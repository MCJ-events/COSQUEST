# maskmeasure.py DIR : from look_shots masks (m_c1 fighters white, m_c0 fighters black), the share of the frame the
# fighters cover and their silhouette's vertical extent, per shot of the game view
import glob, os, sys
import numpy as np
from PIL import Image
D = sys.argv[1]
for c1 in sorted(glob.glob(os.path.join(D, "*_game_m_c1.png"))):
    c0 = c1.replace("_m_c1", "_m_c0")
    a = np.asarray(Image.open(c1).convert("L")).astype(np.int16); b = np.asarray(Image.open(c0).convert("L")).astype(np.int16)
    m = (a - b) > 40
    H, W = m.shape
    rows = np.where(m.any(1))[0]
    ext = (rows.max() - rows.min() + 1) / H * 100 if len(rows) else 0
    print("%s: fighters cover %.1f%% of the frame; silhouettes span rows %.0f%%..%.0f%% (%.0f%% of the height)" % (
        os.path.basename(c1).replace("_game_m_c1.png", ""), m.mean() * 100, rows.min() / H * 100 if len(rows) else 0,
        rows.max() / H * 100 if len(rows) else 0, ext))
