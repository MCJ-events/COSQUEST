extends SceneTree
## build 28 (13 Nov 2026): seeded fights on both panels, each in its own fresh engine (tools/panel/corpus_fight.gd).
##   godot --headless --path app/game3d --fixed-fps 30 -s res://tests/five_seeded_test.gd
## 1. Table 2 untouched: the bot's seeded fight with no rules id, and with table 2's id, gives the very record
##    builds 25 to 27 give (anim-readable d833fb7, seed 239 and the idle loss 2301, md5 of the sorted record).
## 2. Table 3 is deterministic: the same seed twice gives the same record, byte for byte.
## 3. The bot on the five-button panel uses all eight moves under the same rules as a player: it presses only
##    DASH, SHIELD, SHOOT and RAIN; its WHIRLs are combo finishers right after a second swing; its SPLITs come from
##    a held ATTACK of 0.4 s or more; every unpressed cast has its derived row. The idle bot (it never attacks)
##    gets RALLY by itself once below half health.
## Prints "CQTEST PASS <name>" / "CQTEST FAIL <name> <why>", then "CQTEST done failures=N".

const PINNED_V2: String = "f3d-2-e872f23a43a5"
const PINNED_V3: String = "f3d-3-dd591cb09b67"
# md5 of the record (JSON, keys sorted, no spaces) on anim-readable d833fb7, --fixed-fps 30
const B27_RECORD: Dictionary = {239: "731e53b3f749a5b4b6dce468eba336cb", 2301: "8d5261703218a0f121761f6458ea9a24"}
# the five-button record of seed 239 (this branch, first recorded 13 Nov 2026): a change to the fight changes it
const B28_FIVE_RECORD_239: String = "52ce886076c4e1a89945f3cb878bca32"

var _fails: int = 0
var _runs: Array[Dictionary] = [
	{"tag": "v2_seed239_no_id", "cfg": {"seed": 239}},
	{"tag": "v2_seed239_v2_id", "cfg": {"seed": 239, "rules": PINNED_V2}},
	{"tag": "v2_idle2301", "cfg": {"seed": 2301, "bot": "idle"}},
	{"tag": "five_seed239_a", "cfg": {"seed": 239, "rules": PINNED_V3}},
	{"tag": "five_seed239_b", "cfg": {"seed": 239, "rules": PINNED_V3}},
	{"tag": "five_seed2002", "cfg": {"seed": 2002, "rules": PINNED_V3}},
	{"tag": "five_idle2301", "cfg": {"seed": 2301, "bot": "idle", "rules": PINNED_V3}},
]
var _got: Dictionary = {}


func _check(name: String, ok: bool, why: String = "") -> void:
	if ok:
		print("CQTEST PASS " + name)
	else:
		_fails += 1
		print("CQTEST FAIL %s %s" % [name, why])


## Each fight in its own engine (a fresh process, as a phone starts one): a second fight in the same engine starts
## on another frame phase, so only fresh runs are comparable. Runs tools/panel/corpus_fight.gd.
func _initialize() -> void:
	for run: Dictionary in _runs:
		var out: Array = []
		var args: PackedStringArray = ["--headless", "--path", ProjectSettings.globalize_path("res://"), "--fixed-fps", "30",
			"-s", "res://tools/panel/corpus_fight.gd", "--", "--cfg=" + JSON.stringify(run["cfg"]).replace("\"", "\\\"")]
		# (OS.execute hands the line to a shell here: the JSON's quotes are escaped so they reach the fight)
		OS.execute(OS.get_executable_path(), args, out, true)
		var line: String = ""
		for chunk: String in out:
			for l: String in chunk.split("\n"):
				if l.begins_with("CQSEEDED "):
					line = l.substr(9)
		_check(str(run["tag"]) + "_fought", line != "")
		_got[run["tag"]] = _ints(JSON.parse_string(line)) if line != "" else {"judge": {}, "skills": [0, 0, 0, 0, 0, 0, 0]}
	_verify()


## JSON numbers come back as floats: whole ones back to ints, so the record prints as Godot wrote it.
func _ints(v: Variant) -> Variant:
	if v is float and is_equal_approx(v, round(v)) and absf(v) < 1e15:
		return int(v)
	if v is Array:
		var a: Array = []
		for x: Variant in v:
			a.append(_ints(x))
		return a
	if v is Dictionary:
		var d: Dictionary = {}
		for k: Variant in v:
			d[k] = _ints(v[k])
		return d
	return v


