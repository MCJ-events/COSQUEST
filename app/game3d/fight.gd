extends Node3D
## One fight at a landmark plaza: arena, camera, three fighters (runtime GLBs or capsules),
## combat rules, autoplay bot, perf and input-latency instrumentation.
## Created by Bridge.start_fight(); emits `finished(result)` once.

signal finished(result: Dictionary)

const FighterScript := preload("res://fighter.gd")
const HudScript := preload("res://hud.gd")
const FxScript := preload("res://fx.gd")
const LoaderScript := preload("res://char_loader.gd")
const TilesScript := preload("res://tiles_layer.gd")

# ---- combat design. Feel numbers (hit-stop frames, shakes, FX lives, HUD sizes, camera) are
# borrowed from the Unity street-look build (Battle/*.cs); HP / damage / ranges are our own.
const HERO_HP: int = 1000
const ALLY_HP: int = 800
const ENEMY_HP: int = 3000
const HERO_SPEED: float = 4.2            # m/s, no acceleration ramp: moves on the first frame
const ATK_RANGE: float = 2.3             # reach in front of the hero (+ target radius)
const ATK_HALF_ARC: float = 75.0         # degrees either side of facing
const ATK_CD: float = 0.42               # between swings while held / tapped
const ATK_CD_HEAVY: float = 0.55         # after the third (heavy) swing
const COMBO_WINDOW: float = 0.9
const ATK_DMG: Vector2i = Vector2i(60, 80)
const ATK_HEAVY_DMG: Vector2i = Vector2i(110, 130)
const SOFT_LOCK: float = 4.0             # face the enemy on a swing if it is this close
const SKILL_CD: float = 6.0              # WHIRL
const SKILL_RADIUS: float = 3.0          # BattleFx Whirlwind fallback shockwave radius 3 m
const SKILL_DMG: Vector2i = Vector2i(160, 200)
const HITSTOP_LIGHT: float = 3.0 / 60.0  # HitStopFrames / 60 as in BattleRunner
const HITSTOP_HEAVY: float = 6.0 / 60.0
const ENEMY_SPEED: float = 1.6
const ENEMY_REACH: float = 2.4
const ENEMY_WINDUP: float = 0.6
const ENEMY_RECOVER: float = 0.5
const ENEMY_CD: float = 1.6
const ENEMY_DMG: Vector2i = Vector2i(55, 75)
const ALLY_SPEED: float = 4.2
const ALLY_REACH: float = 2.2
const ALLY_DMG: Vector2i = Vector2i(25, 40)
const ARENA_R: float = 12.0

# ---- camera (BattleCamera.cs: pitch 40, yaw -15 (Unity sign), FOV 56, SmoothDamp 0.16 s,
# look-ahead moveDir * 1.4 at rate 2.5, focus + 0.8 m up; distance 23 m and ahead 2.2 m
# were for a 2.8 m hero, scaled here by 1.8 / 2.8)
const CAM_PITCH: float = 40.0
const CAM_YAW: float = 15.0
const CAM_FOV: float = 56.0
const CAM_DIST: float = 15.0
const CAM_AHEAD: float = 1.4
const CAM_SMOOTH: float = 0.16
const CAM_LOOK: float = 0.9
const CAM_BOUNDS: float = 7.0

const TEST_PACKS: String = "/opt/cq/tasks/056-game-forge-in-world-v2/out/packs/"

var cfg: Dictionary = {}
var mode: String = "full"
var autoplay: bool = false
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
var tiles: Node3D
var _ground: MeshInstance3D
var plaza: MeshInstance3D

# combat state
var _atk_cd: float = 0.0
var _attack_buffer: float = 0.0
var _combo: int = 0
var _last_swing: float = -10.0
var skill_cd: float = 0.0
var _hitstop: float = 0.0
var _enemy_state: String = "approach"
var _enemy_t: float = 0.0
var _enemy_cd: float = 1.0
var _ally_cd: float = 2.0
var _bot_dodge: bool = false
var _end_t: float = 0.0
var _end_delay: float = 1.0
var stats: Dictionary = {"damage_dealt": 0, "damage_taken": 0, "hits": 0, "skill_uses": 0, "ally_damage": 0}

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
var _perf_win_us: int = 0
var _lat_move: Dictionary = {}
var _lat_atk: Dictionary = {}
var _lat_printed: Dictionary = {"move": 0, "attack": 0}
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
	_load_threaded = bool(c.get("load_thread", true))
	if c.has("seed"):
		rng.seed = int(c["seed"])
	else:
		rng.randomize()


