extends SceneTree
## fid29 combat (build 29): combat motion and hit effects on the mid and high tiers; the low tier unchanged.
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tests/fid29_combat_test.gd
## 1. Build 28's clip libraries (anim/*.glb), data/anim_clips.json, data/secondary.json and art/fx/fx_atlas.png
##    keep their build 28 sha256 (low phones load exactly these).
## 2. Low (no real look): no dead blending, no captured library, the procedural flinch; Imani's states and clips
##    are the build 28 ones.
## 3. Mid/high (look real): dead blending is the first skeleton modifier and blends a clip switch with no
##    crossfade; the captured clips are in their own library ("cqr"); a captured clip that stands in for a build
##    28 clip has its frames, contact, in, out and tail (the button's length and event times).
## 4. Variation never touches the fight's RNG: 1,000 picks (and 200 guard plays) leave fight.gd's rng state as it
##    was, and the same slot and count always give the same pick.
## 5. A blow plays a directional captured recoil (front, back, left, right) on the spine and arms (pose_layer
##    add_layers), the procedural flinch stays off while it plays, and it fades out.
## 6. The KO settle: no physics body of this lane exists before the result is final (none while "fighting", none
##    after the fall with the fight still on); after the result it starts, no bone ends more than 3 cm under the
##    ground and the body is settled within 1.2 s.
## 7. Effects: the low tier's cards, beams and arcs use build 28's shader resources; mid/high cards and beams compile
##    with FID29, high arcs with FLOW (mid arcs build 28's); a hit sets a shield on the cards it made and on cards made
##    at the struck body within SHIELD_HOLD.
## 8. Cost: the animation modifiers this lane adds (dead blending while it blends, the pose guard, the additive hit layers) take at
##    most 0.3 ms a frame for three fighters (measured on this core).
## 9. Credits: every CC-BY source in docs/game3d/fid29/ASSETS-LICENCES-combat.md is on the Credits screen
##    (app/components/waleui/CreditsScreen.tsx).
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const FightScript := preload("res://fight.gd")
const AnimLib := preload("res://anim_library.gd")
const FighterScript := preload("res://fighter.gd")
const CombatAnimator := preload("res://combat_animator.gd")
const FxScript := preload("res://fx.gd")
const KoSettle := preload("res://ko_settle.gd")

const B28_SHA: Dictionary = {
	"anim/armstrong.glb": "c6f0d83a4356e49106d584b42fe9acf77e5363e461a2be943acc98295019aeb7",
	"anim/ascendants_zuri.glb": "1f328950c940bd4cfc8f59af8303afa68abe5e0b726b45355def56358ea2ca41",
	"anim/blockbusters_kofi.glb": "2d944d822fa05fd77fcfec770b0180662f45d69bb9b4d3af7092af5faef7ed48",
	"anim/bobo.glb": "279b7ad7fdf5830f48db75240b73a9502abee55eafb1ae35b08e6e3ceebeb32d",
	"anim/catboy.glb": "1c6f8068462fccfde00ed87a353588edcfc68b2b60c74081c00f3d31f7baeeaf",
	"anim/celestials_lyra.glb": "8bfe3a7d3a1a748119cf20d76bbe5c5553b011d6d93fd5155c7f4bbcc613ebb2",
	"anim/controllers_tavo.glb": "59b4efab5283bb98f3e88516d32857a60bf886cc3697eaa4a43c8ab2ad74f931",
	"anim/crystalz.glb": "858279726211285bd4985cf07b6ef95276ca1027a18a5f60aaf4b0555a95e49f",
	"anim/elvis.glb": "2e8c1f890d30c184f777bd1d42bcc0e64d5c9c94edd68cdb8202a0856c678970",
	"anim/everborn_oren.glb": "dfa64d7927d4392e68e3986acea46375a97e221ffbb6fabda973154adbe8245a",
	"anim/forge_kade.glb": "aca9325d35e8657876093c3e7869e0ffbb60c7993fb1a7c8c2842862381e8929",
	"anim/forge_samurai.glb": "23d44f5eea8232fe793ce52e637628d2d2a81cc9a2e817a8ff166f6da5ade711",
	"anim/forge_soldier.glb": "a3ade80156a18344e11e918ed71c768aaa5b8ecd4d6e0d6836a014984ba9ae05",
	"anim/hoof.glb": "0d0719fa4db778215e852eafac8a633fdf2919db250e8294fb94b9ebef3d9fed",
	"anim/icons_imani.glb": "3d962190a15c1d1b8a3023f1d572a4d4e49ca544fa23f4a8c574fde6315ca038",
	"anim/nebulx.glb": "42e3dd322ccf3ad409f0e7de0e0a9bdd321cb90e230c64fcd5480920a5c1302c",
	"anim/vanessa.glb": "7edc3125f2b47f41247bd27dabad4c106d8acfc709674bc4cef252eb69c6535d",
	"data/anim_clips.json": "56902c00722359a7be1a7586230a23ac3c887b4c25c1f4c576b76789a5f0d86e",
	"data/secondary.json": "4b78ae90968bfd46d018992ea37cc5c4b8f84baa75247deb9a7531380ac93b9d",
	"art/fx/fx_atlas.png": "e8b255e22f10014a361b15694c9fa680a0b8ab99ffc85d7315151c54d767598e",
}
const KEY: String = "icons_imani"
const HERO: String = "res://cast/heroes/icons_imani_lod1.glb"
const FAKE_FIGHT: String = "extends Node3D\nvar state: String = \"fighting\"\nvar outcome: String = \"\"\nvar arena: Node3D\nvar cfg: Dictionary = {}\nvar fighters: Array = []\n"
const FAKE_ARENA: String = "extends Node3D\nvar look: Dictionary = {}\n"

