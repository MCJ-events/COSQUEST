extends Node3D
## The fight's place (cq 233): a dusk street plaza like the reference. Paving, the carved
## medallion at the centre, pink and gold circuit lines running down the street, shop
## fronts either side (Kenney City Kit, CC0), street lamps with warm light pools,
## planters and benches. All art is CC0 (docs/game3d/LICENSES.md). cfg "arena": "plain"
## gives G0's flat plate (no kit models) for a cheap run.

const T_PAVERS := preload("res://art/street/street_pavers.png")
const T_MEDALLION := preload("res://art/street/medallion.png")
const T_CIRCUIT := preload("res://art/street/circuit_run.png")
const T_POOL := preload("res://art/street/light_pool.png")
const FACADE_SHADER := preload("res://vfx/facade.gdshader")
const T_NEON := preload("res://art/street/neon_atlas.png")     # 6 signs stacked, self-drawn
const T_SHOP := preload("res://art/street/shop_glow.png")
const T_LAMP := preload("res://art/street/lamp_glow.png")
const T_CONE := preload("res://art/street/lamp_cone.png")
const NEON_SIGNS: int = 6

const BUILDINGS: Array[String] = ["building-a", "building-b", "building-c", "building-d", "building-e",
	"building-f", "building-g", "building-h", "building-k", "building-l"]
const STREET_HALF: float = 5.6       # kerb to kerb half width (fight.gd clamps at 4.7 m)
const SHOP_W: float = 7.0
const NEAR_FADE: Vector2 = Vector2(13.0, 15.5)   # lamps fade out nearer the camera than this (m)
const MERGE_CHUNK: float = 12.0      # metres of street per merged mesh (culling)

var ground: MeshInstance3D
var plaza: MeshInstance3D
var _dressing: Node3D
var _scenes: Dictionary = {}
var map_blocks: Array[Rect2] = []   # building footprints (x, z in metres) for the minimap


## The look (cq 015, docs/game3d/LOOK.md): every piece can be switched off from the fight
## config ("look": {"sky": false, ...}) to measure what it costs.
const LOOK_DEFAULTS: Dictionary = {
	"sky": true,        # dusk sky ambient (cool above, lilac horizon, warm bounce below), not flat grey;
	                    # true: a flat sky-up ambient + the hemisphere term in the fighter and facade
	                    # shaders (ALU only); "cube": Godot's sky radiance (two cubemap reads a pixel)
	"fog": false,       # warm haze up the far street, sun-scattered: ~3 % of the frame on the
	                    # software GPU for a faint effect at the top of the screen, so opt-in
	"glow": false,      # Godot glow (post pass): bloom on what is brighter than white. Off: see below
	"grade": false,     # BCS + a split-tone LUT (post pass). Off: see below
	"rim": true,        # the fighters' key-side rim light (in their own pass, fighter.gd)
	"ao": true,         # soft dark where the shop walls meet the paving
	"halos": true,      # soft coloured halos round signs and lamp heads (bloom faked on the light)
	"shadows": false,   # real directional shadows (the blob shadows are always on)
	"tonemap": "aces",  # aces | filmic | agx (all in the scene shader, no extra pass)
}
# "glow" and "grade" each turn on the Compatibility renderer's post pass, which runs over the
# whole screen at full resolution: on the 1-thread software GPU it doubled the frame (LOOK.md).
# Instead the lamps, signs and windows carry their own halo cards (the effects do the same), and
# the grade is in the light and material colours. Turn them on for a device that can pay.
## The key light: a low warm evening sun from up the street on the left (the reference's
## haze sits top left), so the fighters are side-lit and the street's right walls catch it.
const KEY_ROT: Vector3 = Vector3(-34.0, -128.0, 0.0)
const KEY_COLOR: Color = Color(1.0, 0.74, 0.46)
const KEY_ENERGY: float = 1.35
## The dusk sky that lights the shade (look "sky"): straight up, at the horizon, and the bounce
## off the warm paving from below. The paving faces up, so it gets SKY_UP; the walls and the
## fighters add the rest of the gradient in their shaders (hemi_* uniforms).
const SKY_UP: Color = Color(0.6, 0.66, 1.0)
const SKY_HORIZON: Color = Color(0.8, 0.74, 0.9)
const SKY_GROUND: Color = Color(0.6, 0.48, 0.5)
const SKY_ENERGY: float = 0.85

var look: Dictionary = {}
var sun: DirectionalLight3D
var env: Environment


static func look_opts(cfg: Dictionary) -> Dictionary:
	var out: Dictionary = LOOK_DEFAULTS.duplicate()
	var l: Variant = cfg.get("look", {})
	if l is Dictionary:
		for k: String in (l as Dictionary):
			out[k] = l[k]
	if cfg.has("shadows"):
		out["shadows"] = bool(cfg["shadows"])
	if cfg.has("fog"):
		out["fog"] = bool(cfg["fog"])
	return out


