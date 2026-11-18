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
## A touch for the phone to play (haptics.gd): kind, strength 0..1. bridge.gd forwards it to the app.
signal haptic(kind: String, strength: float)

const FighterScript := preload("res://fighter.gd")
const HudScript := preload("res://hud.gd")
const FxScript := preload("res://fx.gd")
const SfxScript := preload("res://sfx.gd")
const HitArea := preload("res://hit_area.gd")
const HeroFiles := preload("res://hero_files.gd")     # fid29 seam (owned by fid29-heromaps): which file a hero loads
const ShaderWarm := preload("res://shader_warm.gd")   # fid29: materials drawn once under the loading card
const LookReal := preload("res://look_real.gd")       # fid29-lightcam: the per-place reflection capture
const AnimLib := preload("res://anim_library.gd")
const AnimatorScript := preload("res://combat_animator.gd")
var _ready_pose: bool = true            # config "ready_pose" (with "weight"): the wound-up stand near an opponent
const READY_RANGE: float = 4.5          # m at size 1: an opponent this close winds the body up (presentation)
const LoaderScript := preload("res://char_loader.gd")
const EnvPieceScript := preload("res://env_piece.gd")   # build 28: the point's Forge world piece
const TilesScript := preload("res://tiles_layer.gd")
const ArenaScript := preload("res://arena.gd")
const BloomScript := preload("res://bloom.gd")
const CoopScript := preload("res://coop.gd")
const HapticsScript := preload("res://haptics.gd")
const FeelScript := preload("res://feel.gd")

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
# look-fight: the hero's skills in the hero's colours, the Guardian's in its own (art direction 2.8)
const CHARGE_COLS: Array = [Color("#FFC54D"), Color("#FFF6D8"), "soft"]
const WHIRL_COLS: Array = [Color("#FF8A1F"), Color("#FFC54D")]
const WHIRL_COLS_2: Array = [Color("#FFC54D"), Color("#FFF6D8")]
const BOSS_COLS: Array = [Color("#FF5FD2"), Color("#FFE3F6")]

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

# ---- skills: slot order CHARGE SPLIT WHIRL RALLY SHIELD SHOOT RAIN (hud.SKILL_NAMES)
# build 22: SHOOT (slot 5) and RAIN (slot 6) are real skills (they were padlocked buttons in build 21)
const SKILL_N: int = 7
const SKILL_CD: Array[float] = [5.0, 8.0, 6.0, 14.0, 12.0, 3.0, 10.0]
const SKILL_LEN: Array[float] = [0.42, 0.72, 0.5, 0.6, 0.5, 0.36, 0.6]
# when each skill's strike (or cast) lands, seconds in: a clip's contact frame is lined up with
# it (cq 012; the frames are data in data/anim_clips.json). WHIRL's two hits span its spin, so
# its clip is stretched evenly (-1).
const SKILL_HIT_AT: Array[float] = [0.18, 0.34, -1.0, 0.25, 0.2, 0.12, 0.3]
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
# SHOOT: a fast shot along the aim (the stick, else the Guardian if within AIM_FAR, else the facing). It leaves
# the hand SHOOT_AT s into the cast, flies straight at SHOOT_SPEED and dies at SHOOT_RANGE: one light hit.
const SHOOT_AT: float = 0.12
const SHOOT_SPEED: float = 22.0
const SHOOT_RANGE: float = 12.0
const SHOOT_DMG: Vector2i = Vector2i(55, 75)
# RAIN: a marked circle on the target's position (where it stood when the cast began), then RAIN_WAVES
# volleys fall on it, the first RAIN_DELAY s after the cast, RAIN_GAP s apart. The Guardian can walk out.
const RAIN_MARK_AT: float = 0.3      # the arm is up: the volleys are loosed (presentation)
const RAIN_DELAY: float = 0.8
const RAIN_GAP: float = 0.2
const RAIN_WAVES: int = 3
const RAIN_RADIUS: float = 2.6
const RAIN_REACH: float = 6.0        # no target in range: the circle lands this far ahead
const RAIN_DMG: Vector2i = Vector2i(60, 80)
const AIM_FAR: float = 14.0          # SHOOT and RAIN aim at the Guardian from this far (the other skills: 9 m)
const SHOOT_COLS: Array = [Color("#3FC3FF"), Color("#E4F7FF")]
const RAIN_COLS: Array = [Color("#FF4A3D"), Color("#FFD9C9")]

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
const CAM_PITCH: float = 34.0     # cq 016: lower, looking along the street (was 44)
const CAM_YAW: float = 12.0       # cq 016: turned a little left, so the left shop fronts face the camera
const CAM_FOV: float = 52.0
const CAM_DIST: float = 15.0      # build 20 pass 2: 20 -> 15, the fighters a third bigger in the frame
const CAM_AHEAD: float = 1.2      # cq 016: the fight in the lower half (pass 2: 3.0 -> 1.2, the fight sits above the controls, not among them)
const CAM_SMOOTH: float = 0.16
const CAM_LOOK: float = 0.7
const CAM_BOUNDS: float = 8.0          # along the street (the fight keeps within ARENA_Z = +-9)
const CAM_BOUNDS_X: float = 3.0        # across it: the street stays centred, the shop walls at the edges (build 20: 2.2 -> 3.0, a fight by the kerb sat at the screen's edge)
## env-fixes 4 (audit issue 16): the fight camera in a real place. At the street's 34 deg the frame
## was two-thirds paving and the landmark only showed in the fly-in. In a place the camera sits lower
## (27 deg above the fight) and its view is lifted a few degrees (CAM_PLACE_TILT) so the horizon, the
## landmark (place.gd turns the place so it stands on the camera's line) and the skyline fill the top
## of the frame while the fighters stay where they were on screen. The fight's rules never see it.
const CAM_PLACE_PITCH: float = 30.0      # look-world: the art direction asks 30 to 34 deg in places (was 27)
const CAM_PLACE_TILT: float = 7.0       # the view's lift over the orbit (deg): 0 aims at the fight
const CAM_PLACE_DIST: float = 16.0      # build 20 pass 2: 21 -> 16 (as the street)
const CAM_PLACE_AHEAD: float = 0.6
const CAM_PLACE_FOV: float = 56.0
const CAM_FAR: float = 600.0            # env-fixes 1: past the fog's end (arena.gd FOG_END_*), so nothing is cut
## env-fixes 3 (audit issue 17): the 3D resolution and anti-aliasing. A device (a real GPU) draws the
## 3D at 0.75 of the screen with 2x MSAA; a software GPU (the llvmpipe review captures, SwiftShader
## emulators) keeps 0.5 and no AA, as before. Dynamic resolution still steps down from either when
## frames are slow. Knobs (fight config): "quality": "auto" | "device" | "low", "render_scale",
## "aa": "msaa2" | "msaa4" | "off". (FXAA is not an option: Godot 4.5.1's Compatibility renderer refuses
## screen-space AA, "Screen space AA is currently unavailable on the Compatibility renderer".)
const DEVICE_RENDER_SCALE: float = 0.75
const DEVICE_AA: String = "msaa2"
const LOW_RENDER_SCALE: float = 0.5

const TEST_PACKS: String = "/opt/cq/tasks/056-game-forge-in-world-v2/out/packs/"

# ---- the server's judge (cq 019, docs/game3d/XP.md): the fight records what happened, the game server
# checks it against these rules (costquest-backend app/roam_fight3d.py) and pays XP like any point fight.
# Recording only: nothing here draws a random number or changes a fight. Times are in 1/100 s.
const RULES_VERSION: int = 2    # build 22: SHOOT and RAIN (slots 5, 6; sources 10, 11); builds 19 to 21 fight on version 1
const J_HERO: int = 0
const J_ALLY: int = 1
const J_BOSS: int = 2
# hit sources: 1..3 the combo's hits, then the skills that strike, the ally's bolt, the boss's two strikes
const J_SRC: Dictionary = {"charge": 4, "split": 5, "whirl": 6, "bolt": 7, "swipe": 8, "slam": 9, "shoot": 10, "rain": 11}
const JF_CRIT: int = 1
const JF_STAGGERED: int = 2
const JF_BUFFED: int = 4
const JF_BLOCKED: int = 8
const JF_PARRIED: int = 16
const JF_DODGED: int = 32
# ---- build 28: the five-button panel (Subomi, 13 Nov 2026). Wale's five are the only buttons (ATTACK, DASH,
# SHIELD, SHOOT, RAIN); the other three moves stay but are not buttons: WHIRL is the combo's finisher (it is the
# third hit whenever it is back), SPLIT is a held ATTACK (a grounded slam), RALLY comes by itself when the hero
# drops below half health. Same numbers as version 2, plus how those three are triggered, so it is its own rules
# table (version 3) and the server judges those casts from the input the record logs (atk, swings, derived rows,
# docs/game3d/XP.md). The setup's rules id picks it (config "rules"); any other id fights as builds 22 to 27.
const RULES_VERSION_FIVE: int = 3
const HOLD_SPLIT_CS: int = 40          # ATTACK held this long (round clock, 1/100 s) casts SPLIT, once per hold
const AUTO_RALLY_BELOW: int = 500      # permille of the hero's max HP: below it RALLY comes by itself
const FINISHER_AFTER: int = 1          # WHIRL replaces the swing that would follow this chain index (the third hit)
const FIVE_BUTTONS: Array[int] = [0, 4, 5, 6]   # the skill slots that still have a button (DASH, SHIELD, SHOOT, RAIN)
# derived casts: why a skill was cast with no button (derived rows [t, lt, slot, how, arg])
const J_HOW_FINISHER: int = 1   # arg: the chain index of the swing it follows
const J_HOW_HOLD: int = 2       # arg: how long ATTACK had been held (1/100 s, round clock)
const J_HOW_AUTO: int = 3       # arg: the hero's HP when it came

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
## The server's per-fight tweaks (battle-3d-only, docs/game3d/XP.md "Modifiers"), from config `mods`:
## the Guardian's HP and the weight of its strikes, in permille. They sit beside the rules table, never
## in it, so rules_id() stays the same; the judge log records them and the server checks them against
## the setup it handed out. Identity (1000, 1000) leaves a fight exactly as it was.
var mods: Dictionary = {}
var boss_hp_permille: int = 1000
var boss_dmg_permille: int = 1000

var hero: FighterScript
var ally: FighterScript
var enemy: FighterScript
var fighters: Array[FighterScript] = []
var cam: Camera3D
var hud: HudScript
var fx: FxScript
var bloom: BloomScript
var sfx: SfxScript
var _haptics: HapticsScript = HapticsScript.new()
var _haptics_on: bool = false   # config "haptics": the app sends its in-game toggle; off when absent
var feel: FeelScript = FeelScript.new()   # look-fight: section 7 of the art direction (presentation only)
var _ko_dt_real: float = 0.0              # this frame's real length while the KO beat slows time
var _banner_at: float = -1.0              # the end banner waits for the KO beat (real seconds into "ending")
var _banner_args: Array = []
var _env: Environment
var _frame_k: float = 0.0                 # look-fight dynamic framing: 0 apart .. 1 engaged
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
var _skill_cd: Array[float] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
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
var _shots: Array[Dictionary] = []      # SHOOT's shots in flight: {mi, area, dir, left (m)}
var _rains: Array[Dictionary] = []      # RAIN's circles: {at, t (s since the cast, moves' clock), wave, area, tele}

# bot
var _bot_guard_t: float = 0.0
var _bot_next_skill: float = 0.0
var _bot_hold_t: float = 0.0   # five-button: the bot holds ATTACK for SPLIT this long at most

# build 28, five-button panel (RULES_VERSION_FIVE): which table this fight runs on, and ATTACK's hold
var rules_version: int = RULES_VERSION
var five: bool = false
var _atk_down: bool = false     # ATTACK is down (logged); the release is logged on the next frame that sees it up
var _atk_down_cs: int = 0       # the round clock (1/100 s) of the latest ATTACK press
var _hold_used: bool = false    # this hold already cast its SPLIT

var _end_t: float = 0.0
var _end_delay: float = 1.0
# every row starts [t, lt]: the round's clock and the moves' clock (lt stops during hit-stop, as
# buffs, staggers, skills and the AI's timers do). hits [t, lt, target, source, amount, dealt, flags];
# casts [t, lt, slot, frame]; heals [t, lt, who, amount]; staggers [t, lt, length (1/100 s), parried];
# presses [t, lt, slot]; guards [t, lt, on]
var _logic_time: float = 0.0
# cq 019: co-op (a proof, coop.gd): the server's shared Guardian pool, clock and end
var coop: Node
var _coop_won: bool = false
var _frame_dt: float = 0.0   # this frame's length: a skill cast mid-frame has its cooldown shortened by it
var _jlog: Dictionary = {"hits": [], "casts": [], "heals": [], "staggers": [], "presses": [], "guards": []}
var stats: Dictionary = {"damage_dealt": 0, "damage_taken": 0, "hits": 0, "skill_uses": 0, "ally_damage": 0,
	"parries": 0, "blocks": 0, "dodges": 0, "crits": 0, "combo_max": 0, "skills": [0, 0, 0, 0, 0, 0, 0]}

# camera state
var _cam_basis: Basis
var _cam_fwd: Vector3
var _cam_right: Vector3
# cq 016: the bot and the ally steer in the street's own frame (the old camera's, yaw 0), not the
# camera's: turning the camera must not change a seeded fight (float rounding through the stick)
var _play_fwd: Vector3
var _play_right: Vector3
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
var _cam_ahead: float = CAM_AHEAD
var _view_basis: Basis          # env-fixes 4: the camera's own turn (the orbit _cam_basis plus a tilt)
var quality: String = "low"     # env-fixes 3: "device" or "low" (software GPU), see DEVICE_*

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
	mods = {}
	boss_hp_permille = 1000
	boss_dmg_permille = 1000
	var m: Variant = c.get("mods")
	if m is Dictionary:
		boss_hp_permille = clampi(int((m as Dictionary).get("boss_hp_permille", 1000)), 200, 5000)
		boss_dmg_permille = clampi(int((m as Dictionary).get("boss_dmg_permille", 1000)), 200, 3000)
		mods = {"boss_hp_permille": boss_hp_permille, "boss_dmg_permille": boss_dmg_permille}
	# build 28: the setup's rules id picks the table; "five_button" is a review/test knob (the app never sends it)
	five = str(c.get("rules", "")) == rules_id(RULES_VERSION_FIVE) or bool(c.get("five_button", false))
	rules_version = RULES_VERSION_FIVE if five else RULES_VERSION
	if five:
		# ATTACK down/up [t, lt, on], every combo swing [t, lt, chain index], every derived cast [t, lt, slot, how, arg]
		_jlog["atk"] = []
		_jlog["swings"] = []
		_jlog["derived"] = []
	autoplay = bool(c.get("autoplay", false))
	bot_kind = str(c.get("bot", "fight"))
	_load_threaded = bool(c.get("load_thread", true))
	if c.has("seed"):
		rng.seed = int(c["seed"])
	else:
		rng.randomize()


## build 21: the fight sideways (config "landscape", the app's flag for 6 GB phones and up). The
## HUD is designed on 1280 x 720 instead of 720 x 1280, so its buttons keep their size on the
## phone; the camera narrows its view (the screen is short now) and keeps the fight in the
## middle, the controls being at the sides. Presentation only: the rules, the seeded RNG and the
## record are the same either way.
const LAND_FOV_K: float = 0.7
const LAND_AHEAD: float = 2.6   # build 21 review: 0.5 put the Guardian under the top bar
var _landscape: bool = false


