extends RefCounted
## fid29 combat (build 29, mid and high tiers): the KO settles like a body. After the KO clip's impact frame
## (the hips have come down to the ground), and only once the fight's result is final (fight.gd state "ending"
## or "done"), a partial ragdoll takes over part of the pose: a PhysicalBoneSimulator3D with capsules round the
## humanoid's 25 joints, on its own collision layer that sees nothing but a ground plane under the fighter
## (never a hit or hurt area), its influence eased from 0 to 0.6 over 0.2 s and held. The captured fall keeps
## 40 % of the pose, so the body lands the way it was animated and the limbs settle under gravity.
##
## No physics body of this lane exists while the fight can still change: the physics server's broadphase
## (which hit_area.gd notes can reorder overlaps) is untouched during play, and seeded records cannot move.
## Everything it makes is a child of the fighter's skeleton (and freed with the fight).

const LAYER: int = 1 << 23          # its own physics layer: the ground plane and the bones only
const INFLUENCE: float = 0.6
const BLEND_S: float = 0.2
## bone -> [child bone the capsule reaches to, radius as a share of the length, mass kg]
const CAPS: Dictionary = {
	"Hips": ["Spine", 0.9, 12.0], "Spine": ["Spine2", 0.75, 9.0], "Spine2": ["Neck", 0.65, 9.0], "Head": ["HeadTop_End", 0.45, 5.0],
	"LeftArm": ["LeftForeArm", 0.22, 2.2], "LeftForeArm": ["LeftHand", 0.2, 1.4], "RightArm": ["RightForeArm", 0.22, 2.2], "RightForeArm": ["RightHand", 0.2, 1.4],
	"LeftUpLeg": ["LeftLeg", 0.2, 7.0], "LeftLeg": ["LeftFoot", 0.16, 3.5], "RightUpLeg": ["RightLeg", 0.2, 7.0], "RightLeg": ["RightFoot", 0.16, 3.5],
}
## joint limits (degrees): [swing, twist]
const LIMITS: Dictionary = {"Spine": [25, 15], "Spine2": [25, 15], "Head": [35, 30], "LeftArm": [70, 40], "RightArm": [70, 40],
	"LeftForeArm": [70, 10], "RightForeArm": [70, 10], "LeftUpLeg": [55, 20], "RightUpLeg": [55, 20], "LeftLeg": [65, 5], "RightLeg": [65, 5]}

var skeleton: Skeleton3D
var sim: PhysicalBoneSimulator3D
var ground: StaticBody3D
var impact_t: float = -1.0         # seconds into the KO clip where the hips have landed (-1 = not known)
var _t: float = 0.0
var started: bool = false


static func impact_of(a: Animation) -> float:
	## The first time the hips come within 15 % of the drop from their start height to their final height.
	if a == null:
		return -1.0
	var hi: int = -1
	for i in a.get_track_count():
		if a.track_get_type(i) == Animation.TYPE_POSITION_3D and str(a.track_get_path(i).get_concatenated_subnames()) == "Hips":
			hi = i
			break
	if hi < 0:
		return a.length * 0.6
	var y0: float = (a.position_track_interpolate(hi, 0.0) as Vector3).y
	var y1: float = (a.position_track_interpolate(hi, a.length) as Vector3).y
	if y0 - y1 < 0.05:
		return a.length * 0.6
	var t: float = 0.0
	while t < a.length:
		if (a.position_track_interpolate(hi, t) as Vector3).y <= y1 + 0.15 * (y0 - y1):
			return t
		t += 1.0 / 30.0
	return a.length


## True once the fight has a final result: walks up from the skeleton to the fight node.
static func result_final(n: Node) -> bool:
	while n != null:
		if "outcome" in n and "state" in n:
			var st: String = str(n.get("state"))
			return (st == "ending" or st == "done") and str(n.get("outcome")) != ""
		n = n.get_parent()
	return false


