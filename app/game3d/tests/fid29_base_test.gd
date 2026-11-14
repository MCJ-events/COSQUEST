extends SceneTree
## fid29 base (docs/game3d/fid29/COMMON.md): what every build 29 fidelity lane builds on.
##   godot --headless --path app/game3d -s res://tests/fid29_base_test.gd
## 1. Shadow parity: the desktop project keys take the phone values (2048 directional atlas, hard filter), so farm
##    stills show what phones show; the .mobile keys, ETC2/ASTC import and the anisotropic level are as build 28.
## 2. The low tier adds nothing and has none of the lanes' keys; mid and high have them all.
## 3. The seams: with the low look (or a lane's key off) hero_files.gd returns the path it was given and
##    street_real.gd leaves the floor and medallion materials as they came; shader_warm.gd empties its registry
##    when it warms.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const ArenaScript := preload("res://arena.gd")
const HeroFiles := preload("res://hero_files.gd")
const StreetReal := preload("res://street_real.gd")
const ShaderWarm := preload("res://shader_warm.gd")
const FID_KEYS: Array[String] = ["fid_street", "fid_dressing", "fid_heromaps", "fid_charshade", "fid_combat"]

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _mat_sig(m: StandardMaterial3D) -> String:
	return "%s|%s|%s|%s|%s|%s" % [str(m.albedo_color), str(m.albedo_texture), str(m.roughness), str(m.normal_enabled),
		str(m.texture_filter), str(m.uv1_scale)]


func _initialize() -> void:
	# 1. shadow parity and the keys that must not move
	var ps: String = "rendering/lights_and_shadows/directional_shadow/"
	_check("desktop_shadow_atlas_2048", int(ProjectSettings.get_setting(ps + "size")) == 2048, str(ProjectSettings.get_setting(ps + "size")))
	_check("desktop_shadow_filter_hard", int(ProjectSettings.get_setting(ps + "soft_shadow_filter_quality")) == 0,
		str(ProjectSettings.get_setting(ps + "soft_shadow_filter_quality")))
	_check("mobile_shadow_keys_as_b28", int(ProjectSettings.get_setting(ps + "size.mobile", 2048)) == 2048
		and int(ProjectSettings.get_setting(ps + "soft_shadow_filter_quality.mobile", 0)) == 0)
	_check("etc2_astc_import_on", bool(ProjectSettings.get_setting("rendering/textures/vram_compression/import_etc2_astc")))
	_check("anisotropic_level_as_b28", int(ProjectSettings.get_setting("rendering/textures/default_filters/anisotropic_filtering_level")) == 2,
		str(ProjectSettings.get_setting("rendering/textures/default_filters/anisotropic_filtering_level")))
	_check("renderer_compatibility", str(ProjectSettings.get_setting("rendering/renderer/rendering_method.mobile")) == "gl_compatibility")
	# 2. the tiers
	_check("low_tier_empty", (ArenaScript.TIER_LOOK["low"] as Dictionary).is_empty())
	var low: Dictionary = ArenaScript.look_opts({"look": {"time": "golden"}})
	var ok_keys: bool = true
	for t: String in ["mid", "high"]:
		var l: Dictionary = ArenaScript.look_opts({"tier": t, "look": {"time": "golden"}})
		for k: String in FID_KEYS:
			if not bool(l.get(k, false)) or low.has(k):
				ok_keys = false
	_check("fid_keys_mid_high_only", ok_keys)
	# 3. the seams, on the low look and with every lane key off
	var off: Dictionary = ArenaScript.look_opts({"tier": "high", "look": {"time": "golden", "fid_street": false, "fid_heromaps": false,
		"fid_dressing": false, "fid_charshade": false, "fid_combat": false}})
	var same: bool = true
	for look: Dictionary in [low, off]:
		for p: String in ["res://cast/heroes/icons_imani_lod1.glb", "res://cast/heroes/icons_imani_lod0.glb", "res://cast/armstrong_lod1.glb", "/abs/forge/lod1.glb", ""]:
			for role: String in ["hero", "ally", "enemy"]:
				if HeroFiles.pick(p, role, look) != p:
					same = false
	_check("hero_files_low_and_off_unchanged", same)
	var floor_same: bool = true
	for look: Dictionary in [low, off]:
		var gm := StandardMaterial3D.new()
		gm.albedo_color = Color(0.68, 0.67, 0.66)
		gm.roughness = 0.95
		gm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		var mm := StandardMaterial3D.new()
		mm.albedo_color = Color(0.8, 0.77, 0.73)
		var a: String = _mat_sig(gm) + "/" + _mat_sig(mm)
		var arena_node := Node3D.new()
		StreetReal.apply_floor(arena_node, look, gm, mm)
		arena_node.free()
		if _mat_sig(gm) + "/" + _mat_sig(mm) != a:
			floor_same = false
	_check("street_floor_low_and_off_unchanged", floor_same)
	ShaderWarm.clear()
	ShaderWarm.add(StandardMaterial3D.new())
	ShaderWarm.add(null)
	_check("shader_warm_registers", ShaderWarm.registered().size() == 1)
	ShaderWarm.warm(null)
	_check("shader_warm_empties", ShaderWarm.registered().is_empty() and int(ShaderWarm.last.get("registered", -1)) == 1)
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
