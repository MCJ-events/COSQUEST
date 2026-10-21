extends Control
## Portrait HUD and two-thumb touch controls, drawn in one Control (_draw), no theme assets.
## Layout numbers come from the Unity BattleHud (sizes in its 390 pt reference width,
## scaled by PT to this 720 px canvas). Multi-touch: every pointer index has its own role,
## so the stick and a button work at the same time. The mouse is pointer -1 and is ignored
## once any real touch has been seen (no double handling of emulated events).

signal attack_pressed(t_in: float, ticks_in: int, src: String)
signal skill_pressed(slot: int, t_in: float, ticks_in: int, src: String)
signal move_started(t_in: float, ticks_in: int, src: String)

const PT: float = 720.0 / 390.0                       # BattleHud.RefW = 390 pt
const STICK_BASE_R: float = 60.0 * PT                # 120 pt base
const STICK_KNOB_R: float = 25.0 * PT                # 50 pt knob
const STICK_TRAVEL: float = 60.0 * PT                # knob clamp 60 pt
const STICK_DEAD: float = 0.10                       # 10% dead zone
const STICK_HOME: Vector2 = Vector2(78.0, 88.0) * PT # from the bottom-left
const ATTACK_R: float = 0.15 * 720.0 * 0.5           # ATTACK 0.15 of screen width
const SKILL_R: float = 0.10 * 720.0 * 0.5            # skills 0.11 in Unity; 0.10 so five fit the arc
const ATTACK_FROM_BR: Vector2 = Vector2(44.0, 50.0) * PT   # AtkPos (-44, 50) pt from bottom-right
const SKILL_ARC_R: float = 185.0
const SKILL_ANGLES: Array[float] = [90.0, 112.5, 135.0, 157.5, 180.0]
const SKILL_NAMES: Array[String] = ["CHARGE", "SPLIT", "WHIRL", "RALLY", "SHIELD"]
const REAL_SLOT: int = 2
const MAP_R: float = 72.0 * PT * 0.5                 # MapSize 72 pt
const MAP_CENTRE_FROM_TR: Vector2 = Vector2(42.0, 92.0) * PT
const MAP_METRES: float = 32.0                       # MapMetres

# ---- view model, written by fight.gd every frame
var cam: Camera3D
var t_left: float = 45.0
var players_text: String = "2/3 players"
var point_name: String = ""
var loading_text: String = ""
var hero_name: String = "You"
var hero_hp: int = 0
var hero_max: int = 1
var show_hero_card: bool = true
var units: Array[Dictionary] = []      # {name, hp, max, team, head: Vector3, alive}
var map_points: Array[Dictionary] = [] # {p: Vector2 metres (x right, y down-screen), kind: String}
var skill_cd: float = 0.0
var skill_cd_max: float = 6.0
var attack_cd_k: float = 0.0

# ---- input state
var stick: Vector2 = Vector2.ZERO      # x right, y up, length <= 1
var attack_held: bool = false
var _ptrs: Dictionary = {}             # pointer id -> {role, slot}
var _touch_seen: bool = false
var _stick_id: int = -999
var _stick_origin: Vector2 = Vector2.ZERO
var _knob: Vector2 = Vector2.ZERO
var _press: Array[float] = [-1.0, -1.0, -1.0, -1.0, -1.0, -1.0]   # 0 attack, 1..5 skills
var _toast: String = ""
var _toast_t: float = 0.0
var _toast_at: Vector2 = Vector2.ZERO
var _pops: Array[Dictionary] = []
var _banner: String = ""
var _banner_sub: String = ""
var _banner_col: Color = Color.WHITE
var _banner_t: float = 0.0
var _banner_dur: float = 0.0
var _hurt_t: float = 0.0

var _font: Font
var _pill: StyleBoxFlat
var _pill_light: StyleBoxFlat


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = ThemeDB.fallback_font
	_pill = StyleBoxFlat.new()
	_pill.bg_color = Color(0.05, 0.07, 0.12, 0.78)
	_pill.set_corner_radius_all(22)
	_pill_light = StyleBoxFlat.new()
	_pill_light.bg_color = Color(0.86, 0.95, 1.0, 0.92)   # the ice timer pill
	_pill_light.set_corner_radius_all(26)
	_knob = _stick_home()


# ------------------------------------------------------------ layout

func attack_centre() -> Vector2:
	return Vector2(size.x - ATTACK_FROM_BR.x, size.y - ATTACK_FROM_BR.y)


func skill_centre(i: int) -> Vector2:
	var a: float = deg_to_rad(SKILL_ANGLES[i])
	return attack_centre() + Vector2(cos(a), -sin(a)) * SKILL_ARC_R


