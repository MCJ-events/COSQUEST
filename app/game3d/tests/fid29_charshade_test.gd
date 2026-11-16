extends SceneTree
## fid29 charshade (docs/game3d/fid29/charshade.md): character materials on mid and high, nothing on low.
##   godot --headless --path app/game3d -s res://tests/fid29_charshade_test.gd
## 1. The key: on with the real look's mid and high tiers, off on low and with "fid_charshade": false; high-only steps
##    follow look "skin" == "full".
## 2. The files: a material-ID mask per hero at 1024 (lod0) and 512 (lod1r), each with its json; a hair atlas per hero
##    with hair cards at 1024 x 2048 and 512 x 1024; the high tier's detail sheet (1024) and metal break-up (256).
## 3. The shader: char_real keeps recv_shadow and kick_a_col; cs_on is off by default (the build 28 path); the hair
##    cards' charshade variant draws with alpha to coverage, the high body variant defines CS_HIGH, and the plain
##    variant is the file itself.
## 4. The materials a fighter builds: high = the lod0 mask and the CS_HIGH variant, mid = the lod1r mask and no new
##    texture sampler; hair cards take charshade's hair shading on build 28's hard cut with the tier's atlas (the soft
##    cut is gated off, look "cs_hair_soft" brings it back); off = no charshade uniform set. Every
##    charshade material is registered with ShaderWarm.
## 5. Contracts: fighter.gd's public calls and the face fill are where they were.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const ArenaScript := preload("res://arena.gd")
const FighterScript := preload("res://fighter.gd")
const ShaderWarm := preload("res://shader_warm.gd")
const HEROES: Array[String] = ["ascendants_zuri", "blockbusters_kofi", "celestials_lyra", "controllers_tavo", "everborn_oren", "icons_imani"]
const HAIRED: Array[String] = ["ascendants_zuri", "blockbusters_kofi", "celestials_lyra", "controllers_tavo", "icons_imani"]

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _size(p: String) -> Vector2i:
	var t: Texture2D = load(p) as Texture2D if ResourceLoader.exists(p) else null
	return Vector2i(t.get_width(), t.get_height()) if t != null else Vector2i.ZERO


func _fighter(tier: String, extra: Dictionary, key: String) -> Node:
	var f: Node = FighterScript.new()
	var lk: Dictionary = {"time": "golden"}
	lk.merge(extra, true)
	f.set("look", ArenaScript.look_opts({"tier": tier, "look": lk}))
	f.set("anim_opts", {"key": key})
	return f


## a hero body: its map's width says which file it is (lod0 2048, lod1 1024: the masks' json "albedo_w")
func _body_mat(w: int = 2048) -> StandardMaterial3D:
	var b := StandardMaterial3D.new()
	b.resource_name = "Material_0"
	b.albedo_texture = ImageTexture.create_from_image(Image.create(w, w, false, Image.FORMAT_L8))
	return b


func _hair_mat() -> StandardMaterial3D:
	var b := StandardMaterial3D.new()
	b.resource_name = "hair_cards"
	b.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	b.cull_mode = BaseMaterial3D.CULL_DISABLED
	return b


