extends Node3D
## One fight at a landmark plaza (cq 061; combat reworked in cq 233): arena, camera, three
## fighters (runtime GLBs or capsules), combat rules, autoplay bot, perf and input-latency
## instrumentation. Created by Bridge.start_fight(); emits `finished(result)` once.
##
## Combat (cq 233, numbers in docs/game3d/COMBAT.md):
##  - a 3-hit combo (attack_1, attack_2, heavy attack_3) with input buffering and a chain
##    window; hits come from Area3D hitboxes (the weapon arc swept through the swing, skill
##    shapes, the boss's cone and ring) overlapping Area3D hurtboxes, never distance checks;
##  - hit-stop, knockback, the target's flash, sparks scaled to damage, crits;
##  - GUARD (hold): 80% less damage; a press inside PARRY_WINDOW before a hit parries it and
##    staggers the boss; GUARD pressed with the stick pushed is a dodge with i-frames;
##  - 5 skills with cooldowns: CHARGE dash, SPLIT ground slam, WHIRL, RALLY heal + buff,
##    SHIELD barrier; the boss telegraphs every strike with a ring or cone that fills.

signal finished(result: Dictionary)

const FighterScript := preload("res://fighter.gd")
const HudScript := preload("res://hud.gd")
const FxScript := preload("res://fx.gd")
const SfxScript := preload("res://sfx.gd")
const HitArea := preload("res://hit_area.gd")
const LoaderScript := preload("res://char_loader.gd")
const TilesScript := preload("res://tiles_layer.gd")
const ArenaScript := preload("res://arena.gd")

# ---- fighters
const HERO_HP: int = 1000
const ALLY_HP: int = 800
const ENEMY_HP: int = 6500
const HERO_SPEED: float = 4.6            # m/s, no acceleration ramp: moves on the first frame
const ARENA_HALF_X: float = 4.7         # the street between the kerbs
const ARENA_Z: Vector2 = Vector2(-9.0, 9.0)   # along the street: the camera (CAM_BOUNDS) keeps the whole fight framed

# ---- the hero's combo. len: swing length; open/close: the hitbox's live window (s);
# sweep: the arc's yaw from/to (deg, + is the hero's left); lift: the trail's height
# from/to over the swing (m, for the overhead third hit)
const COMBO: Array[Dictionary] = [
	{"state": "attack_1", "len": 0.34, "open": 0.05, "close": 0.17, "dmg": Vector2i(60, 80), "kb": 0.35,
		"stop": 3.0 / 60.0, "sweep": Vector2(80, -80), "reach": 2.4, "lift": Vector2(0.15, -0.1), "heavy": false},
	{"state": "attack_2", "len": 0.36, "open": 0.05, "close": 0.17, "dmg": Vector2i(70, 90), "kb": 0.4,
		"stop": 3.0 / 60.0, "sweep": Vector2(-80, 80), "reach": 2.4, "lift": Vector2(-0.1, 0.2), "heavy": false},
	{"state": "attack_3", "len": 0.56, "open": 0.17, "close": 0.3, "dmg": Vector2i(140, 175), "kb": 1.7,
		"stop": 7.0 / 60.0, "sweep": Vector2(30, -30), "reach": 2.8, "lift": Vector2(1.5, -0.7), "heavy": true},
]
const COMBO_CHAIN_AT: float = 0.7        # a buffered press starts the next hit at 70% of this one
const COMBO_RESET: float = 0.55          # seconds after a swing before the chain drops to hit 1
const ATK_BUFFER: float = 0.3            # a press this early is remembered
const CRIT_CHANCE: float = 0.14
const CRIT_MULT: float = 1.6

# ---- effect colours (cq 013): [body, glow] for fx.gd's layered arcs and trails
const CHARGE_COLS: Array = [Color(0.05, 0.85, 0.85), Color(0.35, 1.0, 0.92), "soft"]
const WHIRL_COLS: Array = [Color(1.0, 0.55, 0.12), Color(1.0, 0.82, 0.4)]
const WHIRL_COLS_2: Array = [Color(1.0, 0.4, 0.75), Color(1.0, 0.75, 0.9)]
const BOSS_COLS: Array = [Color(0.9, 0.12, 0.1), Color(1.0, 0.45, 0.3)]

# ---- camera impact (cq 013): trauma adds up per event (capped at 1), decays, and the
# offset is trauma squared, so light hits barely move the view and big ones kick it.
const TRAUMA_DECAY: float = 2.2          # per second
const SHAKE_MAX_M: float = 0.32          # offset at full trauma (the HUD and hero stay readable)
const SHAKE_MAX_ROLL: float = 0.035      # radians of roll at full trauma
const FOV_KICK_DECAY: float = 14.0       # degrees per second back to the base FOV
const SOFT_LOCK: float = 4.5             # face the boss on a swing if it is this close

# ---- guard, parry, dodge
const GUARD_TAKE: float = 0.2            # a blocked hit does 20%
const GUARD_SPEED: float = 0.35
const PARRY_WINDOW: float = 0.22         # guard raised this long (or less) before the hit = parry
const PARRY_STAGGER: float = 1.6         # the boss reels; it takes STAGGER_TAKE damage meanwhile
const STAGGER_TAKE: float = 1.5
const DODGE_LEN: float = 0.36
const DODGE_DIST: float = 3.4
const DODGE_IFRAMES: float = 0.3

# ---- skills: slot order CHARGE SPLIT WHIRL RALLY SHIELD (hud.SKILL_NAMES)
const SKILL_CD: Array[float] = [5.0, 8.0, 6.0, 14.0, 12.0]
const SKILL_LEN: Array[float] = [0.42, 0.72, 0.5, 0.6, 0.5]
# when each skill's strike (or cast) lands, seconds in: a clip's contact frame is lined up with
# it (cq 012; the frames are data in data/anim_clips.json). WHIRL's two hits span its spin, so
# its clip is stretched evenly (-1).
const SKILL_HIT_AT: Array[float] = [0.18, 0.34, -1.0, 0.25, 0.2]
const PARRY_HIT_AT: float = 0.12   # the parry's riposte
const BOLT_HIT_AT: float = 0.06    # the ally's cast, the bolt leaves at once
const CHARGE_DIST: float = 6.0
const CHARGE_DMG: Vector2i = Vector2i(110, 140)
const SPLIT_LEN_M: float = 7.0
const SPLIT_DMG: Vector2i = Vector2i(200, 240)
const WHIRL_RADIUS: float = 3.0
const WHIRL_DMG: Vector2i = Vector2i(90, 110)
const RALLY_HEAL: float = 0.15
const RALLY_MULT: float = 1.3
const RALLY_SECS: float = 6.0
const SHIELD_HP: int = 260
const SHIELD_SECS: float = 6.0
const SUPPORT_RANGE: float = 9.0

# ---- the boss
const ENEMY_SPEED: float = 1.8
const ENEMY_CD: float = 1.5
const SWIPE_R: float = 3.4
const SWIPE_HALF: float = 55.0
const SWIPE_WINDUP: float = 0.8
const SWIPE_DMG: Vector2i = Vector2i(70, 90)
const SLAM_R: float = 2.3
const SLAM_WINDUP: float = 1.05
const SLAM_DMG: Vector2i = Vector2i(110, 140)
const ENEMY_RECOVER: float = 0.6
const ENRAGE_AT: float = 0.35

# ---- the ally (a caster: bolts from range)
const ALLY_SPEED: float = 4.2
const ALLY_RANGE: float = 4.0
const ALLY_DMG: Vector2i = Vector2i(40, 60)
const BOLT_SPEED: float = 14.0

# ---- camera (cq 233: closer and steeper than G0, to match the reference's framing:
# fighters ~1/7 of the screen high, the action on the middle third)
const CAM_PITCH: float = 44.0
const CAM_YAW: float = 0.0
const CAM_FOV: float = 55.0
const CAM_DIST: float = 16.5
const CAM_AHEAD: float = 0.6
const CAM_SMOOTH: float = 0.16
const CAM_LOOK: float = 0.7
const CAM_BOUNDS: float = 8.0          # along the street (the fight keeps within ARENA_Z = +-9)
const CAM_BOUNDS_X: float = 2.2        # across it: the street stays centred, the shop walls at the edges

const TEST_PACKS: String = "/opt/cq/tasks/056-game-forge-in-world-v2/out/packs/"

var cfg: Dictionary = {}
var mode: String = "full"
var autoplay: bool = false
var bot_kind: String = "fight"   # fight | idle (stands still: the loss check)
var state: String = "idle"       # idle | loading | fighting | ending | done
var duration: float = 45.0
var t_left: float = 45.0
var fight_time: float = 0.0
var outcome: String = ""
var rng := RandomNumberGenerator.new()

var hero: FighterScript
var ally: FighterScript
var enemy: FighterScript
var fighters: Array[FighterScript] = []
var cam: Camera3D
var hud: HudScript
var fx: FxScript
var sfx: SfxScript
var tiles: Node3D
var arena: Node3D
var _ground: MeshInstance3D
var plaza: MeshInstance3D

# hero action state: "" | attack | skill | dodge | hit
var _action: String = ""
var _act_t: float = 0.0
var _act_len: float = 0.0
var _combo_i: int = 0               # the swing being played (0..2)
var _combo_next: int = 0
var _combo_shown: int = 0           # pips lit on the attack button
var _since_swing: float = 99.0
var _attack_buffer: float = 0.0
var _atk_data: Dictionary = {}
var _skill: int = -1
var _skill_fired: Dictionary = {}
var _skill_cd: Array[float] = [0.0, 0.0, 0.0, 0.0, 0.0]
var _skill_dir: Vector3 = Vector3.FORWARD
var _skill_from: Vector3 = Vector3.ZERO
var _skill_area: HitArea
var _dodge_dir: Vector3 = Vector3.ZERO
var _guard_wanted: bool = false
var _skill_buffer: int = -1
var _skill_buffer_t: float = 0.0
var _hitstop: float = 0.0

# boss
var _enemy_state: String = "approach"
var _enemy_t: float = 0.0
var _enemy_cd: float = 1.2
var _enemy_kind: String = ""
var _enemy_windup: float = 0.0
var _enemy_target: FighterScript
var _enemy_at: Vector3 = Vector3.ZERO
var _enemy_yaw: float = 0.0
var _enraged: bool = false
var _tele: MeshInstance3D
var _boss_area: HitArea
var _swipe_shape: ConvexPolygonShape3D
var _slam_shape: CylinderShape3D

# ally
var _ally_cd: float = 1.5
var _bolts: Array[Dictionary] = []

# bot
var _bot_guard_t: float = 0.0
var _bot_next_skill: float = 0.0

var _end_t: float = 0.0
var _end_delay: float = 1.0
var stats: Dictionary = {"damage_dealt": 0, "damage_taken": 0, "hits": 0, "skill_uses": 0, "ally_damage": 0,
	"parries": 0, "blocks": 0, "dodges": 0, "crits": 0, "combo_max": 0, "skills": [0, 0, 0, 0, 0]}

