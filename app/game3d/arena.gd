extends Node3D
## The fight's place (cq 233): a dusk street plaza like the reference. Paving, the carved
## medallion at the centre, pink and gold circuit lines running down the street, shop
## fronts either side (Kenney City Kit, CC0), street lamps with warm light pools,
## planters and benches. All art is CC0 (docs/game3d/LICENSES.md). cfg "arena": "plain"
## gives G0's flat plate (no kit models) for a cheap run.

const T_PAVERS := preload("res://art/street/street_pavers.png")
const T_MEDALLION := preload("res://art/street/medallion.png")
const T_CIRCUIT := preload("res://art/street/circuit_run.png")
const T_POOL := preload("res://art/street/light_pool.png")

const BUILDINGS: Array[String] = ["building-a", "building-b", "building-c", "building-d", "building-e",
	"building-f", "building-g", "building-h", "building-k", "building-l"]
const STREET_HALF: float = 9.5       # kerb to kerb half width (fight.gd clamps at 8.2 m)
const SHOP_W: float = 7.0

var ground: MeshInstance3D
var plaza: MeshInstance3D
var _dressing: Node3D
var _scenes: Dictionary = {}


func build(cfg: Dictionary) -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.2, 0.2, 0.36)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.78, 0.72, 0.9)
	env.ambient_light_energy = 0.5
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_white = 6.0
	env.fog_enabled = bool(cfg.get("fog", false))
	env.fog_light_color = Color(0.55, 0.48, 0.7)
	env.fog_density = 0.006
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50.0, 40.0, 0.0)
	sun.light_energy = 1.25
	sun.light_color = Color(1.0, 0.86, 0.72)
	sun.shadow_enabled = bool(cfg.get("shadows", false))
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-35.0, -150.0, 0.0)
	fill.light_energy = 0.35
	fill.light_color = Color(0.6, 0.65, 1.0)
	add_child(fill)
	# the street floor, paved
	ground = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(160, 160)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_texture = T_PAVERS
	gm.uv1_scale = Vector3(40, 40, 1)
	gm.albedo_color = Color(0.74, 0.6, 0.66)
	gm.roughness = 0.95
	gm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	ground.material_override = gm
	add_child(ground)
	# the medallion at the centre: where the fight stands
	plaza = MeshInstance3D.new()
	var mq := PlaneMesh.new()
	mq.size = Vector2(7.2, 7.2)
	plaza.mesh = mq
	var mm := StandardMaterial3D.new()
	mm.albedo_texture = T_MEDALLION
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mm.alpha_scissor_threshold = 0.5
	mm.albedo_color = Color(0.92, 0.78, 0.74)
	mm.roughness = 0.9
	plaza.material_override = mm
	plaza.position.y = 0.02
	add_child(plaza)
	# circuit lines down the street, towards the camera, as on the reference
	var cm := StandardMaterial3D.new()
	cm.albedo_texture = T_CIRCUIT
	cm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	cm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	cm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	cm.albedo_color = Color(1, 1, 1, 0.85)
	cm.disable_receive_shadows = true
	for i in 2:
		var c := MeshInstance3D.new()
		var cq := PlaneMesh.new()
		cq.size = Vector2(2.4, 9.6)
		c.mesh = cq
		c.material_override = cm
		c.position = Vector3(0.6 + i * 0.2, 0.03, 9.6 + i * 9.6)
		c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(c)
	if str(cfg.get("arena", "street")) == "plain":
		return
	_dressing = Node3D.new()
	_dressing.name = "Street"
	add_child(_dressing)
	_build_street()


func _scene(n: String) -> PackedScene:
	if not _scenes.has(n):
		_scenes[n] = load("res://art/city/%s.glb" % n)
	return _scenes[n]


