"""fid29 heromaps: visibility-weighted UV repack of one mesh of a hero GLB (xatlas, MIT).

1. Visibility (waste.py's method): 1.5 M surface samples z-buffered from the game's camera directions (25 deg below level
   to 70 deg above, all round; the front half weighted 1.5x: the intro beat and the victory shot face the hero).
   Per triangle: the weighted share of directions that see it.
2. Triangles no direction sees (inner shells, faces inside the body) get zero UV area: their corners take the new UV of
   the nearest seen vertex, so if a pose ever shows one it carries its neighbour's colour.
3. xatlas charts the seen triangles; each chart is then scaled by sqrt(its visibility / the median), clamped 0.5..1.4,
   and xatlas packs the scaled charts (input UVs) into the square at the requested resolution.
Geometry is not touched: vertices are only split where the new seams need it (vmap: new vertex -> old vertex).

usage: repack.py IN.glb MESH_NAME SIZE OUT.npz [--padding 6] [--target-fill 0.78]
"""
import argparse, json, sys, time
import numpy as np
import xatlas
from hglb import Glb


def fib_dirs(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)


def visibility(prims, focus, grid=512, npts=1_500_000, seed=0, front=np.array([0, 0, 1.0]), tol_k=0.002):
    """prims: [(V, I)] for every mesh of the model (occluders). Returns per-triangle weighted visibility of prim `focus`."""
    rng = np.random.default_rng(seed)
    P = np.concatenate([p[0][p[1]].reshape(-1, 3, 3) for p in prims])
    owner = np.concatenate([np.full(len(p[1]), k) for k, p in enumerate(prims)])
    e1, e2 = P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]
    area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    cnt = rng.multinomial(npts, area / area.sum()) + 1
    tid = np.repeat(np.arange(len(P)), cnt)
    u, v = rng.random(len(tid)), rng.random(len(tid))
    f = u + v > 1
    u[f], v[f] = 1 - u[f], 1 - v[f]
    st = np.r_[0, np.cumsum(cnt)[:-1]]
    u[st] = 1 / 3; v[st] = 1 / 3
    X = P[tid, 0] + u[:, None] * e1[tid] + v[:, None] * e2[tid]
    c = X.mean(0)
    R = np.linalg.norm(X - c, axis=1).max()
    tol = tol_k * R
    D = fib_dirs(220)
    D = D[(D[:, 1] > np.sin(np.radians(-25))) & (D[:, 1] < np.sin(np.radians(70)))]
    W = 1.0 + 0.5 * np.clip(D @ front, 0, None)
    vis = np.zeros(len(P))
    for dv, w in zip(D, W):
        up = np.array([0, 1.0, 0]) if abs(dv[1]) < 0.95 else np.array([1.0, 0, 0])
        ax = np.cross(up, dv); ax /= np.linalg.norm(ax); ay = np.cross(dv, ax)
        Y = X - c
        px = np.clip(((Y @ ax / R + 1) * 0.5 * (grid - 1)).astype(np.int64), 0, grid - 1)
        py = np.clip(((Y @ ay / R + 1) * 0.5 * (grid - 1)).astype(np.int64), 0, grid - 1)
        depth = -(Y @ dv)
        pix = py * grid + px
        dmin = np.full(grid * grid, np.inf)
        np.minimum.at(dmin, pix, depth)
        ok = depth <= dmin[pix] + tol
        seen_t = np.zeros(len(P), bool)
        seen_t[tid[ok]] = True
        vis += w * seen_t
    vis /= W.sum()
    m = owner == focus
    return vis[m], area[m]


def islands(n_vert, idx):
    """Connected components of a UV mesh (vertices shared = same island)."""
    parent = np.arange(n_vert)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for t in idx:
        r0 = find(t[0])
        for k in (1, 2):
            r = find(t[k])
            if r != r0:
                parent[r] = r0
    roots = np.array([find(i) for i in range(n_vert)])
    _, lab = np.unique(roots, return_inverse=True)
    return lab


def uv_area(uv, idx):
    u = uv[idx]
    return 0.5 * np.abs((u[:, 1, 0] - u[:, 0, 0]) * (u[:, 2, 1] - u[:, 0, 1]) - (u[:, 2, 0] - u[:, 0, 0]) * (u[:, 1, 1] - u[:, 0, 1]))