## The hemisphere ambient's extra over the flat sky-up ambient, for a shader with hemi_* uniforms
## (char_lit, facade). Zero when the look's sky is off or the real sky cube is used.
static func set_hemi(sm: ShaderMaterial, l: Dictionary) -> void:
	var on: bool = str(l.get("sky", true)) == "true"
	sm.set_shader_parameter("hemi_up", SKY_UP)
	sm.set_shader_parameter("hemi_horizon", SKY_HORIZON)
	sm.set_shader_parameter("hemi_ground", SKY_GROUND)
	sm.set_shader_parameter("hemi_energy", SKY_ENERGY if on else 0.0)


## The direction the key light travels (world space), for the fighters' rim.
static func key_dir() -> Vector3:
	return Basis.from_euler(KEY_ROT * (PI / 180.0)) * Vector3(0, 0, -1)


func build(cfg: Dictionary) -> void:
	look = look_opts(cfg)
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.2, 0.2, 0.36)
	if str(look["sky"]) == "true":
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = SKY_UP
		env.ambient_light_energy = SKY_ENERGY
		env.background_color = SKY_HORIZON * 0.6   # what the (rare) metal reflects
	elif str(look["sky"]) == "cube":
		# ambient from a sky (never seen: the camera looks down): surfaces facing up get the
		# blue-violet dusk sky, walls the warm horizon, undersides the warm paving's bounce.
		# A 32 px radiance map, filtered once at load; one cubemap read per pixel.
		var sm := ProceduralSkyMaterial.new()
		sm.sky_top_color = Color(0.46, 0.56, 1.0)
		sm.sky_horizon_color = Color(0.78, 0.74, 0.92)
		sm.sky_curve = 0.12
		sm.ground_horizon_color = Color(0.82, 0.68, 0.72)
		sm.ground_bottom_color = Color(0.55, 0.44, 0.48)
		sm.ground_curve = 0.06
		sm.sun_angle_max = 40.0
		sm.sun_curve = 0.2
		var sky := Sky.new()
		sky.sky_material = sm
		sky.radiance_size = Sky.RADIANCE_SIZE_32
		sky.process_mode = Sky.PROCESS_MODE_QUALITY
		env.sky = sky
		env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		env.ambient_light_sky_contribution = 1.0
		env.ambient_light_energy = SKY_ENERGY
		env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	else:
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = Color(0.62, 0.64, 0.92)
		env.ambient_light_energy = 0.66
	env.tonemap_mode = {"filmic": Environment.TONE_MAPPER_FILMIC, "agx": Environment.TONE_MAPPER_AGX}.get(str(look["tonemap"]), Environment.TONE_MAPPER_ACES)
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.fog_enabled = bool(look["fog"])
	if env.fog_enabled:
		# depth fog: nothing near the fight, a warm lilac haze up the far street, brighter
		# towards the sun (the reference's sunlit haze top left)
		env.fog_mode = Environment.FOG_MODE_DEPTH
		env.fog_light_color = Color(0.86, 0.66, 0.74)
		env.fog_light_energy = 1.0
		env.fog_sun_scatter = 0.5
		env.fog_density = 0.85
		env.fog_depth_begin = 21.0
		env.fog_depth_end = 64.0
		env.fog_depth_curve = 1.6
		env.fog_sky_affect = 0.0
	if bool(look["glow"]):
		# bloom only on what is brighter than white (lit windows, neon, lamp heads); the
		# effects peak near white and keep their own glow (EFFECTS.md), so the threshold
		# sits above them
		env.glow_enabled = true
		env.glow_normalized = false
		env.glow_intensity = 0.9
		env.glow_strength = 1.0
		env.glow_bloom = 0.0
		env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SCREEN
		env.glow_hdr_threshold = 1.15
		env.glow_hdr_scale = 2.0
		for i in 7:
			env.set_glow_level(i, 0.0)
		env.set_glow_level(1, 0.6)
		env.set_glow_level(2, 1.0)
		env.set_glow_level(3, 0.7)
	if bool(look["grade"]):
		# a warm evening grade: a touch more contrast and colour, and a split-tone curve
		# (violet shadows, gold highlights) as a 256 px colour-correction ramp
		env.adjustment_enabled = true
		env.adjustment_brightness = 1.0
		env.adjustment_contrast = 1.04
		env.adjustment_saturation = 0.9
		env.adjustment_color_correction = _grade_ramp()
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = KEY_ROT
	sun.light_energy = KEY_ENERGY
	sun.light_color = KEY_COLOR
	sun.shadow_enabled = bool(look["shadows"])
	if sun.shadow_enabled:
		# the fighters only (the street casts nothing): one orthogonal split close in
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
		sun.directional_shadow_max_distance = 30.0
		sun.shadow_blur = 2.0
		sun.shadow_opacity = 0.7
	add_child(sun)
	# no second (fill) light: each directional light is shaded on every pixel, ~2 ms a frame
	# on the software GPU; the sky ambient is the fill
	# the street floor, paved
	ground = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(160, 160)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_texture = T_PAVERS
	gm.uv1_scale = Vector3(40, 40, 1)
	gm.albedo_color = Color(0.66, 0.63, 0.69)
	gm.roughness = 0.95
	# plain trilinear: anisotropic filtering costs ~1.7 ms a frame on a software GPU
	gm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	ground.material_override = gm
	add_child(ground)
	# the medallion at the centre: where the fight stands
	plaza = MeshInstance3D.new()
	var mq := PlaneMesh.new()
	mq.size = Vector2(7.2, 7.2)
	plaza.mesh = mq
	var mm := StandardMaterial3D.new()
	mm.albedo_texture = T_MEDALLION
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mm.alpha_scissor_threshold = 0.5
	mm.albedo_color = Color(0.92, 0.78, 0.74)
	mm.roughness = 0.9
	plaza.material_override = mm
	plaza.position.y = 0.02
	add_child(plaza)
	# circuit lines down the street, towards the camera, as on the reference
	var cm := StandardMaterial3D.new()
	cm.albedo_texture = T_CIRCUIT
	cm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	cm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	cm.albedo_color = Color(1, 1, 1, 0.9)
	cm.disable_receive_shadows = true
	for i in 2:
		var c := MeshInstance3D.new()
		var cq := PlaneMesh.new()
		cq.size = Vector2(2.4, 9.6)
		c.mesh = cq
		c.material_override = cm
		c.position = Vector3(0.6 + i * 0.2, 0.03, 9.6 + i * 9.6)
		c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(c)
	if str(cfg.get("arena", "street")) == "plain":
		return
	_dressing = Node3D.new()
	_dressing.name = "Street"
	add_child(_dressing)
	for k in 2:
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_neon_st.append(st)
		var st2 := SurfaceTool.new()
		st2.begin(Mesh.PRIMITIVE_TRIANGLES)
		_shop_st.append(st2)
	_cones_st = SurfaceTool.new()
	_cones_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_halo_st = SurfaceTool.new()
	_halo_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_shade_st = SurfaceTool.new()
	_shade_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_build_street()
	# the low sun's glare up the street, as on the reference (its bloom): one big warm pool on the
	# far paving, in the halo mesh, so no extra draw
	if bool(look.get("halos", true)):
		_halo_st.set_color(Color(1.0 / HALO_GAIN, 0.74 / HALO_GAIN, 0.48 / HALO_GAIN, 0.85))
		_ground_quad(_halo_st, SUN_GLARE, 15.0, 20.0, Rect2(0, 0, 1, 1))
	if bool(look["ao"]):
		_bake_ground()
	_commit_glows()
	if bool(cfg.get("merge_street", true)):
		_merge_dressing()


