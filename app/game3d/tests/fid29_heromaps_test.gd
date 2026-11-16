extends SceneTree
## fid29 heromaps (build 29): the compressed, denser, de-lit hero files and the seam that picks them (hero_files.gd).
##   godot --headless --path app/game3d -s res://tests/fid29_heromaps_test.gd
## 1. hero_files.gd maps only the shipped hero and cast Guardian files to their "r" siblings, and only with the look's
##    "fid_heromaps", the file present and ASTC sampled natively; with ASTC reported absent (forced here) the loader
##    opens build 28's file, so an ASTC-less Android never decodes ASTC to RGBA8.
## 2. The fight's chain on each tier's own look (arena.gd TIER_LOOK): low opens exactly the file the hero cast chose,
##    mid and high get its r file; the cast Guardians on low keep theirs.
## 3. Every r file the pck ships: under the disk caps (lod0r 14 MiB, lod1r 6 MiB), loads, keeps build 28's rig (bone
##    names, parents, rests) and model AABB within 0.5 mm (fighter.gd scales and centres by it, so the fight is the
##    same), has every map compressed, and stays inside the tier budget (lod0r: 50k triangles, 7 surfaces; lod1r: 20k, 5).
## 4. Build 28's files are untouched: every hero lod0/lod1 and every cast lod0/lod1/lod2 file has build 28's sha256.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const HeroFiles := preload("res://hero_files.gd")
const Loader := preload("res://char_loader.gd")
const FighterScript := preload("res://fighter.gd")
const FightScript := preload("res://fight.gd")
const ArenaScript := preload("res://arena.gd")

const MIB: int = 1024 * 1024
const CAP_LOD0R: int = 14 * MIB
const CAP_LOD1R: int = 6 * MIB

