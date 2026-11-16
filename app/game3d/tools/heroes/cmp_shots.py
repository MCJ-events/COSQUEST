import sys, os, json, numpy as np
from PIL import Image
from skimage import color
a_dir, b_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
rows = []
tiles = []
for f in sorted(os.listdir(a_dir)):
    if not f.endswith('.png') or not os.path.exists(os.path.join(b_dir, f)):
        continue
    A = np.asarray(Image.open(os.path.join(a_dir, f)).convert('RGB'), np.float32) / 255
    B = np.asarray(Image.open(os.path.join(b_dir, f)).convert('RGB'), np.float32) / 255
    m = (A.sum(2) > 0.02) | (B.sum(2) > 0.02)          # the character, not the empty background
    mse = ((A - B) ** 2)[m].mean()
    psnr = 10 * np.log10(1.0 / max(mse, 1e-12))
    de = np.linalg.norm(color.rgb2lab(A) - color.rgb2lab(B), axis=2)[m]
    rows.append({'shot': f, 'psnr_db': round(float(psnr), 2), 'dE76_mean': round(float(de.mean()), 2), 'dE76_p95': round(float(np.percentile(de, 95)), 2), 'pixels': int(m.sum())})
    ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    tiles.append((f, Image.fromarray((A[y0:y1, x0:x1] * 255).astype(np.uint8)), Image.fromarray((B[y0:y1, x0:x1] * 255).astype(np.uint8))))
print(json.dumps(rows, indent=1))
if tiles:
    H = 640
    ims = []
    for f, a, b in tiles:
        k = H / a.height
        a = a.resize((int(a.width * k), H)); b = b.resize((int(b.width * k), H))
        t = Image.new('RGB', (a.width + b.width + 8, H), (255, 255, 255)); t.paste(a, (0, 0)); t.paste(b, (a.width + 8, 0)); ims.append(t)
    W = sum(i.width for i in ims) + 16 * (len(ims) - 1)
    sheet = Image.new('RGB', (W, H), (255, 255, 255)); x = 0
    for i in ims:
        sheet.paste(i, (x, 0)); x += i.width + 16
    sheet.save(out, quality=88)
