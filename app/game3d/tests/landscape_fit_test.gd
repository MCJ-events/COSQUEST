extends SceneTree
## landscape-fit-32 (19 Nov 2026): the fight HUD fits every iPhone, sideways and upright.
##   godot --headless --path app/game3d -s res://tests/landscape_fit_test.gd
## For each phone (points, the safe-area insets iOS reports, as the app turns them into HUD px: fight3d.ts hudLayout,
## landscape.ts hudLandscape) the HUD is laid out on the canvas Godot gives it (stretch canvas_items + expand on
## 720 x 1280, or 1280 x 720 sideways) and:
##   1. every control, the hero card, the RALLY badge, the minimap and the boss bar's left end are inside the safe area;
##   2. nothing of the HUD is under the app's close button (a React Native view over the game, top left);
##   3. the winner's art on the VICTORY card is on screen and under the top block;
##   4. upright, the layout is build 31's (the card, the badge and the end card did not move).
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const HudScript := preload("res://hud.gd")

## key, portrait w x h pt, portrait safe top and bottom, landscape side and bottom (pt)
const PHONES: Array[Array] = [
	["se3", 375, 667, 20, 0, 0, 0],
	["i13", 390, 844, 47, 34, 47, 21],
	["p15", 393, 852, 59, 34, 59, 21],
	["p16", 402, 874, 62, 34, 62, 21],
	["pm15", 430, 932, 59, 34, 59, 21],
	["pm16", 440, 956, 62, 34, 62, 21],
]
const CLOSE_PT: float = 40.0
const CLOSE_BELOW: float = 222.0   # fight3d.ts HUD_CLOSE_BELOW

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	for p: Array in PHONES:
		_landscape(p, true)
		_landscape(p, false)
		_portrait(p, true)
		_portrait(p, false)
	_portrait_as_before()
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)


func _hud(sz: Vector2, five: bool) -> Control:
	var hud: Control = HudScript.new()
	hud.set("panel", "wale")
	hud.set("five", five)
	hud.size = sz
	return hud


## Every disc and box of the HUD that must be on screen: [name, Rect2].
func _parts(hud: Control, five: bool) -> Array[Array]:
	var out: Array[Array] = []
	var ts: float = float(hud.get("top_shift"))
	var card: Rect2 = hud.call("card_rect")
	out.append(["card", Rect2(card.position + Vector2(0, ts), card.size)])
	if five:
		var rc: Vector2 = hud.call("rally_centre")
		out.append(["rally", Rect2(rc + Vector2(-22, ts - 22), Vector2(44, 44))])
	var bx: float = hud.call("top_left_x")
	out.append(["boss_bar_left", Rect2(Vector2(bx - 3.0, 129.0 + ts), Vector2(10, 24))])
	var mc: Vector2 = hud.call("_map_centre")
	var mr: float = HudScript.MAP_R + 9.0
	out.append(["minimap", Rect2(mc + Vector2(-mr, ts - mr), Vector2(mr, mr) * 2.0)])
	var st: Vector2 = hud.call("_stick_home")
	out.append(["stick", Rect2(st - Vector2.ONE * HudScript.STICK_BASE_R, Vector2.ONE * HudScript.STICK_BASE_R * 2.0)])
	var ac: Vector2 = hud.call("attack_centre")
	var ar: float = hud.call("attack_r")
	out.append(["attack", Rect2(ac - Vector2.ONE * ar, Vector2.ONE * ar * 2.0)])
	for j in HudScript.W_BUTTONS.size():
		if five and bool(hud.call("wale_interim", j)):
			continue
		var c: Vector2 = hud.call("wale_centre", j)
		var r: float = hud.call("wale_r", j)
		out.append([str(HudScript.W_BUTTONS[j]["id"]), Rect2(c - Vector2.ONE * r, Vector2.ONE * r * 2.0)])
	var gc: Vector2 = hud.call("guard_centre")
	out.append(["guard", Rect2(gc - Vector2.ONE * HudScript.GUARD_R, Vector2.ONE * HudScript.GUARD_R * 2.0)])
	return out


static func _canvas(w: float, h: float, base: Vector2) -> Vector2:
	# stretch canvas_items + aspect expand: the base size grows along the longer side to the window's shape
	return Vector2(base.y * w / h, base.y) if w / h > base.x / base.y else Vector2(base.x, base.x * h / w)


