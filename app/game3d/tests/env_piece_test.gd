extends SceneTree
## build 28 (forge-env-28): the point's Forge world piece in the fight (env_piece.gd).
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tests/env_piece_test.gd
## 1. The checks: a missing, empty, oversized or non-GLB file is refused before any load; a GLB is stripped of
##    everything that is not a mesh to look at (collision, bodies, lights, cameras, animation players), its textures
##    scaled to the tier's limit; the scale fits the catalogue height (else the placement's) and the widest footprint.
## 2. Where it stands: every spot chosen, for small to wide pieces, is where no fighter can be between it and the
##    camera (past the far end of the fighters' ground, or past their left side), clear of building blocks, seen by
##    the standard camera under the HUD.
## 3. Fights (each in a fresh engine, tools/panel/corpus_fight.gd): the low tier stands the card, mid and high the
##    model; a broken GLB falls back to the card; nothing at all with neither file; and the seeded records with the
##    piece are byte for byte the records without it (table 2 pinned as builds 25 to 28, table 3 pinned as build 28,
##    and the mid and high tiers each against themselves). A threaded load fights to the end with the piece standing.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const EnvPiece := preload("res://env_piece.gd")
const PINNED_V3: String = "f3d-3-dd591cb09b67"
# five_seeded_test.gd: the records builds 25 to 28 fight seed 239 to (table 2) and build 28's five-button record
const B27_RECORD_239: String = "731e53b3f749a5b4b6dce468eba336cb"
const B28_FIVE_RECORD_239: String = "52ce886076c4e1a89945f3cb878bca32"

var _fails: int = 0
var _glb: String = ""
var _thumb: String = ""
var _broken: String = ""


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	_glb = ProjectSettings.globalize_path("res://tests/fixtures/env/env_piece_lod2.glb")
	_thumb = ProjectSettings.globalize_path("res://tests/fixtures/env/env_piece_thumb.png")
	_broken = ProjectSettings.globalize_path("res://tests/fixtures/env/env_broken.glb")
	_checks()
	_spots()
	_fights()
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)


func _checks() -> void:
	var mid: Dictionary = EnvPiece.TIER_LIMITS["mid"]
	_check("file_none", EnvPiece.check_file("", mid) == "no model file")
	_check("file_missing", EnvPiece.check_file("/nowhere/x.glb", mid) == "missing file")
	_check("file_not_glb", EnvPiece.check_file(_broken, mid) == "not a GLB")
	_check("file_over_tier", EnvPiece.check_file(_glb, {"bytes": 1000}).begins_with("file "))
	_check("file_ok", EnvPiece.check_file(_glb, mid) == "", EnvPiece.check_file(_glb, mid))
	# the fixture, loaded as the fight does, then made harmless
	var r: Dictionary = preload("res://char_loader.gd").new().load_glb(_glb, false)
	_check("fixture_loads", bool(r.get("ok", false)), str(r.get("error", "")))
	if not bool(r.get("ok", false)):
		return
	var node: Node3D = r["node"]
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	shape.shape = BoxShape3D.new()
	body.add_child(shape)
	node.add_child(body)
	node.add_child(OmniLight3D.new())
	node.add_child(Camera3D.new())
	node.add_child(AnimationPlayer.new())
	var why: String = EnvPiece.sanitize(node, 128)
	_check("sanitize_ok", why == "", why)
	var left: int = 0
	for n: Node in node.find_children("*", "", true, false):
		if n is CollisionObject3D or n is CollisionShape3D or n is Light3D or n is Camera3D or n is AnimationPlayer:
			left += 1
	_check("sanitize_strips_physics_lights_cameras", left == 0, "%d left" % left)
	var biggest: int = 0
	for mi: Node in node.find_children("*", "MeshInstance3D", true, false):
		var m: Mesh = (mi as MeshInstance3D).mesh
		for s: int in m.get_surface_count():
			var mat := m.surface_get_material(s) as BaseMaterial3D
			var t := mat.get_texture(BaseMaterial3D.TEXTURE_ALBEDO) as ImageTexture if mat != null else null
			if t != null:
				biggest = maxi(biggest, maxi(t.get_width(), t.get_height()))
	_check("sanitize_scales_textures", biggest > 0 and biggest <= 128, "longest side %d" % biggest)
	var tris: int = EnvPiece.triangles(node)
	_check("triangles_counted", tris > 1000 and tris < 3000, str(tris))
	var box: AABB = EnvPiece.local_aabb(node)
	_check("bounds_ok", EnvPiece.box_ok(box), str(box))
	_check("bad_bounds_refused", not EnvPiece.box_ok(AABB(Vector3.ZERO, Vector3(1, 0, 1))) and not EnvPiece.box_ok(AABB(Vector3(NAN, 0, 0), Vector3.ONE)))
	node.free()
	# the scale: the catalogue's height, else the placement's default, within limits, footprint capped
	var unit := AABB(Vector3(-0.39, 0, -0.33), Vector3(0.78, 1.0, 0.66))
	_check("scale_default_ground", is_equal_approx(EnvPiece.fit_scale(unit, 0.0, "ground"), 2.0))
	_check("scale_catalogue_height", is_equal_approx(EnvPiece.fit_scale(unit, 1.5, "ground"), 1.5))
	_check("scale_height_capped", is_equal_approx(EnvPiece.fit_scale(unit, 40.0, "ground"), float(EnvPiece.MAX_H["ground"])))
	var wide := AABB(Vector3(-3, 0, -0.5), Vector3(6.0, 1.0, 1.0))
	var sw: float = EnvPiece.fit_scale(wide, 0.0, "ground")
	_check("scale_wide_fits_footprint", 3.0 * sw <= float(EnvPiece.MAX_HALF["ground"]) + 0.001, str(sw))