# camera state
var _cam_basis: Basis
var _cam_fwd: Vector3
var _cam_right: Vector3
var _focus: Vector3 = Vector3.ZERO
var _focus_vel: Vector3 = Vector3.ZERO
var _look: Vector3 = Vector3.ZERO
var _shake: float = 0.0
var _shake_t: float = 0.0
var _punch: float = 0.0
var _trauma: float = 0.0
var _draws_peak: int = 0
var _base_fov: float = 55.0
var _fov_kick: float = 0.0
var _kick: Vector3 = Vector3.ZERO
var _shake_clock: float = 0.0
var _reduce_motion: bool = false
var _cam_dist: float = CAM_DIST

# loading
var _loader: LoaderScript = LoaderScript.new()
var _load_queue: Array[Dictionary] = []
var _thread: Thread
var _loading_role: Dictionary = {}
var _load_t0: int = 0
var load_ms: float = 0.0
var _load_threaded: bool = true

# instrumentation
var _ft: PackedFloat32Array = PackedFloat32Array()
var _perf_last_us: int = 0
const DYN_RES_SLOW_MS: float = 30.0   # under ~33 fps: fewer 3D pixels
const DYN_RES_FAST_MS: float = 18.0   # over ~55 fps: back up towards render_scale
const DYN_RES_STEP: float = 0.07
const DYN_RES_MIN: float = 0.3
var _dyn_on: bool = false
var _dyn_base: float = 0.5
var _dyn_next_us: int = 0
var _perf_win_us: int = 0
var _lat_move: Dictionary = {}
var _lat_atk: Dictionary = {}
var _lat_printed: Dictionary = {"move": 0, "attack": 0, "move_blocked": 0}
var _headless: bool = false


func configure(c: Dictionary) -> void:
	cfg = c
	mode = str(c.get("mode", "full"))
	if mode != "arena" and mode != "chars":
		mode = "full"
	duration = float(c.get("duration_s", 45.0))
	if duration <= 0.0:
		duration = 45.0
	t_left = duration
	autoplay = bool(c.get("autoplay", false))
	bot_kind = str(c.get("bot", "fight"))
	_load_threaded = bool(c.get("load_thread", true))
	if c.has("seed"):
		rng.seed = int(c["seed"])
	else:
		rng.randomize()


func _ready() -> void:
	_headless = DisplayServer.get_name() == "headless"
	# cam_* overrides are for review captures (close-ups); the game uses the constants
	_cam_dist = float(cfg.get("cam_dist", CAM_DIST))
	_reduce_motion = bool(cfg.get("reduce_motion", false))   # the app's Reduce motion setting: a quarter of the shake, no zoom punch
	_cam_basis = Basis.from_euler(Vector3(deg_to_rad(-float(cfg.get("cam_pitch", CAM_PITCH))), deg_to_rad(float(cfg.get("cam_yaw", CAM_YAW))), 0.0))
	_cam_fwd = Vector3(-_cam_basis.z.x, 0.0, -_cam_basis.z.z).normalized()
	_cam_right = Vector3(_cam_basis.x.x, 0.0, _cam_basis.x.z).normalized()
	var t0: int = Time.get_ticks_usec()
	# 3D drawn at a fraction of the screen's pixels, the HUD at full resolution.
	# A 1080x2400 phone does not need 2.6 M shaded pixels for this view.
	var rs: float = clampf(float(cfg.get("render_scale", 0.5)), 0.25, 1.0)
	get_viewport().scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	get_viewport().scaling_3d_scale = rs
	_dyn_base = rs
	_dyn_on = bool(cfg.get("dyn_res", true)) and not _headless
	# No blocking on vsync (the compositor buffers the surface on Android/iOS, so
	# no tearing), capped at max_fps: a frame that misses a vsync by 1 ms no
	# longer waits a whole extra one, which is input latency.
	if not _headless:
		if not bool(cfg.get("vsync", false)):
			DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		Engine.max_fps = clampi(int(cfg.get("max_fps", 60)), 15, 120)
	print("CQ render_scale=%.2f vsync=%s max_fps=%d" % [rs, str(DisplayServer.window_get_vsync_mode()), Engine.max_fps])
	arena = ArenaScript.new()
	arena.name = "Arena"
	add_child(arena)
	arena.call("build", cfg)
	_ground = arena.get("ground")
	plaza = arena.get("plaza")
	_build_camera()
	fx = FxScript.new()
	fx.name = "Fx"
	add_child(fx)
	sfx = SfxScript.new()
	sfx.name = "Sfx"
	sfx.enabled = bool(cfg.get("sound", true))
	add_child(sfx)
	_build_boss_area()
	var layer := CanvasLayer.new()
	layer.name = "HudLayer"
	add_child(layer)
	hud = HudScript.new()
	hud.name = "Hud"
	layer.add_child(hud)
	hud.cam = cam
	hud.map_blocks = arena.get("map_blocks")
	hud.visible = not bool(cfg.get("prof_no_hud", false))   # profiling only: the 3D cost alone
	hud.players_text = str(cfg.get("players_text", "2/3")).replace(" players", "").replace(" player", "")
	hud.point_name = str(cfg.get("point_name", ""))
	hud.hero_name = str(cfg.get("hero_name", "You"))
	hud.skill_cd_max = SKILL_CD.duplicate()
	hud.t_left = duration
	hud.attack_pressed.connect(_on_attack_pressed)
	hud.skill_pressed.connect(_on_skill_pressed)
	hud.move_started.connect(_on_move_started)
	hud.guard_changed.connect(_on_guard_changed)
	RenderingServer.frame_post_draw.connect(_on_post_draw)
	tiles = TilesScript.new()
	tiles.name = "Tiles"
	add_child(tiles)
	if tiles.call("setup", cfg, cam) == true and _ground != null and bool(cfg.get("tiles_ground", true)):
		arena.call("tiles_mode", bool(cfg.get("tiles_keep_plaza", false)))
	_log("arena built ms=%.1f mode=%s autoplay=%s duration=%.0f" % [(Time.get_ticks_usec() - t0) / 1000.0, mode, autoplay, duration])
	if mode == "arena":
		hud.show_hero_card = false
		_begin_fight()
		return
	# hero_hp / enemy_hp: test and capture knobs (a quick win or loss); the app never sends them
	hero = _spawn(str(cfg.get("hero_name", "You")), 0, int(cfg.get("hero_hp", HERO_HP)), Color(0.3, 0.75, 0.35), Vector3(0.3, 0, 3.6), PI, "hero")
	ally = _spawn(str(cfg.get("ally_name", "Ally")), 0, ALLY_HP, Color(0.3, 0.65, 0.9), Vector3(3.0, 0, 4.4), PI, "ally")
	enemy = _spawn(str(cfg.get("enemy_name", "Guardian")), 1, int(cfg.get("enemy_hp", ENEMY_HP)), Color(0.85, 0.3, 0.25), Vector3(-0.4, 0, -0.6), 0.0, "boss")
	_skill_area = HitArea.new()
	_skill_area.name = "SkillArea"
	var sbox := BoxShape3D.new()
	sbox.size = Vector3(1.6, 2.0, 1.4)
	_skill_area.setup(1, sbox)
	_skill_area.struck.connect(_on_struck)
	hero.add_child(_skill_area)
	for f: FighterScript in fighters:
		f.weapon.struck.connect(_on_struck)
		f.shield_ended.connect(func(at: Vector3, r: float) -> void: fx.shatter(at, r, Color(0.45, 0.8, 1.0)))
	_focus = hero.position + _cam_fwd * CAM_AHEAD
	_apply_camera(0.0)
	for pair: Array in [[hero, "hero_glb"], [ally, "ally_glb"], [enemy, "enemy_glb"]]:
		# the cast clip library and the weapon set (cq 012): by <role>_key when the config
		# has it (else the skeleton is recognised) and the held weapon's class
		var role: String = str(pair[1]).trim_suffix("_glb")
		var wcfg: Variant = cfg.get(role + "_weapon")
		(pair[0] as FighterScript).anim_opts = {"key": str(cfg.get(role + "_key", "")),
			"class": str((wcfg as Dictionary).get("class", "")) if wcfg is Dictionary else ""}
		var p: String = LoaderScript.clean_path(str(cfg.get(pair[1], "")))
		if p != "":
			(pair[0] as FighterScript).visible = false
			_load_queue.append({"f": pair[0], "path": p, "role": str(pair[1]).trim_suffix("_glb")})
		else:
			_log("load role=%s skipped (no path), capsule" % str(pair[1]).trim_suffix("_glb"))
	_queue_weapons()
	if _load_queue.is_empty():
		_begin_fight()
	else:
		state = "loading"
		hud.loading_text = "Loading fighters..."
		_load_t0 = Time.get_ticks_usec()


func _exit_tree() -> void:
	if RenderingServer.frame_post_draw.is_connected(_on_post_draw):
		RenderingServer.frame_post_draw.disconnect(_on_post_draw)
	if _thread != null and _thread.is_started():
		var r: Dictionary = _thread.wait_to_finish()
		var n: Variant = r.get("node")
		if n is Node:
			(n as Node).free()
		_thread = null


func _log(s: String) -> void:
	print("CQ " + s)


# ------------------------------------------------------------ setup

func _build_camera() -> void:
	cam = Camera3D.new()
	cam.name = "Camera"
	cam.fov = float(cfg.get("cam_fov", CAM_FOV))
	_base_fov = cam.fov
	cam.near = 0.5
	cam.far = 160.0
	add_child(cam)
	cam.current = true
	_focus = Vector3(0, 0, 1)
	_apply_camera(0.0)


func _build_boss_area() -> void:
	# the boss's strikes: one world-space Area3D, its shape set per telegraph
	_boss_area = HitArea.new()
	_boss_area.name = "BossStrike"
	var pts := PackedVector3Array()
	pts.append(Vector3(0, 0, 0))
	pts.append(Vector3(0, 2.6, 0))
	var n: int = 10
	for i in n + 1:
		var a: float = deg_to_rad(-SWIPE_HALF + 2.0 * SWIPE_HALF * float(i) / float(n))
		pts.append(Vector3(sin(a) * SWIPE_R, 0, cos(a) * SWIPE_R))
		pts.append(Vector3(sin(a) * SWIPE_R, 2.6, cos(a) * SWIPE_R))
	_swipe_shape = ConvexPolygonShape3D.new()
	_swipe_shape.points = pts
	_slam_shape = CylinderShape3D.new()
	_slam_shape.radius = SLAM_R
	_slam_shape.height = 2.6
	_boss_area.setup(0, _swipe_shape)
	_boss_area.struck.connect(_on_struck)
	add_child(_boss_area)


func _spawn(n: String, team: int, hp_max: int, c: Color, at: Vector3, yaw: float, r: String) -> FighterScript:
	var f := FighterScript.new()
	f.name = n.validate_node_name()
	add_child(f)
	f.setup(n, team, hp_max, c, r)
	f.position = at
	f.yaw = yaw
	f.rotation.y = yaw
	fighters.append(f)
	return f


# ------------------------------------------------------------ loading

