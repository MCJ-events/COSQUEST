# Assets and licences: fid29 combat (build 29, combat motion and hit effects)

Every file this lane downloaded or made, where it came from, its licence and what of it ships. Downloaded on
14 Nov 2026 onto mmfarm (`~/realism-20261111/fid29/combat/src/`, about 38 MB; nothing over 1 GB, nothing paid) and
copied to mm1 (`~/cq-overflow/b29/combat/t/src/`) for the CPU retarget. Raw and converted source takes never go into
a repo or a release asset: only the retargeted clips inside the game's own libraries (`app/game3d/anim/real/*.glb`)
ship, and only in a build that also carries the Credits screen (`app/components/waleui/CreditsScreen.tsx`).

The test `app/game3d/tests/fid29_combat_test.gd` reads the `- Credit:` lines below and checks each one is on the
Credits screen word for word.

## CC BY 4.0 sources (visible credit required, changes indicated)

### Cologne Motion Capture Database (CMCD), TH Köln

- Licence: "The motion data files (BVH and C3D formats) and the annotations contained in the Cologne Motion Capture
  Database by TH Köln (University of Applied Sciences) are licensed under a Creative Commons Attribution 4.0
  International License." https://mocap.web.th-koeln.de/about.php , https://creativecommons.org/licenses/by/4.0/
- Credit: "Motion data from the Cologne Motion Capture Database by TH Köln (University of Applied Sciences), CC BY 4.0. Retargeted and edited."
- Files (each `https://mocap.web.th-koeln.de/mocap_data/<name>`, sha256):

