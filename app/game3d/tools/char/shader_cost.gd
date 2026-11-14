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


func _mat(b: BaseMaterial3D, look: Dictionary, key: String, cut: bool, mask: Texture2D = null) -> ShaderMaterial:
	var f: Node3D = FighterScript.new()
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
	_cfgs = [["body_high_b28mask", _mat(b0["body"], off_h, key, false, m0)], ["body_mid_b28mask", _mat(b1["body"], off_m, key, false, m1)]]
	_cfgs += [["body_high_b28", _mat(b0["body"], off_h, key, false)], ["body_high_new", _mat(b0["body"], high, key, false)],
		["body_mid_b28", _mat(b1["body"], off_m, key, false)], ["body_mid_new", _mat(b1["body"], mid, key, false)]]
	if b0.has("hair"):
		_cfgs += [["hair_high_b28", _mat(b0["hair"], off_h, key, true)], ["hair_high_new", _mat(b0["hair"], high, key, true)],
			["hair_mid_b28", _mat(b1["hair"], off_m, key, true)], ["hair_mid_new", _mat(b1["hair"], mid, key, true)]]
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
	root.get_viewport().msaa_3d = Viewport.MSAA_2X
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
				var bk: String = k.replace("_new", "_b28").replace("_b28mask", "_b28")
				var bm: String = k.replace("_new", "_b28mask")
				print("CQCOST %s ms_per_frame=%.2f ratio_to_b28=%.3f shader_ratio=%.3f shader_ratio_vs_b28mask=%.3f" % [k, med[k],
					med[k] / maxf(med.get(bk, med[k]), 1e-6), (med[k] - fl) / maxf(float(med.get(bk, med[k])) - fl, 1e-6),
					(med[k] - fl) / maxf(float(med.get(bm, med.get(bk, med[k]))) - fl, 1e-6)])
			return true
	_apply()
	return false
