extends RefCounted
## look-world (audit issues 14, 15; art direction 4.6, 4.8): a place dressed like a real street.
##  - Along every car road, on the pavement: street lamps every ~25 m (the region's: UK swan-neck, US
##    cobra-head, Lagos solar pole), bins, benches, US hydrants; traffic lights at the busy junctions;
##    Belisha beacons at UK zebras; a few UK post and phone boxes; parked cars along the kerbs.
##  - Round the squares: bollards where a square meets a road, lamps, benches and planters inside.
##  - Trees: OpenStreetMap's mapped trees, each a species of the place's climate (world_props.gd species),
##    plus street trees where a residential street has none mapped.
##  - Roof clutter on flat roofs (AC units, vents, NY water tanks, UK chimney stacks, Lagos tanks and dishes).
## Everything is a MultiMesh per kit mesh (one draw per surface), placed with a fixed hash of its spot (the
## same city every fight; no draw from the fight's random numbers). A spot is refused when it is in a
## building, on a road, in water, near a landmark or in the fight's clear zone.

const Props := preload("res://world_props.gd")
const REACH: float = 260.0   # place.gd REACH

var _xf: Dictionary = {}      # mesh key "kind:variant" -> [Transform3D]
var _cast: Dictionary = {}
var _p: Node3D
var _roads: RefCounted
var _bake: RefCounted
var _clear: Rect2
var _frontage: float = 0.0
var _count: Dictionary = {}


static func h01(v: Vector2, salt: float = 0.0) -> float:
	return fposmod(sin(v.x * 12.9898 + v.y * 78.233 + salt * 37.719) * 43758.5453, 1.0)


## How far from the fight each kind is placed (metres): beyond it the prop is a few pixels in the fog and
## its triangles are wasted (the art direction's 350 k visible-triangle budget).
const KIND_REACH: Dictionary = {"bollard": 80.0, "bin": 90.0, "bench": 90.0, "hydrant_us": 80.0, "planter": 100.0,
	"post_box_uk": 100.0, "phone_box_uk": 110.0, "bus_stop": 110.0, "belisha": 120.0,
	"lamp_uk": 115.0, "lamp_us": 125.0, "lamp_lagos": 115.0, "traffic_light_uk": 120.0, "traffic_light_us": 130.0}
# day1-world: lamps and signals 10 m nearer (Trafalgar's device frame was 351 k primitives, budget 350 k)


func _put(kind: String, variant: int, p: Vector2, yaw: float, scale: float = 1.0, cast: bool = true) -> void:
	if _real and REAL_SWAP.has(kind):
		_put_photo(REAL_SWAP[kind], p, yaw)
		return
	if p.length() > float(KIND_REACH.get(kind, 180.0)):
		return
	var key: String = "%s:%d" % [kind, variant]
	if not _xf.has(key):
		_xf[key] = []
		_cast[key] = cast
	(_xf[key] as Array).append(Transform3D(Basis(Vector3.UP, yaw).scaled(Vector3.ONE * scale), Vector3(p.x, 0.0, p.y)))
	_count[kind] = int(_count.get(kind, 0)) + 1


## A spot on the pavement a prop may stand on.
func free_spot(p: Vector2, tall: bool = false, margin: float = 0.4) -> bool:
	if p.length() > REACH - 10.0:
		return false
	if _clear.grow(1.5 if tall else 0.5).has_point(p):
		return false
	var r: Array = _roads.call("nearest", p)
	if float(r[0]) < margin:
		return false
	if bool(_p.call("in_building", p, margin)) or bool(_p.call("in_water", p)) or bool(_p.call("near_landmark", p, 1.5)):
		return false
	return true


func build(p: Node3D, ground: Dictionary) -> void:
	_p = p
	_roads = p.get("_roads")
	_bake = p.get("bake")
	_clear = p.get("clear")
	_real_mode(p)
	if _real:
		_real_mats()
	var region: String = p.get("region")
	var lamp: String = {"uk": "lamp_uk", "us_east": "lamp_us", "us_west": "lamp_us", "west_africa": "lamp_lagos"}.get(region, "lamp_uk")
	var us: bool = region.begins_with("us")
	var uk: bool = region == "uk"
	_along_roads(lamp, us, uk, region)
	_squares(lamp)
	_junctions(us, uk)
	if uk:
		for c: Array in _roads.get("crossings"):
			var at: Vector2 = c[0]
			var nrm := Vector2(-(c[1] as Vector2).y, (c[1] as Vector2).x)
			for s: float in [-1.0, 1.0]:
				var q: Vector2 = at + nrm * s * (float(c[2]) + 0.6)
				if free_spot(q, true, 0.2):
					_put("belisha", 0, q, 0.0)
					_bake.call("post", q, 2.8, 0.1)
	_trees(ground)
	_roof_clutter(region)
	if _real:
		_real_cars(region)
		_real_frontage()
		_real_pools()
	else:
		_parked_cars(region)
	for key: String in _xf:
		var kv: PackedStringArray = key.split(":")
		var mesh: ArrayMesh = p.call("kit", kv[0], int(kv[1]))
		p.call("add_multi", mesh, _xf[key], "props_" + key.replace(":", "_"), bool(_cast[key]))
	if _real:
		_real_kit()
		_emit_real()
	var info: Dictionary = p.get("info")
	info["props"] = _count
	var n_street: int = 0
	for k: String in _count:
		if not k.begins_with("tree_") and not k in ["ac_unit", "vent", "water_tank_us", "chimney_uk", "dish", "water_tank_lagos", "roof_plant"]:
			n_street += int(_count[k])
	info["props_per_100m_frontage"] = snappedf(100.0 * n_street / maxf(1.0, _frontage), 0.1)


