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
const T_DISC := preload("res://art/hud/disc.png")   # a white disc (cq 011), tinted per use
const T_FX_ATLAS := preload("res://art/fx/fx_atlas.png")   # cq 013: the crit flash behind a number
const T_BTN_RING := preload("res://art/hud/btn_ring.png")
const T_BTN_ULT := preload("res://art/hud/btn_ring_ult.png")
const T_ATTACK := preload("res://art/hud/icon_attack.png")
const T_GUARD := preload("res://art/hud/icon_guard.png")
const T_PERSON := preload("res://art/hud/icon_person.png")
const T_MAP_FRAME := preload("res://art/hud/minimap_frame.png")
const T_PILL_TIMER := preload("res://art/hud/pill_timer.png")
const T_PILL_SQUAD := preload("res://art/hud/pill_squad.png")
# one distinct, bright icon per skill from the reference sheet's kit (CC0), and a desaturated
# copy of each (made from it) for the cooldown
const SKILL_ICONS: Array[Texture2D] = [
	preload("res://art/hud/icon_dodge.png"),            # CHARGE: the dash chevrons
	preload("res://art/hud/icon_ultimate.png"),         # SPLIT: the sword into the ground ring
	preload("res://art/hud/icon_skill_crescent.png"),   # WHIRL: the spinning crescent
	preload("res://art/hud/icon_skill_shockwave.png"),  # RALLY: the golden burst
	preload("res://art/hud/icon_skill_arcane.png"),     # SHIELD: the barrier circle
]
const SKILL_ICONS_OFF: Array[Texture2D] = [
	preload("res://art/hud/icon_dodge_off.png"),
	preload("res://art/hud/icon_ultimate_off.png"),
	preload("res://art/hud/icon_skill_crescent_off.png"),
	preload("res://art/hud/icon_skill_shockwave_off.png"),
	preload("res://art/hud/icon_skill_arcane_off.png"),
]
const FONT := preload("res://art/fonts/LilitaOne-Regular.ttf")

const STICK_BASE_R: float = 74.0                     # build 20 pass 2: 86 -> 74 (slimmer ring)
const STICK_KNOB_R: float = 34.0
const STICK_TRAVEL: float = 70.0
const STICK_DEAD: float = 0.12                       # 12% dead zone
const STICK_HOME_FROM_BL: Vector2 = Vector2(150.0, 205.0)
const ATTACK_R: float = 62.0
const SKILL_R: float = 37.0
const ICON_K: Array[float] = [0.86, 0.9, 0.86, 0.9, 0.88]   # icon size in the disc (the art has its own margins)
const GUARD_R: float = 33.0
const ATTACK_FROM_BR: Vector2 = Vector2(98.0, 150.0)
const SKILL_ARC_R: float = 150.0
const SKILL_ANGLES: Array[float] = [72.0, 104.0, 136.0, 168.0, 200.0]
const SKILL_NAMES: Array[String] = ["CHARGE", "SPLIT", "WHIRL", "RALLY", "SHIELD", "SHOOT", "RAIN"]
const SKILL_N: int = 7
const GUARD_FROM_ATTACK: Vector2 = Vector2(-10.0, -165.0) # unused when the arc is full; see guard_centre()
const REAL_SLOT: int = 2
# ---- Wale's attack panel (sheet 59328; Mark: "I love these"), drawn with HIS art (build 22). Build 21 drew
# the buttons flat in code from his picture and Mark did not like the look; now each button is the sprite cut
# out of his sheet (art/hud/wale/panel_atlas.png: the button, a dimmed copy, its four grey ring segments as a
# lit layer, one halo disc). The five sit where his sheet puts them, at his relative sizes: every position and
# radius below is the sheet's own pixels, scaled by W_K. All eight skills have a button and every button casts
# (Mark, 12 Nov: buttons with different functions all stay): his ATTACK, DASH (CHARGE, slot 0), SHIELD (4),
# SHOOT (5) and RAIN (6), and SPLIT (1), WHIRL (2), RALLY (3), which he has not drawn yet: those three are
# INTERIM art (his ring and disc recoloured, a new centre), on an outer arc that leaves his five untouched.
# The old code-drawn arc is still panel = "classic" (five skills, no SHOOT or RAIN).
const PanelAtlas := preload("res://art/hud/wale/panel_atlas.gd")
const T_PANEL := preload("res://art/hud/wale/panel_atlas.png")
var panel: String = "wale"
## Where the three interim buttons go: "arc" (an outer arc round his cluster, the default), "row" or "column".
var extras: String = "arc"
## The halo's opacity over the fight (on his sheet it is a solid pale disc on a pale page: 1.0 shows that).
var halo_a: float = 0.42
## Review tools only (tools/panel/panel_sheet.gd): draw the panel and nothing else; leave the interim three out.
var show_only_panel: bool = false
var hide_extras: bool = false
const W_ATTACK_R: float = 70.0
## The sheet's measurements (px in g_59328.jpg): the button's centre x, y and its disc radius; the halo's
## centre and radius. ATTACK is the origin.
const W_SHEET_ATTACK: Dictionary = {"c": Vector2(601.14, 673.24), "r": 203.94, "hc": Vector2(598.5, 674.0), "hr": 245.0}
const W_K: float = W_ATTACK_R / 203.94
const W_BUTTONS: Array[Dictionary] = [
	{"id": "dash", "slot": 0, "c": Vector2(238.23, 807.97), "r": 80.63, "hc": Vector2(237.0, 806.5), "hr": 95.5},
	{"id": "shield", "slot": 4, "c": Vector2(597.15, 211.05), "r": 110.56, "hc": Vector2(598.5, 215.0), "hr": 140.0},
	{"id": "shoot", "slot": 5, "c": Vector2(287.89, 285.8), "r": 96.75, "hc": Vector2(288.0, 283.5), "hr": 115.5},
	{"id": "rain", "slot": 6, "c": Vector2(170.59, 527.59), "r": 92.28, "hc": Vector2(171.0, 525.5), "hr": 108.5},
	# interim (not on his sheet): placed by `extras`, sized like his small buttons
	{"id": "whirl", "slot": 2, "interim": true},
	{"id": "split", "slot": 1, "interim": true},
	{"id": "rally", "slot": 3, "interim": true},
]
const W_EXTRA_R: float = 29.0
const W_EXTRA_HALO: float = 1.2
## The interim three, from the attack centre (HUD px at W_ATTACK_R = 70), nearest the thumb first (WHIRL, SPLIT,
## RALLY), and where GUARD goes with each. "arc": 240 px out at 14, 38 and 62 degrees above the horizontal.
const W_EXTRAS: Dictionary = {
	"arc": {"at": [Vector2(-232.9, -58.1), Vector2(-189.1, -147.8), Vector2(-112.7, -211.9)], "guard": Vector2(-236.0, 58.0)},
	"row": {"at": [Vector2(-200.0, 50.0), Vector2(-272.0, 50.0), Vector2(-344.0, 50.0)], "guard": Vector2(-240.0, -34.0)},
	"column": {"at": [Vector2(-236.0, -16.0), Vector2(-236.0, -86.0), Vector2(-236.0, -156.0)], "guard": Vector2(-236.0, 62.0)},
}
## A thumb is wider than his smallest button: a tap counts within this of a centre at least (HUD px).
const W_TOUCH_MIN: float = 36.0
## build 28, the five-button panel (fight.gd RULES_VERSION_FIVE, Subomi 13 Nov): only his five, no interim three.
## With the outer arc gone his cluster grows by W_FIVE_K about ATTACK (his relative positions and sizes kept), so his
## small DASH, RAIN and SHOOT are bigger under a thumb. GUARD keeps its spot left of DASH. The three moves with no
## button show on the panel: WHIRL (the combo's finisher) and SPLIT (hold ATTACK) as small badges on ATTACK's rim,
## with their cooldowns, and a ring round ATTACK that fills while it is held towards SPLIT; RALLY (comes by itself
## below half health) as a badge under the hero card and a mark at half way on the hero's health bar.
const W_FIVE_K: float = 1.1
const W_FIVE_GUARD: Vector2 = Vector2(-236.0, 58.0)
const W_BADGE_R: float = 17.0
const W_BADGE_AT: Dictionary = {"whirl": -40.0, "split": 40.0}   # degrees round ATTACK from its right (+ is down)
var five: bool = false
var hold_cs: int = 40             # fight.gd HOLD_SPLIT_CS
var rally_below: int = 500        # fight.gd AUTO_RALLY_BELOW (permille of max HP)
var hold_k: float = 0.0           # 0..1: ATTACK held towards SPLIT (fight.gd writes it)
var finisher_next: bool = false   # the next ATTACK is the WHIRL finisher

