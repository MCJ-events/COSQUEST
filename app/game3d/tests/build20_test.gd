extends SceneTree
## build 20 (9 Nov 2026): the fight's presentation fixes that need no device.
##   godot --headless --path app/game3d -s res://tests/build20_test.gd
## 1. A fighter with no model of its own gets a shipped cast character (not a capsule): the hero
##    and the ally fixed, the Guardian by the seed, never one another fighter already wears, and
##    "cast_stand_in": false keeps the capsule.
## 2. The HUD's top block moves down by the safe area: shapes by the canvas transform, text
##    (drawn later from a queue) by the same offset, scaled text by its transform's origin.
## The seeded fight records (with models) are unchanged: e2e, five seeds headless before and after.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const FightScript := preload("res://fight.gd")
const FighterScript := preload("res://fighter.gd")
const HudScript := preload("res://hud.gd")
const AnimLib := preload("res://anim_library.gd")
const ArenaScript := preload("res://arena.gd")
const FeelScript := preload("res://feel.gd")

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _stand_ins(cfg: Dictionary, roles: Array = ["hero", "ally", "enemy"]) -> Dictionary:
	var fight: Node3D = FightScript.new()
	fight.set("cfg", cfg)
	var out: Dictionary = {}
	for role: String in roles:
		var f: Node3D = FighterScript.new()
		out[role] = fight.call("_cast_stand_in", f, role)
		out[role + "_key"] = (f.get("anim_opts") as Dictionary).get("key", "")
		f.free()
	fight.free()
	return out


func _initialize() -> void:
	var a: Dictionary = _stand_ins({"seed": 239})
	_check("hero_stand_in", str(a["hero"]) == "res://cast/armstrong_lod1.glb" and a["hero_key"] == "armstrong", str(a))
	_check("ally_stand_in", str(a["ally"]) == "res://cast/bobo_lod1.glb" and a["ally_key"] == "bobo", str(a))
	_check("enemy_stand_in_is_a_cast_character", str(a["enemy"]).begins_with("res://cast/") and FileAccess.file_exists(str(a["enemy"])), str(a))
	var seen: Dictionary = {}
	for s in range(8):
		seen[str(_stand_ins({"seed": s})["enemy_key"])] = true
	_check("guardian_varies_by_seed", seen.size() >= 3, str(seen.keys()))
	# the hero wears its own Forge model, which is Bobo: the ally's stand-in is the next one
	var b: Dictionary = _stand_ins({"seed": 1, "hero_key": "bobo", "lod": 2}, ["ally", "enemy"])
	_check("never_two_of_one_character", str(b["ally"]) == "res://cast/catboy_lod2.glb", str(b))
	_check("stand_in_lod", str(b["enemy"]).ends_with("_lod2.glb"), str(b))
	var c: Dictionary = _stand_ins({"seed": 1, "cast_stand_in": false})
	_check("switch_keeps_the_capsule", str(c["hero"]) == "" and str(c["enemy"]) == "", str(c))
	# 2. the HUD's top block and the safe area
	var hud: Control = HudScript.new()
	hud.set("_q_off", Vector2(0, 88))
	hud.call("_queue_text", Vector2(10, 20), "x", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 20, Color.WHITE, 0)
	hud.call("_queue_text", Vector2(-400, 7), "y", HORIZONTAL_ALIGNMENT_CENTER, 800.0, 20, Color.WHITE, 0, Transform2D(0.0, Vector2(2, 2), 0.0, Vector2(300, 50)))
	hud.set("_q_off", Vector2.ZERO)
	hud.call("_queue_text", Vector2(10, 20), "z", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 20, Color.WHITE, 0)
	var t: Array = hud.get("_texts")
	_check("hud_text_moves_with_top_block", (t[0] as Array)[2] == Vector2(10, 108), str((t[0] as Array)[2]))
	_check("hud_scaled_text_moves_by_origin", ((t[1] as Array)[7] as Transform2D).origin == Vector2(300, 138) and (t[1] as Array)[2] == Vector2(-400, 7), str(t[1]))
	_check("hud_text_elsewhere_unmoved", (t[2] as Array)[2] == Vector2(10, 20), str((t[2] as Array)[2]))
	hud.free()
	_pass2()
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)


## build 20 pass 2: grounding, hit feel, readability, the first frames, one look.
func _pass2() -> void:
	# the first frames: the fight waits for the app's view size (either way within 12 %)
	_check("view_gate_match", FightScript.view_size_ok(Vector2(1179, 2556), Vector2(1179, 2556)))
	_check("view_gate_small_corner_frame", not FightScript.view_size_ok(Vector2(393, 852), Vector2(1179, 2556)))
	_check("view_gate_no_size_no_wait", FightScript.view_size_ok(Vector2(10, 10), Vector2.ZERO))
	# the run's bounce: the hips' rise over the stance scaled, the lowest key kept
	var a := Animation.new()
	var tr: int = a.add_track(Animation.TYPE_POSITION_3D)
	a.track_set_path(tr, NodePath(".:Hips"))
	a.position_track_insert_key(tr, 0.0, Vector3(0, 1.0, 0))
	a.position_track_insert_key(tr, 0.5, Vector3(0, 1.4, 0.2))
	_check("debob_changes_the_hips", AnimLib.debob(a, 0.3))
	_check("debob_keeps_the_stance", is_equal_approx((a.track_get_key_value(tr, 0) as Vector3).y, 1.0))
	_check("debob_scales_the_rise", is_equal_approx((a.track_get_key_value(tr, 1) as Vector3).y, 1.12)
		and is_equal_approx((a.track_get_key_value(tr, 1) as Vector3).z, 0.2), str(a.track_get_key_value(tr, 1)))
	# hit feel: a heavy blow holds longer and shakes harder than a light one; a light hit stays quick
	var m: Dictionary = FeelScript.MOMENTS
	_check("heavy_outweighs_light", float(m["heavy"]["stop"]) > float(m["light"]["stop"]) and float(m["heavy"]["trauma"]) > float(m["light"]["trauma"]))
	_check("light_stays_quick", float(m["light"]["stop"]) <= 0.07)
	# one look: the fighters' dark side takes the street's shade hue, never darker than its share
	var st: Color = FighterScript.shade_tint(ArenaScript.TIMES["golden"])
	_check("shade_tint_cool", st.b > st.r and st.r < 1.0 and st.b <= 1.0, str(st))
	_check("shade_tint_gentle", minf(st.r, minf(st.g, st.b)) >= 1.0 - FighterScript.SHADE_SHARE, str(st))
	# readability: a damage number over the Guardian's name plate slides clear of it
	var hud: Control = HudScript.new()
	hud.set("_plates", [Rect2(Vector2(300, 200), Vector2(200, 50))] as Array[Rect2])
	var d: Dictionary = {"s": "89", "style": "normal"}
	var dx: float = float(hud.call("_pop_clear", d, Vector2(420, 220)))
	var fs: float = 26.0 * HudScript.PT
	var hw: float = fs * 0.34 * 2.0 + 10.0
	_check("pop_slides_off_the_plate", 420.0 + dx - hw >= 500.0, str(dx))
	var d2: Dictionary = {"s": "89", "style": "normal"}
	_check("pop_clear_of_plates_stays", is_zero_approx(float(hud.call("_pop_clear", d2, Vector2(420, 600)))))
	hud.free()
