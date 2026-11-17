extends Node3D
## One fighter (cq 061, reworked in cq 233): a runtime GLB (or a capsule mannequin), its
## CombatAnimator (clips when the GLB has them, procedural poses when not), a hurtbox, a
## weapon arc hitbox on a pivot, the hit flash (with a team rim while it shows), knockback, the SHIELD barrier
## and the RALLY buff. The model faces +Z (glTF convention); yaw turns +Z to the facing.

const HitArea := preload("res://hit_area.gd")
const Animator := preload("res://combat_animator.gd")
## cq 015 rim (char_lit.gdshader): strength on the key light's side, and the share of it the
## team-coloured sky-side rim gets
## build 20 pass 2 (one look): the rim was a fixed peach at 1.7 with a 0.45 team tint, so the fighters
## glowed green, cyan and red at the edges against a street lit by a plainer sun. It now takes the time
## preset's key colour (rim_key, set in _lit_material) and is a little softer, the team tint a hint.
const RIM_AMOUNT: float = 1.35
const RIM_BOSS: float = 1.5
const RIM_TEAM: float = 0.25
const SHADE_SHARE: float = 0.45       # how much of the street's shade colour the fighters' dark side takes
const FLASH_SHADER := preload("res://vfx/flash.gdshader")
const LIT_SHADER := preload("res://vfx/char_lit.gdshader")
## realism (LOOK.md "The real look"): the mid and high tiers' fighter material (look "real")
const REAL_SHADER := preload("res://vfx/char_real.gdshader")
const LookReal := preload("res://look_real.gd")
const REAL_RIM: float = 0.5           # the rim's strength on the real material (char_lit's is 1.35)
## The fill: the street's measured ambient times this, per time of day. At dusk and at night the street's
## lamps and windows are drawn as cards (light pools on the paving, halos), which light nothing, so the
## measured light on a fighter is less than the paving shows; without this they are silhouettes at night
## (measured: LOOK.md). Golden hour and day use the measured light as it is.
## round 2: with the key turned to the camera's side the fill is smaller (dusk 1.35 -> 1.2, night 2.4 -> 1.9).
## round 3: the camera-side fill (the sky's colour times this) and how much of the key's colour the fighters keep
## round 4 (replaces round 3's frontal fill, REAL_CAM_FILL): per time of day
##  expo  [gain on near-black, power above 0.3]: exposure by the surface's own brightness (char_real.gdshader `expo`)
##  ka    the sky-side kicker (behind the fighter on the camera's right, high), in the sky's colour
##  kb    the lamp-side kicker (behind on the left, low, warm): only when the street's lamps are lit
##  bounce the share of the paving's sunlit colour that reaches surfaces facing down
const REAL_LIGHT: Dictionary = {
	"golden": {"expo": [1.5, 0.25], "ka": 0.55, "kb": 0.0, "bounce": 0.35},
	"day": {"expo": [1.4, 0.2], "ka": 0.5, "kb": 0.0, "bounce": 0.35},
	"dusk": {"expo": [2.6, 0.4], "ka": 0.6, "kb": 0.7, "bounce": 0.3},
	"night": {"expo": [4.5, 1.3], "ka": 0.45, "kb": 0.8, "bounce": 0.25},
}
const LAMP_COL: Color = Color(1.0, 0.76, 0.48)
const REAL_KEY_SAT: Dictionary = {"dusk": 0.6}
const REAL_FILL: Dictionary = {"golden": 1.0, "day": 1.0, "dusk": 1.1, "night": 1.7}
const SKIN_GUESS: float = 0.6         # the skin term's strength when it is guessed from colour (no Forge mask)
const ArenaScript := preload("res://arena.gd")
const DOME_SHADER := preload("res://vfx/dome.gdshader")

## build 21: the boss's arms hang this much closer when it is not attacking (combat_animator arm_droop)
const BOSS_ARM_DROOP: float = 0.75
const HEIGHT: float = 2.3             # a touch over life size: reads at phone size, as on the reference

var display_name: String = ""
var team: int = 0                # 0 = hero side, 1 = enemy
var role: String = "hero"        # hero | ally | boss
var max_hp: int = 1000
var hp: int = 1000
var radius: float = 0.45
var size_k: float = 1.0          # the boss stands taller
## The fight setup's look (battle-3d-only): the boss's height x this (a raid boss stands taller still). Set before setup().
var size_mult: float = 1.0
var colour: Color = Color.WHITE
var body: Node3D
var model: Node3D
var anim: Animator = Animator.new()
var model_info: String = "capsule"
var bind_info: Dictionary = {}
var anim_opts: Dictionary = {}   # {key, class}: picks the cast clip library and the weapon set (cq 012)
var yaw: float = 0.0
var speed_now: float = 0.0
var dead: bool = false
var celebrating: bool = false
var anim_freeze: bool = false
var weapons: Dictionary = {}      # "r" / "l" -> {node, class, bone} (weapons in hand, cq 234)

# combat state the fight reads and writes
var kb_vel: Vector3 = Vector3.ZERO
# autorig: a shove at least this fast (m/s), mostly backwards, plays the stagger clip (a backward
# step) for as long as the shove lasts; presentation only (kb_vel and the position are the game's)
const STAGGER_V: float = 3.0
var _staggering: bool = false
var iframes: float = 0.0
var stagger: float = 0.0
var guarding: bool = false
var guard_t: float = 0.0         # seconds since guard went up
var shield_hp: int = 0
var shield_t: float = 0.0
var buff_t: float = 0.0
var buff_mult: float = 1.0

var hurtbox: Area3D
var weapon_pivot: Node3D
var weapon: HitArea
var weapon_reach: float = 2.2

var _overlay: ShaderMaterial
var _flash: float = 0.0
var _glow: float = 0.0           # build 21: the dissolve's white-hot glow (the hit flash is a rim now)
var _lit_glow: float = -1.0
var _overlay_meshes: Array[MeshInstance3D] = []
var _overlay_on: bool = false
## cq 015: the fighter's own materials, rebuilt on char_lit.gdshader (rim + hit flash in
## the same pass). The overlay above is only kept for a surface that cannot be converted.
var _lit_mats: Array[ShaderMaterial] = []
var _lit_flash: float = -1.0
var rim_on: bool = true                                  # set by fight.gd from the look ("rim": false = the old material + overlay)
var look: Dictionary = {}                                # the arena's look (set by fight.gd)
var hair_mask: Texture2D = null                          # realism round 2: the model's Forge hair mask
var skin_mask: Texture2D = null                          # realism: the model's Forge skin mask (fight.gd, before set_model)
var surface_kinds: Dictionary = {}                       # realism round 5: material name -> "skin" | "hair" | "metal" (char_loader.surface_kinds)
static var _white_tex: ImageTexture = null
## realism round 5 (13 Nov): per time of day, the key's colour on skin pulled towards white (the street keeps its colour)
const SKIN_KEY_DESAT: Dictionary = {"golden": 0.45, "day": 0.2, "dusk": 0.35, "night": 0.2}
const SKIN_ROUGH_MIN: float = 0.5
## skin's colour balance per time of day: the golden street light and the golden grade together turned faces orange
## (measured on game frames against the concept's skin: b* 44 against 24). Linear multipliers on skin's base colour.
## skinlook-28 (14 Nov): with every skin tone on the skin shading (char_real skin_wide) the old balance [0.8, 0.83, 1.17]
## turned faces pink (a* +5 to +12 against the concept); refitted on all six heroes
const SKIN_WB: Dictionary = {"golden": [0.70, 0.83, 1.03], "day": [0.92, 1.0, 1.2], "dusk": [0.8, 1.0, 1.3]}
## skinlook-28 (14 Nov): skin's exposure gain per time of day, the same for every skin tone, in place of the gain by the
## surface's own brightness (REAL_LIGHT expo), so deep and pale skin keep the difference the concepts have. Absent = by
## its own brightness (build 27). Look key "skin_gain" overrides it for trials.
## Measured on concept-toned heads in the close beats (experiments/skinlook-28): golden on all six heroes and both tiers,
## day and dusk on four (high tier). Night is not shipped (arena.gd turns it into dusk) and keeps the old exposure.
const SKIN_GAIN: Dictionary = {"golden": 0.83, "day": 0.62, "dusk": 0.8}
const NORMAL_FADE: float = 1.5            # texels per screen pixel where the detail normal starts to fade
## the face fill (fight.gd set_face_fill): colour x strength; close = the intro beat and the victory shot
const FACE_FILL_COL: Color = Color(1.0, 0.82, 0.74)    # warm: the street is warm, a white fill read as a flash
const FACE_FILL_CLOSE: float = 0.25
const FACE_FILL_FIGHT: float = 0.08
var _face_fill_k: float = -1.0
const FaceLifeScript := preload("res://face_life.gd")
var face_life: RefCounted = null                         # realism round 5: blinks and gaze (face_life.gd), heroes with the shape keys
var _surf_tangents: bool = false                         # the surface being converted has tangents (normal map)
var sun_blob: bool = true                                # set by fight.gd from the look ("ao")
var key_dir: Vector3 = Vector3(0.65, -0.56, 0.51)       # the key light's direction (arena.gd)
var _rim_team: Color = Color(0.5, 0.85, 1.0)
var _dome: MeshInstance3D
var _dome_mat: ShaderMaterial
var _dome_hit: float = 0.0
var _dome_age: float = 0.0          # cq 013: pop-in when the barrier goes up
var _shatter_t: float = -1.0        # cq 013: >= 0 while the dome breaks up
## cq 013: the barrier broke or ran out (fx shards it)
signal shield_ended(at: Vector3, radius: float)
var _aura: MeshInstance3D
var _cast: MeshInstance3D       # cq 015: the blob with its sun-cast tail (top level: it keeps the sun's heading)
var _cast_off: Vector3 = Vector3.ZERO
var _cast_yaw: float = 0.0

# procedural body motion (stands in for clip root motion)
var _motion: String = ""
var _mt: float = 0.0
var _mlen: float = 0.0
var _pop_t: float = -1.0
var _death_t: float = -1.0
var _cele_t: float = 0.0
var _spin_dir: float = -1.0
## build 21 (presentation): while the whirl plays, the yaw towards its target (NAN = none, set by
## fight.gd each frame). The drawn body turns onto it over the spin's last part, so the spin ends
## facing the enemy; the fighter's yaw, hurtbox and weapon arc are the game's and never move.
var face_yaw: float = NAN
var _face_off: float = 0.0
const FACE_FROM: float = 0.55           # the share of the spin after which the body turns onto the target
# look-fight (presentation only): the victim's shudder through a hit-stop, the Guardian's dissolve
var _shud_t: float = 0.0
var _shud_len: float = 0.0
var _shud_amp: float = 0.0
var _shud_clock: float = 0.0
var _diss_t: float = -1.0
var _diss_len: float = 0.7
# fight-anim (presentation only): the model's facing eases after the fighter's yaw. The game snaps
# yaw (soft-lock on a swing, a wind-up's aim, a charge: up to 140 deg in one frame); the yaw, the
# hurtbox and the weapon hitbox keep snapping exactly as before, only the drawn body follows.
const TURN_RATE: float = 16.0           # 1/s: most of a snap within 4-5 frames
const TURN_LAG_MAX: float = 2.618          # 150 deg: a bigger snap catches up the rest at once
var _vis_yaw: float = NAN
## realism-20261111 (presentation only): a directed attack holds the drawn body on the heading the
## swing began with until the blow has landed, and turns onto it fast, so no swing goes sideways
## or backward (the game may turn the fighter's yaw again mid-swing: the ally jogs on while its
## bolt cast still plays; the yaw, hurtbox and weapon arc are the game's and never move).
const AIM_STATES: Array[String] = ["attack_1", "attack_2", "attack_3", "heavy", "skill_charge", "skill_split", "parry"]
const AIM_RATE: float = 30.0            # 1/s: on the aim by the contact (3 frames), not a one-frame snap
const AIM_AFTER: float = 0.14           # s the aim is held after the contact
var aim_hold: bool = false              # config "aim_hold" (on with "motion_realism")
var _aim_yaw: float = 0.0
var _aim_t: float = 0.0
## anim-readable (13 Nov 2026): a readable clip (anim_clips.json sets_readable) is drawn facing the target
## it was aimed at, from its first frames to its contact, on every tier (not only with "aim_hold"): SHOOT
## holds its aim through its tail, RAIN faces its circle. Presentation only.
const READABLE_AIM: Array[String] = ["attack_1", "attack_2", "attack_3", "skill_shoot", "skill_rain", "skill_charge", "skill_split", "parry"]
var _next_hit: String = ""        # anim-readable: the hit reaction the next act("hit") plays (hit_size)
## anim-readable: a body that turns on the spot steps round (the walk's legs for a moment) instead of
## pivoting on its planted feet. Config "readable" (fight.gd sets it).
var turn_steps: bool = false
const TURN_STEP_RATE: float = 2.6        # rad/s of yaw change that counts as a turn on the spot
const TURN_STEP_HOLD: float = 0.32       # s the legs step after it
const TURN_STEP_SPEED: float = 1.0       # m/s the legs are animated at while they step round
var _turn_prev: float = NAN
var _turn_step_t: float = 0.0
## realism-20261111 (presentation only): weight. The attacker's body leans into the blow round
## the contact, the victim's hips give with the flinch (with the feet locked, both read as weight).
const LUNGE_M: float = 0.11             # m at size 1
const LUNGE_IN: float = 0.07            # s before the contact
const LUNGE_OUT: float = 0.2            # s after it
const GIVE_M: float = 0.07              # the victim's hips, back along the blow
const GIVE_DROP: float = 0.03
var weight_fx: bool = false             # config "weight" (on with "motion_realism")
var _hit_at: float = -1.0
var real_speed: bool = false            # config "real_speed" (on with "motion_realism")
## realism round 2 (presentation): a short animation-only pause on a blow, scaled by the damage, on
## top of whatever real hit-stop the game ran (fight.gd calls it for both fighters); the game's
## clock is untouched.
var _vis_pause: float = 0.0
## realism round 2 (presentation): the body is drawn where a smoothed path would have it while the
## game shoves the fighter forward and straight back every frame (the ally against the arena
## edge moved 7 cm each way a frame: it read as a vibration). 0..1.
var _jit: float = 0.0
var _smooth_pos: Vector3 = Vector3.INF
var _trail: Array = []                  # the last few drawn positions (the legs' real speed)
var _trail_dt: Array = []