func _ready() -> void:
	_headless = DisplayServer.get_name() == "headless"
	_cam_basis = Basis.from_euler(Vector3(deg_to_rad(-CAM_PITCH), deg_to_rad(CAM_YAW), 0.0))
	_cam_fwd = Vector3(-_cam_basis.z.x, 0.0, -_cam_basis.z.z).normalized()
	_cam_right = Vector3(_cam_basis.x.x, 0.0, _cam_basis.x.z).normalized()
	var t0: int = Time.get_ticks_usec()
	# 3D drawn at a fraction of the screen's pixels, the HUD at full resolution.
	# A 1080x2400 phone does not need 2.6 M shaded pixels for this view.
	var rs: float = clampf(float(cfg.get("render_scale", 0.5)), 0.25, 1.0)
	get_viewport().scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	get_viewport().scaling_3d_scale = rs
	# No blocking on vsync (the compositor buffers the surface on Android/iOS, so
	# no tearing), capped at max_fps: a frame that misses a vsync by 1 ms no
	# longer waits a whole extra one, which is input latency.
	if not _headless:
		if not bool(cfg.get("vsync", false)):
			DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		Engine.max_fps = clampi(int(cfg.get("max_fps", 60)), 15, 120)
	print("CQ render_scale=%.2f vsync=%s max_fps=%d" % [rs, str(DisplayServer.window_get_vsync_mode()), Engine.max_fps])
	_build_arena()
	_build_camera()
	fx = FxScript.new()
	fx.name = "Fx"
	add_child(fx)
	var layer := CanvasLayer.new()
	layer.name = "HudLayer"
	add_child(layer)
	hud = HudScript.new()
	hud.name = "Hud"
	layer.add_child(hud)
	hud.cam = cam
	hud.players_text = str(cfg.get("players_text", "2/3 players"))
	hud.point_name = str(cfg.get("point_name", ""))
	hud.hero_name = str(cfg.get("hero_name", "You"))
	hud.skill_cd_max = SKILL_CD
	hud.t_left = duration
	hud.attack_pressed.connect(_on_attack_pressed)
	hud.skill_pressed.connect(_on_skill_pressed)
	hud.move_started.connect(_on_move_started)
	RenderingServer.frame_post_draw.connect(_on_post_draw)
	tiles = TilesScript.new()
	tiles.name = "Tiles"
	add_child(tiles)
	if tiles.call("setup", cfg, cam) == true and _ground != null and bool(cfg.get("tiles_ground", true)):
		_ground.visible = false   # the tileset is the ground now
		if plaza != null and not bool(cfg.get("tiles_keep_plaza", false)):
			plaza.visible = false # the place itself under the fight; the medallion marks the centre
	_log("arena built ms=%.1f mode=%s autoplay=%s duration=%.0f" % [(Time.get_ticks_usec() - t0) / 1000.0, mode, autoplay, duration])
	if mode == "arena":
		hud.show_hero_card = false
		_begin_fight()
		return
	hero = _spawn(str(cfg.get("hero_name", "You")), 0, HERO_HP, Color(0.3, 0.75, 0.35), Vector3(0, 0, 5), PI)
	ally = _spawn(str(cfg.get("ally_name", "Ally")), 0, ALLY_HP, Color(0.3, 0.65, 0.9), Vector3(1.8, 0, 6), PI)
	enemy = _spawn(str(cfg.get("enemy_name", "Guardian")), 1, ENEMY_HP, Color(0.85, 0.3, 0.25), Vector3(0, 0, -4), 0.0)
	enemy.radius = 0.55
	_focus = hero.position + _cam_fwd * CAM_AHEAD
	_apply_camera(0.0)
	for pair: Array in [[hero, "hero_glb"], [ally, "ally_glb"], [enemy, "enemy_glb"]]:
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


