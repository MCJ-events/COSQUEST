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

## realism-20261111: which clips the states play. "classic" = the KayKit / Quaternius picks (build 21),
## "mocap" = the motion-capture overlay on top (anim_clips.json sets_mocap: CMU captures and
## Mesh2Motion clips; a state with no overlay pick keeps its classic clip), "" = the data's
## "motion_default". fight.gd sets it from the config ("motion"); one switch for before / after.
static var motion: String = ""
## realism round 2: "hybrid" = the overlay state by state, as the data's "hybrid_states" says per
## weapon set: "mocap" (the captured clip), "classic" (keep build 21's), or "blend" (the captured
## clip's upper body on the classic clip's hips and legs: combat_animator.gd mixes them when the
## swing starts). `state_modes` (fight config "motion_states") overrides single states, for A/B runs.
static var state_modes: Dictionary = {}
## anim-readable (13 Nov 2026): every button's own readable body action (anim_clips.json sets_readable,
## picked per character under the tear gate: characters.<key>.pick_readable) and each faction hero's
## own victory and intro (hero_poses: characters.<key>.pick_poses), on top of whatever the motion
## switch chose. -1 = the data's "readable_default", 0 = off (build 25's clips to the frame), 1 = on.
## fight.gd sets it from the config ("readable").
static var readable: int = -1

## realism (12 Nov 2026): clip grips of characters registered at run time (key -> {class: grip}),
## read by fight.gd beside attach.json's.
static var sidecar_grips: Dictionary = {}

static var _data: Dictionary = {}
static var _libs: Dictionary = {}     # path -> AnimationLibrary (track paths relative to the skeleton: ".:Bone")


static func data() -> Dictionary:
	if _data.is_empty() and FileAccess.file_exists(DATA_JSON):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(DATA_JSON))
		if d is Dictionary:
			_data = d
	return _data


## Registers the clip library of a character that is NOT inside the pck (a Forge catalogue
## download). Beside the model file lie two files written by tools/anim/add_hero.sh:
##   anim.glb   the skeleton-only clip library
##   anim.json  {v, key, character: its data/anim_clips.json entry, clips: metadata of the clips
##               it names, clip_grips: its weapon grips}
## (or <model name>.anim.glb / .anim.json for several characters in one folder). The entry is
## merged into the clip data with the library pointed at the file, so everything else (key_for,
## library, states_for) works as for a built-in character. Returns the key, or "" when there is
## no sidecar or it does not parse. Cheap to call again: a key is registered once.
static func register_sidecar(model_path: String) -> String:
	if model_path == "" or model_path.begins_with("res://"):
		return ""
	var dir: String = model_path.get_base_dir()
	var stem: String = model_path.get_file().get_basename()
	for pair: Array in [[dir.path_join("anim.json"), dir.path_join("anim.glb")], [dir.path_join(stem + ".anim.json"), dir.path_join(stem + ".anim.glb")]]:
		if not (FileAccess.file_exists(str(pair[0])) and FileAccess.file_exists(str(pair[1]))):
			continue
		return _register(str(pair[0]), str(pair[1]), "sidecar")
	return ""


## build 28: a Forge character's fight kit, downloaded with the character (the app's
## features/game3d/fightKit.ts; config "<role>_anim" = the kit's anim.json, anim.glb beside it).
## Same files and checks as a sidecar, plus: version 1 only, and the library is bound only to a
## skeleton that matches its fingerprint (key_for), so a wrong or broken kit leaves the fighter
## exactly as it was without one. Returns the key, or "" (and why on the log).
static func register_kit(json_path: String) -> String:
	if json_path == "" or json_path.begins_with("res://") or not json_path.ends_with(".json"):
		return ""
	var glb_path: String = json_path.get_base_dir().path_join("anim.glb")
	if not (FileAccess.file_exists(json_path) and FileAccess.file_exists(glb_path)):
		print("CQ anim_kit_reject path=%s why=missing files" % json_path)
		return ""
	return _register(json_path, glb_path, "kit")


