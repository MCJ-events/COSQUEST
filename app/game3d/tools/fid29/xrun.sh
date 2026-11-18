#!/usr/bin/env bash
# fid29: run a command on a virtual screen WxH (frozen after fid29-base). xvfb-run where there is one (the farm);
# else a private user-space Xvfb ($XVFB, mm1: ~/bin/Xvfb) on a free display, stopped afterwards. Memory-capped with
# ~/lookfight/bin/capped when present (the farm).   xrun.sh 1170x2532 godot --path . ...
S=$1; shift
CAP=(); [ -x "$HOME/lookfight/bin/capped" ] && CAP=("$HOME/lookfight/bin/capped" 5G)
if command -v xvfb-run >/dev/null; then exec "${CAP[@]}" xvfb-run -a -s "-screen 0 ${S}x24" "$@"; fi
X=${XVFB:-$HOME/bin/Xvfb}
for d in $(seq 91 140); do [ -e /tmp/.X$d-lock ] || [ -e /tmp/.X11-unix/X$d ] || break; done
"$X" :$d -screen 0 ${S}x24 -nolisten tcp > /dev/null 2>&1 & XP=$!
sleep 2
DISPLAY=:$d LIBGL_ALWAYS_SOFTWARE=1 __GLX_VENDOR_LIBRARY_NAME=mesa "$@"; rc=$?
kill $XP 2>/dev/null; wait $XP 2>/dev/null
exit $rc
