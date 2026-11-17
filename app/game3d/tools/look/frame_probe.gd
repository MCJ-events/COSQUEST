extends SceneTree
## fid29-lightcam: the fight camera's frame in numbers (no pictures), for the framing gates of docs/game3d/fid29/lightcam.md.
##   godot --headless --path app/game3d --resolution 720x1280 --fixed-fps 30 -s res://tools/look/frame_probe.gd -- \
##     --config=/abs/config.json [--out=/abs/rows.csv] [--n=60] [--every=8]
## Over a seeded fight, `n` mid-fight frames (every `every` frames from 1 s on, while the hero and the Guardian live):
##  - fighters: the share of the frame inside a fighter's body (rays on a 72 x 128 grid against capsules on the skeleton's
##    bones; the effects are not counted, as in the masks of the fid29 audit)
##  - paving: the share whose ray meets the ground within 40 m of the camera before any fighter (the near paving the audit
##    counted from the masks)
##  - guardian_face_safe: the Guardian's face point on screen and below the HUD's top block (and off the stick and the
##    attack controls): 1 or 0
##  - plate_over_face: a HUD name plate or bar (hud.gd _plates) over any fighter's face box: 1 or 0
## and, once the fight is won, the victory shot (the camera settled): the winner's height as a share of the frame.
## Prints "CQFRAME ..." medians and shares; the rows to --out.

var cfg: Dictionary = {}
var out_path: String = ""
var n_want: int = 60
var every: int = 8
var rows: PackedStringArray = ["t,fighters,paving,guardian_face_safe,plate_over_face,cam_dist,pitch"]
var fs: Array[float] = []
var ps: Array[float] = []
var safe: int = 0
var plate: int = 0
var k: int = 0
var win_share: float = -1.0
var _done: bool = false
const GX: int = 72
const GY: int = 128
## bone pairs (capsules) and their radius at size_k 1 (m)
const SEGS: Array = [["Hips", "Spine2", 0.17], ["Spine2", "Neck", 0.16], ["Neck", "Head", 0.08], ["Head", "HeadTop_End", 0.12],
	["LeftArm", "LeftForeArm", 0.065], ["LeftForeArm", "LeftHand", 0.055], ["RightArm", "RightForeArm", 0.065], ["RightForeArm", "RightHand", 0.055],
	["LeftShoulder", "LeftArm", 0.08], ["RightShoulder", "RightArm", 0.08], ["LeftUpLeg", "LeftLeg", 0.095], ["LeftLeg", "LeftFoot", 0.07],
	["RightUpLeg", "RightLeg", 0.095], ["RightLeg", "RightFoot", 0.07], ["LeftFoot", "LeftToe_End", 0.05], ["RightFoot", "RightToe_End", 0.05],
	["Hips", "LeftUpLeg", 0.12], ["Hips", "RightUpLeg", 0.12]]


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--config="):
			cfg = JSON.parse_string(FileAccess.get_file_as_string(a.substr(9)))
		elif a.begins_with("--out="):
			out_path = a.substr(6)
		elif a.begins_with("--n="):
			n_want = int(a.substr(4))
		elif a.begins_with("--every="):
			every = int(a.substr(8))
		elif a.begins_with("--win="):
			var wh: PackedStringArray = a.substr(6).split("x")
			root.size = Vector2i(int(wh[0]), int(wh[1]))    # headless: the phone window (1170x2532), so the aspect is right
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


func _caps(f: Node3D) -> Array:
	var out: Array = []
	var anim: Variant = f.get("anim")
	var sk: Skeleton3D = anim.get("skeleton") if anim != null else null
	if sk == null or not f.visible:
		return out
	var sz: float = float(f.get("size_k"))
	for s: Array in SEGS:
		var a: int = sk.find_bone(str(s[0]))
		var b: int = sk.find_bone(str(s[1]))
		if a < 0 or b < 0:
			continue
		out.append([sk.global_transform * sk.get_bone_global_pose(a).origin, sk.global_transform * sk.get_bone_global_pose(b).origin, float(s[2]) * sz])
	return out