func setup(n: String, t: int, hp_max: int, c: Color, r: String = "hero") -> void:
	display_name = n
	team = t
	role = r
	max_hp = hp_max
	hp = hp_max
	colour = c
	size_k = (1.55 if role == "boss" else 1.0) * size_mult
	radius = 0.8 if role == "boss" else 0.5
	body = Node3D.new()
	body.name = "Body"
	add_child(body)
	_overlay = ShaderMaterial.new()
	_overlay.shader = FLASH_SHADER
	var rim: Color = Color(1.0, 0.35, 0.3) if team == 1 else (Color(0.55, 1.0, 0.6) if role == "hero" else Color(0.5, 0.85, 1.0))
	_overlay.set_shader_parameter("rim_color", rim)
	_overlay.set_shader_parameter("rim_amount", 0.55 if role == "boss" else 0.4)
	_rim_team = rim
	_build_boxes()
	_build_shadow()
	set_capsule()


## anim-readable (Wale, 13 Nov: "the drop shadow is too thick"): softer contact shadows, still dark right
## under the feet so they read as contact (fight.gd sets it from "readable" before the fighters are made)
static var soft_shadows: bool = false
const SOFT_K: float = 0.55       # opacity of the blob and the sun tail against the old ones
const SOFT_FOOT_K: float = 0.7   # the small per-foot contact shadows keep more (they are what says "on the ground")


func _build_shadow() -> void:
	# a soft contact shadow: grounds the fighters on the bright paving at no real cost
	var sh := MeshInstance3D.new()
	sh.name = "BlobShadow"
	var q := PlaneMesh.new()
	q.size = Vector2(1.5, 1.5) * size_k
	sh.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = preload("res://art/fx/vfx_glow.png")
	m.albedo_color = Color(0.08, 0.04, 0.12, 0.75 * (SOFT_K if soft_shadows else 1.0))
	if bool(look.get("real", false)):
		# round 4: a firmer contact disc under the body on the real look (the judge read "weak contact shadow")
		m.albedo_color = Color(0.05, 0.035, 0.07, 0.92 * (SOFT_K if soft_shadows else 1.0))
		q.size = Vector2(1.8, 1.8) * size_k * (0.85 if soft_shadows else 1.0)
	m.disable_receive_shadows = true
	sh.material_override = m
	sh.position.y = 0.045
	sh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sh)
	# cq 015: the low key light's shadow, faked in the same quad: the contact blob and a long
	# soft tail leaning away from the sun (arena.gd KEY_ROT) in one texture, on a longer quad that
	# keeps the sun's heading as the fighter turns (top level). Still one draw a fighter.
	var ld := Vector3(key_dir.x, 0.0, key_dir.z)
	if sun_blob and ld.length() > 0.05:
		q.size = Vector2(SUN_BLOB.x, SUN_BLOB.y) * size_k
		m.albedo_texture = _sun_blob_tex()
		m.albedo_color = Color(1, 1, 1, SOFT_K) if soft_shadows else Color.WHITE
		sh.top_level = true
		_cast = sh
		# the quad's centre sits ahead of the feet along the sun (the texture's feet are at SUN_FEET)
		_cast_off = ld.normalized() * (SUN_BLOB.y * (0.5 - SUN_FEET)) * size_k
		_cast_yaw = atan2(ld.x, ld.z)


## The sun-cast blob's quad (width, length in metres at size 1) and where the feet sit along it (0-1).
const SUN_BLOB: Vector2 = Vector2(1.5, 3.4)
const SUN_FEET: float = 0.22
static var _sun_tex: ImageTexture


## The contact blob plus the sun's soft tail, drawn once into a 64 x 128 texture (v runs along the sun).
static func _sun_blob_tex() -> ImageTexture:
	if _sun_tex != null:
		return _sun_tex
	var img := Image.create(64, 128, false, Image.FORMAT_RGBA8)
	var contact := Color(0.08, 0.04, 0.12)
	var tail := Color(0.16, 0.12, 0.3)
	for y in 128:
		for x in 64:
			var u: float = (x + 0.5) / 64.0 - 0.5
			var v: float = (y + 0.5) / 128.0
			# contact: a 0.75 m radius disc round the feet, like the old blob (alpha 0.75)
			var dc: float = Vector2(u / 0.5, (v - SUN_FEET) * SUN_BLOB.y / SUN_BLOB.x / 0.5).length()
			var ac: float = 0.75 * pow(clampf(1.0 - dc, 0.0, 1.0), 1.6)
			# tail: a soft ellipse 1 m ahead, 2.6 m long, 1.1 m wide (alpha 0.5)
			var dt: Vector2 = Vector2(u / 0.37, (v - (SUN_FEET + 1.0 / SUN_BLOB.y)) / (1.3 / SUN_BLOB.y))
			var at: float = 0.5 * pow(clampf(1.0 - dt.length(), 0.0, 1.0), 1.2)
			var a: float = ac + at * (1.0 - ac)
			var c: Color = tail.lerp(contact, ac / maxf(a, 0.001))
			c.a = a
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	_sun_tex = ImageTexture.create_from_image(img)
	return _sun_tex


func _build_boxes() -> void:
	hurtbox = Area3D.new()
	hurtbox.name = "Hurtbox"
	hurtbox.collision_layer = HitArea.hurt_layer(team)
	hurtbox.collision_mask = 0
	hurtbox.monitoring = false
	hurtbox.monitorable = true
	hurtbox.set_meta("fighter", self)
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = radius
	cap.height = HEIGHT * size_k
	cs.shape = cap
	cs.position.y = HEIGHT * size_k * 0.5
	hurtbox.add_child(cs)
	add_child(hurtbox)
	# the weapon arc: a fan from the chest out to the reach, rebuilt every frame of a swing
	# to cover the arc the weapon swept since the last frame (sweep_arc)
	weapon_pivot = Node3D.new()
	weapon_pivot.name = "WeaponPivot"
	weapon_pivot.position.y = HEIGHT * size_k * 0.55
	add_child(weapon_pivot)
	weapon = HitArea.new()
	weapon.name = "WeaponArc"
	var fan := ConvexPolygonShape3D.new()
	fan.points = PackedVector3Array([Vector3(-0.2, -0.5, 0.3), Vector3(0.2, -0.5, 0.3), Vector3(-0.2, 0.5, 0.3), Vector3(0.2, 0.5, 0.3),
		Vector3(-0.2, -0.5, 1.5), Vector3(0.2, -0.5, 1.5), Vector3(-0.2, 0.5, 1.5), Vector3(0.2, 0.5, 1.5)])
	weapon.setup(1 - team, fan)
	weapon_pivot.add_child(weapon)
	sweep_arc(-10.0, 10.0)


## The arc's reach (m) for the next swings.
func set_reach(reach: float, _width: float = 0.5) -> void:
	weapon_reach = reach


## Shapes the weapon hitbox as the fan between two yaw angles (deg, + is its left), from
## 0.3 m out to the reach and from knee to above the head: everything the blade swept.
func sweep_arc(a0_deg: float, a1_deg: float) -> void:
	var lo: float = minf(a0_deg, a1_deg)
	var hi: float = maxf(a0_deg, a1_deg)
	if hi - lo < 12.0:
		var mid: float = (lo + hi) * 0.5
		lo = mid - 6.0
		hi = mid + 6.0
	hi = minf(hi, lo + 170.0)   # a fan under 180 degrees stays convex
	var y0: float = -HEIGHT * size_k * 0.45
	var y1: float = HEIGHT * size_k * 0.6
	var pts := PackedVector3Array()
	var n: int = clampi(int((hi - lo) / 15.0) + 1, 1, 12)
	for i in n + 1:
		var a: float = deg_to_rad(lerpf(lo, hi, float(i) / float(n)))
		var d := Vector3(sin(a), 0, cos(a))
		for y: float in [y0, y1]:
			pts.append(d * 0.3 + Vector3(0, y, 0))
			pts.append(d * weapon_reach + Vector3(0, y, 0))
	(weapon.shape_node.shape as ConvexPolygonShape3D).points = pts


func forward() -> Vector3:
	return Vector3(sin(yaw), 0.0, cos(yaw))


func face(dir: Vector3, dt: float, rate: float = 18.0) -> void:
	if dir.length_squared() < 0.0001:
		return
	var target: float = atan2(dir.x, dir.z)
	if rate <= 0.0:
		yaw = target
	else:
		yaw = lerp_angle(yaw, target, 1.0 - exp(-dt * rate))
	rotation.y = yaw


func head_pos() -> Vector3:
	return global_position + Vector3(0.0, HEIGHT * size_k + 0.3, 0.0)


func chest_pos() -> Vector3:
	return global_position + Vector3(0.0, HEIGHT * size_k * 0.6, 0.0)


## The right-hand attach point (BoneAttachment3D on the hand bone, or a stand-in node at
## the right hip when the model has no skeleton). The weapons task parents weapons here.
func hand_r() -> Node3D:
	return anim.hand_r


## Puts `weapon_node` in the right hand (replacing any weapon there). A child named "tip"
## (if any) marks the blade's end; reach, when given, also resizes the arc hitbox.
func attach_weapon(weapon_node: Node3D, reach: float = -1.0) -> void:
	var h: Node3D = hand_r()
	if h == null:
		return
	for c: Node in h.get_children():
		if c.is_in_group("cq_weapon"):
			c.queue_free()
	weapon_node.add_to_group("cq_weapon")
	h.add_child(weapon_node)
	if reach > 0.0:
		set_reach(reach)


# ---------------------------------------------------------------- models

func _clear_model() -> void:
	if model != null:
		model.queue_free()
	model = null
	face_life = null
	weapons = {}


func set_capsule() -> void:
	_clear_model()
	var root := Node3D.new()
	root.name = "Mannequin"
	var mat := StandardMaterial3D.new()
	mat.albedo_color = colour
	mat.roughness = 0.8
	var mi := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.3
	cap.height = HEIGHT
	cap.radial_segments = 12
	cap.rings = 4
	mi.mesh = cap
	mi.position.y = HEIGHT * 0.5
	mi.material_override = mat
	root.add_child(mi)
	var nose := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.18, 0.12, 0.25)
	nose.mesh = bm
	nose.position = Vector3(0.0, 1.55, 0.3)
	nose.material_override = mat
	root.add_child(nose)
	root.scale = Vector3.ONE * size_k
	model = root
	body.add_child(root)
	model_info = "capsule"
	bind_info = anim.bind(root, body)
	_apply_overlay(root)


