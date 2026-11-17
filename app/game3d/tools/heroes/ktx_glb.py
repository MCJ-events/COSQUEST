"""fid29 heromaps: rewrite a hero GLB's embedded maps as KTX2 inside the GLB (KHR_texture_basisu), the form Godot 4.5.1's
GLTFDocument loads at runtime (Image.load_ktx_from_buffer). Meshes, skins, morph targets, animations and material
factors are left as they are; only the image buffer views, their mime types and the texture references change.

Formats, chosen around two traps in Godot 4.5.1's texture_loader_ktx.cpp (Basis data tagged sRGB is transcoded to
uncompressed RGBA32; ASTC tagged UNORM is mapped to the HDR ASTC formats GLES phones cannot sample):
  role        default block              tag     note
  normal      ASTC 4x4 + Zstd 19         sRGB    renormalised mips
  face        ASTC 4x4 + Zstd 19         sRGB    head and hand colour (cq_surface skin), gamma-correct mips
  body        Basis ETC1S                linear  body base colour (transcoded to ETC2 RGB on phones); --body astc4 = 4x4
  orm         ASTC 8x8 + Zstd 19         sRGB    head ORM capped at 1K; Toksvig: normal variance of each mip into roughness
  hair        ASTC 4x4 RGBA + Zstd 19    sRGB    alpha coverage of the cut-off kept per mip
  emissive    ASTC 4x4 + Zstd 19         sRGB    a near-empty emissive (max < 8/255 or < 0.1 % lit) drops to 256
GLES3 samples every format raw and converts colour in the shader, so the sRGB tag on data maps changes nothing there.

usage: ktx_glb.py IN.glb OUT.glb [--body etc1s|astc4] [--quality medium|thorough] [--report out.json]
needs: numpy, Pillow; toktx from KTX-Software 4.4.2 (Apache-2.0) in $TOKTX or bin/ beside the lane.
"""
import argparse, io, json, os, struct, subprocess, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TOKTX = os.environ.get("TOKTX", os.path.expanduser("~/realism-20261111/fid29/heromaps/bin/KTX-Software-4.4.2-Linux-x86_64/bin/toktx"))
ALPHA_CUT = 0.35          # char_real's hair scissor (alpha_scissor_threshold of the hair material)
HEAD_NORMAL_MAX = int(os.environ.get('HEAD_NORMAL_MAX', '1536'))
HEAD_COLOUR_MAX = int(os.environ.get('HEAD_COLOUR_MAX', '0'))
BODY_NORMAL_MAX = int(os.environ.get('BODY_NORMAL_MAX', '0'))     # 0 = keep; the last disk-cap step (renormalised)     # 0 = keep; the lane steps a hero's face colour to 1536 only to meet the disk cap


