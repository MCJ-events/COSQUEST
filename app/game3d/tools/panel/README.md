# Attack panel art pipeline (build 22)

The panel's sprites come from Wale's own sheet (message 59328, `g_59328.jpg`, 870 x 1112). These scripts ran on the
farm (Python with Pillow, NumPy, SciPy, OpenCV) and are kept here so the atlas can be rebuilt when he sends new art.

1. `cut.py SHEET OUT`: cuts his five buttons at the sheet's own pixels, with soft alpha worked out against the halo
   colour behind each one, and the four grey ring segments as a second "lit" layer. Writes `cut.json` (centres, radii).
2. `glyphs.py SHEET OUT`: INTERIM only. Draws SPLIT, WHIRL and RALLY drafts with the farm's klein model
   (FLUX.2 klein 4B, Apache 2.0), his buttons as the style references, inside the GPU lock.
3. `interim.py CUT GEN`: INTERIM only. His shield button's ring, rim and segments recoloured, with the draft's centre.
4. `atlas.py CUT OUT`: packs `panel_atlas.png` (each button: on, dimmed, lit segments; one halo disc) and
   `panel_atlas.gd` (the regions). Copy both to `art/hud/wale/` and run `godot --headless --import`.

Needs Wale's art: SPLIT, WHIRL, RALLY (interim here) and GUARD (still the old kit icon).

Review tools: `panel_sheet.gd` (the panel alone on his page at his sheet's size), `panel_shots.gd` (stills of a real
fight with timed presses, and how often the hero's body is under a button).
