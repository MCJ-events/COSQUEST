# The fight's look: light, materials, post (cq 015)

How the street and the fighters are lit, what each piece costs, how to tune it, and what the
headless llvmpipe captures cannot show. EFFECTS.md has the skill and hit effects; COMBAT.md the
gameplay, camera and frame budget.

## Files
| File | What |
|---|---|
| `arena.gd` | The WorldEnvironment (sky ambient, tonemap, fog, optional glow and grade), the key light, the street, its glows, halos, baked shade and AO. `LOOK_DEFAULTS`, `KEY_*`, `SIGN_HALO`, `SHADE_COL`, `AO_COL` at the top |
| `vfx/char_lit.gdshader` | The fighters' material: their own glTF textures plus the key-side rim and the hit flash in one pass |
| `fighter.gd` | Converts each fighter's materials to `char_lit` (`_apply_overlay`, `_lit_material`), drives the flash, the contact and sun-cast blob shadows (`_build_shadow`). `RIM_*` at the top |
| `vfx/facade.gdshader` | Shop fronts: lit windows (glass swatches of the Kenney atlas glow warm), contact shade at the foot of the wall |
| `fight.gd` | `_spawn` passes the look's rim switch and the key direction to each fighter |

## The renderer (what the device has)
- Devices run Godot 4.5.1's **Compatibility renderer** (GLES3): `godotArgs` passes `opengl3` on
  Android and iOS; `project.godot` sets `gl_compatibility` for desktop and mobile.
- In that renderer, tonemapping, fog and the sky ambient are computed in the scene shader, per
  pixel, with no extra pass. Glow, BCS adjustments and a colour-correction LUT exist (the 4.5.1
  binary carries `GlowShaderGLES3` and `PostShaderGLES3`), but any of them turns on a **post pass**
  over the whole screen at full resolution, plus the glow's blur chain.
- There is no SSAO, SSR, SSIL, SDFGI or volumetric fog. Directional shadows exist (PCF).

## The environment (`arena.gd build`)
| Piece | Setting | Why |
|---|---|---|
| Background | colour (never seen: the camera looks down at 44 deg) | |
| Ambient | a dusk sky, cheaply: the environment's flat ambient is the sky straight up (`SKY_UP` `(0.6, 0.66, 1.0)`, energy 0.85), and the fighter and facade shaders add the rest of the hemisphere (`SKY_HORIZON` lilac on walls, `SKY_GROUND` warm bounce underneath) as an ALU term (`set_hemi`, `hemi_*` uniforms) | The paving faces up, so it gets the blue-violet sky; walls get the lilac horizon; fighters' undersides the warm bounce: the cool shade of the reference, not flat grey. Godot's own sky ambient (`"sky": "cube"`, a `ProceduralSkyMaterial` with a 32 px radiance map) looks the same but reads two cubemaps a pixel |
| Tonemap | ACES, exposure 1.0, white 6 | Compared with Filmic and AgX at the same light: ACES is closest to the reference (luma 158 vs 166, saturation 0.26 vs 0.23); Filmic and AgX go dull and dark (luma 137 and 129) |
| Fog | **off by default** (`look.fog`): depth fog 21 to 64 m, curve 1.6, density 0.85, colour `(0.86, 0.66, 0.74)`, sun scatter 0.5 | A warm lilac haze up the far street. Barely visible at the top of the frame for about 3 % of the frame on the software GPU, so opt-in; a warm low-sun pool on the far paving (`SUN_GLARE`) does part of its job |
| Glow | **off by default** (`look.glow`) | Post pass: see Costs |
| Grade | **off by default** (`look.grade`): BCS (contrast 1.04, saturation 0.9) and a 256 px split-tone ramp (violet shadows, gold highlights) | Post pass: see Costs. The grade is in the light and material colours instead |

## The lights
- **One directional key**, the low evening sun: `KEY_ROT` (-34, -128, 0) (from up the street on
  the left, where the reference's haze sits), colour `(1.0, 0.74, 0.46)`, energy 1.35, no shadow map.
- **No fill light**: a second directional light is shaded on every pixel (cq 011 measured about 2 ms a
  frame on the software GPU); the sky ambient is the fill.
- **No omni lights**: the light that lamps, signs and windows cast is faked with cards:
  - lamp heads: a glow quad and a 2.4 m halo (one mesh with the sign halos), a light cone, a warm
    8 m pool on the paving (alpha 0.42);
  - the low sun: a big warm pool on the far paving (`SUN_GLARE`, in the halo mesh), the reference's
    glare at the top of the street;
  - neon blade signs: the sign (unshaded, 1.35x so the tube reads as lit after the tonemap; brighter
    washes the words to white) and a
    halo in its own colour behind it (`SIGN_HALO`), drawn first (`render_priority` -1);
  - shop windows: the facade shader's glass emission (`window_k` 3.0) and the warm spill on the
    paving (`shop_glow`).
  All of these are one merged mesh per kind (signs and spills per side), so a handful of draws.

## The fighters (`char_lit.gdshader`)
- Each surface of a fighter's model is rebuilt on `char_lit` with the same textures and factors
  (base colour x factor, glTF metallic-roughness texture with its channels), so the character art is
  unchanged. A surface that is not a plain opaque `BaseMaterial3D` (transparent, unshaded, normal or
  emission maps, vertex colours, two-sided) keeps its own material and the old overlay pass.
- **Rim:** `fresnel^2.5 x rim_amount`, warm `(1.0, 0.8, 0.55)` on the side facing the key light
  (computed from `key_dir` in view space), the team colour at 45 % on the other side (boss red, hero
  green, ally blue). `RIM_AMOUNT` 1.7, `RIM_BOSS` 1.8, `RIM_TEAM` 0.45 in `fighter.gd`.
- **Hit flash:** the same terms as cq 013's `flash.gdshader` (a white-hot core at the peak, a warm
  fresnel rim as it decays), now in the material's emission. `fighter.flash()` is unchanged.
