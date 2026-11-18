extends SceneTree
## fid29 charshade: the material-ID masks as a phone samples them. Each mask's ETC2 import (what import_etc2_astc gives
## phones; the desktop's S3TC too) is loaded, decompressed and written as PNG, so tools/char/maskiou.py can measure what
## block compression did to the classes.
##   godot --headless --path app/game3d -s res://tools/char/maskdecode.gd -- --out=/abs/dir
func _initialize() -> void:
	var out: String = "/tmp/cs_maskdecode"
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out = a.substr(6)
	DirAccess.make_dir_recursive_absolute(out)
	var d := DirAccess.open("res://art/char/masks")
	for f: String in d.get_files():
		if not f.ends_with(".png.import"):
			continue
		var cfg := ConfigFile.new()
		cfg.load("res://art/char/masks/" + f)
		var dest: Variant = cfg.get_value("deps", "dest_files", [])
		for p: String in dest:
			var fmt: String = "etc2" if p.contains(".etc2.") else ("s3tc" if p.contains(".s3tc.") else "")
			if fmt == "":
				continue
			var t := CompressedTexture2D.new()
			if t.load(p) != OK:
				print("CQMASK fail ", p)
				continue
			var im: Image = t.get_image()
			var was: String = str(im.get_format())
			if im.is_compressed():
				im.decompress()
			im.convert(Image.FORMAT_RGBA8)
			var name: String = f.trim_suffix(".png.import") + "_" + fmt + ".png"
			im.save_png(out.path_join(name))
			print("CQMASK ", name, " format=", was, " size=", im.get_size())
	quit(0)
