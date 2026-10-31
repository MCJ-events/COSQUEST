extends SceneTree
## The real place round a fight (cq 019, docs/game3d/PLACE.md):
##   godot --headless --path app/game3d -s res://tests/place_test.gd
## Builds Trafalgar Square from tests/fixtures/trafalgar_ground.json (OpenStreetMap, made by
## costquest-backend tools/arena/osm_ground.py) with the fight between the column and the fountains:
## the camera faces Nelson's Column, nothing is built in the fight's area or the camera's way, the
## minimap gets the real footprints, and it builds well under a second.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const PlaceScript := preload("res://place.gd")
const ArenaScript := preload("res://arena.gd")

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	var ground: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/trafalgar_ground.json"))
	var p: Node3D = PlaceScript.new()
	root.add_child(p)
	p.call("build", ground, Vector2(4.9, -4.0), 12.0, NAN, ArenaScript.look_opts({}), Callable())
	var info: Dictionary = p.get("info")
	_check("landmark_is_the_column", str(info.get("landmark", "")) == "Nelson's Column", str(info.get("landmark")))
	var at: Vector3 = info.get("landmark_at", Vector3.ZERO)
	# ahead of the camera (its forward is -z turned 12 degrees), 15 to 30 m out
	var fwd: Vector2 = Vector2(-sin(deg_to_rad(12.0)), -cos(deg_to_rad(12.0)))
	var rel: Vector2 = Vector2(at.x, at.z)
	_check("landmark_ahead", rel.normalized().dot(fwd) > 0.99 and rel.length() > 15.0 and rel.length() < 30.0, str(rel))
	_check("built", int(info.get("buildings", 0)) > 100 and int(info.get("trees", 0)) > 50 and int(info.get("roads", 0)) > 50, str(info))
	_check("build_under_1s", float(info.get("ms", 9999.0)) < 1000.0, str(info.get("ms")))
	var clear: Rect2 = PlaceScript.CLEAR
	var hit: int = 0
	for r: Rect2 in p.get("map_blocks"):
		if r.intersects(clear):
			hit += 1
	_check("fight_area_clear", hit == 0, "%d footprints in the fight's area" % hit)
	_check("minimap_blocks", (p.get("map_blocks") as Array).size() == int(info.get("buildings", -1)))
	# the same ground with the point off to the side of the square still faces a landmark
	var p2: Node3D = PlaceScript.new()
	root.add_child(p2)
	p2.call("build", ground, Vector2(40.0, 30.0), 12.0, NAN, ArenaScript.look_opts({}), Callable())
	_check("another_spot_faces_something", str((p2.get("info") as Dictionary).get("landmark_kind", "")) != "")
	print("CQTEST done failures=%d" % _fails)
	quit(0 if _fails == 0 else 1)