func _landscape(p: Array, five: bool) -> void:
	var w: float = float(p[2])
	var h: float = float(p[1])
	var sz: Vector2 = _canvas(w, h, Vector2(1280, 720))
	var k: float = maxf(1280.0 / w, 720.0 / h)
	var side: float = roundf(float(p[5]) * k)
	var bottom: float = roundf(float(p[6]) * k)
	var close_left: float = roundf(float(p[5])) + 10.0
	var close := Rect2(Vector2(close_left, 14.0) * k, Vector2(CLOSE_PT, CLOSE_PT) * k)
	var hud: Control = _hud(sz, five)
	hud.set("side_l", side)
	hud.set("side_r", side)
	hud.set("close_r", roundf((close_left + CLOSE_PT) * k))
	var safe := Rect2(Vector2(side, 0.0), Vector2(sz.x - side * 2.0, sz.y - bottom)).grow(0.5)
	var tag: String = "%s_land_%s" % [p[0], "five" if five else "eight"]
	var out: Array[String] = []
	var under: Array[String] = []
	for part: Array in _parts(hud, five):
		var r: Rect2 = part[1]
		if not safe.encloses(r):
			out.append("%s %s" % [part[0], str(r)])
		if r.intersects(close):
			under.append(str(part[0]))
	_check("fit_%s_inside_safe_area" % tag, out.is_empty(), str(out))
	_check("fit_%s_clear_of_close" % tag, under.is_empty(), str(under))
	var art: Rect2 = hud.call("title_art_rect")
	_check("fit_%s_victory_art_on_screen" % tag, art.position.y >= HudScript.TITLE_ART_TOP - 0.5 and art.end.y <= sz.y and art.size.y >= 240.0, str(art))
	# the card and the timer pill (hud.gd _draw_top: 150 wide at centre x - 62) do not meet
	var card: Rect2 = hud.call("card_rect")
	_check("fit_%s_card_clear_of_timer" % tag, card.end.x + 12.0 < sz.x * 0.5 - 62.0 - 75.0, "%s canvas %s" % [str(card), str(sz)])
	hud.free()


func _portrait(p: Array, five: bool) -> void:
	var w: float = float(p[1])
	var h: float = float(p[2])
	var sz: Vector2 = _canvas(w, h, Vector2(720, 1280))
	var k: float = maxf(720.0 / w, 1280.0 / h)
	var top: float = roundf(maxf(0.0, float(p[3]) * k - 20.0))
	var bottom: float = roundf(float(p[4]) * k)
	var close_top: float = roundf((CLOSE_BELOW + top) / k)
	var close := Rect2(Vector2(14.0, close_top) * k, Vector2(CLOSE_PT, CLOSE_PT) * k)
	var hud: Control = _hud(sz, five)
	hud.set("top_shift", top)
	var safe_top: float = float(p[3]) * k
	var safe := Rect2(Vector2(0.0, safe_top), Vector2(sz.x, sz.y - safe_top - bottom)).grow(0.5)
	var tag: String = "%s_port_%s" % [p[0], "five" if five else "eight"]
	var out: Array[String] = []
	var under: Array[String] = []
	for part: Array in _parts(hud, five):
		var r: Rect2 = part[1]
		if not safe.encloses(r):
			out.append("%s %s" % [part[0], str(r)])
		if r.intersects(close):
			under.append(str(part[0]))
	_check("fit_%s_inside_safe_area" % tag, out.is_empty(), str(out))
	_check("fit_%s_clear_of_close" % tag, under.is_empty(), str(under))
	var art: Rect2 = hud.call("title_art_rect")
	_check("fit_%s_victory_art_on_screen" % tag, art.position.y >= top and art.end.y <= sz.y, str(art))
	hud.free()


## Upright, build 31's layout: the hero card at (16, 26), the RALLY badge at (40, 184), the end card at 0.38 with
## build 31's art size (on 720 x 1280 and on a tall phone's 720 x 1561).
func _portrait_as_before() -> void:
	for sz: Vector2 in [Vector2(720, 1280), Vector2(720, 1561)]:
		var hud: Control = _hud(sz, true)
		hud.set("top_shift", 88.0 if sz.y > 1300.0 else 18.0)
		var card: Rect2 = hud.call("card_rect")
		var rc: Vector2 = hud.call("rally_centre")
		var art: Rect2 = hud.call("title_art_rect")
		var s: float = minf(176.0 * 2.3, sz.y * 0.5)
		var art31 := Rect2(Vector2(sz.x * 0.5 - s * 0.5, sz.y * 0.38 - s * 0.86), Vector2(s, s))
		var tag: String = "%dx%d" % [int(sz.x), int(sz.y)]
		_check("fit_portrait_card_as_before_" + tag, card == Rect2(16, 26, 196, 64), str(card))
		_check("fit_portrait_rally_as_before_" + tag, rc == Vector2(40, 184), str(rc))
		_check("fit_portrait_victory_as_before_" + tag, art.is_equal_approx(art31), "%s vs %s" % [str(art), str(art31)])
		_check("fit_portrait_boss_bar_as_before_" + tag, is_equal_approx(float(hud.call("top_left_x")), 26.0))
		hud.free()
