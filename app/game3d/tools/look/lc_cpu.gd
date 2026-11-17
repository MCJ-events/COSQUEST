extends SceneTree
## fid29-lightcam (C4): the CPU cost of fight.gd _lightcam_update per frame, 3 fighters (hero, ally, Guardian).
##   godot --headless --path app/game3d -s res://tools/look/lc_cpu.gd -- [--tier=high]
## In a live fight, each frame it calls _lightcam_update(0.0) a further 20 times (dt 0: no state moves) and times them
## with Time.get_ticks_usec(), in the intro beat (close shot: materials walked, shadow and exposure set) and mid-fight.
## Prints "CQCPU <phase> frames=N mean_us=.. max_us=.." per phase.

var _tier: String = "high"
var _frames: int = 0
var _acc: Dictionary = {}


func _initialize() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--tier="):
			_tier = a.substr(7)
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	var cfg: Dictionary = {"mode": "full", "duration_s": 45, "autoplay": true, "seed": 239, "load_thread": false, "place_thread": false,
		"quality": "device", "dyn_res": false, "music": false, "sound": false, "tier": _tier, "hero_cast": true, "faction": "icons",
		"intro": true, "look": {"time": "golden"}}
	(func() -> void:
		root.get_node("Bridge").call("start_fight", JSON.stringify(cfg))).call_deferred()


func _process(_dt: float) -> bool:
	_frames += 1
	var b: Node = root.get_node_or_null("Bridge")
	var fi: Node = b.get("_fight") if b != null else null
	if fi == null or not is_instance_valid(fi):
		return _frames > 4000 and _end()
	var st: String = str(fi.get("state"))
	var ph: String = ""
	if st == "intro" and float(fi.get("_beat_t")) > 0.35:
		ph = "intro_beat"
	elif st == "fighting":
		ph = "mid_fight"
	if ph != "":
		var a: Array = _acc.get(ph, [0, 0.0, 0.0])
		var t0: int = Time.get_ticks_usec()
		for i in 20:
			fi.call("_lightcam_update", 0.0)
		var us: float = (Time.get_ticks_usec() - t0) / 20.0
		a[0] += 1
		a[1] += us
		a[2] = maxf(a[2], us)
		_acc[ph] = a
		if ph == "mid_fight" and int(a[0]) >= 120:
			return _end()
	return _frames > 6000 and _end()


func _end() -> bool:
	for k: String in _acc:
		var a: Array = _acc[k]
		print("CQCPU %s tier=%s frames=%d mean_us=%.1f max_us=%.1f" % [k, _tier, a[0], a[1] / maxf(a[0], 1), a[2]])
	print("CQCPU done")
	quit()
	return true