var _fails: int = 0
var _fight: Node3D
var _f: FighterScript
var _phase: String = ""
var _n: int = 0
var _ko: Dictionary = {}
var _low: FighterScript


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		# the measurement too, for the lane doc (docs/game3d/fid29/combat.md)
		print("CQTEST PASS " + name + ("" if why == "" else " (" + why + ")"))
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


func _script(src: String) -> GDScript:
	var g := GDScript.new()
	g.source_code = src
	g.reload()
	return g


func _model() -> Node3D:
	var doc := GLTFDocument.new()
	var gs := GLTFState.new()
	doc.append_from_buffer(FileAccess.get_file_as_bytes(HERO), "", gs)
	return doc.generate_scene(gs)


func _spawn(look: Dictionary, parent: Node) -> FighterScript:
	var f: FighterScript = FighterScript.new()
	parent.add_child(f)
	f.setup("Imani", 0, 1000, Color.WHITE, "hero")
	f.look = look
	f.anim_opts = {"key": KEY, "class": "sword", "natural_rates": true, "no_bind": true}
	f.set_model(_model())
	return f


func _initialize() -> void:
	AnimLib.motion = "hybrid"
	AnimLib.readable = 1
	# 1. build 28's files
	var same: Array[String] = []
	var diff: Array[String] = []
	for p: String in B28_SHA:
		var got: String = FileAccess.get_sha256("res://" + p)
		if got == str(B28_SHA[p]):
			same.append(p)
		else:
			diff.append("%s %s" % [p, got.substr(0, 12)])
	_check("build28_libraries_data_and_atlas_unchanged", diff.is_empty(), str(diff))
	# a fake fight (state, outcome, arena, cfg, fighters) so fx.gd and ko_settle.gd see what fight.gd gives them
	_fight = Node3D.new()
	_fight.set_script(_script(FAKE_FIGHT))
	root.add_child(_fight)
	var arena := Node3D.new()
	arena.set_script(_script(FAKE_ARENA))
	_fight.add_child(arena)
	_fight.set("arena", arena)
	# 2. low
	var low: FighterScript = _spawn({}, _fight)
	var la = low.anim
	_check("low_no_dead_blend", la.dead_blend == null and la.skeleton.get_node_or_null("DeadBlend") == null and not la.fid, "fid=%s" % str(la.fid))
	_check("low_no_captured_library", not la.player.has_animation_library(AnimLib.REAL_LIB))
	var b28: Dictionary = AnimLib.states_for("sword", KEY)
	var ok_states: bool = true
	for st: String in ["victory", "intro", "guard", "attack_1", "death"]:
		if b28.has(st) and str(la.clips.get(st, "")) != AnimLib.LIB_NAME + "/" + str((b28[st] as Dictionary)["clip"]) and not str(la.clips.get(st, "")).begins_with(AnimLib.LIB_NAME + "/" + str((b28[st] as Dictionary)["clip"])):
			ok_states = false
	_check("low_states_are_build28", ok_states, str(la.clips))
	_low = low
	# 3. mid/high
	_f = _spawn({"real": true}, _fight)
	_fight.set("fighters", [_f])
	var a = _f.anim
	_check("real_dead_blend_installed_first", a.dead_blend != null and a.skeleton.get_child(0) == a.dead_blend, str(a.skeleton.get_child(0).name))
	var rc: Dictionary = AnimLib.real_for(KEY, a.skeleton)
	_check("real_library_bound", a.player.has_animation_library(AnimLib.REAL_LIB) and not rc.is_empty(), str(rc.keys()))
	var timing_ok: bool = true
	var timing_why: String = ""
	var d28: Dictionary = AnimLib.data().get("clips", {})
	for st: String in (rc.get("states", {}) as Dictionary):
		var cn: String = str(rc["states"][st])
		var m: Dictionary = (AnimLib.real_data().get("clips", {}) as Dictionary).get(cn, {})
		var old: Dictionary = d28.get(str(m.get("replaces", "")), {})
		for k: String in ["frames", "contact", "in", "out", "tail"]:
			if old.has(k) != m.has(k) or (old.has(k) and int(old[k]) != int(m[k])):
				timing_ok = false
				timing_why += "%s.%s %s/%s " % [cn, k, str(old.get(k)), str(m.get(k))]
		var anim: Animation = a.player.get_animation(AnimLib.REAL_LIB + "/" + cn)
		if anim == null or int(round(anim.length * 30.0)) + 1 != int(old.get("frames", -1)):
			timing_ok = false
			timing_why += "%s length %s " % [cn, str(anim.length if anim != null else -1.0)]
		if str(a.clips.get(st, "")) != AnimLib.REAL_LIB + "/" + cn:
			timing_ok = false
			timing_why += "%s not mapped " % st
	# every hero's captured state clips (each hero's intro; the victories that pass the tear gate)
	var n_states: int = 0
	for key: String in (AnimLib.real_data().get("characters", {}) as Dictionary):
		var cs: Dictionary = (AnimLib.real_data()["characters"][key] as Dictionary).get("states", {})
		for st: String in cs:
			n_states += 1
			var m2: Dictionary = (AnimLib.real_data().get("clips", {}) as Dictionary).get(str(cs[st]), {})
			var old2: Dictionary = d28.get(str(m2.get("replaces", "")), {})
			for k: String in ["frames", "contact", "in", "out", "tail"]:
				if old2.is_empty() or old2.has(k) != m2.has(k) or (old2.has(k) and int(old2[k]) != int(m2[k])):
					timing_ok = false
					timing_why += "%s %s.%s " % [key, str(cs[st]), k]
	_check("real_states_keep_button_length_and_events", timing_ok and n_states >= 8, timing_why + " states %d" % n_states)
	# the captured intro (100STYLE idle) stands in for the hero's intro, and its arms hang at the sides: the first cut
	# fell inside the take's arms-out stretch (a T-pose read on the game camera). Upper arms at least 45 degrees below
	# level at the start, middle and end of the clip.
	var intro_clip: String = str(a.clips.get("intro", ""))
	var arms_ok: bool = intro_clip.begins_with(AnimLib.REAL_LIB + "/ST_Intro_")
	var arms_why: String = intro_clip
	if arms_ok:
		var ianim: Animation = a.player.get_animation(intro_clip)
		var sk: Skeleton3D = a.skeleton
		for u: float in [0.0, 0.5, 1.0]:
			a.player.play(intro_clip, 0.0)
			a.player.seek(ianim.length * u, true)
			for side: String in ["Left", "Right"]:
				var b0: int = sk.find_bone(side + "Arm")
				var b1: int = sk.find_bone(side + "ForeArm")
				if b0 < 0 or b1 < 0:
					continue
				var d: Vector3 = (sk.get_bone_global_pose(b1).origin - sk.get_bone_global_pose(b0).origin).normalized()
				var elev: float = rad_to_deg(asin(clampf(d.y, -1.0, 1.0)))
				arms_why += " %s@%.1f %.0f" % [side, u, elev]
				if elev > -45.0:
					arms_ok = false
	_check("real_intro_is_captured_arms_down", arms_ok, arms_why)
	# 4. variation and the fight's RNG
	var fight_obj: Node = FightScript.new()
	var rng: RandomNumberGenerator = fight_obj.get("rng")
	rng.seed = 239
	var st0: int = rng.state
	var picks: Array = []
	for i in 1000:
		picks.append(a.variant_pick("guard", i))
	for i in 200:
		a.play("attack_1", 0.34, 0.11)
		a.play("guard")
	_check("variation_never_touches_fight_rng", rng.state == st0, "%d -> %d" % [st0, rng.state])
	var again: bool = true
	for i in 1000:
		again = again and a.variant_pick("guard", i) == int(picks[i])
	var kinds: Dictionary = {}
	for p: Variant in picks:
		kinds[p] = true
	_check("variation_is_deterministic", again and (kinds.size() >= 2 or not a._variants.has("guard")), "kinds %s, variants %s" % [str(kinds.keys()), str(a._variants.get("guard", []))])
	fight_obj.free()
	_f.anim.play("idle")
	_phase = "low"
	_n = 0


