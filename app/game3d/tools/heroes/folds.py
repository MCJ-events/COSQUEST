"""fid29 heromaps: the pale stars and shards in the crotch and at the knees are lifted cloth that turns over when the
legs bend: TRELLIS gives the trouser fold a few long triangles whose corners hang from different bones, so in a stride
or a crouch they flip and face the sun with the trousers' light colour. Their geometry and weights stay (the rig and the
fight are build 28's); their colour is darkened where they turn, the way a real fold sits in its own shadow.

For every body triangle below --hip of the height that hangs from both legs (or from the hips and a thigh: the crotch
web), its worst orientation over every clip of the hero's library (numpy
skinning, 10 frames a clip): the posed normal against the rest normal carried by its corner's bone blend (1 = as at
rest, -1 = turned over). Per vertex the worst of its triangles; per texel (barycentric over the body's own UVs) a
darkening of up to --dark (0.6) times smoothstep(--from, --to) of the turn. Only the base colour changes.

usage: folds.py IN.glb LIB.glb OUT.glb [--report r.json] [--hip 0.55] [--from 0.1] [--to -0.6] [--dark 0.6]
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tears as T  # noqa: E402
from hglb import Glb  # noqa: E402


def worst_turn(g, L, mesh='geometry_0', frames=10):
    J = g.j
    nodes = J['nodes']
    parent = [-1] * len(nodes)
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    order, seen = [], set()

    def visit(i):
        if i in seen:
            return
        if parent[i] >= 0:
            visit(parent[i])
        seen.add(i); order.append(i)
    for i in range(len(nodes)):
        visit(i)
    rest = [T.node_trs(n) for n in nodes]
    name2node = {n.get('name'): i for i, n in enumerate(nodes)}
    skin = J['skins'][0]
    joints = skin['joints']
    ibm = g.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    _, prim = g.find_prim(mesh)
    A = g.prim_arrays(prim)
    P = A['POSITION'].astype(float); I = A['indices'].reshape(-1, 3)
    jn = A['JOINTS_0'].astype(int); w = A['WEIGHTS_0'].astype(float); w /= np.maximum(w.sum(1, keepdims=True), 1e-9)
    ph = np.c_[P, np.ones(len(P))]

    def glob(loc):
        G = [None] * len(loc)
        for i in order:
            m = T.trs(*loc[i]); G[i] = m if parent[i] < 0 else G[parent[i]] @ m
        return G

    def mats(G):
        return np.stack([G[j] for j in joints]) @ ibm

    def skinned(M):
        out = np.zeros((len(P), 3))
        for k in range(4):
            out += w[:, k:k + 1] * np.einsum('nij,nj->ni', M[jn[:, k]][:, :3, :], ph)
        return out

    def tn(X):
        n = np.cross(X[I[:, 1]] - X[I[:, 0]], X[I[:, 2]] - X[I[:, 0]])
        return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    n0 = tn(skinned(mats(glob(rest))))
    lnames = [n.get('name') for n in L.j['nodes']]
    worst = np.ones(len(I))
    for an in L.j.get('animations', []):
        ch = []
        for c in an['channels']:
            nd = c['target'].get('node')
            if nd is None or lnames[nd] not in name2node:
                continue
            s = an['samplers'][c['sampler']]
            ch.append((name2node[lnames[nd]], c['target']['path'], L.acc(s['input']).reshape(-1).astype(float), L.acc(s['output']).astype(float)))
        if not ch:
            continue
        end = max(x[2][-1] for x in ch)
        for t in np.linspace(0, end, frames):
            loc = [list(x) for x in rest]
            for nd, path, tin, vout in ch:
                v = T.sample(tin, vout, t, path)
                k = {'translation': 0, 'rotation': 1, 'scale': 2}[path]
                loc[nd][k] = T.qnorm(v) if k == 1 else v
            M = mats(glob(loc)); X = skinned(M)
            R = np.einsum('nk,nkij->nij', w[I[:, 0]], M[jn[I[:, 0]]][:, :, :3, :3])
            nr = np.einsum('nij,nj->ni', R, n0); nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-12)
            worst = np.minimum(worst, (tn(X) * nr).sum(1))
    return A, prim, worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('lib'); ap.add_argument('dst'); ap.add_argument('--report')
    ap.add_argument('--hip', type=float, default=0.55); ap.add_argument('--dark', type=float, default=0.6)
    ap.add_argument('--from', dest='t0', type=float, default=0.1); ap.add_argument('--to', dest='t1', type=float, default=-0.6)
    a = ap.parse_args()
    g, L = Glb(a.src), Glb(a.lib)
    A, prim, worst = worst_turn(g, L)
    P = A['POSITION'].astype(float); I = A['indices'].reshape(-1, 3); UV = A['TEXCOORD_0'].astype(float)
    ys = P[np.unique(I), 1]
    low = P[I].mean(1)[:, 1] < ys.min() + a.hip * (ys.max() - ys.min())
    x = np.clip((a.t0 - worst) / (a.t0 - a.t1), 0, 1)
    # only the crotch web: triangles hanging from both legs, or from the hips and a thigh (a cape or a coat tail that
    # turns as the legs swing keeps its colour; it is cloth that really swings, not a fold that closes)
    jn = A['JOINTS_0'].astype(int); w = A['WEIGHTS_0'].astype(float)
    names = [g.j['nodes'][j].get('name', '') for j in g.j['skins'][0]['joints']]
    dom = jn[np.arange(len(jn)), np.argmax(w, 1)]
    dn = np.array([names[d] for d in dom])[I]
    left = np.char.startswith(dn, 'Left').any(1); right = np.char.startswith(dn, 'Right').any(1)
    hips = (dn == 'Hips').any(1); thigh = np.isin(dn, ['LeftUpLeg', 'RightUpLeg']).any(1)
    # and anything in the crotch box (centre +-9 % of the height across, 36 to 52 % of it up), whatever its bones
    c = P[I].mean(1); H = ys.max() - ys.min(); cx = 0.5 * (P[:, 0].min() + P[:, 0].max())
    box = (np.abs(c[:, 0] - cx) < 0.09 * H) & (c[:, 1] > ys.min() + 0.36 * H) & (c[:, 1] < ys.min() + 0.52 * H)
    web = (left & right) | (hips & thigh) | box
    f_tri = np.where(low & web, x * x * (3 - 2 * x), 0.0)
    # per vertex: welded by position, the worst of its triangles (so a fold's ring fades instead of stepping)
    key = np.round(P / 1e-5).astype(np.int64)
    _, wid = np.unique(key, axis=0, return_inverse=True); wid = wid.reshape(-1)
    fw = np.zeros(wid.max() + 1)
    np.maximum.at(fw, wid[I].reshape(-1), np.repeat(f_tri, 3))
    fv = fw[wid]
    maps = g.material_maps(prim['material'])
    img = g.image(maps['base']).convert('RGB')
    R = img.size[0]
    acc = np.zeros((R, R), np.float32)
    cnt = np.zeros((R, R), np.float32)
    tris = np.where(fv[I].max(1) > 0.01)[0]
    for t in tris:
        u = UV[I[t]] * R - 0.5
        x0, y0 = np.floor(u.min(0)).astype(int); x1, y1 = np.ceil(u.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, R - 1), min(y1, R - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        p = np.stack([gx.ravel(), gy.ravel()], 1).astype(float)
        v0, v1 = u[1] - u[0], u[2] - u[0]
        d = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(d) < 1e-12:
            continue
        q = p - u[0]
        b1 = (q[:, 0] * v1[1] - v1[0] * q[:, 1]) / d
        b2 = (v0[0] * q[:, 1] - q[:, 0] * v0[1]) / d
        b0 = 1 - b1 - b2
        inside = (b0 >= -0.02) & (b1 >= -0.02) & (b2 >= -0.02)
        if not inside.any():
            continue
        val = b0 * fv[I[t, 0]] + b1 * fv[I[t, 1]] + b2 * fv[I[t, 2]]
        yy, xx = gy.ravel()[inside], gx.ravel()[inside]
        acc[yy, xx] = np.maximum(acc[yy, xx], val[inside]); cnt[yy, xx] = 1
    import cv2
    acc = cv2.GaussianBlur(acc, (0, 0), 1.0) * (cnt > 0)      # a soft edge, inside the island only
    a_ = np.asarray(img, np.float32) / 255
    lin = np.where(a_ <= 0.04045, a_ / 12.92, ((a_ + 0.055) / 1.055) ** 2.4)
    lin *= (1 - a.dark * acc)[..., None]
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, 1) ** (1 / 2.4) - 0.055)
    g.set_image(maps['base'], Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)))
    m = g.j['materials'][prim['material']]
    m.setdefault('extras', {}).setdefault('cq_heromaps', {})['folds'] = {'tris': int((f_tri > 0.01).sum()), 'dark': a.dark}
    g.save(a.dst)
    rep = {'src': os.path.basename(a.src), 'tris_turning': int((f_tri > 0.01).sum()), 'tris_turned_over': int(((worst < 0) & low).sum()),
           'texels_darkened': int((acc > 0.01).sum()), 'dark': a.dark}
    if a.report:
        json.dump(rep, open(a.report, 'w'), indent=1)
    print(json.dumps(rep))


if __name__ == '__main__':
    main()
