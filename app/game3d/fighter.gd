extends Node3D
## One fighter (cq 061, reworked in cq 233): a runtime GLB (or a capsule mannequin), its
## CombatAnimator (clips when the GLB has them, procedural poses when not), a hurtbox, a
## weapon arc hitbox on a pivot, the hit flash (with a team rim while it shows), knockback, the SHIELD barrier
## and the RALLY buff. The model faces +Z (glTF convention); yaw turns +Z to the facing.

const HitArea := preload("res://hit_area.gd")
const Animator := preload("res://combat_animator.gd")
const FLASH_SHADER := preload("res://vfx/flash.gdshader")
const DOME_SHADER := preload("res://vfx/dome.gdshader")

const HEIGHT: float = 2.3             # a touch over life size: reads at phone size, as on the reference

var display_name: String = ""
var team: int = 0                # 0 = hero side, 1 = enemy
var role: String = "hero"        # hero | ally | boss
var max_hp: int = 1000
var hp: int = 1000
var radius: float = 0.45
var size_k: float = 1.0          # the boss stands taller
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
var _overlay_meshes: Array[MeshInstance3D] = []
var _overlay_on: bool = false
var _dome: MeshInstance3D
var _dome_mat: ShaderMaterial
var _dome_hit: float = 0.0
var _aura: MeshInstance3D

# procedural body motion (stands in for clip root motion)
var _motion: String = ""
var _mt: float = 0.0
var _mlen: float = 0.0
var _pop_t: float = -1.0
var _death_t: float = -1.0
var _cele_t: float = 0.0
var _spin_dir: float = 1.0


func setup(n: String, t: int, hp_max: int, c: Color, r: String = "hero") -> void:
	display_name = n
	team = t
	role = r
	max_hp = hp_max
	hp = hp_max
	colour = c
	size_k = 1.55 if role == "boss" else 1.0
	radius = 0.8 if role == "boss" else 0.5
	body = Node3D.new()
	body.name = "Body"
	add_child(body)
	_overlay = ShaderMaterial.new()
	_overlay.shader = FLASH_SHADER
	var rim: Color = Color(1.0, 0.35, 0.3) if team == 1 else (Color(0.55, 1.0, 0.6) if role == "hero" else Color(0.5, 0.85, 1.0))
	_overlay.set_shader_parameter("rim_color", rim)
	_overlay.set_shader_parameter("rim_amount", 0.55 if role == "boss" else 0.4)
	_build_boxes()
	_build_shadow()
	set_capsule()


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
	m.albedo_color = Color(0.08, 0.04, 0.12, 0.75)
	m.disable_receive_shadows = true
	sh.material_override = m
	sh.position.y = 0.045
	sh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sh)


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
	anim.play("idle")
	_apply_overlay(holder)
	var names: PackedStringArray = anim.player.get_animation_list() if anim.player != null else PackedStringArray()
	return {"scale": s, "height_raw": aabb.size.y, "anims": names, "mapped": bind_info.get("clips", {}),
		"bones": bind_info.get("bones", 0), "hand": bind_info.get("hand", ""), "library": anim.lib_key}


## The overlay is a second pass over every (skinned) vertex of the model: on a software GPU
## that is ~1 ms a fighter a frame. It is only attached while a flash is showing (the first
## frames after load too, so its shader is compiled before the fight starts).
func _apply_overlay(root: Node) -> void:
	_overlay_meshes.clear()
	for n: Node in root.find_children("*", "MeshInstance3D", true, false):
		_overlay_meshes.append(n)
	if root is MeshInstance3D:
		_overlay_meshes.append(root)
	_overlay_on = false
	_flash = maxf(_flash, 0.02)   # on for the first frame: compiles the shader during loading
	_set_overlay(true)


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
	var clip: bool = anim.play(state, length, hit_at)
	_motion = state
	_mt = 0.0
	_mlen = length
	_spin_dir = 1.0
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


func hurt_pop() -> void:
	_pop_t = 0.0


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
	anim.frozen = anim_freeze
	anim.update(dt, speed_now, dead or celebrating)
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
	body.position = pos
	body.rotation = rot
	body.scale = Vector3.ONE * sc
	# hit flash
	if _flash > 0.0:
		_flash = maxf(0.0, _flash - dt * 7.0)
	_overlay.set_shader_parameter("flash", _flash)
	_set_overlay(_flash > 0.0)
	if _dome != null:
		var on: bool = shield_t > 0.0 and not dead
		_dome.visible = on
		if on:
			_dome_hit = maxf(0.0, _dome_hit - dt * 4.0)
			var fade: float = clampf(shield_t / 0.4, 0.0, 1.0)
			_dome_mat.set_shader_parameter("alpha", fade)
			_dome_mat.set_shader_parameter("hit", _dome_hit)
	if _aura != null:
		_aura.visible = buff_t > 0.0 and not dead
		if _aura.visible:
			_aura.rotation.y += dt * 1.6
			(_aura.material_override as StandardMaterial3D).albedo_color.a = 0.85 * clampf(buff_t / 0.5, 0.0, 1.0)


var _bm_pos: Vector3
var _bm_rot: Vector3


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