func _initialize() -> void:
	# 1. the key
	var low: Dictionary = ArenaScript.look_opts({"tier": "low", "look": {"time": "golden"}})
	var mid: Dictionary = ArenaScript.look_opts({"tier": "mid", "look": {"time": "golden"}})
	var high: Dictionary = ArenaScript.look_opts({"tier": "high", "look": {"time": "golden"}})
	_check("key_low_absent", not bool(low.get("fid_charshade", false)) and not bool(low.get("real", false)))
	_check("key_mid_high_on", bool(mid.get("fid_charshade", false)) and bool(high.get("fid_charshade", false)))
	_check("high_steps_follow_skin_full", str(high.get("skin", "")) == "full" and str(mid.get("skin", "")) != "full")
	for t: String in ["low", "mid", "high"]:
		var f: Node = _fighter(t, {}, "blockbusters_kofi")
		_check("cs_on_" + t, bool(f.call("_cs_on")) == (t != "low"))
		f.free()
	var off: Node = _fighter("high", {"fid_charshade": false}, "blockbusters_kofi")
	_check("cs_off_with_key_false", not bool(off.call("_cs_on")))
	off.free()
	# 2. the files
	var masks_ok: bool = true
	var why: String = ""
	for k: String in HEROES:
		if _size("res://art/char/masks/%s_lod0.png" % k) != Vector2i(1024, 1024) or _size("res://art/char/masks/%s_lod1r.png" % k) != Vector2i(512, 512) \
				or not FileAccess.file_exists("res://art/char/masks/%s.json" % k):
			masks_ok = false
			why += k + " "
	_check("masks_per_hero_lod0_1024_lod1r_512", masks_ok, why)
	var hair_ok: bool = true
	why = ""
	for k: String in HAIRED:
		if _size("res://art/char/hair/%s_hi.png" % k) != Vector2i(1024, 2048) or _size("res://art/char/hair/%s_mid.png" % k) != Vector2i(512, 1024) \
				or not FileAccess.file_exists("res://art/char/hair/%s_hair.json" % k):
			hair_ok = false
			why += k + " "
	_check("hair_atlases_hi_1kx2k_mid_512x1k", hair_ok, why)
	_check("detail_sheet_1024", _size("res://art/char/detail/cloth_sheet.png") == Vector2i(1024, 1024))
	_check("metal_breakup_256", _size("res://art/char/detail/metal_breakup.png") == Vector2i(256, 256))
	# 3. the shader
	var src: String = (load("res://vfx/char_real.gdshader") as Shader).code
	_check("shader_keeps_recv_shadow_kick_a", src.contains("uniform float recv_shadow") and src.contains("uniform vec3 kick_a_col"))
	_check("shader_cs_off_by_default", src.contains("uniform bool cs_on = false;"))
	_check("orm_trust_off_by_default_tavo_imani_only", src.contains("uniform float cs_orm_trust = 0.0;")
		and float(FighterScript._cs_json("res://art/char/masks/controllers_tavo.json").get("orm_trust", 0.0)) == 1.0
		and float(FighterScript._cs_json("res://art/char/masks/icons_imani.json").get("orm_trust", 0.0)) == 1.0
		and float(FighterScript._cs_json("res://art/char/masks/blockbusters_kofi.json").get("orm_trust", 0.0)) == 0.0)
	# Imani keeps build 28's cape and suit shading (blind judge 15 Nov): the lift's roughness, no cloth sheen, no knee
	var im: Dictionary = FighterScript._cs_json("res://art/char/masks/icons_imani.json")
	_check("imani_keeps_b28_cape_suit", im.get("rough_metal") is Array and float(im["rough_metal"][1]) == 1.0
		and float(im.get("sheen", 1.0)) == 0.0 and not bool(im.get("knee", true))
		and src.contains("uniform vec2 cs_rough_metal") and src.contains("uniform float cs_sheen"))
	_check("plain_variant_is_the_file", FighterScript._real_variant(false, false) == load("res://vfx/char_real.gdshader"))
	var soft: String = FighterScript._real_variant(true, true, true, false).code
	_check("hair_soft_variant_alpha_to_coverage", soft.contains("alpha_to_coverage") and soft.contains("ALPHA_ANTIALIASING_EDGE = 0.3")
		and soft.contains("cull_disabled"))
	_check("hair_cut_variant_as_b28", FighterScript._real_variant(true, true).code.contains("ALPHA_SCISSOR_THRESHOLD = 0.35"))
	_check("high_variant_defines_cs_high", FighterScript._real_variant(false, false, false, true).code.contains("#define CS_HIGH\n"))
	# 4. the materials
	ShaderWarm.clear()
	var fh: Node = _fighter("high", {}, "blockbusters_kofi")
	var sh: ShaderMaterial = fh.call("_real_material", _body_mat())
	_check("high_body_cs_on", sh != null and bool(sh.get_shader_parameter("cs_on")) and int(sh.get_shader_parameter("cs_matid")) == 1)
	_check("high_body_lod0_mask", sh != null and sh.get_shader_parameter("skin_tex") != null
		and (sh.get_shader_parameter("skin_tex") as Texture2D).resource_path.ends_with("blockbusters_kofi_lod0.png"))
	_check("high_body_cs_high_variant", sh != null and sh.shader.code.contains("#define CS_HIGH\n") and sh.get_shader_parameter("cs_detail_tex") != null)
	fh.set("surface_kinds", {"hair_cards": "hair"})
	var hh: ShaderMaterial = fh.call("_real_material", _hair_mat())
	# the soft cut is gated off (over the hair budget, 15 Nov): charshade's hair shading on build 28's hard cut (16 Nov)
	_check("high_hair_cs_shading_b28_cut_and_atlas", hh != null and not hh.shader.code.contains("alpha_to_coverage")
		and hh.shader.code.contains("ALPHA_SCISSOR_THRESHOLD = 0.35") and bool(hh.get_shader_parameter("cs_on"))
		and float(hh.get_shader_parameter("cs_hair_cards")) == 1.0
		and (hh.get_shader_parameter("albedo_tex") as Texture2D).resource_path.ends_with("blockbusters_kofi_hi.png"))
	var fsoft: Node = _fighter("high", {"cs_hair_soft": true}, "blockbusters_kofi")
	fsoft.set("surface_kinds", {"hair_cards": "hair"})
	var hs: ShaderMaterial = fsoft.call("_real_material", _hair_mat())
	_check("high_hair_soft_behind_look_key", hs != null and hs.shader.code.contains("alpha_to_coverage"))
	fsoft.free()
	_check("shader_warm_registered", ShaderWarm.registered().has(sh) and ShaderWarm.registered().has(hh))
	fh.free()
	# the high tier's ally keeps the lod1 file (fight.gd _tier_lod): its mask is the lod1r one, its hair the 512 atlas;
	# a body that is neither file takes no mask
	var fa: Node = _fighter("high", {}, "blockbusters_kofi")
	fa.set("role", "ally")
	var sa: ShaderMaterial = fa.call("_real_material", _body_mat(1024))
	_check("high_ally_lod1_file_lod1r_mask", sa != null and sa.get_shader_parameter("skin_tex") != null
		and (sa.get_shader_parameter("skin_tex") as Texture2D).resource_path.ends_with("blockbusters_kofi_lod1r.png"))
	fa.set("surface_kinds", {"hair_cards": "hair"})
	var ha: ShaderMaterial = fa.call("_real_material", _hair_mat())
	_check("high_ally_hair_atlas_512", ha != null and (ha.get_shader_parameter("albedo_tex") as Texture2D).resource_path.ends_with("blockbusters_kofi_mid.png"))
	var su: ShaderMaterial = fa.call("_real_material", _body_mat(512))
	_check("unknown_file_no_mask", su != null and su.get_shader_parameter("cs_matid") == null)
	fa.free()
	_check("emission_read_skipped_without_emission", src.contains("if (!cs_on || emission.r + emission.g + emission.b > 0.0)"))
	var fm: Node = _fighter("mid", {}, "blockbusters_kofi")
	var sm: ShaderMaterial = fm.call("_real_material", _body_mat(1024))
	_check("mid_body_lod1r_mask_no_new_sampler", sm != null and bool(sm.get_shader_parameter("cs_on"))
		and (sm.get_shader_parameter("skin_tex") as Texture2D).resource_path.ends_with("blockbusters_kofi_lod1r.png")
		and not sm.shader.code.contains("#define CS_HIGH\n"))
	fm.set("surface_kinds", {"hair_cards": "hair"})
	var mh: ShaderMaterial = fm.call("_real_material", _hair_mat())
	_check("mid_hair_atlas_512", mh != null and (mh.get_shader_parameter("albedo_tex") as Texture2D).resource_path.ends_with("blockbusters_kofi_mid.png"))
	fm.free()
	var fo: Node = _fighter("high", {"fid_charshade": false}, "blockbusters_kofi")
	var so: ShaderMaterial = fo.call("_real_material", _body_mat())
	_check("off_body_no_charshade", so != null and so.get_shader_parameter("cs_on") == null and so.shader == load("res://vfx/char_real.gdshader"))
	fo.free()
	var fg: Node = _fighter("high", {}, "")
	var sg: ShaderMaterial = fg.call("_real_material", _body_mat())
	_check("forge_guardian_keeps_colour_guess", sg != null and sg.get_shader_parameter("cs_matid") == null and int(sg.get_shader_parameter("skin_mode")) == 2)
	fg.free()
	ShaderWarm.clear()
	# 5. contracts
	var names: Array[String] = []
	var fs: Script = FighterScript
	for m: Dictionary in fs.get_script_method_list():
		names.append(str(m["name"]))
	var api_ok: bool = true
	for n: String in ["act", "flinch", "set_face_fill", "hit_pause", "hit_size", "die"]:
		api_ok = api_ok and names.has(n)
	_check("fighter_public_api", api_ok)
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
