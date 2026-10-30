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
const FACADE_SHADER := preload("res://vfx/facade.gdshader")
const T_NEON := preload("res://art/street/neon_atlas.png")     # 6 signs stacked, self-drawn
const T_SHOP := preload("res://art/street/shop_glow.png")
const T_LAMP := preload("res://art/street/lamp_glow.png")
const T_CONE := preload("res://art/street/lamp_cone.png")
const NEON_SIGNS: int = 6

const BUILDINGS: Array[String] = ["building-a", "building-b", "building-c", "building-d", "building-e",
	"building-f", "building-g", "building-h", "building-k", "building-l"]
const STREET_HALF: float = 5.6       # kerb to kerb half width (fight.gd clamps at 4.7 m)
const SHOP_W: float = 7.0
const MERGE_CHUNK: float = 12.0      # metres of street per merged mesh (culling)

var ground: MeshInstance3D
var plaza: MeshInstance3D
var _dressing: Node3D
var _scenes: Dictionary = {}
var map_blocks: Array[Rect2] = []   # building footprints (x, z in metres) for the minimap


func build(cfg: Dictionary) -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.2, 0.2, 0.36)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.62, 0.64, 0.92)
	env.ambient_light_energy = 0.66
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
	sun.rotation_degrees = Vector3(-42.0, 40.0, 0.0)
	sun.light_energy = 1.15
	sun.light_color = Color(1.0, 0.8, 0.62)
	sun.shadow_enabled = bool(cfg.get("shadows", false))
	add_child(sun)
	# no second (fill) light: each directional light is shaded on every pixel, ~2 ms a frame
	# on the software GPU; the bluer, stronger ambient does its job
	# the street floor, paved
	ground = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(160, 160)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_texture = T_PAVERS
	gm.uv1_scale = Vector3(40, 40, 1)
	gm.albedo_color = Color(0.64, 0.56, 0.62)
	gm.roughness = 0.95
	# plain trilinear: anisotropic filtering costs ~1.7 ms a frame on a software GPU
	gm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
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
	cm.albedo_color = Color(1, 1, 1, 0.9)
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
	for k in 2:
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_neon_st.append(st)
		var st2 := SurfaceTool.new()
		st2.begin(Mesh.PRIMITIVE_TRIANGLES)
		_shop_st.append(st2)
	_lamps_st = SurfaceTool.new()
	_lamps_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_cones_st = SurfaceTool.new()
	_cones_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_build_street()
	_commit_glows()
	if bool(cfg.get("merge_street", true)):
		_merge_dressing()


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
		if n.begins_with("building"):
			mi.set_meta("facade", true)
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
			var sx: float = -1.0 if side == 0 else 1.0
			var x: float = (STREET_HALF + SHOP_W * 0.5) * sx
			var n: String = BUILDINGS[(i * 3 + side * 5) % BUILDINGS.size()]
			var h: Node3D = _piece(n, SHOP_W, Vector3(x, 0, z), 90.0 if side == 0 else -90.0)
			if h != null:
				_dress_front(h, sx, i * 2 + side)
				var wb: AABB = h.transform * _aabb(h)
				map_blocks.append(Rect2(wb.position.x, wb.position.z, wb.size.x, wb.size.z))
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
			var lamp := _piece("light-curved", 1.6, Vector3(sx * (STREET_HALF - 0.55), 0, lz + side * 3.0), 90.0 if side == 0 else -90.0)
			if lamp != null:
				var aabb: AABB = _aabb(lamp)
				var h: float = aabb.size.y
				lamp.scale = Vector3.ONE * (5.5 / maxf(0.1, h))
				for mi: Node in lamp.find_children("*", "MeshInstance3D", true, false):
					mi.set_meta("lamp", true)
				# the lamp head: the end of the arm, over the street
				var wb: AABB = lamp.transform * _aabb(lamp)
				var head_x: float = wb.position.x if sx > 0.0 else wb.end.x
				var head := Vector3(head_x + sx * 0.25, wb.end.y - 0.35, lamp.position.z)
				_glow_quad(_lamps_st, head, 2.2, 2.2, Rect2(0, 0, 1, 1), true)
				# the light falling from the head to its pool, as on the reference's dusk street
				_cone(_cones_st, head - Vector3(0, 0.2, 0), Vector3(head.x, 0.05, head.z + 0.6), 0.4, 4.0)
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


# ---- the lit street: neon signs, shop windows, lamp heads. Each kind is one mesh per side of
# the street (a handful of draw calls, unshaded and additive), not one node per sign.
var _neon_st: Array[SurfaceTool] = []
var _shop_st: Array[SurfaceTool] = []
var _lamps_st: SurfaceTool
var _cones_st: SurfaceTool
var _cam_facing: Basis = Basis.from_euler(Vector3(deg_to_rad(-44.0), 0.0, 0.0))   # fight.gd CAM_PITCH