const MAP_R: float = 76.0
const MAP_CENTRE_FROM_TR: Vector2 = Vector2(96.0, 118.0)
var map_blocks: Array[Rect2] = []          # building footprints (x, z metres), from the arena
var _map_disc: PackedVector2Array = PackedVector2Array()
var _map_disc_at: Vector2 = Vector2(-1, -1)
const MAP_METRES: float = 20.0   # across the disc

const C_HERO: Color = Color(0.42, 0.93, 0.38)
const C_ALLY: Color = Color(0.36, 0.86, 0.98)
const C_ENEMY: Color = Color(0.72, 0.36, 0.95)

# ---- view model, written by fight.gd every frame
var cam: Camera3D
var t_left: float = 45.0
var players_text: String = "2/2"   # cq 019: you and the AI ally (fighters standing / squad)
var point_name: String = ""
var loading_text: String = ""
var hero_name: String = "You"
var hero_hp: int = 0
var hero_max: int = 1
var show_hero_card: bool = true
## build 20: the phone's safe area over the top of the fight (the app's "hud_top", HUD px). The top
## bar, the boss bar and the minimap move down by it, so the timer no longer sits under the
## Dynamic Island and the app's close button sits clear, under the boss bar (fight3d.ts hudLayout).
var top_shift: float = 0.0
## realism round 3: with the close camera a tall Guardian's head is often behind the top block, and its name
## plate was drawn under the block. Plates are kept below this many HUD px from the top (0 = as before).
var plate_min_y: float = 0.0
## build 21, landscape: HUD px the stick (left) and the attack panel and minimap (right) move in
## from the screen's sides, for the notch / Dynamic Island and the home bar.
var side_l: float = 0.0
var side_r: float = 0.0
var _q_off: Vector2 = Vector2.ZERO
var portrait: Texture2D = null   # the hero's face (fight.gd renders it once at the start)
var units: Array[Dictionary] = []      # {id, name, hp, max, team, head: Vector3, feet, chest, hw (body half width, m), is_hero, shield, buff, stagger, level}
var map_points: Array[Dictionary] = [] # {p: Vector2 metres (x right, y down-screen), kind, facing: Vector2}
var skill_cd: Array[float] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
var skill_cd_max: Array[float] = [5.0, 8.0, 6.0, 14.0, 12.0, 3.0, 10.0]   # fight.gd SKILL_CD (it writes them at the start)
var skill_ok: Array[bool] = [true, true, true, true, true, true, true]   # castable now (not busy, alive)
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
const P_GUARD: int = 8
var _press: Array[float] = [-1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0]   # 0 attack, 1..7 skills, 8 guard
var _ready_pulse: Array[float] = [-1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0]
var _was_cd: Array[bool] = [false, false, false, false, false, false, false]
var _toast: String = ""
var _toast_t: float = 0.0
var _toast_at: Vector2 = Vector2.ZERO
var _pops: Array[Dictionary] = []
var _plates: Array[Rect2] = []          # build 20 pass 2: this frame's name plates (screen px)
var _bodies: Dictionary = {}            # build 21: unit id -> this frame's body box (screen px), feet to head
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
# look-fight (art direction 6.3 / 7): screen washes from fight.gd's feel, the end title card,
# the Guardian's bar along the top
var tint: Color = Color(0, 0, 0, 0)      # the ultimate's source-colour wash (alpha set per frame)
var vignette: float = 0.0                # the hurt vignette's alpha (feel.gd: 15 % for 200 ms)
var _flash_a: float = 0.0
var _banner_kind: String = ""
## fight-look-31 (fight.gd _fl_far): the beats a 3D close-up used to carry, in 2D concept art. vs_card(): both fighters'
## art either side of a VS before the clock starts (nothing else of the HUD shows meanwhile); win_art: the winner's art
## standing on the VICTORY card. Unset (build 30 and the low tier): neither draws.
var _vs: Dictionary = {}
var win_art: Texture2D = null
var _boss_shake: float = 0.0
var _boss_last_hp: int = -1
const INK := Color("#1C2B3A")
const CREAM := Color("#FFF8EC")
const GOLD_HI := Color("#FFE08A")
const GOLD_LO := Color("#F59E2A")
const BERRY := Color("#D93840")
const BOSS_FILL := Color("#FF5FD2")
const BOSS_DEEP := Color("#8E2BD9")
const POP_LIFE: float = 0.7              # damagePop: rise 56 pt over 700 ms, fade the last 200 ms
const POP_MAX: int = 6                   # at most six numbers; the oldest fades first
const POP_STACK_S: float = 0.3           # a number within 300 ms of the last on a fighter stacks above it
const POP_PER_UNIT: int = 3              # build 21: at most three live numbers per fighter (the oldest fades first)
const POP_BODY_GAP: float = 8.0          # build 21: px between a number and its fighter's body
const POP_RISE: float = 44.0             # pt (build 20 pass 2: 56 -> 44, it rose into the name plate)
const PT: float = 1.85                   # HUD px per phone point (720 px across ~390 pt)
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
	# the 256 px kit art is drawn at 40 to 130 px: sample its mipmaps (smoother edges, and far
	# cheaper texture reads on a software GPU)
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
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
	return Vector2(size.x - side_r - ATTACK_FROM_BR.x, size.y - ATTACK_FROM_BR.y)


func attack_r() -> float:
	return W_ATTACK_R * _wk() if panel == "wale" else ATTACK_R


## The panel's scale about ATTACK: W_FIVE_K on the five-button panel, else his sheet's own (1).
func _wk() -> float:
	return W_FIVE_K if five else 1.0


## The Wale panel's button for a skill slot (its index in W_BUTTONS), or -1 when it has none.
func wale_button(slot: int) -> int:
	for j in W_BUTTONS.size():
		if int(W_BUTTONS[j]["slot"]) == slot:
			return j
	return -1


func wale_interim(j: int) -> bool:
	return bool(W_BUTTONS[j].get("interim", false))


func _extra_i(j: int) -> int:
	var n: int = 0
	for q in j:
		if wale_interim(q):
			n += 1
	return n


## A button's offset from the attack centre (HUD px): his sheet's own offset, scaled; the interim three by `extras`.
func wale_at(j: int) -> Vector2:
	var b: Dictionary = W_BUTTONS[j]
	if wale_interim(j):
		var lay: Dictionary = W_EXTRAS.get(extras, W_EXTRAS["arc"])
		return ((lay["at"] as Array)[_extra_i(j)] as Vector2) * (W_ATTACK_R / 70.0)
	return ((b["c"] as Vector2) - (W_SHEET_ATTACK["c"] as Vector2)) * W_K * _wk()


## A button's drawn radius (HUD px): his sheet's, scaled.
func wale_r(j: int) -> float:
	return W_EXTRA_R if wale_interim(j) else float(W_BUTTONS[j]["r"]) * W_K * _wk()


func wale_touch_r(j: int) -> float:
	return maxf(wale_r(j) * 1.2, W_TOUCH_MIN)


func wale_centre(j: int) -> Vector2:
	return attack_centre() + wale_at(j)


func skill_centre(i: int) -> Vector2:
	if panel == "wale":
		var j: int = wale_button(i)
		if five and i in [1, 2, 3]:
			# build 28: no button; where the move shows (its badge)
			return badge_centre("split") if i == 1 else (badge_centre("whirl") if i == 2 else rally_centre() + Vector2(0.0, top_shift))
		return wale_centre(j) if j >= 0 else attack_centre() + Vector2(0.0, -attack_r())
	var a: float = deg_to_rad(SKILL_ANGLES[mini(i, SKILL_ANGLES.size() - 1)])
	return attack_centre() + Vector2(cos(a), -sin(a)) * SKILL_ARC_R


## What the cast callout says for a slot: the panel's name for it.
func skill_label(slot: int) -> String:
	if panel == "wale" and slot == 0:
		return "DASH"
	return SKILL_NAMES[slot]


func guard_centre() -> Vector2:
	if panel == "wale" and five:
		return attack_centre() + W_FIVE_GUARD * (W_ATTACK_R / 70.0) * _wk()
	if panel == "wale":
		return attack_centre() + ((W_EXTRAS.get(extras, W_EXTRAS["arc"]) as Dictionary)["guard"] as Vector2) * (W_ATTACK_R / 70.0)
	# under the skill arc's last button, towards the middle of the screen
	return attack_centre() + Vector2(-SKILL_ARC_R - 92.0, 62.0)


