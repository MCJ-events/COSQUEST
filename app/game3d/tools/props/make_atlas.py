# fid29-dressing: the prop atlas per tier from the Poly Haven maps (and ambientCG bark), after painting out every
# real-world text, sticker and plate (dressing.md checklist), plus the plane tree's leaf cluster texture.
#   python make_atlas.py <ph_dir> <acg_dir> <out_dir>
# Writes props_<tier>_a.png (albedo), props_<tier>_n.png (OpenGL normal), props_<tier>_orm.png (AO, rough, metal),
# plane_leaves_<tier>.png (RGBA) and a contact sheet of the paint-outs.
import json, os, sys, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

PH, ACG, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(os.path.join(HERE, "atlas_layout.json")))
os.makedirs(OUT, exist_ok=True)
LEAF_N, LEAF_SPREAD = 96, 165   # leaves per cluster texture and their spread (px of 1024)
TIERS = {"high": {"a": 2048, "n": 2048, "orm": 1024, "leaf": 512}, "mid": {"a": 1024, "n": 512, "orm": 512, "leaf": 256}}

# Paint-outs on the 1K source maps: (kind, [x0, y0, x1, y1] to cover, [dx, dy] clean source offset, why)
PAINT = [
    ("utility_box_01", [262, 977, 358, 1020], [100, 0], "stencilled cabinet number 2754 (text)"),
    ("utility_box_01", [270, 563, 335, 638], [0, 76], "WARNING HIGH VOLTAGE sticker (text)"),
    ("utility_box_01", [705, 558, 770, 632], [0, 80], "WARNING HIGH VOLTAGE sticker (text)"),
    ("utility_box_01", [375, 895, 465, 988], [0, -120], "DANGER KEEP OUT / Authorised personnel only sticker (text)"),
    ("utility_box_02", [387, 932, 428, 1020], [50, 0], "stencilled cabinet number 2704 (text)"),
    ("utility_box_02", [688, 648, 750, 700], [0, 64], "WARNING HIGH VOLTAGE sticker (text)"),
    ("utility_box_02", [412, 690, 488, 767], [90, 0], "DANGER KEEP OUT sticker (text)"),
    ("utility_box_02", [310, 950, 375, 1005], [-84, 0], "WARNING HIGH VOLTAGE sticker (text)"),
]


def src(kind, mat, m):
    suffix = {"a": "diff", "n": "nor_gl", "orm": "arm"}[m]
    p = os.path.join(PH, kind, "textures", "%s_%s_1k.jpg" % (mat, suffix))
    return Image.open(p).convert("RGB")


def painted(kind, mat, m):
    im = src(kind, mat, m)
    for k, box, off, _ in PAINT:
        if k != kind:
            continue
        x0, y0, x1, y1 = box
        patch = im.crop((x0 + off[0], y0 + off[1], x1 + off[0], y1 + off[1]))
        # feathered edge so the clone has no seam
        mask = Image.new("L", patch.size, 0)
        ImageDraw.Draw(mask).rectangle((2, 2, patch.size[0] - 3, patch.size[1] - 3), fill=255)
        im.paste(patch, (x0, y0), mask.filter(ImageFilter.GaussianBlur(1.5)))
    if kind == "standing_chalkboard_01" and mat.endswith("_board") and m == "a":
        chalk(im)
    return im


def chalk(im):
    # made-up lettering in chalk on the slate (no real business or brand): the board's slate fills the top ~80 %
    d = ImageDraw.Draw(im)
    lines = [("Halden & Co", 70), ("fresh coffee", 52), ("soup of the day", 46), ("open 7 days", 46)]
    y = 150
    rnd = random.Random(7)
    for t, sz in lines:
        try:
            f = ImageFont.load_default(size=sz)
        except TypeError:
            f = ImageFont.load_default()
        w = d.textlength(t, font=f)
        x = (im.size[0] - w) / 2
        for _ in range(3):  # chalky: a few offset passes at low alpha
            d.text((x + rnd.uniform(-1.5, 1.5), y + rnd.uniform(-1.5, 1.5)), t, font=f, fill=(198, 198, 192))
        y += int(sz * 1.6)
    d.line((300, y + 10, 724, y + 10), fill=(180, 180, 175), width=4)


def bark(m):
    b = os.path.join(ACG, "Bark007")
    if m == "a":
        im = Image.open(os.path.join(b, "Bark007_1K-JPG_Color.jpg")).convert("RGB")
        # London plane: mottled olive-grey and cream; pull the warm brown to grey-olive a little
        r, g, bb = im.split()
        return Image.merge("RGB", (r.point(lambda v: int(v * 0.62)), g.point(lambda v: int(v * 0.62)), bb.point(lambda v: int(v * 0.57))))
    if m == "n":
        return Image.open(os.path.join(b, "Bark007_1K-JPG_NormalGL.jpg")).convert("RGB")
    ao = Image.open(os.path.join(b, "Bark007_1K-JPG_AmbientOcclusion.jpg")).convert("L")
    ro = Image.open(os.path.join(b, "Bark007_1K-JPG_Roughness.jpg")).convert("L")
    return Image.merge("RGB", (ao, ro, Image.new("L", ao.size, 0)))


SWATCH = {"glass": ((12, 14, 16), (128, 128, 255), (255, 20, 0)),
          "bulb": ((255, 228, 180), (128, 128, 255), (255, 80, 0)),
          "dark": ((20, 20, 22), (128, 128, 255), (255, 150, 200))}