## The spots, from a piece with no fight (the default street, the standard camera) and from the place's clear zone.
func _spots() -> void:
	var p: Node3D = EnvPiece.new()
	p.cfg = {}
	for place: String in ["ground", "prop", "backdrop"]:
		p.placement = place
		for size: Vector3 in [Vector3(0.4, 1, 0.4), Vector3(0.78, 1, 0.66), Vector3(1, 1, 1), Vector3(2.4, 1, 0.8)]:
			var b := AABB(-Vector3(size.x, 0, size.z) * 0.5, size)
			var s: float = EnvPiece.fit_scale(b, 0.0, place)
			var sp: Variant = p.choose_spot(b, s)
			var tag: String = "spot_%s_%.1f" % [place, size.x]
			if sp == null:
				_check(tag, false, "no spot")
				continue
			var at: Vector3 = (sp as Dictionary)["at"]
			var r: float = maxf(size.x, size.z) * 0.5 * s
			var behind: bool = at.z + r <= EnvPiece.FIGHT_FAR_Z - 0.4
			var beside: bool = at.x + r <= -EnvPiece.FIGHT_HALF_X - 0.4
			_check(tag + "_safe", behind or beside, "at %s r %.2f" % [str(at), r])
			_check(tag + "_in_clear", at.x - r >= EnvPiece.STREET_CLEAR.position.x and at.x + r <= EnvPiece.STREET_CLEAR.end.x, str(at))
			# a backdrop (4.5 m) is taller than the band under the HUD at the far end: its foot and middle are what is seen
			_check(tag + "_seen", float((sp as Dictionary)["score"]) >= (0.8 if place == "backdrop" else 1.0), str(sp))
	p.free()
	# the camera's eye is on the near side of every fighter and right of the left side's spots
	var eye: Vector3 = EnvPiece.view_eye(EnvPiece.VIEW_STREET)
	_check("view_eye_behind_the_fight", eye.z > 9.0 and eye.x > -4.7, str(eye))
	var q: Variant = EnvPiece.view_point(EnvPiece.VIEW_STREET, EnvPiece.HERO_AT + Vector3.UP)
	_check("view_sees_the_hero", q is Vector2 and (q as Vector2).x > 0.3 and (q as Vector2).x < 0.7 and (q as Vector2).y > 0.4, str(q))


