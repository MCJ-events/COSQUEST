extends Node
## Autoload "Bridge" (/root/Bridge): the React Native <-> Godot fight contract.
##   start_fight(config_json: String) -> void     start or restart a fight
##   set_result_callback(cb: Callable) -> void    cb.call(result_json) when a fight ends
##   get_status() -> String                       {state, t_left, hero_hp, enemy_hp, fps}
##   end_fight() -> void                          abort, outcome "quit"
##   signal fight_finished(result_json: String)
## Every event is printed with a "CQ " prefix (Android logcat tag "godot").
## User args (after "--"): --autotest, --config=<json file path>.

signal fight_finished(result_json: String)

const FightScript := preload("res://fight.gd")
const TEST_PACKS: String = "/opt/cq/tasks/056-game-forge-in-world-v2/out/packs/"

var _cb: Callable = Callable()
var _fight: FightScript
var _started: bool = false
var _autotest: bool = false
var _config_path: String = ""
var _fights_started: int = 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var args: PackedStringArray = OS.get_cmdline_user_args()
	for a: String in args:
		if a == "--autotest":
			_autotest = true
		elif a.begins_with("--config="):
			_config_path = a.substr(9)
	var headless: bool = DisplayServer.get_name() == "headless"
	if headless:
		Engine.max_fps = 60   # headless has no vsync: keep the box quiet and the timing phone-like
	_log("bridge ready godot=%s display=%s renderer=%s args=%s" % [
		Engine.get_version_info().get("string", "?"), DisplayServer.get_name(),
		str(ProjectSettings.get_setting("rendering/renderer/rendering_method", "?")), str(args)])
	if _config_path != "":
		_start_from_file.call_deferred(_config_path)
	get_tree().create_timer(1.5).timeout.connect(_on_startup_timeout)
	if _autotest:
		get_tree().create_timer(300.0).timeout.connect(_on_watchdog)


func _on_watchdog() -> void:
	print("CQRESULT " + JSON.stringify({"outcome": "error", "reason": "autotest watchdog 300 s", "status": get_status()}))
	get_tree().quit(1)


func _log(s: String) -> void:
	print("CQ " + s)


func _start_from_file(path: String) -> void:
	var p: String = path
	if p.begins_with("file://"):
		p = p.substr(7).uri_decode()
	var txt: String = FileAccess.get_file_as_string(p)
	if txt == "":
		_log("config_file_error path=%s err=%d" % [p, FileAccess.get_open_error()])
		return
	_log("config_file path=%s" % p)
	start_fight(txt)


func _on_startup_timeout() -> void:
	if _started or not _autotest:
		return
	_log("autotest: no start_fight within 1.5 s, starting the test fight")
	start_fight(JSON.stringify({
		"hero_glb": TEST_PACKS + "armstrong/armstrong__lod1.glb",
		"ally_glb": TEST_PACKS + "knight_woman/knight_woman__lod1.glb",
		"enemy_glb": TEST_PACKS + "old_samurai/old_samurai__lod1.glb",
		"point_name": "Autotest Plaza",
		"autoplay": true,
		"seed": 61,
	}))


# ------------------------------------------------------------ public API

func start_fight(config_json: String) -> void:
	_started = true
	var cfg: Dictionary = {}
	if config_json.strip_edges() != "":
		var j := JSON.new()
		if j.parse(config_json) == OK and j.data is Dictionary:
			cfg = j.data
		else:
			_log("start_fight bad_json line=%d msg=%s, using defaults" % [j.get_error_line(), j.get_error_message()])
	if _autotest and not cfg.has("autoplay"):
		cfg["autoplay"] = true
	if _fight != null and is_instance_valid(_fight):
		_log("restart previous_state=%s" % _fight.state)
		_fight.finished.disconnect(_on_finished)
		_fight.get_parent().remove_child(_fight)
		_fight.queue_free()
		_fight = null
	_fights_started += 1
	_fight = FightScript.new()
	_fight.name = "Fight%d" % _fights_started
	_fight.configure(cfg)
	_fight.finished.connect(_on_finished)
	var parent: Node = get_tree().current_scene
	if parent == null:
		parent = get_tree().root
	parent.add_child(_fight)
	_log("start_fight n=%d mode=%s keys=%s" % [_fights_started, _fight.mode, str(cfg.keys())])


func set_result_callback(cb: Callable) -> void:
	_cb = cb
	_log("result_callback set valid=%s" % cb.is_valid())


func get_status() -> String:
	if _fight == null or not is_instance_valid(_fight):
		return JSON.stringify({"state": "idle", "t_left": 0.0, "hero_hp": 0, "enemy_hp": 0, "fps": Engine.get_frames_per_second()})
	return JSON.stringify(_fight.status())


func end_fight() -> void:
	if _fight == null or not is_instance_valid(_fight):
		_log("end_fight ignored (no fight)")
		return
	_log("end_fight state=%s" % _fight.state)
	_fight.abort()


# ------------------------------------------------------------ result

func _on_finished(result: Dictionary) -> void:
	var json: String = JSON.stringify(result)
	_log("result " + json)
	fight_finished.emit(json)
	if _cb.is_valid():
		_cb.call(json)
	if _autotest:
		print("CQRESULT " + json)
		get_tree().quit.call_deferred(0)
