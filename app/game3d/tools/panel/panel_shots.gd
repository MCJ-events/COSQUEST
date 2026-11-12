extends SceneTree
## Attack panel review (realism panel track, 12 Nov 2026): stills of a real fight with timed presses, and a
## probe of how often the hero's body is under one of the panel's buttons.
##   xvfb-run -s "-screen 0 720x1280x24" godot --path app/game3d --rendering-driver opengl3 --resolution 720x1280 \
##     --fixed-fps 30 -s res://tools/panel/panel_shots.gd -- --plan=/abs/plan.json
## plan.json: {"config": {fight config}, "out": "/abs/dir", "prefix": "port",
##   "input": [{"t": 1.0, "skill_slot": 5}, {"t": 2.0, "attack": true}, {"t": 3, "stick": [0, 1]}, {"t": 4, "autoplay": true}],
##   "shots": [{"t": 2.6, "name": "a"}], "quit_s": 12.0}
## Prints "CQPANEL ..." with the probe's shares and the fight's skill counts.

var plan: Dictionary = {}
var _frames: int = -1
var _shots: Array = []
var _inputs: Array = []
var _busy: bool = false
var _done: bool = false
var _n: int = 0
var _under: Dictionary = {}     # button id -> frames the hero's body box touched its halo disc
var _any: int = 0
var _head: int = 0


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--plan="):
			plan = JSON.parse_string(FileAccess.get_file_as_string(a.substr(7)))
	if plan.is_empty():
		push_error("panel_shots: need --plan=")
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(str(plan["out"]))
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
	if _frames < 0:
		if f.state == "fighting":
			_frames = 0
			print("CQPANEL fight_start frame=%d" % Engine.get_process_frames())   # where a --write-movie clip's fight begins
		else:
			return false
	_frames += 1
	var t: float = _frames / 30.0
	while not _inputs.is_empty() and float(_inputs[0]["t"]) <= t:
		var ev: Dictionary = _inputs.pop_front()
		if ev.has("stick"):
			f.hud.bot_stick(Vector2(float(ev["stick"][0]), float(ev["stick"][1])))
		if bool(ev.get("attack", false)):
			f.hud.bot_attack()
		if ev.has("hold"):
			f.hud.bot_attack_hold(bool(ev["hold"]))
		if ev.has("guard"):
			f.hud.bot_guard(bool(ev["guard"]))
		if ev.has("skill_slot"):
			f.hud.bot_skill_slot(int(ev["skill_slot"]))
		if ev.has("autoplay"):
			f.set("autoplay", bool(ev["autoplay"]))
	if f.state == "fighting":
		_probe(f)
	if not _shots.is_empty() and float(_shots[0]["t"]) <= t:
		_busy = true
		_take.call_deferred(_shots.pop_front())
	elif _shots.is_empty() and (t >= float(plan.get("quit_s", 46.0)) or f.state == "done"):
		_done = true
		var parts: PackedStringArray = []
		for k: String in _under:
			parts.append("%s=%.2f" % [k, 100.0 * float(_under[k]) / maxf(1.0, _n)])
		print("CQPANEL frames=%d hero_under_any_pct=%.2f head_under_any_pct=%.2f %s skills=%s outcome=%s" % [_n,
			100.0 * _any / maxf(1.0, _n), 100.0 * _head / maxf(1.0, _n), " ".join(parts), str(f.stats["skills"]), str(f.outcome)])
		quit.call_deferred(0)
	return false


## The hero's body on the screen (shoulder width, feet to head) against every button's halo disc and GUARD.
func _probe(f: Node) -> void:
	var hud: Control = f.get("hud")
	var cam: Camera3D = f.get("cam")
	var hero: Node3D = f.get("hero")
	if hud == null or cam == null or hero == null or str(hud.get("panel")) != "wale":
		return
	var vs: Vector2 = root.get_visible_rect().size
	var k: float = hud.size.x / vs.x if vs.x > 0.0 else 1.0
	var feet: Vector2 = cam.unproject_position(hero.global_position) * k
	var head: Vector2 = cam.unproject_position(hero.call("head_pos")) * k
	var half: float = absf(cam.unproject_position(hero.global_position + cam.global_basis.x * 0.45).x * k - feet.x)
	var box := Rect2(Vector2(feet.x - half, minf(head.y, feet.y)), Vector2(2.0 * half, absf(feet.y - head.y)))
	var discs: Array = [["attack", hud.call("attack_centre"), float(hud.W_ATTACK_R) * 1.2], ["guard", hud.call("guard_centre"), float(hud.GUARD_R) + 3.0]]
	for j in hud.W_BUTTONS.size():
		discs.append([str(hud.W_BUTTONS[j]["id"]), hud.call("wale_centre", j), float(hud.call("wale_r", j)) * 1.2])
	_n += 1
	var any: bool = false
	var hd: bool = false
	for d: Array in discs:
		var c: Vector2 = d[1]
		var near := Vector2(clampf(c.x, box.position.x, box.end.x), clampf(c.y, box.position.y, box.end.y))
		if near.distance_to(c) < float(d[2]):
			_under[d[0]] = int(_under.get(d[0], 0)) + 1
			any = true
		if head.distance_to(c) < float(d[2]):
			hd = true
	_any += 1 if any else 0
	_head += 1 if hd else 0


func _take(shot: Dictionary) -> void:
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(str(plan["out"]).path_join("%s_%s.png" % [str(plan.get("prefix", "panel")), str(shot["name"])]))
	_busy = false
