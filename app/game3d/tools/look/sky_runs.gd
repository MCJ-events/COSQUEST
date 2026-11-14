extends SceneTree
## fid29-lightcam: the sky maps' longest flat 8-bit run after VRAM compression (the gate: none longer than 24 px in the
## upper sky). The sky imports with compress/high_quality: ASTC 4x4 on phones (the gate), BPTC on desktops; ETC2 and S3TC
## are printed for reference (Godot's fast ETC2 flattens the dither into runs of hundreds of pixels: why the sky is ASTC).
##   godot --headless --path app/game3d -s res://tools/look/sky_runs.gd
## Prints "CQSKY <map> <codec> longest=<px>" and "CQSKY worst=<px>" (ASTC).


func _runs(im: Image) -> int:
	var w: int = im.get_width()
	var h: int = im.get_height() / 2 - 4
	var d: PackedByteArray = im.get_data()
	var best: int = 0
	for y in h:
		var run: int = 1
		var o: int = y * w * 3
		for x in range(1, w):
			var a: int = o + x * 3
			if d[a] == d[a - 3] and d[a + 1] == d[a - 2] and d[a + 2] == d[a - 1]:
				run += 1
				best = maxi(best, run)
			else:
				run = 1
	return best


func _initialize() -> void:
	var worst: int = 0
	for t: String in ["golden", "day", "dusk"]:
		for s: String in ["hi", "mid"]:
			var src := Image.load_from_file(ProjectSettings.globalize_path("res://art/sky/%s_%s.png" % [t, s]))
			if src == null:
				print("CQSKY %s_%s missing" % [t, s])
				worst = 9999
				continue
			src.convert(Image.FORMAT_RGB8)
			for codec: Array in [["etc2", Image.COMPRESS_ETC2], ["astc", Image.COMPRESS_ASTC], ["bptc", Image.COMPRESS_BPTC], ["s3tc", Image.COMPRESS_S3TC]]:
				var im: Image = src.duplicate()
				im.compress(codec[1], Image.COMPRESS_SOURCE_SRGB)
				im.decompress()
				im.convert(Image.FORMAT_RGB8)
				var r: int = _runs(im)
				if codec[0] == "astc":
					worst = maxi(worst, r)    # the gate: the phones read the sky as ASTC 4x4 (compress/high_quality)
				print("CQSKY %s_%s %s longest=%d" % [t, s, codec[0], r])
	print("CQSKY worst=%d" % worst)
	quit(0)
