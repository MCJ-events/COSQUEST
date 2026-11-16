# fid29-street: real street surfaces (mid and high)

Lane spec: `fid29/specs/street.json` (build 29 fidelity). Branch `fid29-street`, forked from `fid29-base` (afec3fd).
Common gates: `docs/game3d/fid29/COMMON.md`. Sources and licences: `docs/game3d/fid29/ASSETS-LICENCES-street.md`.
Short version for the place builder: `docs/game3d/PLACE.md` ("The real street").

## What changes

On mid and high with the look key `fid_street` (`StreetReal.on(look)`), and only there:

- **Arena floor and medallion** (`street_real.gd`, the base seam `apply_floor`): the paved floor takes the grey London
  footway flags (Poly Haven `large_square_pattern_01`, unstylised) and the medallion a worn stone inlay of build 28's
  motif, redrawn by us (`art/street/real/medallion*.png`, mipmapped, granite grain from Poly Haven `granite_tile`).
  Low (and the key off) returns at once: `art/street/medallion.png` and `street_pavers.png` stay build 28's files.
- **Places** (`place.gd`, `place_roads.gd`): ground keys floor, plaza, asphalt, kerb, paint and setts (UK and generic
  regions) take `vfx/world_ground_real.gdshader` with CC0 photo PBR from `art/world/real/ground` (albedo, normal,
  packed ORM); kerbs get a granite sett gutter; fountains and ponds a kerbed granite basin and the real water
  (`world_water.gdshader` `real_k`, default 0 so low is unchanged). Walls keep build 28's `world_facade` by default.
- **Real facade, look key `fid_street_facade` (default off since round 3, `StreetReal.facade(look)`)**: UK facades
  take `vfx/world_facade_real.gdshader` on `art/world/real/trims`, and on high wall segments within 30 m of the fight
  get recessed window reveals and sills (capped at 20,000 triangles), shaded per face through the vertex alpha (cheeks and soffit 0.35, surround 0.82, returns 0.5,
  sill 0.8) and mapped over a patch of the wall's own stone, so they read as depth rather than bright strips.