## One fight in a fresh engine: [the CQSEEDED record dictionary or {}, the env info dictionary or {}].
func _fight(cfg: Dictionary) -> Array:
	var out: Array = []
	var args: PackedStringArray = ["--headless", "--path", ProjectSettings.globalize_path("res://"), "--fixed-fps", "30",
		"-s", "res://tools/panel/corpus_fight.gd", "--", "--cfg=" + JSON.stringify(cfg).replace("\"", "\\\"")]
	OS.execute(OS.get_executable_path(), args, out, true)
	var rec: Dictionary = {}
	var env: Dictionary = {}
	for chunk: String in out:
		for l: String in chunk.split("\n"):
			if l.begins_with("CQSEEDED "):
				var v: Variant = JSON.parse_string(l.substr(9))
				rec = _ints(v) if v is Dictionary else {}
			elif l.begins_with("CQ env "):
				var e: Variant = JSON.parse_string(l.substr(7))
				env = e if e is Dictionary else {}
	return [rec, env]


func _ints(v: Variant) -> Variant:
	if v is float and is_equal_approx(v, round(v)) and absf(v) < 1e15:
		return int(v)
	if v is Array:
		var a: Array = []
		for x: Variant in v:
			a.append(_ints(x))
		return a
	if v is Dictionary:
		var d: Dictionary = {}
		for k: Variant in v:
			d[k] = _ints(v[k])
		return d
	return v


func _md5(r: Dictionary) -> String:
	return JSON.stringify(r.get("judge", {}), "", true).md5_text() if not r.is_empty() else "none"


func _fights() -> void:
	var piece: Dictionary = {"env_glb": _glb, "env_thumb": _thumb, "env_name": "Test Shrine", "env_placement": "ground"}
	# table 2, no tier (the low tier): the card, and the pinned record
	var low: Array = _fight({"seed": 239}.merged(piece))
	_check("low_card", str(low[1].get("mode", "")) == "card" and bool(low[1].get("ok", false)), str(low[1]))
	_check("low_record_pinned", _md5(low[0]) == B27_RECORD_239, _md5(low[0]))
	# table 3 with the piece: build 28's five-button record
	var five: Array = _fight({"seed": 239, "rules": PINNED_V3}.merged(piece))
	_check("five_record_pinned", _md5(five[0]) == B28_FIVE_RECORD_239, _md5(five[0]))
	for tier: String in ["mid", "high"]:
		var bare: Array = _fight({"seed": 239, "tier": tier})
		var with: Array = _fight({"seed": 239, "tier": tier}.merged(piece))
		_check(tier + "_model", str(with[1].get("mode", "")) == "model" and bool(with[1].get("ok", false)), str(with[1]))
		_check(tier + "_fought", not bare[0].is_empty() and not with[0].is_empty())
		_check(tier + "_record_unchanged", _md5(bare[0]) == _md5(with[0]), "%s vs %s" % [_md5(bare[0]), _md5(with[0])])
	# a broken model falls back to the card; neither file: nothing
	var broken: Array = _fight({"seed": 239, "tier": "mid", "duration_s": 12}.merged({"env_glb": _broken, "env_thumb": _thumb}))
	_check("broken_glb_card", str(broken[1].get("mode", "")) == "card" and str(broken[1].get("why", "")) == "not a GLB", str(broken[1]))
	var gone: Array = _fight({"seed": 239, "tier": "mid", "duration_s": 12, "env_glb": "/nowhere/x.glb"})
	_check("missing_no_card_nothing", str(gone[1].get("mode", "")) == "none" and not gone[0].is_empty(), str(gone[1]))
	# threaded loading, as on a phone: the fight is fought and the piece stands
	var thr: Array = _fight({"seed": 239, "tier": "high", "duration_s": 12, "load_thread": true}.merged(piece))
	_check("threaded_fight", not thr[0].is_empty() and str(thr[1].get("mode", "")) == "model" and bool(thr[1].get("ok", false)), str(thr[1]))
