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
| Crystal-Z | clips (cq 014 rig) | staff | 18 of 18 | none (cq 016: WHIRL on `Whirl_Spin`, 0.34 %) |
| Elvis | clips (cq 014 rig) | heavy (greatsword) | 18 of 18 | none (cq 016: WHIRL on `Whirl_Spin`, 0.40 %) |
| Hoof | clips (cq 014 skeleton) | staff | 18 of 18 | none (cq 016: WHIRL on `Whirl_Spin`, 0.02 %) |
| Nebul-X | clips | staff (her own) | 18 of 18 | none |
| Vanessa | clips | gun (rifle) | 18 of 18 | none (cq 016: her heavy and staff sets had no attack_1 that passes, now `1H_Melee_Attack_Stab`, a last alternate in those sets) |

All eight cast play clips. Elvis, Crystal-Z and Hoof use the rigs from cq 014 (the fixed
skeletons, weights and their robe, coat, skirt and wing chains, driven by the secondary sim): see
RIGS.md. The game swaps cq 060's catalogue files for them by sha256 until they are published in the
Forge. Every state's clip and tear, BEFORE and AFTER, is in cq 014's tear table (task evidence).

"Procedural" is combat's CombatAnimator fallback: the character's own cq 060 idle/walk/celebrate
clips plus the procedural spine and arm poses and the body motion (lunge, hop, spin, lean).
The full per-character, per-set, per-state pick is in `app/game3d/data/anim_clips.json`
(`characters.<key>.pick`). Every clip's checks are in `app/game3d/tools/anim/reports/<key>.json`.

### cq 016: WHIRL on a real spin, and the staff hold
- **`Whirl_Spin`** (clips.json): the KayKit spinning attack, retargeted with `damp_rel`: the bones a
  clip or character damps (Elvis's and Crystal-Z's spine at 0.65, the legs at 0 for this clip) take
  their share of the turn **relative to the hips**, not the world. A world-damped leg or spine stays
  behind while the hips turn a full circle and tears the robe (that was the 1.5 to 4.4 % every spin
  clip measured); relative to the hips, the whole body turns with them. With the spin-aware secondary
  sim (RIGS.md) it passes on every LOD: Elvis 0.40 %, Crystal-Z 0.34 %, Hoof 0.02 %. Its hips are
  pinned (`root: zero`): the source sways the hips 0.67 m sideways through the turn, which with the
  legs turning with the hips slid the whole fighter across the street mid-WHIRL (foot slide 3.3 m/s,
  now 1.3 to 1.5). It is the first
  alternate of every set's WHIRL, so a character whose set clip passes (Armstrong, Bobo, Cat-Boy,
  Nebul-X, Vanessa) is unchanged. It carries `spin: true`, so the procedural body spin (`body_alt`)
  does not turn the body a second time on top.
- **The staff hold** (`Staff_Idle`, `Staff_Walk`, `Staff_Run`, `Staff_Hit`, the staff set only):
  KayKit holds a two-handed sword point-down in idle, so a staff in that grip hung orb-down. These
  clips are the same sources with the right forearm and hand turned (`retarget.py staff_upright`) so
  the staff's orb end (the grip's +Y) stands up beside the body, 0.25 forward and 0.12 out, the forearm
  taking 35 % of the turn so the wrist does not break. The grip itself is unchanged, so the attacks
  and skills keep their swing, and no other weapon class changes. Every staff user plays them: Hoof
  and Crystal-Z (Arcane Staff) and Nebul-X (her own staff, modelled in her right hand: the hand turns
  it). A left hand on the upright shaft (two-handed) was tried: it stretched Crystal-Z's left arm past
  the gate (0.75 %), so the idle is one-handed with the left hand by the right, as the source keeps it.

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

## Playback feel (fight-anim, 7 Nov 2026)

Presentation only: the yaw, positions, hitboxes, timings and the judge record are unchanged
(five seeded fights byte-identical before and after; rules id `f3d-1-21d2cde61ab2`).

