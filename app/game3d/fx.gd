extends Node3D
## Cheap procedural combat FX for the Compatibility renderer:
## slash crescents (fade in ~0.2 s), ground rings / telegraphs and CPUParticles3D spark bursts.
## Everything is pooled; nothing is allocated per hit after warm-up.

const SLASH_LIFE: float = 0.2      # BattleFx.Slash 0.16 s, BladeTrail.Life 0.25 s: we sit between
const RING_LIFE: float = 0.35      # BattleFx.Shockwave life
const SPARKS_LIGHT: int = 10       # BattleFx.Hit: 10 sparks, 22 on a heavy hit
const SPARKS_HEAVY: int = 22

var _slash_mesh: ArrayMesh
var _ring_mesh: ArrayMesh
var _disc_mesh: ArrayMesh
var _slashes: Array[MeshInstance3D] = []
var _rings: Array[MeshInstance3D] = []
var _sparks_light: Array[CPUParticles3D] = []
var _sparks_heavy: Array[CPUParticles3D] = []
var _next_slash: int = 0
var _next_ring: int = 0
var _next_light: int = 0
var _next_heavy: int = 0
var _live: Array[Dictionary] = []


func _ready() -> void:
	_slash_mesh = _arc_mesh(0.55, 1.9, 150.0, 18, true)
	_ring_mesh = _arc_mesh(0.86, 1.0, 360.0, 40, false)
	_disc_mesh = _arc_mesh(0.0, 1.0, 360.0, 32, false)
	for i in 6:
		_slashes.append(_make_mi(_slash_mesh))
	for i in 6:
		_rings.append(_make_mi(_ring_mesh))
	for i in 4:
		_sparks_light.append(_make_sparks(SPARKS_LIGHT))
		_sparks_heavy.append(_make_sparks(SPARKS_HEAVY))


static func _additive(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.vertex_color_use_as_albedo = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_receive_shadows = true
	m.albedo_color = c
	return m


func _make_mi(mesh: Mesh) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _additive(Color.WHITE)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	add_child(mi)
	return mi


func _make_sparks(n: int) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = n
	p.lifetime = 0.35
	p.explosiveness = 1.0
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = 180.0
	p.initial_velocity_min = 3.0
	p.initial_velocity_max = 7.5
	p.gravity = Vector3(0.0, -12.0, 0.0)
	p.damping_min = 2.0
	p.damping_max = 4.0
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.2
	var q := QuadMesh.new()
	q.size = Vector2(0.09, 0.09)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.vertex_color_use_as_albedo = true
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	q.material = m
	p.mesh = q
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	p.color_ramp = g
	add_child(p)
	return p


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
		oa.append(lerpf(0.35, 1.0, u) if taper else 1.0)   # the leading edge of a swing is brightest
	for i in seg:
		var c0 := Color(1, 1, 1, oa[i])
		var c1 := Color(1, 1, 1, oa[i + 1])
		var ci := Color(1, 1, 1, 0.0 if taper else 0.5)
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


## A swing crescent at a fighter's chest height, facing yaw. Returns the node (for latency checks).
func slash(at: Vector3, yaw: float, tint: Color, size: float, tilt: float) -> MeshInstance3D:
	var mi: MeshInstance3D = _slashes[_next_slash]
	_next_slash = (_next_slash + 1) % _slashes.size()
	mi.position = at
	mi.basis = Basis(Vector3.UP, yaw) * Basis(Vector3(0, 0, 1), tilt)
	mi.scale = Vector3.ONE * size * 0.85
	(mi.material_override as StandardMaterial3D).albedo_color = tint
	mi.visible = true
	_start(mi, SLASH_LIFE, "slash", size, tint)
	return mi


## An expanding ground ring (whirl shockwave).
func ring(at: Vector3, radius: float, tint: Color, life: float = RING_LIFE) -> void:
	var mi: MeshInstance3D = _rings[_next_ring]
	_next_ring = (_next_ring + 1) % _rings.size()
	mi.mesh = _ring_mesh
	mi.position = at + Vector3(0, 0.06, 0)
	mi.basis = Basis.IDENTITY
	mi.scale = Vector3.ONE * radius * 0.3
	(mi.material_override as StandardMaterial3D).albedo_color = tint
	mi.visible = true
	_start(mi, life, "ring", radius, tint)


## A filling red disc on the ground while a strike winds up.
func telegraph(at: Vector3, radius: float, life: float) -> MeshInstance3D:
	var mi: MeshInstance3D = _rings[_next_ring]
	_next_ring = (_next_ring + 1) % _rings.size()
	mi.mesh = _disc_mesh
	mi.position = at + Vector3(0, 0.05, 0)
	mi.basis = Basis.IDENTITY
	mi.scale = Vector3.ONE * radius * 0.2
	var tint := Color(1.0, 0.18, 0.12, 0.45)
	(mi.material_override as StandardMaterial3D).albedo_color = tint
	mi.visible = true
	_start(mi, life, "tele", radius, tint)
	return mi


func sparks(at: Vector3, tint: Color, heavy: bool) -> void:
	var p: CPUParticles3D
	if heavy:
		p = _sparks_heavy[_next_heavy]
		_next_heavy = (_next_heavy + 1) % _sparks_heavy.size()
	else:
		p = _sparks_light[_next_light]
		_next_light = (_next_light + 1) % _sparks_light.size()
	p.position = at
	p.color = tint
	p.restart()
	p.emitting = true


func _start(mi: MeshInstance3D, life: float, kind: String, size: float, tint: Color) -> void:
	for d: Dictionary in _live:
		if d["node"] == mi:
			_live.erase(d)
			break
	_live.append({"node": mi, "t": 0.0, "life": life, "kind": kind, "size": size, "tint": tint})


func _process(dt: float) -> void:
	var i: int = _live.size() - 1
	while i >= 0:
		var d: Dictionary = _live[i]
		var t: float = float(d["t"]) + dt
		d["t"] = t
		var life: float = d["life"]
		var mi: MeshInstance3D = d["node"]
		var k: float = t / life
		if k >= 1.0:
			mi.visible = false
			_live.remove_at(i)
			i -= 1
			continue
		var tint: Color = d["tint"]
		var size: float = d["size"]
		var mat := mi.material_override as StandardMaterial3D
		match d["kind"]:
			"slash":
				mi.scale = Vector3.ONE * size * lerpf(0.85, 1.15, ease(k, 0.5))
				mat.albedo_color = Color(tint.r, tint.g, tint.b, tint.a * (1.0 - ease(k, 1.8)))
			"ring":
				mi.scale = Vector3.ONE * size * lerpf(0.3, 1.0, ease(k, 0.4))
				mat.albedo_color = Color(tint.r, tint.g, tint.b, tint.a * (1.0 - k))
			"tele":
				mi.scale = Vector3.ONE * size * lerpf(0.2, 1.0, k)
				mat.albedo_color = Color(tint.r, tint.g, tint.b, tint.a * (0.6 + 0.4 * k))
		i -= 1
