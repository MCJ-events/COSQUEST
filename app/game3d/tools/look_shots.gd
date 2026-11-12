extends SceneTree
## Realism review stills and the numbers of BAR.md section D (11 Nov 2026), run outside the app:
##   xvfb-run -s "-screen 0 720x1280x24" godot --path app/game3d --rendering-driver opengl3 --resolution 720x1280 \
##     --fixed-fps 30 -s res://tools/look_shots.gd -- --plan=/abs/plan.json
## plan.json: {"config": {fight config}, "out": "/abs/dir", "prefix": "cast_golden_after",
##   "input": [{"t": 1.0, "skill_slot": 2}], "shots": [{"t": 2.6, "name": "a"}], "quit_s": 4.0,
##   "side": {"dist": 9, "pitch": 16, "yaw": 70}, "close": {"dist": 4.2, "pitch": 8, "yaw": 150, "who": "hero"},
##   "masks": true}
## At each shot the fight is paused and the same moment is drawn from the game camera (with and without the
## HUD), the side camera and the close camera. With "masks", each view is also drawn with the fighters white
## then black, and with discs on the ground under them (2 m round each fighter; 0.2 m under each foot) white
## then black: tools/look/measure.py takes the differences as the character, ground and foot masks.
## Prints CQLOOK lines (texture memory, draw calls, frame time) for the cost table.

var plan: Dictionary = {}
var out_dir: String = ""
var prefix: String = "shot"
var _fight_frames: int = -1
var _shots: Array = []
var _inputs: Array = []
var _busy: bool = false
var _done: bool = false
var _t0_usec: int = 0
var _frame_ms: Array[float] = []
var _last_usec: int = 0
var _cam: Camera3D
var _intro_done: bool = false
var _win_done: bool = false


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--plan="):
			plan = JSON.parse_string(FileAccess.get_file_as_string(a.substr(7)))
	out_dir = str(plan.get("out", ""))
	prefix = str(plan.get("prefix", "shot"))
	if plan.is_empty() or out_dir == "":
		push_error("look_shots: need --plan= with an out dir")
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(out_dir)
	_shots = (plan.get("shots", []) as Array).duplicate()
	_inputs = (plan.get("input", []) as Array).duplicate()
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	var cfg: Dictionary = plan.get("config", {})
	(func() -> void: root.get_node("Bridge").start_fight(JSON.stringify(cfg))).call_deferred()


func _fight() -> Node:
	var b: Node = root.get_node_or_null("Bridge")
	return b.get("_fight") if b != null else null


func _process(_dt: float) -> bool:
	if _done:
		return true
	var f: Node = _fight()
	if f == null or not is_instance_valid(f) or _busy:
		return false
	# round 2: "beat_shot": seconds into the hero's intro shot (a tier without one: the fight's first frame);
	# "win_shot": seconds after the fight ends in a win. Both from the game camera only.
	if plan.has("beat_shot") and not _intro_done:
		var bt: float = float(f.get("_beat_t"))
		if (f.state == "intro" and bt >= float(plan["beat_shot"])) or f.state == "fighting":
			_intro_done = true
			_busy = true
			_take.call_deferred({"name": "intro", "game_only": true}, f)
			return false
	if plan.has("win_shot") and not _win_done and f.state == "ending" and float(f.get("_end_t")) >= float(plan["win_shot"]):
		_win_done = true
		_busy = true
		_take.call_deferred({"name": "win", "game_only": true, "then_quit": true}, f)
		return false
	if _fight_frames < 0:
		if f.state == "fighting":
			_fight_frames = 0
			_last_usec = Time.get_ticks_usec()
		else:
			return false
	var now: int = Time.get_ticks_usec()
	if _fight_frames > 2:
		_frame_ms.append((now - _last_usec) / 1000.0)
	_last_usec = now
	_fight_frames += 1
	var t: float = _fight_frames / 30.0
	while not _inputs.is_empty() and float(_inputs[0]["t"]) <= t:
		var ev: Dictionary = _inputs.pop_front()
		if ev.has("stick"):
			f.hud.bot_stick(Vector2(float(ev["stick"][0]), float(ev["stick"][1])))
		if bool(ev.get("attack", false)):
			f.hud.bot_attack()
		if ev.has("skill_slot"):
			f.hud.bot_skill_slot(int(ev["skill_slot"]))
		if ev.has("autoplay"):
			f.set("autoplay", bool(ev["autoplay"]))
	if not _shots.is_empty() and float(_shots[0]["t"]) <= t:
		_busy = true
		_take.call_deferred(_shots.pop_front(), f)
	elif _shots.is_empty() and ((t >= float(plan.get("quit_s", 0.0)) and not plan.has("win_shot")) or _win_done or f.state == "done" or t > 44.0):
		_done = true
		quit.call_deferred(0)
	return false


