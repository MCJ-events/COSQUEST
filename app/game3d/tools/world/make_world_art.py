"""Rebuilds every texture in app/game3d/art/world (look-world, cq W1) from CC0 sources, deterministically.

    python make_world_art.py <assets-src dir with ambientCG <Id>/ folders> <out: app/game3d/art/world> [--sheet x.jpg]

ground/  tileable ground by land use (ART-DIRECTION.md 2.2, 4.4, 4.5), wear + water normal
trims/   the 7 regional facade trim sheets (4.3), see trim_sheets.py
roofs/   flat roof membrane
misc/    landmark stone, clock face, prop and foliage breakup noise, distant pedestrian silhouettes
CREDITS.md is written from the CREDITS table below. Every photo-sourced texture goes through stylise.stylise().
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stylise as S  # noqa: E402
import trim_sheets  # noqa: E402

ACG = "https://ambientcg.com/view?id="
CREDITS: list[dict] = []


def credit(path: str, what: str, size: str, density: str, sources: list[str], process: str) -> None:
    CREDITS.append({"file": path, "what": what, "size": size, "px_per_m": density, "sources": sources, "process": process})


# ---------------------------------------------------------------- paving builder
def paving(n: int, rects: list, grain: np.ndarray, joint: float, bevel: float, joint_col: float, seed: int,
           tone_sd: float = 0.06, hue: list | None = None) -> np.ndarray:
    """Flags / pavers / slabs on an n x n tile. rects: (x0, y0, w, h) in px, wrapping. Each unit gets its own tone
    (and optionally one of `hue` colour multipliers), a soft bevel (lit top-left, shaded bottom-right) and a joint."""
    rng = np.random.default_rng(seed)
    tone = np.ones((n, n, 3), np.float32)
    shade = np.zeros((n, n), np.float32)
    edge = np.full((n, n), 99.0, np.float32)
    for (x0, y0, w, h) in rects:
        ys = np.arange(y0, y0 + h) % n
        xs = np.arange(x0, x0 + w) % n
        ay, ax = np.arange(h, dtype=np.float32), np.arange(w, dtype=np.float32)
        top, bot = ay, h - 1 - ay
        lef, rig = ax, w - 1 - ax
        d = np.minimum.outer(np.minimum(top, bot), np.minimum(lef, rig))
        sh = (np.add.outer(np.clip(1 - top / bevel, 0, 1) * 0.10 - np.clip(1 - bot / bevel, 0, 1) * 0.12,
                           np.clip(1 - lef / bevel, 0, 1) * 0.06 - np.clip(1 - rig / bevel, 0, 1) * 0.08))
        t = 1.0 + rng.normal(0, tone_sd)
        c = np.array(hue[rng.integers(len(hue))], np.float32) if hue else np.ones(3, np.float32)
        tone[np.ix_(ys, xs)] = c * t
        shade[np.ix_(ys, xs)] = sh
        edge[np.ix_(ys, xs)] = d
    j = np.clip((edge - joint * 0.5) / 1.5, 0, 1)[..., None]
    base = grain * tone * (1.0 + shade[..., None])
    return (base * j + joint_col * (1 - j) * grain.mean()).astype(np.float32)


def row_lengths(total: int, choices: list[int], rng) -> list[int]:
    out, rem = [], total
    while rem > max(choices):
        c = int(rng.choice(choices))
        out.append(c)
        rem -= c
    if rem >= min(choices) or not out:
        out.append(rem)
    else:
        out[-1] += rem
    return out


def grain_from(src: str, aid: str, n: int, tile: int | None = None, contrast: float = 1.0) -> np.ndarray:
    """A photo texture as a neutral-ish grain at n px (tile px per repeat), contrast scaled round its mean."""
    a = S.source(src, aid)
    t = tile or n
    a = S.resize_wrap(a, t, t)
    a = S.tile_to(a, n, n)
    m = a.reshape(-1, 3).mean(0)
    return np.clip(m + (a - m) * contrast, 0, 1).astype(np.float32)


def lowfreq(n: int, seed: int, amp: float, beta: float = 2.5, fmax: float = 6) -> np.ndarray:
    return (1.0 + S.fnoise(n, n, beta, seed, 1, fmax) * amp)[..., None].astype(np.float32)


# ---------------------------------------------------------------- ground
def make_ground(src: str, out: str) -> None:
    g = os.path.join(out, "ground")
    rng = np.random.default_rng(7)

    # asphalt: 512 px = 4 m (128 px/m, AD 4.4), warm grey #5E5C60, no blue
    a = grain_from(src, "Asphalt031", 512, contrast=0.8)
    a = a * lowfreq(512, 11, 0.05)
    a = S.stylise(a, target="#5E5C60", max_sat=0.06)
    S.save(a, f"{g}/asphalt.png")
    credit("ground/asphalt.png", "road asphalt, warm grey", "512", "128 (4 m tile)", ["Asphalt031"],
           "stylise pass, low-freq tone, saturation <= 0.06 so it never reads navy, mean = #5E5C60")

    # UK York stone flags: 1024 = 4 m (256 px/m); rows 0.5 m, flags 0.6 to 1.2 m
    n = 1024
    rects = []
    for r in range(8):
        x = int(rng.integers(0, n))
        for L in row_lengths(n, [154, 205, 256, 307], rng):
            rects.append((x, r * 128, L, 128))
            x += L
    gr = grain_from(src, "Concrete012", n, 512, 0.9)
    gr2 = grain_from(src, "Bricks084", n, 1024, 0.35)
    a = paving(n, rects, gr * 0.7 + gr2 * 0.3, 4, 14, 0.55, 3,
               hue=[[1.0, 0.98, 0.94], [0.97, 0.97, 0.96], [1.02, 0.99, 0.93], [0.95, 0.95, 0.95]])
    S.save(S.stylise(a * lowfreq(n, 12, 0.04), target="#C9C0B2"), f"{g}/pave_uk.png")
    credit("ground/pave_uk.png", "UK pavement, York stone flags in running rows", "1024", "256 (4 m tile)",
           ["Concrete012", "Bricks084"], "procedural flag layout (0.5 m rows, 0.6-1.2 m flags), photo grain, bevels; stylise pass, mean = #C9C0B2")

    # US concrete flags: 1024 = 3 m (341 px/m), 1.5 m score lines
    n = 1024
    rects = [(x * 512, y * 512, 512, 512) for x in range(2) for y in range(2)]
    gr = grain_from(src, "Concrete034", n, 512, 0.8)
    a = paving(n, rects, gr, 3, 8, 0.6, 4, tone_sd=0.03)
    S.save(S.stylise(a * lowfreq(n, 13, 0.035), target="#C7C3BC"), f"{g}/pave_us.png")
    credit("ground/pave_us.png", "US pavement, concrete flags with 1.5 m score lines", "1024", "341 (3 m tile)",
           ["Concrete034"], "procedural score lines, photo grain; stylise pass, mean = #C7C3BC")

    # Lagos interlock pavers: 1024 = 4 m; 0.25 x 0.125 m pavers in stretcher bond, mixed tones
    rects = []
    for r in range(32):
        off = 32 if r % 2 else 0
        for c in range(16):
            rects.append((off + c * 64, r * 32, 64, 32))
    gr = grain_from(src, "Concrete012", n, 256, 0.7)
    a = paving(n, rects, gr, 3, 6, 0.5, 5, tone_sd=0.05,
               hue=[[1.05, 0.92, 0.82], [0.95, 0.95, 0.95], [1.08, 0.86, 0.74], [1.0, 0.97, 0.9]])
    S.save(S.stylise(a * lowfreq(n, 14, 0.06), target="#B89F86"), f"{g}/pave_lagos.png")
    credit("ground/pave_lagos.png", "Lagos interlock pavers", "1024", "256 (4 m tile)", ["Concrete012"],
           "procedural pavers 0.25 x 0.125 m, mixed tones; stylise pass, mean = #B89F86")

    # civic plaza stone: 1 m slabs, half-offset rows
    rects = []
    for r in range(4):
        off = 128 if r % 2 else 0
        for c in range(4):
            rects.append((off + c * 256, r * 256, 256, 256))
    gr = grain_from(src, "Marble012", n, 512, 0.45) * 0.5 + grain_from(src, "Concrete034", n, 512, 0.6) * 0.5
    a = paving(n, rects, gr, 4, 16, 0.6, 6, tone_sd=0.035, hue=[[1.0, 0.98, 0.94], [0.98, 0.98, 0.97], [1.02, 0.99, 0.95]])
    S.save(S.stylise(a * lowfreq(n, 15, 0.03), target="#D8CBB4"), f"{g}/plaza.png")
    credit("ground/plaza.png", "civic plaza stone, 1 m slabs", "1024", "256 (4 m tile)", ["Marble012", "Concrete034"],
           "procedural slabs, photo grain; stylise pass, mean = #D8CBB4")

    # grass and dry grass (4 m)
    a = grain_from(src, "Grass004", n, 1024, 0.8) * lowfreq(n, 16, 0.08)
    S.save(S.stylise(a, target="#7FB356", extra_soften=0.8), f"{g}/grass.png")
    credit("ground/grass.png", "park grass", "1024", "256 (4 m tile)", ["Grass004"], "stylise pass (+0.8 px soften), mean = #7FB356")
    a = grain_from(src, "Grass001", n, 1024, 0.8) * 0.75 + grain_from(src, "Ground037", n, 1024, 0.8) * 0.25
    a = a * lowfreq(n, 17, 0.1)
    S.save(S.stylise(a, target="#A7B866", extra_soften=0.8), f"{g}/grass_dry.png")
    credit("ground/grass_dry.png", "dry grass / verge", "1024", "256 (4 m tile)", ["Grass001", "Ground037"], "stylise pass, mean = #A7B866")

    # park path gravel, ballast, sand, concrete, laterite
    a = grain_from(src, "Gravel023", n, 512, 0.7) * lowfreq(n, 18, 0.05)
    S.save(S.stylise(a, target="#C9B98F"), f"{g}/path.png")
    credit("ground/path.png", "park path, fine gravel", "1024", "256 (4 m tile)", ["Gravel023"], "stylise pass, mean = #C9B98F")
    a = grain_from(src, "Gravel023", n, 1024, 1.2) * lowfreq(n, 19, 0.05)
    S.save(S.stylise(a, target="#8A8279"), f"{g}/ballast.png")
    credit("ground/ballast.png", "railway ballast", "1024", "256 (4 m tile)", ["Gravel023"], "stylise pass, mean = #8A8279")
    s1 = S.fnoise(n, n, 2.8, 20, 1, 40)
    rip = np.sin((np.arange(n)[None, :] * 2 * np.pi * 9 / n) + S.fnoise(n, n, 3, 21, 1, 8) * 2.0) * 0.5
    a = np.repeat((0.8 + s1 * 0.035 + rip * 0.025)[..., None], 3, -1)
    S.save(S.stylise(a, target="#E3CFA2"), f"{g}/sand.png")
    credit("ground/sand.png", "sand / beach with soft ripples", "1024", "256 (4 m tile)", [], "procedural (periodic noise + ripples), stylise pass, mean = #E3CFA2")
    rects = [(x * 512, y * 512, 512, 512) for x in range(2) for y in range(2)]
    gr = grain_from(src, "Concrete034", n, 512, 1.0) * 0.6 + grain_from(src, "Concrete036", n, 1024, 0.7) * 0.4
    a = paving(n, rects, gr, 4, 6, 0.55, 8, tone_sd=0.05)
    S.save(S.stylise(a * lowfreq(n, 22, 0.06), target="#B5B0A6"), f"{g}/concrete.png")
    credit("ground/concrete.png", "industrial concrete, 2 m slabs", "1024", "256 (4 m tile)", ["Concrete034", "Concrete036"],
           "procedural slab joints, photo grain; stylise pass, mean = #B5B0A6")
    a = grain_from(src, "Ground037", n, 1024, 0.6)
    a = S.neutral(a, 0.7, 0.45) * lowfreq(n, 23, 0.05)
    S.save(S.stylise(a, target="#B5643C", max_sat=0.7), f"{g}/laterite.png")
    credit("ground/laterite.png", "laterite verge / red dirt (Lagos)", "1024", "256 (4 m tile)", ["Ground037"],
           "greyed, re-tinted; stylise pass (saturation clamp at the token's 0.67, an AD palette colour), mean = #B5643C")

    # wear: R grime patches, G cracks + stains + patches, B macro brightness. 512 px for a ~24 m world tile.
    n = 512
    r = S.fnoise(n, n, 3.2, 30, 1, 40)
    grime = np.clip((r - 0.4) / 1.4, 0, 1) ** 1.2
    grime = S.blur(grime, 1.5)
    im = Image.new("L", (n * 3, n * 3), 0)
    d = ImageDraw.Draw(im)
    rr = np.random.default_rng(31)
    for _ in range(14):    # cracks: wandering lines
        x, y = rr.uniform(0, n, 2)
        ang = rr.uniform(0, 2 * np.pi)
        pts = []
        for _s in range(int(rr.integers(8, 20))):
            pts.append((x, y))
            ang += rr.normal(0, 0.5)
            x += np.cos(ang) * 6
            y += np.sin(ang) * 6
        for ox in (0, n, 2 * n):
            for oy in (0, n, 2 * n):
                d.line([(p[0] + ox, p[1] + oy) for p in pts], fill=200, width=1)
    for _ in range(10):    # stains
        x, y, rad = rr.uniform(0, n), rr.uniform(0, n), rr.uniform(4, 14)
        for ox in (0, n, 2 * n):
            for oy in (0, n, 2 * n):
                d.ellipse([x + ox - rad, y + oy - rad * 0.7, x + ox + rad, y + oy + rad * 0.7], fill=110)
    for _ in range(4):     # patch repairs
        x, y, w, h = rr.uniform(0, n), rr.uniform(0, n), rr.uniform(14, 40), rr.uniform(10, 26)
        for ox in (0, n, 2 * n):
            for oy in (0, n, 2 * n):
                d.rectangle([x + ox, y + oy, x + ox + w, y + oy + h], fill=70)
    cr = np.asarray(im.filter(ImageFilter.GaussianBlur(0.7)), np.float32)[n:2 * n, n:2 * n] / 255.0
    macro = np.clip(0.5 + S.fnoise(n, n, 2.6, 32, 1, 10) * 0.12, 0, 1)
    S.save(np.stack([grime, cr, macro], -1), f"{g}/wear.png")
    credit("ground/wear.png", "ground wear mask: R grime, G cracks/stains/patches, B macro brightness (0.5 mean)", "512",
           "~21 (24 m world tile)", [], "procedural (periodic noise, wrapped strokes); own work")

    # water normal: gentle ripples, tileable, GL
    n = 256
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    h = (np.sin(2 * np.pi * (3 * xx + 2 * yy)) * 0.35 + np.sin(2 * np.pi * (-2 * xx + 5 * yy)) * 0.25
         + np.sin(2 * np.pi * (7 * xx - 3 * yy)) * 0.15 + S.fnoise(n, n, 2.2, 40, 3, 24) * 0.35)
    S.save(S.normal_from_height(h, 2.2), f"{g}/water_n.png")
    credit("ground/water_n.png", "water ripple normal map (GL, +Y up), scroll two copies", "256", "-", [],
           "procedural (periodic sines + noise); own work")


# ---------------------------------------------------------------- roofs + misc
def make_roofs_misc(src: str, out: str) -> None:
    n = 512
    gr = grain_from(src, "Gravel023", n, 256, 0.55) * 0.5 + grain_from(src, "Concrete036", n, 512, 0.8) * 0.5
    rects = [(x * 128, 0, 128, n) for x in range(4)]     # membrane runs 1 m wide
    a = paving(n, rects, gr, 2, 4, 0.75, 50, tone_sd=0.03)
    a = S.stylise(a * lowfreq(n, 51, 0.06))
    a = S.neutral(a, 0.8, 1.0)
    S.save(a, f"{out}/roofs/roof_flat.png")
    credit("roofs/roof_flat.png", "flat roof membrane + gravel, neutral (mean 0.8), tint by the region roof hex", "512",
           "128 (4 m tile)", ["Gravel023", "Concrete036"], "procedural 1 m membrane runs, photo grain; stylise pass, greyed to mean 0.8")

    # landmark stone: ashlar 0.5 m courses, 1 m blocks, 2 m tile
    rects = []
    for r in range(4):
        off = 128 if r % 2 else 0
        for c in range(2):
            rects.append((off + c * 256, r * 128, 256, 128))
    gr = grain_from(src, "Marble012", n, 512, 0.4) * 0.5 + grain_from(src, "Concrete034", n, 256, 0.7) * 0.5
    a = paving(n, rects, gr, 3, 8, 0.7, 52, tone_sd=0.03)
    a = S.stylise(a, target=np.array([0.81, 0.795, 0.765], np.float32))
    S.save(a, f"{out}/misc/stone.png")
    credit("misc/stone.png", "pale ashlar / limestone for landmarks and kerbs", "512", "256 (2 m tile)", ["Marble012", "Concrete034"],
           "procedural ashlar coursing, photo grain; stylise pass, mean ~0.8 warm neutral")

    # clock face 256 RGBA
    k = 4
    N = 256 * k
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = N / 2
    d.ellipse([4 * k, 4 * k, N - 4 * k, N - 4 * k], fill=(46, 42, 38, 255))
    d.ellipse([14 * k, 14 * k, N - 14 * k, N - 14 * k], fill=(196, 160, 82, 255))
    d.ellipse([20 * k, 20 * k, N - 20 * k, N - 20 * k], fill=(242, 232, 206, 255))
    for i in range(60):
        a_ = i / 60 * 2 * np.pi
        r0, r1 = (0.71, 0.84) if i % 5 == 0 else (0.80, 0.84)
        w = (5 if i % 15 == 0 else 3) * k if i % 5 == 0 else k
        d.line([(c + np.sin(a_) * c * r0, c - np.cos(a_) * c * r0), (c + np.sin(a_) * c * r1, c - np.cos(a_) * c * r1)],
               fill=(30, 28, 30, 255), width=int(w))
    for ang, ln, w in ((305.0, 0.45, 9), (60.0, 0.68, 6)):   # 10:10 (hour hand, minute hand)
        a_ = np.radians(ang)
        d.line([(c, c), (c + np.sin(a_) * c * ln, c - np.cos(a_) * c * ln)], fill=(28, 26, 30, 255), width=w * k)
    d.ellipse([c - 7 * k, c - 7 * k, c + 7 * k, c + 7 * k], fill=(28, 26, 30, 255))
    im = im.resize((256, 256), Image.LANCZOS)
    im.save(f"{out}/misc/clock_face.png", optimize=True)
    credit("misc/clock_face.png", "clock dial (cream, bar numerals, gold ring, 10:10), alpha outside", "256 RGBA", "-", [],
           "drawn with PIL at 4x; own work")

    # props noise + foliage breakup
    n = 256
    p = 0.5 + S.fnoise(n, n, 2.0, 60, 2, 64) * 0.07 + S.fnoise(n, n, 2.8, 61, 1, 12) * 0.05
    p = S.wrap_filter(np.repeat(p[..., None], 3, -1), lambda im: im.filter(ImageFilter.MedianFilter(3)))[..., 0]
    p = p + (0.5 - p.mean())
    Image.fromarray((np.clip(p, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(f"{out}/misc/props_noise.png", optimize=True)
    credit("misc/props_noise.png", "painterly breakup noise for props (mean 0.5)", "256 L", "128 at 2 m", [], "procedural; own work")
    rr = np.random.default_rng(62)
    big = Image.new("L", (n * 3, n * 3), 128)
    d = ImageDraw.Draw(big)
    for _ in range(420):
        x, y, rad = rr.uniform(0, n), rr.uniform(0, n), rr.uniform(5, 15)
        v = int(rr.uniform(70, 200))
        for ox in (0, n, 2 * n):
            for oy in (0, n, 2 * n):
                d.ellipse([x + ox - rad, y + oy - rad, x + ox + rad, y + oy + rad], fill=v)
                d.ellipse([x + ox - rad * 0.6, y + oy - rad * 0.75, x + ox + rad * 0.4, y + oy - rad * 0.05],
                          fill=min(255, v + 40))
    f = np.asarray(big.filter(ImageFilter.GaussianBlur(1.2)), np.float32)[n:2 * n, n:2 * n] / 255.0
    f = f + (0.5 - f.mean())
    Image.fromarray((np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(f"{out}/misc/foliage.png", optimize=True)
    credit("misc/foliage.png", "leafy clump breakup for tree canopies (mean 0.5)", "256 L", "-", [], "procedural (wrapped leaf clumps); own work")

    make_npcs(f"{out}/misc/npc_atlas.png")
    credit("misc/npc_atlas.png", "8 distant pedestrian silhouettes (64 x 256 px cells, feet at the bottom)", "512x256 RGBA", "-", [],
           "drawn with PIL at 4x; own work")


def make_npcs(path: str) -> None:
    k = 4
    W, H = 64 * k, 256 * k
    rr = np.random.default_rng(70)
    tops = [(64, 86, 120), (148, 62, 54), (92, 110, 78), (176, 150, 112), (70, 70, 84), (196, 120, 60), (110, 84, 120), (220, 214, 200)]
    bottoms = [(46, 52, 70), (60, 58, 62), (88, 74, 60), (40, 48, 66), (120, 110, 96), (54, 60, 74), (70, 64, 60), (48, 54, 80)]
    skins = [(224, 182, 150), (176, 128, 96), (120, 80, 58), (236, 196, 166), (150, 100, 72), (96, 64, 48), (210, 160, 120), (184, 140, 110)]
    atlas = Image.new("RGBA", (512, 256), (0, 0, 0, 0))
    for i in range(8):
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        cx = W / 2
        tall = 240 * k * rr.uniform(0.9, 1.0)
        foot = H - 2 * k
        head = tall * 0.13
        sh_y = foot - tall + head * 1.05
        hip_y = foot - tall * 0.47
        walk = i % 2 == 0
        sw = tall * 0.13
        top, bot, skin = tops[i], bottoms[i], skins[i]
        # legs
        if walk:
            d.polygon([(cx - sw * 0.5, hip_y), (cx - sw * 0.05, hip_y), (cx - sw * 0.9, foot), (cx - sw * 1.35, foot)], fill=bot)
            d.polygon([(cx + sw * 0.05, hip_y), (cx + sw * 0.5, hip_y), (cx + sw * 1.2, foot), (cx + sw * 0.75, foot)], fill=tuple(int(c * 0.85) for c in bot))
        else:
            d.polygon([(cx - sw * 0.5, hip_y), (cx - sw * 0.02, hip_y), (cx - sw * 0.12, foot), (cx - sw * 0.48, foot)], fill=bot)
            d.polygon([(cx + sw * 0.02, hip_y), (cx + sw * 0.5, hip_y), (cx + sw * 0.46, foot), (cx + sw * 0.1, foot)], fill=tuple(int(c * 0.88) for c in bot))
        d.ellipse([cx - sw * 1.4, foot - 7 * k, cx - sw * 0.1, foot], fill=(40, 36, 36))
        d.ellipse([cx + sw * 0.1, foot - 7 * k, cx + sw * 1.3, foot], fill=(40, 36, 36))
        # torso (coat for some)
        coat = i in (1, 4, 6)
        bottom_y = hip_y + (tall * 0.16 if coat else tall * 0.02)
        d.polygon([(cx - sw * 0.95, sh_y), (cx + sw * 0.95, sh_y), (cx + sw * (0.8 if not coat else 1.0), bottom_y),
                   (cx - sw * (0.8 if not coat else 1.0), bottom_y)], fill=top)
        # arms
        ar = tall * 0.36
        for s in (-1, 1):
            swing = (0.35 * s if walk else 0.08 * s)
            x0 = cx + s * sw * 0.85
            x1 = x0 + s * sw * 0.2 + swing * ar * 0.6
            d.line([(x0, sh_y + 4 * k), (x1, sh_y + ar)], fill=tuple(int(c * 0.9) for c in top), width=int(sw * 0.42))
            d.ellipse([x1 - sw * 0.2, sh_y + ar - sw * 0.2, x1 + sw * 0.2, sh_y + ar + sw * 0.2], fill=skin)
        # neck + head + hair
        d.rectangle([cx - sw * 0.2, sh_y - head * 0.25, cx + sw * 0.2, sh_y + 2], fill=skin)
        d.ellipse([cx - head * 0.42, sh_y - head * 1.05, cx + head * 0.42, sh_y - head * 0.1], fill=skin)
        hair = [(40, 30, 26), (90, 60, 40), (20, 18, 18), (150, 120, 80)][i % 4]
        d.chord([cx - head * 0.45, sh_y - head * 1.1, cx + head * 0.45, sh_y - head * 0.3], 180, 360, fill=hair)
        if i == 7:   # a bag
            d.rectangle([cx + sw * 0.9, hip_y - tall * 0.05, cx + sw * 1.5, hip_y + tall * 0.08], fill=(120, 80, 50))
        im = im.filter(ImageFilter.GaussianBlur(1.5 * k / 4))
        # soft painted shading: darker towards the feet
        a = np.asarray(im, np.float32)
        g = np.linspace(1.08, 0.82, H)[:, None, None]
        a[..., :3] = np.clip(a[..., :3] * g, 0, 255)
        small = Image.fromarray(a.astype(np.uint8), "RGBA").resize((64, 256), Image.LANCZOS)
        atlas.paste(small, (i * 64, 0))
    atlas.save(path, optimize=True)


# ---------------------------------------------------------------- credits + sheet
def write_credits(out: str) -> None:
    lines = ["# app/game3d/art/world: credits and licences (look-world)", "",
             "Every texture here is rebuilt by `app/game3d/tools/world/make_world_art.py <ambientCG dir> app/game3d/art/world`",
             "(deterministic). Photo-sourced ones go through the art direction's mandatory stylise pass",
             "(`tools/world/stylise.py`: median 3 px, posterise 24 levels, gaussian 2 px, HSV saturation <= 0.55 except",
             "paint/sign accents, mean-matched to the tokens.json hex; normal strength x0.5; roughness >= 0.6 except glass).",
             "",
             "## Licence",
             "- ambientCG (https://ambientcg.com): every asset is **CC0 1.0** (https://docs.ambientcg.com/license/). Sources",
             "  were the 1K JPG/PNG downloads of the ids listed below.",
             "- Everything drawn procedurally (layouts, windows, cornices, signs, noise, silhouettes, clock face) is own work,",
             "  released as **CC0 1.0** by the project.",
             "- No Poly Haven, Kenney or other files are embedded in these textures.",
             "",
             "## Deviation from ART-DIRECTION.md 4.3",
             "The AD asks for 1024 x 1024 trim sheets at 128 px/m, but its rows add up to 9.0 m. The sheets are 1024 x 1280",
             "(8 m x 10 m at 128 px/m) and carry one extra row: a 1.0 m BLANK WALL of the sheet's main material (windowless",
             "walls, sheds, gable ends). ORM and normal maps are half resolution (512 x 640, 64 px/m).",
             "",
             "## Files", "",
             "| File | What | Size | px/m | Sources (CC0 1.0) | Processing |", "|---|---|---|---|---|---|"]
    for c in CREDITS:
        src = ", ".join(f"[{s}]({ACG}{s})" for s in c["sources"]) or "own work"
        lines.append(f"| `{c['file']}` | {c['what']} | {c['size']} | {c['px_per_m']} | {src} | {c['process']} |")
    lines += ["", "## Trim sheet layout (shared by every sheet; place.gd UVs)", "",
              "| Row | Metres (from top) | Pixels (albedo 1024 x 1280) |", "|---|---|---|"]
    for name, (m0, m1) in trim_sheets.ROWS.items():
        lines.append(f"| {name} | {m0:.1f} to {m1:.1f} | {trim_sheets.px(m0)} to {trim_sheets.px(m1)} |")
    lines += ["", "Upper bay: x 0-4 m variant A, 4-8 m variant B. Shopfront: x 0-4 m glazing + fascia, 4-6 m door, 6-8 m",
              "roller shutter. Every row tiles horizontally at 8 m. ORM: R AO, G roughness, B tint mask (1 = main wall",
              "material, authored neutral grey with mean luma 0.8: shade with `albedo * mix(vec3(1), tint / 0.8, B)`),",
              "A glass (window panes).", ""]
    open(os.path.join(out, "CREDITS.md"), "w").write("\n".join(lines))


PREVIEW_TINT = {"trim_uk_brick": "#A65441", "trim_uk_stone": "#E3DACB", "trim_us_brownstone": "#7A4E3A",
                "trim_us_modern": "#BDB8AF", "trim_us_west": "#E8D7BC", "trim_wa_render": "#D9A548", "trim_generic": "#EEE6D8"}


def contact_sheet(out: str, path: str) -> None:
    from PIL import ImageFont
    tiles = []
    for sub in ("ground", "roofs", "misc"):
        for f in sorted(os.listdir(os.path.join(out, sub))):
            tiles.append((f"{sub}/{f}", Image.open(os.path.join(out, sub, f)).convert("RGBA")))
    s = 220
    cols = 6
    rows = -(-len(tiles) // cols)
    trims = sorted(f for f in os.listdir(os.path.join(out, "trims")) if not f.endswith(("_orm.png", "_n.png")))
    tw, th = 300, 375
    W = max(cols * s, len(trims) * tw)
    o = Image.new("RGB", (W, rows * (s + 16) + 2 * (th + 18) + 8), (24, 24, 28))
    d = ImageDraw.Draw(o)
    for i, (name, im) in enumerate(tiles):
        x, y = (i % cols) * s, (i // cols) * (s + 16)
        bg = Image.new("RGBA", im.size, (90, 120, 90, 255))
        im2 = Image.alpha_composite(bg, im).convert("RGB")
        if "ground" in name and "wear" not in name and "water" not in name:   # 2x2 to show tiling
            im2 = Image.fromarray(np.tile(np.asarray(im2.resize((s // 2, s // 2), Image.LANCZOS)), (2, 2, 1)))
        o.paste(im2.resize((s, s), Image.LANCZOS) if im2.size[0] == im2.size[1] else im2.resize((s, s // 2 if im2.size[0] > im2.size[1] else s)), (x, y + 16))
        d.text((x + 2, y + 2), name, fill=(255, 255, 255))
    y0 = rows * (s + 16)
    for i, t in enumerate(trims):
        alb = Image.open(os.path.join(out, "trims", t)).convert("RGB").resize((tw, th), Image.LANCZOS)
        orm = Image.open(os.path.join(out, "trims", t[:-4] + "_orm.png")).convert("RGBA")
        oa = np.stack([np.asarray(c.resize((tw, th), Image.LANCZOS), np.float32) for c in orm.split()], -1)
        a = np.asarray(alb, np.float32)
        hl = a.copy()
        g = oa[..., 3:4] / 255.0
        hl = hl * (1 - g) + np.array([255, 200, 80], np.float32) * g
        tint = oa[..., 2:3] / 255.0
        hl = hl * (0.75 + 0.25 * tint)
        tc = S.hexc(PREVIEW_TINT.get(t[:-4], "#CCCCCC")) / 0.8
        ta = np.asarray(alb, np.float32) * (1 + (tc - 1) * tint)
        o.paste(Image.fromarray(np.clip(ta, 0, 255).astype(np.uint8)), (i * tw, y0 + 16))
        o.paste(Image.fromarray(hl.astype(np.uint8)), (i * tw, y0 + th + 34))
        d.text((i * tw + 2, y0 + 2), t + " (tinted " + PREVIEW_TINT.get(t[:-4], "") + ")", fill=(255, 255, 255))
        d.text((i * tw + 2, y0 + th + 20), "glass=amber, tint mask bright", fill=(220, 220, 220))
    o.save(path, quality=86)


# ================================================================ build 29 "real" profile (fid29-street)
# python make_world_art.py <street asset dir> <app/game3d/art/world> --profile real
# Writes art/world/real/** and art/street/real/** only. Skips stylise.py: CC0 photo maps at full strength, the
# source's roughness, packed ORM (R AO, G roughness, B height: ground is never metal), albedo mean-matched inside
# measured ranges (Physically Based, CC0) with every texel's linear luminance in [0.04, 0.85]. High files at full
# size, mid files (suffix _mid) at half. art/world/ground, trims, roofs and misc (the low tier's art) are not touched.
REAL_CREDITS: list[dict] = []
PH_URL = "https://polyhaven.com/a/"


def rcredit(path: str, what: str, size: str, density: str, sources: list[str], process: str) -> None:
    REAL_CREDITS.append({"file": path, "what": what, "size": size, "px_per_m": density, "sources": sources, "process": process})


def _map(ident: str, kind: str) -> np.ndarray:
    a = trim_sheets.real_map(kind, ident)
    if a is None:
        raise FileNotFoundError(f"{ident} {kind}")
    return a


def _arm(ident: str, n: int) -> np.ndarray:
    """(AO, roughness) at n px from a Poly Haven arm map or ambientCG AO + Roughness."""
    import glob as _g
    f = sorted(_g.glob(os.path.join(trim_sheets.REAL_SRC, "ph", ident, f"{ident}_arm_*.jpg")))
    if f:
        a = S.resize_wrap(np.asarray(Image.open(f[0]).convert("RGB"), np.float32) / 255.0, n, n)
        return a[..., 0], a[..., 1]
    ao = trim_sheets.real_map("AmbientOcclusion", ident)
    ro = trim_sheets.real_map("Roughness", ident)
    ao = S.resize_wrap(ao, n, n)[..., 0] if ao is not None else np.ones((n, n), np.float32)
    ro = S.resize_wrap(ro, n, n)[..., 0] if ro is not None else np.full((n, n), 0.85, np.float32)
    return ao, ro


def _save_n(n01: np.ndarray, path: str) -> None:
    n = n01 * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-5)
    S.save(n * 0.5 + 0.5, path)


def _safe(a_srgb: np.ndarray) -> np.ndarray:
    """The albedo gate (linear luminance 0.04 to 0.85) with a margin that survives 8-bit rounding and resampling:
    applied to every real albedo as the last step before it is written."""
    return trim_sheets.clamp_lum(np.clip(a_srgb, 0, 1), 0.0415, 0.846)


def _lumstat(a_srgb: np.ndarray) -> str:
    L = trim_sheets.lum(trim_sheets.srgb_to_lin(a_srgb))
    return f"lin lum mean {L.mean():.3f}, min {L.min():.3f}, max {L.max():.3f}"


def real_ground_set(out: str, name: str, ident: str, n: int, target_lin, sat: float, tile_m: float, what: str,
                    src_tag: str, fix=None, rough_add: float = 0.0) -> None:
    """One ground material: <name>.png albedo n, <name>_n.png normal n, <name>_orm.png n/2; _mid files at half."""
    col0 = _map(ident, "Color")
    nrm0 = _map(ident, "NormalGL")
    d0 = trim_sheets.real_map("Displacement", ident)
    for suf, k in (("", n), ("_mid", n // 2)):
        col = S.resize_wrap(col0, k, k)
        if fix is not None:
            col = fix(col)
        col = _safe(trim_sheets.match_lin(col, target_lin, sat))
        S.save(col, f"{out}/{name}{suf}.png")
        _save_n(S.resize_wrap(nrm0, k, k), f"{out}/{name}{suf}_n.png")
        ao, ro = _arm(ident, k // 2)
        hg = S.resize_wrap(d0, k // 2, k // 2)[..., 0] if d0 is not None else np.full((k // 2, k // 2), 0.5, np.float32)
        hg = (hg - hg.min()) / max(1e-4, float(hg.max() - hg.min()))
        S.save(np.stack([ao, np.clip(ro + rough_add, 0.05, 1.0), hg], -1), f"{out}/{name}{suf}_orm.png")
        dens = f"{k / tile_m:.0f} ({tile_m} m tile)"
        rcredit(f"real/ground/{name}{suf}.png", what + (" (mid)" if suf else ""), f"{k}", dens, [src_tag],
                f"no stylise; mean-matched to linear {target_lin} (chroma x{sat}); {_lumstat(col)}")
        rcredit(f"real/ground/{name}{suf}_n.png", "normal (GL), source strength", f"{k}", dens, [src_tag], "resized, renormalised")
        rcredit(f"real/ground/{name}{suf}_orm.png", "ORM: R AO, G roughness (source), B height", f"{k // 2}", "-", [src_tag], "packed")


def _deweed(col: np.ndarray) -> np.ndarray:
    """Moss and grass in the joints to a dark grey-brown (London setts and flags: grime, not lawns)."""
    hsv = np.asarray(S.to_img(col).convert("HSV"), np.float32) / 255.0
    green = np.clip((hsv[..., 1] - 0.18) * 4, 0, 1) * np.clip(1 - np.abs(hsv[..., 0] - 0.22) * 6, 0, 1)
    grey = S.luma(col)[..., None] * np.array([0.92, 0.88, 0.82], np.float32) * 0.8
    return (col * (1 - green[..., None]) + grey * green[..., None]).astype(np.float32)


def _cell(img: np.ndarray, a: np.ndarray, box, size: int, rot: int = 0) -> np.ndarray:
    """A decal cell: RGBA crop (box in source px) at size, alpha faded to 0 at the cell edge."""
    x0, y0, x1, y1 = box
    rgba = np.concatenate([img[y0:y1, x0:x1], a[y0:y1, x0:x1, None]], -1)
    im = S.to_img(rgba[..., :3]).resize((size, size), Image.LANCZOS)
    al = Image.fromarray((np.clip(rgba[..., 3], 0, 1) * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    c = np.concatenate([np.asarray(im, np.float32) / 255, np.asarray(al, np.float32)[..., None] / 255], -1)
    yy, xx = np.mgrid[0:size, 0:size] / (size - 1.0)
    edge = np.clip(np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy)) * 10, 0, 1)
    c[..., 3] *= edge
    return np.rot90(c, rot).copy()


def _gully(size: int, metal: np.ndarray, dirt: float, seed: int) -> np.ndarray:
    """A kerbside gully grate, drawn by us (no maker's lettering): cast-iron frame, slots, dark below; the iron's
    grain comes from a clean bar of ambientCG Grate001."""
    k = 4
    N = size * k
    rr = np.random.default_rng(seed)
    hgt = np.zeros((N, N), np.float32)
    m = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(m)
    f0, f1 = int(N * 0.12), int(N * 0.88)
    d.rectangle([f0, int(N * 0.2), f1, int(N * 0.8)], fill=255)          # frame
    slots = Image.new("L", (N, N), 0)
    ds = ImageDraw.Draw(slots)
    for i in range(7):
        y = int(N * (0.27 + i * 0.075))
        ds.rounded_rectangle([int(N * 0.19), y, int(N * 0.81), y + int(N * 0.04)], radius=int(N * 0.012), fill=255)
    mm = np.asarray(m, np.float32) / 255
    ss = np.asarray(slots, np.float32) / 255
    g = S.tile_to(S.resize_wrap(metal, N // 4, N // 16), N, N)
    iron = np.clip(trim_sheets.match_lin(g, [0.045, 0.045, 0.048], 0.3), 0, 1)
    rust = np.array([0.33, 0.22, 0.15], np.float32)
    rn = (S.fnoise(N, N, 2.4, seed, 2, 40) > 1.0).astype(np.float32)[..., None] * 0.35 * dirt
    col = iron * (1 - rn) + rust * rn
    col = col * (1 - ss[..., None]) + np.array([0.11, 0.11, 0.11], np.float32) * ss[..., None]
    alpha = mm * (1 - 0.0 * ss)
    a = np.concatenate([col, alpha[..., None]], -1)
    im = S.to_img(a[..., :3]).resize((size, size), Image.LANCZOS)
    al = Image.fromarray((alpha * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    return np.concatenate([np.asarray(im, np.float32) / 255, np.asarray(al, np.float32)[..., None] / 255], -1)


def real_decals(out: str, n: int) -> np.ndarray:
    """4 x 4 decal atlas, RGBA (alpha = coverage). Cells: 0-3 gum, 4-7 asphalt cracks and patches, 8-9 leaves,
    10-11 gully grates (drawn), 12 damp stain, 13-14 cracks, 15 tar seal patch."""
    c = n // 4
    atlas = np.zeros((n, n, 4), np.float32)
    gum1, gum1a = _map("ChewingGum001", "Color"), _map("ChewingGum001", "Opacity")[..., 0]
    gum2, gum2a = _map("ChewingGum002", "Color"), _map("ChewingGum002", "Opacity")[..., 0]
    dmg, dmga = _map("AsphaltDamageSet001", "Color"), _map("AsphaltDamageSet001", "Opacity")[..., 0]
    lv, lva = _map("ScatteredLeaves006", "Color"), _map("ScatteredLeaves006", "Opacity")[..., 0]
    def _gum(col: np.ndarray, a: np.ndarray, target: float) -> np.ndarray:
        # flattened gum: grey blotches, matched over the gum itself (the source's black ground left out)
        L = S.luma(col)
        k = target / max(1e-4, float(L[a > 0.4].mean()))
        return np.clip((L * k)[..., None] * np.array([1.0, 0.985, 0.96], np.float32), 0, 1)
    gum1 = _gum(gum1, gum1a, 0.42)
    gum2 = _gum(gum2, gum2a, 0.36)
    cells = [_cell(gum1, gum1a, (0, 0, 400, 400), c), _cell(gum1, gum1a, (500, 500, 900, 900), c, 1),
             _cell(gum2, gum2a, (100, 550, 450, 900), c), _cell(gum2, gum2a, (600, 80, 950, 430), c, 2)]
    # AsphaltDamageSet001: the patches lie in rows; four crops round them
    for box in ((0, 0, 512, 300), (512, 0, 1024, 300), (0, 500, 512, 800), (512, 720, 1024, 1024)):
        x0, y0, x1, y1 = box
        side = max(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        b = (max(0, cx - side // 2), max(0, cy - side // 2), min(1024, cx + side // 2), min(1024, cy + side // 2))
        cells.append(_cell(trim_sheets.clamp_lum(dmg), dmga, b, c))
    cells += [_cell(trim_sheets.clamp_lum(lv), lva, (0, 0, 512, 512), c), _cell(trim_sheets.clamp_lum(lv), lva, (512, 400, 1024, 912), c, 3)]
    metal = _map("Grate001", "Color")[430:462, 320:740]          # a clean bar (no lettering): the iron's grain only
    cells += [_gully(c, metal, 0.6, 81), np.rot90(_gully(c, metal, 1.0, 82), 1).copy()]
    yy, xx = np.mgrid[0:c, 0:c] / (c - 1.0) * 2 - 1
    blob = np.clip(1 - np.sqrt(xx ** 2 * 1.3 + yy ** 2) - S.fnoise(c, c, 2.5, 83, 1, 8) * 0.18, 0, 1)
    cells.append(np.concatenate([np.full((c, c, 3), 0.22, np.float32), (np.clip(blob * 2.2, 0, 1) * 0.55)[..., None]], -1))
    a2 = _map("asphalt_02", "Color")
    crack = np.clip((0.16 - S.luma(S.blur(a2, 1.0))) * 9, 0, 1)
    cells.append(_cell(trim_sheets.clamp_lum(a2 * 0.6), crack, (20, 0, 620, 600), c))
    cells.append(_cell(trim_sheets.clamp_lum(a2 * 0.6), crack, (1200, 1000, 1800, 1600), c, 1))
    tar = trim_sheets.clamp_lum(trim_sheets.match_lin(S.resize_wrap(_map("asphalt_04", "Color"), c, c), [0.05, 0.05, 0.052], 0.2))
    edge = np.clip(np.minimum(np.minimum(xx + 1, 1 - xx), np.minimum(yy + 1, 1 - yy)) * 6 - 0.6 + S.fnoise(c, c, 2.2, 84, 2, 20) * 0.25, 0, 1)
    cells.append(np.concatenate([tar, edge[..., None] * 0.92], -1))
    for i, cell in enumerate(cells[:16]):
        x, y = (i % 4) * c, (i // 4) * c
        atlas[y:y + c, x:x + c] = cell
    atlas[..., :3] = _safe(atlas[..., :3])
    return atlas


def real_ground(src: str, out: str) -> None:
    g = os.path.join(out, "real", "ground")
    os.makedirs(g, exist_ok=True)
    # grey London footway flags (Poly Haven large_square_pattern_01, 3 x 3 flags a tile -> 0.8 m flags on a 2.4 m tile)
    real_ground_set(g, "flags_uk", "large_square_pattern_01", 1024, [0.49, 0.485, 0.465], 0.55, 2.4,
                    "London footway: grey concrete flags, dark joints", "ph:large_square_pattern_01", fix=_deweed)
    # civic square paving (ambientCG PavingStones133: 4 x 4 slabs a tile -> 0.8 m on 3.2 m), pale York-stone grey
    real_ground_set(g, "plaza_uk", "PavingStones133", 1024, [0.50, 0.485, 0.445], 0.45, 3.2,
                    "civic square paving, pale slabs", "acg:PavingStones133", fix=_deweed)
    # carriageway asphalt (Poly Haven asphalt_04, 4 m), aged grey
    real_ground_set(g, "asphalt_uk", "asphalt_04", 1024, [0.15, 0.147, 0.142], 0.6, 4.0,
                    "carriageway asphalt, aged grey aggregate", "ph:asphalt_04")
    # granite kerbs (Poly Haven granite_tile, 1 m), mid grey granite
    real_ground_set(g, "kerb_uk", "granite_tile", 512, [0.28, 0.28, 0.275], 0.6, 1.0,
                    "granite kerb", "ph:granite_tile")
    # granite setts for the gutter channel (ambientCG PavingStones070, 1.15 m)
    real_ground_set(g, "setts_uk", "PavingStones070", 512, [0.22, 0.215, 0.205], 0.5, 1.15,
                    "granite setts (gutter channel)", "acg:PavingStones070", fix=_deweed)
    # decal atlas (high 1K, mid 512)
    at = real_decals(g, 1024)
    S.save(at, f"{g}/decals.png")
    am = np.asarray(Image.fromarray((np.clip(at, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").resize((512, 512), Image.LANCZOS), np.float32) / 255
    am[..., :3] = _safe(am[..., :3])
    S.save(am, f"{g}/decals_mid.png")
    for f, sz in (("decals.png", "1024 RGBA"), ("decals_mid.png", "512 RGBA")):
        rcredit(f"real/ground/{f}", "decal atlas 4 x 4: gum (0-3), asphalt cracks/patches (4-7), leaves (8-9), gully grates drawn by us (10-11), damp stain (12), cracks (13-14), tar seal (15)",
                sz, "-", ["acg:ChewingGum001", "acg:ChewingGum002", "acg:AsphaltDamageSet001", "acg:ScatteredLeaves006", "acg:Grate001 (iron grain from a bar with no lettering)", "ph:asphalt_02", "ph:asphalt_04"],
                "crops with source opacity; gully grates drawn (no maker's marks); luminance clamped")
    # world-space detail normal at 1.5 m (asphalt_04's fine aggregate, high-passed: no joints)
    dn = S.resize_wrap(_map("asphalt_04", "NormalGL"), 512, 512) * 2 - 1
    hp = dn - S.blur(dn, 10) + np.array([0, 0, 1], np.float32)
    hp[..., :2] *= 1.4
    _save_n(hp / np.maximum(np.linalg.norm(hp, axis=-1, keepdims=True), 1e-5) * 0.5 + 0.5, f"{g}/detail_n.png")
    rcredit("real/ground/detail_n.png", "detail normal, world 1.5 m (whiteout blend)", "512", "341", ["ph:asphalt_04"], "high-passed normal")
    # wear for the real ground: R grime, G damp patches (dusk/night), B macro brightness; ~24 m world tile
    n = 512
    r = S.fnoise(n, n, 3.2, 130, 1, 40)
    grime = S.blur(np.clip((r - 0.4) / 1.4, 0, 1) ** 1.2, 1.5)
    damp = S.fnoise(n, n, 2.8, 131, 1, 9) + S.fnoise(n, n, 2.0, 132, 6, 40) * 0.25
    damp = np.clip((damp - 0.9) * 2.2, 0, 1)
    macro = np.clip(0.5 + S.fnoise(n, n, 2.6, 133, 1, 10) * 0.1, 0, 1)
    S.save(np.stack([grime, damp, macro], -1), f"{g}/wear.png")
    rcredit("real/ground/wear.png", "wear: R grime, G damp patches, B macro brightness (0.5 mean)", "512", "~21 (24 m)", [], "procedural periodic noise; own work")
    # UK markings: our own lines (place_roads.gd) worn through a mask taken from ambientCG RoadLines020C's paint
    op = _map("RoadLines020C", "Opacity")[..., 0]
    band = op[150:270, :]                                            # inside one worn stripe: paint vs worn holes
    band = S.resize_wrap(band[..., None].repeat(3, -1), 512, 128)[..., 0]
    m = np.tile(band, (4, 1))
    m = np.minimum(m, np.rot90(m))
    m = np.clip((m - 0.25) * 1.6 + 0.25, 0, 1)
    Image.fromarray((m * 255 + 0.5).astype(np.uint8), "L").save(f"{g}/paint_wear.png", optimize=True)
    rcredit("real/ground/paint_wear.png", "road paint wear mask (1 = paint left), world 1 m", "512 L", "512", ["acg:RoadLines020C"], "opacity inside a worn stripe, crossed with itself")
    # rain streaks under sills (facade_real)
    lk = S.luma(_map("Leaking012A", "Color"))
    lk = np.clip((lk - lk.min()) / max(1e-4, lk.max() - lk.min()), 0, 1)
    Image.fromarray((S.resize_wrap(np.repeat(lk[..., None], 3, -1), 512, 512)[..., 0] * 255 + 0.5).astype(np.uint8), "L").save(
        os.path.join(out, "real", "trims", "leak.png"), optimize=True)
    rcredit("real/trims/leak.png", "rain streaks mask (1 clean, dark = streak)", "512 L", "-", ["acg:Leaking012A"], "luma, normalised")
    # brick micro-detail normal for near walls on high (256 px/m: 512 px over 2 m)
    bn = S.resize_wrap(_map("Bricks097", "NormalGL"), 512, 256) * 2 - 1
    bh = bn - S.blur(bn, 6) + np.array([0, 0, 1], np.float32)
    bh = np.concatenate([bh, bh], 0)
    _save_n(bh / np.maximum(np.linalg.norm(bh, axis=-1, keepdims=True), 1e-5) * 0.5 + 0.5, os.path.join(out, "real", "trims", "wall_detail_n.png"))
    rcredit("real/trims/wall_detail_n.png", "masonry micro-detail normal for walls within 15 m (high)", "512", "256 (2 m)", ["acg:Bricks097"], "high-passed normal")


def real_medallion(src: str, street_out: str) -> None:
    """The street medallion redrawn as a worn stone inlay of the same motif: the motif's lines (from our own
    art/street/medallion.png) inlaid in dark granite in pale segmented stone, worn, joints, a polished middle."""
    os.makedirs(street_out, exist_ok=True)
    here = os.path.dirname(os.path.abspath(__file__))
    med = np.asarray(Image.open(os.path.join(here, "..", "..", "art", "street", "medallion.png")).convert("RGBA"), np.float32) / 255
    N = 1024
    alpha = med[..., 3]
    l = S.luma(med[..., :3])
    from scipy.ndimage import gaussian_filter, binary_dilation
    hp = l - gaussian_filter(l, 6)
    line = np.clip((-hp - 0.035) * 14, 0, 1) * (alpha > 0.5)
    line = gaussian_filter(line, 0.7)
    yy, xx = np.mgrid[0:N, 0:N]
    rad = np.sqrt((xx - N / 2 + 0.5) ** 2 + (yy - N / 2 + 0.5) ** 2) / (N / 2)
    ang = np.arctan2(yy - N / 2, xx - N / 2)
    # pale stone: segmented rings (joints) of real render grain + granite speckle
    pal = S.luma(S.tile_to(S.resize_wrap(_map("PaintedPlaster017", "Color"), 512, 256), N, N))
    speck = S.fnoise(N, N, 1.2, 140, 60, 400)
    rings = [0.985, 0.72, 0.55, 0.33]
    ring_id = np.digitize(rad, rings[::-1])
    seg = np.floor((ang + np.pi) / (2 * np.pi) * np.array([1, 6, 12, 16, 24])[np.clip(ring_id, 0, 4)])
    rng = np.random.default_rng(141)
    tone = rng.normal(0, 0.035, (5, 32))[np.clip(ring_id, 0, 4), seg.astype(int) % 32]
    joint = np.zeros((N, N), np.float32)
    for r0 in rings[1:]:
        joint = np.maximum(joint, np.clip(1 - np.abs(rad - r0) * N / 2 / 2.2, 0, 1))
    seg_edge = np.abs(np.sin((ang + np.pi) * np.array([1, 6, 12, 16, 24])[np.clip(ring_id, 0, 4)] / 2))
    joint = np.maximum(joint, np.clip(1 - seg_edge * rad * N / 2 / 2.0, 0, 1) * (ring_id > 0))
    stone = (0.70 + (pal - pal.mean()) * 0.9 + speck * 0.025 + tone)
    stone_rgb = np.stack([stone * 1.0, stone * 0.985, stone * 0.955], -1)
    gran = S.tile_to(S.resize_wrap(_map("granite_tile", "Color"), 256, 256), N, N)
    gran = trim_sheets.match_lin(gran, [0.10, 0.10, 0.106], 0.5)      # dark grey granite, not a black print
    # wear: the inlay worn through in places, dirt in the joints and round the lines, a polished, paler middle
    wearn = S.fnoise(N, N, 2.2, 142, 3, 60)
    inlay = line * np.clip(1.2 - np.clip(wearn - 1.3, 0, 1) * 2.5, 0, 1) * 0.88
    dirt = np.clip(gaussian_filter(inlay, 3) * 0.8 + joint * 0.9 + np.clip(S.fnoise(N, N, 2.6, 143, 2, 30) - 0.8, 0, 1) * 0.35, 0, 1)
    walk = np.clip(1 - rad / 0.55, 0, 1) ** 1.5
    col = stone_rgb * (1 - dirt[..., None] * 0.35) * (1 + walk[..., None] * 0.06)
    col = col * (1 - inlay[..., None]) + gran * inlay[..., None]
    gm, gma = _map("ChewingGum002", "Color"), _map("ChewingGum002", "Opacity")[..., 0]
    # a few dozen gum spots over the outer rings (a sparse mask over the gum map), not a spatter
    sparse = np.clip((S.fnoise(N, N, 1.6, 144, 3, 40) - 0.9) * 3.0, 0, 1)
    gum = S.tile_to(gma, N, N) * sparse * np.clip((rad - 0.5) * 6, 0, 1) * 0.5
    col = col * (1 - gum[..., None]) + np.array([0.40, 0.39, 0.375], np.float32) * gum[..., None]
    col = _safe(col)
    # height: lines a little sunk (worn), joints sunk, edge chamfer
    hgt = -inlay * 0.6 - joint * 1.2 + wearn * 0.06 - np.clip((rad - 0.965) * 60, 0, 1) * 1.0
    n = S.normal_from_height(hgt.astype(np.float32), 3.2, wrap_y=False)
    rough = np.clip(0.78 - walk * 0.18 + dirt * 0.1 - inlay * 0.12 + gum * 0.1, 0.3, 1.0)
    ao = np.clip(1 - joint * 0.35 - inlay * 0.1, 0.4, 1)
    hn = (hgt - hgt.min()) / max(1e-4, float(hgt.max() - hgt.min()))
    a_out = np.clip((1 - rad) * N / 2 / 1.5, 0, 1) * (alpha > 0.02)
    for suf, k in (("", 1024), ("_mid", 512)):
        rgba = np.concatenate([col, a_out[..., None]], -1)
        im = np.asarray(Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").resize((k, k), Image.LANCZOS), np.float32) / 255
        im[..., :3] = _safe(im[..., :3])
        S.save(im, os.path.join(street_out, f"medallion{suf}.png"))
        _save_n(np.asarray(S.to_img(n).resize((k, k), Image.LANCZOS), np.float32) / 255, os.path.join(street_out, f"medallion{suf}_n.png"))
        orm = np.stack([ao, rough, hn], -1)
        S.save(np.asarray(S.to_img(orm).resize((k // 2, k // 2), Image.LANCZOS), np.float32) / 255, os.path.join(street_out, f"medallion{suf}_orm.png"))
        rcredit(f"../street/real/medallion{suf}.png", "street medallion as a worn stone inlay (same motif), alpha = the disc", f"{k} RGBA", f"{k / 5.6:.0f} (5.6 m)",
                ["own: art/street/medallion.png motif", "acg:PaintedPlaster017", "ph:granite_tile", "acg:ChewingGum002"], f"motif lines inlaid in dark granite; {_lumstat(col)}")
    # the arena's plain floor on mid/high (shown before the street is built, and on a "plain" arena)
    import shutil
    for suf in ("", "_n", "_orm"):
        shutil.copyfile(os.path.join(os.path.dirname(street_out), "..", "world", "real", "ground", f"flags_uk_mid{suf}.png"),
                        os.path.join(street_out, f"pavers{suf}.png"))
    rcredit("../street/real/pavers.png", "the arena floor on mid/high (= real/ground/flags_uk_mid)", "512", "-", ["ph:large_square_pattern_01"], "copy")


def write_real_credits(out: str, trims: list[dict]) -> None:
    lines = ["", "## Build 29 real profile (mid and high tiers): art/world/real and art/street/real", "",
             "Rebuilt by `tools/world/make_world_art.py <street assets> app/game3d/art/world --profile real` (fid29-street).",
             "No stylise pass. Sources: Poly Haven (CC0 1.0, https://polyhaven.com/license; their preview renders are never",
             "used) and ambientCG (CC0 1.0). Albedo bounds from Physically Based (CC0 1.0). Lettering and maker's marks are",
             "never shipped: the gully grates are drawn by us (only a plain bar's iron grain is taken from Grate001).",
             "Full list with URLs: docs/game3d/fid29/ASSETS-LICENCES-street.md.", "",
             "| File | What | Size | px/m | Sources (CC0 1.0) | Processing |", "|---|---|---|---|---|---|"]
    for c in REAL_CREDITS + trims:
        src = ", ".join(c["sources"]) or "own work"
        lines.append(f"| `{c['file']}` | {c['what']} | {c['size']} | {c['px_per_m']} | {src} | {c['process']} |")
    p = os.path.join(out, "CREDITS.md")
    body = open(p).read()
    mark = "\n## Build 29 real profile"
    if mark in body:
        body = body[:body.index(mark)]
    open(p, "w").write(body.rstrip("\n") + "\n" + "\n".join(lines) + "\n")


def main_real(src: str, out: str) -> None:
    trim_sheets.REAL_SRC = src
    os.makedirs(os.path.join(out, "real", "trims"), exist_ok=True)
    real_ground(src, out)
    trims = trim_sheets.make_real(src, os.path.join(out, "real", "trims"))
    real_medallion(src, os.path.join(out, "..", "street", "real"))
    write_real_credits(out, trims)
    tot = sum(os.path.getsize(os.path.join(dp, f)) for d in (os.path.join(out, "real"), os.path.join(out, "..", "street", "real"))
              for dp, _, fs in os.walk(d) for f in fs if f.endswith(".png"))
    print(json.dumps({"real_png_mb": round(tot / 1e6, 2), "files": len(REAL_CREDITS) + len(trims)}))


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    if "--profile" in sys.argv and sys.argv[sys.argv.index("--profile") + 1] == "real":
        main_real(src, out)
        return
    sheet = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else ["ground", "misc", "trims"]
    for sub in ("ground", "trims", "roofs", "misc"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    if "ground" in only:
        make_ground(src, out)
    if "misc" in only:
        make_roofs_misc(src, out)
    if "trims" in only:
        CREDITS.extend(trim_sheets.make_all(src, os.path.join(out, "trims")))
    if only == ["ground", "misc", "trims"]:
        write_credits(out)
    if sheet:
        contact_sheet(out, sheet)
    tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs if f.endswith(".png"))
    print(json.dumps({"png_mb": round(tot / 1e6, 2), "files": len(CREDITS)}))


if __name__ == "__main__":
    main()
