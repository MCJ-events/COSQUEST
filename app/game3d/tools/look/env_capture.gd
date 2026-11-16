extends SceneTree
## Captures the street's light for the real look (realism 11 Nov 2026): six 90 degree views from where the
## fight stands, per time of day, in linear light (the tonemap set to linear at a low exposure so nothing
## clips), with the fighters and effects out of the way. tools/look/bake_env.py turns them into the
## prefiltered cube and the six ambient colours in data/look_real.json.
##   xvfb-run godot --path app/game3d --rendering-driver opengl3 --resolution 720x1280 --fixed-fps 30 \
##     -s res://tools/look/env_capture.gd -- --out=/abs/dir [--times=golden,day,dusk,night] [--size=128] [--look={json}]
## --look merges keys into the capture's look (fid29-lightcam: {"fid_lightcam": true} captures under the real sky, for
## bake_env.py --group env_lc).
## Saves <out>/env_<time>_<face>.png (faces px nx py ny pz nz) and <out>/env_<time>.json (exposure, key).

const EXPOSURE: float = 0.25        # stored value = radiance x this (sRGB encoded): radiance up to 4 survives
const AT: Vector3 = Vector3(0.0, 1.2, 1.5)
const FACES: Array = [["px", Vector3(1, 0, 0), Vector3(0, 1, 0)], ["nx", Vector3(-1, 0, 0), Vector3(0, 1, 0)],
	["py", Vector3(0, 1, 0), Vector3(0, 0, -1)], ["ny", Vector3(0, -1, 0), Vector3(0, 0, 1)],
	["pz", Vector3(0, 0, 1), Vector3(0, 1, 0)], ["nz", Vector3(0, 0, -1), Vector3(0, 1, 0)]]

var out_dir: String = ""
var times: PackedStringArray = ["golden", "day", "dusk", "night"]
var size: int = 128
var _ti: int = -1
var _state: String = "next"
var _wait: int = 0
var look_extra: Dictionary = {}


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out_dir = a.substr(6)
		elif a.begins_with("--times="):
			times = a.substr(8).split(",")
		elif a.begins_with("--size="):
			size = int(a.substr(7))
		elif a.begins_with("--look="):
			var lx: Variant = JSON.parse_string(a.substr(7))
			look_extra = lx if lx is Dictionary else {}
	DirAccess.make_dir_recursive_absolute(out_dir)
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main


func _fight() -> Node:
	var b: Node = root.get_node_or_null("Bridge")
	return b.get("_fight") if b != null else null


func _process(_dt: float) -> bool:
	if _state == "busy":
		return false
	if _state == "next":
		_ti += 1
		if _ti >= times.size():
			quit(0)
			return true
		var cfg: Dictionary = {"mode": "full", "duration_s": 45, "autoplay": false, "seed": 1, "load_thread": false, "place_thread": false,
			"quality": "low", "render_scale": 0.5, "dyn_res": false, "music": false, "sound": false, "intro": false,
			"tier": "mid",    # the street as the real look draws it (round 2: the turned key, the paving's exposure)
			"look": {"time": times[_ti], "night": true, "bloom": false, "shadows": false}}
		(cfg["look"] as Dictionary).merge(look_extra, true)
		root.get_node("Bridge").start_fight.call_deferred(JSON.stringify(cfg))
		_state = "load"
		_wait = 0
		return false
	var f: Node = _fight()
	if f == null or not is_instance_valid(f):
		return false
	if _state == "load":
		if f.state == "fighting":
			_wait += 1
			# the fighters, their shadows and the effects out of the views
			for k: String in ["hero", "ally", "enemy"]:
				var o: Node3D = f.get(k)
				if o != null:
					o.position = Vector3(40.0 + 6.0 * _wait, 0.0, 300.0)
			if _wait > 6:
				_state = "busy"
				_shoot.call_deferred(f)
	return false


func _shoot(f: Node) -> void:
	paused = true
	var time: String = times[_ti]
	var arena: Node = f.get("arena")
	var env: Environment = arena.get("env")
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = EXPOSURE
	env.fog_enabled = false
	(f.get("fx") as Node3D).visible = false
	var vp := SubViewport.new()
	vp.size = Vector2i(size, size)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.msaa_3d = Viewport.MSAA_DISABLED
	var cam := Camera3D.new()
	cam.fov = 90.0
	cam.near = 0.1
	cam.far = 600.0
	vp.add_child(cam)
	f.add_child(vp)
	cam.current = true
	for face: Array in FACES:
		cam.look_at_from_position(AT, AT + (face[1] as Vector3), face[2] as Vector3)
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		vp.get_texture().get_image().save_png(out_dir.path_join("env_%s_%s.png" % [time, str(face[0])]))
	var tp: Dictionary = (arena.get_script() as GDScript).get("TIMES")[time]
	var kd: Vector3 = arena.call("key_dir")
	var amb: Color = tp["ambient"]
	var kc: Color = tp["key_color"]
	var meta := FileAccess.open(out_dir.path_join("env_%s.json" % time), FileAccess.WRITE)
	meta.store_string(JSON.stringify({"time": time, "exposure": EXPOSURE, "size": size, "at": [AT.x, AT.y, AT.z],
		"ambient": [amb.r, amb.g, amb.b], "ambient_energy": tp["ambient_energy"], "key_color": [kc.r, kc.g, kc.b],
		"key_energy": tp["key_energy"], "key_dir": [kd.x, kd.y, kd.z]}))
	meta.close()
	print("CQENV captured %s" % time)
	vp.queue_free()
	paused = false
	_state = "next"
