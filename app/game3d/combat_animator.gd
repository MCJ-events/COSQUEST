extends RefCounted
## CombatAnimator (cq 233): one per fighter. The fight asks for a named state; if the
## loaded GLB has a clip for it, the clip plays (time-stretched to the gameplay length, so
## the hit timings never depend on the art); if not, a procedural pose on the skeleton
## (pose_layer.gd) and the body motion in fighter.gd stand in. See docs/game3d/COMBAT.md.
##
## States: idle walk run attack_1 attack_2 attack_3 heavy hit guard parry dodge
##         skill_charge skill_split skill_whirl skill_rally skill_shield death victory
##
## A clip is found by its exact state name first ("attack_1"), then by the aliases below,
## case-insensitive, ignoring "|" library prefixes and separators. To add a clip for a
## character, name the action in the GLB after the state (Blender action "attack_1").

const PoseLayer := preload("res://pose_layer.gd")
const AnimLib := preload("res://anim_library.gd")
const SecondaryMotion := preload("res://secondary_motion.gd")
const FootLock := preload("res://foot_lock.gd")
const DeadBlend := preload("res://dead_blend.gd")
const KoSettle := preload("res://ko_settle.gd")

# crossfades (s, real time): into a one-shot, back to a loop, into a hit react. fight-anim: Godot
# advances a crossfade with the player's speed_scale, so a clip warped to 2-3.6x used to finish its
# 0.08 s fade in one frame (a pose snap); play() now scales the fade by the clip's starting rate.
const BLEND_ACT: float = 0.08
const BLEND_LOOP: float = 0.18
const BLEND_HIT: float = 0.06
const BLEND_RECOVER: float = 0.26        # fight-anim: out of a hit reaction, a soft recovery
const BLEND_VICTORY_IDLE: float = 0.5    # fight-anim: the cheer settles into the idle loop
const BLEND_IN_MIN: Dictionary = {"skill_whirl": 0.17, "skill_split": 0.12}   # build 20 pass 2

# fight-anim: the most a clip's wind-up is sped up to land its contact frame on the gameplay hit.
# A faster wind-up starts later in the clip instead (the crossfade carries the body into it), so a
# 0.11 s strike no longer squeezes 12 frames of wind-up into 3 (3.6x, the arm snapped).
const WINDUP_RATE_MAX: float = 1.7
# fight-anim: a hit reaction plays at most this fast; a short game length shows the reaction's
# first part (the impact and the recoil) and BLEND_RECOVER carries it back, instead of the whole
# clip at 2.2-2.4x
const HIT_RATE_MAX: float = 1.3
const ONE_SHOTS: Array[String] = ["attack_1", "attack_2", "attack_3", "heavy", "parry", "dodge",
	"skill_charge", "skill_split", "skill_whirl", "skill_rally", "skill_shield", "skill_shoot", "skill_rain", "knockdown"]

# fight-anim: the additive flinch (pose_layer channels on top of whatever clip plays): a fast
# recoil away from the blow, then an eased return. Real time on the way in (it shows through the
# hit-stop), game time on the way back.
const FLINCH_IN: float = 0.05
const FLINCH_OUT: float = 0.32
const FLINCH_LEAN: float = 20.0          # degrees of spine lean at strength 1
const FLINCH_TILT: float = 12.0
const FLINCH_YAW: float = 9.0
const FLINCH_ARMS: float = 14.0

const STATES: Array[String] = ["idle", "walk", "run", "attack_1", "attack_2", "attack_3", "heavy",
	"hit", "guard", "parry", "dodge", "skill_charge", "skill_split", "skill_whirl", "skill_rally",
	"skill_shield", "death", "victory", "skill_shoot", "skill_rain"]
# anim-readable (13 Nov 2026): states only a clip library gives (anim_clips.json sets_readable,
# hero_poses): bigger and smaller hit reactions picked by the blow, the Guardian's knockdown and
# get-up when a parry staggers it, the hero's own intro beat. A model without them plays "hit" or
# nothing, as before.
const LIB_ONLY: Array[String] = ["hit_light", "hit_heavy", "knockdown", "intro"]
const LOOPING: Array[String] = ["idle", "walk", "run", "sprint", "guard"]
const LOCO: Array[String] = ["walk", "run", "sprint"]
# autorig: library-only states (anim_clips.json sets; no alias matching on a model's own clips).
# sprint = a fast run clip above the geometric mean of the run's and the sprint's ground speeds
# (both play at the same distance from 1x there), so the hero's top speed no longer plays the run
# at 1.8x; stagger = a backward step while a knockback shoves the
# body (fighter.gd), so the shove reads as steps, not a slide.
const STAGGER_RATE_MAX: float = 1.4
const HOLD_LAST: Array[String] = ["death", "victory"]   # victory settles into idle (fight-anim)
# realism-20261111: a KO fall and a cheer are never squeezed to the game length (a captured fall
# played 1.5 to 2x reads as a dropped doll): they play at most this fast and take the time they take
const DEATH_RATE_MAX: float = 1.25
const VICTORY_RATE_MAX: float = 1.2
# realism-20261111: foot locking (foot_lock.gd) is on from this much reported RAM, the same tier
# rule as the landscape fight (5 GiB reported = a 6 GB phone); config "foot_ik" overrides
const FOOT_IK_MIN_RAM: int = 5 * 1024 * 1024 * 1024
const FOOT_OFF_STATES: Array[String] = ["death", "dodge", "skill_whirl", "skill_charge", "skill_split", "knockdown"]
## fight-motion-31 (mid, high): the share of an action after which its feet are pinned again: SPLIT's slam has landed
## (fighter.gd's hop is over at 0.45), the DASH has stopped travelling (fight.gd CHARGE moves until 0.31 s of 0.42)
## and lands its lunge. Build 30 left them unpinned to the end: 0.5 to 0.9 m of slide after the landing.
const PIN_AFTER: Dictionary = {"skill_split": 0.5, "skill_charge": 0.78}

const ALIASES: Dictionary = {
	"idle": ["idle", "idle_loop", "breathing_idle"],
	"walk": ["walk", "walking", "walk_loop", "walk_forward"],
	"run": ["run", "running", "run_loop", "sprint", "jog"],
	"attack_1": ["attack1", "attack_a", "slash1", "sword_attack", "sword_slash", "punch_jab", "melee_attack"],
	"attack_2": ["attack2", "attack_b", "slash2", "sword_attack2", "punch_cross"],
	"attack_3": ["attack3", "attack_c", "slash3", "heavy_attack", "sword_heavy"],
	"heavy": ["heavy", "heavy_attack", "attack_heavy", "smash", "slam"],
	"hit": ["hit", "hit_react", "hitreact", "hurt", "take_damage", "damage"],
	"guard": ["guard", "block", "block_idle", "defend", "shield_block"],
	"parry": ["parry", "block_hit", "deflect", "counter"],
	"dodge": ["dodge", "roll", "dodge_roll", "evade"],
	"skill_charge": ["charge", "dash", "dash_attack", "lunge"],
	"skill_split": ["split", "ground_slam", "slam", "jump_attack"],
	"skill_whirl": ["whirl", "spin_attack", "spin", "whirlwind"],
	"skill_rally": ["rally", "buff", "cheer", "shout", "cast"],
	"skill_shield": ["shield", "barrier", "cast_shield", "spell"],
	"skill_shoot": ["shoot", "fire", "skill_shoot", "cast_shoot"],
	"skill_rain": ["rain", "skill_rain", "summon"],
	"death": ["death", "die", "dying", "defeat", "ko"],
	"victory": ["victory", "celebrate", "win", "cheer", "dance"],
}