## The checks every run-time library passes before it joins the clip data; "" when it fails.
static func _register(json_path: String, glb_path: String, how: String) -> String:
	var j: Variant = JSON.parse_string(FileAccess.get_file_as_string(json_path))
	var why: String = ""
	if not (j is Dictionary) or not ((j as Dictionary).get("character") is Dictionary) or str((j as Dictionary).get("key", "")) == "":
		why = "not a library description"
	elif how == "kit" and int((j as Dictionary).get("v", 0)) != 1:
		why = "version %s" % str((j as Dictionary).get("v", "?"))
	elif how == "kit" and ((((j as Dictionary)["character"] as Dictionary).get("fingerprint", {}) as Dictionary).is_empty()):
		why = "no skeleton fingerprint"
	if why != "":
		push_warning("anim %s %s: %s" % [how, json_path, why])
		print("CQ anim_%s_reject path=%s why=%s" % [how, json_path, why])
		return ""
	var key: String = str(j["key"])
	var d: Dictionary = data()
	if not d.has("characters"):
		d["characters"] = {}
	var chars: Dictionary = d["characters"]
	# a downloaded library never replaces one the pck ships (same key): it takes its own
	if chars.has(key) and not bool((chars[key] as Dictionary).get("sidecar", false)):
		key = key + "_" + how
	if chars.has(key) and str((chars[key] as Dictionary).get("library", "")) == glb_path:
		return key
	var ch: Dictionary = (j["character"] as Dictionary).duplicate(true)
	ch["library"] = glb_path
	ch["status"] = "clips"
	ch["sidecar"] = true
	ch["sidecar_how"] = how
	chars[key] = ch
	if not d.has("clips"):
		d["clips"] = {}
	var clips: Dictionary = d["clips"]
	for c: String in (j.get("clips", {}) as Dictionary):
		if not clips.has(c):
			clips[c] = j["clips"][c]
	if j.get("clip_grips") is Dictionary:
		sidecar_grips[key] = j["clip_grips"]
	print("CQ anim_%s key=%s library=%s" % [how, key, glb_path])
	return key


## build 28: true when every bone of the character's fingerprint is in `skeleton` with its rest
## position within 2 cm (what key_for asks of a pck character it recognises).
static func fits(skeleton: Skeleton3D, fp: Dictionary) -> bool:
	if skeleton == null or fp.is_empty():
		return false
	for bone: String in fp:
		var b: int = skeleton.find_bone(bone)
		if b < 0:
			return false
		var want: Array = fp[bone]
		if want.size() < 3:
			return false
		if skeleton.get_bone_global_rest(b).origin.distance_to(Vector3(want[0], want[1], want[2])) > 0.02:
			return false
	return true


## The cast key for a skeleton: the config's key when it names a character with a library,
## else the character whose rest skeleton matches (bone names and hip/hand/foot rest
## positions within 2 cm), else "".
static func key_for(skeleton: Skeleton3D, hint: String) -> String:
	var chars: Dictionary = data().get("characters", {})
	if hint != "" and chars.has(hint) and str((chars[hint] as Dictionary).get("status", "")) == "clips":
		var hc: Dictionary = chars[hint]
		# build 28: a library that came with a download binds only to the skeleton it was made for
		if str(hc.get("sidecar_how", "")) == "kit" and not fits(skeleton, hc.get("fingerprint", {})):
			print("CQ anim_kit_reject key=%s why=the model's skeleton is not the library's" % hint)
			return ""
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
	return load_library(path)


## fid29 combat (build 29): the mid and high tiers' captured motion (tools/anim/build_real.py), in its own
## data file and its own libraries (anim/real/<key>.glb). Build 28's anim_clips.json and anim/*.glb are never
## read differently: a low phone loads exactly what it loaded before. combat_animator.gd asks for it only on
## the real-look tiers.
const REAL_JSON: String = "res://data/anim_real.json"
static var _real: Dictionary = {}


static func real_data() -> Dictionary:
	if _real.is_empty() and FileAccess.file_exists(REAL_JSON):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(REAL_JSON))
		if d is Dictionary:
			_real = d
	return _real


## This character's captured-motion entry ({} = none), only when `skeleton` is the one it was made for.
static func real_for(key: String, skeleton: Skeleton3D) -> Dictionary:
	var c: Dictionary = (real_data().get("characters", {}) as Dictionary).get(key, {})
	if c.is_empty() or not fits(skeleton, c.get("fingerprint", {})):
		return {}
	return c


## Loads (once) a library GLB by its path (the build 28 libraries and the fid29 ones alike).
static func load_library(path: String) -> AnimationLibrary:
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
			var fixed: int = 0
			for i in a.get_track_count():
				var p: NodePath = a.track_get_path(i)
				var bone: String = str(p.get_concatenated_subnames())
				a.track_set_path(i, NodePath(".:" + bone))
				fixed += despike(a, i)
			var cd: Dictionary = (data().get("clips", {}) as Dictionary).get(str(n), {})
			if cd.has("bob"):
				debob(a, float(cd["bob"]))
			if SOFT_ARMS.has(str(n)):
				soften_arms(a, float(SOFT_ARMS[str(n)]))
			lib.add_animation(n, a)
			_despiked += fixed
	root.free()
	_libs[path] = lib
	print("CQ anim_library path=%s clips=%d despiked=%d ms=%.1f" % [path, lib.get_animation_list().size(), _despiked, (Time.get_ticks_usec() - t0) / 1000.0])
	_despiked = 0
	return lib


