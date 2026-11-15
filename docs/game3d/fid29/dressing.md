# fid29-dressing: real street furniture, no toy cars, London planes (mid and high)

Branch `fid29-dressing` from `fid29-base` (afec3fd). Spec: `fidelity-29/specs/dressing.json`. Assets and licences:
`ASSETS-LICENCES-dressing.md` (this folder).

## What changed

Gated by `look.real` and `look.fid_dressing` (mid and high). Low runs the build 28 code paths and opens the same files;
its only change is the generic kiosk.

| Commit | Change |
|---|---|
| 46166e1 | Kit kind `phone_box_uk` becomes a generic kiosk of our design on every tier: slim slate cabinet, flat roof, one glazed and one blank panel per side pair. No dome, no 3 x 6 panes, no TELEPHONE band. 44 triangles, same 2 surfaces (paint, glass). `bake_kit.gd --only=kind` keeps the rest of the kit byte-identical. |
| 9017455 | CC0 props (Poly Haven) decimated on mm1 (Blender, CPU) to 2 LODs, packed into one atlas per tier (2048 albedo/normal + 1024 ORM high; 1024 + 512 mid); the London plane (own procedural mesh, ambientCG bark and LeafSet027 leaves); `art/world/props/kit_real/` detail maps. Tools in `tools/props/`. |
| 09e883e | `place_dress.gd`: no Kenney cars on mid/high, parked bays + junction barriers, lamp/bench/planter swapped for the photo props, shop-front A-boards, cafe sets, cabinets, bin bags, wall lanterns, security lights; every temperate broadleaf a plane (LOD0 near the fight on high, impostor elsewhere). Placement by free_spot and fixed spot hashes (no fight RNG), never in the clear ground. MultiMesh per kind, per 24 m cell, per LOD; on high, props within 12 m cast through their own shadow-only MultiMesh. `place_life.gd`: no driving cars on the real look (same random numbers still drawn). New `vfx/world_prop.gdshader` (GGX, multiple-scatter term, specular AA, LookReal cube read-only on high, six-direction ambient and arena hemisphere read-only). `world_kit.gdshader` gains `real_k` (default 0 = low unchanged): kit_real detail, roughness/metalness per class, specular AA, cube on high. |
| 918bbd2 | `env_piece.gd`: Forge pieces get a contact-AO disc on mid and high (1 quad, 1 draw), the key-light shadow on high. |
| 72845d1 | Plane crown at under 3 leaf layers: denser clusters on octagon cards, 250 cards instead of 380 (LOD0 3792 tris). |
| 92cc13a, 1faaea9 | Lamps and benches around square fountain pools, never in the water. After the round-1 blind judge's defect answers: bays left empty (`COVERED_CAR_SHARE = 0`, allowed by the spec) and a summer-green crown. |
| b25fa60 | Plane bark normals rebuilt smooth in the game mesh (no rings down the limbs). |
| c327281 | Poly Haven fetch tool (`tools/props/ph_dl.py`). |
| a9bd443 | Plane impostor fades its cards edge-on (smoothstep on abs(N.V)); no crown squeezed into a streak. |
| 6c0bb9b | Trashbag's printed packaging blurred out of both prop atlases. |

`world_landmarks.gd` and `world_heroes.gd` change only through the kit shading. `arena.gd` and `place.gd` untouched.

## Logo and text checklist (every scanned texture that ships)

Checked by eye on each source albedo and again on the final shipped atlases `props_high_a.png` (zoomed to full
resolution on the cabinets, security light, A-board and trashbag) and `props_mid_a.png`, 15 Nov 2026.

| Texture | Logos / brands | Stickers / labels | Maker plates / serials | Text | Action | Shipped state |
|---|---|---|---|---|---|---|
| street_lamp_01 diff | none | none | none | none | none | clean |
| street_lamp_02 diff | none | none | none | none | none | clean |
| utility_box_01 diff | none | DANGER sign, two warning triangles | none | painted number ("2794") | stickers and number cloned over | clean; terminal internals and hazard stripes, no legible marks |
| utility_box_02 diff | none | DANGER sign, two warning triangles | none | painted number ("2704") | stickers and number cloned over | clean; terminal internals and hazard stripes, no legible marks |
| standing_chalkboard_01 board | none | none | none | none (blank board) | our made-up lettering added ("Halden & Co", fresh coffee, soup of the day, open 7 days) | invented name only |
| standing_chalkboard_01 frame | none | none | none | none | none | clean |
| outdoor_table_chair_set_01 table / chair | none | none | none | none | none | clean |
| trashbag diff | printed packaging visible through the bag | yes (packaging prints) | none | pack copy | blurred out (6c0bb9b) | colour blotches only, nothing legible |
| security_light diff | none | none | none | none | none | clean |
| planter_box_01 diff | none | none | none | none | none | clean |
| painted_wooden_bench diff | none | none | none | none | none | clean |
| concrete_road_barrier diff | none | none | none | none | none | clean |
| covered_car diff (in the atlas, not placed) | none | none | none | none | none | clean |
| ambientCG Bark007, Concrete034, Rock030, LeafSet027, Metal046B | none | none | none | none | none (natural surfaces) | clean |

