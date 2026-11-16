# sbs.py OUT.jpg A.png B.png [crop x0,y0,x1,y1] [width]: side by side (A left, B right), JPEG for viewing
import sys
from PIL import Image
a, b = Image.open(sys.argv[2]).convert("RGB"), Image.open(sys.argv[3]).convert("RGB")
if len(sys.argv) > 4 and sys.argv[4] != "-":
    c = tuple(int(v) for v in sys.argv[4].split(",")); a, b = a.crop(c), b.crop(c)
w = int(sys.argv[5]) if len(sys.argv) > 5 else 700
h = int(a.height * w / a.width)
o = Image.new("RGB", (2 * w + 8, h), (255, 255, 255))
o.paste(a.resize((w, h), Image.LANCZOS), (0, 0)); o.paste(b.resize((w, h), Image.LANCZOS), (w + 8, 0))
o.save(sys.argv[1], quality=88)
