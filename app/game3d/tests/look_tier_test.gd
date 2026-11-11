extends SceneTree
## realism (11 Nov 2026): the device tiers of the fighters' look (arena.gd TIER_LOOK, LOOK.md "The real look").
##   godot --headless --path app/game3d -s res://tests/look_tier_test.gd
## 1. The low tier is build 21's look, key for key: a config with no "tier", with "tier": "low" and with a
##    tier nobody knows all give exactly the look below, the fighters stay on vfx/char_lit.gdshader (the
##    file itself unchanged, by its sha256), a character loads without looking for a skin mask, and the
##    hero's file is not swapped for another detail level.
## 2. The mid and high tiers turn on what the bar gives them (BAR.md section E) and nothing else.
## 3. The baked data the real look reads is there: a cube and six ambient colours per time of day, and
##    the base and faction grade tables.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const ArenaScript := preload("res://arena.gd")
const FighterScript := preload("res://fighter.gd")
const FightScript := preload("res://fight.gd")
const LoaderScript := preload("res://char_loader.gd")
const LookReal := preload("res://look_real.gd")
const LIT_SHADER := preload("res://vfx/char_lit.gdshader")
const REAL_SHADER := preload("res://vfx/char_real.gdshader")

## build 21's look for a golden-hour fight (arena.gd look_opts at a51a640), written out by hand
const BUILD21_GOLDEN: Dictionary = {
	"sky": true, "fog": true, "glow": false, "grade": false, "rim": true, "feet": true, "ao": true, "halos": true,
	"shadows": "auto", "tonemap": "aces", "bloom": true, "post": false, "time": "golden", "sky_draw": true,
	"street": "place", "bloom_strength": 0.5, "bloom_threshold": 0.62, "bloom_cap": 0.28,
}
const CHAR_LIT_SHA256: String = "efb800d0b4f56ed3692b296d080b5bf493a4ab1fabe67c9fe134cc6e2c827cbb"

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _same(a: Dictionary, b: Dictionary) -> String:
	for k: String in a:
		if not b.has(k):
			return "extra key " + k
		if typeof(a[k]) != typeof(b[k]) or str(a[k]) != str(b[k]):
			return "%s = %s, build 21 has %s" % [k, str(a[k]), str(b[k])]
	for k: String in b:
		if not a.has(k):
			return "missing key " + k
	return ""


func _material(look: Dictionary) -> ShaderMaterial:
	var f: Node3D = FighterScript.new()
	f.set("look", look)
	var m := StandardMaterial3D.new()
	var sm: ShaderMaterial = f.call("_lit_material", m)
	f.free()
	return sm


func _initialize() -> void:
	# 1. low = build 21
	for cfg: Dictionary in [{}, {"tier": "low"}, {"tier": "ultra"}, {"tier": 3}]:
		var c: Dictionary = cfg.duplicate()
		c["look"] = {"time": "golden"}
		var why: String = _same(ArenaScript.look_opts(c), BUILD21_GOLDEN)
		_check("low_look_unchanged tier=%s" % str(cfg.get("tier", "-")), why == "", why)
	_check("low_tier_adds_nothing", (ArenaScript.TIER_LOOK["low"] as Dictionary).is_empty())
	var night: Dictionary = ArenaScript.look_opts({"look": {"time": "night"}})
	_check("low_night_is_dusk", str(night["time"]) == "dusk", str(night["time"]))
	var low_m: ShaderMaterial = _material(ArenaScript.look_opts({"look": {"time": "golden"}}))
	_check("low_fighter_shader", low_m != null and low_m.shader == LIT_SHADER)
	_check("low_fighter_shader_file", FileAccess.get_sha256("res://vfx/char_lit.gdshader") == CHAR_LIT_SHA256, FileAccess.get_sha256("res://vfx/char_lit.gdshader"))
	var r: Dictionary = LoaderScript.new().load_glb("res://cast/armstrong_lod2.glb")
	if bool(r.get("ok", false)):
		(r["node"] as Node).free()
	_check("low_load_as_before", bool(r.get("ok", false)) and not r.has("skin_mask"), "ok=%s" % str(r.get("ok")))
	var fight: Node = FightScript.new()
	_check("low_no_lod_swap", str(fight.call("_tier_lod", "res://cast/armstrong_lod1.glb", "hero")) == "res://cast/armstrong_lod1.glb")
	fight.free()
	# 2. mid and high
	var mid: Dictionary = ArenaScript.look_opts({"tier": "mid", "look": {"time": "golden"}})
	_check("mid_real_simple_skin", bool(mid.get("real", false)) and str(mid.get("skin")) == "simple" and bool(mid.get("ibl", false)))
	_check("mid_no_post_no_lod0", str(mid["grade"]) == "false" and not bool(mid["glow"]) and not mid.has("hero_lod") and not mid.has("scale") and str(mid["shadows"]) == "auto")
	var high: Dictionary = ArenaScript.look_opts({"tier": "high", "look": {"time": "golden"}})
	_check("high_real_full", bool(high.get("real", false)) and str(high.get("skin")) == "full" and str(high["grade"]) == "base"
		and int(high.get("hero_lod", 1)) == 0 and float(high.get("scale", 0.0)) == 1.0 and str(high["shadows"]) == "true" and not bool(high["glow"]))
	var over: Dictionary = ArenaScript.look_opts({"tier": "high", "look": {"time": "golden", "real": false, "grade": false}})
	_check("config_overrides_tier", not bool(over["real"]) and str(over["grade"]) == "false")
	var high_m: ShaderMaterial = _material(high)
	_check("high_fighter_shader", high_m != null and high_m.shader == REAL_SHADER)
	# 3. the baked data
	for t: String in ["golden", "day", "dusk", "night"]:
		var e: Dictionary = LookReal.env_for(t)
		_check("env_" + t, e.has("cube") and (e.get("amb", PackedVector3Array()) as PackedVector3Array).size() == 6 and float(e.get("lods", 0.0)) == 5.0)
	_check("lut_base", LookReal.lut_for("base") != null)
	_check("lut_faction", LookReal.lut_for("faction_celestials") != null and LookReal.lut_for("faction_nobody") == null)
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
