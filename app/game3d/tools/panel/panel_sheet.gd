extends SceneTree
## The panel alone on Wale's pale page, at his sheet's own size (870 x 1112), for a side by side with g_59328.jpg:
##   xvfb-run -s "-screen 0 870x1112x24" godot --path app/game3d --rendering-driver opengl3 --resolution 870x1112 \
##     -s res://tools/panel/panel_sheet.gd -- --out=/abs/ours.png [--extras=arc|row|column|none] [--state=ready|cooling]
## The HUD is scaled so its ATTACK has the sheet's radius and sits on the sheet's centre; nothing else is drawn.

const HudScript := preload("res://hud.gd")
var _out: String = ""
var _n: int = 0


func _initialize() -> void:
	var extras: String = "none"
	var state: String = "ready"
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			_out = a.substr(6)
		elif a.begins_with("--extras="):
			extras = a.substr(9)
		elif a.begins_with("--state="):
			state = a.substr(8)
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	var bg := ColorRect.new()
	bg.color = Color8(245, 245, 245)
	bg.size = Vector2(870, 1112)
	root.add_child(bg)
	var holder := Control.new()
	root.add_child(holder)
	var hud: Control = HudScript.new()
	holder.add_child(hud)
	hud.size = Vector2(870, 1112)
	var k: float = 203.94 / HudScript.W_ATTACK_R
	holder.scale = Vector2(k, k)
	hud.set("extras", extras if extras != "none" else "arc")
	hud.set("halo_a", 1.0)
	hud.set("show_only_panel", true)
	hud.set("hide_extras", extras == "none")
	# the HUD follows the viewport's size: place the holder so the attack centre lands on the sheet's
	(func() -> void:
		hud.size = Vector2(870, 1112)
		var ac: Vector2 = hud.call("attack_centre")
		holder.position = Vector2(601.14, 673.24) - ac * k
		if state == "cooling":
			var cd: Array[float] = [3.0, 2.0, 1.5, 9.0, 9.5, 2.4, 0.4]
			hud.set("skill_cd", cd)
			hud.set("combo_step", 2)).call_deferred()


func _process(_dt: float) -> bool:
	_n += 1
	if _n == 8:
		_shot.call_deferred()
	return false


func _shot() -> void:
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(_out)
	quit(0)
