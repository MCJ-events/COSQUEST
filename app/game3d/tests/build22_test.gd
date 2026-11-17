extends SceneTree
## build 22 (12 Nov 2026): Wale's panel from his own art, all eight skills on it, SHOOT and RAIN as real skills.
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tests/build22_test.gd
## 1. The panel: his five buttons sit at his sheet's own offsets and relative sizes (the sheet's pixels, scaled);
##    the three interim buttons (SPLIT, WHIRL, RALLY) are marked interim and never move his five, whichever
##    layout is chosen; every layout is clear and on screen, upright and sideways; the atlas holds every sprite.
## 2. SHOOT (slot 5, source 10): one hit per cast in its damage range, landing inside its window; its cooldown
##    holds; a shot dies at its range.
## 3. RAIN (slot 6, source 11): three volleys on the marked circle at their times; a target that leaves the
##    circle is not hit; its cooldown holds.
## 4. The rules table carries both skills (the server judges them, costquest-backend app/roam_fight3d.py).
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const HudScript := preload("res://hud.gd")
const FightScript := preload("res://fight.gd")
const PanelAtlas := preload("res://art/hud/wale/panel_atlas.gd")

var _fails: int = 0
var _f: Node
var _step: int = -1
var _t: int = 0
var _pin: Vector3 = Vector3.INF     # the Guardian is held here (it would walk to the hero)
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
	var cfg: Dictionary = {"mode": "full", "duration_s": 60, "autoplay": false, "seed": 77, "load_thread": false, "render_scale": 0.5, "intro": false}
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	(func() -> void: root.get_node("Bridge").call("start_fight", JSON.stringify(cfg))).call_deferred()


# ------------------------------------------------------------ 1. the panel

func _hud(extras: String, sz: Vector2) -> Control:
	var hud: Control = HudScript.new()
	hud.set("panel", "wale")
	hud.set("extras", extras)
	hud.size = sz
	return hud


func _panel() -> void:
	var hud: Control = _hud("arc", Vector2(720, 1280))
	# his five: the sheet's offsets from ATTACK and the sheet's radii, times one scale
	var k: float = HudScript.W_ATTACK_R / 203.94
	var sheet: Dictionary = {"dash": [Vector2(238.23, 807.97), 80.63], "shield": [Vector2(597.15, 211.05), 110.56],
		"shoot": [Vector2(287.89, 285.8), 96.75], "rain": [Vector2(170.59, 527.59), 92.28]}
	var worst: float = 0.0
	var his: int = 0
	var interim: Array = []
	for j in HudScript.W_BUTTONS.size():
		var id: String = str(HudScript.W_BUTTONS[j]["id"])
		if bool(hud.call("wale_interim", j)):
			interim.append(id)
			continue
		his += 1
		var want: Vector2 = ((sheet[id][0] as Vector2) - Vector2(601.14, 673.24)) * k
		worst = maxf(worst, (want - (hud.call("wale_at", j) as Vector2)).length())
		worst = maxf(worst, absf(float(sheet[id][1]) * k - float(hud.call("wale_r", j))))
	_check("his_four_round_the_attack", his == 4)
	_check("his_buttons_at_the_sheets_offsets_and_sizes", worst < 0.01, "worst %.3f px" % worst)
	interim.sort()
	_check("interim_are_split_whirl_rally", interim == ["rally", "split", "whirl"], str(interim))
	_check("atlas_marks_the_interim", bool(PanelAtlas.A["split"]["interim"]) and bool(PanelAtlas.A["whirl"]["interim"]) and bool(PanelAtlas.A["rally"]["interim"])
		and not bool(PanelAtlas.A["attack"]["interim"]) and not bool(PanelAtlas.A["shoot"]["interim"]))
	# the atlas: every button's three sprites inside the texture
	var tex: Texture2D = load("res://art/hud/wale/panel_atlas.png")
	var inside: bool = tex != null
	for id: String in ["attack", "dash", "shield", "shoot", "rain", "split", "whirl", "rally"]:
		for kind: String in ["on", "off", "seg"]:
			var r: Array = PanelAtlas.A[id][kind]
			inside = inside and Rect2(0, 0, tex.get_width(), tex.get_height()).encloses(Rect2(r[0], r[1], r[2], r[3]))
	_check("atlas_holds_every_sprite", inside)
	# his five never move with the layout of the other three; every layout is clear, upright and sideways
	var base: Array = []
	for j in HudScript.W_BUTTONS.size():
		base.append(hud.call("wale_at", j))
	hud.free()
	for extras: String in ["arc", "row", "column"]:
		for sz: Vector2 in [Vector2(720, 1280), Vector2(1280, 720)]:
			var h: Control = _hud(extras, sz)
			if sz.x > sz.y:
				h.set("side_l", 100.0)
				h.set("side_r", 70.0)
			var same: bool = true
			var discs: Array = [[h.call("attack_centre"), HudScript.W_ATTACK_R * 1.2, "attack"], [h.call("guard_centre"), HudScript.GUARD_R, "guard"]]
			for j in HudScript.W_BUTTONS.size():
				if not bool(h.call("wale_interim", j)):
					same = same and (h.call("wale_at", j) as Vector2).is_equal_approx(base[j])
				# with its halo
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
					if c.distance_to(discs[q][0]) < r + float(discs[q][1]) - 0.5:
						why += " %s over %s" % [discs[i][2], discs[q][2]]
			var tag: String = "%s_%s" % [extras, "landscape" if sz.x > sz.y else "portrait"]
			_check("his_five_do_not_move_" + tag, same)
			_check("layout_clear_" + tag, why == "", why)
			# every button casts its own skill
			var all_cast: bool = true
			for slot in HudScript.SKILL_N:
				var got: Array = []
				var cb := func(s: int, _a: float, _b: int, _c: String) -> void: got.append(s)
				h.connect("skill_pressed", cb)
				h.call("_down", 3, h.call("wale_centre", h.call("wale_button", slot)), "touch")
				h.call("_up", 3)
				h.disconnect("skill_pressed", cb)
				all_cast = all_cast and got == [slot]
			_check("every_button_casts_" + tag, all_cast)
			h.free()