# ------------------------------------------------------------ arena

func _mat(c: Color, rough: float = 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m


func _box(size: Vector3, at: Vector3, m: Material, parent: Node3D) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = m
	mi.position = at
	parent.add_child(mi)
	return mi


func _build_arena() -> void:
	var arena := Node3D.new()
	arena.name = "Arena"
	add_child(arena)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.55, 0.72, 0.9)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.78, 0.82, 0.92)
	env.ambient_light_energy = 0.6
	var we := WorldEnvironment.new()
	we.environment = env
	arena.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52.0, 35.0, 0.0)
	sun.light_energy = 1.1
	sun.light_color = Color(1.0, 0.96, 0.88)
	sun.shadow_enabled = bool(cfg.get("shadows", false))
	arena.add_child(sun)
	# ground and plaza
	_ground = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(160, 160)
	_ground.mesh = pm
	_ground.material_override = _mat(Color(0.4, 0.46, 0.36))
	arena.add_child(_ground)
	plaza = MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = ARENA_R + 0.5
	cyl.bottom_radius = ARENA_R + 0.5
	cyl.height = 0.04
	cyl.radial_segments = 48
	cyl.rings = 1
	plaza.mesh = cyl
	plaza.position.y = 0.02
	plaza.material_override = _mat(Color(0.74, 0.7, 0.62))
	arena.add_child(plaza)
	var med := MeshInstance3D.new()
	var mc := CylinderMesh.new()
	mc.top_radius = 3.0
	mc.bottom_radius = 3.0
	mc.height = 0.05
	mc.radial_segments = 32
	mc.rings = 1
	med.mesh = mc
	med.position.y = 0.03
	med.material_override = _mat(Color(0.62, 0.55, 0.47))
	arena.add_child(med)
	# the landmark stand-in at the north end (up-screen)
	var stone := _mat(Color(0.82, 0.74, 0.58))
	_box(Vector3(3.2, 1.0, 3.2), Vector3(0, 0.5, -15.0), stone, arena)
	_box(Vector3(1.3, 7.0, 1.3), Vector3(0, 4.5, -15.0), stone, arena)
	_box(Vector3(2.0, 0.6, 2.0), Vector3(0, 8.3, -15.0), _mat(Color(0.95, 0.8, 0.35), 0.5), arena)
	# ring of pillars
	var pillar_mesh := CylinderMesh.new()
	pillar_mesh.top_radius = 0.45
	pillar_mesh.bottom_radius = 0.5
	pillar_mesh.height = 4.0
	pillar_mesh.radial_segments = 12
	pillar_mesh.rings = 1
	var pmat := _mat(Color(0.86, 0.84, 0.8))
	for i in 8:
		var a: float = TAU * float(i) / 8.0 + PI / 8.0
		var p := MeshInstance3D.new()
		p.mesh = pillar_mesh
		p.material_override = pmat
		p.position = Vector3(sin(a) * (ARENA_R + 1.5), 2.0, cos(a) * (ARENA_R + 1.5))
		arena.add_child(p)
	var crate := _mat(Color(0.55, 0.38, 0.22))
	_box(Vector3(1.2, 1.0, 1.2), Vector3(-9.5, 0.5, 4.0), crate, arena)
	_box(Vector3(1.0, 0.8, 1.0), Vector3(-8.6, 0.4, 5.3), crate, arena)
	_box(Vector3(1.4, 1.2, 1.0), Vector3(9.2, 0.6, -5.0), crate, arena)
	_box(Vector3(4.0, 0.5, 0.8), Vector3(8.0, 0.25, 7.5), _mat(Color(0.5, 0.45, 0.42)), arena)


func _build_camera() -> void:
	cam = Camera3D.new()
	cam.name = "Camera"
	cam.fov = CAM_FOV
	cam.near = 0.5
	cam.far = 160.0
	add_child(cam)
	cam.current = true
	_focus = Vector3(0, 0, 2)
	_apply_camera(0.0)


