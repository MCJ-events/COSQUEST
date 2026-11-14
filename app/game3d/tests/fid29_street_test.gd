extends SceneTree
## fid29-street (docs/game3d/fid29/street.md): the real street surfaces on mid and high, build 28's street on low.
##   godot --headless --path app/game3d -s res://tests/fid29_street_test.gd
## Checks: the low tier's street files keep their build 28 sha256 and low takes nothing new (the seam returns at once);
## mid and high get the real floor and the worn stone medallion (mipmapped); every real non-metal albedo texel has a
## linear luminance in [0.04, 0.85]; the places use the real ground, facades and water on mid/high and build 28's on
## low; the window reveals stay within their triangle budget; ground_occluders packs 6 capsules per fighter (read only)
## for at most 0.1 ms a frame with 3 fighters.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const ArenaScript := preload("res://arena.gd")
const PlaceScript := preload("res://place.gd")
const StreetReal := preload("res://street_real.gd")
const StreetLayout := preload("res://street_layout.gd")
const Occluders := preload("res://ground_occluders.gd")

## build 28 (89840bb) sha256 of every file the low street reads from art/street and art/world ground, trims, roofs,
## misc/props_noise: this lane never edits them.
const B28_SHA: Dictionary = {
	"res://art/street/medallion.png": "26df9427ef4bbcc87726d9942fa1d0494ad9d15fc16a2ba2d907696bfdf27d04",
	"res://art/street/street_pavers.png": "7a66a4753eceacdec31c3b93c3f84b47e77e07905b32ab72c2061e641796c6ab",
	"res://art/world/misc/props_noise.png": "30a0fc0133105307566219a569eaba4837899034564382be7f79a543036763c0",
	"res://art/world/ground/asphalt.png": "fa079945e272e5b1188bc676244c7e151fc5a010fc75204fb5e79eff2e9db099",
	"res://art/world/ground/grass_dry.png": "de6e073f202ea30b00cf20c5795ae16868867c6c680e21b72e3698f1675d155d",
	"res://art/world/ground/grass.png": "64c95e5a69137dde8410cd2b177b707fd17706633a5a478625f6715a250dc353",
	"res://art/world/ground/path.png": "201e10a6c47071d1c416ab1808927863d65584af9cddbaa9166e7dd63bd5be7f",
	"res://art/world/ground/pave_lagos.png": "a896e3082f5fbfbd935f9929c49586d18fa71f4d98d603cc3f2ceb207d612c7d",
	"res://art/world/ground/pave_uk.png": "14ed5836e7ec5c0ad8d3a283edbea7684f0a31596074ab2bc41258c63dd4f6ad",
	"res://art/world/ground/pave_us.png": "d594430fdceb93bdc39295831277f3dd57c89d52e58e8593a401cdc66737f520",
	"res://art/world/ground/plaza.png": "84cb55764e8a9e445adff874b9d1b282d84e87707308aff0b17f6ee0e047e6e6",
	"res://art/world/ground/water_n.png": "0d4caea87b0e2cbfa1981ccc50ad380c8a3b1c4506b606165bcf71b2281d4c4d",
	"res://art/world/ground/wear.png": "9c33587d865688968752df70a0220bbc9eb42e47f5dfbb479514624e0caedd64",
	"res://art/world/trims/trim_generic_n.png": "964f6805986f8d51884a91051f57c03a2bf8dbd9d0f5050de357704e8c2a6d3a",
	"res://art/world/trims/trim_generic_orm.png": "91c526d49ae295c6ad3e5c3f908997d926becd21cc438455d3bce6c02e959cd1",
	"res://art/world/trims/trim_generic.png": "8db61a3d92bdceda91d82785153690f26134a1a386d00f6a086daddc528215f0",
	"res://art/world/trims/trim_uk_brick_n.png": "bb40967132ec6dfd1bbe8afc5fa267526ef682269f1232c48a40a2a627e2a4d8",
	"res://art/world/trims/trim_uk_brick_orm.png": "36e2d71e10c702d6001e66f3c123ec1bd46429cad353ce61775e12af5166befd",
	"res://art/world/trims/trim_uk_brick.png": "e6e0b7192d3002b2506d4db38a0abc7e78c59804d3393b6ed5ef7e1ed680e9b9",
	"res://art/world/trims/trim_uk_stone_n.png": "5646eab1b4f39fd22df504c94e284f825d65654bba3d291b747f6a6472e28b1d",
	"res://art/world/trims/trim_uk_stone_orm.png": "071ea1e27e779b25c965ae89a0259e9820a49d82e86c11c4cdc95206814d6d71",
	"res://art/world/trims/trim_uk_stone.png": "5edf847eea46ac33f3e73f1d2360e9c51cba95be790b4dd19efe323a3c7badca",
	"res://art/world/trims/trim_us_brownstone_n.png": "1257ac04006f0e533a78cf8606c8c90fa9fa471fe40bef958f1dbb9a576ea5da",
	"res://art/world/trims/trim_us_brownstone_orm.png": "6830aff8f01b5f798ee5e7a7500da33867fc9f023195782520968f3eb9ad0f62",
	"res://art/world/trims/trim_us_brownstone.png": "45b966291683ca7c6ef35c0f4878c4539291af0a16495249f4af23f16c497c2f",
	"res://art/world/trims/trim_us_modern_n.png": "c7517451011b9231bb650b06233136c68aeedf02d306bcc5deb1654fff97402c",
	"res://art/world/trims/trim_us_modern_orm.png": "6bc419484520674d7a949c8a79f57a33c3b6fa10d196ac2c342dbe59de7ae228",
	"res://art/world/trims/trim_us_modern.png": "27a662d539d0cec44a26024e9ca3733bfbfcaeaa038e9d3bef9684a199d3557c",
	"res://art/world/trims/trim_us_west_n.png": "7f5b6c9d1b1ba2b2ce4358b1f1428af49b32b70bede3fd585cbc016d574dbdc1",
	"res://art/world/trims/trim_us_west_orm.png": "358d53cf64cc274a3c52c28a4e86c97c0115bbb4f27a4c1c0b1ab4812dec4dd0",
	"res://art/world/trims/trim_us_west.png": "8d8977f4735d896cbc3040ef4f8de89c99c11a67c1f3ad2c693a993916075b8d",
	"res://art/world/trims/trim_wa_render_n.png": "39082a89c7726388edec3d736acdc18782ec532d643f6267b8a1d0eef68babb0",
	"res://art/world/trims/trim_wa_render_orm.png": "a45200b8a8fde6e3b93c8ebbd9d6fe81a60685bafbc036f20ac3a806cade888c",
	"res://art/world/trims/trim_wa_render.png": "8b8aafdf76ce4dee64914acbb28195ccc50285f43ea1313ead00eb8811d23494",
	"res://art/world/roofs/roof_flat.png": "a0f56fadb6f4b62951489f08401106a69c8184d8bac371079254c68cf9aff530",
}

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _initialize() -> void:
	_files_untouched()
	_keys()
	_floor_seam()
	_albedo_gate()
	_places()
	_occluders()
	print("CQTEST done failures=%d" % _fails)
	quit(0 if _fails == 0 else 1)


