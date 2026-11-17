#!/usr/bin/env python3
"""fid29 charshade: material-ID masks for the heroes (build 29, "character materials").

One RGBA mask per hero and detail level, in the body material's own UVs (the GLB's first material, Material_0):
  R skin   G metal   B leather   A cloth sheen (cotton, knit)      synthetic / paint / other = what is left.
Every channel is a smooth weight (a 2 x supersampled class map, box-filtered, then blurred about one texel), never a
hard band, so ETC2 / ASTC block compression and the mip chain keep it. Texels outside every UV island take their
nearest island's weights (no dark gutter bleeding into the mips).

Where the classes come from: the handsmetal lane's texel classes (renderer deploy/hybrid/metal_mat.py "apply --maps":
the hero's concept labelled by colour group, laid over the model's front, every other texel by its nearest labelled
texels), on the exact build-28 lod0 file. On top of them this tool's own gates:
  - skin only where the class is skin AND the texel's colour is a skin colour (Lab hue and chroma window), never on
    a leather, wood (brown, low chroma, rough) or hair texel;
  - metal only for the gold / steel / bronze classes; the lift's own metal flag is NOT trusted (it marked Imani's
    cape and suit as metal: the "smeared bronze");
  - leather and cloth straight from the classes.

Then a garment pass (garment_pass): leather against cloth is settled by colour family (a garment is one colour), so a
jacket's sleeves, back and painted highlights stop reading as cloth patches.

Usage (any python with numpy, scipy and Pillow):
  matid.py build KEY --glb LOD0.glb --classes maps_lod0.npz --out-dir art/char/masks [--size 1024]
      -> KEY_lod0.png, KEY.json (hair colour, iris colour, body UV density), KEY_lod0_debug.jpg (the mask over the map)
  matid.py transfer --ref-glb LOD0.glb --ref-mask KEY_lod0.png --glb OTHER.glb --out OUT.png [--size 512]
      -> the same mask on another file's UVs, by 3D position (nearest texel on the reference surface). Used for
         lod1 (KEY_lod1r.png, 512) and at integration for a re-baked hero with new UVs (fid29-heromaps):
         matid.py transfer --ref-glb <build-28 lod0> --ref-mask art/char/masks/KEY_lod0.png --glb <new lod0> ...
  matid.py files --json art/char/masks/KEY.json --lod0 LOD0.glb --lod1 LOD1.glb
      -> records each file's body map width in KEY.json ("albedo_w"): fighter.gd picks the mask that fits the loaded file
  matid.py all --cast app/game3d/cast/heroes --classes-dir DIR --out-dir app/game3d/art/char/masks
      -> build + transfer for the six heroes (lod0 1024, lod1r 512).
"""
import argparse, io, json, struct, sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

CLASSES = ["other", "skin", "hair", "cloth", "leather", "gold", "steel", "bronze", "paint", "glow"]
CID = {c: i for i, c in enumerate(CLASSES)}
HEROES = ["ascendants_zuri", "blockbusters_kofi", "celestials_lyra", "controllers_tavo", "everborn_oren", "icons_imani"]
GAME_HEIGHT = 2.3          # fighter.gd HEIGHT: every hero is scaled to this
# the hair-card style each hero's hybrid head was built with (deploy/hybrid hair_cards.py / hair_styles.py, hair.json):
# "strands" hang (a bun, a bob), "curls" are tufts with no one strand direction (a crop, a beard), "none" = lashes only
HAIR_STYLE = {"icons_imani": "strands", "celestials_lyra": "strands", "blockbusters_kofi": "curls", "ascendants_zuri": "curls",
              "controllers_tavo": "none", "everborn_oren": ""}