- **Crossfades in real time.** Godot advances a crossfade with `speed_scale`, so a clip warped
  to 2-3.6x finished its 0.08 s fade in one frame. `play()` asks for `blend x rate`.
- **Wind-up cap.** A clip's wind-up plays at most `WINDUP_RATE_MAX` (1.7x) to land its contact
  frame on the gameplay hit; a faster one starts later in the clip and the fade carries the body
  in. Long wind-ups (the Guardian's 0.8 s) fade in over 30 % of the wind-up, up to 0.25 s.
- **Hit reactions.** A hit clip plays at most `HIT_RATE_MAX` (1.3x): a short hit shows the
  impact and recoil, then `BLEND_RECOVER` (0.26 s) returns to the loop. Every blow also adds a
  recoil on top of whatever plays (`CombatAnimator.flinch`, pose_layer channels, 0.05 s in,
  0.32 s out, away from the blow). `Fighter.react_hit` never cuts a running attack or skill clip
  (the Guardian mid-swing, the ally mid-cast): the recoil shows the hit instead.
- **One-frame snaps in the clips.** `AnimLib.despike` spreads an isolated jump (> 40 deg and 3x
  its neighbours) over three keys at load: 12 on Armstrong, 7 on Bobo, 6 on Hoof.
- **Facing.** The drawn body eases after the fighter's yaw (`Fighter.TURN_RATE`, lag at most
  150 deg); the yaw itself still snaps for the game.
- **Knockback.** While shoved faster than 1 m/s the body leans with the push and sinks a little.
- **Victory.** The cheer settles into the idle loop instead of freezing on its last frame.

Measuring: `"anim_probe": "/abs/out.jsonl"` in a review config writes per-frame animation data
(`tools/anim_probe.gd`, not exported); `tools/anim/probe_report.py` turns it into playback
rates, pose pops, facing snaps, stance-foot slide and transition pops. `tools/anim/loco_measure.gd`
measures each character's walk/run ground speed in place (it agrees with `ground_speed_per_hip`
within about 10 %). Test: `tests/anim_feel_test.gd`.

## Stagger, jog and sprint (autorig, 9 Nov 2026)

Presentation only: the five seeded fights are byte-identical to fight-anim (same md5s) and the rules
id is unchanged. All clips are CC0 (KayKit Adventurers 1.0, Quaternius UAL).

- **The cast source is back.** `build_all.py --cast` needs `pose/<key>/lod0..2.glb + rig.json`. It
  was rebuilt from the shipped `res://cast/<key>_lod*.glb` (cq 014 rigs, cq 239 look) plus cq 060's
  `rig.json` (Hoof's set to `rigged: true`: cq 060 had rejected its first rig, the shipped one is
  cq 014's). With clips.json unchanged, all eight libraries rebuilt byte-identical and the
  characters' fingerprints, picks and tears matched the committed data.
- **Stagger** (`stagger`, new state, every set): `Stagger_Back` = KayKit `Dodge_Backward`
  (alternate `Walk_Back` = `Walking_Backwards`; Elvis plays it: the hop stretches his mesh 0.57 %, past the 0.5 % gate).
  `Fighter.tick_visual` plays it when a knockback shoves the body at 3 m/s or more
  (`STAGGER_V`) and mostly backwards, and no attack or skill clip owns the body. It lasts as long
  as the shove (the 9/s decay is above 1 m/s for ln(v)/9 s) plus 0.12 s, at most
  `STAGGER_RATE_MAX` (1.4x), then blends back like a hit (`BLEND_RECOVER`). A light shove keeps
  only the lean. Root motion is stripped as for every clip: the game still moves the body.
- **Run = the UAL jog, sprint above it.** `run` is `UAL_Jog` (`Staff_Jog` with the staff hold in
  the staff set): 4.0 m/s per metre of hip against Running_A's 2.3, so the hero's 4.6 m/s plays it
  at about 1.03x (Running_A played at 1.8x). `sprint` (new looping state) is `UAL_Sprint` /
  `Staff_Sprint`, used above the geometric mean of the run's and the sprint's ground speeds (both
  then play the same distance from 1x). Nebul-X's jog and sprint and Vanessa's jog tear past the
  run gate, so they keep Running_A/B (Vanessa sprints on `UAL_Sprint`).
- **Subset builds.** `build_all.py --keys <one key>` (a new character) keeps every other
  character and the full cast's contact frames and ground speeds; it only adds clips the data does
  not have yet. A full-cast run recomputes them as before.

## Motion capture overlay, foot lock and the motion bar (realism, 11 Nov 2026)

**Off by default.** A fight config with none of the keys below plays build 21 to the frame. `"motion_realism": true` turns the whole of this section on (captured clips, foot lock by device tier, aim hold, weight, natural KO and cheer speeds, legs animated by the ground really covered); each key below overrides its part. The app does not pass it yet.

**One switch for the clips.** The fight config's `"motion"` is `"classic"` (build 21's KayKit and Quaternius picks) or `"mocap"` (the overlay below on top). Left out, the data's `motion_default` decides (`anim_clips.json`). Both sets ship in the same libraries, so before and after are one flag apart. `anim_library.gd` `motion`, `states_for()`.

