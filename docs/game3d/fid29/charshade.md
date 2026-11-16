# fid29 charshade: character materials (skin, hair, cloth, leather, metal, eyes)

Lane spec: `fidelity-29/specs/charshade.json`. Branch `fid29-charshade`, forked from `fid29-base` (afec3fd). Common
gates: `COMMON.md`. Licences: `ASSETS-LICENCES-charshade.md`.

## What it does

With look `fid_charshade` on (mid and high; `look.real`), `fighter.gd` builds every hero material from
`vfx/char_real.gdshader` with `cs_on`. Off, or on low (`char_lit`), the fighter draws exactly as build 28.

- **Material-ID masks** (`tools/char/matid.py`, `art/char/masks/<hero>_lod0.png` 1024 and `_lod1r.png` 512): smooth
  weights, R skin, G metal, B leather, A cloth sheen, synthetic = the remainder. They sit in the skin mask's sampler,
  so mid has no extra texture read. Metal only where the mask says so; roughness held inside each class's range.
- **Cloth sheen**: Charlie distribution with Neubelt visibility in place of GGX and the rim on the sheen weight;
  leather keeps GGX.
- **Specular AA**: geometric (variance 0.15, threshold 0.2) plus Toksvig, in every char_real variant on mid and high.
- **Skin**: a warm penumbra tint where `recv_shadow > 0`; specular damped in cavities. The skin weight stays build 28's
  colour weight times the mask, so skinlook-28's tone is kept.
- **Eyes** (hybrid head eye corner): no wrap, roughness 0.06, iris parallax, lid shade, and a live GGX catchlight from
  the face-fill direction; the painted catchlight is taken out.
- **High only** (`#define CS_HIGH`): ambientCG detail normals (one 1K sheet of four 512 tiles: Fabric030, Fabric061,
  Leather037, Leather026) and a metal roughness break-up (Scratches005, SurfaceImperfections003), faded by footprint.
- **Hair cards**: a procedural strand atlas per hero (`tools/char/hair_atlas.py`; 1K x 2K for the player's hero on
  high, 512 x 1024 otherwise) and charshade's hair shading: two shifted lobes along the card's V axis (Scheuermann),
  darker towards the root, and a weak, broad, matte sheen on coils and tufts (`hair_style: curls`). It is drawn on
  **build 28's hard 0.35 alpha cut**. The soft cut (alpha to coverage) stays behind look `cs_hair_soft` (see below).
- **Per-hero overrides** (`matid.py` `ORM_TRUST`, `HERO_SHADE`, written into each mask json): Tavo keeps the lift's
  metal on his painted armour; Imani keeps build 28's bronze cape and muted suit (`orm_trust 1`, metal roughness
  `[0, 1]`, sheen 0, no knee).

Contracts (spec item 8) kept: fighter.gd's public API, `recv_shadow`, `kick_a_col` and the anim members are unchanged;
`char_lit` is untouched; nothing is added under the model holder (AABB unchanged); every charshade variant is
registered with `ShaderWarm`. `face_life.gd` is not edited; `arena.gd` is not edited.

## History of this resume (15 to 16 Nov)

The first blind judge rejected the lane (new 9, old 17, tie 18). Its findings and what was done:

1. **Imani's cape went pale cream and her suit read as plastic** (old won 16 of 16 Imani shots). Root cause: the mask
   moved the lift's metal off the cape (cloth) and the cloth sheen lit the suit. Fixed with Imani's `HERO_SHADE`
   (variant D of `plans/x3.txt`: keep the lift's metal, metal roughness over the whole 0 to 1, no sheen, no knee).
2. **The hair shader was over budget** (+22 % mid, +51 % high by the earlier proxy) and never re-measured.
   - The earlier ratios compared charshade's VRAM-compressed strand atlas against build 28's RGBA8 hair texture.
     llvmpipe decodes block-compressed texels in software, so most of the "cost" was the texture format, not the
     shader. `tools/char/shader_cost.gd --raw=1` samples the same RGBA8 atlas in every config, so only the shader differs.
   - At one format (farm, llvmpipe, 2x MSAA, 11 interleaved rounds, `logs/cost_f1.out`): charshade's hair shading
     on the hard cut is **+3.6 % mid, +3.5 % high (Imani); +3.6 % mid, +2.9 % high (Zuri)** of hair ALU over build 28,
     +0 texture reads. The soft cut: +3.2 to +5.0 %.
   - On 15 Nov the whole strand path was first gated off (50a4935). The renders then lost the lane's one clear win,
     Zuri's dark coils. Those come from the hair *shading*: build 28's strand highlight lights the whole coil, which
     reads as a white or grey blob. 81f4076 turns the shading back on, on the hard cut.
   - The soft cut stays off. It showed no measurable gain in hair-edge stair-steps (see Other numbers), and its cost on a phone
     GPU (alpha to coverage) can't be measured on llvmpipe. Look `cs_hair_soft: true` brings it back for that check.

## Numbers

Measured at 81f4076 on every matched render (83 shots; `budgets.md` in the lane folder has the per-shot table).
Low, mid and high all pass their budgets; mid texture memory sits at the +3 MB ceiling (Kofi, Lyra).

| tier | texture memory | draws | primitives | body shader | hair shader |
|---|---|---|---|---|---|
| low | +0 (budget +0) | +0 | +0 | char_lit untouched | untouched |
| mid | +2.3 to +3.0 MB (budget +3) | +0 | +0 | +0 reads, about +0 % | +0 reads, +3.6 % (budget +10 %) |
| high | +5.7 to +8.4 MB (budget +10) | +0 | +0 | +2 reads, about +17 % (budget +2, +20 %) | +0 reads, +2.9 to +3.5 % (budget +20 %) |

The cost is an llvmpipe proxy, not a phone GPU. With the shipped compressed atlas, the same tool reads the hair at
+31 % mid (`cost_s1`, mm1), a figure dominated by software texture decode.

## Other numbers

- **Masks after VRAM compression** (`tools/char/maskiou.py`, `logs/maskiou_s.jsonl`, 15 Nov, masks unchanged since):
  measured against the lossless masks, not hand-checked ones. ETC2 (phone) lod0: skin IoU Zuri 0.96, Kofi 0.95, Tavo 0.94,
  Oren 0.94, Imani 0.90, Lyra 0.84; metal 0.91 to 0.96 (Kofi has none). Leather or cloth counted as skin at most 0.7 %
  of skin texels. Misses: Lyra skin (0.84), Oren lod1r metal (0.76 ETC2), Imani lod1r skin (0.87).
- **Skin Delta E 76** (`tools/char/measure.py`, `logs/measure30.jsonl`, frames at 81f4076, face middle band): Zuri at
  most 0.65, Imani at most 1.09, Kofi at most 1.82, Lyra at most 2.02, Oren at most 3.66, Tavo at most 8.32 (worst
  on Tavo's intro and mid-fight shots, where his helmet and armour sit in the face box). Golden, day and dusk measured for Kofi and Imani only.
- **Hair-edge stair-steps**, new / b28: median 1.005 over 50 shots (0.77 to 1.26). The spec's at most 0.5 is not met:
  the hard cut is build 28's.
- **Draws, primitives, model AABB**: equal to build 28 on every shot; nothing is added under the model holder.
- **Specular flicker** (30-frame orbit) and the **catchlight** check were not re-measured at 81f4076.

## Pairs

68 matched pairs at 81f4076 against build 28 (`bin/pairs30.sh`): all six heroes x mid, high x intro, victory;
mid-fight for Kofi, Imani, Zuri and Tavo on both tiers; day and dusk for Kofi and Imani; Imani on low; the arena wide
and side shots; and 16 crops on high (face, hair, torso, legs for Kofi, Imani, Zuri, Tavo). Zuri's coils are dark
again (build 28 renders them as a pale grey blob); Imani's cape and suit match build 28's colours.

## Commits (on fid29-base afec3fd)

- `639fa43` material-ID masks, cloth sheen, specular AA, skin penumbra, live eye catchlight, soft strand hair (WIP)
- `1444d59` garment-consistent masks, cornea catchlight, cheaper sheen and hair lobes, measure tool, licences
- `a9fbb2e` masks by the loaded file, hair atlas by role, cheaper light(), dark coils, costume metal, mask tools
- `f4d3156` Tavo's armour stays metal (`orm_trust`)
- `6aa3087` cheaper hair lobes, shader_cost MSAA and cut ablations
- `0f5d74f` Imani keeps build 28's bronze cape and muted suit; same-atlas hair cost ablations
- `50a4935` hair strand path gated off (superseded by 81f4076)
- `81f4076` hair cards take charshade's hair shading on build 28's hard cut; soft cut behind `cs_hair_soft`
- this doc

## Tests and fight identity (81f4076)

- All Godot tests (mm1, `testlogs30/`): 580 pass, 1 fail, the known build21 `whirl_ends_facing_target`, which passes
  39/39 with `--fixed-fps 30`. `fid29_charshade_test` 34/34, `hero_cast_test` 74/74, `five_seeded_test` 26/26.
- The 11 seeded records with `fid_charshade` on and off: all byte-identical to `tools/fid29/records.txt` (build 28),
  `records.sh --check` rc 0 for both.

## Known limits

- The hair cost is an llvmpipe proxy; a phone GPU measurement is still owed, both for the hard cut and for `cs_hair_soft`.
- Hair-edge stair-steps are about build 28's (ratio about 1.0, target at most 0.5): the hard cut is kept.
- Mask IoU after VRAM compression is checked against the lossless masks, not hand-checked masks. Lyra's skin and
  Oren's lod1r metal miss the spec's bars (see Other numbers).
- Skin Delta E for Tavo and Oren is over 1.0 (Tavo's face box takes in his armour); not hand-checked per pixel.
- Specular flicker and the catchlight check were not re-run at 81f4076.
- Zuri's hairline shows a few light flecks under the hard cut (crop_zuri_high_intro_hair).
- Integration (spec item 10): re-run `matid.py` on fid29-heromaps' lod0 and lod1r UVs, then re-judge.