func _ready() -> void:
	_headless = DisplayServer.get_name() == "headless"
	_landscape = bool(cfg.get("landscape", false))
	var root_win: Window = get_tree().root if get_tree() != null else null
	if root_win != null:
		root_win.content_scale_size = Vector2i(1280, 720) if _landscape else Vector2i(720, 1280)
	# cam_* overrides are for review captures (close-ups); the game uses the constants
	_cam_dist = float(cfg.get("cam_dist", CAM_DIST))
	_cam_ahead = float(cfg.get("cam_ahead", LAND_AHEAD if _landscape else CAM_AHEAD))
	_reduce_motion = bool(cfg.get("reduce_motion", false))   # the app's Reduce motion setting: a quarter of the shake, no zoom punch
	feel.reduce_motion = _reduce_motion
	# Off unless the app asks: an older app build reads any message without "event" handling as
	# the result, and review captures and headless runs have no phone to buzz.
	_haptics_on = bool(cfg.get("haptics", false)) and not _headless
	_cam_basis = Basis.from_euler(Vector3(deg_to_rad(-float(cfg.get("cam_pitch", CAM_PITCH))), deg_to_rad(float(cfg.get("cam_yaw", CAM_YAW))), 0.0))
	_view_basis = _cam_basis
	_cam_fwd = Vector3(-_cam_basis.z.x, 0.0, -_cam_basis.z.z).normalized()
	_cam_right = Vector3(_cam_basis.x.x, 0.0, _cam_basis.x.z).normalized()
	var play_basis: Basis = Basis.from_euler(Vector3(deg_to_rad(-44.0), 0.0, 0.0))
	_play_fwd = Vector3(-play_basis.z.x, 0.0, -play_basis.z.z).normalized()
	_play_right = Vector3(play_basis.x.x, 0.0, play_basis.x.z).normalized()
	var t0: int = Time.get_ticks_usec()
	# 3D drawn at a fraction of the screen's pixels, the HUD at full resolution.
	# A 1080x2400 phone does not need 2.6 M shaded pixels for this view.
	quality = _quality()
	# realism: the high tier draws the 3D at the screen's own resolution on a real GPU (look "scale")
	var tier_scale: float = float((ArenaScript.TIER_LOOK[ArenaScript.tier_of(cfg)] as Dictionary).get("scale", DEVICE_RENDER_SCALE))
	if cfg.get("look") is Dictionary and (cfg["look"] as Dictionary).has("scale"):
		tier_scale = float((cfg["look"] as Dictionary)["scale"])
	var rs: float = clampf(float(cfg.get("render_scale", tier_scale if quality == "device" else LOW_RENDER_SCALE)), 0.25, 1.0)
	get_viewport().scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	get_viewport().scaling_3d_scale = rs
	# fid29-lightcam: the tier's own MSAA (TIER_LOOK "aa": high msaa4) when its look has fid_lightcam
	var aa_dev: String = DEVICE_AA
	var lo0: Dictionary = ArenaScript.look_opts(cfg)
	if bool(lo0.get("fid_lightcam", false)) and lo0.has("aa"):
		aa_dev = str(lo0["aa"])
	var aa: String = str(cfg.get("aa", aa_dev if quality == "device" else "off"))
	get_viewport().msaa_3d = {"msaa2": Viewport.MSAA_2X, "msaa4": Viewport.MSAA_4X}.get(aa, Viewport.MSAA_DISABLED)
	_dyn_base = rs
	_dyn_on = bool(cfg.get("dyn_res", true)) and not _headless
	# No blocking on vsync (the compositor buffers the surface on Android/iOS, so
	# no tearing), capped at max_fps: a frame that misses a vsync by 1 ms no
	# longer waits a whole extra one, which is input latency.
	if not _headless:
		if not bool(cfg.get("vsync", false)):
			DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		Engine.max_fps = clampi(int(cfg.get("max_fps", 60)), 15, 120)
	print("CQ render_scale=%.2f aa=%s quality=%s gpu=%s vsync=%s max_fps=%d" % [rs, aa, quality,
		RenderingServer.get_video_adapter_name(), str(DisplayServer.window_get_vsync_mode()), Engine.max_fps])
	cfg["_quality"] = quality   # look-world: the arena picks the device shadow map from it
	arena = ArenaScript.new()
	arena.name = "Arena"
	add_child(arena)
	arena.call("build", cfg)
	_lc = bool((arena.get("look") as Dictionary).get("fid_lightcam", false))
	if _lc:
		ShaderWarm.add(_lc_dof_mat())    # the depth focus first draws at the intro beat: compiled under the loading card
	_place_camera()
	_close_camera()
	HitArea.ordered = bool((arena.get("look") as Dictionary).get("hit_order", false))   # realism round 3 (hit_area.gd)
	# realism round 4: how much the effect cards add (project.godot shader_globals; 1 and no cap unless the tier says)
	var lk_fx: Dictionary = arena.get("look") as Dictionary
	var fx_gain: float = float(lk_fx.get("fx_gain", 1.0))
	var fx_cap: float = float(lk_fx.get("fx_cap", 100.0))
	if bool(lk_fx.get("fx_combat", false)):
		# fx_combat: the effects may add a little more (the shield still frames the struck fighter's head and chest)
		fx_gain = maxf(fx_gain, 0.8)
		fx_cap = maxf(fx_cap, 0.7)
	RenderingServer.global_shader_parameter_set("cq_fx_gain", fx_gain)
	RenderingServer.global_shader_parameter_set("cq_fx_cap", fx_cap)
	_ground = arena.get("ground")
	plaza = arena.get("plaza")
	_build_camera()
	# build 28 (forge-env-28): the point's Forge world piece as set dressing at the far end of the fight
	# (env_piece.gd); presentation only, loaded beside the fighters, never through the load queue
	if str(cfg.get("env_glb", "")) != "" or str(cfg.get("env_thumb", "")) != "":
		var env_piece: Node3D = EnvPieceScript.new()
		env_piece.name = "EnvPiece"
		arena.add_child(env_piece)
		env_piece.call("setup", cfg, self)
	fx = FxScript.new()
	fx.name = "Fx"
	add_child(fx)
	fx.visible = bool(cfg.get("fx_visible", true))   # review captures of the characters only (cq 016)
	var lk: Dictionary = arena.get("look")
	if bool(lk.get("bloom", true)) and not bool(lk.get("glow", false)):
		# cq 016: the cheap bloom (lit street + effects only, a tiny view, LOOK.md)
		bloom = BloomScript.new()
		bloom.name = "Bloom"
		add_child(bloom)
		bloom.setup(cam, Vector2i(get_viewport().get_visible_rect().size), lk)
		bloom.add_source(fx)
		for g: Node in arena.find_children("*", "MeshInstance3D", false, false):
			if g.has_meta("bloom"):
				(g as VisualInstance3D).layers |= BloomScript.BLOOM_LAYER
	sfx = SfxScript.new()
	sfx.name = "Sfx"
	sfx.enabled = bool(cfg.get("sound", true))
	sfx.music_on = bool(cfg.get("music", true)) and not _headless
	add_child(sfx)
	_build_boss_area()
	var layer := CanvasLayer.new()
	layer.name = "HudLayer"
	add_child(layer)
	hud = HudScript.new()
	hud.name = "Hud"
	layer.add_child(hud)
	hud.cam = cam
	if _close:
		hud.plate_min_y = 196.0     # realism round 3: name plates stay under the top block
	hud.map_blocks = arena.get("map_blocks")
	hud.visible = not bool(cfg.get("prof_no_hud", false))   # profiling only: the 3D cost alone
	hud.players_text = str(cfg.get("players_text", "2/2")).replace(" players", "").replace(" player", "")
	hud.point_name = str(cfg.get("point_name", ""))
	hud.top_shift = clampf(float(cfg.get("hud_top", 0.0)), 0.0, 240.0)   # build 20: the safe area (hud.gd)
	hud.panel = "classic" if str(cfg.get("hud_panel", "wale")) == "classic" else "wale"   # build 21: Wale's panel
	hud.extras = str(cfg.get("hud_extras", "arc"))   # build 22: where the three interim buttons sit (review stills)
	hud.halo_a = clampf(float(cfg.get("hud_halo", 0.42)), 0.0, 1.0)
	hud.five = five   # build 28: Wale's five only, the cues for the finisher, the hold and RALLY
	hud.hold_cs = HOLD_SPLIT_CS
	hud.rally_below = AUTO_RALLY_BELOW
	if _landscape:
		var sd: Variant = cfg.get("hud_side", [0, 0])
		if sd is Array and (sd as Array).size() == 2:
			hud.side_l = clampf(float(sd[0]), 0.0, 200.0)
			hud.side_r = clampf(float(sd[1]), 0.0, 200.0)
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
		_begin_when_built()
		return
	# hero_hp / enemy_hp: test and capture knobs (a quick win or loss); the app never sends them
	AnimLib.motion = str(cfg.get("motion", "hybrid" if bool(cfg.get("motion_realism", false)) else "classic"))
	AnimLib.state_modes = (cfg["motion_states"] as Dictionary) if cfg.get("motion_states") is Dictionary else {}
	# anim-readable (13 Nov 2026): every button's own body action, sized hit reactions, the Guardian's
	# knockdown, the hero's intro and victory, breathing and turning steps. Presentation only (the
	# rules, hit frames and cooldowns are untouched). "readable": false plays build 25's clips.
	AnimLib.readable = (1 if bool(cfg["readable"]) else 0) if cfg.has("readable") else -1
	FighterScript.soft_shadows = AnimLib.readable_now()
	_ready_pose = bool(cfg.get("ready_pose", true))
	hero = _spawn(str(cfg.get("hero_name", "You")), 0, int(cfg.get("hero_hp", HERO_HP)), Color(0.3, 0.75, 0.35), Vector3(0.3, 0, 3.6), PI, "hero")
	ally = _spawn(str(cfg.get("ally_name", "Ally")), 0, ALLY_HP, Color(0.3, 0.65, 0.9), Vector3(3.0, 0, 4.4), PI, "ally")
	enemy = _spawn(str(cfg.get("enemy_name", "Guardian")), 1, int(cfg.get("enemy_hp", boss_hp())), Color(0.85, 0.3, 0.25), Vector3(-0.4, 0, -0.6), 0.0, "boss",
		clampf(float(_guardian_look().get("size_permille", 1000)) / 1000.0, 0.7, 1.5))
	if cfg.get("coop") is Dictionary:
		_start_coop(cfg["coop"])
	if bool(cfg.get("rev_solo", false)):
		# review captures of the hero alone (cq 016): the ally and the boss stand well out of shot
		ally.position = Vector3(9.0, 0, 16.0)
		enemy.position = Vector3(-9.0, 0, -16.0)
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
	_focus = hero.position + _cam_fwd * _cam_ahead
	_apply_camera(0.0)
	var no_model: Array = []
	for pair: Array in [[hero, "hero_glb"], [ally, "ally_glb"], [enemy, "enemy_glb"]]:
		# the cast clip library and the weapon set (cq 012): by <role>_key when the config
		# has it (else the skeleton is recognised) and the held weapon's class
		var role: String = str(pair[1]).trim_suffix("_glb")
		var wcfg: Variant = cfg.get(role + "_weapon")
		(pair[0] as FighterScript).anim_opts = {"key": str(cfg.get(role + "_key", "")),
			"class": str((wcfg as Dictionary).get("class", "")) if wcfg is Dictionary else ""}
		var p: String = LoaderScript.clean_path(str(cfg.get(pair[1], "")))
		# realism: on the mid and high tiers the six faction heroes are the cast (see _hero_cast)
		var hero_p: String = _hero_cast(role, p)
		if hero_p != "":
			p = hero_p
			(pair[0] as FighterScript).anim_opts["key"] = str(cfg.get(role + "_key", ""))
		if p != "" and bool(cfg.get("rig_fixes", true)):
			var fx: Array = LoaderScript.rig_fix(p)
			if str(fx[1]) != "":
				_log("rigfix role=%s key=%s from=%s to=%s" % [role, str(fx[1]), p, str(fx[0])])
				p = str(fx[0])
				_cast_worn[role] = str(fx[1])
		# realism-20261111 (presentation only; the app passes none of these yet, so a fight without
		# them is build 21's to the frame). "motion_realism": true turns the whole motion work on:
		# the captured clips ("motion": "mocap"), foot locking by device tier ("foot_ik"), the aim
		# hold ("aim_hold"), weight ("weight"), natural KO and cheer speeds and legs animated by the
		# ground really covered. Each key overrides its part. "<role>_class": a weapon class
		# without a weapon model ("unarmed").
		var mr: bool = bool(cfg.get("motion_realism", false))
		if cfg.has(role + "_class"):
			(pair[0] as FighterScript).anim_opts["class"] = str(cfg[role + "_class"])
		# anim-readable (Wale: feet steadily on the ground on every tier): with the readable clips the foot lock,
		# the bind-pose guard and legs animated by the ground really covered are on by default on every tier;
		# the app's tier keys still override ("foot_ik": false turns the lock off)
		var rd: bool = AnimLib.readable_now()
		(pair[0] as FighterScript).anim_opts["foot_ik"] = bool(cfg.get("foot_ik", rd))   # the app decides by tier (features/game/motionTier.ts)
		(pair[0] as FighterScript).anim_opts["natural_rates"] = bool(cfg.get("natural_rates", mr))
		(pair[0] as FighterScript).anim_opts["no_bind"] = bool(cfg.get("no_bind", mr or rd))
		(pair[0] as FighterScript).anim_opts["run_layer"] = bool(cfg.get("run_layer", mr))
		(pair[0] as FighterScript).aim_hold = bool(cfg.get("aim_hold", mr or rd))
		(pair[0] as FighterScript).weight_fx = bool(cfg.get("weight", mr))
		(pair[0] as FighterScript).real_speed = bool(cfg.get("real_speed", mr or rd))
		(pair[0] as FighterScript).turn_steps = AnimLib.readable_now()
		(pair[0] as FighterScript).anim_opts["breathe"] = AnimLib.readable_now()
		p = _tier_lod(p, role)
		# fid29 seam (fid29-heromaps): the hero file the tier really loads (a no-op at fid29-base)
		p = HeroFiles.pick(p, role, arena.get("look") if arena != null else {})
		# realism: a clip library that came with a downloaded model (anim.glb + anim.json beside it)
		var side_key: String = AnimLib.register_sidecar(p)
		# build 28: the fight kit the app downloaded with this character (config "<role>_anim")
		if side_key == "" and p != "" and not p.begins_with("res://") and str(cfg.get(role + "_anim", "")) != "":
			side_key = AnimLib.register_kit(LoaderScript.clean_path(str(cfg[role + "_anim"])))
		if side_key != "":
			cfg[role + "_key"] = side_key
			(pair[0] as FighterScript).anim_opts["key"] = side_key
		(pair[0] as FighterScript).anim_opts["secondary"] = bool(cfg.get("secondary", true))
		(pair[0] as FighterScript).anim_opts["cloth_push"] = bool(cfg.get("cloth_push", true))   # cq 016
		if p != "":
			(pair[0] as FighterScript).visible = false
			_load_queue.append({"f": pair[0], "path": p, "role": str(pair[1]).trim_suffix("_glb")})
		else:
			no_model.append([pair[0], role])
	# build 20: once every Forge model is known, the roles without one get a cast stand-in
	for nm: Array in no_model:
		var sp: String = _cast_stand_in(nm[0] as FighterScript, str(nm[1]))
		if sp != "":
			(nm[0] as FighterScript).visible = false
			_load_queue.append({"f": nm[0], "path": sp, "role": str(nm[1])})
			_log("load role=%s no path, cast stand-in %s" % [str(nm[1]), sp])
		else:
			_log("load role=%s skipped (no path), capsule" % str(nm[1]))
	if coop != null and coop.get("peer") != null and str((cfg["coop"] as Dictionary).get("peer_glb", "")) != "":
		var peer_f: FighterScript = coop.get("peer")
		peer_f.anim_opts = {"key": str((cfg["coop"] as Dictionary).get("peer_key", "")), "class": "", "secondary": true, "cloth_push": true}
		peer_f.visible = false
		_load_queue.append({"f": peer_f, "path": LoaderScript.clean_path(str((cfg["coop"] as Dictionary)["peer_glb"])), "role": "peer"})
	_queue_weapons()
	# fight-anim review captures only: the per-frame animation probe (tools/ is not exported)
	if str(cfg.get("anim_probe", "")) != "" and ResourceLoader.exists("res://tools/anim_probe.gd"):
		var probe: Node = (load("res://tools/anim_probe.gd") as GDScript).new()
		probe.set("path", str(cfg["anim_probe"]))
		probe.set("fighters", [["hero", hero], ["ally", ally], ["enemy", enemy]])
		add_child(probe)
	if _load_queue.is_empty():
		_begin_when_built()
	else:
		state = "loading"
		hud.loading_text = "Loading fighters..."
		_load_t0 = Time.get_ticks_usec()


func _exit_tree() -> void:
	_restore_time()
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

## env-fixes 3: "device" on a real GPU, "low" on a software one (llvmpipe/lavapipe/SwiftShader, the
## review captures) or headless. Config "quality" forces either.
func _quality() -> String:
	var q: String = str(cfg.get("quality", "auto"))
	if q == "device" or q == "low":
		return q
	if _headless:
		return "low"
	var gpu: String = (RenderingServer.get_video_adapter_name() + " " + RenderingServer.get_video_adapter_vendor()).to_lower()
	for sw: String in ["llvmpipe", "lavapipe", "softpipe", "swiftshader", "software"]:
		if gpu.contains(sw):
			return "low"
	return "device"


## realism round 2 (look "cam": "close", the mid and high tiers): a closer, lower fight camera, so the hero
## stands about a third of the screen high (build 21: under a fifth) and a face can be read. The orbit's
## heading is the old one (the stick's axes, the bot and the ally's spot depend on it: the judged fight is
## the same); only the pitch, the distance and the pivot change. The distance is the closest that still
## shows the hero, the Guardian it is fighting and an ally standing by, inside the HUD's margins: it pulls
## back only as far as the fighters are apart, quickly out and slowly in, never past build 21's distance.
## A config with cam_dist or cam_pitch (review captures) keeps the camera it asks for.
const CLOSE_PITCH: float = 28.0          # deg above the fight, portrait (round 4: 20 -> 28, see CLOSE_FACE)
const CLOSE_PITCH_LAND: float = 16.0
const CLOSE_TILT: float = 2.0            # portrait: the view's extra pitch over the orbit (deg)
const CLOSE_DIST: float = 5.4            # m: the hero alone, portrait (about a third of the screen's height)
const CLOSE_DIST_LAND: float = 7.8       # landscape (about two fifths)
const CLOSE_PIVOT_H: float = 1.15        # the orbit turns round the hero's chest, not the knees
const CLOSE_MAX: float = 15.0            # build 21's distance: the furthest it pulls back
const CLOSE_MARGIN: Vector3 = Vector3(0.94, 0.72, 0.8)
const CLOSE_MARGIN_LAND_TOP: float = 0.70    # landscape: the top block is 112 of 720 HUD px
const CLOSE_BOUNDS_X: float = 4.2
const CLOSE_WIN_DIST: float = 4.4        # the victory shot: the winner from the knees up
const CLOSE_WIN_DIST_LAND: float = 5.2
const CLOSE_WIN_PITCH: float = 9.0
var _close: bool = false
var _close_d: float = CAM_DIST
var _close_win_basis: Basis
var _close_top: float = 0.72
var _close_lean: float = 0.3
var _close_bottom: float = CLOSE_MARGIN.z   # fid29-lightcam: the close fit's bottom margin (lc_bottom)
var _close_face: float = 0.0     # the share of the target's height that must stay under the top margin (0 = only the 0.78 point)


func _close_camera() -> void:
	var lk: Dictionary = arena.get("look") if arena != null else {}
	if str(lk.get("cam", "")) != "close" or cfg.has("cam_dist") or cfg.has("cam_pitch"):
		return
	_close = true
	var yaw: float = atan2(_cam_basis.z.x, _cam_basis.z.z)    # the heading stays: _cam_fwd and _cam_right do not move
	# look "close_pitch", "close_tilt", "close_dist", "close_top", "close_lean", "close_face": framing trials (tools/look/cam_probe.gd)
	var pitch: float = float(lk.get("close_pitch", CLOSE_PITCH_LAND if _landscape else (LC_PITCH if bool(lk.get("fid_lightcam", false)) else CLOSE_PITCH)))
	var tilt: float = float(lk.get("close_tilt", 0.0 if _landscape else CLOSE_TILT))
	_close_top = float(lk.get("close_top", CLOSE_MARGIN_LAND_TOP if _landscape else 0.76))
	_close_lean = float(lk.get("close_lean", 0.45 if _landscape else 0.3))
	# round 4: portrait keeps the target's face under the top block too. From the old 20 deg orbit that cost
	# the hero's size (27 % of the screen); from 28 deg the camera is above a tall Guardian's head, so its face
	# falls lower in the frame and the hero stays at 30 % (trials: experiments/look/round4)
	_close_face = float(lk.get("close_face", 0.9 if _landscape else 0.87))
	# fid29-lightcam: the lowest point (the hero's feet) may sit nearer the bottom edge (under the controls), so the
	# fighters fill more of the frame (look "lc_bottom"; build 28: CLOSE_MARGIN.z)
	_close_bottom = float(lk.get("lc_bottom", LC_BOTTOM)) if (_lc and not _landscape) else CLOSE_MARGIN.z
	_cam_basis = Basis.from_euler(Vector3(deg_to_rad(-pitch), yaw, 0.0))
	# portrait: the view looks a little further down than the orbit, so the fight sits above the controls
	_view_basis = Basis.from_euler(Vector3(deg_to_rad(-(pitch + tilt)), yaw, 0.0))
	_close_win_basis = Basis.from_euler(Vector3(deg_to_rad(-CLOSE_WIN_PITCH), yaw, 0.0))
	_lc_win_basis = Basis.from_euler(Vector3(deg_to_rad(-float(lk.get("lc_win_pitch", LC_WIN_PITCH))), yaw, 0.0))
	_lc_win_basis_place = Basis.from_euler(Vector3(deg_to_rad(-float(lk.get("lc_win_pitch_place", LC_WIN_PITCH_PLACE))), yaw, 0.0))
	_cam_dist = float(lk.get("close_dist", CLOSE_DIST_LAND if _landscape else (LC_CLOSE_DIST if _lc else CLOSE_DIST)))
	_cam_ahead = 0.0
	_close_d = _cam_dist
	_log("close camera pitch=%.0f dist=%.1f" % [CLOSE_PITCH_LAND if _landscape else CLOSE_PITCH, _cam_dist])


## The distance at which the hero, its target and an ally close by are all inside the screen's margins.
func _close_fit() -> float:
	if hero == null or cam == null:
		return _cam_dist
	var tv: float = tan(deg_to_rad(_base_fov) * 0.5)
	var vs: Vector2 = get_viewport().get_visible_rect().size
	var th: float = tv * vs.x / maxf(vs.y, 1.0)
	var pivot: Vector3 = _focus + Vector3.UP * _lc_pivot_h()
	var pts: Array[Vector3] = [hero.position, hero.position + Vector3.UP * (FighterScript.HEIGHT * hero.size_k + 0.15)]
	if enemy != null and not enemy.dead:
		# the target's chest and face (a boss is half as tall again, and a target standing between the hero
		# and the camera is very large: its legs and the top of its head may leave the frame)
		pts.append(enemy.position + Vector3.UP * (FighterScript.HEIGHT * enemy.size_k * 0.55))
		pts.append(enemy.position + Vector3.UP * (FighterScript.HEIGHT * enemy.size_k * 0.78))
		if _close_face > 0.0:
			# round 3: landscape has room to spare (the hero is well over the target size), so the target's
			# whole head stays below the top block; portrait cannot afford it (the hero drops to a quarter)
			pts.append(enemy.position + Vector3.UP * (FighterScript.HEIGHT * enemy.size_k * _close_face))
	if ally != null and not ally.dead and ally.visible and _flat(ally.position - hero.position).length() < (3.0 if _landscape else 1.6):
		# a third fighter in the brawl beside the hero: its body's middle stays in the frame
		pts.append(ally.position + Vector3.UP * 1.2)
	# the nearest distance (from the close distance out to build 21's) at which every point is inside the
	# margins: the view may be tilted off the orbit, so it is searched, not solved
	var lo: float = _cam_dist
	var hi: float = CLOSE_MAX
	if _close_ok(pts, pivot, lo, tv, th):
		return lo
	for i in 7:
		var mid: float = (lo + hi) * 0.5
		if _close_ok(pts, pivot, mid, tv, th):
			hi = mid
		else:
			lo = mid
	return hi


