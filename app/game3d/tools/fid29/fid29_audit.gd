extends SceneTree
## fid29 audit (review only, not shipped): starts a fight like tools/look_shots.gd, waits until `t` seconds of fight,
## then writes one JSON with what the frame costs and where it goes:
##  - every texture the materials in the tree reference: size, format, bytes, path, grouped
##  - every visible geometry in the camera's frustum: triangles x instances, shadow casting, material/shader, grouped
##  - the lights, the environment, the viewport (render scale, MSAA), the project's shadow and filter settings
##  - Godot's own monitors (draws, primitives, objects, texture and video memory)
##   xvfb-run ... godot --path . --rendering-driver opengl3 --resolution 720x1280 --fixed-fps 30 \
##     -s res://tools/fid29/fid29_audit.gd -- --cfg=/abs/cfg.json --out=/abs/out.json --t=4.4 [--intro=0.9 | --win=1.7]
## fid29-base: kept in tools/fid29 (frozen); --intro dumps at that many seconds into the hero's intro beat, --win
## that many seconds after the fight ends (tools/fid29/dump.sh).

var cfg: Dictionary = {}
var out_path: String = ""
var at_t: float = 4.4
var _frames: int = -1
var _done: bool = false
var at_intro: float = -1.0
var at_win: float = -1.0


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--cfg="):
			cfg = JSON.parse_string(FileAccess.get_file_as_string(a.substr(6)))
		elif a.begins_with("--out="):
			out_path = a.substr(6)
		elif a.begins_with("--t="):
			at_t = float(a.substr(4))
		elif a.begins_with("--intro="):
			at_intro = float(a.substr(8))
		elif a.begins_with("--win="):
			at_win = float(a.substr(6))
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	(func() -> void: root.get_node("Bridge").start_fight(JSON.stringify(cfg))).call_deferred()


func _fight() -> Node:
	var b: Node = root.get_node_or_null("Bridge")
	return b.get("_fight") if b != null else null


func _process(_dt: float) -> bool:
	if _done:
		return true
	var f: Node = _fight()
	if f == null or not is_instance_valid(f):
		return false
	if at_intro >= 0.0:
		if (str(f.get("state")) == "intro" and float(f.get("_beat_t")) >= at_intro) or str(f.get("state")) == "fighting":
			_done = true
			_dump.call_deferred(f)
		return false
	if at_win >= 0.0:
		if str(f.get("state")) == "ending" and float(f.get("_end_t")) >= at_win:
			_done = true
			_dump.call_deferred(f)
		return false
	if _frames < 0:
		if str(f.get("state")) == "fighting":
			_frames = 0
		return false
	_frames += 1
	if _frames / 30.0 >= at_t:
		_done = true
		_dump.call_deferred(f)
	return false