func _spawn(n: String, team: int, hp_max: int, c: Color, at: Vector3, yaw: float) -> FighterScript:
	var f := FighterScript.new()
	f.name = n.validate_node_name()
	add_child(f)
	f.setup(n, team, hp_max, c)
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
			var why: String = f.hold_weapon(r["node"] as Node3D, _loading_role["att"], str(_loading_role["weapon"]), str(_loading_role["class"]))
			_log("weapon role=%s class=%s bone=%s ok=%s %s parse_ms=%.1f path=%s" % [role, str(_loading_role["class"]), str(_loading_role["att"].get("bone", "")), str(why == ""), why, float(r["parse_ms"]), str(r["path"])])
		else:
			_log("weapon role=%s ok=false error=%s path=%s" % [role, str(r.get("error", "?")), str(r.get("path", ""))])
		return
	if bool(r.get("ok", false)):
		var info: Dictionary = f.set_model(r["node"] as Node3D)
		_log("load role=%s ok=true parse_ms=%.1f gen_ms=%.1f add_ms=%.1f scale=%.3f raw_h=%.3f anims=%s mapped=%s path=%s" % [
			role, float(r["parse_ms"]), float(r["gen_ms"]), (Time.get_ticks_usec() - t_add) / 1000.0,
			float(info["scale"]), float(info["height_raw"]), str(info["anims"]), JSON.stringify(info["mapped"]), str(r["path"])])
	else:
		f.set_capsule()
		_log("load role=%s ok=false error=%s path=%s (capsule fallback)" % [role, str(r.get("error", "?")), str(r.get("path", ""))])


func _begin_fight() -> void:
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
	_lat_move = {"t_in": t_in, "ticks_in": ticks_in, "frame_in": Engine.get_process_frames(), "pos0": hero.global_position, "src": src}


func _on_attack_pressed(t_in: float, ticks_in: int, src: String) -> void:
	if hero == null or state != "fighting":
		return
	_attack_buffer = 0.3
	_lat_atk = {"t_in": t_in, "ticks_in": ticks_in, "frame_in": Engine.get_process_frames(), "node": null, "src": src}


func _on_skill_pressed(slot: int, _t_in: float, _ticks_in: int, src: String) -> void:
	if hero == null or state != "fighting" or hero.dead:
		return
	if skill_cd > 0.0:
		if src != "bot":
			hud.toast("%.0fs" % ceil(skill_cd), hud.skill_centre(slot) + Vector2(0, -60))
		return
	_whirl()


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
			_bot()
		_move_hero(dt)
		_atk_cd = maxf(0.0, _atk_cd - dt)
		skill_cd = maxf(0.0, skill_cd - dt)
		_attack_buffer = maxf(0.0, _attack_buffer - dt)
		if _atk_cd <= 0.0 and (_attack_buffer > 0.0 or hud.attack_held) and not hero.dead:
			_attack_buffer = 0.0
			_swing()
		_tick_enemy(logic_dt)
		_tick_ally(logic_dt)
		_separate()
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


func _move_hero(dt: float) -> void:
	if hero.dead:
		hero.speed_now = 0.0
		return
	var s: Vector2 = hud.stick
	var w: Vector3 = _cam_right * s.x + _cam_fwd * s.y
	if w.length() > 1.0:
		w = w.normalized()
	hero.position += w * HERO_SPEED * dt
	hero.speed_now = w.length() * HERO_SPEED
	if w.length() > 0.05:
		hero.face(w, dt, 22.0)
	_clamp_arena(hero)


func _clamp_arena(f: FighterScript) -> void:
	var p := Vector2(f.position.x, f.position.z)
	if p.length() > ARENA_R:
		p = p.normalized() * ARENA_R
		f.position.x = p.x
		f.position.z = p.y


func _flat(v: Vector3) -> Vector3:
	return Vector3(v.x, 0.0, v.z)