## Takes ownership of a generated GLTF scene. Normalises it to HEIGHT (x size_k) from its
## AABB, puts its feet on y=0 and centres it, then binds the CombatAnimator.
func set_model(node: Node3D) -> Dictionary:
	_clear_model()
	var holder := Node3D.new()
	holder.name = "Model"
	holder.add_child(node)
	var aabb: AABB = _model_aabb(holder)
	var s: float = 1.0
	if aabb.size.y > 0.01:
		s = HEIGHT * size_k / aabb.size.y
	holder.scale = Vector3.ONE * s
	var c: Vector3 = aabb.get_center()
	holder.position = Vector3(-c.x * s, -aabb.position.y * s, -c.z * s)
	body.add_child(holder)
	model = holder
	model_info = "glb"
	bind_info = anim.bind(holder, body, anim_opts)
	anim.arm_droop = BOSS_ARM_DROOP if role == "boss" else 0.0
	anim.play("idle")
	_apply_overlay(holder)
	face_life = FaceLifeScript.attach(holder, display_name.hash() + team) if bool(look.get("real", false)) and bool(look.get("face_life", true)) else null
	_wire_cloth(holder)
	var names: PackedStringArray = anim.player.get_animation_list() if anim.player != null else PackedStringArray()
	return {"scale": s, "height_raw": aabb.size.y, "anims": names, "mapped": bind_info.get("clips", {}),
		"bones": bind_info.get("bones", 0), "hand": bind_info.get("hand", ""), "library": anim.lib_key}


## cq 015: each surface's material is rebuilt on char_lit.gdshader, which draws the same
## textures plus the rim and the hit flash in the one pass. The old overlay (a second pass over
## every skinned vertex, ~1 ms a fighter a frame on a software GPU) is only kept for a surface
## that cannot be converted (not a plain opaque BaseMaterial3D); it is attached only while a
## flash shows, and for the first frame after load so its shader compiles during loading.
func _apply_overlay(root: Node) -> void:
	_overlay_meshes.clear()
	_lit_mats.clear()
	_lit_flash = -1.0
	_lit_glow = -1.0
	var meshes: Array[Node] = root.find_children("*", "MeshInstance3D", true, false)
	if root is MeshInstance3D:
		meshes.append(root)
	for n: Node in meshes:
		if (not rim_on and not bool(look.get("real", false))) or not _light_mesh(n as MeshInstance3D):
			_overlay_meshes.append(n)
	_overlay_on = false
	if not _overlay_meshes.is_empty():
		_flash = maxf(_flash, 0.02)   # on for the first frame: compiles the shader during loading
		_set_overlay(true)


## cq 016: cloth off the legs. The robe, coat and skirt vertices (skinned to the cq 014 secondary
## chains, whose skin binds the rig appends after the body's) are pushed out of the leg capsules in
## the fighter's own vertex shader (char_lit.gdshader); the secondary sim feeds it the capsules.
func _wire_cloth(root: Node) -> void:
	var sm: Variant = anim.secondary if anim != null else null
	var skel: Skeleton3D = anim.skeleton if anim != null else null
	if sm == null or skel == null or _lit_mats.is_empty() or not bool(anim_opts.get("cloth_push", true)):
		return
	var re := RegEx.new()
	re.compile("^(Robe|Coat|Skirt|Wing|Flame).*_(\\d+|end)$")
	var mats: Array[ShaderMaterial] = []
	for n: Node in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null or mi.skin == null:
			continue
		# the first chain bind; every bind after it must be a chain too (else this mesh is left alone)
		var first: int = -1
		var ok: bool = true
		for b in mi.skin.get_bind_count():
			var nm: String = str(mi.skin.get_bind_name(b))
			if nm == "" and mi.skin.get_bind_bone(b) >= 0:
				nm = skel.get_bone_name(mi.skin.get_bind_bone(b))
			var chain: bool = re.search(nm) != null
			if chain and first < 0:
				first = b
			elif not chain and first >= 0:
				ok = false
		if first < 0 or not ok:
			continue
		var surf: Array[Material] = []
		if mi.material_override != null:
			surf.append(mi.material_override)
		else:
			for si in mi.mesh.get_surface_count():
				surf.append(mi.get_surface_override_material(si))
		for m: Material in surf:
			if m is ShaderMaterial and _lit_mats.has(m):
				(m as ShaderMaterial).set_shader_parameter("cloth_bind0", first)
				mats.append(m as ShaderMaterial)
	sm.set("cloth_mats", mats)
	if not mats.is_empty():
		print("CQ cloth push: %d surfaces" % mats.size())


## Swaps every surface of `mi` to the lit fighter material; false if one cannot be converted.
func _light_mesh(mi: MeshInstance3D) -> bool:
	if mi.mesh == null:
		return false
	var am := mi.mesh as ArrayMesh    # realism: a surface with tangents can take the model's normal map
	_surf_tangents = am != null and am.get_surface_count() > 0 and (am.surface_get_format(0) & Mesh.ARRAY_FORMAT_TANGENT) != 0
	if mi.material_override != null:
		var o: ShaderMaterial = _lit_material(mi.material_override)
		if o == null:
			return false
		mi.material_override = o
		return true
	var subs: Array = []
	for si in mi.mesh.get_surface_count():
		_surf_tangents = am != null and (am.surface_get_format(si) & Mesh.ARRAY_FORMAT_TANGENT) != 0
		var sm: ShaderMaterial = _lit_material(mi.get_active_material(si))
		if sm == null:
			return false
		subs.append(sm)
	for si in subs.size():
		mi.set_surface_override_material(si, subs[si])
	return true


func _lit_material(m: Material) -> ShaderMaterial:
	if not (m is BaseMaterial3D):
		return null
	var b := m as BaseMaterial3D
	if bool(look.get("real", false)):
		return _real_material(b)
	if b.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or b.shading_mode != BaseMaterial3D.SHADING_MODE_PER_PIXEL \
			or b.cull_mode != BaseMaterial3D.CULL_BACK or b.vertex_color_use_as_albedo or b.normal_enabled \
			or b.emission_enabled or b.uv1_triplanar:
		return null
	var sm := ShaderMaterial.new()
	sm.shader = LIT_SHADER
	sm.set_shader_parameter("albedo_tex", b.albedo_texture)
	sm.set_shader_parameter("albedo", b.albedo_color)
	var orm: Texture2D = b.roughness_texture if b.roughness_texture != null else b.metallic_texture
	sm.set_shader_parameter("orm_tex", orm)
	var ch: Array[Vector4] = [Vector4(1, 0, 0, 0), Vector4(0, 1, 0, 0), Vector4(0, 0, 1, 0), Vector4(0, 0, 0, 1), Vector4(0.3, 0.59, 0.11, 0)]
	sm.set_shader_parameter("orm_channel_r", ch[b.roughness_texture_channel] if b.roughness_texture != null else Vector4(0, 0, 0, 1))
	sm.set_shader_parameter("orm_channel_m", ch[b.metallic_texture_channel] if b.metallic_texture != null else Vector4(0, 0, 0, 1))
	sm.set_shader_parameter("roughness", b.roughness)
	sm.set_shader_parameter("metallic", b.metallic)
	sm.set_shader_parameter("specular", b.metallic_specular)
	sm.set_shader_parameter("uv1_scale", b.uv1_scale)
	sm.set_shader_parameter("uv1_offset", b.uv1_offset)
	sm.set_shader_parameter("key_dir", key_dir)
	sm.set_shader_parameter("rim_team", _rim_team)
	sm.set_shader_parameter("rim_amount", (RIM_BOSS if role == "boss" else RIM_AMOUNT) if rim_on else 0.0)
	sm.set_shader_parameter("team_amount", RIM_TEAM)
	ArenaScript.set_hemi(sm, look)
	var tp: Dictionary = ArenaScript.time_preset(look)
	sm.set_shader_parameter("rim_key", (tp["key_color"] as Color).lerp(Color.WHITE, 0.15))
	sm.set_shader_parameter("shade_tint", shade_tint(tp))
	_lit_mats.append(sm)
	return sm


