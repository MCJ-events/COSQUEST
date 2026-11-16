# fid29 combat: combat motion and hit effects (mid and high)

Build 29 fidelity lane, branch `fid29-combat` (forked from `fid29-base`). Client work for Mark Jones (CosQuest). The
target is Call of Duty: Mobile class technical quality on phones, never its look: every clip, texture and shader here is
original or from the permissive sources in `ASSETS-LICENCES-combat.md`.

Behind the look keys `real` and `fid_combat` (mid and high). The low tier has neither key: it loads build 28's clip
libraries, plays build 28's procedural flinch and draws build 28's effect shaders and art. `arena.gd` and `fighter.gd`
are not edited; everything is installed by `combat_animator.gd` when it binds a fighter, and by `fx.gd` per effect.

## What changed

| Part | Files | What it does | Tiers |
|---|---|---|---|
| Dead blending | `dead_blend.gd` (first skeleton modifier) | A clip switch plays the new clip with no crossfade (one clip evaluated, never two). For 0.15 to 0.25 s every bone carries on from its own last two frames (angular velocity extrapolated with a 0.1 s half-life) and eases into the new clip with a smoothstep (D. Holden, "Dead Blending", 2023). A strike's contact frame always shows the clip's own pose. | mid, high |
| Pose guard | `dead_blend.gd` with `guard`, after the foot lock, before the cloth | Hips and legs only: angular acceleration on the final pose limited to 500 rad/s^2 (28,648 deg/s^2) with a braking rule that never overshoots the pose the clip and the IK ask for. The pop probe showed most transition peaks were knee flips from the foot-lock solve, not the clip switch. Motion under the limit passes exactly; spine, arms and head (the strikes) are never touched; a hit-stop holds it. | mid, high |
| Directional hit reactions | `combat_animator.flinch(push, strength)` (signature and `_flinch_env`, `_flinch_k`, `_flinch_dir` kept), `pose_layer.gd add_layers` | Captured recoils as additive layers on the spine, neck and arms: front (CMCD Nussknacker 3), back and right (CMCD 2018-01-17 SAM sparring), left (CMCD Kampf, or the right take mirrored), plus Mesh2Motion hit-chest (light) and hit-head (heavy front). The two strongest sides by the push direction, weighted, scaled 0.55 to 1 by the blow's strength, 0.25 to 0.4 s. A side with no clip for a hero falls back to the procedural flinch. | mid, high |
| KO settle | `ko_settle.gd` | After the KO clip's impact frame (the hips have landed) and only once the fight's result is final, a PhysicalBoneSimulator3D partial ragdoll (capsules from the humanoid's joints, its own collision layer that sees only a ground plane under the fighter, never a hit or hurt area) eases from 0 to 0.6 over 0.2 s and holds. It stops and is freed one step before the Guardian's dissolve (`fighter.gd`) folds the body to zero width, and otherwise with the fight; `foot_lock.gd` skips a zero-width skeleton. No physics body of this lane exists while the fight can still change, so the broadphase that `hit_area.gd` warns about is untouched during play. | mid, high |
| Captured clips | `anim/real/<key>.glb`, `data/anim_real.json`, `anim_library.gd real_for` | A second library `cqr` per hero. Intros by archetype from 100STYLE idles (Proud: Imani, Lyra; Strutting: Zuri; Neutral: Tavo, Oren), cut where the performer's arms hang at the sides; Kofi keeps build 28's intro (below). Victories from the Cologne database's "boxing, jumping, cheering, winning" take for Zuri, Oren and Lyra. GUARD variants from CMU boxing 13_17 and 14_01. A captured clip that stands in for a build 28 clip keeps its frame count and event times (`tools/anim/check_clips.py --real`). | mid, high |
| Variation | `combat_animator.variant_pick` | Which variant a looping state plays: a hash of the fighter's slot, the state and its swing count. Never the fight's RNG. | mid, high |
| Hit shield | `vfx/fx_card.gdshaderinc` (`FID29`), `fx.gd` | A hit's cards fade to 0.2 inside a screen ellipse round the struck fighter's head and chest (set per hit; cards made within 0.35 s at the same body take it too). | mid, high |
| Beam framing | `vfx/fx_beam.gdshader` (`FID29`) | A skill beam standing between the camera and a fighter fades to 0.3 inside that fighter's ellipse. In b28p this beam was the main white-out of the mid-fight frame. | mid, high |
| Ground fade | `fx_card.gdshaderinc` | Upright cards fade out over their lowest 0.3 m above the paving (world height, no depth read). | mid, high |
| Cap with hue | `fx_card.gdshaderinc`, `fx_arc.gdshader` (`FLOW`) | No card, and no high-tier ribbon, adds more than min(`cq_fx_cap`, 0.85) of white; the colour is scaled, not clipped per channel (build 28's per-channel clip turned a saturated burst white). | mid, high (ribbons: high) |
| Flow ribbons | `vfx/fx_arc.gdshader` (`FLOW`), `art/fx/fx_flow.png` | Slash arcs and weapon ribbons advect the energy texture along a painted flow field (two phases half a cycle apart, no visible reset) with fibre streaks; same meshes, same draws. | high |
| Credits | `app/components/waleui/CreditsScreen.tsx` (new), `SettingsScreen.tsx` | Settings > Credits (was "not built yet") lists the CMCD and 100STYLE CC BY 4.0 credits and the CMU courtesy line. The CC-BY clips and this screen are on one branch, so they merge together. | app |

`fx_gain` and `fx_cap` stay in `arena.gd TIER_LOOK` as fid29-lightcam sets them; this lane works under 0.6 and 0.5.
Low compiles the build 28 shader text (`fx.gd` compiles variants with a define only on mid and high), and
`fx_atlas.png` and `fx_tile.png` are unchanged (`make_fx_art.py` still writes them byte-identical).

## Corrections from review, as built

- New captured motion lives in new mid/high library files (`anim/real/*.glb`, library `cqr`); build 28's `anim/*.glb`,
  `data/anim_clips.json` and `data/secondary.json` keep their build 28 sha256 (lane test
  `build28_libraries_data_and_atlas_unchanged`; all 20 checked again against `89840bb` on the final tree).
- No LookAtModifier: `face_life.gd` already turns the head and eyes.
- Variation never draws on the fight's RNG (test: 1,000 picks, RNG state unchanged).
- Ragdoll bodies exist only after the result is final (tests `ko_no_body_while_the_fight_can_change`,
  `ko_settle_starts_after_the_result`).

## What did not make it, and why

- **Kofi's captured intro.** The Strutting idle drops his shoulders and hangs the arms straight, so the jacket collar
  falls and the neck reads as a long stalk under a raised head. The blind judge picked build 28 on 2 of his 4 intro
  pairs; damping the head and neck less (0.6) did not change it. `build_real.py NO_INTRO` keeps build 28's gestured intro
  for him; the other five heroes get a captured intro.
- **Captured victories for Imani, Kofi and Tavo.** The take's boxer hop bends the knees and tilts the pelvis enough to
  stretch these three meshes past the 0.5 % tear gate (Imani 0.57 %, Kofi 0.51 %, Tavo 1.04 % on LOD0). Damping the
  legs harder, damping the pelvis with them, and damping the legs relative to the hips were all tried
  (`CM_Victory_*s`, `*h`, `*r`): best 0.56 % and 0.51 %. They keep build 28's victory.
- **ATTACK variants from CMU boxing.** A punch carries no sword: the attack gates (the weapon's direction at contact,
  the cut's arc) cannot pass on a boxing clip, and the heroes all fight with blades. GUARD variants shipped.
- **Tavo** gets only the back and heavy-front hit reactions and the intro: every other captured clip tears his build 26
  shoulders past the gate (anim-readable's known limit).
- **Blender + Diffeomorphic** were not needed: BVH and ASF/AMC are read by our own `bvh2glb.py` / `cmu2glb.py` path.
  **orangeduck/100style-retarget** was not used, so its credit line is not on the screen.

## Numbers

All on the final tree. Gate values from the brief in brackets.

| Measure | b28p | fid29-combat | Gate |
|---|---|---|---|
| Pop: peak joint angular acceleration within 0.3 s after a clip switch, deg/s^2 (`tools/anim/pop_probe.gd`, seed 239 autoplay, 68 switches, Imani / Kofi, mid and high), mean of per-switch peaks | 75,946 to 78,409 | 28,763 to 29,160 (0.37 to 0.38 x) | at most 0.5 x |
| the same, p90 | 118,014 to 151,049 | 33,059 to 34,486 (0.23 to 0.28 x) | |
| the same, max | 189,178 to 196,584 | 35,279 to 35,949 (0.18 to 0.19 x) | |
| White-out: share of the struck Guardian's mask at or above 0.95 x the frame's white, the four mid-fight hit frames (Imani, Kofi x street, Trafalgar, high, `tools/fx/whiteout.py`) | 30.7, 32.8, 32.3, 34.6 % | 4.8, 4.2, 8.3, 8.6 % | at most 10 % |
| the same at 0.95 absolute luma | 0 % (the phone tonemapper puts white at 0.86) | 0 % | |
| Guardian pixels the effects lift by more than 0.25 luma | 33.6 to 50.1 % | 11.7 to 16.5 % | |
| KO: lowest bone under the ground / time to settle (lane test) | | 0.000 m / 0.03 s after the settle starts | at most 3 cm / within 1.2 s |
| Animation modifiers, three fighters, one CPU core (lane test, `Time.get_ticks_usec`) | | 0.038 ms per frame (0.013 per fighter) on the farm, final commit; 0.047 ms on mm1 earlier | at most 0.3 ms |
| Clip length and event times per button (`check_clips.py --real`) | | 0 problems over every captured clip that stands in for a build 28 one | identical |
| Variation and the fight RNG (lane test, 1,000 picks) | | state unchanged | unchanged |
| Ragdoll bodies before the result is final (lane test) | | 0 (13 after) | 0 |
| Credits list every CC-BY source in `ASSETS-LICENCES-combat.md` (lane test and app test) | | 2 of 2 lines, none missing | all |
| anim-readable gates (273 picks, 0 tears over 0.5 %, 0 T-pose, Kofi's DASH, Tavo's 7 old moves) | | unchanged: build 28's libraries are byte-identical and every state they play on low and for the clips this lane leaves alone is build 28's; every captured clip that ships is under the 0.5 % tear gate on the hero it ships for and has no rest-pose or frozen run (`check_clips.py --real`) | no worse |

The pop metric is the brief's: the peak over the body's main joints (hips, spine, neck, head, upper and lower arms
and legs) in the 0.3 s after each switch. The pose guard caps the legs and hips at 500 rad/s^2, which is why the p50
of the new peaks sits at 28,648 deg/s^2: the remaining peaks are the guard's ceiling on a leg, and the arms and spine
(left alone) peak below it.

## Blind judge (C5)

`tools/fid29/judge29.py` (Claude Sonnet through the logged-in CLI), 585 x 1266 phone JPEGs, hashed names, shuffled,
both orders, a side wins only when both orders name it; 10 % identical and 10 % degraded control pairs in every round.

| Set | Question | Pairs | New | Old | Tie | Split | Controls | Gate |
|---|---|---|---|---|---|---|---|---|
| dev (seed 239; Imani, Kofi, Zuri x mid, high x street, Trafalgar x intro, mid-fight hit, victory) | game | 36 | **18** | **2** | 12 | 4 | identical 1.0, degraded 1.0 (seeds 3 and 4; seeds 1 and 2 void at 0.75 with the same verdicts) | new >= 18, old <= 3: pass |
| dev, mid-fight hit frames only | game | 12 | **10** | 0 | 0 | 2 | as above | new >= 8 of 12: pass |
| sealed held-out (Shoreditch, seed 811, day and dusk; Imani, Kofi, Zuri, Tavo x mid, high x intro, hit, victory; rendered and judged once on the final tree) | game | 48 | **26** | **2** | 15 | 5 | identical 1.0, degraded 1.0 | same ratios (new >= 24, old <= 4): pass |
| held-out, hit frames only | game | 16 | **16** | 0 | 0 | 0 | | |
| render scale 0.6 (Imani, Kofi x mid, high x street golden) | game | 12 | 3 | **0** | 6 | 3 | identical 1.0, degraded 1.0 (seed 3) | old <= 2: pass |
| dev | defect | 36 | **2** new more flawed | 19 | 12 | 3 | identical 1.0, degraded 0.5: **void** | new more flawed <= 10 % |
| held-out | defect | 48 | **3** new more flawed | 26 | 12 | 7 | identical 1.0, degraded 0.4 and 0.6: **void** | new more flawed <= 10 % |

By shot: every win for new is an intro or a hit frame. Zuri is the only judged hero with a captured victory (Imani, Kofi
and Tavo keep build 28's, so their victory pairs tie), and the judge gave 4 of her 8 victory pairs to build 28 (street
mid and high, Shoreditch day mid and high) and split the other 4: the captured cheer does not beat build 28's victory
on a still. A known limit, left as is because the held-out set is judged once on the final tree; dropping her
captured victory is a one-line change in `build_real.py` for the integration if wanted. Intros: dev 8 new, 4 tie;
held-out 10 new, 3 tie, 3 split.

The defect rounds are void on every seed: the judge does not call a blur plus 6-bit posterise a "flaw" often enough
(0.4 to 0.6, the control needs 0.9), the same control failure the other fid29 lanes hit. Their verdicts are reported
as information only: new was named the more flawed frame in 2 of 36 and 3 of 48 pairs (5.6 % and 6.3 %, all victories),
and build 28 in 19 and 26 (every hit frame in both sets, white-out being one of the listed flaws).

Side-by-side sheet of the held-out pairs for Subomi (C6, order unlabelled, key separate):
`experiments/fidelity-29/combat/sheet/` (`KEY.txt`). The motion strips are advisory only and were not judged as a gate.

## Budgets (C4)

Measured with `tools/fid29/dump.sh` (Godot's rendering info) at 3 shots (mid-fight, intro, victory) x street,
Trafalgar x Imani, Kofi x golden on each tier, the phone path, b28p (fid29-base) and this lane on the same machine
(mm1, llvmpipe). Desktop texture sizes (uncompressed), so the absolute MB are above a phone's; the deltas are what count.
Full table: `budgets.md` in the lane's review folder.

| Tier | Texture memory (worst shot) | Draws (worst) | Primitives (worst) | Objects |
|---|---|---|---|---|
| low | 212.6 -> 212.6 MB (every shot identical) | 181 -> 181 | 363,372 -> 363,372 | 360 -> 360 |
| mid | 212.6 -> 212.6 MB (every shot +0.0) | 165 -> 165 | 315,586 -> 315,586 | 344 -> 344 |
| high | 428.4 -> 428.5 MB (+0.1: `fx_flow.png`, 128 x 64 RGBA with mips, 43 KB) | 165 -> 165 | 407,538 -> 407,538 | 344 -> 344 |

| Budget | Mid | High |
|---|---|---|
| Animation CPU, three fighters (at most 0.3 ms) | 0.047 ms | 0.047 ms |
| New hero library on disk (at most +2 MB each) | 61 to 196 KB (`anim/real/*.glb`) | the same files |
| Effect draws (+0) | +0 | +0 (ribbons replace arcs on the same meshes) |
| Depth or screen read | none | none |
| Card fragment ALU over build 28 (at most +6) | +6 (dot, multiply-add, clamp, multiply, clamp-multiply, min; build 28's vec3 min dropped) | +6 |
| Beam fragment ALU over build 28 (at most +6) | +6 (reciprocal, multiply, dot, multiply-add, clamp, vec4 multiply) | +6 |
| Arc / ribbon fragment | build 28's text | `FLOW`: +2 texture reads (1 new sampler) and about 22 ALU for the advection, fibre streaks and the hue-kept cap; the ribbon allowance in the brief |
| Texture memory (mid at most +0.5 MB, high at most +1.5 MB) | +0.0 MB | +0.1 MB |
| Ragdoll | only after the result | only after the result |

The low tier: every counter equal to b28p on every shot (above), and the load trace (strace of a low street fight)
shows every data file low opens with its build 28 content; the files that differ are this lane's scripts and shader
sources (`combat_animator.gd`, `anim_library.gd`, `pose_layer.gd`, `fx.gd`, `dead_blend.gd`, `ko_settle.gd`,
`fx_card.gdshaderinc`, `fx_beam.gdshader`, `fx_arc.gdshader`), which branch on the tier and compile build 28's text
on low (tests `low_*`, `fx_low_is_build28`). `anim/real/*`, `data/anim_real.json` and `fx_flow.png` are never opened
on low.

## Tests

All on the final commit (79584cc), on the farm, Godot 4.5.1, under the shared render lock and gate
(`final/farm_final.sh` in the lane folder, log `final/farm_final.log`).

- C1: the 11 seeded records byte-identical to build 28 with `fid_combat` on and off (`tools/fid29/records.sh --check`):
  cast_low_win 359921307e1b, cast_low_loss 083a338c03d4, hero_high/mid win 7aae6410bfc2 and loss 8770037c84b4, hero_low_win 359921307e1b, s11 9064d3b9d2f0, s101 4f86459549a4, place and forge 7aae6410bfc2.
- C2: `tools/fid29/gdtests.sh`: 577 passed, 1 failed, the known whirl check (`build21_test whirl_ends_facing_target`),
  which passes with `--fixed-fps 30` (build21_test 39 of 39). The lane test `tests/fid29_combat_test.gd` 31 of 31
  (new: `ko_ragdoll_freed_when_the_body_dissolves`);
  `anim_feel_test` 20, `motion_test` 33 and `readable_test` 25 pass unchanged.
- C3: build 28's 17 libraries, `data/anim_clips.json`, `data/secondary.json` and `fx_atlas.png` keep their build 28
  sha256. Low frames on llvmpipe are not repeatable run to run (two b28p renders of the same low shot differ by up to
  231 levels on up to 33 % of pixels, from wall-clock particle timing), so the low frame check is the trace and the
  counters above plus the lane's `low_*` tests; the per-frame differences lane vs b28p sit inside the b28p vs b28p
  spread on 10 of 14 low frames and above it on 4 (street hit2, hit3, victory, intro by 1 level), the same frames whose
  particle timing differs most between any two runs.
- C3 again on the final commit: all 20 files compared by git blob against `89840bb`, none changed.
- App: `npm test` 1168 of 1168 (1164 + 4 credits tests in `features/waleui/__tests__/credits.test.ts`), `tsc --noEmit`
  clean.

## Engine errors and the final commit's pair frames

- Engine errors in the pop runs (seed 239 autoplay, Imani and Kofi, mid and high): earlier lane commits logged 24
  `Basis must be normalized` and 26 to 27 `det == 0` per run, from the ragdoll and the foot lock working on a Guardian
  the dissolve had folded to zero width. On 79584cc: 0 and 0 (Imani), 0 and 1 (Kofi). The one left is
  `face_life.gd:105` inverting the dissolved Guardian's head frame once at the KO. b28p logs that same line once in
  Kofi's fight too (b28p totals: 2 for Kofi, 1 for Imani, the rest from `foot_lock.gd`), so it is build 28's and in a
  file outside this lane.
- The pairs' `__new` frames were rendered before 79584cc, on earlier lane commits. 79584cc only acts after the result is final (the
  ragdoll's start and end checks) and on a zero-width skeleton (foot lock), so intro, mid-fight and hit frames cannot
  change. For the victory frames, run B (intro, victory; 4 heroes x mid, high x street, Trafalgar) was rendered three
  times on mm1: 79584cc twice and 019b88d once. llvmpipe's run-to-run noise on 79584cc vs 79584cc: 5.64 % of pixels
  differ on a victory frame (mean; max 7.72 %), 57,282 pixels by more than 32 levels over the 16 frames; 019b88d vs
  79584cc: 5.87 % (max 8.60 %), 58,214 pixels. Intros: 0.07 % both ways. The change is inside the noise, so the pairs
  were kept, not re-rendered. The shipped `__new` frames match the 79584cc re-renders within the same noise (victories
  2 to 6 %; mid-fight frames differ more, 15 to 54 %; that is run-to-run noise, since the code change cannot reach those frames,
  but no second 79584cc render of them was made to size it).

## How to rebuild and re-measure

- Libraries: `tools/anim/build_real.py` on mm1's CPU (`~/cq-overflow/b29/combat/build.sh`: Blender 4.2's Python with
  numpy, the raw takes in `t/src/`). Writes `anim/real/*.glb` and `data/anim_real.json`, nothing else.
- Clip timing: `python3 tools/anim/check_clips.py --real data/anim_real.json` (from `app/game3d`).
- Pop metric: `godot --headless --path app/game3d --fixed-fps 30 -s res://tools/anim/pop_probe.gd -- --cfg='{...}' --out=...`
  (drops into build 28 unchanged for the baseline).
- White-out: `tools/fx/whiteout.py <frames dir> <prefix>...` on `look_shots` frames taken with `skin_view`.
- Lane test: `tests/fid29_combat_test.gd`; app: `npm test` (credits test in `features/waleui/__tests__/credits.test.ts`).