func _in_arc(src: FighterScript, dst: FighterScript, reach: float, half_deg: float) -> bool:
	var to: Vector3 = _flat(dst.position - src.position)
	var d: float = to.length()
	if d > reach + dst.radius:
		return false
	if d < 0.6:
		return true
	return rad_to_deg(src.forward().angle_to(to / d)) <= half_deg


func _swing() -> void:
	var now: float = fight_time
	_combo = (_combo + 1) % 3 if now - _last_swing < COMBO_WINDOW else 0
	_last_swing = now
	var heavy: bool = _combo == 2
	_atk_cd = ATK_CD_HEAVY if heavy else ATK_CD
	if enemy != null and not enemy.dead:
		var to: Vector3 = _flat(enemy.position - hero.position)
		if to.length() < SOFT_LOCK:
			hero.face(to, 0.0, 0.0)
	hero.lunge(0.45 if heavy else 0.35, 0.22)
	var tint: Color = Color(1.0, 0.85, 0.45, 0.95) if heavy else Color(0.6, 0.85, 1.0, 0.9)
	var tilt: float = [0.35, -0.35, 0.0][_combo]
	var node: MeshInstance3D = fx.slash(hero.position + Vector3(0, 1.0, 0) + hero.forward() * 0.15, hero.yaw, tint, 1.25 if heavy else 1.0, tilt)
	if not _lat_atk.is_empty() and _lat_atk["node"] == null:
		_lat_atk["node"] = node
	if enemy != null and not enemy.dead and _in_arc(hero, enemy, ATK_RANGE, ATK_HALF_ARC):
		var r: Vector2i = ATK_HEAVY_DMG if heavy else ATK_DMG
		_hit(hero, enemy, rng.randi_range(r.x, r.y), heavy)


func _whirl() -> void:
	skill_cd = SKILL_CD
	stats["skill_uses"] = int(stats["skill_uses"]) + 1
	hero.spin(0.4)
	fx.ring(hero.position, SKILL_RADIUS, Color(1.0, 0.8, 0.35, 0.95))
	fx.slash(hero.position + Vector3(0, 0.9, 0), hero.yaw, Color(1.0, 0.8, 0.35, 0.9), 1.5, 0.0)
	fx.slash(hero.position + Vector3(0, 0.9, 0), hero.yaw + PI, Color(1.0, 0.8, 0.35, 0.9), 1.5, 0.0)
	_shake_cam(0.14, 0.3)   # BattleRunner Whirlwind: Shake(0.14, 0.3), Punch(0.5)
	_punch = maxf(_punch, 0.5)
	if enemy != null and not enemy.dead and _flat(enemy.position - hero.position).length() <= SKILL_RADIUS + enemy.radius:
		_hit(hero, enemy, rng.randi_range(SKILL_DMG.x, SKILL_DMG.y), true)


func _hit(src: FighterScript, dst: FighterScript, amount: int, heavy: bool) -> void:
	var to_hero: bool = dst == hero
	var invulnerable: bool = mode == "chars"
	if invulnerable and to_hero:
		dst.hp = maxi(1, dst.hp - amount)
	elif not invulnerable:
		dst.hp = maxi(0, dst.hp - amount)
	dst.hurt_pop()
	var col: Color
	if to_hero:
		col = Color(1.0, 0.35, 0.3)
		stats["damage_taken"] = int(stats["damage_taken"]) + amount
		hud.hurt()
		_shake_cam(0.12, 0.18)
	elif src == hero:
		col = Color(1.0, 0.85, 0.3) if heavy else Color(1, 1, 1)
		stats["damage_dealt"] = int(stats["damage_dealt"]) + amount
		stats["hits"] = int(stats["hits"]) + 1
		if heavy:
			_shake_cam(0.09, 0.18)
	else:
		col = Color(0.6, 0.9, 1.0)
		stats["ally_damage"] = int(stats["ally_damage"]) + amount
	fx.sparks(dst.chest_pos(), col, heavy)
	hud.pop(dst.chest_pos() + Vector3(0, 0.5, 0), str(amount), col, heavy)
	if src == hero or to_hero:
		_hitstop = maxf(_hitstop, HITSTOP_HEAVY if heavy else HITSTOP_LIGHT)
	if dst.hp <= 0 and not dst.dead:
		dst.die()