## An instance of a kit piece scaled so its footprint is `width` metres wide.
func _piece(n: String, width: float, at: Vector3, yaw_deg: float) -> Node3D:
	var ps: PackedScene = _scene(n)
	if ps == null:
		return null
	var inst: Node3D = ps.instantiate() as Node3D
	var holder := Node3D.new()
	holder.add_child(inst)
	var aabb: AABB = _aabb(inst)
	var s: float = width / maxf(0.01, maxf(aabb.size.x, aabb.size.z))
	inst.scale = Vector3.ONE * s
	inst.position = Vector3(-aabb.get_center().x * s, -aabb.position.y * s, -aabb.get_center().z * s)
	holder.position = at
	holder.rotation_degrees.y = yaw_deg
	_dressing.add_child(holder)
	for mi: Node in inst.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return holder


static func _aabb(root: Node3D) -> AABB:
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


func _build_street() -> void:
	# shop fronts down both sides of the street, facing in
	var i: int = 0
	var z: float = 16.0
	while z > -42.0:
		for side in 2:
			var x: float = (STREET_HALF + SHOP_W * 0.5) * (-1.0 if side == 0 else 1.0)
			var n: String = BUILDINGS[(i * 3 + side * 5) % BUILDINGS.size()]
			_piece(n, SHOP_W, Vector3(x, 0, z), 90.0 if side == 0 else -90.0)
		z -= SHOP_W + 0.4
		i += 1
	# kerbs: a slightly raised strip in front of the shops
	var km := StandardMaterial3D.new()
	km.albedo_color = Color(0.62, 0.55, 0.6)
	km.roughness = 0.95
	for side in 2:
		var k := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(0.5, 0.18, 62.0)
		k.mesh = b
		k.material_override = km
		k.position = Vector3((STREET_HALF - 0.3) * (-1.0 if side == 0 else 1.0), 0.09, -13.0)
		_dressing.add_child(k)
	# street lamps with warm pools, planters and benches along the kerbs
	var pool_m := StandardMaterial3D.new()
	pool_m.albedo_texture = T_POOL
	pool_m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	pool_m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	pool_m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	pool_m.albedo_color = Color(1.0, 0.75, 0.45, 0.35)
	pool_m.disable_receive_shadows = true
	var lz: float = 10.0
	var li: int = 0
	while lz > -36.0:
		for side in 2:
			var sx: float = -1.0 if side == 0 else 1.0
			var lamp := _piece("light-curved", 1.6, Vector3(sx * (STREET_HALF - 1.0), 0, lz + side * 3.0), 90.0 if side == 0 else -90.0)
			if lamp != null:
				var aabb: AABB = _aabb(lamp)
				var h: float = aabb.size.y
				lamp.scale = Vector3.ONE * (5.5 / maxf(0.1, h))
			var pool := MeshInstance3D.new()
			var pq := PlaneMesh.new()
			pq.size = Vector2(7.0, 7.0)
			pool.mesh = pq
			pool.material_override = pool_m
			pool.position = Vector3(sx * (STREET_HALF - 3.0), 0.035, lz + side * 3.0)
			pool.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_dressing.add_child(pool)
			if li % 2 == 0:
				_piece("planter", 1.4, Vector3(sx * (STREET_HALF - 0.9), 0, lz + side * 3.0 - 2.2), 0.0)
			else:
				_piece("stall-bench", 2.0, Vector3(sx * (STREET_HALF - 1.0), 0, lz + side * 3.0 - 2.4), 90.0 if side == 0 else -90.0)
		lz -= 9.0
		li += 1
	for side in 2:
		_piece("tree-small", 2.6, Vector3((STREET_HALF - 1.2) * (-1.0 if side == 0 else 1.0), 0, -24.0 + side * 4.0), 0.0)


## With a 3D Tiles ground, the tileset is the floor: hide ours (and the plaza unless kept).
func tiles_mode(keep_plaza: bool) -> void:
	ground.visible = false
	if not keep_plaza:
		plaza.visible = false
	if _dressing != null:
		_dressing.visible = false