# ------------------------------------------------------------ 4. the rules

func _rules() -> void:
	var t: Dictionary = FightScript.rules_table()
	_check("rules_seven_skills", (t["skill_cd_ms"] as Array).size() == 7 and (t["skill_len_ms"] as Array).size() == 7)
	_check("rules_shoot", t["shoot_dmg"] == [55, 75] and int(t["skill_cd_ms"][5]) == 3000 and int(t["shoot_at_ms"]) == 120 and int(t["shoot_window_ms"]) == 665, str(t.get("shoot_window_ms")))
	_check("rules_rain", t["rain_dmg"] == [60, 80] and int(t["skill_cd_ms"][6]) == 10000 and int(t["rain_delay_ms"]) == 800 and int(t["rain_gap_ms"]) == 200 and int(t["rain_waves"]) == 3)
	_check("rules_old_numbers_untouched", t["split_dmg"] == [200, 240] and int(t["skill_cd_ms"][1]) == 8000 and int(t["hp"]["boss"]) == 6500)
	_check("rules_version_2", FightScript.rules_id().begins_with("f3d-2-"), FightScript.rules_id())


# ------------------------------------------------------------ 2, 3. the skills, in a real fight

func _place(hero_z: float, enemy_z: float) -> void:
	_f.hero.position = Vector3(0, 0, hero_z)
	_pin = Vector3(0, 0, enemy_z)
	_f.enemy.position = _pin


func _hits(src: int) -> Array:
	var out: Array = []
	for h: Array in (_f.get("_jlog") as Dictionary)["hits"]:
		if int(h[3]) == src and int(h[2]) == 2:
			out.append(h)
	return out


func _casts(slot: int) -> Array:
	var out: Array = []
	for c: Array in (_f.get("_jlog") as Dictionary)["casts"]:
		if int(c[2]) == slot:
			out.append(c)
	return out


## A hit's amount is in `lo..hi` after the multipliers its flags name (crit x1.6, staggered x1.5, buffed x1.3).
func _in_range(h: Array, lo: int, hi: int) -> bool:
	var a: float = float(lo)
	var b: float = float(hi)
	for bit: Array in [[4, 1.3], [1, 1.6], [2, 1.5]]:
		if int(h[6]) & int(bit[0]):
			a = round(a * float(bit[1]))
			b = round(b * float(bit[1]))
	return int(h[4]) >= int(a) and int(h[4]) <= int(b)


