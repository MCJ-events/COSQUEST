# fid29-lightcam: light, sky, anti-aliasing, framing and cinematic beats

Branch `fid29-lightcam` on fid29-base (afec3fd). Lane spec: `~/handover/fidelity-29/specs/lightcam.json`. Common gates:
`COMMON.md`. All lane changes sit behind the `fid_lightcam` look key (on for mid and high; low's TIER_LOOK stays `{}`).

## Commits
- b4b680a: two-split soft sun shadows (PSSM2, split_1 0.3, blended; mid PCF5, high PCF13), the Poly Haven cloud sky,
  close-shot shadow tightening, the long lens for the beats, ShaderWarm (draws every registered material once during the loading card).
- a98796b: mid-fight framing from frame_probe trials (pitch, pivot and offsets only, heading untouched); victory winner
  at 72 % of frame height; ASTC sky with triangular blue-noise dither (`tools/look/make_sky.py`); per-place reflection
  cube (32 px mid, 64 px high) captured at the fight centre during the loading card, falling back to the baked cube when
  slow; frame and sky probes; `tests/fid29_lightcam_test.gd`.
- b62b614: close shots move the near plane out to half the camera-to-hero distance, so the first split covers a short
  slice (face shadow texel 3.3 to 3.5 mm intro, 4.75 mm victory; it was 6.28 mm before); the shadow blur narrows to 0.8 in close shots;
  fuller mid-fight frame.
- 1672896: `tools/look/lc_cpu.gd` (C4 CPU timer). Tool only.
- Final commit: this doc (no code).

## What the frame does now (mid and high)
- Sun shadows: PSSM2 at fight distance. In the beats (driven by `_face_fill_update`'s close weight, eased over 0.2 s), shadow
  max distance goes to camera-to-hero + 3 m, bias 0.2 to 0.05, normal bias 3.0 to 0.9, and recv_shadow and kick_a_col go up on every
  fighter ShaderMaterial (the rim, +0.15 EV).
- Lens: intro FOV 52 to about 36 to 41, victory to 32, eased, then a critically damped push-in; on high, 0.15 deg handheld from a
  hash of the frame clock (no RNG). BEAT_* timers and hit_order are untouched.
- Depth DOF in the beats only (13 taps + 1 depth read).
- MSAA 4x on high through TIER_LOOK `"aa"` (mid 2x, low as build 28). Verified in the dumps: `msaa_3d = 2` is the 4x enum.
- Sky: equirect from CC0 Poly Haven pure skies (2048x1024 high, 1024x512 mid), ASTC; low keeps the gradient.
- Glow on high: not shipped.

## Measured (logs under `~/realism-20261111/fid29/lightcam/`)
- Face shadow texel in the beats at b62b614 (game code identical to the final commit): intro 3.32 mm (Imani/Kofi
  street) and 3.49 mm, victory 4.75 mm, in every render log of the dev, held-out and dusk sets (limit 5 mm). PASS. This is the
  analytic texel (`_lc_texel_mm`) from the live split, near plane, FOV and atlas, logged as `CQ lightcam close shadow`.
- Mid logs `filter=PCF5 q=2`, high `PCF13 q=3`.
- Framing (frame_probe, b62b614 commit message): fighters 21 % of the frame (b28 12 %; target 22 %, so 1 point short, FAIL),
  paving 4 % (target at most 20 %), Guardian face in the safe area and no nameplate on a face in every sampled frame,
  victory winner 72 % (65 to 80 %).
- Sky banding after VRAM compression (`sky_runs.gd`): ASTC worst flat run 20 px (limit 24, PASS on iOS and ASTC
  Android); ETC2 fallback up to 761 px (golden_hi), so it FAILS on ETC2-only devices.
- Per-place capture: when it runs, the cube mean is 22 to 23 Delta E from the street cube at Trafalgar and Shoreditch day (11 at dusk),
  logged with its time (300 to 570 ms on llvmpipe). It fell back to the baked cube in 6 of 12 Trafalgar runs and 3 of 24 Shoreditch
  runs on the software GPU.
- ShaderWarm: `registered=1 drawn=166..172` at the loading card; registry coverage is checked by the lane test.
- Lit-skin Delta E in the beats (bin/metrics.py): 0.5 to 5.7, L* up 1 to 5. That is the spec's own +0.15 EV close-shot light, which
  conflicts with "skin Delta E within 1.0". FAIL as measured.
- CPU: `_lightcam_update` 10.2 us a frame in the intro beat, 0.8 us mid-fight (high; mid the same).

## Budgets
See `budgets.md` in the lane folder. Low +0 on every counter. Mid texture +0.7 MB (PASS). High MSAA 4x +45.2 MB at
1170x2532 measured (PASS), other texture +14.1 MB (PASS). Draws and primitives FAIL at mid-fight on mid (+19 / +55k) and high
(+19 / +101k): the three fighters are drawn into both shadow splits.

## Gates on the final code commit (1672896)
- C1: 11/11 records byte-identical to build 28 with fid_lightcam on and off (`final3/records_{on,off}.txt`).
- C2: 557 Godot tests pass. build21 `whirl_ends_facing_target` fails under load as known and passes 39/39 with
  `--fixed-fps 30` (`final3/tests.txt`, `testlogs3/`).
- C3: low counters identical in all 12 dumps. Low frames are not repeatable on llvmpipe: street frames sit inside the
  b28p-against-b28p noise floor, and Trafalgar frames are at the floor (0.14 % against 0.08 %, 1.78 % against 1.77 % of pixels over 8 levels).
- C5/C7: not graded by the lane. The coordinator runs the blind judge.

## Known limits
- Draw and primitive budgets over at mid-fight (see above). Skin Delta E over 1.0 in the beats. Fighters 21 % rather than 22 %.
  ETC2 sky banding. Capture fallback on slow GPUs.
- Step 12 (integration) is the coordinator's.
