#!/usr/bin/env python3
"""char_art.py (build 29, 18 Nov 2026): the 2D pictures the app shows for a character, from its clean front concept
view (never a render of the 3D model). Subomi's rule: gameplay uses the 3D model; places that showcase the player
(profile, character picker, share card) use the character's art.

  python3 char_art.py <key> <front.png> <mask.png> <out dir> --name "Mei" [--faction ascendants]
        [--colour "#D633A8"] [--fonts <dir with LilitaOne-Regular.ttf and Fredoka-SemiBold.ttf>]

Writes to <out dir>:
  <key>_card.png      the full figure cut out on its mask, cropped to it with a little room, 720 px tall (RGBA)
  <key>_portrait.png  head and shoulders from the same cut-out, 384 x 384 (RGBA)
  <key>_share.jpg     a 1080 x 1920 card to post: the figure on its faction's colour, its name, "CosQuest"

The mask is the foreground mask the Forge artist pipeline already made for the view (BiRefNet, tools/forge_artist/
masks.py). Pure PIL + numpy."""
import argparse
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FACTION_COLOUR = {"ascendants": "#D633A8", "icons": "#6E80F6", "controllers": "#2D6ED2", "blockbusters": "#B8C800",
                  "everborns": "#F92896", "celestials": "#50BEF5"}
FACTION_NAME = {"ascendants": "Ascendants", "icons": "Icons", "controllers": "Controllers", "blockbusters": "Blockbusters",
                "everborns": "Everborns", "celestials": "Celestials"}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def cutout(front, mask):
    im = Image.open(front).convert("RGB")
    mk = Image.open(mask).convert("L").resize(im.size, Image.LANCZOS)
    m = np.asarray(mk).astype(np.float32) / 255.0
    # a crisp but soft edge: pull the matte's mid-tones apart a little, then feather by one pixel
    m = np.clip((m - 0.25) / 0.5, 0, 1)
    a = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    rgba = im.copy()
    rgba.putalpha(a)
    ys, xs = np.nonzero(np.asarray(a) > 40)
    return rgba, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), np.asarray(a) > 40


def card(rgba, box, h_out=960):
    x0, y0, x1, y1 = box
    pad = int(0.04 * (y1 - y0))
    W, H = rgba.size
    c = rgba.crop((max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)))
    s = h_out / c.height
    return c.resize((max(1, int(c.width * s)), h_out), Image.LANCZOS)


def portrait(rgba, box, fg, size=384):
    x0, y0, x1, y1 = box
    fh = y1 - y0
    # the head: the figure's columns in its top 11 %, centred on their middle
    band = fg[y0:y0 + max(2, int(0.11 * fh))]
    cols = np.nonzero(band.any(0))[0]
    cx = int((cols.min() + cols.max()) / 2) if len(cols) else (x0 + x1) // 2
    side = int(0.30 * fh)
    top = y0 - int(0.03 * fh)
    sq = rgba.crop((cx - side // 2, top, cx - side // 2 + side, top + side))
    return sq.resize((size, size), Image.LANCZOS)


def font(dirs, names, size):
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def share(card_im, name, faction, colour, fonts):
    W, H = 1080, 1920
    c = hex_rgb(colour)
    dark = tuple(int(v * 0.18) for v in c)
    mid = tuple(int(v * 0.55) for v in c)
    # vertical gradient, dark at the top and bottom, the faction colour behind the figure
    t = np.linspace(0, 1, H)[:, None]
    w = np.exp(-((t - 0.52) ** 2) / 0.06)
    bg = (np.array(dark)[None, None, :] * (1 - w[..., None]) + np.array(mid)[None, None, :] * w[..., None])
    bg = np.repeat(bg, W, axis=1).astype(np.uint8)
    out = Image.fromarray(bg, "RGB").convert("RGBA")
    # a soft glow of the faction colour where the figure stands
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse((140, 420, 940, 1560), fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    out = Image.composite(Image.new("RGBA", (W, H), c + (255,)), out, glow)
    # the figure, as large as fits between the name and the footer
    fh = 1250
    f = card_im.resize((int(card_im.width * fh / card_im.height), fh), Image.LANCZOS)
    if f.width > W - 60:
        s = (W - 60) / f.width
        f = f.resize((int(f.width * s), int(f.height * s)), Image.LANCZOS)
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).ellipse((W // 2 - 260, 330 + fh - 40, W // 2 + 260, 330 + fh + 40), fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    out = Image.composite(Image.new("RGBA", (W, H), (0, 0, 0, 255)), out, shadow)
    out.alpha_composite(f, ((W - f.width) // 2, 330 + fh - f.height))
    d = ImageDraw.Draw(out)
    big = font(fonts, ["LilitaOne-Regular.ttf"], 132)
    small = font(fonts, ["Fredoka-SemiBold.ttf", "Fredoka-Medium.ttf"], 46)
    tiny = font(fonts, ["Fredoka-SemiBold.ttf", "Fredoka-Medium.ttf"], 38)

    def centred(y, text, fnt, fill):
        bb = d.textbbox((0, 0), text, font=fnt)
        d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], y), text, font=fnt, fill=fill)

    centred(96, name.upper(), big, (255, 255, 255, 255))
    centred(250, (FACTION_NAME.get(faction, "") or "Forge character").upper(), small, c + (255,) if sum(c) > 300 else (230, 230, 240, 255))
    centred(1680, "I play as %s in" % name, tiny, (235, 235, 245, 255))
    centred(1735, "COSQUEST", font(fonts, ["LilitaOne-Regular.ttf"], 96), (255, 255, 255, 255))
    return out.convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("key"); ap.add_argument("front"); ap.add_argument("mask"); ap.add_argument("out")
    ap.add_argument("--name", required=True); ap.add_argument("--faction", default="")
    ap.add_argument("--colour", default=""); ap.add_argument("--fonts", default="")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rgba, box, fg = cutout(a.front, a.mask)
    cd = card(rgba, box, 720)
    cd.save(os.path.join(a.out, a.key + "_card.png"), optimize=True)
    portrait(rgba, box, fg).save(os.path.join(a.out, a.key + "_portrait.png"), optimize=True)
    colour = a.colour or FACTION_COLOUR.get(a.faction, "#7A5AF0")
    fonts = [a.fonts] if a.fonts else []
    share(card(rgba, box, 1250), a.name, a.faction, colour, fonts).save(os.path.join(a.out, a.key + "_share.jpg"), quality=84, optimize=True, progressive=True)
    print("ART", a.key, "card", cd.size, "box", box)


if __name__ == "__main__":
    main()
