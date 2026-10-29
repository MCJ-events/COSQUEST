extends Control
## Portrait HUD and two-thumb touch controls (cq 061, reworked in cq 233), drawn in one
## Control (_draw) from the project's CC0 HUD kit (art/hud, the reference icon sheet's own
## set) and Lilita One (OFL). Multi-touch: every pointer index has its own role, so the stick
## and a button work at the same time. The mouse is pointer -1 and is ignored once any real
## touch has been seen (no double handling of emulated events).
##
## Controls: joystick bottom left (ring, thumb, dead zone; camera-relative in fight.gd),
## ATTACK bottom right (tap or hold; 3-hit combo pips), 5 skills on an arc round it
## (icons, radial cooldown sweep, seconds left, disabled state), GUARD beside them (hold to
## block; press just before a hit to parry; press while the stick is pushed to dodge).

signal attack_pressed(t_in: float, ticks_in: int, src: String)
signal skill_pressed(slot: int, t_in: float, ticks_in: int, src: String)
signal move_started(t_in: float, ticks_in: int, src: String)
signal guard_changed(on: bool, t_in: float, ticks_in: int, src: String)

const T_STICK_BASE := preload("res://art/hud/stick_base.png")
const T_STICK_KNOB := preload("res://art/hud/stick_knob.png")
const T_BTN_BASE := preload("res://art/hud/btn_base.png")
const T_BTN_RING := preload("res://art/hud/btn_ring.png")
const T_BTN_ULT := preload("res://art/hud/btn_ring_ult.png")
const T_ATTACK := preload("res://art/hud/icon_attack.png")
const T_GUARD := preload("res://art/hud/icon_guard.png")
const T_PERSON := preload("res://art/hud/icon_person.png")
const T_MAP_FRAME := preload("res://art/hud/minimap_frame.png")
const T_PILL_TIMER := preload("res://art/hud/pill_timer.png")
const T_PILL_SQUAD := preload("res://art/hud/pill_squad.png")
const SKILL_ICONS: Array[Texture2D] = [
	preload("res://art/hud/icon_dodge.png"),            # CHARGE: the dash chevrons
	preload("res://art/hud/icon_ultimate.png"),         # SPLIT: the sword into the ground ring
	preload("res://art/hud/icon_skill_shockwave.png"),  # WHIRL: the golden ring
	preload("res://art/hud/coin_heal.png"),             # RALLY
	preload("res://art/hud/coin_shield.png"),           # SHIELD
]
const SKILL_ICONS_OFF: Array = [null, null, null, preload("res://art/hud/coin_heal_off.png"), preload("res://art/hud/coin_shield_off.png")]
const FONT := preload("res://art/fonts/LilitaOne-Regular.ttf")

const STICK_BASE_R: float = 86.0
const STICK_KNOB_R: float = 38.0
const STICK_TRAVEL: float = 70.0
const STICK_DEAD: float = 0.12                       # 12% dead zone
const STICK_HOME_FROM_BL: Vector2 = Vector2(150.0, 205.0)
const ATTACK_R: float = 62.0
const SKILL_R: float = 37.0
const GUARD_R: float = 33.0
const ATTACK_FROM_BR: Vector2 = Vector2(98.0, 150.0)
const SKILL_ARC_R: float = 150.0
const SKILL_ANGLES: Array[float] = [72.0, 104.0, 136.0, 168.0, 200.0]
const SKILL_NAMES: Array[String] = ["CHARGE", "SPLIT", "WHIRL", "RALLY", "SHIELD"]
const GUARD_FROM_ATTACK: Vector2 = Vector2(-10.0, -165.0) # unused when the arc is full; see guard_centre()
const REAL_SLOT: int = 2
const MAP_R: float = 76.0
const MAP_CENTRE_FROM_TR: Vector2 = Vector2(96.0, 118.0)
const MAP_METRES: float = 30.0

const C_HERO: Color = Color(0.42, 0.93, 0.38)
const C_ALLY: Color = Color(0.36, 0.86, 0.98)
const C_ENEMY: Color = Color(0.72, 0.36, 0.95)

