extends RefCounted
## fid29 (audit B4, owned by fid29-lightcam; docs/game3d/fid29/COMMON.md): shader warm-up under the loading card.
## The Compatibility renderer compiles a material's shader variant on its first draw, so a material first seen at
## the hero's intro beat (the depth focus, a lane's new street, prop, kit, hair or character variant) hitched there.
## Lanes register the materials they add with ShaderWarm.add(material); fight.gd calls ShaderWarm.warm(fight) once
## the fighters are loaded, before the first frame the player sees (mid and high: warm(null) on low, which only empties
## the registry). warm() adds every material it finds in the fight's tree (geometry overrides, surface overrides, the
## meshes' own surfaces, particle and sky materials) to the registered ones and draws each once on a tiny quad just in
## front of the camera (sub-pixel, behind the loading card), freed two frames later.

static var _mats: Array[Material] = []
static var last: Dictionary = {}           # what the last warm() did (tests, logs)
static var warmed: Array[Material] = []    # the materials the last warm() drew (tests)


## A lane's material, to be drawn once before the fight shows. Null and repeats are ignored.
static func add(m: Material) -> void:
	if m != null and not _mats.has(m):
		_mats.append(m)


static func registered() -> Array[Material]:
	return _mats.duplicate()


static func clear() -> void:
	_mats.clear()


## Every material under `n` (and the next passes of each).
static func collect(n: Node, out: Array[Material]) -> void:
	var stack: Array[Node] = [n]
	while not stack.is_empty():
		var x: Node = stack.pop_back()
		if x is GeometryInstance3D:
			_take((x as GeometryInstance3D).material_override, out)
			_take((x as GeometryInstance3D).material_overlay, out)
		if x is MeshInstance3D:
			var mi := x as MeshInstance3D
			for i in mi.get_surface_override_material_count():
				_take(mi.get_surface_override_material(i), out)
			if mi.mesh != null:
				for i in mi.mesh.get_surface_count():
					_take(mi.mesh.surface_get_material(i), out)
		elif x is MultiMeshInstance3D and (x as MultiMeshInstance3D).multimesh != null and (x as MultiMeshInstance3D).multimesh.mesh != null:
			var mm: Mesh = (x as MultiMeshInstance3D).multimesh.mesh
			for i in mm.get_surface_count():
				_take(mm.surface_get_material(i), out)
		elif x is GPUParticles3D or x is CPUParticles3D:
			_take(x.get("process_material") if x is GPUParticles3D else null, out)
		for c: Node in x.get_children():
			stack.append(c)


static func _take(m: Material, out: Array[Material]) -> void:
	while m != null:
		if not out.has(m):
			out.append(m)
		m = m.next_pass


static func warm(host: Node) -> void:
	var mats: Array[Material] = _mats.duplicate()
	var n_reg: int = _mats.size()
	_mats.clear()
	warmed = []
	last = {"registered": n_reg, "drawn": 0}
	if host == null or not host.is_inside_tree():
		return
	var t0: int = Time.get_ticks_usec()
	collect(host, mats)
	var cam: Camera3D = host.get_viewport().get_camera_3d()
	if cam == null:
		return
	var holder := Node3D.new()
	holder.name = "ShaderWarm"
	cam.add_child(holder)
	var quad := QuadMesh.new()
	quad.size = Vector2(0.0004, 0.0004)
	var drawn: int = 0
	for m: Material in mats:
		if m is ParticleProcessMaterial:
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = quad
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position = Vector3(0.0, 0.0, -(cam.near * 1.02))
		holder.add_child(mi)
		drawn += 1
	warmed = mats
	last = {"registered": n_reg, "drawn": drawn, "found": mats.size(), "ms": (Time.get_ticks_usec() - t0) / 1000.0}
	print("CQ shader_warm registered=%d drawn=%d ms=%.1f" % [n_reg, drawn, float(last["ms"])])
	var tree: SceneTree = host.get_tree()
	var free_later := func() -> void:
		await tree.process_frame
		await tree.process_frame
		if is_instance_valid(holder):
			holder.queue_free()
	free_later.call()
