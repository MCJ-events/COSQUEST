extends SceneTree
## build 28 (13 Nov 2026, Subomi): the five-button panel. Wale's five are the only buttons (ATTACK, DASH, SHIELD,
## SHOOT, RAIN); all eight moves stay: WHIRL is the combo's finisher, SPLIT a held ATTACK, RALLY comes by itself
## below half health. Its own rules table (version 3), picked by the setup's rules id.
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tests/five_button_test.gd
## 1. The panel: only his five plus GUARD; his five keep his sheet's relative offsets and sizes (one scale about
##    ATTACK); no button for SPLIT, WHIRL or RALLY (a touch where the interim ones were casts nothing); the layout
##    and the cues (WHIRL and SPLIT badges on ATTACK's rim, RALLY under the hero card) are clear and on screen,
##    upright and sideways; every button casts its own skill; a touch on a badge is an ATTACK press.
## 2. The rules: table 3 is table 2 plus the "five" block; its id is pinned (the server's RULES_V3 must agree);
##    table 2's id is unchanged; the config's rules id picks the table.
## 3. In a real fight: a tap swings and never SPLITs; ATTACK held 0.4 s casts SPLIT (once, then the hold rests);
##    the chain's third hit is WHIRL when it is back and the heavy cut while it cools; RALLY comes by itself below
##    half health and not again while it cools; presses of the three have no effect; every derived cast has its
##    derived row with its reason; ATTACK's presses, releases and swings are logged.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const HudScript := preload("res://hud.gd")
const FightScript := preload("res://fight.gd")
const PINNED_V2: String = "f3d-2-e872f23a43a5"
const PINNED_V3: String = "f3d-3-dd591cb09b67"

var _fails: int = 0
var _f: Node
var _step: int = -1
var _t: int = 0
var _pin: Vector3 = Vector3.INF
var _mark: Dictionary = {}


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	_panel()
	_rules()
	var cfg: Dictionary = {"mode": "full", "duration_s": 60, "autoplay": false, "seed": 77, "load_thread": false,
		"render_scale": 0.5, "intro": false, "rules": PINNED_V3}
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	(func() -> void: root.get_node("Bridge").call("start_fight", JSON.stringify(cfg))).call_deferred()


# ------------------------------------------------------------ 1. the panel

func _hud(sz: Vector2) -> Control:
	var hud: Control = HudScript.new()
	hud.set("panel", "wale")
	hud.set("five", true)
	hud.size = sz
	return hud


