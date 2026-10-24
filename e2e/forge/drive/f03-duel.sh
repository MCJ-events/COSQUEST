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
tap 540 2192 "Fight (briefing)"
for i in 1 2 3 4; do sleep 0.7; shot "f03-3-versus-$i"; done
# Strike: tap the arena for 40 s.
end=$(( $(date +%s) + 40 ))
n=0
while [ "$(date +%s)" -lt "$end" ]; do adb shell input tap 540 1200; n=$((n+1)); [ $((n % 15)) = 0 ] && shot "f03-4-fight-$n"; sleep 0.25; done
wait_s 30
shot f03-5-result
alive || exit 1
tap 540 1436 "Back to the map"; wait_s 4
alive
