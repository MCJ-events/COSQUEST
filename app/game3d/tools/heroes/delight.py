"""fid29 heromaps: take the painted-in light out of a hero's body colour (no model; numpy, scipy, OpenCV, Blender AO).

Per body material cluster (k-means on the colour, 8 clusters): fit the luminance as ambient occlusion (Blender Cycles
CPU bake on the rest-pose mesh, the head, hands and hair as occluders) times a 9-coefficient spherical-harmonic light on
the rest-pose normal. The fitted shading, normalised to mean 1 in the cluster, is divided out at the strength (0.6 to
0.8) that brings the share of the cluster's luminance variance it explains under 10 %, in linear light and on all three
channels alike (chroma kept); then each cluster is scaled back to its own mean colour (the concept's tone, skin
included, as tonejoin's skin_tone keeps it). Painted speculars on non-metal (small bright, low-saturation spots in a
cluster, ORM metal < 0.35) are inpainted. The neck: body texels within 3 cm (game scale) of the fitted head's lower
rim are feathered toward the head's own colour at the rim.

usage: delight.py IN.glb OUT.glb --work DIR [--res 1024] [--clusters 8] [--head 0.0]
"""
import argparse, json, os, subprocess, sys, time
import numpy as np
from PIL import Image
from hglb import Glb

HERE = os.path.dirname(os.path.abspath(__file__))
HEIGHT = 2.3


