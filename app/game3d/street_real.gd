extends RefCounted
## build 29 (fid29-street, docs/game3d/fid29/street.md): the real street surfaces on the mid and high tiers.
## The seam between build 28's street and the real one. Everything here returns without touching anything unless
## the look is "real" (mid, high) with "fid_street" on, so the low tier keeps build 28's street byte for byte:
## arena.gd still preloads art/street/medallion.png and street_pavers.png for every tier, and those files, like
## art/world/ground, trims, roofs and misc, are never edited; the real versions are new files reached only from here.
##
## Look keys (arena.gd TIER_LOOK, fid29-base: on for mid and high, never on low):
##   fid_street      the real street
##   fid_street_cap  the fighters' capsule occlusion on the ground (ground_occluders.gd): default on with fid_street;
##                   false switches only the capsule shade off (the budget and C5 comparisons use it)
##   fid_street_hi   the high tier's extras (1K decals, the detail layers, near-wall detail, window reveals):
##                   default = the high tier's full skin look (look.skin == "full")
##   fid_street_facade  the real facades (world_facade_real on art/world/real/trims, the real red-brick sheet, and with
##                   fid_street_hi the window reveals and sills): default OFF, so mid and high keep build 28's
##                   world_facade walls (blind judge round 2, 16 Nov: the real facade loses the intro close-ups: no lit
##                   warm dusk windows, dim glass, dark sill lines, aliased mortar on mid). Kept for a later round.
##
## Callers: arena.gd apply_floor (the seam: the arena's floor and medallion), place.gd (ground and facade materials,
## water and basins, reveals, the near bake, ground_occluders, then adopt()).

## The _real shaders are loaded on first use (never preloaded), so the low tier, which only meets this script through
## arena.gds seam call, opens no file of this lanes beyond this one.
const GROUND_REAL_PATH := "res://vfx/world_ground_real.gdshader"
const FACADE_REAL_PATH := "res://vfx/world_facade_real.gdshader"
const LookRealScript := preload("res://look_real.gd")
const ART := "res://art/world/real/"
const STREET_ART := "res://art/street/real/"
const MEDALLION_M: float = 5.6

## real ground kinds: [file stem in art/world/real/ground, tile metres, decal picks a, decal picks b, decal prob]
const GROUND: Dictionary = {
	"flags": ["flags_uk", 2.4, Vector4(0, 1, 2, 3), Vector4(0, 2, 8, 13), 0.34],
	"plaza": ["plaza_uk", 3.2, Vector4(0, 1, 2, 3), Vector4(12, 13, 8, 9), 0.26],
	"asphalt": ["asphalt_uk", 4.0, Vector4(4, 5, 6, 7), Vector4(13, 14, 15, 12), 0.3],
	"kerb": ["kerb_uk", 3.6, Vector4(0, 1, 2, 3), Vector4(0, 1, 2, 3), 0.0],
	"setts": ["setts_uk", 1.15, Vector4(8, 9, 12, 13), Vector4(8, 9, 12, 13), 0.2],
	"paint": ["asphalt_uk", 4.0, Vector4(0, 0, 0, 0), Vector4(0, 0, 0, 0), 0.0],
}
const DAMP: Dictionary = {"golden": 0.0, "day": 0.0, "dusk": 1.0, "night": 1.0}
const FILL: Dictionary = {"golden": 1.0, "day": 1.0, "dusk": 1.1, "night": 1.7}   # fighter.gd REAL_FILL
## The sky fill on the ground and the walls, over the fighters' (FILL). The six ambient colours are the cube's diffuse
## light as the fighters see it; on the paving build 28's sky light was ~0.6 of the sun's (measured on the farm: the
## street paving in the baked shade keeps ~0.55 of its sunlit brightness), the cube alone gave ~0.25 and shade read as
## night. 2.5 restored build 28's shade balance but flattened golden hour (grey, the fighters' shadows weak); 1.9 keeps
## the shade daylit (baked shade ~0.5 of sunlit) with the sun patches and contact shadows reading (game-camera trials
## 1.9 vs 2.5, 14 Nov). Look "street_amb_k" overrides the product.
const SKY_FILL: float = 1.9
## Walls take less (a vertical wall sees half the sky and build 28's facades were already lifted by a painted AO band):
## at 2.5 the photo brick washed out to a pale render at golden hour.
const SKY_FILL_WALL: float = 1.5

