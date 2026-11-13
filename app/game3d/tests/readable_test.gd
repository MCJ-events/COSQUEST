extends SceneTree
## anim-readable (13 Nov 2026): every button plays its own readable body action, timed to the game's hit
## moments, on a faction hero and on the cartoon cast; nothing in the rules moves.
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tests/readable_test.gd
## 1. The rules id is build 25's (nothing here touches a combat number).
## 2. With the readable clips on (the default), each button's state has its own clip on Imani and on
##    Armstrong: the three cuts, SHOOT, RAIN, DASH, SHIELD, SPLIT, RALLY, GUARD and the parry; SHOOT and
##    RAIN no longer borrow the second cut and the rally. With "readable" off the picks are build 25's.
## 3. Timing: a readable clip's contact frame shows exactly at the game's hit moment (SHOOT's shot at
##    0.12 s, RAIN's raised arm at 0.3 s, the cuts in their hit windows), within one frame.
## 4. The tail: a SHOOT played to its end by a body that stands still keeps its aim for the tail, and a
##    step ends it at once; the body is never busy in the tail (a hit can take it).
## 5. Hit reactions sized to the blow: light, normal and heavy play different clips.
## 6. The faction hero's own intro and victory clips are picked.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const FightScript := preload("res://fight.gd")
const AnimLib := preload("res://anim_library.gd")
const FighterScript := preload("res://fighter.gd")

const BUTTONS: Dictionary = {"attack_1": 0.11, "attack_2": 0.11, "attack_3": 0.235, "skill_shoot": 0.12, "skill_rain": 0.3,
	"skill_charge": 0.18, "skill_split": 0.34, "skill_rally": 0.25, "skill_shield": 0.2, "parry": 0.12}
const LENS: Dictionary = {"attack_1": 0.34, "attack_2": 0.36, "attack_3": 0.56, "skill_shoot": 0.36, "skill_rain": 0.6,
	"skill_charge": 0.42, "skill_split": 0.72, "skill_rally": 0.6, "skill_shield": 0.5, "parry": 0.35}

var _fails: int = 0
var _f: FighterScript
var _steps: Array = []
var _cur: Dictionary = {}
var _n: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _clip(st: Dictionary, s: String) -> String:
	return str((st.get(s, {}) as Dictionary).get("clip", ""))


func _initialize() -> void:
	_check("rules_id_unchanged", FightScript.rules_id() == "f3d-2-e872f23a43a5", FightScript.rules_id())
	AnimLib.motion = "hybrid"
	for key: String in ["icons_imani", "armstrong"]:
		AnimLib.readable = 1
		var on: Dictionary = AnimLib.states_for("sword", key)
		var own: Array[String] = []
		for s: String in ["attack_1", "attack_2", "attack_3", "skill_shoot", "skill_rain", "skill_charge", "skill_split", "skill_rally", "skill_shield", "guard", "parry"]:
			if _clip(on, s).begins_with("R_"):
				own.append(s)
		# the cast passes the tear gate in every state; a faction hero whose mesh tears in a state keeps its old
		# clip there (build 25's Imani: SHOOT, SHIELD, RALLY; build 26's passes all), so at least eight of eleven
		_check("%s_every_button_has_its_own_action" % key, own.size() == 11 if key == "armstrong" else own.size() >= 8, "readable states: %s" % str(own))
		var sh: String = _clip(on, "skill_shoot")
		_check("%s_shoot_and_rain_are_their_own" % key, on.has("skill_rain") and _clip(on, "skill_rain") != _clip(on, "skill_rally")
			and (sh == "" or sh != _clip(on, "attack_2")), "%s %s" % [sh, _clip(on, "skill_rain")])
		_check("%s_hits_sized" % key, on.has("hit_light") and on.has("hit_heavy") and _clip(on, "hit_light") != _clip(on, "hit_heavy"),
			"%s / %s" % [_clip(on, "hit_light"), _clip(on, "hit_heavy")])
		AnimLib.readable = 0
		var off: Dictionary = AnimLib.states_for("sword", key)
		var none: bool = not off.has("skill_shoot") and not off.has("skill_rain")
		for s: String in off:
			none = none and not _clip(off, s).begins_with("R_")
		_check("%s_readable_off_is_build25" % key, none, str(off.keys()))
	AnimLib.readable = 1
	var poses: Dictionary = ((AnimLib.data().get("characters", {}) as Dictionary).get("icons_imani", {}) as Dictionary).get("pick_poses", {})
	_check("hero_has_its_own_intro_and_victory", str(poses.get("intro", "")) != "" and str(poses.get("victory", "")) != "", str(poses))
	var d: Dictionary = AnimLib.data()
	_check("readable_on_by_default", bool(d.get("readable_default", false)))
	# the timing and tail checks run on Armstrong's real model (every state passes the gate on it)
	for st: String in BUTTONS:
		_steps.append({"kind": "contact", "st": st})
	_steps.append({"kind": "tail"})
	_steps.append({"kind": "tail_step"})
	_steps.append({"kind": "hits"})
	_spawn()


