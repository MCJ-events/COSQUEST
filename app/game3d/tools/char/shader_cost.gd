extends SceneTree
## fid29 charshade: what char_real costs per pixel, build 28's path against the charshade variants (a CPU proxy for ALU:
## on Mesa llvmpipe the fragment shader runs on the CPU, so its time per frame follows its instruction count).
##   LP_NUM_THREADS=1 xvfb-run -s "-screen 0 720x1280x24" godot --path app/game3d --rendering-driver opengl3 \
##     --resolution 720x1280 -s res://tools/char/shader_cost.gd -- [--hero blockbusters_kofi] [--frames 40] [--rounds 5]
## A screen-filling quad with the hero's own body maps (lod0 for high, lod1 for mid), one directional key, the face fill
## on. Configs, interleaved round by round so load drifts cancel: b28 (cs_on false, the colour-guessed skin), mid
## (cs_on, the mask), high (the CS_HIGH variant, detail and break-up), and the same three on the hair cards' material
## (b28 cut, soft), and b28's mask path on the body (b28mask: the skin mask read that charshade's mask takes over;
## a "new / b28mask" ratio is then the ALU change alone). Prints "CQCOST <config> ms_per_frame=<median>" and the ratio to b28.
## --only=hair|body: those configs alone (more rounds in the same time). hair_high_newmid: the high look with the ally's
## 512 x 1024 atlas (the atlas size apart from the ALU). --prev=<path>: an earlier char_real.gdshader (outside res://) run
## as "<config>_prev" with the same variant edits and parameters, so two versions of the shader meet in one run.
## hair_mid_newhard / hair_mid_b28soft: the cut swapped (the soft cut's own cost apart from the shading).

const FighterScript := preload("res://fighter.gd")
const LoaderScript := preload("res://char_loader.gd")

var _cfgs: Array = []   # [name, material]; the last is the unshaded quad
var _mi: MeshInstance3D
var _i: int = 0
var _f: int = 0
var _round: int = 0
var _t0: int = 0
var _times: Dictionary = {}
var _frames: int = 40
var _rounds: int = 5
var _warm: int = 0


func _arg(n: String, d: String) -> String:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--" + n + "="):
			return a.substr(n.length() + 3)
	return d


func _body(path: String) -> Dictionary:
	var ld: Dictionary = LoaderScript.new().load_glb(path, true)
	var out: Dictionary = {}
	for n: Node in (ld["node"] as Node).find_children("*", "MeshInstance3D", true, false):
		var m: Mesh = (n as MeshInstance3D).mesh
		for s in m.get_surface_count():
			var b := m.surface_get_material(s) as BaseMaterial3D
			if b == null:
				continue
			if b.resource_name == "Material_0":
				out["body"] = b
			elif b.resource_name == "hair_cards":
				out["hair"] = b
	return out


func _mat(b: BaseMaterial3D, look: Dictionary, key: String, cut: bool, mask: Texture2D = null, role: String = "hero") -> ShaderMaterial:
	var f: Node3D = FighterScript.new()
	f.set("role", role)
	f.set("skin_mask", mask)     # b28's own mask path (a Forge guardian with a skin mask): the read charshade's mask replaces
	f.set("look", look)
	f.set("anim_opts", {"key": key})
	f.set("surface_kinds", {"hair_cards": "hair"} if cut else {})
	var sm: ShaderMaterial = f.call("_real_material", b)
	f.free()
	sm.set_shader_parameter("face_fill_col", Vector3(0.25, 0.2, 0.18))
	sm.set_shader_parameter("face_fill_dir", Vector3(0.0, 0.3, 1.0).normalized())
	return sm


