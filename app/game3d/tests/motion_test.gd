extends SceneTree
## realism-20261111: the motion bar's game-side rules, on Armstrong's real model and clip library.
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tests/motion_test.gd
## 1. The rules id is unchanged (nothing here touches a combat number).
## 2. The motion switch: "classic" gives build 21's picks, "mocap" the capture overlay, and the
##    overlay brings the stumble and the forward fall.
## 3. No bind-pose or T-pose frame in idle, the combo, a hit, a stagger, the cheer, on either
##    switch (the FINAL pose, after the pose layer and the foot lock).
## 4. Attack facing: after a 140 degree yaw snap the drawn body is on the aim by the contact, and
##    it stays on it when the game turns the fighter again mid-swing.
## 5. Foot lock: a foot that is down stays put (under 2 cm) while the body turns on the spot and
##    (10 degrees) and through a hit-stop shudder; with the lock off it does not (the test would catch a dead lock).
## 6. A skeleton with no clip at all does not stand in its rest pose.
## 7. Round 2: the hybrid default per state and the blend mode; a cast on the run keeps the run's
##    legs in one mixed clip; a blow's pause holds the drawing only; the ready pose winds the body up.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const FightScript := preload("res://fight.gd")
const AnimLib := preload("res://anim_library.gd")
const Animator := preload("res://combat_animator.gd")
const FighterScript := preload("res://fighter.gd")

const BIND_DEG: float = 6.0
const LIMBS: Array[String] = ["LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"]

var _fails: int = 0
var _f: FighterScript
var _phase: int = 0
var _t: int = 0
var _g: Array = []              # the final pose (skeleton space) of the last drawn frame
var _bind: int = 0
var _tpose: int = 0
var _frames: int = 0
var _foot0: Vector3
var _drift: float = 0.0
var _aim: float = 0.0
var _modes: Array = ["classic", "mocap"]
var _mi: int = 0
var _lock_drift: Dictionary = {}


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	_check("rules_id_unchanged", FightScript.rules_id() == "f3d-2-e872f23a43a5", FightScript.rules_id())
	AnimLib.motion = "classic"
	var c: Dictionary = AnimLib.states_for("sword", "armstrong")
	_check("classic_keeps_build21_swing", str((c.get("attack_1", {}) as Dictionary).get("clip", "")) == "1H_Melee_Attack_Slice_Diagonal", str(c.get("attack_1", {})))
	_check("classic_has_no_overlay_states", not c.has("stagger_fwd") and not c.has("death_fwd"))
	AnimLib.motion = "mocap"
	var m: Dictionary = AnimLib.states_for("sword", "armstrong")
	var a1: String = str((m.get("attack_1", {}) as Dictionary).get("clip", ""))
	_check("mocap_swing_is_captured", a1.begins_with("CMU_") or a1.begins_with("M2M_"), a1)
	_check("mocap_brings_stumble_and_forward_fall", m.has("stagger_fwd") and m.has("death_fwd"), str(m.keys()))
	var u: Dictionary = AnimLib.states_for("unarmed", "armstrong")
	_check("unarmed_set_punches", str((u.get("attack_2", {}) as Dictionary).get("clip", "")).contains("Punch"), str(u.get("attack_2", {})))
	# round 2: with no switch set a fighter is build 21's (every motion switch off)
	var plain := FighterScript.new()
	_check("no_switch_is_build21", not plain.aim_hold and not plain.weight_fx and not plain.real_speed and not plain.anim.no_bind
		and not plain.anim.natural_rates and not plain.anim.run_layer and plain.anim.foot == null)
	plain.free()
	AnimLib.motion = ""
	_check("no_switch_plays_the_classic_clips", AnimLib.motion_now() == "classic")
	# round 2: the hybrid default, state by state
	AnimLib.motion = "hybrid"
	var hb: Dictionary = AnimLib.states_for("sword", "armstrong")
	_check("hybrid_first_cuts_are_captured", str((hb.get("attack_1", {}) as Dictionary).get("clip", "")).begins_with("CMU_")
		and str((hb.get("attack_2", {}) as Dictionary).get("clip", "")).begins_with("CMU_"), str(hb.get("attack_1", {})))
	_check("hybrid_third_cut_is_the_classic_chop_turned_onto_the_target", str((hb.get("attack_3", {}) as Dictionary).get("clip", "")) == "1H_Melee_Attack_Chop"
		and float((hb.get("attack_3", {}) as Dictionary).get("aim_yaw_deg", 0.0)) > 20.0, str(hb.get("attack_3", {})))
	_check("hybrid_idle_and_victory_are_classic", str((hb.get("idle", {}) as Dictionary).get("clip", "")) == "Idle"
		and str((hb.get("victory", {}) as Dictionary).get("clip", "")) == "Cheer" and str((hb.get("run", {}) as Dictionary).get("clip", "")) == "CMU_Jog",
		"%s %s %s" % [str((hb.get("idle", {}) as Dictionary).get("clip", "")), str((hb.get("victory", {}) as Dictionary).get("clip", "")), str((hb.get("run", {}) as Dictionary).get("clip", ""))])
	var hs: Dictionary = AnimLib.states_for("staff", "hoof")
	_check("hybrid_two_handed_heavy_stays_classic", str((hs.get("heavy", {}) as Dictionary).get("clip", "")) == "2H_Melee_Attack_Chop", str(hs.get("heavy", {})))
	AnimLib.state_modes = {"attack_1": "blend"}
	var bl: Dictionary = AnimLib.states_for("sword", "armstrong")
	_check("blend_mode_carries_the_classic_legs", ((bl.get("attack_1", {}) as Dictionary).get("lower", {}) as Dictionary).get("clip", "") == "1H_Melee_Attack_Slice_Diagonal", str(bl.get("attack_1", {})))
	AnimLib.state_modes = {}
	_spawn("classic", true, true)