func _tris(m: Mesh) -> int:
	if m == null:
		return 0
	var n: int = 0
	for s: int in m.get_surface_count():
		if m is ArrayMesh:
			var am := m as ArrayMesh
			var il: int = am.surface_get_array_index_len(s)
			n += (il if il > 0 else am.surface_get_array_len(s)) / 3
		else:
			var arr: Array = m.surface_get_arrays(s)
			var idx: Variant = arr[Mesh.ARRAY_INDEX]
			n += ((idx as PackedInt32Array).size() if idx != null else (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	return n


func _aabb_in(planes: Array[Plane], box: AABB) -> bool:
	for p: Plane in planes:
		# the box corner furthest along the plane's normal (Godot planes point out of the frustum)
		var c := Vector3(box.position.x if p.normal.x > 0.0 else box.end.x,
			box.position.y if p.normal.y > 0.0 else box.end.y,
			box.position.z if p.normal.z > 0.0 else box.end.z)
		if p.is_point_over(c):
			return false
	return true


func _mat_name(m: Material) -> String:
	if m == null:
		return "-"
	if m is ShaderMaterial:
		var sh: Shader = (m as ShaderMaterial).shader
		if sh == null:
			return "shader:null"
		if sh.resource_path != "":
			return "shader:" + sh.resource_path.get_file()
		var code: String = sh.code
		if code.contains("ALPHA_HOOK") or code.contains("env_cube"):
			return "shader:char_real(variant)"
		return "shader:inline"
	if m is StandardMaterial3D or m is ORMMaterial3D:
		var b := m as BaseMaterial3D
		return "std:%s%s%s" % ["unshaded" if b.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED else "lit",
			"+alpha" if b.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED else "", "+tex" if b.albedo_texture != null else ""]
	return m.get_class()


func _group(n: Node, f: Node) -> String:
	var p: String = str(f.get_path_to(n))
	for k: String in ["hero", "enemy", "ally"]:
		var o: Variant = f.get(k)
		if o is Node and (o as Node).is_ancestor_of(n):
			return "fighter:" + k
	var parts: PackedStringArray = p.split("/")
	if parts.size() >= 3:
		return "%s/%s" % [parts[0], parts[1]]
	return parts[0] if parts.size() > 0 else p


func _dump(f: Node) -> void:
	await RenderingServer.frame_post_draw
	var vp: Viewport = root.get_viewport()
	var cam: Camera3D = vp.get_camera_3d()
	var planes: Array[Plane] = []
	for p: Plane in cam.get_frustum():
		planes.append(p)
	var out: Dictionary = {}
	out["monitors"] = {
		"draws": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"prims": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"objects": Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
		"tex_mb": Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0,
		"vmem_mb": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
		"buf_mb": Performance.get_monitor(Performance.RENDER_BUFFER_MEM_USED) / 1048576.0}
	out["viewport"] = {"scale": vp.scaling_3d_scale, "scale_mode": vp.scaling_3d_mode, "msaa_3d": vp.msaa_3d,
		"screen_aa": vp.screen_space_aa, "size": [vp.get_visible_rect().size.x, vp.get_visible_rect().size.y],
		"cam_fov": cam.fov, "cam_near": cam.near, "cam_far": cam.far, "cam_pos": [cam.global_position.x, cam.global_position.y, cam.global_position.z],
		"cam_pitch_deg": rad_to_deg(cam.global_transform.basis.get_euler().x)}
	var ps: Dictionary = {}
	for k: String in ["rendering/lights_and_shadows/directional_shadow/size", "rendering/lights_and_shadows/directional_shadow/size.mobile",
			"rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality",
			"rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality.mobile",
			"rendering/textures/default_filters/anisotropic_filtering_level", "rendering/textures/vram_compression/import_etc2_astc",
			"rendering/anti_aliasing/quality/msaa_3d", "rendering/textures/canvas_textures/default_texture_filter",
			"rendering/gl_compatibility/driver", "rendering/renderer/rendering_method.mobile"]:
		ps[k] = ProjectSettings.get_setting(k)
	out["project"] = ps
	# lights
	var lights: Array = []
	for n: Node in f.find_children("*", "Light3D", true, false):
		var l := n as Light3D
		var d: Dictionary = {"class": l.get_class(), "energy": l.light_energy, "shadow": l.shadow_enabled, "visible": l.is_visible_in_tree(),
			"color": [l.light_color.r, l.light_color.g, l.light_color.b]}
		if l is DirectionalLight3D:
			var dl := l as DirectionalLight3D
			d["mode"] = dl.directional_shadow_mode
			d["max_dist"] = dl.directional_shadow_max_distance
			d["blur"] = dl.shadow_blur
			d["rot"] = [dl.rotation_degrees.x, dl.rotation_degrees.y]
		lights.append(d)
	out["lights"] = lights
	# environment
	var we: Array = f.find_children("*", "WorldEnvironment", true, false)
	if not we.is_empty():
		var e: Environment = (we[0] as WorldEnvironment).environment
		out["environment"] = {"bg": e.background_mode, "tonemap": e.tonemap_mode, "exposure": e.tonemap_exposure, "white": e.tonemap_white,
			"glow": e.glow_enabled, "fog": e.fog_enabled, "fog_mode": e.fog_mode, "ssao": e.ssao_enabled, "ssr": e.ssr_enabled,
			"sdfgi": e.sdfgi_enabled, "ssil": e.ssil_enabled, "vol_fog": e.volumetric_fog_enabled, "adjust": e.adjustment_enabled,
			"lut": e.adjustment_color_correction != null, "ambient_src": e.ambient_light_source, "reflect_src": e.reflected_light_source,
			"ambient_energy": e.ambient_light_energy}
	# geometry in view, grouped
	var groups: Dictionary = {}
	var items: Array = []
	for n: Node in root.find_children("*", "GeometryInstance3D", true, false):
		var g := n as GeometryInstance3D
		if not g.is_visible_in_tree():
			continue
		var tris: int = 0
		var inst: int = 1
		var mesh: Mesh = null
		if g is MeshInstance3D:
			mesh = (g as MeshInstance3D).mesh
			tris = _tris(mesh)
		elif g is MultiMeshInstance3D and (g as MultiMeshInstance3D).multimesh != null:
			var mm: MultiMesh = (g as MultiMeshInstance3D).multimesh
			mesh = mm.mesh
			inst = mm.visible_instance_count if mm.visible_instance_count >= 0 else mm.instance_count
			tris = _tris(mesh) * inst
		else:
			continue
		var box: AABB = g.global_transform * g.get_aabb()
		var inview: bool = _aabb_in(planes, box)
		var mats: Array[String] = []
		if g.material_override != null:
			mats.append(_mat_name(g.material_override))
		elif mesh != null:
			for s: int in mesh.get_surface_count():
				var m: Material = (g as MeshInstance3D).get_active_material(s) if g is MeshInstance3D else mesh.surface_get_material(s)
				mats.append(_mat_name(m))
		var grp: String = _group(g, f)
		var key: String = "%s|%s" % [grp, "view" if inview else "off"]
		if not groups.has(key):
			groups[key] = {"nodes": 0, "tris": 0, "surfaces": 0, "shadow_casters": 0, "layers": {}}
		var gd: Dictionary = groups[key]
		gd["nodes"] += 1
		gd["tris"] += tris
		gd["surfaces"] += mesh.get_surface_count() if mesh != null else 0
		if g.cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
			gd["shadow_casters"] += 1
		if inview:
			items.append({"path": str(f.get_path_to(g)) if f.is_ancestor_of(g) else str(g.get_path()), "class": g.get_class(), "tris": tris,
				"inst": inst, "mats": mats, "shadow": g.cast_shadow, "layers": g.layers, "aabb_size": [box.size.x, box.size.y, box.size.z],
				"dist": cam.global_position.distance_to(box.get_center())})
	out["groups"] = groups
	items.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a["tris"]) > int(b["tris"]))
	out["top_in_view"] = items.slice(0, 60)
	out["in_view_tris"] = items.reduce(func(acc: int, it: Dictionary) -> int: return acc + int(it["tris"]), 0)
	# textures: every texture a material in the tree references (Godot 4.5 does not expose the renderer's own list to
	# scripts), deduplicated, sized from its image (mipmaps included), grouped by who uses it
	var seen: Dictionary = {}
	var tex: Array = []
	var by: Dictionary = {}
	for n: Node in root.find_children("*", "GeometryInstance3D", true, false):
		var g := n as GeometryInstance3D
		var grp: String = _group(g, f)
		var mats: Array[Material] = []
		if g.material_override != null:
			mats.append(g.material_override)
		if g.material_overlay != null:
			mats.append(g.material_overlay)
		var mesh: Mesh = null
		if g is MeshInstance3D:
			mesh = (g as MeshInstance3D).mesh
			for s: int in (mesh.get_surface_count() if mesh != null else 0):
				var sm: Material = (g as MeshInstance3D).get_surface_override_material(s)
				if sm != null:
					mats.append(sm)
		elif g is MultiMeshInstance3D and (g as MultiMeshInstance3D).multimesh != null:
			mesh = (g as MultiMeshInstance3D).multimesh.mesh
		if mesh != null:
			for s: int in mesh.get_surface_count():
				if mesh.surface_get_material(s) != null:
					mats.append(mesh.surface_get_material(s))
		for m: Material in mats:
			var ts: Array = []
			if m is BaseMaterial3D:
				for i: int in BaseMaterial3D.TEXTURE_MAX:
					ts.append((m as BaseMaterial3D).get_texture(i))
			elif m is ShaderMaterial and (m as ShaderMaterial).shader != null:
				for u: Dictionary in (m as ShaderMaterial).shader.get_shader_uniform_list():
					ts.append((m as ShaderMaterial).get_shader_parameter(str(u["name"])))
			for t: Variant in ts:
				if not (t is Texture) or seen.has(t):
					continue
				seen[t] = true
				var rec: Dictionary = {"class": (t as Object).get_class(), "path": (t as Resource).resource_path, "group": grp}
				var bytes: int = 0
				if t is Texture2D:
					var img: Image = (t as Texture2D).get_image()
					if img != null:
						bytes = img.get_data_size()
						rec["w"] = img.get_width()
						rec["h"] = img.get_height()
						rec["fmt"] = img.get_format()
						rec["mips"] = img.has_mipmaps()
						rec["compressed"] = img.is_compressed()
				elif t is Cubemap or t is TextureLayered:
					var tl := t as TextureLayered
					for li: int in tl.get_layers():
						var li_img: Image = tl.get_layer_data(li)
						if li_img != null:
							bytes += li_img.get_data_size()
							rec["w"] = li_img.get_width()
					rec["layers"] = tl.get_layers()
				elif t is Texture3D:
					for li_img: Image in (t as Texture3D).get_data():
						bytes += li_img.get_data_size()
					rec["w"] = (t as Texture3D).get_width()
				rec["mb"] = bytes / 1048576.0
				tex.append(rec)
				var src: String = grp if rec["path"] == "" else (grp + " (imported)")
				if not by.has(src):
					by[src] = {"n": 0, "mb": 0.0}
				by[src]["n"] += 1
				by[src]["mb"] += float(rec["mb"])
	tex.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["mb"]) > float(b["mb"]))
	out["textures_top"] = tex.slice(0, 60)
	out["textures_by_group"] = by
	out["textures_total_mb"] = tex.reduce(func(acc: float, r: Dictionary) -> float: return acc + float(r["mb"]), 0.0)
	out["textures_n"] = tex.size()
	var fo := FileAccess.open(out_path, FileAccess.WRITE)
	fo.store_string(JSON.stringify(out, "  "))
	fo.close()
	print("FID29 audit written %s draws=%d prims=%d tex=%.1f MB" % [out_path, out["monitors"]["draws"], out["monitors"]["prims"], out["textures_total_mb"]])
	quit(0)