func _initialize() -> void:
	var key: String = _arg("hero", "blockbusters_kofi")
	_frames = int(_arg("frames", "40"))
	_rounds = int(_arg("rounds", "5"))
	var arena := preload("res://arena.gd")
	var high: Dictionary = arena.look_opts({"tier": "high", "look": {"time": "golden"}})
	var mid: Dictionary = arena.look_opts({"tier": "mid", "look": {"time": "golden"}})
	var b0: Dictionary = _body("res://cast/heroes/%s_lod0.glb" % key)
	var b1: Dictionary = _body("res://cast/heroes/%s_lod1.glb" % key)
	var off_h: Dictionary = high.duplicate(); off_h["fid_charshade"] = false
	var off_m: Dictionary = mid.duplicate(); off_m["fid_charshade"] = false
	var m0: Texture2D = load("res://art/char/masks/%s_lod0.png" % key)
	var m1: Texture2D = load("res://art/char/masks/%s_lod1r.png" % key)
	var only: String = _arg("only", "all")
	_cfgs = []
	if only != "hair":
		_cfgs += [["body_high_b28mask", _mat(b0["body"], off_h, key, false, m0)], ["body_mid_b28mask", _mat(b1["body"], off_m, key, false, m1)]]
		_cfgs += [["body_high_b28", _mat(b0["body"], off_h, key, false)], ["body_high_new", _mat(b0["body"], high, key, false)],
			["body_mid_b28", _mat(b1["body"], off_m, key, false)], ["body_mid_new", _mat(b1["body"], mid, key, false)]]
	if b0.has("hair") and only != "body":
		_cfgs += [["hair_high_b28", _mat(b0["hair"], off_h, key, true)], ["hair_high_new", _mat(b0["hair"], high, key, true)],
			["hair_high_newmid", _mat(b0["hair"], high, key, true, null, "ally")],
			["hair_mid_b28", _mat(b1["hair"], off_m, key, true)], ["hair_mid_new", _mat(b1["hair"], mid, key, true)]]
	# what the hair cards' soft cut (alpha to coverage, the edge sharpening, the mip-kept alpha) costs apart from the shading:
	# the charshade parameters on build 28's hard 0.35 cut, and build 28's parameters on the soft cut
	if b0.has("hair") and only != "body":
		var ab: Array = []
		for c: Array in _cfgs:
			if String(c[0]) == "hair_mid_new" or String(c[0]) == "hair_mid_b28":
				var sm: ShaderMaterial = (c[1] as ShaderMaterial).duplicate()
				var vc: String = sm.shader.code
				var sh := Shader.new()
				if vc.find("alpha_to_coverage;") >= 0:
					var hk: int = vc.find("ALPHA = a.a;")
					sh.code = vc.replace("ambient_light_disabled, alpha_to_coverage;", "ambient_light_disabled;").replace(
						vc.substr(hk, vc.find("// ALPHA_HOOK", hk) - hk), "ALPHA = a.a; ALPHA_SCISSOR_THRESHOLD = 0.35; ")
					ab.append(["hair_mid_newhard", sm])
				else:
					sh.code = vc.replace("ambient_light_disabled;", "ambient_light_disabled, alpha_to_coverage;").replace(
						"ALPHA = a.a; ALPHA_SCISSOR_THRESHOLD = 0.35; ", "ALPHA = a.a; ALPHA_SCISSOR_THRESHOLD = 0.12; ALPHA_ANTIALIASING_EDGE = 0.3; " +
						"ALPHA_TEXTURE_COORDINATE = UV * vec2(textureSize(albedo_tex, 0)); ")
					ab.append(["hair_mid_b28soft", sm])
				sm.shader = sh
		_cfgs += ab
		# build 28's shading and hard cut on charshade's own strand atlas: the same texels and the same coverage, so
		# "hair_*_new / hair_*_b28atlas" is the per-pixel ALU change alone (the atlas also changes how many texels pass
		# the cut, which hair_*_new / hair_*_b28 folds in)
		var at: Array = []
		for c: Array in _cfgs:
			var nm: String = String(c[0])
			if nm == "hair_mid_new" or nm == "hair_high_new":
				var bb: ShaderMaterial = _mat(b0["hair"] if nm == "hair_high_new" else b1["hair"], off_h if nm == "hair_high_new" else off_m, key, true)
				bb.set_shader_parameter("albedo_tex", (c[1] as ShaderMaterial).get_shader_parameter("albedo_tex"))
				at.append([nm.replace("_new", "_b28atlas"), bb])
				# the strand atlas decompressed to RGBA8 with mipmaps, as build 28's own GLB hair texture is at runtime
				# (char_loader.gd add_mipmaps): llvmpipe decodes a VRAM-compressed texel in software on every fetch, which
				# a phone GPU does in the texture unit, so "_newraw / _b28" is the change at build 28's texture format
				var ct: Texture2D = (c[1] as ShaderMaterial).get_shader_parameter("albedo_tex")
				if ct != null:
					var img: Image = ct.get_image()
					if img.is_compressed():
						img.decompress()
					if not img.has_mipmaps():
						img.generate_mipmaps()
					var nr: ShaderMaterial = (c[1] as ShaderMaterial).duplicate()
					nr.set_shader_parameter("albedo_tex", ImageTexture.create_from_image(img))
					at.append([nm + "raw", nr])
		_cfgs += at
	# --raw=1 (15 Nov): the hair ALU at one texture format. Every config samples charshade's strand atlas decompressed to
	# RGBA8 with mipmaps (build 28's GLB texture is RGBA8 at runtime; llvmpipe decodes VRAM-compressed texels in software,
	# which swamped the earlier hair ratios): build 28's shading and hard cut (rawb28), charshade's hair shading on build
	# 28's hard 0.35 cut (rawcshard) and on the soft cut (rawcssoft). Prints alu_ratio = (config - flat) / (rawb28 - flat).
	if _arg("raw", "0") == "1" and b0.has("hair"):
		_cfgs = [["hair_high_b28", _mat(b0["hair"], off_h, key, true)], ["hair_mid_b28", _mat(b1["hair"], off_m, key, true)]]
		for t: Array in [["high", b0, high, off_h], ["mid", b1, mid, off_m]]:
			var lk: Dictionary = (t[2] as Dictionary).duplicate()
			lk["cs_hair_soft"] = true
			var soft: ShaderMaterial = _mat((t[1] as Dictionary)["hair"], lk, key, true)
			var tex: Texture2D = soft.get_shader_parameter("albedo_tex")
			var img: Image = tex.get_image()
			if img.is_compressed():
				img.decompress()
			if not img.has_mipmaps():
				img.generate_mipmaps()
			var raw := ImageTexture.create_from_image(img)
			soft.set_shader_parameter("albedo_tex", raw)
			var hard: ShaderMaterial = soft.duplicate()
			hard.shader = FighterScript._real_variant(soft.shader.code.contains("cull_disabled"), true)
			var bb: ShaderMaterial = _mat((t[1] as Dictionary)["hair"], t[3], key, true)
			bb.set_shader_parameter("albedo_tex", raw)
			_cfgs += [["hair_%s_rawb28" % t[0], bb], ["hair_%s_rawcshard" % t[0], hard], ["hair_%s_rawcssoft" % t[0], soft]]
	var prev: String = _arg("prev", "")
	if prev != "" and FileAccess.file_exists(prev):
		var pc: String = FileAccess.get_file_as_string(prev)
		var cur: String = (load("res://vfx/char_real.gdshader") as Shader).code
		var extra: Array = []
		for c: Array in _cfgs:
			if not String(c[0]).ends_with("_new") and not String(c[0]).ends_with("_newmid"):
				continue
			var sm: ShaderMaterial = (c[1] as ShaderMaterial).duplicate()
			var code: String = pc
			var vc: String = sm.shader.code
			# the variant edits fighter.gd made to this material's shader, made again on the earlier code
			if vc.find("render_mode cull_disabled,") >= 0:
				code = code.replace("render_mode cull_back,", "render_mode cull_disabled,")
			if vc.find("alpha_to_coverage;") >= 0:
				code = code.replace("ambient_light_disabled;", "ambient_light_disabled, alpha_to_coverage;")
			var hk: int = vc.find("ALPHA = a.a;")
			if hk >= 0:
				code = code.replace("// ALPHA_HOOK", vc.substr(hk, vc.find("// ALPHA_HOOK", hk) - hk) + "// ALPHA_HOOK")
			if vc.find("#define CS_HIGH") >= 0:
				code = code.replace("// CS_DEFINES", "#define CS_HIGH\n// CS_DEFINES")
			var sh := Shader.new()
			sh.code = code
			sm.shader = sh
			extra.append([String(c[0]) + "_prev", sm])
		_cfgs += extra
		print("CQCOST prev shader %s (%d configs), current %d chars" % [prev, extra.size(), cur.length()])
	var flat := StandardMaterial3D.new()
	flat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_cfgs.append(["flat", flat])
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 2.0
	cam.position = Vector3(0, 0, 2)
	root.add_child(cam)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -25, 0)
	sun.light_energy = 1.9
	root.add_child(sun)
	_mi = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1.2, 2.1)
	_mi.mesh = q
	root.add_child(_mi)
	root.msaa_3d = Viewport.MSAA_2X     # every tier runs MSAA (alpha to coverage needs it); root is the window's viewport
	_apply()