## Walks both pavements of every car road (inside the reach) placing the street furniture.
func _along_roads(lamp: String, us: bool, uk: bool, region: String) -> void:
	var lamp_h: float = float(Props.info(lamp).get("h", 5.0))
	for rd: Dictionary in _roads.get("roads"):
		var line: PackedVector2Array = rd["p"]
		var hw: float = rd["hw"]
		if str(rd["d"]) == "service" and hw < 2.5:
			continue
		var t: float = 0.0
		for i in line.size() - 1:
			var a: Vector2 = line[i]
			var b: Vector2 = line[i + 1]
			var len: float = a.distance_to(b)
			if len < 0.5:
				continue
			var d: Vector2 = (b - a) / len
			var nrm := Vector2(-d.y, d.x)
			var s: float = fposmod(-t, 3.0)
			while s < len:
				var c: Vector2 = a + d * s
				var slot: int = int(round((t + s) / 3.0))
				if c.length() < REACH - 20.0:
					_frontage += 6.0      # both sides, 3 m a slot
				for side: float in [-1.0, 1.0]:
					var face: float = atan2(-side * nrm.x, -side * nrm.y)   # +z towards the road
					var off: float = hw + 0.9
					var q: Vector2 = c + nrm * side * off
					var hv: float = h01(q, slot)
					if (slot + (0 if side > 0.0 else 4)) % 8 == 0:
						if free_spot(q, true) and not bool(_roads.call("near_junction", q, hw + 3.0)):
							_put(lamp, 0, q, face)
							_bake.call("post", q, lamp_h)
							_lamp_heads.append(Transform3D(Basis(Vector3.UP, face), Vector3(q.x, 0, q.y)) * (Props.info(lamp).get("light_at", Vector3(0, lamp_h, 0)) as Vector3))
					elif hv < 0.07:
						var q2: Vector2 = c + nrm * side * (hw + 1.4)
						if free_spot(q2):
							_put("bin", 0, q2, face)
							_bake.call("blob", q2, 0.35, 1.0)
					elif hv < 0.1:
						var q3: Vector2 = c + nrm * side * (hw + 2.2)
						if free_spot(q3, false, 0.6):
							_put("bench", 0, q3, face)
							_bake.call("blob", q3, 0.8, 0.8)
					elif us and hv < 0.13:
						var q4: Vector2 = c + nrm * side * (hw + 0.7)
						if free_spot(q4, false, 0.2):
							_put("hydrant_us", 0, q4, face)
					elif uk and hv > 0.995:
						var q5: Vector2 = c + nrm * side * (hw + 1.6)
						if free_spot(q5, false, 0.6):
							_put("phone_box_uk" if hv > 0.9975 else "post_box_uk", 0, q5, face)
							_bake.call("blob", q5, 0.6, 2.4)
					elif region == "west_africa" and hv > 0.985:
						var q6: Vector2 = c + nrm * side * (hw + 1.8)
						if free_spot(q6, false, 0.6):
							_put("bus_stop", 0, q6, face)
				s += 3.0
			t += len


var _lamp_heads: Array = []


## Squares: bollards on the edges that meet a road, lamps, benches and planters inside.
func _squares(lamp: String) -> void:
	var lamp_h: float = float(Props.info(lamp).get("h", 5.0))
	for poly: PackedVector2Array in _p.get("_paved_polys"):
		var area: float = absf(_p.call("_area", poly))
		for i in poly.size():
			var a: Vector2 = poly[i]
			var b: Vector2 = poly[(i + 1) % poly.size()]
			var len: float = a.distance_to(b)
			if len < 1.0:
				continue
			var d: Vector2 = (b - a) / len
			var s: float = 0.8
			while s < len - 0.8:
				var q: Vector2 = a + d * s
				var r: Array = _roads.call("nearest", q)
				if float(r[0]) > 0.3 and float(r[0]) < 2.5 and free_spot(q, false, 0.3):
					_put("bollard", 0, q, 0.0)
				s += 1.7
		if area < 150.0:
			continue
		# inside: a loose grid of furniture
		var box := Rect2(poly[0], Vector2.ZERO)
		for q: Vector2 in poly:
			box = box.expand(q)
		var step: float = 11.0
		var y: float = box.position.y + step * 0.5
		while y < box.end.y:
			var x: float = box.position.x + step * 0.5
			while x < box.end.x:
				var q := Vector2(x, y) + Vector2(h01(Vector2(x, y), 1.0) - 0.5, h01(Vector2(x, y), 2.0) - 0.5) * 4.0
				if Geometry2D.is_point_in_polygon(q, poly) and free_spot(q, true, 1.0):
					var hv: float = h01(q, 3.0)
					var yaw: float = hv * TAU
					if hv < 0.22:
						_put(lamp, 0, q, yaw)
						_bake.call("post", q, lamp_h)
					elif hv < 0.42:
						_put("bench", 0, q, yaw)
						_bake.call("blob", q, 0.8, 0.8)
					elif hv < 0.55:
						_put("planter", 0, q, yaw)
						_bake.call("blob", q, 0.8, 1.2)
					elif hv < 0.6:
						_put("bin", 0, q, yaw)
				x += step
			y += step


func _junctions(us: bool, uk: bool) -> void:
	var kind: String = "traffic_light_us" if us else "traffic_light_uk"
	var h: float = float(Props.info(kind).get("h", 3.3))
	var n: int = 0
	for j: Array in _roads.get("junctions"):
		var at: Vector2 = j[0]
		if at.length() > 180.0 or int(j[1]) < 3:
			continue
		var r: Array = _roads.call("nearest", at)
		if int(r[1]) < 0:
			continue
		var rd: Dictionary = (_roads.get("roads") as Array)[int(r[1])]
		if not str(rd["k"]) in ["major_road", "medium_road", "highway"]:
			continue
		# a light on two opposite corners, turned to the junction
		for k in 4:
			if k % 2 == 1 and h01(at, k) < 0.5:
				continue
			var ang: float = TAU * (k + 0.5) / 4.0 + h01(at) * 0.6
			var q: Vector2 = at + Vector2(cos(ang), sin(ang)) * (float(rd["hw"]) + 1.6)
			for tries in 4:
				if free_spot(q, true, 0.3):
					break
				q = at + Vector2(cos(ang), sin(ang)) * (float(rd["hw"]) + 2.4 + tries * 1.2)
			if free_spot(q, true, 0.3):
				var to: Vector2 = at - q
				_put(kind, 0, q, atan2(to.x, to.y))
				_bake.call("post", q, h)
				n += 1
	_p.get("info")["traffic_lights"] = n


func _tree_kind(sp: Array, p: Vector2) -> String:
	return str(sp[int(h01(p, 5.0) * 97.0) % sp.size()])


