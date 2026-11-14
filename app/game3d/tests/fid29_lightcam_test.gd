extends SceneTree
## fid29-lightcam (docs/game3d/fid29/lightcam.md): light, sky, anti-aliasing, framing and the cinematic beats.
##   godot --headless --path app/game3d -s res://tests/fid29_lightcam_test.gd
## 1. TIER_LOOK: fid_lightcam on mid and high (aa: msaa2 on mid, msaa4 on high), never on low (low stays {}).
## 2. The sky maps: golden, day and dusk at 2048 x 1024 (high) and 1024 x 512 (mid), imported VRAM-compressed with
##    high quality (ASTC 4x4 on phones: Godot's ETC2 flattens the dither, tools/look/sky_runs.gd) and no mipmaps;
##    sky.json has each map's sun heading and its longest flat run (<= 24 px).
## 3. Presentation only: fight.gd's lightcam section calls no randf, randi, randomize or RandomNumberGenerator; the
##    hand-held drift is a pure function of the frame clock (the same clock, the same value, within -1..1) and the
##    push-in rises 0 -> about 0.9 by the end of the beat without overshoot.
## 4. ShaderWarm: in a live fight on mid (the street, the faction heroes), at the hero's intro beat, the shader of every
##    ShaderMaterial in the fight's tree was drawn by the warm-up under the loading card. On low nothing is drawn.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const ArenaScript := preload("res://arena.gd")
const FightScript := preload("res://fight.gd")
const ShaderWarm := preload("res://shader_warm.gd")

var _fails: int = 0
var _phase: int = 0
var _frames: int = 0
var _fight: Node = null
var _tier: String = "mid"
var _prev: Node = null


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	# 1. the tiers
	_check("low_tier_empty", (ArenaScript.TIER_LOOK["low"] as Dictionary).is_empty())
	var low: Dictionary = ArenaScript.look_opts({"look": {"time": "golden"}})
	var mid: Dictionary = ArenaScript.look_opts({"tier": "mid", "look": {"time": "golden"}})
	var high: Dictionary = ArenaScript.look_opts({"tier": "high", "look": {"time": "golden"}})
	_check("lightcam_mid_high_only", bool(mid.get("fid_lightcam", false)) and bool(high.get("fid_lightcam", false)) and not low.has("fid_lightcam"))
	_check("aa_per_tier", str(mid.get("aa", "")) == "msaa2" and str(high.get("aa", "")) == "msaa4" and not low.has("aa"))
	# 2. the sky maps
	var meta: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://art/sky/sky.json"))
	var sky_ok: bool = meta is Dictionary
	var why: String = ""
	for t: String in ["golden", "day", "dusk"]:
		for s: Array in [["hi", 2048, 1024], ["mid", 1024, 512]]:
			var p: String = "res://art/sky/%s_%s.png" % [t, s[0]]
			var im := Image.load_from_file(ProjectSettings.globalize_path(p))
			if im == null or im.get_width() != int(s[1]) or im.get_height() != int(s[2]):
				sky_ok = false
				why += " size:" + p
			var imp: String = FileAccess.get_file_as_string(p + ".import")
			if not (imp.contains("compress/mode=2") and imp.contains("compress/high_quality=true") and imp.contains("mipmaps/generate=false")):
				sky_ok = false
				why += " import:" + p
			if meta is Dictionary:
				var m: Dictionary = (meta as Dictionary).get(t, {})
				if not m.has("u_sun") or int(m.get("longest_flat_run_" + str(s[0]), 999)) > 24:
					sky_ok = false
					why += " meta:" + t
	_check("sky_maps", sky_ok, why)
	# 3. presentation only
	var src: String = FileAccess.get_file_as_string("res://fight.gd")
	var a: int = src.find("## ---- fid29-lightcam")
	var b: int = src.find("## env-fixes 4:", a)
	var sec: String = src.substr(a, b - a) if a >= 0 and b > a else ""
	var rng_free: bool = sec != ""
	for w: String in ["randf", "randi", "randomize", "RandomNumberGenerator", "_rng"]:
		if sec.contains(w):
			rng_free = false
	_check("lightcam_no_rng", rng_free, "section %d..%d" % [a, b])
	var f: Node = FightScript.new()
	var same: bool = true
	var bounded: bool = true
	for i in 200:
		var t: float = i * 0.137
		var v: float = f.call("_lc_noise", t, 1)
		if v != float(f.call("_lc_noise", t, 1)):
			same = false
		if absf(v) > 1.0001:
			bounded = false
	_check("handheld_pure_and_bounded", same and bounded)
	var prev: float = -1.0
	var mono: bool = float(f.call("_lc_push", 0.0)) == 0.0
	for i in 60:
		var v: float = f.call("_lc_push", i * 0.05)
		if v < prev or v > 1.0:
			mono = false
		prev = v
	var end_v: float = f.call("_lc_push", FightScript.BEAT_LEN - FightScript.LC_LENS_S)
	_check("push_in_damped", mono and end_v > 0.85, "end=%.3f" % end_v)
	f.free()
	# 4. a live fight
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	_start("mid")


func _start(tier: String) -> void:
	_tier = tier
	_frames = 0
	_fight = null
	var cfg: Dictionary = {"mode": "full", "duration_s": 45, "autoplay": true, "seed": 239, "load_thread": false, "place_thread": false,
		"quality": "device", "dyn_res": false, "music": false, "sound": false, "tier": tier, "hero_cast": true, "faction": "icons",
		"intro": true, "look": {"time": "golden"}}
	(func() -> void:
		root.get_node("Bridge").call("start_fight", JSON.stringify(cfg))).call_deferred()


func _process(_dt: float) -> bool:
	_frames += 1
	var b: Node = root.get_node_or_null("Bridge")
	if b == null:
		return false
	var fi: Node = b.get("_fight")
	if fi == null or not is_instance_valid(fi) or fi == _prev:
		if _frames > 3000:
			_check("fight_started_" + _tier, false)
			return _done()
		return false
	if _tier == "mid":
		if str(fi.get("state")) == "intro" and float(fi.get("_beat_t")) > 0.3:
			var mats: Array[Material] = []
			ShaderWarm.collect(fi, mats)
			var warmed: Dictionary = {}
			for m: Material in ShaderWarm.warmed:
				if m is ShaderMaterial and (m as ShaderMaterial).shader != null:
					warmed[(m as ShaderMaterial).shader] = true
			var n: int = 0
			var miss: PackedStringArray = []
			for m: Material in mats:
				if m is ShaderMaterial and (m as ShaderMaterial).shader != null:
					n += 1
					if not warmed.has((m as ShaderMaterial).shader):
						miss.append(str((m as ShaderMaterial).shader.resource_path))
			_check("shader_warm_covers_intro", n > 0 and miss.is_empty() and int(ShaderWarm.last.get("drawn", 0)) > 0,
				"shader materials=%d missed=%s last=%s" % [n, str(miss.slice(0, 6)), str(ShaderWarm.last)])
			print("CQ lightcam_test intro shader materials=%d warmed=%s" % [n, str(ShaderWarm.last)])
			_prev = fi
			_start("low")    # the bridge restarts the fight
			return false
	elif str(fi.get("state")) == "fighting" or str(fi.get("state")) == "intro":
		_check("low_draws_no_warmup", int(ShaderWarm.last.get("drawn", -1)) == 0 and ShaderWarm.warmed.is_empty(), str(ShaderWarm.last))
		return _done()
	if _frames > 6000:
		_check("reached_intro_" + _tier, false, "state=%s" % str(fi.get("state")))
		return _done()
	return false


func _done() -> bool:
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
	return true