# Procedural stand-ins: keyframes of [phase 0..1, {channel: degrees}] (pose_layer.gd channels).
# A missing channel is 0 (the clip's own pose). The phase runs over the state's game length.
const POSES: Dictionary = {
	"attack_1": [[0.0, {}], [0.16, {"spine_yaw": -32, "r_side": 80, "r_fwd": -15, "r_bend": 35}],
		[0.42, {"spine_yaw": 34, "spine_lean": 10, "r_side": 70, "r_fwd": 85, "r_bend": 5}], [1.0, {}]],
	"attack_2": [[0.0, {}], [0.16, {"spine_yaw": 30, "r_fwd": 70, "r_side": 5, "r_bend": 75}],
		[0.42, {"spine_yaw": -36, "spine_lean": 8, "r_side": 85, "r_fwd": 35, "r_bend": 0}], [1.0, {}]],
	"attack_3": [[0.0, {}], [0.28, {"spine_lean": -16, "r_fwd": 165, "l_fwd": 150, "r_bend": 30, "l_bend": 30}],
		[0.5, {"spine_lean": 32, "r_fwd": 55, "l_fwd": 50, "r_bend": 5, "l_bend": 5}],
		[0.8, {"spine_lean": 22, "r_fwd": 45, "l_fwd": 40}], [1.0, {}]],
	"heavy": [[0.0, {}], [0.3, {"spine_lean": -16, "r_fwd": 165, "l_fwd": 150, "r_bend": 30, "l_bend": 30}],
		[0.52, {"spine_lean": 32, "r_fwd": 55, "l_fwd": 50}], [1.0, {}]],
	"hit": [[0.0, {}], [0.18, {"spine_lean": -24, "spine_yaw": 12, "r_side": 28, "l_side": 28, "r_bend": 30, "l_bend": 30}], [1.0, {}]],
	"guard": [[0.0, {"r_fwd": 78, "r_bend": 105, "l_fwd": 78, "l_bend": 105, "spine_lean": 12}]],
	"parry": [[0.0, {"r_fwd": 78, "r_bend": 105, "l_fwd": 78, "l_bend": 105}], [0.25, {"r_fwd": 100, "r_side": 45, "r_bend": 20, "spine_yaw": -22}],
		[0.6, {"r_fwd": 55, "r_side": 75, "spine_yaw": 24}], [1.0, {}]],
	"dodge": [[0.0, {}], [0.2, {"spine_lean": 50, "r_fwd": 45, "l_fwd": 45, "r_bend": 70, "l_bend": 70}],
		[0.8, {"spine_lean": 40, "r_fwd": 35, "l_fwd": 35, "r_bend": 60, "l_bend": 60}], [1.0, {}]],
	"skill_charge": [[0.0, {}], [0.12, {"spine_lean": 35, "r_fwd": -45, "r_side": 25, "l_fwd": -35}],
		[0.7, {"spine_lean": 30, "r_fwd": 70, "r_side": 40, "l_fwd": -30}], [1.0, {}]],
	"skill_split": [[0.0, {}], [0.3, {"spine_lean": -22, "r_fwd": 175, "l_fwd": 175, "r_bend": 15, "l_bend": 15}],
		[0.48, {"spine_lean": 48, "r_fwd": 35, "l_fwd": 35}], [0.85, {"spine_lean": 40, "r_fwd": 30, "l_fwd": 30}], [1.0, {}]],
	"skill_whirl": [[0.0, {}], [0.12, {"r_side": 88, "l_side": 65, "spine_lean": 10}], [0.85, {"r_side": 88, "l_side": 65, "spine_lean": 10}], [1.0, {}]],
	"skill_rally": [[0.0, {}], [0.25, {"spine_lean": -12, "l_side": 165, "l_bend": 10, "r_side": 35}],
		[0.8, {"spine_lean": -10, "l_side": 165, "l_bend": 10, "r_side": 35}], [1.0, {}]],
	"skill_shield": [[0.0, {}], [0.2, {"r_fwd": 85, "r_bend": 95, "l_fwd": 85, "l_bend": 95, "spine_lean": 10}],
		[0.8, {"r_fwd": 85, "r_side": 30, "l_fwd": 85, "l_side": 30, "spine_lean": -8}], [1.0, {}]],
	"skill_shoot": [[0.0, {}], [0.3, {"l_fwd": 88, "l_side": 4, "spine_yaw": 18}], [0.42, {"l_fwd": 100, "spine_yaw": 18, "spine_lean": -6}],
		[0.85, {"l_fwd": 90, "spine_yaw": 16}], [1.0, {}]],
	"skill_rain": [[0.0, {}], [0.5, {"r_fwd": 175, "r_bend": 5, "spine_lean": -12}], [0.8, {"r_fwd": 165, "spine_lean": -8}], [1.0, {"r_fwd": 95, "spine_lean": 6}]],
	"death": [[0.0, {}], [0.3, {"spine_lean": -28, "r_side": 55, "l_side": 55}], [1.0, {"spine_lean": -28, "r_side": 70, "l_side": 70}]],
	"victory": [[0.0, {}], [0.25, {"r_fwd": 170, "r_bend": 10, "spine_lean": -8}], [1.0, {"r_fwd": 170, "r_bend": 10, "spine_lean": -8}]],
}

