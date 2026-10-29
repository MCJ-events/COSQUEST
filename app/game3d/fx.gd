extends Node3D
## Combat FX for the Compatibility renderer (cq 061, reworked in cq 233), all pooled:
##   weapon trails (a ribbon that follows the swing, additive, fading), swing crescents,
##   hit sparks + a contact flare scaled to the damage, ground rings and swirls, boss
##   telegraphs (circle or cone that fills over the wind-up), SPLIT ground bursts, CHARGE
##   streaks, RALLY sparkles, scorch marks, coin pops and the ally's bolts.
## Textures: art/fx (Kenney Particle Pack, CC0; and the project's own CC0 vfx_* set).

const TELEGRAPH_SHADER := preload("res://vfx/telegraph.gdshader")
const TRAIL_SHADER := preload("res://vfx/trail.gdshader")
const T_SPARK := preload("res://art/fx/spark_04.png")
const T_STAR := preload("res://art/fx/star_06.png")
const T_FLARE := preload("res://art/fx/flare_01.png")
const T_SLASH := preload("res://art/fx/slash_02.png")
const T_TRAIL := preload("res://art/fx/vfx_blade_trail.png")
const T_SWIRL := preload("res://art/fx/vfx_swirl.png")
const T_GLOW := preload("res://art/fx/vfx_glow.png")
const T_RING := preload("res://art/fx/vfx_ring_fire.png")
const T_COIN := preload("res://art/fx/vfx_coin.png")
const T_SCORCH := preload("res://art/fx/scorch_01.png")
const T_CIRCLE := preload("res://art/fx/circle_05.png")

const SLASH_LIFE: float = 0.22
const RING_LIFE: float = 0.4
const TRAIL_LIFE: float = 0.22

var _slash_mesh: ArrayMesh
var _ring_mesh: ArrayMesh
var _band_mesh: ArrayMesh
var _slashes: Array[MeshInstance3D] = []
var _rings: Array[MeshInstance3D] = []
var _bands: Array[MeshInstance3D] = []
var _flares: Array[MeshInstance3D] = []
var _decals: Array[MeshInstance3D] = []
var _coins: Array[MeshInstance3D] = []
var _teles: Array[MeshInstance3D] = []
var _sparks: Dictionary = {"s": [], "m": [], "l": []}
var _stars: Array[CPUParticles3D] = []
var _heals: Array[CPUParticles3D] = []
var _dust: Array[CPUParticles3D] = []
var _next: Dictionary = {}
var _live: Array[Dictionary] = []
var _trails: Dictionary = {}        # key -> {mi, mesh, samples: Array[[t, base, tip]], tint}
var _clock: float = 0.0
var _pending: Array[Dictionary] = []   # delayed bursts (SPLIT line)


func _ready() -> void:
	_slash_mesh = _arc_mesh(1.25, 1.9, 150.0, 20, true)
	_ring_mesh = _arc_mesh(0.8, 1.0, 360.0, 48, false)
	_band_mesh = _band(0.55, 1.0, 40)
	for i in 6:
		var sm := _additive(null)
		sm.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
		_slashes.append(_make_mi(_slash_mesh, sm))
	for i in 8:
		var rm := _additive(null)
		rm.blend_mode = BaseMaterial3D.BLEND_MODE_MIX   # reads on the light paving
		_rings.append(_make_mi(_ring_mesh, rm))
	for i in 4:
		_bands.append(_make_mi(_band_mesh, _additive(T_SWIRL)))
	for i in 8:
		_flares.append(_make_mi(_quad(1.0), _additive(T_FLARE, true)))
	for i in 10:
		_decals.append(_make_mi(_flat_quad(1.0), _alpha(T_SCORCH)))
	for i in 4:
		_coins.append(_make_mi(_quad(0.55), _alpha(T_COIN, true)))
	for i in 4:
		var mi := _make_mi(_flat_quad(2.0), null)
		var sm := ShaderMaterial.new()
		sm.shader = TELEGRAPH_SHADER
		mi.material_override = sm
		_teles.append(mi)
	for i in 4:
		(_sparks["s"] as Array).append(_make_sparks(8, T_SPARK, 0.08, Vector2(3.0, 7.0)))
		(_sparks["m"] as Array).append(_make_sparks(16, T_SPARK, 0.11, Vector2(4.0, 9.0)))
		(_sparks["l"] as Array).append(_make_sparks(30, T_SPARK, 0.14, Vector2(5.0, 12.0)))
		_stars.append(_make_sparks(6, T_STAR, 0.35, Vector2(1.5, 3.0)))
	for i in 2:
		var h := _make_sparks(26, T_STAR, 0.2, Vector2(1.0, 2.5))
		h.gravity = Vector3(0, 4.0, 0)
		h.lifetime = 0.9
		h.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
		h.emission_ring_axis = Vector3.UP
		h.emission_ring_radius = 0.9
		h.emission_ring_inner_radius = 0.2
		h.emission_ring_height = 0.1
		h.direction = Vector3.UP
		h.spread = 15.0
		_heals.append(h)
	for i in 3:
		var d := _make_sparks(14, T_CIRCLE, 0.45, Vector2(1.0, 2.6))
		d.gravity = Vector3(0, 0.6, 0)
		d.lifetime = 0.5
		d.direction = Vector3.UP
		d.spread = 80.0
		_dust.append(d)


