# sheet.py FRAMES_DIR OUT_DIR : one contact sheet per tier: rows hero x arena, columns intro beat, mid-fight, victory (game camera, no HUD)
import os, sys
from PIL import Image, ImageDraw
F, O = sys.argv[1], sys.argv[2]
W, H = 360, 640
for tier in ["high", "mid"]:
    rows = [(h, a) for h in ["imani", "kofi"] for a in ["street", "place"]]
    sheet = Image.new("RGB", (W * 3 + 20, (H + 26) * len(rows) + 30), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    d.text((8, 8), "build-28 89840bb, tier %s, golden hour, game camera (no HUD): intro beat 0.9 s | mid-fight 4.4 s | victory 1.7 s" % tier, fill=(230, 230, 230))
    for r, (h, a) in enumerate(rows):
        y = 30 + r * (H + 26)
        for c, (run, shot) in enumerate([("B", "intro"), ("A", "mid"), ("B", "win")]):
            p = os.path.join(F, "%s_%s_%s_%s_%s_game.png" % (h, tier, a, run, shot))
            x = 5 + c * (W + 5)
            if os.path.exists(p):
                sheet.paste(Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS), (x, y + 20))
            d.text((x + 4, y + 4), "%s %s %s" % (h, a, shot), fill=(240, 220, 160))
    sheet.save(os.path.join(O, "sheet_%s.jpg" % tier), quality=86)
    print("sheet", tier)