func _stick_home() -> Vector2:
	return Vector2(STICK_HOME.x, size.y - STICK_HOME.y)


func _map_centre() -> Vector2:
	return Vector2(size.x - MAP_CENTRE_FROM_TR.x, MAP_CENTRE_FROM_TR.y)


# ------------------------------------------------------------ input

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		_touch_seen = true
		var te := make_input_local(event) as InputEventScreenTouch
		if te.pressed:
			_down(te.index, te.position, "touch")
		else:
			_up(te.index)
	elif event is InputEventScreenDrag:
		_touch_seen = true
		var de := make_input_local(event) as InputEventScreenDrag
		_drag(de.index, de.position, "touch")
	elif event is InputEventMouseButton and not _touch_seen:
		var mb := make_input_local(event) as InputEventMouseButton
		if mb.button_index != MOUSE_BUTTON_LEFT:
			return
		if mb.pressed:
			_down(-1, mb.position, "mouse")
		else:
			_up(-1)
	elif event is InputEventMouseMotion and not _touch_seen and _ptrs.has(-1):
		var mm := make_input_local(event) as InputEventMouseMotion
		_drag(-1, mm.position, "mouse")


func _down(id: int, p: Vector2, src: String) -> void:
	var t_in: float = Time.get_unix_time_from_system()
	var ticks: int = Time.get_ticks_usec()
	if p.distance_to(attack_centre()) <= ATTACK_R * 1.2:
		_ptrs[id] = {"role": "attack", "slot": -1}
		_refresh_held()
		_press[0] = 0.0
		attack_pressed.emit(t_in, ticks, src)
		return
	for i in SKILL_ANGLES.size():
		if p.distance_to(skill_centre(i)) <= SKILL_R * 1.15:
			_ptrs[id] = {"role": "skill", "slot": i}
			_press[i + 1] = 0.0
			if i == REAL_SLOT:
				skill_pressed.emit(i, t_in, ticks, src)
			else:
				toast("Locked", skill_centre(i) + Vector2(0, -SKILL_R - 18))
			return
	if p.x < size.x * 0.55 and p.y > size.y * 0.42 and _stick_id == -999:
		_ptrs[id] = {"role": "stick", "slot": -1}
		_stick_id = id
		_stick_origin = p     # floating stick: it spawns where the thumb lands
		_knob = p
		stick = Vector2.ZERO
		return
	_ptrs[id] = {"role": "none", "slot": -1}


func _drag(id: int, p: Vector2, src: String) -> void:
	if not _ptrs.has(id) or id != _stick_id:
		return
	var t_in: float = Time.get_unix_time_from_system()
	var ticks: int = Time.get_ticks_usec()
	var d: Vector2 = p - _stick_origin
	if d.length() > STICK_TRAVEL:
		d = d.normalized() * STICK_TRAVEL
	_knob = _stick_origin + d
	var v: Vector2 = d / STICK_TRAVEL
	if v.length() < STICK_DEAD:
		v = Vector2.ZERO
	_set_stick(Vector2(v.x, -v.y), t_in, ticks, src)


func _up(id: int) -> void:
	if not _ptrs.has(id):
		return
	_ptrs.erase(id)
	if id == _stick_id:
		_stick_id = -999
		stick = Vector2.ZERO
		_knob = _stick_home()
	_refresh_held()


func _refresh_held() -> void:
	attack_held = false
	for k: int in _ptrs:
		if (_ptrs[k] as Dictionary)["role"] == "attack":
			attack_held = true


func _set_stick(v: Vector2, t_in: float, ticks: int, src: String) -> void:
	var was_idle: bool = stick == Vector2.ZERO
	stick = v
	if was_idle and v != Vector2.ZERO:
		move_started.emit(t_in, ticks, src)


## The autoplay bot drives the same paths a thumb does (and the same latency hooks).
func bot_stick(v: Vector2) -> void:
	var t_in: float = Time.get_unix_time_from_system()
	var ticks: int = Time.get_ticks_usec()
	if v.length() < STICK_DEAD:
		v = Vector2.ZERO
	_stick_origin = _stick_home()
	_knob = _stick_origin + Vector2(v.x, -v.y) * STICK_TRAVEL
	_set_stick(v.limit_length(1.0), t_in, ticks, "bot")


func bot_attack() -> void:
	_press[0] = 0.0
	attack_pressed.emit(Time.get_unix_time_from_system(), Time.get_ticks_usec(), "bot")