func _files_untouched() -> void:
	var bad: Array = []
	for p: String in B28_SHA:
		var h: String = FileAccess.get_sha256(p)
		if h != str(B28_SHA[p]):
			bad.append(p.get_file())
	_check("low_files_build28_sha256", bad.is_empty() and B28_SHA.size() == 35, str(bad))


func _look(tier: String, extra: Dictionary = {}) -> Dictionary:
	var cfg: Dictionary = {"tier": tier, "look": extra.merged({"time": "golden"})}
	return ArenaScript.look_opts(cfg)


func _keys() -> void:
	_check("low_off", not StreetReal.on(_look("low")) and not StreetReal.caps_on(_look("low")))
	_check("mid_on", StreetReal.on(_look("mid")) and StreetReal.caps_on(_look("mid")) and not StreetReal.hi(_look("mid")))
	_check("high_on", StreetReal.on(_look("high")) and StreetReal.hi(_look("high")))
	_check("key_off", not StreetReal.on(_look("high", {"fid_street": false})))
	_check("cap_key", StreetReal.on(_look("high", {"fid_street_cap": false})) and not StreetReal.caps_on(_look("high", {"fid_street_cap": false})))


## The arena's plain floor and medallion (the "plain" arena builds only those): low as build 28, mid/high real.
func _arena(tier: String, extra: Dictionary = {}) -> Node3D:
	var a: Node3D = ArenaScript.new()
	root.add_child(a)
	a.call("build", {"arena": "plain", "tier": tier, "look": extra.merged({"time": "golden"})})
	return a


