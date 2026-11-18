extends SceneTree
## tools/props/mesh_dump.gd (fid29 dressing, measurement only): writes a mesh's positions, UVs and indices as JSON
## for tools/props/leaf_overdraw.py.  godot --headless --path app/game3d -s res://tools/props/mesh_dump.gd -- RES OUT.json


func _initialize() -> void:
	var a: PackedStringArray = OS.get_cmdline_user_args()
	var m: Mesh = load(a[0])
	var out: Array = []
	for si in m.get_surface_count():
		var arr: Array = m.surface_get_arrays(si)
		var v: Array = []
		for p: Vector3 in (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array):
			v.append([p.x, p.y, p.z])
		var uv: Array = []
		if arr[Mesh.ARRAY_TEX_UV] != null:
			for t: Vector2 in (arr[Mesh.ARRAY_TEX_UV] as PackedVector2Array):
				uv.append([t.x, t.y])
		var idx: Array = Array(arr[Mesh.ARRAY_INDEX]) if arr[Mesh.ARRAY_INDEX] != null else []
		out.append({"v": v, "uv": uv, "i": idx})
	var f := FileAccess.open(a[1], FileAccess.WRITE)
	f.store_string(JSON.stringify(out))
	f.close()
	print("dumped %d surfaces" % out.size())
	quit()
