# Forge drop-in proof 3/4 (adb driver): a Guardian duel with the equipped
# Forge weapon. The versus card shows the weapon (and a Forge Guardian when
# the server picked one); the server fights with the weapon's class and a
# damage-based attack modifier. Strikes are taps on the arena.
source "$(dirname "$0")/lib.sh"
prep || exit 1
link "cosquest://play?duel=XD-trafalgar-duel"; wait_s 8
shot f03-1-point
tap $SHEET_PLAY "Fight (point sheet)"; wait_s 6
shot f03-2-briefing
# The briefing also offers "Fight (3D)" (cq 061) under "Fight": tap the 2D
# duel by its words, never the 3D one.
expect "Fight (3D)" || true
tap_label "Fight" || exit 1
for i in 1 2 3 4; do sleep 0.7; shot "f03-3-versus-$i"; done
# Strike: tap the arena for 40 s.
end=$(( $(date +%s) + 40 ))
n=0
while [ "$(date +%s)" -lt "$end" ]; do adb shell input tap 540 1200; n=$((n+1)); [ $((n % 15)) = 0 ] && shot "f03-4-fight-$n"; sleep 0.25; done
wait_s 30
shot f03-5-result
alive || exit 1
# The server judged this duel: no "practice" note (that is the 3D fight's).
expect_not "practice fight" || exit 1
tap_label "Back to the map" 540 1436; wait_s 4
alive