Fetched but not shipped (so not in the atlases): large_iron_gate, rollershutter_door, rollershutter_window_01 (its
graffiti map never used), cardboard_box_01.

Trade marks (assets.md section 10): no K6 kiosk on any tier (test `kiosk_*_flat_roof`, `kiosk_*_no_pane_grid`), no TfL
roundel, Routemaster or black cab in anything this lane ships, and the only name on any prop is invented.

## Budgets (C4)

Full table: `budgets.md` in the handover folder. Street mid-fight, Imani, golden, phone path, b28p -> final:

| Tier | Draws | Primitives | Texture MB | World tris in view | Kenney car tris |
|---|---|---|---|---|---|
| low | 175 -> 175 | 348k -> 348k | 190.2 -> 190.2 | 236k -> 236k | 164k -> 164k (unchanged by design) |
| mid | 162 -> 148 | 314k -> 129k | 190.2 -> 191.2 | 227k -> 40k | 164k -> 0 |
| high | 162 -> 148 | 404k -> 243k | 361.1 -> 369.9 | 227k -> 65k | 164k -> 0 |

Every tier-budget limit passes (low +0 everywhere; mid +1.0 MB, worst +3 draws; high +8.8 MB, worst +3 draws). Shader
texture reads: `world_prop.gdshader` 3 (albedo, ORM, normal) on mid, plus the env cube on high = 4; the impostor shader
1; `world_kit.gdshader` with `real_k` adds the kit_real detail reads on mid and high only. Not measured: ALU per variant
and CPU ms per frame of `place_dress.gd` (it builds at place load; per-frame work is only the MultiMesh draws).

Leaf overdraw at the victory shot, high: 2.91 fragments per crown pixel by `tools/props/leaf_overdraw.py` (LOD0 crown
rasterised from 8 views). The in-engine debug view (`dbg_leaf`) read with `tools/props/leaf_overdraw_frame.py` gives a
mean of 3.02 (p50 2.75, p95 7.0) in linear light. That reading is confounded: red rises over the crown as much as green, so
the overdraw and hide frames differ by more than the additive leaf green (tone mapping or a second difference). An
earlier reading of 4.57 counted single 8-bit steps as fragments and is wrong. Status: at the cap, not proven under it.

## Tests and records (final commit 6c0bb9b, farm)

- Godot tests: 628 passed, 1 failed (build21 `whirl_ends_facing_target` at free frame rate, the known check);
  build21 at `--fixed-fps 30` 39/39. `fid29_dressing_test` 78/78, `env_piece_test` 70/70.
- Records: all 11 SAME as build 28 with `fid_dressing` on and off.
- Low frames (C3): llvmpipe is not deterministic here. Two renders of the b28p tree differ by up to 231 per pixel over
  up to 715k pixels, and two renders of the lane tree by up to 231. New against b28p is inside the b28p-b28p maximum on
  13 of 14 low frames. The 14th, street hit0, reads 228 against 209, which is the same 228 two lane renders reach against
  each other. No low-opened file changed (git diff afec3fd..6c0bb9b touches no `art/world/misc`, npc_atlas or Kenney
  car file), and every low counter is +0.

## Known limits

- Covered cars are not placed (`COVERED_CAR_SHARE = 0`) after the round-1 judge read the dark cover as a smear under
  the victory depth of field. Bays are empty, and the barriers stay at junction approaches.
- large_iron_gate, rollershutters and cardboard boxes are not shipped.
- Leaf overdraw: see above (at the cap, in-engine measurement confounded).
- High photo-prop triangles at the street victory shot are 47k, above 40k if that cap is read per shot. At mid-fight
  they are 30k.
- Texture memory per tier is inside the lane budget, but the whole-frame ceilings for the candidate (high 240 MB,
  mid 140 MB) are already exceeded by b28p itself. The lane adds 8.8 MB on high and 1.0 MB on mid.
