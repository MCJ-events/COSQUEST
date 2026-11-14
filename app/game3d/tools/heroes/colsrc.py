"""fid29 heromaps: a clean, denser colour source for a hero body, in the build 28 body's own UV layout, before the
repack bake (build_body.py --source-maps).

Build 28's body colour is a 2048 JPEG (quality 82 to 88, 4:2:0): magnified 2x by a 4K bake its 8 and 16 texel blocks
read as "camo" squares on the jackets. Every hero keeps a lossless, cleaner colour in the same UV layout (checked:
nearest-UV distance 0): the lift's own 2K PNG (raw.glb of its asset job) and, for the redraw heroes (Imani, Zuri), the
4096 projection of their accepted klein views (asset/work/hero_<key>/redraw_run/redraw/rf/lod0_base_4096.png). Build
28's colour = that clean colour + the later passes (tone, metal, skin) as a correction that is smooth except at
material edges. So:
  1. D = b28 - clean (at 2K), filtered by a guided filter (box radius 6, eps 0.002) on the clean colour's luma: the
     correction keeps its tone and follows the clean edges, the JPEG's blocks (noise in D) average out;
  2. out = clean + D (D upsampled to 4K for the redraw heroes: their octave above 2K is real klein detail);
  3. specks: where out still differs from build 28 by more than 0.14 (sRGB) after a 1-texel blur, the lift's or the
     klein views' specks that build 28's passes painted out, build 28's colour is kept (with a 1-texel ring).
  Texels outside the body's triangles keep build 28's colour. Without a clean source: chroma deblock only.
  3. normals: --normal-src (the lift's lossless 2K PNG, raw.glb) replaces the JPEG normal only where they agree
     (angle under 12 degrees after a 3-texel blur), so later edits to the normal map are kept.
usage: colsrc.py B28.glb OUTDIR [--rf rf4096.png] [--raw raw.glb]
Writes OUTDIR/src_base.png (2048 or 4096), OUTDIR/src_normal.png when --raw, OUTDIR/sources.json for build_body.py.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
import cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hglb import Glb  # noqa: E402


def uv_mask(UV, I, R):
    im = Image.new('L', (R, R), 0)
    d = ImageDraw.Draw(im)
    P = UV[I] * R
    for t in P:
        d.polygon([tuple(p) for p in t], fill=255)
    m = np.asarray(im, np.float32) / 255
    return cv2.dilate(m, np.ones((3, 3), np.uint8))


def blur_n(x, m, s):
    if s <= 0:
        return x
    k = int(s * 3) * 2 + 1
    num = cv2.GaussianBlur(x * m[..., None] if x.ndim == 3 else x * m, (k, k), s)
    den = cv2.GaussianBlur(m, (k, k), s)
    den = np.maximum(den, 1e-4)
    return num / (den[..., None] if x.ndim == 3 else den)


def guided(I, p, m, r, eps):
    """He et al.'s guided filter, box radius r, on the texels of mask m only (normalised box means)."""
    k = (2 * r + 1, 2 * r + 1)
    n = np.maximum(cv2.boxFilter(m, -1, k, normalize=True), 1e-4)
    f = lambda x: cv2.boxFilter(x * m, -1, k, normalize=True) / n
    mI, mp = f(I), f(p)
    vI = f(I * I) - mI * mI
    cIp = f(I * p) - mI * mp
    a_ = cIp / (vI + eps)
    b_ = mp - a_ * mI
    return f(a_) * I + f(b_)


def to_ycc(rgb):
    return cv2.cvtColor(rgb.astype(np.float32), cv2.COLOR_RGB2YCrCb)


