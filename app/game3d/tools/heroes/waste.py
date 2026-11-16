"""fidelity-29: (1) how much of each hero's body atlas is spent on surfaces no game camera sees (inner shells, the
lifted head under the fitted head, faces inside the body); (2) how much real detail the shipped 2K maps carry
(loss when a map goes 2K -> 1K -> 2K, and the share of spectral energy above the 1K Nyquist)."""
import io, json, struct, sys
import numpy as np
from PIL import Image
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def load(p):
    d = open(p, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl]); b0 = 20 + jl + 8
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; o = b0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = a['count']; c = NC[a['type']]; dt = np.dtype(CT[a['componentType']]); st = bv.get('byteStride', 0)
        if st and st != dt.itemsize * c:
            return np.ndarray((n, c), dt, d, o, (st, dt.itemsize)).copy()
        return np.frombuffer(d, dt, n * c, o).reshape(n, c).copy()
    def img(ii):
        bv = j['bufferViews'][j['images'][ii]['bufferView']]; o = b0 + bv.get('byteOffset', 0)
        return Image.open(io.BytesIO(d[o:o + bv['byteLength']]))
    return j, acc, img

def fib_dirs(n):
    i = np.arange(n) + 0.5; phi = np.arccos(1 - 2 * i / n); th = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)

def visibility(prims, grid=448, npts=1_500_000, seed=0):
    rng = np.random.default_rng(seed)
    P = np.concatenate([p[0][p[1]].reshape(-1, 3, 3) for p in prims]); owner = np.concatenate([np.full(len(p[1]), k) for k, p in enumerate(prims)])
    e1, e2 = P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]; area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    cnt = rng.multinomial(npts, area / area.sum()) + 1                    # every triangle gets at least its centroid
    tid = np.repeat(np.arange(len(P)), cnt)
    u, v = rng.random(len(tid)), rng.random(len(tid)); f = u + v > 1; u[f], v[f] = 1 - u[f], 1 - v[f]
    u[np.r_[0, np.cumsum(cnt)[:-1]]] = 1 / 3; v[np.r_[0, np.cumsum(cnt)[:-1]]] = 1 / 3
    X = P[tid, 0] + u[:, None] * e1[tid] + v[:, None] * e2[tid]
    c = X.mean(0); R = np.linalg.norm(X - c, axis=1).max()
    seen = np.zeros(len(P), bool)
    D = fib_dirs(160)
    D = D[(D[:, 1] > np.sin(np.radians(-25))) & (D[:, 1] < np.sin(np.radians(70)))]   # the game's cameras: level to well above
    for dv in D:
        up = np.array([0, 1.0, 0]) if abs(dv[1]) < 0.95 else np.array([1.0, 0, 0])
        ax = np.cross(up, dv); ax /= np.linalg.norm(ax); ay = np.cross(dv, ax)
        Y = X - c
        px = ((Y @ ax / R + 1) * 0.5 * (grid - 1)).astype(np.int64); py = ((Y @ ay / R + 1) * 0.5 * (grid - 1)).astype(np.int64)
        depth = -(Y @ dv)                                                      # nearer the camera at +dv = smaller
        pix = py * grid + px
        o = np.lexsort((depth, pix)); first = np.r_[True, pix[o][1:] != pix[o][:-1]]
        vis_pts = o[first]
        # a sample is "seen" if it is the nearest in its pixel or within 4 mm of it (splat tolerance)
        dmin = np.full(grid * grid, np.inf); dmin[pix[vis_pts]] = depth[vis_pts]
        ok = depth <= dmin[pix] + 0.004
        seen[np.unique(tid[ok])] = True
    return seen, owner, area

out = []
for p in sys.argv[1:]:
    j, acc, img = load(p)
    prims = []; meta = []
    for me in j['meshes']:
        for pr in me['primitives']:
            V = acc(pr['attributes']['POSITION']).astype(np.float64); I = acc(pr['indices']).reshape(-1, 3).astype(np.int64)
            UV = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)
            prims.append((V, I)); meta.append((me.get('name'), j['materials'][pr['material']].get('name'), UV, pr['material']))
    seen, owner, area = visibility(prims)
    row = {'file': p.split('/')[-1], 'parts': []}
    for k, (mn, mat, UV, mi) in enumerate(meta):
        V, I = prims[k]; s = seen[owner == k]; a3 = area[owner == k]
        u = UV[I]; a2 = 0.5 * np.abs((u[:, 1, 0] - u[:, 0, 0]) * (u[:, 2, 1] - u[:, 0, 1]) - (u[:, 2, 0] - u[:, 0, 0]) * (u[:, 1, 1] - u[:, 0, 1]))
        row['parts'].append({'mesh': mn, 'material': mat, 'tris': int(len(I)), 'hidden_tri_share': round(float(1 - s.mean()), 3),
                             'hidden_area_share': round(float(a3[~s].sum() / a3.sum()), 3), 'hidden_uv_share': round(float(a2[~s].sum() / max(a2.sum(), 1e-12)), 3),
                             'uv_used': round(float(a2.sum()), 3)})
    # detail actually present in the 2K maps
    det = []
    for ii, im in enumerate(j['images']):
        I0 = img(ii).convert('RGB')
        if max(I0.size) < 2048:
            continue
        A = np.asarray(I0, np.float32) / 255
        B = np.asarray(I0.resize((I0.size[0] // 2, I0.size[1] // 2), Image.LANCZOS).resize(I0.size, Image.LANCZOS), np.float32) / 255
        g = A.mean(2); F = np.abs(np.fft.fftshift(np.fft.fft2(g - g.mean()))) ** 2
        h, w = g.shape; yy, xx = np.mgrid[-h // 2:h // 2, -w // 2:w // 2]; r = np.hypot(yy / h, xx / w)
        hi = float(F[r > 0.25].sum() / F[r > 0.01].sum())
        mse = float(((A - B) ** 2).mean())
        det.append({'image': im.get('name', ii), 'psnr_2k_vs_1k_up_db': round(10 * np.log10(1 / max(mse, 1e-12)), 1), 'energy_above_1k_nyquist': round(hi, 4)})
    row['detail'] = det
    out.append(row); print(json.dumps(row))
json.dump(out, open('waste.json', 'w'), indent=1)