## A shop front: warm light spilling from its windows onto the pavement, and on most a neon
## blade sign sticking out over the pavement (turned to the fight camera, so it reads).
func _dress_front(h: Node3D, sx: float, n: int) -> void:
	var wb: AABB = h.transform * _aabb(h)
	var front_x: float = wb.end.x if sx < 0.0 else wb.position.x
	var zc: float = wb.get_center().z
	var length: float = wb.size.z
	var side: int = 0 if sx < 0.0 else 1
	_ground_quad(_shop_st[side], Vector3(front_x - sx * 1.0, 0.04, zc), 2.0, length * 0.8, Rect2(0, 0, 1, 1))
	# signs only up the street (z < -3): the camera's focus never goes past z = -6
	# (CAM_BOUNDS), so they stay in the top half of the screen, never among the controls
	if n % 3 != 2 and zc < -3.0:
		var k: int = (n * 5 + 1) % NEON_SIGNS
		var w: float = 2.0
		_glow_quad(_neon_st[side], Vector3(front_x - sx * (w * 0.5 + 0.1), 4.7 + 0.35 * float(n % 2), zc + (1.2 if n % 2 == 0 else -1.2)),
			w, w * 0.375, Rect2(0, float(k) / NEON_SIGNS, 1, 1.0 / NEON_SIGNS), true)


## A flat quad on the ground: `wx` across the street (x), `wz` along it.
func _ground_quad(st: SurfaceTool, c: Vector3, wx: float, wz: float, uv: Rect2) -> void:
	_quad(st, c, Vector3(0, 0, wz * 0.5), Vector3(wx * 0.5, 0, 0), uv)


## A quad on a wall facing the street (the wall's normal is -sx along x).
func _wall_quad(st: SurfaceTool, c: Vector3, sx: float, w: float, h: float, uv: Rect2) -> void:
	var right: Vector3 = Vector3(0, 0, sx) * (w * 0.5)   # reads left to right from the street
	var up: Vector3 = Vector3(0, h * 0.5, 0)
	_quad(st, c, right, up, uv)


## A quad that faces the (fixed-angle) fight camera: a glow without a billboard node.
func _glow_quad(st: SurfaceTool, c: Vector3, w: float, h: float, uv: Rect2, _face_cam: bool) -> void:
	_quad(st, c, _cam_facing.x * (w * 0.5), _cam_facing.y * (h * 0.5), uv)


## A light cone: a vertical trapezoid facing the camera's side of the street (+z).
func _cone(st: SurfaceTool, top: Vector3, bottom: Vector3, top_w: float, bottom_w: float) -> void:
	var p := [bottom - Vector3(bottom_w * 0.5, 0, 0), bottom + Vector3(bottom_w * 0.5, 0, 0), top + Vector3(top_w * 0.5, 0, 0), top - Vector3(top_w * 0.5, 0, 0)]
	var t := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
	for idx: int in [0, 1, 2, 0, 2, 3]:
		st.set_uv(t[idx])
		st.add_vertex(p[idx])


func _quad(st: SurfaceTool, c: Vector3, right: Vector3, up: Vector3, uv: Rect2) -> void:
	var p := [c - right - up, c + right - up, c + right + up, c - right + up]
	var t := [Vector2(uv.position.x, uv.end.y), Vector2(uv.end.x, uv.end.y), Vector2(uv.end.x, uv.position.y), uv.position]
	for idx: int in [0, 1, 2, 0, 2, 3]:
		st.set_uv(t[idx])
		st.add_vertex(p[idx])


func _glow_mat(tex: Texture2D, col: Color, add: bool = true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.albedo_color = col
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if add else BaseMaterial3D.BLEND_MODE_MIX
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_receive_shadows = true
	m.no_depth_test = false
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	return m


func _commit_glows() -> void:
	var neon_m := _glow_mat(T_NEON, Color(1.15, 1.15, 1.15, 1.0), false)   # mixed: added on the pale paving it washes to white
	var shop_m := _glow_mat(T_SHOP, Color(1.0, 0.8, 0.55, 0.75))
	var lamp_m := _glow_mat(T_LAMP, Color(1.0, 0.9, 0.7, 1.0))
	var out: Array = []
	for side in 2:
		out.append([_neon_st[side], neon_m])
		out.append([_shop_st[side], shop_m])
	out.append([_lamps_st, lamp_m])
	out.append([_cones_st, _glow_mat(T_CONE, Color(1.0, 0.82, 0.55, 0.95))])
	for pair: Array in out:
		var mesh: ArrayMesh = (pair[0] as SurfaceTool).commit()
		if mesh.get_surface_count() == 0:
			continue
		var mi := MeshInstance3D.new()
		mi.name = "Glow"
		mi.mesh = mesh
		mi.material_override = pair[1]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)


