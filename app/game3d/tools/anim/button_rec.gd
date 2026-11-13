extends SceneTree
## anim-readable (13 Nov 2026): a scripted fight for button review clips, with a per-frame log of what the
## hero plays and where it stands on the screen (to cut and crop each button's moment from a
## --write-movie recording). Works on any build from 22 on (drop it into that tree's tools/anim).
##   xvfb-run -s "-screen 0 720x1280x24" godot --path app/game3d --rendering-driver opengl3 --resolution 720x1280 \
##     --fixed-fps 30 --write-movie /abs/out.avi -s res://tools/anim/button_rec.gd -- --plan=/abs/plan.json
## plan.json: {"config": {fight config}, "input": [{"t": 1.0, "skill_slot": 5}, {"t": 2.0, "attack": true},
##   {"t": 3, "stick": [0, 1]}, {"t": 4, "guard": true}, {"t": 5, "autoplay": true}], "quit_s": 20.0}
## Prints "CQREC start frame=N" when the fight starts, then one line per frame:
##   CQREC f=<process frame> t=<s> st=<hero animation state> clip=<clip> act=<fight action> sk=<skill slot>
##     x=<feet x px> y=<feet y px> hy=<head y px> e=<Guardian state> ex=<Guardian x px> ey=<Guardian feet y>

var plan: Dictionary = {}
var _frames: int = -1
var _inputs: Array = []
var _done: bool = false


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--plan="):
			plan = JSON.parse_string(FileAccess.get_file_as_string(a.substr(7)))
	if plan.is_empty():
		push_error("button_rec: need --plan=")
		quit(2)
		return
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
	if f == null or not is_instance_valid(f):
		return false
	if _frames < 0:
		if f.state == "fighting":
			_frames = 0
			print("CQREC start frame=%d" % Engine.get_process_frames())
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
		if ev.has("guard"):
			f.hud.bot_guard(bool(ev["guard"]))
		if ev.has("skill_slot"):
			f.hud.bot_skill_slot(int(ev["skill_slot"]))
		if ev.has("autoplay"):
			f.set("autoplay", bool(ev["autoplay"]))
	var cam: Camera3D = f.get("cam")
	var hero: Node3D = f.get("hero")
	var enemy: Node3D = f.get("enemy")
	if cam != null and hero != null:
		var vs: Vector2 = root.get_visible_rect().size
		var feet: Vector2 = cam.unproject_position(hero.global_position)
		var head: Vector2 = cam.unproject_position(hero.call("head_pos"))
		var an: Object = hero.get("anim")
		var st: String = str(an.get("state")) if an != null else ""
		var pl: AnimationPlayer = an.get("player") if an != null else null
		var clip: String = str(pl.current_animation).get_file() if pl != null else ""
		var ef: Vector2 = cam.unproject_position(enemy.global_position) if enemy != null else Vector2.ZERO
		var est: String = str((enemy.get("anim") as Object).get("state")) if enemy != null and enemy.get("anim") != null else ""
		print("CQREC f=%d t=%.3f st=%s clip=%s act=%s sk=%d x=%.0f y=%.0f hy=%.0f w=%.0f h=%.0f e=%s ex=%.0f ey=%.0f" % [Engine.get_process_frames(), t, st, clip,
			str(f.get("_action")), int(f.get("_skill")), feet.x, feet.y, head.y, vs.x, vs.y, est, ef.x, ef.y])
	if t >= float(plan.get("quit_s", 46.0)) or str(f.state) == "done":
		_done = true
		print("CQREC end frames=%d outcome=%s skills=%s" % [_frames, str(f.get("outcome")), str((f.get("stats") as Dictionary).get("skills"))])
		quit.call_deferred(0)
	return false