var player: AnimationPlayer
var skeleton: Skeleton3D
var secondary: Node              # SecondaryMotion (cq 014) when the rig has chains
var layer: PoseLayer
var clips: Dictionary = {}       # state -> clip name in the player
var state: String = "idle"
var t: float = 0.0
var length: float = 0.0          # game length of the current one-shot state (0 = looping)
var frozen: bool = false
var walk_rate: float = 1.0
var hand_r: Node3D               # the right-hand attach point (BoneAttachment3D or a stand-in)
var lib_key: String = ""         # the cast key whose clip library is bound ("" = none)
var timing: Dictionary = {}      # state -> {clip, frames, fps, contact, in, out, body} from anim_clips.json
var _warp: Array = []            # [clip time at the hit, speed before it, speed after it, game time of the hit]
var _clip_t: float = 0.0         # where the one-shot clip should be (seconds into the clip)
var hip_h: float = 0.9           # the model's hip height in metres (locomotion rate)
var _after: String = ""          # fight-anim: the one-shot that just ended (picks the blend back)
## anim-readable: a one-shot's tail (anim_clips.json clips.<name>.tail, frames): once the game length is
## over, a body that stands still and is asked for nothing else plays on past the clip's "out" at its
## natural speed (SHOOT holds its aim, RAIN's arm comes down to the circle as the volleys fall). Any
## new state, a walk or a hit ends it at once. Presentation only: the action itself is over.
var _tail: float = 0.0           # seconds of tail the current one-shot has
var in_tail: bool = false
## anim-readable: a standing body breathes (the chest rises and falls) and shifts its weight from foot to
## foot (the trunk sways over the hips), slowly, on top of the idle clip (opts "breathe")
var breathe: bool = false
var _breath_t: float = 0.0
const BREATH_PERIOD: float = 3.8
const SHIFT_PERIOD: float = 7.4
var _victory_idle: bool = false  # fight-anim: the cheer has settled into the idle loop
## moves-fix-32 (mid, high): the cheer holds its own last pose (the captured fist pump ends with the sword raised in front)
## and breathes, instead of settling into the idle loop. The idle under VICTORY had no arm droop (a celebrating body is
## passed as "dead" for the stance layers), so the arms stood out from the body in an A-pose under the banner.
var _victory_hold: bool = false
const VICTORY_BREATH: float = 1.6        # the chest heaves a little more after a fight
var _flinch_t: float = -1.0      # fight-anim: seconds into the current flinch (-1 = none)
var _flinch_k: float = 0.0       # its strength
var _flinch_dir: Vector3 = Vector3.ZERO   # the push, in the character's own frame (+Z forward)
## moves-fix-32 (mid, high): a blow taken on the guard. Build 31 fired the stagger clip off the block's 0.5 m push, so a good
## block looked like being hit (the guard broke into a stumble, the sword dropped). The guard clip now holds and this recoil
## plays on it instead: the trunk rocks back, the arms are driven in toward the chest behind the blade, then it recovers
## (fighter.gd's hips give, GIVE_M, goes with it). Its envelope is the flinch's.
const BLOCK_POSE: Dictionary = {"spine_lean": -11.0, "r_bend": 16.0, "l_bend": 14.0, "r_fwd": -10.0, "l_fwd": -8.0, "spine_tilt": 0.0}
var _flinch_block: bool = false
## build 21: how much of its arms' spread a character takes back while it stands, walks, reels or
## is hit (pose_layer.gd arm_droop; 0 = none). The Guardian's retargeted arms stand out 65 deg in
## every clip, and its stagger read as a T-pose from the game camera (fighter.gd sets it for a boss).
var arm_droop: float = 0.0
var _droop_now: float = 0.0
var char_droop: float = 0.0             # the bound character's own arm droop (see _bind_library)
var char_droop_free: float = 30.0
## realism-20261111: foot locking (null = off for this device tier or this model has no legs)
var foot: FootLock
var floor_y: float = 0.0         # the paving under the fighter (fighter.gd sets it each frame)
## realism-20261111: state -> the library state whose clip plays it this time (fighter.gd: a shove
## from behind plays "stagger_fwd" as the stagger, a KO from behind "death_fwd" as the death)
var variant: Dictionary = {}
var natural_rates: bool = false  # realism-20261111: the KO fall and the cheer at a natural speed (opts "natural_rates")
## realism round 2: the bind-pose guard is a switch too (opts "no_bind"). Build 21 shows the rest
## pose from the moment a model appears until its first state change (set_model plays "idle" while
## the state already is "idle", so nothing starts): with the switch off that is kept, to the frame.
var no_bind: bool = false
## realism round 2: the upper-body layer (opts "run_layer"). A one-shot that starts while the body
## is running keeps the run's hips and legs under the action's upper body (the ally casts on the
## run: a standing clip on a moving body was most of the foot sliding left); and a "blend" state
## (anim_library.gd) plays a captured upper body on the classic clip's lunge. Both are one mixed
## clip built when the action starts (9 tracks resampled: a fraction of a millisecond).
var run_layer: bool = false
var legs_run: bool = false       # the current one-shot's legs are the run cycle (foot_lock: loco reach)
var _speed_now: float = 0.0
## realism round 2 (weight): 0..1, how far the body is wound up for the next blow while it stands
## in reach of a living opponent (fighter.gd sets `ready`); the first frames of a swing then start
## from a loaded pose, not from a hanging arm.
var ready: bool = false
var _ready_w: float = 0.0
## fight-look-31 (look "fl_motion", fighter.gd sets it): 0..1, the open hands of a standing body turned palm in and the
## elbows a little soft (FL_RELAX_POSE), so an idle or the hero's intro beat is not two stiff palms facing the camera.
## The weapon hand only softens its elbow (a twist would turn the weapon in it). 0 = build 30.
var relax: float = 0.0
const FL_RELAX_POSE: Dictionary = {"l_twist": 65.0, "l_bend": 12.0, "r_bend": 8.0}
const FL_RELAX_STATES: Array[String] = ["idle", "_", "intro"]
const READY_RATE: float = 6.0
const LOCO_HOLD: float = 0.3             # fight-motion-31: s a locomotion state is held before a slower one
var _loco_t: float = 0.0
const READY_STATES: Array[String] = ["idle", "_", "walk"]
const READY_POSE: Dictionary = {"spine_yaw": -12.0, "spine_lean": 5.0, "r_fwd": 30.0, "r_bend": 55.0, "r_side": 12.0, "l_fwd": 18.0, "l_bend": 35.0}
const LOWER_BONES: Array[String] = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]
const MIX_STATES: Array[String] = ["attack_1", "attack_2", "attack_3", "heavy", "parry", "skill_rally", "skill_shield"]
const DROOP_STATES: Array[String] = ["idle", "_", "walk", "run", "sprint", "hit", "stagger"]
const DROOP_RATE: float = 8.0            # 1/s: eases in and out round the attacks
## moves-fix-32 (mid, high): the share of each arm's spread (x: the sword arm, y: the off arm) taken back while a clip flings
## the arms out. The DASH's arms went out wide to the sides (near a T from the front) and the whirl held both arms locked
## out at shoulder height for 8 frames: the off arm now stays in by the body and the sword arm keeps its sweep, lower.
const ARM_TUCK: Dictionary = {"skill_charge": Vector2(0.45, 0.8), "skill_whirl": Vector2(0.3, 0.85)}
const TUCK_RATE: float = 16.0            # 1/s: in by the DASH's take-off (0.26 s of travel)
var _tuck: Vector2 = Vector2.ZERO
## moves-fix-32 (mid, high): the end of a one-shot. A clip whose last key came a frame before its state's end (the DASH,
## SHIELD and RALLY tails end on the clip's last key; the whirl and the knockdown play to it) ran out in the player one
## frame early: one frame with no clip, then the idle came in with a jump. The clip is now held a hair before its end until
## the state hands over, and the hand-over is dead-blended as every other switch.
const END_KEEP: float = 0.002            # s short of the clip's end
const END_MARGIN: float = 1.5            # frame-time headroom
## moves-fix-32 (mid, high): a run that stops. The run used to stand up into the idle in 0.25 s and go dead still. Now the
## legs and arms come together over STOP_BLEND and the trunk carries on forward, then settles back in decaying bounces
## (Wale's weighted-step reference), scaled by how fast the body was going.
const STOP_BLEND: float = 0.36
const STOP_LEAN: float = 10.0            # deg of forward carry from a full run
const STOP_PERIOD: float = 0.46          # s of one bounce
const STOP_DECAY: float = 0.17           # s
const STOP_LEN: float = 0.8
const STOP_FULL: float = 4.6             # m/s: the hero's full-stick run
var _stop_t: float = -1.0
var _stop_k: float = 0.0
var _loco_speed: float = 0.0
var _blend_max: float = 0.25             # the next dead blend's longest (STOP_BLEND for a stop)

## fid29 combat (build 29): on the mid and high tiers (the fighter's look "real", and "fid_combat" unless it is
## false) the animator installs, in bind():
##   * dead blending (dead_blend.gd): clips switch with no crossfade (one clip evaluated) and the body carries on
##     from its own motion into the new clip over 0.15 to 0.25 s
##   * directional hit reactions: flinch() layers a captured recoil (front, back, left, right; data/anim_real.json)
##     on the spine, neck and arms (pose_layer.gd add_layers), scaled by the blow, 0.25 to 0.4 s
##   * the KO settle (ko_settle.gd): a partial ragdoll after the fall's impact, only once the result is final
##   * captured victory and intro clips and GUARD variants from anim/real/<key>.glb (never the build 28 files),
##     a variant picked by a hash of the fighter's slot and its swing count (never the fight's RNG)
## The low tier gets none of it: its libraries, flinch and timings are build 28's to the frame.
## `fid_force` (tests and the probe): -1 = by the look, 0 = off, 1 = on.
static var fid_force: int = -1
var fid: bool = false
var dead_blend: DeadBlend
var pose_guard: DeadBlend                # the same script with guard on: after the foot lock, before the cloth
var ko: KoSettle
var _slot: String = ""
var _swings: int = 0
var _variants: Dictionary = {}           # state -> [clip names in the player] (index 0 = build 28's)
var _hit_anims: Dictionary = {}          # "front" | "back" | "left" | "right" | "front_heavy" | "front_light" -> Animation
var _hit_gain: Dictionary = {}           # the same keys -> the largest share of the reaction this hero's mesh takes (data)
var _add_t: float = -1.0                 # seconds into the clip hit reaction (-1 = none)
var _add_len: float = 0.3
var _add_w: float = 1.0
var _add_set: Array = []                 # [[Animation, share], ...]
const ADD_LEN: Vector2 = Vector2(0.25, 0.4)