## build 28: a badge's centre on ATTACK's rim (WHIRL up right, SPLIT down right, away from his other buttons).
func badge_centre(id: String) -> Vector2:
	return attack_centre() + Vector2.from_angle(deg_to_rad(float(W_BADGE_AT[id]))) * attack_r() * 1.02


## build 28: where the RALLY badge sits, under the hero card at the left (inside the top block, so top_shift applies).
func rally_centre() -> Vector2:
	return Vector2(40.0, 184.0)


func _stick_home() -> Vector2:
	return Vector2(side_l + STICK_HOME_FROM_BL.x, size.y - STICK_HOME_FROM_BL.y)


func _map_centre() -> Vector2:
	return Vector2(size.x - side_r - MAP_CENTRE_FROM_TR.x, MAP_CENTRE_FROM_TR.y)


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
	if p.distance_to(attack_centre()) <= attack_r() * 1.2:
		_ptrs[id] = {"role": "attack", "slot": -1}
		_refresh_held()
		_press[0] = 0.0
		attack_pressed.emit(t_in, ticks, src)
		return
	if panel == "wale":
		# the nearest button whose touch disc holds the point (the discs are padded for a thumb, so two can share a point)
		var best: int = -1
		var best_k: float = 1.0
		for j in W_BUTTONS.size():
			if five and wale_interim(j):
				continue   # build 28: SPLIT, WHIRL and RALLY have no button
			var kd: float = p.distance_to(wale_centre(j)) / wale_touch_r(j)
			if kd <= best_k:
				best_k = kd
				best = j
		if best >= 0:
			var slot: int = int(W_BUTTONS[best]["slot"])
			_ptrs[id] = {"role": "skill", "slot": slot}
			_press[slot + 1] = 0.0
			skill_pressed.emit(slot, t_in, ticks, src)
			return
	for i in (SKILL_ANGLES.size() if panel != "wale" else 0):
		if p.distance_to(skill_centre(i)) <= SKILL_R * 1.2:
			_ptrs[id] = {"role": "skill", "slot": i}
			_press[i + 1] = 0.0
			skill_pressed.emit(i, t_in, ticks, src)
			return
	if p.distance_to(guard_centre()) <= GUARD_R * 1.35:
		_ptrs[id] = {"role": "guard", "slot": -1}
		_press[P_GUARD] = 0.0
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
		_press[P_GUARD] = 0.0
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
	# look-fight (art direction 7, damage numbers): a new number within 300 ms of the last one on
	# the same fighter sits 18 pt above it; at most six live, the oldest fades out first.
	# build 21: the numbers keep clear of the fighter's body (they sat on the Guardian's chest, a
	# stack over its torso): each one belongs to the fighter it is on (uid), alternates sides, slides
	# out to the body's edge on its side (_body_clear), stacks only over its own side's last number,
	# and a fighter shows at most POP_PER_UNIT at once.
	_pop_side = -_pop_side
	var dx: float = _pop_side * randf_range(14.0, 34.0)
	var dy: float = 0.0
	var uid: int = _unit_at(world)
	for j in range(_pops.size() - 1, -1, -1):
		var q: Dictionary = _pops[j]
		if float(q["t"]) < POP_STACK_S and (q["w"] as Vector3).distance_to(world) < 1.2 \
				and signf(float(q["dx"])) == signf(dx) and not q.has("out"):
			dy = float(q["dy"]) - 18.0 * PT
			dx = float(q["dx"]) * 0.4 + _pop_side * 12.0
			break
	var live: Array[Dictionary] = []
	var mine: Array[Dictionary] = []
	for q: Dictionary in _pops:
		if not q.has("out"):
			live.append(q)
			if uid != 0 and int(q.get("uid", 0)) == uid:
				mine.append(q)
	if live.size() >= POP_MAX:
		live[0]["out"] = float(live[0]["t"])
	if mine.size() >= POP_PER_UNIT and not mine[0].has("out"):
		mine[0]["out"] = float(mine[0]["t"])
	if _pops.size() > 16:
		_pops.remove_at(0)
	var tilt: float = randf_range(0.02, 0.1 if style == "crit" else 0.06) * (-_pop_side)
	_pops.append({"w": world, "t": 0.0, "s": text, "style": style, "dx": dx, "dy": dy, "rot": tilt, "uid": uid})


## build 21: the fighter a number at `world` is on (its unit id; 0 = none near).
func _unit_at(world: Vector3) -> int:
	var best: int = 0
	var bd: float = 2.5
	for u: Dictionary in units:
		if not u.has("feet"):
			continue
		var f: Vector3 = u["feet"]
		var d: float = Vector2(world.x - f.x, world.z - f.z).length()
		if d < bd:
			bd = d
			best = int(u.get("id", 0))
	return best


func callout(text: String, col: Color) -> void:
	_callout = text
	_callout_col = col
	_callout_t = 0.0


func vs_card(a: Texture2D, b: Texture2D, name_a: String, name_b: String, length: float) -> void:
	_vs = {"a": a, "b": b, "na": name_a, "nb": name_b, "t": 0.0, "len": length}
	queue_redraw()


func vs_showing() -> bool:
	return not _vs.is_empty()


func banner(text: String, sub: String, col: Color, dur: float, kind: String = "") -> void:
	_banner_kind = kind
	if kind == "win" or kind == "lose":
		_pops.clear()   # the title card reads alone
	_banner = text
	_banner_sub = sub
	_banner_col = col
	_banner_t = 0.0
	_banner_dur = dur


func hurt() -> void:
	# look-fight: the red vignette is fight.gd's feel now (`vignette`, 15 % for 200 ms)
	pass


## A short cream flash over the frame (the Guardian's KO): never a white-out.
func flash_screen(a: float) -> void:
	_flash_a = maxf(_flash_a, minf(a, 0.35))


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
	for i in SKILL_N:
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
	if not _vs.is_empty():
		_vs["t"] = float(_vs["t"]) + dt
		if float(_vs["t"]) >= float(_vs["len"]):
			_vs = {}
	if _banner != "":
		_banner_t += dt
		if _banner_dur > 0.0 and _banner_t > _banner_dur:
			_banner = ""
	_flash_a = maxf(0.0, _flash_a - dt * 3.0)
	_boss_shake = maxf(0.0, _boss_shake - dt * 4.0)
	var i: int = _pops.size() - 1
	while i >= 0:
		var d: Dictionary = _pops[i]
		d["t"] = float(d["t"]) + dt
		if float(d["t"]) > POP_LIFE or (d.has("out") and float(d["t"]) - float(d["out"]) > 0.12):
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
func _text_scaled(centre: Vector2, s: String, fs: int, col: Color, outline: int, k: float, ocol: Color = Color(0, 0, 0, 0), rot: float = 0.0) -> void:
	_queue_text(Vector2(-400.0, fs * 0.36), s, HORIZONTAL_ALIGNMENT_CENTER, 800.0, fs, col, outline, Transform2D(rot, Vector2(k, k), 0.0, centre), ocol)


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
	if _q_off != Vector2.ZERO:
		if xf != Transform2D.IDENTITY:
			xf.origin += _q_off
		else:
			base += _q_off
	_texts.append([fs, outline, base, s, align, w, col, xf, ocol])


func _flush_texts() -> void:
	# look-fight: within a size, thicker outlines first (a crit's ink ring under its orange ring)
	_texts.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] > b[1]))
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