static var _tex: Dictionary = {}
static var _cut: Shader
static var _ground: Shader
static var _facade: Shader
static var _warm_cls: Variant = null


static func on(look: Dictionary) -> bool:
	return bool(look.get("real", false)) and bool(look.get("fid_street", true))


static func caps_on(look: Dictionary) -> bool:
	return on(look) and bool(look.get("fid_street_cap", true))


static func hi(look: Dictionary) -> bool:
	return on(look) and bool(look.get("fid_street_hi", str(look.get("skin", "")) == "full"))


static func facade(look: Dictionary) -> bool:
	return on(look) and bool(look.get("fid_street_facade", false))


static func ground_shader() -> Shader:
	if _ground == null:
		_ground = load(GROUND_REAL_PATH)
	return _ground


static func facade_shader() -> Shader:
	if _facade == null:
		_facade = load(FACADE_REAL_PATH)
	return _facade


static func tex(path: String) -> Texture2D:
	if not _tex.has(path):
		_tex[path] = load(path) if ResourceLoader.exists(path) else null
	return _tex[path]


## A ground texture by stem: the high file, or its _mid copy on mid (half size). High reads the _mid file where there
## is no full-size one (the asphalt's and the square slabs' normals: make_world_art.py n_hi False).
static func gtex(stem: String, suffix: String, look: Dictionary) -> Texture2D:
	var t: Texture2D = null
	if hi(look):
		t = tex(ART + "ground/" + stem + suffix + ".png")
		return t if t != null else tex(ART + "ground/" + stem + "_mid" + suffix + ".png")
	t = tex(ART + "ground/" + stem + "_mid" + suffix + ".png")
	return t if t != null else tex(ART + "ground/" + stem + suffix + ".png")


## The cut-out variant of the ground shader (the medallion's disc, worn road paint): alpha scissor only where needed,
## so every other ground pixel keeps early depth.
static func cutout_shader() -> Shader:
	if _cut == null:
		_cut = Shader.new()
		_cut.code = ground_shader().code.replace("// @CUTOUT", "#define CUTOUT\n//")
	return _cut


## fid29's shader warm-up (shader_warm.gd, ShaderWarm.add, fid29-base): every new material is drawn once under the
## loading card. Loaded by path so this lane also runs on a tree without it.
static func warm(m: Material) -> void:
	if m == null:
		return
	if _warm_cls == null:
		_warm_cls = load("res://shader_warm.gd") if ResourceLoader.exists("res://shader_warm.gd") else false
	if _warm_cls is Script:
		(_warm_cls as Script).call("add", m)


## The street's light (LookReal.env_for(time), read only) and the time's damp on a real material.
static func env_params(sm: ShaderMaterial, look: Dictionary, tp: Dictionary, fill: float = SKY_FILL) -> void:
	var time: String = str(look.get("time", "golden"))
	var e: Dictionary = LookRealScript.env_for(time)
	if e.is_empty():
		var ac: Color = (tp.get("ambient", Color(0.72, 0.78, 0.86)) as Color) * float(tp.get("ambient_energy", 0.38))
		var flat := PackedVector3Array()
		for i in 6:
			flat.append(Vector3(ac.r, ac.g, ac.b))
		sm.set_shader_parameter("amb_cube", flat)
		sm.set_shader_parameter("env_on", 0.0)
	else:
		sm.set_shader_parameter("amb_cube", e["amb"])
		sm.set_shader_parameter("env_cube", e["cube"])
		sm.set_shader_parameter("env_scale", e["scale"])
		sm.set_shader_parameter("env_lods", e["lods"])
		sm.set_shader_parameter("env_on", 1.0)
	sm.set_shader_parameter("amb_amount", float(look.get("street_amb_k", FILL.get(time, 1.0) * fill)))
	if sm.shader == _ground or (_cut != null and sm.shader == _cut):
		sm.set_shader_parameter("damp_k", float(look.get("street_damp", DAMP.get(time, 0.0))))


