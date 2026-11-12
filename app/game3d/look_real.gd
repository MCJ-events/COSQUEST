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
	if _env.has(time):
		return _env[time]
	var out: Dictionary = {}
	var e: Variant = (doc().get("env", {}) as Dictionary).get(time)
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
				out = {"cube": cube, "amb": amb, "scale": float((e as Dictionary).get("scale", 4.0)), "lods": float(lods)}
	_env[time] = out
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