func bot_skill() -> void:
	_press[REAL_SLOT + 1] = 0.0
	skill_pressed.emit(REAL_SLOT, Time.get_unix_time_from_system(), Time.get_ticks_usec(), "bot")


func release_all() -> void:
	_ptrs.clear()
	_stick_id = -999
	stick = Vector2.ZERO
	attack_held = false
	_knob = _stick_home()


# ------------------------------------------------------------ feedback

func toast(s: String, at: Vector2) -> void:
	_toast = s
	_toast_t = 0.9
	_toast_at = at


func pop(world: Vector3, text: String, col: Color, big: bool) -> void:
	if _pops.size() > 24:
		_pops.remove_at(0)
	_pops.append({"w": world, "t": 0.0, "s": text, "c": col, "big": big, "dx": randf_range(-18.0, 18.0)})


func banner(text: String, sub: String, col: Color, dur: float) -> void:
	_banner = text
	_banner_sub = sub
	_banner_col = col
	_banner_t = 0.0
	_banner_dur = dur


func hurt() -> void:
	_hurt_t = 0.25


func _process(dt: float) -> void:
	# The embedded display (react-native-godot) sizes the window after the HUD is
	# added and the full-rect anchors never hear about it: follow the viewport.
	var vs: Vector2 = get_viewport().get_visible_rect().size
	if size != vs:
		position = Vector2.ZERO
		size = vs
		if _stick_id == -999:
			_knob = _stick_home()
	for i in _press.size():
		if _press[i] >= 0.0:
			_press[i] += dt
			if _press[i] > 0.15:
				_press[i] = -1.0
	if _toast_t > 0.0:
		_toast_t -= dt
	if _hurt_t > 0.0:
		_hurt_t -= dt
	if _banner != "":
		_banner_t += dt
		if _banner_dur > 0.0 and _banner_t > _banner_dur:
			_banner = ""
	var i: int = _pops.size() - 1
	while i >= 0:
		var d: Dictionary = _pops[i]
		d["t"] = float(d["t"]) + dt
		if float(d["t"]) > 0.8:
			_pops.remove_at(i)
		i -= 1
	queue_redraw()


# ------------------------------------------------------------ drawing

func _text(centre: Vector2, s: String, fs: int, col: Color, outline: int = 0) -> void:
	_queue_text(Vector2(centre.x - 400.0, centre.y + fs * 0.36), s, HORIZONTAL_ALIGNMENT_CENTER, 800.0, fs, col, outline)


## Text scaled by a draw transform, so animated sizes do not create new glyph caches per size.
func _text_scaled(centre: Vector2, s: String, fs: int, col: Color, outline: int, k: float) -> void:
	_queue_text(Vector2(-400.0, fs * 0.36), s, HORIZONTAL_ALIGNMENT_CENTER, 800.0, fs, col, outline, Transform2D(0.0, Vector2(k, k), 0.0, centre))


func _text_left(pos: Vector2, s: String, fs: int, col: Color, outline: int = 0) -> void:
	_queue_text(Vector2(pos.x, pos.y + fs * 0.36), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col, outline)


# Text is queued and drawn after every shape, grouped by size and outline: the
# shapes then batch into a few draw calls and each glyph cache texture is bound
# once, instead of one draw call per shape/text switch. On the software-GPU
# emulator every draw call costs, so this is frame time (and input latency).
var _texts: Array = []


func _queue_text(base: Vector2, s: String, align: HorizontalAlignment, w: float, fs: int, col: Color, outline: int, xf: Transform2D = Transform2D.IDENTITY) -> void:
	_texts.append([fs, outline, base, s, align, w, col, xf])


func _flush_texts() -> void:
	_texts.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	# outlines first (they sit under the fill), then the fills
	for pass_i in 2:
		for t in _texts:
			var outline: int = t[1]
			if pass_i == 0 and outline <= 0:
				continue
			var xf: Transform2D = t[7]
			if xf != Transform2D.IDENTITY:
				draw_set_transform_matrix(xf)
			var col: Color = t[6]
			if pass_i == 0:
				draw_string_outline(_font, t[2], t[3], t[4], t[5], t[0], outline, Color(0, 0, 0, col.a * 0.85))
			else:
				draw_string(_font, t[2], t[3], t[4], t[5], t[0], col)
			if xf != Transform2D.IDENTITY:
				draw_set_transform_matrix(Transform2D.IDENTITY)
	_texts.clear()


func _bar(r: Rect2, k: float, fill: Color) -> void:
	draw_rect(r.grow(2.0), Color(0.05, 0.04, 0.08, 0.85))
	draw_rect(Rect2(r.position, Vector2(r.size.x * clampf(k, 0.0, 1.0), r.size.y)), fill)