func _tick_enemy(dt: float) -> void:
	if enemy == null or enemy.dead or hero.dead:
		if enemy != null:
			enemy.speed_now = 0.0
		return
	var to: Vector3 = _flat(hero.position - enemy.position)
	var d: float = to.length()
	_enemy_cd = maxf(0.0, _enemy_cd - dt)
	match _enemy_state:
		"approach":
			enemy.face(to, dt, 6.0)
			if d > ENEMY_REACH * 0.75:
				enemy.position += to / maxf(d, 0.001) * ENEMY_SPEED * dt
				enemy.speed_now = ENEMY_SPEED
			else:
				enemy.speed_now = 0.0
			if d < ENEMY_REACH and _enemy_cd <= 0.0:
				_enemy_state = "windup"
				_enemy_t = 0.0
				_bot_dodge = rng.randf() < 0.4
				enemy.speed_now = 0.0
				enemy.lean_back(ENEMY_WINDUP)
				fx.telegraph(enemy.position + enemy.forward() * 1.2, 1.5, ENEMY_WINDUP)
		"windup":
			enemy.face(to, dt, 3.0)
			_enemy_t += dt
			if _enemy_t >= ENEMY_WINDUP:
				enemy.lunge(0.6, 0.25)
				fx.slash(enemy.position + Vector3(0, 1.1, 0), enemy.yaw, Color(1.0, 0.3, 0.25, 0.9), 1.2, 0.3)
				if _in_arc(enemy, hero, ENEMY_REACH, 70.0):
					_hit(enemy, hero, rng.randi_range(ENEMY_DMG.x, ENEMY_DMG.y), false)
				_enemy_state = "recover"
				_enemy_t = 0.0
		"recover":
			_enemy_t += dt
			if _enemy_t >= ENEMY_RECOVER:
				_enemy_state = "approach"
				_enemy_cd = ENEMY_CD


func _tick_ally(dt: float) -> void:
	if ally == null or ally.dead:
		return
	var goal: Vector3
	var engage: bool = enemy != null and not enemy.dead and _flat(enemy.position - hero.position).length() < 7.0
	if engage:
		var from_enemy: Vector3 = _flat(ally.position - enemy.position)
		if from_enemy.length() < 0.01:
			from_enemy = Vector3(1, 0, 0)
		goal = enemy.position + from_enemy.normalized() * 1.7
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
	if engage and _ally_cd <= 0.0 and _flat(enemy.position - ally.position).length() < ALLY_REACH + enemy.radius:
		_ally_cd = rng.randf_range(2.2, 3.4)
		ally.face(_flat(enemy.position - ally.position), 0.0, 0.0)
		ally.lunge(0.35, 0.22)
		fx.slash(ally.position + Vector3(0, 1.0, 0), ally.yaw, Color(0.45, 0.95, 1.0, 0.85), 0.9, -0.3)
		_hit(ally, enemy, rng.randi_range(ALLY_DMG.x, ALLY_DMG.y), false)


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


func _bot() -> void:
	if enemy == null or enemy.dead or hero.dead:
		hud.bot_stick(Vector2.ZERO)
		return
	var to: Vector3 = _flat(enemy.position - hero.position)
	var d: float = to.length()
	var want := Vector3.ZERO
	if _enemy_state == "windup" and _bot_dodge and d < ENEMY_REACH + 1.0:
		want = -to.normalized() + Vector3(-to.z, 0, to.x).normalized()   # out of the red
	elif d > ATK_RANGE * 0.8:
		want = to.normalized()
	if want != Vector3.ZERO:
		want = want.normalized()
	hud.bot_stick(Vector2(want.dot(_cam_right), want.dot(_cam_fwd)))
	if d < ATK_RANGE + enemy.radius:
		if skill_cd <= 0.0 and d < SKILL_RADIUS:
			hud.bot_skill()
		elif _atk_cd <= 0.0 and _attack_buffer <= 0.0:
			hud.bot_attack()


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
	match o:
		"win":
			_end_delay = 1.5
			hero.celebrate()
			if ally != null:
				ally.celebrate()
			_hitstop = 0.15            # BattleRunner Guardian kill: hit-stop 0.15, punch 1, shake 0.14 / 0.35
			_punch = 1.0
			_shake_cam(0.14, 0.35)
			hud.banner("VICTORY", str(cfg.get("enemy_name", "Guardian")) + " defeated", Color(1.0, 0.82, 0.35), 0.0)
		"lose":
			_end_delay = 1.2
			hud.banner("DEFEATED", "", Color(1.0, 0.4, 0.35), 0.0)
		_:
			_end_delay = 0.6
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


