extends RefCounted
## The "real" look's baked data (realism 11 Nov 2026, docs/game3d/LOOK.md "The real look"):
##  - per time of day, a small prefiltered cube of the street (what a fighter standing on the medallion
##    sees round it) and six ambient colours measured from it (vfx/char_real.gdshader);
##  - the colour grade's 3D tables: one base grade, and one per faction on top of it.
## All of it lives in data/look_real.json (PNG bytes as base64: data/*.json is exported as it is, so
## nothing depends on how a texture was imported). Written by tools/look/bake_env.py and bake_lut.py from
## captures of the street itself (tools/look/env_capture.gd). Nothing here is read on the low tier.

const DATA_JSON: String = "res://data/look_real.json"
static var _doc: Dictionary = {}
static var _env: Dictionary = {}    # time -> {cube, amb, scale, lods}
static var _lut: Dictionary = {}    # name -> ImageTexture3D
static var lc: bool = false         # fid29-lightcam: arena.gd sets it from the look ("fid_lightcam")


static func doc() -> Dictionary:
	if _doc.is_empty():
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(DATA_JSON)) if FileAccess.file_exists(DATA_JSON) else null
		_doc = d if d is Dictionary else {"env": {}, "lut": {}}
	return _doc


static func _png(b64: String) -> Image:
	var img := Image.new()
	if img.load_png_from_buffer(Marshalls.base64_to_raw(b64)) != OK:
		return null
	return img


## The street's light at `time` ("golden" | "day" | "dusk" | "night"): {cube: Cubemap (sqrt-encoded
## radiance / scale, mip = roughness), amb: PackedVector3Array (6), scale, lods}. Empty when not baked.
static func env_for(time: String) -> Dictionary:
	# fid29-lightcam: with the lightcam look (arena.gd sets `lc`), the cubes re-baked under the real sky ("env_lc"),
	# when there are; otherwise build 28's
	var group: String = "env_lc" if lc and (doc().get("env_lc", {}) as Dictionary).has(time) else "env"
	var ck: String = group + ":" + time
	if _env.has(ck):
		return _env[ck]
	var out: Dictionary = {}
	var e: Variant = (doc().get(group, {}) as Dictionary).get(time)
	if e is Dictionary:
		var atlas: Image = _png(str((e as Dictionary).get("png", "")))
		var size: int = int((e as Dictionary).get("size", 32))
		if atlas != null and atlas.get_width() >= size * 6:
			atlas.convert(Image.FORMAT_RGB8)
			# the atlas: six faces across (+x -x +y -y +z -z), the mips stacked downwards
			var faces: Array[Image] = []
			for f in 6:
				var bytes := PackedByteArray()
				var y: int = 0
				var s: int = size
				while s >= 1:
					bytes.append_array(atlas.get_region(Rect2i(f * size, y, s, s)).get_data())
					y += s
					s >>= 1
				faces.append(Image.create_from_data(size, size, true, Image.FORMAT_RGB8, bytes))
			var cube := Cubemap.new()
			if cube.create_from_images(faces) == OK:
				var amb := PackedVector3Array()
				for c: Variant in (e as Dictionary).get("amb", []):
					amb.append(Vector3(float(c[0]), float(c[1]), float(c[2])))
				var lods: int = 0
				while (size >> (lods + 1)) >= 1:
					lods += 1
				out = {"cube": cube, "amb": amb, "scale": float((e as Dictionary).get("scale", 4.0)), "lods": float(lods),
					"mean": _face_mean(faces, size)}
	_env[ck] = out
	return out


## A grade table by name ("base", "faction_<id>"): an ImageTexture3D of `size`^3, or null.
static func lut_for(name: String) -> ImageTexture3D:
	if _lut.has(name):
		return _lut[name]
	var out: ImageTexture3D = null
	var e: Variant = (doc().get("lut", {}) as Dictionary).get(name)
	if e is Dictionary:
		var strip: Image = _png(str((e as Dictionary).get("png", "")))
		var n: int = int((e as Dictionary).get("size", 33))
		if strip != null and strip.get_width() == n * n and strip.get_height() == n:
			strip.convert(Image.FORMAT_RGB8)
			var slices: Array[Image] = []
			for b in n:
				slices.append(strip.get_region(Rect2i(b * n, 0, n, n)))
			out = ImageTexture3D.new()
			if out.create(Image.FORMAT_RGB8, n, n, n, false, slices) != OK:
				out = null
	_lut[name] = out
	return out