## A filled circle as a textured quad: draw_circle is a polygon, one draw call each on the
## Compatibility renderer; quads of one texture drawn back to back batch into one.
func _disc(c: Vector2, r: float, col: Color) -> void:
	draw_texture_rect(T_DISC, Rect2(c - Vector2(r, r), Vector2(r, r) * 2.0), false, col)


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
	if show_only_panel:
		_draw_wale_panel()
		_flush_texts()
		return
	if not _vs.is_empty():
		_draw_vs()
		_flush_texts()
		return
	var card: bool = _banner != "" and (_banner_kind == "win" or _banner_kind == "lose")
	if not card:
		_draw_overheads()
		_draw_pops()
	if top_shift > 0.0:
		draw_set_transform(Vector2(0.0, top_shift))
		_q_off = Vector2(0.0, top_shift)
	_draw_top()
	_draw_boss_bar()
	_draw_minimap()
	if top_shift > 0.0:
		draw_set_transform(Vector2.ZERO)
		_q_off = Vector2.ZERO
	if not card:   # look-fight: the controls step aside for the end card
		_draw_controls()
	if tint.a > 0.004:
		draw_rect(Rect2(Vector2.ZERO, size), tint)
	if _flash_a > 0.004:
		draw_rect(Rect2(Vector2.ZERO, size), Color(CREAM.r, CREAM.g, CREAM.b, _flash_a))
	if vignette > 0.004:
		var a: float = vignette
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
		_text_scaled(Vector2(size.x * 0.5, size.y * 0.64), _callout, 48, cc, 12, kp, Color(0.12, 0.04, 0.1, ka))
	if _banner != "" and (_banner_kind == "win" or _banner_kind == "lose"):
		_draw_title_card()
	elif _banner != "":
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
		if plate_min_y > 0.0:
			p.y = maxf(p.y, plate_min_y + top_shift)
		var boss: bool = int(u["team"]) == 1
		var w: float = 150.0 if boss else 108.0
		boxes.append({"u": u, "p": p, "w": w, "boss": boss})
	_plates.clear()
	_bodies.clear()
	var cr: Vector3 = cam.global_basis.x
	for u: Dictionary in units:
		if not u.has("feet") or float(u["hp"]) <= 0.0:
			continue
		var ch: Vector3 = u["chest"]
		if cam.is_position_behind(ch):
			continue
		var pc: Vector2 = cam.unproject_position(ch)
		var hwp: float = absf(cam.unproject_position(ch + cr * float(u["hw"])).x - pc.x)
		var top: float = cam.unproject_position(u["head"] as Vector3).y
		var bot: float = cam.unproject_position(u["feet"] as Vector3).y
		_bodies[int(u.get("id", 0))] = Rect2(Vector2(pc.x - hwp, minf(top, bot)), Vector2(hwp * 2.0, absf(bot - top)))
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
		# build 20 pass 2: the plate's box (name above the bar, the level badge, the ENRAGED line), so
		# the damage numbers keep out of it
		_plates.append(Rect2(p + Vector2(-w * 0.5 - 26.0, -34.0), Vector2(w + 52.0, h + 34.0 + (26.0 if boss and enemy_label != "" else 4.0))))
		if not boss:   # look-fight: the Guardian's bar is the big one along the top
			_rbar(r, k, fill, float(_chip.get(id, k)), float(u.get("shield", 0.0)))
		if not boss:
			# level badge, as on the reference's hero bar
			var bc: Vector2 = r.position + Vector2(-12, h * 0.5)
			_disc(bc, 12.0, Color(0.1, 0.07, 0.14, 0.95))
			_disc(bc, 10.0, Color(0.95, 0.72, 0.25))
			_text(bc + Vector2(0, -1), str(int(u.get("level", 1))), 14, Color(0.25, 0.12, 0.02))
		var name_col: Color = Color(0.86, 0.72, 1.0) if boss else (Color(0.72, 1.0, 0.62) if bool(u["is_hero"]) else Color(0.7, 0.93, 1.0))
		_text(p + Vector2(0, -15), str(u["name"]), 22 if boss else 19, name_col, 6)
		if float(u.get("buff", 0.0)) > 0.0:
			_text(p + Vector2(w * 0.5 + 16, 6), "▲", 18, Color(1.0, 0.8, 0.3), 4)
		if boss and enemy_label != "":
			var pulse: float = 0.75 + 0.25 * sin(_clock * 10.0)
			_text(p + Vector2(0, 14), enemy_label, 18, Color(1.0, 0.85, 0.3, pulse), 5)


func _draw_pops() -> void:
	if cam == null or not cam.is_inside_tree():
		return
	for d: Dictionary in _pops:
		var w: Vector3 = d["w"]
		if cam.is_position_behind(w):
			continue
		var t: float = d["t"]
		var style: String = d["style"]
		# look-fight damagePop (art direction 6.3): 0.6 -> 1.15 -> 1.0 over 180 ms, rises 56 pt over
		# 700 ms easing out, fades over the last 200 ms (or 120 ms when a seventh number pushes it out)
		var rise: float = POP_RISE * PT * (1.0 - pow(1.0 - clampf(t / POP_LIFE, 0.0, 1.0), 2.0))
		var p: Vector2 = cam.unproject_position(w) + Vector2(float(d["dx"]), float(d.get("dy", 0.0)) - 10.0 - rise)
		p.x += _body_clear(d, p)
		p.x += _pop_clear(d, p)
		var a: float = 1.0 - clampf((t - (POP_LIFE - 0.2)) / 0.2, 0.0, 1.0)
		if d.has("out"):
			a = minf(a, 1.0 - clampf((t - float(d["out"])) / 0.12, 0.0, 1.0))
		var punch: float = _damage_pop(t, 1.22 if style == "crit" else 1.15)
		var fs: int = int(22.0 * PT)
		var col: Color = Color(1.0, 1.0, 1.0, a)
		var ocol: Color = Color(INK.r, INK.g, INK.b, a)
		var ol: int = int(3.0 * PT * 2.0)
		match style:
			"heavy":
				fs = int(30.0 * PT)
			"crit":
				fs = int(34.0 * PT)
				col = Color(GOLD_HI.r, GOLD_HI.g, GOLD_HI.b, a)
				# the gold's darker lower edge: an orange ring inside the ink outline
				_text_scaled(p, str(d["s"]), fs, Color(GOLD_LO.r, GOLD_LO.g, GOLD_LO.b, 0.0), int(ol * 0.55), punch, Color(GOLD_LO.r, GOLD_LO.g, GOLD_LO.b, a), float(d.get("rot", 0.0)))
				ol = int(ol * 1.25)
				if t < 0.2:
					var fk: float = 1.0 - t / 0.2
					var fsz: float = 200.0 * (0.6 + 0.6 * ease(t / 0.2, 0.4))
					draw_texture_rect_region(T_FX_ATLAS, Rect2(p - Vector2(fsz, fsz) * 0.5, Vector2(fsz, fsz)), Rect2(512, 0, 256, 256), Color(GOLD_HI.r, GOLD_HI.g, GOLD_HI.b, 0.75 * fk))
			"hurt":
				fs = int(24.0 * PT)
				col = Color(1.0, 0.29, 0.24, a)   # #FF4A3D
			"heal":
				fs = int(22.0 * PT)
				col = Color(0.42, 0.92, 0.55, a)   # #6BEA8C
			"blocked", "absorbed":
				fs = int(16.0 * PT)
				col = Color(0.56, 0.85, 1.0, a)    # shield mid
			"parry":
				fs = int(26.0 * PT)
				col = Color(GOLD_HI.r, GOLD_HI.g, GOLD_HI.b, a)
			"dodge":
				fs = int(16.0 * PT)
				col = Color(0.9, 0.97, 1.0, a)
			"ally":
				fs = int(17.0 * PT)
				col = Color(0.5, 0.87, 0.96, a)    # #7FDDF5
		_text_scaled(p, str(d["s"]), fs, col, ol, punch, ocol, float(d.get("rot", 0.0)))


## build 20 pass 2: how far (px, x only) a number at `p` must slide to stay clear of every name
## plate. A number that sat over "Guardian" slides off to the side it is already on. Its slide only
## grows over its life, so it never jitters back over the plate.
func _pop_clear(d: Dictionary, p: Vector2) -> float:
	var s: String = str(d["s"])
	var fs: float = 34.0 * PT if str(d["style"]) == "crit" else 26.0 * PT
	var hw: float = fs * 0.34 * float(s.length()) + 10.0
	var hh: float = fs * 0.5
	var px: float = float(d.get("px", 0.0))
	for r: Rect2 in _plates:
		var q := Rect2(Vector2(p.x + px - hw, p.y - hh), Vector2(hw * 2.0, hh * 2.0))
		if not q.intersects(r):
			continue
		var right: bool = (p.x + px) >= r.get_center().x
		var need: float = (r.end.x + hw + 4.0 - p.x) if right else (r.position.x - hw - 4.0 - p.x)
		if absf(need) > absf(px):
			px = need
	d["px"] = px
	return px


