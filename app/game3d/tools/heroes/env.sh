# fid29 heromaps on mm1: CPU only (the GPU is AIMM brain: never touched). Software GL only.
O=$HOME/cq-overflow/b29/heromaps
export CUDA_VISIBLE_DEVICES="" PYTHONPATH=$O/pylib:$O/stage_tools BPY=$O/blender/4.5/python/bin/python3.11 BLENDER=$O/blender/blender
export TOKTX=$O/bin/KTX-Software-4.4.2-Linux-x86_64/bin/toktx G=$O/xbin/godot GAME=$O/repo/app/game3d
export LD_LIBRARY_PATH=$O/bin/KTX-Software-4.4.2-Linux-x86_64/lib:${LD_LIBRARY_PATH:-}
GLENV="LP_NUM_THREADS=8 DISPLAY=:91 __GLX_VENDOR_LIBRARY_NAME=mesa LIBGL_ALWAYS_SOFTWARE=1"
xv() { pgrep -f "Xvfb :91" >/dev/null || { (setsid $O/xbin/Xvfb :91 -screen 0 720x1280x24 -nolisten tcp > $O/xvfb91.log 2>&1 &); sleep 2; }; }
ogate() { for i in $(seq 1 240); do l=$(cut -d" " -f1 /proc/loadavg); ma=$(awk "/MemAvailable/ {print int(\$2/1048576)}" /proc/meminfo)
  awk -v l=$l "BEGIN{exit !(l<=16)}" && [ "$ma" -ge ${NEED_GB:-8} ] && { echo "$(date -u +%T) ogate ok load $l avail ${ma}G $*" >> $O/gate.log; return 0; }
  echo "$(date -u +%T) ogate wait load $l avail ${ma}G $*" >> $O/gate.log; sleep 30; done; return 1; }