func _close_ok(pts: Array[Vector3], pivot: Vector3, d: float, tv: float, th: float) -> bool:
	var eye: Vector3 = pivot + _cam_basis.z * d
	if _lc and not _landscape:
		eye += _view_basis.x * _lc_hoff() + _view_basis.y * _lc_voff()   # fid29-lightcam: the camera's offsets
	for p: Vector3 in pts:
		var r: Vector3 = p - eye
		var depth: float = -r.dot(_view_basis.z)
		if depth < 0.6:
			return false
		var y: float = r.dot(_view_basis.y)
		if absf(r.dot(_view_basis.x)) > depth * th * CLOSE_MARGIN.x or y > depth * tv * _close_top or -y > depth * tv * _close_bottom:
			return false
	return true


## realism round 2 (look "beats"): the hero's shot before the fight. For BEAT_LEN seconds before the clock
## starts the hero turns to the camera and the camera stands at chest-up distance, then pulls back to the
## fight camera as the hero turns to the Guardian. Nothing of the fight has started (the clock, the bot and
## the Guardian wait as they do through a place's fly-in), the hero's yaw is put back exactly before the
## first frame of the fight, and a tap on ATTACK skips it. Config "intro": false, or the low tier: none.
const BEAT_LEN: float = 1.8
const BEAT_OUT: float = 0.7              # the pull-back to the fight camera, at the end
const BEAT_TURN: float = 0.45            # the hero turns back to the Guardian over the last part
var _beat_t: float = -1.0
var _beat_yaw0: float = 0.0


func _after_intro() -> void:
	var lk: Dictionary = arena.get("look") if arena != null else {}
	if hero == null or not bool(lk.get("beats", false)) or not bool(cfg.get("intro", true)) or cfg.has("cam_dist") or cfg.has("cam_pitch"):
		_begin_fight()
		return
	_beat_t = 0.0
	_beat_yaw0 = hero.yaw
	if bool(lk.get("beat_turn", true)):
		hero.yaw = atan2(-_cam_fwd.x, -_cam_fwd.z)
		hero.rotation.y = hero.yaw
	state = "intro"
	hud.visible = false     # the shot is the hero's: no controls over it (they come back with the clock)
	if AnimLib.readable_now() and hero.anim.has_clip("intro"):
		hero.act("intro", BEAT_LEN)   # anim-readable: the hero's own intro pose (anim_clips.json hero_poses)
	_log("intro hero beat")


func _beat_restore() -> void:
	if hero != null and hero.yaw != _beat_yaw0:
		hero.yaw = _beat_yaw0
		hero.rotation.y = hero.yaw


func _beat_camera() -> void:
	if _beat_t < 0.0 or hero == null:
		return
	var to: Transform3D = cam.global_transform
	var face: Vector3 = hero.position + Vector3.UP * (FighterScript.HEIGHT * hero.size_k * 0.74)
	var dist: float = (2.5 if _landscape else 2.0) * hero.size_k * (1.08 - 0.08 * _beat_t / BEAT_LEN)
	var k: float = smoothstep(BEAT_LEN - BEAT_OUT, BEAT_LEN, _beat_t)
	# fid29-lightcam fix round: build 28's intro lens, distance and push-in (the 30 deg long lens lost its pairs:
	# it cropped the opponent to half a body at the frame's edge and flattened the depth)
	var from: Vector3 = face - _cam_fwd * dist + _cam_right * 0.5 + Vector3.UP * 0.12
	cam.global_transform = Transform3D(Basis.looking_at(face - from, Vector3.UP).slerp(to.basis.orthonormalized(), k), from.lerp(to.origin, k))


## realism round 4 (look "dof", the high tier): a stand-in for a shallow depth of field in the hero's intro
## shot and the victory shot. This renderer has no depth of field. A plate stands a little behind the hero,
## facing the camera, and draws the picture behind it again from the screen texture's small mips (a soft
## version of the street): what is in front of the plate (the hero, an ally beside it) stays sharp, what is
## behind goes soft. One screen copy and one quad, only while a beat shows; nothing in gameplay.
const DOF_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled, fog_disabled, depth_draw_never;
uniform sampler2D screen : hint_screen_texture, filter_linear, repeat_disable;
uniform float amount = 0.0;
void fragment() {
	// the screen texture has no usable mips here (reading them gave ghost edges), so: 13 taps on two rings
	vec2 px = 1.0 / VIEWPORT_SIZE;
	vec3 c = texture(screen, SCREEN_UV).rgb * 0.16;
	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.0472;
		vec2 d = vec2(cos(a), sin(a));
		c += texture(screen, SCREEN_UV + d * px * 3.5).rgb * 0.08;
		c += texture(screen, SCREEN_UV + vec2(d.y, -d.x) * px * 8.0).rgb * 0.06;
	}
	ALBEDO = c;
	ALPHA = amount;
}
"""
var _dof: MeshInstance3D
var _dof_k: float = 0.0


## realism round 5 (13 Nov): the soft face fill on the real look (mid and high tier). Full in the hero's intro beat and
## the victory shot (the camera moments that show faces), FACE_FILL_FIGHT of it at fight distance. It lights the
## fighters only (their material), never the street, and comes from the camera's side, above it and a little left.
func _face_fill_update() -> void:
	if arena == null or cam == null or not bool((arena.get("look") as Dictionary).get("real", false)):
		return
	var close: float = 0.0
	if _beat_t >= 0.0:
		close = 1.0 - smoothstep(BEAT_LEN - BEAT_OUT, BEAT_LEN, _beat_t)
	elif state == "ending" and outcome == "win":
		close = ease(_win_k, -2.0)
	if bool(cfg.get("face_close", false)):
		close = 1.0      # review tools (tools/look/face_clip.gd): the close shots' light and gaze throughout
	var k: float = lerpf(FighterScript.FACE_FILL_FIGHT, FighterScript.FACE_FILL_CLOSE, close)
	var cb: Basis = cam.global_transform.basis
	var to_fill: Vector3 = (cb.z + cb.y * 0.45 - cb.x * 0.3).normalized()
	for f: FighterScript in fighters:
		f.set_face_fill(k, to_fill)
		if f.face_life != null and not bool(f.face_life.get("pinned")):
			# the gaze: the camera in the close shots (the hero is turned to it), else the nearest living opponent's face
			var tgt: Vector3 = Vector3.INF
			if close > 0.5 and f == hero:
				tgt = cam.global_position
			else:
				var best: float = INF
				for o: FighterScript in fighters:
					if o.team != f.team and not o.dead:
						var dd: float = o.position.distance_to(f.position)
						if dd < best:
							best = dd
							tgt = o.global_position + Vector3.UP * (FighterScript.HEIGHT * o.size_k * 0.9)
			f.face_life.target = tgt


func _dof_update() -> void:
	if arena == null or cam == null or hero == null or not (bool((arena.get("look") as Dictionary).get("dof", false)) or _lc):
		return
	var want: float = 0.0
	if _beat_t >= 0.0:
		want = 1.0 - smoothstep(BEAT_LEN - BEAT_OUT, BEAT_LEN - 0.15, _beat_t)
	elif _close and state == "ending" and outcome == "win":
		want = ease(_win_k, -2.0)
	_dof_k = want if _beat_t >= 0.0 else move_toward(_dof_k, want, 0.08)
	if _dof_k <= 0.01:
		if _dof != null:
			_dof.visible = false
		return
	if _dof == null:
		_dof = MeshInstance3D.new()
		_dof.name = "DofPlate"
		_dof.mesh = QuadMesh.new()
		_dof.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var sm: ShaderMaterial = _lc_dof_mat() if _lc else ShaderMaterial.new()
		if not _lc:
			var sh := Shader.new()
			sh.code = DOF_SHADER
			sm.shader = sh
		sm.render_priority = -100     # before the effects and the halos: they stay sharp over it
		_dof.material_override = sm
		_dof.set_meta("no_bloom", true)
		cam.add_child(_dof)
	if _lc:
		# fid29-lightcam: a full-screen pass (the vertex shader places it), focused on the hero's chest
		_dof.extra_cull_margin = 16384.0
		_dof.position = Vector3(0.0, 0.0, -1.0)
		_dof.visible = true
		var dm: ShaderMaterial = _dof.material_override
		dm.set_shader_parameter("amount", _dof_k)
		dm.set_shader_parameter("focus", -(cam.global_transform.affine_inverse() * (hero.global_position + Vector3.UP * FighterScript.HEIGHT * hero.size_k * 0.6)).z)
		return
	var d: float = cam.global_position.distance_to(hero.global_position + Vector3.UP * 1.2) + 1.1 * hero.size_k
	var h: float = 2.0 * d * tan(deg_to_rad(cam.fov) * 0.5) * 1.3
	var vs: Vector2 = get_viewport().get_visible_rect().size
	(_dof.mesh as QuadMesh).size = Vector2(h * vs.x / maxf(vs.y, 1.0), h)
	_dof.position = Vector3(0.0, 0.0, -d)
	_dof.visible = true
	(_dof.material_override as ShaderMaterial).set_shader_parameter("amount", _dof_k)


## ---- fid29-lightcam (build 29, docs/game3d/fid29/lightcam.md): light, lens and framing, mid and high only
## (look "fid_lightcam"; off, and on the low tier, everything below is build 28's). Presentation only: nothing here
## reads or writes the fight's state, timers, RNG or hit order; all motion comes from the frame clock.
##   - the close shots (the hero's intro beat, the victory shot), weighted by the same close weight as the face fill:
##     the sun's shadow tightens round the hero (max distance = camera to hero + 3 m, the first split ends just past
##     the face, bias 0.2 -> 0.05, normal bias 3.0 -> 0.9, eased over LC_SHADOW_S), the fighters take the shadow map
##     (recv_shadow 0 -> 1: nose, chin and collar shadows), the sky-side kicker becomes a rim (kick_a x LC_RIM) and the
##     exposure rises LC_EV stops; the victory shot on a long lens with a slow push-in (_apply_camera; the intro beat
##     keeps build 28's lens); depth-aware focus. The sun has two splits (PSSM2) only while the close weight is above
##     0: at fight distance it is build 28's single orthogonal split, so the fighters are drawn into one shadow pass
##   - the mid-fight frame: a lower orbit (LC_PITCH), a lower pivot and a camera offset (LC_H_OFF, LC_V_OFF), so the
##     fighters fill more of the frame and the paving less; the heading is untouched (the stick, the bot and the ally's
##     spot depend on it)
##   - a real place's reflections: a small cube captured at the fight under the loading card (look_real.gd)
## fid29-lightcam street victory fit round (judge-lightcam-r2): the street victory was 0.72 of the height on a 32 deg lens,
## aimed at 0.52 of the body, pitch 3: it cut Kofi's and Tavo's raised hands and looked up under Zuri's chin. Now 0.50
## on a 48 deg lens (the hands fit with margin), the camera at 0.8 of the body looking down 8 deg (the face level, as
## build 28's), on the place victory's single full-atlas split and near plane (face texel 4.77 mm). Trials fix/s10..s16.
const LC_WIN_FOV: float = 48.0
const LC_PUSH: float = 0.05             # the victory shot's slow push-in (critically damped)
const LC_PUSH_W: float = 2.6            # its rate (1/s): about 90 % done by the end of the beat
const LC_HANDHELD_DEG: float = 0.15     # high: a hand-held drift, from a hash of the frame clock
const LC_EV: float = 0.15
const LC_RIM: float = 2.6               # kick_a's gain in the close shots
const LC_SHADOW_S: float = 0.2
const LC_CLOSE_BLUR: float = 0.8        # the sun's shadow_blur in the close shots (fight distance keeps the tier's)
const LC_BIAS: Vector2 = Vector2(0.2, 0.05)       # fight, close
const LC_NBIAS: Vector2 = Vector2(3.0, 0.9)
const LC_SPLIT: float = 0.3             # the first shadow split at fight distance (of 35 m)
const LC_WIN_SHARE: float = 0.5         # the winner's share of the frame's height
const LC_WIN_HK: float = 1.07           # the drawn figure's height over HEIGHT (the models stand under the 2.3 m capsule)
const LC_WIN_AIM: float = 0.8           # the victory view's height, as a share of the body
const LC_WIN_PITCH: float = 8.0         # positive: the camera looks down at the winner
const LC_WIN_ONE: bool = true           # the street victory on the place victory's single full-atlas split and near plane
## fid29-lightcam fix round: at a real place the victory shot is looser and looks up a little (the place's flat facades
## filled the long lens's frame behind the winner, with no sky, and the arms of a wide pose cropped at its edges).
## 0.56 of the height on a 48 deg lens keeps 0.65-on-42's camera distance and fits Kofi's arms-up pose inside the
## portrait frame's width (0.65 cut both hands); the near plane comes in to LC_NEAR_K_PLACE_WIN of the distance there,
## or the wider lens's bottom edge showed the clipped ground's background as a flat band (trials fix/t5..t9). The sun
## stays one split there (see _lightcam_update) so the face texel holds under 5 mm on the wider lens.
const LC_WIN_SHARE_PLACE: float = 0.56
const LC_WIN_FOV_PLACE: float = 48.0
const LC_NEAR_K_PLACE_WIN: float = 0.35
const LC_WIN_PITCH_PLACE: float = -6.0   # negative: the camera looks up at the winner
const LC_WIN_AIM_PLACE: float = 0.55
const LC_PITCH: float = 20.0            # the mid-fight orbit (build 28: 28)
const LC_PIVOT_H: float = 1.15          # the orbit's pivot (build 28's; trials 0.9 to 1.3, tools/look/frame_probe.gd)
const LC_H_OFF: float = 0.5             # the camera right of its orbit point: the hero sits left, over the shoulder
const LC_V_OFF: float = 0.9             # the camera above its orbit point (m, in the view's up): the fight drops under the top block
const LC_BOTTOM: float = 1.05           # the close fit's bottom margin (build 28's CLOSE_MARGIN.z = 0.8): the feet may sit at
										# the bottom edge, under the controls (frame_probe.gd trials, lightcam.md)
const LC_CLOSE_DIST: float = 5.15       # the nearest close distance (build 28: CLOSE_DIST 5.4); 5.0 put a nameplate on a face
const LC_NEAR: float = 0.5              # the fight camera's near plane (build 28's)
const LC_NEAR_K: float = 0.5            # close shots: the near plane moves out to this share of the camera-to-hero distance,
										# so the first shadow split's slice (near to just past the face) is short and its texel small
var _lc: bool = false
var _lc_close: float = 0.0
var _lc_mats: Dictionary = {}           # ShaderMaterial -> [kick_a_col at fight distance, recv_shadow at fight distance]
var _lc_expo: float = -1.0
var _lc_blur: float = -1.0
var _lc_clock: float = 0.0
var _lc_fov: float = -1.0
var _lc_win_basis: Basis = Basis.IDENTITY
var _lc_win_basis_place: Basis = Basis.IDENTITY
var _lc_said: Dictionary = {}
var _lc_cap: Dictionary = {}            # the per-place capture's state
var _lc_warm_n: int = 0                 # 2 after ShaderWarm's draw: one frame with two shadow splits, then one with one


func _lc_pivot_h() -> float:
	if _lc and not _landscape:
		return float((arena.get("look") as Dictionary).get("lc_pivot", LC_PIVOT_H))
	return CLOSE_PIVOT_H


func _lc_voff() -> float:
	return float((arena.get("look") as Dictionary).get("lc_voff", LC_V_OFF)) if arena != null else LC_V_OFF


func _lc_hoff() -> float:
	return float((arena.get("look") as Dictionary).get("lc_hoff", LC_H_OFF)) if arena != null else LC_H_OFF


## 0 -> 1, critically damped from t = 0 (no overshoot), at LC_PUSH_W.
func _lc_push(t: float) -> float:
	if t <= 0.0:
		return 0.0
	return 1.0 - (1.0 + LC_PUSH_W * t) * exp(-LC_PUSH_W * t)


static func _lc_hash(i: int) -> float:
	var x: int = (i * 73856093) ^ 0x5bd1e995
	x = ((x >> 13) ^ x) * 1274126177
	x = (x >> 16) ^ x
	return float(x & 0xffff) / 32767.5 - 1.0


## Smooth value noise from integer hashes of the frame clock (no RNG): -1..1.
func _lc_noise(t: float, seed_off: int) -> float:
	var i: int = int(floor(t))
	var f: float = t - float(i)
	f = f * f * (3.0 - 2.0 * f)
	return lerpf(_lc_hash(i * 2 + seed_off * 7919), _lc_hash((i + 1) * 2 + seed_off * 7919), f)


## high: the close shots drift by LC_HANDHELD_DEG, as a held camera (mid: none).
func _lc_handheld(b: Basis) -> Basis:
	if ArenaScript.tier_of(cfg) != "high" or _reduce_motion:
		return b
	var t: float = _lc_clock * 0.9
	var yaw: float = deg_to_rad(LC_HANDHELD_DEG) * _lc_noise(t, 1)
	var pit: float = deg_to_rad(LC_HANDHELD_DEG) * _lc_noise(t * 1.3 + 17.0, 2)
	return (b * Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, pit)).orthonormalized()


func _lightcam_update(dt: float) -> void:
	if not _lc or cam == null or arena == null:
		return
	_lc_clock += dt
	var close: float = 0.0
	if _beat_t >= 0.0:
		close = 1.0 - smoothstep(BEAT_LEN - BEAT_OUT, BEAT_LEN, _beat_t)
	elif state == "ending" and outcome == "win" and _close:
		close = ease(_win_k, -2.0)
	if bool(cfg.get("face_close", false)):
		close = 1.0
	var was: float = _lc_close
	_lc_close = move_toward(_lc_close, close, dt / LC_SHADOW_S)
	var c: float = _lc_close
	# fid29-lightcam fix round: two splits only in the close shots. At fight distance (c = 0) the sun is build 28's
	# single orthogonal split: with two blended splits the three fighters sat across the boundary and were drawn into
	# both (+17 to +19 draws, +49k to +101k primitives over the tier budget). The first frame after ShaderWarm's
	# draw is drawn with two splits and the next with one (its quads live for both), so both shader variants compile
	# under the loading card, not at the intro beat (the close weight is still under 0.1 there).
	# The victory (at a real place, and on the street with LC_WIN_ONE) keeps the single split too, fitted to [near, hero + 3 m] on the whole atlas: its
	# 48 deg lens (LC_WIN_FOV_PLACE) put the face texel of the first of two half-atlas splits at 5.7 mm (limit 5).
	var place_win: bool = state == "ending" and (arena.get("place") != null or bool((arena.get("look") as Dictionary).get("lc_win_one", LC_WIN_ONE)))
	var sun0: DirectionalLight3D = arena.get("sun")
	if sun0 != null and sun0.shadow_enabled:
		var two: bool = c > 0.0 and not place_win
		if _lc_warm_n > 0:
			two = _lc_warm_n == 2
			_lc_warm_n -= 1
		var want: int = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS if two else DirectionalLight3D.SHADOW_ORTHOGONAL
		if sun0.directional_shadow_mode != want:
			sun0.directional_shadow_mode = want
			if not _lc_said.has("mode%d" % want):
				_lc_said["mode%d" % want] = true
				_log("lightcam shadow mode=%s state=%s close=%.2f" % ["pssm2" if two else "ortho", state, c])
	if c == was and c == 0.0 and not _lc_mats.is_empty():
		return
	var lk: Dictionary = arena.get("look")
	# the sun's shadow, tightened round the hero in the close shots
	var sun: DirectionalLight3D = arena.get("sun")
	if sun != null and sun.shadow_enabled and hero != null:
		var dh: float = cam.global_position.distance_to(hero.global_position + Vector3.UP * FighterScript.HEIGHT * hero.size_k * 0.8)
		var far_c: float = dh + 3.0
		sun.directional_shadow_max_distance = lerpf(35.0, far_c, c)
		var nk: float = float(lk.get("lc_near_k", LC_NEAR_K))
		if place_win:
			nk = float(lk.get("lc_near_k_place_win", LC_NEAR_K_PLACE_WIN))
		cam.near = lerpf(LC_NEAR, maxf(LC_NEAR, dh * nk), c)
		# the filter's blur narrows too (high 3.0, mid 2.0 at fight distance): a wide penumbra washed out the nose's
		# and the chin's shadows, a few millimetres across at this texel
		if _lc_blur < 0.0:
			_lc_blur = sun.shadow_blur
		sun.shadow_blur = lerpf(_lc_blur, minf(_lc_blur, float(lk.get("lc_close_blur", LC_CLOSE_BLUR))), c)
		# Godot splits [near, max]: the first split ends just past the face
		var nr: float = cam.near
		sun.directional_shadow_split_1 = lerpf(LC_SPLIT, clampf((dh + 0.6 - nr) / maxf(far_c - nr, 0.01), 0.1, 0.9), c)
		sun.shadow_bias = lerpf(LC_BIAS.x, LC_BIAS.y, c)
		sun.shadow_normal_bias = lerpf(LC_NBIAS.x, LC_NBIAS.y, c)
		if c > 0.99 and not _lc_said.has("texel%d" % int(state == "ending")):
			_lc_said["texel%d" % int(state == "ending")] = true
			_log("lightcam close shadow shot=%s dist_m=%.2f max_m=%.2f split1=%.2f texel_mm=%.2f near=%.2f fov=%.1f" % ["win" if state == "ending" else "intro",
				dh, far_c, sun.directional_shadow_split_1, _lc_texel_mm(dh, nr, far_c if place_win else nr + (far_c - nr) * sun.directional_shadow_split_1, place_win), cam.near, cam.fov])
	# the fighters: the shadow map on them, the kicker as a rim
	for f: FighterScript in fighters:
		for m: ShaderMaterial in f.get("_lit_mats"):
			if not _lc_mats.has(m):
				_lc_mats[m] = [m.get_shader_parameter("kick_a_col"), m.get_shader_parameter("recv_shadow")]
			var base: Array = _lc_mats[m]
			var kc: Variant = base[0]
			if kc is Vector3:
				m.set_shader_parameter("kick_a_col", (kc as Vector3) * lerpf(1.0, float(lk.get("lc_rim", LC_RIM)), c))
			m.set_shader_parameter("recv_shadow", maxf(float(base[1]) if base[1] != null else 1.0, c))
	# the exposure of the close shots
	var env: Environment = arena.get("env")
	if env != null:
		if _lc_expo < 0.0:
			_lc_expo = env.tonemap_exposure
		env.tonemap_exposure = _lc_expo * pow(2.0, float(lk.get("lc_ev", LC_EV)) * c)


## The shadow map's texel at distance `d` from the camera (mm): the first split covers [near, split_far]; the split's
## view slice is fitted into a sphere, and with two splits each gets half the atlas's width.
func _lc_texel_mm(d: float, near: float, split_far: float, one: bool = false) -> float:
	var far_s: float = split_far
	var nr: float = near
	if d > split_far:
		nr = split_far
		far_s = float((arena.get("sun") as DirectionalLight3D).directional_shadow_max_distance)
	var vs: Vector2 = get_viewport().get_visible_rect().size
	var tv: float = tan(deg_to_rad(cam.fov) * 0.5)
	var th: float = tv * vs.x / maxf(vs.y, 1.0)
	var mid: float = (nr + far_s) * 0.5
	var r: float = Vector3(far_s * th, far_s * tv, far_s - mid).length()
	var atlas: int = int(ProjectSettings.get_setting("rendering/lights_and_shadows/directional_shadow/size", 2048))
	return 2.0 * r / (atlas * (1.0 if one else 0.5)) * 1000.0   # one split: the whole atlas; two: half each


## The depth-aware focus (mid and high, close shots only): a full-screen pass over the screen copy, its circle of
## confusion from the depth buffer (one read, linearised), 0 at the focus (the hero's chest) rising over 3 m behind
## it; the same 13 taps as build 28's plate. On Compatibility the depth read forces a depth copy: only while a close
## shot shows (it is hidden otherwise).
const LC_DOF_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled, fog_disabled, depth_draw_never, depth_test_disabled;
uniform sampler2D screen : hint_screen_texture, filter_linear, repeat_disable;
uniform sampler2D depth : hint_depth_texture, filter_nearest, repeat_disable;
uniform float amount = 0.0;
uniform float focus = 3.0;
uniform float ramp = 3.0;
uniform float radius = 8.0;
void vertex() {
	POSITION = vec4(VERTEX.xy * 2.0, 0.0, 1.0);
}
void fragment() {
	float d = texture(depth, SCREEN_UV).r;
	vec3 ndc = vec3(SCREEN_UV, d) * 2.0 - 1.0;
	vec4 v = INV_PROJECTION_MATRIX * vec4(ndc, 1.0);
	float z = -v.z / v.w;
	float coc = smoothstep(0.0, ramp, z - focus) * amount;
	vec2 px = coc / VIEWPORT_SIZE;
	vec3 c = texture(screen, SCREEN_UV).rgb * 0.16;
	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.0472;
		vec2 dd = vec2(cos(a), sin(a));
		c += texture(screen, SCREEN_UV + dd * px * radius * 0.44).rgb * 0.08;
		c += texture(screen, SCREEN_UV + vec2(dd.y, -dd.x) * px * radius).rgb * 0.06;
	}
	ALBEDO = c;
	ALPHA = clamp(coc * 4.0, 0.0, 1.0);
}
"""
static var _lc_dof_shader: Shader