## realism: the surface on vfx/char_real.gdshader: the model's own maps (normal and emissive too), the
## key light through the shader's own light(), the street's baked cube and ambient colours for this time
## of day, the skin term from the Forge mask (or a colour guess). null if it cannot be converted.
func _real_material(b: BaseMaterial3D) -> ShaderMaterial:
	if b.shading_mode != BaseMaterial3D.SHADING_MODE_PER_PIXEL or b.cull_mode == BaseMaterial3D.CULL_FRONT \
			or b.vertex_color_use_as_albedo or b.uv1_triplanar:
		return null
	# round 4: two-sided surfaces (a donor head's shell) and see-through hair shells take the same shading through
	# variants of the shader: no culling, and the hair's alpha as a cut-out (blended hair sorts badly on a fighter)
	var two_sided: bool = b.cull_mode == BaseMaterial3D.CULL_DISABLED
	var cut: bool = b.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED
	var sm := ShaderMaterial.new()
	sm.shader = _real_variant(two_sided, cut)
	# charload-29 (look key `charload`, default off): a see-through surface is only hair when it is declared hair (or named
	# so): eyes (cornea shell), lashes and brows of a multi-part character are cut-outs without the hair shading
	var cl: bool = bool(look.get("charload", false))
	var nm_l: String = b.resource_name.to_lower()
	var kind0: String = str(surface_kinds.get(b.resource_name, ""))
	var as_hair: bool = cut or nm_l.contains("hair")
	if cl:
		as_hair = kind0 == "hair" or nm_l.contains("hair") or (cut and kind0 == "" and not nm_l.contains("eye"))
	if as_hair:
		sm.set_shader_parameter("hair_all", 1.0)
	sm.set_shader_parameter("albedo_tex", b.albedo_texture)
	sm.set_shader_parameter("albedo", b.albedo_color)
	var orm: Texture2D = b.roughness_texture if b.roughness_texture != null else b.metallic_texture
	sm.set_shader_parameter("orm_tex", orm)
	var ch: Array[Vector4] = [Vector4(1, 0, 0, 0), Vector4(0, 1, 0, 0), Vector4(0, 0, 1, 0), Vector4(0, 0, 0, 1), Vector4(0.3, 0.59, 0.11, 0)]
	sm.set_shader_parameter("orm_channel_r", ch[b.roughness_texture_channel] if b.roughness_texture != null else Vector4(0, 0, 0, 1))
	sm.set_shader_parameter("orm_channel_m", ch[b.metallic_texture_channel] if b.metallic_texture != null else Vector4(0, 0, 0, 1))
	sm.set_shader_parameter("roughness", b.roughness)
	sm.set_shader_parameter("metallic", b.metallic)
	sm.set_shader_parameter("specular", b.metallic_specular)
	sm.set_shader_parameter("uv1_scale", b.uv1_scale)
	sm.set_shader_parameter("uv1_offset", b.uv1_offset)
	if b.normal_enabled and b.normal_texture != null and _surf_tangents and bool(look.get("normal_map", true)):
		sm.set_shader_parameter("normal_tex", b.normal_texture)
		sm.set_shader_parameter("normal_amount", b.normal_scale)
	if b.emission_enabled:
		sm.set_shader_parameter("emission_tex", b.emission_texture)
		var ec: Color = b.emission * b.emission_energy_multiplier
		# charload-29: Godot's glTF import sets an emissive texture with a black colour and the ADD operator (glTF's
		# emissive = texture x factor); the shader multiplies texture by colour, so every emissive map read as zero
		if cl and b.emission_texture != null and b.emission_operator == BaseMaterial3D.EMISSION_OP_ADD:
			ec = (Color(1, 1, 1) + b.emission) * b.emission_energy_multiplier
		sm.set_shader_parameter("emission", Vector3(ec.r, ec.g, ec.b) if b.emission_texture != null else Vector3.ZERO)
	if b.ao_enabled and b.ao_texture != null and b.ao_texture == orm and b.ao_texture_channel == BaseMaterial3D.TEXTURE_CHANNEL_RED:
		sm.set_shader_parameter("ao_amount", 1.0)
	# skin: the Forge mask when the model came with one, else a guess from the colour at part strength
	var skin: String = str(look.get("skin", "full"))
	var kind: String = str(surface_kinds.get(b.resource_name, ""))
	if skin == "off" or skin == "false":
		sm.set_shader_parameter("skin_mode", 0)
	elif kind == "skin":
		# a fitted head: the whole surface is skin, the colour check still leaves out brows, lashes, the eyes and the scalp
		if _white_tex == null:
			var wimg := Image.create(1, 1, false, Image.FORMAT_R8)
			wimg.fill(Color.WHITE)
			_white_tex = ImageTexture.create_from_image(wimg)
		sm.set_shader_parameter("skin_mode", 1)
		sm.set_shader_parameter("skin_tex", _white_tex)
		sm.set_shader_parameter("skin_amount", 1.0)
		sm.set_shader_parameter("skin_wide", float(look.get("skin_wide", 1.0)))     # skinlook-28: every tone is skin here
	elif kind == "hair":
		sm.set_shader_parameter("skin_mode", 0)
		sm.set_shader_parameter("hair_all", 1.0)
	elif kind != "":
		# any other declared surface (a fitted metal mask, "metal"): no skin, and not the body's masks (other UVs)
		sm.set_shader_parameter("skin_mode", 0)
	elif skin_mask != null:
		sm.set_shader_parameter("skin_mode", 1)
		sm.set_shader_parameter("skin_tex", skin_mask)
		sm.set_shader_parameter("skin_amount", 1.0)
	elif bool(look.get("skin_guess", true)):
		sm.set_shader_parameter("skin_mode", 2)
		sm.set_shader_parameter("skin_amount", SKIN_GUESS)
	sm.set_shader_parameter("skin_lobe2", 0.18 if skin == "full" else 0.0)
	if hair_mask != null and bool(look.get("hair", true)) and kind == "":
		sm.set_shader_parameter("hair_on", true)
		sm.set_shader_parameter("hair_tex", hair_mask)
	# the street's light at this time of day
	var tp: Dictionary = ArenaScript.time_preset(look)
	var e: Dictionary = LookReal.env_for(str(look.get("time", "golden")))
	if e.is_empty():
		# not baked: the preset's flat ambient from every side, no reflections
		var ac: Color = (tp["ambient"] as Color) * float(tp["ambient_energy"])
		var flat := PackedVector3Array()
		for i in 6:
			flat.append(Vector3(ac.r, ac.g, ac.b))
		sm.set_shader_parameter("amb_cube", flat)
		sm.set_shader_parameter("env_spec", 0.0)
	else:
		sm.set_shader_parameter("env_cube", e["cube"])
		sm.set_shader_parameter("env_scale", e["scale"])
		sm.set_shader_parameter("env_lods", e["lods"])
		sm.set_shader_parameter("amb_cube", e["amb"])
		sm.set_shader_parameter("env_spec", float(look.get("ibl_k", 1.0)) if bool(look.get("ibl", true)) else 0.0)
	sm.set_shader_parameter("amb_amount", float(look.get("amb_k", REAL_FILL.get(str(look.get("time", "golden")), 1.0))))
	sm.set_shader_parameter("key_dir", key_dir)
	sm.set_shader_parameter("rim_team", _rim_team)
	sm.set_shader_parameter("rim_amount", float(look.get("rim_k", REAL_RIM)) if rim_on else 0.0)
	sm.set_shader_parameter("team_amount", RIM_TEAM)
	sm.set_shader_parameter("rim_key", (tp["key_color"] as Color).lerp(Color.WHITE, 0.15))
	# round 3: no shadow-map shadow on the fighter itself (look "self_shadow"), the key's colour toned at dusk,
	# and the camera-side fill at dusk and night in the sky's colour
	var tm: String = str(look.get("time", "golden"))
	sm.set_shader_parameter("recv_shadow", 1.0 if bool(look.get("self_shadow", true)) else 0.0)
	sm.set_shader_parameter("key_sat", float(look.get("key_sat", REAL_KEY_SAT.get(tm, 1.0))))
	var rl: Dictionary = REAL_LIGHT.get(tm, REAL_LIGHT["golden"])
	var sky: Color = tp["ambient"]
	var smax: float = maxf(sky.r, maxf(sky.g, sky.b))
	var ex: Array = look.get("expo", rl["expo"])
	sm.set_shader_parameter("expo", Vector2(float(ex[0]), float(ex[1])))
	# the kickers stand behind the fighter as the fight camera sees it (the camera's heading in the street)
	var cb: Basis = Basis.from_euler(Vector3(0.0, deg_to_rad(12.0), 0.0))
	var fwd: Vector3 = -cb.z
	var right: Vector3 = cb.x
	sm.set_shader_parameter("kick_a_dir", (fwd * 0.55 + right * 0.65 + Vector3.UP * 0.5).normalized())
	sm.set_shader_parameter("kick_a_col", Vector3(sky.r, sky.g, sky.b) / maxf(smax, 0.001) * float(look.get("kick_a", rl["ka"])))
	sm.set_shader_parameter("kick_b_dir", (fwd * 0.5 - right * 0.75 + Vector3.UP * 0.25).normalized())
	sm.set_shader_parameter("kick_b_col", Vector3(LAMP_COL.r, LAMP_COL.g, LAMP_COL.b) * float(look.get("kick_b", rl["kb"])) * float(tp.get("lamps", 0.0)))
	var kc: Color = tp["key_color"]
	var down: float = float(tp["key_energy"]) * sin(deg_to_rad(maxf(float(tp["key_elev"]), float(look.get("key_elev_min", 0.0))))) * 0.5 * float(look.get("ground_k", 1.0))
	sm.set_shader_parameter("bounce_col", Vector3(kc.r, kc.g * 0.92, kc.b * 0.82) * down * float(look.get("bounce_k", rl["bounce"])))
	sm.set_shader_parameter("occ_k", float(look.get("occ_k", 1.0)))
	# round 4: the current target keeps a readable rim (the team's colour) through the effects
	if team == 1:
		sm.set_shader_parameter("rim_amount", float(look.get("rim_k", REAL_RIM)) * 1.5 if rim_on else 0.0)
		sm.set_shader_parameter("team_amount", 0.6)
	sm.set_shader_parameter("debug_view", int(look.get("real_debug", 0)))
	# round 5: faces under the game's light (look "skin_key_desat", "skin_rough_min", "normal_fade" for trials)
	sm.set_shader_parameter("skin_key_desat", float(look.get("skin_key_desat", SKIN_KEY_DESAT.get(tm, 0.0))))
	sm.set_shader_parameter("skin_rough_min", float(look.get("skin_rough_min", SKIN_ROUGH_MIN)))
	sm.set_shader_parameter("normal_fade", float(look.get("normal_fade", NORMAL_FADE)))
	sm.set_shader_parameter("skin_gain", float(look.get("skin_gain", SKIN_GAIN.get(tm, 0.0))))
	var wb: Array = look.get("skin_wb", SKIN_WB.get(tm, [1.0, 1.0, 1.0]))
	sm.set_shader_parameter("skin_wb", Vector3(float(wb[0]), float(wb[1]), float(wb[2])))
	if _cs_on():
		_charshade(sm, b, kind, cut, two_sided)
	_lit_mats.append(sm)
	return sm


## fid29 charshade (14 Nov 2026, docs/game3d/fid29/charshade.md): every surface of a hero shades as what it is. On with
## the real look when the tier's look carries "fid_charshade" (arena.gd TIER_LOOK: mid and high); the high tier's extra steps follow look
## "skin" == "full". Presentation only: no node is added, the model holder, its AABB and every public call are unchanged.
const CS_MASK_DIR: String = "res://art/char/masks/"
const CS_HAIR_DIR: String = "res://art/char/hair/"
const CS_DETAIL: String = "res://art/char/detail/cloth_sheet.png"
const CS_BREAKUP: String = "res://art/char/detail/metal_breakup.png"
const ShaderWarmScript := preload("res://shader_warm.gd")
const CS_TILE_M: float = 0.05            # the detail tiles' size on the body at the game's scale (4 to 6 cm)
## which tile of the cloth sheet each hero's cloth and leather take (x, y of the cloth tile, x, y of the leather tile):
## tiles 0,0 woven cotton (Fabric030), 0.5,0 knit (Fabric061), 0,0.5 grained leather (Leather037), 0.5,0.5 smooth (Leather026)
const CS_TILES: Dictionary = {
	"blockbusters_kofi": Vector4(0.0, 0.0, 0.0, 0.5), "icons_imani": Vector4(0.5, 0.0, 0.5, 0.5),
	"ascendants_zuri": Vector4(0.5, 0.0, 0.5, 0.5), "celestials_lyra": Vector4(0.5, 0.0, 0.5, 0.5),
	"controllers_tavo": Vector4(0.0, 0.0, 0.0, 0.5), "everborn_oren": Vector4(0.0, 0.0, 0.0, 0.5),
}
static var _cs_info: Dictionary = {}


func _cs_on() -> bool:
	return bool(look.get("real", false)) and bool(look.get("fid_charshade", false))


## build 29 ships charshade's hair and eyes only (blind judge 16 Nov, keep-partial: the body path lost 29 to 21 on four of
## six heroes). Look "cs_body" (default off on every tier) brings the body path back for review: the material-ID masks,
## cloth sheen, the high tier's detail normals and metal break-up, orm_trust and the knee, and with them cs_on on every
## surface that is not hair or a face (specular AA, Toksvig, cavity). Off, a body or a fitted metal piece takes no
## charshade uniform and no mask, detail or break-up texture is loaded: it draws as build 28's to the pixel.
func _cs_body() -> bool:
	return bool(look.get("cs_body", false))


func _cs_high() -> bool:
	return str(look.get("skin", "full")) == "full"


## The hero this fighter plays (fight.gd puts the cast key in anim_opts), or "".
func _cs_key() -> String:
	return str(anim_opts.get("key", ""))


static func _cs_tex(path: String) -> Texture2D:
	return load(path) as Texture2D if ResourceLoader.exists(path) else null


static func _cs_json(path: String) -> Dictionary:
	if not _cs_info.has(path):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
		_cs_info[path] = d if d is Dictionary else {}
	return _cs_info[path]


func _charshade(sm: ShaderMaterial, b: BaseMaterial3D, kind: String, cut: bool, two_sided: bool) -> void:
	if kind != "hair" and kind != "skin" and not _cs_body():
		return
	sm.set_shader_parameter("cs_on", true)
	_charshade_parts(sm, b, kind, cut, two_sided)
	# review and tuning only: look "cs_u_<uniform>": <value> sets that char_real uniform on every surface
	for k: String in look:
		if k.begins_with("cs_u_"):
			var v: Variant = look[k]
			if v is Array and (v as Array).size() == 2:
				v = Vector2(float(v[0]), float(v[1]))
			elif v is Array and (v as Array).size() == 3:
				v = Vector3(float(v[0]), float(v[1]), float(v[2]))
			elif v is Array and (v as Array).size() == 4:
				v = Vector4(float(v[0]), float(v[1]), float(v[2]), float(v[3]))
			sm.set_shader_parameter(k.substr(5), v)
	ShaderWarmScript.add(sm)


## Which of the hero's masks fits this body. A mask lies in one file's UVs (lod0 or lod1, matid.py), and the file is not
## the tier's: the high tier's ally keeps the lod1 file (fight.gd _tier_lod). The files are told apart by their body map's
## width (matid.py "albedo_w" in the hero's json: lod0 2048, lod1 1024); a body that matches neither takes no mask.
func _cs_body_lod(b: BaseMaterial3D, info: Dictionary) -> String:
	var w: int = b.albedo_texture.get_width() if b.albedo_texture != null else 0
	var aw: Variant = info.get("albedo_w")
	if aw is Dictionary and int((aw as Dictionary).get("lod0", 0)) != int((aw as Dictionary).get("lod1", 0)):
		if w == int((aw as Dictionary).get("lod0", 0)):
			return "_lod0.png"
		if w == int((aw as Dictionary).get("lod1", 0)):
			return "_lod1r.png"
		return ""
	return "_lod0.png" if _cs_high() else "_lod1r.png"