func _pie(c: Vector2, r: float, k: float, col: Color) -> void:
	# k = remaining fraction, drawn clockwise from 12 o'clock
	if k <= 0.0:
		return
	var pts := PackedVector2Array([c])
	var n: int = maxi(3, int(40.0 * k))
	for j in n + 1:
		var a: float = -PI * 0.5 + TAU * k * float(j) / float(n)
		pts.append(c + Vector2(cos(a), sin(a)) * r)
	draw_colored_polygon(pts, col)


func _draw() -> void:
	_draw_overheads()
	_draw_pops()
	_draw_top()
	_draw_minimap()
	_draw_controls()
	if _hurt_t > 0.0:
		var a: float = _hurt_t / 0.25 * 0.35
		draw_rect(Rect2(Vector2.ZERO, Vector2(size.x, 14)), Color(1, 0.1, 0.1, a))
		draw_rect(Rect2(Vector2(0, size.y - 14), Vector2(size.x, 14)), Color(1, 0.1, 0.1, a))
	if _banner != "":
		var k: float = clampf(_banner_t / 0.15, 0.0, 1.0)
		var y: float = size.y * 0.36
		draw_rect(Rect2(Vector2(0, y - 60), Vector2(size.x, 120)), Color(0, 0, 0, 0.45 * k))
		_text_scaled(Vector2(size.x * 0.5, y - 10), _banner, 64, _banner_col, 10, lerpf(1.3, 1.0, k))
		if _banner_sub != "":
			_text(Vector2(size.x * 0.5, y + 40), _banner_sub, 24, Color(1, 1, 1, 0.9), 6)
	if loading_text != "":
		_text(Vector2(size.x * 0.5, size.y * 0.5), loading_text, 30, Color(1, 1, 1, 0.9), 6)
	_flush_texts()


func _draw_overheads() -> void:
	if cam == null or not cam.is_inside_tree():
		return
	for u: Dictionary in units:
		var head: Vector3 = u["head"]
		if cam.is_position_behind(head):
			continue
		var p: Vector2 = cam.unproject_position(head)
		var w: float = 120.0 if int(u["team"]) == 1 else 104.0
		var fill: Color = Color(0.92, 0.25, 0.22) if int(u["team"]) == 1 else (Color(0.35, 0.92, 0.42) if bool(u["is_hero"]) else Color(0.35, 0.8, 0.95))
		var k: float = float(u["hp"]) / maxf(1.0, float(u["max"]))
		_bar(Rect2(p + Vector2(-w * 0.5, 0), Vector2(w, 12)), k, fill)
		_text(p + Vector2(0, -16), str(u["name"]), 22, Color.WHITE, 6)


func _draw_pops() -> void:
	if cam == null or not cam.is_inside_tree():
		return
	for d: Dictionary in _pops:
		var w: Vector3 = d["w"]
		if cam.is_position_behind(w):
			continue
		var t: float = d["t"]
		var p: Vector2 = cam.unproject_position(w) + Vector2(float(d["dx"]), -70.0 * ease(t / 0.8, 0.5))
		var c: Color = d["c"]
		c.a = 1.0 - clampf((t - 0.5) / 0.3, 0.0, 1.0)
		var big: bool = d["big"]
		_text_scaled(p, str(d["s"]), 40 if big else 30, c, 8, 1.0 + 0.4 * maxf(0.0, 1.0 - t / 0.1))


func _draw_top() -> void:
	var cx: float = size.x * 0.5
	# timer pill (ice) and the squad pill, top centre
	var tr := Rect2(Vector2(cx - 80, 34), Vector2(160, 60))
	draw_style_box(_pill_light, tr)
	var secs: int = int(ceil(maxf(t_left, 0.0)))
	var ink: Color = Color(0.1, 0.16, 0.3) if secs > 10 else Color(0.85, 0.1, 0.1)
	_text(tr.get_center(), "%d:%02d" % [secs / 60, secs % 60], 42, ink)
	var pr := Rect2(Vector2(cx - 88, 102), Vector2(176, 38))
	draw_style_box(_pill, pr)
	_text(pr.get_center(), players_text, 22, Color(0.94, 0.93, 0.98))
	if point_name != "":
		_text(Vector2(cx, 160), point_name, 18, Color(1, 1, 1, 0.85), 5)
	# hero card, top left
	if show_hero_card:
		var hr := Rect2(Vector2(18, 30), Vector2(220, 70))
		draw_style_box(_pill, hr)
		_text_left(hr.position + Vector2(16, 20), hero_name, 24, Color.WHITE)
		_bar(Rect2(hr.position + Vector2(16, 40), Vector2(188, 14)), float(hero_hp) / maxf(1.0, float(hero_max)), Color(0.35, 0.92, 0.42))
		_text_left(hr.position + Vector2(16, 64), "%d / %d" % [hero_hp, hero_max], 14, Color(1, 1, 1, 0.8))


