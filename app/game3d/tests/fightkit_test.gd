extends SceneTree
## build 28 (13 Nov 2026): a Forge character's fight kit registered at run time (anim_library.gd
## register_kit, config "<role>_anim"), and every way a kit falls back to how the fighter played
## before (no library: the model's own clips or the procedural pose).
##   godot --headless --path app/game3d -s res://tests/fightkit_test.gd
## The kit is made here from a character the pck ships (Armstrong's library and model, written to
## user://), so the test needs no download.
## 1. A good kit registers, and binds to the skeleton it was made for (key_for).
## 2. The same kit on another character's skeleton is refused (key_for ""), so it never deforms a
##    model it does not fit.
## 3. Version 2, a missing anim.glb, no fingerprint, bad JSON: refused at registration.
## 4. A kit whose key is a pck character's takes its own key; the pck's entry is untouched.
## 5. The library loads from the kit's file and carries the clips its picks name.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const AnimLib := preload("res://anim_library.gd")
const LoaderScript := preload("res://char_loader.gd")

var _fails: int = 0
var _roots: Array[Node] = []


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _kit(dir: String, key: String, v: int = 1, with_glb: bool = true, fp: bool = true, raw: String = "") -> String:
	var abs: String = ProjectSettings.globalize_path("user://fightkit_test/" + dir)
	DirAccess.make_dir_recursive_absolute(abs)
	var ch: Dictionary = (AnimLib.data()["characters"]["armstrong"] as Dictionary).duplicate(true)
	if not fp:
		ch.erase("fingerprint")
	var j: Dictionary = {"v": v, "key": key, "character": ch, "clips": {}, "clip_grips": {}}
	var f := FileAccess.open(abs.path_join("anim.json"), FileAccess.WRITE)
	f.store_string(raw if raw != "" else JSON.stringify(j))
	f.close()
	if with_glb:
		var g := FileAccess.open(abs.path_join("anim.glb"), FileAccess.WRITE)
		g.store_buffer(FileAccess.get_file_as_bytes("res://anim/armstrong.glb"))
		g.close()
	else:
		DirAccess.remove_absolute(abs.path_join("anim.glb"))
	return abs.path_join("anim.json")


func _skeleton(res_glb: String) -> Skeleton3D:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("user://fightkit_test"))
	var abs: String = ProjectSettings.globalize_path("user://fightkit_test/" + res_glb.get_file())
	var f := FileAccess.open(abs, FileAccess.WRITE)
	f.store_buffer(FileAccess.get_file_as_bytes(res_glb))
	f.close()
	var r: Dictionary = LoaderScript.new().load_glb(abs)
	if not bool(r.get("ok", false)):
		return null
	_roots.append(r["node"] as Node)
	var sk: Array[Node] = (r["node"] as Node).find_children("*", "Skeleton3D", true, false)
	return sk[0] as Skeleton3D if sk.size() > 0 else null


func _initialize() -> void:
	var arm: Skeleton3D = _skeleton("res://cast/armstrong_lod1.glb")
	var bobo: Skeleton3D = _skeleton("res://cast/bobo_lod1.glb")
	_check("models_load", arm != null and bobo != null)
	# 1. a good kit
	var key: String = AnimLib.register_kit(_kit("good", "fk_test_good"))
	_check("kit_registers", key == "fk_test_good", key)
	var ch: Dictionary = AnimLib.data()["characters"].get(key, {})
	_check("kit_marked", bool(ch.get("sidecar", false)) and str(ch.get("sidecar_how", "")) == "kit" and str(ch.get("library", "")).ends_with("/good/anim.glb"))
	_check("kit_binds_own_skeleton", AnimLib.key_for(arm, key) == key)
	# 2. another skeleton
	_check("kit_refused_on_other_skeleton", AnimLib.key_for(bobo, key) == "")
	_check("kit_refused_without_skeleton", AnimLib.key_for(null, key) == "")
	# 3. refused at registration
	_check("v2_refused", AnimLib.register_kit(_kit("v2", "fk_test_v2", 2)) == "")
	_check("no_glb_refused", AnimLib.register_kit(_kit("noglb", "fk_test_noglb", 1, false)) == "")
	_check("no_fingerprint_refused", AnimLib.register_kit(_kit("nofp", "fk_test_nofp", 1, true, false)) == "")
	_check("bad_json_refused", AnimLib.register_kit(_kit("badjson", "fk_test_bad", 1, true, true, "{not json")) == "")
	_check("res_path_refused", AnimLib.register_kit("res://data/anim_clips.json") == "")
	_check("not_a_json_path_refused", AnimLib.register_kit(ProjectSettings.globalize_path("user://fightkit_test/good/anim.glb")) == "")
	# 4. a pck key is never replaced
	var before: String = str(AnimLib.data()["characters"]["armstrong"].get("library", ""))
	var k2: String = AnimLib.register_kit(_kit("clash", "armstrong"))
	_check("pck_key_kept", k2 == "armstrong_kit" and str(AnimLib.data()["characters"]["armstrong"].get("library", "")) == before, k2)
	# 5. the library itself
	var lib: AnimationLibrary = AnimLib.library(key)
	_check("library_loads", lib != null and lib.get_animation_list().size() > 10, str(lib.get_animation_list().size() if lib else -1))
	var st: Dictionary = AnimLib.states_for("sword", key)
	var missing: Array = []
	for s: String in st:
		if lib == null or not lib.has_animation(StringName(str(st[s]["clip"]))):
			missing.append(s)
	_check("picks_in_library", st.size() > 8 and missing.is_empty(), "states %d missing %s" % [st.size(), str(missing)])
	for n: Node in _roots:
		n.free()
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