func _lc_dof_mat() -> ShaderMaterial:
	if _lc_dof_shader == null:
		_lc_dof_shader = Shader.new()
		_lc_dof_shader.code = LC_DOF_SHADER
	var sm := ShaderMaterial.new()
	sm.shader = _lc_dof_shader
	return sm


## A real place's reflections (audit L2): under the loading card, a small cube (look_real.gd capture_place; mid 32 px,
## high 64 px) at the fight's centre, then every fighter reflects the place instead of the default street. Falls back to
## the baked cube when the capture runs over its budget. True while the capture is still running.
func _lc_capture_pending() -> bool:
	if not _lc or arena == null or arena.get("place") == null or _headless or bool(_lc_cap.get("done", false)):
		return false
	var lk: Dictionary = arena.get("look")
	if not bool(lk.get("lc_capture", true)):
		_lc_cap["done"] = true
		return false
	if not _lc_cap.has("job"):
		var sz: int = 64 if ArenaScript.tier_of(cfg) == "high" else 32
		_lc_cap["t0"] = Time.get_ticks_usec()
		_lc_cap["job"] = LookReal.capture_begin(self, Vector3(0.0, 1.2, 0.0), sz, arena.get("env"))
		return true
	var job: Dictionary = _lc_cap["job"]
	var e: Dictionary = LookReal.capture_step(job)
	var ms: float = (Time.get_ticks_usec() - int(_lc_cap["t0"])) / 1000.0
	if e.is_empty() and ms < LookReal.CAPTURE_BUDGET_MS:
		return true
	_lc_cap["done"] = true
	LookReal.capture_end(job)
	if e.is_empty():
		_log("lightcam place capture fallback ms=%.1f (baked cube kept)" % ms)
		return false
	for f: FighterScript in fighters:
		for m: ShaderMaterial in f.get("_lit_mats"):
			if m.get_shader_parameter("env_spec") != null:
				m.set_shader_parameter("env_cube", e["cube"])
				m.set_shader_parameter("env_scale", e["scale"])
				m.set_shader_parameter("env_lods", e["lods"])
				m.set_shader_parameter("amb_cube", e["amb"])
	_log("lightcam place capture size=%d ms=%.1f cube_mean=%s street_mean=%s" % [int(job["size"]), ms, str(e.get("mean")),
		str(LookReal.env_mean(str(lk.get("time", "golden"))))])
	return false


## env-fixes 4: in a real place (the arena built one), the place's camera unless the config sets its
## own (cam_* review overrides keep working as before). The street keeps its camera exactly.
func _place_camera() -> void:
	if arena == null or arena.get("place") == null or not bool(cfg.get("place_cam", true)):
		return
	var pitch: float = float(cfg.get("cam_pitch", CAM_PLACE_PITCH))
	var tilt: float = float(cfg.get("cam_tilt", 0.0 if cfg.has("cam_pitch") else CAM_PLACE_TILT))
	var yaw: float = deg_to_rad(float(cfg.get("cam_yaw", CAM_YAW)))
	_cam_dist = float(cfg.get("cam_dist", CAM_PLACE_DIST))
	_cam_ahead = float(cfg.get("cam_ahead", LAND_AHEAD if _landscape else CAM_PLACE_AHEAD))
	_cam_basis = Basis.from_euler(Vector3(deg_to_rad(-pitch), yaw, 0.0))
	_view_basis = Basis.from_euler(Vector3(deg_to_rad(-(pitch - tilt)), yaw, 0.0))
	_cam_fwd = Vector3(-_cam_basis.z.x, 0.0, -_cam_basis.z.z).normalized()
	_cam_right = Vector3(_cam_basis.x.x, 0.0, _cam_basis.x.z).normalized()
	if not cfg.has("cam_fov") and not cfg.has("cam_pitch"):
		cfg["cam_fov"] = CAM_PLACE_FOV
	_log("place camera pitch=%.1f tilt=%.1f dist=%.1f ahead=%.1f fov=%.0f" % [pitch, tilt, _cam_dist, _cam_ahead, float(cfg.get("cam_fov", CAM_FOV))])


func _build_camera() -> void:
	cam = Camera3D.new()
	cam.name = "Camera"
	cam.fov = float(cfg.get("cam_fov", CAM_FOV))
	if _landscape and not cfg.has("cam_fov_fixed"):
		cam.fov *= LAND_FOV_K
	_base_fov = cam.fov
	cam.near = 0.5
	cam.far = CAM_FAR
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


func _spawn(n: String, team: int, hp_max: int, c: Color, at: Vector3, yaw: float, r: String, size_mult: float = 1.0) -> FighterScript:
	var f := FighterScript.new()
	f.size_mult = size_mult
	f.name = n.validate_node_name()
	add_child(f)
	# cq 015: the fighters' rim light follows the arena's key light (docs/game3d/LOOK.md)
	f.rim_on = bool((arena.get("look") as Dictionary).get("rim", true)) if arena != null else true
	# build 20 pass 2: the per-foot contact shadows (look "feet": false turns them off to measure them)
	f.foot_shadows = bool((arena.get("look") as Dictionary).get("feet", true)) if arena != null else true
	f.foot_plant = bool((arena.get("look") as Dictionary).get("plant", true)) if arena != null else true
	f.key_dir = ArenaScript.key_dir()
	f.look = arena.get("look") if arena != null else {}
	f.sun_blob = bool((arena.get("look") as Dictionary).get("ao", true)) if arena != null else true
	# realism: with the real look and a real shadow map, the sun's shadow is the map's; the blob keeps only
	# its contact disc (two shadows of one fighter read as a mistake)
	if arena != null and bool(f.look.get("real", false)) and str(f.look.get("shadows", false)) == "true":
		f.sun_blob = false
	f.setup(n, team, hp_max, c, r)
	f.position = at
	f.yaw = yaw
	f.rotation.y = yaw
	fighters.append(f)
	return f


# ------------------------------------------------------------ loading

## day1-world: the place builds on a worker while the fighters load (arena.pump_place, place.gd begin);
## the fly-in and the fight wait for it in "loading", so nothing starts in a half-built place.
## The fight never waits a frame for it: when the fighters are in, whatever is left (normally nothing; the
## worker is long done while the fighters load) is finished in that frame (arena.finish_place), so the
## fight starts on the same frame as with a synchronous build and seeded fights stay byte-identical.
func _begin_when_built() -> void:
	if arena != null:
		arena.call("finish_place")
	ShaderWarm.warm(self if _lc else null)
	if _lc:
		_lc_warm_n = 2
	_begin_when_shown()


func _poll_loading() -> void:
	if _view_wait:
		_tick_view_gate()
		return
	if _start_delay > 0:
		# tests only (config "start_delay": frames): the fight starts this many frames later, so a record can
		# be compared with and without the hero's intro shot from the same late start
		_start_delay -= 1
		if _start_delay == 0:
			_begin_or_intro()
		return
	if arena != null:
		arena.call("pump_place")
	if _thread != null:
		if _thread.is_alive():
			return
		var r: Dictionary = _thread.wait_to_finish()
		_thread = null
		_finish_load(r)
	if _load_queue.is_empty():
		if arena != null:
			arena.call("finish_place")
		if _lc_capture_pending():
			return    # fid29-lightcam: the place's reflections are being captured under the loading card (two frames)
		load_ms = (Time.get_ticks_usec() - _load_t0) / 1000.0
		_log("load_total ms=%.1f threaded=%s" % [load_ms, _load_threaded])
		hud.loading_text = ""
		for f: FighterScript in fighters:
			f.visible = true
		ShaderWarm.warm(self if _lc else null)    # fid29: every material of the fight drawn once before the first shot (lightcam look)
		if _lc:
			_lc_warm_n = 2
		_begin_when_shown()
		return
	_loading_role = _load_queue.pop_front()
	var path: String = _loading_role["path"]
	# realism: a character for the real look loads with tangents and its skin mask (char_loader.gd)
	var real: bool = arena != null and bool((arena.get("look") as Dictionary).get("real", false)) and not _loading_role.has("weapon")
	if _load_threaded:
		_thread = Thread.new()
		if _thread.start(_loader.load_glb.bind(path, real)) != OK:
			_thread = null
			_finish_load(_loader.load_glb(path, real))
	else:
		_finish_load(_loader.load_glb(path, real))   # one model per frame on the main thread


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
				if _hero_roles.has(str(pair[1])):
					key = str(_hero_roles[str(pair[1])])     # a faction hero holds it, with its own grip
				var ch: Dictionary = (_attach_manifest().get("characters", {}) as Dictionary).get(key, {})
				att = (ch.get("grips", {}) as Dictionary).get(cls, {})
				if att.is_empty():
					# realism: a character with a clip library but no hand-fitted grip (the heroes, a
					# run-time sidecar) holds the weapon by its clip grip
					att = (ch.get("clip_grips", {}) as Dictionary).get(cls, {})
				if att.is_empty():
					att = (AnimLib.sidecar_grips.get(key, {}) as Dictionary).get(cls, {})
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
				if cg.is_empty():
					cg = AnimLib.sidecar_grips.get(f.anim.lib_key, {})   # a library registered at run time
				if cg.has(str(_loading_role["class"])):
					_loading_role["att"] = cg[str(_loading_role["class"])]
			var why: String = f.hold_weapon(r["node"] as Node3D, _loading_role["att"], str(_loading_role["weapon"]), str(_loading_role["class"]))
			_log("weapon role=%s class=%s bone=%s ok=%s %s parse_ms=%.1f path=%s" % [role, str(_loading_role["class"]), str(_loading_role["att"].get("bone", "")), str(why == ""), why, float(r["parse_ms"]), str(r["path"])])
		else:
			_log("weapon role=%s ok=false error=%s path=%s" % [role, str(r.get("error", "?")), str(r.get("path", ""))])
		return
	if bool(r.get("ok", false)):
		f.skin_mask = r.get("skin_mask")
		f.hair_mask = r.get("hair_mask")
		f.surface_kinds = r.get("surface_kinds", {})
		var info: Dictionary = f.set_model(r["node"] as Node3D)
		_log("load role=%s ok=true parse_ms=%.1f gen_ms=%.1f add_ms=%.1f scale=%.3f raw_h=%.3f library=%s anims=%d mapped=%s bones=%d hand=%s path=%s" % [
			role, float(r["parse_ms"]), float(r["gen_ms"]), (Time.get_ticks_usec() - t_add) / 1000.0,
			float(info["scale"]), float(info["height_raw"]), str(info.get("library", "")), (info["anims"] as PackedStringArray).size(), JSON.stringify(info["mapped"]),
			int(info["bones"]), str(info["hand"]), str(r["path"])])
	else:
		var stand_in: String = "" if str(r.get("path", "")).begins_with(CAST_STAND_IN_DIR) else _cast_stand_in(f, role)
		if stand_in != "":
			# build 20: a Forge model that fails to load is replaced by a shipped cast character,
			# next in the queue (before the weapons, which attach to it)
			_load_queue.push_front({"f": f, "path": stand_in, "role": role})
			_log("load role=%s ok=false error=%s path=%s (cast stand-in %s)" % [role, str(r.get("error", "?")), str(r.get("path", "")), stand_in])
			return
		f.set_capsule()
		_log("load role=%s ok=false error=%s path=%s (capsule fallback)" % [role, str(r.get("error", "?")), str(r.get("path", ""))])


## realism: on the high tier (look "hero_lod": 0) the hero and the Guardian load the model's most detailed
## file when it sits beside the one the app sent (".../lod1.glb" -> ".../lod0.glb", "x_lod1.glb" ->
## "x_lod0.glb"); the ally keeps what was sent. Without the key, or without the file, the path is unchanged.
func _tier_lod(p: String, role: String) -> String:
	var lk: Dictionary = arena.get("look") if arena != null else {}
	if p == "" or (role != "hero" and role != "enemy") or not lk.has("hero_lod"):
		return p
	var want: String = "lod%d.glb" % clampi(int(lk["hero_lod"]), 0, 2)
	for have: String in ["lod0.glb", "lod1.glb", "lod2.glb"]:
		if p.ends_with(have) and have != want:
			var q: String = p.substr(0, p.length() - have.length()) + want
			if FileAccess.file_exists(q):
				_log("tier lod role=%s %s -> %s" % [role, have, want])
				return q
	return p


## realism (12 Nov 2026): the faction heroes as the playable cast. Build 26 (the hybrid heroes):
## ON by default again on the mid and high tiers, off on the low tier (builds 22 to 25 had it off
## everywhere); the config's "hero_cast" true or false overrides the tier. With it on, a role whose
## model is one of the cartoon built-in cast, or that has no model at all, plays a faction hero
## from res://cast/heroes instead:
## the player's hero is its faction's (config "faction", the app's faction id), the ally and the
## Guardian are drawn from the other factions' heroes by the fight's seed. A player's own Forge
## character (any other model) is left alone. Presentation only: the rules read no model.
const HERO_DIR: String = "res://cast/heroes/"
const HERO_BY_FACTION: Dictionary = {"ascendants": "ascendants_zuri", "controllers": "controllers_tavo", "icons": "icons_imani",
	"everborns": "everborn_oren", "celestials": "celestials_lyra", "blockbusters": "blockbusters_kofi"}
const HERO_ORDER: Array[String] = ["ascendants_zuri", "controllers_tavo", "icons_imani", "everborn_oren", "celestials_lyra", "blockbusters_kofi"]
const CARTOON_CAST: Array[String] = ["armstrong", "bobo", "catboy", "crystalz", "elvis", "hoof", "nebulx", "vanessa"]
## build 29 (Subomi, 18 Nov): the Forge characters a player can choose to be, beside the six faction heroes. Their
## files sit in res://cast/heroes like the heroes' (tools/forge_chars/chars.json says where each comes from) with
## their own clip library (anim/<key>.glb, tools/anim/add_hero.sh). Only a character whose rig passed the clip
## gate is listed. They never stand in as an ally or a Guardian: only the player who picked one plays it.
const FORGE_CAST: Array[String] = ["forge_courier"]
var _hero_roles: Dictionary = {}     # role -> hero key, for the roles a faction hero plays