## build 21: how far (px, x only) a number at `p` slides to clear its own fighter's body box, out to
## the side it is on (or the other side when that would leave the screen). Like _pop_clear, the slide
## only grows over the number's life, so it never jitters back over the body.
func _body_clear(d: Dictionary, p: Vector2) -> float:
	var r: Variant = _bodies.get(int(d.get("uid", 0)))
	var bx: float = float(d.get("bx", 0.0))
	if r == null:
		return bx
	var body: Rect2 = r
	var s: String = str(d["s"])
	var fs: float = 34.0 * PT if str(d["style"]) == "crit" else 26.0 * PT
	var hw: float = fs * 0.34 * float(s.length()) + 6.0
	var x: float = p.x + bx
	if x + hw <= body.position.x - POP_BODY_GAP or x - hw >= body.end.x + POP_BODY_GAP:
		return bx
	var right: bool = float(d["dx"]) >= 0.0
	var need: float = (body.end.x + POP_BODY_GAP + hw - p.x) if right else (body.position.x - POP_BODY_GAP - hw - p.x)
	if p.x + need + hw > size.x - 4.0 or p.x + need - hw < 4.0:
		need = (body.position.x - POP_BODY_GAP - hw - p.x) if right else (body.end.x + POP_BODY_GAP + hw - p.x)
	if absf(need) > absf(bx):
		bx = need
	d["bx"] = bx
	return bx


## look-fight damagePop scale: 0.6 to `peak` in 90 ms, back to 1.0 by 180 ms.
static func _damage_pop(t: float, peak: float) -> float:
	if t < 0.09:
		return lerpf(0.6, peak, 1.0 - pow(1.0 - t / 0.09, 2.0))
	if t < 0.18:
		return lerpf(peak, 1.0, smoothstep(0.0, 1.0, (t - 0.09) / 0.09))
	return 1.0


## look-fight end title card (art direction 7): VICTORY in gold (#FFE08A over #F59E2A, ink
## outline) on a dimmed band, or DEFEATED in cream on a Berry band. In over 220 ms.
## fight-look-31: the VS card. The two halves slide in on a slant (the hero's blue on the left, the Guardian's berry on the
## right), the concept art large on each, the names under them and a gold VS in the middle; out again over the last 0.35 s.
func _draw_vs() -> void:
	var t: float = float(_vs["t"])
	var ln: float = float(_vs["len"])
	var kin: float = ease(clampf(t / 0.3, 0.0, 1.0), 0.4)
	var kout: float = 1.0 - ease(clampf((t - (ln - 0.35)) / 0.35, 0.0, 1.0), 2.0)
	var a: float = minf(kin, kout)
	var w: float = size.x
	var h: float = size.y
	var slide: float = (1.0 - kin) * w * 0.55 + (1.0 - kout) * w * 0.15
	draw_rect(Rect2(Vector2.ZERO, size), Color(INK.r, INK.g, INK.b, 0.45 * a))
	var blue := Color(0.09, 0.22, 0.48, 0.92 * a)
	var berry := Color(0.5, 0.08, 0.14, 0.92 * a)
	draw_colored_polygon(PackedVector2Array([Vector2(-slide, 0), Vector2(w * 0.56 - slide, 0), Vector2(w * 0.44 - slide, h), Vector2(-slide, h)]), blue)
	draw_colored_polygon(PackedVector2Array([Vector2(w * 0.56 + slide, 0), Vector2(w + slide, 0), Vector2(w + slide, h), Vector2(w * 0.44 + slide, h)]), berry)
	draw_line(Vector2(w * 0.56 - slide, 0), Vector2(w * 0.44 - slide, h), Color(GOLD_HI.r, GOLD_HI.g, GOLD_HI.b, a), 6.0)
	var s: float = minf(h * 0.66, w * 0.36)
	for i in 2:
		var tex: Texture2D = _vs["a"] if i == 0 else _vs["b"]
		var cx: float = (w * 0.25 - slide) if i == 0 else (w * 0.75 + slide)
		var r := Rect2(Vector2(cx - s * 0.5, h * 0.46 - s * 0.5), Vector2(s, s))
		if tex != null:
			draw_texture_rect(tex, r, false, Color(1, 1, 1, a))
		else:
			draw_circle(r.get_center(), s * 0.36, Color(CREAM.r, CREAM.g, CREAM.b, 0.18 * a))
		var nm: String = str(_vs["na"] if i == 0 else _vs["nb"])
		_text(Vector2(cx, h * 0.46 + s * 0.5 + 34.0), nm, int(24.0 * PT), Color(CREAM.r, CREAM.g, CREAM.b, a), 10, Color(INK.r, INK.g, INK.b, a))
	var kp: float = lerpf(1.6, 1.0, ease(clampf((t - 0.15) / 0.25, 0.0, 1.0), 0.4))
	_text_scaled(Vector2(w * 0.5, h * 0.48), "VS", int(64.0 * PT), Color(GOLD_HI.r, GOLD_HI.g, GOLD_HI.b, a), 18, kp, Color(INK.r, INK.g, INK.b, a))


func _draw_title_card() -> void:
	var k: float = clampf(_banner_t / 0.22, 0.0, 1.0)
	var ke: float = ease(k, 0.35)
	var y: float = size.y * 0.38
	var win: bool = _banner_kind == "win"
	# the frame dims behind the card (the "frozen, slightly blurred" frame, without a post pass)
	draw_rect(Rect2(Vector2.ZERO, size), Color(INK.r, INK.g, INK.b, 0.28 * ke))
	var band_h: float = 176.0
	if win and win_art != null:
		# fight-look-31: the winner's 2D art rising behind the card (the 3D victory close-up is gone); the band covers its
		# lower edge, so the head and shoulders stand over VICTORY
		var s: float = minf(band_h * 2.3, size.y * 0.5) * lerpf(0.8, 1.0, ke)
		draw_texture_rect(win_art, Rect2(Vector2(size.x * 0.5 - s * 0.5, y - s * 0.86), Vector2(s, s)), false, Color(1, 1, 1, ke))
	var band: Color = Color(INK.r, INK.g, INK.b, 0.72 * ke) if win else Color(BERRY.r, BERRY.g, BERRY.b, 0.94 * ke)
	var bw: float = size.x * lerpf(0.3, 1.0, ke)
	draw_rect(Rect2(Vector2((size.x - bw) * 0.5, y - band_h * 0.5), Vector2(bw, band_h)), band)
	if win:
		draw_rect(Rect2(Vector2((size.x - bw) * 0.5, y - band_h * 0.5), Vector2(bw, 4)), Color(GOLD_LO.r, GOLD_LO.g, GOLD_LO.b, ke))
		draw_rect(Rect2(Vector2((size.x - bw) * 0.5, y + band_h * 0.5 - 4), Vector2(bw, 4)), Color(GOLD_LO.r, GOLD_LO.g, GOLD_LO.b, ke))
	var fs: int = int(56.0 * PT)
	var sc: float = lerpf(1.3, 1.0, ke)
	var ty: float = y - 16.0
	if win:
		_text_scaled(Vector2(size.x * 0.5, ty), _banner, fs, Color(GOLD_LO.r, GOLD_LO.g, GOLD_LO.b, 0.0), 10, sc, Color(GOLD_LO.r, GOLD_LO.g, GOLD_LO.b, ke))
		_text_scaled(Vector2(size.x * 0.5, ty), _banner, fs, Color(GOLD_HI.r, GOLD_HI.g, GOLD_HI.b, ke), 18, sc, Color(INK.r, INK.g, INK.b, ke))
	else:
		_text_scaled(Vector2(size.x * 0.5, ty), _banner, int(48.0 * PT), Color(CREAM.r, CREAM.g, CREAM.b, ke), 12, sc, Color(0.42, 0.07, 0.1, ke))
	if _banner_sub != "":
		var ks: float = clampf((_banner_t - 0.15) / 0.2, 0.0, 1.0)
		_text(Vector2(size.x * 0.5, y + 58), _banner_sub, int(15.0 * PT), Color(CREAM.r, CREAM.g, CREAM.b, ks), 6, Color(INK.r, INK.g, INK.b, ks))


