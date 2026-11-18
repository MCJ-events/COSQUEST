#!/usr/bin/env python3
"""fid29 blind judge for game frames (frozen after fid29-base; docs/game3d/fid29/COMMON.md gate C5). Runs on the Mac.

  judge29.py run pairs.csv --out result.jsonl [--q game|defect|face_sun] [--jobs 4] [--seed 1]
      pairs.csv: pair_id,new,old  (paths to JPEGs; tools/fid29/phone_jpeg.py makes 585x1266 judge copies)
  judge29.py report result.jsonl

Every picture is copied under its content hash (the model never sees a file name), the pairs are shuffled and every
pair is asked in both orders (Left/Right swapped). A side wins only when both orders name it. Each round mixes in
controls built from the pairs' old pictures: 10 % identical pairs (old against itself: must tie or split in >= 90 %)
and 10 % degraded pairs (old against old blurred sigma 1.5 and posterised to 6 bits: the degraded one must lose in
>= 90 %; for the defect question it must be named more flawed). A round that fails a control is VOID.
Questions and thresholds: judge.json beside this file. Answers are cached by (question, picture hashes, order).
Backend: headless `claude -p --model sonnet` (the logged-in CLI), Read tool only.
"""
from __future__ import annotations
import argparse, csv, hashlib, json, math, os, random, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "judge.json").read_text())
CACHE = Path(os.getenv("FID29_JUDGE_CACHE", Path.home() / "Desktop/cosquest-review/realism-20261111/judge/cache29"))
IMG = CACHE / "img"; ANS = CACHE / "answers.jsonl"
SYS = ("You are a careful visual judge of game screenshots. Read the picture files you are given, then answer only "
       "in the JSON format asked for, with no other text.")


def put(img: Image.Image) -> Path:
    img = img.convert("RGB")
    ls = int(CFG.get("image_long_side", 1266))
    if max(img.size) > ls:
        k = ls / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    import io
    b = io.BytesIO(); img.save(b, "JPEG", quality=92)
    h = hashlib.sha1(b.getvalue()).hexdigest()[:20]
    p = IMG / f"{h}.jpg"
    if not p.exists():
        p.write_bytes(b.getvalue())
    return p


def degrade(img: Image.Image) -> Image.Image:
    c = CFG["controls"]
    g = img.convert("RGB").filter(ImageFilter.GaussianBlur(float(c["degraded_blur_sigma"])))
    bits = int(c["degraded_posterise_bits"])
    from PIL import ImageOps
    return ImageOps.posterize(g, bits)


_cache: dict = {}


def load_cache():
    if ANS.exists():
        for line in ANS.read_text().splitlines():
            try:
                d = json.loads(line); _cache[d["key"]] = d
            except Exception:
                pass


def ask(q: str, left: Path, right: Path, model: str) -> dict:
    key = hashlib.sha1(f"{q}|{left.name}|{right.name}|{model}".encode()).hexdigest()
    if key in _cache:
        return _cache[key]
    prompt = (f"Read these two picture files, then answer.\nLeft: {left}\nRight: {right}\n"
              f"Both are screenshots from a mobile game. Question: {q}\n"
              "If the two are the same picture or you truly cannot tell, answer Tie.\n"
              'Reply with only JSON: {"winner":"Left"|"Right"|"Tie","reason":"under 20 words"}')
    cmd = ["claude", "-p", prompt, "--model", model, "--tools", "Read", "--allowedTools", "Read", "--strict-mcp-config",
           "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence", "--output-format", "json",
           "--add-dir", str(IMG), "--system-prompt", SYS]
    out = {"key": key, "q": q, "left": left.name, "right": right.name}
    for _ in range(3):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=240, cwd=str(IMG))
            d = json.loads(r.stdout)
            m = re.search(r"\{.*\}", d.get("result", ""), re.S)
            j = json.loads(m.group(0)) if m else {}
            w = str(j.get("winner", "")).strip().lower()
            if w in ("left", "right", "tie") and not d.get("is_error"):
                out.update(pick=w, reason=str(j.get("reason", ""))[:160], cost=d.get("total_cost_usd"))
                with ANS.open("a") as f:
                    f.write(json.dumps(out) + "\n")
                _cache[key] = out
                return out
        except Exception as e:  # noqa: BLE001
            out["error"] = repr(e)[:160]
        time.sleep(2)
    out.setdefault("error", "no answer")
    return out