## Finds the AnimationPlayer and Skeleton3D under `model`, maps clips to states, adds the
## pose layer and the hand_r attach point. `body` hosts the stand-in hand if there is no
## skeleton. `opts`: {key: cast key hint, class: weapon class}; when the skeleton is a cast
## character with a clip library (anim_library.gd), the library's clips for that weapon
## class take every state they cover. Returns {clips: {state: clip}, procedural: [states],
## bones: n, hand: "bone"|"standin", library: key}.
func bind(model: Node3D, body: Node3D, opts: Dictionary = {}) -> Dictionary:
	clips.clear()
	timing.clear()
	lib_key = ""
	char_droop = 0.0
	player = null
	skeleton = null
	layer = null
	secondary = null
	foot = null
	variant.clear()
	fid = false
	dead_blend = null
	pose_guard = null
	ko = null
	_variants.clear()
	_hit_anims.clear()
	_hit_gain.clear()
	_add_t = -1.0
	_add_set = []
	var skels: Array[Node] = model.find_children("*", "Skeleton3D", true, false)
	if skels.size() > 0:
		skeleton = skels[0] as Skeleton3D
	var players: Array[Node] = model.find_children("*", "AnimationPlayer", true, false)
	if players.size() > 0:
		player = players[0] as AnimationPlayer
		var names: PackedStringArray = player.get_animation_list()
		for st: String in STATES:
			var c: String = _match(names, st)
			if c != "":
				clips[st] = c
	if skeleton != null:
		_bind_library(model, str(opts.get("key", "")), str(opts.get("class", "")))
	if player != null:
		for st: String in clips:
			var a: Animation = player.get_animation(clips[st])
			if a != null:
				a.loop_mode = Animation.LOOP_LINEAR if st in LOOPING else Animation.LOOP_NONE
	var nb: int = 0
	if skeleton != null:
		layer = PoseLayer.new()
		layer.name = "CombatPose"
		layer.frame_root = model
		skeleton.add_child(layer)
		nb = layer.bind_bones()
		# foot locking, after the pose layer and before the cloth (device tier, or config "foot_ik")
		natural_rates = bool(opts.get("natural_rates", false))
		no_bind = bool(opts.get("no_bind", false))
		run_layer = bool(opts.get("run_layer", false))
		breathe = bool(opts.get("breathe", false))
		relax = float(opts.get("relax", 0.0))
		if bool(opts.get("foot_ik", false)) and not clips.is_empty():
			var fl := FootLock.new()
			fl.name = "FootLock"
			fl.frame_root = model
			skeleton.add_child(fl)
			if fl.setup(skeleton) == 2:
				foot = fl
			else:
				skeleton.remove_child(fl)
				fl.free()
		# robes, coats, skirts, wings, flames (cq 014): after the pose layer, so they hang from
		# the final pose
		secondary = null
		if bool(opts.get("secondary", true)):
			var sm := SecondaryMotion.new()
			sm.name = "SecondaryMotion"
			if sm.setup(skeleton) > 0:
				skeleton.add_child(sm)
				secondary = sm
			else:
				sm.free()
		_fid_setup(body)
	hand_r = _make_hand(body)
	var proc: Array[String] = []
	for st: String in STATES:
		if not clips.has(st):
			proc.append(st)
	return {"clips": clips.duplicate(), "procedural": proc, "bones": nb, "hand": str(hand_r.get_meta("kind", "standin"))}


static func foot_ik_default() -> bool:
	return int(OS.get_memory_info().get("physical", 0)) >= FOOT_IK_MIN_RAM


## fid29 combat: true on the real-look tiers (mid, high), from the fighter's look.
static func fid_on(body: Node) -> bool:
	if fid_force >= 0:
		return fid_force == 1
	var f: Node = body.get_parent() if body != null else null
	if f == null or not ("look" in f):
		return false
	var lk: Variant = f.get("look")
	if not (lk is Dictionary):
		return false
	return bool((lk as Dictionary).get("real", false)) and bool((lk as Dictionary).get("fid_combat", true))


## fid29 combat: installs dead blending, the KO settle and the captured clips (see the note at the top).
func _fid_setup(body: Node) -> void:
	if skeleton == null or not fid_on(body):
		return
	fid = true
	var f: Node = body.get_parent() if body != null else null
	_slot = "%s%s" % [str(f.get("role")) if f != null and "role" in f else "", str(f.get("team")) if f != null and "team" in f else ""]
	_swings = 0
	if player != null and not clips.is_empty():
		var db := DeadBlend.new()
		db.name = "DeadBlend"
		skeleton.add_child(db)
		skeleton.move_child(db, 0)     # first of the modifiers: the pose layer, foot lock and cloth act on the blended pose
		if db.bind_bones(skeleton) > 0:
			dead_blend = db
		else:
			skeleton.remove_child(db)
			db.free()
		var pg := DeadBlend.new()
		pg.name = "PoseGuard"
		pg.guard = true
		skeleton.add_child(pg)
		# after the pose layer and the foot lock (the final leg pose), before the cloth (it hangs from the guarded pose)
		var after: Node = foot if foot != null else layer
		if after != null:
			skeleton.move_child(pg, after.get_index() + 1)
		if pg.bind_bones(skeleton) > 0:
			pose_guard = pg
			pg.foot_lock = foot   # fight-motion-31: the feet are put back on their pins after the smoothing
		else:
			skeleton.remove_child(pg)
			pg.free()
	ko = KoSettle.new()
	ko.skeleton = skeleton
	if lib_key == "" or player == null:
		return
	var rc: Dictionary = AnimLib.real_for(lib_key, skeleton)
	if rc.is_empty():
		return
	var rl: AnimationLibrary = AnimLib.load_library(str(rc.get("library", "")))
	if rl == null:
		return
	AnimLib.apply(player, skeleton, rl, AnimLib.REAL_LIB)
	var meta: Dictionary = AnimLib.real_data().get("clips", {})
	var pre: String = AnimLib.REAL_LIB + "/"
	for st: String in (rc.get("states", {}) as Dictionary):
		var cn: String = str(rc["states"][st])
		if not player.has_animation(pre + cn):
			continue
		player.get_animation(pre + cn).loop_mode = Animation.LOOP_NONE
		clips[st] = pre + cn
		var m: Dictionary = (meta.get(cn, {}) as Dictionary).duplicate()
		m["clip"] = cn
		m["real"] = true
		timing[st] = m
	for st: String in (rc.get("variants", {}) as Dictionary):
		if not clips.has(st):
			continue
		var vs: Array = [clips[st]]
		for cn: Variant in rc["variants"][st]:
			if player.has_animation(pre + str(cn)):
				player.get_animation(pre + str(cn)).loop_mode = Animation.LOOP_LINEAR if st in LOOPING else Animation.LOOP_NONE
				vs.append(pre + str(cn))
		if vs.size() > 1:
			_variants[st] = vs
	for d: String in (rc.get("hit", {}) as Dictionary):
		var hn: String = pre + str(rc["hit"][d])
		if player.has_animation(hn):
			_hit_anims[d] = player.get_animation(hn)
			_hit_gain[d] = float((rc.get("hit_gain", {}) as Dictionary).get(d, 1.0))


## fid29 combat: which of a state's variants plays this time: a hash of the fighter's slot and its swing
## count (the same fight shows the same picks; the fight's seeded RNG is never read).
func variant_pick(st: String, n: int) -> int:
	var vs: Array = _variants.get(st, [])
	if vs.size() < 2:
		return 0
	return posmod(hash("%s:%s:%d" % [_slot, st, n]), vs.size())


## fid29 combat: a clip switch with no crossfade, dead-blended from the body's own motion instead.
func _dead_play(clip: String, blend: float, hit_at: float = -1.0) -> void:
	player.play(clip, 0.0, 1.0)
	var d: float = clampf(blend * 2.0, 0.15, maxf(0.25, _blend_max))
	_blend_max = 0.25
	if hit_at > 0.02:
		d = minf(d, maxf(hit_at, 0.1))   # a strike's contact frame shows the clip's own pose
	dead_blend.start(d)