func _floor_seam() -> void:
	var lo: Node3D = _arena("low")
	var pm: Material = (lo.get("plaza") as MeshInstance3D).material_override
	var gm: Material = (lo.get("ground") as MeshInstance3D).material_override
	_check("low_medallion_build28", pm is StandardMaterial3D and (pm as StandardMaterial3D).albedo_texture == load("res://art/street/medallion.png")
		and not lo.has_meta("fid29_street"))
	_check("low_floor_build28", gm is StandardMaterial3D and (gm as StandardMaterial3D).albedo_texture == load("res://art/street/street_pavers.png"))
	var off: Node3D = _arena("high", {"fid_street": false})
	_check("key_off_medallion_build28", (off.get("plaza") as MeshInstance3D).material_override is StandardMaterial3D)
	for tier: String in ["mid", "high"]:
		var a: Node3D = _arena(tier)
		var m: Material = (a.get("plaza") as MeshInstance3D).material_override
		var ok: bool = m is ShaderMaterial
		var t: Texture2D = (m as ShaderMaterial).get_shader_parameter("albedo_tex") if ok else null
		var want: String = "res://art/street/real/medallion%s.png" % ("" if tier == "high" else "_mid")
		ok = ok and t != null and t.resource_path == want and t.get_image() != null and t.get_image().has_mipmaps()
		_check(tier + "_medallion_real_mipmapped", ok, str(t.resource_path if t != null else "none"))
		var g: Material = (a.get("ground") as MeshInstance3D).material_override
		_check(tier + "_floor_real", g is ShaderMaterial and (g as ShaderMaterial).shader == StreetReal.ground_shader())


## Every real albedo (ground, decals where opaque, medallion where opaque, facade sheets): linear luminance in range.
func _albedo_gate() -> void:
	var files: Array = []
	for d: String in ["res://art/world/real/ground/", "res://art/world/real/trims/", "res://art/street/real/"]:
		for f: String in DirAccess.get_files_at(d):
			if f.ends_with(".png") and not f.ends_with("_n.png") and not f.ends_with("_orm.png") and not f in ["wear.png", "paint_wear.png", "leak.png"]:
				files.append(d + f)
	var worst: Array = []
	var n_tex: int = 0
	var n_out: int = 0
	for p: String in files:
		var img := Image.new()
		if img.load_png_from_buffer(FileAccess.get_file_as_bytes(p)) != OK:
			worst.append(p.get_file() + ":unreadable")
			continue
		img.convert(Image.FORMAT_RGBA8)
		var w: int = img.get_width()
		var h: int = img.get_height()
		var data: PackedByteArray = img.get_data()
		var step: int = 3
		for y in range(0, h, step):
			for x in range(0, w, step):
				var i: int = (y * w + x) * 4
				if data[i + 3] < 128:
					continue
				var l: float = 0.2126 * _lin(data[i]) + 0.7152 * _lin(data[i + 1]) + 0.0722 * _lin(data[i + 2])
				n_tex += 1
				if l < 0.0395 or l > 0.8505:
					n_out += 1
		if n_out > 0 and worst.size() < 5:
			worst.append(p.get_file())
	print("CQTEST INFO albedo_gate files=%d texels=%d outside=%d" % [files.size(), n_tex, n_out])
	_check("albedo_lum_0.04_0.85", files.size() >= 18 and n_out == 0, str(worst))


static func _lin(b: int) -> float:
	var c: float = b / 255.0
	return c / 12.92 if c <= 0.04045 else pow((c + 0.055) / 1.055, 2.4)


func _place(ground: Dictionary, at: Vector2, yaw: float, look: Dictionary) -> Node3D:
	var p: Node3D = PlaceScript.new()
	root.add_child(p)
	p.call("build", ground, at, 12.0, yaw, look, Callable())
	return p


func _mesh_mat(p: Node3D, n: String) -> Material:
	var mi: Node = p.get_node_or_null(n)
	return (mi as MeshInstance3D).material_override if mi is MeshInstance3D else null