## A real ground material of `kind` (GROUND). opts: extra shader parameters.
static func ground_mat(kind: String, look: Dictionary, tp: Dictionary, opts: Dictionary = {}, cutout: bool = false) -> ShaderMaterial:
	var g: Array = GROUND.get(kind, GROUND["flags"])
	var sm := ShaderMaterial.new()
	sm.shader = cutout_shader() if cutout else ground_shader()
	var h: bool = hi(look)
	sm.set_shader_parameter("albedo_tex", gtex(str(g[0]), "", look))
	sm.set_shader_parameter("normal_tex", gtex(str(g[0]), "_n", look))
	sm.set_shader_parameter("orm_tex", gtex(str(g[0]), "_orm", look))
	sm.set_shader_parameter("tile_m", float(g[1]))
	sm.set_shader_parameter("wear_tex", tex(ART + "ground/wear.png"))
	sm.set_shader_parameter("detail_tex", tex(ART + "ground/detail_n.png"))
	sm.set_shader_parameter("detail_on", 1.0 if h else 0.0)
	var prob: float = float(g[4])
	sm.set_shader_parameter("decal_on", 1.0 if prob > 0.0 else 0.0)
	if prob > 0.0:
		sm.set_shader_parameter("decal_tex", tex(ART + "ground/" + ("decals.png" if h else "decals_mid.png")))
		sm.set_shader_parameter("decal_pick_a", g[2])
		sm.set_shader_parameter("decal_pick_b", g[3])
		sm.set_shader_parameter("decal_prob", prob)
	sm.set_shader_parameter("ao_col", tp.get("ao", Color(0.42, 0.416, 0.478)))
	sm.set_shader_parameter("ao_alpha", float(tp.get("ao_alpha", 0.55)))
	if look.has("ground_k"):
		sm.set_shader_parameter("expose", float(look["ground_k"]))
	sm.set_shader_parameter("cap_k", float(look.get("street_cap_k", 1.0)) if caps_on(look) else 0.0)
	env_params(sm, look, tp)
	for k: String in opts:
		sm.set_shader_parameter(k, opts[k])
	warm(sm)
	return sm


## A real facade material for a trim sheet with a real version (art/world/real/trims), else null (the caller keeps
## build 28's). The sheet's windows (for the streaks) come from trim_sheets.py make_real.
const SHEET_WINDOWS: Dictionary = {
	"trim_uk_brick": [Vector4(0.5, 1.5, 2.5, 3.5), Vector4(4.85, 7.15, -1, -1), 3.45, 0.0],
	"trim_uk_brick_red": [Vector4(0.5, 1.5, 2.5, 3.5), Vector4(4.85, 7.15, -1, -1), 3.45, 0.0],
	"trim_uk_stone": [Vector4(0.475, 1.525, 2.475, 3.525), Vector4(5.35, 6.65, -1, -1), 3.65, 1.0],
}