func _poll_loading() -> void:
	if _thread != null:
		if _thread.is_alive():
			return
		var r: Dictionary = _thread.wait_to_finish()
		_thread = null
		_finish_load(r)
	if _load_queue.is_empty():
		load_ms = (Time.get_ticks_usec() - _load_t0) / 1000.0
		_log("load_total ms=%.1f threaded=%s" % [load_ms, _load_threaded])
		hud.loading_text = ""
		for f: FighterScript in fighters:
			f.visible = true
		_begin_fight()
		return
	_loading_role = _load_queue.pop_front()
	var path: String = _loading_role["path"]
	if _load_threaded:
		_thread = Thread.new()
		if _thread.start(_loader.load_glb.bind(path)) != OK:
			_thread = null
			_finish_load(_loader.load_glb(path))
	else:
		_finish_load(_loader.load_glb(path))   # one model per frame on the main thread


## Weapons in hand (cq 234). Per fighter the config may name
##   <role>_weapon / <role>_offhand: {"glb": path, "class": "sword", "bone": "RightHand",
##     "matrix": [16 floats]}  (bone + matrix as in data/attach.json; when they are
##     missing they are read from that manifest by "character" or <role>_key)
## and they load after the three characters.
const ATTACH_JSON: String = "res://data/attach.json"
var _attach: Dictionary = {}


func _attach_manifest() -> Dictionary:
	if _attach.is_empty() and FileAccess.file_exists(ATTACH_JSON):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(ATTACH_JSON))
		if d is Dictionary:
			_attach = d
	return _attach


func _queue_weapons() -> void:
	for pair: Array in [[hero, "hero"], [ally, "ally"], [enemy, "enemy"]]:
		for slot: Array in [["_weapon", "r"], ["_offhand", "l"]]:
			var w: Variant = cfg.get(str(pair[1]) + str(slot[0]))
			if not (w is Dictionary):
				continue
			var wd: Dictionary = w
			var path: String = LoaderScript.clean_path(str(wd.get("glb", "")))
			var cls: String = str(wd.get("class", "sword"))
			var att: Dictionary = {}
			if wd.has("matrix"):
				att = {"bone": str(wd.get("bone", "")), "matrix": wd["matrix"]}
			else:
				var key: String = str(wd.get("character", cfg.get(str(pair[1]) + "_key", "")))
				var ch: Dictionary = (_attach_manifest().get("characters", {}) as Dictionary).get(key, {})
				att = (ch.get("grips", {}) as Dictionary).get(cls, {})
			if path == "" or att.is_empty():
				_log("weapon role=%s side=%s skipped path=%s attach=%s" % [pair[1], slot[1], path, str(not att.is_empty())])
				continue
			_load_queue.append({"f": pair[0], "path": path, "role": str(pair[1]) + "_weapon_" + str(slot[1]), "weapon": slot[1], "att": att, "class": cls})


func _finish_load(r: Dictionary) -> void:
	var f: FighterScript = _loading_role["f"]
	var role: String = _loading_role["role"]
	var t_add: int = Time.get_ticks_usec()
	if _loading_role.has("weapon"):
		if bool(r.get("ok", false)):
			# a fighter playing the cast clips holds the weapon the way the clips were made
			# for (attach.json clip_grips, cq 012); else the idle-fitted grip
			if f.anim.lib_key != "":
				var cg: Dictionary = ((_attach_manifest().get("characters", {}) as Dictionary).get(f.anim.lib_key, {}) as Dictionary).get("clip_grips", {})
				if cg.has(str(_loading_role["class"])):
					_loading_role["att"] = cg[str(_loading_role["class"])]
			var why: String = f.hold_weapon(r["node"] as Node3D, _loading_role["att"], str(_loading_role["weapon"]), str(_loading_role["class"]))
			_log("weapon role=%s class=%s bone=%s ok=%s %s parse_ms=%.1f path=%s" % [role, str(_loading_role["class"]), str(_loading_role["att"].get("bone", "")), str(why == ""), why, float(r["parse_ms"]), str(r["path"])])
		else:
			_log("weapon role=%s ok=false error=%s path=%s" % [role, str(r.get("error", "?")), str(r.get("path", ""))])
		return
	if bool(r.get("ok", false)):
		var info: Dictionary = f.set_model(r["node"] as Node3D)
		_log("load role=%s ok=true parse_ms=%.1f gen_ms=%.1f add_ms=%.1f scale=%.3f raw_h=%.3f library=%s anims=%d mapped=%s bones=%d hand=%s path=%s" % [
			role, float(r["parse_ms"]), float(r["gen_ms"]), (Time.get_ticks_usec() - t_add) / 1000.0,
			float(info["scale"]), float(info["height_raw"]), str(info.get("library", "")), (info["anims"] as PackedStringArray).size(), JSON.stringify(info["mapped"]),
			int(info["bones"]), str(info["hand"]), str(r["path"])])
	else:
		f.set_capsule()
		_log("load role=%s ok=false error=%s path=%s (capsule fallback)" % [role, str(r.get("error", "?")), str(r.get("path", ""))])


## The hero card's portrait, as on the reference: the loaded hero's face, rendered once by a
## small camera into a 128 px image (the SubViewport shares the fight's world, then goes).
func _make_portrait() -> void:
	if hero == null or _headless or not bool(cfg.get("portrait", true)):
		return
	var vp := SubViewport.new()
	vp.name = "Portrait"
	vp.size = Vector2i(128, 128)
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	var c := Camera3D.new()
	c.fov = 21.0
	vp.add_child(c)
	add_child(vp)
	var fwd: Vector3 = hero.global_transform.basis.z.normalized()
	var face: Vector3 = hero.global_position + Vector3(0, FighterScript.HEIGHT * hero.size_k * 0.9, 0)
	c.look_at_from_position(face + fwd * 1.6 + Vector3(0, 0.2, 0), face, Vector3.UP)
	c.current = true
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	if not is_instance_valid(vp):
		return
	var img: Image = vp.get_texture().get_image()
	vp.queue_free()
	if img != null and hud != null:
		hud.portrait = ImageTexture.create_from_image(img)


func _begin_fight() -> void:
	_make_portrait()
	state = "fighting"
	fight_time = 0.0
	t_left = duration
	_perf_last_us = 0
	_ft.clear()
	_log("fight_start mode=%s" % mode)


# ------------------------------------------------------------ input from the HUD

func _on_move_started(t_in: float, ticks_in: int, src: String) -> void:
	if hero == null or state != "fighting":
		return
	# a push while the hero cannot move (a skill, a dodge, hit stun, hit-stop) waits for the move to
	# end by design: logged as move_blocked, so "move" stays the input-to-motion latency
	var free: bool = (_action == "" or _action == "attack") and _hitstop <= 0.0 and hero.stagger <= 0.0 and not hero.dead
	_lat_move = {"t_in": t_in, "ticks_in": ticks_in, "frame_in": Engine.get_process_frames(), "pos0": hero.global_position, "src": src,
		"kind": "move" if free else "move_blocked"}


func _on_attack_pressed(t_in: float, ticks_in: int, src: String) -> void:
	if hero == null or state != "fighting":
		return
	_attack_buffer = ATK_BUFFER
	_lat_atk = {"t_in": t_in, "ticks_in": ticks_in, "frame_in": Engine.get_process_frames(), "node": null, "src": src}
	# Start the swing on this very frame when the hero is free: the press is drawn next frame.
	if _action == "" and not hero.guarding and not hero.dead:
		_attack_buffer = 0.0
		_swing()


func _on_skill_pressed(slot: int, _t_in: float, _ticks_in: int, src: String) -> void:
	if hero == null or state != "fighting" or hero.dead:
		return
	if _skill_cd[slot] > 0.0:
		if src != "bot":
			hud.toast("%ds" % int(ceil(_skill_cd[slot])), hud.skill_centre(slot) + Vector2(0, -hud.SKILL_R - 22))
		return
	if not _can_cast():
		# pressed during another move: remembered briefly and cast the moment it ends
		_skill_buffer = slot
		_skill_buffer_t = 0.4
		return
	_cast(slot)


func _on_guard_changed(on: bool, _t_in: float, _ticks_in: int, _src: String) -> void:
	_guard_wanted = on
	if hero == null or state != "fighting" or hero.dead:
		return
	if on:
		var w: Vector3 = _stick_world()
		if w.length() > 0.5 and (_action == "" or (_action == "attack" and _act_t > float(_atk_data.get("close", 0.0)))):
			_start_dodge(w.normalized())
		elif _action == "" or (_action == "attack" and _act_t > float(_atk_data.get("close", 0.0))):
			_end_action()
			hero.set_guard(true)
	else:
		hero.set_guard(false)


func _stick_world() -> Vector3:
	var s: Vector2 = hud.stick
	var w: Vector3 = _cam_right * s.x + _cam_fwd * s.y
	return w.limit_length(1.0)


# ------------------------------------------------------------ frame

func _process(dt: float) -> void:
	if state == "fighting" or state == "ending":
		_perf_sample(dt)
	if state == "loading":
		_poll_loading()
	elif state == "fighting":
		_tick_fight(dt)
	elif state == "ending":
		_end_t += dt
		if _end_t >= _end_delay:
			_emit_result()
	var frozen: bool = _hitstop > 0.0
	if _hitstop > 0.0:
		_hitstop -= dt
	for f: FighterScript in fighters:
		f.anim_freeze = frozen
		f.tick_visual(dt)
	_follow_camera(dt)
	_sync_hud()
	if _headless and (not _lat_move.is_empty() or not _lat_atk.is_empty()):
		_check_latency.call_deferred("deferred")


func _tick_fight(dt: float) -> void:
	fight_time += dt
	t_left = maxf(0.0, duration - fight_time)
	var logic_dt: float = 0.0 if _hitstop > 0.0 else dt
	if hero != null:
		if autoplay:
			_bot(dt)
		for i in 5:
			_skill_cd[i] = maxf(0.0, _skill_cd[i] - dt)
		_attack_buffer = maxf(0.0, _attack_buffer - dt)
		_since_swing += logic_dt
		for f: FighterScript in fighters:
			f.tick_logic(logic_dt)
		_tick_hero(logic_dt, dt)
		_tick_enemy(logic_dt)
		_tick_ally(logic_dt)
		_tick_bolts(logic_dt)
		_separate()
		for f: FighterScript in fighters:
			_clamp_arena(f)
	# outcomes
	if mode == "full":
		if enemy != null and enemy.hp <= 0:
			_end("win")
			return
		if hero != null and hero.hp <= 0:
			_end("lose")
			return
	if t_left <= 0.0:
		_end("timeout")


# ------------------------------------------------------------ the hero

