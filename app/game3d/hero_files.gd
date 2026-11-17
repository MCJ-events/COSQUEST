extends RefCounted
## fid29 seam (docs/game3d/fid29/COMMON.md), owned by fid29-heromaps: which file a fighter really loads. fight.gd asks
## after the hero cast and the tier's detail level chose one (role "hero", "ally" or "enemy"; look: the arena's look).
##
## The six faction heroes (res://cast/heroes) and the cast Guardians (res://cast) ship a second set of files with
## compressed (KTX2: ASTC / Basis ETC1S inside the GLB), denser, de-lit maps and cleaned geometry:
##   <key>_lod0.glb -> <key>_lod0r.glb   (high tier: the hero and the Guardian)
##   <key>_lod1.glb -> <key>_lod1r.glb   (mid tier, and the ally on high)
## pick() returns the "r" file, for any role, only when
##   1. the look asks for it ("fid_heromaps": true; arena.gd TIER_LOOK sets it on mid and high, never on low), and
##   2. the "r" file is in the pck, and
##   3. this phone samples ASTC natively (GL_KHR_texture_compression_astc_ldr; every iPhone since A8, current Adreno,
##      Mali and PowerVR). Godot has no runtime ASTC decoder fallback that is cheap: an ASTC-less GPU would get every
##      map decoded to RGBA8 on load, heavier than build 28's files. So without ASTC the build 28 file is kept.
## Otherwise the path comes back unchanged, so the low tier (no "fid_heromaps") opens exactly build 28's files, and a
## look with "fid_heromaps": false gives build 28's files on mid and high too.
## Presentation only: the "r" files keep build 28's rig, weights and model bounds (fighter.gd scales by the AABB).

const SUFFIXES: Dictionary = {"_lod0.glb": "_lod0r.glb", "_lod1.glb": "_lod1r.glb"}
const DIRS: Array[String] = ["res://cast/heroes/", "res://cast/"]

## -1 = ask the GPU (default); 0 = act as if ASTC were absent; 1 = act as if present. Tests set it; so may the
## environment variable CQ_HEROMAPS_ASTC ("0" / "1") for the farm's headless measuring runs.
static var force_astc: int = -1
static var _astc: int = -1        # cached answer: 0 / 1


## The file to open for `path` under `look`. Never returns a file that does not exist. `_role` is not read: the ally on
## high keeps the config's detail level (lod1), so it gets lod1r like the mid tier.
static func pick(path: String, _role: String, look: Dictionary) -> String:
	if not bool(look.get("fid_heromaps", false)):
		return path
	var r: String = r_path(path)
	if r == "" or not FileAccess.file_exists(r):
		return path
	if not astc_native():
		return path
	return r


## The "r" sibling of a shipped hero or Guardian file, or "" when `path` is not one.
static func r_path(path: String) -> String:
	var in_dir: bool = false
	for d: String in DIRS:
		if path.begins_with(d) and not path.substr(d.length()).contains("/"):
			in_dir = true
	if not in_dir:
		return ""
	for s: String in SUFFIXES:
		if path.ends_with(s):
			return path.substr(0, path.length() - s.length()) + str(SUFFIXES[s])
	return ""


## Whether this GPU samples ASTC 4x4 / 8x8 LDR blocks as they are.
static func astc_native() -> bool:
	if force_astc >= 0:
		return force_astc == 1
	var env: String = OS.get_environment("CQ_HEROMAPS_ASTC")
	if env == "0" or env == "1":
		return env == "1"
	if _astc < 0:
		_astc = 1 if _probe() else 0
	return _astc == 1


static func _probe() -> bool:
	var rs := RenderingServer
	# The GLES3 and RD renderers answer for every compressed family; the headless (dummy) one answers false to all.
	var reports: bool = false
	for f: String in ["etc2", "s3tc", "bptc", "astc", "etc"]:
		if rs.has_os_feature(f):
			reports = true
	if reports:
		return rs.has_os_feature("astc")
	# No answer from the renderer: upload one 4x4 ASTC block and see whether it stays ASTC on the GPU.
	var block := PackedByteArray()
	block.resize(16)
	block[0] = 0xFC     # a void-extent (constant colour) block: valid in every ASTC decoder
	block[1] = 0xFD
	for i in range(2, 8):
		block[i] = 0xFF
	var img := Image.create_from_data(4, 4, false, Image.FORMAT_ASTC_4x4, block)
	if img == null or img.is_empty():
		return false
	var rid: RID = rs.texture_2d_create(img)
	if not rid.is_valid():
		return false
	var back: Image = rs.texture_2d_get(rid)
	rs.free_rid(rid)
	return back != null and back.get_format() == Image.FORMAT_ASTC_4x4