func _charshade_parts(sm: ShaderMaterial, b: BaseMaterial3D, kind: String, cut: bool, two_sided: bool) -> void:
	var key: String = _cs_key()
	var high: bool = _cs_high()
	var info: Dictionary = _cs_json(CS_MASK_DIR + key + ".json") if key != "" else {}
	if kind == "" and _cs_body():
		# the body (look "cs_body" only): its material-ID mask, in the skin mask's sampler (the colour guess stays for Forge guardians)
		var lod: String = _cs_body_lod(b, info) if key != "" else ""
		var mask: Texture2D = _cs_tex(CS_MASK_DIR + key + lod) if lod != "" else null
		if mask != null:
			sm.set_shader_parameter("cs_matid", 1)
			sm.set_shader_parameter("skin_mode", 1)
			sm.set_shader_parameter("skin_tex", mask)
			# the same skin strength the colour guess had (SKIN_GUESS): only where skin is changes, not how much of it
			sm.set_shader_parameter("skin_amount", float(look.get("cs_skin_amount", SKIN_GUESS)))
			# a hero whose painted armour the classes took for cloth keeps the lift's metal there (matid.py ORM_TRUST)
			sm.set_shader_parameter("cs_orm_trust", float(info.get("orm_trust", 0.0)))
			# per-hero overrides (matid.py HERO_SHADE): Imani's cape and suit keep build 28's shading (the blind judge
			# preferred build 28's bronze cape to the mask's cloth, and the suit's sheen read as plastic)
			var rm: Variant = info.get("rough_metal")
			if rm is Array and (rm as Array).size() == 2:
				sm.set_shader_parameter("cs_rough_metal", Vector2(float(rm[0]), float(rm[1])))
			if info.has("sheen"):
				sm.set_shader_parameter("cs_sheen", float(info["sheen"]))
			var kn: Variant = info.get("lum_p50_p75_p95", {})
			if kn is Dictionary and bool(look.get("cs_knee", true)) and bool(info.get("knee", true)):
				var kl: Variant = (kn as Dictionary).get("leather")
				var kc: Variant = (kn as Dictionary).get("cloth")
				sm.set_shader_parameter("cs_knee", Vector2(float(kl[1]) if kl is Array else 0.0, float(kc[1]) if kc is Array else 0.0))
			var detail: Texture2D = _cs_tex(CS_DETAIL) if high else null
			if detail != null and bool(look.get("cs_detail", true)):
				sm.shader = _real_variant(two_sided, cut, false, true)
				sm.set_shader_parameter("cs_detail_tex", detail)
				sm.set_shader_parameter("cs_grain", 0.0)      # the leather tile's own averaged grain does it on high
				var bk: Texture2D = _cs_tex(CS_BREAKUP)
				if bk != null:
					sm.set_shader_parameter("cs_breakup_tex", bk)
				var upm: float = float(info.get("uv_per_m", 0.19))
				sm.set_shader_parameter("cs_tiles", 1.0 / maxf(upm * CS_TILE_M, 1e-4))
				sm.set_shader_parameter("cs_detail_pick", CS_TILES.get(key, Vector4(0.0, 0.0, 0.0, 0.5)))
	elif kind == "skin" and b.resource_name == "head_hybrid":
		# the hybrid head: eyes in its UVs' top-right corner (deploy/hybrid/hybrid_head.py)
		var ir: Dictionary = info.get("iris", {}) if info.get("iris") is Dictionary else {}
		var cs: Array = ir.get("centres", [[0.879, 0.1205, 0.0193], [0.9497, 0.0504, 0.0193]])
		if cs.size() == 2:
			sm.set_shader_parameter("cs_eye", 1)
			sm.set_shader_parameter("cs_iris_a", Vector4(float(cs[0][0]), float(cs[0][1]), maxf(float(cs[0][2]), 0.019), 0.0))
			sm.set_shader_parameter("cs_iris_b", Vector4(float(cs[1][0]), float(cs[1][1]), maxf(float(cs[1][2]), 0.019), 0.0))
			var ic: Array = ir.get("colour_srgb", [0.21, 0.15, 0.11])
			var c := Color(float(ic[0]), float(ic[1]), float(ic[2])).srgb_to_linear()
			sm.set_shader_parameter("cs_iris_col", Vector3(c.r, c.g, c.b))
	elif kind == "hair":
		# 16 Nov: the hair cards take charshade's hair SHADING (strand lobes along the card, root-to-tip shade, the coils'
		# broad matte sheen) on build 28's hard 0.35 cut. The shading is what turns Zuri's coils from build 28's white blob
		# (its strand highlight lit the whole coil) into dark coils; it costs +3 to +5 % hair ALU and +0 texture reads at one
		# texture format (shader_cost --raw=1, budgets.md), inside +10 % mid and +20 % high. The soft cut (alpha to
		# coverage) is what was over the budget (+33 to +69 % on the llvmpipe proxy): it stays off, look "cs_hair_soft": true
		# brings it back for a re-measure on a phone GPU.
		sm.set_shader_parameter("cs_hair_cards", 1.0)
		if str(info.get("hair_style", "")) == "curls":
			# tufts (a crop, a beard) have no one strand direction: a weak, broad highlight
			sm.set_shader_parameter("cs_hair_lobes", Vector4(0.0, 0.08, 0.035, 0.025))
		if cut and bool(look.get("cs_hair_soft", false)):
			sm.shader = _real_variant(two_sided, true, true, false)
		# the strand atlas made for this hero (tools/char/hair_atlas.py): 1K x 2K on high, 512 x 1024 on mid, soft alpha
		# for the coverage; which card columns hold strands (the rest are coils or braids) and which end is the root
		var hj: Dictionary = _cs_json(CS_HAIR_DIR + key + "_hair.json") if key != "" else {}
		var sc: Variant = hj.get("strand_columns", [1, 1, 1, 1])
		if sc is Array and (sc as Array).size() == 4:
			sm.set_shader_parameter("cs_hair_strand", Vector4(float(sc[0]), float(sc[1]), float(sc[2]), float(sc[3])))
		sm.set_shader_parameter("cs_hair_root_v", float(hj.get("root_v", 1.0)))
		# the 1K x 2K atlas only for the player's own hero on high (the intro and victory close-ups are its); the ally and
		# the Guardian are never framed that close, so they take the 512 x 1024 one (the high tier's texture budget)
		var at: Texture2D = _cs_tex(CS_HAIR_DIR + key + ("_hi.png" if high and role == "hero" else "_mid.png")) if key != "" else null
		if at != null:
			sm.set_shader_parameter("albedo_tex", at)


## realism round 5: the soft face fill. k 0 = off, 1 = the close shots' strength; `to_fill` is the world direction
## towards the fill (fight.gd: from the camera, above it, a little to its left). Only the real look's materials take it.
func set_face_fill(k: float, to_fill: Vector3) -> void:
	if _lit_mats.is_empty() or not bool(look.get("real", false)) or not bool(look.get("face_fill", true)):
		return
	if absf(k - _face_fill_k) < 0.004 and k > 0.0 and _lit_mats[0].get_shader_parameter("face_fill_dir") == to_fill:
		return
	_face_fill_k = k
	var fc: Array = look.get("face_fill_col", [FACE_FILL_COL.r, FACE_FILL_COL.g, FACE_FILL_COL.b])
	var c: Vector3 = Vector3(float(fc[0]), float(fc[1]), float(fc[2])) * k * float(look.get("face_fill_k", 1.0))
	for m: ShaderMaterial in _lit_mats:
		m.set_shader_parameter("face_fill_col", c)
		m.set_shader_parameter("face_fill_dir", to_fill)


static var _real_variants: Dictionary = {}


## fid29 charshade: `soft` (hair cards with the charshade look) = alpha to coverage on the tier's MSAA instead of the hard
## 0.35 cut ("ALPHA_ANTIALIASING_EDGE" 0.3), the alpha kept as the texture's mips thin it; `high` = the high tier's hero
## body (#define CS_HIGH: detail normals and the metal break-up). Every material charshade touches is handed to
## ShaderWarm (fid29-base), so its variant compiles while the fight loads.
static func _real_variant(two_sided: bool, cut: bool, soft: bool = false, high: bool = false) -> Shader:
	if not two_sided and not cut and not soft and not high:
		return REAL_SHADER
	var key: String = "%s%s%s%s" % [two_sided, cut, soft, high]
	if not _real_variants.has(key):
		var code: String = REAL_SHADER.code
		if two_sided:
			code = code.replace("render_mode cull_back,", "render_mode cull_disabled,")
		if cut and soft:
			code = code.replace("ambient_light_disabled;", "ambient_light_disabled, alpha_to_coverage;")
			# Godot keeps the coverage through the mips itself from ALPHA_TEXTURE_COORDINATE (alpha x (1 + mip / 4))
			code = code.replace("// ALPHA_HOOK", "ALPHA = a.a; ALPHA_SCISSOR_THRESHOLD = 0.12; ALPHA_ANTIALIASING_EDGE = 0.3; " +
				"ALPHA_TEXTURE_COORDINATE = UV * vec2(textureSize(albedo_tex, 0)); // ALPHA_HOOK")
		elif cut:
			code = code.replace("// ALPHA_HOOK", "ALPHA = a.a; ALPHA_SCISSOR_THRESHOLD = 0.35; // ALPHA_HOOK")
		if high:
			code = code.replace("// CS_DEFINES", "#define CS_HIGH\n// CS_DEFINES")
		var sh := Shader.new()
		sh.code = code
		_real_variants[key] = sh
	return _real_variants[key]


## The fighters' shade multiplier for a time preset: its shade colour brought to the brightness of
## white (only its hue), SHADE_SHARE of the way. Golden hour: a faint blue-violet on the dark side.
static func shade_tint(tp: Dictionary) -> Color:
	var sc: Color = tp.get("shade", Color.WHITE)
	var mx: float = maxf(sc.r, maxf(sc.g, sc.b))
	if mx <= 0.0:
		return Color.WHITE
	return Color.WHITE.lerp(Color(sc.r / mx, sc.g / mx, sc.b / mx), SHADE_SHARE)


func _set_overlay(on: bool) -> void:
	if on == _overlay_on:
		return
	_overlay_on = on
	for mi: MeshInstance3D in _overlay_meshes:
		if is_instance_valid(mi):
			mi.material_overlay = _overlay if on else null


static func _model_aabb(root: Node3D) -> AABB:
	var out := AABB()
	var first: bool = true
	for n: Node in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf: Transform3D = Transform3D.IDENTITY
		var p: Node = mi
		while p != null and p != root:
			if p is Node3D:
				xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var box: AABB = xf * mi.get_aabb()
		if first:
			out = box
			first = false
		else:
			out = out.merge(box)
	return out


# ---------------------------------------------------------------- weapons in hand (cq 234)

## Puts a loaded weapon scene in a hand. `att` is {bone, matrix} from
## data/attach.json (or the app's fight config): bone is the skeleton's hand
## bone ("" for a static model: the weapon goes on the model itself) and
## matrix the weapon root's transform in that bone's space (16 floats,
## column-major). The socket is a BoneAttachment3D named hand_r / hand_l on
## the hand bone, so the idle, walk and attack motion carry the weapon.
## Returns "" or why it could not.
func hold_weapon(weapon: Node3D, att: Dictionary, side: String, cls: String) -> String:
	if model == null or model_info != "glb":
		weapon.free()
		return "no model"
	var m: Array = att.get("matrix", [])
	if m.size() != 16:
		weapon.free()
		return "no grip matrix"
	var xf := Transform3D(Basis(Vector3(m[0], m[1], m[2]), Vector3(m[4], m[5], m[6]), Vector3(m[8], m[9], m[10])), Vector3(m[12], m[13], m[14]))
	var bone: String = str(att.get("bone", ""))
	var socket: Node3D
	if bone == "":
		# static model: the GLB's own root (under the size-normalising holder)
		socket = Node3D.new()
		model.get_child(0).add_child(socket)
	else:
		var sk: Skeleton3D = null
		for n: Node in model.find_children("*", "Skeleton3D", true, false):
			if (n as Skeleton3D).find_bone(bone) >= 0:
				sk = n
				break
		if sk == null:
			weapon.free()
			return "no bone " + bone
		var ba := BoneAttachment3D.new()
		ba.bone_name = bone
		sk.add_child(ba)
		socket = ba
	socket.name = "hand_" + side
	var holder := Node3D.new()
	holder.name = "weapon_" + side
	holder.transform = xf
	socket.add_child(holder)
	holder.add_child(weapon)
	if weapons.has(side):
		(weapons[side]["socket"] as Node).queue_free()
	weapons[side] = {"socket": socket, "node": holder, "class": cls, "bone": bone}
	return ""