func _process(_dt: float) -> bool:
	if _phase == "":
		return false
	var a = _f.anim
	_n += 1
	# drive the fighters as fight.gd does (logic, then the visual tick: the animator's update)
	for f: FighterScript in ([_f, _low] if _low != null and is_instance_valid(_low) else [_f]):
		f.tick_logic(1.0 / 30.0)
		f.tick_visual(1.0 / 30.0)
	match _phase:
		"low":
			if _n == 4:
				_low.anim.flinch(Vector3(0, 0, 1), 1.0)
			elif _n == 5:
				_check("low_flinch_is_procedural", not _low.anim.layer.pose.is_empty() and _low.anim.layer.add_layers.is_empty(), str(_low.anim.layer.pose))
				_low.queue_free()
				_low = null
			elif _n == 6:
				var b0: int = a.dead_blend.blends
				a.play("attack_1", 0.34, 0.11)
				_check("real_switch_is_dead_blended", a.dead_blend.blends == b0 + 1 and a.dead_blend.blending(), "blends %d" % a.dead_blend.blends)
			elif _n == 20:
				_phase = "hit"
				_n = 0
		"hit":
			if _n == 1:
				_f.anim.play("idle")
			elif _n == 10:
				# pushed to its own left (+X of the model holder)
				a.flinch(a.layer.frame_root.global_basis.orthonormalized() * Vector3(1, 0, 0), 1.0)
				var dirs: Array = []
				for e: Array in a._add_set:
					for d: String in a._hit_anims:
						if a._hit_anims[d] == e[0]:
							dirs.append(d)
				_check("hit_clip_plays_on_a_blow", not a._add_set.is_empty() or a._hit_anims.is_empty(), "hit clips %s" % str(a._hit_anims.keys()))
				var want: String = "left" if a._hit_anims.has("left") else ""
				_check("hit_clip_follows_the_push", want == "" or dirs.has(want), "pushed to its left: %s" % str(dirs))
			elif _n == 13:
				_check("hit_layers_on_spine_and_arms", not a.layer.add_layers.is_empty() and a._flinch_pose().is_empty(), str(a.layer.add_layers.size()))
			elif _n == 30:
				_check("hit_layers_fade_out", a.layer.add_layers.is_empty() and a._add_t < 0.0, str(a._add_t))
				_cost()
				_guard_check()
				_effects()
				_credits()
				_phase = "ko"
				_n = 0
		"ko":
			if _n == 1:
				_f.die()
			if _n < 75:
				if a.ko != null and a.ko.bodies() > 0:
					_ko["early"] = true
			elif _n == 75:
				_check("ko_no_body_while_the_fight_can_change", not _ko.has("early") and a.ko != null and a.ko.bodies() == 0 and a.ko.impact_t >= 0.0,
					"early=%s impact=%s" % [str(_ko.has("early")), str(a.ko.impact_t if a.ko != null else -1.0)])
				_fight.set("state", "ending")
				_fight.set("outcome", "lose")
			elif _n > 75:
				if a.ko.started and not _ko.has("t0"):
					_ko["t0"] = _n
					_ko["prev"] = _bones()
					_ko["low"] = 0.0
					_ko["settled"] = -1
				elif _ko.has("t0"):
					var now: Array = _bones()
					var mv: float = 0.0
					for i in now.size():
						mv = maxf(mv, ((now[i] as Vector3) - (_ko["prev"][i] as Vector3)).length() * 30.0)
						_ko["low"] = minf(float(_ko["low"]), (now[i] as Vector3).y - _f.global_position.y)
					_ko["prev"] = now
					if mv < 0.05 and int(_ko["settled"]) < 0:
						_ko["settled"] = _n
					elif mv >= 0.05:
						_ko["settled"] = -1
				if _n == 75 + 90:
					_check("ko_settle_starts_after_the_result", a.ko.started and a.ko.bodies() > 0, "bodies %d" % a.ko.bodies())
					var st: float = (int(_ko.get("settled", -1)) - int(_ko.get("t0", 0))) / 30.0 if int(_ko.get("settled", -1)) > 0 else 99.0
					_check("ko_no_bone_under_ground", float(_ko.get("low", 0.0)) > -0.03, "lowest %.3f m" % float(_ko.get("low", 0.0)))
					_check("ko_settled_within_1_2_s", st <= 1.2, "settled after %.2f s" % st)
					print("CQTEST done failures=%d" % _fails)
					quit(1 if _fails > 0 else 0)
					_phase = ""
	return false