func _tick_hero(dt: float, real_dt: float) -> void:
	if hero.dead:
		hero.speed_now = 0.0
		return
	if _action != "":
		_act_t += dt
		match _action:
			"attack":
				_tick_swing(dt)
			"skill":
				_tick_skill(dt)
			"dodge":
				var k: float = _act_t / DODGE_LEN
				if k < 0.8:
					hero.position += _dodge_dir * (DODGE_DIST / (DODGE_LEN * 0.8)) * dt
			"hit":
				pass
		if _act_t >= _act_len and _action != "":
			var was: String = _action
			_end_action()
			if was == "dodge" and _guard_wanted:
				hero.set_guard(true)
	# a skill pressed during the last move
	if _skill_buffer >= 0:
		_skill_buffer_t -= dt
		if _skill_buffer_t <= 0.0:
			_skill_buffer = -1
		elif _can_cast() and _skill_cd[_skill_buffer] <= 0.0:
			var b: int = _skill_buffer
			_skill_buffer = -1
			_cast(b)
	# attack input: buffered presses and a held button
	var want_attack: bool = _attack_buffer > 0.0 or hud.attack_held
	if want_attack and not hero.guarding:
		if _action == "":
			_attack_buffer = 0.0
			_swing()
	# movement
	var w: Vector3 = _stick_world()
	var spd: float = HERO_SPEED
	match _action:
		"attack":
			spd *= 0.25
		"skill", "dodge", "hit":
			spd = 0.0
	if hero.guarding:
		spd *= GUARD_SPEED
	if hero.stagger > 0.0:
		spd = 0.0
	hero.position += w * spd * real_dt * (0.0 if dt <= 0.0 else 1.0)
	hero.speed_now = w.length() * spd
	if w.length() > 0.05 and (_action == "" or _action == "attack" and _act_t > float(_atk_data.get("close", 0.0))):
		hero.face(w, dt, 22.0)
	elif hero.guarding and enemy != null and not enemy.dead:
		hero.face(_flat(enemy.position - hero.position), dt, 10.0)


func _end_action() -> void:
	if _action == "attack":
		hero.weapon.close()
		_since_swing = 0.0
	if _action == "skill":
		_skill_area.close()
	_action = ""
	_act_t = 0.0
	_skill = -1


func _swing() -> void:
	if _since_swing > COMBO_RESET and _action != "attack":
		_combo_next = 0
	_combo_i = _combo_next
	_atk_data = COMBO[_combo_i]
	_combo_next = (_combo_i + 1) % COMBO.size()
	_action = "attack"
	_act_t = 0.0
	_act_len = float(_atk_data["len"])
	_combo_shown = _combo_i + 1
	stats["combo_max"] = maxi(int(stats["combo_max"]), _combo_shown)
	if enemy != null and not enemy.dead:
		var to: Vector3 = _flat(enemy.position - hero.position)
		if to.length() < SOFT_LOCK:
			hero.face(to, 0.0, 0.0)
	fx.trail_cut("hero%d" % _combo_i)
	_tip_prev = {}
	_hero_wclass = _wclass(hero)
	hero.act(str(_atk_data["state"]), _act_len, (float(_atk_data["open"]) + float(_atk_data["close"])) * 0.5)
	hero.set_reach(float(_atk_data["reach"]), 0.6 if bool(_atk_data["heavy"]) else 0.45)
	var sweep: Vector2 = _atk_data["sweep"]
	var heavy: bool = _atk_data["heavy"]
	var cols: Array = _swing_cols(heavy)
	var tilt: float = [0.3, -0.3, 0.75][_combo_i]   # the overhead third hit leans so the camera sees its face, not its edge
	# the crescent (or a gun's muzzle flash) shows on the press frame: that is what the
	# latency rig times. Sized to the swing: the edge sits near the hitbox reach.
	var node: MeshInstance3D
	if _hero_wclass == "gun" and enemy != null:
		var muzzle: Vector3 = _weapon_tip(hero)
		if muzzle == Vector3.INF:
			muzzle = hero.chest_pos() + hero.forward() * 0.8
		node = fx.muzzle(muzzle, enemy.chest_pos(), cols)
	else:
		var reach: float = float(_atk_data["reach"])
		node = fx.slash(hero.position + Vector3(0, 1.0, 0) + hero.forward() * 0.1, hero.yaw, cols, reach * (1.2 if heavy else 1.05), tilt, 0.4 if heavy else 0.32, true)
	if not _lat_atk.is_empty() and _lat_atk["node"] == null:
		_lat_atk["node"] = node
	sfx.play("swing_heavy" if heavy else "swing", 1.0 - 0.06 * _combo_i)


var _swing_prev_deg: float = 0.0


func _tick_swing(_dt: float) -> void:
	var d: Dictionary = _atk_data
	var open: float = d["open"]
	var close: float = d["close"]
	var sweep: Vector2 = d["sweep"]
	var lift: Vector2 = d["lift"]
	var k: float = clampf((_act_t - open) / maxf(0.01, close - open), 0.0, 1.0)
	var yaw_deg: float = lerpf(sweep.x, sweep.y, ease(k, 0.6))
	var live: bool = _act_t >= open and (_act_t <= close or hero.weapon.active)
	if live:
		if not hero.weapon.active:
			hero.weapon.open({"src": hero, "kind": "melee", "dmg": d["dmg"], "kb": d["kb"], "stop": d["stop"],
				"heavy": d["heavy"], "combo": _combo_i})
			_swing_prev_deg = sweep.x
		# the hitbox is the fan the weapon swept since the last frame (frame-rate proof)
		hero.sweep_arc(_swing_prev_deg, yaw_deg)
		hero.weapon.scan()
		if _act_t > close:
			hero.weapon.close()
	# the ribbon follows the weapon tip when a clip plays it (cq 012), else the procedural arc
	# (hilt at 0.42 of the reach, tip at the reach), filled in between frames
	if _hero_wclass == "gun":
		pass
	elif _tip_trail_ok() and _act_t >= open - 0.07 and _act_t <= close + 0.05:
		_push_tip_trail("hero%d" % _combo_i, _swing_cols(bool(d["heavy"])), float(d["reach"]), _dt)
	elif not _tip_trail_ok() and _act_t >= open - 0.03 and (_act_t <= close + 0.03 or live):
		var reach: float = d["reach"]
		var from_deg: float = _swing_prev_deg if live else yaw_deg
		var steps: int = clampi(int(absf(yaw_deg - from_deg) / 10.0), 0, 10)
		for i in steps + 1:
			var u: float = float(i + 1) / float(steps + 1)
			var a_deg: float = lerpf(from_deg, yaw_deg, u)
			var kk: float = clampf(k - (1.0 - u) * 0.15, 0.0, 1.0) if steps > 0 else k
			var a: float = hero.yaw + deg_to_rad(a_deg)
			var dir := Vector3(sin(a), 0, cos(a))
			var h: float = 1.15 + lerpf(lift.x, lift.y, kk)
			var base: Vector3 = hero.position + Vector3(0, 1.15 + lerpf(lift.x, lift.y, kk) * 0.4, 0) + dir * (reach * 0.42)
			var tip: Vector3 = hero.position + Vector3(0, h, 0) + dir * reach
			fx.trail_push("hero%d" % _combo_i, base, tip, _swing_cols(bool(d["heavy"])), (1.0 - u) * _dt, 0.45)
	_swing_prev_deg = yaw_deg
	# chain: a buffered press (or a held button) starts the next hit at COMBO_CHAIN_AT
	if (_attack_buffer > 0.0 or hud.attack_held) and _act_t >= _act_len * COMBO_CHAIN_AT and _combo_i < COMBO.size() - 1:
		_attack_buffer = 0.0
		hero.weapon.close()
		_action = ""
		_since_swing = 0.0   # a chained hit is never a fresh start (the reset check in _swing)
		_swing()
	elif _act_t >= _act_len and _combo_i == COMBO.size() - 1:
		_combo_next = 0


# ------------------------------------------------------------ slash look (cq 013)

var _hero_wclass: String = "blade"
var _tip_prev: Dictionary = {}


## The held weapon's effect class: blade (sword, dagger, axe), heavy (hammer, greatsword),
## staff, or gun (rifle, crossbow: a muzzle flash and tracer instead of an arc).
func _wclass(f: FighterScript) -> String:
	if f == null or not f.weapons.has("r"):
		return "blade"
	var c: String = str((f.weapons["r"] as Dictionary).get("class", ""))
	if c in ["hammer", "greatsword", "warhammer", "mace"]:
		return "heavy"
	if c in ["staff", "wand"]:
		return "staff"
	if c in ["rifle", "crossbow", "gun", "pistol", "bow"]:
		return "gun"
	return "blade"


func _swing_cols(heavy: bool) -> Array:
	if heavy:
		return fx.GOLD
	return fx.CLASS_COLS.get(_hero_wclass, fx.CLASS_COLS["blade"])


## The weapon's far end in the world (the end of its mesh's longest axis away from the
## grip), or Vector3.INF. The local point is measured once per weapon.
func _weapon_tip(f: FighterScript) -> Vector3:
	if f == null or not f.weapons.has("r"):
		return Vector3.INF
	var w: Dictionary = f.weapons["r"]
	var holder := w["node"] as Node3D
	if holder == null or not is_instance_valid(holder) or not holder.is_inside_tree():
		return Vector3.INF
	if not w.has("tip_local"):
		var box := AABB()
		var first: bool = true
		var inv: Transform3D = holder.global_transform.affine_inverse()
		for n: Node in holder.find_children("*", "MeshInstance3D", true, false):
			var mi := n as MeshInstance3D
			var bb: AABB = (inv * mi.global_transform) * mi.get_aabb()
			box = bb if first else box.merge(bb)
			first = false
		if first:
			w["tip_local"] = Vector3.INF
		else:
			var ax: int = box.get_longest_axis_index()
			var lo: Vector3 = box.get_center()
			var hi: Vector3 = lo
			lo[ax] = box.position[ax]
			hi[ax] = box.end[ax]
			w["tip_local"] = hi if hi.length() > lo.length() else lo
	var tl: Vector3 = w["tip_local"]
	if tl == Vector3.INF:
		return tl
	return holder.global_transform * tl


## True when the hero's swing plays a real clip with a weapon in hand (cq 012).
func _tip_trail_ok() -> bool:
	return hero.weapons.has("r") and hero.anim.has_clip(str(_atk_data.get("state", ""))) and _weapon_tip(hero) != Vector3.INF


## One frame of the weapon ribbon along the real tip path. The ribbon runs out from the
## chest through the tip (inner edge at 58 % of the outer), pushed out to at least 85 % of
## the hitbox reach so the arc is about a fighter's height across, as on the reference.
## Between frames it is filled in round the chest (polar), so a fast swing stays an arc.
func _push_tip_trail(key: String, cols: Array, reach: float, frame_dt: float) -> void:
	var tip: Vector3 = _weapon_tip(hero)
	var c: Vector3 = hero.position + Vector3(0, 1.05, 0)
	var off: Vector3 = tip - c
	var r: float = off.length()
	if r < 0.05:
		return
	var dir: Vector3 = off / r
	var r_out: float = maxf(r * 1.15, reach * 0.85)
	if not _tip_prev.is_empty() and str(_tip_prev["key"]) == key:
		var pd: Vector3 = _tip_prev["dir"]
		var pr: float = _tip_prev["r"]
		var steps: int = clampi(int(pd.angle_to(dir) / deg_to_rad(7.0)), 0, 10)
		for i in steps:
			var u: float = float(i + 1) / float(steps + 1)
			var dd: Vector3 = pd.slerp(dir, u).normalized()
			var ro: float = lerpf(pr, r_out, u)
			fx.trail_push(key, c + dd * ro * 0.58, c + dd * ro, cols, (1.0 - u) * frame_dt, 0.45)
	fx.trail_push(key, c + dir * r_out * 0.58, c + dir * r_out, cols, 0.0, 0.45)
	_tip_prev = {"key": key, "dir": dir, "r": r_out}