# ---- view model, written by fight.gd every frame
var cam: Camera3D
var t_left: float = 45.0
var players_text: String = "2/3"
var point_name: String = ""
var loading_text: String = ""
var hero_name: String = "You"
var hero_hp: int = 0
var hero_max: int = 1
var show_hero_card: bool = true
var units: Array[Dictionary] = []      # {id, name, hp, max, team, head: Vector3, is_hero, shield, buff, stagger, level}
var map_points: Array[Dictionary] = [] # {p: Vector2 metres (x right, y down-screen), kind, facing: Vector2}
var skill_cd: Array[float] = [0.0, 0.0, 0.0, 0.0, 0.0]
var skill_cd_max: Array[float] = [5.0, 8.0, 6.0, 14.0, 12.0]
var skill_ok: Array[bool] = [true, true, true, true, true]   # castable now (not busy, alive)
var attack_cd_k: float = 0.0
var combo_step: int = 0                # 0..3 swings landed in the current chain
var guard_on: bool = false
var buff_t: float = 0.0
var enemy_label: String = ""           # "ENRAGED" / "STAGGERED" under the boss bar

# ---- input state
var stick: Vector2 = Vector2.ZERO      # x right, y up, length <= 1
var attack_held: bool = false
var guard_held: bool = false
var _ptrs: Dictionary = {}             # pointer id -> {role, slot}
var _touch_seen: bool = false
var _stick_id: int = -999
var _stick_origin: Vector2 = Vector2.ZERO
var _knob: Vector2 = Vector2.ZERO
var _press: Array[float] = [-1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0]   # 0 attack, 1..5 skills, 6 guard
var _ready_pulse: Array[float] = [-1.0, -1.0, -1.0, -1.0, -1.0]
var _was_cd: Array[bool] = [false, false, false, false, false]
var _toast: String = ""
var _toast_t: float = 0.0
var _toast_at: Vector2 = Vector2.ZERO
var _pops: Array[Dictionary] = []
var _pop_side: float = 1.0
var _callout: String = ""
var _callout_col: Color = Color.WHITE
var _callout_t: float = 0.0
var _banner: String = ""
var _banner_sub: String = ""
var _banner_col: Color = Color.WHITE
var _banner_t: float = 0.0
var _banner_dur: float = 0.0
var _hurt_t: float = 0.0
var _clock: float = 0.0
var _chip: Dictionary = {}             # unit id -> trailing fraction (the chip-away)
var _chip_hold: Dictionary = {}        # unit id -> seconds before the chip starts falling
var _last_k: Dictionary = {}

var _font: Font
var _pill: StyleBoxFlat
var _card: StyleBoxFlat


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = FONT
	_pill = StyleBoxFlat.new()
	_pill.bg_color = Color(0.09, 0.08, 0.16, 0.82)
	_pill.set_corner_radius_all(20)
	_pill.border_color = Color(1, 1, 1, 0.18)
	_pill.set_border_width_all(2)
	_card = StyleBoxFlat.new()
	_card.bg_color = Color(0.09, 0.08, 0.16, 0.78)
	_card.set_corner_radius_all(16)
	_card.border_color = Color(1, 1, 1, 0.16)
	_card.set_border_width_all(2)
	_knob = _stick_home()


# ------------------------------------------------------------ layout

func attack_centre() -> Vector2:
	return Vector2(size.x - ATTACK_FROM_BR.x, size.y - ATTACK_FROM_BR.y)


func skill_centre(i: int) -> Vector2:
	var a: float = deg_to_rad(SKILL_ANGLES[i])
	return attack_centre() + Vector2(cos(a), -sin(a)) * SKILL_ARC_R


func guard_centre() -> Vector2:
	# under the skill arc's last button, towards the middle of the screen
	return attack_centre() + Vector2(-SKILL_ARC_R - 92.0, 62.0)


func _stick_home() -> Vector2:
	return Vector2(STICK_HOME_FROM_BL.x, size.y - STICK_HOME_FROM_BL.y)


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
		if p.distance_to(skill_centre(i)) <= SKILL_R * 1.2:
			_ptrs[id] = {"role": "skill", "slot": i}
			_press[i + 1] = 0.0
			skill_pressed.emit(i, t_in, ticks, src)
			return
	if p.distance_to(guard_centre()) <= GUARD_R * 1.35:
		_ptrs[id] = {"role": "guard", "slot": -1}
		_press[6] = 0.0
		_refresh_held()
		guard_changed.emit(true, t_in, ticks, src)
		return
	if p.x < size.x * 0.55 and p.y > size.y * 0.42 and _stick_id == -999:
		_ptrs[id] = {"role": "stick", "slot": -1}
		_stick_id = id
		if p.distance_to(_stick_home()) <= STICK_BASE_R * 1.1:
			# On the drawn stick: its centre is the origin, so the thumb's first
			# touch already steers (no wait for the first drag event, which
			# Android batches to the next vsync).
			_stick_origin = _stick_home()
			_drag(id, p, src)
		else:
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
	# dead zone, then rescaled so just past it is a slow walk, not a jump to 12%
	var l: float = v.length()
	if l < STICK_DEAD:
		v = Vector2.ZERO
	else:
		v = v / l * ((l - STICK_DEAD) / (1.0 - STICK_DEAD))
	_set_stick(Vector2(v.x, -v.y), t_in, ticks, src)


