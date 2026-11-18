extends Node3D
## build 28 (forge-env-28): the point's Forge world piece (catalogue type "environment", "World piece" in the Forge
## web app) standing at the fight as set dressing, the way the Encounter of a question point already shows it.
##
## Config keys (the app sends them only while the server's forge_env_fights flag is on and the point is dressed,
## features/game3d/fightEnv.ts):
##   env_glb        absolute path of the piece's GLB at the tier's LOD (the Forge cache, sha256-checked)
##   env_thumb      absolute path of its thumbnail PNG (transparent background): the low tier's impostor, and the
##                  fallback when the model is missing or fails the checks below
##   env_name       its name (logs only)
##   env_height_m   the catalogue's height_m when it has one (Forge models are normalised to 1 m tall)
##   env_placement  ground | prop | backdrop (the catalogue's gameplay.placement)
##   env            false: none of this (review captures)
##
## Presentation only. The piece has no collision, no physics body, no hit area and no light; it is not one of the
## fighters and nothing of the rules, the bot, the camera or the record reads it. It loads on its own thread (or, with
## the config's load_thread false as in every seeded test, inside the fight's _ready), never through the fight's load
## queue, so the fighters load and the fight starts on the frame they always did and seeded records do not change.
##
## Where it stands: where no fighter can ever be between the camera and the piece, so it never hides one: past the far
## end of the fighters' ground (fight.gd ARENA_Z; the camera is always on the near side of every fighter), or past
## their left side (ARENA_HALF_X; the camera sits right of its focus, so its sight lines to the fighters never cross
## there). Inside the place's clear zone where it fits (place.gd keeps it free of buildings and props), never over a
## building footprint (the minimap's blocks) or near a landmark. Spots are scored from the fight's standard wide camera
## (the low tier's, the one the close camera pulls back to): how much of the piece it sees under the HUD's top block,
## and how far that stays from the hero and the Guardian on screen. No spot: no piece. The same point gets the same
## spot on every tier and every phone (nothing here reads the fight's RNG or the screen).
##
## Per look tier (arena.gd TIER_LOOK, the app's RAM rule): low draws the thumbnail as one upright card (one quad, no
## model load at all); mid and high load the GLB, within the size limits of TIER_LIMITS (a heavier file, too many
## triangles or a broken model falls back to the card). Textures above the tier's size are scaled down on the loader's
## thread. Shadows from the piece only where the tier has shadows (high).

const LoaderScript := preload("res://char_loader.gd")
const ShaderWarmScript := preload("res://shader_warm.gd")

## What each look tier may draw. bytes: the GLB file; tris: triangles after load; tex: the longest texture side kept.
const TIER_LIMITS: Dictionary = {
	"low": {"model": false},
	"mid": {"model": true, "bytes": 1_500_000, "tris": 12_000, "tex": 512},
	"high": {"model": true, "bytes": 4_000_000, "tris": 40_000, "tex": 1024},
}
## Heights (m) by placement when the catalogue has none, and the most a piece may be. Fighters are ~1.8 m tall.
const DEFAULT_H: Dictionary = {"ground": 2.0, "prop": 1.2, "backdrop": 4.5}
const MAX_H: Dictionary = {"ground": 3.2, "prop": 1.8, "backdrop": 6.0}
const MIN_H: float = 0.6
## The widest a piece may stand (footprint half-width, m): it is shrunk to fit.
const MAX_HALF: Dictionary = {"ground": 1.4, "prop": 0.9, "backdrop": 3.0}
## The fighters' ground ends at fight.gd ARENA_Z.x (-9 m) and a fighter is ~0.4 m across: the piece's near edge stays
## behind this line, so it is always further from the camera than any fighter.
const FIGHT_FAR_Z: float = -9.0
const NEAR_GAP: float = 0.7
## x of the far end's candidate spots, in the order they win ties (the camera looks a little left along the street).
const SPOT_X: Array[float] = [-3.4, 1.8, -5.6, 4.0, -1.6, 0.0, -7.2, 6.2]
## The default street's clear zone (street_layout.gd), when the arena has no place node.
const STREET_CLEAR := Rect2(-5.2, -11.0, 10.4, 37.0)
## The screen band the piece should sit in: under the HUD's top block (boss bar ~0.14 of 1280), above the controls.
const SCREEN_TOP: float = 0.15
const SCREEN_BOTTOM: float = 0.8