func _trees(ground: Dictionary) -> void:
	var climate: String = _p.get("climate")
	var sp: Array = Props.species(climate)
	if sp.is_empty():
		return
	var spots: Array = []
	for t: Variant in ground.get("trees", []):
		var a: Array = t
		var q: Vector2 = _p.call("to_fight", Vector2(float(a[0]), float(a[1])))
		if q.length() > 210.0 or _clear.grow(-1.0).has_point(q):
			continue
		spots.append([q, clampf(float(a[2]), 0.6, 1.8)])
	# street trees where residential and minor streets have none mapped (most of the world maps few)
	var region: String = _p.get("region")
	if region != "us_east":
		for rd: Dictionary in _roads.get("roads"):
			if not str(rd["k"]) in ["minor_road", "medium_road"] or str(rd["d"]) == "service":
				continue
			var line: PackedVector2Array = rd["p"]
			for i in line.size() - 1:
				var a: Vector2 = line[i]
				var b: Vector2 = line[i + 1]
				var len: float = a.distance_to(b)
				var d: Vector2 = (b - a) / maxf(0.01, len)
				var s: float = 6.0
				while s < len - 4.0:
					for side: float in [-1.0, 1.0]:
						var q: Vector2 = a + d * s + Vector2(-d.y, d.x) * side * (float(rd["hw"]) + 2.0)
						if h01(q, 7.0) < 0.45 and q.length() < 170.0 and free_spot(q, true, 1.2) and not _tree_near(spots, q, 7.0):
							spots.append([q, 0.8 + h01(q, 8.0) * 0.4])
					s += 13.0
	var n: int = 0
	for s: Array in spots:
		var q: Vector2 = s[0]
		if bool(_p.call("in_building", q, 0.3)):
			continue
		if _real and _clear.has_point(q):
			continue    # fid29: on the real look no trunk stands inside the fighters' clear ground at all
		var kind: String = _tree_kind(sp, q)
		var variant: int = int(h01(q, 9.0) * 2.0)
		var sc: float = float(s[1]) * (0.85 + h01(q, 11.0) * 0.3)
		if _real and kind in TEMPERATE_BROADLEAF:
			# fid29: the London plane (tools/props/tree_blender.py) for every temperate broadleaf, at the kit's height
			_put_photo("plane", q, h01(q, 12.0) * TAU, sc * float(Props.info("tree_london_plane").get("h", 14.0)) / PLANE_H)
		else:
			_put(kind, variant, q, h01(q, 12.0) * TAU, sc, true)
		var inf: Dictionary = Props.info(kind)
		_bake.call("tree", q, float(inf.get("h", 10.0)) * sc, float(inf.get("r", 4.0)) * sc)
		n += 1
	_p.get("info")["trees"] = n


static func _tree_near(spots: Array, q: Vector2, r: float) -> bool:
	for s: Array in spots:
		if (s[0] as Vector2).distance_to(q) < r:
			return true
	return false


func _roof_clutter(region: String) -> void:
	var kinds: Dictionary = {
		"uk": ["chimney_uk", "chimney_uk", "ac_unit", "vent"],
		"us_east": ["water_tank_us", "ac_unit", "vent", "ac_unit"],
		"us_west": ["ac_unit", "vent", "ac_unit", "dish"],
		"west_africa": ["water_tank_lagos", "dish", "ac_unit", "water_tank_lagos"],
		"generic": ["ac_unit", "vent", "chimney_uk", "ac_unit"],
	}
	var ks: Array = kinds.get(region, kinds["generic"])
	for r: Array in _p.get_meta("roofs", []):
		var poly: PackedVector2Array = r[0]
		var h: float = r[1]
		var sheet: String = r[2]
		var area: float = r[3]
		if area < 40.0 or _p.call("_poly_centre", poly).length() > 120.0:
			continue
		var box := Rect2(poly[0], Vector2.ZERO)
		for q: Vector2 in poly:
			box = box.expand(q)
		var want: int = clampi(int(area / 140.0) + 1, 1, 6)
		if sheet == "trim_us_modern":
			ks = ["roof_plant", "ac_unit", "vent", "ac_unit"]
		elif region == "us_east" and h > 45.0:
			ks = ["ac_unit", "vent", "ac_unit", "vent"]
		else:
			ks = kinds.get(region, kinds["generic"])
		var placed: int = 0
		for tries in want * 4:
			if placed >= want:
				break
			var q := Vector2(lerpf(box.position.x, box.end.x, h01(poly[0], tries * 2.0)), lerpf(box.position.y, box.end.y, h01(poly[0], tries * 2.0 + 1.0)))
			if not Geometry2D.is_point_in_polygon(q, poly):
				continue
			var edge: float = INF
			for i in poly.size():
				edge = minf(edge, Geometry2D.get_closest_point_to_segment(q, poly[i], poly[(i + 1) % poly.size()]).distance_to(q))
			var k: String = ks[(placed + int(h01(q) * 4.0)) % ks.size()]
			if k == "chimney_uk" and (h > 20.0 or placed >= 2):
				k = "vent"
			var need: float = float(Props.info(k).get("r", 1.0)) + 0.4
			if k == "chimney_uk":
				need = 0.6
			if edge < need:
				continue
			var xf := Transform3D(Basis(Vector3.UP, h01(q, 4.0) * TAU), Vector3(q.x, h, q.y))
			var key: String = "%s:%d" % [k, int(h01(q, 6.0) * 2.0)]
			if not _xf.has(key):
				_xf[key] = []
				_cast[key] = false
			(_xf[key] as Array).append(xf)
			_count[k] = int(_count.get(k, 0)) + 1
			placed += 1


## Parked cars (Kenney Car Kit, scaled to 4.5 m) along the kerbs of the quieter roads.
const CARS: Array[String] = ["cars/sedan", "cars/hatchback-sports", "cars/suv", "cars/van", "cars/taxi", "cars/delivery"]