func _up(id: int) -> void:
	if not _ptrs.has(id):
		return
	var was: Dictionary = _ptrs[id]
	_ptrs.erase(id)
	if id == _stick_id:
		_stick_id = -999
		stick = Vector2.ZERO
		_knob = _stick_home()
	_refresh_held()
	if str(was.get("role", "")) == "guard" and not guard_held:
		guard_changed.emit(false, Time.get_unix_time_from_system(), Time.get_ticks_usec(), "touch")


func _refresh_held() -> void:
	attack_held = false
	guard_held = false
	for k: int in _ptrs:
		var r: String = (_ptrs[k] as Dictionary)["role"]
		if r == "attack":
			attack_held = true
		elif r == "guard":
			guard_held = true


func _set_stick(v: Vector2, t_in: float, ticks: int, src: String) -> void:
	var was_idle: bool = stick == Vector2.ZERO
	stick = v
	if was_idle and v != Vector2.ZERO:
		move_started.emit(t_in, ticks, src)


## The autoplay bot and the capture timeline drive the same paths a thumb does.
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


func bot_attack_hold(on: bool) -> void:
	attack_held = on
	if on:
		bot_attack()


func bot_skill() -> void:
	bot_skill_slot(REAL_SLOT)


func bot_skill_slot(i: int) -> void:
	_press[i + 1] = 0.0
	skill_pressed.emit(i, Time.get_unix_time_from_system(), Time.get_ticks_usec(), "bot")


func bot_guard(on: bool) -> void:
	if on == guard_held:
		return
	guard_held = on
	if on:
		_press[6] = 0.0
	guard_changed.emit(on, Time.get_unix_time_from_system(), Time.get_ticks_usec(), "bot")


func release_all() -> void:
	_ptrs.clear()
	_stick_id = -999
	stick = Vector2.ZERO
	attack_held = false
	if guard_held:
		guard_held = false
		guard_changed.emit(false, Time.get_unix_time_from_system(), Time.get_ticks_usec(), "release")
	_knob = _stick_home()


# ------------------------------------------------------------ feedback

func toast(s: String, at: Vector2) -> void:
	_toast = s
	_toast_t = 0.9
	_toast_at = at


## A floating number or word over a fighter. style: normal | heavy | crit | blocked |
## absorbed | heal | hurt | parry | dodge | ally
func pop(world: Vector3, text: String, style: String) -> void:
	if _pops.size() > 24:
		_pops.remove_at(0)
	# numbers fan out to alternate sides of the head so a combo does not stack on one spot
	_pop_side = -_pop_side
	_pops.append({"w": world, "t": 0.0, "s": text, "style": style, "dx": _pop_side * randf_range(30.0, 70.0), "dy": randf_range(-10.0, 14.0)})


func callout(text: String, col: Color) -> void:
	_callout = text
	_callout_col = col
	_callout_t = 0.0


func banner(text: String, sub: String, col: Color, dur: float) -> void:
	_banner = text
	_banner_sub = sub
	_banner_col = col
	_banner_t = 0.0
	_banner_dur = dur


func hurt() -> void:
	_hurt_t = 0.3