# ---------------------------------------------------------------- building blocks

static func _additive(tex: Texture2D, billboard: bool = false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.vertex_color_use_as_albedo = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_receive_shadows = true
	m.no_depth_test = false
	if tex != null:
		m.albedo_texture = tex
	if billboard:
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	return m


static func _alpha(tex: Texture2D, billboard: bool = false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_receive_shadows = true
	m.albedo_texture = tex
	if billboard:
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	return m


func _make_mi(mesh: Mesh, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	add_child(mi)
	return mi


static func _quad(s: float) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2(s, s)
	return q


static func _flat_quad(s: float) -> PlaneMesh:
	var p := PlaneMesh.new()
	p.size = Vector2(s, s)
	return p


func _make_sparks(n: int, tex: Texture2D, size: float, vel: Vector2) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = n
	p.lifetime = 0.4
	p.explosiveness = 1.0
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = 180.0
	p.initial_velocity_min = vel.x
	p.initial_velocity_max = vel.y
	p.gravity = Vector3(0.0, -9.0, 0.0)
	p.damping_min = 3.0
	p.damping_max = 6.0
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.3
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.vertex_color_use_as_albedo = true
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.albedo_texture = tex
	q.material = m
	p.mesh = q
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	p.color_ramp = g
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	return p


func _pick(pool: Array, key: String) -> Variant:
	var i: int = int(_next.get(key, 0))
	_next[key] = (i + 1) % pool.size()
	return pool[i]


## A crescent (taper = true) or a ring / disc in the XZ plane, opening towards +Z.
## Vertex alpha: bright on the outer edge, clear on the inner edge.
static func _arc_mesh(r0: float, r1: float, deg: float, seg: int, taper: bool) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var outer: PackedVector3Array = PackedVector3Array()
	var inner: PackedVector3Array = PackedVector3Array()
	var oa: PackedFloat32Array = PackedFloat32Array()
	for i in seg + 1:
		var u: float = float(i) / float(seg)
		var a: float = deg_to_rad(-deg * 0.5 + deg * u)
		var w: float = maxf(sin(PI * u), 0.04) if taper else 1.0
		var ri: float = r1 - (r1 - r0) * w
		outer.append(Vector3(sin(a) * r1, 0.0, cos(a) * r1))
		inner.append(Vector3(sin(a) * ri, 0.0, cos(a) * ri))
		oa.append(lerpf(0.25, 1.0, u) if taper else 1.0)   # the leading edge of a swing is brightest
	for i in seg:
		var c0 := Color(1, 1, 1, oa[i])
		var c1 := Color(1, 1, 1, oa[i + 1])
		var ci := Color(1, 1, 1, 0.0 if taper else 0.35)
		st.set_color(c0)
		st.add_vertex(outer[i])
		st.set_color(ci)
		st.add_vertex(inner[i])
		st.set_color(c1)
		st.add_vertex(outer[i + 1])
		st.set_color(ci)
		st.add_vertex(inner[i])
		st.set_color(ci)
		st.add_vertex(inner[i + 1])
		st.set_color(c1)
		st.add_vertex(outer[i + 1])
	return st.commit()


## A flat ring with UVs (u around, v across), for the swirl texture.
static func _band(r0: float, r1: float, seg: int) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in seg:
		var a0: float = TAU * float(i) / float(seg)
		var a1: float = TAU * float(i + 1) / float(seg)
		var u0: float = float(i) / float(seg) * 3.0
		var u1: float = float(i + 1) / float(seg) * 3.0
		var p := [Vector3(sin(a0) * r0, 0, cos(a0) * r0), Vector3(sin(a0) * r1, 0, cos(a0) * r1),
			Vector3(sin(a1) * r0, 0, cos(a1) * r0), Vector3(sin(a1) * r1, 0, cos(a1) * r1)]
		var uv := [Vector2(u0, 1), Vector2(u0, 0), Vector2(u1, 1), Vector2(u1, 0)]
		for j: int in [0, 1, 3, 0, 3, 2]:
			st.set_color(Color.WHITE)
			st.set_uv(uv[j])
			st.add_vertex(p[j])
	return st.commit()


func _start(mi: Node3D, life: float, kind: String, size: float, tint: Color, extra: Dictionary = {}) -> Dictionary:
	for d: Dictionary in _live:
		if d["node"] == mi:
			_live.erase(d)
			break
	var d := {"node": mi, "t": 0.0, "life": life, "kind": kind, "size": size, "tint": tint}
	d.merge(extra)
	_live.append(d)
	return d


# ---------------------------------------------------------------- public FX

## A swing crescent at chest height, facing yaw. Returns the node (for latency checks).
func slash(at: Vector3, yaw: float, tint: Color, size: float, tilt: float) -> MeshInstance3D:
	var mi: MeshInstance3D = _pick(_slashes, "slash")
	mi.position = at
	mi.basis = Basis(Vector3.UP, yaw) * Basis(Vector3(0, 0, 1), tilt)
	mi.scale = Vector3.ONE * size * 0.85
	(mi.material_override as StandardMaterial3D).albedo_color = tint
	mi.visible = true
	_start(mi, SLASH_LIFE, "slash", size, tint)
	return mi


## Adds the current hilt/tip pair to `key`'s trail. Call every frame of a swing.
func trail_push(key: String, base: Vector3, tip: Vector3, tint: Color, t_back: float = 0.0) -> void:
	var tr: Dictionary = _trails.get(key, {})
	if tr.is_empty():
		var mi := MeshInstance3D.new()
		var im := ImmediateMesh.new()
		mi.mesh = im
		var sm := ShaderMaterial.new()
		sm.shader = TRAIL_SHADER
		sm.set_shader_parameter("tex", T_TRAIL)
		mi.material_override = sm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		tr = {"mi": mi, "mesh": im, "samples": [], "tint": tint}
		_trails[key] = tr
	tr["tint"] = tint
	var s: Array = tr["samples"]
	if not s.is_empty():
		var last: Array = s[-1]
		# densify fast sweeps so the ribbon stays a smooth arc at 15-30 fps
		var lb: Vector3 = last[1]
		var lt: Vector3 = last[2]
		var steps: int = clampi(int(lt.distance_to(tip) / 0.18), 0, 6)
		for i in steps:
			var u: float = float(i + 1) / float(steps + 1)
			s.append([lerpf(float(last[0]), _clock, u), lb.lerp(base, u), lt.lerp(tip, u)])
	s.append([_clock - t_back, base, tip])
	((tr["mi"] as MeshInstance3D).material_override as ShaderMaterial).set_shader_parameter("tint", tint)


func _draw_trails() -> void:
	for key: String in _trails:
		var tr: Dictionary = _trails[key]
		var s: Array = tr["samples"]
		while not s.is_empty() and _clock - float(s[0][0]) > TRAIL_LIFE:
			s.pop_front()
		var im: ImmediateMesh = tr["mesh"]
		im.clear_surfaces()
		var mi: MeshInstance3D = tr["mi"]
		mi.visible = s.size() >= 2
		if s.size() < 2:
			continue
		im.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
		for i in range(s.size() - 1, -1, -1):
			var age: float = clampf((_clock - float(s[i][0])) / TRAIL_LIFE, 0.0, 1.0)
			im.surface_set_color(Color(1, 1, 1, 1))
			im.surface_set_uv(Vector2(age, 0.0))
			im.surface_add_vertex(s[i][1])
			im.surface_set_uv(Vector2(age, 1.0))
			im.surface_add_vertex(s[i][2])
		im.surface_end()


## Sparks and a contact flare, scaled to the damage (a 60 jab is a flick, a 250 slam a burst).
func sparks(at: Vector3, tint: Color, dmg: int, crit: bool = false) -> void:
	var key: String = "s" if dmg < 90 else ("m" if dmg < 170 else "l")
	if crit and key == "s":
		key = "m"
	var p: CPUParticles3D = _pick(_sparks[key], "sp_" + key)
	p.position = at
	p.color = tint.lerp(Color.WHITE, 0.25)
	p.restart()
	p.emitting = true
	var fl: MeshInstance3D = _pick(_flares, "flare")
	fl.position = at
	var fs: float = clampf(0.9 + float(dmg) / 120.0, 1.0, 3.2) * (1.3 if crit else 1.0)
	fl.scale = Vector3.ONE * fs
	(fl.material_override as StandardMaterial3D).albedo_color = tint.lerp(Color.WHITE, 0.4)
	fl.visible = true
	_start(fl, 0.16, "flare", fs, tint.lerp(Color.WHITE, 0.4))
	if crit or dmg >= 170:
		var st: CPUParticles3D = _pick(_stars, "star")
		st.position = at
		st.color = Color(1.0, 0.9, 0.5)
		st.restart()
		st.emitting = true


## An expanding ground ring.
func ring(at: Vector3, radius: float, tint: Color, life: float = RING_LIFE) -> void:
	var mi: MeshInstance3D = _pick(_rings, "ring")
	mi.position = at + Vector3(0, 0.07, 0)
	mi.basis = Basis.IDENTITY
	mi.scale = Vector3.ONE * radius * 0.3
	(mi.material_override as StandardMaterial3D).albedo_color = tint
	mi.visible = true
	_start(mi, life, "ring", radius, tint)


## The WHIRL swirl: a textured band that spins and widens round the hero.
func swirl(at: Vector3, radius: float, tint: Color, life: float = 0.5, height: float = 0.9) -> void:
	var mi: MeshInstance3D = _pick(_bands, "band")
	mi.position = at + Vector3(0, height, 0)
	mi.basis = Basis.IDENTITY
	mi.scale = Vector3.ONE * radius * 0.6
	(mi.material_override as StandardMaterial3D).albedo_color = tint
	mi.visible = true
	_start(mi, life, "swirl", radius, tint)


## A boss telegraph: circle (half_deg >= 180) or cone towards yaw. The fill reaches the rim
## at `life`; the fight resolves the strike then and calls telegraph_end().
func telegraph(at: Vector3, yaw: float, radius: float, half_deg: float, life: float, tint: Color = Color(1.0, 0.2, 0.12, 1.0)) -> MeshInstance3D:
	var mi: MeshInstance3D = _pick(_teles, "tele")
	mi.position = at + Vector3(0, 0.05, 0)
	mi.basis = Basis(Vector3.UP, yaw)
	mi.scale = Vector3(radius, 1.0, radius)
	var sm := mi.material_override as ShaderMaterial
	sm.set_shader_parameter("tint", tint)
	sm.set_shader_parameter("half_angle", deg_to_rad(minf(half_deg, 180.0)))
	sm.set_shader_parameter("fill", 0.0)
	sm.set_shader_parameter("alpha", 1.0)
	sm.set_shader_parameter("flash", 0.0)
	mi.visible = true
	_start(mi, life, "tele", radius, tint, {"phase": "fill"})
	return mi


## The strike landed (flash then fade) or was cancelled (fade).
func telegraph_end(mi: MeshInstance3D, landed: bool) -> void:
	for d: Dictionary in _live:
		if d["node"] == mi:
			d["phase"] = "flash" if landed else "fade"
			d["t"] = 0.0
			d["life"] = 0.25
			return


func scorch(at: Vector3, size: float) -> void:
	var mi: MeshInstance3D = _pick(_decals, "decal")
	mi.position = at + Vector3(0, 0.04, 0)
	mi.basis = Basis(Vector3.UP, randf() * TAU)
	mi.scale = Vector3.ONE * size
	(mi.material_override as StandardMaterial3D).albedo_color = Color(0.1, 0.07, 0.06, 0.8)
	mi.visible = true
	_start(mi, 2.5, "decal", size, Color(0.1, 0.07, 0.06, 0.8))


func dust(at: Vector3) -> void:
	var p: CPUParticles3D = _pick(_dust, "dust")
	p.position = at + Vector3(0, 0.15, 0)
	p.color = Color(0.85, 0.78, 0.68, 0.55)
	p.restart()
	p.emitting = true


func heal(at: Vector3, tint: Color) -> void:
	var p: CPUParticles3D = _pick(_heals, "heal")
	p.position = at + Vector3(0, 0.1, 0)
	p.color = tint
	p.restart()
	p.emitting = true
	ring(at, 1.6, Color(tint.r, tint.g, tint.b, 0.8), 0.5)


func coin(at: Vector3) -> void:
	var mi: MeshInstance3D = _pick(_coins, "coin")
	mi.position = at
	(mi.material_override as StandardMaterial3D).albedo_color = Color(1, 1, 1, 1)
	mi.visible = true
	_start(mi, 0.9, "coin", 1.0, Color.WHITE, {"from": at})


## SPLIT: bursts that run along the ground from `from` in `dir` over `secs`.
func ground_split(from: Vector3, dir: Vector3, length: float, secs: float, tint: Color) -> void:
	var n: int = 6
	for i in n:
		var u: float = float(i + 1) / float(n)
		_pending.append({"at_t": _clock + secs * u, "p": from + dir * length * u, "tint": tint, "big": i == n - 1})


func _burst(p: Vector3, tint: Color, big: bool) -> void:
	ring(p, 1.3 if big else 0.9, tint, 0.35)
	sparks(p + Vector3(0, 0.3, 0), tint, 200 if big else 100)
	scorch(p, 1.6 if big else 1.1)
	dust(p)


## The ally's bolt: a glowing orb (the fight moves it and its Area3D).
func make_bolt(tint: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = _quad(0.7)
	var m := _additive(T_GLOW, true)
	m.albedo_color = tint
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi


# ---------------------------------------------------------------- tick

func _process(dt: float) -> void:
	_clock += dt
	while not _pending.is_empty() and _clock >= float(_pending[0]["at_t"]):
		var b: Dictionary = _pending.pop_front()
		_burst(b["p"], b["tint"], bool(b["big"]))
	_draw_trails()
	var i: int = _live.size() - 1
	while i >= 0:
		var d: Dictionary = _live[i]
		var t: float = float(d["t"]) + dt
		d["t"] = t
		var life: float = d["life"]
		var mi: MeshInstance3D = d["node"]
		var k: float = t / life
		var kind: String = d["kind"]
		if k >= 1.0 and not (kind == "tele" and d.get("phase", "") == "fill" and k < 3.0):
			mi.visible = false
			_live.remove_at(i)
			i -= 1
			continue
		var tint: Color = d["tint"]
		var size: float = d["size"]
		match kind:
			"slash":
				var mat := mi.material_override as StandardMaterial3D
				mi.scale = Vector3.ONE * size * lerpf(0.85, 1.2, ease(k, 0.5))
				mat.albedo_color = Color(tint.r, tint.g, tint.b, tint.a * (1.0 - ease(k, 1.8)))
			"ring":
				var mat2 := mi.material_override as StandardMaterial3D
				mi.scale = Vector3.ONE * size * lerpf(0.3, 1.0, ease(k, 0.4))
				mat2.albedo_color = Color(tint.r, tint.g, tint.b, tint.a * (1.0 - k))
			"swirl":
				var mat3 := mi.material_override as StandardMaterial3D
				mi.rotation.y -= dt * 14.0
				mi.scale = Vector3.ONE * size * lerpf(0.6, 1.1, ease(k, 0.5))
				mat3.albedo_color = Color(tint.r, tint.g, tint.b, tint.a * sin(k * PI))
			"flare":
				var mat4 := mi.material_override as StandardMaterial3D
				mi.scale = Vector3.ONE * size * lerpf(0.6, 1.2, k)
				mat4.albedo_color = Color(tint.r, tint.g, tint.b, 1.0 - k)
			"decal":
				var mat5 := mi.material_override as StandardMaterial3D
				mat5.albedo_color = Color(tint.r, tint.g, tint.b, tint.a * (1.0 - ease(k, 3.0)))
			"coin":
				var from: Vector3 = d["from"]
				mi.position = from + Vector3(0, 1.4 * sin(minf(k * 1.4, 1.0) * PI * 0.5), 0)
				mi.scale = Vector3(absf(cos(t * 9.0)) * 0.9 + 0.1, 1, 1)
				(mi.material_override as StandardMaterial3D).albedo_color = Color(1, 1, 1, 1.0 - ease(maxf(0.0, k - 0.6) / 0.4, 1.0))
			"tele":
				var sm := mi.material_override as ShaderMaterial
				match str(d.get("phase", "fill")):
					"fill":
						sm.set_shader_parameter("fill", clampf(k, 0.0, 1.0))
					"flash":
						sm.set_shader_parameter("fill", 1.0)
						sm.set_shader_parameter("flash", 0.8 * (1.0 - k))
						sm.set_shader_parameter("alpha", 1.0 - k)
					"fade":
						sm.set_shader_parameter("alpha", 1.0 - k)
		i -= 1
