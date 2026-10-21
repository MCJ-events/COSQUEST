extends Node3D
## One fighter: a runtime GLB (or a capsule mannequin), its clip map, HP and the
## faked attack motion (no attack clip exists, so the body lunges / spins / leans).
## The model faces +Z (glTF convention); the fighter's yaw turns +Z to the facing.

const HEIGHT: float = 1.8

var display_name: String = ""
var team: int = 0                # 0 = hero side, 1 = enemy
var max_hp: int = 1000
var hp: int = 1000
var radius: float = 0.45
var colour: Color = Color.WHITE
var body: Node3D
var model: Node3D
var anim: AnimationPlayer
var clips: Dictionary = {}       # "idle" / "walk" / "celebrate" -> clip name in the player
var cur_clip: String = ""
var model_info: String = "capsule"
var yaw: float = 0.0
var speed_now: float = 0.0
var dead: bool = false
var celebrating: bool = false
var anim_freeze: bool = false
var walk_rate: float = 1.0

var _lunge_t: float = -1.0
var _lunge_len: float = 0.22
var _lunge_dist: float = 0.4
var _spin_t: float = -1.0
var _spin_len: float = 0.4
var _lean_t: float = -1.0
var _lean_len: float = 0.6
var _pop_t: float = -1.0
var _death_t: float = -1.0
var _cele_t: float = 0.0


func setup(n: String, t: int, hp_max: int, c: Color) -> void:
	display_name = n
	team = t
	max_hp = hp_max
	hp = hp_max
	colour = c
	body = Node3D.new()
	body.name = "Body"
	add_child(body)
	set_capsule()


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
	return global_position + Vector3(0.0, HEIGHT + 0.35, 0.0)


func chest_pos() -> Vector3:
	return global_position + Vector3(0.0, HEIGHT * 0.6, 0.0)


# ---------------------------------------------------------------- models

func _clear_model() -> void:
	if model != null:
		model.queue_free()
	model = null
	anim = null
	clips = {}
	cur_clip = ""


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
	model = root
	body.add_child(root)
	model_info = "capsule"


## Takes ownership of a generated GLTF scene. Normalises it to HEIGHT from its AABB,
## puts its feet on y=0 and centres it, then maps the idle/walk/celebrate clips.
func set_model(node: Node3D) -> Dictionary:
	_clear_model()
	var holder := Node3D.new()
	holder.name = "Model"
	holder.add_child(node)
	var aabb: AABB = _model_aabb(holder)
	var s: float = 1.0
	if aabb.size.y > 0.01:
		s = HEIGHT / aabb.size.y
	holder.scale = Vector3.ONE * s
	var c: Vector3 = aabb.get_center()
	holder.position = Vector3(-c.x * s, -aabb.position.y * s, -c.z * s)
	body.add_child(holder)
	model = holder
	var players: Array[Node] = holder.find_children("*", "AnimationPlayer", true, false)
	var names: PackedStringArray = PackedStringArray()
	if players.size() > 0:
		anim = players[0] as AnimationPlayer
		names = anim.get_animation_list()
		for key: String in ["idle", "walk", "celebrate"]:
			for n: String in names:
				if n.to_lower().contains(key):
					clips[key] = n
					break
		for key: String in ["idle", "walk"]:
			if clips.has(key):
				var a: Animation = anim.get_animation(clips[key])
				if a != null:
					a.loop_mode = Animation.LOOP_LINEAR
		if clips.has("celebrate"):
			var ca: Animation = anim.get_animation(clips["celebrate"])
			if ca != null:
				ca.loop_mode = Animation.LOOP_NONE
	model_info = "glb"
	play("idle")
	return {"scale": s, "height_raw": aabb.size.y, "anims": names, "mapped": clips}


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


# ---------------------------------------------------------------- animation

func play(key: String, blend: float = 0.15) -> void:
	if anim == null or not clips.has(key):
		cur_clip = key
		return
	if cur_clip == key and anim.is_playing():
		return
	cur_clip = key
	anim.play(clips[key], blend)


func lunge(dist: float = 0.4, length: float = 0.22) -> void:
	_lunge_t = 0.0
	_lunge_dist = dist
	_lunge_len = length


func spin(length: float = 0.4) -> void:
	_spin_t = 0.0
	_spin_len = length


func lean_back(length: float) -> void:
	_lean_t = 0.0
	_lean_len = length


func hurt_pop() -> void:
	_pop_t = 0.0


func die() -> void:
	if dead:
		return
	dead = true
	hp = 0
	_death_t = 0.0
	if anim != null:
		anim.pause()


func celebrate() -> void:
	celebrating = true
	_cele_t = 0.0
	if clips.has("celebrate"):
		play("celebrate", 0.1)
	else:
		play("idle")


## Visual tick: clip choice and the procedural lunge / spin / lean / hurt pop.
func tick_visual(dt: float) -> void:
	if anim != null:
		anim.speed_scale = 0.0 if anim_freeze else (walk_rate if cur_clip == "walk" else 1.0)
	if not dead and not celebrating:
		if speed_now > 0.2:
			walk_rate = clampf(speed_now / 2.6, 0.8, 1.9)
			play("walk")
		else:
			play("idle")
	var pos := Vector3.ZERO
	var rot := Vector3.ZERO
	var sc: float = 1.0
	if _lunge_t >= 0.0:
		_lunge_t += dt
		var k: float = _lunge_t / _lunge_len
		if k >= 1.0:
			_lunge_t = -1.0
		else:
			# fast out (first 30%), eased back
			var f: float = k / 0.3 if k < 0.3 else 1.0 - ease((k - 0.3) / 0.7, 0.6)
			pos.z += _lunge_dist * f
			rot.x += 0.28 * f
	if _spin_t >= 0.0:
		_spin_t += dt
		var ks: float = _spin_t / _spin_len
		if ks >= 1.0:
			_spin_t = -1.0
		else:
			rot.y += TAU * ease(ks, 0.7)
	if _lean_t >= 0.0:
		_lean_t += dt
		var kl: float = _lean_t / _lean_len
		if kl >= 1.0:
			_lean_t = -1.0
		else:
			rot.x -= 0.3 * sin(kl * PI * 0.5)
			pos.z -= 0.15 * kl
	if _pop_t >= 0.0:
		_pop_t += dt
		if _pop_t > 0.15:
			_pop_t = -1.0
		else:
			sc = 1.0 + 0.08 * (1.0 - _pop_t / 0.15)
	if dead and _death_t >= 0.0:
		_death_t += dt
		var kd: float = clampf(_death_t / 0.6, 0.0, 1.0)
		rot.x = -PI * 0.5 * ease(kd, 0.5)
		pos.y = -0.25 * kd
	if celebrating and not clips.has("celebrate"):
		_cele_t += dt
		pos.y += absf(sin(_cele_t * 7.0)) * 0.35
	body.position = pos
	body.rotation = rot
	body.scale = Vector3.ONE * sc