def s2l(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def l2s(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def raster(P, N, UV, I, R):
    """texel -> (triangle id, position, normal) for a UV layout at R x R (glTF UV: v down = image row)."""
    tid = np.full((R, R), -1, np.int64)
    pos = np.zeros((R, R, 3), np.float32); nrm = np.zeros((R, R, 3), np.float32)
    uv = UV[I] * R - 0.5
    for t in range(len(I)):
        u = uv[t]
        x0, y0 = np.floor(u.min(0)).astype(int); x1, y1 = np.ceil(u.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, R - 1), min(y1, R - 1)
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        a, b, c = u
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not m.any():
            continue
        yy, xx = ys[m], xs[m]
        W = np.stack([w0[m], w1[m], w2[m]], 1)
        tid[yy, xx] = t
        pos[yy, xx] = W @ P[I[t]]
        nn = W @ N[I[t]]
        nrm[yy, xx] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-8)
    return tid, pos, nrm


def sh9(n):
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    return np.stack([np.ones_like(x), y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y], 1)


def basis(n, ao):
    """[1, AO x SH9(n)]: the constant is the cluster's own colour, the rest the light it was painted with."""
    return np.concatenate([np.ones((len(n), 1), np.float32), sh9(n) * ao[:, None]], 1)


def explained(Y, F):
    v = Y.var()
    return float(1 - ((Y - F) ** 2).mean() / v) if v > 1e-10 else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--work', required=True)
    ap.add_argument('--res', type=int, default=1024); ap.add_argument('--clusters', type=int, default=8)
    ap.add_argument('--target', type=float, default=0.10); ap.add_argument('--neck-cm', type=float, default=3.0)
    ap.add_argument('--no-neck', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    t0 = time.time()
    g = Glb(a.src)
    mi, prim = g.find_prim('geometry_0')
    A = g.prim_arrays(prim)
    P, N, UV, I = A['POSITION'].astype(np.float64), A['NORMAL'].astype(np.float64), A['TEXCOORD_0'].astype(np.float64), A['indices']
    maps = g.material_maps(prim['material'])
    base_img = g.image(maps['base']).convert('RGB')
    W0, H0 = base_img.size
    R = a.res
    orm = np.asarray(g.image(maps['orm']).convert('RGB').resize((R, R), Image.BILINEAR), np.float32) / 255 if 'orm' in maps else None
    # model scale (fighter.gd HEIGHT over the model's height)
    ys = np.concatenate([g.acc(me['primitives'][0]['attributes']['POSITION'])[np.unique(g.acc(me['primitives'][0]['indices']).reshape(-1)), 1] for me in g.j['meshes']])
    k = HEIGHT / (ys.max() - ys.min())
    # AO from Blender: the body as target, every other mesh as an occluder
    occ = [me.get('name') for me in g.j['meshes'] if me.get('name') != 'geometry_0']
    M = {'tgt_pos': P, 'tgt_nrm': N, 'tgt_uv': UV, 'tgt_idx': I}
    srcs = []
    for j, nm in enumerate(occ):
        _, pr = g.find_prim(nm)
        B = g.prim_arrays(pr)
        M['src%d_pos' % j] = B['POSITION']; M['src%d_nrm' % j] = B['NORMAL']; M['src%d_uv' % j] = B['TEXCOORD_0']; M['src%d_idx' % j] = B['indices']
        srcs.append({})
    np.savez(os.path.join(a.work, 'ao_in.npz'), **M)
    aop = os.path.join(a.work, 'ao.png')
    if not os.path.exists(aop):
        spec = {'meshes': os.path.join(a.work, 'ao_in.npz'), 'sources': srcs, 'passes': {'ao': [R, R, aop]}, 'samples': 64,
                'margin': 8, 'threads': 12, 'ao_distance': 0.25 / k}
        json.dump(spec, open(os.path.join(a.work, 'ao.json'), 'w'))
        r = subprocess.run([os.environ.get('BLENDER', 'blender'), '-b', '--factory-startup', '--python', os.path.join(HERE, 'bake_bl.py'), '--',
                            os.path.join(a.work, 'ao.json')], capture_output=True, text=True)
        open(os.path.join(a.work, 'ao_blender.log'), 'w').write(r.stdout[-8000:] + r.stderr[-8000:])
        if 'BAKEDONE' not in r.stdout:
            raise SystemExit('AO bake failed')
    ao = np.asarray(Image.open(aop).convert('L'), np.float32) / 255
    ao_raw = ao.copy()
    ao = np.clip(ao, 0.2, 1.0)        # hidden faces read 0: they carry no light worth fitting
    tid, pos, nrm = raster(P, N, UV, I, R)
    cov = tid >= 0
    col = s2l(np.asarray(base_img.resize((R, R), Image.BOX), np.float32) / 255)
    Y = col @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # clusters on colour (Lab-ish: log luminance + chromaticity), texels the mesh covers
    from scipy.cluster.vq import kmeans2
    chrom = col / np.maximum(col.sum(2, keepdims=True), 1e-4)
    feat = np.concatenate([np.log(Y[..., None] + 0.01) * 0.6, chrom[..., :2] * 4], 2)[cov]
    rng = np.random.default_rng(0)
    sub = feat[rng.choice(len(feat), min(60000, len(feat)), replace=False)]
    cent, _ = kmeans2(sub, a.clusters, seed=1, minit='++')
    lab = np.argmin(((feat[:, None, :] - cent[None]) ** 2).sum(2), 1)
    L = np.full((R, R), -1); L[cov] = lab
    metal = orm[..., 2] if orm is not None else np.zeros((R, R), np.float32)
    shade = np.ones((R, R), np.float32)
    rows = []
    Yc, aoc, nc = Y[cov], ao[cov], nrm[cov]
    lit = ao_raw[cov] > 0.2
    for c in range(a.clusters):
        m = (lab == c) & lit
        if m.sum() < 500:
            continue
        B = basis(nc[m], aoc[m])
        coef, *_ = np.linalg.lstsq(B, Yc[m], rcond=None)
        F = B @ coef
        before = explained(Yc[m], F)
        s = F / max(F.mean(), 1e-6)
        s = np.clip(s, 0.25, 4.0)
        best = None
        for alpha in (0.6, 0.65, 0.7, 0.75, 0.8):
            Yd = Yc[m] / s ** alpha
            B2 = basis(nc[m], aoc[m])
            c2, *_ = np.linalg.lstsq(B2, Yd, rcond=None)
            after = explained(Yd, B2 @ c2)
            best = (alpha, after)
            if after < a.target:
                break
        alpha = best[0]
        idx = np.where(cov.ravel())[0][m]
        shade.ravel()[idx] = s ** alpha
        # texels of the cluster too dark in AO to fit keep the cluster's fitted light at their normal, AO floored
        m2 = (lab == c) & ~lit
        if m2.any():
            F2 = basis(nc[m2], aoc[m2]) @ coef
            idx2 = np.where(cov.ravel())[0][m2]
            shade.ravel()[idx2] = np.clip(F2 / max(F.mean(), 1e-6), 0.25, 4.0) ** alpha
        rows.append({'cluster': c, 'texels': int(m.sum()), 'explained_before': round(before, 3), 'alpha': alpha,
                     'explained_after': round(best[1], 3), 'metal_mean': round(float(metal[cov][m].mean()), 3)})
    # full-res application: the shading field upsampled (smooth: it comes from normals and AO)
    import cv2
    sh_full = cv2.resize(shade, (W0, H0), interpolation=cv2.INTER_LINEAR)
    cov_full = cv2.resize(cov.astype(np.uint8), (W0, H0), interpolation=cv2.INTER_NEAREST).astype(bool)
    sh_full[~cov_full] = 1.0
    colF = s2l(np.asarray(base_img, np.float32) / 255)
    out = colF / sh_full[..., None]
    # keep each cluster's mean colour (the concept's tone)
    labF = cv2.resize(L.astype(np.int16), (W0, H0), interpolation=cv2.INTER_NEAREST)
    for r_ in rows:
        m = labF == r_['cluster']
        if m.sum() == 0:
            continue
        g0 = colF[m].mean(0); g1 = out[m].mean(0)
        out[m] *= (g0 / np.maximum(g1, 1e-5))
        r_['tone_kept'] = True
    # painted speculars on non-metal: bright, low-saturation spots within their cluster
    spec_mask = np.zeros((H0, W0), np.uint8)
    metalF = cv2.resize(metal, (W0, H0), interpolation=cv2.INTER_LINEAR)
    YF = out @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    satF = (out.max(2) - out.min(2)) / np.maximum(out.max(2), 1e-4)
    for r_ in rows:
        m = (labF == r_['cluster']) & (metalF < 0.35)
        if m.sum() < 1000:
            continue
        thr = np.percentile(YF[m], 75) * 1.7
        sm = np.median(satF[m])
        spec_mask |= (m & (YF > thr) & (satF < sm * 0.6)).astype(np.uint8)
    nlab, cc, stats, _ = cv2.connectedComponentsWithStats(spec_mask, 8)
    small = np.zeros(nlab, bool); small[1:] = stats[1:, cv2.CC_STAT_AREA] < (W0 * H0) * 4e-5
    spec_mask = small[cc].astype(np.uint8)
    out_s = (l2s(out) * 255 + 0.5).clip(0, 255).astype(np.uint8)
    if spec_mask.any():
        out_s = cv2.inpaint(out_s, cv2.dilate(spec_mask, np.ones((3, 3), np.uint8)), 3, cv2.INPAINT_TELEA)
    # neck: feather the body toward the head's colour at its lower rim
    neck = {}
    if not a.no_neck and 'head_hybrid' in [me.get('name') for me in g.j['meshes']]:
        _, hp = g.find_prim('head_hybrid')
        HA = g.prim_arrays(hp)
        hm = g.material_maps(hp['material'])
        himg = np.asarray(g.image(hm['base']).convert('RGB'), np.float32) / 255
        HP, HI, HUV = HA['POSITION'].astype(np.float64), HA['indices'], HA['TEXCOORD_0']
        # rim = boundary vertices of the head mesh in its lowest 25 %
        e = np.sort(np.concatenate([HI[:, [0, 1]], HI[:, [1, 2]], HI[:, [2, 0]]]), 1)
        ue, cnt = np.unique(e, axis=0, return_counts=True)
        bv = np.unique(ue[cnt == 1])
        ylo, yhi = HP[:, 1].min(), HP[:, 1].max()
        rim = bv[HP[bv, 1] < ylo + 0.25 * (yhi - ylo)]
        if len(rim):
            hh, hw = himg.shape[:2]
            rc = himg[np.clip((HUV[rim, 1] * hh).astype(int), 0, hh - 1), np.clip((HUV[rim, 0] * hw).astype(int), 0, hw - 1)]
            from scipy.spatial import cKDTree
            kd = cKDTree(HP[rim])
            tidF = cv2.resize(tid.astype(np.float32), (W0, H0), interpolation=cv2.INTER_NEAREST).astype(np.int64)
            posF = cv2.resize(pos, (W0, H0), interpolation=cv2.INTER_LINEAR)
            ok = tidF >= 0
            d, j = kd.query(posF[ok].reshape(-1, 3))
            dcm = d * k * 100
            w = np.clip(1 - dcm / a.neck_cm, 0, 1) ** 1.5 * 0.85
            sel = w > 0
            if sel.any():
                cur = out_s[ok].astype(np.float32) / 255
                tgt = rc[j]
                lin = s2l(cur); tl = s2l(tgt)
                mix = l2s(lin * (1 - w[:, None]) + tl * w[:, None])
                cur[sel] = mix[sel]
                o2 = out_s.copy(); o2[ok] = (cur * 255 + 0.5).clip(0, 255).astype(np.uint8); out_s = o2
            neck = {'rim_vertices': int(len(rim)), 'texels_feathered': int(sel.sum())}
    res_img = Image.fromarray(out_s)
    g.set_image(maps['base'], res_img)
    ex = g.j['materials'][prim['material']].setdefault('extras', {})
    ex.setdefault('cq_heromaps', {})['delight'] = {'clusters': rows, 'specular_spots_px': int(spec_mask.sum()), 'neck': neck}
    g.save(a.dst)
    rep = {'src': os.path.basename(a.src), 'clusters': rows, 'specular_spots_px': int(spec_mask.sum()), 'neck': neck, 'seconds': round(time.time() - t0, 1)}
    json.dump(rep, open(os.path.join(a.work, 'delight.json'), 'w'), indent=1)
    Image.fromarray((np.clip(shade / 2, 0, 1) * 255).astype(np.uint8)).save(os.path.join(a.work, 'shade.png'))
    print(json.dumps({'src': rep['src'], 'max_before': max([r['explained_before'] for r in rows] or [0]), 'max_after': max([r['explained_after'] for r in rows] or [0]),
                      'spec_px': rep['specular_spots_px'], 'neck': neck, 'seconds': rep['seconds']}))


if __name__ == '__main__':
    main()