## The character the player chose in the app (config "hero_pick": a faction hero's or a Forge character's key), when
## this build ships its files; "" otherwise (no pick, an unknown key, or a key from a newer app than this pck).
func _hero_pick(lod: int) -> String:
	var k: String = str(cfg.get("hero_pick", ""))
	if k == "" or not (k in HERO_ORDER or k in FORGE_CAST):
		return ""
	if FileAccess.file_exists("%s%s_lod%d.glb" % [HERO_DIR, k, lod]) or FileAccess.file_exists("%s%s_lod1.glb" % [HERO_DIR, k]):
		return k
	return ""


func _hero_cast(role: String, p: String) -> String:
	if not bool(cfg.get("hero_cast", ArenaScript.tier_of(cfg) != "low")):
		return ""
	var key_now: String = str(cfg.get(role + "_key", ""))
	# build 29: a character the player picked plays the hero even over a Forge download (the pick is the newer choice)
	var picked: String = _hero_pick(clampi(int(cfg.get("lod", 1)), 0, 2)) if role == "hero" else ""
	if picked == "" and p != "" and not p.begins_with(CAST_STAND_IN_DIR) and not (key_now in CARTOON_CAST):
		return ""     # the player's own character
	var lod: int = clampi(int(cfg.get("lod", 1)), 0, 2)
	var lk: Dictionary = ArenaScript.TIER_LOOK[ArenaScript.tier_of(cfg)]
	if (role == "hero" or role == "enemy") and lk.has("hero_lod") and not cfg.has("lod"):
		lod = clampi(int(lk["hero_lod"]), 0, 2)
	var have: Array[String] = []
	for k: String in HERO_ORDER:
		if FileAccess.file_exists("%s%s_lod%d.glb" % [HERO_DIR, k, lod]) or FileAccess.file_exists("%s%s_lod1.glb" % [HERO_DIR, k]):
			have.append(k)
	if have.is_empty():
		return ""
	var mine: String = str(HERO_BY_FACTION.get(str(cfg.get("faction", "")), ""))
	if not (mine in have):
		mine = have[int(absf(float(cfg.get("seed", 0)))) % have.size()]
	var chosen: String = _hero_pick(lod)
	if chosen != "":
		mine = chosen     # the ally and the Guardian are then never the player's pick
	var pick: String = mine
	if role != "hero":
		var others: Array[String] = []
		for k: String in have:
			if k != mine:
				others.append(k)
		if others.is_empty():
			return ""
		var s: int = int(absf(float(cfg.get("seed", 0))))
		var ally_i: int = s % others.size()
		pick = others[ally_i] if role == "ally" else others[(ally_i + 1 + (s / 7) % maxi(1, others.size() - 1)) % others.size()]
	var path: String = "%s%s_lod%d.glb" % [HERO_DIR, pick, lod]
	if not FileAccess.file_exists(path):
		path = "%s%s_lod1.glb" % [HERO_DIR, pick]
	cfg[role + "_key"] = pick
	_hero_roles[role] = pick
	_log("hero cast role=%s key=%s lod=%d faction=%s pick=%s" % [role, pick, lod, str(cfg.get("faction", "")), chosen])
	return path


## build 20: a fighter with no model of its own (no Forge catalogue on this server, offline, a
## download that failed or was slow) used to stand as a coloured capsule. It now plays one of the
## eight rigged cast characters the pck ships (res://cast, with its clip library res://anim):
## the hero and the ally the first of two, the Guardian one of four by the fight's seed, never a
## character another fighter already wears. Presentation only: the rules never read the model
## (seeded fights with capsules and with stand-ins give the same record). "cast_stand_in": false
## in the config keeps the capsules. Returns the path to load, or "" for the capsule.
const CAST_STAND_IN_DIR: String = "res://cast/"
const CAST_STAND_IN: Dictionary = {"hero": ["armstrong", "vanessa"], "ally": ["bobo", "catboy"], "enemy": ["hoof", "elvis", "nebulx", "crystalz"]}
var _cast_worn: Dictionary = {}   # role -> the cast key a Forge download turned out to be (rig_fix)


func _cast_stand_in(f: FighterScript, role: String) -> String:
	if not bool(cfg.get("cast_stand_in", true)) or not CAST_STAND_IN.has(role):
		return ""
	var taken: Array[String] = []
	for r: String in ["hero", "ally", "enemy"]:
		if r != role:
			taken.append(str(cfg.get(r + "_key", "")))
			taken.append(str(_cast_worn.get(r, "")))
	var pool: Array = CAST_STAND_IN[role]
	var lod: int = clampi(int(cfg.get("lod", 1)), 0, 2)
	if (role == "hero" or role == "enemy") and arena != null and (arena.get("look") as Dictionary).has("hero_lod") and not cfg.has("lod"):
		lod = clampi(int((arena.get("look") as Dictionary)["hero_lod"]), 0, 2)   # realism: the high tier's hero and Guardian
	var start: int = (int(absf(float(cfg.get("seed", 0)))) % pool.size()) if role == "enemy" else 0
	for i in range(pool.size()):
		var key: String = str(pool[(start + i) % pool.size()])
		var path: String = "%s%s_lod%d.glb" % [CAST_STAND_IN_DIR, key, lod]
		if key in taken or not FileAccess.file_exists(path):
			continue
		cfg[role + "_key"] = key            # the weapon grips (attach.json) read it too
		f.anim_opts["key"] = key
		return path
	return ""


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


## cq 019: at a real place (arena "place"), a short fly-in from the landmark down to the fight camera
## before the clock starts, so the place reads; the fight itself starts after it exactly as before.
## Config intro: false skips it. The app sees "fighting" from its first frame (bridge.gd).
const INTRO_LEN: float = 3.4
var _intro_t: float = -1.0
var _intro_from: Transform3D


## build 20 pass 2: the first frames on a phone. The app's loading card went as soon as Godot said
## the fight was on, but the iOS view then showed ~15 s of its blank navy (the first frames, shaders
## compiling) and a frame drawn at a third of the size in a corner before it filled the screen; on the
## street the fight's clock was already running under it. With the app's screen size in the config
## ("view_px": [w, h] in pixels) the fight now stays in "loading" (the card stays up) until the window
## is that size and VIEW_GATE_FRAMES frames have been drawn at it, at most VIEW_GATE_MAX_S. Without
## "view_px" (tests, captures, older apps) nothing waits.
const VIEW_GATE_FRAMES: int = 4
const VIEW_GATE_MAX_S: float = 8.0
const VIEW_GATE_TOL: float = 0.12
var _view_wait: bool = false
var _view_t0: int = 0
var _view_frames0: int = -1


var _start_delay: int = 0


func _begin_when_shown() -> void:
	if int(cfg.get("start_delay", 0)) > 0 and _start_delay == 0:
		_start_delay = int(cfg["start_delay"])
		state = "loading"
		return
	var want: Variant = cfg.get("view_px", null)
	if not (want is Array) or (want as Array).size() < 2 or float(want[0]) < 1.0 or float(want[1]) < 1.0:
		_begin_or_intro()
		return
	_view_wait = true
	state = "loading"
	_view_t0 = Time.get_ticks_msec()
	_view_frames0 = -1
	_tick_view_gate()


## True when a window of `have` pixels is the app's view of `want` pixels (either way round).
static func view_size_ok(have: Vector2, want: Vector2) -> bool:
	if want.x < 1.0 or want.y < 1.0:
		return true
	return absf(have.x / want.x - 1.0) <= VIEW_GATE_TOL and absf(have.y / want.y - 1.0) <= VIEW_GATE_TOL


func _tick_view_gate() -> void:
	var want: Array = cfg["view_px"]
	var have: Vector2 = Vector2(get_window().size) if is_inside_tree() else Vector2.ZERO
	var waited: float = (Time.get_ticks_msec() - _view_t0) / 1000.0
	if view_size_ok(have, Vector2(float(want[0]), float(want[1]))):
		if _view_frames0 < 0:
			_view_frames0 = Engine.get_frames_drawn()
		if Engine.get_frames_drawn() - _view_frames0 < VIEW_GATE_FRAMES and waited < VIEW_GATE_MAX_S:
			return
	else:
		_view_frames0 = -1
		if waited < VIEW_GATE_MAX_S:
			return
	_view_wait = false
	_log("view shown size=%dx%d want=%dx%d waited_ms=%d frames=%d" % [int(have.x), int(have.y), int(want[0]), int(want[1]),
		int(waited * 1000.0), (Engine.get_frames_drawn() - _view_frames0) if _view_frames0 >= 0 else 0])
	_begin_or_intro()


func _begin_or_intro() -> void:
	if mode == "full":
		sfx.start_music()   # look-fight: the combat loop fades in under the intro
	var pl: Node3D = arena.get("place") if arena != null else null
	if pl == null or not bool(cfg.get("intro", true)):
		_after_intro()
		return
	var info: Dictionary = pl.get("info")
	var lm: Vector3 = info.get("landmark_at", Vector3(0, 0, -30))
	var h: float = float(info.get("landmark_h", 12.0))
	# from behind the fight, low, looking up at the landmark over the fighters' heads
	var back: Vector3 = Vector3(_cam_basis.z.x, 0.0, _cam_basis.z.z).normalized()
	var from: Vector3 = back * 36.0 + Vector3.UP * 9.0
	# day1-world: a tall hero landmark (Elizabeth Tower, Hoover Tower) is framed higher, so its clock or
	# its dome reads in the opening shot
	var look: Vector3 = lm + Vector3.UP * (minf(h * 0.45, 24.0) if str(info.get("landmark_kind", "")) != "hero" else minf(h * 0.55, 52.0))
	_intro_from = Transform3D(Basis.looking_at(look - from, Vector3.UP), from)
	_intro_t = 0.0
	state = "intro"
	var title: String = str(_guardian_look().get("title", ""))
	var sub: String = str(info.get("landmark", ""))
	if title != "":
		sub = title if sub == "" else "%s · %s" % [title, sub]
	# build 25: the Warden's intro line (setup.warden.intro, server-decided) under the place's name, when sent
	if str(cfg.get("warden_intro", "")) != "":
		sub = str(cfg.get("warden_intro", ""))
	hud.banner(str(cfg.get("point_name", "")).to_upper(), sub, Color(1.0, 0.86, 0.5), INTRO_LEN - 0.4)
	_log("intro landmark=%s" % str(info.get("landmark", "")))


func _tick_intro(dt: float) -> void:
	if _beat_t >= 0.0:
		_beat_t += dt
		if _beat_t >= BEAT_LEN - BEAT_TURN:
			_beat_restore()
		if _beat_t >= BEAT_LEN:
			_beat_t = -1.0
			hud.visible = not bool(cfg.get("prof_no_hud", false))
			_begin_fight()
		return
	_intro_t += dt
	if _intro_t >= INTRO_LEN:
		_intro_t = -1.0
		_after_intro()


func _intro_camera() -> void:
	if _intro_t < 0.0:
		return
	var k: float = smoothstep(0.25, 1.0, _intro_t / INTRO_LEN)
	var to: Transform3D = cam.global_transform
	cam.global_transform = Transform3D(_intro_from.basis.slerp(to.basis.orthonormalized(), k), _intro_from.origin.lerp(to.origin, k))


## Co-op (coop.gd): the connection, and the other hero, drawn but outside the fight's rules (no hurtbox,
## not in `fighters`: the AI, the separation and the hits never see it).
func _start_coop(c: Dictionary) -> void:
	coop = CoopScript.new()
	coop.name = "Coop"
	add_child(coop)
	var pf: FighterScript = _spawn(str(c.get("peer_name", "Hero 2")), 0, HERO_HP, Color(0.9, 0.75, 0.3), Vector3(-2.5, 0, 4.0), PI, "ally")
	fighters.erase(pf)
	pf.hurtbox.collision_layer = 0
	pf.weapon.monitoring = false
	coop.set("peer", pf)
	coop.call("setup", self, c)
	duration = maxf(duration, 300.0)   # the server's clock ends the round
	t_left = duration


## The server ended the shared fight (coop.gd).
func coop_end(outcome: String) -> void:
	if state != "fighting":
		return
	if outcome == "win":
		_coop_won = true
		if enemy != null and not enemy.dead:
			enemy.hp = 0
			enemy.die()
		_end("win")
	elif outcome == "timeout":
		_end("timeout")


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
	if state == "intro" and _beat_t >= 0.0:
		_beat_t = maxf(_beat_t, BEAT_LEN - BEAT_TURN)    # realism round 2: a tap skips the hero's shot
	if hero == null or state != "fighting":
		return
	if five:
		(_jlog["atk"] as Array).append([_jt(), _jl(), 1])
		_atk_down = true
		_atk_down_cs = _jt()
		_hold_used = false
	_attack_buffer = ATK_BUFFER
	_lat_atk = {"t_in": t_in, "ticks_in": ticks_in, "frame_in": Engine.get_process_frames(), "node": null, "src": src}
	# Start the swing on this very frame when the hero is free: the press is drawn next frame.
	if _action == "" and not hero.guarding and not hero.dead:
		_attack_buffer = 0.0
		_swing()


func _on_skill_pressed(slot: int, _t_in: float, _ticks_in: int, src: String) -> void:
	if hero == null or state != "fighting" or hero.dead:
		return
	if five and not FIVE_BUTTONS.has(slot):
		return   # build 28: SPLIT, WHIRL and RALLY have no button (a stray press, e.g. an old capture timeline)
	(_jlog["presses"] as Array).append([_jt(), _jl(), slot])
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
	(_jlog["guards"] as Array).append([_jt(), _jl(), 1 if on else 0])
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
	if autoplay:
		w = _play_right * s.x + _play_fwd * s.y   # the bot's stick is in the street's frame (bot_stick below)
	return w.limit_length(1.0)


# ------------------------------------------------------------ frame

func _process(dt: float) -> void:
	_frame_dt = dt
	# look-fight: the KO beat slows Engine.time_scale (only once the fight is over, so the
	# simulation never sees it); the end beat and the feel timers run on real time
	var real_dt: float = dt / maxf(0.05, Engine.time_scale)
	_ko_dt_real = real_dt
	if state == "fighting" or state == "ending":
		_perf_sample(dt)
	if state == "loading":
		_poll_loading()
	elif state == "fighting":
		_tick_fight(dt)
	elif state == "intro":
		_tick_intro(dt)
	elif state == "ending":
		_end_t += real_dt
		_tick_end_beat()
		if outcome == "win":
			_tick_ally_step(dt)
			if _close and hero != null and not hero.dead:
				# realism round 2: the winner turns to the camera for the closer victory shot (the fight is over)
				hero.face(-_cam_fwd, real_dt, 5.0)
		if _end_t >= _end_delay:
			_emit_result()
	var frozen: bool = _hitstop > 0.0 or feel.vis_stop > 0.0
	if _hitstop > 0.0:
		_hitstop -= dt
	feel.tick(real_dt, state == "fighting")
	if feel.ko_active and state == "ending":
		Engine.time_scale = feel.ko_time_scale(feel.ko_t)
	hud.tint = Color(feel.tint_col.r, feel.tint_col.g, feel.tint_col.b, feel.tint_alpha())
	hud.vignette = feel.vignette_alpha()
	# build 21 (presentation): the whirl's spin ends facing the Guardian (fighter.gd face_yaw: the
	# drawn body only; the hero's yaw is the game's)
	if hero != null:
		hero.face_yaw = NAN
		if state == "fighting" and _action == "skill" and _skill == 2 and enemy != null and not enemy.dead:
			var to_e: Vector3 = _flat(enemy.position - hero.position)
			if to_e.length() > 0.3:
				hero.face_yaw = atan2(to_e.x, to_e.z)
	for f: FighterScript in fighters:
		f.anim_freeze = frozen
		# realism round 2 (presentation): wound up while a living opponent stands within reach
		var rdy: bool = false
		if state == "fighting" and f.weight_fx and _ready_pose and not f.dead:
			for o: FighterScript in fighters:
				if o.team != f.team and not o.dead and _flat(o.position - f.position).length() < READY_RANGE * maxf(f.size_k, o.size_k):
					rdy = true
		f.anim.ready = rdy
		f.tick_visual(dt)
	_skid_dust(dt)
	_follow_camera(dt)
	_intro_camera()
	_beat_camera()
	_dof_update()
	_face_fill_update()
	_lightcam_update(real_dt)
	_sync_hud()
	if _headless and (not _lat_move.is_empty() or not _lat_atk.is_empty()):
		_check_latency.call_deferred("deferred")


func _tick_fight(dt: float) -> void:
	# build 28: ATTACK let go since the last frame (logged on the clock the press was, before this frame moves it)
	if five and _atk_down and not hud.attack_held:
		(_jlog["atk"] as Array).append([_jt(), _jl(), 0])
		_atk_down = false
	fight_time += dt
	t_left = maxf(0.0, duration - fight_time)
	var logic_dt: float = 0.0 if _hitstop > 0.0 else dt
	_logic_time += logic_dt
	if hero != null:
		if autoplay:
			_bot(dt)
		for i in SKILL_N:
			_skill_cd[i] = maxf(0.0, _skill_cd[i] - dt)
		_attack_buffer = maxf(0.0, _attack_buffer - dt)
		_since_swing += logic_dt
		for f: FighterScript in fighters:
			f.tick_logic(logic_dt)
		_tick_hero(logic_dt, dt)
		_tick_enemy(logic_dt)
		_tick_ally(logic_dt)
		_tick_bolts(logic_dt)
		_tick_shots(logic_dt)
		_tick_rains(logic_dt)
		_separate()
		for f: FighterScript in fighters:
			_clamp_arena(f)
	if coop != null:
		# the shared pool (less this phone's hits on their way); the Guardian stands until the server says
		if enemy != null and not _coop_won:
			enemy.hp = maxi(1, int(coop.call("boss_hp_local", enemy.max_hp)))
		if float(coop.get("server_t_left")) >= 0.0:
			t_left = float(coop.get("server_t_left"))
	# outcomes
	if mode == "full":
		if enemy != null and enemy.hp <= 0 and coop == null:
			_end("win")
			return
		if hero != null and hero.hp <= 0:
			_end("lose")
			return
	if t_left <= 0.0 and coop == null:
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
	if five:
		_tick_five()
	# attack input: buffered presses and a held button
	var want_attack: bool = _attack_buffer > 0.0 or _held_chains()
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


## build 28: the two moves that come with no button of their own.
##  SPLIT: ATTACK held HOLD_SPLIT_CS (the round clock, from the latest press), once per hold, when SPLIT is back and
##  the hero can cast (a swing's recovery is cancelled, as a pressed skill does).
##  RALLY: the hero below AUTO_RALLY_BELOW of their HP, RALLY back, the hero free (no swing, guard or dodge).
## WHIRL, the third, is the combo's finisher (_swing).
func _tick_five() -> void:
	if hero.dead:
		return
	var held_cs: int = _jt() - _atk_down_cs
	if _atk_down and not _hold_used and held_cs >= HOLD_SPLIT_CS and _skill_cd[1] <= 0.0 and _can_cast() and not hero.guarding:
		_hold_used = true
		_cast(1, J_HOW_HOLD, held_cs)
		return
	if _skill_cd[3] <= 0.0 and hero.hp * 1000 < hero.max_hp * AUTO_RALLY_BELOW and _action == "" and not hero.guarding \
			and _can_cast():
		_cast(3, J_HOW_AUTO, hero.hp)