func _process(dt: float) -> void:
	# The embedded display (react-native-godot) sizes the window after the HUD is
	# added and the full-rect anchors never hear about it: follow the viewport.
	var vs: Vector2 = get_viewport().get_visible_rect().size
	if size != vs:
		position = Vector2.ZERO
		size = vs
		if _stick_id == -999:
			_knob = _stick_home()
	_clock += dt
	for i in _press.size():
		if _press[i] >= 0.0:
			_press[i] += dt
			if _press[i] > 0.3:
				_press[i] = -1.0
	for i in 5:
		var on_cd: bool = skill_cd[i] > 0.0
		if _was_cd[i] and not on_cd:
			_ready_pulse[i] = 0.0
		_was_cd[i] = on_cd
		if _ready_pulse[i] >= 0.0:
			_ready_pulse[i] += dt
			if _ready_pulse[i] > 0.5:
				_ready_pulse[i] = -1.0
	if _toast_t > 0.0:
		_toast_t -= dt
	if _hurt_t > 0.0:
		_hurt_t -= dt
	_callout_t += dt
	if _banner != "":
		_banner_t += dt
		if _banner_dur > 0.0 and _banner_t > _banner_dur:
			_banner = ""
	var i: int = _pops.size() - 1
	while i >= 0:
		var d: Dictionary = _pops[i]
		d["t"] = float(d["t"]) + dt
		if float(d["t"]) > 0.95:
			_pops.remove_at(i)
		i -= 1
	# health chip-away: the trailing part waits a moment, then slides down
	for u: Dictionary in units:
		var id: int = int(u.get("id", 0))
		var k: float = float(u["hp"]) / maxf(1.0, float(u["max"]))
		var prev: float = float(_last_k.get(id, k))
		if k < prev - 0.0001:
			_chip_hold[id] = 0.45
			if not _chip.has(id):
				_chip[id] = prev
		_last_k[id] = k
		var c: float = float(_chip.get(id, k))
		if float(_chip_hold.get(id, 0.0)) > 0.0:
			_chip_hold[id] = float(_chip_hold[id]) - dt
		else:
			c = move_toward(c, k, dt * 0.6)
		_chip[id] = maxf(c, k)
	queue_redraw()


# ------------------------------------------------------------ drawing helpers

func _text(centre: Vector2, s: String, fs: int, col: Color, outline: int = 0, ocol: Color = Color(0, 0, 0, 0)) -> void:
	_queue_text(Vector2(centre.x - 400.0, centre.y + fs * 0.36), s, HORIZONTAL_ALIGNMENT_CENTER, 800.0, fs, col, outline, Transform2D.IDENTITY, ocol)


## Text scaled by a draw transform, so animated sizes do not create new glyph caches per size.
func _text_scaled(centre: Vector2, s: String, fs: int, col: Color, outline: int, k: float, ocol: Color = Color(0, 0, 0, 0)) -> void:
	_queue_text(Vector2(-400.0, fs * 0.36), s, HORIZONTAL_ALIGNMENT_CENTER, 800.0, fs, col, outline, Transform2D(0.0, Vector2(k, k), 0.0, centre), ocol)


func _text_left(pos: Vector2, s: String, fs: int, col: Color, outline: int = 0) -> void:
	_queue_text(Vector2(pos.x, pos.y + fs * 0.36), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col, outline)


# Text is queued and drawn after every shape, grouped by size and outline: the
# shapes then batch into a few draw calls and each glyph cache texture is bound
# once, instead of one draw call per shape/text switch. On the software-GPU
# emulator every draw call costs, so this is frame time (and input latency).
var _texts: Array = []


func _queue_text(base: Vector2, s: String, align: HorizontalAlignment, w: float, fs: int, col: Color, outline: int, xf: Transform2D = Transform2D.IDENTITY, ocol: Color = Color(0, 0, 0, 0)) -> void:
	if ocol.a <= 0.0:
		ocol = Color(0.05, 0.03, 0.08, col.a * 0.9)
	_texts.append([fs, outline, base, s, align, w, col, xf, ocol])


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
				draw_string_outline(_font, t[2], t[3], t[4], t[5], t[0], outline, t[8])
			else:
				draw_string(_font, t[2], t[3], t[4], t[5], t[0], col)
			if xf != Transform2D.IDENTITY:
				draw_set_transform_matrix(Transform2D.IDENTITY)
	_texts.clear()


func _tex(t: Texture2D, c: Vector2, r: float, mod: Color = Color.WHITE) -> void:
	draw_texture_rect(t, Rect2(c - Vector2(r, r), Vector2(r, r) * 2.0), false, mod)


