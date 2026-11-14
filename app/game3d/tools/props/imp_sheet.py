# imp_sheet.py IMP_0.png IMP_1.png OUT.png : the mid tier's plane impostor texture (fid29 dressing): the two Cycles views
# of tree_blender.py side by side (1024 x 512, view 0 left, view 1 right, as plane_imp.res's UVs), the transparent
# texels filled with the crown's mean colour so mips never fringe dark.
import sys
from PIL import Image
a, b = Image.open(sys.argv[1]).convert("RGBA"), Image.open(sys.argv[2]).convert("RGBA")
o = Image.new("RGBA", (1024, 512), (0, 0, 0, 0)); o.paste(a, (0, 0)); o.paste(b, (512, 0))
al = o.getchannel("A")
px = [p for p, q in zip(o.convert("RGB").getdata(), al.getdata()) if q > 200]
m = tuple(sum(c[i] for c in px) // max(1, len(px)) for i in range(3))
rgb = Image.new("RGB", o.size, m); rgb.paste(o.convert("RGB"), (0, 0), al)
rgb.putalpha(al); rgb.save(sys.argv[3], optimize=True)
print("IMP sheet", sys.argv[3], "fill", m)