- **Ground shader**: GGX with Karis' environment BRDF lit from `LookReal.env_for(time)` (read only), normal + ORM,
  world-space detail normal at 1.5 m on high (fades out 8 to 25 m), a decal atlas (gum, cracks, patches, leaves, gully
  grates; 1K on high, 512 on mid) scattered by a hashed world grid in the shader with nothing within 1.2 m of the
  fight centre, damp patches at dusk and night (albedo x 0.55, roughness 0.08, Fresnel reflection of the cube),
  geometric specular AA (Tokuyoshi and Kaplanyan, variance 0.15, threshold 0.2), anisotropic samplers via shader hints
  only (the project's anisotropic level is unchanged).
- **Facade shader** (only with `fid_street_facade`): the same lighting, rain streaks under the sills (ambientCG `Leaking012A`), lit windows by hash,
  glass reflecting the upper sky (`glass_refl` 0.22 + 0.32 Fresnel, as build 28's glass; mid and high).
- **Grounding**: `place_bake.gd` adds a near-fight shade and contact-AO bake (512 px over 48 m); `ground_occluders.gd`
  reads each fighter's Skeleton3D pose after animation (read only), packs 6 capsules per fighter (thighs, shins, feet)
  for up to 4 fighters, and the ground darkens its ambient light by cosine-weighted capsule occlusion within 2.5 m of a
  fighter only, never below `cap_floor` (0.3) of the sky light. `fid_street_cap: false` switches it off. Every new material goes through `ShaderWarm.add`.
- `art/world/ground`, `trims`, `roofs`, `misc/props_noise.png`, `vfx/world_ground.gdshader` and `arena.gd` are not
  edited. `tex`, `kit_mat`, `add_multi_buffer`, `_emit` and `free_spot` keep their signatures.

Cut in review (as the spec says): window-interior parallax and downpipes.

## Commits

| commit | what |
|---|---|
| ccc4185 | real street surfaces for mid and high (WIP checkpoint): photo PBR ground, decals, medallion, trims, shaders, water, basins, reveals, near bake, capsule shade |
| d2e631e | ground lighting balanced to build 28, albedos in measured ranges, lazy low path (low opens no new file) |
| 67c4ab1 | water reflecting the sky, albedo gate at 8 bits on the trims, softer medallion inlay, ground sky fill 1.9 |
| 7172c2e | high reads the half-size normal for asphalt, slabs and the medallion (-3 MB high texture memory) |
| feaf658 | one bake read per pixel (branch, not select), no normal read for worn paint (same pixels); PLACE.md section |
| e7922d7 | lane doc with the numbers, tests and records on feaf658 |
| 100ae32 | judge conditions (verdict keep-partial, 15 Nov): road paint reads its wear mask only within 25 m (far ground 4 reads); high reveals and sills shaded and in the wall's stone, glass reflects the sky again (mid and high); capsule shade floor `cap_floor` 0.45 |
| 40cc7ca | lane doc with the numbers, tests, records, pairs and budgets on 100ae32 |
| 2519457 | round 3 (verdict keep-partial, 16 Nov): the real facade and the high reveals behind look `fid_street_facade`, default off (build 28's walls on mid and high); `cap_floor` 0.3 |
| (this doc) | lane doc on 2519457: 72 pairs re-rendered, arena wide intros re-shot as wide shots, budgets, capsule shade re-measured, tests and records |

Of the tweaks made after the held-out set (`~/realism-20261111/fid29/street/post-heldout-tweaks.patch`: dusk shade
x1.3, a capsule-shade floor, stronger water ripples) only the capsule floor landed (100ae32, as the judge asked; 0.3 since 2519457); the
dusk shade and ripple hunks stay off the branch.

## Budgets (C4)

Full table: `~/handover/fidelity-29/street/budgets.md` (tools/fid29 dump.sh, phone path, mm1, 3 shots x street and
Trafalgar x Imani and Kofi x golden x low, mid, high, b28p vs 2519457, default look, dumps `dumps_r3/`).

| tier | texture | draws | primitives | budget | verdict |
|---|---|---|---|---|---|
| low | +0.0 MB | +0 | +0 | +0 each | PASS (every monitor identical to b28p) |
| mid | +4.10 MB | +2 | +2,292 | +6 MB, +6, +5k | PASS (100ae32: +5.94 MB, +3) |
| high | +9.29 MB | +2 | +2,292 | +12 MB, +10, +22k | PASS (100ae32: +11.46 MB, +3, +19,136) |

With the facade off by default, every mid and high shot drops the real trim sheets (1.8 MB mid, 2.2 MB high) and one
draw, and high street drops the 19,096 reveal triangles. With `fid_street_facade: true` the costs are 100ae32's
(`budgets_prev_40cc7ca.md` in the handover folder).

Texture reads (from source): ground mid 6 within 25 m, 4 beyond, road paint included (its wear mask is read only
within 25 m); ground high 7 within 25 m; default facade = build 28's; real facade (key on) mid 4, high 5 within 15 m
(the glass sky is arithmetic). ALU: 646 vs 400 operators in the Mesa-dumped lit fragment shader on feaf658 (1.6x,
budget 2x); since then the ground gained a branch and a `max()`, not re-dumped.

## Numbers (spec acceptance)

Measured with `street_probe.gd` on mm1 (llvmpipe, phone path), Imani, street, golden, against b28p (fid29-base) with
the same probe; scripts `metrics.py` and `capm.py` (lane kit, `~/realism-20261111/fid29/street/kit2/`). Sharpness,
shimmer, albedo and skin are feaf658's (probe frames `~/realism-20261111/fid29/street/probe_mm1/probe/`; 100ae32
changes neither the near paving nor the faces). The capsule shade and the occluder cost were re-measured on 2519457
(`final_r3.sh` probes: Imani street, Kofi street, Imani Trafalgar per tier, plus a second Imani street run on high;
frames in `~/realism-20261111/fid29/street/probe/r3/`, numbers `work/r3/capm_r3.txt`).

| number | spec | mid | high | verdict |
|---|---|---|---|---|
| paving sharpness 6 to 15 m (Laplacian variance, mid-fight frame) | >= 1.5x b28p | 0.00236 vs 0.00062 (3.8x) | 0.01254 vs 0.00133 (9.4x) | PASS |
| ground shimmer, raw mean abs frame-to-frame luminance, 30-frame orbit | <= 0.01 | 0.038 (b28p 0.022) | 0.051 (b28p 0.023) | FAIL as written (b28p fails it too: the raw figure is mostly the camera's motion) |
| ground shimmer, plane motion taken out (previous frame warped through the ground plane) | (our reading) | 0.0057 (b28p 0.0025) | 0.0095 (b28p 0.0027) | under 0.01, but 2.3x / 3.5x build 28's |
| capsule shade under the feet (0.35 m), mean darker than `fid_street_cap: false`, 2519457 (`cap_floor` 0.3), pixel-weighted over the scenes | 10 to 25 % | 9.8 % (3 scenes, 4,952 px: 13.2 / 9.7 / 8.1 %) | 10.7 % (4 scenes, 7,078 px: 12.7 / 10.1 / 17.1 / 4.2 %) | high mean just over 10 %, mid just under; per scene 4.2 to 17.1 % (see below) |
| capsule shade, darkest pixels, 2519457 | never > 35 % | p99 31.4 %, max 33.1 % | p99 36.2 %, max 43.1 % | mid PASS; high FAIL (tail back over 35 % with the 0.3 floor) |
| (100ae32, `cap_floor` 0.45, for reference) | | mean 11.3 %, max 32.9 % | mean 7.2 %, max 14.9 % | |
| (feaf658, no floor, for reference) | | mean 9.9 % | mean 18.6 %, max 57.2 % | |
| ground_occluders.gd CPU per frame (`Time.get_ticks_usec`, 191 to 293 frames), 2519457 | <= 0.1 ms | mean 0.023 to 0.025, max 0.052 ms | mean 0.023 to 0.025, max 0.076 ms | PASS |
| albedo: non-metal real albedo texels in 0.04 to 0.85 linear luminance | 100 % | `fid29_street_test` albedo_gate: 18 files, 1,114,413 texels, 0 outside | (same files) | PASS (checked on the shipped maps, not on a render debug view) |
| skin Delta E76 vs b28p (face middle, intro and win, 8 frames per hero) | within 0.5 | Imani 0.00, Kofi 0.00, Zuri 0.00 | Tavo mean 0.51, max 3.40 | Imani/Kofi/Zuri PASS; Tavo 0.01 over (one frame's face box catches a moving background) |
| no text or logo in shipped photo maps | none | see below | | PASS (by eye) |

Capsule shade, read with care: the probe's VFX differ from run to run, and capm masks the fighter, its sun shadow
and the effects from the cap-off frame, so the measured pixels differ between runs. The same high Imani street shot
run twice on 2519457 gives 10.1 % and 17.1 % mean; on the pixels it shares with the 100ae32 run (`capm_pair.py` in
`work/n29/`) it gives 7.4 % vs 7.7 % on one run and 7.3 % vs 16.2 % on the other. Trafalgar (the fighters on bright
open paving) stays low at 4.2 % high, 8.1 % mid. So with `cap_floor` 0.3 the high mean over all scenes is 10.7 %, at
the spec's floor but not clearly above it, and the darkest pixels go back over 35 % on high (max 43.1 %, p99 36.2 %,
in Kofi's street scene and the second Imani run). Only 0.45 and 0.3 were measured: 0.45 holds the tail but
cuts the high mean to about 7 %; 0.3 brings the mean back to about 10 % and lets the tail through. A value in between
or a softer shaping of the occlusion (a smooth knee instead of the hard `max()` floor) was not tried.

The blind pair judgement (36 golden + 12 dusk, held-out) is the coordinator's; this lane does not grade itself.

## No text or logos in shipped photo maps

Every shipped map (52 PNGs under `art/world/real/**` and `art/street/real/**`) was viewed whole on 15 Nov 2026
(albedo, normal and ORM; the `_mid` files are downsizes of the full files, checked by correlation, and the ones that are
not (`medallion_mid`, `decals_mid`, `asphalt_uk_mid_n`, `plaza_uk_mid_n`) were viewed separately). None carries text,
a logo, graffiti or lettering.

| maps | source | text/logo |
|---|---|---|
| ground/flags_uk (+_n, _orm, _mid*) | Poly Haven large_square_pattern_01 | none |
| ground/plaza_uk (+_orm, _mid*) | ambientCG PavingStones133 | none |
| ground/asphalt_uk (+_orm, _mid*) | Poly Haven asphalt_04 | none |
| ground/kerb_uk (+_n, _orm, _mid*) | Poly Haven granite_tile | none |
| ground/setts_uk (+_n, _orm, _mid*) | ambientCG PavingStones070 | none |
| ground/decals, decals_mid | ambientCG ChewingGum001/002, AsphaltDamageSet001, ScatteredLeaves006, Grate001 (iron grain of our drawn grates); Poly Haven asphalt_02, asphalt_04 (tar seal) | none (ManholeCover009 has cast lettering and is not shipped) |
| ground/wear, paint_wear, detail_n | generated wear / ambientCG RoadLines020C (opacity of our own markings) / Poly Haven asphalt_04 | none |
| trims/trim_uk_brick, _brick_red, _stone (+_n, _orm) | ambientCG Bricks105, Poly Haven brick_wall_001, ambientCG PaintedPlaster017; layout drawn by us | none: shop fascias carry plain blocks, not letters |
| trims/leak, wall_detail_n | ambientCG Leaking012A, Bricks097 | none |
| street/real/medallion*, pavers* | drawn by us (build 28's motif) on granite_tile and PaintedPlaster017 grain, ChewingGum002; pavers = the footway flags | none |

## Judge conditions (100ae32)

The coordinator's blind judge (15 Nov, `~/realism-20261111/fid29/judge-street/verdict.json`) kept the lane partially,
on two conditions before merge:

1. **Road paint beyond 25 m must not read its wear mask, so the far ground stays at 4 texture reads.** Done: in
   `world_ground_real.gdshader` the CUTOUT variant reads `mask_tex` only when `is_near` (`textureGrad`, so the
   branch keeps its mip); beyond 25 m every ground pixel, paint included, reads albedo, ORM, wear and one bake = 4.
   The mask's far mips average about 0.95, so the far markings barely change.
2. **Tone down the high-tier window reveal frames and sills (flat bright-white strips) and give the glass back its sky
   reflection.** Done: the reveal faces carry a shade in the vertex alpha (`REVEAL_SHADE_*` in `place.gd`), map a
   patch of the wall's stone instead of one flat texel, and on stone fronts the sill takes the wall's tinted stone; the
   facade glass mirrors the upper sky at `glass_refl` 0.22 + 0.32 Fresnel (mid and high). In the re-rendered pairs the
   frames now read as recesses in the wall's stone and the panes are sky-blue again, though fainter than build 28's.
   At dusk, build 28's frames show lit warm windows that the new frames do not (judge's "monotone at dusk").

Also landed, as the judge advised: the capsule floor `cap_floor` 0.45 (numbers above).

Round 2 pairs: all 72 pairs were re-rendered on 100ae32 (mm1, `final_n29.sh`) and every one changed (the glass is on mid and high, so
every frame with a window changes; the mid-fight frames also carry run-to-run VFX noise). They replace the `__new`
frames in `~/realism-20261111/fid29/street/pairs/` and the judge JPEGs in `~/handover/fidelity-29/street/pairs/`; the list
is `~/realism-20261111/fid29/street/changed_n29.txt` (72 names). Previous frames: `pairs_prev_e7922d7/`. The
`arena_wide_*_intro` artefact the judge noticed remains: with `cam: wide` the intro beat still renders the hero
close-up (0.02 % of pixels differ from Imani's street intro; the cause in the shot tool was not looked into).

## Judge conditions, round 3 (2519457)

The round-2 blind judge (16 Nov, `~/realism-20261111/fid29/judge-street-r2/verdict.json`, keep-partial) kept the
ground and asked for:

1. **The real facade not as the default.** Done: `world_facade_real`, the real trim and red-brick sheets and the high
   window reveals and sills now need look `fid_street_facade: true` (`StreetReal.facade`; never on low). By default
   mid and high use build 28's `world_facade` walls with their lit warm dusk windows. `fid29_street_test` checks the
   key (off by default, the real facade and the reveals within budget with it on): 39/39.
2. **Lower `cap_floor` to about 0.3 and re-measure; high mean must be >= 10 %.** Done: 0.3. Measured high mean 10.7 %
   over 4 scenes (just over the floor, per scene 4.2 to 17.1 %), but the high tail is back over 35 % (max 43.1 %);
   see Numbers.
3. **Re-render the changed pairs.** All 72 `__new` frames changed (the walls are build 28's again on every frame with
   a building; mid-fight frames also carry run-to-run VFX noise); all were replaced from `final_r3.sh` (mm1). Diff
   table `work/r3/diff_r3.tsv`; previous frames `pairs_prev_40cc7ca/`, previous JPEGs `work/r3/jpg_prev/`. The intro
   close-ups were checked by eye: the walls behind the heroes are build 28's stone facade with its lit windows.
4. **Arena wide intros as real wide shots.** Done: the intro beat's close-up camera is skipped by passing the game
   camera's own defaults explicitly (`--extra '"cam_dist": 15.0, "cam_pitch": 34.0,'`, fight.gd CAM_DIST/CAM_PITCH),
   B run only, on both sides (build 28: `acc/base_widei/`, new: `r3frames/*_widei_*`). Both `arena_wide_*_golden_intro`
   pairs (`__b28` and `__new`) are now these wide shots: 74 files in all, list `changed_r3.txt` (in the lane folder
   and the handover).

## Tests and records (final commit 2519457, mm1 CPU, Godot 4.5.1)

Run by `final_r3.sh` on mm1 (CPU) on `~/cq-overflow/b29/street/r3/game3d`, whose 934 tracked files under app/game3d
match 2519457 blob for blob (checked 16 Nov 05:20Z), 16 Nov 00:34-02:45Z:

- **Seeded records, all 11, key on** (`records.sh --check` against `tools/fid29/records.txt`, unchanged since
  fid29-base): SAME x11. Log `records_on_r3.txt`, `rec_on_r3/`.
- **Seeded records, all 11, `fid_street: false`**: SAME x11. Log `records_off_r3.txt`, `rec_off_r3/`.
- **Godot tests** (`gdtests.sh`): 585 passed, 1 failed = the known build21 `whirl_ends_facing_target`; build21 with
  `--fixed-fps 30`: 39/39. `fid29_street_test` 39/39, `place_test` 19/19, `fid29_base_test` 12/12, `look_tier_test`
  24/24. Log `gdtests_r3.txt`, per-test logs `testlogs_r3/`.
- Copies of these logs, the job script and log `final_r3.{sh,log}` and the budget table: `~/handover/fidelity-29/street/logs/`.
  The 100ae32 (`*_n29*`) and feaf658 (`*_f*`) runs stay there too.

## Known limits

- Capsule shade on high (`cap_floor` 0.3): mean 10.7 % over 4 scenes, at the 10 % floor but scene-dependent (4.2 %
  on Trafalgar), and the darkest pixels exceed 35 % again (max 43.1 %, p99 36.2 %). Mid: mean 9.8 %, max 33.1 %. Of the two
  floors measured, 0.45 met the tail and missed the mean, 0.3 the reverse; nothing in between was tried.
- The real facade (`fid_street_facade`) is off by default and unchanged from 100ae32: at dusk it shows none of build
  28's lit warm windows, and on mid its mortar lines are bright and aliased. It needs that work before it can be the
  default.
- Shimmer: the raw figure the spec names (0.038 mid, 0.051 high) fails 0.01, as build 28 does (0.022); with the camera
  motion taken out it is under 0.01 but 2 to 3.5x build 28's, i.e. the photo paving does shimmer more than the
  stylised paving.
- Skin Delta E: Tavo's mean is 0.51 against the 0.5 limit (max 3.40, one frame); Imani, Kofi and Zuri are 0.00.
- Build time of a place on the farm's CPU is still over the device budget (PLACE.md "Not done").
- The env cube is captured on build 28's street; fid29-lightcam re-captures it on the merged street (merge order).
- Whole-frame ceilings in COMMON.md are for the integrated candidate; b28p already exceeds the mid texture ceiling on
  mm1's monitors.
