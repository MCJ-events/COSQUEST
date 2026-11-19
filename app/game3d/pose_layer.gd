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
	"r_hand": ["RightHand", "hand_r", "hand.R", "Hand_R"],
	"l_hand": ["LeftHand", "hand_l", "hand.L", "Hand_L"],
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


## fid29 combat (build 29, mid and high): additive captured clips on top of whatever plays, the directional
## hit reactions (combat_animator.gd flinch). Each entry is [Animation, clip seconds, weight]; only the spine,
## neck, head and arm bones take them (each bone's rotation since the clip's first frame, in its own frame,
## scaled by the weight), so the legs keep the clip's footwork and foot lock. Empty on the low tier.
var add_layers: Array = []
const ADD_BONES: Array[String] = ["Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm",
	"RightShoulder", "RightArm", "RightForeArm"]
var _add_map: Dictionary = {}   # Animation -> [[bone index, track index, rotation at the first frame], ...]


func _apply_add(skel: Skeleton3D) -> void:
	for e: Array in add_layers:
		var a: Animation = e[0]
		var w: float = float(e[2])
		if a == null or w <= 0.001:
			continue
		if not _add_map.has(a):
			var m: Array = []
			for i in a.get_track_count():
				if a.track_get_type(i) != Animation.TYPE_ROTATION_3D:
					continue
				var bn: String = str(a.track_get_path(i).get_concatenated_subnames())
				if not (bn in ADD_BONES):
					continue
				var b: int = skel.find_bone(bn)
				if b >= 0:
					m.append([b, i, a.rotation_track_interpolate(i, 0.0)])
			_add_map[a] = m
		var t: float = float(e[1])
		for bt: Array in _add_map[a]:
			var q0: Quaternion = bt[2]
			var d: Quaternion = (q0.inverse() * a.rotation_track_interpolate(int(bt[1]), t)).normalized()
			var b: int = bt[0]
			skel.set_bone_pose_rotation(b, skel.get_bone_pose_rotation(b) * Quaternion.IDENTITY.slerp(d, w))


func _process_modification_with_delta(_delta: float) -> void:
	if not add_layers.is_empty() and not _bones.is_empty():
		var sk: Skeleton3D = get_skeleton()
		if sk != null:
			_apply_add(sk)
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
	# fight-look-31 (fl_motion): the hand turned about the forearm's line (+ = the palm towards the body), so a hanging
	# open hand rests palm in instead of facing the camera (the models have no finger bones)
	_twist(skel, "r_hand", "r_fore", -_c("r_twist"))
	_twist(skel, "l_hand", "l_fore", _c("l_twist"))


func _twist(skel: Skeleton3D, hand: String, fore: String, deg: float) -> void:
	if absf(deg) < 0.01 or not (_bones.has(hand) and _bones.has(fore)):
		return
	var b: int = _bones[hand]
	var g: Transform3D = skel.get_bone_global_pose(b)
	var axis: Vector3 = g.origin - skel.get_bone_global_pose(_bones[fore]).origin
	if axis.length_squared() < 1e-10:
		return
	g.basis = Basis(axis.normalized(), deg_to_rad(deg)) * g.basis
	skel.set_bone_global_pose(b, g)


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