| File | sha256 | Used for |
|---|---|---|
| Take_2019-01-09_E_Nussknacker3.bvh | 7f22debe9fe6b5c9ac7947a07ce941de3123bff096720435285f6ecfa67b9b2b | CM_Hit_Front (frames 670 to 712, 60 fps) |
| Take2018-01-17_12.01.06SAM.bvh | faa0d6b49d57394ebc30905a7a7fa75649b37bd9acfa311e65f00e4828c46d38 | CM_Hit_Back (1061 to 1103), CM_Hit_Right (638 to 680) |
| Take_2019-01-09_E_Kampf.bvh | 0386a776c84ceb553d556c67766e64f5427c74b8be19eb7bb27822417130c4bd | CM_Hit_Left (449 to 491) |
| Take_2014-12-16_11.21.47_AM.bvh | a187ddbbd42e9e4ee48c8ad3170b9abe24886aa0ccabe2c0fd211933e84a09a8 | CM_Victory_* (1200 to 1500, 120 fps: "boxing, jumping, cheering, winning"): ships for Zuri, Oren and Lyra; over the tear gate on Imani, Kofi and Tavo |
| Take_2019-01-09_E_Nussknacker1.bvh | 85db6ef37e149c39e78eaa71bf125e8238919ff4bdf03ec582061ed69ea9bc9a | scanned for hits (find_hits.py), not shipped |
| Take_2019-01-09_N_Nussknacker1.bvh, _N_Nussknacker3.bvh, _N_Kampf.bvh | 1ea138c9..., d4a8c10c..., 39360101... | the attacker's side of the pairs, read for timing only, not shipped |
| Take2018-01-17_12.01.06AM.bvh, 12.21.11AM.bvh, 12.21.11SAM.bvh | af7c5040..., 17b5330c..., f19c81fb... | scanned for hits, not shipped |
| Take_2015-11-25_03.02.43_PM_getsShot.bvh, Take_2019-01-09_G4_tod.bvh | 1c5c6244..., b826a1b5... | KO falls, fetched, not used (the KO keeps build 28's clip plus the ragdoll settle) |

### 100STYLE, Ian Mason et al.

- Licence: "For creative or commercial work please credit in an appropriate way. E.g. "The 100STYLE Dataset - Ian
  Mason". This work is licensed under a Creative Commons Attribution 4.0 International License."
  https://www.ianxmason.com/100style/ (Zenodo record 8127870, licence id cc-by-4.0)
- Credit: "The 100STYLE Dataset - Ian Mason, CC BY 4.0. Retargeted and edited."
- Status in this build: the three idles stand in for every hero's intro but Kofi's on the mid and high tiers (clips `ST_Intro_*`
  in `anim/real/*.glb`, mapped in `data/anim_real.json`). The first cuts (frame 300 on) fell inside each take's
  arms-out stretch and read as a T-pose; the cuts below come from stretches with the arms at the sides, and the head and
  neck keep a quarter of the take's turn (the performers look down at the floor).
- Files, fetched one by one from the site's per-file links (never the 1.47 GB zip):

| File | Link id | sha256 | Used for |
|---|---|---|---|
| Proud_ID.bvh | drive 19Or4e2n_RVGSXmUPpN1GCqZkYIIB4hZX | 9e29739d07c5b8d340011907099d11e298182de9280701d76e8497fd6826382b | ST_Intro_Proud_* (Imani, Lyra): frames 1000 to 1106 / 1152 (60 fps) |
| Strutting_ID.bvh | drive 1qREJO0GS2VVULxwDImB4e69QoaZ6Rild | a98391a24acf795cd37310fe5b38af88c3be0ff34bc5e087a29611c68ba45d76 | ST_Intro_Strut_* (Zuri; built for Kofi too but not shipped, see combat.md): frames 1100 to 1206 |
| Neutral_ID.bvh | drive 1Vnz5wnFmOztNzaSBHjSt9v6y0pl0FK8X | 71aead2e3246bdb47a5b839cb3e60e0574e9a1a046c071cc147e2922a35f259f | ST_Intro_Neutral_* (Tavo, Oren): frames 700 to 764 / 796 |

- orangeduck/100style-retarget (CC BY 4.0) was not used: our own bvh2glb.py and retarget.py read the BVH directly, so
  its credit line is not needed and is not on the screen.

## CMU Graphics Lab Motion Capture Database

- Terms: "This dataset of motions is free for all uses." "You may include this data in commercially-sold products,
  but you may not resell this data directly, even in converted form." http://mocap.cs.cmu.edu/
- Courtesy line (asked for, not required; on the Credits screen): "The data used in this project was obtained from
  mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."
- Never in a public repo or a public release asset, raw or converted (check the repo's visibility before any
  tarball is attached).

| File | sha256 | Used for |
|---|---|---|
| 13.asf, 13_17.amc | eb33390b..., f024bfe30728fb01debc868c011df16be5d8cca95e8a734dfe00c59722c4cfd1 | CB_Guard_13 (frames 780 to 884, 120 fps) |
| 14.asf, 14_01.amc | 96a22ac5..., a2648d51ea42461d8667557f8721fa8ff8463341838defdf7c2d32a96f19cba5 | CB_Guard_14 (400 to 504) |
| 13_18.amc, 14_02.amc, 14_03.amc | 46f4cddb..., 33605103..., 3685b067... | fetched, not used |
| 143_23, 144_20, 144_21 (.asf/.amc) | 972ce903..., 42d62fa9..., b2ebfaaf... | already on the farm from the motion lane; read, not used (see combat.md: ATTACK variants) |

## CC0

- Mesh2Motion human set (hit-chest, hit-head), already in the build 28 source library `~/realism-20261111/motion/lib/m2m.glb`:
  "The art assets (3d models, rigs, animations) are all licensed under CC0." https://github.com/Mesh2Motion/mesh2motion-app
  Used for M2M_Hit_Chest (front, light) and M2M_Hit_Head (front, heavy). No credit required.

## Made here (no third-party pixels or data)

- `app/game3d/art/fx/fx_flow.png` (128 x 64 RGBA, 13.7 KB): the high tier's ribbon flow field and fibre mask, drawn by
  `app/game3d/tools/fx/make_fx_art.py` (fixed seed). Project licence.
- Everything in `app/game3d/dead_blend.gd`, `ko_settle.gd`, the shader changes and the tools: our own code. Dead
  blending follows the published method (D. Holden, "Dead Blending", 2023); no code was copied.

## Tools (their licences do not reach the data they write)

- Blender 4.2's bundled Python (numpy) runs our scripts on mm1's CPU; the Diffeomorphic add-on was not needed (BVH is
  read by `tools/anim/bvh2glb.py`, written for this lane).
