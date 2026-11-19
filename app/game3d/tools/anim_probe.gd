extends Node
## Per-frame motion probe for review captures and the motion bar (realism-20261111, BAR.md section C).
## fight.gd adds it when the config has "anim_probe": "/abs/out.jsonl"; the game never sets it and
## tools/ is not exported. It reads only; it changes nothing in the fight.
##
## v2 (11 Nov 2026) keeps every field of the fight-anim probe (tools/anim/probe_report.py still
## reads it) and adds what tools/anim/motion_report.py needs:
##   * the FINAL pose of the frame (after pose_layer, foot IK and the secondary sim): bones are read
##     on Skeleton3D.skeleton_updated, and each row is written on the next frame's start with the
##     transforms the frame was drawn with (the old probe read the pose before the modifiers)
##   * feet, toes, knees, hands, elbows, shoulders, head and hips in the world; the weapon tip
##   * the drawn body's forward, the fighter's yaw, its target (nearest living opponent)
##   * how far the limbs are from the rest (bind) pose, in degrees
##   * the action clock (t, len, the game time of the hit) and whether the frame is frozen (hit-stop)
##   * one "ev":"hit" line per landed blow (who, on whom, what kind), from the hit areas' signals
##     and the victims' hp
## It drops into any build that has the "anim_probe" hook (build 18 and later): copy this one file
## over tools/anim_probe.gd (tools/anim/motion_measure.sh does that).

var fighters: Array = []        # [[role, FighterScript], ...]
var path: String = ""
var _f: FileAccess
var _prev: Dictionary = {}
var _frame: int = 0
const SKIP_CHAINS: String = "^(Robe|Coat|Skirt|Wing|Flame|Hair|Tail|Cape).*"
var _re: RegEx
const POINTS: Array[String] = ["Hips", "Head", "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase",
	"LeftLeg", "RightLeg", "LeftUpLeg", "RightUpLeg", "LeftHand", "RightHand", "LeftForeArm", "RightForeArm",
	"LeftArm", "RightArm", "Spine2"]
const LIMBS: Array[String] = ["LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftUpLeg", "RightUpLeg",
	"LeftLeg", "RightLeg"]
const TRUNK: Array[String] = ["Spine", "Spine1", "Spine2", "Neck", "Head"]
var _snap: Dictionary = {}      # role -> {"g": Array[Transform3D] skeleton-space finals, "n": updates}
var _hooked: Dictionary = {}    # role -> Skeleton3D the signal is on
var _hp: Dictionary = {}        # role -> hp at the last frame
var _hits: Array = []           # this frame's struck signals: [src role, dst role, kind]
var _fight: Node
var _areas_hooked: bool = false


func _ready() -> void:
	_f = FileAccess.open(path, FileAccess.WRITE)
	_re = RegEx.new()
	_re.compile(SKIP_CHAINS)
	process_priority = 1000   # after the fighters' visual tick
	_fight = get_parent()
	get_tree().process_frame.connect(_write_frame)
	_f.store_line(JSON.stringify({"ev": "meta", "probe": 2, "fps": Engine.get_frames_per_second(),
		"physics_fps": Engine.physics_ticks_per_second}))


func _role_of(f: Object) -> String:
	for pair: Array in fighters:
		if pair[1] == f:
			return str(pair[0])
	return ""


func _hook_areas() -> void:
	if _areas_hooked or _fight == null:
		return
	_areas_hooked = true
	for pair: Array in fighters:
		var f: Node3D = pair[1]
		if f == null or not is_instance_valid(f):
			continue
		var w: Variant = f.get("weapon")
		if w != null and (w as Object).has_signal("struck"):
			(w as Object).connect("struck", _on_struck)
	for nm: String in ["_skill_area", "_boss_area"]:
		var a: Variant = _fight.get(nm)
		if a != null and (a as Object).has_signal("struck"):
			(a as Object).connect("struck", _on_struck)


func _on_struck(target: Node3D, area: Area3D) -> void:
	var info: Variant = area.get("info")
	if not (info is Dictionary):
		return
	var src: Variant = (info as Dictionary).get("src")
	_hits.append([_role_of(src) if src != null else "", _role_of(target), str((info as Dictionary).get("kind", ""))])