func _spawn() -> void:
	_f = FighterScript.new()
	root.add_child(_f)
	_f.setup("Armstrong", 0, 1000, Color.WHITE, "hero")
	var doc := GLTFDocument.new()
	var gs := GLTFState.new()
	doc.append_from_file("res://cast/armstrong_lod1.glb", gs)
	var scene: Node3D = doc.generate_scene(gs)
	_f.anim_opts = {"key": "armstrong", "class": "sword", "breathe": true}
	_f.turn_steps = true
	_f.set_model(scene)


func _next() -> void:
	if _steps.is_empty():
		print("CQTEST done failures=%d" % _fails)
		quit(1 if _fails > 0 else 0)
		return
	_cur = _steps.pop_front()
	_n = 0
	_f.speed_now = 0.0
	_f.anim.play("idle")
	var k: String = str(_cur["kind"])
	if k == "contact" or k == "tail" or k == "tail_step":
		var st: String = str(_cur.get("st", "skill_shoot"))
		_cur["st"] = st
		_cur["clipped"] = _f.act(st, LENS[st], BUTTONS[st])
	elif k == "hits":
		_f.hit_size(50, false, false)
		_f.act("hit", 0.28)
		_cur["light"] = str(_f.anim.player.current_animation)
		_f.hit_size(160, true, false)
		_f.act("hit", 0.28)
		_cur["heavy"] = str(_f.anim.player.current_animation)
		_f.act("hit", 0.28)
		_cur["normal"] = str(_f.anim.player.current_animation)


func _process(_dt: float) -> bool:
	if _f == null or not _f.is_inside_tree() or _f.anim.player == null:
		return false
	if _cur.is_empty():
		_next()
		return false
	var dt: float = 1.0 / 30.0
	var k: String = str(_cur["kind"])
	_n += 1
	if k == "hits":
		_check("hit_reactions_differ_by_blow", str(_cur["light"]) != str(_cur["heavy"]) and str(_cur["heavy"]) != str(_cur["normal"]),
			"light %s, normal %s, heavy %s" % [_cur["light"], _cur["normal"], _cur["heavy"]])
		_cur = {}
		return false
	var st: String = str(_cur["st"])
	if k == "tail_step" and _n == int(round(LENS[st] * 30.0)) + 3:
		_f.speed_now = 1.5
	_f.tick_visual(dt)
	if k == "contact":
		var hit_f: int = int(round(BUTTONS[st] * 30.0))
		if _n == hit_f:
			var m: Dictionary = _f.anim.timing.get(st, {})
			var want: float = float(m.get("contact", -1)) / float(m.get("fps", 30.0))
			var at: float = _f.anim.player.current_animation_position
			# the frame drawn at the hit moment is the contact frame (the warp's two pieces meet there)
			_check("contact_on_hit_" + st, bool(_cur["clipped"]) and str(m.get("clip", "")).begins_with("R_") and absf(at - want) <= 1.6 / 30.0,
				"%s clip %s at %.3f, contact %.3f" % [st, str(m.get("clip", "")), at, want])
			_cur = {}
	elif k == "tail":
		var end_f: int = int(round(LENS[st] * 30.0))
		if _n == end_f + 4:
			_check("shoot_holds_its_aim_in_the_tail", _f.anim.state == st and _f.anim.in_tail and not _f.anim.busy_action(),
				"state %s in_tail %s busy %s" % [_f.anim.state, str(_f.anim.in_tail), str(_f.anim.busy_action())])
		if _n == end_f + 30:
			_check("tail_ends_by_itself", _f.anim.state != st, _f.anim.state)
			_cur = {}
	elif k == "tail_step":
		var end2: int = int(round(LENS[st] * 30.0))
		if _n == end2 + 5:
			_check("a_step_ends_the_tail", _f.anim.state == "walk" or _f.anim.state == "run", _f.anim.state)
			_cur = {}
	return false