func _save(name: String) -> void:
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(out_dir.path_join("%s_%s.png" % [prefix, name]))


func _fighters(f: Node) -> Array:
	var out: Array = []
	for k: String in ["hero", "ally", "enemy"]:
		var o: Node3D = f.get(k)
		if o != null and o.visible:
			out.append([k, o])
	return out


func _view_cam(f: Node, spec: Dictionary) -> void:
	if _cam == null:
		_cam = Camera3D.new()
		_cam.near = 0.1
		_cam.far = 600.0
		f.add_child(_cam)
	var hero: Node3D = f.get("hero")
	var enemy: Node3D = f.get("enemy")
	var who: String = str(spec.get("who", "pair"))
	var target: Vector3 = hero.global_position
	if who == "pair" and enemy != null:
		target = hero.global_position.lerp(enemy.global_position, 0.5)
	elif who != "hero" and f.get(who) != null:
		target = (f.get(who) as Node3D).global_position
	target.y = float(spec.get("height", 1.1))
	var b: Basis = Basis.from_euler(Vector3(deg_to_rad(-float(spec.get("pitch", 16.0))), deg_to_rad(float(spec.get("yaw", 70.0))), 0.0))
	_cam.fov = float(spec.get("fov", (f.get("cam") as Camera3D).fov))
	_cam.global_transform = Transform3D(b, target + b.z * float(spec.get("dist", 9.0)))
	_cam.current = true


func _take(s: Dictionary, f: Node) -> void:
	paused = true
	var name: String = str(s["name"])
	var hud_layer: CanvasLayer = f.get_node_or_null("HudLayer")
	var game_cam: Camera3D = f.get("cam")
	var n_ms: int = _frame_ms.size()
	var sorted_ms: Array[float] = _frame_ms.duplicate()
	sorted_ms.sort()
	print("CQLOOK perf %s_%s frames=%d frame_ms_p50=%.1f tex_mb=%.1f vmem_mb=%.1f buf_mb=%.1f draws=%d prims=%d objects=%d" % [prefix, name, n_ms,
		sorted_ms[n_ms / 2] if n_ms > 0 else 0.0, Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0,
		Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, Performance.get_monitor(Performance.RENDER_BUFFER_MEM_USED) / 1048576.0,
		Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)])
	var views: Array = [["game", {}]]
	if plan.has("side") and not bool(s.get("game_only", false)):
		views.append(["side", plan["side"]])
	if plan.has("close") and not bool(s.get("game_only", false)):
		views.append(["close", plan["close"]])
	var meta: Dictionary = {"prefix": prefix, "shot": name, "views": {}}
	for v: Array in views:
		var vn: String = str(v[0])
		if vn == "game":
			if _cam != null:
				_cam.current = false
			game_cam.current = true
			if hud_layer != null:
				hud_layer.visible = true
			await _save(name + "_game_hud")
		else:
			_view_cam(f, v[1])
		# the review cameras look at the characters: no effects across them (as the earlier review captures)
		var fxn: Node3D = f.get("fx")
		if fxn != null:
			fxn.visible = vn == "game" or bool((v[1] as Dictionary).get("fx", false))
		if hud_layer != null:
			hud_layer.visible = false
		await _save("%s_%s" % [name, vn])
		var cam: Camera3D = root.get_viewport().get_camera_3d()
		var boxes: Dictionary = {}
		for kf: Array in _fighters(f):
			boxes[str(kf[0])] = _screen_box(cam, kf[1] as Node3D)
		(meta["views"] as Dictionary)[vn] = boxes
		if bool(plan.get("masks", false)):
			await _masks(f, "%s_%s" % [name, vn])
	if hud_layer != null:
		hud_layer.visible = true
	if f.get("fx") != null:
		(f.get("fx") as Node3D).visible = true
	if _cam != null:
		_cam.current = false
	game_cam.current = true
	var mf := FileAccess.open(out_dir.path_join("%s_%s.json" % [prefix, name]), FileAccess.WRITE)
	mf.store_string(JSON.stringify(meta))
	mf.close()
	print("CQLOOK shot %s_%s t=%.2f" % [prefix, name, _fight_frames / 30.0])
	paused = false
	_busy = false
	if bool(s.get("then_quit", false)):
		_done = true
		quit.call_deferred(0)