## The grade's colour curve, per channel (input level -> output level): shadows lean violet,
## highlights gold, as on the reference's evening street.
static func _grade_ramp() -> GradientTexture1D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.22, 0.5, 0.78, 1.0])
	g.colors = PackedColorArray([Color(0.07, 0.06, 0.12), Color(0.25, 0.24, 0.3), Color(0.505, 0.495, 0.5),
		Color(0.81, 0.775, 0.72), Color(1.0, 0.97, 0.9)])
	g.interpolation_mode = Gradient.GRADIENT_INTERPOLATE_CUBIC
	var t := GradientTexture1D.new()
	t.gradient = g
	t.width = 256
	return t


func _scene(n: String) -> PackedScene:
	if not _scenes.has(n):
		_scenes[n] = load("res://art/city/%s.glb" % n)
	return _scenes[n]


## An instance of a kit piece scaled so its footprint is `width` metres wide.
func _piece(n: String, width: float, at: Vector3, yaw_deg: float) -> Node3D:
	var ps: PackedScene = _scene(n)
	if ps == null:
		return null
	var inst: Node3D = ps.instantiate() as Node3D
	var holder := Node3D.new()
	holder.add_child(inst)
	var aabb: AABB = _aabb(inst)
	var s: float = width / maxf(0.01, maxf(aabb.size.x, aabb.size.z))
	inst.scale = Vector3.ONE * s
	inst.position = Vector3(-aabb.get_center().x * s, -aabb.position.y * s, -aabb.get_center().z * s)
	holder.position = at
	holder.rotation_degrees.y = yaw_deg
	_dressing.add_child(holder)
	for mi: Node in inst.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if n.begins_with("building"):
			mi.set_meta("facade", true)
		elif n in ["planter", "tree-small", "stall-bench"]:
			mi.set_meta("near_fade", true)
	return holder


static func _aabb(root: Node3D) -> AABB:
	var out := AABB()
	var first: bool = true
	for n: Node in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf: Transform3D = Transform3D.IDENTITY
		var p: Node = mi
		while p != null and p != root:
			if p is Node3D:
				xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var box: AABB = xf * mi.get_aabb()
		if first:
			out = box
			first = false
		else:
			out = out.merge(box)
	return out