def to_rgb(ycc):
    return cv2.cvtColor(ycc.astype(np.float32), cv2.COLOR_YCrCb2RGB)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('b28'); ap.add_argument('out'); ap.add_argument('--rf'); ap.add_argument('--raw')
    ap.add_argument('--chroma2k', type=float, default=2.0); ap.add_argument('--radius', type=int, default=6); ap.add_argument('--speck', type=float, default=0.14); ap.add_argument('--eps', type=float, default=0.002)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    g = Glb(a.b28)
    _, pr = g.find_prim('geometry_0')
    A = g.prim_arrays(pr)
    mm = g.material_maps(pr['material'])
    B = np.asarray(g.image(mm['base']).convert('RGB'), np.float32) / 255
    R0 = B.shape[0]
    M0 = uv_mask(A['TEXCOORD_0'], A['indices'], R0)
    rep = {'b28': os.path.basename(a.b28), 'size_in': R0}
    C = None
    if a.rf:
        C = np.asarray(Image.open(a.rf).convert('RGB'), np.float32) / 255
        rep['clean'] = a.rf
    elif a.raw:
        r = Glb(a.raw)
        _, prr = r.find_prim('geometry_0')
        mr = r.material_maps(prr['material'])
        C = np.asarray(r.image(mr['base']).convert('RGB'), np.float32) / 255
        rep['clean'] = a.raw
    if C is not None:
        # b28 = clean source + a colour correction (tone, metal, skin passes) that is smooth except at material edges:
        # fit it at 2K with a guided filter on the clean source's luma, so the correction follows the clean edges, then
        # add it to the clean source at its own resolution. The JPEG's blocks (noise of the correction) are averaged out.
        R = C.shape[0]
        C2 = cv2.resize(C, (R0, R0), interpolation=cv2.INTER_AREA) if R != R0 else C
        D = B - C2
        guide = cv2.cvtColor(C2, cv2.COLOR_RGB2GRAY)
        Dg = np.stack([guided(guide, D[..., c], M0, a.radius, a.eps) for c in range(3)], 2)
        Du = cv2.resize(Dg, (R, R), interpolation=cv2.INTER_CUBIC) if R != R0 else Dg
        M = M0 if R == R0 else uv_mask(A['TEXCOORD_0'], A['indices'], R)
        Bup = cv2.resize(B, (R, R), interpolation=cv2.INTER_CUBIC) if R != R0 else B
        Me = cv2.erode((M > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0     # the island's border ring keeps b28
        res = np.where(Me[..., None], np.clip(C + np.clip(Du, -0.35, 0.35), 0, 1), Bup)
        # specks: the lift's colour has dark and bright single-texel specks (holes in the colour volume, grazing klein
        # views) that build 28's later passes painted out. Where the clean result differs from build 28 by more than
        # --speck (sRGB units, after build 28's own 1-texel blur) the texel and its neighbours take build 28's colour.
        Bs = blur_n(B, M0, 1.0)
        r2 = cv2.resize(res, (R0, R0), interpolation=cv2.INTER_AREA) if R != R0 else res
        sp = (np.abs(r2 - Bs).max(2) > a.speck) & (M0 > 0.5)
        sp = cv2.dilate(sp.astype(np.uint8), np.ones((3, 3), np.uint8))
        spu = (cv2.resize(sp, (R, R), interpolation=cv2.INTER_NEAREST) if R != R0 else sp) > 0
        soft = cv2.GaussianBlur(spu.astype(np.float32), (5, 5), 1.0)[..., None]
        res = res * (1 - soft) + Bup * soft
        rep['speck_texels_share'] = round(float(sp.sum() / max(1, (M0 > 0.5).sum())), 4)
        back = cv2.resize(res, (R0, R0), interpolation=cv2.INTER_AREA) if R != R0 else res
        d = np.abs(back - B)[M0 > 0.5]
        # the same measured on b28 deblocked by a plain 3-texel blur (what is left is JPEG noise, not colour change)
        rep.update(size_out=R, mean_abs_vs_b28=round(float(d.mean() * 255), 2),
                   mean_abs_vs_b28_blur3=round(float(np.abs(blur_n(back, M0, 3) - blur_n(B, M0, 3))[M0 > 0.5].mean() * 255), 2))
    else:
        y = to_ycc(B)
        y[..., 1:] = blur_n(y[..., 1:], M0, a.chroma2k)
        res = np.where(M0[..., None] > 0.5, np.clip(to_rgb(y), 0, 1), B)
        rep.update(size_out=R0, note='no clean source: chroma deblock only')
    Image.fromarray((res * 255 + 0.5).astype(np.uint8)).save(os.path.join(a.out, 'src_base.png'), compress_level=3)
    src = {'base': os.path.join(a.out, 'src_base.png')}
    if a.raw and 'normal' in mm:
        r = Glb(a.raw)
        _, prr = r.find_prim('geometry_0')
        mr = r.material_maps(prr['material'])
        if 'normal' in mr:
            N = np.asarray(g.image(mm['normal']).convert('RGB'), np.float32) / 127.5 - 1
            Nr = np.asarray(r.image(mr['normal']).convert('RGB').resize((N.shape[1], N.shape[0]), Image.LANCZOS), np.float32) / 127.5 - 1

            def nz(v):
                return v / np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
            Mn = M0 if N.shape[0] == R0 else uv_mask(A['TEXCOORD_0'], A['indices'], N.shape[0])
            Nb, Nrb = nz(blur_n(N, Mn, 3)), nz(blur_n(Nr, Mn, 3))
            ang = np.degrees(np.arccos(np.clip((Nb * Nrb).sum(2), -1, 1)))
            agree = (ang < 12) & (Mn > 0.5)
            w = cv2.GaussianBlur(agree.astype(np.float32), (9, 9), 2)[..., None]
            out = np.where(Mn[..., None] > 0.5, nz(w * Nr + (1 - w) * N), N)
            Image.fromarray(((out * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(os.path.join(a.out, 'src_normal.png'), compress_level=3)
            src['normal'] = os.path.join(a.out, 'src_normal.png')
            rep['normal_from_raw_share'] = round(float(agree.sum() / max(1, (Mn > 0.5).sum())), 3)
    json.dump(src, open(os.path.join(a.out, 'sources.json'), 'w'))
    json.dump(rep, open(os.path.join(a.out, 'colsrc.json'), 'w'), indent=1)
    print(json.dumps(rep))


if __name__ == '__main__':
    main()