# heroes whose painted armour the texel classes took for cloth (Tavo's breastplate and helmet: the class debug view shows
# them green, with only the painted highlight as metal): the shader keeps the lift's own metal flag on their cloth and
# leather texels (cs_orm_trust). Imani too (15 Nov, after the blind judge): with her lift's metal flag dropped the cape went
# flat pale cream with black streaks, and build 28's bronze-gold cape won 16 of 16 Imani pairs.
ORM_TRUST = {"controllers_tavo": 1.0, "icons_imani": 1.0}
# per-hero shading overrides written into the hero's json (fighter.gd _charshade_parts): Imani's cape keeps the lift's own
# roughness (rough_metal 0..1), her suit no cloth sheen and no painted-light knee (the judge: "plastic over-saturated sheen")
HERO_SHADE = {"icons_imani": {"rough_metal": [0.0, 1.0], "sheen": 0.0, "knee": False}}


# ---------------------------------------------------------------- glb
def read_glb(p):
    raw = Path(p).read_bytes(); n = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + n]), raw[20 + n + 8:]


def accessor(j, b, i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    comp = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a["componentType"]]
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0); isz = np.dtype(comp).itemsize * nc
    if stride and stride != isz:
        rows = np.frombuffer(b, np.uint8, count=stride * (a["count"] - 1) + isz, offset=off)
        out = np.lib.stride_tricks.as_strided(rows, (a["count"], isz), (stride, 1)).copy().view(comp).reshape(a["count"], nc)
    else:
        out = np.frombuffer(b, comp, count=a["count"] * nc, offset=off).reshape(a["count"], nc)
    if a.get("normalized") and comp != np.float32:
        out = out.astype(np.float32) / np.iinfo(comp).max
    return out.astype(np.float32) if comp == np.float32 else out