## look-fight: the Guardian's bar along the top (delayed drain, the enrage mark at 35 %,
## a jolt on big hits). The bar over its head goes; its name stays there.
func _draw_boss_bar() -> void:
	var u: Dictionary = {}
	for x: Dictionary in units:
		if int(x["team"]) == 1:
			u = x
			break
	if u.is_empty() or float(u["hp"]) <= 0.0:
		return
	var id: int = int(u.get("id", 0))
	var hp: int = int(u["hp"])
	var mx: float = maxf(1.0, float(u["max"]))
	if _boss_last_hp >= 0 and hp < _boss_last_hp and float(_boss_last_hp - hp) / mx > 0.018:
		_boss_shake = 1.0
	_boss_last_hp = hp
	var k: float = float(hp) / mx
	var chip: float = float(_chip.get(id, k))
	var x0: float = 26.0
	var x1: float = size.x - side_r - 194.0   # build 21: clear of the minimap, which moves in by side_r
	var y: float = 132.0
	var j: Vector2 = Vector2(sin(_clock * 70.0), cos(_clock * 53.0)) * 4.0 * _boss_shake
	var r := Rect2(Vector2(x0, y) + j, Vector2(x1 - x0, 18.0))
	draw_rect(r.grow(3.0), Color(INK.r, INK.g, INK.b, 0.9))
	if chip > k:
		draw_rect(Rect2(r.position + Vector2(r.size.x * k, 0), Vector2(r.size.x * (clampf(chip, 0.0, 1.0) - k), r.size.y)), CREAM)
	var fw: float = r.size.x * clampf(k, 0.0, 1.0)
	draw_rect(Rect2(r.position, Vector2(fw, r.size.y)), BOSS_FILL)
	draw_rect(Rect2(r.position + Vector2(0, r.size.y * 0.62), Vector2(fw, r.size.y * 0.38)), BOSS_DEEP)
	draw_rect(Rect2(r.position, Vector2(fw, 4.0)), Color(1, 1, 1, 0.3))
	if _boss_shake > 0.5:
		draw_rect(Rect2(r.position, Vector2(fw, r.size.y)), Color(1, 1, 1, 0.35 * (_boss_shake - 0.5) * 2.0))
	var ex: float = r.position.x + r.size.x * 0.35
	draw_rect(Rect2(Vector2(ex - 1.5, r.position.y - 3), Vector2(3, r.size.y + 6)), Color(CREAM.r, CREAM.g, CREAM.b, 0.9))
	_text_left(Vector2(x0, y - 16) + j, str(u["name"]).to_upper(), 22, CREAM, 6)
	if enemy_label != "":
		var pulse: float = 0.75 + 0.25 * sin(_clock * 10.0)
		_queue_text(Vector2(x1 - 300.0, y - 16 + 22 * 0.36) + j, enemy_label, HORIZONTAL_ALIGNMENT_RIGHT, 300.0, 20, Color(GOLD_HI.r, GOLD_HI.g, GOLD_HI.b, pulse), 6)


## cq 013: the number's scale over its life: pops in from small to `peak` in 0.06 s, drops
## just under full size, settles at 1.
static func _pop_punch(t: float, peak: float) -> float:
	if t < 0.06:
		return lerpf(0.45, peak, 1.0 - pow(1.0 - t / 0.06, 2.0))
	if t < 0.16:
		return lerpf(peak, 0.93, smoothstep(0.0, 1.0, (t - 0.06) / 0.1))
	if t < 0.24:
		return lerpf(0.93, 1.0, (t - 0.16) / 0.08)
	return 1.0


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
		_disc(hr.position + Vector2(30, 32), 21.0, Color(0.95, 0.72, 0.25))
		_disc(hr.position + Vector2(30, 32), 18.0, Color(0.16, 0.12, 0.26))
		if portrait != null:
			# the hero's face in the round frame (a textured circle)
			var pc: Vector2 = hr.position + Vector2(30, 32)
			var pts := PackedVector2Array()
			var uvs := PackedVector2Array()
			for j in 24:
				var d: Vector2 = Vector2.from_angle(TAU * j / 24.0)
				pts.append(pc + d * 18.0)
				uvs.append(Vector2(0.5, 0.5) + d * 0.5)
			draw_polygon(pts, PackedColorArray([Color.WHITE]), uvs, portrait)
		else:
			_text(hr.position + Vector2(30, 31), hero_name.substr(0, 1).to_upper(), 24, Color(1, 0.86, 0.45))
		_text_left(hr.position + Vector2(60, 18), hero_name, 20, Color.WHITE)
		_rbar(Rect2(hr.position + Vector2(60, 34), Vector2(122, 12)), float(hero_hp) / maxf(1.0, float(hero_max)), C_HERO)
		if five and panel == "wale":
			_draw_rally_cue(Rect2(hr.position + Vector2(60, 34), Vector2(122, 12)))
		_text_left(hr.position + Vector2(60, 54), "%d / %d" % [hero_hp, hero_max], 14, Color(1, 1, 1, 0.8))
		if buff_t > 0.0:
			_text_left(hr.position + Vector2(146, 54), "ATK+", 14, Color(1.0, 0.8, 0.3))


## The minimap, as on the reference: centred on the hero, the street and the blocks round it
## (clipped to the disc), the hero's view cone, the three fighters with their facing.
func _draw_minimap() -> void:
	var c: Vector2 = _map_centre()
	var k: float = (MAP_R * 2.0) / MAP_METRES
	var me: Vector2 = Vector2.ZERO
	for m: Dictionary in map_points:
		if m["kind"] == "hero":
			me = m["p"]
	if _map_disc.is_empty() or _map_disc_at != c:
		_map_disc_at = c
		_map_disc = PackedVector2Array()
		for j in 40:
			_map_disc.append(c + Vector2.from_angle(TAU * j / 40.0) * (MAP_R - 1.0))
	_disc(c, MAP_R, Color(0.43, 0.41, 0.56, 0.92))   # the street (and anything not built)
	var reach: float = MAP_R / k + 8.0
	for r: Rect2 in map_blocks:
		if absf(r.get_center().y - me.y) > reach + r.size.y or absf(r.get_center().x - me.x) > reach + r.size.x:
			continue
		var q := PackedVector2Array([c + (r.position - me) * k, c + (Vector2(r.end.x, r.position.y) - me) * k,
			c + (r.end - me) * k, c + (Vector2(r.position.x, r.end.y) - me) * k])
		for poly: PackedVector2Array in Geometry2D.intersect_polygons(q, _map_disc):
			draw_colored_polygon(poly, Color(0.14, 0.12, 0.24, 0.96))
	# the medallion where the fight began
	var mc: Vector2 = c + (Vector2.ZERO - me) * k
	if mc.distance_to(c) < MAP_R - 3.6 * k:
		_disc(mc, 3.6 * k, Color(0.62, 0.5, 0.48, 0.55))
		draw_arc(mc, 3.6 * k, 0, TAU, 28, Color(1, 0.85, 0.7, 0.45), 1.5)
	var dots: Array = []
	for m: Dictionary in map_points:
		var v: Vector2 = ((m["p"] as Vector2) - me) * k
		v = v.limit_length(MAP_R - 9)
		var kind: String = m["kind"]
		var col: Color = C_HERO
		var r: float = 5.0
		if kind == "ally":
			col = C_ALLY
			r = 4.5
		elif kind == "enemy":
			col = Color(0.95, 0.25, 0.22)
			r = 6.5
		var p: Vector2 = c + v
		var f: Vector2 = m.get("facing", Vector2.ZERO)
		if kind == "hero":
			# the view cone: what the camera sees (up the screen), glowing like the reference's
			var cone := PackedVector2Array([p])
			var cols := PackedColorArray([Color(0.6, 0.97, 1.0, 0.85)])
			for j in 9:
				var a: float = -PI * 0.5 + deg_to_rad(-34.0 + 68.0 * j / 8.0)
				cone.append(p + Vector2.from_angle(a) * 46.0)
				cols.append(Color(0.55, 0.95, 1.0, 0.0))
			draw_polygon(cone, cols)
		if f != Vector2.ZERO:
			# the facing wedge
			var fn: Vector2 = f.normalized()
			var side: Vector2 = Vector2(-fn.y, fn.x)
			draw_colored_polygon(PackedVector2Array([p + fn * (r + 8.0), p + side * (r * 0.85), p - side * (r * 0.85)]), Color(col.r, col.g, col.b, 0.9))
		dots.append([p, r, col])
	for d: Array in dots:
		var p: Vector2 = d[0]
		var r: float = d[1]
		_disc(p, r + 2.5, Color(0.02, 0.02, 0.05, 0.85))
		_disc(p, r, d[2])
		_disc(p + Vector2(-r * 0.3, -r * 0.3), r * 0.35, Color(1, 1, 1, 0.45))
	draw_texture_rect(T_MAP_FRAME, Rect2(c - Vector2(MAP_R + 9, MAP_R + 9), Vector2(MAP_R + 9, MAP_R + 9) * 2.0), false)


# ------------------------------------------------------------ controls

