extends Node3D
## The real place round a fight (cq 019, docs/game3d/PLACE.md): OpenStreetMap ground in the game
## server's /v1/map/ground shape (roads, paved squares, green, water, buildings with heights, trees,
## and the landmarks the Overpass tool adds), laid out round the Quest Point the fight is at.
##
## The fight itself does not change: the fighters keep the same 11.2 x 18 m area and every rule. The
## place is turned so the camera looks at the nearest notable landmark (a column, a monument, a
## statue, a fountain; else the tallest building near by), and nothing is built where it would stand
## in the fight or between the fight and the camera.
##
## Built as a handful of meshes: the buildings in three wall styles (place_facade.gdshader: lit
## windows at dusk, like the street's facades), roads, paved squares, green and water as flat
## polygons, trees as one MultiMesh, landmarks from simple solids.

const FACADE := preload("res://vfx/place_facade.gdshader")

const BAY: float = 3.6          # metres per window bay along a wall
const FLOOR: float = 3.4        # metres per floor
const TEX_BAYS: int = 4         # the wall texture is 4 x 4 bays, so windows vary
const REACH: float = 260.0      # nothing further than this is built (the camera sees ~150 m)
# the clear zone, in the fight's frame: the fighters' area with a margin, and the wedge up to the
# camera (it stands ~17 m behind the fight, ~11 m up)
const CLEAR := Rect2(-9.0, -11.0, 18.0, 37.0)
const LANDMARK_WEIGHT: Dictionary = {"column": 3.0, "obelisk": 2.5, "monument": 2.0, "statue": 1.0, "fountain": 0.8}

var map_blocks: Array[Rect2] = []
var info: Dictionary = {}       # what was built and which way it faces (the load log)

var _at: Vector2 = Vector2.ZERO  # the fight's spot in ground metres (x east, z north)
var _yaw: float = 0.0            # radians: ground (after the north flip) turned by this into the fight frame
var _hemi: Callable
var _look: Dictionary = {}


## ground: the parsed JSON. at: the Quest Point in the ground's metres. cam_yaw_deg: the fight camera's
## turn (fight.gd CAM_YAW), so the landmark lands in the middle of the view. yaw_override: degrees, or NAN.
func build(ground: Dictionary, at: Vector2, cam_yaw_deg: float, yaw_override: float, look: Dictionary, hemi: Callable) -> void:
	_at = at
	_hemi = hemi
	_look = look
	var t0: int = Time.get_ticks_usec()
	var lm: Dictionary = _hero_landmark(ground)
	if not is_nan(yaw_override):
		_yaw = deg_to_rad(yaw_override)
	elif not lm.is_empty():
		# the landmark's direction (after the north flip) onto the camera's forward
		var d: Vector2 = Vector2(float(lm["x"]) - at.x, -(float(lm["z"]) - at.y))
		var fwd: Vector2 = Vector2(-sin(deg_to_rad(cam_yaw_deg)), -cos(deg_to_rad(cam_yaw_deg)))
		_yaw = fwd.angle() - d.angle()
	info = {"landmark": str(lm.get("name", "")), "landmark_kind": str(lm.get("kind", "")),
		"yaw_deg": snappedf(rad_to_deg(_yaw), 0.1)}
	if not lm.is_empty():
		var lp: Vector2 = to_fight(Vector2(float(lm["x"]), float(lm["z"])))
		info["landmark_at"] = Vector3(lp.x, 0.0, lp.y)
		info["landmark_h"] = float(lm.get("h", 12.0))
	_build_flat(ground)
	_build_buildings(ground.get("buildings", []), look)
	_build_trees(ground.get("trees", []))
	_build_landmarks(ground.get("landmarks", []))
	info["ms"] = snappedf((Time.get_ticks_usec() - t0) / 1000.0, 0.1)


## A point in the ground's metres to the fight's frame (x right, z towards the camera).
func to_fight(p: Vector2) -> Vector2:
	return Vector2(p.x - _at.x, -(p.y - _at.y)).rotated(_yaw)