## The cast clip library (cq 012): adds it to the model's AnimationPlayer (made if the GLB has
## none) and maps the weapon class's set onto the states. A looping state gets its own copy
## of a clip that a one-shot state also uses, so the loop flag never fights.
func _bind_library(model: Node3D, hint: String, cls: String) -> void:
	var key: String = AnimLib.key_for(skeleton, hint)
	if key == "":
		return
	var lib: AnimationLibrary = AnimLib.library(key)
	if lib == null:
		return
	if player == null:
		player = AnimationPlayer.new()
		player.name = "AnimationPlayer"
		model.add_child(player)
		player.root_node = player.get_path_to(model)
	AnimLib.apply(player, skeleton, lib)
	if cls == "":
		# nothing in hand: the character's own prop decides (Nebul-X's staff is part of her model)
		cls = str(((AnimLib.data().get("characters", {}) as Dictionary).get(key, {}) as Dictionary).get("default_class", ""))
	var st_map: Dictionary = AnimLib.states_for(cls, key)
	var used: Dictionary = {}
	for st: String in st_map:
		var name: String = AnimLib.LIB_NAME + "/" + str(st_map[st]["clip"])
		if not player.has_animation(name):
			continue
		if st in LOOPING and used.has(name):
			name = _loop_copy(name)
		elif st in LOOPING:
			name = _loop_copy(name)
		used[name] = true
		clips[st] = name
		timing[st] = st_map[st]
	lib_key = key
	# realism (12 Nov 2026): a realistic body under the stylised clips. The classic clips hold the
	# upper arms 55 to 65 degrees out from hanging (made for chunky figures); on a hero that reads
	# as "arms out". A character's "arm_droop" (anim_clips.json, written by add_hero.sh) takes that
	# spread back in the standing, moving and reeling states, down to "arm_free_deg" from hanging.
	var chd: Dictionary = (AnimLib.data().get("characters", {}) as Dictionary).get(key, {})
	char_droop = float(chd.get("arm_droop", 0.0))
	char_droop_free = float(chd.get("arm_free_deg", PoseLayer.DROOP_FREE))
	var hb: int = skeleton.find_bone("Hips")
	if hb >= 0:
		hip_h = skeleton.get_bone_global_rest(hb).origin.y * model.scale.y


## The locomotion clip's playback rate for a ground speed (m/s): the planted foot moves at
## the body's speed, so the feet do not slide.
func _loco_rate(st: String, speed_now: float) -> float:
	var gs: float = float((timing.get(st, {}) as Dictionary).get("ground_speed_per_hip", 0.0)) * hip_h
	if gs <= 0.01:
		return clampf(speed_now / 2.6, 0.8, 1.9)
	return clampf(speed_now / gs, 0.5, 2.4)


## fight-motion-31: idle < walk < run < sprint (LOCO_HOLD)
static func _loco_rank(st: String) -> int:
	return {"walk": 1, "run": 2, "sprint": 3}.get(st, 0)


func _loop_copy(name: String) -> String:
	var copy: String = name + "__loop"
	var lib: AnimationLibrary = player.get_animation_library(AnimLib.LIB_NAME)
	if not lib.has_animation(copy.get_slice("/", 1)):
		var a: Animation = player.get_animation(name).duplicate(true)
		a.loop_mode = Animation.LOOP_LINEAR
		lib.add_animation(copy.get_slice("/", 1), a)
	return copy


## True when the state's clip wants the procedural body motion on top (data: "body": true).
func body_with_clip(st: String) -> bool:
	return bool((timing.get(st, {}) as Dictionary).get("body", false))


static func _norm(s: String) -> String:
	var n: String = s.to_lower()
	if n.contains("|"):
		n = n.get_slice("|", n.get_slice_count("|") - 1)
	return n.replace(" ", "_").replace("-", "_").replace(".", "_")


func _match(names: PackedStringArray, st: String) -> String:
	for n: String in names:
		if _norm(n) == st:
			return n
	for alias: String in ALIASES.get(st, []):
		for n: String in names:
			if _norm(n) == alias:
				return n
	if st in ["idle", "walk", "victory"]:   # the 056/060 packs name them loosely ("celebrate", "Idle_A")
		for alias: String in ALIASES.get(st, []):
			for n: String in names:
				if _norm(n).contains(alias):
					return n
	return ""


const HAND_BONES: Array = ["RightHand", "hand_r", "hand.R", "Hand_R", "RightHandMiddle1", "mixamorig:RightHand"]


func _make_hand(body: Node3D) -> Node3D:
	if skeleton != null:
		var b: int = PoseLayer.find_bone(skeleton, HAND_BONES)
		if b >= 0:
			var ba := BoneAttachment3D.new()
			ba.name = "hand_r"
			ba.bone_name = skeleton.get_bone_name(b)
			ba.set_meta("kind", "bone")
			skeleton.add_child(ba)
			return ba
	var n := Node3D.new()
	n.name = "hand_r"
	n.position = Vector3(-0.38, 1.0, 0.18)   # its right side (+X is its left), waist high, a little forward
	n.set_meta("kind", "standin")
	body.add_child(n)
	return n


func has_clip(st: String) -> bool:
	return clips.has(st)


## Plays a state. `game_len` > 0 makes it a one-shot of that many seconds (a clip is
## time-stretched to fit); 0 makes it a loop. `hit_at` (seconds into the state, when the
## gameplay strike lands): a clip with a contact frame in the data is time-warped in two
## pieces so that frame shows exactly then (the hitbox and the art agree). Returns true when
## a clip plays it.
func play(st: String, game_len: float = 0.0, hit_at: float = -1.0, blend: float = -1.0) -> bool:
	var restart: bool = game_len > 0.0
	if st == state and not restart:
		return clips.has(st)
	var was: String = state
	if was == "_" and _after != "":
		was = _after
	_after = ""
	state = st
	t = 0.0
	length = game_len
	_warp = []
	_victory_idle = false
	_victory_hold = false
	_tail = 0.0
	in_tail = false
	if player == null or not clips.has(st):
		# no clip: idle/walk still come from the clip map when it has them
		return false
	var key: String = st
	if variant.has(st) and clips.has(str(variant[st])):
		key = str(variant[st])
	var clip: String = clips[key]
	if fid:
		if st in ONE_SHOTS:
			_swings += 1
		if _variants.has(key):
			clip = str((_variants[key] as Array)[variant_pick(key, _swings)])
	var a: Animation = player.get_animation(clip)
	if blend < 0.0:
		blend = BLEND_HIT if st == "hit" else (BLEND_ACT if restart else BLEND_LOOP)
		if was in LOOPING:
			blend = BLEND_ACT if restart else BLEND_LOOP
		elif (was == "hit" or was == "stagger") and not restart:
			blend = BLEND_RECOVER
		# build 20 pass 2: the spin's first pose is far from any swing's last (the off forearm
		# turned 148-157 deg in one frame going into the whirl): it fades in over a few frames more
		blend = maxf(blend, float(BLEND_IN_MIN.get(st, 0.0)))
	var m: Dictionary = timing.get(key, {})
	var fps: float = float(m.get("fps", 30.0))
	var t_in: float = float(m.get("in", 0)) / fps
	var t_out: float = a.length if a != null else 0.0
	if m.has("out"):
		t_out = minf(t_out, float(m["out"]) / fps)
	if restart and (st == "hit" or st == "stagger") and a != null:
		# fight-anim: the reaction's opening at a natural speed, not the whole clip squeezed
		t_out = minf(t_out, t_in + game_len * (HIT_RATE_MAX if st == "hit" else STAGGER_RATE_MAX))
	if restart and a != null and t_out - t_in > 0.01:
		var c_t: float = float(m.get("contact", -1)) / fps
		if hit_at > 0.02 and hit_at < game_len - 0.02 and c_t > t_in and c_t < t_out:
			# fight-anim: cap the wind-up speed; skip into the wind-up instead
			if (c_t - t_in) / hit_at > WINDUP_RATE_MAX:
				t_in = c_t - hit_at * WINDUP_RATE_MAX
			_warp = [c_t, (c_t - t_in) / hit_at, (t_out - c_t) / (game_len - hit_at), hit_at]
		else:
			_warp = [t_out, (t_out - t_in) / game_len, (t_out - t_in) / game_len, game_len]
			if natural_rates and (st == "death" or st == "victory"):
				# realism-20261111: at a natural speed; the state lasts as long as the clip then takes
				var cap: float = DEATH_RATE_MAX if st == "death" else VICTORY_RATE_MAX
				var r: float = clampf((t_out - t_in) / game_len, 0.7, cap)
				_warp = [t_out, r, r, game_len]
				if st == "victory":
					length = (t_out - t_in) / r
		# a short strike cannot spend more than ~70 % of its wind-up fading in; a long wind-up (the
		# Guardian's 0.8 s) fades in over 30 % of it (up to 0.25 s), not 0.08 s: its two-hand chop
		# starts far from the idle pose (the off forearm swung 100 deg in one frame)
		if hit_at > 0.02:
			blend = maxf(minf(blend, hit_at * 0.7), minf(hit_at * 0.3, 0.25))
	_clip_t = t_in
	if restart and float(m.get("tail", 0)) > 0.0 and a != null:
		_tail = minf(float(m["tail"]) / fps, maxf(0.0, a.length - t_out))
	legs_run = false
	if run_layer and restart and a != null and not _warp.is_empty() and st in MIX_STATES:
		var mixed: String = ""
		if was in LOCO and _speed_now > 1.2 and clips.has(was) and player.current_animation == clips[was]:
			# the run goes on under the action: its phase now, its rate, in game time
			mixed = _mix(clip, clips[was], t_in, t_out, player.current_animation_position, walk_rate, {}, st)
			legs_run = mixed != ""
		elif m.has("lower"):
			var lm: Dictionary = m["lower"]
			var lname: String = AnimLib.LIB_NAME + "/" + str(lm.get("clip", ""))
			if player.has_animation(lname):
				mixed = _mix(clip, lname, t_in, t_out, 0.0, 1.0, {"meta": lm, "len": game_len, "hit_at": hit_at}, st)
		if mixed != "":
			clip = mixed
	# fight-anim: the fade runs in clip time (speed_scale), so ask for blend x rate to get `blend` s
	var rate0: float = float(_warp[1]) if not _warp.is_empty() else (walk_rate if st in LOCO else 1.0)
	if dead_blend != null:
		_dead_play(clip, blend, hit_at)
	else:
		player.play(clip, blend * maxf(rate0, 0.05), 1.0)
	player.seek(t_in, true)
	if ko != null and st == "death":
		ko.impact_t = KoSettle.impact_of(a)
	if not _warp.is_empty():
		player.speed_scale = 0.0 if frozen else float(_warp[1])
	return true


