import json, sys
for n in ["high_street", "mid_street", "low_street", "high_place", "mid_place", "low_place"]:
    d = json.load(open("dumps/%s.json" % n)); m = d["monitors"]; v = d["viewport"]; L = d["lights"][0] if d["lights"] else {}
    g = d["groups"]
    gs = lambda pref: sum(x["tris"] for k, x in g.items() if k.startswith(pref) and k.endswith("view"))
    tb = d["textures_by_group"]
    ft = sum(x["mb"] for k, x in tb.items() if k.startswith("fighter")); wt = sum(x["mb"] for k, x in tb.items() if not k.startswith("fighter"))
    cars = sum(it["tris"] for it in d["top_in_view"] if "cars_" in it["path"])
    props = sum(it["tris"] for it in d["top_in_view"] if "props_" in it["path"])
    bld = sum(it["tris"] for it in d["top_in_view"] if "buildings_" in it["path"])
    print("%s: draws %d prims %d objects %d tex_mon %.0f vmem %.0f | scale %.2f msaa %d pitch %.0f fov %.0f | shadow %s %s | in-view tris fighters %d world %d (cars %d props %d buildings %d) fx %d | tex fighters %.0f MB, rest %.0f MB (counted %.0f) | lut %s" % (
        n, m["draws"], m["prims"], m["objects"], m["tex_mb"], m["vmem_mb"], v["scale"], v["msaa_3d"], v["cam_pitch_deg"], v["cam_fov"],
        L.get("shadow"), L.get("max_dist"), gs("fighter:"), gs("Arena"), cars, props, bld, gs("Fx"), ft, wt, d["textures_total_mb"], d["environment"]["lut"]))
    if n in ("mid_street", "low_street", "high_place"):
        for k, x in sorted(tb.items(), key=lambda kv: -kv[1]["mb"])[:6]: print("     tex", k, "%.1f MB" % x["mb"], x["n"])