## A held ATTACK keeps the combo going. Five-button: the hold belongs to SPLIT, so it chains only while SPLIT
## is cooling down (and not after this hold already cast it).
func _held_chains() -> bool:
	if not hud.attack_held:
		return false
	return not five or (_skill_cd[1] > 0.0 and not _hold_used)


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
	if five:
		# build 28: the combo's finisher is WHIRL whenever it is back (the heavy third cut while it cools down)
		if _combo_i == FINISHER_AFTER + 1 and _skill_cd[2] <= 0.0 and _can_cast():
			_combo_shown = 3
			stats["combo_max"] = maxi(int(stats["combo_max"]), 3)
			_cast(2, J_HOW_FINISHER, FINISHER_AFTER)
			return
		(_jlog["swings"] as Array).append([_jt(), _jl(), _combo_i])
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
	if (_attack_buffer > 0.0 or _held_chains()) and _act_t >= _act_len * COMBO_CHAIN_AT and _combo_i < COMBO.size() - 1:
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
	# fx_combat (17 Nov): the weapon's element instead (Frostbrand's ice blue, Wale's reference)
	if fx != null and fx.fxc:
		return fx.FXC_FROST_HEAVY if heavy else fx.FXC_FROST
	# look-fight: every hero swing in the hero's colours (art direction 2.8), the heavy third hotter
	if heavy:
		return [FeelScript.HERO_EDGE, FeelScript.HERO_MID]
	return [FeelScript.HERO_MID, FeelScript.HERO_CORE]


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


## `how`/`arg` (build 28): a cast with no button press of its own (J_HOW_*), logged as a derived row beside it.
func _cast(slot: int, how: int = 0, arg: int = 0) -> void:
	_end_action()
	hero.set_guard(false)
	_skill = slot
	_action = "skill"
	_act_t = 0.0
	_act_len = SKILL_LEN[slot]
	_skill_fired = {}
	_skill_cd[slot] = SKILL_CD[slot]
	(_jlog["casts"] as Array).append([_jt(), _jl(), slot, int(round(_frame_dt * 100.0))])
	if how > 0:
		(_jlog["derived"] as Array).append([_jt(), _jl(), slot, how, arg])
	stats["skill_uses"] = int(stats["skill_uses"]) + 1
	(stats["skills"] as Array)[slot] = int((stats["skills"] as Array)[slot]) + 1
	_combo_next = 0
	# SHOOT plays the cast-and-shoot clip (the state the ally's bolt uses), RAIN the raised-arm cast.
	# anim-readable: their own states (skill_shoot: aim, fire with a recoil, hold; skill_rain: the arm to
	# the sky, then down at the circle) where the character has them or has no clip for the old ones
	var names: Array[String] = ["skill_charge", "skill_split", "skill_whirl", "skill_rally", "skill_shield", "attack_2", "skill_rally"]
	if AnimLib.readable_now():
		for pair: Array in [[5, "skill_shoot"], [6, "skill_rain"]]:
			if hero.anim.has_clip(str(pair[1])) or not hero.anim.has_clip(names[int(pair[0])]):
				names[int(pair[0])] = str(pair[1])
	# aim: the stick if pushed, else the boss if near, else the facing
	var aim: Vector3 = _stick_world()
	var aim_range: float = AIM_FAR if slot >= 5 else 9.0
	if aim.length() < 0.3 and enemy != null and not enemy.dead and _flat(enemy.position - hero.position).length() < aim_range:
		aim = _flat(enemy.position - hero.position)
	if aim.length() < 0.05:
		aim = hero.forward()
	_skill_dir = aim.normalized()
	_skill_from = hero.position
	if slot <= 2 or slot >= 5:
		hero.face(_skill_dir, 0.0, 0.0)
	# anim-readable: the clip starts after the hero has turned onto the aim, so a readable clip is drawn facing
	# where the skill goes (presentation only: the yaw and the aim are the rules' as before)
	hero.act(names[slot], _act_len, SKILL_HIT_AT[slot])
	var cols: Array[Color] = [Color(0.4, 0.95, 0.9), Color(1.0, 0.6, 0.25), Color(1.0, 0.82, 0.35), Color(0.5, 1.0, 0.5), Color(0.5, 0.85, 1.0),
		SHOOT_COLS[0], RAIN_COLS[0]]
	hud.callout(hud.skill_label(slot), cols[slot])
	_buzz("cast", 0.4)
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
		5:
			sfx.play("skill", 1.5)
		6:
			sfx.play("skill", 0.85)
			_begin_rain()


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
				_feel_cam("skill_m", _skill_dir)
		1:   # SPLIT: hop, slam, a crack that runs 7 m ahead
			if t >= 0.34 and _fire_once("slam"):
				_shake_cam(0.2, 0.3)
				_buzz("slam", 0.8)
				_punch = maxf(_punch, 0.7)
				sfx.play("slam")
				fx.split_slam(hero.position + _skill_dir * 0.5, _skill_dir)
				_feel_cam("ult")
				feel.wash("ult", FeelScript.HERO_MID)
				fx.ground_split(hero.position + _skill_dir * 0.8, _skill_dir, SPLIT_LEN_M, 0.25, FeelScript.HERO_EDGE)
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
					_buzz("hit", 0.5)
					_feel_cam("skill_s")
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
					(_jlog["heals"] as Array).append([_jt(), _jl(), _jwho(f), heal])
					f.give_buff(RALLY_MULT, RALLY_SECS)
					fx.heal(f.position, FeelScript.HEAL_MID)
					hud.pop(f.chest_pos() + Vector3(0, 0.6, 0), "+%d" % heal, "heal")
		4:   # SHIELD: a barrier over the hero and a nearby ally
			if t >= 0.2 and _fire_once("shield"):
				sfx.play("block", 1.3)
				for f: FighterScript in [hero, ally]:
					if f == null or f.dead or _flat(f.position - hero.position).length() > SUPPORT_RANGE:
						continue
					f.give_shield(SHIELD_HP, SHIELD_SECS)
					fx.shield_up(f.position, 1.3 * f.size_k, FeelScript.SHIELD_MID)
		5:   # SHOOT: the shot leaves the hand
			if t >= SHOOT_AT and _fire_once("shot"):
				_fire_shot()
		6:   # RAIN: the arm is up, the volleys are on their way (they fall on the moves' clock, see _tick_rains)
			if t >= RAIN_MARK_AT and _fire_once("loose"):
				sfx.play("swing_heavy", 1.4)
				fx.pillar(hero.position, 3.2, 0.5, RAIN_COLS[0], 0.35)


# ---- build 22: SHOOT. One straight shot, one light hit; the record's source is 10.
func _fire_shot() -> void:
	var mi: MeshInstance3D = fx.make_bolt(SHOOT_COLS[0])
	var area := HitArea.new()
	var sph := SphereShape3D.new()
	sph.radius = 0.4
	area.setup(1, sph)
	area.struck.connect(_on_struck)
	add_child(area)
	var p: Vector3 = hero.position + Vector3(0, 1.25 * hero.size_k, 0) + _skill_dir * 0.6
	mi.global_position = p
	area.global_position = p
	area.open({"src": hero, "kind": "shoot", "dmg": SHOOT_DMG, "kb": 0.2, "stop": 2.0 / 60.0, "heavy": false})
	_shots.append({"mi": mi, "area": area, "dir": _skill_dir, "left": SHOOT_RANGE})
	# anim-readable: the flash leaves the hand that aims (the shot's own path is unchanged)
	var muzzle: Vector3 = p
	if hero.anim.state == "skill_shoot" and hero.anim.has_clip("skill_shoot"):
		var hp: Vector3 = hero.bone_pos("LeftHand" if not str(hero.anim.timing.get("skill_shoot", {}).get("contact_class", "")).begins_with("rifle") else "RightHand")
		if hp != Vector3.INF:
			muzzle = hp + _skill_dir * 0.12
	fx.muzzle(muzzle, muzzle + _skill_dir, SHOOT_COLS)
	fx.ring(hero.position, 0.8, Color(SHOOT_COLS[0], 0.8), 0.25)
	sfx.play("dash", 1.6)
	_buzz("hit", 0.3)


## The fight is over (or closed): shots in flight and circles still waiting go with it.
func _clear_ranged() -> void:
	for b: Dictionary in _shots:
		(b["area"] as Node).queue_free()
		(b["mi"] as Node).queue_free()
	_shots.clear()
	for r: Dictionary in _rains:
		if r["tele"] != null:
			fx.telegraph_end(r["tele"], false)
		(r["area"] as Node).queue_free()
	_rains.clear()
	for b: Dictionary in _bolts:      # the ally's bolts in flight too (they were left to the fight's own free)
		(b["area"] as Node).queue_free()
		(b["mi"] as Node).queue_free()
	_bolts.clear()


func _tick_shots(dt: float) -> void:
	var i: int = _shots.size() - 1
	while i >= 0:
		var b: Dictionary = _shots[i]
		var area: HitArea = b["area"]
		var mi: MeshInstance3D = b["mi"]
		var dir: Vector3 = b["dir"]
		var done: bool = float(b["left"]) <= 0.0 or area.hit_count() > 0
		if not done and dt > 0.0:
			# in steps no longer than the shot's own size, so a slow frame cannot carry it through the Guardian
			var go: float = minf(SHOOT_SPEED * dt, float(b["left"]))
			var steps: int = maxi(1, int(ceil(go / 0.5)))
			for _k in steps:
				area.global_position += dir * (go / steps)
				area.scan()
				if area.hit_count() > 0:
					break
			b["left"] = float(b["left"]) - go
			mi.global_position = area.global_position
			fx.trail_push("shot%d" % (i % 4), area.global_position + Vector3(0, 0.14, 0), area.global_position - Vector3(0, 0.14, 0), SHOOT_COLS, 0.0, 0.5)
			done = float(b["left"]) <= 0.0 or area.hit_count() > 0
		if done:
			if area.hit_count() > 0:
				fx.ring(area.global_position - Vector3(0, area.global_position.y, 0), 0.9, Color(SHOOT_COLS[0], 0.85), 0.25)
			area.queue_free()
			mi.queue_free()
			_shots.remove_at(i)
		i -= 1


# ---- build 22: RAIN. A marked circle where the target stood, then RAIN_WAVES volleys; source 11.
func _begin_rain() -> void:
	var at: Vector3 = hero.position + _skill_dir * RAIN_REACH
	if hud.stick.length() < 0.3 and enemy != null and not enemy.dead and _flat(enemy.position - hero.position).length() < AIM_FAR:
		at = enemy.position
	at.y = 0.0
	at.x = clampf(at.x, -ARENA_HALF_X, ARENA_HALF_X)
	at.z = clampf(at.z, ARENA_Z.x, ARENA_Z.y)
	var area := HitArea.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = RAIN_RADIUS
	cyl.height = 3.0
	area.setup(1, cyl)
	area.struck.connect(_on_struck)
	add_child(area)
	area.global_position = at + Vector3(0, 1.2, 0)
	var tele: MeshInstance3D = fx.telegraph(at, 0.0, RAIN_RADIUS, 180.0, RAIN_DELAY, Color(RAIN_COLS[0], 1.0))
	_rains.append({"at": at, "t": 0.0, "wave": 0, "area": area, "tele": tele})


func _tick_rains(dt: float) -> void:
	var i: int = _rains.size() - 1
	while i >= 0:
		var r: Dictionary = _rains[i]
		r["t"] = float(r["t"]) + dt
		var area: HitArea = r["area"]
		var at: Vector3 = r["at"]
		var wave: int = int(r["wave"])
		if wave < RAIN_WAVES and float(r["t"]) >= RAIN_DELAY + RAIN_GAP * wave:
			if wave == 0 and r["tele"] != null:
				fx.telegraph_end(r["tele"], true)
				r["tele"] = null
			area.close()
			area.open({"src": hero, "kind": "rain", "dmg": RAIN_DMG, "kb": 0.0, "stop": 2.0 / 60.0, "heavy": false})
			area.scan()
			area.close()
			r["wave"] = wave + 1
			# the volley: streaks from above across the circle, a ring and dust where they land
			for k in 5:
				var a: float = TAU * (float(k) / 5.0 + 0.13 * wave)
				var q: Vector3 = at + Vector3(cos(a), 0, sin(a)) * RAIN_RADIUS * (0.3 + 0.12 * ((k + wave) % 3))
				fx.beam(q, 4.2, 0.16, RAIN_COLS[0], RAIN_COLS[1], 0.22)
			fx.ring(at, RAIN_RADIUS, Color(RAIN_COLS[0], 0.85), 0.3)
			fx.dust(at)
			sfx.play("hit", 1.3)
			if wave == RAIN_WAVES - 1:
				fx.shock(at, RAIN_RADIUS, RAIN_COLS[0], 0.4)
				_shake_cam(0.08, 0.18)
		if int(r["wave"]) >= RAIN_WAVES:
			area.queue_free()
			_rains.remove_at(i)
		i -= 1


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
	var jf: int = JF_BUFFED if src.buff_mult != 1.0 else 0
	var away: Vector3 = _flat(dst.position - src.position)
	var pop_at: Vector3 = dst.chest_pos() + Vector3(0, 0.25 * dst.size_k, 0)   # on the target's body, as on the reference
	# dodge: i-frames
	if dst.iframes > 0.0:
		_jhit(dst, src, info, amount, 0, jf | JF_DODGED)
		hud.pop(pop_at, "DODGE", "dodge")
		if dst == hero:
			stats["dodges"] = int(stats["dodges"]) + 1
		return
	# guard and parry (the boss's strikes only; facing the attacker)
	if dst == hero and hero.guarding and bool(info.get("parryable", false)):
		var facing_ok: bool = hero.forward().angle_to(-away.normalized()) < deg_to_rad(100.0)
		if facing_ok and hero.guard_t <= PARRY_WINDOW:
			_jhit(dst, src, info, amount, 0, jf | JF_PARRIED)
			_parry(src)
			return
		if facing_ok:
			amount = maxi(1, int(round(amount * GUARD_TAKE)))
			stats["blocks"] = int(stats["blocks"]) + 1
			_jhit(dst, src, info, amount, amount, jf | JF_BLOCKED)
			_take(dst, amount, src, false)
			hud.pop(pop_at, "BLOCK %d" % amount, "blocked")
			fx.sparks(hero.chest_pos() + hero.forward() * 0.4, Color(0.7, 0.85, 1.0), 60)
			sfx.play("block")
			hero.knock(away, 0.5)
			hero.flinch(away, 0.45)   # fight-anim: the guard gives under the blow
			_hitstop = maxf(_hitstop, 3.0 / 60.0)
			_shake_cam(0.06, 0.12)
			_feel_hit("block", hero, 3.0 / 60.0, away, src)
			_buzz("block", 0.5)
			return
	# crits (the hero's side)
	var crit: bool = false
	if src.team == 0 and rng.randf() < CRIT_CHANCE * (1.6 if heavy else 1.0):
		crit = true
		amount = int(round(amount * CRIT_MULT))
		jf |= JF_CRIT
	if dst == enemy and enemy.stagger > 0.0:
		amount = int(round(amount * STAGGER_TAKE))
		jf |= JF_STAGGERED
	# the barrier soaks first
	var left: int = dst.absorb(amount)
	_jhit(dst, src, info, amount, left, jf)
	if left < amount:
		hud.pop(pop_at + Vector3(0, 0.35, 0), "ABSORB %d" % (amount - left), "absorbed")
		fx.shock(dst.position, 1.25 * dst.size_k, Color(0.45, 0.8, 1.0), 0.3)
		sfx.play("block", 1.4)
	if left > 0:
		_take(dst, left, src, crit)
	# feedback
	dst.flash(0.95 if crit else (0.82 if heavy else 0.68))   # cq 013: a short white pop that keeps the body readable (pass 2: held through the stop)
	dst.hurt_pop(away, 1.4 if crit else (1.0 if heavy else 0.6))   # fight-anim: + the recoil away from the blow
	var kb: float = float(info.get("kb", 0.3))
	if dst == enemy:
		kb *= 0.45   # the boss is heavy
	if kb > 0.0:
		dst.knock(away, kb)
	# look-fight: colours by source (art direction 2.8), so who hit whom reads without words
	var tint: Color = FeelScript.CRIT_MID if crit else (FeelScript.HERO_EDGE if heavy else FeelScript.HERO_MID)
	if src == ally:
		tint = FeelScript.ALLY_MID
	if dst.team == 0:
		tint = FeelScript.BOSS_MID
	var contact: Vector3 = dst.chest_pos() - away.normalized() * 0.45 * dst.size_k   # on the body's surface, facing the blow
	if fx.fxc and src == hero and not crit:
		tint = (_swing_cols(heavy)[0] as Color)
	fx.sparks(contact, tint, amount, crit, away)
	if fx.fxc and src == hero:
		fx.impact(contact, dst.position, _swing_cols(heavy), 1.0 if crit else (0.7 if heavy else 0.3))
	if heavy and src == hero:
		fx.dust(dst.position, amount >= 140)
	if crit:
		fx.decal(fx.SCORCH, dst.position + away.normalized() * 0.3, 1.1 + 0.3 * dst.size_k, Color(0.12, 0.08, 0.07, 0.6), 3.0)
	var stop: float = float(info.get("stop", 3.0 / 60.0))
	if src == hero or dst == hero:
		_hitstop = maxf(_hitstop, stop * (1.4 if crit else 1.0))
		_feel_hit(_moment_for(src, dst, info, heavy, crit), dst, stop * (1.4 if crit else 1.0), away, src)
	# realism round 2 (presentation): an animation-only pause on both bodies, scaled by the damage,
	# on top of the real hit-stop (which only the hero's blows have): the game clock never sees it
	var want_pause: float = clampf(0.025 + 0.06 * float(amount) / 175.0, 0.025, 0.09)
	var real_stop: float = stop * (1.4 if crit else 1.0) if (src == hero or dst == hero) else 0.0
	src.hit_pause(maxf(0.0, want_pause - real_stop))
	dst.hit_pause(maxf(0.0, want_pause - real_stop))
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
	# Touch: the hero's own blows and blows on the hero (an ally's or the boss's on the ally stay quiet).
	if src == hero and dst == enemy:
		_buzz("hit_heavy" if heavy or crit else "hit", 1.0 if crit else (0.8 if heavy else 0.4))
		if dst == enemy and (crit or amount >= 170):
			fx.coin(enemy.head_pos() + Vector3(rng.randf_range(-0.6, 0.6), 0.0, 0.0))
	sfx.play("hit_heavy" if heavy or crit else "hit", 0.9 if dst == enemy else 1.1)
	if crit:
		stats["crits"] = int(stats["crits"]) + 1
		sfx.crit()
	if left > 0 and AnimLib.readable_now():
		dst.hit_size(left, heavy, crit)   # anim-readable: the reaction sized to the blow (presentation)
	if dst == hero and left > 0:
		hud.hurt()
		_shake_cam(0.14, 0.2)
		_buzz("hit_heavy" if heavy or crit else "hurt", 0.9 if heavy or crit else 0.6)
		sfx.play("hurt")
		if _action == "attack" or _action == "":
			_end_action()
			_action = "hit"
			_act_t = 0.0
			_act_len = 0.28
			hero.act("hit", 0.28)
	elif dst == ally and left > 0 and not ally.dead:
		ally.react_hit(0.28)   # fight-anim: not over its own bolt cast (the recoil shows it)
	elif dst == enemy and (heavy or crit) and _enemy_state != "windup":
		enemy.react_hit(0.3)   # fight-anim: not over its swing's recovery (the recoil shows it)
	if dst == enemy and info.has("stagger") and not enemy.dead:
		_stagger_enemy(float(info["stagger"]), false)
	if dst.hp <= 0 and not dst.dead:
		dst.die()
		sfx.play("ko")
		if dst == enemy or dst == hero:
			_buzz("ko", 1.0)
		fx.ko_burst(dst.position, dst.size_k, Color(1.0, 0.85, 0.45) if dst.team == 1 else Color(0.7, 0.85, 1.0))
		if dst == enemy:
			fx.coin_burst(dst.position + Vector3(0, 1.0 * dst.size_k, 0), 6)
			if mode == "full" and coop == null:
				_ko_begin("boss_ko", enemy)
		elif dst == hero and mode == "full":
			_ko_begin("hero_ko", hero)
		if dst == ally:
			_update_players()