# ------------------------------------------------------------ skills

func _can_cast() -> bool:
	if hero.dead or hero.stagger > 0.0:
		return false
	if _action == "" :
		return true
	# skills cancel a swing's recovery (after its hitbox closed)
	return _action == "attack" and _act_t > float(_atk_data.get("close", 0.0))


func _cast(slot: int) -> void:
	_end_action()
	hero.set_guard(false)
	_skill = slot
	_action = "skill"
	_act_t = 0.0
	_act_len = SKILL_LEN[slot]
	_skill_fired = {}
	_skill_cd[slot] = SKILL_CD[slot]
	stats["skill_uses"] = int(stats["skill_uses"]) + 1
	(stats["skills"] as Array)[slot] = int((stats["skills"] as Array)[slot]) + 1
	_combo_next = 0
	var names: Array[String] = ["skill_charge", "skill_split", "skill_whirl", "skill_rally", "skill_shield"]
	hero.act(names[slot], _act_len, SKILL_HIT_AT[slot])
	# aim: the stick if pushed, else the boss if near, else the facing
	var aim: Vector3 = _stick_world()
	if aim.length() < 0.3 and enemy != null and not enemy.dead and _flat(enemy.position - hero.position).length() < 9.0:
		aim = _flat(enemy.position - hero.position)
	if aim.length() < 0.05:
		aim = hero.forward()
	_skill_dir = aim.normalized()
	_skill_from = hero.position
	if slot <= 2:
		hero.face(_skill_dir, 0.0, 0.0)
	var cols: Array[Color] = [Color(0.4, 0.95, 0.9), Color(1.0, 0.6, 0.25), Color(1.0, 0.82, 0.35), Color(0.5, 1.0, 0.5), Color(0.5, 0.85, 1.0)]
	hud.callout(hud.SKILL_NAMES[slot], cols[slot])
	match slot:
		0:
			hero.iframes = 0.34
			fx.charge_start(hero.position, _skill_dir, CHARGE_COLS[0])
			sfx.play("dash")
			_skill_area_shape(Vector3(1.8, 2.0, 1.6), Vector3(0, 1.0, 0.6))
			_skill_area.open({"src": hero, "kind": "charge", "dmg": CHARGE_DMG, "kb": 1.8, "stop": 5.0 / 60.0, "heavy": true})
		1:
			sfx.play("swing_heavy")
		2:
			sfx.play("skill")
		3, 4:
			sfx.play("skill", 1.2)


func _skill_area_shape(sz: Vector3, at: Vector3) -> void:
	var b := _skill_area.shape_node.shape as BoxShape3D
	if b == null:
		b = BoxShape3D.new()
		_skill_area.shape_node.shape = b
	b.size = sz
	_skill_area.shape_node.position = at


func _fire_once(key: String) -> bool:
	if _skill_fired.has(key):
		return false
	_skill_fired[key] = true
	return true


func _tick_skill(dt: float) -> void:
	var t: float = _act_t
	match _skill:
		0:   # CHARGE: a 6 m dash that hits what it passes through
			if t >= 0.05 and t <= 0.31:
				hero.position += _skill_dir * (CHARGE_DIST / 0.26) * dt
				_skill_area.scan()
				# the energy trail: a tall ribbon behind the hero, plus speed streaks
				fx.trail_push("charge", hero.position + Vector3(0, 0.15, 0), hero.position + Vector3(0, 1.9, 0), CHARGE_COLS, 0.0, 0.5)
				if Engine.get_process_frames() % 2 == 0:
					var side: Vector3 = Vector3(_skill_dir.z, 0, -_skill_dir.x) * randf_range(-0.7, 0.7)
					fx.speed_line(hero.position + Vector3(0, randf_range(0.4, 1.6), 0) + side - _skill_dir * 0.6, _skill_dir, CHARGE_COLS[1])
			elif t > 0.31 and _fire_once("end"):
				_skill_area.close()
				fx.charge_end(hero.position, _skill_dir, CHARGE_COLS[0])
				_impact_cam(0.35, 1.5)
		1:   # SPLIT: hop, slam, a crack that runs 7 m ahead
			if t >= 0.34 and _fire_once("slam"):
				_shake_cam(0.2, 0.3)
				_punch = maxf(_punch, 0.7)
				sfx.play("slam")
				fx.split_slam(hero.position + _skill_dir * 0.5, _skill_dir)
				_impact_cam(0.6, 4.0)
				fx.ground_split(hero.position + _skill_dir * 0.8, _skill_dir, SPLIT_LEN_M, 0.25, Color(1.0, 0.55, 0.2))
				hero.remove_child(_skill_area)
				add_child(_skill_area)
				_skill_area.global_position = hero.position
				_skill_area.rotation = Vector3(0, atan2(_skill_dir.x, _skill_dir.z), 0)
				_skill_area.open({"src": hero, "kind": "split", "dmg": SPLIT_DMG, "kb": 2.2, "stop": 8.0 / 60.0, "heavy": true, "stagger": 0.8})
			if t >= 0.34 and t <= 0.62:
				var len_now: float = SPLIT_LEN_M * clampf((t - 0.34) / 0.25, 0.1, 1.0)
				_skill_area_shape(Vector3(1.9, 2.0, len_now), Vector3(0, 1.0, 0.6 + len_now * 0.5))
				_skill_area.scan()
			if t > 0.62 and _fire_once("end"):
				_skill_area.close()
				remove_child(_skill_area)
				hero.add_child(_skill_area)
				_skill_area.transform = Transform3D.IDENTITY
		2:   # WHIRL: two spinning hits round the hero
			for hit_i in 2:
				var at_t: float = [0.08, 0.3][hit_i]
				if t >= at_t and _fire_once("w%d" % hit_i):
					fx.whirl(hero.position, WHIRL_RADIUS, WHIRL_COLS if hit_i == 0 else WHIRL_COLS_2, 1.0, hit_i == 1)
					_shake_cam(0.12, 0.25)
					_impact_cam(0.3, 0.0)
					_punch = maxf(_punch, 0.4)
					sfx.play("swing_heavy", 1.1)
					var cyl := CylinderShape3D.new()
					cyl.radius = WHIRL_RADIUS
					cyl.height = 2.4
					_skill_area.shape_node.shape = cyl
					_skill_area.shape_node.position = Vector3(0, 1.0, 0)
					_skill_area.open({"src": hero, "kind": "whirl", "dmg": WHIRL_DMG, "kb": 1.0, "stop": 4.0 / 60.0, "heavy": true})
				if t >= at_t and t <= at_t + 0.08:
					_skill_area.scan()
				elif t > at_t + 0.08 and _fire_once("wc%d" % hit_i):
					_skill_area.close()
		3:   # RALLY: heal and a damage buff for the hero and a nearby ally
			if t >= 0.25 and _fire_once("rally"):
				sfx.play("rally")
				for f: FighterScript in [hero, ally]:
					if f == null or f.dead or _flat(f.position - hero.position).length() > SUPPORT_RANGE:
						continue
					var heal: int = int(round(f.max_hp * RALLY_HEAL))
					f.hp = mini(f.max_hp, f.hp + heal)
					f.give_buff(RALLY_MULT, RALLY_SECS)
					fx.heal(f.position, Color(0.55, 1.0, 0.45))
					hud.pop(f.chest_pos() + Vector3(0, 0.6, 0), "+%d" % heal, "heal")
		4:   # SHIELD: a barrier over the hero and a nearby ally
			if t >= 0.2 and _fire_once("shield"):
				sfx.play("block", 1.3)
				for f: FighterScript in [hero, ally]:
					if f == null or f.dead or _flat(f.position - hero.position).length() > SUPPORT_RANGE:
						continue
					f.give_shield(SHIELD_HP, SHIELD_SECS)
					fx.shield_up(f.position, 1.3 * f.size_k, Color(0.45, 0.8, 1.0))


func _start_dodge(dir: Vector3) -> void:
	_end_action()
	hero.set_guard(false)
	_action = "dodge"
	_act_t = 0.0
	_act_len = DODGE_LEN
	_dodge_dir = dir
	hero.iframes = DODGE_IFRAMES
	hero.face(dir, 0.0, 0.0)
	hero.act("dodge", DODGE_LEN)
	fx.dust(hero.position)
	fx.speed_line(hero.position + Vector3(0, 0.9, 0), dir, Color(0.75, 0.9, 1.0))
	sfx.play("dash", 1.2)


# ------------------------------------------------------------ hits

func _on_struck(target: Node3D, area: Area3D) -> void:
	var info: Dictionary = (area as HitArea).info
	var src: FighterScript = info.get("src")
	var dst := target as FighterScript
	if dst == null or src == null or dst.dead or state != "fighting":
		return
	_apply_hit(src, dst, info)