func _on_skel(role: String, sk: Skeleton3D) -> void:
	var g: Array = []
	for b in sk.get_bone_count():
		g.append(sk.get_bone_global_pose(b))
	var s: Dictionary = _snap.get(role, {"n": 0})
	s["g"] = g
	s["n"] = int(s["n"]) + 1
	_snap[role] = s


func _process(_dt: float) -> void:
	# hook each fighter's skeleton once its model is in (the load is spread over frames)
	for pair: Array in fighters:
		var role: String = pair[0]
		var f: Node3D = pair[1]
		if f == null or not is_instance_valid(f):
			continue
		var a: Variant = f.get("anim")
		if a == null:
			continue
		var sk: Skeleton3D = a.get("skeleton")
		if sk != null and _hooked.get(role) != sk:
			_hooked[role] = sk
			_snap.erase(role)
			sk.skeleton_updated.connect(_on_skel.bind(role, sk))
	_hook_areas()


## Runs at the start of the next frame: every transform is still the one the last frame was drawn
## with, and the skeletons hold that frame's final pose.
func _write_frame() -> void:
	if _f == null:
		return
	_frame += 1
	var fstate: String = str(_fight.get("state")) if _fight != null else ""
	var frozen: bool = _fight != null and (float(_fight.get("_hitstop")) > 0.0)
	for pair: Array in fighters:
		var role: String = pair[0]
		var f: Node3D = pair[1]
		if f == null or not is_instance_valid(f):
			continue
		var a: Variant = f.get("anim")
		if a == null:
			continue
		var sk: Skeleton3D = a.get("skeleton")
		var pl: AnimationPlayer = a.get("player")
		var warp: Array = a.get("_warp")
		var row: Dictionary = {"fr": _frame, "role": role, "st": str(a.get("state")),
			"clip": str(pl.current_animation) if pl != null else "", "rate": snappedf(pl.speed_scale, 0.001) if pl != null else 0.0,
			"spd": snappedf(float(f.get("speed_now")), 0.001), "pos": _v(f.global_position), "dead": bool(f.get("dead")),
			"motion": str(f.get("_motion")), "t": snappedf(float(a.get("t")), 0.0001), "len": snappedf(float(a.get("length")), 0.0001),
			"hit_at": snappedf(float(warp[3]), 0.0001) if warp.size() > 3 else -1.0,
			"yaw": snappedf(float(f.get("yaw")), 0.0001), "vis": f.visible, "hp": int(f.get("hp")),
			"fs": fstate, "frz": frozen, "kb": snappedf((f.get("kb_vel") as Vector3).length(), 0.001),
			"size": snappedf(float(f.get("size_k")), 0.001), "team": int(f.get("team")),
			"fid": bool(a.get("fid")), "afz": bool(a.get("frozen"))}   # fight-motion-31: the real-look motion on, the animation frozen
		var fl: Variant = a.get("foot")
		if fl != null and (fl as Object).has_method("debug_state"):
			row["lock"] = (fl as Object).call("debug_state")
		var model: Variant = f.get("model")
		if model != null and is_instance_valid(model) and (model as Node3D).is_inside_tree():
			var fw: Vector3 = (model as Node3D).global_basis.z
			row["fwd"] = [snappedf(fw.x, 0.001), snappedf(fw.z, 0.001)]
		# the target: the nearest living fighter of the other team
		var best: float = INF
		for other: Array in fighters:
			var o: Node3D = other[1]
			if o == null or not is_instance_valid(o) or o == f or int(o.get("team")) == int(f.get("team")) or bool(o.get("dead")):
				continue
			var d: float = (o.global_position - f.global_position).length()
			if d < best:
				best = d
				row["tgt"] = _v(o.global_position)
				row["tgt_role"] = str(other[0])
		# the Guardian's own pick (it may swing at the ally, not the nearest)
		if role == "enemy" and _fight != null and str(_fight.get("_enemy_state")) == "windup":
			var et: Variant = _fight.get("_enemy_target")
			if et != null and is_instance_valid(et) and not bool((et as Node3D).get("dead")):
				row["tgt"] = _v((et as Node3D).global_position)
				row["tgt_role"] = _role_of(et)
		if _fight != null and _fight.has_method("_weapon_tip"):
			var tip: Vector3 = _fight.call("_weapon_tip", f)
			if tip != Vector3.INF:
				row["tip"] = _v(tip)
		if sk != null and not (_snap.has(role) and (_snap[role]["g"] as Array).size() == sk.get_bone_count()):
			# no skeleton update yet: nothing has animated this model, it is drawn as it was loaded
			# (build 21 stands a fighter in its rest pose until its first state change)
			var g0: Array = []
			for b0 in sk.get_bone_count():
				g0.append(sk.get_bone_global_pose(b0))
			_snap[role] = {"g": g0, "n": 0}
		if sk != null and _snap.has(role) and (_snap[role]["g"] as Array).size() == sk.get_bone_count():
			var g: Array = _snap[role]["g"]
			var xf: Transform3D = sk.global_transform
			for nm: String in POINTS:
				var b: int = sk.find_bone(nm)
				if b >= 0:
					row[nm] = _v(xf * (g[b] as Transform3D).origin)
			row["upd"] = int(_snap[role]["n"])
			# the limbs' and the trunk's distance from the rest pose (degrees, local rotations)
			var dev_max: float = 0.0
			var dev_sum: float = 0.0
			var n_dev: int = 0
			var trunk_max: float = 0.0
			for group: Array in [LIMBS, TRUNK]:
				for nm: String in group:
					var b: int = sk.find_bone(nm)
					if b < 0:
						continue
					var p: int = sk.get_bone_parent(b)
					var loc: Basis = (g[b] as Transform3D).basis.orthonormalized()
					if p >= 0:
						loc = (g[p] as Transform3D).basis.orthonormalized().inverse() * loc
					var d: float = rad_to_deg(loc.get_rotation_quaternion().angle_to(sk.get_bone_rest(b).basis.get_rotation_quaternion()))
					if group == LIMBS:
						dev_max = maxf(dev_max, d)
						dev_sum += d
						n_dev += 1
					else:
						trunk_max = maxf(trunk_max, d)
			row["dev"] = [snappedf(dev_max, 0.1), snappedf(dev_sum / maxf(1.0, n_dev), 0.1), snappedf(trunk_max, 0.1)]
			# the largest rotation any bone made since the last frame (a snap or pop)
			var worst: float = 0.0
			var worst_b: String = ""
			var mq: Quaternion = xf.basis.get_rotation_quaternion()
			if _prev.has(role + "/m"):
				row["turn"] = snappedf(rad_to_deg((_prev[role + "/m"] as Quaternion).angle_to(mq)), 0.01)
			_prev[role + "/m"] = mq
			var prev: Array = _prev.get(role, [])
			var qs: Array = []
			for b in sk.get_bone_count():
				var q: Quaternion = (g[b] as Transform3D).basis.get_rotation_quaternion()
				qs.append(q)
				if prev.size() == sk.get_bone_count() and _re.search(sk.get_bone_name(b)) == null:
					var d2: float = rad_to_deg((prev[b] as Quaternion).angle_to(q))
					if d2 > worst:
						worst = d2
						worst_b = sk.get_bone_name(b)
			_prev[role] = qs
			row["pop"] = snappedf(worst, 0.01)
			row["pop_bone"] = worst_b
		_f.store_line(JSON.stringify(row))
		# a landed blow: the victim's hp fell this frame
		var hp: int = int(f.get("hp"))
		if _hp.has(role) and hp < int(_hp[role]):
			var src: String = ""
			var kind: String = ""
			for h: Array in _hits:
				if str(h[1]) == role:
					src = str(h[0])
					kind = str(h[2])
			if src == "":
				# no hit area of ours fired: a bolt (the ally's) or a skill's own area
				src = "ally" if int(f.get("team")) == 1 else "enemy"
				kind = "bolt" if src == "ally" else "?"
			_f.store_line(JSON.stringify({"ev": "hit", "fr": _frame, "src": src, "dst": role, "kind": kind,
				"dmg": int(_hp[role]) - hp, "ko": hp <= 0}))
		_hp[role] = hp
	_hits.clear()


func _exit_tree() -> void:
	if _f != null:
		_f.close()


static func _v(p: Vector3) -> Array:
	return [snappedf(p.x, 0.001), snappedf(p.y, 0.001), snappedf(p.z, 0.001)]