func _bones() -> Array:
	var sk: Skeleton3D = _f.anim.skeleton
	var out: Array = []
	for b in sk.get_bone_count():
		out.append((sk.global_transform * sk.get_bone_global_pose(b)).origin)
	return out


func _cost() -> void:
	# dead blending while it blends and two additive hit layers, per fighter per frame, on this core
	var a = _f.anim
	var db = a.dead_blend
	var hits: Array = a._hit_anims.values()
	if db == null:
		_check("modifier_cost_measured", false, "no dead blend")
		return
	a.layer.add_layers = [[hits[0], 0.2, 0.5], [hits[min(1, hits.size() - 1)], 0.2, 0.5]] if not hits.is_empty() else []
	var pg = a.pose_guard
	_check("pose_guard_after_foot_lock_before_cloth", pg != null and pg.guard and pg.get_index() > a.layer.get_index()
		and (a.foot == null or pg.get_index() > a.foot.get_index()) and (a.secondary == null or pg.get_index() < a.secondary.get_index()),
		"guard %s" % str(pg.get_index() if pg != null else -1))
	var n: int = 300
	var t0: int = Time.get_ticks_usec()
	for i in n:
		db.start(0.2)
		db.dt = 1.0 / 30.0
		db._process_modification_with_delta(1.0 / 30.0)
		a.layer._apply_add(a.skeleton)
		if pg != null:
			# worst case: every guarded bone jerked this frame (the limit and the braking both run)
			a.skeleton.set_bone_pose_rotation(pg._ids[0], Quaternion(Vector3.UP, 1.5 if i % 2 == 0 else -1.5))
			pg.dt = 1.0 / 30.0
			pg._process_modification_with_delta(1.0 / 30.0)
	var per: float = (Time.get_ticks_usec() - t0) / float(n) / 1000.0
	a.layer.add_layers = []
	print("CQFID29 modifier_ms_per_fighter=%.4f three=%.4f" % [per, per * 3.0])
	_check("modifiers_under_0_3_ms_for_three", per * 3.0 <= 0.3, "%.4f ms for three" % (per * 3.0))