func _take(dst: FighterScript, amount: int, src: FighterScript, _crit: bool) -> void:
	var invulnerable: bool = mode == "chars"
	if invulnerable and dst == hero:
		dst.hp = maxi(1, dst.hp - amount)
	elif not invulnerable:
		dst.hp = maxi(0, dst.hp - amount)
		if coop != null and dst == enemy and not _coop_won:
			dst.hp = maxi(1, dst.hp)   # co-op: only the server's pool brings the Guardian down
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
	fx.shock(hero.position, 2.2, FeelScript.CRIT_MID, 0.4)
	_feel_cam("parry")
	feel.stop("parry", 0.16)
	hero.act("parry", 0.35, PARRY_HIT_AT)
	hero.flash(0.6)
	_hitstop = maxf(_hitstop, 0.16)
	_shake_cam(0.1, 0.2)
	_buzz("parry", 1.0)
	_punch = maxf(_punch, 0.6)
	if src == enemy:
		_stagger_enemy(PARRY_STAGGER, true)
		sfx.play("grunt", 1.18)


func _stagger_enemy(secs: float, parried: bool) -> void:
	(_jlog["staggers"] as Array).append([_jt(), _jl(), int(round(secs * 100.0)), 1 if parried else 0])
	enemy.stagger = maxf(enemy.stagger, secs)
	if _tele != null:
		fx.telegraph_end(_tele, false)
		_tele = null
	_boss_area.close()
	_enemy_state = "staggered"
	_enemy_t = 0.0
	if AnimLib.readable_now() and secs >= 1.2 and enemy.anim.has_clip("knockdown"):
		# anim-readable: a parried Guardian goes down and gets up again inside the stagger the rules give it
		enemy.act("knockdown", secs)
	else:
		if AnimLib.readable_now():
			enemy.hit_size(200, true, false)
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
	if bool(cfg.get("boss_passive", false)):
		return   # review captures of the characters only (cq 016): the boss stands still
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
		_feel_cam("enrage")
		_buzz("slam", 0.6)
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
	sfx.play("grunt", 0.95 if kind == "swipe" else 0.82)   # look-fight: the Guardian's voice on the wind-up
	if kind == "swipe":
		_boss_area.shape_node.shape = _swipe_shape
		_boss_area.shape_node.position = Vector3.ZERO
		_boss_area.global_position = enemy.position
		_boss_area.rotation = Vector3(0, _enemy_yaw, 0)
		_tele = fx.telegraph(enemy.position, _enemy_yaw, SWIPE_R, SWIPE_HALF, _enemy_windup, FeelScript.TELEGRAPH)
	else:
		# the ring lands where the target stands now: move out of it, or parry it
		_enemy_at = target.position
		_boss_area.shape_node.shape = _slam_shape
		_boss_area.shape_node.position = Vector3(0, 1.3, 0)
		_boss_area.global_position = _enemy_at
		_boss_area.rotation = Vector3.ZERO
		_tele = fx.telegraph(_enemy_at, 0.0, SLAM_R, 180.0, _enemy_windup, FeelScript.TELEGRAPH)


func _enemy_strike() -> void:
	var dmg: Vector2i = boss_dmg(SWIPE_DMG if _enemy_kind == "swipe" else SLAM_DMG)
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
		sfx.play("swing_heavy", 0.75)
	else:
		fx.shock(_enemy_at, SLAM_R * 1.1, FeelScript.BOSS_MID, 0.45)
		fx.sparks(_enemy_at + Vector3(0, 0.3, 0), FeelScript.BOSS_MID, 200)
		fx.crack(_enemy_at, SLAM_R * 1.3)
		fx.dust(_enemy_at, true)
		_shake_cam(0.16, 0.3)
		_buzz("slam", 0.9)
		if hero != null and _flat(hero.position - _enemy_at).length() < 6.0:
			_feel_cam("boss_slam")
		sfx.play("slam", 0.85)
	_enemy_state = "recover"
	_enemy_t = 0.0


# ------------------------------------------------------------ the ally

func _tick_ally(dt: float) -> void:
	if bool(cfg.get("rev_solo", false)):
		return   # review captures of the hero alone (cq 016)
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
		goal = hero.position + _play_right * 1.6 - _play_fwd * 0.8
	var to: Vector3 = _flat(goal - ally.position)
	var d: float = to.length()
	if d > 0.3:
		var step: float = minf(d, ALLY_SPEED * dt)
		ally.position += to / d * step
		# build 20: the speed the body really moves at (it read 0 for the last 0.6 m, so the ally
		# slid into place standing in idle). The animation reads it, the rules never do.
		ally.speed_now = step / dt if dt > 0.0 else 0.0
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
	var mi: MeshInstance3D = fx.make_bolt(FeelScript.ALLY_MID)
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
	fx.ring(ally.position, 0.9, Color(FeelScript.ALLY_MID, 0.8), 0.3)


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
			fx.trail_push("bolt%d" % (i % 4), area.global_position + Vector3(0, 0.12, 0), area.global_position - Vector3(0, 0.12, 0), FeelScript.ALLY_MID)
			area.scan()
		if done or area.hit_count() > 0:
			if area.hit_count() > 0:
				fx.ring(enemy.position, 1.0, Color(FeelScript.ALLY_MID, 0.8), 0.3)
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
	if five and _bot_hold_t > 0.0:
		# build 28: holding ATTACK for SPLIT (stands still); let go once it is cast, or after the hold's time
		_bot_hold_t -= dt
		hud.bot_stick(Vector2.ZERO)
		if _hold_used or _bot_hold_t <= 0.0:
			_bot_hold_t = 0.0
			hud.bot_attack_hold(false)
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
					want = from_ring.normalized() if from_ring.length() > 0.05 else _play_right
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
	hud.bot_stick(Vector2(want.dot(_play_right), want.dot(_play_fwd)))
	if threat:
		return
	_bot_next_skill -= dt
	if five:
		_bot_five(d, reach)
		return
	if d < reach + 0.4:
		var cast: int = -1
		if _bot_next_skill <= 0.0:
			if _skill_cd[3] <= 0.0 and (hero.hp < hero.max_hp * 0.6 or (ally != null and not ally.dead and ally.hp < ally.max_hp * 0.5)):
				cast = 3
			elif _skill_cd[4] <= 0.0 and hero.hp < hero.max_hp * 0.8:
				cast = 4
			elif _skill_cd[6] <= 0.0:
				cast = 6    # build 22: RAIN on the Guardian where it stands, first: it falls while the bot keeps swinging
			elif _skill_cd[1] <= 0.0:
				cast = 1
			elif _skill_cd[2] <= 0.0:
				cast = 2
			elif _skill_cd[5] <= 0.0:
				cast = 5    # and a SHOOT at point-blank when nothing bigger is back
		if cast >= 0 and _can_cast():
			hud.bot_skill_slot(cast)
			_bot_next_skill = 1.2
		elif _action == "" or (_action == "attack" and _act_t > _act_len * 0.5):
			hud.bot_attack()
	elif d < 7.0 and d > 3.5 and _skill_cd[0] <= 0.0 and _can_cast() and _bot_next_skill <= 0.0:
		hud.bot_skill_slot(0)
		_bot_next_skill = 1.0
	elif d < SHOOT_RANGE - 1.0 and _skill_cd[5] <= 0.0 and _can_cast() and _bot_next_skill <= 0.0:
		hud.bot_skill_slot(5)   # build 22: closing in from range, a SHOOT on the way
		_bot_next_skill = 0.6


## build 28: the bot on the five-button panel, the same eight moves as a player: it presses DASH, SHIELD, SHOOT
## and RAIN, holds ATTACK for SPLIT, swings its combo into the WHIRL finisher, and RALLY comes by itself.
func _bot_five(d: float, reach: float) -> void:
	if d < reach + 0.4:
		var cast: int = -1
		var hold: bool = false
		if _bot_next_skill <= 0.0:
			if _skill_cd[4] <= 0.0 and hero.hp < hero.max_hp * 0.8:
				cast = 4
			elif _skill_cd[6] <= 0.0:
				cast = 6    # RAIN on the Guardian where it stands, first: it falls while the bot keeps swinging
			elif _skill_cd[1] <= 0.0:
				hold = true  # SPLIT: hold ATTACK
			elif _skill_cd[5] <= 0.0:
				cast = 5    # and a SHOOT at point-blank when nothing bigger is back
		if hold and _action == "" and not hero.guarding:
			hud.bot_attack_hold(true)   # the press starts a swing; the hold casts SPLIT HOLD_SPLIT_CS later
			_bot_hold_t = HOLD_SPLIT_CS / 100.0 + 0.5
			_bot_next_skill = 1.2
		elif cast >= 0 and _can_cast():
			hud.bot_skill_slot(cast)
			_bot_next_skill = 1.2
		elif _action == "" or (_action == "attack" and _act_t > _act_len * 0.5):
			hud.bot_attack()    # the chain's third hit is WHIRL whenever it is back
	elif d < 7.0 and d > 3.5 and _skill_cd[0] <= 0.0 and _can_cast() and _bot_next_skill <= 0.0:
		hud.bot_skill_slot(0)
		_bot_next_skill = 1.0
	elif d < SHOOT_RANGE - 1.0 and _skill_cd[5] <= 0.0 and _can_cast() and _bot_next_skill <= 0.0:
		hud.bot_skill_slot(5)
		_bot_next_skill = 0.6


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
	_clear_ranged()
	# look-fight: the end banner waits for the KO beat (feel.gd), then holds 1.2 s over the
	# slowed, dimmed frame before the result goes to the app (art direction 7, "Win screen")
	var beat: float = _ko_beat_len()
	match o:
		"win":
			_end_delay = beat + BANNER_HOLD_S
			hero.celebrate()
			if ally != null and not ally.dead:
				_win_ally_step()
				if _ally_to == Vector3.INF:
					ally.celebrate()
			_hitstop = 0.15            # BattleRunner Guardian kill: hit-stop 0.15, punch 1, shake 0.14 / 0.35
			_punch = 1.0
			_shake_cam(0.14, 0.35)
			_buzz("ko", 1.0)   # one rumble with the Guardian's fall (haptics.gd); a co-op win (no fall here) gets it now
			# build 25: the Warden's verdict line (setup.warden.win) under VICTORY, when sent
			var win_sub: String = str(cfg.get("warden_win", ""))
			_banner_later(beat, ["VICTORY", win_sub if win_sub != "" else str(cfg.get("enemy_name", "Guardian")).to_upper() + " DEFEATED", "win"])
		"lose":
			_end_delay = beat + LOSS_HOLD_S
			_banner_later(beat, ["DEFEATED", str(cfg.get("warden_loss", "")), "lose"])
		_:
			_end_delay = 1.0
			hud.banner("TIME UP", "", Color(0.85, 0.92, 1.0), 0.0)
			sfx.end_music(0.8)
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
		"judge": judge_log(),
	}.merged({"coop": (coop.get("stats") as Dictionary).merged({"seat": coop.get("seat"), "ended": coop.get("ended"),
		"server_hp": coop.get("server_hp")})} if coop != null else {})


## What the game server checks (docs/game3d/XP.md): the rules this build fights by, the seed it used,
## and every hit, cast, heal, stagger, skill press and guard change, on both clocks (1/100 s).
func judge_log() -> Dictionary:
	var j: Dictionary = _jlog.duplicate(true)
	j["v"] = rules_version
	j["rules"] = rules_id(rules_version)
	j["seed"] = int(cfg["seed"]) if cfg.has("seed") else -1
	if not mods.is_empty():
		j["mods"] = mods.duplicate()
	return j


## The Guardian's HP for this fight: the rules' ENEMY_HP x boss_hp_permille (the server's roam_fight3d.boss_hp).
func boss_hp() -> int:
	return ENEMY_HP if boss_hp_permille == 1000 else int(round(ENEMY_HP * (boss_hp_permille / 1000.0)))


## A boss strike's damage range x boss_dmg_permille, each end rounded (the server's roam_fight3d._boss_range).
func boss_dmg(r: Vector2i) -> Vector2i:
	if boss_dmg_permille == 1000:
		return r
	var m: float = boss_dmg_permille / 1000.0
	return Vector2i(int(round(r.x * m)), int(round(r.y * m)))


## The setup's look (cosmetic, never judged): {size_permille, title}.
func _guardian_look() -> Dictionary:
	var lk: Variant = cfg.get("guardian_look")
	return lk if lk is Dictionary else {}


## The combat numbers the judge needs, as whole numbers (ms, permille): the server holds the same
## table, and the sha256 of this one's sorted JSON must match its own (rules_id).
## `version` 3 (build 28, the five-button panel) is version 2's table plus "five": how the three moves with no button
## are triggered (the server re-derives each such cast from the record's ATTACK presses, swings and HP).
static func rules_table(version: int = RULES_VERSION) -> Dictionary:
	var combo: Array = []
	for c: Dictionary in COMBO:
		combo.append({"len_ms": int(round(float(c["len"]) * 1000.0)), "dmg": [(c["dmg"] as Vector2i).x, (c["dmg"] as Vector2i).y]})
	var cd: Array = []
	var ln: Array = []
	for i in SKILL_N:
		cd.append(int(round(SKILL_CD[i] * 1000.0)))
		ln.append(int(round(SKILL_LEN[i] * 1000.0)))
	var t: Dictionary = {
		"hp": {"hero": HERO_HP, "ally": ALLY_HP, "boss": ENEMY_HP},
		"combo": combo, "combo_chain_permille": int(round(COMBO_CHAIN_AT * 1000.0)),
		"crit_permille": int(round(CRIT_CHANCE * 1000.0)), "crit_mult_permille": int(round(CRIT_MULT * 1000.0)),
		"guard_take_permille": int(round(GUARD_TAKE * 1000.0)), "parry_window_ms": int(round(PARRY_WINDOW * 1000.0)),
		"parry_stagger_ms": int(round(PARRY_STAGGER * 1000.0)), "stagger_take_permille": int(round(STAGGER_TAKE * 1000.0)),
		"skill_cd_ms": cd, "skill_len_ms": ln,
		"charge_dmg": [CHARGE_DMG.x, CHARGE_DMG.y], "split_dmg": [SPLIT_DMG.x, SPLIT_DMG.y], "whirl_dmg": [WHIRL_DMG.x, WHIRL_DMG.y],
		"rally_heal_permille": int(round(RALLY_HEAL * 1000.0)), "rally_mult_permille": int(round(RALLY_MULT * 1000.0)),
		"rally_ms": int(round(RALLY_SECS * 1000.0)), "shield_hp": SHIELD_HP, "shield_ms": int(round(SHIELD_SECS * 1000.0)),
		"swipe_dmg": [SWIPE_DMG.x, SWIPE_DMG.y], "slam_dmg": [SLAM_DMG.x, SLAM_DMG.y], "boss_cd_ms": int(round(ENEMY_CD * 1000.0)),
		"ally_dmg": [ALLY_DMG.x, ALLY_DMG.y],
		# build 22. shoot_window_ms: the latest a shot can land after its cast (the release plus the flight
		# to SHOOT_RANGE); rain: the first volley rain_delay_ms after the cast, rain_waves of them rain_gap_ms apart
		"shoot_dmg": [SHOOT_DMG.x, SHOOT_DMG.y], "shoot_at_ms": int(round(SHOOT_AT * 1000.0)),
		"shoot_window_ms": int(round((SHOOT_AT + SHOOT_RANGE / SHOOT_SPEED) * 1000.0)),
		"rain_dmg": [RAIN_DMG.x, RAIN_DMG.y], "rain_delay_ms": int(round(RAIN_DELAY * 1000.0)),
		"rain_gap_ms": int(round(RAIN_GAP * 1000.0)), "rain_waves": RAIN_WAVES,
	}
	if version >= RULES_VERSION_FIVE:
		# buttons: the slots with a button; finisher: WHIRL follows a swing of chain index finisher_after (within
		# its length plus combo_reset_ms); hold: SPLIT after ATTACK held hold_ms; auto: RALLY below auto_below_permille
		t["five"] = {"buttons": FIVE_BUTTONS.duplicate(), "finisher_slot": 2, "finisher_after": FINISHER_AFTER,
			"combo_reset_ms": int(round(COMBO_RESET * 1000.0)), "hold_slot": 1, "hold_ms": HOLD_SPLIT_CS * 10,
			"auto_slot": 3, "auto_below_permille": AUTO_RALLY_BELOW}
	return t


static func rules_id(version: int = RULES_VERSION) -> String:
	var body: String = JSON.stringify(rules_table(version), "", true)
	return "f3d-%d-%s" % [version, body.sha256_text().left(12)]


func _jt() -> int:
	return int(round(fight_time * 100.0))


func _jl() -> int:
	return int(round(_logic_time * 100.0))


func _jwho(f: FighterScript) -> int:
	return J_HERO if f == hero else (J_ALLY if f == ally else J_BOSS)


func _jhit(dst: FighterScript, src: FighterScript, info: Dictionary, amount: int, dealt: int, flags: int) -> void:
	var kind: String = str(info.get("kind", ""))
	var code: int = 1 + int(info.get("combo", 0)) if kind == "melee" else int(J_SRC.get(kind, 0))
	if src == ally and kind == "melee":
		code = 0   # the ally never swings; kept apart so a log cannot pass its hits off as the hero's
	var row: Array = [_jt(), _jl(), _jwho(dst), code, amount, dealt, flags]
	(_jlog["hits"] as Array).append(row)
	if coop != null and dst == enemy:
		coop.call("send_hit", row)


func _emit_result() -> void:
	if state == "done":
		return
	state = "done"
	_restore_time()
	finished.emit(result())


## Bridge.end_fight(): abort now with outcome "quit".
func abort() -> void:
	if fx != null:
		_clear_ranged()
	if state == "done":
		return
	outcome = "quit"
	_emit_result()


func status() -> Dictionary:
	var st: String = state
	if st == "ending" or st == "intro":
		st = "fighting"
	return {
		"state": st,
		"t_left": snappedf(t_left, 0.01),
		"hero_hp": hero.hp if hero != null else 0,
		"enemy_hp": enemy.hp if enemy != null else 0,
		"fps": Engine.get_frames_per_second(),
	}


# ------------------------------------------------------------ camera

## A touch for the phone (haptics.gd decides whether it is sent; the app plays it).
func _buzz(kind: String, strength: float) -> void:
	if not _haptics_on or (state != "fighting" and state != "ending"):
		return
	if _haptics.allow(kind, Time.get_ticks_msec()):
		haptic.emit(kind, clampf(strength, 0.0, 1.0))


func _shake_cam(amount: float, seconds: float) -> void:
	# look-fight: the view's shake is feel.gd's now (section 7 values, budget, Reduce motion).
	# These two still run because _apply_camera's legacy draws advance the seeded RNG for as long
	# as _shake_t lasts: crits and the boss's choices depend on it. Never change them.
	_shake = maxf(_shake, amount)
	_shake_t = maxf(_shake_t, seconds)