func _process(_dt: float) -> bool:
	if _f == null:
		var b: Node = root.get_node_or_null("Bridge")
		_f = b.get("_fight") if b != null else null
		return false
	if not is_instance_valid(_f) or str(_f.state) != "fighting":
		if _step >= 0 and _step < 99:
			_check("the_fight_ran_to_the_end_of_the_script", false, "state %s at step %d" % [str(_f.state) if is_instance_valid(_f) else "gone", _step])
			_finish()
			return true
		return false
	if _step < 0:
		_step = 0
		_t = 0
	_t += 1
	_f.set("_enemy_cd", 99.0)          # the Guardian never strikes: the hero is free to cast
	_f.set("_ally_cd", 99.0)           # and the ally holds its bolts
	if _pin != Vector3.INF:
		_f.enemy.position = _pin
	var hud: Control = _f.get("hud")
	match _step:
		0:   # SHOOT at 8 m
			if _t == 2:
				_place(-4.0, 4.0)
				hud.call("bot_skill_slot", 5)
				_check("shoot_casts", _casts(5).size() == 1)
			if _t == 12:
				hud.call("bot_skill_slot", 5)      # 0.33 s later: still on its 3 s cooldown
			if _t == 40:
				var hs: Array = _hits(10)
				_check("shoot_one_hit", hs.size() == 1, str(hs.size()))
				_check("shoot_cooldown_holds", _casts(5).size() == 1, str(_casts(5).size()))
				if hs.size() == 1:
					var dl: int = int(hs[0][1]) - int(_casts(5)[0][1])
					_check("shoot_damage_in_range", _in_range(hs[0], 55, 75), str(hs[0]))
					_check("shoot_lands_in_its_window", dl >= 10 and dl <= 67 + 10, "%d cs after the cast" % dl)
			if _t == 100:   # 3.3 s on: it is back
				_place(-4.0, 4.0)
				hud.call("bot_skill_slot", 5)
				_check("shoot_back_after_its_cooldown", _casts(5).size() == 2, str(_casts(5).size()))
			if _t == 140:
				_check("shoot_second_hit", _hits(10).size() == 2, str(_hits(10).size()))
				_next()
		1:   # a shot dies at 12 m: the Guardian 17 m away is not hit
			if _t == 60:
				_place(-8.5, 8.5)
				_f.hero.call("face", Vector3(0, 0, 1), 0.0, 0.0)
				hud.call("bot_skill_slot", 5)
				_check("shoot_far_casts", _casts(5).size() == 3, str(_casts(5).size()))
			if _t == 100:
				_check("shoot_dies_at_its_range", _hits(10).size() == 2, str(_hits(10).size()))
				_next()
		2:   # RAIN on the Guardian where it stands
			if _t == 2:
				_place(-3.0, 3.0)
				hud.call("bot_skill_slot", 6)
				_check("rain_casts", _casts(6).size() == 1)
				_check("rain_marks_the_target", (_f.get("_rains") as Array).size() == 1 and ((_f.get("_rains") as Array)[0]["at"] as Vector3).distance_to(Vector3(0, 0, 3.0)) < 0.01)
			if _t == 20:
				_check("rain_is_telegraphed_first", _hits(11).is_empty(), str(_hits(11).size()))
				hud.call("bot_skill_slot", 6)      # still on its 10 s cooldown
			if _t == 60:
				var hs: Array = _hits(11)
				_check("rain_three_volleys", hs.size() == 3, str(hs.size()))
				_check("rain_cooldown_holds", _casts(6).size() == 1, str(_casts(6).size()))
				var c0: int = int(_casts(6)[0][1])
				var ok_t: bool = hs.size() == 3
				var ok_d: bool = true
				for i in hs.size():
					var dl: int = int(hs[i][1]) - c0
					ok_t = ok_t and dl >= 80 + 20 * i - 5 and dl <= 80 + 20 * i + 5
					ok_d = ok_d and _in_range(hs[i], 60, 80)
				_check("rain_volleys_at_their_times", ok_t, str(hs))
				_check("rain_damage_in_range", ok_d, str(hs))
				_next()
		3:   # a target that walks out of the circle is not hit
			if _t == 290:   # 10 s after the first RAIN
				_place(-3.0, 3.0)
				hud.call("bot_skill_slot", 6)
				_check("rain_back_after_its_cooldown", _casts(6).size() == 2, str(_casts(6).size()))
			if _t == 296:
				_pin = Vector3(0, 0, 8.5)          # 5.5 m from the mark: outside the 2.6 m circle
			if _t == 350:
				_check("rain_misses_a_target_that_left", _hits(11).size() == 3, str(_hits(11).size()))
				var skills: Array = _f.stats["skills"]
				_check("skills_counted", skills.size() == 7 and int(skills[5]) == 3 and int(skills[6]) == 2, str(skills))
				var j: Dictionary = _f.call("judge_log")
				_check("record_names_the_new_rules", str(j["rules"]) == FightScript.rules_id() and int(j["v"]) == 2)
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