func _build_street() -> void:
	# shop fronts down both sides of the street, facing in
	var i: int = 0
	var z: float = 16.0
	while z > -42.0:
		for side in 2:
			var sx: float = -1.0 if side == 0 else 1.0
			var x: float = (STREET_HALF + SHOP_W * 0.5) * sx
			var n: String = BUILDINGS[(i * 3 + side * 5) % BUILDINGS.size()]
			var h: Node3D = _piece(n, SHOP_W, Vector3(x, 0, z), 90.0 if side == 0 else -90.0)
			if h != null:
				_dress_front(h, sx, i * 2 + side)
				var wb: AABB = h.transform * _aabb(h)
				map_blocks.append(Rect2(wb.position.x, wb.position.z, wb.size.x, wb.size.z))
		z -= SHOP_W + 0.4
		i += 1
	# kerbs: a slightly raised strip in front of the shops
	var km := StandardMaterial3D.new()
	km.albedo_color = Color(0.62, 0.55, 0.6)
	km.roughness = 0.95
	for side in 2:
		var k := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(0.5, 0.18, 62.0)
		k.mesh = b
		k.material_override = km
		k.position = Vector3((STREET_HALF - 0.3) * (-1.0 if side == 0 else 1.0), 0.09, -13.0)
		_dressing.add_child(k)
	# street lamps with warm pools, planters and benches along the kerbs
	var pool_m := StandardMaterial3D.new()
	pool_m.albedo_texture = T_POOL
	pool_m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	pool_m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	pool_m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	pool_m.albedo_color = Color(1.0, 0.68, 0.36, 0.42)
	pool_m.disable_receive_shadows = true
	var lz: float = 10.0
	var li: int = 0
	while lz > -36.0:
		for side in 2:
			var sx: float = -1.0 if side == 0 else 1.0
			var lamp := _piece("light-curved", 1.6, Vector3(sx * (STREET_HALF - 0.55), 0, lz + side * 3.0), 90.0 if side == 0 else -90.0)
			if lamp != null:
				var aabb: AABB = _aabb(lamp)
				var h: float = aabb.size.y
				lamp.scale = Vector3.ONE * (5.5 / maxf(0.1, h))
				for mi: Node in lamp.find_children("*", "MeshInstance3D", true, false):
					mi.set_meta("lamp", true)
				# the lamp head: the end of the arm, over the street
				var wb: AABB = lamp.transform * _aabb(lamp)
				var head_x: float = wb.position.x if sx > 0.0 else wb.end.x
				var head := Vector3(head_x + sx * 0.25, wb.end.y - 0.35, lamp.position.z)
				# the head itself, in the halo mesh (same texture, one draw for both)
				_halo_st.set_color(Color(1.0, 0.885, 0.69) )
				_glow_quad(_halo_st, head, 2.2, 2.2, Rect2(0, 0, 1, 1), true)
				_halo(head, 2.4, Color(1.0, 0.72, 0.4, 0.45))
				# the light falling from the head to its pool, as on the reference's dusk street
				_cone(_cones_st, head - Vector3(0, 0.2, 0), Vector3(head.x, 0.05, head.z + 0.6), 0.4, 4.0)
				if sx < 0.0 and bool(look.get("ao", true)):
					_post_shadow(Vector3(lamp.position.x, 0.0, lamp.position.z), wb.size.y)
			var pool := MeshInstance3D.new()
			var pq := PlaneMesh.new()
			pq.size = Vector2(8.0, 8.0)
			pool.mesh = pq
			pool.material_override = pool_m
			pool.position = Vector3(sx * (STREET_HALF - 3.0), 0.035, lz + side * 3.0)
			pool.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_dressing.add_child(pool)
			if li % 2 == 0:
				_piece("planter", 1.4, Vector3(sx * (STREET_HALF - 0.9), 0, lz + side * 3.0 - 2.2), 0.0)
			else:
				_piece("stall-bench", 2.0, Vector3(sx * (STREET_HALF - 1.0), 0, lz + side * 3.0 - 2.4), 90.0 if side == 0 else -90.0)
		lz -= 9.0
		li += 1
	for side in 2:
		_piece("tree-small", 2.6, Vector3((STREET_HALF - 1.2) * (-1.0 if side == 0 else 1.0), 0, -24.0 + side * 4.0), 0.0)


# ---- the lit street: neon signs, shop windows, lamp heads. Each kind is one mesh per side of
# the street (a handful of draw calls, unshaded and additive), not one node per sign.
var _neon_st: Array[SurfaceTool] = []
var _shop_st: Array[SurfaceTool] = []
var _cones_st: SurfaceTool
var _halo_st: SurfaceTool    # cq 015: soft coloured halos behind signs and lamp heads (bloom faked on the light)
var _shade_st: SurfaceTool   # cq 015: baked sun shade and contact darkening where the walls meet the paving
const SIGN_HALO: Array[Color] = [Color(1.0, 0.3, 0.7), Color(0.25, 0.8, 1.0), Color(1.0, 0.7, 0.25),
	Color(0.65, 0.35, 1.0), Color(0.3, 1.0, 0.55), Color(1.0, 0.35, 0.45)]   # the neon atlas's six signs