def repack(g, mesh_name, size, padding=6, wmin=0.5, wmax=1.4, all_seen=False):
    t0 = time.time()
    prims = []
    focus = None
    for me in g.j['meshes']:
        for pr in me['primitives']:
            V = g.acc(pr['attributes']['POSITION']).astype(np.float64)
            I = g.acc(pr['indices']).reshape(-1, 3).astype(np.int64)
            if me.get('name') == mesh_name:
                focus = len(prims)
            prims.append((V, I))
    V, I = prims[focus]
    N = g.acc(g.find_prim(mesh_name)[1]['attributes']['NORMAL']).astype(np.float64)
    if all_seen:
        vis = np.ones(len(I)); area = np.ones(len(I))
    else:
        vis, area = visibility(prims, focus)
    seen = vis > 0
    Is = I[seen]
    # 1. chart the seen triangles
    a1 = xatlas.Atlas()
    a1.add_mesh(V.astype(np.float32), Is.astype(np.uint32), N.astype(np.float32))
    po = xatlas.PackOptions(); po.resolution = size; po.padding = padding; po.bilinear = True; po.rotate_charts = True
    co = xatlas.ChartOptions()
    a1.generate(co, po)
    vm1, ix1, uv1 = a1[0]
    _, chart = a1.get_mesh_vertex_assignment(0)
    chart = chart.astype(np.int64)
    bad = chart == 4294967295
    if bad.any():                                  # vertices of degenerate faces: their own islands
        isl = islands(len(vm1), ix1)
        chart[bad] = chart[~bad].max() + 1 + isl[bad]
    _, lab = np.unique(chart, return_inverse=True)
    # 2. scale each chart by its visibility
    tri_vis = vis[seen]
    ta = uv_area(uv1, ix1)
    tri_lab = lab[ix1[:, 0]]
    nl = lab.max() + 1
    cv = np.bincount(tri_lab, tri_vis * area[seen], nl) / np.maximum(np.bincount(tri_lab, area[seen], nl), 1e-12)
    med = np.median(tri_vis)
    sc = np.sqrt(np.clip(cv / max(med, 1e-6), wmin ** 2, wmax ** 2))
    uvs = uv1.copy()
    P1 = V[vm1].copy()
    for k in range(nl):
        m = lab == k
        cen = uvs[m].mean(0)
        uvs[m] = cen + (uvs[m] - cen) * sc[k]
        c3 = P1[m].mean(0)
        P1[m] = c3 + (P1[m] - c3) * sc[k]          # xatlas packs input-UV charts by their 3D area: scale that too
    # 3. pack the scaled charts (xatlas, input UVs, brute-force placement); isotropic normalisation (xatlas divides
    #    u by the atlas width and v by its height, which would stretch texels when the atlas is not square)
    a2 = xatlas.Atlas()
    a2.add_mesh(P1.astype(np.float32), ix1.astype(np.uint32), N[vm1].astype(np.float32), uvs.astype(np.float32))
    co2 = xatlas.ChartOptions(); co2.use_input_mesh_uvs = True
    po2 = xatlas.PackOptions(); po2.resolution = size; po2.padding = padding; po2.bilinear = True; po2.rotate_charts = True
    po2.bruteForce = True
    a2.generate(co2, po2)
    vm2, ix2, uv2 = a2[0]
    if a2.atlas_count != 1:
        raise SystemExit('xatlas pack: %d atlases' % a2.atlas_count)
    ix2 = ix2.astype(np.int64)
    w, h = a2.width, a2.height
    uv2 = (uv2 * np.array([w, h], np.float32) / max(w, h)).astype(np.float32)
    vmap = vm1[vm2]
    s_before = np.bincount(lab[vm2[ix2[:, 0]]], uv_area(uvs[vm2], ix2), nl)
    s_after = np.bincount(lab[vm2[ix2[:, 0]]], uv_area(uv2, ix2), nl)
    okr = s_before > 1e-9
    ratio = s_after[okr] / s_before[okr]
    ratio = ratio / np.median(ratio)
    # 4. the unseen triangles: all three corners take the new UV of the seen vertex nearest the centroid
    unseen = np.where(~seen)[0]
    if len(unseen):
        from scipy.spatial import cKDTree
        kd = cKDTree(V[vmap])
        corners = I[unseen].reshape(-1)
        _, near = kd.query(V[I[unseen]].mean(1))       # one point per triangle: zero UV area
        add_vm = corners
        add_uv = np.repeat(uv2[near], 3, axis=0)
        base = len(vmap)
        vmap = np.concatenate([vmap, add_vm])
        uv2 = np.concatenate([uv2, add_uv])
        ix_un = (base + np.arange(len(corners))).reshape(-1, 3)
        ix2 = np.concatenate([ix2, ix_un])
    fill = float(uv_area(uv2, ix2).sum())
    stats = {'mesh': mesh_name, 'size': size, 'tris': int(len(I)), 'unseen_tris': int((~seen).sum()),
             'unseen_area_share': round(float(area[~seen].sum() / area.sum()), 4), 'charts': int(nl), 'fill': round(fill, 3),
             'verts_before': int(len(V)), 'verts_after': int(len(vmap)), 'scale_ratio_p5_p95': [round(float(np.percentile(ratio, 5)), 3), round(float(np.percentile(ratio, 95)), 3)],
             'chart_scale_range': [round(float(sc.min()), 2), round(float(sc.max()), 2)], 'seconds': round(time.time() - t0, 1)}
    return {'vmap': vmap.astype(np.int64), 'uv': uv2.astype(np.float32), 'idx': ix2.astype(np.int64), 'vis': vis}, stats


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('mesh'); ap.add_argument('size', type=int); ap.add_argument('out')
    ap.add_argument('--padding', type=int, default=6)
    ap.add_argument('--all-seen', action='store_true')
    a = ap.parse_args()
    g = Glb(a.src)
    r, st = repack(g, a.mesh, a.size, a.padding, all_seen=a.all_seen)
    np.savez_compressed(a.out, **r)
    print(json.dumps(st))