func _guard_check() -> void:
	# the pose guard on its own skeleton: a slow turn passes exactly; a one-frame flip is limited to GUARD_ACC (5 % for the
	# discrete braking step, which may stop a little harder) and lands
	var sk := Skeleton3D.new()
	sk.add_bone("Hips")
	sk.add_bone("LeftUpLeg")
	sk.set_bone_parent(1, 0)
	var DeadBlendS: GDScript = load("res://dead_blend.gd")
	var g = DeadBlendS.new()
	g.guard = true
	sk.add_child(g)
	g.bind_bones(sk)
	var dt: float = 1.0 / 30.0
	g.dt = dt
	var exact: bool = true
	for i in 10:
		var q := Quaternion(Vector3.RIGHT, 0.02 * i)
		sk.set_bone_pose_rotation(1, q)
		g._guard(sk)
		exact = exact and sk.get_bone_pose_rotation(1).is_equal_approx(q)
	_check("pose_guard_passes_motion_under_the_limit", exact)
	var target := Quaternion(Vector3.RIGHT, 0.18 + 1.2)
	var w_prev: float = 0.0
	var a_max: float = 0.0
	var prev := Quaternion(Vector3.RIGHT, 0.18)
	var landed: int = -1
	for i in 30:
		sk.set_bone_pose_rotation(1, target)
		g._guard(sk)
		var now: Quaternion = sk.get_bone_pose_rotation(1)
		var w: float = (now * prev.inverse()).get_angle() / dt
		a_max = maxf(a_max, absf(w - w_prev) / dt)
		w_prev = w
		prev = now
		if landed < 0 and now.angle_to(target) < 0.001:
			landed = i
	_check("pose_guard_limits_a_flip_and_lands", a_max <= g.GUARD_ACC * 1.05 and landed > 0 and landed <= 12, "acc %.0f rad/s2, landed at %d" % [a_max, landed])
	sk.free()


