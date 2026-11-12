extends SceneTree
## realism round 2: what the fight camera shows over a whole seeded fight.
##   xvfb-run godot --path app/game3d --rendering-driver opengl3 --resolution 720x1280 --fixed-fps 30 \
##     -s res://tools/look/cam_probe.gd -- --config=/abs/config.json --out=/abs/probe.csv
## Every frame of the fight (state "fighting"): the hero's height as a share of the screen's height, whether
## the Guardian's chest is on the screen, and whether the hero's body is under a HUD control (the stick, the
## attack panel, the top block). Prints the medians and shares, and the fight's result line.

var cfg: Dictionary = {}
var out_path: String = ""
var rows: PackedStringArray = ["t,hero_h,target_on,hud_over,cam_dist"]
var heights: Array[float] = []
var n: int = 0
var n_target: int = 0
var n_off: int = 0
var n_hud: int = 0
var n_head: int = 0       # round 3: the hero's or the target's head under a HUD control
var _done: bool = false


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--config="):
			cfg = JSON.parse_string(FileAccess.get_file_as_string(a.substr(9)))
		elif a.begins_with("--out="):
			out_path = a.substr(6)
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	(func() -> void:
		var bridge: Node = root.get_node("Bridge")
		bridge.call("set_result_callback", func(j: String) -> void:
			if not j.contains("\"event\"") and not _done:
				_done = true
				_finish(j))
		bridge.call("start_fight", JSON.stringify(cfg))).call_deferred()


func _process(_dt: float) -> bool:
	var b: Node = root.get_node_or_null("Bridge")
	var f: Node = b.get("_fight") if b != null else null
	if _done or f == null or not is_instance_valid(f) or f.state != "fighting":
		return false
	var cam: Camera3D = f.get("cam")
	var hero: Node3D = f.get("hero")
	var enemy: Node3D = f.get("enemy")
	var hud: Control = f.get("hud")
	if cam == null or hero == null or hero.get("dead"):
		return false
	var vs: Vector2 = root.get_viewport().get_visible_rect().size
	var top: Vector3 = hero.global_position + Vector3.UP * 2.3 * float(hero.get("size_k"))
	var feet: Vector2 = cam.unproject_position(hero.global_position)
	var head: Vector2 = cam.unproject_position(top)
	var h: float = absf(feet.y - head.y) / vs.y
	var on: int = -1
	if enemy != null and not enemy.get("dead"):
		var chest: Vector3 = enemy.global_position + Vector3.UP * 1.3 * float(enemy.get("size_k"))
		var q: Vector2 = cam.unproject_position(chest)
		on = 1 if (not cam.is_position_behind(chest) and q.x >= 0.0 and q.x <= vs.x and q.y >= 0.0 and q.y <= vs.y) else 0
		n_target += 1
		if on == 0:
			n_off += 1
	# the hero's body on the screen: shoulder width across, feet to head
	var half: float = absf(cam.unproject_position(hero.global_position + cam.global_basis.x * 0.45).x - feet.x)
	var box := Rect2(Vector2(feet.x - half, minf(head.y, feet.y)), Vector2(2.0 * half, absf(feet.y - head.y)))
	var over: int = 0
	var land: bool = vs.x > vs.y
	if box.position.y < (float(hud.get("top_shift")) + (112.0 if land else 150.0)):
		over = 1
	for c: Array in [[hud.call("_stick_home"), 118.0], [hud.call("attack_centre"), float(hud.call("attack_r")) * 1.9]]:
		var cc: Vector2 = c[0]
		var near := Vector2(clampf(cc.x, box.position.x, box.end.x), clampf(cc.y, box.position.y, box.end.y))
		if near.distance_to(cc) < float(c[1]):
			over = 1
	# round 3: the heads. The hero's and the target's head point against the same controls
	var heads: Array[Vector3] = [hero.global_position + Vector3.UP * 2.0 * float(hero.get("size_k"))]
	if enemy != null and not enemy.get("dead"):
		heads.append(enemy.global_position + Vector3.UP * 2.0 * float(enemy.get("size_k")))
	var head_over: int = 0
	for hp: Vector3 in heads:
		if cam.is_position_behind(hp):
			continue
		var q2: Vector2 = cam.unproject_position(hp)
		if q2.x < 0.0 or q2.x > vs.x or q2.y < 0.0 or q2.y > vs.y:
			continue
		if q2.y < (float(hud.get("top_shift")) + (112.0 if land else 150.0)):
			head_over = 1
		if q2.distance_to(hud.call("_stick_home")) < 118.0 or q2.distance_to(hud.call("attack_centre")) < float(hud.call("attack_r")) * 1.9:
			head_over = 1
		var mc: Vector2 = hud.call("_map_centre")
		if q2.distance_to(mc) < 100.0:
			head_over = 1
	n_head += head_over
	n += 1
	n_hud += over
	heights.append(h)
	rows.append("%.2f,%.4f,%d,%d,%.2f" % [float(f.get("fight_time")), h, on, over, cam.global_position.distance_to(hero.global_position)])
	return false


func _finish(j: String) -> void:
	heights.sort()
	var r: Dictionary = JSON.parse_string(j)
	if out_path != "":
		var fa := FileAccess.open(out_path, FileAccess.WRITE)
		fa.store_string("\n".join(rows) + "\n")
		fa.close()
	var vs: Vector2 = root.get_viewport().get_visible_rect().size
	print("CQCAM frames=%d screen=%dx%d hero_h_median=%.3f hero_h_p10=%.3f hero_px_median=%d hero_px_p10=%d target_off_pct=%.2f hud_over_pct=%.2f head_under_hud_pct=%.2f outcome=%s time=%s" % [n, int(vs.x), int(vs.y),
		heights[n / 2] if n > 0 else 0.0, heights[n / 10] if n > 0 else 0.0, int(heights[n / 2] * vs.y) if n > 0 else 0, int(heights[n / 10] * vs.y) if n > 0 else 0,
		100.0 * n_off / maxf(n_target, 1), 100.0 * n_hud / maxf(n, 1), 100.0 * n_head / maxf(n, 1), str(r.get("outcome", "?")), str(r.get("fight_s", r.get("duration_s", "?")))])
	quit(0)
