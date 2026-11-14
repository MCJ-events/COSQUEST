extends SkeletonModifier3D
## fid29 combat (build 29, mid and high tiers): dead blending (D. Holden, "Dead Blending", 2023) in place of
## the AnimationPlayer's crossfade. CombatAnimator switches clips with no fade (one clip evaluated, never
## two) and calls start(); for the next 0.15 to 0.25 s this modifier carries every bone on from the pose
## the body was in, extrapolating its angular velocity (measured on the last two frames this modifier
## wrote) with a decay of HALF_LIFE, and eases from that extrapolated pose into the new clip with a
## smoothstep. The body keeps its momentum through a transition instead of snapping or lerping through
## the middle. Presentation only: hurtboxes and weapon arcs are fixed game nodes (fighter.gd), never bones.
##
## Sits first among the skeleton's modifiers (before the pose layer, foot lock and cloth), so everything
## else is applied on the blended pose. Low phones never get it (combat_animator.gd installs it on the
## real-look tiers only).

const HALF_LIFE: float = 0.1
const LN2: float = 0.6931472
## the humanoid's 25 joints (the faction heroes, the cast and the Forge auto-rigs share the names)
const BONES: Array[String] = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm",
	"LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg",
	"LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]

var dt: float = 1.0 / 30.0          # set by the animator each frame (0 in a hit-stop: the blend waits)
var _ids: PackedInt32Array = PackedInt32Array()
var _hips: int = -1
var _q1: Array[Quaternion] = []     # the last pose this modifier wrote (bone local rotations)
var _q0: Array[Quaternion] = []     # the one before
var _p1: Vector3 = Vector3.ZERO     # the hips' local position, last frame and the one before
var _p0: Vector3 = Vector3.ZERO
var _dt1: float = 1.0 / 30.0        # the game time between those two frames
var _have: int = 0                  # frames of history (0, 1, 2)
var _src_q: Array[Quaternion] = []
var _src_w: Array[Vector3] = []     # angular velocity (axis * rad/s) in the parent's frame
var _src_p: Vector3 = Vector3.ZERO
var _src_v: Vector3 = Vector3.ZERO
var _t: float = -1.0                # seconds into the current blend (-1 = none)
var _dur: float = 0.2
var blends: int = 0                 # transitions blended (tests, the probe)
var cost_usec: int = 0              # the last frame's cost


func bind_bones(skel: Skeleton3D) -> int:
	_ids = PackedInt32Array()
	for n: String in BONES:
		var b: int = skel.find_bone(n)
		if b < 0:
			b = skel.find_bone("mixamorig:" + n)
		if b >= 0:
			_ids.append(b)
	_hips = skel.find_bone("Hips")
	_q1.resize(_ids.size())
	_q0.resize(_ids.size())
	_src_q.resize(_ids.size())
	_src_w.resize(_ids.size())
	_have = 0
	_t = -1.0
	return _ids.size()


## A clip switch happened this frame (the player now plays the new clip with no fade): blend from the
## body's own motion into it over `dur` seconds of game time.
func start(dur: float) -> void:
	if _ids.is_empty() or _have < 1:
		return
	_dur = maxf(dur, 0.01)
	for i in _ids.size():
		_src_q[i] = _q1[i]
		var w := Vector3.ZERO
		if _have >= 2 and _dt1 > 0.0001:
			var d: Quaternion = (_q1[i] * _q0[i].inverse()).normalized()
			if d.w < 0.0:
				d = -d
			var ang: float = d.get_angle()
			if ang > 0.0001:
				w = d.get_axis() * (ang / _dt1)
		_src_w[i] = w
	_src_p = _p1
	_src_v = (_p1 - _p0) / _dt1 if _have >= 2 and _dt1 > 0.0001 else Vector3.ZERO
	_t = 0.0
	blends += 1


func blending() -> bool:
	return _t >= 0.0


func _process_modification_with_delta(_delta: float) -> void:
	var skel: Skeleton3D = get_skeleton()
	if skel == null or _ids.is_empty():
		return
	var t0: int = Time.get_ticks_usec()
	if _t >= 0.0:
		_t += dt
		var u: float = clampf(_t / _dur, 0.0, 1.0)
		if u >= 1.0:
			_t = -1.0
		else:
			var a: float = u * u * (3.0 - 2.0 * u)
			# how far the extrapolated motion has carried on: the integral of a velocity that halves every HALF_LIFE
			var k: float = HALF_LIFE / LN2 * (1.0 - exp(-LN2 * _t / HALF_LIFE))
			for i in _ids.size():
				var b: int = _ids[i]
				var w: Vector3 = _src_w[i]
				var ext: Quaternion = _src_q[i]
				var wl: float = w.length()
				if wl > 0.0001:
					ext = (Quaternion(w / wl, wl * k) * _src_q[i]).normalized()
				skel.set_bone_pose_rotation(b, ext.slerp(skel.get_bone_pose_rotation(b), a))
			if _hips >= 0:
				var pe: Vector3 = _src_p + _src_v * k
				skel.set_bone_pose_position(_hips, pe.lerp(skel.get_bone_pose_position(_hips), a))
	# history: what this frame shows (a hit-stop adds nothing; the velocity across it is the body's)
	if dt > 0.0:
		for i in _ids.size():
			_q0[i] = _q1[i]
			_q1[i] = skel.get_bone_pose_rotation(_ids[i])
		_p0 = _p1
		_p1 = skel.get_bone_pose_position(_hips) if _hips >= 0 else Vector3.ZERO
		if _have < 1:
			_q0 = _q1.duplicate()
			_p0 = _p1
		_dt1 = dt
		_have = mini(_have + 1, 2)
	cost_usec = Time.get_ticks_usec() - t0
