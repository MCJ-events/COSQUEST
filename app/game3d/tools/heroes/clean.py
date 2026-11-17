"""fid29 heromaps: geometry clean-up of a hero body (geometry_0), same rig and weights on every kept vertex.

Deletes triangles only (no vertex moves, no new vertices):
 1. loose components: pieces (welded by position) with fewer than 0.3 % of the body's triangles (floating shards);
 2. fins: patches of two-sided sheet thinner than 4 mm (a ray from each triangle, back through the surface, meets a
    back-facing surface within 4 mm) whose area is over 2 cm2 at game scale, below the hips (the torn flaps on the
    trousers and knees). Larger cloth (a cape, a sash, a coat tail) is not touched: a patch over 120 cm2 is kept, and
    nothing above the hips is looked at.
The deleted triangles' vertices stay in the vertex buffer (unreferenced), and the model's AABB is checked against the
input in Godot afterwards (aabb.gd): fighter.gd scales and centres each model by it.

usage: clean.py IN.glb OUT.glb [--report r.json] [--min-share 0.003] [--fin-mm 4] [--fin-cm2 2] [--hip 0.47]
       [--dry] [--keep-fins] [--mask out.npz]
"""
import argparse, json, sys
import numpy as np
import trimesh
from hglb import Glb

HEIGHT = 2.3     # fighter.gd: models are scaled so their AABB is this tall


def weld_components(P, I):
    key = np.round(P / 1e-5).astype(np.int64)
    _, wid = np.unique(key, axis=0, return_inverse=True)
    wid = wid.reshape(-1)
    T = wid[I]
    n = wid.max() + 1
    parent = np.arange(n)

    def find(x):
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r
    for a, b, c in T:
        ra, rb, rc = find(a), find(b), find(c)
        if rb != ra:
            parent[rb] = ra
        if rc != ra and find(rc) != ra:
            parent[find(rc)] = ra
    roots = np.array([find(x) for x in range(n)])
    comp = roots[T[:, 0]]
    _, comp = np.unique(comp, return_inverse=True)
    return comp, T


