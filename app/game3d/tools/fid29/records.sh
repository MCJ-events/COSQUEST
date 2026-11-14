#!/usr/bin/env bash
# fid29 seeded fight records (frozen after fid29-base; docs/game3d/fid29/COMMON.md gate C1): the 11 records every lane
# must keep byte-identical, through tools/anim/motion_measure.sh (md5 of the fight's result, load time left out).
#   records.sh --game /abs/app/game3d --out /abs/dir [--only name,name] [--look '{"fid_street": false}'] [--check]
#   --look   merged into every run's look (a lane's key off: C1 asks for the records with it on and off)
#   --check  compare with records.txt beside this script; exit 1 on any difference
# Records (name: what it runs):
#   cast_low_win / cast_low_loss       low tier, the cartoon cast (build 21 to 28's low phones)
#   hero_high_win / hero_high_loss     high tier, faction heroes (Imani), motion realism + foot IK, lod0
#   hero_mid_win / hero_mid_loss       the same on the mid tier (lod1)
#   hero_low_win                       the faction heroes on the low tier (lod1, what a low phone loads with hero_cast)
#   hero_high_s11_win / _s101_win      high, seeds 11 and 101
#   hero_high_place_win                high, the real Trafalgar Square place (places/trafalgar_staging.json)
#   hero_high_forge_win                high against a shipped Forge Guardian (fixture under $FID/fixtures)
# One heavy run at a time: each goes through flock $FID/render.lock and gate.sh. About 1 min a run on the farm.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FID=${FID:-$HOME/realism-20261111/fid29}
G=""; OUT=""; ONLY=""; LOOK=""; CHECK=0
while [ $# -gt 0 ]; do case "$1" in
  --game) G=$2; shift 2;; --out) OUT=$2; shift 2;; --only) ONLY=$2; shift 2;; --look) LOOK=$2; shift 2;;
  --check) CHECK=1; shift;; *) echo "unknown $1" >&2; exit 2;; esac; done
[ -n "$G" ] && [ -n "$OUT" ] || { echo "need --game and --out" >&2; exit 2; }
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
MM="$HERE/../anim/motion_measure.sh"
FORGE=${FID_FORGE:-$FID/fixtures/forge_guardian_fk_83421efe_v1}
HERO='"hero_cast":true,"faction":"icons","motion_realism":true,"foot_ik":true'
LX=""; [ -n "$LOOK" ] && LX=",\"look\":$LOOK"
want() { [ -z "$ONLY" ] || case ",$ONLY," in *,$1,*) return 0;; *) return 1;; esac; }
: > "$OUT/records.txt"
run() { # name-prefix runs extra [motion_measure args...]
  local n=$1 runs=$2 ex=$3; shift 3
  local go=0; for r in ${runs//,/ }; do want "${n}_$r" && go=1; done; [ $go = 1 ] || return 0
  ( flock 9; bash "$HERE/gate.sh" >/dev/null || exit 1
    bash "$MM" --game "$G" --out "$OUT/mm" --name "$n" --runs "$runs" --extra "$ex$LX" "$@" 2>"$OUT/mm_$n.err" ) 9>"$FID/render.lock" \
    | grep -E " md5 " | awk '{print $1, $NF, $2, $3, $5}' | tee -a "$OUT/records.txt"
}
run cast_low win,loss '"tier":"low"'
run hero_high win,loss "\"tier\":\"high\",$HERO"
run hero_mid win,loss "\"tier\":\"mid\",$HERO"
run hero_low win "\"tier\":\"low\",$HERO"
run hero_high_s11 win "\"tier\":\"high\",$HERO" --seed 11
run hero_high_s101 win "\"tier\":\"high\",$HERO" --seed 101
run hero_high_place win "\"tier\":\"high\",$HERO,\"arena\":\"place\",\"ground_json\":\"$HERE/places/trafalgar_staging.json\",\"place_at\":[-14.4,19.8],\"place_thread\":false"
run hero_high_forge win "\"tier\":\"high\",$HERO,\"enemy_glb\":\"$FORGE/lod1.glb\",\"enemy_key\":\"\""
if [ $CHECK = 1 ]; then
  bad=0
  while read -r n md5 rest; do
    exp=$(awk -v n="$n" '$1==n {print $2}' "$HERE/records.txt")
    if [ "$exp" = "$md5" ]; then echo "SAME $n $md5"; else echo "DIFF $n got $md5 want ${exp:-none}"; bad=1; fi
  done < "$OUT/records.txt"
  exit $bad
fi