const SHADE_COL: Color = Color(0.6, 0.62, 0.86)   # multiplied into the paving: the sky-lit shade
const AO_COL: Color = Color(0.5, 0.47, 0.62)       # the contact darkening at the foot of a wall
const KERB_TOP: float = 0.185
const SUN_GLARE: Vector3 = Vector3(-2.0, 0.06, -19.0)   # a warm pool of low sun on the far paving
const HALO_GAIN: float = 1.3   # the halo mesh's material gain: vertex colours stop at 1, lamp heads need 1.3
var _cam_facing: Basis = Basis.from_euler(Vector3(deg_to_rad(-44.0), 0.0, 0.0))   # fight.gd CAM_PITCH


## A shop front: warm light spilling from its windows onto the pavement, and on most a neon
## blade sign sticking out over the pavement (turned to the fight camera, so it reads).
func _dress_front(h: Node3D, sx: float, n: int) -> void:
	var wb: AABB = h.transform * _aabb(h)
	var front_x: float = wb.end.x if sx < 0.0 else wb.position.x
	var zc: float = wb.get_center().z
	var length: float = wb.size.z
	var side: int = 0 if sx < 0.0 else 1
	_ground_quad(_shop_st[side], Vector3(front_x - sx * 1.0, 0.04, zc), 2.0, length * 0.8, Rect2(0, 0, 1, 1))
	if bool(look.get("ao", true)):
		_wall_shade(front_x, sx, wb.position.z, wb.end.z, wb.end.y)
	# signs only up the street (z < -5): the camera's focus never goes past z = -8
	# (fight.gd CAM_BOUNDS), so they stay up the screen, never among the controls
	if n % 3 != 2 and zc < -5.0:
		var k: int = (n * 5 + 1) % NEON_SIGNS
		var w: float = 2.2
		var at := Vector3(front_x - sx * (w * 0.5 + 0.1), 4.7 + 0.35 * float(n % 2), zc + (1.2 if n % 2 == 0 else -1.2))
		_glow_quad(_neon_st[side], at, w, w * 0.375, Rect2(0, float(k) / NEON_SIGNS, 1, 1.0 / NEON_SIGNS), true)
		var hc: Color = SIGN_HALO[k]
		hc.a = 0.3
		_halo(at, w * 1.7, hc, 0.6)


## A soft coloured halo round a light, facing the camera (vertex colour x the lamp glow).
func _halo(c: Vector3, size: float, col: Color, aspect: float = 1.0) -> void:
	if not bool(look.get("halos", true)):
		return
	_halo_st.set_color(Color(col.r / HALO_GAIN, col.g / HALO_GAIN, col.b / HALO_GAIN, col.a))
	_glow_quad(_halo_st, c, size, size * aspect, Rect2(0, 0, 1, 1), true)


## The paving at the foot of a shop front: a contact darkening 0.9 m out on every wall, and on the
## street's left side (the low sun comes from the left, KEY_ROT) the block's shade, as wide as
## half its height (2.5 to 4.5 m), leaning along the sun, fading out softly. The paving's share is
## baked into the ground mesh's vertex colours (`_bake_ground`, no extra draw, no overdraw); the
## kerb's top gets a thin multiplied strip.
func _wall_shade(front_x: float, sx: float, z0: float, z1: float, h: float) -> void:
	var w: float = clampf(h * 0.5, 2.5, 4.5) if sx < 0.0 else 0.0
	_blocks.append([sx, front_x, z0, z1, w])
	var kerb_in: float = STREET_HALF - 0.55       # the kerb's street-side edge (|x|)
	var xk: float = sx * kerb_in
	var lean: float = _lean() if sx < 0.0 else 0.0
	var ck: Color = _shade_at(xk + sx * 0.01, (z0 + z1) * 0.5 + lean * absf(xk - front_x))
	var c0: Color = _shade_at(front_x - sx * 0.01, (z0 + z1) * 0.5)
	_shade_quad(Vector3(front_x, KERB_TOP, z0), Vector3(xk, KERB_TOP, z0 + lean * absf(xk - front_x)), z1 - z0, c0, ck)


var _blocks: Array = []   # [sx, front_x, z0, z1, shade width] per shop block


## Metres along the street the sun's shade moves per metre across it.
static func _lean() -> float:
	var d: Vector3 = key_dir()
	return d.z / maxf(0.05, absf(d.x))


## The baked shade multiplier at a point of the paving (white = none).
func _shade_at(x: float, z: float) -> Color:
	var c := Color.WHITE
	var lean: float = _lean()
	for b: Array in _blocks:
		var sx: float = b[0]
		var dist: float = (x - float(b[1])) * -sx    # metres out from the wall into the street
		if dist < 0.0 or dist > 4.6:
			continue
		var zb: float = z - (lean * dist if sx < 0.0 else 0.0)
		if zb < float(b[2]) - 0.2 or zb > float(b[3]) + 0.2:
			continue
		# soft ends where the blocks' gaps let the sun through
		var edge: float = clampf(minf(zb - float(b[2]) + 0.2, float(b[3]) + 0.2 - zb) / 0.6, 0.0, 1.0)
		if dist < 0.9:
			c *= AO_COL.lerp(Color.WHITE, lerpf(1.0, dist / 0.9, edge))
		var w: float = b[4]
		if w > 0.0 and dist < w:
			c *= SHADE_COL.lerp(Color.WHITE, lerpf(1.0, smoothstep(0.0, 1.0, dist / w), edge))
	return c