var cfg: Dictionary = {}
var fight: Node = null
var tier: String = "low"
var placement: String = "ground"
var info: Dictionary = {}          # what happened, for the logs and the tests: {mode, ok, why, tris, h, at, ...}
var model: Node3D = null           # the piece as it stands (a GLB scene or the card), under this node
var _thread: Thread = null
var _loaded: Dictionary = {}       # the load's result, waiting for the place to be built
var _waiting: bool = false


## Starts the piece for this fight. `f` is the fight (fight.gd): only its arena (the place, its clear zone and blocks)
## is read, nothing else.
func setup(c: Dictionary, f: Node) -> void:
	cfg = c
	fight = f
	tier = str(c.get("tier", "low"))
	if not TIER_LIMITS.has(tier):
		tier = "low"
	placement = str(c.get("env_placement", "ground"))
	if not DEFAULT_H.has(placement):
		placement = "ground"
	var glb: String = LoaderScript.clean_path(str(c.get("env_glb", "")))
	var thumb: String = LoaderScript.clean_path(str(c.get("env_thumb", "")))
	info = {"name": str(c.get("env_name", "")), "tier": tier, "placement": placement, "mode": "none", "ok": false, "why": ""}
	if c.get("env", true) == false or (glb == "" and thumb == ""):
		info["why"] = "off" if c.get("env", true) == false else "no piece"
		return
	var lim: Dictionary = TIER_LIMITS[tier]
	var why: String = check_file(glb, lim) if bool(lim["model"]) else "tier %s draws the card" % tier
	if why != "":
		_use_card(thumb, why)
		return
	info["mode"] = "model"
	_waiting = true
	if bool(c.get("load_thread", true)):
		_thread = Thread.new()
		if _thread.start(_load.bind(glb, lim)) != OK:
			_thread = null
			_loaded = _load(glb, lim)
	else:
		_loaded = _load(glb, lim)
	_try_attach()


## Why a file cannot be loaded on this tier ("" when it can): missing, empty, too big, not a GLB.
static func check_file(path: String, lim: Dictionary) -> String:
	if path == "":
		return "no model file"
	if not FileAccess.file_exists(path):
		return "missing file"
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return "unreadable"
	var n: int = f.get_length()
	var magic: String = f.get_buffer(4).get_string_from_ascii() if n >= 4 else ""
	f.close()
	if n <= 0:
		return "empty file"
	if n > int(lim.get("bytes", 0)):
		return "file %d bytes over the tier's %d" % [n, int(lim.get("bytes", 0))]
	if magic != "glTF":
		return "not a GLB"
	return ""


## On the loader's thread: the GLB (char_loader.gd, mipmaps included), checked and made harmless. Nothing here is in
## the tree yet.
func _load(path: String, lim: Dictionary) -> Dictionary:
	var r: Dictionary = LoaderScript.new().load_glb(path, false)
	if not bool(r.get("ok", false)):
		return {"ok": false, "why": "load: " + str(r.get("error", "?"))}
	var node: Node3D = r["node"]
	var why: String = sanitize(node, int(lim.get("tex", 512)))
	var tris: int = triangles(node)
	var box: AABB = local_aabb(node)
	if why == "" and tris <= 0:
		why = "no triangles"
	if why == "" and tris > int(lim.get("tris", 0)):
		why = "%d triangles over the tier's %d" % [tris, int(lim.get("tris", 0))]
	if why == "" and not box_ok(box):
		why = "bad bounds %s" % str(box)
	if why != "":
		node.free()
		return {"ok": false, "why": why}
	return {"ok": true, "node": node, "tris": tris, "box": box, "parse_ms": float(r.get("parse_ms", 0.0))}