func _spawn(mode: String, foot_ik: bool, clips: bool) -> void:
	if _f != null:
		_f.queue_free()
	AnimLib.motion = mode
	_f = FighterScript.new()
	root.add_child(_f)
	_f.setup("Armstrong", 0, 1000, Color.WHITE, "hero")
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	doc.append_from_file("res://cast/armstrong_lod1.glb", st)
	var scene: Node3D = doc.generate_scene(st)
	if not clips:
		for p: Node in scene.find_children("*", "AnimationPlayer", true, false):
			p.get_parent().remove_child(p)
			p.free()
		# no library either: an unknown key and a skeleton the data does not recognise
		(AnimLib.data()["characters"] as Dictionary)["armstrong"]["status"] = "off"
	_f.anim_opts = {"key": "armstrong", "class": "sword", "foot_ik": foot_ik, "natural_rates": true, "no_bind": true, "run_layer": true}
	_f.aim_hold = true
	_f.weight_fx = true
	_f.real_speed = true
	_f.set_model(scene)
	if not clips:
		(AnimLib.data()["characters"] as Dictionary)["armstrong"]["status"] = "clips"
	_g = []
	_bind = 0
	_tpose = 0
	_frames = 0
	_t = 0
	if _f.anim.skeleton != null:
		_f.anim.skeleton.skeleton_updated.connect(_on_skel.bind(_f.anim.skeleton))


func _on_skel(sk: Skeleton3D) -> void:
	_g = []
	for b in sk.get_bone_count():
		_g.append(sk.get_bone_global_pose(b))


func _world(bone: String) -> Vector3:
	var sk: Skeleton3D = _f.anim.skeleton
	return sk.global_transform * (_g[sk.find_bone(bone)] as Transform3D).origin


