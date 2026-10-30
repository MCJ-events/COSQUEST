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
  - neon blade signs: the sign (unshaded, 1.7x so the tube reads as lit after the tonemap) and a
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
- **Kerbs and lamp posts:** one small multiply-blended mesh (vertex colours, one draw) shades the
  kerb tops by the blocks and lays the left lamp posts' long thin shadows across the street.
- **Real shadow maps:** `look.shadows` (off). See Costs.

## Costs (1-thread llvmpipe, the fight at 720x1280, render scale 0.5)
Measured as cq 011 does: real-time autoplay fight, `LP_NUM_THREADS=1`, dynamic resolution on (it
settles at 0.3 of the screen within seconds on this software GPU), interleaved runs, frame p50.
The look's pieces can each be switched off from the config to measure them (`"look": {...}`).

| Piece | Frame cost on the software GPU | Shipped? |
|---|---|---|
| Whole look, final (8 interleaved pairs, load 1 to 2) | +6 % vs the effects head 0acfd79 (32.0 -> 33.9 ms), +10 % vs 5bd7f4f; draws 117 vs 120 | yes |
| Glow, or the BCS + LUT grade (either turns on the post pass) | about 2x the frame (a run with either on took 2.2 to 2.7x the CPU of the same run with both off) | no: opt-in `glow` / `grade` |
| Real directional shadow map (one split, 30 m) | +58 % (467 vs 295 ms frame p50 in a loaded pair) | no: opt-in `shadows`; the blob shadows carry the sun's direction instead |
| Godot's sky ambient (radiance cubemap, two reads a pixel) | not separable from noise in wall time; replaced by the ALU hemisphere term, which looks the same | `"sky": "cube"` opt-in |
| Depth fog with sun scatter | about 3 % | no: opt-in `fog` |
| Baked shade (ground grid vertex colours, kerb strips, lamp-post shadows, sun-cast blob tails) | about 5 % with a dense 0.35 x 0.7 m grid (~6k triangles); the sparse grid shipped is part of the final +6 % | yes |
| Sign and lamp halos, the far sun pool | 0 to 2 % (inside the noise) | yes |
| Fighter material with rim and hit flash (`char_lit`) | none measurable (no slower than the old material + overlay) | yes |

The interleaved logs are in the task's evidence (`lat_fin2_*`, `lat_v*_*`).

## How to tune
- Warmer or cooler evening: `KEY_COLOR` and the sky colours; brighter or darker: `KEY_ENERGY` and
  `ambient_light_energy` (the tonemap's exposure moves everything, effects too).
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
- **MSAA.** Off in the project (`msaa_3d=0`) for phones and captures alike; aliasing looks worse in the
  captures only because of their lower resolution.
- **Cross-check on lavapipe.** One frame rendered with the **Mobile** renderer (Vulkan) on Mesa's
  lavapipe (CPU Vulkan; the loader was limited to the lavapipe ICD, the log reads `Using Device #0:
  llvmpipe`) looks almost the same as the Compatibility frame, with and without the post stack. The
  gap to the reference is the scene and the art, not the software renderer.