func _md5(r: Dictionary) -> String:
	return JSON.stringify(r["judge"], "", true).md5_text()


func _verify() -> void:
	# 1. table 2 untouched
	for tag: String in ["v2_seed239_no_id", "v2_seed239_v2_id"]:
		var r: Dictionary = _got[tag]
		_check(tag + "_record_as_build_27", str(r["judge"]["rules"]) == PINNED_V2 and _md5(r) == B27_RECORD[239], _md5(r))
		_check(tag + "_no_five_rows", not (r["judge"] as Dictionary).has("atk") and not (r["judge"] as Dictionary).has("derived"))
	_check("v2_idle_record_as_build_27", _md5(_got["v2_idle2301"]) == B27_RECORD[2301], _md5(_got["v2_idle2301"]))
	# 2. table 3 deterministic
	var a: Dictionary = _got["five_seed239_a"]
	var b: Dictionary = _got["five_seed239_b"]
	_check("five_record_on_table_3", str(a["judge"]["rules"]) == PINNED_V3 and int(a["judge"]["v"]) == 3, str(a["judge"]["rules"]))
	_check("five_seeded_record_identical", _md5(a) == _md5(b) and a["outcome"] == b["outcome"] and a["time_s"] == b["time_s"],
		"%s vs %s" % [_md5(a), _md5(b)])
	_check("five_seeded_record_pinned", _md5(a) == B28_FIVE_RECORD_239, _md5(a))
	print("CQSEEDMD5 five_seed239 %s %s %s %s" % [_md5(a), a["outcome"], a["time_s"], str(a["skills"])])
	# 3. the bot's moves, on two seeds
	for tag: String in ["five_seed239_a", "five_seed2002"]:
		var j: Dictionary = _got[tag]["judge"]
		var bad_press: bool = false
		for p: Array in j["presses"]:
			bad_press = bad_press or int(p[2]) in [1, 2, 3]
		_check(tag + "_presses_only_his_five", not bad_press)
		var unpressed: Array = []
		for c: Array in j["casts"]:
			if int(c[2]) in [1, 2, 3]:
				unpressed.append(c)
		var same: bool = unpressed.size() == (j["derived"] as Array).size()
		for k in mini(unpressed.size(), (j["derived"] as Array).size()):
			same = same and (unpressed[k] as Array).slice(0, 3) == (j["derived"][k] as Array).slice(0, 3)
		_check(tag + "_every_unpressed_cast_has_its_reason", same, "%d casts, %d rows" % [unpressed.size(), (j["derived"] as Array).size()])
		var whirls: int = 0
		var splits: int = 0
		var ok_w: bool = true
		var ok_s: bool = true
		for d: Array in j["derived"]:
			if int(d[2]) == 2:
				whirls += 1
				var prev: Array = []
				for s: Array in j["swings"]:
					if int(s[1]) <= int(d[1]):
						prev = s
				ok_w = ok_w and int(d[3]) == 1 and not prev.is_empty() and int(prev[2]) == 1 and int(d[1]) - int(prev[1]) >= 0 and int(d[1]) - int(prev[1]) <= 101
			elif int(d[2]) == 1:
				splits += 1
				ok_s = ok_s and int(d[3]) == 2 and int(d[4]) >= 40
		_check(tag + "_bot_whirls_as_finisher", whirls >= 1 and ok_w, "%d whirls" % whirls)
		_check(tag + "_bot_splits_by_holding", splits >= 1 and ok_s, "%d splits" % splits)
		_check(tag + "_bot_uses_the_buttons", int(_got[tag]["skills"][0]) + int(_got[tag]["skills"][5]) + int(_got[tag]["skills"][6]) >= 3, str(_got[tag]["skills"]))
	var idle: Dictionary = _got["five_idle2301"]["judge"]
	var rallies: Array = []
	for d: Array in idle["derived"]:
		if int(d[2]) == 3:
			rallies.append(d)
	_check("five_idle_rally_by_itself", rallies.size() >= 1 and int(rallies[0][3]) == 3 and int(rallies[0][4]) < 500 and (idle["presses"] as Array).is_empty(), str(rallies))
	print("CQTEST done failures=%d" % _fails)
	quit(1 if _fails > 0 else 0)