## realism round 2: one clip from two. The upper body (and every track but the hips and legs) is
## `upper`'s; the hips and legs are `lower`'s, sampled where the lower clip would be at the same
## game time: a loop running on from `phase0` at `rate` (the run under a cast), or, with
## `timed`, a one-shot warped to the same game length and hit time (the classic lunge under a
## captured swing; its own contact frame lands on the hit). Returns the mixed clip's name ("" if
## it could not be built).
func _mix(upper: String, lower: String, t_in: float, t_out: float, phase0: float, rate: float, timed: Dictionary, st: String) -> String:
	var ua: Animation = player.get_animation(upper)
	var la: Animation = player.get_animation(lower)
	if ua == null or la == null or la.length <= 0.01 or _warp.is_empty():
		return ""
	var mix: Animation = ua.duplicate(true)
	mix.loop_mode = Animation.LOOP_NONE
	# the lower clip's own timing when it is a one-shot (as play() would warp it)
	var l_in: float = 0.0
	var l_out: float = la.length
	var l_c: float = -1.0
	var hit_at: float = float(_warp[3])
	var glen: float = float(timed.get("len", 0.0))
	if not timed.is_empty():
		var lm: Dictionary = timed["meta"]
		var lfps: float = float(lm.get("fps", 30.0))
		l_in = float(lm.get("in", 0)) / lfps
		if lm.has("out"):
			l_out = minf(l_out, float(lm["out"]) / lfps)
		l_c = float(lm.get("contact", -1)) / lfps
		if l_c > l_in and l_c < l_out and hit_at > 0.02 and (l_c - l_in) / hit_at > WINDUP_RATE_MAX:
			l_in = l_c - hit_at * WINDUP_RATE_MAX
	var step: float = 1.0 / 30.0
	for i in mix.get_track_count():
		var bone: String = str(mix.track_get_path(i).get_concatenated_subnames())
		if not (bone in LOWER_BONES):
			continue
		var typ: int = mix.track_get_type(i)
		if typ != Animation.TYPE_ROTATION_3D and typ != Animation.TYPE_POSITION_3D:
			continue
		var li: int = la.find_track(mix.track_get_path(i), typ)
		if li < 0:
			continue
		for k in range(mix.track_get_key_count(i) - 1, -1, -1):
			mix.track_remove_key(i, k)
		var tau: float = t_in
		while tau <= t_out + 0.0001:
			# game time at this point of the upper clip (the two-piece warp)
			var g: float = (tau - t_in) / maxf(0.01, float(_warp[1])) if tau < float(_warp[0]) else hit_at + (tau - float(_warp[0])) / maxf(0.01, float(_warp[2]))
			var lt: float
			if timed.is_empty():
				lt = fposmod(phase0 + rate * g, la.length)
			elif l_c > l_in and l_c < l_out and hit_at > 0.02 and glen > hit_at:
				lt = l_in + (l_c - l_in) * (g / hit_at) if g < hit_at else l_c + (l_out - l_c) * minf(1.0, (g - hit_at) / (glen - hit_at))
			else:
				lt = l_in + (l_out - l_in) * clampf(g / maxf(0.01, glen), 0.0, 1.0)
			if typ == Animation.TYPE_ROTATION_3D:
				mix.rotation_track_insert_key(i, tau, la.rotation_track_interpolate(li, lt))
			else:
				mix.position_track_insert_key(i, tau, la.position_track_interpolate(li, lt))
			tau += step
	# the upper body keeps the orientation the upper clip gives it in the world: the spine's turn
	# is re-expressed on the new hips (a captured swordsman stands side-on; on the run's
	# forward-facing hips his slash would otherwise go 80 degrees wide)
	var hp: NodePath = NodePath()
	var sp_i: int = -1
	for i in mix.get_track_count():
		if mix.track_get_type(i) != Animation.TYPE_ROTATION_3D:
			continue
		var bn: String = str(mix.track_get_path(i).get_concatenated_subnames())
		if bn == "Hips":
			hp = mix.track_get_path(i)
		elif bn == "Spine":
			sp_i = i
	var uh: int = ua.find_track(hp, Animation.TYPE_ROTATION_3D) if hp != NodePath() else -1
	var mh: int = mix.find_track(hp, Animation.TYPE_ROTATION_3D) if hp != NodePath() else -1
	var us: int = ua.find_track(mix.track_get_path(sp_i), Animation.TYPE_ROTATION_3D) if sp_i >= 0 else -1
	if uh >= 0 and mh >= 0 and us >= 0:
		for k in range(mix.track_get_key_count(sp_i) - 1, -1, -1):
			mix.track_remove_key(sp_i, k)
		var tau2: float = t_in
		while tau2 <= t_out + 0.0001:
			var q: Quaternion = mix.rotation_track_interpolate(mh, tau2).inverse() * ua.rotation_track_interpolate(uh, tau2) * ua.rotation_track_interpolate(us, tau2)
			mix.rotation_track_insert_key(sp_i, tau2, q.normalized())
			tau2 += step
	var lib: AnimationLibrary = player.get_animation_library(AnimLib.LIB_NAME)
	var name: String = "__mix_" + st
	if lib.has_animation(name):
		lib.remove_animation(name)
	lib.add_animation(name, mix)
	return AnimLib.LIB_NAME + "/" + name


## fight-anim: an additive recoil on top of whatever plays (the clip keeps running): `push` is the
## blow's direction in the world, `strength` about 0.5 (blocked or light) to 1.4 (a crit). A new
## blow restarts it from the current depth, so a flurry stays a recoil, not a twitch.
func flinch(push: Vector3, strength: float) -> void:
	if layer == null or layer.frame_root == null or not layer.frame_root.is_inside_tree():
		return
	var local: Vector3 = layer.frame_root.global_basis.orthonormalized().inverse() * Vector3(push.x, 0.0, push.z)
	if local.length_squared() < 0.0001:
		local = Vector3(0, 0, -1)   # no direction: pushed back
	_flinch_dir = local.normalized()
	_flinch_k = maxf(strength, _flinch_k * _flinch_env() if _flinch_t >= 0.0 else 0.0)
	_flinch_t = 0.0
	_flinch_block = fid and state == "guard" and clips.has("guard")
	if _flinch_block:
		_add_t = -1.0
		_add_set = []
		return
	if fid and not _hit_anims.is_empty():
		_hit_clip(_flinch_dir, strength)


