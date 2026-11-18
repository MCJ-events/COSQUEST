extends Area3D
## A hitbox (cq 233): an Area3D that, while open, reports every hurtbox it overlaps, once
## per opening. Hurtboxes are plain Area3Ds on a fighter with meta "fighter". The weapon
## arc is one of these on a pivot that the fight sweeps through the swing; skills, the
## boss's strikes and the ally's bolts use their own.
## Layers: 1 hero-side hurtboxes, 2 enemy hurtboxes. A hitbox masks the other side's layer.

signal struck(target: Node3D, area: Area3D)

const LAYER_HERO_HURT: int = 1
const LAYER_ENEMY_HURT: int = 2

var info: Dictionary = {}       # what the fight needs to resolve the hit (attack kind, damage, knockback)
var active: bool = false
var _hit: Dictionary = {}
var shape_node: CollisionShape3D
## realism round 3: when one opening overlaps several hurtboxes, the physics server lists them in an order
## that changes with how long it has been running (its tree is re-balanced a little every tick), so which
## fighter a strike reports first, and with it the fight's random rolls, depended on how many frames passed
## before the fight began (measured: a fight started 10 frames late and one started 64 frames late gave
## different records in build 21). With `ordered` (fight.gd, look "hit_order") the hurtboxes found together
## are reported in the fighters' own order in the scene, whatever the server's order.
static var ordered: bool = false


static func hurt_layer(team: int) -> int:
	return LAYER_HERO_HURT if team == 0 else LAYER_ENEMY_HURT


func setup(target_team: int, shape: Shape3D) -> void:
	collision_layer = 0
	collision_mask = hurt_layer(target_team)
	monitorable = false
	monitoring = true
	shape_node = CollisionShape3D.new()
	shape_node.shape = shape
	add_child(shape_node)


func open(i: Dictionary) -> void:
	info = i
	_hit.clear()
	active = true


func close() -> void:
	active = false


## Checks for hurtboxes under this Area3D's shape right now: an immediate shape query of
## the area's own shape at its current transform (areas only, this hitbox's mask). Unlike
## get_overlapping_areas() it does not lag a physics step, so a hitbox opened, moved and
## closed between two physics steps (a fast swing on a 15 fps phone) still lands.
func scan() -> void:
	if not active or shape_node == null or shape_node.shape == null or not is_inside_tree():
		return
	var space: PhysicsDirectSpaceState3D = get_world_3d().direct_space_state
	if space == null:
		return
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = shape_node.shape
	q.transform = shape_node.global_transform
	q.collision_mask = collision_mask
	q.collide_with_areas = true
	q.collide_with_bodies = false
	var found: Array[Area3D] = []
	for r: Dictionary in space.intersect_shape(q, 16):
		var a: Object = r.get("collider")
		if a is Area3D:
			found.append(a as Area3D)
	_consider_all(found)


func _consider_all(found: Array[Area3D]) -> void:
	if ordered and found.size() > 1:
		found.sort_custom(func(x: Area3D, y: Area3D) -> bool: return _order_key(x) < _order_key(y))
	for a: Area3D in found:
		_consider(a)


static func _order_key(a: Area3D) -> int:
	var f: Variant = a.get_meta("fighter", null)
	return (f as Node).get_index() if f != null and is_instance_valid(f) else 1 << 30


func _consider(a: Area3D) -> void:
	var f: Variant = a.get_meta("fighter", null)
	if f == null or not is_instance_valid(f):
		return
	var id: int = (f as Node).get_instance_id()
	if _hit.has(id):
		return
	if bool((f as Node).get("dead")):
		return
	_hit[id] = true
	struck.emit(f, self)


func _physics_process(_dt: float) -> void:
	# the physics server's own overlap list as a second path (same once-per-opening rule)
	if not active:
		return
	_consider_all(get_overlapping_areas())


func hit_count() -> int:
	return _hit.size()