func _pts(raw: Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	for q: Variant in raw:
		var a: Array = q
		out.append(to_fight(Vector2(float(a[0]), float(a[1]))))
	return out


func _far(pts: PackedVector2Array) -> bool:
	for p: Vector2 in pts:
		if p.length() < REACH:
			return false
	return true


func _hero_landmark(ground: Dictionary) -> Dictionary:
	var best: Dictionary = {}
	var best_s: float = 0.0
	for m: Variant in ground.get("landmarks", []):
		var d: Dictionary = m
		var dist: float = Vector2(float(d["x"]) - _at.x, float(d["z"]) - _at.y).length()
		if dist < 12.0 or dist > 140.0:
			continue
		var s: float = float(LANDMARK_WEIGHT.get(str(d["kind"]), 0.5)) * sqrt(maxf(1.0, float(d["h"]))) / (1.0 + dist / 50.0)
		if s > best_s:
			best_s = s
			best = d
	if not best.is_empty():
		# its best name: a column's statue is often mapped apart from the column ("Horatio Nelson" on
		# "Nelson's Column"); the widest named thing at the same spot names the place
		for m2: Variant in ground.get("landmarks", []):
			var d2: Dictionary = m2
			if str(d2.get("name", "")) != "" and Vector2(float(d2["x"]) - float(best["x"]), float(d2["z"]) - float(best["z"])).length() < 3.0 \
					and float(d2.get("r", 0.0)) > float(best.get("r", 0.0)):
				best = best.duplicate()
				best["name"] = d2["name"]
	if best.is_empty():
		for b: Variant in ground.get("buildings", []):
			var bd: Dictionary = b
			var ring: Array = bd["p"]
			var c: Vector2 = Vector2.ZERO
			for q: Variant in ring:
				c += Vector2(float(q[0]), float(q[1]))
			c /= maxf(1.0, ring.size())
			var dist2: float = (c - _at).length()
			if dist2 > 25.0 and dist2 < 150.0 and float(bd["h"]) / (1.0 + dist2 / 60.0) > best_s:
				best_s = float(bd["h"]) / (1.0 + dist2 / 60.0)
				best = {"x": c.x, "z": c.y, "name": "", "kind": "building"}
	return best


# ------------------------------------------------------------ the flat layers

func _build_flat(ground: Dictionary) -> void:
	var layers: Array = [
		["paved", ground.get("paved", []), Color(0.72, 0.72, 0.7), 0.006],   # env-fixes 2: grey stone, not lilac
		["green", ground.get("green", []), Color(0.33, 0.5, 0.3), 0.010],
		["water", ground.get("water", []), Color(0.22, 0.42, 0.62), 0.014],
	]
	for layer: Array in layers:
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var n: int = 0
		for a: Variant in layer[1]:
			var pts: PackedVector2Array = _pts((a as Dictionary)["p"])
			if pts.size() > 3 and pts[0].is_equal_approx(pts[pts.size() - 1]):
				pts.remove_at(pts.size() - 1)
			if pts.size() < 3 or _far(pts):
				continue
			var tri: PackedInt32Array = Geometry2D.triangulate_polygon(pts)
			if tri.is_empty():
				continue
			for k in range(0, tri.size(), 3):
				_up_tri(st, pts[tri[k]], pts[tri[k + 1]], pts[tri[k + 2]], float(layer[3]))
			n += 1
		info[str(layer[0])] = n
		if n > 0:
			_add_mesh(st.commit(), _flat_mat(layer[2]), str(layer[0]))
	# roads: asphalt ribbons; paths stay the paving they already are
	var rs := SurfaceTool.new()
	rs.begin(Mesh.PRIMITIVE_TRIANGLES)
	var nr: int = 0
	for r: Variant in ground.get("roads", []):
		var rd: Dictionary = r
		if str(rd.get("k", "")) in ["path", "rail"]:
			continue
		var pts2: PackedVector2Array = _pts(rd["p"])
		if _far(pts2):
			continue
		var hw: float = float(rd.get("w", 6.0)) * 0.5
		for i in range(pts2.size() - 1):
			var a2: Vector2 = pts2[i]
			var b2: Vector2 = pts2[i + 1]
			var dir: Vector2 = (b2 - a2)
			if dir.length() < 0.05:
				continue
			dir = dir.normalized()
			var nrm: Vector2 = Vector2(-dir.y, dir.x) * hw
			a2 -= dir * hw * 0.5
			b2 += dir * hw * 0.5
			_up_tri(rs, a2 + nrm, b2 + nrm, b2 - nrm, 0.018)
			_up_tri(rs, a2 + nrm, b2 - nrm, a2 - nrm, 0.018)
		nr += 1
	info["roads"] = nr
	if nr > 0:
		# env-fixes 2: a dark asphalt (was (0.44, 0.42, 0.47): it rendered navy under the blue ambient)
		_add_mesh(rs.commit(), _flat_mat(Color(0.25, 0.26, 0.28)), "roads")


## One flat ground triangle, wound so its front face looks up. env-fixes 2: the flat layers are drawn
## two-sided, and a triangle wound the other way was lit as a face looking down (ambient only): that
## is why the roads, and some squares, rendered navy under the blue ambient (audit issue 7).
func _up_tri(st: SurfaceTool, a: Vector2, b: Vector2, c: Vector2, y: float) -> void:
	var cross: float = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
	var tri := PackedVector2Array([a, b, c] if cross > 0.0 else [a, c, b])   # clockwise seen from above
	for p: Vector2 in tri:
		st.set_normal(Vector3.UP)
		st.add_vertex(Vector3(p.x, y, p.y))


func _flat_mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.95
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


func _add_mesh(mesh: Mesh, mat: Material, n: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = n
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi


# ------------------------------------------------------------ buildings

## Three wall styles: Portland stone (the tall and civic), London brick, white stucco.
const WALLS: Array = [Color(0.86, 0.8, 0.68), Color(0.62, 0.4, 0.32), Color(0.9, 0.88, 0.84)]


func _wall_texture(wall: Color, seed_i: int) -> ImageTexture:
	var px: int = 16                       # pixels per bay
	var img := Image.create(px * TEX_BAYS, px * TEX_BAYS, false, Image.FORMAT_RGB8)
	img.fill(wall)
	var rng := RandomNumberGenerator.new()
	rng.seed = 1931 + seed_i              # fixed: the same city every fight (and no draw from the fight's rng)
	for by in TEX_BAYS:
		for bx in TEX_BAYS:
			# env-fixes 2: a lit window carries its dim level (red) and one of three warm tints (green),
			# blue high to mark it glass (place_facade.gdshader); some have a drawn curtain (dimmer, amber
			# top rows). Unlit glass is a dark neutral, not navy.
			var lit: bool = rng.randf() < 0.5
			var level: float = rng.randf_range(0.35, 1.0)
			var pick: float = [0.0, 0.5, 1.0][rng.randi() % 3]
			var curtain: int = 4 + (3 + rng.randi() % 3 if rng.randf() < 0.35 else 0)
			for y in range(4, 13):
				for x in range(4, 12):
					var glass: Color = Color(0.13, 0.14, 0.17)
					if lit:
						glass = Color(level * 0.6 * (0.5 if y < curtain else 1.0), (1.0 if y < curtain else pick) * 0.6, 1.0)
					img.set_pixel(bx * px + x, by * px + y, glass)
			# a sill under each window
			for x in range(3, 13):
				img.set_pixel(bx * px + x, by * px + 13, wall.darkened(0.18))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _build_buildings(builds: Array, look: Dictionary) -> void:
	var sts: Array[SurfaceTool] = []
	for i in WALLS.size():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		sts.append(st)
	var built: int = 0
	var cleared: int = 0
	for b: Variant in builds:
		var bd: Dictionary = b
		var pts: PackedVector2Array = _pts(bd["p"])
		if pts.size() > 3 and pts[0].is_equal_approx(pts[pts.size() - 1]):
			pts.remove_at(pts.size() - 1)
		if pts.size() < 3 or _far(pts):
			continue
		var box: Rect2 = Rect2(pts[0], Vector2.ZERO)
		for p: Vector2 in pts:
			box = box.expand(p)
		if box.intersects(CLEAR):
			cleared += 1
			continue
		var h: float = clampf(float(bd["h"]), 3.0, 320.0)
		var base: float = clampf(float(bd.get("b", 0.0)), 0.0, h - 1.0)
		var style: int = 0 if h >= 22.0 else (1 + int(absf(pts[0].x * 7.0 + pts[0].y * 13.0)) % 2)
		_extrude(sts[style], pts, base, h)
		map_blocks.append(box)
		built += 1
	info["buildings"] = built
	info["buildings_cleared"] = cleared
	for i in WALLS.size():
		var sm := ShaderMaterial.new()
		sm.shader = FACADE
		sm.set_shader_parameter("atlas", _wall_texture(WALLS[i], i))
		if _hemi.is_valid():
			_hemi.call(sm, look)
		_add_mesh(sts[i].commit(), sm, "buildings_%d" % i)


func _extrude(st: SurfaceTool, pts: PackedVector2Array, base: float, h: float) -> void:
	# outward walls: the ring's winding after the flip and turn decides which side is out
	var area: float = 0.0
	for i in pts.size():
		var a: Vector2 = pts[i]
		var b: Vector2 = pts[(i + 1) % pts.size()]
		area += a.x * b.y - b.x * a.y
	var ccw: bool = area > 0.0
	var u: float = 0.0
	var span: float = BAY * TEX_BAYS
	var vspan: float = FLOOR * TEX_BAYS
	for i in pts.size():
		var a: Vector2 = pts[i]
		var b: Vector2 = pts[(i + 1) % pts.size()]
		var len: float = a.distance_to(b)
		if len < 0.05:
			continue
		var d: Vector2 = (b - a) / len
		var n2: Vector2 = Vector2(d.y, -d.x) if ccw else Vector2(-d.y, d.x)
		var nrm: Vector3 = Vector3(n2.x, 0.0, n2.y)
		var v0: Vector3 = Vector3(a.x, base, a.y)
		var v1: Vector3 = Vector3(b.x, base, b.y)
		var v2: Vector3 = Vector3(b.x, h, b.y)
		var v3: Vector3 = Vector3(a.x, h, a.y)
		var uv0: Vector2 = Vector2(u / span, -base / vspan)
		var uv1: Vector2 = Vector2((u + len) / span, -base / vspan)
		var uv2: Vector2 = Vector2((u + len) / span, -h / vspan)
		var uv3: Vector2 = Vector2(u / span, -h / vspan)
		var quad: Array = [[v0, uv0], [v1, uv1], [v2, uv2], [v0, uv0], [v2, uv2], [v3, uv3]] if ccw \
			else [[v0, uv0], [v2, uv2], [v1, uv1], [v0, uv0], [v3, uv3], [v2, uv2]]
		for q: Array in quad:
			st.set_normal(nrm)
			st.set_uv(q[1])
			st.add_vertex(q[0])
		u += len
	var tri: PackedInt32Array = Geometry2D.triangulate_polygon(pts)
	for k in range(0, tri.size(), 3):
		# roof triangles face up
		var ids := PackedInt32Array([tri[k], tri[k + 2], tri[k + 1]]) if ccw else PackedInt32Array([tri[k], tri[k + 1], tri[k + 2]])
		for i2: int in ids:
			st.set_normal(Vector3.UP)
			st.set_uv(Vector2.ZERO)
			st.add_vertex(Vector3(pts[i2].x, h, pts[i2].y))


# ------------------------------------------------------------ trees

func _build_trees(trees: Array) -> void:
	var places: Array[Transform3D] = []
	for t: Variant in trees:
		var a: Array = t
		var p: Vector2 = to_fight(Vector2(float(a[0]), float(a[1])))
		if p.length() > REACH or CLEAR.grow(-1.0).has_point(p):
			continue
		var s: float = clampf(float(a[2]), 0.6, 1.8)
		var xf := Transform3D(Basis.from_euler(Vector3(0, float(int(a[0] * 10.0) % 360), 0)).scaled(Vector3.ONE * s), Vector3(p.x, 0, p.y))
		places.append(xf)
	info["trees"] = places.size()
	if places.is_empty():
		return
	# a London plane, simply: a trunk and two crowns, 9 m tall at scale 1
	var am := ArrayMesh.new()
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.22
	trunk.bottom_radius = 0.32
	trunk.height = 4.0
	trunk.radial_segments = 6
	trunk.rings = 1
	var crown := SphereMesh.new()
	crown.radius = 2.9
	crown.height = 4.6
	crown.radial_segments = 8
	crown.rings = 4
	var st := SurfaceTool.new()
	st.append_from(trunk, 0, Transform3D(Basis(), Vector3(0, 2.0, 0)))
	am = st.commit()
	var st2 := SurfaceTool.new()
	st2.append_from(crown, 0, Transform3D(Basis(), Vector3(0, 5.8, 0)))
	st2.append_from(crown, 0, Transform3D(Basis().scaled(Vector3(0.75, 0.8, 0.75)), Vector3(0.9, 7.6, 0.4)))
	am = st2.commit(am)
	var bark := _flat_mat(Color(0.33, 0.27, 0.24))
	var leaf := _flat_mat(Color(0.3, 0.46, 0.28))
	leaf.cull_mode = BaseMaterial3D.CULL_BACK
	am.surface_set_material(0, bark)
	am.surface_set_material(1, leaf)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = am
	mm.instance_count = places.size()
	for i in places.size():
		mm.set_instance_transform(i, places[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "trees"
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)


# ------------------------------------------------------------ landmarks

func _stone_mat(c: Color) -> ShaderMaterial:
	# the buildings' lit-wall look on a plain stone texture (no windows), so a monument sits in the same light
	var img := Image.create(4, 4, false, Image.FORMAT_RGB8)
	img.fill(c)
	img.generate_mipmaps()
	var sm := ShaderMaterial.new()
	sm.shader = FACADE
	sm.set_shader_parameter("atlas", ImageTexture.create_from_image(img))
	sm.set_shader_parameter("roof_dark", 0.95)
	sm.set_shader_parameter("lift", 0.12)   # env-fixes 2: was 0.2 (flat, no shadow side); the landmark faces the camera, often in shade
	if _hemi.is_valid():
		_hemi.call(sm, _look)
	return sm


func _build_landmarks(marks: Array) -> void:
	var stone := _stone_mat(Color(0.74, 0.7, 0.62))
	var granite := _stone_mat(Color(0.6, 0.59, 0.6))   # env-fixes 2: was (0.5, 0.5, 0.54), a blue-black slab in shade
	# env-fixes 2 (audit issue 13a): the bronze was albedo 0.2 with metallic 0.4 and no sky to reflect,
	# so it drew black. Now a lit bronze on the facade shader (its hemisphere ambient and a little lift).
	var bronze := _stone_mat(Color(0.45, 0.33, 0.22))
	bronze.set_shader_parameter("lift", 0.1)
	bronze.set_shader_parameter("roof_dark", 0.85)
	var water := _flat_mat(Color(0.35, 0.6, 0.85))
	water.emission_enabled = true
	water.emission = Color(0.12, 0.25, 0.4)
	var st_stone := SurfaceTool.new()
	st_stone.begin(Mesh.PRIMITIVE_TRIANGLES)
	var st_granite := SurfaceTool.new()
	st_granite.begin(Mesh.PRIMITIVE_TRIANGLES)
	var st_bronze := SurfaceTool.new()
	st_bronze.begin(Mesh.PRIMITIVE_TRIANGLES)
	var st_water := SurfaceTool.new()
	st_water.begin(Mesh.PRIMITIVE_TRIANGLES)
	var counts: Dictionary = {}
	for m: Variant in marks:
		var d: Dictionary = m
		var p: Vector2 = to_fight(Vector2(float(d["x"]), float(d["z"])))
		if p.length() > REACH:
			continue
		var kind: String = str(d["kind"])
		var h: float = float(d["h"])
		var r: float = float(d.get("r", 0.0))
		if CLEAR.has_point(p) and kind != "monument":
			continue
		var at := Vector3(p.x, 0.0, p.y)
		match kind:
			"column", "obelisk":
				if h >= 20.0:
					_column(st_stone, st_granite, st_bronze, at, h, kind == "obelisk")
				else:
					_statue(st_granite, st_bronze, at, h)
			"monument":
				if h >= 20.0:
					_column(st_stone, st_granite, st_bronze, at, h, false)
				elif r > 3.0:
					# a monument's platform (its steps), clear of the fight
					if not Rect2(p - Vector2(r, r) * 0.45, Vector2(r, r) * 0.9).intersects(CLEAR):
						_add(st_granite, _box(Vector3(r * 0.9, 0.7, r * 0.9)), at + Vector3(0, 0.35, 0))
				else:
					_statue(st_granite, st_bronze, at, h)
			"statue":
				_statue(st_granite, st_bronze, at, h)
			"fountain":
				var rr: float = r if r > 0.5 else 1.6
				_fountain(st_stone, st_water, at, rr)
		counts[kind] = int(counts.get(kind, 0)) + 1
	info["landmarks"] = counts
	_add_mesh(st_stone.commit(), stone, "landmarks_stone")
	_add_mesh(st_granite.commit(), granite, "landmarks_granite")
	_add_mesh(st_bronze.commit(), bronze, "landmarks_bronze")
	_add_mesh(st_water.commit(), water, "landmarks_water")


func _add(st: SurfaceTool, mesh: PrimitiveMesh, at: Vector3, basis: Basis = Basis()) -> void:
	st.append_from(mesh, 0, Transform3D(basis, at))


func _box(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


func _cyl(r_top: float, r_bottom: float, h: float, seg: int = 12) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = r_top
	c.bottom_radius = r_bottom
	c.height = h
	c.radial_segments = seg
	c.rings = 1
	return c


## A tall column on its pedestal, with a capital and a figure on top (Nelson's Column is 51.6 m).
func _column(st: SurfaceTool, granite: SurfaceTool, bronze: SurfaceTool, at: Vector3, h: float, obelisk: bool) -> void:
	var ped: float = h * 0.2
	_add(granite, _box(Vector3(h * 0.16, ped * 0.25, h * 0.16)), at + Vector3(0, ped * 0.125, 0))
	_add(granite, _box(Vector3(h * 0.12, ped * 0.75, h * 0.12)), at + Vector3(0, ped * 0.25 + ped * 0.375, 0))
	# env-fixes 2: the pedestal's bronze reliefs are no longer drawn as solid blocks (they read as
	# black squares); a landmark kit (audit fix 6b) brings them back as real reliefs
	if obelisk:
		_add(st, _cyl(h * 0.02, h * 0.05, h - ped, 4), at + Vector3(0, ped + (h - ped) * 0.5, 0))
		return
	var shaft: float = h * 0.68
	_add(st, _cyl(h * 0.028, h * 0.034, shaft, 16), at + Vector3(0, ped + shaft * 0.5, 0))
	_add(bronze, _box(Vector3(h * 0.085, h * 0.03, h * 0.085)), at + Vector3(0, ped + shaft + h * 0.015, 0))
	_add(st, _cyl(h * 0.03, h * 0.03, h * 0.035, 12), at + Vector3(0, ped + shaft + h * 0.047, 0))
	var fig: float = h - (ped + shaft + h * 0.065)
	_add(st, _cyl(h * 0.012, h * 0.016, fig, 8), at + Vector3(0, h - fig * 0.5, 0))


## A figure on a plinth (the lions and the statues round a square).
func _statue(st: SurfaceTool, bronze: SurfaceTool, at: Vector3, h: float) -> void:
	var hh: float = clampf(h, 2.5, 12.0)
	var plinth: float = hh * 0.5
	_add(st, _box(Vector3(maxf(1.6, hh * 0.45), plinth, maxf(1.6, hh * 0.45))), at + Vector3(0, plinth * 0.5, 0))
	_add(bronze, _cyl(hh * 0.07, hh * 0.1, hh * 0.42, 8), at + Vector3(0, plinth + hh * 0.21, 0))
	var head := SphereMesh.new()
	head.radius = hh * 0.07
	head.height = hh * 0.14
	head.radial_segments = 8
	head.rings = 4
	_add(bronze, head, at + Vector3(0, plinth + hh * 0.47, 0))


## A round basin with water in it and a jet in the middle.
func _fountain(st: SurfaceTool, water: SurfaceTool, at: Vector3, r: float) -> void:
	_add(st, _cyl(r, r + 0.15, 0.7, 20), at + Vector3(0, 0.35, 0))
	_add(water, _cyl(r - 0.25, r - 0.25, 0.08, 20), at + Vector3(0, 0.72, 0))
	_add(st, _cyl(r * 0.18, r * 0.24, 1.6, 10), at + Vector3(0, 1.2, 0))
	_add(water, _cyl(0.06, r * 0.12, 2.6, 8), at + Vector3(0, 3.2, 0))