- This is what cq 011 could not afford: its team rim was a second pass over every skinned vertex
  (`material_overlay`). Now the rim costs a few ALU per pixel and no draw, and the hit flash no longer
  adds a pass while it shows.

## Shadows and contact shade
- **Fighters:** the soft contact blob (cq 233) now carries a sun-cast tail: one longer quad (1.5 x
  3.4 m) with a texture drawn once at load (`_sun_blob_tex`: the old contact disc plus a soft tail
  leaning away from the key light), top level so it keeps the sun's heading as the fighter turns.
  Still one draw a fighter.
- **Walls:** the shop fronts darken towards the paving (`ao_height` 1.6 m, `ao_min` 0.55 in
  `facade.gdshader`). On the paving, a 0.9 m contact band at every wall's foot and the left blocks'
  shade (as wide as half the block's height, 2.5 to 4.5 m, leaning along the sun, soft at the gaps)
  are **baked into the ground mesh's vertex colours** (`_shade_at`, `_bake_ground`): the ground is a
  sparse grid over the street (0.3 m steps near the walls, open in the middle, 2.2 m along the
  street). A first, denser grid (0.35 x 0.7 m, ~6k triangles) cost more than a multiplied overlay
  on the software GPU (every triangle has a set-up cost there), hence the sparse one.
- **Dusk depth:** up the street (z -4 to -24, beyond the fight) the paving and the shop fronts cool
  towards `DUSK_COL` (blue-violet), baked into the same ground vertex colours and a term in
  `facade.gdshader` (`dusk_col`, `dusk_z`), so the far street reads as dusk while the lamps, signs
  and the warm low-sun pool (moved to the left) stay warm, as on the reference. No extra pass.
- **Kerbs and lamp posts:** one small multiply-blended mesh (vertex colours, one draw) shades the
  kerb tops by the blocks and lays the left lamp posts' long thin shadows across the street.
- **Real shadow maps:** `look.shadows` (off). See Costs.

## Costs (1-thread llvmpipe, the fight at 720x1280, render scale 0.5)
Measured as cq 011 does: real-time autoplay fight, `LP_NUM_THREADS=1`, dynamic resolution on (it
settles at 0.3 of the screen within seconds on this software GPU), interleaved runs, frame p50.
The look's pieces can each be switched off from the config to measure them (`"look": {...}`).

| Piece | Frame cost on the software GPU | Shipped? |
|---|---|---|
| Whole look, final (5 interleaved rounds, load 1) | +7 % vs the effects head 0acfd79 (31.8 -> 33.9 ms), +12 % vs 5bd7f4f (30.6 ms); draws 114 vs 118 | yes |
| Glow, or the BCS + LUT grade (either turns on the post pass) | about 2x the frame (a run with either on took 2.2 to 2.7x the CPU of the same run with both off) | no: opt-in `glow` / `grade` |
| Real directional shadow map (one split, 30 m) | +58 % (467 vs 295 ms frame p50 in a loaded pair) | no: opt-in `shadows`; the blob shadows carry the sun's direction instead |
| Godot's sky ambient (radiance cubemap, two reads a pixel) | not separable from noise in wall time; replaced by the ALU hemisphere term, which looks the same | `"sky": "cube"` opt-in |
| Depth fog with sun scatter | about 3 % | no: opt-in `fog` |
| Baked shade (ground grid vertex colours, kerb strips, lamp-post shadows, sun-cast blob tails) | about 5 % with a dense 0.35 x 0.7 m grid (~6k triangles); the sparse grid shipped is part of the final +6 % | yes |
| Sign and lamp halos, the far sun pool | 0 to 2 % (inside the noise) | yes |
| Fighter material with rim and hit flash (`char_lit`) | none measurable (no slower than the old material + overlay) | yes |

The interleaved logs are in the task's evidence (`lat_fin2_*`, `lat_v*_*`).

## Bloom (cq 016, `bloom.gd`)
The reference's whole frame blooms. Godot's glow is a full-screen post pass (about 1.7x the frame on
the 1-thread software GPU, measured again in cq 016), so the shipped bloom only blooms what is meant to
glow, from a tiny picture:
- **Sources** sit on visual layer 11 (`BloomScript.BLOOM_LAYER`) as well as their own: the sign tubes,
  shop-window spills and the lamp heads/halos (the arena's glow meshes with meta `bloom`), and the
  effects (`fx.gd`: every pooled node except the slash arcs, and the standing cards only, not the flat
  ground rings; `fx.bloom_layer`). The arcs and the big WHIRL/SPLIT ground rings carry their own halo:
  bloomed as well, they whited the fighters out inside a WHIRL.
- A second camera, copied from the fight camera every frame (after it moves: `process_priority`),
  draws only that layer into a SubViewport of 1/8 of the screen (black background, linear, no
  tonemap). A canvas pass blurs it (13 taps) into a 1/16 one. (1/6 and 1/12 looked the same and
  cost 5.6 %; `SRC_DIV`, `BLUR_DIV`.)
- A quad in front of the fight camera (`BloomAdd`, a full-screen triangle pair in its vertex shader,
  additive, no depth test, drawn last, under the HUD) adds them back at the 3D resolution:
  `max(tight - threshold) * 0.3 + max(wide - threshold / 2) * 1.3`, saturation kept (x1.5 around the
  luma, so a blurred white core stays coloured), times `strength`, soft-capped at `cap`
  (`c * cap / (cap + c)`), so a big effect hazes round a fighter instead of whiting it out.
- Defaults: strength 0.8, threshold 0.45, cap 0.35 (`look` keys `bloom_strength`, `bloom_threshold`,
  `bloom_cap`). Off: `"look": {"bloom": false}`.
- Nothing occludes the bloom view (the fighters are not drawn into it), so a sign directly behind a
  fighter glows a little round them. The sources are on the walls and the effects mostly over the
  fighters, so it is rare.
- **Cost** (4 interleaved rounds, 1-thread llvmpipe, final build): +3.2 % frame p50 (36.8 vs 35.7 ms
  with it off); +10 to 16 draws (the bloom view's own, tiny).
- **The full post stack is one switch for real devices:** `"look": {"post": true}` turns on Godot's
  glow and the grade (the cheap bloom then steps aside): +71 % frame p50 on the software GPU (58.4 vs
  34.1 ms), likely 1 to 3 ms on a phone GPU. `glow`, `grade` and `fog` stay separate switches.

## Composition (cq 016)
The reference looks along the street at lit shop fronts, awnings, cars and crossings; cq 011's camera
looked down at the paving. Now:
- **Camera** (`fight.gd CAM_*`): pitch 44 -> 34 deg, distance 16.5 -> 20 m, FOV 55 -> 52, yaw 0 -> 12 deg
  (turned a little left, so the left-hand shop fronts face the camera, as on the reference), and the
  focus 3 m ahead of the fight (`CAM_AHEAD`, was 0.6) so the fight sits in the lower half and the street
  and the cross street fill the upper half. `arena.gd _cam_facing` (the camera-facing sign and halo
  quads) follows the same pitch and yaw.
- **Gameplay is untouched by the camera:** the autoplay bot's stick and the ally's spot were computed in
  the camera's axes, so turning the camera changed seeded fights by float rounding. They now use the
  street's own frame (`_play_right` / `_play_fwd`, the old yaw-0 axes); a player's stick stays
  camera-relative.
- **The cross street** (`arena.gd _build_crossroad`, `CROSS_Z` = z -18 to -28, beyond the fight's
  z -9): asphalt, zebra crossings across the mouth of the street, a dashed centre line (one
  vertex-coloured mesh), kerbs, traffic lights on the four corners with a red glow, neon signs on the
  corner shops facing down the street, five parked cars, and two cars driving through the junction
  (each one mesh, moved in `arena._process`; nothing in gameplay).
- **Up the street**: the shop rows continue past the junction to z -64, low-detail kit blocks beyond
  z -40 and along the cross street beyond the corner shops; awnings over most shop fronts; two café
  parasols by the shops beyond the fight's reach; the trees moved beyond the junction.
- Kit pieces: Kenney Car Kit, City Kit (Roads) and (Commercial), CC0 (LICENSES.md), merged per
  material like the rest of the street, except the two moving cars.
- **Cost:** the street, camera and cloth push together +4.4 % frame p50 (35.7 vs 34.1 ms, bloom off); the
  cloth push alone about 1.6 % (37.6 vs 37.0 ms with `cloth_push: false`), so the street and camera about
  2.5 %; +10 to 14 draws.

## How to tune
- Warmer or cooler evening: `KEY_COLOR` and the sky colours; brighter or darker: `KEY_ENERGY` and
  `ambient_light_energy` (the tonemap's exposure moves everything, effects too).
- The paving's tint (`gm.albedo_color` in `build`, `(0.66, 0.63, 0.69)`): lighter matches the
  reference's average brightness but takes contrast from the effects' additive glow (EFFECTS.md); this
  value keeps both.
- Rim: `RIM_AMOUNT` / `RIM_BOSS` / `RIM_TEAM` in `fighter.gd`; its width is the `fr` exponent in
  `char_lit.gdshader`. Turn it off with `"look": {"rim": false}`.
- Shade on the street: `SHADE_COL` / `AO_COL` (closer to white is lighter), the width rule in
  `_wall_shade`; `"look": {"ao": false}` removes the mesh.
- Signs: brightness in `_commit_glows` (`neon_m`), halo colours `SIGN_HALO`, halo size and alpha in
  `_dress_front`.
- Every piece can be switched from the fight config for a measurement:
  `"look": {"sky": false, "fog": false, "glow": true, "grade": true, "rim": false, "ao": false,
  "shadows": true, "tonemap": "agx"}`.
- On a device that can pay for a post pass (a real phone GPU), `glow` and `grade` add a bloom on
  windows, signs and lamp heads (threshold 1.15, above the effects' peak) and the split-tone grade.

## What llvmpipe captures cannot show
The review captures run headless under xvfb on Mesa's llvmpipe (a CPU OpenGL), with the same
**Compatibility renderer** the phones run (the log line reads `OpenGL API 4.5 ... Compatibility -
Using Device: Mesa - llvmpipe`). So every piece above (rim, halos, baked shade, blob tails, colours)
is drawn the way a phone draws it. What the captures cannot show:
- **Resolution and sharpness.** Captures are 720x1280 with the 3D at half that (360x640). A phone
  at 1080x2340 draws the 3D at 540x1170, 2.25x the pixels, so edges, rims and sign letters are
  sharper on device. Dynamic resolution only steps down on a GPU too slow for 30 ms frames.
- **Precision.** llvmpipe runs every shader in 32-bit float. Phone GPUs run `mediump` maths in 16-bit,
  so soft gradients (halos, the sun pool, blob tails, the baked shade) may band slightly on device.
- **Texture formats.** Desktop exports use S3TC/BPTC; the APK carries ETC2/ASTC. Block artefacts in
  the paving and the characters' textures differ a little.
- **Frame time.** llvmpipe is 10x or more slower than a phone GPU and its costs fall differently: on
  the CPU, ALU per pixel and per-triangle set-up are expensive (the dense shade grid cost more than an
  overlay); on a phone, blended overdraw and bandwidth are what costs. So on device, watch the halos
  and light pools (blended), not the triangles. On-device frame time is pending an emulator or phone.
- **Glow / HDR.** The post stack (glow, grade, fog) is off by default because of its cost here. A phone
  GPU would likely pay 1 to 3 ms for it at 1080p (not measured). Turned on, it renders the same on
  llvmpipe as on a device; the captures under `evidence/post/` show it.
- **MSAA.** Off in the project (`msaa_3d=0`). Since env-fixes 3 a device turns on 2x MSAA at runtime
  (`fight.gd _quality`); the llvmpipe captures keep it off unless the config says `"quality": "device"`.
- **Cross-check on lavapipe.** One frame rendered with the **Mobile** renderer (Vulkan) on Mesa's
  lavapipe (CPU Vulkan; the loader was limited to the lavapipe ICD, the log reads `Using Device #0:
  llvmpipe`) looks almost the same as the Compatibility frame, with and without the post stack. The
  gap to the reference is the scene and the art, not the software renderer.

## env-fixes 1 to 4 (31 Oct 2026, from the environment audit)
The audit (`cosquest-review/env-audit-20261031/AUDIT.md`) ranked four cheap fixes first. What changed:

**1. Sky, fog, horizon** (`arena.gd`, `vfx/sky.gdshader`)
- The background is now a drawn gradient sky (`vfx/sky.gdshader`, `shader_type sky`): zenith, upper sky,
  a horizon that warms towards the sun, a soft sun glow, and a haze band that ends in exactly the fog's
  colour. ALU only: the ambient stays a flat colour, no radiance map, no reflections. `"look": {"sky_draw": false}` gives the old flat colour.
- Depth fog is on by default, in the sky's horizon colour, from `FOG_BEGIN` 60 m (or the camera distance
  + 25 m, for far review cameras) to `FOG_END_STREET` 220 m / `FOG_END_PLACE` 320 m, density 1, curve 1.25,
  no sun scatter (it would seam against the band). The fighters are never in it.
- The paved floor is 640 m in both arenas (the street's was 160 m) and a flat ring (`_build_horizon`, 8
  triangles) runs on to 2.4 km, so the ground meets the fogged horizon. The fight camera's far plane is
  600 m (`CAM_FAR`; was 160 m, and 420 m in the fly-in).
- Two presets, `TIMES` in `arena.gd`: `"dusk"` (default) and `"day"` (`"look": {"time": "day"}`): sky,
  fog, key colour and energy, ambient, and the windows' glow. The key's direction is the same in both.

**2. Contrast and colour** (`arena.gd`, `place.gd`, `vfx/facade.gdshader`, `vfx/place_facade.gdshader`)
- Ambient 0.85 -> 0.45, colour (0.6, 0.66, 1.0) -> (0.7, 0.74, 0.9); key 1.35 -> 1.9, colour (1.0, 0.84, 0.68).
  Warm light, cool shade, real darks, in the light colours (no post pass).
- Walls: no tint (was (1, 0.92, 0.95)); lift 0.12 -> 0.03 (street), 0 (places). Paving (0.68, 0.67, 0.66), was
  pink-lilac; place squares (0.72, 0.72, 0.7); roads (0.25, 0.26, 0.28).
- **The navy roads were a winding bug**: the flat layers are two-sided, and triangles wound the wrong way
  were lit as faces looking down (ambient only, which was blue). `place.gd _up_tri` winds every flat triangle
  to face up.
- Place windows: the wall texture carries each lit window's dim level and one of three warm tints
  (`warm_a/b/c`), some with a curtain; glow `window_k` 1.2, clamped at 1.2 (was 2.6, clipped to white). Unlit
  glass is a dark neutral (was navy). Street windows `window_k` 3.0 -> 1.6, clamped at 1.4.
- Bronze: albedo (0.45, 0.33, 0.22) on the facade shader (was 0.2 metallic, drew black); the pedestal reliefs
  are not drawn as blocks. Landmark stone lift 0.12, granite (0.6, 0.59, 0.6).
- The opt-in grade ramp (`_grade_ramp`, post pass) now has cool slate shadows and a deeper toe.

**3. Resolution, AA, halos** (`fight.gd`, `arena.gd`, `bloom.gd`)
- `fight.gd _quality()`: `"device"` on a real GPU, `"low"` on a software one (llvmpipe, lavapipe, softpipe,
  SwiftShader) or headless. Device: `render_scale` 0.75 (`DEVICE_RENDER_SCALE`) and 2x MSAA (`DEVICE_AA`);
  low: 0.5 and no AA, as before. Dynamic resolution still steps down from either.
- Fight config knobs: `"quality": "auto" | "device" | "low"`, `"render_scale"`, `"aa": "msaa2" | "msaa4" | "off"`.
  FXAA is not offered: Godot 4.5.1 Compatibility refuses screen-space AA ("currently unavailable").
- Halos: every halo's alpha x0.6, clamped at 0.42 (`HALO_SCALE`, `HALO_ALPHA_MAX`). Cheap bloom strength
  0.8 -> 0.48, cap 0.35 -> 0.28.

**4. The fight camera in a real place** (`fight.gd _place_camera`, `arena.gd _faction_ring_mat`)
- In a place: the camera orbits at 27 deg (`CAM_PLACE_PITCH`), 21 m, look-ahead 1.5 m, FOV 56, and its
  view is lifted 7 deg (`CAM_PLACE_TILT`), so the landmark (place.gd already turns the place so it stands on
  the camera's line) and the skyline fill the top of the frame and the fighters stay where they were on
  screen. The fly-in ends on this frame, so it ends showing the landmark. Any `cam_*` override in the config
  wins (review cameras unchanged); `"place_cam": false` keeps the street camera.
- The 7.2 m medallion is replaced in places by a 5.2 m faction ring (thin line, hairline, faint wash, ~40 %
  opacity; `"faction_color"`, default gold; `"place_medallion": true` brings the medallion back). The street
  keeps its medallion.
- Nothing in gameplay reads the camera: the seeded fights (street and Trafalgar) and their judge logs are
  byte-identical before and after, and the rules id is still `f3d-1-21d2cde61ab2`.

Captures, side-by-sides and the device checklist: `cosquest-review/env-fixes-1-4/`. Rig: `e2e/env-fixes/`.

## look-world (1 Nov 2026, the art direction "Sunlit Real Places")
The world now follows `cosquest-review/art-direction/` (v1.0). PLACE.md has the place and street kit.

**Time of day** (`arena.gd TIMES`, tokens `world.time.*`, exactly): `golden` (default by day), `day` (optional
noon), `dusk` (the hour round sunset; Mark's reference look), `night` (defined; shipped as dusk). Each preset sets
the sky (zenith, upper, horizon, sun side, fog, sun glow), the key's colour, energy and **elevation** (38, 55, 14,
40 deg; the heading stays -128), the ambient, the baked shade and contact-AO colours, the windows' emission and
colour, tonemap exposure, fog curve 1.6 and sun scatter, the cheap bloom (strength, threshold, cap) and the halo
scale/clamp (no halos by day). `"look": {"time": "auto"}` (the default) follows the device clock at the place
(`time_of_day`, NOAA sunrise/sunset): golden from sunrise to an hour before sunset, dusk to half an hour after,
then night (dusk). `"clock_hour"` in the config replaces the clock for tests. The review captures pin Golden
(`capture.gd`) unless the spec names a time.

**Shadows:** `"shadows": "auto"` (default) turns the directional shadow map on for the device quality profile
(35 m, 1 split, opacity 0.65, 0.5 at dusk) and keeps it off on software GPUs. Only the fighters cast into it; the
place's shade is baked (PLACE.md).

**Materials** (all new shaders are one pass, no post): `vfx/world_ground.gdshader` (world-space textures, wear,
baked shadow removes the sun's direct light in `light()`, AO tints), `vfx/world_facade.gdshader` (trim sheets),
`vfx/world_kit.gdshader` (props, trees with wind sway, landmarks, birds' wing flap, lamp emission at dusk, a
small lift so bronze and shade sides never go black), `vfx/world_water.gdshader`, `vfx/world_npc.gdshader`.
`vfx/place_facade.gdshader` is gone. Vertex colours are authored in sRGB and converted in the shaders.

**The street:** `"look": {"street": "place"}` (default) is the street built by the place kit; `"kit"` keeps the
cq 016 Kenney street exactly as it was (its neon circuit lines show only at dusk on the new street).

**Camera:** in places the orbit pitch is 30 deg (`CAM_PLACE_PITCH`, the art direction's 30 to 34; was 27).

**Assets:** all CC0 (ambientCG sources through the stylise pass, own procedural meshes, the Kenney Car Kit
already in the project); every file in `art/world/CREDITS.md`. Mobile pack delta: ~17.4 MB of ETC2 textures with
mipmaps plus 1.1 MB of kit meshes. Rig: `e2e/look-world/` (mkspec, run, seeded, compose). Captures and the
before/after stills: `cosquest-review/look-world/`.

## The real look (realism, 11 Nov 2026)
The fighters drawn as real materials lit by the street, behind a device tier. Evidence, numbers and what
still falls short: `cosquest-review/realism-20261111/experiments/look/README.md`.

**Tiers** (`arena.gd TIER_LOOK`, the fight config's `"tier"`): the app sends it from the phone's reported
memory with the landscape flag's rule (`features/game/lookTier.ts`: high at 5 GiB and up, mid from 3.3 GiB,
else low; `EXPO_PUBLIC_LOOK_TIER=low|mid|high` forces one, `0` means low). A config without a tier is low.

| Tier | Adds to `LOOK_DEFAULTS` | What the player gets |
|---|---|---|
| low | nothing | build 21's look, key for key (`tests/look_tier_test.gd`); seeded fights unchanged |
| mid | `real`, `skin: "simple"`, `ibl` | the real fighter material, wrap skin with one specular lobe, the street's reflections; no post pass, LOD1, render scale as before |
| high | mid plus `skin: "full"`, `shadows: true`, `grade: "base"`, `hero_lod: 0`, `scale: 1.0` | two-lobe skin, the shadow map, the base grade, the hero and the Guardian at LOD0, 3D at the screen's resolution |

Every key can still be set from the config's `"look"` (it wins over the tier), which is how each piece is
measured. Extra knobs: `faction` (a faction's grade table over the base), `normal_map`, `skin_guess`,
`ibl_k`, `amb_k`, `rim_k`, `night` (lets the night preset through; without it night is drawn as dusk, as
before), `real_debug` (1 grey fighters, 2 mirror fighters, 3 skin weight, 4 normals).

**The material** (`vfx/char_real.gdshader`, built by `fighter.gd _real_material`):
- The model's own maps: base colour, packed roughness and metal, the tangent-space normal map and the
  emissive map when the file has them (`char_lit` refused a surface with either).
- The key light goes through the shader's own `light()`: GGX specular with Schlick Fresnel, Lambert diffuse
  less what the specular took, and a share given back on rough metal (single scattering makes it dark).
  `ambient_light_disabled`: the flat ambient and `char_lit`'s hemisphere guess are not used.
- The street's light replaces them: `data/look_real.json` holds, per time of day, a 32 px prefiltered cube of
  the street as seen from where the fight stands (mip = roughness; one `textureLod` a pixel) and six ambient
  colours taken from the same cube (ALU only). `tools/look/env_capture.gd` renders the six views in linear
  light with the fighters out of the way; `tools/look/bake_env.py` filters and packs them. Rebake when the
  street or a time preset changes.
- Skin: the Forge skin mask (`lodN_skin.png` beside the model, named in `extras.forge_skin`; `char_loader.gd`
  reads it) checked against the colour, or a guess from the colour alone at 0.6 strength when there is no
  mask. The diffuse wraps past the terminator, red furthest (`skin_wrap`); a second tighter specular lobe on
  the high tier; a little light through thin skin at the silhouette when the key is behind. All of it is
  multiplied by the surface's own colour, so deep skin stays deep.
- The rim is the key light at a grazing angle (0.6, was 1.35) and the team tint a hint; the hit flash and
  the dissolve glow are `char_lit`'s, as is the cloth-off-legs vertex code.
- `fighter.gd REAL_FILL`: the measured ambient is used as it is at golden hour and by day, x1.35 at dusk
  and x2.4 at night. The street's lamps and windows are cards that light nothing, so the measured light is
  less than the paving shows; without the factor the fighters are silhouettes at night.

**Shadows:** the high tier turns the shadow map on. With it the blob keeps only its contact disc (the
sun-cast tail and the map's shadow were two shadows of one fighter). The per-foot contact shadows stay.

**The grade without blow-out** (`look.grade: "base"`, `look.faction`): what was measured (README, section 5):
- Godot's glow moves the frame's bright pixels to white: the additive effects add up in linear light before
  the tonemap and pass the glow's threshold. `post: true` (glow plus the old grade) clipped 5 to 10 % of an
  effect-heavy frame; the same frame with neither clipped none.
- The old 1D ramp lifted the highlights and its contrast gain did the rest.
- At render scale 1.0 the renderer skips its linear buffer and tonemaps inside every material, so every
  see-through thing (effects, halos, light pools, blob shadows) blends in display space and the frame goes
  brighter and whiter. Every scale under 1 takes the other path, which is the one the look was tuned on.
The fix: the grade is one 33-point 3D table in the renderer's colour-correction slot (base, or a faction's
`.cube` over the base at 0.6), with no glow and no contrast gain; above mid-grey a table never returns more
than it was given and it is the identity at white (`tools/look/bake_lut.py`). When the look's scale is 1.0,
neutral adjustments keep the frame on the linear path.

**Costs** (Godot's monitors, the Forge test characters, golden hour; frame time on the 1-thread software GL,
three noisy rounds, relative only): the real material +1 to +9 % of the frame with its cube read, the skin
term and the grade table not measurable, LOD0 for two fighters +20 to +40 % and +77 MB of textures (runtime
GLB textures are not GPU-compressed), render scale 1.0 +28 to +48 %. Video memory: low 113 MB, mid 113 MB,
high 202 MB. Draw calls unchanged (295). On-device frame time is not measured.

**Tools:** `tools/look_shots.gd` (the same paused moment from the game, side and close cameras, with mask
renders), `tools/look/measure.py` (BAR.md section D from those frames), `tools/look/judge_crops.py`.

### Round 2 (12 Nov): camera, beats, light direction
After the first judge run (6 wins in 30) the coordinator ruled that size on screen and light direction are
the levers. All of it is on the mid and high tiers only (`TIER_LOOK`); the low tier is unchanged.

- **Close camera** (`look.cam: "close"`, `fight.gd CLOSE_*`): pitch 20 deg in portrait and 16 in landscape
  (was 34), distance from 5.85 m (portrait) or 7.8 m (landscape) instead of 15 m, orbit round the chest; in
  portrait the view looks 6 deg further down than the orbit so the fight sits above the controls. The
  heading is the old one, so the stick's axes, the bot and the ally's spot do not move: the seeded fight's
  record is the same as on the low tier. Each frame the distance is the closest that keeps the hero whole,
  the target's chest and face and an ally at the hero's side inside the HUD's margins (`_close_fit`, a
  short search), eased quickly out and slowly in, never past 15 m. A config with `cam_dist` or `cam_pitch`
  keeps the camera it asks for.
- **Beats** (`look.beats`): the hero's shot before the clock (`BEAT_LEN` 1.8 s: the hero turns to the
  camera, chest-up, then the camera pulls back as the hero turns to the Guardian; a tap on ATTACK skips it;
  the HUD is hidden for it; config `"intro": false` turns it off), a closer victory shot (the winner turns
  to the camera, 4.4 m, 9 deg), and a harder push-in on heavy hits. The fight's clock is untouched, but the
  seeded record is NOT the same with the beat: build 21's own record changes whenever the fight starts a
  few frames later (measured with its view wait), so the record depends on what runs before the clock.
- **Light** (`look.key_yaw` -25, `look.key_elev_min` 24, `look.ground_k`): the sun comes from behind the
  camera's left shoulder instead of from up the street, so the side of a fighter the camera sees is the lit
  side, the shadows fall up the street, and the fill factors are smaller (`REAL_FILL` dusk 1.2, night 1.9).
  The sun is never lower than 24 deg (at dusk's 14 one fighter's shadow lay across the next one's face).
  The paving's exposure is 0.62 at golden hour and by day, 0.85 at dusk, 1.0 at night
  (`vfx/world_ground.gdshader expose`, the street floor and the medallion). The street's cube was baked
  again with this light (`tools/look/env_capture.gd` now captures on the mid tier).
- **Faces and hair**: narrower skin wrap, the skin mask's floor on non-skin colours 0.1, rough non-metal
  surfaces no longer mirror the sky at grazing angles (the grey haze on dark hair), the rim follows the
  surface's colour more. A Forge hair mask (`lodN_hair.png`, `extras.forge_hair`) gives hair its own path:
  never skin, rough base, a strand highlight (Kajiya-Kay on the solid sculpt).
- **Shadows**: the renderer's 13-tap soft filter on the high tier, blur 3, bias 0.2 (the low sun drew
  stepped self-shadow on faces).
- `tools/look/cam_probe.gd` measures the hero's height on screen, the target on screen and HUD overlap over
  a whole fight; `tools/look/judge_crops2.py` cuts the round 2 judge pairs.
- Measured (`cosquest-review/realism-20261111/experiments/look/round2/`): hero height 15 % to about 30 % of the
  screen in portrait, 23 % to 47 to 49 % in landscape; target off screen under 1 % of frames.

### Round 3 (12 Nov): what blocked shipping the close camera
Evidence: `cosquest-review/realism-20261111/experiments/look/round3/README.md`.
- **Face patch:** the baked normal map is noisy on faces; on skin it is read four mips down at 0.15 strength
  (`char_real.gdshader`). Fighters do not take the shadow map's shadow on themselves (`look.self_shadow: false`).
- **Fill:** `fighter.gd REAL_CAM_FILL` (dusk 0.5, night 0.6, the sky's colour, from the camera's left shoulder, with a
  wide sheen) and `REAL_KEY_SAT` (dusk 0.6). Pale surfaces take less of it. Open: a cream coat is still 2.84 times
  the paving at night.
- **Hit order:** `hit_area.gd ordered` (`look.hit_order`, mid and high): fighters struck by one opening are reported
  in scene order. Build 21 reports them in the physics server's order, which changes with how long it has run, so
  its seeded record depends on when the fight starts. Test hook: config `start_delay` (frames), `tests/seeded_fight.gd
  --delay= --tier= --look=`.
- **HUD:** name plates stay below the top block (`hud.gd plate_min_y`); in landscape the camera keeps the target's
  face below the block. `tools/look/cam_probe.gd` reports heads under HUD controls.
- **Leaves:** with the close camera, place_life's leaves have a leaf outline and fade within 4 m of the camera.

### Round 4 (12 Nov): light with a direction, occlusion, depth, the donor head
Evidence: `cosquest-review/realism-20261111/experiments/look/round4/README.md`.
- **Light** (`fighter.gd REAL_LIGHT`, `char_real.gdshader`): round 3's frontal fill is gone. Two kickers from behind the
  fighter (`kick_a_*` the sky, `kick_b_*` the lamps at dusk and night), the paving's bounce on down-facing surfaces
  (`bounce_col`), and exposure by the surface's own brightness (`expo`: a gain on near-black cloth fading out by mid
  tones, a power-law hold above). Night is still out of range for very dark and very pale cloth.
- **Occlusion stand-in** (`occ_k`): creases from the screen-space curvature of the mesh normal, and the ground's shade
  on down-facing parts near it. No capsule or baked occlusion.
- **Depth of field stand-in** (`fight.gd _dof`, look `dof`, high tier): a plate behind the hero in the intro and victory
  shots redraws the street from the screen texture with 13 ring taps (the screen texture has no usable mips here).
- **Effects** (`vfx/fx_card.gdshaderinc`, project `shader_globals` `cq_fx_gain`, `cq_fx_cap`; look `fx_gain`, `fx_cap`):
  cards add less and are capped per card on mid and high. They still cover a target on the frame a hit lands.
- **Portrait camera**: orbit 28 deg, tilt 2, 5.4 m, and the target's face point kept under the top block
  (`close_*` look keys override each value for trials; `tools/look/cam_probe.gd`).
- **Shader variants** (`fighter.gd _real_variant`): two-sided surfaces and alpha cut-out hair shells take the same
  shading; a material whose name contains "hair", or any see-through one, is treated as hair.
- **Masks** are also looked for one folder above the model file (`char_loader.gd`).

### skinlook-28 (14 Nov): skin tone on mid and high is the same treatment for every tone
Evidence: `cosquest-review/realism-20261111/experiments/skinlook-28/README.md` (Spec 4 tone method on game frames, six heroes,
both tiers, before and after).
- **Cause 1, the colour check** (`char_real.gdshader skin_guess`): on a fitted head (`cq_surface` "skin") the skin weight came
  from the base colour with green/red at most 0.62 to 0.72. Pale and olive faces fail that (a toned pale face measured a
  weight of about 0.15, a deep one 1), so only deep skin took the skin shading, its colour balance and its exposure. Now
  `skin_wide` (1 on fitted heads, look key `skin_wide`) moves the upper edges to 0.80 to 0.88 (green/red) and 0.62 to
  0.72 (blue/red); eye whites and grey or white paint still fail. Bodies keep the narrow check.
- **Cause 2, exposure by the surface's own brightness** (`expo`): the gain for near-black cloth lifted deep skin 1.3 to
  1.5 times at golden hour (up to about 4 at night) and held pale skin near 1, which squeezed every face towards one
  middle tone. Skin now takes one gain per time of day, whatever its tone (`fighter.gd SKIN_GAIN`, look key `skin_gain`;
  absent = the old behaviour).
- **Colour balance** (`SKIN_WB` golden): the old [0.8, 0.83, 1.17] turned faces pink once every tone took it (a* +5 to
  +12 against the concept); refitted on all six heroes to [0.70, 0.83, 1.03].
- Low tier (`char_lit.gdshader`) unchanged. The fight itself is untouched (presentation only).
- Measuring: `tools/look_shots.gd` plan key `"skin_view": true` also draws each shot without effects (`_nofx`), the skin
  weight the shader used (debug view 3, `_skinw`) and one id mask per fighter (`_id_<role>1/0`, white then black).