def read_glb(p):
    d = open(p, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    b0 = 20 + jl + 8
    bl = struct.unpack('<I', d[20 + jl:24 + jl])[0]
    return j, d[b0:b0 + bl]


def write_glb(p, j, b):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    b = bytes(b) + b'\0' * ((4 - len(b) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(b)
    with open(p, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(b), 0x004E4942)); f.write(b)


def s2l(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def l2s(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def half(a):
    """2x2 box down (odd edges dropped, as GL mip sizes floor)."""
    h, w = max(a.shape[0] // 2, 1), max(a.shape[1] // 2, 1)
    if a.shape[0] == 1:
        a = np.repeat(a, 2, 0)
    if a.shape[1] == 1:
        a = np.repeat(a, 2, 1)
    return a[:h * 2, :w * 2].reshape(h, 2, w, 2, a.shape[2]).mean((1, 3))


def coverage_scale(alpha, target):
    """The scale s for which mean(alpha * s > cut) matches the base level's coverage (binary search)."""
    lo, hi = 0.25, 8.0
    for _ in range(18):
        m = (lo + hi) / 2
        if ((alpha * m) > ALPHA_CUT).mean() < target:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


PLAIN = os.environ.get('KTX_PLAIN_MIPS', '0') == '1'   # build 28's runtime mips (box in stored values): the compression-only pass


def mip_chain(a, role):
    """Full chain to 1x1, float32 0..1, per role: colour in linear light, normals renormalised, alpha coverage kept.
    KTX_PLAIN_MIPS=1: box filter in stored values for every role, as Godot's generate_mipmaps does at load in build 28."""
    out = [a]
    cov = (a[..., 3] > ALPHA_CUT).mean() if a.shape[2] == 4 and not PLAIN else None
    lin = s2l(a[..., :3]) if role in ('face', 'body', 'hair', 'emissive') and not PLAIN else None
    cur, curlin = a, lin
    while cur.shape[0] > 1 or cur.shape[1] > 1:
        nxt = half(cur)
        if role == 'normal' and not PLAIN:
            n = nxt[..., :3] * 2 - 1
            n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
            nxt[..., :3] = n * 0.5 + 0.5
        if curlin is not None:
            curlin = half(curlin)
            nxt[..., :3] = l2s(curlin)
        if cov is not None and cov > 0:
            s = coverage_scale(nxt[..., 3], cov)
            nxt[..., 3] = np.clip(nxt[..., 3] * s, 0, 1)
        out.append(nxt)
        cur = nxt
    return out


def toksvig(orm_levels, normal_img):
    """Fold the normal map's lost variance into each ORM mip's roughness (G). Level 0 is left as it is (there the normal
    map itself carries the detail). For level k at size S: mean of the unit normals over each texel's footprint -> |Na|,
    variance s2 = (1 - |Na|) / |Na|, GGX alpha'^2 = alpha^2 + 2 s2 with alpha = roughness^2 (Godot's convention)."""
    n = np.asarray(normal_img.convert('RGB'), np.float32) / 255 * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    out = [orm_levels[0]]
    for lv in orm_levels[1:]:
        h, w = lv.shape[:2]
        if h < 1 or w < 1:
            out.append(lv); continue
        fy, fx = n.shape[0] // h, n.shape[1] // w
        if fy < 2 or fx < 2:
            out.append(lv); continue
        na = n[:h * fy, :w * fx].reshape(h, fy, w, fx, 3).mean((1, 3))
        ln = np.clip(np.linalg.norm(na, axis=-1), 1e-3, 1.0)
        var = (1 - ln) / ln
        r = np.clip(lv[..., 1], 0.02, 1.0)
        a2 = np.clip(r ** 4 + 2 * var, 0, 1)
        lv = lv.copy(); lv[..., 1] = a2 ** 0.25
        out.append(lv)
    return out


def encode(levels, role, blk, quality, tmp, tag):
    files = []
    for i, m in enumerate(levels):
        fp = os.path.join(tmp, f'{tag}_l{i}.png')
        Image.fromarray(np.clip(m * 255 + 0.5, 0, 255).astype(np.uint8)).save(fp)
        files.append(fp)
    out = os.path.join(tmp, f'{tag}.ktx2')
    rgba = levels[0].shape[2] == 4
    if blk == 'etc1s':
        cmd = [TOKTX, '--t2', '--encode', 'etc1s', '--clevel', '5', '--qlevel', '255', '--mipmap', '--assign_oetf', 'linear',
               '--target_type', 'RGBA' if rgba else 'RGB']
    else:
        cmd = [TOKTX, '--t2', '--encode', 'astc', '--astc_blk_d', blk, '--astc_quality', quality, '--mipmap',
               '--assign_oetf', 'srgb', '--target_type', 'RGBA' if rgba else 'RGB', '--zcmp', '19']
        if role in ('face', 'body', 'hair', 'emissive'):
            cmd.append('--astc_perceptual')
    r = subprocess.run(cmd + [out] + files, capture_output=True)
    if r.returncode != 0:
        raise SystemExit('toktx failed: %s' % r.stderr.decode()[-400:])
    return open(out, 'rb').read()


def gpu_bytes(w, h, levels, blk):
    bw, bh, bpb = (4, 4, 8) if blk == 'etc1s' else (int(blk.split('x')[0]), int(blk.split('x')[1]), 16)
    return sum(((max(w >> l, 1) + bw - 1) // bw) * ((max(h >> l, 1) + bh - 1) // bh) * bpb for l in range(levels))


def roles(j):
    """image index -> (role, normal image index of the same material or None)."""
    out = {}
    for m in j.get('materials', []):
        ex = m.get('extras', {}) or {}
        surf = str(ex.get('cq_surface', ''))
        pb = m.get('pbrMetallicRoughness', {})
        src = lambda t: j['textures'][t['index']].get('source', j['textures'][t['index']].get('extensions', {}).get('KHR_texture_basisu', {}).get('source'))
        nrm = src(m['normalTexture']) if m.get('normalTexture') else None
        bc = pb.get('baseColorTexture')
        if bc:
            r = 'hair' if surf == 'hair' or m.get('alphaMode') in ('MASK', 'BLEND') else ('face' if surf in ('skin',) else 'body')
            out.setdefault(src(bc), (r, None))
        for key in (pb.get('metallicRoughnessTexture'), m.get('occlusionTexture')):
            if key:
                out.setdefault(src(key), ('orm_head' if surf == 'skin' else 'orm', nrm))
        if nrm is not None:
            out.setdefault(nrm, ('normal_skin' if surf == 'skin' else 'normal', None))
        if m.get('emissiveTexture'):
            out.setdefault(src(m['emissiveTexture']), ('emissive', None))
    return out


def convert(src, dst, body='etc1s', quality='medium', report=None, max_size=0):
    j, b = read_glb(src)
    views = j['bufferViews']
    rl = roles(j)
    imgs = {}
    for ii, im in enumerate(j['images']):
        bv = views[im['bufferView']]
        raw = b[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        img = Image.open(io.BytesIO(raw)); img.load()
        imgs[ii] = img
    repl, rows = {}, []
    with tempfile.TemporaryDirectory() as tmp:
        for ii, im in enumerate(j['images']):
            img = imgs[ii]
            role, nrm_i = rl.get(ii, ('face', None))
            has_a = img.mode in ('RGBA', 'LA', 'PA') or 'transparency' in img.info
            if role == 'hair' or (has_a and role != 'normal'):
                img = img.convert('RGBA')
            else:
                img = img.convert('RGB')
            if max_size and max(img.size) > max_size:
                img = img.resize((min(img.size[0], max_size), min(img.size[1], max_size)), Image.LANCZOS)
            note = ''
            if role == 'orm_head' and max(img.size) > 1024 and not PLAIN:
                img = img.resize((1024, 1024), Image.BOX); note = 'head ORM to 1K'
            if role == 'normal_skin' and max(img.size) > HEAD_NORMAL_MAX and not PLAIN:
                # the fitted head's normal holds little above 1.5K (2K vs 1K-up: 44 to 51 dB, characters.md waste.json)
                a_ = np.asarray(img.resize((HEAD_NORMAL_MAX, HEAD_NORMAL_MAX), Image.LANCZOS), np.float32) / 255 * 2 - 1
                a_ /= np.maximum(np.linalg.norm(a_, axis=2, keepdims=True), 1e-6)
                img = Image.fromarray(((a_ * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8)); note = 'head normal to %d' % HEAD_NORMAL_MAX
            if role == 'face' and HEAD_COLOUR_MAX and max(img.size) > HEAD_COLOUR_MAX and not PLAIN:
                img = img.resize((HEAD_COLOUR_MAX, HEAD_COLOUR_MAX), Image.LANCZOS); note = 'face colour to %d (disk cap)' % HEAD_COLOUR_MAX
            if role == 'normal' and BODY_NORMAL_MAX and max(img.size) > BODY_NORMAL_MAX and not PLAIN:
                a_ = np.asarray(img.resize((BODY_NORMAL_MAX, BODY_NORMAL_MAX), Image.LANCZOS), np.float32) / 255 * 2 - 1
                a_ /= np.maximum(np.linalg.norm(a_, axis=2, keepdims=True), 1e-6)
                img = Image.fromarray(((a_ * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8)); note = 'body normal to %d (disk cap)' % BODY_NORMAL_MAX
            if role == 'emissive' and not PLAIN:
                a = np.asarray(img, np.float32)
                if max(img.size) > 256 and (a.max() < 8 or (a.max(2) > 8).mean() < 0.001):
                    img = img.resize((256, 256), Image.BOX); note = 'near-empty emissive to 256 (max %d)' % a.max()
            a = np.asarray(img, np.float32) / 255
            rr = 'orm' if role == 'orm_head' else ('normal' if role == 'normal_skin' else role)
            lv = mip_chain(a, rr)
            if rr == 'orm' and nrm_i is not None and not PLAIN:
                lv = toksvig(lv, imgs[nrm_i]); note = (note + '; ' if note else '') + 'Toksvig from image %d' % nrm_i
            blk = {'normal': '4x4', 'face': '4x4', 'hair': '4x4', 'emissive': '4x4', 'orm': '8x8' if min(img.size) >= 1024 else '4x4',
                   'body': ('etc1s' if body == 'etc1s' else '4x4')}[rr]
            if blk == 'etc1s' and img.mode == 'RGBA':
                blk = '4x4'
            data = encode(lv, rr, blk, quality, tmp, 'i%d' % ii)
            repl[im['bufferView']] = data
            im['mimeType'] = 'image/ktx2'
            rows.append({'image': ii, 'role': role, 'size': list(img.size), 'block': blk, 'levels': len(lv),
                         'kb_before': round(views[im['bufferView']]['byteLength'] / 1024), 'kb_after': round(len(data) / 1024),
                         'gpu_mib': round(gpu_bytes(img.size[0], img.size[1], len(lv), blk) / 1048576, 3), 'note': note})
    nb = bytearray()
    for i, bv in enumerate(views):
        data = repl.get(i)
        if data is None:
            data = b[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        nb += b'\0' * ((4 - len(nb) % 4) % 4)
        bv['byteOffset'] = len(nb); bv['byteLength'] = len(data)
        nb += data
    j['buffers'][0]['byteLength'] = len(nb)
    for t in j.get('textures', []):
        if 'source' in t:
            t['extensions'] = {**t.get('extensions', {}), 'KHR_texture_basisu': {'source': t.pop('source')}}
    for key in ('extensionsUsed', 'extensionsRequired'):
        j[key] = sorted(set(j.get(key, [])) | {'KHR_texture_basisu'})
    write_glb(dst, j, bytes(nb))
    res = {'src': os.path.basename(src), 'dst': os.path.basename(dst), 'src_mib': round(os.path.getsize(src) / 1048576, 3),
           'dst_mib': round(os.path.getsize(dst) / 1048576, 3), 'gpu_mib': round(sum(r['gpu_mib'] for r in rows), 2), 'images': rows}
    if report:
        json.dump(res, open(report, 'w'), indent=1)
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--body', default='etc1s', choices=['etc1s', 'astc4'])
    ap.add_argument('--quality', default='medium')
    ap.add_argument('--max', type=int, default=0)
    ap.add_argument('--report', default=None)
    a = ap.parse_args()
    r = convert(a.src, a.dst, a.body, a.quality, a.report, a.max)
    print(json.dumps({k: v for k, v in r.items() if k != 'images'}))
