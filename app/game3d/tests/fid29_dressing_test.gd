extends SceneTree
## fid29-dressing (docs/game3d/fid29/dressing.md): real street furniture on the mid and high tiers.
##   godot --headless --path app/game3d -s res://tests/fid29_dressing_test.gd
## 1. Every photo prop's LODs inside their triangle caps (tools/props/atlas_layout.json), read from the meshes; the
##    London plane 3k to 6k triangles, its impostor 2 to 4 cards.
## 2. The kiosk (kit kind phone_box_uk, every tier): no K6-style mesh: two surfaces (paint, glass), no more triangles
##    than build 28's, a flat roof (no dome) and at most one glazed panel per side (no 3 x 6 panes).
## 3. Places built with the high, mid and low looks (Trafalgar's fountain pools get lamp standards on mid and high) (the default street, Trafalgar, Westminster, Times Square):
##    mid and high draw no Kenney car (no cars_* MultiMesh, no driving car in the life layer) and photo props
##    instead; no photo prop or tree stands in the fighters' clear ground; LOD0 props only on high; shadow casters only
##    within 12 m; the kit materials run the real shading (real_k 1) on mid and high, the original (0) on low; the low
##    tier has no photo prop at all, keeps its Kenney cars, and fid_dressing false turns the whole lane off.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const PlaceScript := preload("res://place.gd")
const ArenaScript := preload("res://arena.gd")
const PropsScript := preload("res://world_props.gd")
const StreetLayout := preload("res://street_layout.gd")
const Dress := preload("res://place_dress.gd")
const B28_KIOSK_TRIS: int = 220     # build 28's K6-style phone_box_uk_0 (dome, 3 x 6 panes a side, sign band)

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


static func tris(m: Mesh) -> int:
	var n: int = 0
	for si in m.get_surface_count():
		var a: Array = m.surface_get_arrays(si)
		var idx: Variant = a[Mesh.ARRAY_INDEX]
		n += ((idx as PackedInt32Array).size() if idx != null and (idx as PackedInt32Array).size() > 0 else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	return n


func _initialize() -> void:
	_caps()
	_kiosk()
	var places: Array = [["street", StreetLayout.ground(), Vector2.ZERO, 0.0]]
	for pl: Array in [["trafalgar", "trafalgar_staging", Vector2(-14.4, 19.8)], ["westminster", "westminster", Vector2.ZERO], ["times_square", "times_square", Vector2.ZERO]]:
		var g: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://tools/fid29/places/%s.json" % pl[1]))
		if g is Dictionary:
			places.append([pl[0], g, pl[2], NAN])
		else:
			_check("place_doc_" + str(pl[0]), false, "unreadable")
	for pl: Array in places:
		for tier: String in ["high", "mid", "low"]:
			_place(str(pl[0]), pl[1], pl[2], float(pl[3]), tier, {})
	_place("street", StreetLayout.ground(), Vector2.ZERO, 0.0, "high", {"fid_dressing": false})
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)


func _caps() -> void:
	var lay: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tools/props/atlas_layout.json"))
	var bad: Array = []
	var n: int = 0
	for kind: String in (lay["kinds"] as Dictionary):
		var k: Dictionary = lay["kinds"][kind]
		if k.get("src") == null:
			continue
		for lod in 2:
			var m: Mesh = load("res://art/world/props/%s_lod%d.res" % [kind, lod])
			var t: int = tris(m) if m != null else -1
			n += 1
			if m == null or t > int(k["cap%d" % lod]) or t < 12 or (lod == 1 and t > tris(load("res://art/world/props/%s_lod0.res" % kind))):
				bad.append("%s_lod%d=%d/%d" % [kind, lod, t, int(k["cap%d" % lod])])
	_check("prop_lods_within_caps", bad.is_empty() and n >= 22, str(bad))
	var car: Mesh = load("res://art/world/props/covered_car_lod0.res")
	_check("covered_car_at_most_4k", car != null and tris(car) <= 4000, str(tris(car) if car != null else -1))
	var bark: Mesh = load("res://art/world/trees/plane_lod0_bark.res")
	var leaves: Mesh = load("res://art/world/trees/plane_lod0_leaves.res")
	var tt: int = (tris(bark) + tris(leaves)) if bark != null and leaves != null else -1
	_check("plane_3k_to_6k", tt >= 3000 and tt <= 6000, str(tt))
	var imp: Mesh = load("res://art/world/trees/plane_imp.res")
	var it: int = tris(imp) if imp != null else -1
	_check("plane_impostor_2_to_4_cards", it >= 4 and it <= 8, str(it))


