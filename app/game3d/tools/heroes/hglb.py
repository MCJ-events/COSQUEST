"""fid29 heromaps: a small GLB reader/writer for the hero files (numpy only). Edits keep everything they do not touch:
nodes, skins, inverse bind matrices, animations, morph targets, materials and extras stay byte-for-byte; a replaced
primitive gets new accessors appended, a replaced image a new buffer view, and the binary is compacted at write time."""
import io, json, struct
import numpy as np
from PIL import Image

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
CT_R = {np.dtype(v): k for k, v in CT.items()}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
NC_R = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'}


class Glb:
    def __init__(self, path):
        d = open(path, 'rb').read()
        jl = struct.unpack('<I', d[12:16])[0]
        self.j = json.loads(d[20:20 + jl])
        b0 = 20 + jl + 8
        bl = struct.unpack('<I', d[20 + jl:24 + jl])[0]
        self.bin = bytearray(d[b0:b0 + bl])
        self.path = path

    # ---- reading
    def view_bytes(self, vi):
        bv = self.j['bufferViews'][vi]
        o = bv.get('byteOffset', 0)
        return bytes(self.bin[o:o + bv['byteLength']])

    def acc(self, i):
        a = self.j['accessors'][i]
        if 'bufferView' not in a or 'sparse' in a:
            n, c, dt = a['count'], NC[a['type']], np.dtype(CT[a['componentType']])
            out = np.zeros((n, c), dt) if 'bufferView' not in a else self._dense(a)
            if 'sparse' in a:
                s = a['sparse']
                iv = self.j['bufferViews'][s['indices']['bufferView']]
                io_ = iv.get('byteOffset', 0) + s['indices'].get('byteOffset', 0)
                idx = np.frombuffer(self.bin, np.dtype(CT[s['indices']['componentType']]), s['count'], io_)
                vv = self.j['bufferViews'][s['values']['bufferView']]
                vo = vv.get('byteOffset', 0) + s['values'].get('byteOffset', 0)
                out[idx] = np.frombuffer(self.bin, dt, s['count'] * c, vo).reshape(-1, c)
            return out
        return self._dense(a)

    def _dense(self, a):
        bv = self.j['bufferViews'][a['bufferView']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n, c, dt = a['count'], NC[a['type']], np.dtype(CT[a['componentType']])
        st = bv.get('byteStride', 0)
        if st and st != dt.itemsize * c:
            out = np.ndarray((n, c), dt, self.bin, o, (st, dt.itemsize)).copy()
        else:
            out = np.frombuffer(self.bin, dt, n * c, o).reshape(n, c).copy()
        if a.get('normalized') and dt.kind in 'iu':
            pass   # callers that need floats convert themselves (weights stay as stored)
        return out

    def image(self, ii):
        return Image.open(io.BytesIO(self.view_bytes(self.j['images'][ii]['bufferView'])))

    def tex_source(self, tex_index):
        t = self.j['textures'][tex_index]
        return t.get('source', t.get('extensions', {}).get('KHR_texture_basisu', {}).get('source'))

    def find_prim(self, mesh_name):
        for mi, me in enumerate(self.j['meshes']):
            if me.get('name') == mesh_name:
                return mi, me['primitives'][0]
        raise KeyError(mesh_name)

    def prim_arrays(self, prim):
        out = {k: self.acc(v) for k, v in prim['attributes'].items()}
        out['indices'] = self.acc(prim['indices']).reshape(-1, 3).astype(np.int64)
        return out

    def material_maps(self, mat_index):
        m = self.j['materials'][mat_index]
        pb = m.get('pbrMetallicRoughness', {})
        out = {}
        for k, t in (('base', pb.get('baseColorTexture')), ('orm', pb.get('metallicRoughnessTexture')),
                     ('normal', m.get('normalTexture')), ('emissive', m.get('emissiveTexture')), ('occlusion', m.get('occlusionTexture'))):
            if t:
                out[k] = self.tex_source(t['index'])
        return out

    # ---- writing
    def _append(self, data, target=None):
        self.bin += b'\0' * ((4 - len(self.bin) % 4) % 4)
        bv = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            bv['target'] = target
        self.bin += data
        self.j['bufferViews'].append(bv)
        return len(self.j['bufferViews']) - 1

    def add_accessor(self, arr, normalized=False, minmax=False, target=34962):
        arr = np.ascontiguousarray(arr)
        n = arr.shape[0]
        c = 1 if arr.ndim == 1 else arr.shape[1]
        vi = self._append(arr.tobytes(), target)
        a = {'bufferView': vi, 'componentType': CT_R[arr.dtype], 'count': int(n), 'type': NC_R[c]}
        if normalized:
            a['normalized'] = True
        if minmax:
            flat = arr.reshape(n, c)
            a['min'] = [float(x) for x in flat.min(0)]
            a['max'] = [float(x) for x in flat.max(0)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def set_prim(self, prim, arrays):
        """Replace a primitive's vertex attributes and indices. `arrays` holds every attribute of the primitive
        (same names, same dtypes as before) plus 'indices' (T, 3)."""
        old = prim['attributes']
        new = {}
        for k in old:
            a0 = self.j['accessors'][old[k]]
            arr = np.asarray(arrays[k]).astype(CT[a0['componentType']])
            new[k] = self.add_accessor(arr, normalized=bool(a0.get('normalized')), minmax=(k == 'POSITION'))
        prim['attributes'] = new
        idx = np.asarray(arrays['indices']).reshape(-1).astype(np.uint32)
        prim['indices'] = self.add_accessor(idx, target=34963)

    def set_image(self, ii, img, fmt='PNG'):
        bio = io.BytesIO()
        img.save(bio, fmt, **({'compress_level': 6} if fmt == 'PNG' else {'quality': 95}))
        im = self.j['images'][ii]
        im['bufferView'] = self._append(bio.getvalue())
        im['mimeType'] = 'image/png' if fmt == 'PNG' else 'image/jpeg'

    def add_image(self, img, name=''):
        self.j['images'].append({'name': name, 'bufferView': 0, 'mimeType': 'image/png'})
        ii = len(self.j['images']) - 1
        self.set_image(ii, img)
        self.j.setdefault('textures', []).append({'source': ii, 'sampler': self.j['textures'][0].get('sampler', 0)} if self.j.get('textures') else {'source': ii})
        return len(self.j['textures']) - 1

    def save(self, path):
        # compact: keep only buffer views still referenced (accessors, images), in order
        used = set()
        for a in self.j['accessors']:
            if 'bufferView' in a:
                used.add(a['bufferView'])
        for im in self.j.get('images', []):
            used.add(im['bufferView'])
        # drop accessors nobody references? keep all (animations, skins reference theirs); only orphaned replaced ones
        ref_acc = set()
        for me in self.j['meshes']:
            for p in me['primitives']:
                ref_acc.update(p['attributes'].values()); ref_acc.add(p['indices'])
                for t in p.get('targets', []):
                    ref_acc.update(t.values())
        for s in self.j.get('skins', []):
            if 'inverseBindMatrices' in s:
                ref_acc.add(s['inverseBindMatrices'])
        for an in self.j.get('animations', []):
            for sm in an['samplers']:
                ref_acc.add(sm['input']); ref_acc.add(sm['output'])
        amap, accs = {}, []
        for i, a in enumerate(self.j['accessors']):
            if i in ref_acc:
                amap[i] = len(accs); accs.append(a)
        self.j['accessors'] = accs
        for me in self.j['meshes']:
            for p in me['primitives']:
                p['attributes'] = {k: amap[v] for k, v in p['attributes'].items()}
                p['indices'] = amap[p['indices']]
                for t in p.get('targets', []):
                    for k in list(t):
                        t[k] = amap[t[k]]
        for s in self.j.get('skins', []):
            if 'inverseBindMatrices' in s:
                s['inverseBindMatrices'] = amap[s['inverseBindMatrices']]
        for an in self.j.get('animations', []):
            for sm in an['samplers']:
                sm['input'] = amap[sm['input']]; sm['output'] = amap[sm['output']]
        sp = set()
        for a in accs:
            if 'sparse' in a:
                sp.add(a['sparse']['indices']['bufferView']); sp.add(a['sparse']['values']['bufferView'])
        used = sorted({a['bufferView'] for a in accs if 'bufferView' in a} | {im['bufferView'] for im in self.j.get('images', [])} | sp)
        vmap, views, nb = {}, [], bytearray()
        for vi in used:
            bv = dict(self.j['bufferViews'][vi])
            data = self.view_bytes(vi)
            nb += b'\0' * ((4 - len(nb) % 4) % 4)
            bv['byteOffset'] = len(nb); bv['byteLength'] = len(data)
            nb += data
            vmap[vi] = len(views); views.append(bv)
        self.j['bufferViews'] = views
        for a in accs:
            if 'bufferView' in a:
                a['bufferView'] = vmap[a['bufferView']]
            if 'sparse' in a:
                a['sparse']['indices']['bufferView'] = vmap[a['sparse']['indices']['bufferView']]
                a['sparse']['values']['bufferView'] = vmap[a['sparse']['values']['bufferView']]
        for im in self.j.get('images', []):
            im['bufferView'] = vmap[im['bufferView']]
        self.j['buffers'] = [{'byteLength': len(nb)}]
        self.bin = nb
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        b = bytes(nb) + b'\0' * ((4 - len(nb) % 4) % 4)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(b)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(b), 0x004E4942)); f.write(b)


def world_positions(g, mesh_name):
    """POSITION of a mesh in the GLB's rest frame (node transforms applied; skinned meshes in glTF ignore their node
    transform, so the raw positions are what the skin binds)."""
    mi, prim = g.find_prim(mesh_name)
    return g.acc(prim['attributes']['POSITION']).astype(np.float64)