## Takes out everything of a GLB that is not a mesh to look at: collision shapes and bodies, cameras, lights (a
## glTF punctual light would relight the fight), animation players, skeleton-free extras. Scales textures down to
## `tex_max`. Returns "" or why the model is not usable.
static func sanitize(node: Node3D, tex_max: int) -> String:
	var drop: Array[Node] = []
	for n: Node in node.find_children("*", "", true, false):
		if n is CollisionObject3D or n is CollisionShape3D or n is CollisionPolygon3D or n is Camera3D \
				or n is Light3D or n is AnimationPlayer or n is AudioStreamPlayer3D or n is GPUParticles3D or n is CPUParticles3D:
			drop.append(n)
	for n: Node in drop:
		if is_instance_valid(n) and n.get_parent() != null:
			n.get_parent().remove_child(n)
			n.free()
	var meshes: Array[Node] = node.find_children("*", "MeshInstance3D", true, false)
	if meshes.is_empty():
		return "no mesh"
	var done: Dictionary = {}
	for mi: Node in meshes:
		var m: MeshInstance3D = mi
		m.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		if m.mesh == null:
			continue
		for s: int in m.mesh.get_surface_count():
			var mat := m.mesh.surface_get_material(s) as BaseMaterial3D
			if mat == null:
				continue
			for p: int in [BaseMaterial3D.TEXTURE_ALBEDO, BaseMaterial3D.TEXTURE_METALLIC, BaseMaterial3D.TEXTURE_ROUGHNESS,
					BaseMaterial3D.TEXTURE_NORMAL, BaseMaterial3D.TEXTURE_EMISSION, BaseMaterial3D.TEXTURE_AMBIENT_OCCLUSION]:
				var t := mat.get_texture(p) as ImageTexture
				if t == null or done.has(t):
					continue
				done[t] = true
				var img: Image = t.get_image()
				if img == null or img.is_compressed() or maxi(img.get_width(), img.get_height()) <= tex_max:
					continue
				var k: float = float(tex_max) / float(maxi(img.get_width(), img.get_height()))
				img.clear_mipmaps()
				img.resize(maxi(1, int(img.get_width() * k)), maxi(1, int(img.get_height() * k)), Image.INTERPOLATE_BILINEAR)
				img.generate_mipmaps()
				t.set_image(img)
	return ""


static func triangles(node: Node) -> int:
	var n: int = 0
	for mi: Node in node.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = (mi as MeshInstance3D).mesh
		if mesh == null:
			continue
		for s: int in mesh.get_surface_count():
			if mesh is ArrayMesh:
				var il: int = (mesh as ArrayMesh).surface_get_array_index_len(s)
				n += (il if il > 0 else (mesh as ArrayMesh).surface_get_array_len(s)) / 3
	return n


## The model's bounds in its own space (every mesh, with the transforms under the root).
static func local_aabb(root: Node3D) -> AABB:
	var out: AABB = AABB()
	var first: bool = true
	for mi: Node in root.find_children("*", "MeshInstance3D", true, false):
		var m: MeshInstance3D = mi
		if m.mesh == null:
			continue
		var xf: Transform3D = Transform3D.IDENTITY
		var n: Node = m
		while n != null and n != root:
			if n is Node3D:
				xf = (n as Node3D).transform * xf
			n = n.get_parent()
		var b: AABB = xf * m.mesh.get_aabb()
		out = b if first else out.merge(b)
		first = false
	return out


static func box_ok(b: AABB) -> bool:
	for v: float in [b.position.x, b.position.y, b.position.z, b.size.x, b.size.y, b.size.z]:
		if is_nan(v) or is_inf(v):
			return false
	return b.size.y > 0.001 and b.size.x > 0.001 and b.size.z > 0.001 and b.size.length() < 10000.0