func _parked_cars(region: String) -> void:
	var left: bool = region == "uk"
	var groups: Dictionary = {}
	for rd: Dictionary in _roads.get("roads"):
		var hw: float = rd["hw"]
		if not str(rd["k"]) in ["minor_road", "medium_road", "major_road"] or hw < 2.8 or str(rd["d"]) == "service":
			continue
		var line: PackedVector2Array = rd["p"]
		for i in line.size() - 1:
			var a: Vector2 = line[i]
			var b: Vector2 = line[i + 1]
			var len: float = a.distance_to(b)
			var d: Vector2 = (b - a) / maxf(0.01, len)
			var nrm := Vector2(-d.y, d.x)
			var s: float = 3.0
			while s < len - 3.0:
				for side: float in [-1.0, 1.0]:
					var q: Vector2 = a + d * s + nrm * side * (hw - 1.15)
					var hv: float = h01(q, 21.0)
					if hv > 0.42 or q.length() > 100.0 or _clear.grow(2.0).has_point(q):
						continue
					if bool(_roads.call("near_junction", q, hw + 9.0)) or bool(_p.call("in_building", q, 0.5)):
						continue
					# cars face the way the traffic on their side drives
					var fwd: Vector2 = d * (side if left else -side) * -1.0
					var model: String = CARS[int(hv * 1000.0) % CARS.size()]
					if region == "us_east" and hv < 0.12:
						model = "cars/taxi"
					if not groups.has(model):
						groups[model] = []
					(groups[model] as Array).append(Transform3D(Basis(Vector3.UP, atan2(fwd.x, fwd.y)), Vector3(q.x, 0.0, q.y)))
					_bake.call("blob", q, 1.6, 1.0)
				s += 6.2
	var n: int = 0
	for model: String in groups:
		# day1-world: the car's mesh (a Kenney GLB merged once, cached for the next fight) and its node are made
		# on the main thread (place.gd _emit): merging reads the GLB's surfaces back from the RenderingServer
		_p.call("_emit", Callable(_p, "mk_cars").bind(model, groups[model]))
		n += (groups[model] as Array).size()
	_p.get("info")["parked_cars"] = n


## A Kenney car as one mesh (its own atlas material, opaque) and the transform that stands it 4.5 m long
## on y = 0, nose to +z. Cached on the place.
static var _car_cache: Dictionary = {}


static func car_mesh(_p: Node3D, model: String) -> Array:
	var cache: Dictionary = _car_cache
	if cache.has(model):
		return cache[model]
	var ps: PackedScene = load("res://art/city/%s.glb" % model)
	if ps == null:
		return []
	var inst: Node3D = ps.instantiate() as Node3D
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var mat: Material = null
	var box := AABB()
	var first: bool = true
	for node: Node in inst.find_children("*", "MeshInstance3D", true, false):
		var mi := node as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf: Transform3D = Transform3D.IDENTITY
		var q: Node = mi
		while q != null and q != inst:
			if q is Node3D:
				xf = (q as Node3D).transform * xf
			q = q.get_parent()
		for si in mi.mesh.get_surface_count():
			if mat == null:
				mat = mi.get_active_material(si)
			st.append_from(mi.mesh, si, xf)
		var bb: AABB = xf * mi.get_aabb()
		box = bb if first else box.merge(bb)
		first = false
	inst.free()
	var mesh: ArrayMesh = st.commit()
	if mat is BaseMaterial3D:
		var m := (mat as BaseMaterial3D).duplicate() as BaseMaterial3D
		m.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
		m.roughness = 0.55
		mesh.surface_set_material(0, m)
	var long_z: bool = box.size.z >= box.size.x
	var s: float = 4.5 / maxf(0.01, maxf(box.size.x, box.size.z))
	var rot := Basis() if long_z else Basis(Vector3.UP, PI * 0.5)
	var c: Vector3 = box.get_center()
	var xf2 := Transform3D(rot.scaled(Vector3.ONE * s), Vector3.ZERO) * Transform3D(Basis(), Vector3(-c.x, -box.position.y, -c.z))
	var out: Array = [mesh, xf2]
	cache[model] = out
	return out


# ------------------------------------------------------------------ fid29: real street furniture (mid and high)
## fid29 (dressing, docs/game3d/fid29/dressing.md): on the mid and high tiers (look "real", unless the look says
## "fid_dressing": false) the street gets photo-scanned furniture (Poly Haven, CC0, decimated to two LODs in
## tools/props) and London planes instead of the toy art: no Kenney cars (a few covered cars, road barriers at the
## junction approaches), Victorian lamp posts, painted benches, planter boxes, bin bags, street cabinets, A-boards
## and cafe sets at the shop fronts, wall lanterns, and the kit (landmarks, the procedural props that stay) shaded
## for real (world_kit.gdshader real_k). The low tier never runs any of this: its places are byte for byte build 28's.
## Placement uses free_spot (never in the fighters' clear ground) and fixed hashes of the spot (no draw from the
## fight's random numbers). Each kind is instanced per 24 m cell and LOD (out-of-view cells cull); on high, the
## props within SHADOW_R of the fight also cast into the shadow map (their own shadow-only MultiMesh).

