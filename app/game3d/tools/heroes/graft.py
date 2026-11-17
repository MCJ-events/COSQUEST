"""fid29 heromaps: give a build 28 hero the curled MakeHuman (CC0) hands kept by forge-q2 (hands2.py --curl 1.0,
mm1 ~/cq-overflow/forge-q2/hm/out/<hero>_g10), without taking anything else from that older package.

The g10 files were made on the hero package before build 28's concept-toned heads and body tone, so only their hand
work is taken: the body's index buffer (the lifted hand triangles past the wrist cut deleted, the cut ring closed) and
the cut ring's vertex positions (forge-q2: "hands2 only rewrites the body's index buffer, the cut ring and the hands
mesh"), plus the "hands" mesh with its own material and maps, its colour matched to build 28's concept-toned head
(Lab median of the face skin). Build 28's head, hair, body maps, rig, weights, normals,
UVs and animations stay as they are. The body's vertex count is unchanged (deleted triangles leave their vertices in
the buffer), so the model AABB is build 28's; the rig is the same skeleton (hands2 skins the hand with the existing
hand bones).

usage: graft.py B28.glb G10.glb OUT.glb [--report r.json]
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hglb import Glb  # noqa: E402
from PIL import Image  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('b28'); ap.add_argument('g10'); ap.add_argument('out'); ap.add_argument('--report')
    a = ap.parse_args()
    B, G = Glb(a.b28), Glb(a.g10)
    names_b = [n.get('name') for n in B.j['nodes']]
    names_g = [n.get('name') for n in G.j['nodes']]
    # same skeleton, same joints order
    jb = [names_b[i] for i in B.j['skins'][0]['joints']]
    jg = [names_g[i] for i in G.j['skins'][0]['joints']]
    assert jb == jg, 'skeletons differ'
    # 1. body: g10's index buffer and cut-ring positions, everything else build 28's
    _, pb = B.find_prim('geometry_0')
    _, pg = G.find_prim('geometry_0')
    AB, AG = B.prim_arrays(pb), G.prim_arrays(pg)
    assert len(AB['POSITION']) == len(AG['POSITION']), 'body vertex count differs'
    for k in ('NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'):
        assert np.array_equal(AB[k], AG[k]), 'body %s differs' % k
    moved = np.abs(AB['POSITION'] - AG['POSITION']).max(1) > 0
    arrays = {k: AB[k] for k in pb['attributes']}
    arrays['POSITION'] = AG['POSITION']
    arrays['indices'] = AG['indices']
    B.set_prim(pb, arrays)
    # 2. the hands mesh, its material and maps
    hm = [m.get('name') for m in G.j['meshes']].index('hands')
    ph = G.j['meshes'][hm]['primitives'][0]
    AH = G.prim_arrays(ph)
    attrs = {}
    for k, ai in ph['attributes'].items():
        a0 = G.j['accessors'][ai]
        attrs[k] = B.add_accessor(np.ascontiguousarray(AH[k]), normalized=bool(a0.get('normalized')), minmax=(k == 'POSITION'))
    idx = B.add_accessor(AH['indices'].reshape(-1).astype(np.uint32), target=34963)
    mat = json.loads(json.dumps(G.j['materials'][ph['material']]))
    gm = G.material_maps(ph['material'])

    tone = {}
    h2 = os.path.join(os.path.dirname(a.g10), 'hands2.json')
    gloved = os.path.exists(h2) and int(json.load(open(h2)).get('args', {}).get('glove', 0)) == 1

    def skin_lab(g, prim_, img):
        """median Lab of the skin texels a primitive uses (luminance 20th to 80th percentile: no hair, brows, lips)"""
        import cv2
        from PIL import ImageDraw
        A_ = g.prim_arrays(prim_)
        m = Image.new('L', img.size, 0); d = ImageDraw.Draw(m)
        for t in A_['TEXCOORD_0'][A_['indices']] * np.array(img.size):
            d.polygon([tuple(x) for x in t], fill=255)
        a = np.asarray(img.convert('RGB'), np.float32) / 255
        lab = cv2.cvtColor(a, cv2.COLOR_RGB2LAB)[np.asarray(m) > 0]
        lo, hi = np.percentile(lab[:, 0], [20, 80])
        return np.median(lab[(lab[:, 0] >= lo) & (lab[:, 0] <= hi)], 0), np.asarray(m) > 0

    def retex(t, key):
        if t is None:
            return
        img = G.image(gm[key]).convert('RGB')
        if gloved:
            tone['skipped'] = 'gloved hands (hands2.json glove 1): colour kept'
        if key == 'base' and not gloved:
            # the hands were toned for forge-q2's older head: match them to build 28's concept-toned head (Lab median
            # of the face's skin; chroma fully, lightness at 85 %, so a hand keeps its own shading and nails)
            import cv2
            _, ph_head = B.find_prim('head_hybrid')
            hm_ = B.material_maps(ph_head['material'])
            head_lab, _ = skin_lab(B, ph_head, B.image(hm_['base']))
            hand_lab, hmask = skin_lab(G, ph, img)
            dl = head_lab - hand_lab
            dl[0] *= 0.85
            lab_ = cv2.cvtColor(np.asarray(img, np.float32) / 255, cv2.COLOR_RGB2LAB)
            lab_[hmask] += dl
            img = Image.fromarray((np.clip(cv2.cvtColor(lab_, cv2.COLOR_LAB2RGB), 0, 1) * 255 + 0.5).astype(np.uint8))
            tone.update(head_lab=[round(float(x), 2) for x in head_lab], hand_lab_before=[round(float(x), 2) for x in hand_lab],
                        shift=[round(float(x), 2) for x in dl])
        t['index'] = B.add_image(img, 'hands_' + key)
    pbr = mat.get('pbrMetallicRoughness', {})
    retex(pbr.get('baseColorTexture'), 'base')
    retex(pbr.get('metallicRoughnessTexture'), 'orm')
    retex(mat.get('normalTexture'), 'normal')
    retex(mat.get('emissiveTexture'), 'emissive')
    B.j['materials'].append(mat)
    prim = {'attributes': attrs, 'indices': idx, 'material': len(B.j['materials']) - 1}
    if 'mode' in ph:
        prim['mode'] = ph['mode']
    B.j['meshes'].append({'name': 'hands', 'primitives': [prim]})
    gn = G.j['nodes'][names_g.index('hands')]
    node = {k: v for k, v in gn.items() if k not in ('mesh', 'skin', 'children')}
    node['mesh'] = len(B.j['meshes']) - 1
    node['skin'] = 0
    B.j['nodes'].append(node)
    ni = len(B.j['nodes']) - 1
    # same parent as the body's node (or the scene root list)
    body_node = names_b.index('geometry_0')
    parent = None
    for i, n in enumerate(B.j['nodes']):
        if body_node in n.get('children', []):
            parent = i
    if parent is None:
        for sc in B.j['scenes']:
            if body_node in sc['nodes']:
                sc['nodes'].append(ni)
    else:
        B.j['nodes'][parent]['children'].append(ni)
    B.save(a.out)
    rep = {'b28': os.path.basename(a.b28), 'g10': a.g10, 'body_tris_b28': int(len(AB['indices'])),
           'body_tris_new': int(len(AG['indices'])), 'cut_ring_vertices_moved': int(moved.sum()),
           'hands_tris': int(len(AH['indices'])), 'hands_maps': sorted(gm), 'hand_tone': tone}
    if a.report:
        json.dump(rep, open(a.report, 'w'), indent=1)
    print(json.dumps(rep))


if __name__ == '__main__':
    main()