## The scale for a model of bounds `b`: the catalogue's height (else the placement's default) within limits, then
## shrunk until its footprint fits MAX_HALF.
static func fit_scale(b: AABB, height_m: float, place: String) -> float:
	var h: float = height_m if height_m > 0.0 else float(DEFAULT_H[place])
	h = clampf(h, MIN_H, float(MAX_H[place]))
	var s: float = h / maxf(b.size.y, 0.001)
	var half: float = maxf(b.size.x, b.size.z) * 0.5 * s
	if half > float(MAX_HALF[place]):
		s *= float(MAX_HALF[place]) / half
	return s


func _process(_dt: float) -> void:
	if _thread != null and not _thread.is_alive():
		_loaded = _thread.wait_to_finish()
		_thread = null
	if _waiting:
		_try_attach()
	if _card_wait:
		_place_card()
	if not _waiting and not _card_wait and _thread == null:
		set_process(false)


func _exit_tree() -> void:
	if _thread != null:
		var r: Dictionary = _thread.wait_to_finish()
		_thread = null
		if r.get("node") is Node:
			(r["node"] as Node).free()
	if _loaded.get("node") is Node and is_instance_valid(_loaded["node"]) and (_loaded["node"] as Node).get_parent() == null:
		(_loaded["node"] as Node).free()
	_loaded = {}
	if _card != null and is_instance_valid(_card) and _card.get_parent() == null:
		_card.free()
	_card = null