func _rbar(r: Rect2, k: float, fill: Color, chip: float = -1.0, shield: float = 0.0) -> void:
	# a rounded bar: dark back, a light chip trailing the fill, the fill, a gloss line
	var back := Color(0.06, 0.04, 0.1, 0.88)
	draw_rect(r.grow(2.5), back)
	if chip > k:
		draw_rect(Rect2(r.position + Vector2(r.size.x * k, 0), Vector2(r.size.x * (clampf(chip, 0, 1) - k), r.size.y)), Color(1.0, 0.95, 0.75, 0.95))
	var fw: float = r.size.x * clampf(k, 0.0, 1.0)
	draw_rect(Rect2(r.position, Vector2(fw, r.size.y)), fill)
	draw_rect(Rect2(r.position, Vector2(fw, r.size.y * 0.38)), Color(1, 1, 1, 0.22))
	if shield > 0.0:
		draw_rect(Rect2(r.position + Vector2(0, -5), Vector2(r.size.x * clampf(shield, 0.0, 1.0), 4)), Color(0.55, 0.85, 1.0, 0.95))


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
		var a: float = _hurt_t / 0.3 * 0.4
		for j in 4:
			var w: float = 26.0 - j * 6.0
			var col := Color(1, 0.08, 0.08, a * (0.25 + j * 0.2))
			draw_rect(Rect2(Vector2.ZERO, Vector2(size.x, w)), col)
			draw_rect(Rect2(Vector2(0, size.y - w), Vector2(size.x, w)), col)
			draw_rect(Rect2(Vector2.ZERO, Vector2(w, size.y)), col)
			draw_rect(Rect2(Vector2(size.x - w, 0), Vector2(w, size.y)), col)
	if _callout != "" and _callout_t < 0.9:
		var ka: float = 1.0 - clampf((_callout_t - 0.6) / 0.3, 0.0, 1.0)
		var kp: float = 1.0 + 0.5 * maxf(0.0, 1.0 - _callout_t / 0.12)
		var cc := _callout_col
		cc.a = ka
		_text_scaled(Vector2(size.x * 0.5, size.y * 0.27), _callout, 56, cc, 12, kp, Color(0.12, 0.04, 0.1, ka))
	if _banner != "":
		var k: float = clampf(_banner_t / 0.15, 0.0, 1.0)
		var y: float = size.y * 0.36
		draw_rect(Rect2(Vector2(0, y - 70), Vector2(size.x, 140)), Color(0.04, 0.02, 0.08, 0.55 * k))
		draw_rect(Rect2(Vector2(0, y - 72), Vector2(size.x, 3)), Color(_banner_col.r, _banner_col.g, _banner_col.b, 0.8 * k))
		draw_rect(Rect2(Vector2(0, y + 69), Vector2(size.x, 3)), Color(_banner_col.r, _banner_col.g, _banner_col.b, 0.8 * k))
		_text_scaled(Vector2(size.x * 0.5, y - 12), _banner, 72, _banner_col, 14, lerpf(1.4, 1.0, k))
		if _banner_sub != "":
			_text(Vector2(size.x * 0.5, y + 42), _banner_sub, 26, Color(1, 1, 1, 0.92), 6)
	if loading_text != "":
		_text(Vector2(size.x * 0.5, size.y * 0.5), loading_text, 30, Color(1, 1, 1, 0.9), 6)
	_flush_texts()


# ------------------------------------------------------------ overheads

func _draw_overheads() -> void:
	if cam == null or not cam.is_inside_tree():
		return
	# lay the labels out first, then nudge overlapping ones apart (names never collide)
	var boxes: Array[Dictionary] = []
	for u: Dictionary in units:
		var head: Vector3 = u["head"]
		if cam.is_position_behind(head):
			continue
		var p: Vector2 = cam.unproject_position(head)
		var boss: bool = int(u["team"]) == 1
		var w: float = 150.0 if boss else 108.0
		boxes.append({"u": u, "p": p, "w": w, "boss": boss})
	boxes.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return (a["p"] as Vector2).y > (b["p"] as Vector2).y)
	for i in boxes.size():
		for j in i:
			var a: Dictionary = boxes[i]
			var b: Dictionary = boxes[j]
			var pa: Vector2 = a["p"]
			var pb: Vector2 = b["p"]
			if absf(pa.x - pb.x) < (float(a["w"]) + float(b["w"])) * 0.5 + 6.0 and absf(pa.y - pb.y) < 44.0:
				a["p"] = Vector2(pa.x, pb.y - 44.0)
	for bx: Dictionary in boxes:
		var u: Dictionary = bx["u"]
		var p: Vector2 = bx["p"]
		var boss: bool = bx["boss"]
		var w: float = bx["w"]
		var id: int = int(u.get("id", 0))
		var fill: Color = C_ENEMY if boss else (C_HERO if bool(u["is_hero"]) else C_ALLY)
		var k: float = float(u["hp"]) / maxf(1.0, float(u["max"]))
		if float(u["hp"]) <= 0.0:
			continue
		var h: float = 13.0 if boss else 11.0
		var r := Rect2(p + Vector2(-w * 0.5, 0), Vector2(w, h))
		_rbar(r, k, fill, float(_chip.get(id, k)), float(u.get("shield", 0.0)))
		if not boss:
			# level badge, as on the reference's hero bar
			var bc: Vector2 = r.position + Vector2(-12, h * 0.5)
			draw_circle(bc, 12.0, Color(0.1, 0.07, 0.14, 0.95))
			draw_circle(bc, 10.0, Color(0.95, 0.72, 0.25))
			_text(bc + Vector2(0, -1), str(int(u.get("level", 1))), 14, Color(0.25, 0.12, 0.02))
		var name_col: Color = Color(0.86, 0.72, 1.0) if boss else (Color(0.72, 1.0, 0.62) if bool(u["is_hero"]) else Color(0.7, 0.93, 1.0))
		_text(p + Vector2(0, -15), str(u["name"]), 22 if boss else 19, name_col, 6)
		if float(u.get("buff", 0.0)) > 0.0:
			_text(p + Vector2(w * 0.5 + 16, 6), "▲", 18, Color(1.0, 0.8, 0.3), 4)
		if boss and enemy_label != "":
			var pulse: float = 0.75 + 0.25 * sin(_clock * 10.0)
			_text(p + Vector2(0, 30), enemy_label, 18, Color(1.0, 0.85, 0.3, pulse), 5)