const PROPS_DIR := "res://art/world/props/"
const TREES_DIR := "res://art/world/trees/"
const PROP_SHADER := preload("res://vfx/world_prop.gdshader")
const LookRealScript := preload("res://look_real.gd")
const ShaderWarmScript := preload("res://shader_warm.gd")
const CELL: float = 24.0
const SHADOW_R: float = 12.0
## LOD0 within these metres of the fight on high (mid draws LOD1 and the tree impostor everywhere)
const LOD0_R: float = 34.0
const TREE_LOD0_R: float = 64.0
## the kit kinds a real place swaps for a photo prop
const REAL_SWAP: Dictionary = {"lamp_uk": "street_lamp_01", "bench": "painted_wooden_bench", "planter": "planter_box_01"}
## photo props: yaw (radians) that turns the scan's front to the kit's +z, how far from the fight it is placed
const PHOTO: Dictionary = {
	"street_lamp_01": {"yaw": 0.0, "reach": 115.0}, "painted_wooden_bench": {"yaw": 0.0, "reach": 90.0},
	"planter_box_01": {"yaw": 0.0, "reach": 90.0}, "covered_car": {"yaw": 0.0, "reach": 100.0},
	"concrete_road_barrier": {"yaw": 0.0, "reach": 90.0}, "trashbag": {"yaw": 0.0, "reach": 70.0},
	"utility_box_01": {"yaw": 0.0, "reach": 80.0}, "utility_box_02": {"yaw": 0.0, "reach": 80.0},
	"standing_chalkboard_01": {"yaw": 0.0, "reach": 70.0}, "outdoor_table_chair_set_01": {"yaw": 0.0, "reach": 70.0},
	"street_lamp_02": {"yaw": PI * 0.5, "reach": 90.0}, "security_light": {"yaw": 0.0, "reach": 70.0},
	"plane": {"yaw": 0.0, "reach": 210.0},
}
## kit classes on the real look: [kit_real detail, roughness, metal, detail weight]
const KIT_REAL: Dictionary = {
	"paint": ["props_noise", 0.45, 0.0, 0.3], "stone": ["stone", 0.82, 0.0, 0.7], "granite": ["stone", 0.6, 0.0, 0.6],
	"render": ["stone", 0.8, 0.0, 0.6], "bronze": ["metal_rough", 0.42, 1.0, 0.35], "gilt": ["metal_rough", 0.3, 1.0, 0.2],
	"bark": ["props_noise", 0.9, 0.0, 0.5], "foliage": ["foliage", 0.75, 0.0, 0.5], "tile": ["props_noise", 0.55, 0.0, 0.4],
	"slate": ["metal_rough", 0.5, 0.0, 0.35], "glass": ["props_noise", 0.08, 0.0, 0.0], "glow": ["props_noise", 0.3, 0.0, 0.0],
}
const NEAR_DRESS_R: float = 45.0
const NEAR_DRESS_K: float = 2.2
const TEMPERATE_BROADLEAF: Array[String] = ["tree_london_plane", "tree_lime", "tree_oak"]
const PLANE_H: float = 16.8    # the plane mesh's height (tree_blender.py, plane.json dims)

var _real: bool = false
var _high: bool = false
var _px: Dictionary = {}        # photo kind -> [Transform3D]
var _prop_mat: Material
var _leaf_mat: Material
var _imp_mat: Material


## Which look this place has: mid and high (look "real") get the real dressing unless the look turns it off.
func _real_mode(p: Node3D) -> void:
	var lk: Dictionary = p.get("_look")
	_real = bool(lk.get("real", false)) and bool(lk.get("fid_dressing", false))
	_high = _real and str(lk.get("skin", "")) == "full"


func _put_photo(kind: String, p: Vector2, yaw: float, scale: float = 1.0, y: float = 0.0) -> void:
	var inf: Dictionary = PHOTO.get(kind, {})
	if p.length() > float(inf.get("reach", 90.0)):
		return
	if not _px.has(kind):
		_px[kind] = []
	var b := Basis(Vector3.UP, yaw + float(inf.get("yaw", 0.0))).scaled(Vector3.ONE * scale)
	(_px[kind] as Array).append(Transform3D(b, Vector3(p.x, y, p.y)))
	_count[kind] = int(_count.get(kind, 0)) + 1


## The shop front behind a pavement spot: marches from `q` along `out` (unit, away from the road) until a building,
## up to `max_d` metres. Returns the facade point, or null.
func _facade(q: Vector2, out: Vector2, max_d: float = 7.0) -> Variant:
	var d: float = 0.0
	while d < max_d:
		if bool(_p.call("in_building", q + out * d, 0.0)):
			return q + out * maxf(0.0, d - 0.25)
		d += 0.5
	return null


## Shop-front dressing along a frontage sample: A-boards, cafe sets, cabinets against the wall, bin bags, wall
## lanterns and security lights. `f` is the facade point, `out` points from the street into the building.
func _front_props(f: Vector2, out: Vector2, depth: float, salt: float) -> void:
	var face: float = atan2(-out.x, -out.y)     # +z away from the wall, towards the street
	# near the fight (in the frames' top band and the victory shot's background) the frontage is busier: a shop front
	# within NEAR_DRESS_R m gets a piece of furniture about twice as often
	var hv: float = h01(f, salt) / (NEAR_DRESS_K if f.length() < NEAR_DRESS_R else 1.0)
	var along := Vector2(-out.y, out.x)
	if hv < 0.05 and depth > 2.2:
		var q: Vector2 = f - out * 0.9
		if free_spot(q, false, 0.25):
			_put_photo("standing_chalkboard_01", q, face + (h01(f, salt + 1.0) - 0.5) * 0.5)
			_bake.call("blob", q, 0.45, 0.6)
	elif hv < 0.085 and depth > 3.0:
		var q: Vector2 = f - out * 1.35
		if free_spot(q, false, 0.6):
			_put_photo("outdoor_table_chair_set_01", q, face + PI * 0.5 + (h01(f, salt + 2.0) - 0.5) * 0.6)
			_bake.call("blob", q, 1.0, 0.7)
	elif hv < 0.115:
		var q: Vector2 = f - out * 0.3
		if free_spot(q, false, 0.0) or not bool(_p.call("in_building", q, 0.0)) and not _clear.grow(0.5).has_point(q):
			_put_photo("utility_box_02" if h01(f, salt + 3.0) < 0.6 else "utility_box_01", q, face)
			_bake.call("blob", q, 0.6, 1.2)
	elif hv < 0.15:
		var c: Vector2 = f - out * 0.45
		if free_spot(c, false, 0.0) or not bool(_p.call("in_building", c, 0.0)) and not _clear.grow(0.8).has_point(c):
			var n: int = 2 + int(h01(f, salt + 4.0) * 3.0)
			for i in n:
				var q: Vector2 = c + along * (float(i) - n * 0.5) * 0.42 + out * (h01(f, salt + 5.0 + i) - 0.5) * 0.25
				_put_photo("trashbag", q, h01(q, 6.0) * TAU, 0.9 + h01(q, 7.0) * 0.25)
			_bake.call("blob", c, 0.9, 0.9)
	elif hv < 0.19:
		# a lantern on its bracket over the shop door (wall-mounted: only the clear zone is checked)
		var q: Vector2 = f + out * 0.05
		if not _clear.grow(1.0).has_point(q) and q.length() < REACH - 10.0:
			_put_photo("street_lamp_02", q, face, 1.0, 2.55)
	elif hv < 0.205:
		var q: Vector2 = f + out * 0.05
		if not _clear.grow(1.0).has_point(q) and q.length() < REACH - 10.0:
			_put_photo("security_light", q, face, 1.0, 3.1)