## Each frame while the fighter is down: `clip_t` = seconds into the KO clip, `floor_y` the paving.
func tick(dt: float, clip_t: float, floor_y: float) -> void:
	if skeleton == null or not is_instance_valid(skeleton):
		return
	if not started:
		if impact_t >= 0.0 and clip_t >= impact_t and result_final(skeleton):
			_start(floor_y)
		return
	_t += dt
	var u: float = clampf(_t / BLEND_S, 0.0, 1.0)
	sim.influence = INFLUENCE * u * u * (3.0 - 2.0 * u)


func _start(floor_y: float) -> void:
	started = true
	_t = 0.0
	sim = PhysicalBoneSimulator3D.new()
	sim.name = "KoSettle"
	sim.influence = 0.0
	skeleton.add_child(sim)
	var k: float = skeleton.global_basis.get_scale().y
	for bn: String in CAPS:
		var b: int = skeleton.find_bone(bn)
		var c: int = skeleton.find_bone(str(CAPS[bn][0]))
		if b < 0:
			continue
		var g: Transform3D = skeleton.get_bone_global_rest(b)
		var tip: Vector3 = skeleton.get_bone_global_rest(c).origin if c >= 0 else g.origin + g.basis.y.normalized() * 0.15 / maxf(k, 0.01)
		var len_s: float = maxf(g.origin.distance_to(tip), 0.04)
		var pb := PhysicalBone3D.new()
		pb.name = "pb_" + bn
		pb.bone_name = bn
		pb.collision_layer = LAYER
		pb.collision_mask = LAYER
		pb.mass = float(CAPS[bn][2])
		pb.friction = 0.9
		pb.linear_damp = 0.8
		pb.angular_damp = 2.0
		if LIMITS.has(bn):
			pb.joint_type = PhysicalBone3D.JOINT_TYPE_6DOF
			var sw: float = deg_to_rad(float(LIMITS[bn][0]))
			var tw: float = deg_to_rad(float(LIMITS[bn][1]))
			for ax: String in ["x", "z"]:
				pb.set("joint_constraints/%s/angular_limit_enabled" % ax, true)
				pb.set("joint_constraints/%s/angular_limit_upper" % ax, rad_to_deg(sw))
				pb.set("joint_constraints/%s/angular_limit_lower" % ax, -rad_to_deg(sw))
			pb.set("joint_constraints/y/angular_limit_enabled", true)
			pb.set("joint_constraints/y/angular_limit_upper", rad_to_deg(tw))
			pb.set("joint_constraints/y/angular_limit_lower", -rad_to_deg(tw))
		sim.add_child(pb)
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		# sizes in the skeleton's own units: the model holder's scale reaches the shape through the tree
		var r: float = clampf(len_s * float(CAPS[bn][1]) * 0.5, 0.03 / maxf(k, 0.01), 0.16 / maxf(k, 0.01))
		cap.radius = r
		cap.height = maxf(len_s, 2.0 * r + 0.01 / maxf(k, 0.01))
		cs.shape = cap
		# along the bone, from the joint to its child (in the bone's rest frame; the capsule's axis is Y)
		var dir_l: Vector3 = g.basis.inverse() * (tip - g.origin)
		var mid: Vector3 = dir_l * 0.5
		var y: Vector3 = dir_l.normalized()
		var x: Vector3 = y.cross(Vector3(0, 0, 1)) if absf(y.z) < 0.9 else y.cross(Vector3(1, 0, 0))
		x = x.normalized()
		cs.transform = Transform3D(Basis(x, y, x.cross(y).normalized()).orthonormalized(), mid)
		pb.add_child(cs)
	ground = StaticBody3D.new()
	ground.name = "KoGround"
	ground.collision_layer = LAYER
	ground.collision_mask = 0
	ground.top_level = true
	var gs := CollisionShape3D.new()
	gs.shape = WorldBoundaryShape3D.new()
	ground.add_child(gs)
	skeleton.add_child(ground)
	ground.global_transform = Transform3D(Basis.IDENTITY, Vector3(0.0, floor_y, 0.0))
	sim.physical_bones_start_simulation()


## Physics bodies this made (0 until the result is final): the test reads it.
func bodies() -> int:
	return (sim.get_child_count() if sim != null else 0) + (1 if ground != null else 0)