func _follow_camera(dt: float) -> void:
	if dt <= 0.0:
		return
	var target: Vector3 = Vector3(0, 0, 2)
	if hero != null:
		var mv: Vector3 = _cam_right * hud.stick.x + _cam_fwd * hud.stick.y
		_look = _look.lerp(mv * CAM_LOOK, 1.0 - exp(-dt * 2.5))
		target = hero.position + _cam_fwd * CAM_AHEAD + _look
		if enemy != null and not enemy.dead:
			target = target.lerp((hero.position + enemy.position) * 0.5, 0.25)
	target.x = clampf(target.x, -CAM_BOUNDS, CAM_BOUNDS)
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
	var d: float = CAM_DIST * (1.0 - _punch * 0.12)
	var pos: Vector3 = _focus + Vector3.UP * 0.8 + _cam_basis.z * d
	if _shake_t > 0.0:
		_shake_t -= dt
		var s: float = _shake * clampf(_shake_t / 0.18, 0.0, 1.0)
		pos += _cam_basis * Vector3(rng.randf_range(-s, s), rng.randf_range(-s, s), 0.0)
		if _shake_t <= 0.0:
			_shake = 0.0
	cam.transform = Transform3D(_cam_basis, pos)


# ------------------------------------------------------------ hud sync

func _sync_hud() -> void:
	hud.t_left = t_left
	hud.skill_cd = skill_cd
	hud.attack_cd_k = _atk_cd / ATK_CD_HEAVY
	if hero != null:
		hud.hero_hp = hero.hp
		hud.hero_max = hero.max_hp
	var units: Array[Dictionary] = []
	var pts: Array[Dictionary] = []
	if state != "loading":
		for f: FighterScript in fighters:
			units.append({"name": f.display_name, "hp": f.hp, "max": f.max_hp, "team": f.team, "head": f.head_pos(), "is_hero": f == hero})
			var kind: String = "hero" if f == hero else ("enemy" if f.team == 1 else "ally")
			if not f.dead:
				pts.append({"p": Vector2(f.position.dot(_cam_right), -f.position.dot(_cam_fwd)), "kind": kind})
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
	if now - _perf_win_us < 2000000:
		return
	_perf_win_us = now
	var s: PackedFloat32Array = _ft.duplicate()
	s.sort()
	var n: int = s.size()
	var pick := func(q: float) -> float: return s[clampi(int(ceil(q * n)) - 1, 0, n - 1)]
	print("CQPERF fps=%d ft_p50=%.2f ft_p95=%.2f ft_p99=%.2f ft_max=%.2f n=%d mem_static_mb=%.1f vmem_mb=%.1f draws=%d objs=%d mode=%s gd_objects=%d gd_resources=%d gd_nodes=%d" % [
		int(Engine.get_frames_per_second()), pick.call(0.5), pick.call(0.95), pick.call(0.99), s[n - 1], n,
		Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)), mode, int(Performance.get_monitor(Performance.OBJECT_COUNT)), int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)), int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))])
	_ft.clear()


func _on_post_draw() -> void:
	_check_latency("post_draw")


func _check_latency(hook: String) -> void:
	if not _lat_move.is_empty() and hero != null:
		if hero.global_position.distance_squared_to(_lat_move["pos0"]) > 1e-8:
			_print_lat("move", _lat_move, hook)
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
