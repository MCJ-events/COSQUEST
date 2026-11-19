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
##
## A second instance with `guard` on sits after the foot lock (before the cloth): the pose guard. The foot lock's
## two-bone solve can flip a knee in one frame when a pin is taken or let go, and a clip switch can still jerk the
## hips; the guard makes each leg bone and the hips follow the FINAL pose with a critically damped spring fed the
## pose's own motion (fight-motion-31; build 29 limited the acceleration to GUARD_ACC, see _guard). Smooth motion
## passes through exactly; the spine, arms and head (the strikes) are never touched. A hit-stop (dt 0) holds it.

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

## the pose guard (see above): rad/s^2 (about 28,600 degrees/s^2; a knee flip in one frame is 150,000 and more). 700
## (40,100) left the median transition peak at 0.65x build 28; 500 brings every statistic under 0.5x
var guard: bool = false
const GUARD_ACC: float = 500.0       # build 29's limit, kept as the bar a one-frame flip is measured against (tests)
const GUARD_BONES: Array[String] = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"]
var _gw: Array[Vector3] = []        # the guard's own angular velocity per bone (rad/s, parent frame)
var guarded: int = 0                # frames the guard changed something (tests, the probe)


func bind_bones(skel: Skeleton3D) -> int:
	_ids = PackedInt32Array()
	for n: String in (GUARD_BONES if guard else BONES):
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
	_gw.resize(_ids.size())
	_gw.fill(Vector3.ZERO)
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
	if guard:
		_guard(skel)
		cost_usec = Time.get_ticks_usec() - t0
		return
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


## The pose guard (guard = true). fight-motion-31: a velocity-continuous follower in place of build 29's limiter.
## Build 29 limited each bone's angular acceleration to GUARD_ACC with a braking rule; on a moving target (the foot
## lock's IK on a body that moves) the limit and the brake took turns frame by frame (bang-bang), and that chatter was
## half of all the joint-acceleration spikes the probe found (fight-motion-31 REPORT.md). Now each bone follows the pose
## the clip and the IK ask for with a critically damped spring (GUARD_W) that is fed the target's own motion: a motion
## that changes speed smoothly passes exactly, a kink in it is rounded off over a few frames and a jump (a knee flip, a
## pin taken) is absorbed with no overshoot. 15/s was picked on the probe: 30 left most of the spikes, 10 let the
## planted feet slide (fight-motion-31 REPORT.md).
const GUARD_W: float = 15.0          # 1/s: the follower's stiffness (critically damped: a kink is rounded off in ~0.15 s)
const GUARD_W_MAX: float = 25.0      # rad/s: the most target speed taken as real motion (more is a jump to absorb)
const GUARD_FF_ACC: float = 250.0    # rad/s^2: how fast the target's speed taken as motion may change
var foot_lock: Node = null          # fight-motion-31: the fighter's foot lock (repin after the smoothing)
var _gt: Array[Quaternion] = []      # the target last frame
var _gtw: Array[Vector3] = []        # its velocity last frame (clamped)


func _guard(skel: Skeleton3D) -> void:
	if dt <= 0.0:
		# a hit-stop: the clip is held, so is what the guard last showed (no jump to the raw pose in the freeze)
		if _have >= 1:
			for i in _ids.size():
				skel.set_bone_pose_rotation(_ids[i], _q1[i])
		return
	if _gt.size() != _ids.size():
		_gt.resize(_ids.size())
		_gtw.resize(_ids.size())
		_gtw.fill(Vector3.ZERO)
	var changed: bool = false
	var subs: int = maxi(1, ceili(GUARD_W * dt / 0.5))
	var h: float = dt / float(subs)
	for i in _ids.size():
		var b: int = _ids[i]
		var q: Quaternion = skel.get_bone_pose_rotation(b)
		if _have < 1:
			_q1[i] = q
			_gt[i] = q
			_gw[i] = Vector3.ZERO
			_gtw[i] = Vector3.ZERO
			continue
		# the target's own velocity this frame, clamped (a faster one is a jump, not motion)
		var wt: Vector3 = _rotvec(q * _gt[i].inverse()) / dt
		if _have < 2:
			_gw[i] = wt.limit_length(GUARD_W_MAX)     # the first measured frame: no impulse
			_gtw[i] = _gw[i]
		# the target's speed is taken as motion only as fast as it could really change (GUARD_FF_ACC); the rest of
		# a sudden change (a flip, a pin taken) is left to the spring as an offset to absorb
		var dwt: Vector3 = wt - _gtw[i]
		if dwt.length() > GUARD_FF_ACC * dt:
			wt = _gtw[i] + dwt * (GUARD_FF_ACC * dt / dwt.length())
		wt = wt.limit_length(GUARD_W_MAX)
		_gt[i] = q
		_gtw[i] = wt
		var w: Vector3 = _gw[i]
		var cur: Quaternion = _q1[i]
		# the offset from the target, measured against where the target was at the frame's start (a bone moving with
		# its target has none), integrated on the critically damped spring in sub-steps; the bone's own velocity carries
		# over (a kink in the target's speed is rounded off, never passed on in one frame)
		var x: Vector3 = _rotvec(cur * q.inverse()) + wt * dt
		var v: Vector3 = w - wt
		for si in subs:
			v += (-GUARD_W * GUARD_W * x - 2.0 * GUARD_W * v) * h
			x += v * h
		w = wt + v
		var wl: float = w.length()
		var out: Quaternion = (Quaternion(w / wl, wl * dt) * cur).normalized() if wl > 0.000001 else cur
		if out.angle_to(q) < 0.0005:
			out = q
			w = wt
		else:
			changed = true
		skel.set_bone_pose_rotation(b, out)
		_q1[i] = out
		_gw[i] = w
	_have = mini(_have + 1, 2)
	if changed:
		guarded += 1
	if foot_lock != null and is_instance_valid(foot_lock):
		foot_lock.repin(skel)   # fight-motion-31: the planted feet back on their pins from the smoothed legs


static func _rotvec(d: Quaternion) -> Vector3:
	d = d.normalized()
	if d.w < 0.0:
		d = -d
	var ang: float = d.get_angle()
	return d.get_axis() * ang if ang > 0.000001 else Vector3.ZERO
