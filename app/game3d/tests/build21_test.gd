extends SceneTree
## build 21 (11 Nov 2026): what needs no device.
##   godot --headless --path app/game3d -s res://tests/build21_test.gd
## 1. Wale's attack panel (59328), as build 22 draws it (his own art; tests/build22_test.gd has the rest):
##    ATTACK, DASH (= CHARGE, slot 0) and SHIELD (slot 4) cast what they did; SHOOT and RAIN cast
##    their own skills (slots 5 and 6: nothing is locked); SPLIT, WHIRL and RALLY have buttons again;
##    GUARD still works; the old arc is still there as panel = "classic".
## 2. Landscape (config "landscape", 1280 x 720 HUD): the stick and the panel move in by the side
##    insets, nothing overlaps or leaves the screen, and taps still land.
## 3. The fight fixes from the build 20 review (presentation only; the five seeded fights stay
##    byte-identical, e2e on the farm):
##    a. the Guardian's feet: sole markers on both hooves, and after a moment of idle the lower sole
##       is on the paving (it stood off it, and sank 30 cm into it in its chop and stagger);
##    b. the hit flash is a rim and a light tint (the shader's white body is the dissolve's glow
##       only), and a hit never raises the glow;
##    c. the victory shot: an ally at the hero's shoulder walks out to WIN_SPACING across the view,
##       then cheers; the shot looks between the two;
##    d. the whirl: the clip, the blades' sweep and the ring all turn clockwise seen from above, the
##       procedural spin too, and the drawn body ends the spin facing its target;
##    e. the stagger's arms: the clip keeps a third of its arm swing and the boss's arms hang closer;
##    f. damage numbers: each belongs to its fighter, at most three per fighter, and slides clear of
##       the fighter's body box.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const HudScript := preload("res://hud.gd")
const FightScript := preload("res://fight.gd")
const FighterScript := preload("res://fighter.gd")
const FxScript := preload("res://fx.gd")
const AnimLib := preload("res://anim_library.gd")
const LIT_SHADER := preload("res://vfx/char_lit.gdshader")
const FLASH_SHADER := preload("res://vfx/flash.gdshader")

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


var _g: FighterScript          # the Guardian (hoof) for the frame-driven checks
var _t: int = 0
var _step: int = 0


func _initialize() -> void:
	_panel()
	_landscape()
	_victory()
	_stagger_static()
	_numbers()
	_g = FighterScript.new()
	root.add_child(_g)
	_g.setup("Guardian", 1, 1000, Color.WHITE, "boss")
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	doc.append_from_file("res://cast/hoof_lod1.glb", st)
	_g.anim_opts = {"key": "hoof", "class": ""}
	_g.set_model(doc.generate_scene(st))
	_check("guardian_bound", _g.anim.lib_key == "hoof" and _g.anim.has_clip("stagger"), _g.anim.lib_key)
	_check("boss_arm_droop", _g.anim.arm_droop > 0.0)


func _process(dt: float) -> bool:
	if _g == null:
		return true
	_t += 1
	_g.tick_logic(dt)
	_g.tick_visual(dt)
	match _step:
		0:
			if _t == 1:
				_flash()          # these need the tree running (a node's _ready, global transforms)
				_whirl_static()
			if _t == 2:
				var marks: Array = _g.get("_soles")
				_check("guardian_sole_markers", marks.size() == 2 and not (marks[0] as Array).is_empty() and not (marks[1] as Array).is_empty(), str(marks.size()))
			if _t > 40:
				# the lower sole, with the body's turn and the planting offset, on the ground
				var b := Basis.from_euler(_g.body.rotation).scaled(_g.body.scale)
				var h: float = _g.sole_height(b) + _g.body.position.y
				_check("guardian_feet_planted_idle", absf(h) < 0.03 * _g.size_k, "sole=%.3f plant=%.3f" % [h, float(_g.get("_plant_y"))])
				# d. the whirl ends facing its target (the drawn body only; the yaw is the game's)
				_g.yaw = 0.0
				_g.rotation.y = 0.0
				_g.act("skill_whirl", 0.5)
				_check("procedural_spin_clockwise", float(_g.get("_spin_dir")) < 0.0)
				_step = 1
				_t = 0
		1:
			_g.face_yaw = 1.2
			if _t == 14:   # the spin's last frame (0.5 s at 30 fps)
				var drawn: float = wrapf(_g.body.rotation.y, -PI, PI)
				_check("whirl_ends_facing_target", absf(wrapf(drawn - 1.2, -PI, PI)) < 0.2, "drawn=%.2f" % drawn)
				_check("whirl_yaw_is_the_games", is_equal_approx(_g.yaw, 0.0))
			if _t > 16:
				_g.face_yaw = NAN
				_g.free()
				_g = null
				print("CQTEST done failures=%d" % _fails)
				quit(1 if _fails > 0 else 0)
				return true
	return false


