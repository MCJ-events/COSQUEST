# Build 29 fidelity lanes: the common base and gates (fid29-base)

Client work for Mark Jones (CosQuest). Target: Call of Duty: Mobile class technical fidelity on phones, never its look,
characters, assets, maps or UI. Everything shipped stays original.

Every fid29 lane forks from `origin/fid29-base`, works behind its own look key, and must pass the gates below on its
final commit. The base changes no phone pixel and no fight record.

## What fid29-base is

| Part | Where | What |
|---|---|---|
| Shadow parity | `project.godot` | the desktop keys take the phone values: `directional_shadow/size=2048`, `soft_shadow_filter_quality=0` (hard), so farm stills show what phones show. The `.mobile` keys, `import_etc2_astc` (on) and the anisotropic level (4x) are build 28's. On the farm, mid frames now have phones' hard 2048 shadow; high keeps its runtime soft filter on a 2048 atlas. |
| Lane keys | `arena.gd TIER_LOOK` | mid and high gain `fid_street`, `fid_dressing`, `fid_heromaps`, `fid_charshade`, `fid_combat` = true. Low stays `{}`. `fid_lightcam` is added by its own lane. `tests/look_tier_test.gd` checks it. |
| Seam: street floor | `street_real.gd` (fid29-street) | `StreetReal.apply_floor(arena, look, floor_mat, medallion_mat)`, called by `arena.gd` once the paved floor and the medallion (or a place's faction ring) have their materials. A no-op at base. |
| Seam: hero files | `hero_files.gd` (fid29-heromaps) | `HeroFiles.pick(path, role, look)`, called by `fight.gd` after the hero cast and the tier's detail level chose a file. Returns `path` at base. |
| Seam: shader warm-up | `shader_warm.gd` (fid29-lightcam) | lanes call `ShaderWarm.add(material)` for every material they add; `fight.gd` calls `ShaderWarm.warm(fight)` under the loading card. At base it only empties the registry. |
| Shots | `tools/look_shots.gd` (frozen) | the phone path (`tools/fid29/shots.sh --phone`: a 1170x2532 window, the tier's own render scale and MSAA, Godot's upscale, the HUD composited), contact frames (`hit_frames`), 6-frame strips (`strips`), named crops per fighter (`crops`: face, eyes, hair, torso, legs, hand_l, hand_r, ground) and a 30-frame slow orbit (`orbit`, `beat_orbit`, `win_orbit`). |
| Audit kit | `tools/fid29/` (frozen) | `gate.sh` (farm and mm1 gates), `shots.sh` (frames), `dump.sh` + `fid29_audit.gd` (frame cost: draws, primitives, objects, texture and video memory, textures and triangles by owner), `sumdump.py`, `maskmeasure.py`, `sheet.py`, `crops.py`, `phone_jpeg.py`, `gdtests.sh` (all Godot tests), `records.sh` + `records.txt` (the 11 records), `judge.json` + `judge29.py` (the blind judge), `places/` (ground documents). |
| Frozen | | `tools/look_shots.gd`, `tools/fid29/**`, `tools/anim/motion_measure.sh`, `tools/anim_probe.gd`: nobody edits them after the base. |

## Where things run

- **mmfarm**: lane worktree `~/realism-20261111/fid29/<lane>/` from `origin/fid29-base`. Renders with
  `~/lookfight/bin/godot` under `xvfb-run` through `flock ~/realism-20261111/fid29/render.lock` and `tools/fid29/gate.sh`
  (1-min load <= 24, MemAvailable >= 6 GB, vmstat si+so < 100 pages/s, one heavy process of yours at a time). The farm
  GPU only inside `gpulock` (AIMM and live Forge first). Leave `~/vp` alone.
- **mm1**: CPU only, in `~/cq-overflow/b29/<lane>/`, `FID_HOST=mm1 gate.sh` (load <= 16, MemAvailable >= 8 GB). Never
  AIMM, Ollama, the renderer, the FLUX sidecar or mm1's GPU. mm1 has no GitHub access and no route to the farm: copy
  trees through the Mac as a stream (`ssh mmfarm 'tar c ...' | ssh mm1 'tar x ...'`), never onto the Mac's disk.
- **The Mac**: no clone, build or render. Only 585x1266 judge JPEGs (`phone_jpeg.py`); keep 4 GB free and delete them
  after judging.
- No download over 1 GB; every asset in `docs/game3d/fid29/ASSETS-LICENCES-<lane>.md` (URL, quoted licence line, date,
  sha256, attribution if CC-BY). Only CC0, CC-BY, MIT, Apache-2.0, BSD class licences.
- All new visual randomness from local hashes or a locally seeded `RandomNumberGenerator`: never global
  `randf`/`randi`, never the fight's RNG. No game logic reads anything a lane adds.
- Commits under Subomi's identity, no Co-Authored-By or "Generated with" lines. Push only `fid29-<lane>`. Nothing deployed,
  released or sent.

## The 11 records (`tools/fid29/records.sh`, `records.txt`)

Derived on build 28 (`89840bb`) and confirmed identical on fid29-base (mm1, Godot 4.5.1, CPU):

| Record | What runs | md5 |
|---|---|---|
| cast_low_win / cast_low_loss | low tier, cartoon cast | 359921307e1b / 083a338c03d4 |
| hero_high_win / hero_high_loss | high, faction heroes (Imani), motion realism, foot IK, lod0 | 7aae6410bfc2 / 8770037c84b4 |
| hero_mid_win / hero_mid_loss | mid, the same at lod1 | 7aae6410bfc2 / 8770037c84b4 |
| hero_low_win | low tier with the faction heroes at lod1 | 359921307e1b |
| hero_high_s11_win | high, seed 11 | 9064d3b9d2f0 |
| hero_high_s101_win | high, seed 101 | 4f86459549a4 |
| hero_high_place_win | high, the real Trafalgar Square place | 7aae6410bfc2 |
| hero_high_forge_win | high against a shipped Forge Guardian (fk_83421efe_v1) | 7aae6410bfc2 |

Several records share an md5: the record is what happened in the fight (outcome, hits, damage, times), which never
depends on the tier, the place or the models. That is the point of the gate. They are still separate runs: each one
loads a different tree of files and would catch a lane that let presentation touch the rules there.

`records.sh --game <tree> --out <dir> --check` compares against `records.txt`; `--look '{"fid_x": false}'` runs them
with a lane's key off. Run on mm1: `FID_HOST=mm1 GODOT=... WEAPON=... FID_FORGE=...` (the Forge fixture and the sword
are copied there; on the farm they default to `~/realism-20261111/fid29/fixtures/` and `~/fightanim/weapons/`).