func _draw_minimap() -> void:
	var c: Vector2 = _map_centre()
	draw_circle(c, MAP_R + 4, Color(1, 1, 1, 0.6))
	draw_circle(c, MAP_R, Color(0.15, 0.13, 0.23, 0.88))
	var k: float = (MAP_R * 2.0 / 0.9) / MAP_METRES
	# the plaza outline
	draw_arc(c, minf(12.0 * k, MAP_R - 3), 0, TAU, 40, Color(1, 1, 1, 0.25), 2.0)
	for m: Dictionary in map_points:
		var v: Vector2 = (m["p"] as Vector2) * k   # metres, already turned so up = camera forward
		v = v.limit_length(MAP_R - 6)
		var kind: String = m["kind"]
		var col: Color = Color(0.35, 0.92, 0.42)
		var r: float = 8.0
		if kind == "ally":
			col = Color(0.35, 0.8, 0.95)
			r = 6.0
		elif kind == "enemy":
			col = Color(0.95, 0.25, 0.22)
			r = 8.0
		draw_circle(c + v, r + 2, Color(0, 0, 0, 0.6))
		draw_circle(c + v, r, col)


func _draw_controls() -> void:
	# stick (rests dimmed at home while no thumb is down)
	var active: bool = _stick_id != -999 or stick != Vector2.ZERO
	var base_c: Vector2 = _stick_origin if active else _stick_home()
	var knob_c: Vector2 = _knob if active else _stick_home()
	var a: float = 1.0 if active else 0.6
	draw_circle(base_c, STICK_BASE_R, Color(0.05, 0.07, 0.12, 0.35 * a))
	draw_arc(base_c, STICK_BASE_R, 0, TAU, 48, Color(1, 1, 1, 0.55 * a), 3.0, true)
	draw_circle(knob_c, STICK_KNOB_R, Color(1, 1, 1, 0.85 * a))
	# attack
	var ac: Vector2 = attack_centre()
	var s0: float = 0.9 if _press[0] >= 0.0 else 1.0
	draw_circle(ac, ATTACK_R * s0, Color(0.85, 0.42, 0.18, 0.92))
	draw_arc(ac, ATTACK_R * s0, 0, TAU, 48, Color(1, 1, 1, 0.9), 4.0, true)
	if attack_cd_k > 0.0:
		_pie(ac, ATTACK_R * s0, attack_cd_k, Color(0, 0, 0, 0.25))
	_text(ac, "ATTACK", 22, Color.WHITE, 5)
	# skills
	for i in SKILL_ANGLES.size():
		var c: Vector2 = skill_centre(i)
		var s: float = 0.9 if _press[i + 1] >= 0.0 else 1.0
		var r: float = SKILL_R * s
		if i == REAL_SLOT:
			draw_circle(c, r, Color(0.14, 0.18, 0.27, 0.92))
			draw_arc(c, r, 0, TAU, 40, Color(1.0, 0.85, 0.35, 0.95), 3.0, true)
			if skill_cd > 0.0:
				_pie(c, r, skill_cd / maxf(skill_cd_max, 0.01), Color(0, 0, 0, 0.6))
				_text(c, "%d" % int(ceil(skill_cd)), 30, Color.WHITE, 6)
			else:
				_text(c, SKILL_NAMES[i], 17, Color.WHITE, 4)
		else:
			draw_circle(c, r, Color(0.2, 0.2, 0.22, 0.55))
			draw_arc(c, r, 0, TAU, 40, Color(1, 1, 1, 0.25), 2.0, true)
			_text(c + Vector2(0, 14), SKILL_NAMES[i], 13, Color(1, 1, 1, 0.4))
			_lock(c + Vector2(0, -8), Color(1, 1, 1, 0.55))
	if _toast_t > 0.0:
		_text(_toast_at, _toast, 22, Color(1, 1, 1, clampf(_toast_t / 0.3, 0.0, 1.0)), 6)


func _lock(c: Vector2, col: Color) -> void:
	draw_rect(Rect2(c + Vector2(-9, -3), Vector2(18, 13)), col)
	draw_arc(c + Vector2(0, -3), 6.0, PI, TAU, 12, col, 3.0)
