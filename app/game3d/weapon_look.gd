extends RefCounted
## fight-look-31 (19 Nov 2026, arena.gd look "fl_weapon", mid and high): the weapons in hand on metal, wood and leather.
## The Forge's swords, axes and hammers are low-poly kit models coloured from a palette texture, so in the close shots
## they read as flat-shaded untextured blocks. apply() swaps every surface's material for vfx/weapon.gdshader, which
## sorts each pixel by its palette colour (steel, gilt, wood, leather) and gives it roughness, metal, our own grain detail
## (art/weapons/weapon_grain.png, tools/weapons/make_grain.py) and the street's reflection. Presentation only: the mesh,
## the grip and the hit arcs are untouched. Off (low tier, or "fl_weapon": false): the model's own materials, build 30.

const WEAPON_SHADER := preload("res://vfx/weapon.gdshader")
const T_GRAIN := preload("res://art/weapons/weapon_grain.png")
const LookReal := preload("res://look_real.gd")


## Returns how many surfaces took the material.
static func apply(weapon: Node3D, look: Dictionary) -> int:
	if weapon == null:
		return 0
	var e: Dictionary = LookReal.env_for(str(look.get("time", "golden")))
	var n: int = 0
	for node: Node in weapon.find_children("*", "MeshInstance3D", true, false):
		var mi := node as MeshInstance3D
		if mi.mesh == null:
			continue
		for si in mi.mesh.get_surface_count():
			var src: Material = mi.get_active_material(si)
			var sm := ShaderMaterial.new()
			sm.shader = WEAPON_SHADER
			sm.set_shader_parameter("grain_tex", T_GRAIN)
			if src is BaseMaterial3D:
				var b := src as BaseMaterial3D
				sm.set_shader_parameter("albedo_tex", b.albedo_texture if b.albedo_texture != null else _white())
				sm.set_shader_parameter("albedo", b.albedo_color)
			else:
				sm.set_shader_parameter("albedo_tex", _white())
			if not e.is_empty() and bool(look.get("ibl", true)):
				sm.set_shader_parameter("env_cube", e["cube"])
				sm.set_shader_parameter("env_scale", e["scale"])
				sm.set_shader_parameter("env_lods", e["lods"])
				sm.set_shader_parameter("env_k", float(look.get("fl_weapon_env", 1.0)))
			mi.set_surface_override_material(si, sm)
			n += 1
		mi.material_override = null
	return n


static var _white_tex: ImageTexture = null


static func _white() -> Texture2D:
	if _white_tex == null:
		var im := Image.create(1, 1, false, Image.FORMAT_RGB8)
		im.fill(Color.WHITE)
		_white_tex = ImageTexture.create_from_image(im)
	return _white_tex