func _apply_hit(src: FighterScript, dst: FighterScript, info: Dictionary) -> void:
	var r: Vector2i = info["dmg"]
	var heavy: bool = bool(info.get("heavy", false))
	var amount: int = rng.randi_range(r.x, r.y)
	amount = int(round(amount * src.buff_mult))
	var away: Vector3 = _flat(dst.position - src.position)
	var pop_at: Vector3 = dst.chest_pos() + Vector3(0, 0.25 * dst.size_k, 0)   # on the target's body, as on the reference
	# dodge: i-frames
	if dst.iframes > 0.0:
		hud.pop(pop_at, "DODGE", "dodge")
		if dst == hero:
			stats["dodges"] = int(stats["dodges"]) + 1
		return
	# guard and parry (the boss's strikes only; facing the attacker)
	if dst == hero and hero.guarding and bool(info.get("parryable", false)):
		var facing_ok: bool = hero.forward().angle_to(-away.normalized()) < deg_to_rad(100.0)
		if facing_ok and hero.guard_t <= PARRY_WINDOW:
			_parry(src)
			return
		if facing_ok:
			amount = maxi(1, int(round(amount * GUARD_TAKE)))
			stats["blocks"] = int(stats["blocks"]) + 1
			_take(dst, amount, src, false)
			hud.pop(pop_at, "BLOCK %d" % amount, "blocked")
			fx.sparks(hero.chest_pos() + hero.forward() * 0.4, Color(0.7, 0.85, 1.0), 60)
			sfx.play("block")
			hero.knock(away, 0.5)
			_hitstop = maxf(_hitstop, 3.0 / 60.0)
			_shake_cam(0.06, 0.12)
			return
	# crits (the hero's side)
	var crit: bool = false
	if src.team == 0 and rng.randf() < CRIT_CHANCE * (1.6 if heavy else 1.0):
		crit = true
		amount = int(round(amount * CRIT_MULT))
	if dst == enemy and enemy.stagger > 0.0:
		amount = int(round(amount * STAGGER_TAKE))
	# the barrier soaks first
	var left: int = dst.absorb(amount)
	if left < amount:
		hud.pop(pop_at + Vector3(0, 0.35, 0), "ABSORB %d" % (amount - left), "absorbed")
		fx.shock(dst.position, 1.25 * dst.size_k, Color(0.45, 0.8, 1.0), 0.3)
		sfx.play("block", 1.4)
	if left > 0:
		_take(dst, left, src, crit)
	# feedback
	dst.flash(0.85 if crit else (0.7 if heavy else 0.55))   # cq 013: a short white pop that keeps the body readable
	dst.hurt_pop()
	var kb: float = float(info.get("kb", 0.3))
	if dst == enemy:
		kb *= 0.45   # the boss is heavy
	if kb > 0.0:
		dst.knock(away, kb)
	var tint: Color = Color(1.0, 0.85, 0.35) if (heavy or crit) else Color(0.8, 0.92, 1.0)
	if src == ally:
		tint = Color(0.6, 0.85, 1.0)
	if dst.team == 0:
		tint = Color(1.0, 0.35, 0.25)
	var contact: Vector3 = dst.chest_pos() - away.normalized() * 0.45 * dst.size_k   # on the body's surface, facing the blow
	fx.sparks(contact, tint, amount, crit, away)
	if heavy and src == hero:
		fx.dust(dst.position, amount >= 140)
	if crit:
		fx.decal(fx.SCORCH, dst.position + away.normalized() * 0.3, 1.1 + 0.3 * dst.size_k, Color(0.12, 0.08, 0.07, 0.6), 3.0)
	if src == hero or dst == hero:
		var big: bool = crit or amount >= 140 or (src == enemy and heavy)
		_impact_cam(0.42 if crit else (0.32 if big else 0.14), (1.6 if crit else (1.2 if big else 0.0)), away)
	var stop: float = float(info.get("stop", 3.0 / 60.0))
	if src == hero or dst == hero:
		_hitstop = maxf(_hitstop, stop * (1.4 if crit else 1.0))
	if left > 0:
		var style: String = "normal"
		if dst.team == 0:
			style = "hurt"
		elif crit:
			style = "crit"
		elif src == ally:
			style = "ally"
		elif heavy:
			style = "heavy"
		hud.pop(pop_at, ("%d!" % left) if crit else str(left), style)
	if heavy or crit:
		_shake_cam(0.1 if dst.team == 1 else 0.14, 0.2)
		if dst == enemy and (crit or amount >= 170):
			fx.coin(enemy.head_pos() + Vector3(rng.randf_range(-0.6, 0.6), 0.0, 0.0))
	sfx.play("hit_heavy" if heavy or crit else "hit", 0.9 if dst == enemy else 1.1)
	if crit:
		stats["crits"] = int(stats["crits"]) + 1
	if dst == hero and left > 0:
		hud.hurt()
		_shake_cam(0.14, 0.2)
		sfx.play("hurt")
		if _action == "attack" or _action == "":
			_end_action()
			_action = "hit"
			_act_t = 0.0
			_act_len = 0.28
			hero.act("hit", 0.28)
	elif dst == ally and left > 0 and not ally.dead:
		ally.act("hit", 0.28)
	elif dst == enemy and (heavy or crit) and _enemy_state != "windup":
		enemy.act("hit", 0.3)
	if dst == enemy and info.has("stagger") and not enemy.dead:
		_stagger_enemy(float(info["stagger"]), false)
	if dst.hp <= 0 and not dst.dead:
		dst.die()
		sfx.play("ko")
		fx.ko_burst(dst.position, dst.size_k, Color(1.0, 0.85, 0.45) if dst.team == 1 else Color(0.7, 0.85, 1.0))
		if dst == enemy:
			fx.coin_burst(dst.position + Vector3(0, 1.0 * dst.size_k, 0), 6)
			_impact_cam(0.7, 2.5)
		if dst == ally:
			_update_players()


func _take(dst: FighterScript, amount: int, src: FighterScript, _crit: bool) -> void:
	var invulnerable: bool = mode == "chars"
	if invulnerable and dst == hero:
		dst.hp = maxi(1, dst.hp - amount)
	elif not invulnerable:
		dst.hp = maxi(0, dst.hp - amount)
	if dst == hero:
		stats["damage_taken"] = int(stats["damage_taken"]) + amount
	elif src == hero:
		stats["damage_dealt"] = int(stats["damage_dealt"]) + amount
		stats["hits"] = int(stats["hits"]) + 1
	elif src == ally:
		stats["ally_damage"] = int(stats["ally_damage"]) + amount


func _parry(src: FighterScript) -> void:
	stats["parries"] = int(stats["parries"]) + 1
	hud.pop(hero.chest_pos() + Vector3(0, 0.9, 0), "PARRY!", "parry")
	hud.callout("PARRY!", Color(1.0, 0.92, 0.45))
	sfx.play("parry")
	fx.clash(hero.chest_pos() + hero.forward() * 0.55 + Vector3(0, 0.15, 0))
	fx.shock(hero.position, 2.2, Color(1.0, 0.88, 0.45), 0.4)
	_impact_cam(0.4, 1.2)
	hero.act("parry", 0.35, PARRY_HIT_AT)
	hero.flash(0.6)
	_hitstop = maxf(_hitstop, 0.16)
	_shake_cam(0.1, 0.2)
	_punch = maxf(_punch, 0.6)
	if src == enemy:
		_stagger_enemy(PARRY_STAGGER, true)


func _stagger_enemy(secs: float, parried: bool) -> void:
	enemy.stagger = maxf(enemy.stagger, secs)
	if _tele != null:
		fx.telegraph_end(_tele, false)
		_tele = null
	_boss_area.close()
	_enemy_state = "staggered"
	_enemy_t = 0.0
	enemy.act("hit", minf(secs, 0.5))
	enemy.knock(_flat(enemy.position - hero.position), 0.6 if parried else 0.3)


func _update_players() -> void:
	var alive: int = 0
	for f: FighterScript in [hero, ally]:
		if f != null and not f.dead:
			alive += 1
	var total: String = "3"
	var parts: PackedStringArray = hud.players_text.split("/")
	if parts.size() == 2:
		total = parts[1]
	hud.players_text = "%d/%s" % [alive, total]


# ------------------------------------------------------------ the boss

func _tick_enemy(dt: float) -> void:
	if enemy == null or enemy.dead:
		if enemy != null:
			enemy.speed_now = 0.0
		return
	if hero.dead:
		enemy.speed_now = 0.0
		return
	if not _enraged and float(enemy.hp) / float(enemy.max_hp) <= ENRAGE_AT:
		_enraged = true
		hud.callout("ENRAGED!", Color(1.0, 0.4, 0.3))
		enemy.flash(1.0)
		_shake_cam(0.12, 0.3)
	var target: FighterScript = _enemy_target if (_enemy_target != null and not _enemy_target.dead) else hero
	var to: Vector3 = _flat(target.position - enemy.position)
	var d: float = to.length()
	_enemy_cd = maxf(0.0, _enemy_cd - dt)
	var k_speed: float = 1.25 if _enraged else 1.0
	match _enemy_state:
		"approach":
			_enemy_target = _pick_target()
			enemy.face(to, dt, 5.0)
			if d > SWIPE_R * 0.7:
				enemy.position += to / maxf(d, 0.001) * ENEMY_SPEED * k_speed * dt
				enemy.speed_now = ENEMY_SPEED * k_speed
			else:
				enemy.speed_now = 0.0
			if _enemy_cd <= 0.0 and d < 6.5:
				if d < SWIPE_R * 0.95 and rng.randf() < 0.62:
					_enemy_begin("swipe", target)
				elif d < 6.5:
					_enemy_begin("slam", target)
		"windup":
			_enemy_t += dt
			enemy.speed_now = 0.0
			if _enemy_kind == "swipe" and _enemy_t < _enemy_windup * 0.55:
				# tracks you for the first half, then commits: a late side-step works
				enemy.face(to, dt, 4.0)
				_enemy_yaw = enemy.yaw
				_boss_area.global_position = enemy.position
				_boss_area.rotation = Vector3(0, _enemy_yaw, 0)
				if _tele != null:
					_tele.global_position = enemy.position + Vector3(0, 0.05, 0)
					_tele.rotation.y = _enemy_yaw
			if _enemy_t >= _enemy_windup:
				_enemy_strike()
		"recover":
			_enemy_t += dt
			enemy.speed_now = 0.0
			if _enemy_t >= ENEMY_RECOVER / k_speed:
				_enemy_state = "approach"
				_enemy_cd = ENEMY_CD / k_speed
		"staggered":
			enemy.speed_now = 0.0
			if enemy.stagger <= 0.0:
				_enemy_state = "approach"
				_enemy_cd = 0.5


func _pick_target() -> FighterScript:
	if ally != null and not ally.dead:
		var dh: float = _flat(hero.position - enemy.position).length()
		var da: float = _flat(ally.position - enemy.position).length()
		if da + 2.0 < dh and rng.randf() < 0.3:
			return ally
	return hero


func _enemy_begin(kind: String, target: FighterScript) -> void:
	_enemy_state = "windup"
	_enemy_kind = kind
	_enemy_t = 0.0
	_enemy_target = target
	var k: float = 0.8 if _enraged else 1.0
	_enemy_windup = (SWIPE_WINDUP if kind == "swipe" else SLAM_WINDUP) * k
	enemy.face(_flat(target.position - enemy.position), 0.0, 0.0)
	_enemy_yaw = enemy.yaw
	enemy.act("heavy", _enemy_windup / 0.72, _enemy_windup)
	if kind == "swipe":
		_boss_area.shape_node.shape = _swipe_shape
		_boss_area.shape_node.position = Vector3.ZERO
		_boss_area.global_position = enemy.position
		_boss_area.rotation = Vector3(0, _enemy_yaw, 0)
		_tele = fx.telegraph(enemy.position, _enemy_yaw, SWIPE_R, SWIPE_HALF, _enemy_windup)
	else:
		# the ring lands where the target stands now: move out of it, or parry it
		_enemy_at = target.position
		_boss_area.shape_node.shape = _slam_shape
		_boss_area.shape_node.position = Vector3(0, 1.3, 0)
		_boss_area.global_position = _enemy_at
		_boss_area.rotation = Vector3.ZERO
		_tele = fx.telegraph(_enemy_at, 0.0, SLAM_R, 180.0, _enemy_windup, Color(1.0, 0.3, 0.1, 1.0))


func _enemy_strike() -> void:
	var dmg: Vector2i = SWIPE_DMG if _enemy_kind == "swipe" else SLAM_DMG
	_boss_area.open({"src": enemy, "kind": _enemy_kind, "dmg": dmg, "kb": 1.4 if _enemy_kind == "swipe" else 2.2,
		"stop": 5.0 / 60.0, "heavy": true, "parryable": true})
	_boss_area.scan()
	_boss_area.close()
	if _tele != null:
		fx.telegraph_end(_tele, true)
		_tele = null
	if _enemy_kind == "swipe":
		fx.slash(enemy.position + Vector3(0, 1.4, 0), _enemy_yaw, BOSS_COLS, SWIPE_R * 0.95, 0.25, 0.32)
		fx.trail_cut("boss")
		for i in 9:
			var a: float = _enemy_yaw + deg_to_rad(lerpf(SWIPE_HALF, -SWIPE_HALF, float(i) / 8.0))
			var dir := Vector3(sin(a), 0, cos(a))
			fx.trail_push("boss", enemy.position + Vector3(0, 1.5, 0) + dir * 0.9, enemy.position + Vector3(0, 1.2, 0) + dir * SWIPE_R, BOSS_COLS, (8 - i) * 0.012, 0.5)
		_impact_cam(0.35, 1.2)
		sfx.play("swing_heavy", 0.75)
	else:
		fx.shock(_enemy_at, SLAM_R * 1.1, Color(1.0, 0.45, 0.2), 0.45)
		fx.sparks(_enemy_at + Vector3(0, 0.3, 0), Color(1.0, 0.55, 0.25), 200)
		fx.crack(_enemy_at, SLAM_R * 1.3)
		fx.dust(_enemy_at, true)
		_shake_cam(0.16, 0.3)
		_impact_cam(0.55, 2.5)
		sfx.play("slam", 0.85)
	_enemy_state = "recover"
	_enemy_t = 0.0