## The ray (o, d unit) passes within r of segment p-q (in front of the camera)?
static func _hit(o: Vector3, d: Vector3, p: Vector3, q: Vector3, r: float) -> float:
	var u: Vector3 = q - p
	var w: Vector3 = o - p
	var a: float = 1.0
	var b: float = d.dot(u)
	var c: float = u.dot(u)
	var dd: float = d.dot(w)
	var e: float = u.dot(w)
	var den: float = a * c - b * b
	var sc: float = 0.0
	var tc: float = 0.0
	if den < 1e-8:
		tc = clampf(e / maxf(c, 1e-8), 0.0, 1.0)
		sc = maxf(0.0, -dd + b * tc)
	else:
		sc = (b * e - c * dd) / den
		tc = clampf((a * e - b * dd) / den, 0.0, 1.0)
		sc = maxf(0.0, d.dot(p + u * tc - o))
	var dist: float = (o + d * sc).distance_to(p + u * tc)
	return sc if dist <= r else -1.0


func _measure(f: Node) -> Array:
	var cam: Camera3D = f.get("cam")
	var vs: Vector2 = root.get_viewport().get_visible_rect().size
	var caps: Array = []
	for kk: String in ["hero", "ally", "enemy"]:
		var o: Node3D = f.get(kk)
		if o != null and not bool(o.get("dead")):
			caps.append_array(_caps(o))
	var nf: int = 0
	var np: int = 0
	var band: int = 0
	var band_open: bool = true
	for gy0 in GY:
		var gy: int = GY - 1 - gy0     # from the bottom row up
		var row_pave: int = 0
		for gx in GX:
			var sp := Vector2((gx + 0.5) / GX * vs.x, (gy + 0.5) / GY * vs.y)
			var o: Vector3 = cam.project_ray_origin(sp)
			var d: Vector3 = cam.project_ray_normal(sp)
			var best: float = INF
			for c: Array in caps:
				var t: float = _hit(o, d, c[0], c[1], c[2])
				if t >= 0.0 and t < best:
					best = t
			if best < INF:
				nf += 1
				continue
			if d.y < -1e-4:
				var tg: float = -o.y / d.y
				var g: Vector3 = o + d * tg
				if Vector2(g.x - o.x, g.z - o.z).length() < 40.0:
					np += 1
					row_pave += 1
		if band_open and row_pave >= int(GX * 0.9):
			band += 1
		else:
			band_open = false
	return [float(nf) / (GX * GY), float(band) / GY, float(np) / (GX * GY)]


