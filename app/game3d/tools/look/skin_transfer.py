#!/usr/bin/env python3
"""skin_transfer.py <rigged.glb> <unrigged.glb> <out.glb>

Look-track test helper (realism 11 Nov 2026), not part of Forge: puts the skeleton, skin and clips of a
rigged character onto another build of the SAME character in the same pose that has the newer maps (normal
map, emissive, the forge_skin mask in the material's extras) but no rig. Each vertex of the unrigged mesh
takes the joints and weights of the nearest vertex of the rigged one (position, with a small penalty for
normals that disagree). Only good when the two meshes are the same shape to within a few millimetres.
Needs numpy."""
import json, struct, sys
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    return j, b[20 + n + 8:]


def acc(j, bin_, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    dt, nc = CT[a["componentType"]], NC[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0)
    if stride and stride != np.dtype(dt).itemsize * nc:
        raw = np.frombuffer(bin_, np.uint8, count=stride * a["count"], offset=off).reshape(a["count"], stride)
        return np.frombuffer(raw[:, :np.dtype(dt).itemsize * nc].tobytes(), dt).reshape(a["count"], nc)
    return np.frombuffer(bin_, dt, count=a["count"] * nc, offset=off).reshape(a["count"], nc)


def main():
    rig_p, new_p, out_p = sys.argv[1:4]
    rj, rb = read(rig_p)
    nj, nb = read(new_p)
    rp = rj["meshes"][0]["primitives"][0]
    np_ = nj["meshes"][0]["primitives"][0]
    r_pos, r_nrm = acc(rj, rb, rp["attributes"]["POSITION"]), acc(rj, rb, rp["attributes"]["NORMAL"]) if "NORMAL" in rp["attributes"] else None
    r_j, r_w = acc(rj, rb, rp["attributes"]["JOINTS_0"]), acc(rj, rb, rp["attributes"]["WEIGHTS_0"])
    n_pos = acc(nj, nb, np_["attributes"]["POSITION"])
    n_nrm = acc(nj, nb, np_["attributes"]["NORMAL"])
    n_uv = acc(nj, nb, np_["attributes"]["TEXCOORD_0"])
    n_idx = acc(nj, nb, np_["indices"]).astype(np.uint32)
    near = np.zeros(len(n_pos), np.int64)
    dist = np.zeros(len(n_pos))
    for i in range(0, len(n_pos), 1024):
        d = np.linalg.norm(n_pos[i:i + 1024, None, :] - r_pos[None], axis=-1)
        if r_nrm is not None:
            d = d + 0.02 * (1.0 - np.clip(n_nrm[i:i + 1024] @ r_nrm.T, -1, 1))
        near[i:i + 1024] = d.argmin(1)
        dist[i:i + 1024] = np.linalg.norm(n_pos[i:i + 1024] - r_pos[near[i:i + 1024]], axis=-1)
    print("nearest-vertex distance: median %.4f m, 95th %.4f m, max %.4f m" % (np.median(dist), np.percentile(dist, 95), dist.max()))
    joints, weights = r_j[near], r_w[near].astype(np.float32)

    # the output: the rigged file's nodes, skin and clips; the unrigged file's mesh, material and images
    out = bytearray()
    views, accessors = [], []

    def add_view(data, target=None):
        while len(out) % 4:
            out.append(0)
        v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data)}
        if target:
            v["target"] = target
        out.extend(data)
        views.append(v)
        return len(views) - 1

    def add_acc(arr, ctype, typ, target=None, minmax=False):
        a = {"bufferView": add_view(arr.tobytes(), target), "componentType": ctype, "count": len(arr), "type": typ}
        if minmax:
            a["min"], a["max"] = arr.min(0).tolist(), arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    def copy_acc(j, b, i):
        a = dict(j["accessors"][i])
        arr = acc(j, b, i)
        a.pop("byteOffset", None)
        a["bufferView"] = add_view(np.ascontiguousarray(arr).tobytes())
        accessors.append(a)
        return len(accessors) - 1

    prim = {"attributes": {"POSITION": add_acc(n_pos.astype(np.float32), 5126, "VEC3", 34962, True),
                           "NORMAL": add_acc(n_nrm.astype(np.float32), 5126, "VEC3", 34962),
                           "TEXCOORD_0": add_acc(n_uv.astype(np.float32), 5126, "VEC2", 34962),
                           "JOINTS_0": add_acc(joints.astype(np.uint16), 5123, "VEC4", 34962),
                           "WEIGHTS_0": add_acc(weights, 5126, "VEC4", 34962)},
            "indices": add_acc(n_idx.reshape(-1), 5125, "SCALAR", 34963), "material": 0}
    for s in rj.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = copy_acc(rj, rb, s["inverseBindMatrices"])
    for an in rj.get("animations", []):
        for sm in an["samplers"]:
            sm["input"], sm["output"] = copy_acc(rj, rb, sm["input"]), copy_acc(rj, rb, sm["output"])
    images = []
    for im in nj.get("images", []):
        bv = nj["bufferViews"][im["bufferView"]]
        im = dict(im)
        im["bufferView"] = add_view(nb[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])
        images.append(im)
    rj["meshes"] = [{"name": rj["meshes"][0].get("name", "geometry_0"), "primitives": [prim]}]
    for k in ("materials", "textures", "samplers"):
        if k in nj:
            rj[k] = nj[k]
    rj["images"] = images
    rj["accessors"], rj["bufferViews"] = accessors, views
    while len(out) % 4:
        out.append(0)
    rj["buffers"] = [{"byteLength": len(out)}]
    js = json.dumps(rj, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    with open(out_p, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(out)))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(out), b"BIN\x00") + bytes(out))
    print("wrote", out_p, 28 + len(js) + len(out), "bytes")


if __name__ == "__main__":
    main()