## ---- fid29-lightcam: a real place's reflections, captured at load (audit L2) ----
## Six 90 degree views from the fight's centre in linear light (the world's environment copied with a linear tonemap at
## CAPTURE_EXPOSURE, no fog, no glow, as tools/look/env_capture.gd), drawn by six small SubViewports in one frame under
## the loading card, read back the frame after, then encoded as env_for's cubes are (sqrt(radiance / 4) in 8 bits, mip =
## roughness: here box-filtered mips in linear light, not the bake's GGX lobes) with six ambient colours (cosine-weighted
## from the 4 px mip, raw as shipped). Costs 6 x 6 views' draws once; capture_step gives up (empty) past the budget.
const CAPTURE_EXPOSURE: float = 0.25
const CAPTURE_SCALE: float = 4.0
const CAPTURE_BUDGET_MS: float = 400.0
const _GL_FACES: Array = [[Vector3(1, 0, 0), Vector3(0, 1, 0)], [Vector3(-1, 0, 0), Vector3(0, 1, 0)], [Vector3(0, 1, 0), Vector3(0, 0, -1)],
	[Vector3(0, -1, 0), Vector3(0, 0, 1)], [Vector3(0, 0, 1), Vector3(0, 1, 0)], [Vector3(0, 0, -1), Vector3(0, 1, 0)]]


static func _gl_dir(face: int, s: float, t: float) -> Vector3:
	match face:
		0: return Vector3(1.0, -t, -s)
		1: return Vector3(-1.0, -t, s)
		2: return Vector3(s, 1.0, t)
		3: return Vector3(s, -1.0, -t)
		4: return Vector3(s, -t, 1.0)
	return Vector3(-s, -t, -1.0)


static func capture_begin(host: Node, at: Vector3, size: int, world_env: Environment) -> Dictionary:
	var cenv: Environment = world_env.duplicate() if world_env != null else Environment.new()
	cenv.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	cenv.tonemap_exposure = CAPTURE_EXPOSURE
	cenv.fog_enabled = false
	cenv.glow_enabled = false
	cenv.adjustment_enabled = false
	var vps: Array = []
	for f in 6:
		var vp := SubViewport.new()
		vp.size = Vector2i(size, size)
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		vp.msaa_3d = Viewport.MSAA_DISABLED
		vp.positional_shadow_atlas_size = 0
		var cam := Camera3D.new()
		cam.fov = 90.0
		cam.near = 0.1
		cam.far = 400.0
		cam.environment = cenv
		vp.add_child(cam)
		host.add_child(vp)
		cam.current = true
		var fu: Array = _GL_FACES[f]
		cam.look_at_from_position(at, at + (fu[0] as Vector3), fu[1] as Vector3)
		vps.append(vp)
	return {"vps": vps, "size": size, "frames": 0, "at": at}


