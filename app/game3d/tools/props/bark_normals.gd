extends SceneTree
## fid29-dressing: the plane's bark normals, rebuilt in the game mesh. The Blender step's per-loop normals came through
## the glTF round trip turned ring by ring (each limb segment shaded dark at one end and pale at the other: hard rings
## down every branch at the fight camera, which the blind judge read as seams). This rebuilds them from the geometry:
## smooth normals over every vertex at the same position (the u seam and the joints between segments shade as one
## surface), then the tangents again. UVs, positions and indices are kept.
## bake_props.gd runs smooth_bark() on the bark of a fresh bake; this runs it on the committed mesh in place:
##   godot --headless --path app/game3d -s res://tools/props/bark_normals.gd [-- --res=res://art/world/trees/plane_lod0_bark.res]

const BARK_RES := "res://art/world/trees/plane_lod0_bark.res"


static func smooth_bark(m: ArrayMesh) -> ArrayMesh:
	var out := ArrayMesh.new()
	for s in m.get_surface_count():
		var t := SurfaceTool.new()
		t.create_from(m, s)
		t.generate_normals()
		t.generate_tangents()
		t.commit(out)
		out.surface_set_name(s, m.surface_get_name(s))
	return out


func _initialize() -> void:
	var path: String = BARK_RES
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--res="):
			path = a.substr(6)
	var m: ArrayMesh = load(path)
	if m == null:
		print("BARKNORMALS missing %s" % path)
		quit(1)
		return
	var before: int = (m.surface_get_arrays(0)[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
	var out: ArrayMesh = smooth_bark(m)
	var after: int = (out.surface_get_arrays(0)[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
	var err: int = ResourceSaver.save(out, path, ResourceSaver.FLAG_COMPRESS)
	print("BARKNORMALS %s vertices %d -> %d surfaces %d save %d" % [path, before, after, out.get_surface_count(), err])
	quit(0 if err == OK else 1)