## fid29 combat: the captured recoil for a blow pushing the body along `d` (its own frame, +Z forward): the
## two strongest of front (pushed back), back (pushed forward), left and right, weighted by how much of the push
## each is; a heavy blow from the front takes the head hit. A side with no clip on this hero: the procedural
## flinch shows the blow instead.
func _hit_clip(d: Vector3, strength: float) -> void:
	var parts: Array = [["front", maxf(0.0, -d.z)], ["back", maxf(0.0, d.z)], ["left", maxf(0.0, d.x)], ["right", maxf(0.0, -d.x)]]
	parts.sort_custom(func(p: Array, q: Array) -> bool: return float(p[1]) > float(q[1]))
	var out: Array = []
	for p: Array in parts.slice(0, 2):
		var k: String = str(p[0])
		if k == "front" and strength >= 1.0 and _hit_anims.has("front_heavy"):
			k = "front_heavy"
		elif k == "front" and not _hit_anims.has("front"):
			k = "front_light"
		if not _hit_anims.has(k):
			if out.is_empty():
				break      # the main side has no clip: procedural
			continue
		if float(p[1]) > 0.15 or out.is_empty():
			out.append([_hit_anims[k], float(p[1]), float(_hit_gain.get(k, 1.0))])
	_add_set = []
	_add_t = -1.0
	if out.is_empty():
		return
	var tot: float = 0.0
	for o: Array in out:
		tot += float(o[1])
	for o: Array in out:
		o[1] = float(o[1]) / maxf(tot, 0.0001)
	_add_set = out
	var u: float = clampf((strength - 0.45) / 0.95, 0.0, 1.0)
	_add_len = lerpf(ADD_LEN.x, ADD_LEN.y, u)
	_add_w = lerpf(0.55, 1.0, u)
	_add_t = 0.0


func _flinch_env() -> float:
	if _flinch_t < 0.0:
		return 0.0
	if _flinch_t < FLINCH_IN:
		var u: float = _flinch_t / FLINCH_IN
		return u * (2.0 - u)
	var v: float = clampf((_flinch_t - FLINCH_IN) / FLINCH_OUT, 0.0, 1.0)
	return 1.0 - v * v * (3.0 - 2.0 * v)


func _flinch_pose() -> Dictionary:
	if _add_t >= 0.0:
		return {}   # fid29: the captured recoil plays it
	var e: float = _flinch_env() * _flinch_k
	if e <= 0.001:
		return {}
	if _flinch_block:
		# moves-fix-32: the block's recoil (BLOCK_POSE), at full depth for a 0.45 blow (fight.gd's block)
		var kb: float = minf(e / 0.45, 1.6)
		return {"spine_lean": BLOCK_POSE["spine_lean"] * kb * maxf(0.3, -_flinch_dir.z), "r_bend": BLOCK_POSE["r_bend"] * kb,
			"l_bend": BLOCK_POSE["l_bend"] * kb, "r_fwd": BLOCK_POSE["r_fwd"] * kb, "l_fwd": BLOCK_POSE["l_fwd"] * kb,
			"spine_tilt": FLINCH_TILT * 0.5 * e * _flinch_dir.x}
	# pushed back (-Z) leans the spine back; pushed to its left (+X) tilts it that way and turns it
	return {"spine_lean": FLINCH_LEAN * e * _flinch_dir.z, "spine_tilt": FLINCH_TILT * e * _flinch_dir.x,
		"spine_yaw": FLINCH_YAW * e * _flinch_dir.x, "r_side": FLINCH_ARMS * e, "l_side": FLINCH_ARMS * e,
		"r_bend": FLINCH_ARMS * 0.8 * e, "l_bend": FLINCH_ARMS * 0.8 * e}


## True while a one-shot action clip (an attack, skill, parry or dodge) still owns the body.
func busy_action() -> bool:
	return length > 0.0 and t < length and not in_tail and state in ONE_SHOTS and clips.has(state)