**The overlay** (`tools/anim/clips.json` `sets_mocap`, copied to `anim_clips.json`): per weapon set and state, a captured or authored clip and its alternates, picked per character under the same tear gate as the classic clips (`characters.<key>.pick_mocap`). A state with no overlay pick keeps its classic clip.

| state | blade (sword, dagger, axe) | unarmed (new set, `"<role>_class": "unarmed"`) | heavy, staff, gun |
|---|---|---|---|
| idle | `CMU_Idle` (captured stand with weight shifts) | `CMU_Guard` (captured guard) | classic (the weapon holds) |
| run | `CMU_Jog` (captured) | `CMU_Jog` | classic |
| attack 1, 2 | `CMU_Slash_A`, `CMU_Slash_B` (captured forehand and backhand) | `CMU_Punch_L`, `CMU_Punch_R` | classic |
| attack 3, heavy | `CMU_Chop_2H` (captured overhead cut) | `CMU_Strike_Down` | `CMU_Chop_2H` for the heavy |
| hit | `M2M_Hit_Chest` (authored) | same | same |
| stagger, and from behind | `CMU_Stagger_Back`, `CMU_Stumble_Fwd` (captured) | same | same |
| KO, and from behind | `CMU_Fall_Back`, `CMU_Fall_Front` (captured) | same | same |
| victory | `M2M_Victory_Fist_Pump` (authored) | same | same |

`stagger_fwd` and `death_fwd` are library-only states: `fighter.gd` plays them as the stagger or the death when the shove or the killing blow came from behind (`CombatAnimator.variant`).

**Sources.** `tools/anim/cmu2glb.py` turns CMU ASF/AMC takes into a source library (frames per clip in `cmu_clips.json`: cut, 30 frames a second, turned to face +Z by the pelvis or, for a strike, by the striking hand at the contact, floor at the lowest toe, loops closed with a cross-fade). `tools/anim/m2m_merge.py` merges decoded Mesh2Motion clips. `retarget.py --libs cmu=...,m2m=...` reads them with the `cmu_to_mixamo` and `m2m_to_mixamo` maps in `rigs.json`. `tools/anim/build_motion.sh` runs the lot. Licences: `docs/game3d/LICENSES.md`.

