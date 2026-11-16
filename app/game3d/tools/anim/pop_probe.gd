extends SceneTree
## fid29 combat (build 29): the pop metric. A seeded autoplay fight, headless, at --fixed-fps 30; every frame the
## FINAL pose of each fighter (after every skeleton modifier: read on Skeleton3D.skeleton_updated) is kept as bone
## local rotations; a clip switch (the AnimationPlayer's current clip changes, or the same clip restarts) is a
## transition. Per transition: the peak, over the body's main joints and the frames within 0.3 s after it, of the
## joint's angular acceleration (|w(t) - w(t - 1)| / dt, w = the rotation between consecutive frames / dt), in
## degrees per second squared. A hit-stop frame (the animation held) is left out on both sides, so the measure is
## the blend, not the freeze.
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tools/anim/pop_probe.gd -- --cfg='{json}' --out=/abs.json
## Writes {transitions: n, peak_deg_s2: {p50, p90, max}, per_fighter: {...}, samples: [...]}. Read-only: it changes
## nothing in the fight. Drops into build 28 as it is (copy this file; it needs nothing of build 29).

const BONES: Array[String] = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "LeftForeArm", "RightArm",
	"RightForeArm", "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"]
const WINDOW_S: float = 0.3

var cfg: Dictionary = {}
var out_path: String = ""
var _f: Node
var _hooked: Dictionary = {}       # role -> {skel, ids, q: [prev quats], w: [prev ang vel], clip, pos, events: [frames], acc: [per-frame peak]}
var _frame: int = 0
var _done: bool = false
var _t0: int = -1


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--cfg="):
			cfg = JSON.parse_string(a.substr(6))
		elif a.begins_with("--out="):
			out_path = a.substr(6)
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	(func() -> void:
		var bridge: Node = root.get_node("Bridge")
		bridge.call("set_result_callback", func(j: String) -> void:
			if not j.contains("\"event\"") and not _done:
				_finish())
		bridge.call("start_fight", JSON.stringify(cfg))).call_deferred()


func _fight() -> Node:
	var b: Node = root.get_node_or_null("Bridge")
	return b.get("_fight") if b != null else null


func _hook(role: String, f: Node) -> void:
	var anim: Variant = f.get("anim")
	if anim == null:
		return
	var sk: Skeleton3D = (anim as Object).get("skeleton")
	var ap: AnimationPlayer = (anim as Object).get("player")
	if sk == null or ap == null:
		return
	var ids: Array[int] = []
	for n: String in BONES:
		var b: int = sk.find_bone(n)
		if b >= 0:
			ids.append(b)
	var h: Dictionary = {"skel": sk, "ap": ap, "anim": anim, "ids": ids, "q": [], "w": [], "clip": "", "pos": -1.0,
		"events": [], "acc": [], "held": [], "ev_info": [], "acc_bone": []}
	_hooked[role] = h
	sk.skeleton_updated.connect(_on_skel.bind(role))


func _on_skel(role: String) -> void:
	var h: Dictionary = _hooked[role]
	var sk: Skeleton3D = h["skel"]
	var qs: Array = []
	for b: int in h["ids"]:
		var g: Transform3D = sk.get_bone_global_pose(b)
		var p: int = sk.get_bone_parent(b)
		var lq: Quaternion = (sk.get_bone_global_pose(p).basis.inverse() * g.basis).get_rotation_quaternion() if p >= 0 else g.basis.get_rotation_quaternion()
		qs.append(lq)
	h["cur"] = qs