func _flash() -> void:
	var lit: String = LIT_SHADER.code
	_check("flash_no_white_body", lit.contains("smoothstep(0.35, 1.0, glow)") and not lit.contains("smoothstep(0.35, 1.0, flash)"))
	_check("overlay_no_white_body", FLASH_SHADER.code.contains("smoothstep(0.35, 1.0, glow)") and not FLASH_SHADER.code.contains("smoothstep(0.35, 1.0, flash)"))
	var f: FighterScript = FighterScript.new()
	root.add_child(f)
	f.setup("Guardian", 1, 1000, Color.WHITE, "boss")
	f.flash(0.95)
	f.tick_visual(1.0 / 30.0)
	_check("hit_flash_raises_no_glow", float(f.get("_glow")) == 0.0 and float(f.get("_flash")) > 0.5)
	f.dissolve(0.7)
	f.tick_visual(1.0 / 30.0)
	_check("dissolve_glows", float(f.get("_glow")) > 0.5)
	f.free()


func _victory() -> void:
	var fight: Node3D = FightScript.new()
	var hero: FighterScript = FighterScript.new()
	var ally: FighterScript = FighterScript.new()
	hero.setup("Armstrong", 0, 1000, Color.WHITE, "hero")
	ally.setup("Bobo", 0, 1000, Color.WHITE, "ally")
	hero.position = Vector3(1.0, 0, 2.0)
	ally.position = Vector3(1.6, 0, 2.5)    # at the hero's shoulder, a little behind
	fight.set("hero", hero)
	fight.set("ally", ally)
	fight.set("_cam_right", Vector3(1, 0, 0))
	fight.set("_cam_fwd", Vector3(0, 0, -1))
	fight.call("_win_ally_step")
	var to: Vector3 = fight.get("_ally_to")
	_check("victory_ally_steps_out", to != Vector3.INF and absf((to - hero.position).x) >= FightScript.WIN_SPACING - 0.01, str(to))
	var mid: Vector3 = fight.call("_winners_at")
	_check("victory_frames_both", mid.distance_to((hero.position + to) * 0.5) < 0.01, str(mid))
	for i in 60:
		fight.call("_tick_ally_step", 1.0 / 30.0)
	_check("victory_ally_arrives_and_cheers", ally.celebrating and absf(ally.position.x - hero.position.x) >= FightScript.WIN_SPACING - 0.01, str(ally.position))
	_check("victory_looks_at_the_winners", FightScript.WIN_AHEAD < 2.0)
	# by the kerb, the ally goes to the other side
	hero.position = Vector3(FightScript.ARENA_HALF_X - 0.5, 0, 0)
	ally.position = hero.position + Vector3(0.4, 0, 0)
	ally.celebrating = false
	fight.call("_win_ally_step")
	to = fight.get("_ally_to")
	_check("victory_ally_stays_in_the_street", to != Vector3.INF and absf(to.x) <= FightScript.ARENA_HALF_X and to.x < hero.position.x, str(to))
	# already apart: stays
	ally.position = hero.position - Vector3(2.4, 0, 0)
	fight.call("_win_ally_step")
	_check("victory_apart_ally_stays", fight.get("_ally_to") == Vector3.INF)
	hero.free()
	ally.free()
	fight.free()


## The whirl clip's hips turn (deg over the clip), + = counter-clockwise seen from above.
func _clip_turn(key: String, clip: String) -> float:
	var lib: AnimationLibrary = AnimLib.library(key)
	if lib == null or not lib.has_animation(clip):
		return 0.0
	var a: Animation = lib.get_animation(clip)
	for i in a.get_track_count():
		if a.track_get_type(i) == Animation.TYPE_ROTATION_3D and str(a.track_get_path(i)).ends_with(":Hips"):
			var acc: float = 0.0
			var prev: float = 0.0
			for k in 33:
				var f: Vector3 = Basis(a.rotation_track_interpolate(i, a.length * k / 32.0)) * Vector3(0, 0, 1)
				var y: float = atan2(f.x, f.z)
				if k > 0:
					acc += wrapf(y - prev, -PI, PI)
				prev = y
			return rad_to_deg(acc)
	return 0.0


func _whirl_static() -> void:
	_check("whirl_clip_turns_clockwise", _clip_turn("armstrong", "2H_Melee_Attack_Spinning") < -300.0)
	var fx: Node3D = FxScript.new()
	root.add_child(fx)
	fx.call("whirl", Vector3.ZERO, 3.0, [Color(1, 0.5, 0.1), Color(1, 0.8, 0.3)], 1.0, false)
	var arcs: int = 0
	var cw: int = 0
	for d: Dictionary in fx.get("_live"):
		if str(d.get("kind", "")) != "arc":
			continue
		arcs += 1
		var bs: Basis = (d["node"] as Node3D).basis
		# the crescent's head runs from u = 0 (-80 deg) through its middle (+Z): clockwise seen from
		# above when that turn's cross product points down
		var p0: Vector3 = bs * Vector3(sin(deg_to_rad(-80.0)), 0, cos(deg_to_rad(-80.0)))
		var pm: Vector3 = bs * Vector3(0, 0, 1)
		if p0.cross(pm).y < 0.0 and float(d["spin"]) < 0.0:
			cw += 1
	_check("whirl_blades_sweep_with_the_spin", arcs == 4 and cw == arcs, "arcs=%d clockwise=%d" % [arcs, cw])
	fx.free()