## Locomotion and the procedural pose. `busy` = a one-shot owns the body.
func update(dt: float, speed_now: float, dead: bool) -> void:
	_speed_now = speed_now
	if not frozen:
		t += dt
	if _flinch_t >= 0.0 and (not frozen or _flinch_t < FLINCH_IN):
		_flinch_t += dt
		if _flinch_t > FLINCH_IN + FLINCH_OUT:
			_flinch_t = -1.0
			_flinch_k = 0.0
	if _add_t >= 0.0 and (not frozen or _add_t < FLINCH_IN):
		_add_t += dt
		if _add_t > _add_len:
			_add_t = -1.0
			_add_set = []
	if dead_blend != null:
		dead_blend.dt = 0.0 if frozen else dt
	if pose_guard != null:
		pose_guard.dt = 0.0 if frozen else dt
	if ko != null and dead and state == "death" and player != null:
		ko.tick(0.0 if frozen else dt, player.current_animation_position, floor_y)
	if player != null:
		var base: float = 1.0
		if state in LOCO:
			base = walk_rate
		elif not _warp.is_empty():
			base = float(_warp[1]) if t < float(_warp[3]) else float(_warp[2])
		elif in_tail:
			base = 1.0
		player.speed_scale = 0.0 if frozen else base
		if fid and length > 0.0 and not frozen and dt > 0.0 and player.is_playing() and not (state in LOOPING) and state != "death":
			# moves-fix-32: held a hair before the clip's end while the state still owns the body (END_KEEP)
			var left: float = player.current_animation_length - player.current_animation_position - END_KEEP
			if player.speed_scale * dt * END_MARGIN > left:
				player.speed_scale = maxf(0.0, left / (dt * END_MARGIN))
	if state == "victory" and length > 0.0 and t >= length and not _victory_idle and player != null and clips.has("idle"):
		# fight-anim: the cheer used to freeze on its last frame (a statue); it settles into idle
		_victory_idle = true
		_warp = []
		if fid:
			_victory_hold = true   # moves-fix-32: the last pose holds and breathes (see _victory_hold)
		elif dead_blend != null:
			_dead_play(clips["idle"], BLEND_VICTORY_IDLE)
		else:
			player.play(clips["idle"], BLEND_VICTORY_IDLE, 1.0)
		player.speed_scale = 0.0 if (frozen or _victory_hold) else 1.0
	if _victory_hold and player != null:
		player.speed_scale = 0.0
	if in_tail and speed_now > 0.2:
		length = t     # a step ends the tail: the walk takes over below
	if length > 0.0 and t >= length and not (state in HOLD_LAST) and not in_tail and _tail > 0.01 and speed_now <= 0.2 and player != null and clips.has(state):
		# anim-readable: the tail plays on at the clip's own speed
		in_tail = true
		length = t + _tail
		_warp = []
	if length > 0.0 and t >= length and not (state in HOLD_LAST):
		length = 0.0
		_after = state
		state = "_"
		_warp = []
		in_tail = false
	if length <= 0.0 and not dead and not (state in HOLD_LAST) and state != "guard":
		var want: String = "idle"
		# run once a walk would have to play much faster than it was made
		var walk_gs: float = float((timing.get("walk", {}) as Dictionary).get("ground_speed_per_hip", 0.0)) * hip_h
		var run_at: float = walk_gs * 1.8 if walk_gs > 0.01 and clips.has("run") else 3.2
		if speed_now > run_at:
			want = "run" if clips.has("run") else "walk"
			if want == "run" and clips.has("sprint"):
				var run_gs: float = float((timing.get("run", {}) as Dictionary).get("ground_speed_per_hip", 0.0)) * hip_h
				var spr_gs: float = float((timing.get("sprint", {}) as Dictionary).get("ground_speed_per_hip", 0.0)) * hip_h
				if run_gs > 0.01 and spr_gs > run_gs and speed_now > sqrt(run_gs * spr_gs):
					want = "sprint"
		elif speed_now > 0.2:
			want = "walk"
		# fight-motion-31: a locomotion state is held at least LOCO_HOLD before the body drops to a slower one (the
		# ally kiting at its range flipped idle, walk and run every few frames: 48 flips in one fight, each a new
		# clip); speeding up still switches at once, a hit or an action still ends it at once
		_loco_t += dt
		if fid and state in LOCO and want != state and _loco_rank(want) < _loco_rank(state) and _loco_t < LOCO_HOLD:
			want = state
		if want != state:
			_loco_t = 0.0
		if fid and (state == "run" or state == "sprint") and want == "idle" and _loco_speed > 2.0 and clips.has("idle"):
			# moves-fix-32: the run stops with a carry and a settle (STOP_*)
			_stop_t = 0.0
			_stop_k = clampf(_loco_speed / STOP_FULL, 0.0, 1.2)
			_blend_max = STOP_BLEND
		_loco_speed = speed_now if state in LOCO else 0.0
		walk_rate = _loco_rate(want if clips.has(want) else "walk", speed_now)
		if want != state:
			if not play(want, 0.0, -1.0, STOP_BLEND * 0.5 if _stop_t == 0.0 else -1.0):
				# no clip for it: fall back to whichever locomotion clip exists
				if player != null:
					var alt: String = "walk" if want == "run" or want == "sprint" else want
					if clips.has(alt):
						if dead_blend != null:
							_dead_play(clips[alt], 0.15)
						else:
							player.play(clips[alt], 0.15)
				state = want
	# realism-20261111: no state ever shows the bind pose. A player that has stopped while the
	# state is a loop or between states (nothing queued, a clip removed under it) goes back to the
	# idle loop; a skeleton with no clip at all hangs its arms (pose_layer arm_droop) instead of
	# standing in its T or A rest pose.
	if no_bind and player != null and not player.is_playing() and (state in LOOPING or state == "_") and clips.has("idle") and not frozen:
		if dead_blend != null:
			_dead_play(clips["idle"], BLEND_LOOP)
		else:
			player.play(clips["idle"], BLEND_LOOP, 1.0)
	if foot != null:
		foot.dt = 0.0 if frozen else dt
		foot.floor_y = floor_y
		foot.size = layer.frame_root.scale.y if layer != null and layer.frame_root != null else 1.0
		foot.loco = state in LOCO or (legs_run and length > 0.0)
		foot.pinning = (not (state in FOOT_OFF_STATES) or (fid and PIN_AFTER.has(state) and phase() >= float(PIN_AFTER[state])) or in_tail) and player != null
	if _stop_t >= 0.0:
		_stop_t += 0.0 if frozen else dt
		if _stop_t > STOP_LEN or dead or not (state == "idle" or state == "_"):
			_stop_t = -1.0
	if layer != null:
		var p: Dictionary = _pose_now() if not clips.has(state) else {}
		if _stop_t >= 0.0:
			p = p.duplicate()
			p["spine_lean"] = float(p.get("spine_lean", 0.0)) + STOP_LEAN * stop_env()
		# realism round 2: wound up for the next blow while an opponent is in reach
		_ready_w = lerpf(_ready_w, 1.0 if (ready and not dead and state in READY_STATES) else 0.0, 1.0 - exp(-dt * READY_RATE))
		if _ready_w > 0.01:
			p = p.duplicate()
			for rk: String in READY_POSE:
				p[rk] = float(p.get(rk, 0.0)) + float(READY_POSE[rk]) * _ready_w
		if relax > 0.0 and not dead and state in FL_RELAX_STATES:
			p = p.duplicate()
			for rk: String in FL_RELAX_POSE:
				p[rk] = float(p.get(rk, 0.0)) + float(FL_RELAX_POSE[rk]) * relax
		if breathe and (_victory_hold or (not dead and (state == "idle" or state == "_" or state == "guard"))):
			_breath_t += dt
			p = p.duplicate()
			var bk: float = VICTORY_BREATH if _victory_hold else 1.0
			var br: float = sin(TAU * _breath_t / BREATH_PERIOD)
			var sh: float = sin(TAU * _breath_t / SHIFT_PERIOD)
			p["spine_lean"] = float(p.get("spine_lean", 0.0)) - 1.4 * br * bk
			p["spine_tilt"] = float(p.get("spine_tilt", 0.0)) + 2.2 * sh
			p["spine_yaw"] = float(p.get("spine_yaw", 0.0)) + 1.2 * sin(TAU * _breath_t / (SHIFT_PERIOD * 1.3))
			p["r_side"] = float(p.get("r_side", 0.0)) + 1.5 * br * bk
			p["l_side"] = float(p.get("l_side", 0.0)) + 1.5 * br * bk
		if fid:
			layer.add_layers = _add_layers_now()
		var fl: Dictionary = _flinch_pose()
		if not fl.is_empty():
			p = p.duplicate()
			for k: String in fl:
				p[k] = float(p.get(k, 0.0)) + float(fl[k])
		layer.pose = p
		var dw: float = maxf(arm_droop, char_droop) if (state in DROOP_STATES and not dead) else 0.0
		layer.droop_free = char_droop_free if char_droop > arm_droop else PoseLayer.DROOP_FREE
		if no_bind and clips.is_empty() and state != "death":
			dw = 1.0   # no clip at all: never the bind pose
		_droop_now = lerpf(_droop_now, dw, 1.0 - exp(-dt * DROOP_RATE))
		layer.arm_droop = _droop_now
		if fid:
			var tw: Vector2 = ARM_TUCK.get(state, Vector2.ZERO) if (clips.has(state) and length > 0.0 and not dead) else Vector2.ZERO
			_tuck = _tuck.lerp(tw, 1.0 - exp(-dt * TUCK_RATE))
			layer.droop_r = maxf(_droop_now, _tuck.x) if _tuck.x > 0.002 else -1.0
			layer.droop_l = maxf(_droop_now, _tuck.y) if _tuck.y > 0.002 else -1.0


## fid29 combat: this frame's additive hit layers for pose_layer.gd: each clip at the matching point of its own
## length, weighted by its share of the push and the blow, eased in over FLINCH_IN and out over the last 35 %.
func _add_layers_now() -> Array:
	if _add_t < 0.0 or _add_set.is_empty():
		return []
	var u: float = clampf(_add_t / _add_len, 0.0, 1.0)
	var env: float = minf(1.0, _add_t / FLINCH_IN) * (1.0 - smoothstep(0.65, 1.0, u))
	var out: Array = []
	for o: Array in _add_set:
		var a: Animation = o[0]
		out.append([a, u * a.length, float(o[1]) * float(o[2]) * _add_w * env])
	return out


## moves-fix-32: the run stop's trunk carry, signed (+ = forward), times how fast the run was (STOP_*)
func stop_env() -> float:
	if _stop_t < 0.0:
		return 0.0
	return _stop_k * exp(-_stop_t / STOP_DECAY) * cos(TAU * _stop_t / STOP_PERIOD)


func phase() -> float:
	if length <= 0.0:
		return 0.0
	return clampf(t / length, 0.0, 1.0)


func _pose_now() -> Dictionary:
	if not POSES.has(state):
		return {}
	var keys: Array = POSES[state]
	var k: float = phase() if length > 0.0 else 0.0
	if keys.size() == 1:
		return keys[0][1]
	for i in range(keys.size() - 1):
		var a: Array = keys[i]
		var b: Array = keys[i + 1]
		if k <= float(b[0]):
			var u: float = (k - float(a[0])) / maxf(0.0001, float(b[0]) - float(a[0]))
			u = u * u * (3.0 - 2.0 * u)
			return _lerp_pose(a[1], b[1], u)
	return keys[-1][1]


static func _lerp_pose(a: Dictionary, b: Dictionary, u: float) -> Dictionary:
	var out: Dictionary = {}
	for k: String in a:
		out[k] = lerpf(float(a[k]), float(b.get(k, 0.0)), u)
	for k: String in b:
		if not out.has(k):
			out[k] = lerpf(0.0, float(b[k]), u)
	return out