## Counts the last drawn frame if it is the bind pose or a T-pose.
func _pose_frame() -> void:
	var sk: Skeleton3D = _f.anim.skeleton
	if sk == null or _g.size() != sk.get_bone_count():
		return
	_frames += 1
	var worst: float = 0.0
	for nm: String in LIMBS:
		var b: int = sk.find_bone(nm)
		var p: int = sk.get_bone_parent(b)
		var loc: Basis = (_g[b] as Transform3D).basis.orthonormalized()
		if p >= 0:
			loc = (_g[p] as Transform3D).basis.orthonormalized().inverse() * loc
		worst = maxf(worst, rad_to_deg(loc.get_rotation_quaternion().angle_to(sk.get_bone_rest(b).basis.get_rotation_quaternion())))
	if worst < BIND_DEG:
		_bind += 1
	var fw: Vector3 = _f.model.global_basis.z.normalized()
	var lat := Vector3(fw.z, 0.0, -fw.x)
	var t: bool = true
	for side: String in ["Left", "Right"]:
		var up: Vector3 = _world(side + "ForeArm") - _world(side + "Arm")
		var lo: Vector3 = _world(side + "Hand") - _world(side + "ForeArm")
		var level: float = absf(rad_to_deg(asin(clampf(up.normalized().y, -1.0, 1.0))))
		var out: float = rad_to_deg(up.angle_to(lat))
		out = minf(out, 180.0 - out)
		if level > 20.0 or out > 30.0 or rad_to_deg(up.angle_to(lo)) > 30.0:
			t = false
	if t:
		_tpose += 1


func _body_off(aim: float) -> float:
	var fw: Vector3 = _f.model.global_basis.z
	return absf(rad_to_deg(wrapf(atan2(fw.x, fw.z) - aim, -PI, PI)))