static func facade_mat(sheet: String, look: Dictionary, tp: Dictionary) -> ShaderMaterial:
	if not SHEET_WINDOWS.has(sheet):
		return null
	var alb: Texture2D = tex(ART + "trims/" + sheet + ".png")
	if alb == null:
		return null
	var sm := ShaderMaterial.new()
	sm.shader = facade_shader()
	sm.set_shader_parameter("albedo_tex", alb)
	sm.set_shader_parameter("orm_tex", tex(ART + "trims/" + sheet + "_orm.png"))
	sm.set_shader_parameter("normal_tex", tex(ART + "trims/" + sheet + "_n.png"))
	sm.set_shader_parameter("leak_tex", tex(ART + "trims/leak.png"))
	var w: Array = SHEET_WINDOWS[sheet]
	sm.set_shader_parameter("sill_a", w[0])
	sm.set_shader_parameter("sill_b", w[1])
	sm.set_shader_parameter("sill_y", w[2])
	sm.set_shader_parameter("tint_k", w[3])
	if hi(look):
		sm.set_shader_parameter("detail_tex", tex(ART + "trims/wall_detail_n.png"))
		sm.set_shader_parameter("detail_on", 1.0)
	sm.set_shader_parameter("windows_k_mul", float(tp.get("windows", 0.15)))
	sm.set_shader_parameter("window_col", tp.get("window_col", Color(1.0, 0.85, 0.63)))
	sm.set_shader_parameter("sky_upper", tp.get("upper", Color(0.5, 0.68, 0.88)))
	sm.set_shader_parameter("sky_horizon", tp.get("horizon", Color(0.95, 0.87, 0.76)))
	env_params(sm, look, tp, SKY_FILL_WALL)
	warm(sm)
	return sm


## The seam (fid29-base, docs/game3d/fid29/COMMON.md): arena.gd calls this once the street floor (the paved plane under
## every arena) and the medallion (or a place's faction ring) have their materials. On mid and high with fid_street the
## floor and the medallion take the real stone (the medallion redrawn as a worn stone inlay of the same motif,
## mipmapped); a place's faction ring is left as it came. Low, or the key off: returns at once, nothing touched.
## The new materials wait in the arena's meta "fid29_street" until place.gd has its bake and the fighters' occluders
## (place.gd _real_finish), as the place is built after the arena's floor.
static func apply_floor(arena: Node3D, look: Dictionary, floor_mat: Material, medallion_mat: Material) -> void:
	if not on(look) or arena == null:
		return
	var tp: Dictionary = (load("res://arena.gd") as GDScript).call("time_preset", look)
	var h: bool = hi(look)
	var made: Array = []
	var plaza: Variant = arena.get("plaza")
	if plaza is MeshInstance3D and (plaza as MeshInstance3D).material_override == medallion_mat \
			and ((plaza as MeshInstance3D).mesh is PlaneMesh) \
			and is_equal_approx(((plaza as MeshInstance3D).mesh as PlaneMesh).size.x, MEDALLION_M):
		var suf: String = "" if h else "_mid"
		var mm: ShaderMaterial = ground_mat("flags", look, tp, {"uv_mode": 2.0, "decal_on": 0.0, "bake_on": 1.0,
			"albedo_tex": tex(STREET_ART + "medallion" + suf + ".png"),
			"normal_tex": tex(STREET_ART + "medallion_n.png"),
			"orm_tex": tex(STREET_ART + "medallion" + suf + "_orm.png")}, true)
		(plaza as MeshInstance3D).material_override = mm
		made.append(mm)
	var ground: Variant = arena.get("ground")
	if ground is MeshInstance3D and (ground as MeshInstance3D).material_override == floor_mat:
		var gm: ShaderMaterial = ground_mat("flags", look, tp, {"decal_on": 0.0, "bake_on": 0.0,
			"albedo_tex": tex(STREET_ART + "pavers.png"), "normal_tex": tex(STREET_ART + "pavers_n.png"),
			"orm_tex": tex(STREET_ART + "pavers_orm.png")})
		(ground as MeshInstance3D).material_override = gm
	arena.set_meta("fid29_street", made)


## place.gd, once its bake is committed: the medallion takes the bake and the fighters' capsule shade.
static func adopt(arena: Node, bake: RefCounted, caps: Node) -> void:
	if arena == null or not arena.has_meta("fid29_street"):
		return
	for m: Variant in arena.get_meta("fid29_street"):
		if bake != null:
			bake.call("register_real", m)
		if caps != null:
			caps.call("register", m)
