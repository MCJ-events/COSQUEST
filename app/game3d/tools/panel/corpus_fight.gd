extends SceneTree
## One seeded autoplay fight for the game server's fight corpus (costquest-backend tests/fixtures):
##   godot --headless --path app/game3d [--fixed-fps 30] -s res://tools/panel/corpus_fight.gd -- --cfg='{"seed": 1, ...}'
## The config is the fight's own (mode full, autoplay on and load_thread off are filled in). Prints
## "CQSEEDED {result json}" with the whole judge log when the fight ends.

var _done: bool = false


func _initialize() -> void:
	var cfg: Dictionary = {"mode": "full", "duration_s": 45, "autoplay": true, "load_thread": false, "render_scale": 0.5}
	for s: String in OS.get_cmdline_user_args():
		if s.begins_with("--cfg="):
			cfg.merge(JSON.parse_string(s.substr(6)) as Dictionary, true)
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	current_scene = main
	(func() -> void:
		var bridge: Node = root.get_node("Bridge")
		bridge.call("set_result_callback", func(j: String) -> void:
			if not j.contains("\"event\"") and not _done:
				_done = true
				print("CQSEEDED " + j)
				quit.call_deferred(0))
		bridge.call("start_fight", JSON.stringify(cfg))).call_deferred()
