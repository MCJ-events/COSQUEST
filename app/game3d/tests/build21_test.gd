extends SceneTree
## build 21 (11 Nov 2026): what needs no device.
##   godot --headless --path app/game3d -s res://tests/build21_test.gd
## 1. Wale's attack panel (59328): ATTACK, DASH (= CHARGE, slot 0) and SHIELD (slot 4) cast what
##    they did; SHOOT and RAIN are locked and send nothing to the fight; GUARD still works; the
##    old arc is still there as panel = "classic".
## 2. Landscape (config "landscape", 1280 x 720 HUD): the stick and the panel move in by the side
##    insets, nothing overlaps or leaves the screen, and taps still land.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const HudScript := preload("res://hud.gd")

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _hud(panel: String, sz: Vector2 = Vector2(720, 1280)) -> Control:
	var hud: Control = HudScript.new()
	hud.set("panel", panel)
	hud.size = sz
	return hud


## Taps `p` and lifts; returns what the HUD sent: ["attack"], ["skill", slot], ["guard"] or [].
func _tap(hud: Control, p: Vector2) -> Array:
	var got: Array = []
	var a := func(_t: float, _k: int, _s: String) -> void: got.append("attack")
	var s := func(slot: int, _t: float, _k: int, _s: String) -> void: got.append_array(["skill", slot])
	var g := func(on: bool, _t: float, _k: int, _s: String) -> void:
		if on:
			got.append("guard")
	hud.connect("attack_pressed", a)
	hud.connect("skill_pressed", s)
	hud.connect("guard_changed", g)
	hud.call("_down", 7, p, "touch")
	hud.call("_up", 7)
	hud.disconnect("attack_pressed", a)
	hud.disconnect("skill_pressed", s)
	hud.disconnect("guard_changed", g)
	return got


func _initialize() -> void:
	_panel()
	_landscape()
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)


func _panel() -> void:
	var hud: Control = _hud("wale")
	var ac: Vector2 = hud.call("attack_centre")
	_check("wale_attack", _tap(hud, ac) == ["attack"])
	var dash: int = hud.call("wale_button", 0)
	var shield: int = hud.call("wale_button", 4)
	_check("wale_has_dash_and_shield", dash >= 0 and shield >= 0)
	_check("wale_dash_is_charge", _tap(hud, hud.call("wale_centre", dash)) == ["skill", 0])
	_check("wale_shield_is_shield", _tap(hud, hud.call("wale_centre", shield)) == ["skill", 4])
	_check("wale_no_split_whirl_rally", int(hud.call("wale_button", 1)) < 0 and int(hud.call("wale_button", 2)) < 0 and int(hud.call("wale_button", 3)) < 0)
	var locked: Array = []
	for j in HudScript.W_BUTTONS.size():
		if int(HudScript.W_BUTTONS[j]["slot"]) < 0:
			locked.append(str(HudScript.W_BUTTONS[j]["id"]))
			var got: Array = _tap(hud, hud.call("wale_centre", j))
			_check("wale_locked_%s_sends_nothing" % HudScript.W_BUTTONS[j]["id"], got.is_empty(), str(got))
	_check("wale_locked_are_shoot_and_rain", locked == ["shoot", "rain"], str(locked))
	_check("wale_locked_says_coming_soon", str(hud.get("_toast")) == "Coming soon")
	_check("wale_guard", _tap(hud, hud.call("guard_centre")) == ["guard"])
	_check("wale_dash_label", str(hud.call("skill_label", 0)) == "DASH" and str(hud.call("skill_label", 4)) == "SHIELD")
	# the buttons do not overlap each other, the attack or the guard, and stay on screen
	var discs: Array = [[ac, HudScript.W_ATTACK_R], [hud.call("guard_centre"), HudScript.GUARD_R]]
	for j in HudScript.W_BUTTONS.size():
		discs.append([hud.call("wale_centre", j), float(HudScript.W_BUTTONS[j]["r"])])
	var clear: bool = true
	for i in discs.size():
		var ci: Vector2 = discs[i][0]
		var ri: float = discs[i][1]
		if ci.x - ri < 0.0 or ci.y - ri < 0.0 or ci.x + ri > 720.0 or ci.y + ri > 1280.0:
			clear = false
		for k in range(i + 1, discs.size()):
			if ci.distance_to(discs[k][0]) < ri + float(discs[k][1]) + 4.0:
				clear = false
	_check("wale_buttons_clear", clear)
	# the hidden slots' toasts land over the attack, not off screen
	var t1: Vector2 = hud.call("skill_centre", 1)
	_check("wale_hidden_slot_toast_on_screen", Rect2(Vector2.ZERO, Vector2(720, 1280)).has_point(t1), str(t1))
	hud.free()
	# the old arc, as before
	var old: Control = _hud("classic")
	_check("classic_whirl", _tap(old, old.call("skill_centre", 2)) == ["skill", 2])
	_check("classic_label", str(old.call("skill_label", 0)) == "CHARGE")
	old.free()


func _landscape() -> void:
	var sz := Vector2(1280, 720)
	var hud: Control = _hud("wale", sz)
	hud.set("side_l", 100.0)
	hud.set("side_r", 70.0)
	var ac: Vector2 = hud.call("attack_centre")
	_check("land_attack_moves_in", is_equal_approx(ac.x, 1280.0 - 70.0 - HudScript.ATTACK_FROM_BR.x), str(ac))
	var st: Vector2 = hud.call("_stick_home")
	_check("land_stick_moves_in", is_equal_approx(st.x, 100.0 + HudScript.STICK_HOME_FROM_BL.x), str(st))
	_check("land_attack_tap", _tap(hud, ac) == ["attack"])
	_check("land_shield_tap", _tap(hud, hud.call("wale_centre", hud.call("wale_button", 4))) == ["skill", 4])
	var screen := Rect2(Vector2.ZERO, sz)
	var ok: bool = screen.grow(-1.0).has_point(st + Vector2(-HudScript.STICK_BASE_R, 0)) and st.x - HudScript.STICK_BASE_R >= 100.0
	for j in HudScript.W_BUTTONS.size():
		var c: Vector2 = hud.call("wale_centre", j)
		var r: float = float(HudScript.W_BUTTONS[j]["r"]) * 1.2
		ok = ok and c.y - r >= 0.0 and c.x + r <= 1280.0 - 70.0 + 1.0
	var mc: Vector2 = hud.call("_map_centre")
	ok = ok and mc.x + HudScript.MAP_R <= 1280.0 - 70.0
	# the panel's top (the shield) stays under the minimap
	var sh: Vector2 = hud.call("wale_centre", hud.call("wale_button", 4))
	ok = ok and sh.y - 40.0 > mc.y + HudScript.MAP_R
	_check("land_all_on_screen_and_clear", ok)
	hud.free()
