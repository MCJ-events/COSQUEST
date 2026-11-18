"""fid29 heromaps: torn flaps and shards on a hero body, found the way the game shows them: in its own clips.

The TRELLIS bodies carry webbing (sheet spanning the gap between the knees, flaps between a trouser leg and the coat)
whose corners are weighted to different bones: in the rest pose it hides, in every clip it stretches into the pale and
dark shards between the legs. This skins the body (numpy linear blend skinning, the hero's own skin and inverse bind
matrices) through every clip of its library (res://anim/<key>.glb, bound by bone name) and marks each body triangle
whose longest edge stretches past --stretch (default 2.0) times its rest length in any sampled frame while its corners
hang from bones of both sides (webbing between the legs), or past --stretch-any (3.0) whatever its bones (the cq 060
tear gate counts 2.5). Only triangles below --hip of the body height (the legs) and geometry_0 (the lifted body) are deleted
by default; vertices stay in the buffer, so positions, weights and the model AABB are untouched.

usage: tears.py IN.glb LIB.glb OUT.glb [--report r.json] [--stretch 2.0] [--hip 0.5] [--everywhere] [--frames 12]
       [--grow 0] [--dry]
"""
import argparse, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hglb import Glb  # noqa: E402


def qnorm(q):
    return q / np.maximum(np.linalg.norm(q, axis=-1, keepdims=True), 1e-12)


def q_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def slerp(a, b, u):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        return qnorm(a + u * (b - a))
    th = np.arccos(d)
    return (np.sin((1 - u) * th) * a + np.sin(u * th) * b) / np.sin(th)


def trs(t, r, s):
    m = np.eye(4)
    m[:3, :3] = q_to_mat(r) * np.asarray(s, float)[None, :]
    m[:3, 3] = t
    return m


def node_trs(n):
    if 'matrix' in n:
        m = np.array(n['matrix'], float).reshape(4, 4).T
        s = np.linalg.norm(m[:3, :3], axis=0)
        from scipy.spatial.transform import Rotation
        return m[:3, 3].copy(), Rotation.from_matrix(m[:3, :3] / s).as_quat(), s
    return (np.array(n.get('translation', [0, 0, 0]), float), qnorm(np.array(n.get('rotation', [0, 0, 0, 1]), float)),
            np.array(n.get('scale', [1, 1, 1]), float))