def build(tier):
    T = TIERS[tier]
    grid = L["grid"]
    for m in ("a", "n", "orm"):
        S = T[m]
        bg = {"a": (40, 40, 40), "n": (128, 128, 255), "orm": (255, 200, 0)}[m]
        at = Image.new("RGB", (S, S), bg)
        u = S // grid
        for kind, k in L["kinds"].items():
            x, y, sz = k["cell"]
            cw = sz * u
            if kind == "bark":
                at.paste(bark(m).resize((cw, cw), Image.LANCZOS), (x * u, y * u))
                continue
            mats = k["mats"]
            for j, mat in enumerate(mats):
                w = cw // len(mats)
                at.paste(painted(k["src"], mat, m).resize((w, cw), Image.LANCZOS), (x * u + j * w, y * u))
        # swatches: quadrants of the swatch cell
        for name, (sx, sy) in L["swatch"].items():
            q = u // 2
            px, py = int(sx * S) // q * q, int(sy * S) // q * q
            col = SWATCH[name][{"a": 0, "n": 1, "orm": 2}[m]]
            ImageDraw.Draw(at).rectangle((px, py, px + q - 1, py + q - 1), fill=col)
        at.save(os.path.join(OUT, "props_%s_%s.png" % (tier, m)), optimize=True)
    leaves(tier, T["leaf"])


def leaves(tier, S):
    # a dense cluster of real maple leaves (ambientCG LeafSet027, the nearest palmate leaf to a plane leaf):
    # the source's leaves cut out by its opacity, scattered rotated and scaled into one card texture
    b = os.path.join(ACG, "LeafSet027")
    col = Image.open(os.path.join(b, "LeafSet027_1K-JPG_Color.jpg")).convert("RGB")
    op = Image.open(os.path.join(b, "LeafSet027_1K-JPG_Opacity.jpg")).convert("L")
    leaf = col.copy()
    leaf.putalpha(op)
    rnd = random.Random(11)
    big = 1024
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    # summer-to-autumn mix: most leaves pulled towards plane green, a few left yellow
    # fid29 overdraw cap: twice the leaves, gathered tighter, so a card is mostly leaf (alpha coverage about 0.65 of
    # the card, 0.9 of its trimmed octagon) and the crown needs fewer cards for the same leaf mass (dressing.md)
    for i in range(LEAF_N):
        s = rnd.uniform(0.26, 0.42)
        w = int(leaf.size[0] * s)
        im = leaf.resize((w, w), Image.LANCZOS).rotate(rnd.uniform(0, 360), resample=Image.BICUBIC, expand=True)
        r, g, bb, a = im.split()
        if rnd.random() < 0.88:
            gr = ImageChops.multiply(Image.merge("RGB", (r, g, bb)), Image.new("RGB", im.size, (128, 196, 104)))
            r, g, bb = gr.split()
        cx = 512 + rnd.gauss(0, LEAF_SPREAD)
        cy = 512 + rnd.gauss(0, LEAF_SPREAD)
        out.alpha_composite(Image.merge("RGBA", (r, g, bb, a)), (int(cx - im.size[0] / 2), int(cy - im.size[1] / 2)))
    # keep the cluster inside a soft disc so a card's square never shows
    disc = Image.new("L", (big, big), 0)
    ImageDraw.Draw(disc).ellipse((40, 40, big - 40, big - 40), fill=255)
    disc = disc.filter(ImageFilter.GaussianBlur(30))
    out.putalpha(ImageChops.multiply(out.getchannel("A"), disc))
    # bleed colour into the transparent texels so mips do not fringe dark
    rgb = Image.new("RGB", (big, big), (70, 92, 52))
    rgb.paste(out.convert("RGB"), (0, 0), out.getchannel("A"))
    res = rgb.copy()
    res.putalpha(out.getchannel("A"))
    res.resize((S, S), Image.LANCZOS).save(os.path.join(OUT, "plane_leaves_%s.png" % tier), optimize=True)
    a = out.getchannel("A")
    cov = sum(1 for v in a.resize((128, 128)).getdata() if v > 100) / (128 * 128.0)
    print("ATLAS leaves %s coverage %.2f" % (tier, cov))


def sheet():
    tiles = []
    for kind, box, off, why in PAINT:
        k = [kk for kk in L["kinds"].values() if kk.get("src") == kind][0]
        a = src(kind, k["mats"][0], "a").crop((box[0] - 40, box[1] - 40, box[2] + 40, box[3] + 40))
        b = painted(kind, k["mats"][0], "a").crop((box[0] - 40, box[1] - 40, box[2] + 40, box[3] + 40))
        t = Image.new("RGB", (a.size[0] * 2 + 6, a.size[1]), (255, 0, 255))
        t.paste(a, (0, 0)); t.paste(b, (a.size[0] + 6, 0))
        tiles.append(t.resize((t.size[0] * 2, t.size[1] * 2)))
    W = max(t.size[0] for t in tiles); H = sum(t.size[1] + 8 for t in tiles)
    s = Image.new("RGB", (W, H), (30, 30, 30)); y = 0
    for t in tiles:
        s.paste(t, (0, y)); y += t.size[1] + 8
    s.save(os.path.join(OUT, "paintout_sheet.jpg"), quality=90)
    board = painted("standing_chalkboard_01", "standing_chalkboard_01_board", "a")
    board.save(os.path.join(OUT, "chalkboard_board.jpg"), quality=90)


for t in TIERS:
    build(t)
sheet()
print("ATLAS_DONE")
