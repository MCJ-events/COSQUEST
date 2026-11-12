extends SceneTree
## realism (12 Nov 2026): the six faction heroes as the cast (fight.gd _hero_cast).
##   godot --headless --path app/game3d -s res://tests/hero_cast_test.gd
## 1. The low tier (and a config with no tier) keeps the built-in cast: no hero is chosen.
## 2. Mid and high: a fighter with no character of their own gets a hero. The player's is their
##    faction's, the ally and the Guardian are heroes of other factions, all three different.
## 3. A player's own character (a file outside res://cast) is never replaced.
## 4. Every hero the pck ships has both detail levels, a clip library the game binds by key, an
##    arm droop, and stays small (a guard of ours, not the bar's: 5 MB at lod0, 2 MB at lod1).
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const FightScript := preload("res://fight.gd")
const AnimLib := preload("res://anim_library.gd")

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _pick(c: Dictionary, role: String, p: String = "") -> String:
	var f: Node = FightScript.new()
	f.cfg = c.duplicate(true)
	var out: String = f._hero_cast(role, p)
	f.free()
	return out


func _initialize() -> void:
	for t: String in ["", "low", "nonsense"]:
		var c: Dictionary = {"seed": 7, "faction": "ascendants"}
		if t != "":
			c["tier"] = t
		_check("low_keeps_cast_" + (t if t != "" else "none"), _pick(c, "hero") == "" and _pick(c, "enemy") == "")
	for t: String in ["mid", "high"]:
		for fac: String in FightScript.HERO_BY_FACTION:
			var want: String = FightScript.HERO_BY_FACTION[fac]
			if not FileAccess.file_exists(FightScript.HERO_DIR + want + "_lod1.glb"):
				continue     # a hero that has not arrived (Kofi): the seed picks one that has
			for seed: int in [1, 7, 52012, 99991]:
				var c: Dictionary = {"tier": t, "seed": seed, "faction": fac}
				var h: String = _pick(c, "hero"); var a: String = _pick(c, "ally"); var e: String = _pick(c, "enemy", "res://cast/hoof.glb")
				_check("%s_%s_%d" % [t, fac, seed], h.contains(want) and a != "" and e != "" and not a.contains(want) and not e.contains(want)
					and a.get_file().trim_suffix(a.get_file().right(9)) != e.get_file().trim_suffix(e.get_file().right(9)), "%s %s %s" % [h, a, e])
		var hi: String = _pick({"tier": t, "seed": 3, "faction": "ascendants"}, "hero")
		_check(t + "_hero_lod", hi.ends_with("_lod0.glb") if t == "high" else hi.ends_with("_lod1.glb"), hi)
		_check(t + "_own_character_kept", _pick({"tier": t, "seed": 3, "faction": "icons"}, "hero", "/data/forge/abc/lod1.glb") == "")
		_check(t + "_switch_off", _pick({"tier": t, "seed": 3, "hero_cast": false}, "hero") == "")
		_check(t + "_no_faction_still_a_hero", _pick({"tier": t, "seed": 3}, "hero") != "")
	var chars: Dictionary = AnimLib.data().get("characters", {})
	for k: String in FightScript.HERO_ORDER:
		var p0: String = FightScript.HERO_DIR + k + "_lod0.glb"
		if not FileAccess.file_exists(p0):
			continue
		var n0: int = FileAccess.open(p0, FileAccess.READ).get_length()
		var p1: String = FightScript.HERO_DIR + k + "_lod1.glb"
		var n1: int = FileAccess.open(p1, FileAccess.READ).get_length() if FileAccess.file_exists(p1) else 0
		_check("files_" + k, n1 > 0 and n0 <= 5 * 1024 * 1024 and n1 <= 2 * 1024 * 1024, "lod0=%d lod1=%d" % [n0, n1])
		var ch: Dictionary = chars.get(k, {})
		_check("library_" + k, FileAccess.file_exists("res://anim/%s.glb" % k) and float(ch.get("arm_droop", 0.0)) > 0.0)
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
