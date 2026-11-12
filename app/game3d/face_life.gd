extends RefCounted
## realism round 5 (13 Nov): a face that is alive. For a character whose head carries the shape keys the hybrid
## hero build writes (cq_blink, cq_eye_xp, cq_eye_xn, cq_eye_up, cq_eye_dn; deploy/hybrid in the renderer), the
## lids blink and the eyes look: blinks every 2 to 6 s, about 0.15 s, now and then a double blink; small saccades,
## the gaze settling on a target (fight.gd: the camera in the close shots, the opponent in the fight); the lids
## follow the eyes through the shape keys themselves. Characters without the shape keys get nothing (attach()
## returns null). Its own random stream: the fight's seeded RNG is never touched, so seeded fights are unchanged.

const BLINK_GAP: Vector2 = Vector2(2.0, 6.0)
const BLINK_CLOSE_S: float = 0.06
const BLINK_OPEN_S: float = 0.10
const DOUBLE_P: float = 0.15
const SACCADE_GAP: Vector2 = Vector2(0.35, 1.6)
const SACCADE_DEG: float = 2.5
const EYE_MAX_X: float = 18.0          # the shape keys' full turn, degrees (deploy/hybrid/hybrid_assemble.py face_shapes)
const EYE_MAX_Y: float = 12.0

var _meshes: Array = []                # [[MeshInstance3D, {key: blend shape index}]]
var _skel: Skeleton3D
var _head: int = -1
var _rng := RandomNumberGenerator.new()
var _blink_in: float = 1.0
var _blink_t: float = -1.0
var _blink_again: bool = false
var _second: bool = false
var _sacc_in: float = 0.5
var _sacc: Vector2 = Vector2.ZERO
var _gaze: Vector2 = Vector2.ZERO      # degrees: x to the character's left (+x), y up
var target: Vector3 = Vector3.INF      # world point to look at (INF: straight ahead)
var pinned: bool = false               # a review tool holds the target (fight.gd leaves it alone)
var force_blink: float = -1.0          # review tools: the lids held at this weight (-1: off)
var blinks: int = 0                    # counted, for tests


static func attach(model: Node, seed: int) -> RefCounted:
	var meshes: Array = []
	for n: Node in model.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		var idx: Dictionary = {}
		for k: String in ["cq_blink", "cq_eye_xp", "cq_eye_xn", "cq_eye_up", "cq_eye_dn"]:
			var i: int = mi.find_blend_shape_by_name(StringName(k))
			if i >= 0:
				idx[k] = i
		if idx.has("cq_blink"):
			meshes.append([mi, idx])
	if meshes.is_empty():
		return null
	var fl = load("res://face_life.gd").new()
	fl._meshes = meshes
	for n: Node in model.find_children("*", "Skeleton3D", true, false):
		var sk := n as Skeleton3D
		var h: int = sk.find_bone("Head")
		if h < 0:
			h = sk.find_bone("mixamorig:Head")
		if h >= 0:
			fl._skel = sk
			fl._head = h
			break
	fl._rng.seed = seed
	fl._blink_in = fl._rng.randf_range(0.6, 2.5)
	return fl


## The head's rest-pose frame in the world now: directions in it are the shape keys' directions (+z ahead, +x the
## character's left, +y up).
func _head_frame() -> Transform3D:
	if _skel == null:
		return Transform3D.IDENTITY
	var pose: Transform3D = _skel.global_transform * _skel.get_bone_global_pose(_head)
	return pose * _skel.get_bone_global_rest(_head).affine_inverse()


func tick(dt: float, frozen: bool) -> void:
	if dt <= 0.0:
		return
	# blinks
	var w_blink: float = 0.0
	if _blink_t >= 0.0:
		_blink_t += dt
		var t: float = _blink_t
		w_blink = smoothstep(0.0, BLINK_CLOSE_S, t) if t < BLINK_CLOSE_S else 1.0 - smoothstep(BLINK_CLOSE_S, BLINK_CLOSE_S + BLINK_OPEN_S, t)
		if t >= BLINK_CLOSE_S + BLINK_OPEN_S:
			_blink_t = -1.0
			if _blink_again:
				_blink_again = false
				_blink_in = 0.08
			else:
				_second = false
				_blink_in = _rng.randf_range(BLINK_GAP.x, BLINK_GAP.y)
	elif not frozen:
		_blink_in -= dt
		if _blink_in <= 0.0:
			_blink_t = 0.0
			blinks += 1
			_blink_again = not _second and _rng.randf() < DOUBLE_P
			_second = _blink_again
	# gaze: the target's direction in the head's frame, plus a small saccade that jumps now and then
	var want: Vector2 = Vector2.ZERO
	if target != Vector3.INF and _skel != null:
		var fr: Transform3D = _head_frame()
		var d: Vector3 = (fr.basis.inverse() * (target - fr.origin)).normalized()
		if d.z > 0.2:
			want = Vector2(rad_to_deg(atan2(d.x, d.z)), rad_to_deg(atan2(d.y, Vector2(d.x, d.z).length())))
	_sacc_in -= dt
	if _sacc_in <= 0.0:
		_sacc_in = _rng.randf_range(SACCADE_GAP.x, SACCADE_GAP.y)
		_sacc = Vector2(_rng.randf_range(-1.0, 1.0), _rng.randf_range(-0.6, 0.6)) * SACCADE_DEG
	if force_blink >= 0.0:
		w_blink = force_blink
	want += _sacc
	want.x = clampf(want.x, -EYE_MAX_X, EYE_MAX_X)
	want.y = clampf(want.y, -EYE_MAX_Y, EYE_MAX_Y)
	# eyes jump (a saccade takes 30 to 50 ms), they do not drift
	_gaze = _gaze.lerp(want, 1.0 - exp(-dt * 28.0))
	var wx: float = _gaze.x / EYE_MAX_X
	var wy: float = _gaze.y / EYE_MAX_Y
	for m: Array in _meshes:
		var mi: MeshInstance3D = m[0]
		var idx: Dictionary = m[1]
		mi.set_blend_shape_value(idx["cq_blink"], w_blink)
		if idx.has("cq_eye_xp"):
			mi.set_blend_shape_value(idx["cq_eye_xp"], maxf(wx, 0.0))
			mi.set_blend_shape_value(idx["cq_eye_xn"], maxf(-wx, 0.0))
		if idx.has("cq_eye_up"):
			mi.set_blend_shape_value(idx["cq_eye_up"], maxf(wy, 0.0))
			mi.set_blend_shape_value(idx["cq_eye_dn"], maxf(-wy, 0.0))
