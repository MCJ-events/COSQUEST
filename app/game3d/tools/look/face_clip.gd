extends SceneTree
## realism round 5: a short close clip of the hero's face (blinks and gaze), run outside the app:
##   xvfb-run -s "-screen 0 720x720x24" godot --path app/game3d --rendering-driver opengl3 --resolution 720x720 \
##     --fixed-fps 30 --write-movie /abs/out.avi --quit-after 200 -s res://tools/look/face_clip.gd -- --plan=/abs/plan.json
## plan.json: {"config": {fight config}, "secs": 5.0, "dist": 1.1, "yaw": 20, "look_cam_s": 2.5}
## Once the fight has started, the hero stops (autoplay off) and a camera stands `dist` in front of its face. For the
## first look_cam_s seconds the eyes look at this camera, then at the nearest opponent (as fight.gd does). Prints
## CQFACE lines (blinks counted by face_life.gd).

var plan: Dictionary = {}
var _cam: Camera3D
var _t: float = -1.0


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--plan="):
			plan = JSON.parse_string(FileAccess.get_file_as_string(a.substr(7)))
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	var cfg: Dictionary = plan.get("config", {})
	(func() -> void: root.get_node("Bridge").start_fight(JSON.stringify(cfg))).call_deferred()


func _fight() -> Node:
	var b: Node = root.get_node_or_null("Bridge")
	return b.get("_fight") if b != null else null


func _process(dt: float) -> bool:
	var f: Node = _fight()
	if f == null or not is_instance_valid(f):
		return false
	if _t < 0.0:
		if f.state != "fighting":
			return false
		_t = 0.0
		f.set("autoplay", false)
		var hud_layer: CanvasLayer = f.get_node_or_null("HudLayer")
		if hud_layer != null:
			hud_layer.visible = false
		_cam = Camera3D.new()
		_cam.fov = 30.0
		f.add_child(_cam)
		_cam.current = true
		var hero0: Node3D = f.get("hero")
		print("CQFACE start face_life=%s" % str(hero0.get("face_life") != null))
	_t += dt
	var hero: Node3D = f.get("hero")
	var fl: RefCounted = hero.get("face_life")
	var y: float = deg_to_rad(float(plan.get("yaw", 20.0)))
	var fwd := Vector3(sin(float(hero.get("yaw"))), 0.0, cos(float(hero.get("yaw"))))
	var dir: Vector3 = fwd.rotated(Vector3.UP, y)
	var face: Vector3 = hero.global_position + Vector3.UP * (2.3 * float(hero.get("size_k")) * 0.915)
	_cam.global_transform = Transform3D(Basis.looking_at(-dir, Vector3.UP), face + dir * float(plan.get("dist", 1.1)))
	if fl != null:
		fl.set("pinned", _t < float(plan.get("look_cam_s", 2.5)))
		if bool(fl.get("pinned")):
			fl.set("target", _cam.global_position)
	if _t >= float(plan.get("secs", 5.0)):
		print("CQFACE done t=%.2f blinks=%d" % [_t, int(fl.get("blinks")) if fl != null else -1])
		quit.call_deferred(0)
	return false