func _follow_camera(dt: float) -> void:
	if dt <= 0.0:
		return
	var target: Vector3 = Vector3(0, 0, 1)
	if hero != null:
		var mv: Vector3 = _cam_right * hud.stick.x + _cam_fwd * hud.stick.y
		_look = _look.lerp(mv * CAM_LOOK, 1.0 - exp(-dt * 2.5))
		target = hero.position + _cam_fwd * _cam_ahead + _look
		if enemy != null and not enemy.dead and not bool(cfg.get("cam_hero_only", false)):
			target = target.lerp((hero.position + enemy.position) * 0.5, 0.5)
		if _close:
			# the close camera stays with the hero and leans towards its target (less in portrait: a hero nearer
			# the camera than the focus drops under the controls)
			target = hero.position + _look * 0.5
			if enemy != null and not enemy.dead and not bool(cfg.get("cam_hero_only", false)):
				target = target.lerp(enemy.position, _close_lean)
		# look-fight dynamic framing: a little closer while the hero and the Guardian are engaged
		var engaged: bool = enemy != null and not enemy.dead and _flat(enemy.position - hero.position).length() < FRAME_NEAR_M
		_frame_k = lerpf(_frame_k, 1.0 if engaged else 0.0, 1.0 - exp(-dt * 1.6))
	target.x = clampf(target.x, -(CLOSE_BOUNDS_X if _close else CAM_BOUNDS_X), CLOSE_BOUNDS_X if _close else CAM_BOUNDS_X)
	target.z = clampf(target.z, -CAM_BOUNDS, CAM_BOUNDS)
	target.y = 0.0
	if state == "ending" and outcome == "win" and hero != null:
		# build 20: the victory shot. The view used to hold the street's clamp, so a hero who won
		# by the kerb cheered at the frame's edge behind the VICTORY card; it now eases onto the
		# hero (who stands under the card) and in
		_win_k = move_toward(_win_k, 1.0, _ko_dt_real / WIN_FRAME_S)
		# build 21: the shot frames the winners (the hero and the ally beside it), not the Guardian's
		# scorch mark: WIN_AHEAD was 4.5 m, so the pair stood in the bottom corner under an empty
		# street centre
		var ht: Vector3 = _winners_at() + _cam_fwd * (0.0 if _close else WIN_AHEAD)
		if _close and not _landscape:
			ht = hero.position    # a portrait screen is too narrow for the pair at this distance: the hero's shot
		ht.x = clampf(ht.x, -WIN_BOUNDS_X, WIN_BOUNDS_X)
		ht.y = 0.0
		target = target.lerp(ht, ease(_win_k, -2.0))
	if feel.ko_active and not _reduce_motion:
		# the KO beat: the view leans in on the fallen fighter, then comes back
		target = target.lerp(Vector3(feel.ko_at.x, 0.0, feel.ko_at.z), 0.55 * feel.ko_push(feel.ko_t))
	_focus = _smooth_damp(_focus, target, CAM_SMOOTH, 40.0, dt)
	if _close:
		var need: float = _close_fit()
		_close_d = lerpf(_close_d, need, 1.0 - exp(-_ko_dt_real * (7.0 if need > _close_d else 1.6)))
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
	var ko_k: float = 0.0 if _reduce_motion else feel.ko_push(feel.ko_t)
	var ko_m: Dictionary = FeelScript.moment(feel.ko_kind) if feel.ko_active else {}
	var d: float = _cam_dist * (1.0 - _punch * 0.1) * (1.0 - FRAME_IN * _frame_k) * (1.0 - float(ko_m.get("zoom", 0.0)) * ko_k)
	d *= 1.0 - WIN_ZOOM * (0.5 if _reduce_motion else 1.0) * ease(_win_k, -2.0)
	var orbit: Basis = Basis(Vector3.UP, deg_to_rad(float(ko_m.get("orbit", 0.0)) * ko_k))
	var pos: Vector3 = _focus + Vector3.UP * 0.8 + (orbit * _cam_basis.z) * d
	var close_basis: Basis = _view_basis
	if _close:
		# realism round 2: the fitted distance, a harder push-in on a heavy hit (the view is close enough for
		# it to read), and the victory shot: down to the winner's height and in to CLOSE_WIN_DIST
		var wk: float = ease(_win_k, -2.0)
		d = _close_d * (1.0 - _punch * (0.04 if _reduce_motion else 0.12)) * (1.0 - float(ko_m.get("zoom", 0.0)) * ko_k)
		var win_d: float = CLOSE_WIN_DIST_LAND if _landscape else CLOSE_WIN_DIST
		var win_h: float = FighterScript.HEIGHT * (hero.size_k if hero != null else 1.0) + 0.25
		var win_b: Basis = _close_win_basis
		if _lc and not _landscape:
			# fid29-lightcam: the victory shot on LC_WIN_FOV, the winner LC_WIN_SHARE of the frame's height, the camera
			# at LC_WIN_AIM of the body looking down LC_WIN_PITCH, so a wide pose's hands stay in frame and the face is level
			# (at a real place: looser, a wider lens and a low camera looking up, LC_WIN_*_PLACE)
			var hh: float = FighterScript.HEIGHT * (hero.size_k if hero != null else 1.0)
			var at_place: bool = arena != null and arena.get("place") != null
			var lk3: Dictionary = arena.get("look") if arena != null else {}
			var w_fov: float = float(lk3.get("lc_win_fov_place", LC_WIN_FOV_PLACE)) if at_place else float(lk3.get("lc_win_fov", LC_WIN_FOV))
			var w_share: float = float(lk3.get("lc_win_share_place", LC_WIN_SHARE_PLACE)) if at_place else float(lk3.get("lc_win_share", LC_WIN_SHARE))
			var fw: float = lerpf(_base_fov, w_fov, wk)
			win_d = hh * LC_WIN_HK / (w_share * 2.0 * tan(deg_to_rad(w_fov) * 0.5)) * (1.0 - LC_PUSH * _lc_push(_end_t - WIN_FRAME_S))
			win_h = hh * (float(lk3.get("lc_win_aim_place", LC_WIN_AIM_PLACE)) if at_place else float(lk3.get("lc_win_aim", LC_WIN_AIM)))
			win_b = _lc_win_basis_place if at_place else _lc_win_basis
			_lc_fov = fw
		d = lerpf(d, win_d, wk)
		close_basis = _view_basis.slerp(win_b, wk) if wk > 0.0 else _view_basis
		var orbit_basis: Basis = _cam_basis.slerp(win_b, wk) if wk > 0.0 else _cam_basis
		# the VICTORY card lies across the upper third: the winner's head sits just under it
		pos = _focus + Vector3.UP * lerpf(_lc_pivot_h(), win_h, wk) + (orbit * orbit_basis.z) * d
	if _shake_t > 0.0:
		_shake_t -= dt
		var s: float = _shake * clampf(_shake_t / 0.18, 0.0, 1.0)
		# cq 013: the view now moves by trauma (below). These two draws stay so the fight's
		# seeded RNG advances exactly as before (crits and the boss's choices are unchanged).
		var _legacy := Vector2(rng.randf_range(-s, s), rng.randf_range(-s, s))
		if _shake_t <= 0.0:
			_shake = 0.0
	var basis: Basis = orbit * (close_basis if _close else _view_basis)
	_shake_clock += _ko_dt_real
	var sh: Vector3 = feel.shake_offset(_shake_clock)
	if sh != Vector3.ZERO:
		pos += basis * Vector3(sh.x, sh.y, 0.0)
		basis = basis * Basis(Vector3(0, 0, 1), sh.z)
	# the kick: a short push of the view along the blow, springing back
	_kick = _kick.lerp(Vector3.ZERO, 1.0 - exp(-dt * 12.0))
	pos += _kick * (0.3 if _reduce_motion else 1.0)
	_fov_kick = move_toward(_fov_kick, 0.0, FOV_KICK_DECAY * dt)
	cam.fov = (_lc_fov if _lc_fov > 0.0 else _base_fov) - (0.0 if _reduce_motion else _fov_kick)
	_lc_fov = -1.0
	if _lc and _close and _win_k > 0.0 and not _landscape:
		basis = _lc_handheld(basis)
	cam.transform = Transform3D(basis, pos)
	if _lc and _close:
		# fid29-lightcam: the mid-fight frame's offsets (the view shifts, the heading and the pitch of the orbit stay);
		# none in the close shots (the intro beat, the victory shot), which frame the hero themselves
		var wk2: float = ease(_win_k, -2.0)
		if _beat_t >= 0.0:
			wk2 = maxf(wk2, 1.0 - smoothstep(BEAT_LEN - BEAT_OUT, BEAT_LEN, _beat_t))
		cam.h_offset = _lc_hoff() * (1.0 - wk2)
		cam.v_offset = _lc_voff() * (1.0 - wk2)


## Camera impact for a hit or a skill (cq 013): trauma 0..1 (shake), fov_kick degrees of
## zoom punch, and an optional push along `dir` (the blow). Hit-stop is separate.
func _impact_cam(trauma: float, fov_kick: float = 0.0, dir: Vector3 = Vector3.ZERO) -> void:
	# kept for older callers; look-fight's moments go through _feel_cam
	feel.trauma = maxf(feel.trauma, trauma * (0.25 if _reduce_motion else 1.0))
	_fov_kick = minf(4.0, maxf(_fov_kick, fov_kick))
	if dir != Vector3.ZERO:
		_kick += _flat(dir).normalized() * 0.12 * trauma


# ------------------------------------------------------------ look-fight: feel (presentation only)

const FRAME_NEAR_M: float = 5.0        # engaged: the hero within this of the Guardian
const FRAME_IN: float = 0.07           # the view comes this much closer when engaged
const BANNER_HOLD_S: float = 1.2       # VICTORY over the frame before the app's reward sheet
const WIN_FRAME_S: float = 0.9         # build 20: the victory shot eases onto the hero over this (real s)
const WIN_ZOOM: float = 0.22           # and comes this much closer
const WIN_BOUNDS_X: float = ARENA_HALF_X   # the hero may stand by the kerb, beyond the fight's view
const WIN_AHEAD: float = 1.4           # the view looks this far past the winners: they stand under the VICTORY card, not behind it (build 21: was 4.5)
const WIN_SPACING: float = 2.1         # build 21: the ally stands this far to the hero's side (across the view) for the victory shot
const WIN_STEP_V: float = 3.2          # m/s: the ally's walk there
var _ally_to: Vector3 = Vector3.INF    # where the ally walks for the victory shot (INF = stays)
var _win_k: float = 0.0
const LOSS_HOLD_S: float = 1.05        # DEFEATED: calm, the buttons under 2 s after the fall


## The camera side of a moment: shake (with its budget), zoom punch, a push along the blow.
func _feel_cam(name: String, dir: Vector3 = Vector3.ZERO) -> void:
	feel.shake(name, fight_time, _action == "dodge")
	var z: float = feel.zoom(name)
	if z > 0.0:
		_fov_kick = maxf(_fov_kick, _base_fov * z)
	if dir != Vector3.ZERO and not _reduce_motion:
		_kick += _flat(dir).normalized() * 0.4 * float(FeelScript.moment(name).get("trauma", 0.0))


## build 20 pass 2: a shove reads as a shove. While a fighter is knocked back faster than
## SKID_V its feet kick up dust behind it every SKID_EVERY s (presentation only: fx's own randomness).
const SKID_V: float = 2.5
const SKID_EVERY: float = 0.07
var _skid_t: Dictionary = {}


func _skid_dust(dt: float) -> void:
	if fx == null or state != "fighting":
		return
	for f: FighterScript in fighters:
		if f == null or f.dead or not f.visible:
			continue
		var kv: float = f.kb_vel.length()
		var id: int = f.get_instance_id()
		if kv < SKID_V:
			_skid_t.erase(id)
			continue
		var t: float = float(_skid_t.get(id, 0.0)) - dt
		if t <= 0.0:
			t = SKID_EVERY
			fx.dust(f.position + f.kb_vel.normalized() * -0.2 * f.size_k, false)
		_skid_t[id] = t


## A blow's feel: the camera, the presentation hit-stop over the simulation's `sim_stop`, the
## victim's shudder through the freeze, and the screen washes (the ultimate's tint, the hurt vignette).
func _feel_hit(name: String, dst: FighterScript, sim_stop: float, away: Vector3, src: FighterScript) -> void:
	_feel_cam(name, away)
	feel.stop(name, sim_stop)
	var hold: float = maxf(sim_stop, float(FeelScript.moment(name).get("stop", 0.0)))
	if dst != null and hold > 0.0:
		dst.shudder(hold, (0.07 if name in ["crit", "heavy", "ult", "hurt_heavy"] else 0.045) * dst.size_k)
	feel.wash(name, FeelScript.HURT if dst == hero else (FeelScript.ALLY_MID if src == ally else FeelScript.HERO_MID))


## Which section 7 moment a blow is.
func _moment_for(src: FighterScript, dst: FighterScript, info: Dictionary, heavy: bool, crit: bool) -> String:
	if dst == hero:
		return "hurt_heavy" if (crit or str(info.get("kind", "")) == "slam") else "hurt"
	var kind: String = str(info.get("kind", ""))
	if src == hero:
		if kind == "split":
			return "ult"
		if crit:
			return "crit"
		if kind == "charge":
			return "skill_m"
		if kind == "whirl":
			return "skill_s"
		return "heavy" if heavy else "light"
	return "light"


## The KO beat starts the moment a fighter falls (the fight ends this same frame): the hit-stop,
## then slow motion (Engine.time_scale, while state is "ending" only), the camera leaning in.
func _ko_begin(kind: String, who: FighterScript) -> void:
	feel.ko(kind, who.position)
	feel.stop(kind, 0.0)
	feel.shake(kind, fight_time, false)
	sfx.ko_beat(kind == "boss_ko")
	if kind == "boss_ko":
		hud.flash_screen(0.22)


## Real seconds from the KO to the end banner (0 when there was no KO beat: a timeout, co-op).
func _ko_beat_len() -> float:
	if not feel.ko_active:
		return 0.0
	var m: Dictionary = FeelScript.moment(feel.ko_kind)
	return float(m.get("stop", 0.0)) + float(m.get("slow_s", 0.0)) + 0.1


func _banner_later(at: float, args: Array) -> void:
	_banner_at = at
	_banner_args = args
	if at <= 0.0:
		_tick_end_beat()


var _dissolved: bool = false
var _env_sat0: float = 1.0


## build 21: the victory shot's spacing. The ally fights at the hero's shoulder, so the two cheered
## overlapped (Bobo's cape over Armstrong). When the ally stands closer than WIN_SPACING across the
## view, it walks to WIN_SPACING on its own side (the other side by the kerb) and cheers there.
## Presentation only: the fight is over and its record is final (positions are not in it).
func _win_ally_step() -> void:
	_ally_to = Vector3.INF
	if ally == null or ally.dead or hero == null:
		return
	var rel: Vector3 = _flat(ally.position - hero.position)
	var across: float = rel.dot(_cam_right)
	if absf(across) >= WIN_SPACING * 0.85 and absf(rel.dot(_cam_fwd)) < 2.5:
		return
	var side: float = 1.0 if across >= 0.0 else -1.0
	var to: Vector3 = hero.position + _cam_right * side * WIN_SPACING - _cam_fwd * 0.4
	if absf(to.x) > ARENA_HALF_X:
		to = hero.position - _cam_right * side * WIN_SPACING - _cam_fwd * 0.4
	to.x = clampf(to.x, -ARENA_HALF_X, ARENA_HALF_X)
	to.y = ally.position.y
	_ally_to = to


func _tick_ally_step(dt: float) -> void:
	if _ally_to == Vector3.INF or ally == null or ally.dead:
		return
	var d: Vector3 = _flat(_ally_to - ally.position)
	if d.length() <= WIN_STEP_V * dt or d.length() < 0.05:
		ally.position = _ally_to
		ally.speed_now = 0.0
		ally.face(_flat(hero.position - ally.position).normalized().lerp(-_cam_fwd, 0.6), 0.0, 0.0)
		_ally_to = Vector3.INF
		ally.celebrate()
		return
	ally.position += d.normalized() * WIN_STEP_V * dt
	ally.speed_now = WIN_STEP_V
	ally.face(d, dt)


## Where the victory shot looks: the hero, or between the hero and the ally (where it is going).
func _winners_at() -> Vector3:
	var at: Vector3 = hero.position
	if ally != null and not ally.dead:
		var ap: Vector3 = _ally_to if _ally_to != Vector3.INF else ally.position
		if _flat(ap - hero.position).length() < 6.0:
			at = (hero.position + ap) * 0.5
	return at


## The end beat, per frame in "ending" (real time): the Guardian dissolves into motes and a
## reward beam, the world desaturates on a loss, the banner and its sting arrive on time.
func _tick_end_beat() -> void:
	if feel.ko_active and feel.ko_kind == "boss_ko" and not _dissolved and feel.ko_t >= 0.55 and enemy != null:
		_dissolved = true
		enemy.dissolve(0.7)
		fx.motes(enemy.position, enemy.size_k, _faction_col())
		fx.pillar(enemy.position, 9.0, 1.1, FeelScript.CRIT_MID, 0.9)
	if feel.desat > 0.0:
		_desaturate(feel.desat)
	if _banner_at >= 0.0 and _end_t >= _banner_at:
		_banner_at = -1.0
		var kind: String = str(_banner_args[2])
		hud.banner(str(_banner_args[0]), str(_banner_args[1]), FeelScript.CRIT_MID if kind == "win" else FeelScript.CREAM, 0.0, kind)
		sfx.sting(kind == "win")
		if kind == "win":
			_buzz("ko", 0.8)


func _faction_col() -> Color:
	var c: Variant = cfg.get("faction_color")
	if c is String and str(c).begins_with("#"):
		return Color(str(c))
	return FeelScript.SUN


## The hero's KO: the world's colour drains (art direction 7). A post pass, only for the end beat.
func _desaturate(k: float) -> void:
	if _env == null:
		if arena != null:
			for n: Node in arena.find_children("*", "WorldEnvironment", true, false):
				_env = (n as WorldEnvironment).environment
				break
		if _env == null and get_viewport().world_3d != null:
			_env = get_viewport().world_3d.environment
		if _env == null:
			return
		if not _env.adjustment_enabled:
			_env.adjustment_enabled = true
			_env.adjustment_brightness = 1.0
			_env.adjustment_contrast = 1.0
			_env.adjustment_saturation = 1.0
		_env_sat0 = _env.adjustment_saturation
	_env.adjustment_saturation = _env_sat0 * (1.0 - k)


func _restore_time() -> void:
	if Engine.time_scale != 1.0:
		Engine.time_scale = 1.0


# ------------------------------------------------------------ hud sync

func _sync_hud() -> void:
	hud.t_left = t_left
	for i in SKILL_N:
		hud.skill_cd[i] = _skill_cd[i]
		# disabled only when a press cannot count: during a swing or another skill it is buffered
		hud.skill_ok[i] = hero != null and state == "fighting" and not hero.dead and hero.stagger <= 0.0
	hud.attack_cd_k = 0.0
	if _action == "attack":
		hud.attack_cd_k = clampf(1.0 - _act_t / maxf(0.01, _act_len), 0.0, 1.0)
	if _action != "attack" and _since_swing > COMBO_RESET:
		_combo_shown = 0
	hud.combo_step = _combo_shown
	if five:
		# the hold's charge towards SPLIT (0..1, while it can still come), and whether the next ATTACK is the WHIRL finisher
		hud.hold_k = 0.0
		if _atk_down and not _hold_used and _skill_cd[1] <= 0.0 and state == "fighting":
			hud.hold_k = clampf(float(_jt() - _atk_down_cs) / float(HOLD_SPLIT_CS), 0.0, 1.0)
		hud.finisher_next = _skill_cd[2] <= 0.0 and _combo_next == FINISHER_AFTER + 1 \
			and (_action == "attack" or _since_swing <= COMBO_RESET)
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
		var shown: Array[FighterScript] = fighters.duplicate()
		if coop != null and coop.get("peer") != null and (coop.get("peer") as Node3D).visible:
			shown.append(coop.get("peer"))   # the other player's hero: its name and bar, a dot on the minimap
		for f: FighterScript in shown:
			units.append({"id": f.get_instance_id(), "name": f.display_name, "hp": f.hp, "max": f.max_hp, "team": f.team,
				"head": f.head_pos(), "feet": f.global_position, "chest": f.chest_pos(), "hw": f.radius * 0.85, "is_hero": f == hero, "shield": float(f.shield_hp) / float(SHIELD_HP) if f.shield_t > 0.0 else 0.0,
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
