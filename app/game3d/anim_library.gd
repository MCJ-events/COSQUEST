extends RefCounted
## Combat clip libraries for the cast (cq 012). Each rigged cast character has a
## skeleton-only GLB in res://anim/<key>.glb, retargeted offline from KayKit's CC0 clips
## (app/game3d/tools/anim/retarget.py). It is loaded at run time with GLTFDocument (once per
## process, cached) and its animations are added to the character's own AnimationPlayer as the
## library "cq", with every track pointed at that model's Skeleton3D, so any LOD of the
## character plays them. Which clip plays for which combat state, and its contact frame, is
## data: res://data/anim_clips.json (see docs/game3d/ANIMATIONS.md).

const DATA_JSON: String = "res://data/anim_clips.json"
const LIB_NAME: String = "cq"

static var _data: Dictionary = {}
static var _libs: Dictionary = {}     # path -> AnimationLibrary (track paths relative to the skeleton: ".:Bone")


static func data() -> Dictionary:
	if _data.is_empty() and FileAccess.file_exists(DATA_JSON):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(DATA_JSON))
		if d is Dictionary:
			_data = d
	return _data


## The cast key for a skeleton: the config's key when it names a character with a library,
## else the character whose rest skeleton matches (bone names and hip/hand/foot rest
## positions within 2 cm), else "".
static func key_for(skeleton: Skeleton3D, hint: String) -> String:
	var chars: Dictionary = data().get("characters", {})
	if hint != "" and chars.has(hint) and str((chars[hint] as Dictionary).get("status", "")) == "clips":
		return hint
	if skeleton == null:
		return ""
	for k: String in chars:
		var c: Dictionary = chars[k]
		if str(c.get("status", "")) != "clips":
			continue
		var fp: Dictionary = c.get("fingerprint", {})
		var ok: bool = not fp.is_empty()
		for bone: String in fp:
			var b: int = skeleton.find_bone(bone)
			if b < 0:
				ok = false
				break
			var want: Array = fp[bone]
			var got: Vector3 = skeleton.get_bone_global_rest(b).origin
			if got.distance_to(Vector3(want[0], want[1], want[2])) > 0.02:
				ok = false
				break
		if ok:
			return k
	return ""


## Loads (once) the library GLB for `key`. Returns null when there is none.
static func library(key: String) -> AnimationLibrary:
	var c: Dictionary = (data().get("characters", {}) as Dictionary).get(key, {})
	var path: String = str(c.get("library", ""))
	if path == "":
		return null
	if _libs.has(path):
		return _libs[path]
	var t0: int = Time.get_ticks_usec()
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	var err: int = OK
	if path.begins_with("res://"):
		var bytes: PackedByteArray = FileAccess.get_file_as_bytes(path)
		err = doc.append_from_buffer(bytes, "", st) if bytes.size() > 0 else ERR_FILE_NOT_FOUND
	else:
		err = doc.append_from_file(path, st)
	if err != OK:
		push_warning("anim library %s: error %d" % [path, err])
		_libs[path] = null
		return null
	var root: Node = doc.generate_scene(st)
	var lib := AnimationLibrary.new()
	var players: Array[Node] = root.find_children("*", "AnimationPlayer", true, false)
	if players.size() > 0:
		var ap: AnimationPlayer = players[0]
		for n: StringName in ap.get_animation_list():
			var a: Animation = ap.get_animation(n).duplicate(true)
			# keep only the bone name: the track is pointed at the model's skeleton on apply
			for i in a.get_track_count():
				var p: NodePath = a.track_get_path(i)
				var bone: String = str(p.get_concatenated_subnames())
				a.track_set_path(i, NodePath(".:" + bone))
			lib.add_animation(n, a)
	root.free()
	_libs[path] = lib
	print("CQ anim_library path=%s clips=%d ms=%.1f" % [path, lib.get_animation_list().size(), (Time.get_ticks_usec() - t0) / 1000.0])
	return lib


## Adds the library to `player`, its tracks pointed at `skeleton`. Returns the clip names.
static func apply(player: AnimationPlayer, skeleton: Skeleton3D, src: AnimationLibrary) -> PackedStringArray:
	var out := PackedStringArray()
	if player == null or skeleton == null or src == null:
		return out
	var root: Node = player.get_node(player.root_node)
	var skel_path: String = str(root.get_path_to(skeleton))
	var lib := AnimationLibrary.new()
	for n: StringName in src.get_animation_list():
		var a: Animation = src.get_animation(n).duplicate(true)
		for i in a.get_track_count():
			var bone: String = str(a.track_get_path(i).get_concatenated_subnames())
			a.track_set_path(i, NodePath(skel_path + ":" + bone))
		lib.add_animation(n, a)
		out.append(LIB_NAME + "/" + str(n))
	if player.has_animation_library(LIB_NAME):
		player.remove_animation_library(LIB_NAME)
	player.add_animation_library(LIB_NAME, lib)
	return out


## The clip set for a weapon class ("hammer" -> "heavy"), "" for none.
static func set_for(cls: String) -> String:
	var cs: Dictionary = data().get("class_set", {})
	return str(cs.get(cls, cs.get("_default", "")))


## {state: {clip, frames, fps, contact, in, out, body, ground_speed_per_hip}} for a weapon
## class on character `key`: the character's pick (the set's clip or the first alternate
## that passed the tear gate on its mesh); a state with no pick is left out (the model's own
## clip or the procedural pose plays it).
static func states_for(cls: String, key: String = "") -> Dictionary:
	var d: Dictionary = data()
	var sname: String = set_for(cls)
	var s: Dictionary = (d.get("sets", {}) as Dictionary).get(sname, {})
	var pick: Dictionary = ((((d.get("characters", {}) as Dictionary).get(key, {}) as Dictionary).get("pick", {}) as Dictionary).get(sname, {}) as Dictionary)
	var clips: Dictionary = d.get("clips", {})
	var out: Dictionary = {}
	for st: String in s:
		var e: Dictionary = s[st]
		var name: String = str(pick.get(st, e.get("clip", ""))) if key != "" else str(e.get("clip", ""))
		var c: Dictionary = clips.get(name, {})
		if name == "" or c.is_empty():
			continue
		var m: Dictionary = c.duplicate()
		if name == str(e.get("clip", "")):
			m.merge(e, true)    # in / out / body belong to the set's own clip
		elif e.has("body"):
			m["body"] = e["body"]
		m["clip"] = name
		out[st] = m
	return out