# ------------------------------------------------------------ the ally

func _tick_ally(dt: float) -> void:
	if ally == null or ally.dead:
		return
	var goal: Vector3
	var engage: bool = enemy != null and not enemy.dead
	if engage:
		# hold a casting spot at range, on the hero's side of the boss, out of any telegraph
		var from_enemy: Vector3 = _flat(hero.position - enemy.position)
		if from_enemy.length() < 0.01:
			from_enemy = Vector3(1, 0, 0)
		var side: Vector3 = Vector3(-from_enemy.z, 0, from_enemy.x).normalized()
		goal = enemy.position + (from_enemy.normalized() * 0.8 + side * 0.6).normalized() * ALLY_RANGE
		if _enemy_state == "windup" and _enemy_kind == "slam" and _flat(ally.position - _enemy_at).length() < SLAM_R + 0.6:
			goal = _enemy_at + _flat(ally.position - _enemy_at).normalized() * (SLAM_R + 1.5)
	else:
		goal = hero.position + _cam_right * 1.6 - _cam_fwd * 0.8
	var to: Vector3 = _flat(goal - ally.position)
	var d: float = to.length()
	if d > 0.3:
		var step: float = minf(d, ALLY_SPEED * dt)
		ally.position += to / d * step
		ally.speed_now = ALLY_SPEED if d > 0.6 else 0.0
		ally.face(to, dt, 12.0)
	else:
		ally.speed_now = 0.0
		if engage:
			ally.face(_flat(enemy.position - ally.position), dt, 12.0)
	_ally_cd = maxf(0.0, _ally_cd - dt)
	if engage and _ally_cd <= 0.0 and _flat(enemy.position - ally.position).length() < ALLY_RANGE + 2.5:
		_ally_cd = rng.randf_range(1.6, 2.6)
		ally.face(_flat(enemy.position - ally.position), 0.0, 0.0)
		ally.act("attack_2", 0.36, BOLT_HIT_AT)
		_fire_bolt()


func _fire_bolt() -> void:
	var mi: MeshInstance3D = fx.make_bolt(Color(0.65, 0.5, 1.0))
	var area := HitArea.new()
	var sph := SphereShape3D.new()
	sph.radius = 0.35
	area.setup(1, sph)
	area.struck.connect(_on_struck)
	add_child(area)
	var p: Vector3 = ally.position + Vector3(0, 1.3, 0) + ally.forward() * 0.5
	mi.global_position = p
	area.global_position = p
	area.open({"src": ally, "kind": "bolt", "dmg": ALLY_DMG, "kb": 0.15, "stop": 0.0, "heavy": false})
	_bolts.append({"mi": mi, "area": area, "t": 0.0})
	fx.ring(ally.position, 0.9, Color(0.7, 0.55, 1.0, 0.8), 0.3)


func _tick_bolts(dt: float) -> void:
	var i: int = _bolts.size() - 1
	while i >= 0:
		var b: Dictionary = _bolts[i]
		b["t"] = float(b["t"]) + dt
		var area: HitArea = b["area"]
		var mi: MeshInstance3D = b["mi"]
		var done: bool = float(b["t"]) > 1.2 or area.hit_count() > 0 or enemy == null or enemy.dead
		if not done:
			var to: Vector3 = enemy.chest_pos() - area.global_position
			var step: Vector3 = to.normalized() * minf(BOLT_SPEED * dt, to.length())
			area.global_position += step
			mi.global_position = area.global_position
			fx.trail_push("bolt%d" % (i % 4), area.global_position + Vector3(0, 0.12, 0), area.global_position - Vector3(0, 0.12, 0), Color(0.7, 0.55, 1.0))
			area.scan()
		if done or area.hit_count() > 0:
			if area.hit_count() > 0:
				fx.ring(enemy.position, 1.0, Color(0.7, 0.55, 1.0, 0.8), 0.3)
			area.queue_free()
			mi.queue_free()
			_bolts.remove_at(i)
		i -= 1


# ------------------------------------------------------------ space

func _clamp_arena(f: FighterScript) -> void:
	f.position.x = clampf(f.position.x, -ARENA_HALF_X, ARENA_HALF_X)
	f.position.z = clampf(f.position.z, ARENA_Z.x, ARENA_Z.y)


func _flat(v: Vector3) -> Vector3:
	return Vector3(v.x, 0.0, v.z)


func _separate() -> void:
	for i in fighters.size():
		for j in range(i + 1, fighters.size()):
			var a: FighterScript = fighters[i]
			var b: FighterScript = fighters[j]
			if a.dead or b.dead:
				continue
			var dv: Vector3 = _flat(b.position - a.position)
			var d: float = dv.length()
			var md: float = a.radius + b.radius
			if d >= md:
				continue
			var n: Vector3 = dv / d if d > 0.001 else Vector3(1, 0, 0)
			var push: float = md - d
			if a == hero:
				b.position += n * push * (0.5 if b.team == 1 else 1.0)
				if b.team == 1:
					a.position -= n * push * 0.5
			elif b == hero:
				a.position -= n * push * (0.5 if a.team == 1 else 1.0)
				if a.team == 1:
					b.position += n * push * 0.5
			else:
				a.position -= n * push * 0.5
				b.position += n * push * 0.5


# ------------------------------------------------------------ the autoplay bot

func _bot(dt: float) -> void:
	if bot_kind == "idle":
		hud.bot_stick(Vector2.ZERO)
		return
	if enemy == null or enemy.dead or hero.dead:
		hud.bot_stick(Vector2.ZERO)
		hud.bot_guard(false)
		return
	var to: Vector3 = _flat(enemy.position - hero.position)
	var d: float = to.length()
	var want := Vector3.ZERO
	var reach: float = 2.2 + enemy.radius
	# boss strikes: parry the swipe when it is about to land, step out of the slam ring
	var threat: bool = false
	if _enemy_state == "windup" and _enemy_target == hero:
		var left: float = _enemy_windup - _enemy_t
		if _enemy_kind == "slam":
			var from_ring: Vector3 = _flat(hero.position - _enemy_at)
			if from_ring.length() < SLAM_R + 0.4:
				threat = true
				if rng.seed % 2 == 0 or left > 0.25:
					want = from_ring.normalized() if from_ring.length() > 0.05 else _cam_right
		elif d < SWIPE_R + 0.3 and left < 0.16 and left > 0.02 and _bot_guard_t <= 0.0:
			threat = true
			hud.bot_stick(Vector2.ZERO)
			hud.bot_guard(true)
			_bot_guard_t = 0.4
	if _bot_guard_t > 0.0:
		_bot_guard_t -= dt
		if _bot_guard_t <= 0.0:
			hud.bot_guard(false)
		return
	if not threat:
		if d > reach * 0.85:
			want = to.normalized()
	if want != Vector3.ZERO:
		want = want.normalized()
	hud.bot_stick(Vector2(want.dot(_cam_right), want.dot(_cam_fwd)))
	if threat:
		return
	_bot_next_skill -= dt
	if d < reach + 0.4:
		var cast: int = -1
		if _bot_next_skill <= 0.0:
			if _skill_cd[3] <= 0.0 and (hero.hp < hero.max_hp * 0.6 or (ally != null and not ally.dead and ally.hp < ally.max_hp * 0.5)):
				cast = 3
			elif _skill_cd[4] <= 0.0 and hero.hp < hero.max_hp * 0.8:
				cast = 4
			elif _skill_cd[1] <= 0.0:
				cast = 1
			elif _skill_cd[2] <= 0.0:
				cast = 2
		if cast >= 0 and _can_cast():
			hud.bot_skill_slot(cast)
			_bot_next_skill = 1.2
		elif _action == "" or (_action == "attack" and _act_t > _act_len * 0.5):
			hud.bot_attack()
	elif d < 7.0 and d > 3.5 and _skill_cd[0] <= 0.0 and _can_cast() and _bot_next_skill <= 0.0:
		hud.bot_skill_slot(0)
		_bot_next_skill = 1.0


# ------------------------------------------------------------ end

func _end(o: String) -> void:
	if state != "fighting":
		return
	outcome = o
	state = "ending"
	_end_t = 0.0
	hud.release_all()
	if hero != null:
		hero.speed_now = 0.0
		hero.set_guard(false)
	if _tele != null:
		fx.telegraph_end(_tele, false)
		_tele = null
	match o:
		"win":
			_end_delay = 1.8
			hero.celebrate()
			if ally != null and not ally.dead:
				ally.celebrate()
			_hitstop = 0.15            # BattleRunner Guardian kill: hit-stop 0.15, punch 1, shake 0.14 / 0.35
			_punch = 1.0
			_shake_cam(0.14, 0.35)
			hud.banner("VICTORY", str(cfg.get("enemy_name", "Guardian")) + " defeated", Color(1.0, 0.82, 0.35), 0.0)
		"lose":
			_end_delay = 1.4
			hud.banner("DEFEATED", "", Color(1.0, 0.4, 0.35), 0.0)
		_:
			_end_delay = 1.0
			hud.banner("TIME UP", "", Color(0.85, 0.92, 1.0), 0.0)
			if enemy != null and not enemy.dead and hero != null and hero.hp > 0 and mode != "full":
				hero.celebrate()
	_log("fight_end outcome=%s t=%.2f" % [o, fight_time])


func result() -> Dictionary:
	return {
		"outcome": outcome,
		"damage_dealt": int(stats["damage_dealt"]),
		"damage_taken": int(stats["damage_taken"]),
		"time_s": snappedf(fight_time, 0.01),
		"hits": int(stats["hits"]),
		"skill_uses": int(stats["skill_uses"]),
		"enemy_hp_left": enemy.hp if enemy != null else 0,
		"hero_hp_left": hero.hp if hero != null else 0,
		"mode": mode,
		"ally_damage": int(stats["ally_damage"]),
		"load_ms": snappedf(load_ms, 0.1),
		"parries": int(stats["parries"]),
		"blocks": int(stats["blocks"]),
		"dodges": int(stats["dodges"]),
		"crits": int(stats["crits"]),
		"combo_max": int(stats["combo_max"]),
		"skills": stats["skills"],
	}


func _emit_result() -> void:
	if state == "done":
		return
	state = "done"
	finished.emit(result())


## Bridge.end_fight(): abort now with outcome "quit".
func abort() -> void:
	if state == "done":
		return
	outcome = "quit"
	_emit_result()