## sha256 of build 28's model files (build-28 89840bb): the low tier opens only files from this list.
const B28_SHA: Dictionary = {
	"res://cast/heroes/ascendants_zuri_lod0.glb": "c835a1e70d38b99aafbbcace8c37cc8e81420635ef34fe48935925ac6cda6647",
	"res://cast/heroes/ascendants_zuri_lod1.glb": "7e7ba6f4d20b0ae7ab122e928c763c370a2eeb1061ef2384bd911a114667ca8d",
	"res://cast/heroes/blockbusters_kofi_lod0.glb": "6bd1b725449b5ce3b985fe71790934e6ae688a30a07c7b5298c2fffc255069f8",
	"res://cast/heroes/blockbusters_kofi_lod1.glb": "dd90b5b729b5adeb330f5c386d3e3d32c0ad8a4bf70db9b0b997b2d6e8e6f77f",
	"res://cast/heroes/celestials_lyra_lod0.glb": "07025af2eac130e2dd6a54fa9265cbdac001820d75a4fe2307de58dfb52d5f92",
	"res://cast/heroes/celestials_lyra_lod1.glb": "eee238a8f71aee035f4b7b6166ae7b5b6d4f35f661ef7a4e85dbe1a53ef657d7",
	"res://cast/heroes/controllers_tavo_lod0.glb": "a338cd458383f90605638e4fcfe972e8a57e8b092891562d699f62bcaa834427",
	"res://cast/heroes/controllers_tavo_lod1.glb": "e8a9dd1f2b84e0783e41fabbaa14419b26b0e0bc82a346ca80294f9d5a37a988",
	"res://cast/heroes/everborn_oren_lod0.glb": "bce7753f836e810a11eb8aaa1dce4f406d7ebbf77da4610d5016e0be88db2ae7",
	"res://cast/heroes/everborn_oren_lod1.glb": "ae472405d82bde269840dc5635711281f19544a568eabe4f1c14acd5be7675a5",
	"res://cast/heroes/icons_imani_lod0.glb": "0d160564643d289a490992cab1854639721af91378433242d8e12918a5ee4850",
	"res://cast/heroes/icons_imani_lod1.glb": "defa658cadf4f411fce0b4a2ad499f923a78f12c573ea32e7f172d1d0e977c6c",
	"res://cast/armstrong_lod0.glb": "990ee8ced7d73ad2509f7711e9737b7f8233c274c2f179ff7f1c8ba416ab1523",
	"res://cast/armstrong_lod1.glb": "133ba991334c34336ea1fd6bea202e653ed2161f8ca584389ba2c56bfe15f3e7",
	"res://cast/armstrong_lod2.glb": "4b1afb4067ff0852ca8e5bccafbd4e031d0b303b63d139007f56dae9fef9e321",
	"res://cast/bobo_lod0.glb": "75cb04abb703ae216c5977654a67269030ab97b185ae582b19b90631cb118ddc",
	"res://cast/bobo_lod1.glb": "9ff121198ff284c96c11be607d38b4785767d59b2ca7dccc7f43d43ef607aa32",
	"res://cast/bobo_lod2.glb": "fb3f9b274ba5329cf60adbd7ba089d1fc21d140392bef78ab297e483c88a346f",
	"res://cast/catboy_lod0.glb": "76c3b05ea1f1524dfc469dafea1bc90fd56f3d696756846325f03c05053d2dc0",
	"res://cast/catboy_lod1.glb": "d106cc3c9091efe4199046e1c845cdfca54e4e468f5e83c9d9949c6959e82385",
	"res://cast/catboy_lod2.glb": "efd2d840a7d34eac2ddb28c80a93c5e6722d0677485f313f1ad7df885d836f70",
	"res://cast/crystalz_lod0.glb": "4877e862990fc5208a85edcd46e7118c37728c06a4b862ca60ddfa181ae86d3e",
	"res://cast/crystalz_lod1.glb": "2d0ef3a7ef2f1ecde9536144d68ab638895cef2187647277e8d3adf96bdd58da",
	"res://cast/crystalz_lod2.glb": "37c887253fde00e721c67782964c1a4f49ac8b4db877f62ce7207fef2ec25db6",
	"res://cast/elvis_lod0.glb": "3407751486baf118b82cd475104e4bfbb3855d09221fc8b2aee8b251bda92bc5",
	"res://cast/elvis_lod1.glb": "2e791a71d1db77fa099423c40da22f3ae4c3bddf8b98be2ccbdeab632b0c310c",
	"res://cast/elvis_lod2.glb": "febf2ec8cc68deb9b35745fc4bae3d26a7b0f6b6431a38570e4e9259f394e3c3",
	"res://cast/hoof_lod0.glb": "b224884aa8dbe842960f11cf5ee90353fa50778894202abede30aab6003bb046",
	"res://cast/hoof_lod1.glb": "fce7f37bae86fe66441e80477a1c0dc36b885710ea510c3d0c9beeb529d5736c",
	"res://cast/hoof_lod2.glb": "9291aa996c6750aeaf5fd371f64e610e705e808c0f648ce1a35a0cf0ec12335b",
	"res://cast/nebulx_lod0.glb": "a7d9a2ccff115096a704d282e341f51d29f5b4acaa181441c0694839d6637018",
	"res://cast/nebulx_lod1.glb": "11f1522244c1b33b2f039aaa8c28e84b45c80b6e9f1974c9cde6a35030a491f7",
	"res://cast/nebulx_lod2.glb": "5b3cb8c4b9ad9f29324d9a1f6fb48c8ee1d2616c509b5a5cd4cc30bcd2e9320b",
	"res://cast/vanessa_lod0.glb": "10a2688ecfa3deefce383627e1f6f3804ae1c43bfabdd9644cbe4c90c347fc38",
	"res://cast/vanessa_lod1.glb": "1f13774dc7c740d9b2ee3c1996c322a7e5da573325891a88be366a6ca18967dd",
	"res://cast/vanessa_lod2.glb": "61ffc582559e64c67005ee99b2863db67bc0321b6596c84bbee391297d6b90fc"
}

var _fails: int = 0


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _rig(node: Node) -> Array:
	var out: Array = []
	for sk: Skeleton3D in node.find_children("*", "Skeleton3D", true, false):
		for b in sk.get_bone_count():
			out.append([sk.get_bone_name(b), sk.get_bone_parent(b), sk.get_bone_rest(b)])
	return out


func _rig_same(a: Array, b: Array) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		if a[i][0] != b[i][0] or a[i][1] != b[i][1]:
			return false
		var ta: Transform3D = a[i][2]
		var tb: Transform3D = b[i][2]
		if not ta.is_equal_approx(tb):
			return false
	return true