func _effects() -> void:
	var fl: Dictionary = {}
	for tier: String in ["low", "mid", "high"]:
		var arena: Node3D = _fight.get("arena")
		arena.set("look", {} if tier == "low" else {"real": true})
		_fight.set("cfg", {"tier": tier})
		var fx: FxScript = FxScript.new()
		_fight.add_child(fx)
		var card_sh: Shader = (fx._cards[0].material_override as ShaderMaterial).shader
		var top_sh: Shader = (fx._tops[0].material_override as ShaderMaterial).shader
		var arc_sh: Shader = (fx._arcs[0].material_override as ShaderMaterial).shader
		var beam_sh: Shader = (fx._beams[0].material_override as ShaderMaterial).shader
		fl[tier] = [card_sh == FxScript.CARD_SHADER and top_sh == FxScript.CARD_TOP_SHADER and beam_sh == FxScript.BEAM_SHADER, arc_sh == FxScript.ARC_SHADER,
			card_sh.code.contains("#define FID29") and beam_sh.code.contains("#define FID29"), arc_sh.code.contains("#define FLOW")]
		if tier == "mid":
			fx.sparks(_f.chest_pos(), Color(1, 0.5, 0.2), 200, true, Vector3(0, 0, 1))
			var shielded: int = 0
			for mi: MeshInstance3D in fx._tops:
				if mi.visible and ((mi.material_override as ShaderMaterial).get_shader_parameter("sh_head") as Vector4).w > 0.0:
					shielded += 1
			_check("fx_hit_sets_a_shield", fx.shields == 1 and shielded >= 2, "shields %d, cards %d" % [fx.shields, shielded])
			# a card made just after the hit, at the struck body, takes its shield; one far away does not
			var near: MeshInstance3D = fx.card(FxScript.GLOW, _f.chest_pos(), Color.WHITE, 0.2, 1.0, 1.2)
			var far: MeshInstance3D = fx.card(FxScript.GLOW, _f.chest_pos() + Vector3(8, 0, 0), Color.WHITE, 0.2, 1.0, 1.2)
			_check("fx_shield_holds_for_cards_at_the_struck_body", ((near.material_override as ShaderMaterial).get_shader_parameter("sh_head") as Vector4).w > 0.0
				and ((far.material_override as ShaderMaterial).get_shader_parameter("sh_head") as Vector4).w == 0.0)
		fx.queue_free()
	_check("fx_low_is_build28", fl["low"][0] and fl["low"][1] and not fl["low"][2], str(fl["low"]))
	_check("fx_mid_cards_fid29_arcs_build28", fl["mid"][2] and fl["mid"][1], str(fl["mid"]))
	_check("fx_high_cards_fid29_arcs_flow", fl["high"][2] and fl["high"][3], str(fl["high"]))


func _credits() -> void:
	var base: String = ProjectSettings.globalize_path("res://")
	var tsx: String = FileAccess.get_file_as_string(base.path_join("../components/waleui/CreditsScreen.tsx").simplify_path())
	var md: String = FileAccess.get_file_as_string(base.path_join("../../docs/game3d/fid29/ASSETS-LICENCES-combat.md").simplify_path())
	var lines: Array[String] = []
	for l: String in md.split("\n"):
		# the licence file's credit lines: "Credit: <the exact words>" on every CC-BY source
		if l.strip_edges().begins_with("- Credit:"):
			lines.append(l.strip_edges().substr(9).strip_edges().trim_prefix("\"").trim_suffix("\""))
	var missing: Array[String] = []
	for l: String in lines:
		if not tsx.contains(l):
			missing.append(l)
	_check("credits_list_every_cc_by_source", tsx != "" and md != "" and lines.size() >= 2 and missing.is_empty(), "%d lines, missing %s" % [lines.size(), str(missing)])