func status() -> Dictionary:
	var st: String = state
	if st == "ending":
		st = "fighting"
	return {
		"state": st,
		"t_left": snappedf(t_left, 0.01),
		"hero_hp": hero.hp if hero != null else 0,
		"enemy_hp": enemy.hp if enemy != null else 0,
		"fps": Engine.get_frames_per_second(),
	}


# ------------------------------------------------------------ camera

func _shake_cam(amount: float, seconds: float) -> void:
	_shake = maxf(_shake, amount)
	_shake_t = maxf(_shake_t, seconds)
	_trauma = minf(1.0, _trauma + amount * 1.6)


func _follow_camera(dt: float) -> void:
	if dt <= 0.0:
		return
	var target: Vector3 = Vector3(0, 0, 1)
	if hero != null:
		var mv: Vector3 = _cam_right * hud.stick.x + _cam_fwd * hud.stick.y
		_look = _look.lerp(mv * CAM_LOOK, 1.0 - exp(-dt * 2.5))
		target = hero.position + _cam_fwd * CAM_AHEAD + _look
		if enemy != null and not enemy.dead:
			target = target.lerp((hero.position + enemy.position) * 0.5, 0.5)
	target.x = clampf(target.x, -CAM_BOUNDS_X, CAM_BOUNDS_X)
	target.z = clampf(target.z, -CAM_BOUNDS, CAM_BOUNDS)
	target.y = 0.0
	_focus = _smooth_damp(_focus, target, CAM_SMOOTH, 40.0, dt)
	_apply_camera(dt)


func _smooth_damp(cur: Vector3, target: Vector3, smooth: float, max_speed: float, dt: float) -> Vector3:
	# Unity's Vector3.SmoothDamp (critically damped spring), as BattleCamera uses it
	var omega: float = 2.0 / smooth
	var x: float = omega * dt
	var e: float = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x)
	var change: Vector3 = (cur - target).limit_length(max_speed * smooth)
	var to: Vector3 = target
	var tgt: Vector3 = cur - change
	var temp: Vector3 = (_focus_vel + omega * change) * dt
	_focus_vel = (_focus_vel - omega * temp) * e
	var out: Vector3 = tgt + (change + temp) * e
	if (to - cur).dot(out - to) > 0.0:
		out = to
		_focus_vel = (out - to) / dt
	return out


func _apply_camera(dt: float) -> void:
	_punch = move_toward(_punch, 0.0, dt * 3.0)
	var d: float = _cam_dist * (1.0 - _punch * 0.1)
	var pos: Vector3 = _focus + Vector3.UP * 0.8 + _cam_basis.z * d
	if _shake_t > 0.0:
		_shake_t -= dt
		var s: float = _shake * clampf(_shake_t / 0.18, 0.0, 1.0)
		# cq 013: the view now moves by trauma (below). These two draws stay so the fight's
		# seeded RNG advances exactly as before (crits and the boss's choices are unchanged).
		var _legacy := Vector2(rng.randf_range(-s, s), rng.randf_range(-s, s))
		if _shake_t <= 0.0:
			_shake = 0.0
	var basis: Basis = _cam_basis
	_shake_clock += dt
	_trauma = maxf(0.0, _trauma - TRAUMA_DECAY * dt)
	var tr2: float = _trauma * _trauma * (0.3 if _reduce_motion else 1.0)
	if tr2 > 0.0:
		var t: float = _shake_clock
		var nx: float = sin(t * 47.0) * 0.6 + sin(t * 83.0 + 1.3) * 0.4
		var ny: float = sin(t * 53.0 + 2.1) * 0.6 + sin(t * 97.0 + 0.4) * 0.4
		var nr: float = sin(t * 41.0 + 0.7)
		pos += _cam_basis * Vector3(nx, ny, 0.0) * SHAKE_MAX_M * tr2
		basis = basis * Basis(Vector3(0, 0, 1), nr * SHAKE_MAX_ROLL * tr2)
	# the kick: a short push of the view along the blow, springing back
	_kick = _kick.lerp(Vector3.ZERO, 1.0 - exp(-dt * 12.0))
	pos += _kick * (0.3 if _reduce_motion else 1.0)
	_fov_kick = move_toward(_fov_kick, 0.0, FOV_KICK_DECAY * dt)
	cam.fov = _base_fov - (0.0 if _reduce_motion else _fov_kick)
	cam.transform = Transform3D(basis, pos)


## Camera impact for a hit or a skill (cq 013): trauma 0..1 (shake), fov_kick degrees of
## zoom punch, and an optional push along `dir` (the blow). Hit-stop is separate.
func _impact_cam(trauma: float, fov_kick: float = 0.0, dir: Vector3 = Vector3.ZERO) -> void:
	_trauma = minf(1.0, _trauma + trauma)
	_fov_kick = minf(4.0, maxf(_fov_kick, fov_kick))
	if dir != Vector3.ZERO:
		_kick += _flat(dir).normalized() * 0.12 * trauma


# ------------------------------------------------------------ hud sync

func _sync_hud() -> void:
	hud.t_left = t_left
	for i in 5:
		hud.skill_cd[i] = _skill_cd[i]
		# disabled only when a press cannot count: during a swing or another skill it is buffered
		hud.skill_ok[i] = hero != null and state == "fighting" and not hero.dead and hero.stagger <= 0.0
	hud.attack_cd_k = 0.0
	if _action == "attack":
		hud.attack_cd_k = clampf(1.0 - _act_t / maxf(0.01, _act_len), 0.0, 1.0)
	if _action != "attack" and _since_swing > COMBO_RESET:
		_combo_shown = 0
	hud.combo_step = _combo_shown
	if hero != null:
		hud.hero_hp = hero.hp
		hud.hero_max = hero.max_hp
		hud.guard_on = hero.guarding
		hud.buff_t = hero.buff_t
	hud.enemy_label = ""
	if enemy != null and not enemy.dead:
		if enemy.stagger > 0.0:
			hud.enemy_label = "STAGGERED"
		elif _enraged:
			hud.enemy_label = "ENRAGED"
	var units: Array[Dictionary] = []
	var pts: Array[Dictionary] = []
	if state != "loading":
		for f: FighterScript in fighters:
			units.append({"id": f.get_instance_id(), "name": f.display_name, "hp": f.hp, "max": f.max_hp, "team": f.team,
				"head": f.head_pos(), "is_hero": f == hero, "shield": float(f.shield_hp) / float(SHIELD_HP) if f.shield_t > 0.0 else 0.0,
				"buff": f.buff_t, "level": 1})
			var kind: String = "hero" if f == hero else ("enemy" if f.team == 1 else "ally")
			if not f.dead:
				var fw: Vector3 = f.forward()
				pts.append({"p": Vector2(f.position.dot(_cam_right), -f.position.dot(_cam_fwd)), "kind": kind,
					"facing": Vector2(fw.dot(_cam_right), -fw.dot(_cam_fwd))})
	hud.units = units
	hud.map_points = pts


# ------------------------------------------------------------ instrumentation

func _perf_sample(_dt: float) -> void:
	# Real wall-clock frame intervals: the engine's delta is smoothed (delta_smoothing) and
	# would hide hitches.
	var now: int = Time.get_ticks_usec()
	if _perf_last_us == 0:
		_perf_last_us = now
		_perf_win_us = now
		return
	_ft.append((now - _perf_last_us) / 1000.0)
	_perf_last_us = now
	_draws_peak = maxi(_draws_peak, int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)))
	_dyn_res(now)
	if now - _perf_win_us < 2000000:
		return
	_perf_win_us = now
	var s: PackedFloat32Array = _ft.duplicate()
	s.sort()
	var n: int = s.size()
	var pick := func(q: float) -> float: return s[clampi(int(ceil(q * n)) - 1, 0, n - 1)]
	print("CQPERF fps=%d ft_p50=%.2f ft_p95=%.2f ft_p99=%.2f ft_max=%.2f n=%d mem_static_mb=%.1f vmem_mb=%.1f draws=%d objs=%d mode=%s gd_objects=%d gd_resources=%d gd_nodes=%d proc_ms=%.2f phys_ms=%.2f draws_peak=%d fx_pool=%d fx_peak_live=%d fx_peak_parts=%d" % [
		int(Engine.get_frames_per_second()), pick.call(0.5), pick.call(0.95), pick.call(0.99), s[n - 1], n,
		Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)), mode, int(Performance.get_monitor(Performance.OBJECT_COUNT)), int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)), int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		_draws_peak, int(fx.budget()["pooled"]), int(fx.budget()["peak_live"]), int(fx.budget()["peak_parts"])])
	_ft.clear()
	_draws_peak = 0


## Dynamic 3D resolution: when real frames are slow (a software GPU, an old phone), the 3D is
## drawn at fewer pixels, in steps, down to DYN_RES_MIN of the screen; it steps back up when
## frames are fast again. The HUD stays at full resolution. Frame time is input latency.
func _dyn_res(now: int) -> void:
	if not _dyn_on or now < _dyn_next_us or _ft.size() < 12:
		return
	_dyn_next_us = now + 750000
	var tail: PackedFloat32Array = _ft.slice(_ft.size() - 12)
	tail.sort()
	var med: float = tail[6]
	var vp: Viewport = get_viewport()
	var sc: float = vp.scaling_3d_scale
	var want: float = sc
	if med > DYN_RES_SLOW_MS and sc > DYN_RES_MIN + 0.001:
		want = maxf(DYN_RES_MIN, sc - DYN_RES_STEP)
	elif med < DYN_RES_FAST_MS and sc < _dyn_base - 0.001:
		want = minf(_dyn_base, sc + DYN_RES_STEP)
	if want != sc:
		vp.scaling_3d_scale = want
		print("CQ dynres scale %.2f -> %.2f (frame p50 %.1f ms)" % [sc, want, med])


func _on_post_draw() -> void:
	_check_latency("post_draw")


func _check_latency(hook: String) -> void:
	if not _lat_move.is_empty() and hero != null:
		if hero.global_position.distance_squared_to(_lat_move["pos0"]) > 1e-8:
			_print_lat(str(_lat_move.get("kind", "move")), _lat_move, hook)
			_lat_move = {}
	if not _lat_atk.is_empty():
		var node: Variant = _lat_atk["node"]
		if node is MeshInstance3D and (node as MeshInstance3D).visible:
			_print_lat("attack", _lat_atk, hook)
			_lat_atk = {}
		elif Engine.get_process_frames() - int(_lat_atk["frame_in"]) > 120:
			_lat_atk = {}   # the press never produced a swing (fight over, hero down)


func _print_lat(kind: String, d: Dictionary, hook: String) -> void:
	var src: String = d["src"]
	if src == "bot":
		if int(_lat_printed[kind]) >= 6:
			return
		_lat_printed[kind] = int(_lat_printed[kind]) + 1
	var t_out: float = Time.get_unix_time_from_system()
	var ticks_out: int = Time.get_ticks_usec()
	print("CQLAT kind=%s t_in_unix=%.6f t_out_unix=%.6f engine_ms=%.3f frames=%d src=%s hook=%s" % [
		kind, float(d["t_in"]), t_out, (ticks_out - int(d["ticks_in"])) / 1000.0,
		Engine.get_process_frames() - int(d["frame_in"]), src, hook])