func _process(_dt: float) -> bool:
	var b: Node = root.get_node_or_null("Bridge")
	var f: Node = b.get("_fight") if b != null else null
	if _done or f == null or not is_instance_valid(f):
		return false
	var hero: Node3D = f.get("hero")
	var enemy: Node3D = f.get("enemy")
	var cam: Camera3D = f.get("cam")
	if str(f.get("state")) == "ending" and str(f.get("outcome")) == "win" and win_share < 0.0 and float(f.get("_win_k")) >= 0.999 and float(f.get("_end_t")) > 1.6:
		var caps: Array = _caps(hero)
		var lo: float = INF
		var hi: float = -INF
		for c: Array in caps:
			for p: Vector3 in [c[0], c[1]]:
				var y: float = cam.unproject_position(p).y
				lo = minf(lo, y)
				hi = maxf(hi, y)
		var vs: Vector2 = root.get_viewport().get_visible_rect().size
		win_share = (minf(hi, vs.y) - maxf(lo, 0.0)) / vs.y
		print("CQFRAME victory winner_rows=%.3f..%.3f share=%.3f" % [lo / vs.y, hi / vs.y, win_share])
	if str(f.get("state")) != "fighting" or hero == null or enemy == null or bool(enemy.get("dead")) or bool(hero.get("dead")):
		return false
	if float(f.get("fight_time")) < 1.0 or k >= n_want:
		return false
	if Engine.get_process_frames() % every != 0:
		return false
	k += 1
	var m: Array = _measure(f)
	var vs2: Vector2 = root.get_viewport().get_visible_rect().size
	var hud: Control = f.get("hud")
	var land: bool = vs2.x > vs2.y
	var top_block: float = float(hud.get("top_shift")) + (112.0 if land else 150.0)
	var face: Vector3 = enemy.global_position + Vector3.UP * (2.3 * float(enemy.get("size_k")) * 0.9)
	var ok: int = 0
	if not cam.is_position_behind(face):
		var q: Vector2 = cam.unproject_position(face)
		ok = 1 if (q.x >= 0.0 and q.x <= vs2.x and q.y > top_block and q.y <= vs2.y
			and q.distance_to(hud.call("_stick_home")) >= 118.0 and q.distance_to(hud.call("attack_centre")) >= float(hud.call("attack_r")) * 1.9) else 0
	var over: int = 0
	var plates: Array = hud.get("_plates")
	for kk: String in ["hero", "ally", "enemy"]:
		var o: Node3D = f.get(kk)
		if o == null or bool(o.get("dead")) or not o.visible:
			continue
		var fp: Vector3 = o.global_position + Vector3.UP * (2.3 * float(o.get("size_k")) * 0.86)
		if cam.is_position_behind(fp):
			continue
		var yw: float = float(o.get("yaw"))
		var tc: Vector3 = cam.global_position - o.global_position
		if Vector3(sin(yw), 0.0, cos(yw)).dot(Vector3(tc.x, 0.0, tc.z).normalized()) < 0.0:
			continue    # its back to the camera: no face to cover
		var c2: Vector2 = cam.unproject_position(fp)
		var r: float = absf(cam.unproject_position(fp + cam.global_basis.x * 0.14 * float(o.get("size_k"))).x - c2.x)
		var fb := Rect2(c2 - Vector2(r, r * 1.2), Vector2(2.0 * r, 2.4 * r))
		for pr: Rect2 in plates:
			if pr.intersects(fb):
				over = 1
	fs.append(m[0])
	ps.append(m[1])
	safe += ok
	plate += over
	var pitch: float = rad_to_deg(-cam.global_basis.get_euler().x)
	rows.append("%.2f,%.4f,%.4f,%d,%d,%.2f,%.1f" % [float(f.get("fight_time")), m[0], m[1], ok, over, cam.global_position.distance_to(hero.global_position), pitch])
	return false


func _finish(j: String) -> void:
	var r: Variant = JSON.parse_string(j)
	if out_path != "":
		var fa := FileAccess.open(out_path, FileAccess.WRITE)
		fa.store_string("\n".join(rows) + "\n")
		fa.close()
	var a: Array[float] = fs.duplicate()
	var p: Array[float] = ps.duplicate()
	a.sort()
	p.sort()
	var n: int = a.size()
	var mean_f: float = 0.0
	var mean_p: float = 0.0
	var f_ok: int = 0
	var p_ok: int = 0
	for i in n:
		mean_f += fs[i] / n
		mean_p += ps[i] / n
		f_ok += 1 if fs[i] >= 0.22 else 0
		p_ok += 1 if ps[i] <= 0.20 else 0
	print("CQFRAME screen=%s" % str(root.get_viewport().get_visible_rect().size))
	print("CQFRAME frames=%d fighters_median=%.3f fighters_mean=%.3f fighters_p10=%.3f fighters_ge22_pct=%.1f paving_median=%.3f paving_mean=%.3f paving_le20_pct=%.1f guardian_face_safe_pct=%.1f plate_over_face_pct=%.1f victory_share=%.3f outcome=%s" % [
		n, a[n / 2] if n > 0 else 0.0, mean_f, a[n / 10] if n > 0 else 0.0, 100.0 * f_ok / maxf(n, 1), p[n / 2] if n > 0 else 0.0, mean_p,
		100.0 * p_ok / maxf(n, 1), 100.0 * safe / maxf(n, 1), 100.0 * plate / maxf(n, 1), win_share, str((r as Dictionary).get("outcome", "?")) if r is Dictionary else "?"])
	quit(0)
