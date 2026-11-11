extends RefCounted
## Loads a Forge character GLB at runtime with GLTFDocument + GLTFState.
## load_glb() is safe to run on a worker Thread: nothing it builds is in the tree yet.


static func clean_path(p: String) -> String:
	var s: String = p.strip_edges()
	if s.begins_with("file://"):
		s = s.substr(7).uri_decode()
	return s


## The cast rigs fixed by cq 014 and the cast look pass of cq 239 (all 8): when `path` is one
## of the exact files cq 060 published to the Forge catalogue (matched by sha256, so any newer
## version of the character is left alone), the game loads the same model with the fixed
## skeleton and weights (cq 014) and the new textures and normals (cq 239) from res://cast/
## instead (data/rig_fixes.json, written by tools/rig/ship.py then tools/look/ship_look.py;
## the meshes, UVs and skins are byte-identical). Returns the path to load and the fix's key.
const RIG_FIXES_JSON: String = "res://data/rig_fixes.json"
static var _fixes: Dictionary = {}


static func rig_fix(path: String) -> Array:
	if _fixes.is_empty() and FileAccess.file_exists(RIG_FIXES_JSON):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(RIG_FIXES_JSON))
		_fixes = (d as Dictionary).get("files", {}) if d is Dictionary else {}
		if _fixes.is_empty():
			_fixes = {"_none": true}
	if path == "" or path.begins_with("res://") or not FileAccess.file_exists(path):
		return [path, ""]
	var sha: String = FileAccess.get_sha256(path)
	var f: Variant = _fixes.get(sha)
	if f is Dictionary and FileAccess.file_exists(str((f as Dictionary).get("glb", ""))):
		return [str(f["glb"]), str(f.get("key", ""))]
	return [path, ""]


## Returns {ok, node, parse_ms, gen_ms, error, path}.
## realism: `real` (the "real" look, mid and high tier) also builds tangents for the normal map and reads
## the Forge skin mask that sits beside the file (lodN_skin.png, named in the material's extras.forge_skin):
## out.skin_mask (a Texture2D, or absent). Without it the load is exactly as before.
func load_glb(path: String, real: bool = false) -> Dictionary:
	var out: Dictionary = {"ok": false, "node": null, "parse_ms": 0.0, "gen_ms": 0.0, "error": "", "path": path}
	if path == "":
		out["error"] = "empty path"
		return out
	if not FileAccess.file_exists(path):
		out["error"] = "missing file"
		return out
	var t0: int = Time.get_ticks_usec()
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err: Error
	if path.begins_with("res://"):
		# a rig shipped in the pck (cq 014): read as bytes, as anim_library.gd does
		err = doc.append_from_buffer(FileAccess.get_file_as_bytes(path), "", state, GEN_TANGENTS if real else 0)
	else:
		err = doc.append_from_file(path, state, GEN_TANGENTS if real else 0)
	var t1: int = Time.get_ticks_usec()
	out["parse_ms"] = (t1 - t0) / 1000.0
	if err != OK:
		out["error"] = "append_from_file error %d" % err
		return out
	var node: Node = doc.generate_scene(state)
	out["gen_ms"] = (Time.get_ticks_usec() - t1) / 1000.0
	if node == null or not (node is Node3D):
		if node != null:
			node.free()
		out["error"] = "generate_scene returned no Node3D"
		return out
	var t2: int = Time.get_ticks_usec()
	out["mip_textures"] = add_mipmaps(node)
	out["mip_ms"] = (Time.get_ticks_usec() - t2) / 1000.0
	if real:
		var mask: Texture2D = skin_mask(path, state)
		if mask != null:
			out["skin_mask"] = mask
	out["node"] = node
	out["ok"] = true
	return out


const GEN_TANGENTS: int = 8    # EditorSceneFormatImporter.IMPORT_GENERATE_TANGENT_ARRAYS (not named in export builds)


## The Forge skin mask of a character file: the PNG the material's extras name (forge_skin.mask_file), else
## "<file>_skin.png", beside the GLB. Red = skin, in the model's UVs. null when there is none.
static func skin_mask(path: String, state: GLTFState) -> Texture2D:
	if path.begins_with("res://"):
		return null
	var names: Array[String] = []
	var mats: Variant = state.json.get("materials", [])
	if mats is Array:
		for m: Variant in mats:
			var ex: Variant = (m as Dictionary).get("extras", {}) if m is Dictionary else {}
			var fs: Variant = (ex as Dictionary).get("forge_skin", {}) if ex is Dictionary else {}
			if fs is Dictionary and str((fs as Dictionary).get("mask_file", "")) != "":
				names.append(str(fs["mask_file"]).get_file())
	names.append(path.get_file().get_basename() + "_skin.png")
	for nm: String in names:
		var p: String = path.get_base_dir().path_join(nm)
		if not FileAccess.file_exists(p):
			continue
		var img := Image.new()
		if img.load(p) != OK:
			continue
		img.convert(Image.FORMAT_R8)
		img.generate_mipmaps()
		return ImageTexture.create_from_image(img)
	return null


## GLTFDocument's runtime load gives the embedded textures no mipmaps, so at the fight camera
## (a character ~60 px tall) every screen pixel samples one texel of the many-island atlas
## and the character sparkles with noise (cq 239). Builds the mip chain once, at load, for
## every texture of the model's materials. Returns how many textures got mipmaps.
static func add_mipmaps(model: Node) -> int:
	var done: Dictionary = {}
	for n: Node in model.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = (n as MeshInstance3D).mesh
		if mesh == null:
			continue
		for s: int in mesh.get_surface_count():
			var m := mesh.surface_get_material(s) as BaseMaterial3D
			if m == null:
				continue
			for p: int in [BaseMaterial3D.TEXTURE_ALBEDO, BaseMaterial3D.TEXTURE_METALLIC,
					BaseMaterial3D.TEXTURE_ROUGHNESS, BaseMaterial3D.TEXTURE_NORMAL,
					BaseMaterial3D.TEXTURE_EMISSION, BaseMaterial3D.TEXTURE_AMBIENT_OCCLUSION]:
				var t := m.get_texture(p) as ImageTexture
				if t == null:
					continue
				if done.has(t):
					continue
				done[t] = true
				var img: Image = t.get_image()
				if img == null or img.has_mipmaps() or img.is_compressed():
					continue
				img.generate_mipmaps()
				t.set_image(img)
	return done.size()