## Walks the frontages: both pavements of every car road, and the edges of paved pedestrian areas that meet a
## building (the default street's shopping street is one).
func _real_frontage() -> void:
	for rd: Dictionary in _roads.get("roads"):
		var line: PackedVector2Array = rd["p"]
		var hw: float = rd["hw"]
		if str(rd["d"]) == "service" or str(rd["k"]) == "path":
			continue
		for i in line.size() - 1:
			var a: Vector2 = line[i]
			var b: Vector2 = line[i + 1]
			var len: float = a.distance_to(b)
			if len < 1.0:
				continue
			var d: Vector2 = (b - a) / len
			var nrm := Vector2(-d.y, d.x)
			var s: float = 1.5
			while s < len:
				for side: float in [-1.0, 1.0]:
					var out: Vector2 = nrm * side
					var q: Vector2 = a + d * s + out * (hw + 0.6)
					if q.length() > 95.0:
						continue
					var f: Variant = _facade(q, out)
					if f != null:
						_front_props(f, out, (f as Vector2).distance_to(q) + 0.6, 40.0 + side)
				s += 3.0
	for poly: PackedVector2Array in _p.get("_paved_polys"):
		for i in poly.size():
			var a: Vector2 = poly[i]
			var b: Vector2 = poly[(i + 1) % poly.size()]
			var len: float = a.distance_to(b)
			if len < 2.0:
				continue
			var d: Vector2 = (b - a) / len
			var nrm := Vector2(-d.y, d.x)
			var mid: Vector2 = (a + b) * 0.5
			var out: Vector2 = nrm if not Geometry2D.is_point_in_polygon(mid + nrm * 0.3, poly) else -nrm
			var s: float = 1.5
			while s < len - 1.0:
				var q: Vector2 = a + d * s - out * 0.2
				if q.length() < 95.0 and bool(_p.call("in_building", q + out * 0.6, 0.0)):
					_front_props(q, out, 4.0, 50.0)
				s += 3.0


## Squares with a fountain pool (Trafalgar Square's two): Victorian lamp standards round the pool's rim every
## POOL_LAMP_STEP m and a painted bench facing the water between every other pair, as real squares are furnished. Only
## pools (a water polygon under POOL_MAX m across) within POOL_R m of the fight; free_spot keeps the clear ground,
## roads, buildings and landmarks free. The paved open plaza around a fight otherwise has nothing in the frames' top band.
const POOL_MAX: float = 60.0
const POOL_R: float = 80.0
const POOL_LAMP_STEP: float = 9.0


func _real_pools() -> void:
	var lamps: Array = []
	for poly: PackedVector2Array in _p.get("_water_polys"):
		if poly.size() < 3:
			continue
		var bb := Rect2(poly[0], Vector2.ZERO)
		for q: Vector2 in poly:
			bb = bb.expand(q)
		if bb.size.x > POOL_MAX or bb.size.y > POOL_MAX or bb.get_center().length() > POOL_R:
			continue
		var carry: float = POOL_LAMP_STEP * 0.5
		var k: int = 0
		for i in poly.size():
			var a: Vector2 = poly[i]
			var b: Vector2 = poly[(i + 1) % poly.size()]
			var len: float = a.distance_to(b)
			if len < 0.5:
				continue
			var d: Vector2 = (b - a) / len
			var nrm := Vector2(-d.y, d.x)
			var mid: Vector2 = (a + b) * 0.5
			var out: Vector2 = -nrm if Geometry2D.is_point_in_polygon(mid + nrm * 0.3, poly) else nrm
			var s: float = carry
			while s < len:
				var e: Vector2 = a + d * s
				# 1.6 m out from the rim, and never inside the pool (the edge's outward side can still fall in the water at a
				# concave corner): the blind judge read a lamp at 1.1 m as standing in the water (dressing.md, round 2)
				var q: Vector2 = e + out * 1.6
				if Geometry2D.is_point_in_polygon(q, poly) or Geometry2D.is_point_in_polygon(q - out * 0.6, poly):
					s += POOL_LAMP_STEP
					continue
				var near: bool = false
				for o: Vector2 in lamps:
					if o.distance_to(q) < POOL_LAMP_STEP * 0.6:
						near = true
				if not near and free_spot(q, true, 0.6):
					_put_photo("street_lamp_01", q, h01(q, 61.0) * TAU)
					_bake.call("post", q, 2.8, 0.1)
					lamps.append(q)
					k += 1
					# a bench between this lamp and the next, its seat towards the water
					var qb: Vector2 = e + d * POOL_LAMP_STEP * 0.5 + out * 2.6
					if k % 2 == 0 and not Geometry2D.is_point_in_polygon(qb, poly) and free_spot(qb, false, 0.6) and free_spot(qb + d * 1.0, false, 0.3) and free_spot(qb - d * 1.0, false, 0.3):
						_put_photo("painted_wooden_bench", qb, atan2(-out.x, -out.y))
						_bake.call("blob", qb, 1.0, 0.7)
				s += POOL_LAMP_STEP
			carry = s - len
	_p.get("info")["pool_lamps"] = lamps.size()


## Share of today's parked slots that get a covered car on the real look (the brief allows 0 to 30 %). 0: the blind
## judge (dressing.md) named the dark, depth-of-field-softened cover a smeared or ghostly car in 9 of 11 flawed
## victory frames, so the bays stay empty; the mesh and its atlas cell stay for a later, lighter cover.
const COVERED_CAR_SHARE: float = 0.0


