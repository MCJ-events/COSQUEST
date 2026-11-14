extends RefCounted
## fid29 (audit B4, owned by fid29-lightcam; docs/game3d/fid29/COMMON.md): shader warm-up under the loading card.
## The Compatibility renderer compiles a material's shader variant on its first draw, so a material first seen at
## the hero's intro beat hitched there. Lanes register the materials they add with ShaderWarm.add(material);
## fight.gd calls ShaderWarm.warm(fight) once the fighters are loaded, before the first frame the player sees.
## fid29-base: the registry is emptied and nothing is drawn (no lane registers yet).

static var _mats: Array[Material] = []
static var last: Dictionary = {}     # what the last warm() did (tests, logs)


## A lane's material, to be drawn once before the fight shows. Null and repeats are ignored.
static func add(m: Material) -> void:
	if m != null and not _mats.has(m):
		_mats.append(m)


static func registered() -> Array[Material]:
	return _mats.duplicate()


static func clear() -> void:
	_mats.clear()


static func warm(_host: Node) -> void:
	last = {"registered": _mats.size(), "drawn": 0}
	_mats.clear()