func _draw_pops() -> void:
	if cam == null or not cam.is_inside_tree():
		return
	for d: Dictionary in _pops:
		var w: Vector3 = d["w"]
		if cam.is_position_behind(w):
			continue
		var t: float = d["t"]
		var style: String = d["style"]
		var rise: float = 80.0 if style != "crit" else 60.0
		var p: Vector2 = cam.unproject_position(w) + Vector2(float(d["dx"]) * minf(1.0, t / 0.12 + 0.4), float(d.get("dy", 0.0)) - 30.0 - rise * ease(t / 0.95, 0.4))
		var a: float = 1.0 - clampf((t - 0.6) / 0.35, 0.0, 1.0)
		var punch: float = 1.0 + 0.6 * maxf(0.0, 1.0 - t / 0.1)
		var fs: int = 34
		var col: Color = Color(1, 1, 1, a)
		var ocol: Color = Color(0.1, 0.05, 0.12, a)
		var ol: int = 8
		match style:
			"heavy":
				fs = 40
				col = Color(1.0, 0.86, 0.3, a)
				ocol = Color(0.35, 0.12, 0.02, a)
			"crit":
				fs = 56
				col = Color(1.0, 0.42, 0.12, a)
				ocol = Color(0.3, 0.02, 0.06, a)
				ol = 12
				punch = 1.0 + 1.0 * maxf(0.0, 1.0 - t / 0.12)
			"blocked":
				fs = 26
				col = Color(0.7, 0.8, 0.95, a)
				ocol = Color(0.08, 0.1, 0.2, a)
			"absorbed":
				fs = 26
				col = Color(0.55, 0.88, 1.0, a)
				ocol = Color(0.03, 0.12, 0.25, a)
			"heal":
				fs = 32
				col = Color(0.45, 1.0, 0.45, a)
				ocol = Color(0.02, 0.2, 0.05, a)
			"hurt":
				fs = 34
				col = Color(1.0, 0.32, 0.3, a)
				ocol = Color(0.25, 0.0, 0.02, a)
			"parry":
				fs = 44
				col = Color(1.0, 0.95, 0.5, a)
				ocol = Color(0.35, 0.18, 0.0, a)
				ol = 10
			"dodge":
				fs = 28
				col = Color(0.8, 1.0, 1.0, a)
			"ally":
				fs = 28
				col = Color(0.7, 0.92, 1.0, a)
		_text_scaled(p, str(d["s"]), fs, col, ol, punch, ocol)


# ------------------------------------------------------------ top bar and minimap

