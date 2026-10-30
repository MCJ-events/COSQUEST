# Combat clips for the cast (cq 012)

The cast (Armstrong, Bobo, Cat-Boy, Crystal-Z, Elvis, Hoof, Nebul-X, Vanessa) fight with
real animation clips in the Godot fight: a three-hit combo, the boss's heavy strike, a hit
react, guard, parry, dodge, one clip per skill (CHARGE, SPLIT, WHIRL, RALLY, SHIELD), death,
victory, and idle/walk/run. The clips are CC0 and retargeted offline onto each character's
own skeleton. The game picks them per weapon class and per character, and lines each clip's
contact frame up with the hitbox. This page covers how that works and how to change it.
Commando, Blade, Killua and P-Mon are out of scope and are not touched.

## Who plays what

| character | status | weapon set | states on clips | falls back |
|---|---|---|---|---|
| Armstrong | clips | heavy (warhammer) | 18 of 18 | none (cq 014's trouser weights: Death_A 0.07 %, the two-handed swings pass) |
| Bobo | clips | blade (war axe) | 18 of 18 | none (cq 014's rig: walk, run, guard, dodge, death and WHIRL now pass) |
| Cat-Boy | clips | blade (dagger) | 18 of 18 | none |
| Crystal-Z | clips (cq 014 rig) | staff | 17 of 18 | WHIRL: no spin or slice under the gate (best 0.92 %), so the procedural spin plays |
| Elvis | clips (cq 014 rig) | heavy (greatsword) | 17 of 18 | WHIRL (best 0.56 %): procedural spin |
| Hoof | clips (cq 014 skeleton) | staff | 17 of 18 | WHIRL (best 0.66 %): procedural spin |
| Nebul-X | clips | staff (her own) | 18 of 18 | none |
| Vanessa | clips | gun (rifle) | 18 of 18 | none |

All eight cast play clips. Elvis, Crystal-Z and Hoof use the rigs from cq 014 (the fixed
skeletons, weights and their robe, coat, skirt and wing chains, driven by the secondary sim): see
RIGS.md. The game swaps cq 060's catalogue files for them by sha256 until they are published in the
Forge. Every state's clip and tear, BEFORE and AFTER, is in cq 014's tear table (task evidence).

"Procedural" is combat's CombatAnimator fallback: the character's own cq 060 idle/walk/celebrate
clips plus the procedural spine and arm poses and the body motion (lunge, hop, spin, lean).
The full per-character, per-set, per-state pick is in `app/game3d/data/anim_clips.json`
(`characters.<key>.pick`). Every clip's checks are in `app/game3d/tools/anim/reports/<key>.json`.

## Files

| what | where |
|---|---|
| clip libraries (skeleton-only GLB, one per character with clips) | `app/game3d/anim/<key>.glb` (imported as "keep": shipped as bytes, read with GLTFDocument) |
| clip data: sets, picks, contact frames, ground speeds, fingerprints | `app/game3d/data/anim_clips.json` |
| clip-matched grips (weapon in hand through the clips) | `app/game3d/data/attach.json` `characters.<key>.clip_grips.<class>` |
| run-time loader | `app/game3d/anim_library.gd` |
| state machine (blends, time warp, locomotion rate) | `app/game3d/combat_animator.gd` |
| retarget (numpy on the glTF data, run with Blender 4.2's Python) | `app/game3d/tools/anim/retarget.py`, `gltf.py` |
| build everything | `app/game3d/tools/anim/build_all.py` |
| bone maps | `app/game3d/tools/anim/rigs.json` |
| clip choices, alternates, trims, holds, damping | `app/game3d/tools/anim/clips.json` |
| review renders (per-state frames, turntable) | `app/game3d/tools/anim_review.gd` |

## Sources (CC0)

- **KayKit Adventurers 1.0** (Kay Lousberg): the combat set (1H and 2H melee, ranged, block,
  block-hit, dodge, hits, deaths, cheer, spellcasts). It is read from `Knight.glb` (the rig is
  the same in all four characters), and the hand slot transforms come from `Knight.glb` and `Rogue.glb`.
- **Quaternius Universal Animation Library** (standard, free): realistic idle, walk, jog,
  sprint, hit, death (`AnimationLibrary_Godot_Standard.gltf`).

Sources and licences are in `docs/game3d/LICENSES.md`.

## Retarget

For each target bone b and frame t, in glTF world space:
- `D(t) = S_b(t) * S_b(rest)^-1`: the source bone's world rotation since its rest;
- `A_b = from_to(target rest direction, source rest direction)`: the rest-pose correction
  (the cast rest in an A-pose, the sources in a T-pose); bones with no clear direction take
  their parent's;
- `T_b(t) = D(t) * A_b * T_b(rest)`, then `local = parent(t)^-1 * T_b(t)`.

Other rules:
- Bone maps: `rigs.json`. KayKit has no neck or shoulder bones, so the neck takes a slerp of
  chest and head, and the shoulders follow the chest.
- **Root motion: stripped consistently.** The horizontal hips motion loses its straight line
  from the first to the last frame, so every clip ends where it starts. The in-place sway is
  kept, and the fight moves the body (CHARGE, dodge, walking).
- **Feet on the floor.** Each frame, the lowest target foot is put where the source's lowest
  foot is (scaled by hip height), so different leg proportions neither sink nor float.
  Vertical motion (hops, deaths) is kept.
- **No foot sliding.** Each walk and run clip stores its ground speed per metre of hip height
  (`ground_speed_per_hip`). The game plays it at `speed / (ground_speed_per_hip * hip height)`,
  clamped 0.5 to 2.4, and switches walk to run at 1.8 times the walk's speed.
- **Why not Blender's importer and exporter:** a glTF round trip through Blender re-orients
  every bone, so the clips would not match the Forge GLB's node frames that the game loads.
  The maths runs on the glTF data itself and writes a skeleton-only GLB with the
  character's exact joint nodes and rest.
- **LODs:** cq 060's LOD0, 1 and 2 share one skeleton, so one library drives every LOD
  (checked with LOD0 and LOD1 renders).

## The tear gate (cq 060's)

Each clip is skinned on the character's own mesh (numpy linear blend skinning, every third
frame), on LOD0, LOD1 and LOD2, and the worst of the three counts. On a rig with secondary chains
(cq 014: robes, coats, skirts, wings) the chains move as the game moves them (the secondary sim's
numpy twin, RIGS.md); the number with the chains rigid is kept beside it in the reports. A clip "tears" when more than **0.5 %** of triangles have an edge stretched past
2.5x. This is cq 060's own measure, and it reproduces 060's numbers to within 0.04 %. Run
clips get **1.0 %**: a walk sped past 2x skates visibly, while a run's brief stretch at speed
does not read at the fight camera.

Per weapon set and state, the build tries the set's clip, then its alternates in
`clips.json`, and keeps the first under the gate. A state left with none falls back for that
character only: a loop to its own cq 060 clip, anything else to the procedural pose. A
character whose own weapon set has no clean idle, attack 1 to 3 or hit is marked procedural
as a whole ("rig tears"). Robes, skirts and baggy trousers stretch between the legs on
wide stances, so some characters and clips take only part of the source's leg rotation
(`damp`, `damp_legs` in clips.json).

## Weapons in hand

The weapon stays parented to the hand bone (`hold_weapon()`, cq 234), so it cannot drift.
For the clips, the grip matrix comes from the source's own hold. If KayKit holds its
reference weapon in `handslot.r` with rotation `L`, the hand-space rotation that gives the
same world orientation in every frame is `(A_hand * T_hand(rest))^-1 * S_slot(rest) * L`. It
is the same constant for every frame, and the translation is the cq 234 palm point. The
result per character and class is `attach.json` `characters.<key>.clip_grips`. `fight.gd`
uses it instead of the idle-fitted grip whenever the fighter plays library clips. The holds
per class (slot, rotation, reference axes, an optional extra rotation or offset) are in
`clips.json` `holds`. Every pack shares one frame (+Y tip, +Z edge), so a class holds its
weapon the way KayKit holds its sword (melee, staff) or crossbow (rifle, crossbow).

A class's hold can be turned a little to keep a big swing clear of the body. The hammer,
axe and dagger are tilted 10 degrees back about their own X, and the rifle is turned 20
degrees about its top axis. With that, no character's own weapon goes more than 3 cm into
its body in any state it plays (`evidence/tests/weapon_clipping.txt` in the task workdir).

Checks per clip and class are in the reports: the deepest point of the weapon inside the
body (capsules fitted to the mesh), the frames past 3 cm, and the left hand's distance to the
haft.

## Timing: the contact frame is data

- `anim_clips.json` `clips.<name>.contact` is the frame where the weapon strikes. For a strike
  clip it is found from the source: the frame where a 0.9 m stick in the right hand moves
  fastest inside the strike window. Casts set it by hand in `clips.json`.
- The fight passes the gameplay moment of the strike to `fighter.act(state, length, hit_at)`:
  the middle of the combo hit's hitbox window, `SKILL_HIT_AT` for skills, the boss's wind-up
  for `heavy`, `PARRY_HIT_AT` and `BOLT_HIT_AT`.
- The animator warps the clip in two pieces (one speed up to the contact frame, one after),
  so the contact frame shows exactly when the hitbox is live. The gameplay numbers stay
  combat's; the art follows them.
- `in` / `out` trim a clip. Attacks end 10 frames after contact, and the next state's
  crossfade covers the return.

## Blends and cancels

- Crossfades are `BLEND_ACT` 0.08 s into a one-shot, `BLEND_HIT` 0.08 s into a hit react,
  and `BLEND_LOOP` 0.15 s back to idle, walk or run.
- A combo hit chained inside combat's window (70 % of the swing) restarts the next attack
  clip with a 0.08 s crossfade.
- A hit react interrupts whatever plays. Death holds its last frame and ends the round as
  before.
- Hit-stop freezes the clip.

## How to change things

- Another clip for a state: edit `clips.json` `sets.<set>.<state>` (or its `alt` list), then
  run `build_all.py`.
- Another character: give it a `pose/<key>/lod1.glb` + `rig.json` (cq 060 layout) and run
  `build_all.py --keys <key>`. The skeleton fingerprint is written to the data, so the game
  recognises the model from any source (Forge catalogue or bundled) without a key in the
  config.
- A grip per class: `clips.json` `holds.<class>` (`extra_rot` quaternion in the weapon's
  frame, `offset` metres in the hand's), then rebuild. The result lands in attach.json only.

```
BPY=~/cq-work/tools/blender-dl/blender-4.2.9-linux-x64/4.2/python/bin/python3.11
$BPY app/game3d/tools/anim/build_all.py --src <KayKit>/Knight.glb \
  --src_ual <UAL>/AnimationLibrary_Godot_Standard.gltf --cast <cq 060 models dir>
```

It takes about 5 minutes on the CPU for the eight characters (25 under the load of a second task); `--cast` takes the fixed rigs from cq 014 (`pose/<key>/lod*.glb` + `rig.json` per character, see RIGS.md).
