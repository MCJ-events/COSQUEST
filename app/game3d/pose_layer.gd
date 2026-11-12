extends SkeletonModifier3D
## Procedural combat poses on top of whatever the AnimationPlayer played (cq 233).
## CombatAnimator writes `pose` (channel -> degrees) every frame when the loaded GLB has
## no clip for the current state; this modifier then turns the spine and arms after the
## animation has been applied. Channels are in the character's own frame (it faces +Z):
##   spine_yaw (turn to its left +), spine_lean (forward +), spine_tilt (to its left +)
##   r_fwd / l_fwd (raise the arm forward +), r_side / l_side (raise it out to the side +)
##   r_bend / l_bend (bend the elbow +)
## Bones are found by name (Mixamo-style names, with or without the "mixamorig:" prefix,
## plus a few common alternatives). A missing bone just skips its channels.

var pose: Dictionary = {}
## build 21: 0..1, the share of each upper arm's spread beyond DROOP_FREE deg from hanging that is
## taken back (CombatAnimator sets it, eased, for a character whose retargeted arms stand out).
var arm_droop: float = 0.0
const DROOP_FREE: float = 30.0
## realism (12 Nov 2026): the angle from hanging an arm keeps untouched, per character (a hero's
## arms hang 14 degrees out; the Guardian's long arms keep the old 30)
var droop_free: float = DROOP_FREE
var frame_root: Node3D          # the character's own frame (the model holder)
var _bones: Dictionary = {}     # role -> bone index

const ROLES: Dictionary = {
	"spine": ["Spine1", "Spine", "spine_01", "spine.001", "Chest", "chest"],
	"spine2": ["Spine2", "spine_02", "spine.002", "UpperChest"],
	"r_arm": ["RightArm", "upperarm_r", "upper_arm.R", "UpperArm_R", "RightUpperArm"],
	"r_fore": ["RightForeArm", "lowerarm_r", "forearm.R", "LowerArm_R", "RightLowerArm"],
	"l_arm": ["LeftArm", "upperarm_l", "upper_arm.L", "UpperArm_L", "LeftUpperArm"],
	"l_fore": ["LeftForeArm", "lowerarm_l", "forearm.L", "LowerArm_L", "LeftLowerArm"],
}


static func find_bone(skel: Skeleton3D, names: Array) -> int:
	for n: String in names:
		var i: int = skel.find_bone(n)
		if i >= 0:
			return i
		i = skel.find_bone("mixamorig:" + n)
		if i >= 0:
			return i
	# case-insensitive, prefix-free fallback
	for b in skel.get_bone_count():
		var bn: String = skel.get_bone_name(b).to_lower()
		if bn.contains(":"):
			bn = bn.get_slice(":", 1)
		for n: String in names:
			if bn == n.to_lower():
				return b
	return -1


func bind_bones() -> int:
	var skel: Skeleton3D = get_skeleton()
	_bones.clear()
	if skel == null:
		return 0
	for role: String in ROLES:
		var i: int = find_bone(skel, ROLES[role])
		if i >= 0:
			_bones[role] = i
	return _bones.size()


func _process_modification_with_delta(_delta: float) -> void:
	if (pose.is_empty() and arm_droop <= 0.001) or _bones.is_empty():
		return
	var skel: Skeleton3D = get_skeleton()
	if skel == null or frame_root == null or not frame_root.is_inside_tree():
		return
	# s maps skeleton space to the character frame; a frame rotation R is s^-1 R s in skeleton space
	var s: Basis = (frame_root.global_basis.orthonormalized().inverse() * skel.global_basis.orthonormalized())
	if arm_droop > 0.001:
		_droop(skel, "r_arm", "r_fore", s)
		_droop(skel, "l_arm", "l_fore", s)
	if pose.is_empty():
		return
	var spine := Basis.from_euler(Vector3(deg_to_rad(_c("spine_lean")), deg_to_rad(_c("spine_yaw")), deg_to_rad(_c("spine_tilt"))), EULER_ORDER_YXZ)
	_turn(skel, "spine", spine.slerp(Basis.IDENTITY, 0.45), s)
	_turn(skel, "spine2", spine.slerp(Basis.IDENTITY, 0.55), s)
	# arms: forward raise turns about the frame's X axis, side raise about Z (mirrored left/right)
	_turn(skel, "r_arm", Basis(Vector3.RIGHT, deg_to_rad(-_c("r_fwd"))) * Basis(Vector3.BACK, deg_to_rad(-_c("r_side"))), s)
	_turn(skel, "l_arm", Basis(Vector3.RIGHT, deg_to_rad(-_c("l_fwd"))) * Basis(Vector3.BACK, deg_to_rad(_c("l_side"))), s)
	_turn(skel, "r_fore", Basis(Vector3.RIGHT, deg_to_rad(-_c("r_bend"))), s)
	_turn(skel, "l_fore", Basis(Vector3.RIGHT, deg_to_rad(-_c("l_bend"))), s)


## build 21: turns the upper arm (about its shoulder) towards hanging straight down, so its angle
## from down beyond DROOP_FREE shrinks by arm_droop. The forearm and hand follow.
func _droop(skel: Skeleton3D, arm: String, fore: String, s: Basis) -> void:
	if not (_bones.has(arm) and _bones.has(fore)):
		return
	var b: int = _bones[arm]
	var g: Transform3D = skel.get_bone_global_pose(b)
	var dir: Vector3 = skel.get_bone_global_pose(_bones[fore]).origin - g.origin
	if dir.length_squared() < 1e-10:
		return
	dir = dir.normalized()
	var down: Vector3 = (s.inverse() * Vector3.DOWN).normalized()
	var ang: float = dir.angle_to(down)
	var free: float = deg_to_rad(droop_free)
	if ang <= free:
		return
	var axis: Vector3 = dir.cross(down)
	if axis.length_squared() < 1e-10:
		return
	g.basis = Basis(axis.normalized(), (ang - free) * clampf(arm_droop, 0.0, 1.0)) * g.basis
	skel.set_bone_global_pose(b, g)


func _c(k: String) -> float:
	return float(pose.get(k, 0.0))


func _turn(skel: Skeleton3D, role: String, r_frame: Basis, s: Basis) -> void:
	if not _bones.has(role):
		return
	if r_frame.is_equal_approx(Basis.IDENTITY):
		return
	var b: int = _bones[role]
	var g: Transform3D = skel.get_bone_global_pose(b)
	var r_skel: Basis = s.inverse() * r_frame * s
	g.basis = r_skel * g.basis
	skel.set_bone_global_pose(b, g)