func _stagger_static() -> void:
	var lib: AnimationLibrary = AnimLib.library("hoof")
	var a: Animation = lib.get_animation("Stagger_Back") if lib != null else null
	var worst: float = 0.0
	if a != null:
		for i in a.get_track_count():
			if a.track_get_type(i) != Animation.TYPE_ROTATION_3D or not str(a.track_get_path(i)).ends_with("Arm"):
				continue
			var q0: Quaternion = a.track_get_key_value(i, 0)
			for k in a.track_get_key_count(i):
				worst = maxf(worst, rad_to_deg(q0.angle_to(a.track_get_key_value(i, k))))
	_check("stagger_arms_softened", a != null and worst > 5.0 and worst < 40.0, "worst=%.1f (was 86)" % worst)


func _numbers() -> void:
	var hud: Control = _hud("wale")
	var units: Array[Dictionary] = [{"id": 5, "name": "Guardian", "hp": 900, "max": 1000, "team": 1, "head": Vector3(0, 3.9, 0),
		"feet": Vector3.ZERO, "chest": Vector3(0, 2.1, 0), "hw": 0.68, "is_hero": false},
		{"id": 6, "name": "Armstrong", "hp": 900, "max": 1000, "team": 0, "head": Vector3(0, 2.6, 4),
		"feet": Vector3(0, 0, 4), "chest": Vector3(0, 1.4, 4), "hw": 0.42, "is_hero": true}]
	hud.set("units", units)
	for i in 5:
		hud.call("pop", Vector3(0, 2.5, 0), str(100 + i), "normal")
	var pops: Array = hud.get("_pops")
	var live_g: int = 0
	for d: Dictionary in pops:
		if int(d.get("uid", 0)) == 5 and not d.has("out"):
			live_g += 1
	_check("numbers_belong_to_their_fighter", int((pops[-1] as Dictionary).get("uid", 0)) == 5)
	_check("numbers_at_most_three_per_fighter", live_g <= HudScript.POP_PER_UNIT, "live=%d" % live_g)
	# a body box in the middle of the screen: every number slides clear of it, on its own side
	var body := Rect2(Vector2(300, 300), Vector2(120, 400))
	(hud.get("_bodies") as Dictionary)[5] = body
	var clear: bool = true
	for d: Dictionary in pops:
		var p := Vector2(360 + float(d["dx"]), 420)
		var x: float = p.x + float(hud.call("_body_clear", d, p))
		var hw: float = 26.0 * HudScript.PT * 0.34 * float(str(d["s"]).length())
		if x + hw > body.position.x and x - hw < body.end.x:
			clear = false
		if signf(x - body.get_center().x) != signf(float(d["dx"])):
			clear = false
	_check("numbers_clear_of_the_body", clear)
	hud.free()


func _panel() -> void:
	var hud: Control = _hud("wale")
	var ac: Vector2 = hud.call("attack_centre")
	_check("wale_attack", _tap(hud, ac) == ["attack"])
	var dash: int = hud.call("wale_button", 0)
	var shield: int = hud.call("wale_button", 4)
	_check("wale_has_dash_and_shield", dash >= 0 and shield >= 0)
	_check("wale_dash_is_charge", _tap(hud, hud.call("wale_centre", dash)) == ["skill", 0])
	_check("wale_shield_is_shield", _tap(hud, hud.call("wale_centre", shield)) == ["skill", 4])
	# build 22: every skill has a button and every button casts its own skill; nothing says "coming soon"
	var all_cast: bool = true
	for slot in HudScript.SKILL_N:
		var j: int = hud.call("wale_button", slot)
		all_cast = all_cast and j >= 0 and _tap(hud, hud.call("wale_centre", j)) == ["skill", slot]
	_check("wale_every_skill_has_a_button_that_casts_it", all_cast)
	_check("wale_nothing_locked", str(hud.get("_toast")) == "")
	_check("wale_guard", _tap(hud, hud.call("guard_centre")) == ["guard"])
	_check("wale_dash_label", str(hud.call("skill_label", 0)) == "DASH" and str(hud.call("skill_label", 4)) == "SHIELD")
	# the buttons do not overlap each other, the attack or the guard, and stay on screen
	var discs: Array = [[ac, HudScript.W_ATTACK_R], [hud.call("guard_centre"), HudScript.GUARD_R]]
	for j in HudScript.W_BUTTONS.size():
		discs.append([hud.call("wale_centre", j), float(hud.call("wale_r", j))])
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
		var r: float = float(hud.call("wale_r", j)) * 1.2
		ok = ok and c.y - r >= 0.0 and c.x + r <= 1280.0 - 70.0 + 1.0
	var mc: Vector2 = hud.call("_map_centre")
	ok = ok and mc.x + HudScript.MAP_R <= 1280.0 - 70.0
	# the panel's top (the shield) stays under the minimap
	var sh: Vector2 = hud.call("wale_centre", hud.call("wale_button", 4))
	ok = ok and sh.y - 40.0 > mc.y + HudScript.MAP_R
	_check("land_all_on_screen_and_clear", ok)
	hud.free()