static var _despiked: int = 0
const SPIKE_DEG: float = 40.0     # a one-frame bone turn this big ...
const SPIKE_RATIO: float = 3.0    # ... and this many times its neighbours' (at least 5 deg) is a snap


## fight-anim: the retargeted clips have a few one-frame snaps (both legs 62-67 deg in a single
## frame of 1H_Melee_Attack_Chop, the off-hand forearm 54 deg in the horizontal slice, the legs
## 135 deg in 2H_Melee_Attack_Spinning, the forearm 57 deg in Death_A): an isolated jump between
## keys k and k+1 is spread over keys k-1..k+2 (the same start and end pose, three even steps).
## Returns how many it spread. Rotation tracks only; a clip with no spike is untouched.
static func despike(a: Animation, i: int) -> int:
	if a.track_get_type(i) != Animation.TYPE_ROTATION_3D:
		return 0
	var n: int = a.track_get_key_count(i)
	if n < 5:
		return 0
	var q: Array[Quaternion] = []
	for k in n:
		q.append(a.track_get_key_value(i, k))
	var fixed: int = 0
	var k: int = 1
	while k < n - 2:
		var d: float = rad_to_deg(q[k].angle_to(q[k + 1]))
		var nb: float = maxf(5.0, maxf(rad_to_deg(q[k - 1].angle_to(q[k])), rad_to_deg(q[k + 1].angle_to(q[k + 2]))))
		if d > SPIKE_DEG and d > SPIKE_RATIO * nb:
			var q0: Quaternion = q[k - 1]
			var q3: Quaternion = q[k + 2]
			q[k] = q0.slerp(q3, 1.0 / 3.0)
			q[k + 1] = q0.slerp(q3, 2.0 / 3.0)
			a.track_set_key_value(i, k, q[k])
			a.track_set_key_value(i, k + 1, q[k + 1])
			fixed += 1
			k += 3
		else:
			k += 1
	return fixed


## build 20 pass 2: the UAL jog and sprint were retargeted with their leg swing damped by half
## (clips.json damp_legs), but not the hips' bounce: the body rose 0.33-0.42 m a stride with both
## feet off the ground for most of it, so a running fighter floated over its shadow. The hips'
## height over the clip's lowest is scaled by `k` (the stance keys, at the lowest, stay put).
## Position track of the Hips only; returns true when it changed the clip.
static func debob(a: Animation, k: float) -> bool:
	for i in a.get_track_count():
		if a.track_get_type(i) != Animation.TYPE_POSITION_3D:
			continue
		if str(a.track_get_path(i).get_concatenated_subnames()) != "Hips":
			continue
		var n: int = a.track_get_key_count(i)
		if n < 2:
			return false
		var lo: float = INF
		for j in n:
			lo = minf(lo, (a.track_get_key_value(i, j) as Vector3).y)
		for j in n:
			var v: Vector3 = a.track_get_key_value(i, j)
			v.y = lo + (v.y - lo) * k
			a.track_set_key_value(i, j, v)
		return true
	return false


## build 21: the stagger (KayKit Dodge_Backward) throws both arms out 85 deg from where they start;
## on the Guardian's long arms, from the game camera, the backward step read as a T-pose. The arms
## (shoulders to hands) keep this share of their motion away from the clip's first pose (the arms
## down, as the idle and the hit react hold them); the legs' step is untouched.
const SOFT_ARMS: Dictionary = {"Stagger_Back": 0.35}
const ARM_BONES: Array[String] = ["LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "LeftForeArm",
	"RightForeArm", "LeftHand", "RightHand"]


static func soften_arms(a: Animation, keep: float) -> int:
	var n_tracks: int = 0
	for i in a.get_track_count():
		if a.track_get_type(i) != Animation.TYPE_ROTATION_3D:
			continue
		if not (str(a.track_get_path(i).get_concatenated_subnames()) in ARM_BONES):
			continue
		var n: int = a.track_get_key_count(i)
		if n < 2:
			continue
		var q0: Quaternion = a.track_get_key_value(i, 0)
		for j in range(1, n):
			a.track_set_key_value(i, j, q0.slerp(a.track_get_key_value(i, j) as Quaternion, keep))
		n_tracks += 1
	return n_tracks


## Adds the library to `player`, its tracks pointed at `skeleton`. Returns the clip names. `lib_name` (fid29):
## the name it is added under ("cq" = build 28's; the captured clips go in beside it as REAL_LIB).
const REAL_LIB: String = "cqr"