## Parked bays on the real look: no Kenney cars. A covered car (Poly Haven) in COVERED_CAR_SHARE of today's slots,
## the rest empty; road barriers on the junction approaches, where today's rule leaves the kerb free.
func _real_cars(region: String) -> void:
	var left: bool = region == "uk"
	var n: int = 0
	var slots: int = 0
	for rd: Dictionary in _roads.get("roads"):
		var hw: float = rd["hw"]
		if not str(rd["k"]) in ["minor_road", "medium_road", "major_road"] or hw < 2.8 or str(rd["d"]) == "service":
			continue
		var line: PackedVector2Array = rd["p"]
		for i in line.size() - 1:
			var a: Vector2 = line[i]
			var b: Vector2 = line[i + 1]
			var len: float = a.distance_to(b)
			var d: Vector2 = (b - a) / maxf(0.01, len)
			var nrm := Vector2(-d.y, d.x)
			var s: float = 3.0
			while s < len - 3.0:
				for side: float in [-1.0, 1.0]:
					var q: Vector2 = a + d * s + nrm * side * (hw - 1.15)
					var hv: float = h01(q, 21.0)
					if hv > 0.42 or q.length() > 100.0 or _clear.grow(2.0).has_point(q):
						continue
					if bool(_p.call("in_building", q, 0.5)):
						continue
					var fwd: Vector2 = d * (side if left else -side) * -1.0
					if bool(_roads.call("near_junction", q, hw + 9.0)):
						# the approach to a junction: a short run of barriers along the kerb, now and then
						if not bool(_roads.call("near_junction", q, hw + 3.0)) and h01(q, 33.0) < 0.3:
							var qb: Vector2 = a + d * s + nrm * side * (hw - 0.45)
							if not _clear.grow(2.0).has_point(qb):
								for k in 2:
									_put_photo("concrete_road_barrier", qb + d * (float(k) - 0.5) * 1.6, atan2(d.x, d.y) + PI * 0.5)
								_bake.call("blob", qb, 1.4, 0.8)
						continue
					slots += 1
					if h01(q, 31.0) < COVERED_CAR_SHARE:
						_put_photo("covered_car", q, atan2(fwd.x, fwd.y))
						_bake.call("blob", q, 1.6, 1.0)
						n += 1
				s += 6.2
	_p.get("info")["parked_cars"] = n
	_p.get("info")["parked_slots"] = slots


## Materials for the photo props, the plane's leaves and the mid tier's tree impostor (made on the place's worker;
## textures by tier: the high atlas 2048, mid 1024).
func _real_mats() -> void:
	var tier: String = "high" if _high else "mid"
	var lk: Dictionary = _p.get("_look")
	var tp: Dictionary = _p.get("_tp")
	var sm := ShaderMaterial.new()
	sm.shader = PROP_SHADER
	sm.set_shader_parameter("albedo_tex", load(PROPS_DIR + "props_%s_a.png" % tier))
	sm.set_shader_parameter("normal_tex", load(PROPS_DIR + "props_%s_n.png" % tier))
	sm.set_shader_parameter("orm_tex", load(PROPS_DIR + "props_%s_orm.png" % tier))
	sm.set_shader_parameter("emit_k", 2.2 * float(tp.get("lamps", 0.0)))
	sm.set_shader_parameter("albedo_k", float(lk.get("prop_k", 1.0)))
	_env_params(sm, lk, _high)
	var hemi: Callable = _p.get("_hemi")
	if hemi.is_valid():
		hemi.call(sm, lk)
	_prop_mat = sm
	ShaderWarmScript.add(sm)
	if _high:
		var lm := StandardMaterial3D.new()
		lm.albedo_texture = load(TREES_DIR + "plane_leaves_high.png")
		lm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		lm.alpha_scissor_threshold = 0.45
		lm.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
		lm.cull_mode = BaseMaterial3D.CULL_DISABLED
		# the scan's mixed autumn leaves pulled to a plane's mid summer green (a first pass at 0.66, 0.74, 0.54 read as a
		# flat lime crown in the golden light), wrapped diffuse so the crown's shaded side stays leafy, not black
		lm.albedo_color = Color(0.5, 0.58, 0.43)
		lm.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT_WRAP
		lm.roughness = 0.85
		lm.specular = 0.25
		lm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		_leaf_mat = lm
		ShaderWarmScript.add(lm)
		# measurement only (dressing.md, leaf overdraw): look "dbg_leaf": "overdraw" draws every leaf fragment as +1/32
		# green with no depth test (a debug overdraw view of the leaves alone), "hide" draws no leaves; the difference
		# of the two frames x 32 is the fragments per pixel over the crowns. Never set by the game.
		var dbg: String = str(lk.get("dbg_leaf", ""))
		if dbg == "overdraw":
			var od := StandardMaterial3D.new()
			od.albedo_texture = lm.albedo_texture
			od.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
			od.alpha_scissor_threshold = lm.alpha_scissor_threshold
			od.cull_mode = BaseMaterial3D.CULL_DISABLED
			od.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			od.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
			od.no_depth_test = true
			od.disable_fog = true
			od.albedo_color = Color(0.0, 1.0 / 32.0, 0.0, 1.0)
			od.render_priority = 100
			_leaf_mat = od
		elif dbg == "hide":
			_leaf_mat = null
	else:
		_imp_mat = _imp_material(lk)


## The street's light from the LookReal cube (read only), as fighter.gd gives the fighters: the six ambient
## directions always, the reflection cube only where the tier pays for it (high).
static func _env_params(sm: ShaderMaterial, lk: Dictionary, cube: bool) -> void:
	var e: Dictionary = LookRealScript.env_for(str(lk.get("time", "golden")))
	if e.is_empty():
		var flat := PackedVector3Array()
		for i in 6:
			flat.append(Vector3(0.6, 0.6, 0.65))
		sm.set_shader_parameter("amb_cube", flat)
		sm.set_shader_parameter("env_spec", 0.0)
		return
	sm.set_shader_parameter("amb_cube", e["amb"])
	sm.set_shader_parameter("env_scale", e["scale"])
	sm.set_shader_parameter("env_lods", e["lods"])
	if cube and bool(lk.get("ibl", true)):
		sm.set_shader_parameter("env_cube", e["cube"])
		sm.set_shader_parameter("env_spec", 1.0)
	else:
		sm.set_shader_parameter("env_spec", 0.0)


## The kit's own materials (landmarks, the procedural props that stay, roof clutter) on the real look: the cached
## place.kit_mat(cls) materials get real_k = 1 and the kit_real detail maps. Mid and high only.
func _real_kit() -> void:
	var lk: Dictionary = _p.get("_look")
	for cls: String in KIT_REAL:
		var m: Variant = (_p.get("_mats") as Dictionary).get("kit_" + cls)
		if not m is ShaderMaterial:
			continue
		var sm := m as ShaderMaterial
		var r: Array = KIT_REAL[cls]
		sm.set_shader_parameter("real_k", 1.0)
		sm.set_shader_parameter("real_detail", load(PROPS_DIR + "kit_real/%s.png" % str(r[0])))
		sm.set_shader_parameter("real_mean", 0.8 if str(r[0]) == "stone" else 0.5)
		sm.set_shader_parameter("real_rough", float(r[1]))
		sm.set_shader_parameter("real_metal", float(r[2]))
		sm.set_shader_parameter("real_dk", float(r[3]))
		var e: Dictionary = LookRealScript.env_for(str(lk.get("time", "golden")))
		if _high and not e.is_empty() and bool(lk.get("ibl", true)):
			sm.set_shader_parameter("env_cube", e["cube"])
			sm.set_shader_parameter("env_scale", e["scale"])
			sm.set_shader_parameter("env_lods", e["lods"])
			sm.set_shader_parameter("env_spec", 0.6)
		ShaderWarmScript.add(sm)


