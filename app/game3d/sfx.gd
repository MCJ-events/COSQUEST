extends Node
## Combat sounds (cq 233): Kenney "Impact Sounds" and "RPG Audio" (CC0, art/sfx/License_*).
## A few pooled AudioStreamPlayers; each cue picks one of its variants and a little pitch
## jitter so repeated swings do not sound machine-gunned. cfg "sound": false mutes it.

const CUES: Dictionary = {
	"swing": ["knifeSlice", "knifeSlice2", "drawKnife1", "drawKnife2"],
	"swing_heavy": ["chop"],
	"hit": ["impactPunch_medium_000", "impactPunch_medium_001"],
	"hit_heavy": ["impactPunch_heavy_000", "impactPunch_heavy_001"],
	"block": ["impactPlate_medium_000"],
	"parry": ["impactMetal_heavy_000", "impactBell_heavy_000"],
	"skill": ["impactGlass_heavy_000"],
	"slam": ["impactMining_000", "impactPunch_heavy_001"],
	"dash": ["cloth1"],
	"rally": ["handleCoins"],
	"ko": ["impactSoft_heavy_000", "impactMining_000"],
	"hurt": ["impactPunch_heavy_000"],
}
const VOLUME_DB: Dictionary = {"swing": -8.0, "hit": -4.0, "hit_heavy": -2.0, "block": -5.0, "parry": 0.0,
	"skill": -6.0, "slam": -1.0, "dash": -4.0, "rally": -6.0, "ko": 0.0, "hurt": -5.0, "swing_heavy": -5.0}

var enabled: bool = true
var _streams: Dictionary = {}
var _players: Array[AudioStreamPlayer] = []
var _next: int = 0
var _last_ms: Dictionary = {}


func _ready() -> void:
	for cue: String in CUES:
		var arr: Array = []
		for n: String in CUES[cue]:
			var s: Resource = load("res://art/sfx/%s.ogg" % n)
			if s is AudioStream:
				arr.append(s)
		_streams[cue] = arr
	for i in 8:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		_players.append(p)


func play(cue: String, pitch: float = 1.0) -> void:
	if not enabled:
		return
	var arr: Array = _streams.get(cue, [])
	if arr.is_empty():
		return
	# the same cue twice inside 40 ms is one sound
	var now: int = Time.get_ticks_msec()
	if now - int(_last_ms.get(cue, -1000)) < 40:
		return
	_last_ms[cue] = now
	var p: AudioStreamPlayer = _players[_next]
	_next = (_next + 1) % _players.size()
	p.stream = arr[randi() % arr.size()]
	p.pitch_scale = pitch * randf_range(0.93, 1.07)
	p.volume_db = float(VOLUME_DB.get(cue, -4.0))
	p.play()
