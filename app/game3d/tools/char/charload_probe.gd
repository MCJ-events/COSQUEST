extends SceneTree
## charload probe: what the runtime glTF load gives each surface of a character file, and which of the fighter's
## conversion rules it trips.  godot --headless --path app/game3d -s res://tools/char/charload_probe.gd -- <glb>
const Loader := preload("res://char_loader.gd")
func _initialize() -> void:
	var path: String = OS.get_cmdline_user_args()[0]
	var r: Dictionary = Loader.new().load_glb(path, true)
	if not r.ok:
		print("PROBE fail ", r.error)
		quit(1)
		return
	var node: Node = r.node
	for mi: Node in node.find_children("*", "MeshInstance3D", true, false):
		var m: MeshInstance3D = mi
		var am := m.mesh as ArrayMesh
		for s in m.mesh.get_surface_count():
			var mat = m.mesh.surface_get_material(s)
			var b := mat as BaseMaterial3D
			var fmt: int = am.surface_get_format(s) if am else 0
			var info := {"mesh": m.name, "surf": s, "mat": (mat.resource_name if mat else "null"),
				"tris": am.surface_get_array_index_len(s) / 3 if am and am.surface_get_array_index_len(s) > 0 else -1,
				"tangents": (fmt & Mesh.ARRAY_FORMAT_TANGENT) != 0, "vcolor": (fmt & Mesh.ARRAY_FORMAT_COLOR) != 0}
			if b:
				info.merge({"transp": b.transparency, "cull": b.cull_mode, "vc_albedo": b.vertex_color_use_as_albedo,
					"normal": b.normal_enabled and b.normal_texture != null, "emission": b.emission_enabled,
					"emis_tex": b.emission_texture != null, "emis_col": b.emission, "rough_tex": b.roughness_texture != null,
					"metal_tex": b.metallic_texture != null, "ao": b.ao_enabled, "albedo_tex": b.albedo_texture != null,
					"albedo": b.albedo_color, "metallic": b.metallic, "roughness": b.roughness,
					"alpha_scissor": b.alpha_scissor_threshold})
			print("PROBE ", JSON.stringify(info))
	print("PROBE kinds ", r.get("surface_kinds", {}), " skin_mask ", r.has("skin_mask"))
	quit(0)