func _panel() -> void:
	var hud: Control = _hud(Vector2(720, 1280))
	var k: float = HudScript.W_ATTACK_R / 203.94 * HudScript.W_FIVE_K
	var sheet: Dictionary = {"dash": [Vector2(238.23, 807.97), 80.63], "shield": [Vector2(597.15, 211.05), 110.56],
		"shoot": [Vector2(287.89, 285.8), 96.75], "rain": [Vector2(170.59, 527.59), 92.28]}
	var worst: float = 0.0
	for j in HudScript.W_BUTTONS.size():
		var id: String = str(HudScript.W_BUTTONS[j]["id"])
		if bool(hud.call("wale_interim", j)):
			continue
		var want: Vector2 = ((sheet[id][0] as Vector2) - Vector2(601.14, 673.24)) * k
		worst = maxf(worst, (want - (hud.call("wale_at", j) as Vector2)).length())
		worst = maxf(worst, absf(float(sheet[id][1]) * k - float(hud.call("wale_r", j))))
	_check("five_his_buttons_keep_his_proportions", worst < 0.01, "worst %.3f px" % worst)
	_check("five_attack_scaled", is_equal_approx(float(hud.call("attack_r")), HudScript.W_ATTACK_R * HudScript.W_FIVE_K))
	hud.free()
	for sz: Vector2 in [Vector2(720, 1280), Vector2(1280, 720)]:
		var h: Control = _hud(sz)
		if sz.x > sz.y:
			h.set("side_l", 100.0)
			h.set("side_r", 70.0)
		var tag: String = "landscape" if sz.x > sz.y else "portrait"
		var ac: Vector2 = h.call("attack_centre")
		var discs: Array = [[ac, float(h.call("attack_r")) * 1.2, "attack"], [h.call("guard_centre"), HudScript.GUARD_R * 1.35, "guard"]]
		for j in HudScript.W_BUTTONS.size():
			if not bool(h.call("wale_interim", j)):
				discs.append([h.call("wale_centre", j), float(h.call("wale_r", j)) * 1.19, str(HudScript.W_BUTTONS[j]["id"])])
		var why: String = ""
		var mc: Vector2 = h.call("_map_centre")
		var stick: Vector2 = h.call("_stick_home")
		for i in discs.size():
			var c: Vector2 = discs[i][0]
			var r: float = discs[i][1]
			if c.x - r < float(h.get("side_l")) or c.y - r < 0.0 or c.x + r > sz.x - float(h.get("side_r")) or c.y + r > sz.y:
				why += " %s off screen" % discs[i][2]
			if c.distance_to(mc) < r + HudScript.MAP_R:
				why += " %s under the minimap" % discs[i][2]
			if c.distance_to(stick) < r + HudScript.STICK_BASE_R:
				why += " %s on the stick" % discs[i][2]
			for q in range(i + 1, discs.size()):
				# the badges sit on ATTACK's rim by design; everything else stays apart
				if c.distance_to(discs[q][0]) < r + float(discs[q][1]) - 0.5:
					why += " %s over %s" % [discs[i][2], discs[q][2]]
		# the badges: on screen, on ATTACK's rim, clear of his other buttons
		for id: String in ["whirl", "split"]:
			var bc: Vector2 = h.call("badge_centre", id)
			var br: float = HudScript.W_BADGE_R * HudScript.W_FIVE_K
			if bc.x + br > sz.x - float(h.get("side_r")) or bc.y + br > sz.y or bc.y - br < 0.0:
				why += " %s badge off screen" % id
			for d: Array in discs.slice(1):
				if bc.distance_to(d[0]) < br + float(d[1]):
					why += " %s badge over %s" % [id, d[2]]
		_check("five_layout_clear_" + tag, why == "", why)
		# every one of his buttons casts its own skill; the old interim spots and the badges cast nothing
		var got: Array = []
		var atk: Array = []
		var cb := func(s: int, _a: float, _b: int, _c: String) -> void: got.append(s)
		var cba := func(_a: float, _b: int, _c: String) -> void: atk.append(1)
		h.connect("skill_pressed", cb)
		h.connect("attack_pressed", cba)
		var all_cast: bool = true
		for slot: int in [0, 4, 5, 6]:
			got.clear()
			h.call("_down", 3, h.call("wale_centre", h.call("wale_button", slot)), "touch")
			h.call("_up", 3)
			all_cast = all_cast and got == [slot]
		_check("five_every_button_casts_" + tag, all_cast)
		got.clear()
		var lay: Dictionary = HudScript.W_EXTRAS["arc"]
		for p: Vector2 in lay["at"]:
			h.call("_down", 4, ac + p, "touch")
			h.call("_up", 4)
		_check("five_no_button_for_split_whirl_rally_" + tag, not got.has(1) and not got.has(2) and not got.has(3), str(got))
		atk.clear()
		for id: String in ["whirl", "split"]:
			h.call("_down", 5, h.call("badge_centre", id), "touch")
			h.call("_up", 5)
		_check("five_badge_touch_is_attack_" + tag, atk.size() == 2 and got.is_empty(), "%s %s" % [atk, got])
		h.free()


# ------------------------------------------------------------ 2. the rules