func _apply() -> void:
	_mi.material_override = _cfgs[_i][1]
	_f = 0
	_warm = 4


func _process(_d: float) -> bool:
	if _warm > 0:
		_warm -= 1
		_t0 = Time.get_ticks_usec()
		return false
	_f += 1
	if _f < _frames:
		return false
	var ms: float = (Time.get_ticks_usec() - _t0) / 1000.0 / _frames
	var n: String = _cfgs[_i][0]
	if not _times.has(n):
		_times[n] = []
	_times[n].append(ms)
	_i += 1
	if _i >= _cfgs.size():
		_i = 0
		_round += 1
		if _round >= _rounds:
			var med: Dictionary = {}
			for k: String in _times:
				var a: Array = _times[k]
				a.sort()
				med[k] = a[a.size() / 2]
			# the fixed cost of a frame (clear, resolve, the quad's vertices) is the unshaded quad's time: what is left is
			# the fragment shader's, the ALU proxy
			var fl: float = float(med.get("flat", 0.0))
			for k: String in med:
				if k.ends_with("_new") and med.has(k.replace("_new", "_b28atlas")):
					var ba: float = float(med[k.replace("_new", "_b28atlas")])
					print("CQCOST %s alu_ratio_same_atlas=%.3f" % [k, (med[k] - fl) / maxf(ba - fl, 1e-6)])
				for sfx: String in ["_rawcshard", "_rawcssoft", "_b28"]:
					if k.ends_with(sfx) and med.has(k.replace(sfx, "_rawb28")):
						var rb: float = float(med[k.replace(sfx, "_rawb28")])
						print("CQCOST %s alu_ratio_vs_rawb28=%.3f" % [k, (med[k] - fl) / maxf(rb - fl, 1e-6)])
				if k.ends_with("_newraw") and med.has(k.replace("_newraw", "_b28")):
					var b2: float = float(med[k.replace("_newraw", "_b28")])
					print("CQCOST %s shader_ratio_b28_format=%.3f" % [k, (med[k] - fl) / maxf(b2 - fl, 1e-6)])
				var bk: String = k.replace("_prev", "").replace("_b28atlas", "_b28").replace("_newmid", "_b28").replace("_newhard", "_b28").replace("_b28soft", "_b28").replace("_new", "_b28").replace("_b28mask", "_b28")
				var bm: String = k.replace("_prev", "").replace("_newmid", "_b28mask").replace("_new", "_b28mask")
				print("CQCOST %s ms_per_frame=%.2f ratio_to_b28=%.3f shader_ratio=%.3f shader_ratio_vs_b28mask=%.3f" % [k, med[k],
					med[k] / maxf(med.get(bk, med[k]), 1e-6), (med[k] - fl) / maxf(float(med.get(bk, med[k])) - fl, 1e-6),
					(med[k] - fl) / maxf(float(med.get(bm, med.get(bk, med[k]))) - fl, 1e-6)])
			return true
	_apply()
	return false