## anim-readable: how far the lowest sole is above the fighter's ground (m; INF without sole markers).
## Review logs only (button_rec.gd): it is what "levitating" or "sunk" measures.
func sole_gap() -> float:
	if _soles.is_empty() or _feet_sk == null or not is_instance_valid(_feet_sk) or not _feet_sk.is_inside_tree():
		return INF
	var lo: float = INF
	for marks: Array in _soles:
		for mk: Array in marks:
			lo = minf(lo, (_feet_sk.global_transform * (_feet_sk.get_bone_global_pose(int(mk[0])) * (mk[1] as Vector3))).y)
	return lo - global_position.y


## anim-readable: a bone's position in the world (Vector3.INF when there is no such bone).
func bone_pos(bone: String) -> Vector3:
	if anim == null or anim.skeleton == null or not anim.skeleton.is_inside_tree():
		return Vector3.INF
	var i: int = anim.skeleton.find_bone(bone)
	if i < 0:
		return Vector3.INF
	return anim.skeleton.global_transform * anim.skeleton.get_bone_global_pose(i).origin


## The weapon's grip point (the hand) in the world, or Vector3.INF.
func grip_point(side: String = "r") -> Vector3:
	if weapons.has(side):
		return (weapons[side]["node"] as Node3D).global_position
	return Vector3.INF


# ---------------------------------------------------------------- actions

## Plays a combat state for `length` seconds: the clip if the GLB has one, else the
## procedural pose plus a body motion. `hit_at`: when the strike lands (seconds into the
## state); a clip's contact frame is lined up with it. Returns true when a clip plays it.
func act(state: String, length: float, hit_at: float = -1.0) -> bool:
	if dead and state != "death":
		# a hit landing after the killing blow (a bolt in flight) must not stand a clip
		# character back up out of its held death pose (cq 014: the boss and the Guardian
		# have clips now)
		return anim.has_clip("death")
	if state != "death":
		anim.variant.erase(state)
	if state == "hit" and _next_hit != "" and anim.has_clip(_next_hit):
		anim.variant["hit"] = _next_hit
	_next_hit = ""
	var clip: bool = anim.play(state, length, hit_at)
	_hit_at = hit_at
	var tm: Dictionary = anim.timing.get(state, {})
	if clip and bool(tm.get("readable", false)) and state in READABLE_AIM:
		# anim-readable: on the target by the contact, held through the clip's tail
		_aim_yaw = yaw + deg_to_rad(float(tm.get("aim_yaw_deg", 0.0)))
		_aim_t = (hit_at if hit_at > 0.0 else length * 0.5) + AIM_AFTER + float(tm.get("tail", 0)) / float(tm.get("fps", 30.0))
	elif aim_hold and state in AIM_STATES:
		# round 2: a clip whose swing lands to one side of its own forward (the classic chop cuts 35
		# to 55 degrees to the right) is turned by its "aim_yaw_deg" so the blade meets the target
		_aim_yaw = yaw + deg_to_rad(float((anim.timing.get(state, {}) as Dictionary).get("aim_yaw_deg", 0.0)))
		_aim_t = (hit_at if hit_at > 0.0 else length * 0.5) + AIM_AFTER
	_motion = state
	_mt = 0.0
	_mlen = length
	# build 21: the procedural spin turns clockwise seen from above, as the whirl clips do (their
	# hips turn -360 deg) and as fx.whirl's ring and blades turn
	_spin_dir = -1.0
	return clip


func set_guard(on: bool) -> void:
	if on == guarding:
		return
	guarding = on
	guard_t = 0.0
	if on:
		anim.play("guard")
	elif anim.state == "guard":
		anim.state = "_"


func flash(amount: float = 1.0) -> void:
	_flash = maxf(_flash, amount)


## The hit's pop, and (fight-anim) the additive recoil away from `push` (the blow's direction in
## the world; zero = pushed back) at `strength` (0.5 light or blocked, 1 heavy, 1.4 crit).
func hurt_pop(push: Vector3 = Vector3.ZERO, strength: float = 0.8) -> void:
	_pop_t = 0.0
	anim.flinch(push, strength)


## fight-anim: a blow the body takes without a new clip (a block, a barrier): the recoil only.
func flinch(push: Vector3, strength: float) -> void:
	anim.flinch(push, strength)


## realism round 2: holds this fighter's animation for `secs` more (drawing only).
func hit_pause(secs: float) -> void:
	if weight_fx:
		_vis_pause = maxf(_vis_pause, secs)


## fight-anim: a hit reaction for `length` seconds, unless an attack or skill clip still owns the
## body (the Guardian mid-swing): then the recoil already playing on top of it shows the hit, and
## the swing is not cut into a hit clip (the old 165 deg/frame snap). Presentation only: callers
## that change the game (the hero's interrupted swing, a stagger) keep calling act("hit").
func react_hit(length: float) -> void:
	if anim.busy_action():
		_next_hit = ""
		return
	act("hit", length)


## anim-readable: sizes the next hit reaction to the blow (presentation only): a light one (under 80,
## not heavy) plays "hit_light", a heavy blow, a crit or 110 and more plays "hit_heavy", the rest "hit".
## Each only when this character's library has it.
func hit_size(amount: int, heavy: bool, crit: bool) -> void:
	_next_hit = ""
	if heavy or crit or amount >= 110:
		_next_hit = "hit_heavy"
	elif amount < 80:
		_next_hit = "hit_light"


## look-fight: the body shakes side to side for `secs` (the hit-stop), `amp` metres, fading.
## The body node only: the fighter's position, hurtbox and weapon arc never move.
func shudder(secs: float, amp: float) -> void:
	_shud_t = secs
	_shud_len = maxf(0.001, secs)
	_shud_amp = amp


## look-fight: the fallen Guardian glows and folds away over `secs` (fx.motes carries it off).
func dissolve(secs: float) -> void:
	_diss_t = 0.0
	_diss_len = maxf(0.05, secs)


func knock(dir: Vector3, metres: float) -> void:
	# an impulse that travels about `metres` under the 9/s friction in tick_physics
	var d: Vector3 = Vector3(dir.x, 0.0, dir.z)
	if d.length_squared() < 0.0001:
		d = -forward()
	kb_vel = d.normalized() * metres * 9.0


func give_shield(amount: int, seconds: float) -> void:
	shield_hp = amount
	shield_t = seconds
	if _dome == null:
		_dome = MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 1.0
		sm.height = 1.0           # a half-height sphere: a dome
		sm.radial_segments = 24
		sm.rings = 8
		sm.is_hemisphere = true
		_dome.mesh = sm
		_dome_mat = ShaderMaterial.new()
		_dome_mat.shader = DOME_SHADER
		_dome.material_override = _dome_mat
		_dome.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_dome)
	var r: float = 1.15 * size_k
	_dome.scale = Vector3(r, HEIGHT * size_k * 0.75, r)
	_dome.visible = true
	_dome_age = 0.0
	_shatter_t = -1.0
	_dome_mat.set_shader_parameter("shatter", 0.0)
	_dome_mat.set_shader_parameter("tile", preload("res://art/fx/fx_tile.png"))


## Damage through the barrier first. Returns what is left for the HP.
func absorb(amount: int) -> int:
	if shield_hp <= 0:
		return amount
	var took: int = mini(shield_hp, amount)
	shield_hp -= took
	_dome_hit = 1.0
	if shield_hp <= 0:
		shield_t = minf(shield_t, 0.25)
	return amount - took


func give_buff(mult: float, seconds: float) -> void:
	buff_mult = mult
	buff_t = seconds
	if _aura == null:
		_aura = MeshInstance3D.new()
		var q := PlaneMesh.new()
		q.size = Vector2(2.2, 2.2) * size_k
		_aura.mesh = q
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.albedo_texture = preload("res://art/fx/magic_02.png")
		m.albedo_color = Color(1.0, 0.75, 0.3, 0.9)
		m.disable_receive_shadows = true
		_aura.material_override = m
		_aura.position.y = 0.06
		_aura.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_aura)
	_aura.visible = true


func die() -> void:
	if dead:
		return
	dead = true
	hp = 0
	_death_t = 0.0
	# realism-20261111: felled from behind, the body falls forward (library state "death_fwd")
	if kb_vel.length() > 0.5 and kb_vel.normalized().dot(forward()) > 0.3 and anim.has_clip("death_fwd"):
		anim.variant["death"] = "death_fwd"
	else:
		anim.variant.erase("death")
	set_guard(false)
	shield_t = 0.0
	buff_t = 0.0
	act("death", 1.2)
	hurtbox.monitorable = false


func celebrate() -> void:
	celebrating = true
	_cele_t = 0.0
	set_guard(false)
	act("victory", 1.4)


## Timers that run with game logic (frozen in hit-stop).
func tick_logic(dt: float) -> void:
	iframes = maxf(0.0, iframes - dt)
	stagger = maxf(0.0, stagger - dt)
	if guarding:
		guard_t += dt
	if shield_t > 0.0:
		shield_t -= dt
		if shield_t <= 0.0:
			shield_hp = 0
	if buff_t > 0.0:
		buff_t -= dt
		if buff_t <= 0.0:
			buff_mult = 1.0
	if kb_vel.length_squared() > 0.0001:
		position += kb_vel * dt
		kb_vel = kb_vel * exp(-9.0 * dt)
		if kb_vel.length() < 0.05:
			kb_vel = Vector3.ZERO