func _rules() -> void:
	_check("five_rules_v2_unchanged", FightScript.rules_id() == PINNED_V2, FightScript.rules_id())
	_check("five_rules_v3_pinned", FightScript.rules_id(3) == PINNED_V3, FightScript.rules_id(3))
	var t2: Dictionary = FightScript.rules_table(2)
	var t3: Dictionary = FightScript.rules_table(3)
	var same: bool = true
	for key: String in t2:
		same = same and JSON.stringify(t2[key]) == JSON.stringify(t3[key])
	_check("five_rules_v3_is_v2_plus_five", same and t3.size() == t2.size() + 1 and t3.has("five"))
	var f5: Dictionary = t3["five"]
	_check("five_rules_block", f5["buttons"] == [0, 4, 5, 6] and int(f5["finisher_slot"]) == 2 and int(f5["finisher_after"]) == 1
		and int(f5["hold_slot"]) == 1 and int(f5["hold_ms"]) == 400 and int(f5["auto_slot"]) == 3
		and int(f5["auto_below_permille"]) == 500 and int(f5["combo_reset_ms"]) == 550, str(f5))


# ------------------------------------------------------------ 3. in a real fight

func _j() -> Dictionary:
	return _f.get("_jlog") as Dictionary


func _rows(name: String, slot: int = -1) -> Array:
	var out: Array = []
	for c: Array in _j()[name]:
		if slot < 0 or int(c[2]) == slot:
			out.append(c)
	return out


func _place(hero_z: float, enemy_z: float) -> void:
	_f.hero.position = Vector3(0, 0, hero_z)
	_pin = Vector3(0, 0, enemy_z)
	_f.enemy.position = _pin