def tri_adjacency_groups(T, mask):
    """Connected groups (sharing a welded vertex) among triangles where mask is true."""
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return np.full(len(T), -1)
    parent = {i: i for i in idx}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    first = {}
    for t in idx:
        for v in T[t]:
            if v in first:
                ra, rb = find(first[v]), find(t)
                if ra != rb:
                    parent[rb] = ra
            else:
                first[v] = t
    g = np.full(len(T), -1)
    roots = {}
    for t in idx:
        r = find(t)
        g[t] = roots.setdefault(r, len(roots))
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--report'); ap.add_argument('--mask')
    ap.add_argument('--min-share', type=float, default=0.003)
    ap.add_argument('--fin-mm', type=float, default=4.0); ap.add_argument('--fin-cm2', type=float, default=2.0)
    ap.add_argument('--fin-max-cm2', type=float, default=120.0); ap.add_argument('--hip', type=float, default=0.47)
    ap.add_argument('--vis-max', type=float, default=0.03)
    ap.add_argument('--everywhere', action='store_true')
    ap.add_argument('--dry', action='store_true'); ap.add_argument('--keep-fins', action='store_true')
    a = ap.parse_args()
    g = Glb(a.src)
    mi, prim = g.find_prim('geometry_0')
    A = g.prim_arrays(prim)
    P = A['POSITION'].astype(np.float64); I = A['indices']
    # game scale from the whole model's height (all meshes)
    ys = np.concatenate([g.acc(me['primitives'][0]['attributes']['POSITION'])[:, 1] for me in g.j['meshes']])
    used_y = []
    for me in g.j['meshes']:
        pr = me['primitives'][0]
        Q = g.acc(pr['attributes']['POSITION']); J = g.acc(pr['indices']).reshape(-1)
        used_y.append(Q[np.unique(J), 1])
    used_y = np.concatenate(used_y)
    k = HEIGHT / (used_y.max() - used_y.min())
    comp, T = weld_components(P, I)
    nc = comp.max() + 1
    csize = np.bincount(comp, minlength=nc)
    small = csize < a.min_share * len(I)
    del_comp = small[comp]
    # fins
    mesh = trimesh.Trimesh(P, I, process=False)
    n = mesh.face_normals
    c = mesh.triangles_center
    area = mesh.area_faces * k * k * 1e4             # cm2 at game scale
    lowy = c[:, 1] < used_y.min() + a.hip * (used_y.max() - used_y.min())
    thin = np.zeros(len(I), bool)
    # fins: the hidden side of a thin double shell. TRELLIS cloth is often two surfaces a millimetre or two apart; the
    # inner one carries no real colour and pokes through the outer one wherever the skin bends (the pale stars on Kofi's
    # trousers, the dark tears at Imani's knees). A triangle whose back ray meets a back-facing surface within fin-mm and
    # that (nearly) no game camera direction sees in the rest pose, while the surface in front of it is seen, is a fin.
    import repack as rp
    prims = []
    for me in g.j['meshes']:
        pr = me['primitives'][0]
        prims.append((g.acc(pr['attributes']['POSITION']).astype(np.float64), g.acc(pr['indices']).reshape(-1, 3).astype(np.int64)))
    focus = [m.get('name') for m in g.j['meshes']].index('geometry_0')
    vis, _ = rp.visibility(prims, focus, grid=768, npts=2_500_000, tol_k=0.0003)
    cand = np.where(~del_comp & (vis < a.vis_max))[0]
    pair_vis = np.zeros(len(I))
    if len(cand):
        origins = c[cand] - n[cand] * 1e-5
        dirs = -n[cand]
        hits, ray_i, tri_i = mesh.ray.intersects_location(origins, dirs, multiple_hits=False)
        d = np.linalg.norm(hits - origins[ray_i], axis=1) * k * 1000          # mm at game scale
        back = (n[tri_i] * n[cand][ray_i]).sum(1) < -0.5
        ok = (d < a.fin_mm) & back & (tri_i != cand[ray_i]) & (vis[tri_i] > vis[cand[ray_i]] + 0.05)
        thin[cand[ray_i[ok]]] = True
    if not a.everywhere:
        thin &= lowy
    grp = tri_adjacency_groups(T, thin)
    del_fin = np.zeros(len(I), bool)
    fins = []
    for gi in range(grp.max() + 1):
        m = grp == gi
        ar = area[m].sum()
        if a.fin_cm2 < ar:
            fins.append({'tris': int(m.sum()), 'cm2': round(float(ar), 1), 'centre': [round(float(x), 3) for x in c[m].mean(0)]})
            del_fin |= m
    if a.keep_fins:
        del_fin[:] = False
    dele = del_comp | del_fin
    rep = {'src': a.src.split('/')[-1], 'tris': int(len(I)), 'components': int(nc), 'small_components': int(small.sum()),
           'small_component_tris': int(del_comp.sum()), 'thin_tris': int(thin.sum()), 'fin_patches': fins,
           'fin_tris': int(del_fin.sum()), 'deleted_tris': int(dele.sum()), 'deleted_share': round(float(dele.mean()), 4), 'game_scale': round(k, 4)}
    if a.mask:
        np.savez(a.mask, comp=del_comp, fin=del_fin, thin=thin)
    if not a.dry:
        arrays = {kk: A[kk] for kk in prim['attributes']}
        arrays['indices'] = I[~dele]
        g.set_prim(prim, arrays)
        g.save(a.dst)
    if a.report:
        json.dump(rep, open(a.report, 'w'), indent=1)
    print(json.dumps({x: rep[x] for x in rep if x != 'fin_patches'} | {'fin_patches': len(fins)}))


if __name__ == '__main__':
    main()