## Bakes the whole street (about 90 mesh instances) into one mesh per material: the Kenney
## kits share a colour atlas, so the street draws in a handful of calls instead of ~90.
## On the emulator's software GPU each draw call is frame time, and frame time is input latency.
func _merge_dressing() -> void:
	var groups: Dictionary = {}     # key -> {st: SurfaceTool, mat: Material}
	var n_in: int = 0
	var inv: Transform3D = _dressing.global_transform.affine_inverse()
	for node: Node in _dressing.find_children("*", "MeshInstance3D", true, false):
		var mi := node as MeshInstance3D
		if mi.mesh == null:
			continue
		n_in += 1
		var xf: Transform3D = inv * mi.global_transform
		# one chunk per stretch of street and side, so the camera culls what it cannot see
		var at: Vector3 = xf * mi.get_aabb().get_center()
		var facade: bool = mi.has_meta("facade")
		# the shop fronts (most of the vertices) in chunks the camera can cull; the small
		# props one mesh per material (each extra mesh is a draw call)
		var chunk: String = "%d%s" % [floori(at.z / MERGE_CHUNK), "l" if at.x < 0.0 else "r"] if facade else ""
		for si in mi.mesh.get_surface_count():
			var mat: Material = mi.get_active_material(si)
			var key: String = "%s_c%s%s" % [_mat_key(mat), chunk, "f" if facade else ""]
			if not groups.has(key):
				var st := SurfaceTool.new()
				st.begin(Mesh.PRIMITIVE_TRIANGLES)
				groups[key] = {"st": st, "mat": _facade_mat(mat) if facade else (_dark(mat) if mi.has_meta("lamp") else _opaque(mat))}
			(groups[key]["st"] as SurfaceTool).append_from(mi.mesh, si, xf)
	var merged := Node3D.new()
	merged.name = "StreetMerged"
	for key: String in groups:
		var st: SurfaceTool = groups[key]["st"]
		var mesh: ArrayMesh = st.commit()
		var out := MeshInstance3D.new()
		out.mesh = mesh
		out.material_override = groups[key]["mat"]
		out.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		merged.add_child(out)
	remove_child(_dressing)
	_dressing.queue_free()
	_dressing = merged
	add_child(_dressing)
	print("CQ street merged %d mesh instances into %d (%.0f m chunks)" % [n_in, groups.size(), MERGE_CHUNK])


## The kits' GLBs import as alpha blended with a depth pre-pass (drawn twice, blended, sorted)
## though every pixel is opaque: draw the shop fronts, lamps and benches as plain opaque.
func _opaque(mat: Material) -> Material:
	if mat is BaseMaterial3D and (mat as BaseMaterial3D).transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_DEPTH_PRE_PASS:
		var m := (mat as BaseMaterial3D).duplicate() as BaseMaterial3D
		m.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
		return m
	return mat


## Lamp posts: dark iron, so the glowing heads carry them (the kit's are pale grey).
func _dark(mat: Material) -> Material:
	var m: Material = _opaque(mat)
	if m is BaseMaterial3D:
		m = (m as BaseMaterial3D).duplicate()
		(m as BaseMaterial3D).albedo_color = Color(0.3, 0.27, 0.36)
	return m


var _facades: Dictionary = {}   # atlas texture -> the facade ShaderMaterial (one per atlas)


func _facade_mat(mat: Material) -> Material:
	if not (mat is BaseMaterial3D) or (mat as BaseMaterial3D).albedo_texture == null:
		return _opaque(mat)
	var tex: Texture2D = (mat as BaseMaterial3D).albedo_texture
	var key: String = _mat_key(mat)
	if not _facades.has(key):
		var sm := ShaderMaterial.new()
		sm.shader = FACADE_SHADER
		sm.set_shader_parameter("atlas", tex)
		_facades[key] = sm
	return _facades[key]


var _tex_hash: Dictionary = {}   # texture instance id -> pixel hash (one hash per texture)


func _mat_key(mat: Material) -> String:
	# the kits' GLBs each embed their own copy of the same atlas: key them by the pixels
	if mat is BaseMaterial3D and (mat as BaseMaterial3D).albedo_texture != null:
		var bm := mat as BaseMaterial3D
		var tex: Texture2D = bm.albedo_texture
		var id: int = tex.get_instance_id()
		if not _tex_hash.has(id):
			var img: Image = tex.get_image()
			_tex_hash[id] = hash(img.get_data()) if img != null else id
		return "tex%d_%d_%s" % [_tex_hash[id], bm.transparency, str(bm.albedo_color)]
	return "mat%d" % (mat.get_instance_id() if mat != null else 0)


## With a 3D Tiles ground, the tileset is the floor: hide ours (and the plaza unless kept).
func tiles_mode(keep_plaza: bool) -> void:
	ground.visible = false
	if not keep_plaza:
		plaza.visible = false
	if _dressing != null:
		_dressing.visible = false