func _kiosk() -> void:
	var m: ArrayMesh = PlaceScript.kit("phone_box_uk", 0)
	var built: ArrayMesh = PropsScript.build("phone_box_uk", 0)
	for pair: Array in [["baked", m], ["built", built]]:
		var mesh: ArrayMesh = pair[1]
		if mesh == null:
			_check("kiosk_%s_exists" % pair[0], false)
			continue
		var names: Array = []
		for si in mesh.get_surface_count():
			names.append(mesh.surface_get_name(si))
		names.sort()
		_check("kiosk_%s_surfaces_as_b28" % pair[0], names == ["glass", "paint"], str(names))
		_check("kiosk_%s_no_more_tris" % pair[0], tris(mesh) <= B28_KIOSK_TRIS, str(tris(mesh)))
		# no dome: a flat roof is a slab, so the top fifth of the kiosk has at most 5 vertex heights (the K6 dome's
		# lathe rings, crown and sign band give 10 or more)
		var top: float = mesh.get_aabb().end.y
		var levels: Dictionary = {}
		var glass_quads: int = 0
		for si in mesh.get_surface_count():
			var a: Array = mesh.surface_get_arrays(si)
			for v: Vector3 in (a[Mesh.ARRAY_VERTEX] as PackedVector3Array):
				if v.y > top * 0.8:
					levels[int(round(v.y * 100.0))] = true
			if mesh.surface_get_name(si) == "glass":
				glass_quads = tris_of(a) / 2
		_check("kiosk_%s_flat_roof" % pair[0], levels.size() <= 5, "%d vertex heights in the top fifth" % levels.size())
		_check("kiosk_%s_no_pane_grid" % pair[0], glass_quads <= 4, "%d glass quads" % glass_quads)


static func tris_of(a: Array) -> int:
	var idx: Variant = a[Mesh.ARRAY_INDEX]
	if idx != null and (idx as PackedInt32Array).size() > 0:
		return (idx as PackedInt32Array).size() / 3
	return (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size() / 3


func _place(pname: String, ground: Dictionary, at: Vector2, yaw: float, tier: String, extra: Dictionary) -> void:
	var cfg: Dictionary = {"tier": tier, "look": {"time": "golden"}}
	for k: String in extra:
		(cfg["look"] as Dictionary)[k] = extra[k]
	var look: Dictionary = ArenaScript.look_opts(cfg)
	var p: Node3D = PlaceScript.new()
	root.add_child(p)
	p.call("build", ground, at, 12.0, yaw, look, Callable())
	var tag: String = "%s_%s%s" % [pname, tier, "_off" if not extra.is_empty() else ""]
	var real: bool = tier != "low" and extra.is_empty()
	var clear: Rect2 = p.get("clear")
	var kenney: int = 0
	var photo: int = 0
	var lod0: int = 0
	var inside: Array = []
	var far_cast: int = 0
	var trees: int = 0
	for c: Node in p.get_children():
		if not c is MultiMeshInstance3D:
			continue
		var mmi := c as MultiMeshInstance3D
		var mm: MultiMesh = mmi.multimesh
		var nm: String = str(mmi.name)
		if nm.begins_with("cars_"):
			kenney += mm.instance_count
		if not nm.begins_with("real_"):
			continue
		photo += mm.instance_count
		if nm.ends_with("_l0"):
			lod0 += mm.instance_count
		if nm.begins_with("real_plane"):
			trees += mm.instance_count
		var shadow: bool = mmi.cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		for q: Vector2 in (mmi.get_meta("xz", PackedVector2Array()) as PackedVector2Array):
			if clear.has_point(q):
				inside.append("%s@%.1f,%.1f" % [nm, q.x, q.y])
			if shadow and q.length() > Dress.SHADOW_R + 0.01:
				far_cast += 1
	var driving: int = 0
	var life: Node = p.get("life")
	if life != null:
		for c: Node in life.get_children():
			if c is MeshInstance3D:
				driving += 1    # place_life.gd: a driving car is its only plain MeshInstance3D
	if real:
		_check("no_kenney_cars_" + tag, kenney == 0 and driving == 0, "parked %d driving %d" % [kenney, driving])
		_check("photo_props_" + tag, photo > 20, str(photo))
		_check("clear_ground_free_" + tag, inside.is_empty(), str(inside.slice(0, 6)))
		_check("lod0_high_only_" + tag, (lod0 > 0) if tier == "high" else (lod0 == 0), "lod0 %d" % lod0)
		_check("casters_within_12m_" + tag, far_cast == 0, str(far_cast))
		if pname == "trafalgar":
			# the square's fountain pools get lamp standards round the rim (place_dress._real_pools)
			var pool_lamps: int = int((p.get("info") as Dictionary).get("pool_lamps", 0))
			_check("pool_lamps_" + tag, pool_lamps >= 4, str(pool_lamps))
	else:
		_check("no_photo_props_" + tag, photo == 0, str(photo))
	var kit_ok: bool = true
	var n_kit: int = 0
	for key: String in (p.get("_mats") as Dictionary):
		var m: Variant = p.get("_mats")[key]
		if key.begins_with("kit_") and m is ShaderMaterial and (m as ShaderMaterial).shader.resource_path.ends_with("world_kit.gdshader"):
			n_kit += 1
			var rk: float = float((m as ShaderMaterial).get_shader_parameter("real_k") if (m as ShaderMaterial).get_shader_parameter("real_k") != null else 0.0)
			var cls: String = key.substr(4)
			var want: float = 1.0 if real and Dress.KIT_REAL.has(cls) else 0.0
			if absf(rk - want) > 0.001:
				kit_ok = false
	_check("kit_shading_%s" % tag, kit_ok and n_kit > 0, "%d kit materials" % n_kit)
	print("CQDRESS %s photo=%d lod0=%d trees=%d kenney=%d info=%s" % [tag, photo, lod0, trees, kenney, JSON.stringify((p.get("info") as Dictionary).get("real", {}))])
	p.queue_free()
