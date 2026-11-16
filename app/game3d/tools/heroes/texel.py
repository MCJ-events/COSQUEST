"""fidelity-29: texels per metre of each material of a hero GLB, at the game's scale (fighter.gd HEIGHT 2.3 m).
usage: python3 texel.py FILE.glb [...]   (numpy only; light enough for the Mac)
Compare with screen pixels per metre: H_px / (2 * d * tan(fov / 2)); fov 56 deg vertical, d = 2.0 m in the intro
beat, 4.4 m in the victory shot, 5.4 m at the fight camera (fight.gd)."""
import json, struct, sys
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(p):
    d = open(p, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    b0 = 20 + jl + 8

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        o = b0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n, c, dt = a['count'], NC[a['type']], np.dtype(CT[a['componentType']])
        st = bv.get('byteStride', 0)
        if st and st != dt.itemsize * c:
            return np.ndarray((n, c), dt, d, o, (st, dt.itemsize)).copy()
        return np.frombuffer(d, dt, n * c, o).reshape(n, c).copy()

    def imsize(ii):
        bv = j['bufferViews'][j['images'][ii]['bufferView']]
        o = b0 + bv.get('byteOffset', 0)
        b = d[o:o + bv['byteLength']]
        if b[:4] == b'\x89PNG':
            return struct.unpack('>II', b[16:24])
        i = 2
        while i < len(b):
            if b[i] != 0xFF:
                i += 1
                continue
            m = b[i + 1]
            if m in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack('>HH', b[i + 5:i + 9])
                return (w, h)
            i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
        return (0, 0)
    return j, acc, imsize


for p in sys.argv[1:]:
    j, acc, imsize = load(p)
    rows, allP = [], []
    for me in j['meshes']:
        for pr in me['primitives']:
            P = acc(pr['attributes']['POSITION']).astype(np.float64)
            UV = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)
            I = acc(pr['indices']).reshape(-1, 3).astype(np.int64)
            allP.append(P)
            m = j['materials'][pr['material']]
            bt = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            w, h = imsize(j['textures'][bt['index']]['source']) if bt else (0, 0)
            rows.append((me.get('name'), m.get('name'), w, h, P, I, UV))
    PP = np.concatenate(allP)
    k = 2.3 / (PP[:, 1].max() - PP[:, 1].min())
    print('==', p.split('/')[-1], 'game scale %.3f' % k)
    for name, mat, w, h, P, I, UV in rows:
        a3 = 0.5 * np.linalg.norm(np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]]), axis=1) * k * k
        u = UV[I]
        a2 = 0.5 * np.abs((u[:, 1, 0] - u[:, 0, 0]) * (u[:, 2, 1] - u[:, 0, 1]) - (u[:, 2, 0] - u[:, 0, 0]) * (u[:, 1, 1] - u[:, 0, 1]))
        ok = a3 > 0
        td = np.sqrt(a2[ok] * w * h / a3[ok])
        o = np.argsort(td)
        cw = np.cumsum(a3[ok][o]) / a3[ok].sum()
        print('  %-12s %-12s %4dx%-4d world %.2f m2  uv used %.2f  texels/m mean %.0f median %.0f' % (
            name, mat, w, h, a3.sum(), a2.sum(), np.sqrt(a2.sum() * w * h / a3.sum()), td[o][np.searchsorted(cw, 0.5)]))
        if mat == 'head_hybrid':
            n = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
            n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
            f = (n[:, 2] > 0.6) & ok
            print('     face, front-facing: texels/m median %.0f' % np.median(np.sqrt(a2[f] * w * h / a3[f])))