func _stats(node: Node) -> Dictionary:
	var tris: int = 0
	var surfaces: int = 0
	var all_compressed: bool = true
	var maps: int = 0
	var seen: Dictionary = {}
	for mi: MeshInstance3D in node.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = mi.mesh
		for s in mesh.get_surface_count():
			surfaces += 1
			var arr := mesh.surface_get_arrays(s)
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
			tris += idx.size() / 3
			var m := mesh.surface_get_material(s) as BaseMaterial3D
			if m == null:
				continue
			for p: int in [BaseMaterial3D.TEXTURE_ALBEDO, BaseMaterial3D.TEXTURE_METALLIC, BaseMaterial3D.TEXTURE_ROUGHNESS,
					BaseMaterial3D.TEXTURE_NORMAL, BaseMaterial3D.TEXTURE_EMISSION, BaseMaterial3D.TEXTURE_AMBIENT_OCCLUSION]:
				var t := m.get_texture(p) as ImageTexture
				if t == null or seen.has(t):
					continue
				seen[t] = true
				maps += 1
				var img: Image = t.get_image()
				if img != null and not img.is_compressed():
					all_compressed = false
	return {"tris": tris, "surfaces": surfaces, "compressed": all_compressed, "maps": maps}


func _initialize() -> void:
	# 1. the seam
	_check("r_path_hero_lod0", HeroFiles.r_path("res://cast/heroes/icons_imani_lod0.glb") == "res://cast/heroes/icons_imani_lod0r.glb")
	_check("r_path_hero_lod1", HeroFiles.r_path("res://cast/heroes/icons_imani_lod1.glb") == "res://cast/heroes/icons_imani_lod1r.glb")
	_check("r_path_cast", HeroFiles.r_path("res://cast/hoof_lod0.glb") == "res://cast/hoof_lod0r.glb")
	_check("r_path_lod2_none", HeroFiles.r_path("res://cast/hoof_lod2.glb") == "")
	_check("r_path_forge_none", HeroFiles.r_path("/data/forge/abc/lod1.glb") == "" and HeroFiles.r_path("user://forge/x_lod1.glb") == "")
	_check("r_path_subdir_none", HeroFiles.r_path("res://cast/heroes/old/icons_imani_lod1.glb") == "")
	var any_r: String = ""
	for k: String in FightScript.HERO_ORDER:
		if FileAccess.file_exists(FightScript.HERO_DIR + k + "_lod1r.glb"):
			any_r = FightScript.HERO_DIR + k + "_lod1.glb"
			break
	if any_r == "":
		# build 29 ships the seam only (heromaps keep-partial: the r files wait on the app-size OK). With no r file in
		# the pck the seam must hand back build 28's file for every hero, role and tier, even with ASTC reported present.
		HeroFiles.force_astc = 1
		_check("pick_missing_r_keeps_b28", HeroFiles.pick("res://cast/heroes/nobody_lod1.glb", "hero", {"fid_heromaps": true}) == "res://cast/heroes/nobody_lod1.glb")
		for k: String in FightScript.HERO_ORDER:
			for sfx: String in ["_lod0.glb", "_lod1.glb"]:
				var hp: String = FightScript.HERO_DIR + k + sfx
				var same: bool = true
				for t: String in ["low", "mid", "high"]:
					same = same and HeroFiles.pick(hp, "hero", ArenaScript.TIER_LOOK[t]) == hp
				_check("seam_only_b28_" + k + sfx.get_basename(), same)
	if any_r != "":
		HeroFiles.force_astc = 1
		_check("pick_off_without_look", HeroFiles.pick(any_r, "hero", {}) == any_r)
		_check("pick_off_when_false", HeroFiles.pick(any_r, "hero", {"fid_heromaps": false}) == any_r)
		_check("pick_on", HeroFiles.pick(any_r, "hero", {"fid_heromaps": true}) == HeroFiles.r_path(any_r))
		_check("pick_missing_r_keeps_b28", HeroFiles.pick("res://cast/heroes/nobody_lod1.glb", "hero", {"fid_heromaps": true}) == "res://cast/heroes/nobody_lod1.glb")
		HeroFiles.force_astc = 0
		_check("pick_no_astc_keeps_b28", HeroFiles.pick(any_r, "hero", {"fid_heromaps": true}) == any_r)
		# 2. the fight's chain (fight.gd: _hero_cast, _tier_lod's choice, then the seam) on each tier's own look
		HeroFiles.force_astc = 1
		for t: String in ["low", "mid", "high"]:
			var lk: Dictionary = ArenaScript.TIER_LOOK[t]
			for role: String in ["hero", "ally", "enemy"]:
				var f: Node = FightScript.new()
				f.cfg = {"tier": t, "seed": 7, "faction": "icons", "hero_cast": true}
				var p: String = f._hero_cast(role, "")
				f.free()
				if p == "":
					continue
				var q: String = HeroFiles.pick(p, role, lk)
				var want: String = p if t == "low" or not FileAccess.file_exists(HeroFiles.r_path(p)) else HeroFiles.r_path(p)
				_check("chain_%s_%s" % [t, role], q == want, "%s -> %s" % [p, q])
		for c: String in ["armstrong", "hoof", "bobo"]:
			var cp: String = "res://cast/%s_lod1.glb" % c
			_check("chain_low_cast_" + c, HeroFiles.pick(cp, "enemy", ArenaScript.TIER_LOOK["low"]) == cp)
		HeroFiles.force_astc = 0
		_check("chain_high_no_astc", HeroFiles.pick(any_r, "hero", ArenaScript.TIER_LOOK["high"]) == any_r)
	HeroFiles.force_astc = -1
	# 3. every r file
	var dirs: Array[String] = [FightScript.HERO_DIR, "res://cast/"]
	for d: String in dirs:
		var da := DirAccess.open(d)
		if da == null:
			continue
		for f: String in da.get_files():
			if not (f.ends_with("_lod0r.glb") or f.ends_with("_lod1r.glb")):
				continue
			var rp: String = d + f
			var lod0: bool = f.ends_with("_lod0r.glb")
			var bp: String = rp.substr(0, rp.length() - 5) + ".glb"
			var n: int = FileAccess.open(rp, FileAccess.READ).get_length()
			_check("disk_" + f, n <= (CAP_LOD0R if lod0 else CAP_LOD1R), "%d bytes" % n)
			# load both with the r swap off (absolute choice of file), compare
			var old: Dictionary = Loader.new().load_glb(bp, false)
			var new: Dictionary = Loader.new().load_glb(rp, false)
			_check("loads_" + f, bool(new.get("ok", false)) and bool(old.get("ok", false)), str(new.get("error", "")))
			if not bool(new.get("ok", false)) or not bool(old.get("ok", false)):
				continue
			var a0: AABB = FighterScript._model_aabb(old["node"])
			var a1: AABB = FighterScript._model_aabb(new["node"])
			var dpos: float = (a0.position - a1.position).abs().length()
			var dsize: float = (a0.size - a1.size).abs().length()
			_check("aabb_" + f, (a0.position - a1.position).abs().x <= 0.0005 and (a0.position - a1.position).abs().y <= 0.0005
				and (a0.position - a1.position).abs().z <= 0.0005 and (a0.size - a1.size).abs().x <= 0.0005
				and (a0.size - a1.size).abs().y <= 0.0005 and (a0.size - a1.size).abs().z <= 0.0005, "%s vs %s" % [a0, a1])
			_check("rig_same_" + f, _rig_same(_rig(old["node"]), _rig(new["node"])))
			var st: Dictionary = _stats(new["node"])
			_check("budget_" + f, int(st["tris"]) <= (50000 if lod0 else 20000) and int(st["surfaces"]) <= (7 if lod0 else 5), str(st))
			_check("compressed_" + f, bool(st["compressed"]) and int(st["maps"]) > 0, str(st))
			(old["node"] as Node).free()
			(new["node"] as Node).free()
	# 4. build 28's files untouched
	for p: String in B28_SHA:
		_check("b28_same_" + p.get_file(), FileAccess.file_exists(p) and FileAccess.get_sha256(p) == str(B28_SHA[p]))
	_check("b28_list_present", B28_SHA.size() >= 36, "%d entries" % B28_SHA.size())
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