## The ground with the shade baked in: a grid over the street whose vertex colours multiply the
## paving, dense only near the walls (0.3 m) and open in the middle, 2.2 m along the street over
## the stretch the camera can see, and plain quads out to the old 160 m plate. Few triangles: on a
## software GPU every triangle has a set-up cost (a 0.35 x 0.7 m grid, ~6k triangles, cost more
## than the multiplied overlay it replaced).
func _bake_ground() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var hx: float = STREET_HALF + 0.35
	var zmin: float = -44.8
	var zmax: float = 21.0
	var xs: Array[float] = []
	for d: float in [-0.35, 0.0, 0.3, 0.6, 0.9, 1.4, 2.0, 2.7, 3.5, 4.5]:
		xs.append(-STREET_HALF + d)
	for d: float in [4.5, 2.0, 0.9, 0.45, 0.0, -0.35]:
		xs.append(STREET_HALF - d)
	var nz: int = int(ceil((zmax - zmin) / 2.2))
	var cols: Array = []
	for j in nz + 1:
		var row: Array = []
		for x: float in xs:
			row.append(_shade_at(x, zmin + j * ((zmax - zmin) / nz)))
		cols.append(row)
	for j in nz:
		var z0: float = zmin + j * ((zmax - zmin) / nz)
		var z1: float = zmin + (j + 1) * ((zmax - zmin) / nz)
		for i in xs.size() - 1:
			_ground_cell(st, xs[i], z0, xs[i + 1], z1, [cols[j][i], cols[j][i + 1], cols[j + 1][i + 1], cols[j + 1][i]])
	var w := Color.WHITE
	for r: Array in [[-80.0, -80.0, 80.0, zmin], [-80.0, zmax, 80.0, 80.0], [-80.0, zmin, -hx, zmax], [hx, zmin, 80.0, zmax]]:
		_ground_cell(st, r[0], r[1], r[2], r[3], [w, w, w, w])
	ground.mesh = st.commit()
	(ground.material_override as StandardMaterial3D).vertex_color_use_as_albedo = true
	(ground.material_override as StandardMaterial3D).uv1_scale = Vector3.ONE


func _ground_cell(st: SurfaceTool, x0: float, z0: float, x1: float, z1: float, c: Array) -> void:
	# UVs as the old PlaneMesh x 40: one paving repeat every 4 m, same phase
	var p := [Vector3(x0, 0, z0), Vector3(x1, 0, z0), Vector3(x1, 0, z1), Vector3(x0, 0, z1)]
	for idx: int in [0, 1, 2, 0, 2, 3]:
		st.set_color(c[idx])
		st.set_normal(Vector3.UP)
		st.set_uv(Vector2((p[idx].x + 80.0) / 4.0, (p[idx].z + 80.0) / 4.0))
		st.add_vertex(p[idx])


## A lamp post's long thin shadow across the paving, leaning away from the low sun.
func _post_shadow(base: Vector3, h: float) -> void:
	var d: Vector3 = key_dir()
	var run := Vector3(d.x, 0.0, d.z) / maxf(0.2, -d.y) * h * 0.8
	var side: Vector3 = Vector3(-run.z, 0.0, run.x).normalized() * 0.11
	var a := Vector3(base.x, 0.03, base.z)
	var b := a + run
	var p := [a - side, a + side, b + side * 2.5, b - side * 2.5]
	var col: Array[Color] = [SHADE_COL, SHADE_COL, Color.WHITE, Color.WHITE]
	for idx: int in [0, 1, 2, 0, 2, 3]:
		_shade_st.set_color(_ink(col[idx]))
		_shade_st.set_normal(Vector3.UP)
		_shade_st.add_vertex(p[idx])


## The shade multiplier `c` (white = none) as an alpha-blended ink of the same darkness.
const SHADE_INK: Color = Color(0.16, 0.15, 0.36)


static func _ink(c: Color) -> Color:
	var k: float = 1.0 - (c.r * 0.3 + c.g * 0.55 + c.b * 0.15)
	return Color(SHADE_INK.r, SHADE_INK.g, SHADE_INK.b, clampf(k * 1.15, 0.0, 1.0))


## A strip from the line `a` (length `len` along +z) to the line `b`, colour ca at a, cb at b.
func _shade_quad(a: Vector3, b: Vector3, len: float, ca: Color, cb: Color) -> void:
	var p := [a, b, b + Vector3(0, 0, len), a + Vector3(0, 0, len)]
	var c := [ca, cb, cb, ca]
	for idx: int in [0, 1, 2, 0, 2, 3]:
		_shade_st.set_color(_ink(c[idx]))
		_shade_st.set_normal(Vector3.UP)
		_shade_st.add_vertex(p[idx])


## A flat quad on the ground: `wx` across the street (x), `wz` along it.
func _ground_quad(st: SurfaceTool, c: Vector3, wx: float, wz: float, uv: Rect2) -> void:
	_quad(st, c, Vector3(0, 0, wz * 0.5), Vector3(wx * 0.5, 0, 0), uv)