func _process(dt: float) -> bool:
	if _f == null:
		return true
	_t += 1
	if _t > 3:
		_pose_frame()
	var a: Animator = _f.anim
	match _phase:
		0, 1:
			# the states, on each switch: idle, the combo, a hit, a shove from the front, one from behind, the cheer
			var mode: String = _modes[_phase]
			if _t == 20:
				_f.act("attack_1", 0.34, 0.11)
			elif _t == 31:
				_f.act("attack_2", 0.36, 0.11)
			elif _t == 43:
				_f.act("attack_3", 0.56, 0.235)
			elif _t == 64:
				_f.hurt_pop(Vector3(0, 0, -1), 1.0)
				_f.act("hit", 0.28)
			elif _t == 80:
				_f.knock(-_f.forward(), 2.2)
			elif _t == 110:
				_f.knock(_f.forward(), 2.2)
			elif _t == 112 and mode == "mocap":
				_check("shove_from_behind_stumbles_forward", a.state == "stagger" and str(a.variant.get("stagger", "")) == "stagger_fwd"
					and a.player.get_current_animation() == a.clips.get("stagger_fwd", "?"), "%s %s %s" % [a.state, str(a.variant), a.player.get_current_animation()])
			elif _t == 140:
				_f.celebrate()
			elif _t == 150:
				_check(mode + "_victory_not_squeezed", a.player.speed_scale <= Animator.VICTORY_RATE_MAX + 0.001, "%.2f" % a.player.speed_scale)
			elif _t == 230:
				_check(mode + "_no_bind_pose_frames", _bind == 0 and _frames > 200, "bind=%d of %d" % [_bind, _frames])
				_check(mode + "_no_t_pose_frames", _tpose == 0, "tpose=%d of %d" % [_tpose, _frames])
				_check(mode + "_foot_lock_took_hold", a.foot != null and int(a.foot.stats["pins"]) > 0, str(a.foot.stats) if a.foot != null else "no foot lock")
				_phase += 1
				_spawn("mocap", true, true)
				if _phase == 2:
					_f.position = Vector3(3, 0, 0)
		2:
			# facing: a 140 degree snap, then the game turns the fighter again mid-swing
			if _t == 12:
				_aim = deg_to_rad(140.0)
				_f.face(Vector3(sin(_aim), 0, cos(_aim)), 0.0, 0.0)
				_f.act("attack_1", 0.34, 0.11)
			elif _t == 14:
				_f.face(Vector3(sin(_aim + 1.6), 0, cos(_aim + 1.6)), 0.0, 0.0)   # the ally jogs on
			elif _t == 16:
				# 0.11 s = 3.3 frames after the press: the contact
				_check("body_on_aim_at_contact", _body_off(_aim) < 45.0, "%.1f deg" % _body_off(_aim))
				print("CQTEST info body off the aim at contact %.1f deg" % _body_off(_aim))
			elif _t == 40:
				_check("body_follows_yaw_after_swing", _body_off(_aim + 1.6) < 20.0, "%.1f deg" % _body_off(_aim + 1.6))
				_phase = 3
				_spawn("classic", true, true)   # the classic idle stands still: the lock alone is under test
		3, 4:
			# foot lock on (3) and off (4): a turn on the spot, then a shudder
			if _t == 55:
				_foot0 = _world("LeftFoot")
				_drift = 0.0
			elif _t > 55 and _t <= 65:
				_f.yaw += deg_to_rad(1.0)
				_f.rotation.y = _f.yaw
				_drift = maxf(_drift, Vector2(_world("LeftFoot").x - _foot0.x, _world("LeftFoot").z - _foot0.z).length())
			elif _t == 68:
				_f.shudder(0.2, 0.03)
			elif _t > 68 and _t <= 75:
				_drift = maxf(_drift, Vector2(_world("LeftFoot").x - _foot0.x, _world("LeftFoot").z - _foot0.z).length())
			elif _t == 76:
				_lock_drift[_phase] = _drift
				print("CQTEST info planted foot drift through a 10 degree turn and a shudder: %.1f cm (foot lock %s)" % [_drift * 100.0, "on" if _phase == 3 else "off"])
				if _phase == 3:
					_check("locked_foot_stays_put", _drift < 0.02, "%.1f cm" % (_drift * 100.0))
					_phase = 4
					_spawn("classic", false, true)
				else:
					_check("unlocked_foot_drifts", _drift > 0.025 and a.foot == null, "%.1f cm" % (_drift * 100.0))
					_phase = 6
					_spawn("hybrid", true, true)
		6:
			# round 2: a cast on the run keeps the run's legs (one mixed clip), and a blow pauses the drawing
			_f.speed_now = 4.2 if _t < 40 else 0.0
			if _t == 2:
				_f.real_speed = false
			elif _t == 20:
				_check("running_before_the_cast", a.state in ["run", "sprint"], a.state)
				_f.act("attack_2", 0.36, 0.2)
				_check("cast_on_the_run_keeps_the_run_legs", a.legs_run and str(a.player.current_animation).contains("__mix_"), "%s %s" % [str(a.legs_run), a.player.current_animation])
			elif _t == 22:
				_check("lock_uses_the_stride_reach_under_a_cast", a.foot != null and a.foot.loco)
				_f.hit_pause(0.07)
			elif _t == 23:
				_check("hit_pause_holds_the_drawing_only", a.frozen and not _f.anim_freeze)
			elif _t == 27:
				_check("hit_pause_ends", not a.frozen)
			elif _t == 50:
				a.ready = true
			elif _t == 70:
				_check("ready_pose_winds_the_body_up", a._ready_w > 0.8 and float(a.layer.pose.get("r_bend", 0.0)) > 30.0, "%.2f %s" % [a._ready_w, str(a.layer.pose)])
				_phase = 5
				_spawn("classic", false, false)
		5:
			if _t == 30:
				_check("no_clip_skeleton_not_in_bind_pose", _bind == 0 and _frames > 20 and a.clips.is_empty(), "bind=%d of %d clips=%d" % [_bind, _frames, a.clips.size()])
				print("CQTEST done failures=%d" % _fails)
				quit(1 if _fails > 0 else 0)
				return true
	_f.tick_logic(dt)
	_f.tick_visual(dt)
	return false