func _draw_controls() -> void:
	# joystick: the ring art at rest, brighter with a direction glow when held
	var active: bool = _stick_id != -999 or stick != Vector2.ZERO
	var base_c: Vector2 = _stick_origin if active else _stick_home()
	var knob_c: Vector2 = _knob if active else _stick_home()
	# build 20 pass 2: lighter at rest (0.75 -> 0.42) and slimmer, so the fight shows through it
	var a: float = 0.9 if active else 0.42
	_tex(T_STICK_BASE, base_c, STICK_BASE_R, Color(1, 1, 1, a))
	if stick != Vector2.ZERO:
		var dir: float = atan2(-stick.y, stick.x)
		draw_arc(base_c, STICK_BASE_R - 5.0, dir - 0.6, dir + 0.6, 16, Color(0.6, 0.95, 1.0, 0.85), 6.0, true)
	_tex(T_STICK_KNOB, knob_c, STICK_KNOB_R * (1.06 if active else 1.0), Color(1, 1, 1, 0.92 if active else 0.62))
	if panel == "wale":
		_draw_wale_panel()
		if _toast_t > 0.0:
			_text(_toast_at, _toast, 24, Color(1, 1, 1, clampf(_toast_t / 0.3, 0.0, 1.0)), 6)
		return
	# attack: big, pressed-state squash and a ring burst, combo pips round the top
	var ac: Vector2 = attack_centre()
	var pk: float = _press[0]
	var s0: float = 1.0
	if pk >= 0.0:
		s0 = 0.86 + 0.14 * clampf(pk / 0.12, 0.0, 1.0)
	var held: bool = attack_held and pk < 0.0
	if held:
		s0 = 0.92
	_tex(T_BTN_BASE, ac, ATTACK_R * s0, Color(1, 1, 1, 0.78))
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
		_disc(pp, 6.5, Color(0.05, 0.03, 0.08, 0.85))
		_disc(pp, 4.5, Color(1.0, 0.75, 0.25) if lit else Color(1, 1, 1, 0.28))
	# skills
	for i in SKILL_ANGLES.size():
		var c: Vector2 = skill_centre(i)
		var pr: float = _press[i + 1]
		var s: float = 0.86 + 0.14 * clampf(pr / 0.12, 0.0, 1.0) if pr >= 0.0 else 1.0
		var r: float = SKILL_R * s
		var cd: float = skill_cd[i]
		var ok: bool = skill_ok[i] and cd <= 0.0
		# the reference's button: a translucent light disc, the icon on it
		_tex(T_BTN_BASE, c, r + 2.0, Color(1, 1, 1, 0.62))
		var icon: Texture2D = SKILL_ICONS_OFF[i] if cd > 0.0 or not skill_ok[i] else SKILL_ICONS[i]
		var mod: Color = Color.WHITE if ok else (Color(0.85, 0.85, 0.9, 0.95) if cd > 0.0 else Color(0.8, 0.8, 0.85, 0.75))
		_tex(icon, c, r * ICON_K[i], mod)
		if cd > 0.0:
			_pie(c, r, cd / maxf(skill_cd_max[i], 0.01), Color(0.04, 0.02, 0.1, 0.45))
			draw_arc(c, r + 1.5, -PI * 0.5, -PI * 0.5 + TAU * (1.0 - cd / maxf(skill_cd_max[i], 0.01)), 32, Color(1.0, 0.8, 0.35, 0.9), 3.0, true)
			_text(c, ("%.1f" % cd) if cd < 1.0 else ("%d" % int(ceil(cd))), 28, Color.WHITE, 7)
		if _ready_pulse[i] >= 0.0:
			var kp: float = _ready_pulse[i] / 0.5
			_tex(T_BTN_RING, c, r * lerpf(1.0, 1.6, kp), Color(1.0, 0.9, 0.5, 1.0 - kp))
	# guard
	var gc: Vector2 = guard_centre()
	var gs: float = 0.9 if guard_on else 1.0
	_disc(gc, GUARD_R + 3.0, Color(0.05, 0.03, 0.1, 0.32))
	if guard_on:
		_disc(gc, GUARD_R + 7.0, Color(0.5, 0.85, 1.0, 0.35))
	_tex(T_GUARD, gc, GUARD_R * gs, Color.WHITE if guard_on else Color(1, 1, 1, 0.85))
	if _press[P_GUARD] >= 0.0:
		var kg: float = _press[P_GUARD] / 0.3
		_tex(T_BTN_RING, gc, GUARD_R * lerpf(1.0, 1.5, kg), Color(0.6, 0.9, 1.0, 1.0 - kg))
	if _toast_t > 0.0:
		_text(_toast_at, _toast, 24, Color(1, 1, 1, clampf(_toast_t / 0.3, 0.0, 1.0)), 6)


# ------------------------------------------------------------ Wale's attack panel, from his art

## One sprite of a button from the atlas, its disc centred on `c` with radius `r` (HUD px). `quad` draws one
## quarter only (0 top left, 1 top right, 2 bottom left, 3 bottom right): each holds one ring segment.
func _w_sprite(id: String, kind: String, c: Vector2, r: float, mod: Color = Color.WHITE, quad: int = -1) -> void:
	var e: Dictionary = PanelAtlas.A[id]
	var reg: Array = e[kind]
	var k: float = r / float(e["r"])
	var half: float = float(e["half"]) * k
	var sc: Vector2 = c - Vector2(float(e["off_x"]), float(e["off_y"])) * k
	var src := Rect2(float(reg[0]), float(reg[1]), float(reg[2]), float(reg[3]))
	var dst := Rect2(sc - Vector2(half, half), Vector2(half, half) * 2.0)
	if quad >= 0:
		var q := Vector2(float(quad % 2), float(quad / 2))
		src = Rect2(src.position + src.size * 0.5 * q, src.size * 0.5)
		dst = Rect2(dst.position + dst.size * 0.5 * q, dst.size * 0.5)
	draw_texture_rect_region(T_PANEL, dst, src, mod)


func _w_halo(c: Vector2, r: float, col: Color) -> void:
	var e: Dictionary = PanelAtlas.A["halo"]
	var reg: Array = e["on"]
	var half: float = r * float(reg[2]) * 0.5 / float(e["r"])
	draw_texture_rect_region(T_PANEL, Rect2(c - Vector2(half, half), Vector2(half, half) * 2.0),
		Rect2(float(reg[0]), float(reg[1]), float(reg[2]), float(reg[3])), col)


## The ring's segments in the order they light: clockwise from the top left (the atlas quarter of each).
const W_SEG_ORDER: Array[int] = [0, 1, 3, 2]


## A button in one of its states. `back` 0..1: how much of the move has come back (1 = ready). While it is
## coming back the button is the dimmed copy and his four grey segments light one by one, clockwise; the one
## on its way glows in. `usable` false with no cooldown (staggered, down): dimmed and faint.
func _w_button(id: String, c: Vector2, r: float, halo_c: Vector2, halo_r: float, back: float, usable: bool, s: float) -> void:
	var e: Dictionary = PanelAtlas.A[id]
	var hc: Array = e["halo"]
	var ready: bool = usable and back >= 1.0
	var ha: float = halo_a * (1.0 if ready else 0.5)
	_w_halo(halo_c, halo_r * s, Color(float(hc[0]), float(hc[1]), float(hc[2]), ha))
	if ready:
		_w_sprite(id, "on", c, r * s)
		return
	_w_sprite(id, "off", c, r * s, Color(1, 1, 1, 1.0 if back < 1.0 else 0.72))
	if back < 1.0:
		var f: float = clampf(back, 0.0, 1.0) * 4.0
		for q in 4:
			var a: float = 1.0 if f >= float(q + 1) else clampf(f - float(q), 0.0, 1.0) * 0.75
			if a > 0.01:
				_w_sprite(id, "seg", c, r * s, Color(1, 1, 1, a), W_SEG_ORDER[q])