func _process(_dt: float) -> bool:
	if _f == null:
		var b: Node = root.get_node_or_null("Bridge")
		_f = b.get("_fight") if b != null else null
		return false
	if not is_instance_valid(_f) or str(_f.state) != "fighting":
		if _step >= 0 and _step < 99:
			_check("five_fight_ran_to_the_end_of_the_script", false, "state %s at step %d" % [str(_f.state) if is_instance_valid(_f) else "gone", _step])
			_finish()
			return true
		return false
	if _step < 0:
		_step = 0
		_t = 0
		_check("five_fight_on_table_3", bool(_f.get("five")) and int(_f.get("rules_version")) == 3)
	_t += 1
	_f.set("_enemy_cd", 99.0)
	_f.set("_ally_cd", 99.0)
	if _pin != Vector3.INF:
		_f.enemy.position = _pin
	var hud: Control = _f.get("hud")
	match _step:
		0:   # a tap swings and never SPLITs; a hold of 0.4 s does, once
			if _t == 2:
				_place(-1.2, 1.2)
				hud.call("bot_attack")
				_check("five_tap_swings", _rows("swings").size() == 1 and int(_rows("swings")[0][2]) == 0, str(_rows("swings")))
				_check("five_tap_press_logged", _rows("atk").size() == 1 and int(_rows("atk")[0][2]) == 1, str(_rows("atk")))
			if _t == 3:
				_check("five_tap_release_logged", _rows("atk").size() == 2 and int(_rows("atk")[1][2]) == 0, str(_rows("atk")))
			if _t == 30:
				_check("five_tap_never_splits", _rows("casts", 1).is_empty())
			if _t == 40:
				_mark["sw"] = _rows("swings").size()
				hud.call("bot_attack_hold", true)   # the press swings at once; the hold casts SPLIT
			if _t == 50:   # 0.33 s held
				_check("five_hold_not_yet", _rows("casts", 1).is_empty())
			if _t == 54:   # 0.47 s held
				var cs: Array = _rows("casts", 1)
				var ds: Array = _rows("derived", 1)
				_check("five_hold_casts_split", cs.size() == 1, str(cs))
				_check("five_hold_derived_row", ds.size() == 1 and int(ds[0][3]) == 2 and int(ds[0][4]) >= 40 and int(ds[0][4]) <= 42
					and ds[0].slice(0, 3) == cs[0].slice(0, 3), str(ds))
			if _t == 75:   # still held: the hold rests (no chain, no second SPLIT)
				_check("five_hold_rests_after_split", _rows("swings").size() == int(_mark["sw"]) + 1 and _rows("casts", 1).size() == 1,
					"%d swings since the hold" % (_rows("swings").size() - int(_mark["sw"])))
				hud.call("bot_attack_hold", false)
			if _t == 77:
				var a: Array = _rows("atk")
				_check("five_hold_release_logged", int(a[a.size() - 1][2]) == 0, str(a))
				_next()
		1:   # the chain's third hit is WHIRL (it is back); then, while it cools, the heavy third cut
			if _t == 30:
				_place(-1.2, 1.2)
				_mark["sw"] = _rows("swings").size()
				hud.call("bot_attack")
			if _t in [35, 41]:
				hud.call("bot_attack")
			if _t == 80:
				var sw: Array = _rows("swings").slice(int(_mark["sw"]))
				var idx: Array = []
				for s: Array in sw:
					idx.append(int(s[2]))
				var cs: Array = _rows("casts", 2)
				var ds: Array = _rows("derived", 2)
				_check("five_chain_into_whirl", idx == [0, 1] and cs.size() == 1, "swings %s, whirls %d" % [idx, cs.size()])
				_check("five_whirl_derived_row", ds.size() == 1 and int(ds[0][3]) == 1 and int(ds[0][4]) == 1, str(ds))
				if cs.size() == 1 and sw.size() >= 2:
					var gap: int = int(cs[0][1]) - int(sw[1][1])
					_check("five_whirl_inside_the_chain", gap >= 23 and gap <= 101, "%d cs after the second swing" % gap)
				_mark["sw"] = _rows("swings").size()
				hud.call("bot_attack")
			if _t in [85, 91, 97, 103]:
				hud.call("bot_attack")
			if _t == 130:
				var idx: Array = []
				for s: Array in _rows("swings").slice(int(_mark["sw"])):
					idx.append(int(s[2]))
				_check("five_heavy_third_while_whirl_cools", idx.slice(0, 3) == [0, 1, 2] and _rows("casts", 2).size() == 1,
					"swings %s, whirls %d" % [idx, _rows("casts", 2).size()])
				_next()
		2:   # RALLY by itself below half health, once per cooldown; presses of the three do nothing
			if _t == 30:
				_f.hero.hp = 600
			if _t == 33:
				_check("five_no_rally_above_half", _rows("casts", 3).is_empty())
				_f.hero.hp = 450
			if _t == 35:
				var cs: Array = _rows("casts", 3)
				var ds: Array = _rows("derived", 3)
				_check("five_rally_by_itself", cs.size() == 1, str(cs))
				_check("five_rally_derived_row", ds.size() == 1 and int(ds[0][3]) == 3 and int(ds[0][4]) == 450, str(ds))
			if _t == 60:
				_check("five_rally_healed", int(_f.hero.hp) == 600, str(_f.hero.hp))
				_f.hero.hp = 300
			if _t == 70:
				_check("five_rally_waits_its_cooldown", _rows("casts", 3).size() == 1, str(_rows("casts", 3).size()))
				for s: int in [1, 2, 3]:
					hud.call("bot_skill_slot", s)
			if _t == 75:
				var bad: bool = false
				for p: Array in _rows("presses"):
					bad = bad or int(p[2]) in [1, 2, 3]
				_check("five_no_press_for_the_three", not bad and _rows("casts", 1).size() == 1 and _rows("casts", 2).size() == 1, str(_rows("presses")))
				var jl: Dictionary = _f.call("judge_log")
				_check("five_record_names_table_3", str(jl["rules"]) == PINNED_V3 and int(jl["v"]) == 3 and jl.has("atk") and jl.has("swings") and jl.has("derived"))
				var n_derived: int = 0
				for c: Array in _rows("casts"):
					if int(c[2]) in [1, 2, 3]:
						n_derived += 1
				_check("five_every_unpressed_cast_has_its_reason", n_derived == _rows("derived").size(), "%d casts, %d rows" % [n_derived, _rows("derived").size()])
				_step = 99
				_finish()
				return true
	return false


func _next() -> void:
	_step += 1
	_t = 0


func _finish() -> void:
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