## The b28p baseline

Rendered once from fid29-base into `mmfarm:~/realism-20261111/fid29/baseline/` with `tools/fid29/shots.sh --phone`
and `dump.sh`: frames, crops, contact frames, strips, counters, records. Every lane compares against b28p, never the
audit's desktop-shadow frames.

- **dev set** (seed 239): Imani, Kofi, Zuri, Tavo x mid, high x street, Trafalgar x golden; Imani and Kofi also day
  and dusk; low (Imani, street and Trafalgar) for C3.
- **sealed held-out set** (seed 811): the real place **Shoreditch** (`places/shoreditch.json`), never rendered during
  development, day and dusk, the six heroes x mid, high. No lane renders Shoreditch or seed 811 before its final commit.
- **render scale 0.6 subset**: 12 shots at render scale 0.6 (what dynamic resolution gives under load).
- `baseline/INDEX.md` lists every file.

## Common gates (every lane, final commit, against b28p)

- **C1** the 11 seeded records byte-identical, with the lane's fid_* key on and off.
- **C2** all 533 Godot tests pass plus the lane test (`gdtests.sh`; build21's whirl check with `--fixed-fps 30`);
  existing tests extended, never relaxed except where a lane names it; place_test's build_under_1s timing check re-run
  alone if it fails under shared load.
- **C3** low: frames byte-identical to b28p at intro, mid-fight, victory on street and Trafalgar (if llvmpipe proves
  non-deterministic, max per-pixel difference within the noise floor of two b28p renders, never a mean); a load trace
  shows every file low opens has its build 28 sha256 except a lane's named exceptions; every low counter (texture,
  video memory, draws, primitives, objects) at or below b28p.
- **C4** budgets with `tools/fid29` at 3 shots x street and Trafalgar x Imani and Kofi x golden, plus shader texture
  reads and ALU per variant from source and CPU ms per frame of any new script (3 fighters, `Time.get_ticks_usec`),
  written in the lane doc.
- **C5** judge: frames from the frozen phone path, `judge29.py` (Claude Sonnet via the logged-in CLI), hashed names,
  shuffled, both orders, a win only when both orders agree. Every game-frame pair asks "Which screenshot looks more like
  a top-tier realistic mobile game? Judge rendering quality only." and the defect question "Which shows more visible
  flaws (shimmer, stair-steps, smears, seams, broken geometry, white-out)?". Each round mixes in 10 % identical pairs
  (must tie or split in at least 90 %) and 10 % degraded b28p pairs (blur sigma 1.5 plus 6-bit posterise; must lose in
  at least 90 %); a round that fails a control is void. Lane thresholds apply to the dev set during work; on the final
  commit the sealed held-out set is judged once and must meet the same pass ratios; 12 pairs re-rendered at render scale
  0.6 must not favour old (old wins at most 2); new is judged more flawed in at most 10 % of pairs.
- **C6** a side-by-side sheet of the held-out pairs (order unlabelled, key separate) under
  `~/Desktop/cosquest-review/realism-20261111/experiments/fid29-<lane>/` for Subomi's own eyes; not sent.
- **C7** after merging into build-29-candidate, the lane's held-out pairs re-run on the candidate keep at least 80 % of
  the lane's new wins.

## Whole-frame ceilings (the integrated candidate, phone shadow settings, all lanes together)

High at most 240 MB texture memory, 230 draws, 420k primitives including shadow passes; mid at most 140 MB, 210 draws,
330k primitives (mid is 126 to 149 MB today, so this ceiling depends on fid29-heromaps' savings); low no counter above
b28p.

## Merge order (fid29-lightcam integrates last)

heromaps, charshade, street, dressing, combat, lightcam; then the env cube is re-captured on the merged street and the
whole-candidate ceilings and every lane's C7 are re-checked.
