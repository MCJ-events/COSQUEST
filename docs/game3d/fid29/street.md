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
  packed ORM); UK facades take `vfx/world_facade_real.gdshader` on `art/world/real/trims`; kerbs get a granite sett
  gutter; fountains and ponds a kerbed granite basin and the real water (`world_water.gdshader` `real_k`, default 0 so
  low is unchanged). High: wall segments within 30 m of the fight get recessed window reveals and sills (capped at
  20,000 triangles).
- **Ground shader**: GGX with Karis' environment BRDF lit from `LookReal.env_for(time)` (read only), normal + ORM,
  world-space detail normal at 1.5 m on high (fades out 8 to 25 m), a decal atlas (gum, cracks, patches, leaves, gully
  grates; 1K on high, 512 on mid) scattered by a hashed world grid in the shader with nothing within 1.2 m of the
  fight centre, damp patches at dusk and night (albedo x 0.55, roughness 0.08, Fresnel reflection of the cube),
  geometric specular AA (Tokuyoshi and Kaplanyan, variance 0.15, threshold 0.2), anisotropic samplers via shader hints
  only (the project's anisotropic level is unchanged).
- **Facade shader**: the same lighting, rain streaks under the sills (ambientCG `Leaking012A`), lit windows by hash.
- **Grounding**: `place_bake.gd` adds a near-fight shade and contact-AO bake (512 px over 48 m); `ground_occluders.gd`
  reads each fighter's Skeleton3D pose after animation (read only), packs 6 capsules per fighter (thighs, shins, feet)
  for up to 4 fighters, and the ground darkens its ambient light by cosine-weighted capsule occlusion within 2.5 m of a
  fighter only. `fid_street_cap: false` switches it off. Every new material goes through `ShaderWarm.add`.
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
| (this doc) | lane doc with the final numbers, tests and records |

A set of tweaks made after the held-out set had been rendered (dusk shade x1.3, a capsule-shade floor, stronger
water ripples) was **not** committed, so the held-out frames stay those of the final commit; it is kept as
`~/realism-20261111/fid29/street/post-heldout-tweaks.patch` for after integration.

## Budgets (C4)

Full table: `~/handover/fidelity-29/street/budgets.md` (tools/fid29 dump.sh, phone path, mm1, 3 shots x street and
Trafalgar x Imani and Kofi x golden x low, mid, high, b28p vs feaf658).

| tier | texture | draws | primitives | budget | verdict |
|---|---|---|---|---|---|
| low | +0.0 MB | +0 | +0 | +0 each | PASS (identical counters) |
| mid | +5.9 MB | +3 | +2,292 | +6 MB, +6, +5k | PASS |
| high | +11.5 MB | +3 | +19,136 | +12 MB, +10, +22k | PASS |

Texture reads (from source): ground mid 6 within 25 m, 4 beyond; ground high 7 within 25 m; facade mid 4, high 5
within 15 m. ALU: 646 vs 400 operators in the Mesa-dumped lit fragment shader (1.6x, budget 2x).

## Numbers (spec acceptance)

Measured on the final tree (feaf658) with `street_probe.gd` on mm1 (llvmpipe, phone path), Imani, street, golden,
against b28p (fid29-base) with the same probe; scripts `metrics.py` and `capm.py` (lane kit,
`~/realism-20261111/fid29/street/kit2/`), probe frames in `~/realism-20261111/fid29/street/probe_mm1/probe/`.

| number | spec | mid | high | verdict |
|---|---|---|---|---|
| paving sharpness 6 to 15 m (Laplacian variance, mid-fight frame) | >= 1.5x b28p | 0.00236 vs 0.00062 (3.8x) | 0.01254 vs 0.00133 (9.4x) | PASS |
| ground shimmer, raw mean abs frame-to-frame luminance, 30-frame orbit | <= 0.01 | 0.038 (b28p 0.022) | 0.051 (b28p 0.023) | FAIL as written (b28p fails it too: the raw figure is mostly the camera's motion) |
| ground shimmer, plane motion taken out (previous frame warped through the ground plane) | (our reading) | 0.0057 (b28p 0.0025) | 0.0095 (b28p 0.0027) | under 0.01, but 2.3x / 3.5x build 28's |
| capsule shade under the feet (0.35 m), mean darker than `fid_street_cap: false` | 10 to 25 % | 9.9 % | 18.6 % | high PASS, mid just under 10 % |
| capsule shade, darkest pixels | never > 35 % | p99 28.7 %, max 31.1 % | p99 43.9 %, max 57.2 % | mid PASS, high FAIL (a few pixels right under the soles) |
| ground_occluders.gd CPU per frame (`Time.get_ticks_usec`, 191 frames) | <= 0.1 ms | mean 0.030, max 0.084 ms | mean 0.025, max 0.058 ms | PASS |
| albedo: non-metal real albedo texels in 0.04 to 0.85 linear luminance | 100 % | `fid29_street_test` albedo_gate: 18 files, 1,114,413 texels, 0 outside | (same files) | PASS (checked on the shipped maps, not on a render debug view) |
| skin Delta E76 vs b28p (face middle, intro and win, 8 frames per hero) | within 0.5 | Imani 0.00, Kofi 0.00, Zuri 0.00 | Tavo mean 0.51, max 3.40 | Imani/Kofi/Zuri PASS; Tavo 0.01 over (one frame's face box catches a moving background) |
| no text or logo in shipped photo maps | none | see below | | PASS (by eye) |

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

## Tests and records (final commit feaf658, mm1 CPU, Godot 4.5.1)

Run by `final_mm1.sh` on mm1 (CPU) on a copy of the game tree whose .gd/.gdshader/.py/.sh and real art match
feaf658 by sha256 (checked 15 Nov 14:10Z), 15 Nov 08:03-08:19Z:

- **Seeded records, all 11, key on** (`records.sh --check`): SAME x11 against build 28 (cast_low win/loss, hero
  high/mid/low win and loss, s11, s101, place, forge). Log `mm1:~/cq-overflow/b29/street/records_on_f.txt`, `rec_on_f/`.
- **Seeded records, all 11, `fid_street: false`**: SAME x11. Log `records_off_f.txt`, `rec_off_f/`.
- **Godot tests** (`gdtests.sh`): 581 passed, 1 failed = the known build21 `whirl_ends_facing_target`; build21 with
  `--fixed-fps 30`: 39/39. `fid29_street_test` 35/35, `place_test` 19/19, `fid29_base_test` 12/12, `look_tier_test`
  24/24. Log `gdtests_f.txt`, per-test logs `testlogs_f/`.
- Copies of these logs: `~/handover/fidelity-29/street/logs/`.

## Known limits

- Road paint beyond 25 m reads 5 textures (its wear mask on top of the 4), one over the far-ground limit of 4; only
  the markings' pixels pay it.
- Shimmer: the raw figure the spec names (0.038 mid, 0.051 high) fails 0.01, as build 28 does (0.022); with the camera
  motion taken out it is under 0.01 but 2 to 3.5x build 28's, i.e. the photo paving does shimmer more than the
  stylised paving.
- Capsule shade: on high the mean darkening under the feet is inside 10 to 25 % (18.6 %), but the darkest pixels right
  under the soles reach 44 % (p99) and 57 % (max), past the 35 % limit; on mid the mean is 9.9 %, just under 10 %. The
  uncommitted `cap_floor` tweak (post-heldout-tweaks.patch) would cap the high tail.
- Skin Delta E: Tavo's mean is 0.51 against the 0.5 limit (max 3.40, one frame); Imani, Kofi and Zuri are 0.00.
- Mid texture memory is +5.94 MB against +6 MB: no headroom.
- Build time of a place on the farm's CPU is still over the device budget (PLACE.md "Not done").
- The env cube is captured on build 28's street; fid29-lightcam re-captures it on the merged street (merge order).
- Whole-frame ceilings in COMMON.md are for the integrated candidate; b28p already exceeds the mid texture ceiling on
  mm1's monitors.