func _draw_top() -> void:
	var cx: float = size.x * 0.5
	# timer pill (ice) and the squad pill, top centre, as on the reference
	var secs: int = int(ceil(maxf(t_left, 0.0)))
	var urgent: bool = t_left <= 10.0 and t_left > 0.0
	var pulse: float = 1.0 + (0.07 * maxf(0.0, cos((t_left - floor(t_left)) * PI * 2.0 - PI * 0.0)) if urgent else 0.0)
	var tw: Vector2 = Vector2(150, 56) * pulse
	var tc: Vector2 = Vector2(cx - 62, 52)
	var tr := Rect2(tc - tw * 0.5, tw)
	draw_texture_rect(T_PILL_TIMER, tr, false, Color(1.0, 0.55, 0.5) if urgent else Color.WHITE)
	var ink: Color = Color(0.1, 0.14, 0.3) if not urgent else Color(0.55, 0.0, 0.05)
	_text(tc + Vector2(0, -1), "%d:%02d" % [secs / 60, secs % 60], 36, ink)
	var sr := Rect2(Vector2(cx + 22, 30), Vector2(116, 44))
	draw_texture_rect(T_PILL_SQUAD, sr, false)
	_tex(T_PERSON, sr.position + Vector2(30, 22), 13.0)
	_text_left(sr.position + Vector2(50, 22), players_text, 26, Color(0.94, 0.93, 0.98))
	if point_name != "":
		_text(Vector2(cx, 98), point_name, 18, Color(1, 1, 1, 0.85), 5)
	# hero card, top left
	if show_hero_card:
		var hr := Rect2(Vector2(16, 26), Vector2(196, 64))
		draw_style_box(_card, hr)
		draw_circle(hr.position + Vector2(30, 32), 21.0, Color(0.95, 0.72, 0.25))
		draw_circle(hr.position + Vector2(30, 32), 18.0, Color(0.16, 0.12, 0.26))
		_text(hr.position + Vector2(30, 31), hero_name.substr(0, 1).to_upper(), 24, Color(1, 0.86, 0.45))
		_text_left(hr.position + Vector2(60, 18), hero_name, 20, Color.WHITE)
		_rbar(Rect2(hr.position + Vector2(60, 34), Vector2(122, 12)), float(hero_hp) / maxf(1.0, float(hero_max)), C_HERO)
		_text_left(hr.position + Vector2(60, 54), "%d / %d" % [hero_hp, hero_max], 14, Color(1, 1, 1, 0.8))
		if buff_t > 0.0:
			_text_left(hr.position + Vector2(146, 54), "ATK+", 14, Color(1.0, 0.8, 0.3))


func _draw_minimap() -> void:
	var c: Vector2 = _map_centre()
	draw_circle(c, MAP_R, Color(0.13, 0.11, 0.22, 0.88))
	var k: float = (MAP_R * 2.0 / 0.95) / MAP_METRES
	# the street running up-screen and the plaza ring
	draw_rect(Rect2(c + Vector2(-10.0 * k * 0.25, -MAP_R + 4), Vector2(5.0 * k * 0.25 * 2.0, MAP_R * 2 - 8)), Color(0.32, 0.3, 0.42, 0.7))
	draw_arc(c, minf(12.0 * k, MAP_R - 4), 0, TAU, 40, Color(1, 1, 1, 0.22), 2.0)
	draw_circle(c, 3.0 * k, Color(0.55, 0.45, 0.4, 0.45))
	for m: Dictionary in map_points:
		var v: Vector2 = (m["p"] as Vector2) * k   # metres, already turned so up = camera forward
		v = v.limit_length(MAP_R - 9)
		var kind: String = m["kind"]
		var col: Color = C_HERO
		var r: float = 7.0
		if kind == "ally":
			col = C_ALLY
			r = 6.0
		elif kind == "enemy":
			col = Color(0.95, 0.25, 0.22)
			r = 9.0
		var p: Vector2 = c + v
		var f: Vector2 = m.get("facing", Vector2.ZERO)
		if f != Vector2.ZERO:
			# the facing wedge
			var fn: Vector2 = f.normalized()
			var side: Vector2 = Vector2(-fn.y, fn.x)
			draw_colored_polygon(PackedVector2Array([p + fn * (r + 9.0), p + side * (r * 0.8), p - side * (r * 0.8)]), Color(col.r, col.g, col.b, 0.85))
		draw_circle(p, r + 2.5, Color(0.02, 0.02, 0.05, 0.85))
		draw_circle(p, r, col)
		draw_circle(p + Vector2(-r * 0.3, -r * 0.3), r * 0.35, Color(1, 1, 1, 0.45))
	draw_texture_rect(T_MAP_FRAME, Rect2(c - Vector2(MAP_R + 9, MAP_R + 9), Vector2(MAP_R + 9, MAP_R + 9) * 2.0), false)


# ------------------------------------------------------------ controls