func _places() -> void:
	var traf: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/trafalgar_ground.json"))
	var street: Dictionary = StreetLayout.ground()
	for tier: String in ["low", "mid", "high"]:
		var lk: Dictionary = _look(tier)
		var pt: Node3D = _place(traf, Vector2(4.9, -4.0), NAN, lk)
		var ps: Node3D = _place(street, Vector2.ZERO, 0.0, lk)
		var real: bool = tier != "low"
		var fm: Material = _mesh_mat(pt, "floor")
		var fs: bool = fm is ShaderMaterial and (fm as ShaderMaterial).shader == StreetReal.ground_shader()
		_check(tier + "_floor_material", fs == real, str(fm))
		var fac: Material = _mesh_mat(ps, "buildings_trim_uk_brick")
		var fr: bool = fac is ShaderMaterial and (fac as ShaderMaterial).shader == StreetReal.facade_shader()
		_check(tier + "_facade_material", fr == real, str(fac))
		_check(tier + "_occluders", (pt.get_node_or_null("GroundOccluders") != null) == real)
		var si: Dictionary = ps.get("info")
		var ti: Dictionary = pt.get("info")
		_check(tier + "_same_place", int(ti.get("buildings", 0)) == 199 and int(si.get("buildings", 0)) > 50, "%s %s" % [ti.get("buildings"), si.get("buildings")])
		if real:
			var sr: Dictionary = ti.get("street_real", {})
			var ss: Dictionary = si.get("street_real", {})
			var rt: int = int(sr.get("reveal_tris", 0))
			var rs: int = int(ss.get("reveal_tris", 0))
			print("CQTEST INFO %s reveal_tris trafalgar=%d street=%d basins=%d" % [tier, rt, rs, int(sr.get("basins", 0))])
			_check(tier + "_reveals", (rt == 0 and rs == 0) if tier == "mid" else (rs > 0 and rt <= 20000 and rs <= 20000), "%d %d" % [rt, rs])
			_check(tier + "_near_bake", pt.get_node_or_null("ShadeBakeNear") != null)
		else:
			_check("low_no_real", not ti.has("street_real") and pt.get_node_or_null("ShadeBakeNear") == null and pt.get_node_or_null("gutters") == null)


## A fight-shaped stand-in: 3 fighters with the game's leg bones; the occluders read them and fill the arrays.
func _occluders() -> void:
	var fs := GDScript.new()
	fs.source_code = "extends Node3D\nvar fighters: Array = []\n"
	fs.reload()
	var ff := GDScript.new()
	ff.source_code = "extends Node3D\nvar model: Node3D\n"
	ff.reload()
	var fight: Node3D = Node3D.new()
	fight.set_script(fs)
	root.add_child(fight)
	var host := Node3D.new()
	fight.add_child(host)
	var fl: Array = []
	for i in 3:
		var f: Node3D = Node3D.new()
		f.set_script(ff)
		var model := Node3D.new()
		var sk := Skeleton3D.new()
		model.add_child(sk)
		f.add_child(model)
		f.set("model", model)
		fight.add_child(f)
		f.position = Vector3(i * 2.0 - 2.0, 0.0, 0.0)
		var names: Array = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]
		var ys: Array = [0.95, 0.9, 0.5, 0.08, 0.02, 0.9, 0.5, 0.08, 0.02]
		for k in names.size():
			sk.add_bone(names[k])
			sk.set_bone_rest(k, Transform3D(Basis(), Vector3((-0.1 if k < 5 else 0.1) if k > 0 else 0.0, ys[k], 0.12 if k in [4, 8] else 0.0)))
		sk.reset_bone_poses()
		fl.append(f)
	fight.set("fighters", fl)
	var occ: Node = Occluders.new()
	host.add_child(occ)
	var sm := ShaderMaterial.new()
	sm.shader = StreetReal.ground_shader()
	occ.call("register", sm)
	var before: Array = []
	for f: Node3D in fl:
		before.append(((f.get("model") as Node3D).get_child(0) as Skeleton3D).get_bone_pose_position(2))
	for i in 200:
		occ.call("_process", 1.0 / 30.0)
	var st: Dictionary = occ.call("stats")
	var cf: PackedVector4Array = sm.get_shader_parameter("cap_f")
	var ca: PackedVector4Array = sm.get_shader_parameter("cap_a")
	print("CQTEST INFO occluders " + str(st))
	_check("occluders_three_fighters", cf.size() == 4 and cf[0].w == 1.0 and cf[2].w == 1.0 and cf[3].w == 0.0, str(cf))
	_check("occluders_capsules", ca.size() == 24 and ca[0].w > 0.03 and ca[5].w > 0.0 and absf(ca[2].y - 0.5) < 0.01, str(ca.slice(0, 6)))
	var same: bool = true
	for k in fl.size():
		same = same and ((fl[k].get("model") as Node3D).get_child(0) as Skeleton3D).get_bone_pose_position(2) == before[k]
	_check("occluders_read_only", same)
	_check("occluders_under_0.1ms", float(st["mean_ms"]) <= 0.1, str(st))
