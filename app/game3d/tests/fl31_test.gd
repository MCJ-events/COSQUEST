extends SceneTree
## fight-look-31 (19 Nov 2026, the graphics pass; arena.gd "fl31"):
##   godot --headless --path app/game3d -s res://tests/fl31_test.gd
## 1. The look: every fl_ part on for mid and high, none on low (the low look stays build 21's key for key).
## 2. The light: with fl_light a time preset's key is whiter than build 30's and the sky's horizon cooler; without it the
##    preset is TIMES itself. The grade table: highlights keep their value, an orange loses saturation, grey stays grey.
## 3. The weapons: weapon_look.gd puts every surface of a palette-coloured mesh on vfx/weapon.gdshader.
## 4. A live fight on high (the street, autoplay, "bot_pace" 3): before the clock the 2D VS card shows and no close shot
##    weighs in (the close weight 0, the camera no nearer the hero than build 30's nearest, LC_CLOSE_DIST); while the fight
##    runs the camera never comes nearer than that either; the effects are tamed (fx.gd fl_fx) and the bot is paced.
##    Build 32: the hero's RAIN circle lands with a small tinted flash, a Guardian telegraph keeps its white one.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const ArenaScript := preload("res://arena.gd")
const FightScript := preload("res://fight.gd")
const WeaponLook := preload("res://weapon_look.gd")

var _fails: int = 0
var _frames: int = 0
var _vs_seen: bool = false
var _intro_ok: bool = true
var _fight_frames: int = 0
var _min_d: float = INF
var _intro_min_d: float = INF


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	# 1. the look
	var low: Dictionary = ArenaScript.look_opts({"look": {"time": "dusk"}})
	var ok: bool = true
	for t: String in ["mid", "high"]:
		var l: Dictionary = ArenaScript.look_opts({"tier": t, "look": {"time": "dusk"}})
		for k: String in ArenaScript.FL_PARTS:
			ok = ok and bool(l.get(k, false))
	for k: String in ArenaScript.FL_PARTS:
		ok = ok and not low.has(k)
	_check("parts_mid_high_not_low", ok and not low.has("fl31"))
	var off: Dictionary = ArenaScript.look_opts({"tier": "high", "look": {"time": "dusk", "fl_fx": false}})
	_check("part_switch_off", not bool(off.get("fl_fx", true)) and bool(off.get("fl_light", false)))
	# 2. the light and the grade
	var b30: Dictionary = ArenaScript.time_preset({"time": "dusk"})
	var fl: Dictionary = ArenaScript.time_preset({"time": "dusk", "fl_light": true})
	var kb: Color = b30["key_color"]
	var kf: Color = fl["key_color"]
	_check("key_whiter", kf.s < kb.s and b30 == ArenaScript.TIMES["dusk"], "s %.2f -> %.2f" % [kb.s, kf.s])
	_check("horizon_cooler", (fl["horizon"] as Color).b - (fl["horizon"] as Color).r > (b30["horizon"] as Color).b - (b30["horizon"] as Color).r)
	var white: Color = ArenaScript.fl_grade_color(Color(0.97, 0.97, 0.97))
	var orange: Color = Color(0.8, 0.5, 0.25)
	var og: Color = ArenaScript.fl_grade_color(orange)
	var grey: Color = ArenaScript.fl_grade_color(Color(0.5, 0.5, 0.5))
	_check("grade_highlights_kept", absf(white.r - 0.97) < 0.02 and absf(white.b - 0.97) < 0.02, str(white))
	_check("grade_orange_calmer", og.s < orange.s, "%.2f -> %.2f" % [orange.s, og.s])
	_check("grade_grey_neutral_cool", grey.b >= grey.r and grey.b - grey.r < 0.08, str(grey))
	# 3. the weapons
	var w := Node3D.new()
	var mi := MeshInstance3D.new()
	mi.mesh = BoxMesh.new()
	var sm := StandardMaterial3D.new()
	sm.albedo_color = Color(0.6, 0.62, 0.65)
	mi.material_override = sm
	w.add_child(mi)
	var n: int = WeaponLook.apply(w, {"time": "dusk"})
	var m0: Material = mi.get_surface_override_material(0)
	_check("weapon_material", n == 1 and m0 is ShaderMaterial and (m0 as ShaderMaterial).shader == WeaponLook.WEAPON_SHADER and mi.material_override == null)
	w.free()
	# 4. a live fight on high
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	var cfg: Dictionary = {"mode": "full", "duration_s": 45, "autoplay": true, "seed": 239, "load_thread": false, "place_thread": false,
		"quality": "device", "dyn_res": false, "music": false, "sound": false, "tier": "high", "hero_cast": true, "faction": "icons",
		"intro": true, "bot_pace": 3.0, "look": {"time": "dusk"}}
	(func() -> void:
		root.get_node("Bridge").call("start_fight", JSON.stringify(cfg))).call_deferred()