func _draw_controls() -> void:
	# joystick: the ring art at rest, brighter with a direction glow when held
	var active: bool = _stick_id != -999 or stick != Vector2.ZERO
	var base_c: Vector2 = _stick_origin if active else _stick_home()
	var knob_c: Vector2 = _knob if active else _stick_home()
	var a: float = 1.0 if active else 0.75
	_tex(T_STICK_BASE, base_c, STICK_BASE_R, Color(1, 1, 1, a))
	if stick != Vector2.ZERO:
		var dir: float = atan2(-stick.y, stick.x)
		draw_arc(base_c, STICK_BASE_R - 5.0, dir - 0.6, dir + 0.6, 16, Color(0.6, 0.95, 1.0, 0.85), 6.0, true)
	_tex(T_STICK_KNOB, knob_c, STICK_KNOB_R * (1.06 if active else 1.0), Color(1, 1, 1, 0.95 if active else 0.85))
	# attack: big, pressed-state squash and a ring burst, combo pips round the top
	var ac: Vector2 = attack_centre()
	var pk: float = _press[0]
	var s0: float = 1.0
	if pk >= 0.0:
		s0 = 0.86 + 0.14 * clampf(pk / 0.12, 0.0, 1.0)
	var held: bool = attack_held and pk < 0.0
	if held:
		s0 = 0.92
	_tex(T_BTN_BASE, ac, ATTACK_R * s0, Color(1, 1, 1, 0.95))
	if pk >= 0.0:
		var kr: float = pk / 0.3
		_tex(T_BTN_ULT, ac, ATTACK_R * lerpf(1.0, 1.55, kr), Color(1, 0.9, 0.6, 1.0 - kr))
	_tex(T_ATTACK, ac + Vector2(2, 0), ATTACK_R * 0.82 * s0)
	if attack_cd_k > 0.0:
		draw_arc(ac, ATTACK_R * s0 - 3.0, -PI * 0.5, -PI * 0.5 + TAU * attack_cd_k, 32, Color(1, 1, 1, 0.5), 4.0, true)
	for j in 3:
		var pa: float = deg_to_rad(-90.0 - 22.0 + 22.0 * j)
		var pp: Vector2 = ac + Vector2(cos(pa), sin(pa)) * (ATTACK_R + 13.0)
		var lit: bool = j < combo_step
		draw_circle(pp, 6.5, Color(0.05, 0.03, 0.08, 0.85))
		draw_circle(pp, 4.5, Color(1.0, 0.75, 0.25) if lit else Color(1, 1, 1, 0.28))
	# skills
	for i in SKILL_ANGLES.size():
		var c: Vector2 = skill_centre(i)
		var pr: float = _press[i + 1]
		var s: float = 0.86 + 0.14 * clampf(pr / 0.12, 0.0, 1.0) if pr >= 0.0 else 1.0
		var r: float = SKILL_R * s
		var cd: float = skill_cd[i]
		var ok: bool = skill_ok[i] and cd <= 0.0
		draw_circle(c, r + 3.0, Color(0.05, 0.03, 0.1, 0.55))
		var icon: Texture2D = SKILL_ICONS[i]
		if cd > 0.0 and SKILL_ICONS_OFF[i] != null:
			icon = SKILL_ICONS_OFF[i]
		var mod: Color = Color.WHITE if ok else (Color(0.5, 0.5, 0.55, 0.9) if cd > 0.0 else Color(0.75, 0.75, 0.8, 0.8))
		_tex(icon, c, r * (1.12 if i < 3 else 1.0), mod)
		if cd > 0.0:
			_pie(c, r, cd / maxf(skill_cd_max[i], 0.01), Color(0.02, 0.0, 0.06, 0.62))
			draw_arc(c, r + 1.5, -PI * 0.5, -PI * 0.5 + TAU * (1.0 - cd / maxf(skill_cd_max[i], 0.01)), 32, Color(1.0, 0.8, 0.35, 0.9), 3.0, true)
			_text(c, ("%.1f" % cd) if cd < 1.0 else ("%d" % int(ceil(cd))), 28, Color.WHITE, 7)
		if _ready_pulse[i] >= 0.0:
			var kp: float = _ready_pulse[i] / 0.5
			_tex(T_BTN_RING, c, r * lerpf(1.0, 1.6, kp), Color(1.0, 0.9, 0.5, 1.0 - kp))
	# guard
	var gc: Vector2 = guard_centre()
	var gs: float = 0.9 if guard_on else 1.0
	draw_circle(gc, GUARD_R + 3.0, Color(0.05, 0.03, 0.1, 0.55))
	if guard_on:
		draw_circle(gc, GUARD_R + 7.0, Color(0.5, 0.85, 1.0, 0.35))
	_tex(T_GUARD, gc, GUARD_R * gs, Color.WHITE if guard_on else Color(1, 1, 1, 0.85))
	if _press[6] >= 0.0:
		var kg: float = _press[6] / 0.3
		_tex(T_BTN_RING, gc, GUARD_R * lerpf(1.0, 1.5, kg), Color(0.6, 0.9, 1.0, 1.0 - kg))
	if _toast_t > 0.0:
		_text(_toast_at, _toast, 24, Color(1, 1, 1, clampf(_toast_t / 0.3, 0.0, 1.0)), 6)