func _process(_dt: float) -> bool:
	var f: Node = _fight()
	if f == null or not is_instance_valid(f) or _done:
		return false
	if _hooked.is_empty():
		for kv: Array in [["hero", f.get("hero")], ["ally", f.get("ally")], ["enemy", f.get("enemy")]]:
			if kv[1] != null and is_instance_valid(kv[1]) and (kv[1] as Object).get("anim") != null and ((kv[1] as Object).get("anim") as Object).get("skeleton") != null:
				_hook(str(kv[0]), kv[1])
		return false
	_frame += 1
	var dt: float = 1.0 / 30.0
	for role: String in _hooked:
		var h: Dictionary = _hooked[role]
		var ap: AnimationPlayer = h["ap"]
		var anim: Object = h["anim"]
		var clip: String = str(ap.current_animation)
		var pos: float = ap.current_animation_position if clip != "" else 0.0
		var frozen: bool = bool(anim.get("frozen"))
		if clip != str(h["clip"]) or (clip != "" and pos + 0.0001 < float(h["pos"]) and ap.get_animation(clip).loop_mode == Animation.LOOP_NONE):
			(h["events"] as Array).append(_frame)
			(h["ev_info"] as Array).append([str(h["clip"]).get_file(), clip.get_file(), str(anim.get("state"))])
		h["clip"] = clip
		h["pos"] = pos
		var cur: Array = h.get("cur", [])
		var prev: Array = h["q"]
		var acc: float = -1.0
		if not cur.is_empty() and prev.size() == cur.size() and not frozen:
			var ws: Array = []
			for i in cur.size():
				var d: Quaternion = ((cur[i] as Quaternion) * (prev[i] as Quaternion).inverse()).normalized()
				if d.w < 0.0:
					d = -d
				var ang: float = d.get_angle()
				var wv: Vector3 = d.get_axis() * (ang / dt) if ang > 1e-6 else Vector3.ZERO
				ws.append(wv)
			var pw: Array = h["w"]
			if pw.size() == ws.size() and not bool(h.get("was_frozen", false)):
				acc = 0.0
				var ab: int = -1
				for i in ws.size():
					var ai: float = rad_to_deg(((ws[i] as Vector3) - (pw[i] as Vector3)).length() / dt)
					if ai > acc:
						acc = ai
						ab = i
				h["_ab"] = ab
			h["w"] = ws
		elif frozen:
			h["w"] = []
		h["was_frozen"] = frozen
		(h["acc"] as Array).append(acc)
		(h["acc_bone"] as Array).append(int(h.get("_ab", -1)) if acc >= 0.0 else -1)
		h["q"] = cur
	if str(f.get("state")) == "done" or _frame > 30 * 50:
		_finish()
	return false


func _finish() -> void:
	if _done:
		return
	_done = true
	var peaks: Array = []
	var per: Dictionary = {}
	var win: int = int(round(WINDOW_S * 30.0))
	for role: String in _hooked:
		var h: Dictionary = _hooked[role]
		var acc: Array = h["acc"]
		var pk: Array = []
		var evs: Array = []
		for ei in (h["events"] as Array).size():
			var ev: int = h["events"][ei]
			var m: float = -1.0
			var at: int = -1
			for k in range(ev, mini(ev + win + 1, acc.size() + 1)):
				if k - 1 >= 0 and k - 1 < acc.size() and float(acc[k - 1]) > m:
					m = float(acc[k - 1])
					at = k - 1
			if m >= 0.0:
				pk.append(m)
				var bi: int = int(h["acc_bone"][at]) if at >= 0 else -1
				evs.append({"from": h["ev_info"][ei][0], "to": h["ev_info"][ei][1], "state": h["ev_info"][ei][2], "peak": round(m), "after": at - (ev - 1),
					"bone": BONES[(h["ids"] as Array).find((h["ids"] as Array)[bi])] if bi >= 0 and bi < (h["ids"] as Array).size() else ""})
		per[role + "_events"] = evs
		per[role] = {"transitions": pk.size(), "p50": _pct(pk, 0.5), "p90": _pct(pk, 0.9), "max": _pct(pk, 1.0)}
		peaks += pk
	var res: Dictionary = {"transitions": peaks.size(), "peak_deg_s2": {"p50": _pct(peaks, 0.5), "p90": _pct(peaks, 0.9), "max": _pct(peaks, 1.0),
		"mean": (peaks.reduce(func(a: float, b: float) -> float: return a + b, 0.0) / maxf(1.0, peaks.size()))}, "per_fighter": per, "frames": _frame,
		"cfg": cfg}
	print("CQPOP " + JSON.stringify(res))
	if out_path != "":
		var fa := FileAccess.open(out_path, FileAccess.WRITE)
		fa.store_string(JSON.stringify(res, " "))
		fa.close()
	quit.call_deferred(0)


static func _pct(a: Array, q: float) -> float:
	if a.is_empty():
		return 0.0
	var s: Array = a.duplicate()
	s.sort()
	return float(s[clampi(int(round(q * (s.size() - 1))), 0, s.size() - 1)])
