#!/usr/bin/env python3
"""fight-look-31 (19 Nov 2026): the Courier's neck. Its head was textured by projecting the concept onto an auto-unwrapped
mesh, so the neck (seen side-on by the projection) took long vertical smears of the jaw and collar: a stretched, streaky
neck in every close shot (also why the build 29 turntable was held back). This repaints the neck in the head's own
texture: every head triangle below NECK_TOP (bind pose, model metres) is filled in UV space with the face's own skin
colour (the median of the cheeks), a little darker towards the collar, blended into the old texels over FADE metres
under NECK_TOP so the jaw keeps its edge. Only the head texture's bytes change; the mesh, UVs, rig and every other
image are untouched, and the file is rewritten with the same layout.

  python3 tools/char/neck_fix.py cast/heroes/forge_courier_lod0.glb [more.glb ...]

Idempotent enough to re-run (it repaints the same triangles with the same colour). numpy + Pillow."""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

NECK_TOP = 1.585     # m: the jaw line at the front of the Courier's neck (the head mesh starts at 1.47)
FADE = 0.03          # m of blend under NECK_TOP
CHEEK = (1.63, 1.70)  # m: where the skin colour is read (front of the face)
JPEG_Q = 92

CT = {5126: (np.float32, 4), 5123: (np.uint16, 2), 5125: (np.uint32, 4), 5121: (np.uint8, 1)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def load(path):
    b = open(path, "rb").read()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack("<I", b[off:off + 4])[0]
    return j, bytearray(b[off + 8:off + 8 + bl])


def save(path, j, binb):
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    binb = bytes(binb) + b"\0" * ((4 - len(binb) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(binb), 0x004E4942) + binb
    open(path, "wb").write(out)


def read(j, binb, ai):
    a = j["accessors"][ai]
    v = j["bufferViews"][a["bufferView"]]
    n = NC[a["type"]]
    dt, sz = CT[a["componentType"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", 0) or n * sz
    raw = np.frombuffer(bytes(binb[off:off + stride * (a["count"] - 1) + n * sz]), dtype=np.uint8)
    if stride == n * sz:
        return np.frombuffer(raw.tobytes(), dtype=dt).reshape(-1, n)
    rows = np.stack([raw[i * stride:i * stride + n * sz] for i in range(a["count"])])
    return np.frombuffer(rows.tobytes(), dtype=dt).reshape(-1, n)


def replace_view(j, binb, vi, data):
    """Swaps bufferView vi's bytes for `data`, shifting every later view (4-byte aligned)."""
    v = j["bufferViews"][vi]
    start = v.get("byteOffset", 0)
    old = v["byteLength"]
    pad_old = (4 - old % 4) % 4
    pad_new = (4 - len(data) % 4) % 4
    delta = (len(data) + pad_new) - (old + pad_old)
    binb[start:start + old + pad_old] = data + b"\0" * pad_new
    v["byteLength"] = len(data)
    for o in j["bufferViews"]:
        if o is not v and o.get("byteOffset", 0) > start:
            o["byteOffset"] = o.get("byteOffset", 0) + delta
    j["buffers"][0]["byteLength"] = len(binb)


def fix(path):
    j, binb = load(path)
    head = next((m for m in j["meshes"] if m.get("name") == "head"), None)
    if head is None:
        print(path, "no head mesh")
        return
    p = head["primitives"][0]
    pos = read(j, binb, p["attributes"]["POSITION"])
    uv = read(j, binb, p["attributes"]["TEXCOORD_0"])
    idx = read(j, binb, p["indices"]).reshape(-1, 3)
    mat = j["materials"][p["material"]]
    tex = j["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    img_i = j["images"][tex["source"]]
    vi = img_i["bufferView"]
    v = j["bufferViews"][vi]
    img = Image.open(io.BytesIO(bytes(binb[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]))).convert("RGB")
    w, h = img.size
    a = np.asarray(img).astype(np.float32)
    # the cheeks' skin: front-facing head vertices in the cheek band, their texels' median
    ys = pos[:, 1]
    front = (ys > CHEEK[0]) & (ys < CHEEK[1]) & (pos[:, 2] > np.percentile(pos[:, 2], 70))
    px = np.clip((uv[front, 0] % 1.0) * w, 0, w - 1).astype(int)
    py = np.clip((uv[front, 1] % 1.0) * h, 0, h - 1).astype(int)
    samp = a[py, px]
    lum = samp @ np.array([0.2126, 0.7152, 0.0722])
    keep = (lum > np.percentile(lum, 50)) & (lum < np.percentile(lum, 92)) & (samp[:, 0] > samp[:, 2])
    skin = np.median(samp[keep], axis=0)
    # the neck mask (per texel weight) and a darkening towards the collar, drawn triangle by triangle in UV space
    mask = Image.new("L", (w, h), 0)
    shade = Image.new("L", (w, h), 0)
    dm, ds = ImageDraw.Draw(mask), ImageDraw.Draw(shade)
    lo = ys.min()
    n = 0
    for t in idx:
        ty = ys[t]
        if ty.max() >= NECK_TOP:
            continue
        poly = [(float(uv[k, 0] % 1.0) * w, float(uv[k, 1] % 1.0) * h) for k in t]
        if max(abs(poly[0][0] - poly[1][0]), abs(poly[1][0] - poly[2][0])) > w * 0.25:
            continue    # a triangle across the seam of the wrap
        wt = int(255 * min(1.0, (NECK_TOP - ty.max()) / FADE))
        dm.polygon(poly, fill=wt)
        ds.polygon(poly, fill=int(255 * np.clip((NECK_TOP - ty.mean()) / max(NECK_TOP - lo, 0.01), 0.0, 1.0)))
        n += 1
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    m = np.asarray(mask).astype(np.float32)[..., None] / 255.0
    sh = np.asarray(shade.filter(ImageFilter.MaxFilter(3))).astype(np.float32)[..., None] / 255.0
    # the fill: the skin, darker towards the collar, with a faint grain so it is not a flat plastic patch
    rng = np.random.default_rng(7)
    grain = Image.fromarray((rng.normal(128, 18, (h // 4, w // 4))).clip(0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    g = (np.asarray(grain).astype(np.float32)[..., None] - 128.0) / 128.0
    fill = skin[None, None, :] * (1.0 - 0.12 * sh) * (1.0 + 0.04 * g)
    out = a * (1.0 - m) + fill * m
    buf = io.BytesIO()
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(buf, "JPEG", quality=JPEG_Q, subsampling=0)
    img_i["mimeType"] = "image/jpeg"
    replace_view(j, binb, vi, buf.getvalue())
    save(path, j, binb)
    print(path, "neck triangles", n, "skin", skin.round(1).tolist())


if __name__ == "__main__":
    for f in sys.argv[1:]:
        fix(f)