**Game side (presentation only; seeded fights are byte-identical with every switch on or off).**
- **Foot lock** (`foot_lock.gd`, config `"foot_ik"`, default on from 5 GiB of reported RAM, the landscape tier rule): a foot the clip holds down is pinned where it touched, in the world, by a two-bone leg IK; a pin that drifts too far from the clip's foot takes a small lifted step to it.
- **Aim hold** (`fighter.gd`, config `"aim_hold"`): a directed attack turns the drawn body onto the heading the swing began with inside 2 to 3 frames and holds it until the blow has landed, whatever the game does to the yaw meanwhile.
- **Weight** (config `"weight"`): the attacker's body leans 11 cm into the blow round the contact; the victim's hips give 7 cm with the flinch.
- **No bind pose**: a stopped player goes back to the idle loop; a skeleton with no clip at all hangs its arms.
- A KO fall plays at most 1.25x and a cheer at most 1.2x (they were squeezed to the game length).

**The motion bar in one command** (`BAR.md` section C): `tools/anim/motion_measure.sh --out DIR [--game TREE] [--trio a,b,c | --forge DIR --trio ...] [--extra '"motion":"mocap"']`. It records the seeded win and loss fights headless with `tools/anim_probe.gd` (v2: the final pose after every modifier) and prints `tools/anim/motion_report.py`: foot slide per step and state, foot speed against body speed, attacks off target, bind and T-pose frames, anticipation and follow-through per blow, hips in a stagger, tear per state and LOD. It works on any build from 18 on (it drops its probe into that tree). Tests: `tests/motion_test.gd`.

### Round 2 (12 Nov 2026)