## A quad on a wall facing the street (the wall's normal is -sx along x).
func _wall_quad(st: SurfaceTool, c: Vector3, sx: float, w: float, h: float, uv: Rect2) -> void:
	var right: Vector3 = Vector3(0, 0, sx) * (w * 0.5)   # reads left to right from the street
	var up: Vector3 = Vector3(0, h * 0.5, 0)
	_quad(st, c, right, up, uv)


## A quad that faces the (fixed-angle) fight camera: a glow without a billboard node.
func _glow_quad(st: SurfaceTool, c: Vector3, w: float, h: float, uv: Rect2, _face_cam: bool) -> void:
	_quad(st, c, _cam_facing.x * (w * 0.5), _cam_facing.y * (h * 0.5), uv)


## A light cone: a vertical trapezoid facing the camera's side of the street (+z).
func _cone(st: SurfaceTool, top: Vector3, bottom: Vector3, top_w: float, bottom_w: float) -> void:
	var p := [bottom - Vector3(bottom_w * 0.5, 0, 0), bottom + Vector3(bottom_w * 0.5, 0, 0), top + Vector3(top_w * 0.5, 0, 0), top - Vector3(top_w * 0.5, 0, 0)]
	var t := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
	for idx: int in [0, 1, 2, 0, 2, 3]:
		st.set_uv(t[idx])
		st.add_vertex(p[idx])


func _quad(st: SurfaceTool, c: Vector3, right: Vector3, up: Vector3, uv: Rect2) -> void:
	var p := [c - right - up, c + right - up, c + right + up, c - right + up]
	var t := [Vector2(uv.position.x, uv.end.y), Vector2(uv.end.x, uv.end.y), Vector2(uv.end.x, uv.position.y), uv.position]
	for idx: int in [0, 1, 2, 0, 2, 3]:
		st.set_uv(t[idx])
		st.add_vertex(p[idx])


func _glow_mat(tex: Texture2D, col: Color, add: bool = true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.albedo_color = col
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if add else BaseMaterial3D.BLEND_MODE_MIX
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_receive_shadows = true
	m.no_depth_test = false
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	return m


func _commit_glows() -> void:
	# cq 015: brighter than white (the ACES tonemap rolls the peak off), so signs read as lit tubes
	var neon_m := _glow_mat(T_NEON, Color(1.35, 1.35, 1.35, 1.0), false)   # mixed: added on the pale paving it washes to white
	var shop_m := _glow_mat(T_SHOP, Color(1.0, 0.78, 0.5, 0.6))
	var halo_m := _glow_mat(T_LAMP, Color(HALO_GAIN, HALO_GAIN, HALO_GAIN, 1))
	halo_m.vertex_color_use_as_albedo = true
	halo_m.render_priority = -1   # under the signs and lamp heads, not over them
	_near_fade(halo_m, true)
	var shade_m := StandardMaterial3D.new()
	shade_m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	shade_m.vertex_color_use_as_albedo = true
	# alpha-blended towards a dusk ink, not multiplied: with a post pass on (look glow / grade) the
	# 3D buffer is scaled by a luminance multiplier and a multiply blend goes black
	shade_m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	shade_m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	shade_m.disable_receive_shadows = true
	shade_m.disable_fog = true
	shade_m.cull_mode = BaseMaterial3D.CULL_DISABLED   # the strips are wound either way
	var cone_m := _glow_mat(T_CONE, Color(1.0, 0.82, 0.55, 0.95))
	_near_fade(cone_m, true)
	var out: Array = []
	for side in 2:
		out.append([_neon_st[side], neon_m])
		out.append([_shop_st[side], shop_m])
	out.append([_cones_st, cone_m])
	out.append([_halo_st, halo_m])
	out.append([_shade_st, shade_m])
	for pair: Array in out:
		var mesh: ArrayMesh = (pair[0] as SurfaceTool).commit()
		if mesh.get_surface_count() == 0:
			continue
		var mi := MeshInstance3D.new()
		mi.name = "Glow"
		mi.mesh = mesh
		mi.material_override = pair[1]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)