## Visual tick: animator, procedural body motion, flash, dome, aura.
func tick_visual(dt: float) -> void:
	if _vis_pause > 0.0 and not anim_freeze:
		_vis_pause = maxf(0.0, _vis_pause - dt)
	anim.frozen = anim_freeze or _vis_pause > 0.0
	anim.floor_y = global_position.y
	if face_life != null:
		face_life.tick(dt, anim.frozen or dead)
	# realism-20261111: the animation follows the ground the body really covers. The game reports
	# the speed it asked for (speed_now) even when the arena edge or another body pushes the
	# fighter straight back (the ally "ran" on the spot against the edge, 7 cm forward and back each
	# frame): over the last 4 frames the net travel caps the speed the legs are animated at.
	var anim_speed: float = speed_now
	if real_speed and dt > 0.0 and not anim_freeze:
		_trail.append(global_position)
		_trail_dt.append(dt)
		if _trail.size() > 5:
			_trail.pop_front()
			_trail_dt.pop_front()
		if _trail.size() >= 4:
			var span: float = 0.0
			for i in range(1, _trail_dt.size()):
				span += float(_trail_dt[i])
			var net: Vector3 = (_trail[-1] as Vector3) - (_trail[0] as Vector3)
			net.y = 0.0
			anim_speed = minf(speed_now, net.length() / maxf(0.001, span) * 1.1 + 0.15)
			if anim_speed < 0.45:
				anim_speed = 0.0    # a creep is a stand (and the state does not flicker between idle and walk)
			# how much of the last frames' travel was there-and-back
			var path: float = 0.0
			for i in range(1, _trail.size()):
				path += Vector2((_trail[i] as Vector3).x - (_trail[i - 1] as Vector3).x, (_trail[i] as Vector3).z - (_trail[i - 1] as Vector3).z).length()
			var jt: float = clampf(1.0 - net.length() / maxf(0.001, path) * 1.6, 0.0, 1.0) if path > 0.06 and kb_vel.length() < 0.5 else 0.0
			_jit = lerpf(_jit, jt, 0.35)
	if real_speed:
		if _smooth_pos == Vector3.INF or (_smooth_pos - global_position).length() > 1.0:
			_smooth_pos = global_position
		_smooth_pos = _smooth_pos.lerp(global_position, 1.0 - exp(-dt * 9.0))
	if turn_steps and dt > 0.0 and not anim_freeze:
		if not is_nan(_turn_prev) and not dead:
			var dyaw: float = absf(wrapf(yaw - _turn_prev, -PI, PI))
			if dyaw / dt > TURN_STEP_RATE and anim_speed < 0.2 and anim.state in ["idle", "_", "walk"]:
				_turn_step_t = TURN_STEP_HOLD
		_turn_prev = yaw
		if _turn_step_t > 0.0:
			_turn_step_t -= dt
			if anim_speed < 0.2 and anim.state in ["idle", "_", "walk"] and not dead:
				anim_speed = TURN_STEP_SPEED
	anim.update(dt, anim_speed, dead or celebrating)
	var vdt: float = 0.0 if anim_freeze else dt
	var pos := Vector3.ZERO
	var rot := Vector3.ZERO
	var sc: float = 1.0
	var clip: bool = anim.has_clip(_motion) and not anim.body_with_clip(_motion)
	if _motion != "" and _mlen > 0.0:
		_mt += vdt
		var k: float = _mt / _mlen
		if k >= 1.0 and _motion != "death" and _motion != "victory":
			_motion = ""
		elif not clip:
			_body_motion(_motion, clampf(k, 0.0, 1.0), pos, rot)
			pos = _bm_pos
			rot = _bm_rot
	if _pop_t >= 0.0:
		_pop_t += vdt
		if _pop_t > 0.15:
			_pop_t = -1.0
		else:
			sc = 1.0 + 0.08 * (1.0 - _pop_t / 0.15)
	if dead and _death_t >= 0.0 and not anim.has_clip("death"):
		_death_t += vdt
		var kd: float = clampf(_death_t / 0.6, 0.0, 1.0)
		rot.x = -PI * 0.5 * ease(kd, 0.5)
		pos.y = -0.25 * kd
	if celebrating and not anim.has_clip("victory"):
		_cele_t += vdt
		pos.y += absf(sin(_cele_t * 7.0)) * 0.3
	if guarding and not anim.has_clip("guard"):
		pos.y -= 0.06
	if _shud_t > 0.0:
		_shud_t = maxf(0.0, _shud_t - dt)
		_shud_clock += dt
		var sk: float = _shud_t / _shud_len
		pos.x += sin(_shud_clock * 95.0) * _shud_amp * sk
		pos.z += sin(_shud_clock * 71.0 + 1.1) * _shud_amp * 0.5 * sk
	var sxz: float = 1.0
	if _diss_t >= 0.0:
		_diss_t += dt
		var kd2: float = clampf(_diss_t / _diss_len, 0.0, 1.0)
		_glow = maxf(_glow, 0.9 * (1.0 - kd2) + 0.3)
		sxz = 1.0 - ease(kd2, 2.2)
		sc *= 1.0 + 0.08 * sin(kd2 * PI)
		if kd2 >= 1.0:
			visible = false
			_diss_t = -1.0
	# fight-anim: the drawn body eases after the yaw (see TURN_RATE)
	if is_nan(_vis_yaw):
		_vis_yaw = yaw
	if _aim_t > 0.0 and not dead:
		_aim_t -= vdt
		_vis_yaw = lerp_angle(_vis_yaw, _aim_yaw, 1.0 - exp(-dt * AIM_RATE))
	else:
		_vis_yaw = lerp_angle(_vis_yaw, yaw, 1.0 - exp(-dt * TURN_RATE))
	var lag: float = wrapf(_vis_yaw - yaw, -PI, PI)
	if absf(lag) > TURN_LAG_MAX:
		lag = signf(lag) * TURN_LAG_MAX
		_vis_yaw = yaw + lag
	rot.y += lag
	# build 21: the whirl ends facing its target (the body only; see face_yaw)
	if _motion == "skill_whirl" and not is_nan(face_yaw) and _mlen > 0.0 and not dead:
		var fk: float = smoothstep(FACE_FROM, 1.0, clampf(_mt / _mlen, 0.0, 1.0))
		_face_off = wrapf(face_yaw - yaw, -PI, PI) * fk
		rot.y += _face_off
	elif _face_off != 0.0:
		# the spin is over: the drawn body keeps that heading and eases back onto the yaw (TURN_RATE)
		_vis_yaw = yaw + _face_off
		rot.y += _face_off - lag
		_face_off = 0.0
	# fight-anim: a knockback shove leans the body with the push and sinks it a little (the feet
	# are planted while the game slides the fighter back, so the body reads as shoved, not gliding)
	var kv: float = kb_vel.length()
	if kv < 0.05:
		_staggering = false
	elif kv >= STAGGER_V and not _staggering and not dead and anim.has_clip("stagger") and not anim.busy_action() \
			and (kb_vel.normalized().dot(forward()) < -0.4 or (kb_vel.normalized().dot(forward()) > 0.4 and anim.has_clip("stagger_fwd"))):
		# the shove decays 9/s: it is above 1 m/s for ln(kv)/9 s; the step covers that, then blends back
		_staggering = true
		# realism-20261111: shoved from behind, the body stumbles forward (library state "stagger_fwd")
		if kb_vel.normalized().dot(forward()) > 0.4:
			anim.variant["stagger"] = "stagger_fwd"
		else:
			anim.variant.erase("stagger")
		anim.play("stagger", clampf(log(kv) / 9.0 + 0.12, 0.3, 0.6))
	if kv > 1.0 and not dead:
		var kk: float = clampf((kv - 1.0) / 6.0, 0.0, 1.0)
		var kl: Vector3 = global_basis.orthonormalized().inverse() * kb_vel.normalized()
		rot.x += 0.32 * kk * kl.z
		rot.z -= 0.32 * kk * kl.x
		pos.y -= 0.07 * kk * size_k
	if weight_fx and not dead:
		# the attacker leans into the blow round the contact
		if _hit_at > 0.0 and _motion in AIM_STATES and _mlen > 0.0 and anim.has_clip(_motion):
			var lt: float = _mt - _hit_at
			var le: float = clampf(1.0 + lt / LUNGE_IN, 0.0, 1.0) if lt < 0.0 else clampf(1.0 - lt / LUNGE_OUT, 0.0, 1.0)
			pos.z += LUNGE_M * size_k * le * le * (3.0 - 2.0 * le)
		# the victim's hips give with the flinch, away from the blow
		var ge: float = anim._flinch_env() * minf(anim._flinch_k, 1.4)
		if ge > 0.001:
			pos += Vector3(anim._flinch_dir.x, 0.0, anim._flinch_dir.z) * GIVE_M * size_k * ge
			pos.y -= GIVE_DROP * size_k * ge
	if real_speed and _jit > 0.02 and not dead:
		# drawn on the smoothed path while the game jitters the fighter
		var off: Vector3 = global_basis.orthonormalized().inverse() * ((_smooth_pos - global_position) * _jit)
		pos += Vector3(off.x, 0.0, off.z)
	var bscale := Vector3(sc * sxz, sc * (1.0 + 0.6 * (1.0 - sxz)) * maxf(0.05, sxz), sc * sxz)
	# build 21: the lower foot on the paving, with this frame's lean and offsets (see _plant_target)
	# anim-readable: the readable clips crouch and rise more, so the plant follows faster (no float on the way back up)
	_plant_y = lerpf(_plant_y, _plant_target(Basis.from_euler(rot).scaled(bscale), pos.y), 1.0 - exp(-dt * (PLANT_RATE_READABLE if turn_steps else PLANT_RATE)))
	pos.y += _plant_y
	body.position = pos
	body.rotation = rot
	body.scale = bscale
	if _cast != null:
		_cast.visible = visible
		_cast.global_transform = Transform3D(Basis(Vector3.UP, _cast_yaw), global_position + _cast_off + Vector3(0, 0.04, 0))
	_tick_feet()
	# hit flash
	if _flash > 0.0 and _shud_t <= 0.0:
		# build 20 pass 2: the flash holds through the hit-stop (the shudder), then fades
		_flash = maxf(0.0, _flash - dt * 6.0)
	if _glow > 0.0 and _diss_t < 0.0:
		_glow = maxf(0.0, _glow - dt * 6.0)
	_overlay.set_shader_parameter("flash", _flash)
	_overlay.set_shader_parameter("glow", _glow)
	_set_overlay((_flash > 0.0 or _glow > 0.0) and not _overlay_meshes.is_empty())
	if _flash != _lit_flash or _glow != _lit_glow:
		_lit_flash = _flash
		_lit_glow = _glow
		for m: ShaderMaterial in _lit_mats:
			m.set_shader_parameter("flash", _flash)
			m.set_shader_parameter("glow", _glow)
	if _dome != null:
		var on: bool = shield_t > 0.0 and not dead
		if not on and _dome.visible and _shatter_t < 0.0:
			_shatter_t = 0.0
			shield_ended.emit(global_position, 1.15 * size_k)
		if _shatter_t >= 0.0:
			# the dome breaks up cell by cell over 0.3 s (fx throws the shards)
			_shatter_t += dt
			_dome_mat.set_shader_parameter("shatter", clampf(_shatter_t / 0.3, 0.0, 1.0))
			_dome_mat.set_shader_parameter("hit", 1.0)
			if _shatter_t >= 0.3:
				_shatter_t = -1.0
				_dome.visible = false
		else:
			_dome.visible = on
		if on:
			_dome_age += dt
			_dome_hit = maxf(0.0, _dome_hit - dt * 4.0)
			var fade: float = clampf(shield_t / 0.4, 0.0, 1.0)
			_dome_mat.set_shader_parameter("alpha", maxf(fade, 0.6))
			_dome_mat.set_shader_parameter("hit", _dome_hit + maxf(0.0, 1.0 - _dome_age / 0.25))
			var pop: float = 1.0 + 0.12 * sin(clampf(_dome_age / 0.22, 0.0, 1.0) * PI) - 0.25 * maxf(0.0, 1.0 - _dome_age / 0.1)
			var r: float = 1.15 * size_k
			_dome.scale = Vector3(r, HEIGHT * size_k * 0.75, r) * pop
	if _aura != null:
		_aura.visible = buff_t > 0.0 and not dead
		if _aura.visible:
			_aura.rotation.y += dt * 1.6
			(_aura.material_override as StandardMaterial3D).albedo_color.a = 0.85 * clampf(buff_t / 0.5, 0.0, 1.0)


var _bm_pos: Vector3
var _bm_rot: Vector3

# build 20 pass 2: contact shadows under each foot. The sun blob is a broad soft disc round the
# fighter; on its own it read as a shadow the body floated over. Each foot now has a small, dark,
# tight shadow right under it (the ankle/toe bones projected to the ground) that fades and widens
# as the foot lifts, so a planted foot reads as touching the paving. Presentation only.
const FOOT_SHADOW: Vector2 = Vector2(0.42, 0.62)    # m (across, along the foot) at size 1
const FOOT_LIFT_FADE: float = 0.32                   # m: a foot this high has no contact shadow
const FOOT_ALPHA: float = 0.78
const FOOT_BONES: Array = [["LeftToeBase", "LeftFoot", "foot.L", "Foot_L"], ["RightToeBase", "RightFoot", "foot.R", "Foot_R"]]
var _feet: Array = []          # [[MeshInstance3D, toe bone, ankle bone], ...]
var _feet_sk: Skeleton3D = null
var _feet_mat: StandardMaterial3D
var foot_shadows: bool = true  # set false by fight.gd from the look ("feet": false)
static var _foot_tex: ImageTexture


## The foot shadow's texture: a soft dark ellipse with a denser core (64 px, drawn once).
static func _foot_shadow_tex() -> ImageTexture:
	if _foot_tex != null:
		return _foot_tex
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		for x in 64:
			var d: float = Vector2((x + 0.5) / 32.0 - 1.0, (y + 0.5) / 32.0 - 1.0).length()
			var a: float = clampf(1.0 - d, 0.0, 1.0)
			a = 0.55 * pow(a, 0.9) + 0.45 * pow(a, 3.0)
			img.set_pixel(x, y, Color(0.05, 0.03, 0.08, a))
	img.generate_mipmaps()
	_foot_tex = ImageTexture.create_from_image(img)
	return _foot_tex


func _bind_feet() -> void:
	for f: Array in _feet:
		(f[0] as Node).queue_free()
	_feet = []
	_feet_sk = anim.skeleton
	_soles = []
	_plant_y = 0.0
	if _feet_sk == null:
		return
	_find_soles()
	if not foot_shadows:
		return
	if _feet_mat == null:
		_feet_mat = StandardMaterial3D.new()
		_feet_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_feet_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_feet_mat.albedo_texture = _foot_shadow_tex()
		_feet_mat.disable_receive_shadows = true
		_feet_mat.vertex_color_use_as_albedo = false
	for names: Array in FOOT_BONES:
		var toe: int = -1
		var ankle: int = -1
		for nm: String in names:
			var b: int = _feet_sk.find_bone(nm)
			if b < 0:
				continue
			if nm.contains("Toe"):
				toe = b
			elif ankle < 0:
				ankle = b
		if ankle < 0 and toe < 0:
			continue
		var mi := MeshInstance3D.new()
		mi.name = "FootShadow"
		var q := PlaneMesh.new()
		q.size = FOOT_SHADOW * size_k
		mi.mesh = q
		var m: StandardMaterial3D = _feet_mat.duplicate()
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.top_level = true
		add_child(mi)
		_feet.append([mi, toe, ankle, FOOT_BONES.find(names)])