def sample(tin, vout, t, path):
    if t <= tin[0]:
        return vout[0]
    if t >= tin[-1]:
        return vout[-1]
    k = int(np.searchsorted(tin, t) - 1)
    u = (t - tin[k]) / max(1e-9, tin[k + 1] - tin[k])
    if path == 'rotation':
        return slerp(vout[k], vout[k + 1], u)
    return vout[k] * (1 - u) + vout[k + 1] * u


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('lib'); ap.add_argument('dst')
    ap.add_argument('--report'); ap.add_argument('--stretch', type=float, default=2.0); ap.add_argument('--stretch-any', type=float, default=3.0)
    ap.add_argument('--hip', type=float, default=0.5); ap.add_argument('--everywhere', action='store_true')
    ap.add_argument('--frames', type=int, default=12); ap.add_argument('--grow', type=int, default=0)
    ap.add_argument('--mesh', default='geometry_0'); ap.add_argument('--dry', action='store_true')
    ap.add_argument('--mask', default=None)
    a = ap.parse_args()
    g, L = Glb(a.src), Glb(a.lib)
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
    rest = [node_trs(n) for n in nodes]
    name2node = {n.get('name'): i for i, n in enumerate(nodes)}
    skin = J['skins'][0]
    joints = skin['joints']
    ibm = g.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    mi, prim = g.find_prim(a.mesh)
    A = g.prim_arrays(prim)
    P = A['POSITION'].astype(np.float64); I = A['indices'].reshape(-1, 3).astype(np.int64)
    jn = A['JOINTS_0'].astype(np.int64); w = A['WEIGHTS_0'].astype(np.float64)
    w /= np.maximum(w.sum(1, keepdims=True), 1e-9)
    ph = np.concatenate([P, np.ones((len(P), 1))], 1)
    E = np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]])

    def skinned(G):
        M = np.stack([G[j] for j in joints]) @ ibm
        out = np.zeros((len(P), 3))
        for k in range(4):
            out += w[:, k:k + 1] * np.einsum('nij,nj->ni', M[jn[:, k]][:, :3, :], ph)
        return out

    def globals_of(loc):
        G = [None] * len(loc)
        for i in order:
            m = trs(*loc[i])
            G[i] = m if parent[i] < 0 else G[parent[i]] @ m
        return G

    rest_v = skinned(globals_of(rest))
    rl = np.linalg.norm(rest_v[E[:, 0]] - rest_v[E[:, 1]], axis=1)
    ok = rl > 1e-6
    nt = len(I)
    worst = np.ones(nt)
    per_clip = {}
    lnames = [n.get('name') for n in L.j['nodes']]
    for an in L.j.get('animations', []):
        chans = []
        end = 0.0
        for c in an['channels']:
            nd = c['target'].get('node')
            if nd is None or lnames[nd] not in name2node:
                continue
            s = an['samplers'][c['sampler']]
            tin = L.acc(s['input']).reshape(-1).astype(float)
            vout = L.acc(s['output']).astype(float)
            if s.get('interpolation') == 'CUBICSPLINE':
                vout = vout.reshape(len(tin), 3, -1)[:, 1, :]
            chans.append((name2node[lnames[nd]], c['target']['path'], tin, vout))
            end = max(end, float(tin[-1]))
        if not chans:
            continue
        cw = np.ones(nt)
        for t in np.linspace(0, end, a.frames):
            loc = [list(x) for x in rest]
            for nd, path, tin, vout in chans:
                v = sample(tin, vout, t, path)
                loc[nd][{'translation': 0, 'rotation': 1, 'scale': 2}[path]] = qnorm(v) if path == 'rotation' else v
            V = skinned(globals_of(loc))
            ln = np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)
            st = np.where(ok, ln / np.maximum(rl, 1e-9), 1.0).reshape(3, nt).max(0)
            cw = np.maximum(cw, st)
        per_clip[an.get('name', '?')] = round(float((cw > 2.5).mean()), 5)
        worst = np.maximum(worst, cw)
    used_y = P[np.unique(I), 1]
    y0, y1 = used_y.min(), used_y.max()
    cy = P[I, 1].mean(1)
    region = np.ones(nt, bool) if a.everywhere else cy < y0 + a.hip * (y1 - y0)
    # which side of the body each corner hangs from (its heaviest bone): webbing spans the two legs (or a leg and the
    # other side's coat), a flap tears within one leg chain only far past the gate
    jnames = [nodes[j].get('name', '') for j in joints]
    dom = jn[np.arange(len(jn)), np.argmax(w, 1)]
    side = np.array([1 if jnames[d].startswith('Left') else (2 if jnames[d].startswith('Right') else 0) for d in dom])
    st = side[I]
    cross = ((st == 1).any(1) & (st == 2).any(1))
    bad = region & (((worst > a.stretch) & cross) | (worst > a.stretch_any))
    if a.grow > 0:
        for _ in range(a.grow):
            vs = np.zeros(len(P), bool); vs[I[bad].reshape(-1)] = True
            bad |= vs[I].sum(1) >= 2 & region
    keep = ~bad
    rep = {'src': os.path.basename(a.src), 'lib': os.path.basename(a.lib), 'tris': int(nt), 'deleted': int(bad.sum()),
           'deleted_cross': int((bad & cross).sum()), 'stretch_any': a.stretch_any,
           'stretch': a.stretch, 'hip': a.hip, 'region_tris': int(region.sum()),
           'tear_25_before': round(float((worst > 2.5).mean()), 5),
           'tear_25_after': round(float(((worst > 2.5) & keep).sum() / max(1, keep.sum())), 5),
           'worst_clips_before': dict(sorted(per_clip.items(), key=lambda kv: -kv[1])[:8])}
    if a.mask:
        np.savez_compressed(a.mask, bad=bad, worst=worst)
    if not a.dry:
        arrays = {k: A[k] for k in prim['attributes']}
        arrays['indices'] = I[keep].reshape(-1).astype(A['indices'].dtype)
        g.set_prim(prim, arrays)
        g.save(a.dst)
    if a.report:
        json.dump(rep, open(a.report, 'w'), indent=1)
    print(json.dumps(rep))


if __name__ == '__main__':
    main()
