extends SkeletonModifier3D
## Foot locking (realism-20261111, presentation only). A clip is made in place and the game moves and
## turns the fighter, so a foot that the clip holds on the ground still drifts over the paving
## whenever the two disagree: a turn on the spot, a hit-stop shudder, a knockback shove, a
## locomotion clip a little faster or slower than the body. While a foot is down this modifier
## pins its ankle (and the foot's own heading) where it touched, in the world, and bends the leg
## to it with a two-bone IK. A foot that is low is always pinned: it never travels along the
## ground. When the pin drifts too far from where the clip wants the foot (a blend into another
## stance, a shove), the foot takes a short step to the clip's place, with a small lift, so a
## change of stance reads as steps, not as a slide.
##
## It runs after the pose layer and before the secondary sim (cloth hangs from the final legs).
## Cost: two legs, a handful of vector operations a frame; no physics, no ray casts. Gated by
## device tier in combat_animator.gd (config "foot_ik", default on from 5 GiB of reported RAM).
## The simulation never reads bones: the fight's outcome is unchanged (seeded fights identical).

const LEGS: Array = [["LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase"], ["RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]]
const DOWN_H: float = 0.030        # m at size 1: a foot this close to its standing height is down
const UP_H: float = 0.055          # ... and this far over it has left the ground (hysteresis)
const REACH: float = 0.16          # m at size 1: the pin lets go when the clip's foot is this far from it
const REACH_LOCO: float = 0.34     # the same while walking or running (a stride carries the foot back)
const STEP_TIME: float = 0.12      # s: the step back to the clip's place
const STEP_LIFT: float = 0.06      # m at size 1: how high that step lifts
const BLEND_IN: float = 0.05       # s: a pin that is dropped (not stepped) eases off
const PIN_SPEED: float = 0.45      # m/s at size 1: the settle clock only runs while the clip holds the foot this still
const SETTLE_ERR: float = 0.10     # m at size 1: a standing pin this far from the clip's foot ...
const SETTLE_TIME: float = 0.35    # ... for this long takes a step to it (the stance follows a turn)
const STRETCH: float = 0.995       # the leg never straightens past this share of its length

var frame_root: Node3D             # the fighter's model holder (its scale is the character's size)
var floor_y: float = 0.0           # the paving under the fighter, world
var size: float = 1.0
var pinning: bool = true           # false: every pin eases off (death, dodge, a spin, no clip)
var loco: bool = false             # walking or running: the longer reach
var dt: float = 1.0 / 30.0         # set by the animator each frame (0 in a hit-stop)
var strength: float = 1.0          # tier switch: 0 = off
var _legs: Array = []              # per leg: {up, lo, foot, toe, base_a, base_t, pinned, pin: Transform3D, w, step_t, step_from}
var stats: Dictionary = {"pins": 0, "steps": 0}


## How far the lock holds foot `i` (0 left, 1 right) from where the clip has it, in the world, on
## the last drawn frame (fighter.gd moves the foot's contact shadow with it).
func offset(i: int) -> Vector3:
	if i < 0 or i >= _legs.size():
		return Vector3.ZERO
	return (_legs[i] as Dictionary).get("off", Vector3.ZERO)


## For the motion probe: per leg [pinned, stepping].
func debug_state() -> Array:
	var out: Array = []
	for l: Dictionary in _legs:
		out.append([1 if bool(l["pinned"]) else 0, 1 if float(l["step_t"]) >= 0.0 else 0, snappedf(float(l.get("err", 0.0)), 0.001)])
	return out


func setup(sk: Skeleton3D) -> int:
	_legs.clear()
	if sk == null:
		return 0
	for names: Array in LEGS:
		var ids: Array = []
		for n: String in names:
			ids.append(sk.find_bone(n))
		if ids[0] < 0 or ids[1] < 0 or ids[2] < 0:
			continue
		# standing heights from the rest pose (skeleton space, metres before the holder's scale)
		var a_rest: float = sk.get_bone_global_rest(ids[2]).origin.y
		var t_rest: float = sk.get_bone_global_rest(ids[3]).origin.y if ids[3] >= 0 else a_rest
		_legs.append({"up": ids[0], "lo": ids[1], "foot": ids[2], "toe": ids[3], "a_rest": a_rest, "t_rest": t_rest,
			"pinned": false, "pin": Transform3D.IDENTITY, "w": 0.0, "step_t": -1.0, "step_from": Vector3.ZERO, "cool": 0.0})
	return _legs.size()


## Forget every pin (a teleport, a new model).
func reset() -> void:
	for l: Dictionary in _legs:
		l["pinned"] = false
		l["w"] = 0.0
		l["step_t"] = -1.0


func _process_modification_with_delta(_delta: float) -> void:
	if _legs.is_empty() or strength <= 0.0:
		return
	var sk: Skeleton3D = get_skeleton()
	if sk == null or not sk.is_inside_tree():
		return
	var xf: Transform3D = sk.global_transform
	var inv: Transform3D = xf.affine_inverse()
	var k: float = maxf(0.05, size)
	for l: Dictionary in _legs:
		var foot: int = l["foot"]
		var g: Transform3D = sk.get_bone_global_pose(foot)
		var world: Transform3D = xf * g
		# how far over its standing height the clip holds this foot (ankle, or the toe joint if lower)
		if not l.has("a_h"):
			# the standing heights of the ankle and the toe joint over the fighter's origin, from
			# the rest pose as the holder places it (once)
			var rel: Transform3D = frame_root.transform * (frame_root.global_transform.affine_inverse() * xf) if frame_root != null and frame_root.is_inside_tree() else xf
			l["a_h"] = (rel * sk.get_bone_global_rest(foot).origin).y
			l["t_h"] = (rel * sk.get_bone_global_rest(int(l["toe"])).origin).y if int(l["toe"]) >= 0 else float(l["a_h"])
		var h: float = world.origin.y - floor_y - float(l["a_h"])
		if int(l["toe"]) >= 0:
			var tw: Vector3 = xf * sk.get_bone_global_pose(int(l["toe"])).origin
			h = minf(h, tw.y - floor_y - float(l["t_h"]))
		l["cool"] = maxf(0.0, float(l["cool"]) - dt)
		# how fast the clip moves this foot under the body (skeleton space): a blend or a teleport
		# is not a place to pin
		var sp: float = 0.0
		if l.has("prev") and dt > 0.0:
			sp = ((g.origin - (l["prev"] as Vector3)) * xf.basis.get_scale().y).length() / dt
		if dt > 0.0:
			l["prev"] = g.origin
		var head_now: float = _heading(sk, xf, l)
		var pinned: bool = l["pinned"]
		if not pinning:
			pinned = false
			l["step_t"] = -1.0
		elif pinned and h > UP_H * k:
			# the clip lifts the foot (a real step): ease from the pin to the clip's foot, no extra lift
			pinned = false
			l["step_t"] = 0.0
			l["step_from"] = (l["pin"] as Transform3D).origin
			l["step_head"] = float(l.get("pin_head", head_now))
			l["step_lift"] = 0.0
		elif not pinned and h < DOWN_H * k and float(l["cool"]) <= 0.0 and float(l["step_t"]) < 0.0 \
				and l.has("prev"):
			pinned = true
			l["err_t"] = 0.0
			l["pin"] = world.orthonormalized()
			l["pin_head"] = head_now
			# a foot that touches down flat keeps its whole orientation (the toe stays put too); one
			# caught tilted (toe down in a blend) keeps only its heading and the clip's pitch and roll
			l["pin_full"] = int(l["toe"]) < 0 or absf((xf * sk.get_bone_global_pose(int(l["toe"])).origin).y - floor_y - float(l["t_h"]) - (world.origin.y - floor_y - float(l["a_h"]))) < 0.03 * k
			stats["pins"] = int(stats["pins"]) + 1
		if pinned:
			var err: Vector3 = world.origin - (l["pin"] as Transform3D).origin
			err.y = 0.0
			l["err"] = err.length()
			if not loco and err.length() > SETTLE_ERR * k and sp < PIN_SPEED * k:
				l["err_t"] = float(l.get("err_t", 0.0)) + dt
			else:
				l["err_t"] = 0.0
			if err.length() > (REACH_LOCO if loco else REACH) * k or float(l["err_t"]) > SETTLE_TIME:
				# too far from where the clip wants it: step there
				pinned = false
				l["step_t"] = 0.0
				l["step_from"] = (l["pin"] as Transform3D).origin
				l["step_head"] = float(l.get("pin_head", head_now))
				l["step_lift"] = STEP_LIFT
				stats["steps"] = int(stats["steps"]) + 1
		l["pinned"] = pinned
		var w: float = float(l["w"])
		var target: Transform3D = world
		if pinned:
			w = 1.0       # at once: the pin starts where the foot is, so there is nothing to ease into
			# the pin holds the place and the heading; the foot keeps the clip's own pitch and roll,
			# and rides at the height the clip holds it (the body's own plant moves it)
			target.origin = (l["pin"] as Transform3D).origin
			target.origin.y = world.origin.y
			if bool(l.get("pin_full", false)):
				target.basis = (l["pin"] as Transform3D).basis
			else:
				target.basis = Basis(Vector3.UP, wrapf(float(l["pin_head"]) - head_now, -PI, PI)) * world.basis.orthonormalized()
		elif float(l["step_t"]) >= 0.0:
			var st: float = float(l["step_t"]) + dt
			var u: float = clampf(st / STEP_TIME, 0.0, 1.0)
			var e: float = u * u * (3.0 - 2.0 * u)
			target.origin = (l["step_from"] as Vector3).lerp(world.origin, e)
			target.origin.y = world.origin.y + sin(u * PI) * float(l.get("step_lift", 0.0)) * k
			target.basis = Basis(Vector3.UP, wrapf(float(l["step_head"]) - head_now, -PI, PI) * (1.0 - e)) * world.basis.orthonormalized()
			w = 1.0
			if u > 0.5 and u < 1.0 and target.origin.y - floor_y - float(l["a_h"]) < DOWN_H * k and pinning:
				# the stepping foot has come down: it lands here, whatever the clip's foot still does
				# (a foot never travels along the ground; the next step takes up what is left)
				l["step_t"] = -1.0
				l["pinned"] = true
				l["err_t"] = 0.0
				l["pin"] = Transform3D(target.basis, target.origin)
				l["pin_full"] = false
				l["pin_head"] = wrapf(head_now + wrapf(float(l["step_head"]) - head_now, -PI, PI) * (1.0 - e), -PI, PI)
				stats["pins"] = int(stats["pins"]) + 1
			elif u >= 1.0:
				l["step_t"] = -1.0
				l["cool"] = 0.03
				w = 0.0
			else:
				l["step_t"] = st
		else:
			w = maxf(0.0, w - dt / BLEND_IN) if dt > 0.0 else w
		l["w"] = w
		l["off"] = Vector3.ZERO
		if w <= 0.001:
			continue
		var ww: float = w * clampf(strength, 0.0, 1.0)
		l["off"] = (target.origin - world.origin) * ww    # where the foot really is, for its contact shadow
		var goal: Vector3 = inv * world.origin.lerp(target.origin, ww)
		_solve(sk, int(l["up"]), int(l["lo"]), foot, goal)
		# the foot keeps the heading it was planted with (no pivot on the spot)
		var gf: Transform3D = sk.get_bone_global_pose(foot)
		var want: Basis = (inv.basis * target.basis).orthonormalized()
		var sc: Vector3 = g.basis.get_scale()
		gf.basis = g.basis.orthonormalized().slerp(want, ww).scaled(sc)
		sk.set_bone_global_pose(foot, gf)


## The heading of a foot in the world: ankle to toe joint on the ground plane (0 with no toe bone).
func _heading(sk: Skeleton3D, xf: Transform3D, l: Dictionary) -> float:
	if int(l["toe"]) < 0:
		return 0.0
	var d: Vector3 = xf * sk.get_bone_global_pose(int(l["toe"])).origin - xf * sk.get_bone_global_pose(int(l["foot"])).origin
	return atan2(d.x, d.z)


## Two-bone IK in skeleton space: the ankle to `goal`, the knee kept on the side it bends to.
func _solve(sk: Skeleton3D, up: int, lo: int, foot: int, goal: Vector3) -> void:
	var ga: Transform3D = sk.get_bone_global_pose(up)
	var gb: Transform3D = sk.get_bone_global_pose(lo)
	var gc: Transform3D = sk.get_bone_global_pose(foot)
	var a: Vector3 = ga.origin
	var b: Vector3 = gb.origin
	var c: Vector3 = gc.origin
	var l1: float = (b - a).length()
	var l2: float = (c - b).length()
	if l1 < 1e-5 or l2 < 1e-5:
		return
	var to: Vector3 = goal - a
	var d: float = clampf(to.length(), absf(l1 - l2) + 1e-4, (l1 + l2) * STRETCH)
	if to.length_squared() < 1e-10:
		return
	var dir: Vector3 = to.normalized()
	# the knee's side: what the clip's knee has, taken square to the new hip-to-ankle line
	var bend: Vector3 = (b - a) - dir * (b - a).dot(dir)
	if bend.length_squared() < 1e-8:
		bend = (ga.basis.z - dir * ga.basis.z.dot(dir))
	if bend.length_squared() < 1e-10:
		return
	bend = bend.normalized()
	var along: float = (l1 * l1 - l2 * l2 + d * d) / (2.0 * d)
	var side: float = sqrt(maxf(0.0, l1 * l1 - along * along))
	var knee: Vector3 = a + dir * along + bend * side
	var ankle: Vector3 = a + dir * d
	# turn the thigh onto the new knee
	var r1: Quaternion = _arc(b - a, knee - a)
	ga.basis = Basis(r1) * ga.basis
	sk.set_bone_global_pose(up, ga)
	# the shin follows the thigh; turn it onto the ankle
	gb = sk.get_bone_global_pose(lo)
	var c2: Vector3 = sk.get_bone_global_pose(foot).origin
	var r2: Quaternion = _arc(c2 - gb.origin, ankle - gb.origin)
	gb.basis = Basis(r2) * gb.basis
	sk.set_bone_global_pose(lo, gb)


static func _arc(from: Vector3, to: Vector3) -> Quaternion:
	var f: Vector3 = from.normalized()
	var t: Vector3 = to.normalized()
	var d: float = f.dot(t)
	if d > 0.999999:
		return Quaternion.IDENTITY
	if d < -0.999999:
		var ax: Vector3 = f.cross(Vector3.UP)
		if ax.length_squared() < 1e-6:
			ax = f.cross(Vector3.RIGHT)
		return Quaternion(ax.normalized(), PI)
	return Quaternion(f.cross(t).normalized(), acos(d))
