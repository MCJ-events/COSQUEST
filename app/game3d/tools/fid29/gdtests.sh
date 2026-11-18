#!/usr/bin/env bash
# fid29 Godot tests (frozen after fid29-base; COMMON.md gate C2): every tests/*_test.gd as its header says, then
# build21_test again with --fixed-fps 30 (the known whirl check), then place_test alone if it failed (its
# build_under_1s timing check fails under shared load).
#   gdtests.sh /abs/app/game3d [logdir]
# Needs GODOT (default ~/lookfight/bin/godot). cycles_test needs a display: xvfb-run when there is one, else XVFB
# (a user-space Xvfb binary, mm1: ~/bin/Xvfb) on display :89. Prints one line per test and TOTAL.
G=${GODOT:-$HOME/lookfight/bin/godot}
cd "$1" || exit 2
L=${2:-$(pwd)/../testlogs}; mkdir -p "$L"; rm -f "$L"/*_test.log
gate() { [ -n "${GATE:-}" ] && bash "$GATE" >/dev/null; return 0; }
tot=0; totf=0; bad=0
for t in tests/*_test.gd; do
  n=$(basename $t .gd); gate
  if [ $n = cycles_test ]; then
    if command -v xvfb-run >/dev/null; then
      timeout 1500 xvfb-run -a $G --path . --rendering-driver opengl3 -s res://$t > "$L/$n.log" 2>&1
    else
      pgrep -f "Xvfb :89" >/dev/null || { (setsid ${XVFB:-$HOME/bin/Xvfb} :89 -screen 0 720x1280x24 -nolisten tcp > "$L/xvfb89.log" 2>&1 &); sleep 2; }
      DISPLAY=:89 LIBGL_ALWAYS_SOFTWARE=1 __GLX_VENDOR_LIBRARY_NAME=mesa timeout 1500 $G --path . --rendering-driver opengl3 -s res://$t > "$L/$n.log" 2>&1
    fi
  elif grep -q -- "--fixed-fps 30 -s res://$t" $t; then
    timeout 1500 $G --headless --path . --fixed-fps 30 -s res://$t > "$L/$n.log" 2>&1
  else
    timeout 1500 $G --headless --path . -s res://$t > "$L/$n.log" 2>&1
  fi
  rc=$?
  p=$(grep -c "CQTEST PASS" "$L/$n.log"); f=$(grep -c "CQTEST FAIL" "$L/$n.log")
  echo "$n: $p passed, $f failed, rc=$rc | $(grep 'CQTEST done' "$L/$n.log" | tail -1)"
  tot=$((tot+p)); totf=$((totf+f)); [ $rc -ne 0 ] && bad=$((bad+1))
done
echo "TOTAL passed=$tot failed=$totf nonzero_exits=$bad"
gate; timeout 1500 $G --headless --path . --fixed-fps 30 -s res://tests/build21_test.gd > "$L/build21_fixed30.log" 2>&1
echo "build21_test --fixed-fps 30: $(grep -c 'CQTEST PASS' "$L/build21_fixed30.log") passed, $(grep -c 'CQTEST FAIL' "$L/build21_fixed30.log") failed"
if grep -q "CQTEST FAIL" "$L/place_test.log" 2>/dev/null; then
  gate; timeout 1500 $G --headless --path . -s res://tests/place_test.gd > "$L/place_alone.log" 2>&1
  echo "place_test alone: $(grep -c 'CQTEST PASS' "$L/place_alone.log") passed, $(grep -c 'CQTEST FAIL' "$L/place_alone.log") failed"
fi
grep -h "CQTEST FAIL" "$L"/*_test.log | cut -c1-250