func _tick_feet() -> void:
	if anim.skeleton != _feet_sk:
		_bind_feet()
	if _feet.is_empty() or _feet_sk == null or not is_instance_valid(_feet_sk):
		return
	var xf: Transform3D = _feet_sk.global_transform
	var gy: float = global_position.y
	var fwd: Vector3 = (body.global_basis.z * Vector3(1, 0, 1))
	var yaw_v: float = atan2(fwd.x, fwd.z) if fwd.length_squared() > 0.0001 else yaw
	for f: Array in _feet:
		var mi: MeshInstance3D = f[0]
		var toe: int = f[1]
		var ankle: int = f[2]
		var pa: Vector3 = xf * _feet_sk.get_bone_global_pose(ankle if ankle >= 0 else toe).origin
		var pt: Vector3 = xf * _feet_sk.get_bone_global_pose(toe).origin if toe >= 0 else pa
		# the sole's height: the lower of the toe and (the ankle less its own height off the sole)
		var h: float = maxf(0.0, minf(pt.y - gy - 0.03 * size_k, pa.y - gy - 0.09 * size_k))
		var c: Vector3 = pa.lerp(pt, 0.55)
		# build 21: where the mesh's sole is known (_soles), the shadow sits under it and fades by
		# its real height. A hoof's "foot" bone is the hock, high behind the hoof: the old
		# ankle-to-toe midpoint put the Guardian's shadows behind its hooves (it read as hovering).
		var fi: int = f[3]
		if fi >= 0 and fi < _soles.size() and not (_soles[fi] as Array).is_empty():
			var lo: float = INF
			var pts: Array[Vector3] = []
			for mk: Array in _soles[fi]:
				var w: Vector3 = xf * (_feet_sk.get_bone_global_pose(int(mk[0])) * (mk[1] as Vector3))
				lo = minf(lo, w.y)
				pts.append(w)
			var cs := Vector3.ZERO
			var nc: int = 0
			for w: Vector3 in pts:
				if w.y < lo + 0.06 * size_k:   # the part of the foot that is down
					cs += w
					nc += 1
			c = cs / float(maxi(1, nc))
			h = maxf(0.0, lo - gy)
		if anim.foot != null and fi >= 0:
			# realism-20261111: the shadow goes with the locked foot, not with the clip's
			var lo_off: Vector3 = anim.foot.offset(fi)
			c += Vector3(lo_off.x, 0.0, lo_off.z)
			h = maxf(0.0, h + lo_off.y)
		var k: float = clampf(1.0 - h / (FOOT_LIFT_FADE * size_k), 0.0, 1.0)
		mi.visible = visible and k > 0.02 and not (dead and _diss_t >= 0.0)
		if not mi.visible:
			continue
		var grow: float = 1.0 + 0.5 * (1.0 - k)
		mi.global_transform = Transform3D(Basis(Vector3.UP, yaw_v).scaled(Vector3(grow, 1.0, grow)), Vector3(c.x, gy + 0.05, c.z))
		(mi.material_override as StandardMaterial3D).albedo_color = Color(1, 1, 1, (0.95 if bool(look.get("real", false)) else FOOT_ALPHA) * k * k * (SOFT_FOOT_K if soft_shadows else 1.0))


# build 21: planted feet. The retargeted clips put a character's feet where a human's go, and a
# rig whose proportions differ (the Guardian's hooves and long shins) stood a few centimetres off
# the paving in its idle and sank up to 35 cm into it in its chop and its stagger. Each foot gets
# a few sole markers (its lowest mesh vertices in the rest pose, in the foot bone's space); every
# frame the body (the drawn model only) moves up or down so the lower sole touches the ground,
# eased, in the states where a foot should be down. Presentation only: the fighter's position,
# hurtbox and weapon arc are the game's and never move.
const PLANT_RATE: float = 18.0              # 1/s
const PLANT_RATE_READABLE: float = 40.0     # 1/s, with the readable clips
const PLANT_MAX: float = 0.45               # m at size 1: the most the body moves
const PLANT_STATES: Array[String] = ["idle", "_", "walk", "hit", "stagger", "guard", "parry", "heavy",
	"attack_1", "attack_2", "skill_charge", "skill_whirl", "skill_rally", "skill_shield"]
const PLANT_LIFT_ONLY: Array[String] = ["run", "sprint"]   # a stride leaves the ground: only lift a sunk foot
## anim-readable (Wale, 13 Nov: "the players are kind of levitating"): with the readable clips on, every
## standing action keeps its lower sole on the paving too (it floated through the third cut, SHOOT, RAIN,
## SPLIT and the intro), and a fall or knockdown is only kept from sinking
const PLANT_READABLE: Array[String] = ["attack_3", "skill_shoot", "skill_rain", "skill_split", "intro", "sprint_stop"]
const PLANT_LIFT_READABLE: Array[String] = ["knockdown"]
var foot_plant: bool = true                 # set false by fight.gd from the look ("plant": false)
var _soles: Array = []                      # per foot (FOOT_BONES order): [[bone, Vector3 in bone space], ...]
var _plant_y: float = 0.0


## The sole markers: per foot, for each of its bones (the foot and the toe), the vertices weighted
## mostly to that bone that stick out furthest along SOLE_DIRS in the rest pose (the bone's hull
## seen from below and the sides), kept in the bone's own space. Whatever the clip does to the
## foot, its lowest point is one of them, at a few transforms a frame.
const SOLE_DIRS: Array[Vector3] = [Vector3(0, -1, 0), Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 0, 1),
	Vector3(0, 0, -1), Vector3(0.707, -0.707, 0), Vector3(-0.707, -0.707, 0), Vector3(0, -0.707, 0.707),
	Vector3(0, -0.707, -0.707), Vector3(0.577, -0.577, 0.577), Vector3(-0.577, -0.577, 0.577),
	Vector3(0.577, -0.577, -0.577), Vector3(-0.577, -0.577, -0.577), Vector3(0.707, 0, 0.707),
	Vector3(-0.707, 0, 0.707), Vector3(0.707, 0, -0.707), Vector3(-0.707, 0, -0.707)]
func _find_soles() -> void:
	_soles = []
	var sk: Skeleton3D = _feet_sk
	if sk == null or model == null:
		return
	var foot_of: Dictionary = {}    # bone -> foot index
	for fi in FOOT_BONES.size():
		for nm: String in FOOT_BONES[fi]:
			var b: int = sk.find_bone(nm)
			if b >= 0:
				foot_of[b] = fi
	if foot_of.is_empty():
		return
	var best: Dictionary = {}       # bone -> [[score, local] per SOLE_DIRS]
	for n: Node in model.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.skin == null or mi.mesh == null or mi.name == "FootShadow":
			continue
		var bind_bone: Dictionary = {}   # bind -> [bone, bind pose, bone rest]
		for bi in mi.skin.get_bind_count():
			var bone: int = mi.skin.get_bind_bone(bi)
			if bone < 0:
				bone = sk.find_bone(str(mi.skin.get_bind_name(bi)))
			if foot_of.has(bone):
				bind_bone[bi] = [bone, mi.skin.get_bind_pose(bi), sk.get_bone_global_rest(bone)]
		if bind_bone.is_empty():
			continue
		for si in mi.mesh.get_surface_count():
			var arr: Array = mi.mesh.surface_get_arrays(si)
			var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var bi_arr: Variant = arr[Mesh.ARRAY_BONES]
			var bw_arr: Variant = arr[Mesh.ARRAY_WEIGHTS]
			if bi_arr == null or bw_arr == null or v.is_empty():
				continue
			var bones: PackedInt32Array = bi_arr
			var weights: PackedFloat32Array = bw_arr
			var nb: int = bones.size() / v.size()
			if nb < 1:
				continue
			for i in v.size():
				var top: int = -1
				var tw: float = 0.0
				for j in nb:
					if weights[i * nb + j] > tw:
						tw = weights[i * nb + j]
						top = bones[i * nb + j]
				if tw < 0.5 or not bind_bone.has(top):
					continue
				var bb: Array = bind_bone[top]
				var bone_i: int = bb[0]
				var local: Vector3 = (bb[1] as Transform3D) * v[i]
				var rest: Vector3 = (bb[2] as Transform3D) * local
				if not best.has(bone_i):
					var init: Array = []
					for d in SOLE_DIRS.size():
						init.append([-INF, Vector3.ZERO])
					best[bone_i] = init
				var row: Array = best[bone_i]
				for d in SOLE_DIRS.size():
					var sc: float = rest.dot(SOLE_DIRS[d])
					if sc > float(row[d][0]):
						row[d] = [sc, local]
	for fi in FOOT_BONES.size():
		var marks: Array = []
		for bone_i: int in best:
			if int(foot_of[bone_i]) != fi:
				continue
			var seen: Dictionary = {}
			for e: Array in best[bone_i]:
				if float(e[0]) > -INF and not seen.has(e[1]):
					seen[e[1]] = true
					marks.append([bone_i, e[1]])
		_soles.append(marks)


## The lower sole's height (m) over the body node's origin when the body is turned and scaled by
## `b` (the body's own position never feeds back), INF when the model has no sole markers.
func sole_height(b: Basis = Basis.IDENTITY) -> float:
	if _soles.is_empty() or _feet_sk == null or not is_instance_valid(_feet_sk) or body == null:
		return INF
	var m: Transform3D = Transform3D(b, Vector3.ZERO) * body.global_transform.affine_inverse() * _feet_sk.global_transform
	var lo: float = INF
	for marks: Array in _soles:
		for mk: Array in marks:
			lo = minf(lo, (m * (_feet_sk.get_bone_global_pose(int(mk[0])) * (mk[1] as Vector3))).y)
	return lo


## How far the body moves (m, up +) so the lower sole touches the ground: `b` is this frame's body
## turn and scale (a knockback lean), `y0` the body's other offsets this frame (the knockback sink).
func _plant_target(b: Basis, y0: float) -> float:
	if not foot_plant or dead or celebrating or _diss_t >= 0.0 or not anim.has_clip(anim.state if anim.state != "_" else "idle"):
		return 0.0
	var st: String = anim.state
	var lift_only: bool = st in PLANT_LIFT_ONLY or (turn_steps and st in PLANT_LIFT_READABLE)
	if not lift_only and not (st in PLANT_STATES) and not (turn_steps and st in PLANT_READABLE):
		return 0.0
	var h: float = sole_height(b)
	if h == INF:
		return 0.0
	h += y0
	var lim: float = PLANT_MAX * size_k
	return clampf(maxf(-h, 0.0) if lift_only else -h, -lim, lim)


## Root-motion stand-ins per state; k is the state's phase 0..1.
func _body_motion(st: String, k: float, pos: Vector3, rot: Vector3) -> void:
	match st:
		"attack_1", "attack_2":
			var f: float = k / 0.3 if k < 0.3 else 1.0 - ease((k - 0.3) / 0.7, 0.6)
			pos.z += 0.3 * f
			rot.x += 0.14 * f
		"attack_3", "heavy":
			var f3: float = k / 0.45 if k < 0.45 else 1.0 - ease((k - 0.45) / 0.55, 0.6)
			pos.z += 0.5 * f3
			pos.y += 0.25 * sin(clampf(k / 0.45, 0.0, 1.0) * PI)
			rot.x += 0.22 * f3
		"skill_whirl":
			rot.y += TAU * 2.0 * ease(k, 0.8) * _spin_dir
		"skill_charge":
			rot.x += 0.35 * sin(k * PI)
		"skill_split":
			pos.y += 0.9 * sin(clampf(k / 0.45, 0.0, 1.0) * PI) if k < 0.45 else 0.0
			if k >= 0.45 and k < 0.7:
				pos.y -= 0.12 * sin((k - 0.45) / 0.25 * PI)
		"skill_rally", "skill_shield":
			pos.y += 0.12 * sin(k * PI)
		"hit":
			pos.z -= 0.18 * sin(k * PI)
			rot.x -= 0.18 * sin(k * PI)
		"parry":
			rot.y += 0.35 * sin(k * PI)
		"dodge":
			rot.x += 0.55 * sin(k * PI)
			pos.y -= 0.25 * sin(k * PI)
	_bm_pos = pos
	_bm_rot = rot