## Empty until the views are drawn (call once a frame), then {cube, amb, scale, lods, mean}.
static func capture_step(job: Dictionary) -> Dictionary:
	job["frames"] = int(job["frames"]) + 1
	if int(job["frames"]) < 2:
		return {}
	var n: int = int(job["size"])
	var shots: Array[Image] = []
	for vp: SubViewport in job["vps"]:
		var im: Image = vp.get_texture().get_image()
		if im == null or im.get_width() != n:
			return {}
		im.convert(Image.FORMAT_RGB8)
		shots.append(im)
	# GL face texels from the shots: each shot looked along its face's axis with its up, so texel (s, t) of the face is
	# the shot's pixel where that direction lands
	var faces_lin: Array[Image] = []
	for f in 6:
		var fwd: Vector3 = (_GL_FACES[f] as Array)[0]
		var up: Vector3 = (_GL_FACES[f] as Array)[1]
		var right: Vector3 = fwd.cross(up)
		var src: Image = shots[f]
		var lin := Image.create(n, n, false, Image.FORMAT_RGBF)
		for y in n:
			for x in n:
				var d: Vector3 = _gl_dir(f, (x + 0.5) / n * 2.0 - 1.0, (y + 0.5) / n * 2.0 - 1.0)
				var dz: float = d.dot(fwd)
				var px: int = clampi(int((d.dot(right) / dz * 0.5 + 0.5) * n), 0, n - 1)
				var py: int = clampi(int((0.5 - d.dot(up) / dz * 0.5) * n), 0, n - 1)
				var c: Color = src.get_pixel(px, py).srgb_to_linear()
				lin.set_pixel(x, y, Color(c.r, c.g, c.b) * (1.0 / CAPTURE_EXPOSURE))
		lin.generate_mipmaps()
		faces_lin.append(lin)
	var faces: Array[Image] = []
	for f in 6:
		var bytes := PackedByteArray()
		var src: Image = faces_lin[f]
		var s: int = n
		var lv: int = 0
		while s >= 1:
			var m: Image = Image.create_from_data(s, s, false, Image.FORMAT_RGBF, src.get_data().slice(src.get_mipmap_offset(lv), src.get_mipmap_offset(lv) + s * s * 12))
			for y in s:
				for x in s:
					var c: Color = m.get_pixel(x, y)
					bytes.append(clampi(int(sqrt(clampf(c.r / CAPTURE_SCALE, 0.0, 1.0)) * 255.0 + 0.5), 0, 255))
					bytes.append(clampi(int(sqrt(clampf(c.g / CAPTURE_SCALE, 0.0, 1.0)) * 255.0 + 0.5), 0, 255))
					bytes.append(clampi(int(sqrt(clampf(c.b / CAPTURE_SCALE, 0.0, 1.0)) * 255.0 + 0.5), 0, 255))
			s >>= 1
			lv += 1
		faces.append(Image.create_from_data(n, n, true, Image.FORMAT_RGB8, bytes))
	var cube := Cubemap.new()
	if cube.create_from_images(faces) != OK:
		return {}
	# six ambient colours: irradiance / pi towards each axis, from the 4 px mip
	var axes: Array[Vector3] = [Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 1, 0), Vector3(0, -1, 0), Vector3(0, 0, 1), Vector3(0, 0, -1)]
	var acc: Array[Vector3] = []
	for i in 6:
		acc.append(Vector3.ZERO)
	var q: int = mini(4, n)
	var lvq: int = 0
	while (n >> lvq) > q:
		lvq += 1
	for f in 6:
		var src: Image = faces_lin[f]
		var m: Image = Image.create_from_data(q, q, false, Image.FORMAT_RGBF, src.get_data().slice(src.get_mipmap_offset(lvq), src.get_mipmap_offset(lvq) + q * q * 12))
		for y in q:
			for x in q:
				var s2: float = (x + 0.5) / q * 2.0 - 1.0
				var t2: float = (y + 0.5) / q * 2.0 - 1.0
				var d: Vector3 = _gl_dir(f, s2, t2)
				var r2: float = d.length_squared()
				var w: float = 1.0 / pow(r2, 1.5)
				d = d / sqrt(r2)
				var c: Color = m.get_pixel(x, y)
				for i in 6:
					var k: float = maxf(d.dot(axes[i]), 0.0) * w
					acc[i] += Vector3(c.r, c.g, c.b) * k
	var amb := PackedVector3Array()
	for i in 6:
		amb.append(acc[i] * (4.0 / float(q * q)) / PI)    # sum of L cos dw over the sphere / pi (bake_env.py --raw)
	var lods: int = 0
	while (n >> (lods + 1)) >= 1:
		lods += 1
	return {"cube": cube, "amb": amb, "scale": CAPTURE_SCALE, "lods": float(lods), "mean": _face_mean(faces, n)}


static func capture_end(job: Dictionary) -> void:
	for vp: SubViewport in job.get("vps", []):
		if is_instance_valid(vp):
			vp.queue_free()


## The mean linear radiance of a cube's sharpest level (for logs: a place's capture against the street's bake).
static func _face_mean(faces: Array[Image], n: int) -> Array:
	var acc := Vector3.ZERO
	var cnt: int = 0
	for im: Image in faces:
		var d: PackedByteArray = im.get_data()
		for i in range(0, n * n * 3, 3):
			var c := Vector3(d[i] / 255.0, d[i + 1] / 255.0, d[i + 2] / 255.0)
			acc += c * c * CAPTURE_SCALE
			cnt += 1
	acc /= maxf(cnt, 1)
	return [snappedf(acc.x, 0.0001), snappedf(acc.y, 0.0001), snappedf(acc.z, 0.0001)]


static func env_mean(time: String) -> Array:
	return env_for(time).get("mean", [])
