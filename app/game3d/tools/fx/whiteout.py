#!/usr/bin/env python3
"""fid29 combat: how much of the struck Guardian a hit's effects white out, on game-camera stills.

  python3 whiteout.py <frames dir> [prefix ...]

For each mid-fight still taken with look_shots.gd's "skin_view" (the frame, then the same paused moment with one
fighter white and the others black, `_id_enemy1` / `_id_enemy0`), the Guardian's mask is where those two differ;
the measure is the share of its mask pixels whose luma (Rec. 709) in the game frame (effects on, HUD off) is at
or above 0.95. Also prints the same share without effects (`_nofx`: what the light alone does) and the share of
the frame the effects change by more than 0.1 luma inside the mask.

On the phone path the tonemapper's white lands near 0.86 luma, so nothing reaches 0.95 and that share is 0 % on b28p
too (a gate that cannot fail). The gate this lane reports is therefore relative to the frame's own white: `white_rel`
= the share of mask pixels at or above 0.95 x the frame's white (the 99.9th percentile of the whole frame's luma), and
`raised` = the share the effects lift by more than 0.25 luma over the no-effects frame (washed out, not only bright).
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image


def luma(p):
    a = np.asarray(Image.open(p).convert("RGB")).astype(np.float32) / 255.0
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def measure(d, prefix):
    game = os.path.join(d, prefix + "_mid_game.png")
    m1 = os.path.join(d, prefix + "_mid_game_id_enemy1.png")
    m0 = os.path.join(d, prefix + "_mid_game_id_enemy0.png")
    nofx = os.path.join(d, prefix + "_mid_game_nofx.png")
    if not (os.path.exists(game) and os.path.exists(m1) and os.path.exists(m0)):
        return None
    a = np.asarray(Image.open(m1).convert("L")).astype(np.int16)
    b = np.asarray(Image.open(m0).convert("L")).astype(np.int16)
    mask = (a - b) > 40
    n = int(mask.sum())
    if n == 0:
        return {"prefix": prefix, "mask_px": 0}
    g = luma(game)
    white = float(np.percentile(g, 99.9))
    out = {"prefix": prefix, "mask_px": n, "white_share": float((g[mask] >= 0.95).mean()),
           "frame_white": white, "white_rel": float((g[mask] >= 0.95 * white).mean()),
           "mean_luma": float(g[mask].mean())}
    if os.path.exists(nofx):
        nf = luma(nofx)
        out["white_share_nofx"] = float((nf[mask] >= 0.95).mean())
        out["fx_changed_share"] = float((np.abs(g - nf)[mask] > 0.1).mean())
        out["raised"] = float(((g - nf)[mask] > 0.25).mean())
        out["white_rel_nofx"] = float((nf[mask] >= 0.95 * white).mean())
    return out


def main():
    d = sys.argv[1]
    prefixes = sys.argv[2:] or sorted({os.path.basename(p).replace("_mid_game_id_enemy1.png", "") for p in glob.glob(os.path.join(d, "*_mid_game_id_enemy1.png"))})
    rows = [r for r in (measure(d, p) for p in prefixes) if r]
    for r in rows:
        if r.get("mask_px"):
            print("%-34s mask %6d px  white %5.1f %%  (no fx %4.1f %%)  white_rel %5.1f %% (white %.2f, no fx %4.1f %%)  raised %5.1f %%  fx changed %5.1f %%  mean luma %.2f" % (
                r["prefix"], r["mask_px"], 100 * r["white_share"], 100 * r.get("white_share_nofx", 0), 100 * r["white_rel"], r["frame_white"],
                100 * r.get("white_rel_nofx", 0), 100 * r.get("raised", 0), 100 * r.get("fx_changed_share", 0), r["mean_luma"]))
        else:
            print("%-34s no Guardian in view" % r["prefix"])
    print("WHITEOUT " + json.dumps(rows))


if __name__ == "__main__":
    main()