func _draw_wale_panel() -> void:
	var ac: Vector2 = attack_centre()
	# the small buttons first, so the attack sits over their halos (as on his sheet)
	for j in W_BUTTONS.size():
		var b: Dictionary = W_BUTTONS[j]
		if (hide_extras or five) and wale_interim(j):
			continue
		var id: String = str(b["id"])
		var c: Vector2 = wale_centre(j)
		var slot: int = int(b["slot"])
		var r: float = wale_r(j)
		var hcen: Vector2 = c
		var hr: float = r * W_EXTRA_HALO
		if not wale_interim(j):
			hcen = ac + ((b["hc"] as Vector2) - (W_SHEET_ATTACK["c"] as Vector2)) * W_K * _wk()
			hr = float(b["hr"]) * W_K * _wk()
		var pr: float = _press[slot + 1]
		var s: float = 0.86 + 0.14 * clampf(pr / 0.12, 0.0, 1.0) if pr >= 0.0 else 1.0
		var cd: float = skill_cd[slot]
		var back: float = 1.0 - clampf(cd / maxf(skill_cd_max[slot], 0.01), 0.0, 1.0) if cd > 0.0 else 1.0
		var hc: Array = PanelAtlas.A[id]["halo"]
		var hcol := Color(float(hc[0]), float(hc[1]), float(hc[2]))
		if pr >= 0.0:   # the press: the halo jumps out and fades
			var kr: float = pr / 0.3
			_w_halo(hcen, hr * lerpf(1.0, 1.45, kr), Color(hcol, 0.7 * (1.0 - kr)))
		_w_button(id, c, r, hcen, hr, back, skill_ok[slot], s)
		if cd > 0.0:
			_text(c, ("%.1f" % cd) if cd < 1.0 else ("%d" % int(ceil(cd))), int(round(r * 0.72)), Color.WHITE, 7)
		if _ready_pulse[slot] >= 0.0:   # back: all four segments flash and a ring runs out
			var kp: float = _ready_pulse[slot] / 0.5
			_w_sprite(id, "seg", c, r, Color(1, 1, 1, 1.0 - kp))
			draw_arc(c, r * lerpf(1.0, 1.45, kp), 0.0, TAU, 32, Color(hcol, 0.8 * (1.0 - kp)), 4.0, true)
	# GUARD: not on his sheet; the old button, small and quiet, off his cluster
	if not show_only_panel:
		_draw_guard()
	_draw_wale_attack(ac)


func _draw_guard() -> void:
	var gc: Vector2 = guard_centre()
	var gs: float = 0.9 if guard_on else 1.0
	_disc(gc, GUARD_R + 3.0, Color(0.05, 0.03, 0.1, 0.32))
	if guard_on:
		_disc(gc, GUARD_R + 7.0, Color(0.5, 0.85, 1.0, 0.35))
	_tex(T_GUARD, gc, GUARD_R * gs, Color.WHITE if guard_on else Color(1, 1, 1, 0.85))
	if _press[P_GUARD] >= 0.0:
		var kg: float = _press[P_GUARD] / 0.3
		_tex(T_BTN_RING, gc, GUARD_R * lerpf(1.0, 1.5, kg), Color(0.6, 0.9, 1.0, 1.0 - kg))


func _draw_wale_attack(ac: Vector2) -> void:
	# ATTACK: his big purple one. The combo shows on its ring: the bottom left segment after the first swing,
	# the top left after the second, the right side (all four) on the third.
	var pk: float = _press[0]
	var s0: float = 1.0
	if pk >= 0.0:
		s0 = 0.88 + 0.12 * clampf(pk / 0.12, 0.0, 1.0)
	if attack_held and pk < 0.0:
		s0 = 0.94
	var ahc: Array = PanelAtlas.A["attack"]["halo"]
	var acol := Color(float(ahc[0]), float(ahc[1]), float(ahc[2]))
	var ah: Vector2 = ac + ((W_SHEET_ATTACK["hc"] as Vector2) - (W_SHEET_ATTACK["c"] as Vector2)) * W_K * _wk()
	var ahr: float = float(W_SHEET_ATTACK["hr"]) * W_K * _wk()
	var ar: float = attack_r()
	if pk >= 0.0:
		var kr0: float = pk / 0.3
		_w_halo(ah, ahr * lerpf(1.0, 1.35, kr0), Color(acol, 0.7 * (1.0 - kr0)))
	_w_halo(ah, ahr * s0, Color(acol, halo_a))
	_w_sprite("attack", "on", ac, ar * s0)
	var lit: Array[int] = [2, 0, 1, 3]   # bottom left, top left, then the right side
	for q in mini(combo_step, 3) + (1 if combo_step >= 3 else 0):
		_w_sprite("attack", "seg", ac, ar * s0, Color(1, 1, 1, 0.95), lit[q])
	if five:
		_draw_five_attack(ac, ar * s0)


## build 28: the hold ring (fills towards SPLIT while ATTACK is held) and the WHIRL and SPLIT badges on its rim.
func _draw_five_attack(ac: Vector2, ar: float) -> void:
	var gold := Color("#FFD23F")
	var teal := Color("#3FE0C8")
	if hold_k > 0.0:
		draw_arc(ac, ar + 7.0, -PI * 0.5, -PI * 0.5 + TAU * hold_k, 48, Color(gold, 0.95), 7.0, true)
		if hold_k >= 1.0:
			_w_halo(ac, (ar + 14.0) * 1.2, Color(gold, 0.5))
	if finisher_next:
		# the next tap is the finisher: the right side of the ring (the third hit's segments) glows teal
		var pulse: float = 0.6 + 0.4 * sin(_clock * 12.0)
		draw_arc(ac, ar + 4.0, -PI * 0.5, PI * 0.5, 32, Color(teal, 0.8 * pulse), 5.0, true)
	for id: String in ["whirl", "split"]:
		var slot: int = 2 if id == "whirl" else 1
		var c: Vector2 = badge_centre(id)
		var r: float = W_BADGE_R * _wk()
		var cd: float = skill_cd[slot]
		var back: float = 1.0 - clampf(cd / maxf(skill_cd_max[slot], 0.01), 0.0, 1.0) if cd > 0.0 else 1.0
		var hcv: Array = PanelAtlas.A[id]["halo"]
		var hcol := Color(float(hcv[0]), float(hcv[1]), float(hcv[2]))
		var big: float = 1.0
		if id == "whirl" and finisher_next:
			big = 1.0 + 0.12 * (0.5 + 0.5 * sin(_clock * 12.0))
		elif id == "split" and hold_k > 0.0:
			big = 1.0 + 0.25 * hold_k
		_disc(c, r * big + 3.0, Color(0.05, 0.03, 0.1, 0.55))
		_w_button(id, c, r * big, c, r * big * 1.25, back, skill_ok[slot], 1.0)
		if cd > 0.0:
			_text(c, ("%.1f" % cd) if cd < 1.0 else ("%d" % int(ceil(cd))), int(round(r * 0.95)), Color.WHITE, 5)
		if _ready_pulse[slot] >= 0.0:
			var kp: float = _ready_pulse[slot] / 0.5
			draw_arc(c, r * lerpf(1.0, 1.7, kp), 0.0, TAU, 24, Color(hcol, 0.9 * (1.0 - kp)), 3.0, true)


## build 28: RALLY comes by itself below half health: a badge under the hero card (its cooldown, "AUTO" while it is
## back) and, on the health bar, a mark at the point where it comes.
func _draw_rally_cue(bar: Rect2) -> void:
	var pink := Color("#FF6FB0")
	var cd: float = skill_cd[3]
	var ready: bool = cd <= 0.0
	var mx: float = bar.position.x + bar.size.x * float(rally_below) / 1000.0
	draw_line(Vector2(mx, bar.position.y - 4.0), Vector2(mx, bar.end.y + 4.0), Color(pink, 1.0 if ready else 0.45), 3.0)
	var c: Vector2 = rally_centre()
	var r: float = 19.0
	var back: float = 1.0 - clampf(cd / maxf(skill_cd_max[3], 0.01), 0.0, 1.0) if cd > 0.0 else 1.0
	_disc(c, r + 3.0, Color(0.05, 0.03, 0.1, 0.55))
	_w_button("rally", c, r, c, r * 1.25, back, skill_ok[3], 1.0)
	if cd > 0.0:
		_text(c, "%d" % int(ceil(cd)), 18, Color.WHITE, 5)
	if _ready_pulse[3] >= 0.0:
		var kp: float = _ready_pulse[3] / 0.5
		draw_arc(c, r * lerpf(1.0, 1.7, kp), 0.0, TAU, 24, Color(pink, 0.9 * (1.0 - kp)), 3.0, true)
	_text_left(c + Vector2(r + 8.0, -8.0), "RALLY", 16, Color(pink, 1.0) if ready else Color(1, 1, 1, 0.7), 4)
	_text_left(c + Vector2(r + 8.0, 9.0), "auto below half" if ready else "back soon", 12, Color(1, 1, 1, 0.8), 3)
