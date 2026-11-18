extends SceneTree
## fid29-dressing review tool (not shipped): every photo prop (LOD0 and LOD1) and the plane in a row on a grey floor
## under the golden key, with the real prop material (world_prop.gdshader), drawn from the front and the 3/4 view.
##   xvfb ... godot --path . --rendering-driver opengl3 --resolution 1600x900 -s res://tools/props/prop_sheet.gd -- --out=/abs/dir [--tier=high]

const PROP_SHADER := preload("res://vfx/world_prop.gdshader")
const LookReal := preload("res://look_real.gd")
const KINDS: Array[String] = ["street_lamp_01", "street_lamp_02", "utility_box_02", "utility_box_01", "standing_chalkboard_01",
	"outdoor_table_chair_set_01", "trashbag", "painted_wooden_bench", "planter_box_01", "concrete_road_barrier",
	"security_light", "covered_car"]

var out_dir: String = "/tmp"
var tier: String = "high"
var _frame: int = 0
var _cam: Camera3D


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out_dir = a.substr(6)
		elif a.begins_with("--tier="):
			tier = a.substr(7)
	var w := Node3D.new()
	root.add_child(w)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.62, 0.7, 0.82)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.64, 0.78)
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	var we := WorldEnvironment.new()
	we.environment = env
	w.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-34.0, -128.0, 0.0)
	sun.light_color = Color(1.0, 0.84, 0.68)
	sun.light_energy = 1.9
	sun.shadow_enabled = true
	w.add_child(sun)
	var fl := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(80, 30)
	fl.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.55, 0.53, 0.5)
	fl.material_override = fm
	w.add_child(fl)
	var sm := ShaderMaterial.new()
	sm.shader = PROP_SHADER
	sm.set_shader_parameter("albedo_tex", load("res://art/world/props/props_%s_a.png" % tier))
	sm.set_shader_parameter("normal_tex", load("res://art/world/props/props_%s_n.png" % tier))
	sm.set_shader_parameter("orm_tex", load("res://art/world/props/props_%s_orm.png" % tier))
	var e: Dictionary = LookReal.env_for("golden")
	if not e.is_empty():
		sm.set_shader_parameter("amb_cube", e["amb"])
		sm.set_shader_parameter("env_cube", e["cube"])
		sm.set_shader_parameter("env_scale", e["scale"])
		sm.set_shader_parameter("env_lods", e["lods"])
		sm.set_shader_parameter("env_spec", 1.0 if tier == "high" else 0.0)
	var x: float = -26.0
	for k: String in KINDS:
		for lod in 2:
			var mi := MeshInstance3D.new()
			mi.mesh = load("res://art/world/props/%s_lod%d.res" % [k, lod])
			mi.material_override = sm
			mi.position = Vector3(x, 0, -3.0 * lod)
			w.add_child(mi)
		x += 4.4 if k != "covered_car" else 5.0
	_cam = Camera3D.new()
	_cam.fov = 40
	w.add_child(_cam)
	_cam.current = true


func _process(_dt: float) -> bool:
	_frame += 1
	var views: Array = [[Vector3(0, 6, 34), Vector3(0, 1, 0)], [Vector3(-14, 3, 9), Vector3(-17, 1, -1)], [Vector3(8, 3, 9), Vector3(4, 1, -1)]]
	var v: int = (_frame - 3) / 3
	if _frame >= 3 and (_frame - 3) % 3 == 0 and v < views.size():
		_cam.position = views[v][0]
		_cam.look_at(views[v][1])
	if _frame >= 5 and (_frame - 5) % 3 == 0:
		var i: int = (_frame - 5) / 3
		if i < views.size():
			root.get_viewport().get_texture().get_image().save_png(out_dir.path_join("props_%s_v%d.png" % [tier, i]))
		else:
			return true
	return false