## The fighter's box on the screen [x0, y0, x1, y1] in pixels of the saved image.
func _screen_box(cam: Camera3D, o: Node3D) -> Array:
	var sz: Vector2 = Vector2(root.get_viewport().get_texture().get_size())
	var vis: Vector2 = root.get_viewport().get_visible_rect().size
	var k: Vector2 = sz / vis
	var h: float = 2.3 * float(o.get("size_k"))
	var r: float = 0.8 * float(o.get("size_k"))
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for dx: float in [-r, r]:
		for dz: float in [-r, r]:
			for y: float in [0.0, h]:
				var p: Vector3 = o.global_position + Vector3(dx, y, dz)
				if cam.is_position_behind(p):
					continue
				var q: Vector2 = cam.unproject_position(p) * k
				lo = lo.min(q)
				hi = hi.max(q)
	return [lo.x, lo.y, hi.x, hi.y]


func _flat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c
	m.disable_fog = true
	return m


func _masks(f: Node, tag: String) -> void:
	var white: StandardMaterial3D = _flat(Color(1, 1, 1))
	var black: StandardMaterial3D = _flat(Color(0, 0, 0))
	var meshes: Array[MeshInstance3D] = []
	var discs: Array[MeshInstance3D] = []
	var feet: Array[MeshInstance3D] = []
	for kf: Array in _fighters(f):
		var o: Node3D = kf[1]
		var body: Node = o.get("body")
		for n: Node in body.find_children("*", "MeshInstance3D", true, false):
			if (n as MeshInstance3D).is_visible_in_tree():
				meshes.append(n)
		var d := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 2.0
		cm.bottom_radius = 2.0
		cm.height = 0.004
		cm.radial_segments = 40
		d.mesh = cm
		d.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		d.visible = false
		f.add_child(d)
		d.global_position = Vector3(o.global_position.x, 0.075, o.global_position.z)
		discs.append(d)
		for ft: Array in o.get("_feet"):
			var fm: MeshInstance3D = ft[0]
			var fd := MeshInstance3D.new()
			var fc := CylinderMesh.new()
			fc.top_radius = 0.2 * float(o.get("size_k"))
			fc.bottom_radius = fc.top_radius
			fc.height = 0.004
			fd.mesh = fc
			fd.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			fd.visible = false
			f.add_child(fd)
			fd.global_position = Vector3(fm.global_position.x, 0.085, fm.global_position.z)
			fd.set_meta("planted", fm.visible)
			feet.append(fd)
	var fx: Node3D = f.get("fx")
	var fx_was: bool = fx.visible if fx != null else false
	var bloom_q: Node3D = (f.get("cam") as Node).get_node_or_null("BloomAdd")
	if bloom_q != null:
		bloom_q.visible = false
	if fx != null:
		fx.visible = false
	await _save(tag + "_m_nofx")    # the frame without effects: what the light alone does (measure.py)
	# 1. the fighters white, then black: the character mask
	var was: Array = []
	for m: MeshInstance3D in meshes:
		was.append(m.material_override)
		m.material_override = white
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	await _save(tag + "_m_c1")
	for m: MeshInstance3D in meshes:
		m.material_override = black
	await _save(tag + "_m_c0")
	# 2. the ground discs (the fighters stay black, in front): the ground each stands on
	for d: MeshInstance3D in discs:
		d.visible = true
		d.material_override = white
	await _save(tag + "_m_g1")
	for d: MeshInstance3D in discs:
		d.material_override = black
	await _save(tag + "_m_g0")
	# 3. the discs under the planted feet
	for d: MeshInstance3D in feet:
		d.visible = bool(d.get_meta("planted"))
		d.material_override = white
	await _save(tag + "_m_f1")
	for d: MeshInstance3D in feet:
		d.material_override = black
	await _save(tag + "_m_f0")
	for d: MeshInstance3D in discs + feet:
		d.queue_free()
	for i in meshes.size():
		var m: MeshInstance3D = meshes[i]
		m.material_override = was[i]
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	if fx != null:
		fx.visible = fx_was
	if bloom_q != null:
		bloom_q.visible = true