## Bakes the whole street (about 90 mesh instances) into one mesh per material: the Kenney
## kits share a colour atlas, so the street draws in a handful of calls instead of ~90.
## On the emulator's software GPU each draw call is frame time, and frame time is input latency.
func _merge_dressing() -> void:
	var groups: Dictionary = {}     # key -> {st: SurfaceTool, mat: Material}
	var n_in: int = 0
	var inv: Transform3D = _dressing.global_transform.affine_inverse()
	for node: Node in _dressing.find_children("*", "MeshInstance3D", true, false):
		var mi := node as MeshInstance3D
		if mi.mesh == null:
			continue
		n_in += 1
		var xf: Transform3D = inv * mi.global_transform
		# one chunk per stretch of street and side, so the camera culls what it cannot see
		var at: Vector3 = xf * mi.get_aabb().get_center()
		var facade: bool = mi.has_meta("facade")
		# the shop fronts (most of the vertices) in chunks the camera can cull; the small
		# props one mesh per material (each extra mesh is a draw call)
		var chunk: String = "%d%s" % [floori(at.z / MERGE_CHUNK), "l" if at.x < 0.0 else "r"] if facade else ""
		for si in mi.mesh.get_surface_count():
			var mat: Material = mi.get_active_material(si)
			var key: String = "%s_c%s%s%s" % [_mat_key(mat), chunk, "f" if facade else "", "n" if mi.has_meta("near_fade") else ""]
			if not groups.has(key):
				var st := SurfaceTool.new()
				st.begin(Mesh.PRIMITIVE_TRIANGLES)
				groups[key] = {"st": st, "mat": _facade_mat(mat) if facade else (_dark(mat) if mi.has_meta("lamp") else (_faded(mat) if mi.has_meta("near_fade") else _opaque(mat)))}
			(groups[key]["st"] as SurfaceTool).append_from(mi.mesh, si, xf)
	var merged := Node3D.new()
	merged.name = "StreetMerged"
	for key: String in groups:
		var st: SurfaceTool = groups[key]["st"]
		var mesh: ArrayMesh = st.commit()
		var out := MeshInstance3D.new()
		out.mesh = mesh
		out.material_override = groups[key]["mat"]
		out.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		merged.add_child(out)
	remove_child(_dressing)
	_dressing.queue_free()
	_dressing = merged
	add_child(_dressing)
	# the kit scenes are no longer needed: each GLB embeds its own copy of the shared atlas,
	# so keeping them would hold ~15 duplicate textures in video memory
	_scenes.clear()
	_tex_hash.clear()
	print("CQ street merged %d mesh instances into %d (%.0f m chunks)" % [n_in, groups.size(), MERGE_CHUNK])


## The kits' GLBs import as alpha blended with a depth pre-pass (drawn twice, blended, sorted)
## though every pixel is opaque: draw the shop fronts, lamps and benches as plain opaque.
func _opaque(mat: Material) -> Material:
	if mat is BaseMaterial3D and (mat as BaseMaterial3D).transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_DEPTH_PRE_PASS:
		var m := (mat as BaseMaterial3D).duplicate() as BaseMaterial3D
		m.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
		return m
	return mat


## Lamp posts: dark iron, so the glowing heads carry them (the kit's are pale grey).
func _dark(mat: Material) -> Material:
	var m: Material = _opaque(mat)
	if m is BaseMaterial3D:
		m = (m as BaseMaterial3D).duplicate()
		(m as BaseMaterial3D).albedo_color = Color(0.3, 0.27, 0.36)
		_near_fade(m as BaseMaterial3D, false)
	return m


func _faded(mat: Material) -> Material:
	var m: Material = _opaque(mat)
	if m is BaseMaterial3D:
		m = (m as BaseMaterial3D).duplicate()
		_near_fade(m as BaseMaterial3D, false)
	return m


## Lamps close to the camera stand at the bottom of the screen, tall, behind the controls:
## fade them out there.
func _near_fade(m: BaseMaterial3D, alpha: bool) -> void:
	# alpha, not dither: a dithered lamp arm reads as noise at phone size
	m.distance_fade_mode = BaseMaterial3D.DISTANCE_FADE_PIXEL_ALPHA
	m.distance_fade_min_distance = NEAR_FADE.x
	m.distance_fade_max_distance = NEAR_FADE.y


var _facades: Dictionary = {}   # atlas texture -> the facade ShaderMaterial (one per atlas)


func _facade_mat(mat: Material) -> Material:
	if not (mat is BaseMaterial3D) or (mat as BaseMaterial3D).albedo_texture == null:
		return _opaque(mat)
	var tex: Texture2D = (mat as BaseMaterial3D).albedo_texture
	var key: String = _mat_key(mat)
	if not _facades.has(key):
		var sm := ShaderMaterial.new()
		sm.shader = FACADE_SHADER
		sm.set_shader_parameter("atlas", tex)
		set_hemi(sm, look)
		_facades[key] = sm
	return _facades[key]


var _tex_hash: Dictionary = {}   # texture instance id -> pixel hash (one hash per texture)


func _mat_key(mat: Material) -> String:
	# the kits' GLBs each embed their own copy of the same atlas: key them by the pixels
	if mat is BaseMaterial3D and (mat as BaseMaterial3D).albedo_texture != null:
		var bm := mat as BaseMaterial3D
		var tex: Texture2D = bm.albedo_texture
		var id: int = tex.get_instance_id()
		if not _tex_hash.has(id):
			var img: Image = tex.get_image()
			_tex_hash[id] = hash(img.get_data()) if img != null else id
		return "tex%d_%d_%s" % [_tex_hash[id], bm.transparency, str(bm.albedo_color)]
	return "mat%d" % (mat.get_instance_id() if mat != null else 0)


## With a 3D Tiles ground, the tileset is the floor: hide ours (and the plaza unless kept).
func tiles_mode(keep_plaza: bool) -> void:
	ground.visible = false
	if not keep_plaza:
		plaza.visible = false
	if _dressing != null:
		_dressing.visible = false
