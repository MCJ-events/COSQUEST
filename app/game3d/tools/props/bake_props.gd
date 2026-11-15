extends SceneTree
## fid29-dressing: the street props and the plane tree from the Blender step (tools/props/props_blender.py,
## tree_blender.py) into the game's meshes:
##   art/world/props/<kind>_lod0.res, <kind>_lod1.res   one surface "prop" (UVs in the prop atlas), with tangents
##   art/world/trees/plane_lod0.res                    surfaces "bark" (prop atlas) and "leaves" (plane_leaves)
##   art/world/trees/plane_imp.res                     the mid tier's 2-card impostor (plane_imp_mid.png)
## The glbs are read at run time (GLTFDocument), so they never enter the project:
##   godot --headless --path app/game3d -s res://tools/props/bake_props.gd -- --glb=/abs/glb --tree=/abs/tree
## Prints BAKEPROPS lines (triangles per LOD, bounds) and checks every LOD against its cap (atlas_layout.json).

const BarkNormals := preload("res://tools/props/bark_normals.gd")


func _initialize() -> void:
	var glb_dir: String = ""
	var tree_dir: String = ""
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--glb="):
			glb_dir = a.substr(6)
		elif a.begins_with("--tree="):
			tree_dir = a.substr(7)
	var lay: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tools/props/atlas_layout.json"))
	var bad: int = 0
	DirAccess.make_dir_recursive_absolute("res://art/world/props")
	DirAccess.make_dir_recursive_absolute("res://art/world/trees")
	for kind: String in (lay["kinds"] as Dictionary):
		var k: Dictionary = lay["kinds"][kind]
		if k.get("src") == null:
			continue
		for lod in 2:
			var m: ArrayMesh = _load(glb_dir.path_join("%s_lod%d.glb" % [kind, lod]), ["prop"])
			if m == null:
				print("BAKEPROPS missing %s lod%d" % [kind, lod])
				bad += 1
				continue
			var tris: int = _tris(m)
			var cap: int = int(k["cap%d" % lod])
			if tris > cap:
				bad += 1
			ResourceSaver.save(m, "res://art/world/props/%s_lod%d.res" % [kind, lod], ResourceSaver.FLAG_COMPRESS)
			print("BAKEPROPS %s lod%d tris=%d cap=%d aabb=%s" % [kind, lod, tris, cap, m.get_aabb()])
	if tree_dir != "":
		for pair: Array in [["plane_lod0", ["bark", "leaves"]], ["plane_imp", ["imp"]]]:
			var m: ArrayMesh = _load(tree_dir.path_join("%s.glb" % pair[0]), pair[1])
			if m == null:
				bad += 1
				continue
			# one mesh per surface: each is its own MultiMesh with its own material (bark: the prop atlas, leaves: the
			# alpha-to-coverage leaf material)
			for si in m.get_surface_count():
				var one := ArrayMesh.new()
				one.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, m.surface_get_arrays(si))
				one.surface_set_name(0, m.surface_get_name(si))
				if m.surface_get_name(si) == "bark":
					one = BarkNormals.smooth_bark(one)   # the glTF round trip turns the ring normals
				var nm: String = pair[0] if m.get_surface_count() == 1 else "%s_%s" % [pair[0], m.surface_get_name(si)]
				ResourceSaver.save(one, "res://art/world/trees/%s.res" % nm, ResourceSaver.FLAG_COMPRESS)
				print("BAKEPROPS %s tris=%d aabb=%s" % [nm, _tris(one), one.get_aabb()])
	print("BAKEPROPS done bad=%d" % bad)
	quit(1 if bad > 0 else 0)


## One glb -> an ArrayMesh, a surface per glTF primitive (named by `names` in order), tangents generated from
## the final UVs (Godot's own convention for the OpenGL normal maps).
func _load(path: String, names: Array) -> ArrayMesh:
	if not FileAccess.file_exists(path):
		return null
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	if doc.append_from_file(path, st) != OK:
		return null
	var root: Node = doc.generate_scene(st)
	var out := ArrayMesh.new()
	var si: int = 0
	for n: Node in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		var xf: Transform3D = Transform3D.IDENTITY
		var p: Node = mi
		while p != null and p != root:
			if p is Node3D:
				xf = (p as Node3D).transform * xf
			p = p.get_parent()
		for s in mi.mesh.get_surface_count():
			var t := SurfaceTool.new()
			t.begin(Mesh.PRIMITIVE_TRIANGLES)
			t.append_from(mi.mesh, s, xf)
			t.generate_tangents()
			t.commit(out)
			out.surface_set_name(out.get_surface_count() - 1, str(names[mini(si, names.size() - 1)]))
			si += 1
	root.free()
	return out


static func _tris(m: ArrayMesh) -> int:
	var n: int = 0
	for s in m.get_surface_count():
		var a: Array = m.surface_get_arrays(s)
		var idx: Variant = a[Mesh.ARRAY_INDEX]
		n += ((idx as PackedInt32Array).size() if idx != null else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	return n
