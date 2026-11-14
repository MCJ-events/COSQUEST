extends Node
## build 29 (fid29-street): the fighters' soft contact shade on the real ground (mid and high, look fid_street_cap).
## Once a frame, after the fighters have animated, it READS each fighter's Skeleton3D pose (never writes it) and packs
## 6 capsules per fighter (both thighs, both shins, both feet) for up to 4 fighters into the uniform arrays of the
## real ground materials (vfx/world_ground_real.gdshader caps_occ: cosine-weighted occlusion of the ambient light,
## only within 2.5 m of a fighter). Presentation only: the fight's rules never see it, and the records do not change.
## Added by place.gd on the mid and high tiers; nothing on low.

const MAX_FIGHTERS: int = 4
const BONES: Array = [["LeftUpLeg", "LeftLeg", 0.26], ["RightUpLeg", "RightLeg", 0.26], ["LeftLeg", "LeftFoot", 0.2],
	["RightLeg", "RightFoot", 0.2], ["LeftFoot", "LeftToeBase", 0.42], ["RightFoot", "RightToeBase", 0.42]]   # [a, b, radius / length]

var mats: Array[ShaderMaterial] = []
var _fight: Node = null
var _rigs: Dictionary = {}          # fighter instance id -> [Skeleton3D, PackedInt32Array of 12 bone ids, hips id]
var _a := PackedVector4Array()
var _b := PackedVector4Array()
var _f := PackedVector4Array()
var frames: int = 0
var total_us: int = 0
var max_us: int = 0


func _ready() -> void:
	process_priority = 1000          # after the fighters and their animators this frame
	_a.resize(MAX_FIGHTERS * 6)
	_b.resize(MAX_FIGHTERS * 6)
	_f.resize(MAX_FIGHTERS)


func register(m: ShaderMaterial) -> void:
	if m != null and not mats.has(m):
		mats.append(m)


## Mean and worst cost per frame (ms), for the budget table.
func stats() -> Dictionary:
	return {"frames": frames, "mean_ms": snappedf(total_us / 1000.0 / maxf(1.0, frames), 0.001), "max_ms": snappedf(max_us / 1000.0, 0.001)}


func _find_fight() -> Node:
	var n: Node = get_parent()
	while n != null:
		if n.get("fighters") is Array:
			return n
		n = n.get_parent()
	return null


func _rig(f: Node) -> Array:
	var id: int = f.get_instance_id()
	if _rigs.has(id):
		return _rigs[id]
	var out: Array = []
	var model: Variant = f.get("model")
	if model is Node3D:
		for n: Node in (model as Node3D).find_children("*", "Skeleton3D", true, false):
			var sk := n as Skeleton3D
			var ids := PackedInt32Array()
			for b: Array in BONES:
				ids.append(sk.find_bone(str(b[0])))
				ids.append(sk.find_bone(str(b[1])))
			if not ids.has(-1):
				out = [sk, ids, sk.find_bone("Hips")]
				break
	_rigs[id] = out
	return out


func _process(_dt: float) -> void:
	if mats.is_empty():
		return
	var t0: int = Time.get_ticks_usec()
	if _fight == null or not is_instance_valid(_fight):
		_fight = _find_fight()
	var n: int = 0
	if _fight != null:
		for f: Variant in _fight.get("fighters"):
			if n >= MAX_FIGHTERS or not (f is Node3D) or not is_instance_valid(f) or not (f as Node3D).is_visible_in_tree():
				continue
			var r: Array = _rig(f as Node)
			if r.is_empty():
				continue
			var sk: Skeleton3D = r[0]
			var ids: PackedInt32Array = r[1]
			var xf: Transform3D = sk.global_transform
			for c in 6:
				var pa: Vector3 = xf * sk.get_bone_global_pose(ids[c * 2]).origin
				var pb: Vector3 = xf * sk.get_bone_global_pose(ids[c * 2 + 1]).origin
				if c >= 4:
					pb = pa + (pb - pa) * 1.4        # the toe bone sits mid-foot: reach the tip
				var rad: float = clampf(pa.distance_to(pb) * float(BONES[c][2]), 0.03, 0.2)
				_a[n * 6 + c] = Vector4(pa.x, pa.y, pa.z, rad)
				_b[n * 6 + c] = Vector4(pb.x, pb.y, pb.z, 0.0)
			var hp: Vector3 = xf * sk.get_bone_global_pose(int(r[2])).origin if int(r[2]) >= 0 else (f as Node3D).global_position
			_f[n] = Vector4(hp.x, 0.0, hp.z, 1.0)
			n += 1
	for i in range(n, MAX_FIGHTERS):
		_f[i] = Vector4.ZERO
	for m: ShaderMaterial in mats:
		m.set_shader_parameter("cap_a", _a)
		m.set_shader_parameter("cap_b", _b)
		m.set_shader_parameter("cap_f", _f)
	var dt: int = Time.get_ticks_usec() - t0
	frames += 1
	total_us += dt
	max_us = maxi(max_us, dt)