## Places the loaded piece once the place round the fight is built (its clear zone and building footprints are known
## then); before that it waits, a frame at a time, without holding anything else up.
func _try_attach() -> void:
	if _loaded.is_empty():
		return
	var arena: Node = fight.get("arena") if fight != null else null
	if arena != null and arena.get("_pending_place") != null:
		return
	_waiting = false
	var r: Dictionary = _loaded
	_loaded = {}
	if not bool(r.get("ok", false)):
		_use_card(LoaderScript.clean_path(str(cfg.get("env_thumb", ""))), str(r.get("why", "?")))
		return
	var node: Node3D = r["node"]
	var box: AABB = r["box"]
	var s: float = fit_scale(box, float(cfg.get("env_height_m", 0.0)), placement)
	var spot: Variant = choose_spot(box, s)
	if spot == null:
		node.free()
		info["why"] = "no free spot"
		_log()
		return
	var holder := Node3D.new()
	holder.name = "Piece"
	# the model's base centre on the spot: its bounds' bottom on the ground, its middle over the spot
	node.position = -Vector3(box.position.x + box.size.x * 0.5, box.position.y, box.position.z + box.size.z * 0.5)
	holder.add_child(node)
	holder.scale = Vector3.ONE * s
	holder.position = (spot as Dictionary)["at"]
	holder.rotation.y = float((spot as Dictionary)["yaw"])
	var lk: Dictionary = (arena.get("look") if arena != null else {}) as Dictionary
	var shadows: bool = tier == "high" and bool(lk.get("shadows", false))
	for mi: Node in holder.find_children("*", "MeshInstance3D", true, false):
		(mi as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(holder)
	model = holder
	# fid29 (dressing): on the real look (mid and high) the piece sits on the street through a contact shadow, a soft
	# dark disc under its footprint (one quad, one draw); high also casts the key light's shadow (above)
	if tier != "low" and bool(lk.get("real", false)) and bool(lk.get("fid_dressing", false)):
		var half: float = maxf(box.size.x, box.size.z) * 0.5 * s
		add_child(contact_disc(holder.position, half))
		info["contact_ao"] = true
	info.merge({"ok": true, "tris": int(r["tris"]), "h": snappedf(box.size.y * s, 0.01), "half": snappedf(maxf(box.size.x, box.size.z) * 0.5 * s, 0.01),
		"at": [snappedf(holder.position.x, 0.01), snappedf(holder.position.z, 0.01)], "score": (spot as Dictionary)["score"],
		"parse_ms": snappedf(float(r.get("parse_ms", 0.0)), 0.1), "shadows": shadows}, true)
	_log()


static var _disc_mat: StandardMaterial3D


## fid29 (dressing): the contact shadow under a Forge piece on the real look: a quad 2.6 x the footprint's half-width,
## a radial falloff (made here, no file) multiplied onto the street, unshaded, no shadow, drawn just above the paving.
static func contact_disc(at: Vector3, half: float) -> MeshInstance3D:
	if _disc_mat == null:
		var g := Gradient.new()
		g.set_color(0, Color(0.0, 0.0, 0.0, 0.55))
		g.set_color(1, Color(0.0, 0.0, 0.0, 0.0))
		g.add_point(0.45, Color(0.0, 0.0, 0.0, 0.32))
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill = GradientTexture2D.FILL_RADIAL
		gt.fill_from = Vector2(0.5, 0.5)
		gt.fill_to = Vector2(1.0, 0.5)
		gt.width = 64
		gt.height = 64
		var m := StandardMaterial3D.new()
		m.albedo_texture = gt
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.disable_receive_shadows = true
		m.render_priority = -1
		_disc_mat = m
		ShaderWarmScript.add(m)
	var q := PlaneMesh.new()
	var r: float = clampf(half * 1.3, 0.4, 4.0)
	q.size = Vector2(r * 2.0, r * 2.0)
	var mi := MeshInstance3D.new()
	mi.name = "ContactAO"
	mi.mesh = q
	mi.material_override = _disc_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = Vector3(at.x, at.y + 0.025, at.z)
	return mi


## The low tier's card, or the fallback: the thumbnail cropped to what it shows, standing upright on the spot and
## turning about its upright to face the camera (one quad, unshaded, alpha cut so it never sorts).
func _use_card(thumb: String, why: String) -> void:
	info["why"] = why
	var tex: Texture2D = null
	var crop: Rect2i = Rect2i()
	if thumb != "" and FileAccess.file_exists(thumb):
		var img := Image.new()
		if img.load(thumb) == OK and img.get_width() > 0:
			crop = img.get_used_rect()
			if crop.size.x > 4 and crop.size.y > 4:
				img = img.get_region(crop)
				var k: float = minf(1.0, 256.0 / float(maxi(img.get_width(), img.get_height())))
				if k < 1.0:
					img.resize(maxi(1, int(img.get_width() * k)), maxi(1, int(img.get_height() * k)), Image.INTERPOLATE_BILINEAR)
				img.generate_mipmaps()
				tex = ImageTexture.create_from_image(img)
	if tex == null:
		info["mode"] = "none"
		info["why"] = why + (", no card" if thumb == "" else ", card unreadable")
		_log()
		return
	var h: float = clampf(float(cfg.get("env_height_m", 0.0)) if float(cfg.get("env_height_m", 0.0)) > 0.0 else float(DEFAULT_H[placement]), MIN_H, float(MAX_H[placement]))
	var w: float = h * float(tex.get_width()) / float(tex.get_height())
	if w * 0.5 > float(MAX_HALF[placement]):
		h *= float(MAX_HALF[placement]) / (w * 0.5)
		w = float(MAX_HALF[placement]) * 2.0
	var box := AABB(Vector3(-w * 0.5, 0.0, -0.05), Vector3(w, h, 0.1))
	info["mode"] = "card"
	_loaded = {}
	_waiting = false
	var card := Sprite3D.new()
	card.name = "Card"
	card.texture = tex
	card.pixel_size = h / float(tex.get_height())
	card.centered = true
	card.offset = Vector2(0.0, float(tex.get_height()) * 0.5)
	card.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	card.shaded = false
	card.double_sided = true
	card.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	card.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	card.modulate = Color(0.86, 0.86, 0.86)
	card.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	card.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	# like the model, it stands once the place round the fight is built (_process)
	_card = card
	_card_box = box
	_card_wait = true
	_place_card()


var _card: Sprite3D = null
var _card_box: AABB
var _card_wait: bool = false


func _place_card() -> void:
	var arena: Node = fight.get("arena") if fight != null else null
	if arena != null and arena.get("_pending_place") != null:
		return
	_card_wait = false
	var spot: Variant = choose_spot(_card_box, 1.0)
	if spot == null:
		_card.free()
		_card = null
		info["mode"] = "none"
		info["why"] = str(info["why"]) + ", no free spot"
		_log()
		return
	_card.position = (spot as Dictionary)["at"]
	add_child(_card)
	model = _card
	info.merge({"ok": true, "h": snappedf(_card_box.size.y, 0.01), "half": snappedf(_card_box.size.x * 0.5, 0.01),
		"at": [snappedf(_card.position.x, 0.01), snappedf(_card.position.z, 0.01)], "score": (spot as Dictionary)["score"]}, true)
	_card = null
	_log()


## The spot for a piece of model bounds `b` at scale `s`: {at: Vector3, yaw: float, score: float}, or null.
## Two rows of spots, both where no fighter can stand between the camera and the piece: the far end (past ARENA_Z,
## the camera is always on the near side of every fighter) and the left side (past ARENA_HALF_X: the camera sits on
## the right of its focus, so its sight lines to the fighters never cross x < -4.7). Each spot is scored from the
## fight's standard wide camera (VIEW_*), the one the low tier plays with and the close camera pulls back to.
func choose_spot(b: AABB, s: float) -> Variant:
	var half_x: float = b.size.x * 0.5 * s
	var half_z: float = b.size.z * 0.5 * s
	var r: float = maxf(half_x, half_z)    # the piece turns to the camera: keep its widest side's room both ways
	var arena: Node = fight.get("arena") if fight != null else null
	var pl: Node = null
	if arena != null:
		pl = arena.get("place")
		if pl == null:
			pl = arena.get("street_place")
	var clear: Rect2 = STREET_CLEAR
	if pl != null and pl.get("clear") is Rect2:
		clear = pl.get("clear")
	var blocks: Array = (arena.get("map_blocks") as Array) if arena != null and arena.get("map_blocks") is Array else []
	var lm: Variant = null
	if pl != null and pl.get("info") is Dictionary:
		lm = (pl.get("info") as Dictionary).get("landmark_at")
	var view: Dictionary = VIEW_PLACE if (arena != null and arena.get("place") != null) else VIEW_STREET
	var spots: Array[Vector2] = []
	var far_z: float = FIGHT_FAR_Z - NEAR_GAP - r     # a backdrop too: further back it stands under the HUD
	for x: float in (cfg["env_xs"] if cfg.get("env_xs") is Array else SPOT_X):
		spots.append(Vector2(x, far_z))
	if placement != "backdrop":
		for z: float in SIDE_Z:
			spots.append(Vector2(-FIGHT_HALF_X - NEAR_GAP - r, z))
	if cfg.get("env_spots") is Array:     # review captures: these spots only
		spots.clear()
		for v: Variant in cfg["env_spots"]:
			if v is Array and (v as Array).size() == 2:
				spots.append(Vector2(float(v[0]), float(v[1])))
	var best: Variant = null
	for sp: Vector2 in spots:
		var x: float = sp.x
		var z: float = sp.y
		if x - r < clear.position.x or x + r > clear.position.x + clear.size.x:
			continue
		var foot := Rect2(x - r - 0.4, z - r - 0.4, (r + 0.4) * 2.0, (r + 0.4) * 2.0)
		var hit: bool = false
		for blk: Variant in blocks:
			if blk is Rect2 and (blk as Rect2).intersects(foot):
				hit = true
				break
		if hit:
			continue
		if lm is Vector3 and Vector2((lm as Vector3).x - x, (lm as Vector3).z - z).length() < r + 6.0:
			continue
		var at := Vector3(x, 0.0, z)
		var sc: float = score_spot(view, at, r, b.size.y * s)
		if z < FIGHT_FAR_Z:
			sc += FAR_BONUS     # the intro fly-in and the victory shot look down the fight: the far end is in both
		if bool(cfg.get("env_debug", false)):
			print("CQ env spot x=%.1f z=%.1f score=%.3f" % [x, z, sc])
		if best == null or sc > float((best as Dictionary)["score"]) + 0.001:
			var eye: Vector3 = view_eye(view)
			best = {"at": at, "yaw": atan2(eye.x - at.x, eye.z - at.z), "score": snappedf(sc, 0.001)}
	return best


## The fight's standard cameras (fight.gd CAM_* and CAM_PLACE_*), at the opening: the focus ahead of the hero's
## spawn. Portrait, as the fight is drawn by default.
const VIEW_STREET: Dictionary = {"pitch": 34.0, "tilt": 0.0, "yaw": 12.0, "dist": 15.0, "ahead": 1.2, "fov": 52.0}
const VIEW_PLACE: Dictionary = {"pitch": 30.0, "tilt": 7.0, "yaw": 12.0, "dist": 16.0, "ahead": 0.6, "fov": 56.0}
const HERO_AT := Vector3(0.3, 0.0, 3.6)
const GUARDIAN_AT := Vector3(-0.4, 0.0, -0.6)
const FIGHT_HALF_X: float = 4.7            # fight.gd ARENA_HALF_X
const SIDE_Z: Array[float] = [-6.5, -4.0, -1.5]
const VIEW_ASPECT: float = 720.0 / 1280.0
## The far end over the left side when both are seen: the place's fly-in and the victory shot (fight.gd CLOSE_WIN_PITCH,
## the close camera's low shot of the winner) look along the fight, so a piece at its far end is in both.
const FAR_BONUS: float = 0.2


static func _orbit(view: Dictionary) -> Basis:
	return Basis.from_euler(Vector3(deg_to_rad(-float(view["pitch"])), deg_to_rad(float(view["yaw"])), 0.0))


static func view_eye(view: Dictionary) -> Vector3:
	var o: Basis = _orbit(view)
	var fwd := Vector3(-o.z.x, 0.0, -o.z.z).normalized()
	var focus: Vector3 = HERO_AT + fwd * float(view["ahead"])
	return focus + Vector3.UP * 0.8 + o.z * float(view["dist"])


## A world point on the standard view's screen, as fractions (0..1 from the top left); null behind the camera.
static func view_point(view: Dictionary, p: Vector3) -> Variant:
	var b: Basis = Basis.from_euler(Vector3(deg_to_rad(-(float(view["pitch"]) - float(view["tilt"]))), deg_to_rad(float(view["yaw"])), 0.0))
	var r: Vector3 = p - view_eye(view)
	var depth: float = -r.dot(b.z)
	if depth < 0.5:
		return null
	var tv: float = tan(deg_to_rad(float(view["fov"])) * 0.5)
	return Vector2(0.5 + r.dot(b.x) / (depth * tv * VIEW_ASPECT) * 0.5, 0.5 - r.dot(b.y) / (depth * tv) * 0.5)


## How well the standard view shows a piece at `at` (0..1.5): the share of its outline points on screen in the band
## under the HUD's top block and above the controls, plus up to 0.5 for its distance on screen from the hero and the
## Guardian where they spawn.
static func score_spot(view: Dictionary, at: Vector3, r: float, h: float) -> float:
	var pts: Array[Vector3] = [at, at + Vector3(0, h, 0), at + Vector3(-r, h * 0.5, 0), at + Vector3(r, h * 0.5, 0), at + Vector3(0, h * 0.5, 0)]
	var seen: float = 0.0
	var mid := Vector2.ZERO
	var n: int = 0
	for p: Vector3 in pts:
		var q: Variant = view_point(view, p)
		if q == null:
			continue
		mid += q
		n += 1
		if (q as Vector2).x >= 0.04 and (q as Vector2).x <= 0.96 and (q as Vector2).y >= SCREEN_TOP and (q as Vector2).y <= SCREEN_BOTTOM:
			seen += 1.0
	if n == 0:
		return 0.0
	mid /= float(n)
	var away: float = 1.0
	for f: Vector3 in [HERO_AT, GUARDIAN_AT]:
		var fq: Variant = view_point(view, f + Vector3.UP)
		if fq != null:
			away = minf(away, clampf(mid.distance_to(fq) / 0.35, 0.0, 1.0))
	return seen / float(pts.size()) + away * 0.5


func _log() -> void:
	print("CQ env " + JSON.stringify(info))