## Every photo kind as MultiMeshes per 24 m cell and LOD, queued on the place (place._emit: nodes are made on the
## main thread). On high, the instances within SHADOW_R of the fight cast too, through a shadow-only MultiMesh.
func _emit_real() -> void:
	var n_lod0: int = 0
	var tris: int = 0
	for kind: String in _px:
		var cells: Dictionary = {}
		var casters: Array = []
		for x: Transform3D in _px[kind]:
			var c := Vector2i(floori(x.origin.x / CELL), floori(x.origin.z / CELL))
			if not cells.has(c):
				cells[c] = []
			(cells[c] as Array).append(x)
			if _high and Vector2(x.origin.x, x.origin.z).length() < SHADOW_R:
				casters.append(x)
		for c: Vector2i in cells:
			var ctr := Vector2((c.x + 0.5) * CELL, (c.y + 0.5) * CELL)
			var xs: Array = cells[c]
			if kind == "plane":
				if _high and ctr.length() < TREE_LOD0_R:
					_emit_mm(load(TREES_DIR + "plane_lod0_bark.res"), _prop_mat, xs, "real_plane_bark_%d_%d" % [c.x, c.y], 0)
					if _leaf_mat != null:
						_emit_mm(load(TREES_DIR + "plane_lod0_leaves.res"), _leaf_mat, xs, "real_plane_leaves_%d_%d" % [c.x, c.y], 0)
					tris += 3792 * xs.size()
				else:
					_emit_mm(load(TREES_DIR + "plane_imp.res"), _imp_mat if _imp_mat != null else _imp_for_high(), xs, "real_plane_imp_%d_%d" % [c.x, c.y], 0)
				continue
			var lod: int = 0 if _high and ctr.length() < LOD0_R else 1
			n_lod0 += xs.size() if lod == 0 else 0
			_emit_mm(load(PROPS_DIR + "%s_lod%d.res" % [kind, lod]), _prop_mat, xs, "real_%s_%d_%d_l%d" % [kind, c.x, c.y, lod], 0)
		if not casters.is_empty():
			_emit_mm(load(PROPS_DIR + "%s_lod1.res" % kind), _prop_mat, casters, "real_%s_shadow" % kind, 1)
	var info: Dictionary = _p.get("info")
	info["real"] = {"tier": "high" if _high else "mid", "kinds": _px.size(), "lod0": n_lod0}


var _imp_high: Material


## Far trees on high use the impostor card too (the mid texture, lit the same way).
func _imp_for_high() -> Material:
	if _imp_high == null:
		_imp_high = _imp_material(_p.get("_look"))
	return _imp_high


## The plane impostor's two crossed cards. A card seen near edge-on squeezes the whole crown into a vertical green
## streak (the held-out judge's defect at Shoreditch, mid), so each card fades out by how squarely it faces the eye:
## alpha x smoothstep(IMP_FADE) of |N.V|. At any yaw the other card faces the eye at |N.V| >= 0.7, so the crown never
## thins. One texture read, as the StandardMaterial3D it replaces (unshaded, alpha scissor 0.45, alpha to coverage).
const IMP_FADE := Vector2(0.18, 0.42)
static var _imp_shader: Shader


static func _imp_material(lk: Dictionary) -> Material:
	if _imp_shader == null:
		_imp_shader = Shader.new()
		_imp_shader.code = """shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque, alpha_to_coverage;
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap;
uniform float tint = 0.86;
uniform vec2 fade = vec2(0.18, 0.42);
void fragment() {
	vec4 c = texture(albedo_tex, UV);
	float facing = abs(dot(normalize(NORMAL), normalize(VIEW)));
	ALBEDO = c.rgb * tint;
	ALPHA = c.a * smoothstep(fade.x, fade.y, facing);
	ALPHA_SCISSOR_THRESHOLD = 0.45;
	ALPHA_ANTIALIASING_EDGE = 0.3;
	ALPHA_TEXTURE_COORDINATE = UV * vec2(textureSize(albedo_tex, 0));
}
"""
	var im := ShaderMaterial.new()
	im.shader = _imp_shader
	im.set_shader_parameter("albedo_tex", load(TREES_DIR + "plane_imp_mid.png"))
	im.set_shader_parameter("tint", float(lk.get("imp_k", 0.86)))
	im.set_shader_parameter("fade", IMP_FADE)
	ShaderWarmScript.add(im)
	return im


func _emit_mm(mesh: Mesh, mat: Material, xs: Array, n: String, shadow: int) -> void:
	if mesh == null or xs.is_empty():
		return
	var buf: PackedFloat32Array = (_p.get_script() as GDScript).call("xform_buffer", xs)
	var xz := PackedVector2Array()
	for x: Transform3D in xs:
		xz.append(Vector2(x.origin.x, x.origin.z))
	_p.call("_emit", Callable(get_script(), "mk_real").bind(_p, mesh, mat, buf, xs.size(), n, shadow, xz))


## Main thread (place._emit): one MultiMeshInstance3D. shadow 0: drawn, casts nothing (the place's rule);
## 1: shadow only (high, near the fight).
## xz: the instances' ground positions, kept on the node (tests/fid29_dressing_test.gd checks the clear ground).
static func mk_real(p: Node3D, mesh: Mesh, mat: Material, buf: PackedFloat32Array, count: int, n: String, shadow: int, xz: PackedVector2Array) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = count
	mm.buffer = buf
	var mmi := MultiMeshInstance3D.new()
	mmi.name = n
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY if shadow == 1 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.set_meta("xz", xz)
	p.add_child(mmi)