def verdict(a1: dict, a2: dict) -> str:
    """a1: new Left / old Right; a2: old Left / new Right. Returns new | old | tie | split | error."""
    p1, p2 = a1.get("pick"), a2.get("pick")
    if p1 is None or p2 is None:
        return "error"
    n1 = {"left": "new", "right": "old", "tie": "tie"}[p1]
    n2 = {"left": "old", "right": "new", "tie": "tie"}[p2]
    return n1 if n1 == n2 else "split"


def cmd_run(a):
    IMG.mkdir(parents=True, exist_ok=True); load_cache()
    q = CFG["questions"].get(a.q, a.q)
    rows = [r for r in csv.reader(open(a.pairs)) if r and not r[0].startswith("#") and r[0] != "pair_id"]
    rng = random.Random(a.seed)
    items = []
    for pid, new, old in rows:
        items.append({"id": pid, "kind": "pair", "new": put(Image.open(new)), "old": put(Image.open(old))})
    c = CFG["controls"]
    olds = [r[2] for r in rows]
    for i in range(max(1, math.ceil(len(rows) * float(c["identical_share"])))):
        o = rng.choice(olds); p = put(Image.open(o))
        items.append({"id": f"ctl_same_{i}", "kind": "identical", "new": p, "old": p})
    for i in range(max(1, math.ceil(len(rows) * float(c["degraded_share"])))):
        o = rng.choice(olds); im = Image.open(o)
        # the degraded copy plays "new": for "game" it must lose (old wins), for "defect" it must be named more flawed (new)
        items.append({"id": f"ctl_degr_{i}", "kind": "degraded", "new": put(degrade(im)), "old": put(im)})
    rng.shuffle(items)
    jobs = []
    for it in items:
        jobs.append((it, it["new"], it["old"])); jobs.append((it, it["old"], it["new"]))
    rng.shuffle(jobs)
    with ThreadPoolExecutor(a.jobs) as ex:
        list(ex.map(lambda j: ask(q, j[1], j[2], a.model), jobs))
    res = []
    for it in items:
        v = verdict(ask(q, it["new"], it["old"], a.model), ask(q, it["old"], it["new"], a.model))
        res.append({"id": it["id"], "kind": it["kind"], "verdict": v, "q": a.q, "new": it["new"].name, "old": it["old"].name})
    with open(a.out, "w") as f:
        for r in res:
            f.write(json.dumps(r) + "\n")
    report(res, a.q)


def report(res, qname):
    c = CFG["controls"]
    pairs = [r for r in res if r["kind"] == "pair"]
    cnt = {k: sum(1 for r in pairs if r["verdict"] == k) for k in ("new", "old", "tie", "split", "error")}
    same = [r for r in res if r["kind"] == "identical"]
    degr = [r for r in res if r["kind"] == "degraded"]
    same_ok = sum(1 for r in same if r["verdict"] in ("tie", "split")) / max(1, len(same))
    want = "new" if qname == "defect" else "old"
    degr_ok = sum(1 for r in degr if r["verdict"] == want) / max(1, len(degr))
    void = same_ok < float(c["identical_must_tie_or_split"]) or degr_ok < float(c["degraded_must_lose"])
    print(json.dumps({"question": qname, "pairs": len(pairs), **cnt, "identical_ok": round(same_ok, 3),
                      "degraded_ok": round(degr_ok, 3), "void": void}))
    return void


def cmd_report(a):
    res = [json.loads(l) for l in open(a.jsonl)]
    report(res, res[0]["q"] if res else "game")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run"); p.add_argument("pairs"); p.add_argument("--out", required=True)
    p.add_argument("--q", default="game"); p.add_argument("--jobs", type=int, default=4); p.add_argument("--seed", type=int, default=1)
    p.add_argument("--model", default=CFG.get("model", "sonnet"))
    p = sub.add_parser("report"); p.add_argument("jsonl")
    a = ap.parse_args()
    {"run": cmd_run, "report": cmd_report}[a.cmd](a)