func _process(_dt: float) -> bool:
	_frames += 1
	var b: Node = root.get_node_or_null("Bridge")
	var fi: Node = b.get("_fight") if b != null else null
	if fi == null or not is_instance_valid(fi):
		if _frames > 3000:
			_check("fight_started", false)
			return _done()
		return false
	var st: String = str(fi.get("state"))
	var cam: Camera3D = fi.get("cam")
	var hero: Node3D = fi.get("hero")
	if cam != null and hero != null and (st == "intro" or st == "fighting"):
		var d: float = cam.global_position.distance_to(hero.global_position + Vector3.UP * FightScript.LC_PIVOT_H)
		if st == "intro":
			_intro_min_d = minf(_intro_min_d, d)
			if float(fi.get("_beat_t")) >= 0.0:
				_vs_seen = _vs_seen or bool((fi.get("hud") as Node).call("vs_showing"))
				_intro_ok = _intro_ok and float(fi.get("_lc_close")) == 0.0
		else:
			_fight_frames += 1
			_min_d = minf(_min_d, d)
	if st == "fighting" and _fight_frames >= 150:
		_check("vs_card_in_intro", _vs_seen)
		_check("no_close_shot_in_intro", _intro_ok and _intro_min_d >= FightScript.LC_CLOSE_DIST - 0.05, "min=%.2f" % _intro_min_d)
		_check("camera_never_nearer_than_build30", _min_d >= FightScript.LC_CLOSE_DIST - 0.05, "min=%.2f" % _min_d)
		_check("fx_tamed", bool((fi.get("fx") as Node).get("fl_fx")))
		_check("bot_paced", is_equal_approx(float(fi.get("_bot_pace")), 3.0))
		_check_rain_flash(fi.get("fx") as Node)
		return _done()
	if _frames > 6000:
		_check("reached_fight", false, "state=%s" % st)
		return _done()
	return false


## build 32: the hero's RAIN circle lands with a small flash in its own tint (fx.gd telegraph_land_own); a Guardian
## telegraph keeps its white 0.8 flash.
func _check_rain_flash(fx: Node) -> void:
	var own: MeshInstance3D = fx.call("telegraph", Vector3.ZERO, 0.0, 2.6, 180.0, 0.8, Color(1.0, 0.29, 0.24))
	fx.call("telegraph_land_own", own, Color("#FFD9C9"))
	var boss: MeshInstance3D = fx.call("telegraph", Vector3(3, 0, 0), 0.0, 2.0, 180.0, 0.8)
	fx.call("telegraph_end", boss, true)
	var fo: float = -1.0
	var fb: float = -1.0
	for d: Dictionary in fx.get("_live"):
		if d["node"] == own:
			fo = float(d.get("flash", -1.0))
		elif d["node"] == boss:
			fb = float(d.get("flash", -1.0))
	var col: Color = (own.material_override as ShaderMaterial).get_shader_parameter("flash_col")
	_check("rain_flash_tamed", fo > 0.0 and fo <= 0.25 and col.b < 0.9, "flash=%.2f col=%s" % [fo, str(col)])
	_check("guardian_flash_kept", is_equal_approx(fb, 0.8), "flash=%.2f" % fb)


func _done() -> bool:
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
	return true