**Tiers.** The app sets the switches by device tier (`app/features/game/motionTier.ts`, the look tier's RAM lines): high (5 GiB reported and up) sends `"motion_realism": true, "foot_ik": true`; mid (3.3 GiB and up) sends `"motion_realism": true`; low, or unknown memory, sends nothing. With nothing sent the fight is build 21's motion frame for frame (checked field by field on both seeded fights). `EXPO_PUBLIC_MOTION_TIER` = `high`, `mid`, `low` forces a tier.

| | low | mid | high |
|---|---|---|---|
| clips | classic (build 21) | hybrid | hybrid |
| foot lock | off | off | on |
| aim hold, weight (lean, hips give, hit pause, ready pose) | off | on | on |
| run legs under a cast, natural KO and cheer speed, no bind pose, legs by ground covered | off | on | on |

**Hybrid** (`"motion": "hybrid"`, the default with `motion_realism`): the overlay state by state, as `anim_clips.json` `hybrid_states` says (`mocap`, `classic` or `blend`; a state not listed plays its overlay clip). As judged in rounds 2 and 3: the sword's first and second cuts are captured, the third is the classic chop turned 35 degrees onto the target (`aim_yaw_deg` on the clip, applied by the aim hold), the jog is captured, staggers and KO falls are captured, hit reactions are Mesh2Motion's, and the sword idle, the victory and the two-handed heavy are classic. `"ready_pose": false` turns the wound-up stand off on its own. `"motion_states": {"attack_1": "classic"}` in the config overrides single states for A/B runs.

**The upper-body layer** (`combat_animator.gd` `_mix`, opts `run_layer`): when a one-shot starts while the body runs, one mixed clip is built on the spot: the action's upper body on the run's hips and legs, the run carried on from its phase at its rate; the spine is re-expressed so the upper body keeps the orientation the action gives it in the world. The same function builds `blend` states (a captured upper body on the classic clip's lunge, the two contact frames lined up). The foot lock uses its stride reach while such a clip plays.

**Foot lock, round 2** (`foot_lock.gd`): each foot learns its own floor (a captured clip holds one foot a few centimetres higher than the other); the contact point is pinned, not always the ankle (when the heel lifts, the ball of the foot stays and the ankle swings over it); when a planted leg cannot reach, the hips sink (up to 14 cm) instead of the foot being dragged; corrective steps go one foot at a time, cross first and then come down, longer for longer distances; an ease that the clip interrupts never travels along the ground.

**Weight in presentation** (no rules change): a ready pose while a living opponent is within 4.5 m (the sword arm loaded, the trunk coiled 12 degrees), so the first frames of a swing start wound up; an animation-only pause on both bodies on every blow, 25 to 90 ms by damage, on top of the game's own hit-stop; the lean into the blow and the victim's hips giving from round 1.

**Forge and the tear gate.** Auto-rigged Forge characters are held to the strict 0.5 % for attacks too (`build_motion.sh`, `build_all.py --soft_core`: an attack with no clip under the gate falls back to the procedural swing, the character keeps its library). Kade loses all three attacks; Soldier and Samurai lose none.

**The bar's exclusions** (`motion_report.py`): a step is left out of the planted-feet gate when any of its frames has a knockback speed over 1 m/s or is in the stagger, the dodge, CHARGE, WHIRL or SPLIT. Wind-up is scored in seconds: 0.05 s for the first two cuts, 0.10 s for heavy and skill attacks.

### Round 3 (12 Nov 2026)

**A standing fighter stands** (`foot_lock.gd`, `STAND_*`). While the body is not walking or running, a pin that is off by less than 15 cm is never stepped away: the hips move over the feet (half the feet's mean offset, up to 9 cm, slowly) and sink. A larger offset takes one clean step, after the clip has held the foot still for 0.3 s (so a blend back to the stance is waited out), or at once when it is 40 cm off or the leg cannot reach its pin even with the hips sunk. A pin that does not hold the whole foot holds the ball of the foot.

## Readable actions (anim-readable, 13 Nov 2026)

Every button now has its own body action, timed to the existing hit moments and cooldowns, so the rules
(`f3d-2-e872f23a43a5`), the hit windows and every seeded record are unchanged. **On by default on every tier**
(`anim_clips.json` `readable_default`); the fight config `"readable": false` plays build 25's clips (A/B and tests).
Feedback that started it (Adewale, team PM): the effects showed a skill landed, but the body did not do it.

| button | state | what the body does | hit moment (unchanged) |
|---|---|---|---|
| ATTACK | `attack_1..3` | a left-to-right cut from a coiled trunk (`R_Atk1`), a right-to-left backhand turned onto the target (`R_Atk2`), a two-handed overhead slam (`R_Atk3`, or the turned overhead chop `R_Atk3_k` where the slam tears); the off hand comes in | 0.11 s, 0.11 s, 0.235 s |
| SHOOT | `skill_shoot` (new; was `attack_2`) | the shoulders turn side-on and the off hand comes up and out towards the target (32 degrees out and 30 up, so it shows past the body from the camera behind the hero), fires with a recoil (arm kicks up, chest back) and holds the aim for 0.5 s while the body stands; guns: the rifle shot | 0.12 s |
| RAIN | `skill_rain` (new; was `skill_rally`) | the weapon arm and the eyes go up to the sky, then the arm comes down to point at the marked circle as the volleys fall | 0.3 s (the arm is up) |
| DASH | `skill_charge` | a crouch, then a sprint stride leaning 30 degrees into a forward thrust | 0.18 s |
| SHIELD | `skill_shield` | a braced, lowered stance, the off forearm raised like a shield, pushing out as the barrier goes up | 0.2 s |
| SPLIT | `skill_split` | a grounded power slam: the weapon wound up overhead in both hands, the body sinking and driving it into the ground (no jump: Wale found the jump unconvincing and not right for every character; a jump version was built first and is not used) | 0.34 s |
| WHIRL | `skill_whirl` | unchanged: the spin was already a full turn with the weapon out | 0.08, 0.30 s |
| RALLY | `skill_rally` | a crouch, then both arms thrown up with the chest out and the head back | 0.25 s |
| GUARD | `guard`, `parry` | a low block stance with the weapon across; the parry a fast deflection | `PARRY_HIT_AT` |

**How the clips are made.** `tools/anim/compose.py`: a clip in `clips.json` with a `"compose"` entry is built from
other clips already retargeted onto the same character (KayKit, Quaternius UAL, CMU, Mesh2Motion): segments
retimed onto the output frames, bone groups layered from another clip, and turns, arm aims (two-bone IK, in
the character's own forward frame) and hip offsets keyed on top. So one recipe works on every rig, and the
result goes through the same tear gate (worst of LOD0 to LOD2, 0.5 %) and checks as any clip. Each state has a
gentler alternate (`_s`, legs bending less; `_k`, from KayKit's smaller clips) for robes and capes; a character
where none passes keeps what it played before. `clips.json`: `sets_readable` (per weapon set), `hero_poses`
(per faction hero). Composed clips carry `contact` (lands on the game's hit moment through the usual two-piece
warp), `out` (the end of the game-length part) and `tail` (frames that play on past it while the fighter stands
still: SHOOT keeps its aim, RAIN's arm comes down at the circle; a step, a hit or any new state ends it).
The report of each clip has `gates`: the weapon direction at the contact against forward (no backward attacks),
T-pose frames and planted-foot slide per step.

**Wale's notes (13 Nov), same switch:**
- *Grounding* ("levitating, feet not steadily on the ground"): the cause on the side camera was feet resting on
  their toes (the classic idle's front foot 28 to 30 degrees toes-down) while the sole planting kept the lowest point on
  the paving. A `flatfeet` compose op stands a planted foot heel and ball down in the idle, guard, every button and the
  intro. With the readable clips the foot lock, the bind-pose guard, legs animated by the ground covered and the aim hold
  are on by default on every tier (they were mid and high only; the app's tier keys still override). The body's sole planting (build 21, `fighter.gd`
  `_plant_target`) now also holds the third cut, SHOOT, RAIN, SPLIT and the intro beat on the paving
  (`PLANT_READABLE`), and keeps a knockdown from sinking. `fighter.sole_gap()` is the measure (the lowest sole marker
  above the fighter's ground), logged per frame by `tools/anim/button_rec.gd`.
- *Shadows* ("too thick"): the blob and the sun's tail at 55 % of their old opacity, the per-foot contact shadows at
  70 % (they are what says "on the ground"), the real-look disc 15 % smaller (`Fighter.soft_shadows`).
- *Sprint and jog*: `R_Sprint` (Mesh2Motion sprint) and `R_Jog` (CMU jog) with a `pump` op: each hand is driven
  forward and up when the opposite foot is forward and back past the hip when it is behind, elbows bent, the weapon
  arm swinging less than the free one; the stride's ground speed is each character's own.
- *Falls*: the death is the captured fall onto the back (CMU 90_18) on every tier where it passes the gate (it was
  KayKit's stiff arched fall on the low tier); the parried Guardian's knockdown is that fall, a moment on the
  ground and KayKit's get-up.

**Character animation generally** (same switch):
- hit reactions sized to the blow (`fighter.hit_size`): under 80 plays `hit_light`, 110 and more, heavy blows and
  crits `hit_heavy` (the trunk and head thrown back, the hips driven back and down), the rest `hit`;
- the Guardian knocked down and back up (`knockdown`) when a parry staggers it for 1.6 s, where its rig passes the
  gate (else the heavy hit), and a heavy hit for SPLIT's 0.8 s stagger;
- each faction hero's own intro beat and victory (`hero_poses`: Imani salutes and pumps a fist, Zuri charges her
  open hand and raises it, Tavo sets a guard, Oren holds his weapon ready, Lyra opens her arms, Kofi bounces on
  his toes and leaps to celebrate);
- a standing fighter breathes and shifts its weight (an additive sway on the idle and guard);
- a fighter turning on the spot steps round (the walk's legs for 0.32 s) instead of pivoting on planted feet;
- readable clips are drawn facing their target from the first frames to the contact on every tier (`READABLE_AIM`).

**Building.** `tools/anim/build_readable.sh [cast|heroes|forge|all]` rebuilds every library (the cast first: it
recomputes the shared clip data; then the faction heroes with `add_hero.sh` from `HERO_SRC`, then the Forge
proofs). Tests: `tests/readable_test.gd`. Review recordings: `tools/anim/button_rec.gd`.