def prims(j, b, mat_index=None):
    out = []
    for me in j["meshes"]:
        for pr in me["primitives"]:
            if mat_index is not None and pr.get("material") != mat_index:
                continue
            at = pr["attributes"]
            out.append({"V": accessor(j, b, at["POSITION"]).astype(np.float64),
                        "F": accessor(j, b, pr["indices"]).astype(np.int64).reshape(-1, 3),
                        "UV": accessor(j, b, at["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in at else None,
                        "mesh": me.get("name", ""), "mat": pr.get("material")})
    return out


def all_vertices(j, b):
    return np.concatenate([p["V"] for p in prims(j, b)])


def image(j, b, tex_index):
    src = j["textures"][tex_index]["source"]; bv = j["bufferViews"][j["images"][src]["bufferView"]]
    return Image.open(io.BytesIO(b[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]))


def body_material(j):
    """The body: the first material without a cq_surface kind (Material_0 on every hero file)."""
    for i, m in enumerate(j["materials"]):
        if not str((m.get("extras") or {}).get("cq_surface", "")):
            return i
    return 0


# ---------------------------------------------------------------- raster: texel -> 3D point on the surface
def raster(UV, F, V, size):
    """For every texel centre covered by a UV triangle: its 3D point. Returns (P (size,size,3), covered (size,size))."""
    P = np.zeros((size, size, 3), np.float32); cov = np.zeros((size, size), bool)
    T = UV[F] * size                          # glTF UVs: origin top-left, as the image rows
    lo = np.floor(T.min(1)).astype(int); hi = np.ceil(T.max(1)).astype(int)
    for t in range(len(F)):
        x0, y0 = max(lo[t, 0], 0), max(lo[t, 1], 0); x1, y1 = min(hi[t, 0], size - 1), min(hi[t, 1], size - 1)
        if x1 < x0 or y1 < y0:
            continue
        a, b_, c = T[t]
        d = (b_[1] - c[1]) * (a[0] - c[0]) + (c[0] - b_[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((b_[1] - c[1]) * (xs - c[0]) + (c[0] - b_[0]) * (ys - c[1])) / d
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not m.any():
            continue
        tri = V[F[t]]
        p = w0[..., None] * tri[0] + w1[..., None] * tri[1] + w2[..., None] * tri[2]
        sub = P[y0:y1 + 1, x0:x1 + 1]; sub[m] = p[m]; cov[y0:y1 + 1, x0:x1 + 1] |= m
    return P, cov


def fill_gutter(img, cov):
    """Texels outside every island take the nearest covered texel's value."""
    idx = ndimage.distance_transform_edt(~cov, return_distances=False, return_indices=True)
    return img[idx[0], idx[1]]


# ---------------------------------------------------------------- colour
def srgb_to_lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def skin_colour_gate(lab):
    """1 where a texel's colour can be skin (every tone from deep to pale): a warm hue (25 to 75 degrees), chroma 6 to 42,
    lightness 12 to 85. Brown leather and wood are warm too, which is why the class must also say skin."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    hue = np.degrees(np.arctan2(b, a)); ch = np.hypot(a, b)
    return (smooth(hue, 15, 25) * (1 - smooth(hue, 75, 85)) * smooth(ch, 3, 6) * (1 - smooth(ch, 42, 50))
            * smooth(L, 3, 7) * (1 - smooth(L, 86, 92)))


# ---------------------------------------------------------------- build
def weights_from_classes(cls, albedo_rgb, size):
    """cls: (N, N) int class map (-1 = no texel); albedo (N, N, 3) sRGB 0..1 at the same size. Returns RGBA float, cover."""
    N = cls.shape[0]
    cov = cls >= 0
    lab = srgb_to_lab(albedo_rgb)
    gate = skin_colour_gate(lab)
    # leather or wood that the classes still called skin: brown, darker and duller than the hero's skin median
    is_skin = (cls == CID["skin"]).astype(np.float32) * gate
    metal = np.isin(cls, [CID["gold"], CID["steel"], CID["bronze"]]).astype(np.float32)
    leather = (cls == CID["leather"]).astype(np.float32)
    cloth = (cls == CID["cloth"]).astype(np.float32)
    w = np.stack([is_skin, metal, leather, cloth], -1)
    # fill empty texels before filtering (so the filter never pulls in zeros from the gutter)
    w = fill_gutter(w, cov)
    k = N // size
    if k > 1:
        w = w.reshape(size, k, size, k, 4).mean((1, 3))
        cov = cov.reshape(size, k, size, k).any((1, 3))
    w = np.stack([ndimage.gaussian_filter(w[..., c], 0.9) for c in range(4)], -1)
    # a texel never adds up to more than one class
    s = w.sum(-1, keepdims=True); w = np.where(s > 1, w / np.maximum(s, 1e-6), w)
    return np.clip(w, 0, 1), cov


def garment_pass(w, cov, alb, k=150, sub=3, seed=7):
    """Leather against cloth, garment by garment. The classes come from the concept's colour groups laid over the model's
    front (the back and sides by nearest labelled texel), so a jacket came out with patches of cloth (its sleeves, its
    painted highlights, a wedge of its back) that drew as satin streaks. A garment is one colour family: every leather-or-
    cloth texel takes the leather share of the texels nearest it in colour (CIELAB, lightness at half weight, the k
    nearest of a 1-in-`sub` sample of the hero's leather and cloth), so the jacket's brown is leather wherever it is and
    the shirt's cream and the trousers' olive stay cloth. Skin and metal are left as they are; the texel's leather +
    cloth total is kept."""
    lab = srgb_to_lab(np.clip(alb, 0, 1))[cov] * np.array([0.5, 1.0, 1.0])
    lc = w[..., 2][cov] + w[..., 3][cov]
    fr = np.where(lc > 1e-3, w[..., 2][cov] / np.maximum(lc, 1e-3), 0.5)
    rng = np.random.default_rng(seed)
    src = np.where(lc > 0.5)[0]
    src = src[rng.random(len(src)) < 1.0 / sub]
    if len(src) < k or not (0.25 <= float((fr[src] > 0.5).mean()) <= 0.75):
        # only where leather is a garment (a jacket: a quarter or more of the leather-and-cloth surface). Small leather
        # parts (belts, straps, holsters) share colours with the cloth round them and a vote would wash them out
        return w
    _, nn = cKDTree(lab[src]).query(lab, k=k)
    v = fr[src][nn].mean(1)
    # a clear colour vote decides; a split one (a colour both garments share) keeps the texel's own class
    t = np.clip((np.abs(v - 0.5) - 0.1) / 0.2, 0, 1)
    fr = t * (v > 0.5) + (1 - t) * fr
    out = w.copy()
    L = out[..., 2].copy(); C = out[..., 3].copy()
    L[cov] = lc * fr; C[cov] = lc * (1 - fr)
    out[..., 2] = L; out[..., 3] = C
    return out


def hair_colour(j, b):
    for m in j["materials"]:
        if str((m.get("extras") or {}).get("cq_surface", "")) == "hair":
            im = np.asarray(image(j, b, m["pbrMetallicRoughness"]["baseColorTexture"]["index"]).convert("RGBA"), np.float32) / 255
            a = im[..., 3] > 0.5
            if a.sum() > 100:
                return [round(float(x), 4) for x in np.median(im[a][:, :3], 0)]
    return None


EYE = 0.17       # deploy/hybrid/hybrid_head.py: the eyes take the top-right EYE x EYE corner of the head's UVs


def iris_info(j, b):
    """Iris centres (UV), radius and colour on a hybrid head: the two eyeball islands in the head map's eye corner."""
    for m in j["materials"]:
        if m.get("name") == "head_hybrid":
            im = np.asarray(image(j, b, m["pbrMetallicRoughness"]["baseColorTexture"]["index"]).convert("RGB"), np.float32) / 255
            H, W = im.shape[:2]; s = int(EYE * W)
            sq = im[:s, W - s:]
            lab = srgb_to_lab(sq)
            ch = np.hypot(lab[..., 1], lab[..., 2])
            # iris: darker than the sclera and either coloured or very dark (the pupil); the hidden sclera is a flat grey
            dark = ((lab[..., 0] < 50) & (ch > 7)) | (lab[..., 0] < 12)
            dark = ndimage.binary_fill_holes(ndimage.binary_opening(dark, iterations=2))
            lbl, n = ndimage.label(dark)
            if n < 2:
                return None
            sizes = ndimage.sum(dark, lbl, range(1, n + 1)); top = np.argsort(sizes)[::-1][:2] + 1
            out = []
            for t in top:
                ys, xs = np.where(lbl == t)
                cu = (W - s + xs.mean() + 0.5) / W; cv = (ys.mean() + 0.5) / H
                r = np.sqrt(len(xs) / np.pi) / W
                out.append([round(float(cu), 5), round(float(cv), 5), round(float(r), 5)])
            ring = np.isin(lbl, top) & (lab[..., 0] > 14) & (lab[..., 0] < 50) & (ch > 7)
            col = np.median(sq[ring], 0) if ring.sum() > 20 else np.array([0.2, 0.13, 0.08])
            return {"centres": sorted(out), "colour_srgb": [round(float(x), 4) for x in col]}
    return None


def uv_density(j, b, mat):
    """Median UV units per metre of the body at the game's scale (the detail maps' world scale)."""
    allV = all_vertices(j, b); h = float(allV[:, 1].max() - allV[:, 1].min())
    s = GAME_HEIGHT / max(h, 1e-6)
    r = []; wts = []
    for p in prims(j, b, mat):
        T3 = p["V"][p["F"]] * s; T2 = p["UV"][p["F"]]
        a3 = 0.5 * np.linalg.norm(np.cross(T3[:, 1] - T3[:, 0], T3[:, 2] - T3[:, 0]), axis=1)
        e = T2[:, 1:] - T2[:, :1]; a2 = 0.5 * np.abs(e[:, 0, 0] * e[:, 1, 1] - e[:, 0, 1] * e[:, 1, 0])
        ok = (a3 > 1e-10) & (a2 > 1e-12)
        r.append(np.sqrt(a2[ok] / a3[ok])); wts.append(a3[ok])
    r = np.concatenate(r); wts = np.concatenate(wts); o = np.argsort(r); c = np.cumsum(wts[o])
    return float(r[o][np.searchsorted(c, c[-1] / 2)])


def save_mask(w, path):
    Image.fromarray((np.clip(w, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(path, optimize=True)


def debug_sheet(w, albedo, path):
    """The albedo greyed, then each class tinted: skin orange, metal cyan, leather red, cloth sheen green."""
    g = albedo.mean(-1, keepdims=True) * 0.6 + 0.2
    out = np.repeat(g, 3, -1)
    for c, col in enumerate([(1.0, 0.55, 0.2), (0.2, 0.9, 1.0), (0.9, 0.15, 0.15), (0.3, 0.95, 0.3)]):
        out = out * (1 - 0.75 * w[..., c:c + 1]) + 0.75 * w[..., c:c + 1] * np.array(col)
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(path, quality=85)


def cmd_build(a):
    j, b = read_glb(a.glb)
    mat = body_material(j)
    m = j["materials"][mat]
    cls_all = np.load(a.classes, allow_pickle=True)
    key = "cls_" + m.get("name", "Material_0")
    cls = cls_all[key].astype(np.int16)
    alb = np.asarray(image(j, b, m["pbrMetallicRoughness"]["baseColorTexture"]["index"]).convert("RGB"), np.float32) / 255
    if alb.shape[:2] != cls.shape:
        alb = np.asarray(Image.fromarray((alb * 255).astype(np.uint8)).resize(cls.shape[::-1], Image.BILINEAR), np.float32) / 255
    # the class map's own cover: texels the apply step placed in 3D (the rest is gutter it filled with "other")
    UVp = prims(j, b, mat)
    _, cov = raster(np.concatenate([p["UV"] for p in UVp]), np.concatenate(
        [p["F"] + sum(len(q["V"]) for q in UVp[:i]) for i, p in enumerate(UVp)]),
        np.concatenate([p["V"] for p in UVp]), cls.shape[0])
    cls = np.where(cov, cls, -1)
    w, cov_s = weights_from_classes(cls, alb, a.size)
    small_alb = np.asarray(Image.fromarray((alb * 255).astype(np.uint8)).resize((a.size, a.size), Image.BILINEAR), np.float32) / 255
    if not getattr(a, "no_garment", False):
        w = garment_pass(w, cov_s, small_alb)
    out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)
    save_mask(w, out / f"{a.key}_lod0.png")
    debug_sheet(w, small_alb, Path(a.debug_dir or out) / f"{a.key}_lod0_debug.jpg")
    # the painted light on leather and cloth: the lift baked the concept's highlights into the base colour, and on
    # leather those streaks read as lacquer. char_real soft-clips each class's linear luminance above a knee: the
    # class's own 75th percentile (the shader keeps a quarter of what is above it)
    lin = np.where(alb <= 0.04045, alb / 12.92, ((alb + 0.055) / 1.055) ** 2.4)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    knee = {}
    for c, nm in ((CID["leather"], "leather"), (CID["cloth"], "cloth")):
        m = cls == c
        knee[nm] = [round(float(np.percentile(lum[m], q)), 4) for q in (50, 75, 95)] if m.sum() > 500 else None
    info = {"key": a.key, "source": Path(a.glb).name, "classes": Path(a.classes).name,
            "share_of_body_texels": {c: round(float(w[..., i][cov_s].mean()), 4) for i, c in enumerate(["skin", "metal", "leather", "cloth"])},
            "uv_per_m": round(uv_density(j, b, mat), 4), "hair_srgb": hair_colour(j, b), "iris": iris_info(j, b),
            "lum_p50_p75_p95": knee, "hair_style": HAIR_STYLE.get(a.key, ""),
            "orm_trust": ORM_TRUST.get(a.key, 0.0), **HERO_SHADE.get(a.key, {})}
    (out / f"{a.key}.json").write_text(json.dumps(info, indent=1) + "\n")
    print("MATID_BUILD", json.dumps(info))


def surface_points(glb, size):
    j, b = read_glb(glb); mat = body_material(j)
    pp = prims(j, b, mat); off = np.cumsum([0] + [len(p["V"]) for p in pp])
    V = np.concatenate([p["V"] for p in pp]); F = np.concatenate([p["F"] + off[i] for i, p in enumerate(pp)])
    UV = np.concatenate([p["UV"] for p in pp])
    return raster(UV, F, V, size)


def cmd_transfer(a):
    ref = np.asarray(Image.open(a.ref_mask).convert("RGBA"), np.float32) / 255
    Pr, cr = surface_points(a.ref_glb, ref.shape[0])
    Pt, ct = surface_points(a.glb, a.size)
    tree = cKDTree(Pr[cr])
    _, nn = tree.query(Pt[ct], k=4)
    vals = ref[cr][nn].mean(1)
    w = np.zeros((a.size, a.size, 4), np.float32); w[ct] = vals
    w = fill_gutter(w, ct)
    save_mask(w, a.out)
    print("MATID_TRANSFER", a.out, "covered", round(float(ct.mean()), 4))


def albedo_w(glb):
    j, b = read_glb(glb); m = j["materials"][body_material(j)]
    return image(j, b, m["pbrMetallicRoughness"]["baseColorTexture"]["index"]).size[0]


def cmd_files(a):
    """Which file each mask belongs to: the body map's width of lod0 and lod1 (fighter.gd _cs_body_lod tells the files
    apart by it, since the high tier's ally keeps the lod1 file). Written into KEY.json as "albedo_w"."""
    p = Path(a.json); info = json.loads(p.read_text())
    info["albedo_w"] = {"lod0": albedo_w(a.lod0), "lod1": albedo_w(a.lod1)}
    p.write_text(json.dumps(info, indent=1) + "\n")
    print("MATID_FILES", a.json, info["albedo_w"])


def cmd_all(a):
    cast = Path(a.cast); out = Path(a.out_dir)
    for k in HEROES:
        cmd_build(argparse.Namespace(key=k, glb=str(cast / f"{k}_lod0.glb"), classes=str(Path(a.classes_dir) / k / "maps_lod0.npz"),
                                     out_dir=str(out), size=1024, debug_dir=a.debug_dir))
        cmd_transfer(argparse.Namespace(ref_glb=str(cast / f"{k}_lod0.glb"), ref_mask=str(out / f"{k}_lod0.png"),
                                        glb=str(cast / f"{k}_lod1.glb"), out=str(out / f"{k}_lod1r.png"), size=512))
        cmd_files(argparse.Namespace(json=str(out / f"{k}.json"), lod0=str(cast / f"{k}_lod0.glb"), lod1=str(cast / f"{k}_lod1.glb")))


def main():
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("build"); p.add_argument("key"); p.add_argument("--glb", required=True); p.add_argument("--classes", required=True)
    p.add_argument("--out-dir", required=True); p.add_argument("--size", type=int, default=1024); p.add_argument("--debug-dir")
    p = sp.add_parser("transfer"); p.add_argument("--ref-glb", required=True); p.add_argument("--ref-mask", required=True)
    p.add_argument("--glb", required=True); p.add_argument("--out", required=True); p.add_argument("--size", type=int, default=512)
    p = sp.add_parser("files"); p.add_argument("--json", required=True); p.add_argument("--lod0", required=True); p.add_argument("--lod1", required=True)
    p = sp.add_parser("all"); p.add_argument("--cast", required=True); p.add_argument("--classes-dir", required=True)
    p.add_argument("--out-dir", required=True); p.add_argument("--debug-dir")
    a = ap.parse_args()
    {"build": cmd_build, "transfer": cmd_transfer, "files": cmd_files, "all": cmd_all}[a.cmd](a)


if __name__ == "__main__":
    main()