static func apply(player: AnimationPlayer, skeleton: Skeleton3D, src: AnimationLibrary, lib_name: String = LIB_NAME) -> PackedStringArray:
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
		out.append(lib_name + "/" + str(n))
	if player.has_animation_library(lib_name):
		player.remove_animation_library(lib_name)
	player.add_animation_library(lib_name, lib)
	return out


## "classic" or "mocap" (see `motion`).
static func motion_now() -> String:
	var m: String = motion if motion != "" else str(data().get("motion_default", "classic"))
	return m if (m == "mocap" or m == "hybrid") else "classic"


## The clip set for a weapon class ("hammer" -> "heavy"), "" for none. A set that exists only in the
## motion-capture overlay ("unarmed") falls back to its classic base set when the switch is classic.
static func set_for(cls: String) -> String:
	var cs: Dictionary = data().get("class_set", {})
	return str(cs.get(cls, cs.get("_default", "")))


## {state: {clip, frames, fps, contact, in, out, body, ground_speed_per_hip}} for a weapon
## class on character `key`: the character's pick (the set's clip or the first alternate
## that passed the tear gate on its mesh); a state with no pick is left out (the model's own
## clip or the procedural pose plays it). With the motion switch on "mocap" the overlay's pick
## replaces a state's classic one (and adds the overlay-only states: stagger_fwd, death_fwd).
static func states_for(cls: String, key: String = "") -> Dictionary:
	var d: Dictionary = data()
	var sname: String = set_for(cls)
	var base: String = str((d.get("set_base", {}) as Dictionary).get(sname, sname))
	var s: Dictionary = (d.get("sets", {}) as Dictionary).get(base, {})
	var ch: Dictionary = (d.get("characters", {}) as Dictionary).get(key, {})
	var pick: Dictionary = ((ch.get("pick", {}) as Dictionary).get(base, {}) as Dictionary)
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
		if name != str(e.get("clip", "")) and bool(e.get("body_alt", false)) and not bool(c.get("spin", false)):
			m["body"] = true    # an alternate without the set clip's motion (no spin): the body motion adds it
		m["clip"] = name
		out[st] = m
	if motion_now() != "classic" and key != "":
		var so: Dictionary = (d.get("sets_mocap", {}) as Dictionary).get(sname, {})
		var po: Dictionary = ((ch.get("pick_mocap", {}) as Dictionary).get(sname, {}) as Dictionary)
		var hy: Dictionary = (d.get("hybrid_states", {}) as Dictionary).get(sname, {})
		for st: String in so:
			var name2: String = str(po.get(st, ""))
			var c2: Dictionary = clips.get(name2, {})
			if name2 == "" or c2.is_empty():
				continue
			var mode: String = "mocap"
			if motion_now() == "hybrid":
				mode = str(hy.get(st, "mocap"))
			mode = str(state_modes.get(st, mode))
			if mode == "classic":
				continue
			var lower: Dictionary = (out.get(st, {}) as Dictionary).duplicate() if mode == "blend" else {}
			var m2: Dictionary = c2.duplicate()
			var own: Dictionary = ch.get("ground_speed_per_hip", {})
			if own.has(name2):
				m2["ground_speed_per_hip"] = own[name2]   # this character's own stride
			m2["clip"] = name2
			m2["mocap"] = true
			if not lower.is_empty() and str(lower.get("clip", "")) != name2:
				m2["lower"] = lower    # the classic clip whose hips and legs carry this one's upper body
			out[st] = m2
	# the readable picks win over the overlay too: they are the actions the buttons promise
	_readable_overlay(out, d, sname, ch, clips)
	return out


## anim-readable: true when the readable clips play (config "readable", else the data's default).
static func readable_now() -> bool:
	if readable >= 0:
		return readable == 1
	return bool(data().get("readable_default", false))


## anim-readable: the character's readable picks for this weapon set, and its own victory and intro,
## into `out` (state -> clip metadata). A state with no pick keeps what is there.
static func _readable_overlay(out: Dictionary, d: Dictionary, sname: String, ch: Dictionary, clips: Dictionary) -> void:
	if not readable_now() or ch.is_empty():
		return
	var pr: Dictionary = ((ch.get("pick_readable", {}) as Dictionary).get(sname, {}) as Dictionary)
	var poses: Dictionary = ch.get("pick_poses", {})
	for src: Dictionary in [pr, poses]:
		for st: String in src:
			var name: String = str(src[st])
			var c: Dictionary = clips.get(name, {})
			if name == "" or c.is_empty():
				continue
			var m: Dictionary = c.duplicate()
			var own: Dictionary = ch.get("ground_speed_per_hip", {})
			if own.has(name):
				m["ground_speed_per_hip"] = own[name]   # this character's own stride (run and sprint)
			m["clip"] = name
			m["readable"] = true
			out[st] = m
