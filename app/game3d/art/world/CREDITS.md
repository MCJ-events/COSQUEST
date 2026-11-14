# app/game3d/art/world: credits and licences (look-world)

Every texture here is rebuilt by `app/game3d/tools/world/make_world_art.py <ambientCG dir> app/game3d/art/world`
(deterministic). Photo-sourced ones go through the art direction's mandatory stylise pass
(`tools/world/stylise.py`: median 3 px, posterise 24 levels, gaussian 2 px, HSV saturation <= 0.55 except
paint/sign accents, mean-matched to the tokens.json hex; normal strength x0.5; roughness >= 0.6 except glass).

## Licence
- ambientCG (https://ambientcg.com): every asset is **CC0 1.0** (https://docs.ambientcg.com/license/). Sources
  were the 1K JPG/PNG downloads of the ids listed below.
- Everything drawn procedurally (layouts, windows, cornices, signs, noise, silhouettes, clock face) is own work,
  released as **CC0 1.0** by the project.
- No Poly Haven, Kenney or other files are embedded in these textures.

## Deviation from ART-DIRECTION.md 4.3
The AD asks for 1024 x 1024 trim sheets at 128 px/m, but its rows add up to 9.0 m. The sheets are 1024 x 1280
(8 m x 10 m at 128 px/m) and carry one extra row: a 1.0 m BLANK WALL of the sheet's main material (windowless
walls, sheds, gable ends). ORM and normal maps are half resolution (512 x 640, 64 px/m).

## Files

| File | What | Size | px/m | Sources (CC0 1.0) | Processing |
|---|---|---|---|---|---|
| `ground/asphalt.png` | road asphalt, warm grey | 512 | 128 (4 m tile) | [Asphalt031](https://ambientcg.com/view?id=Asphalt031) | stylise pass, low-freq tone, saturation <= 0.06 so it never reads navy, mean = #5E5C60 |
| `ground/pave_uk.png` | UK pavement, York stone flags in running rows | 1024 | 256 (4 m tile) | [Concrete012](https://ambientcg.com/view?id=Concrete012), [Bricks084](https://ambientcg.com/view?id=Bricks084) | procedural flag layout (0.5 m rows, 0.6-1.2 m flags), photo grain, bevels; stylise pass, mean = #C9C0B2 |
| `ground/pave_us.png` | US pavement, concrete flags with 1.5 m score lines | 1024 | 341 (3 m tile) | [Concrete034](https://ambientcg.com/view?id=Concrete034) | procedural score lines, photo grain; stylise pass, mean = #C7C3BC |
| `ground/pave_lagos.png` | Lagos interlock pavers | 1024 | 256 (4 m tile) | [Concrete012](https://ambientcg.com/view?id=Concrete012) | procedural pavers 0.25 x 0.125 m, mixed tones; stylise pass, mean = #B89F86 |
| `ground/plaza.png` | civic plaza stone, 1 m slabs | 1024 | 256 (4 m tile) | [Marble012](https://ambientcg.com/view?id=Marble012), [Concrete034](https://ambientcg.com/view?id=Concrete034) | procedural slabs, photo grain; stylise pass, mean = #D8CBB4 |
| `ground/grass.png` | park grass | 1024 | 256 (4 m tile) | [Grass004](https://ambientcg.com/view?id=Grass004) | stylise pass (+0.8 px soften), mean = #7FB356 |
| `ground/grass_dry.png` | dry grass / verge | 1024 | 256 (4 m tile) | [Grass001](https://ambientcg.com/view?id=Grass001), [Ground037](https://ambientcg.com/view?id=Ground037) | stylise pass, mean = #A7B866 |
| `ground/path.png` | park path, fine gravel | 1024 | 256 (4 m tile) | [Gravel023](https://ambientcg.com/view?id=Gravel023) | stylise pass, mean = #C9B98F |
| `ground/wear.png` | ground wear mask: R grime, G cracks/stains/patches, B macro brightness (0.5 mean) | 512 | ~21 (24 m world tile) | own work | procedural (periodic noise, wrapped strokes); own work |
| `ground/water_n.png` | water ripple normal map (GL, +Y up), scroll two copies | 256 | - | own work | procedural (periodic sines + noise); own work |
| `roofs/roof_flat.png` | flat roof membrane + gravel, neutral (mean 0.8), tint by the region roof hex | 512 | 128 (4 m tile) | [Gravel023](https://ambientcg.com/view?id=Gravel023), [Concrete036](https://ambientcg.com/view?id=Concrete036) | procedural 1 m membrane runs, photo grain; stylise pass, greyed to mean 0.8 |
| `misc/stone.png` | pale ashlar / limestone for landmarks and kerbs | 512 | 256 (2 m tile) | [Marble012](https://ambientcg.com/view?id=Marble012), [Concrete034](https://ambientcg.com/view?id=Concrete034) | procedural ashlar coursing, photo grain; stylise pass, mean ~0.8 warm neutral |
| `misc/clock_face.png` | clock dial (cream, bar numerals, gold ring, 10:10), alpha outside | 256 RGBA | - | own work | drawn with PIL at 4x; own work |
| `misc/props_noise.png` | painterly breakup noise for props (mean 0.5) | 256 L | 128 at 2 m | own work | procedural; own work |
| `misc/foliage.png` | leafy clump breakup for tree canopies (mean 0.5) | 256 L | - | own work | procedural (wrapped leaf clumps); own work |
| `misc/npc_atlas.png` | 8 distant pedestrian silhouettes (64 x 256 px cells, feet at the bottom) | 512x256 RGBA | - | own work | drawn with PIL at 4x; own work |
| `trims/trim_uk_brick.png` | UK brick: stock/red brick (tint), sash windows with white frames, gauged lintels, stone coping and string course, painted timber shopfront, deep fascias, roller shutter | 1024x1280 | 128 (8 x 10 m) | [Bricks085](https://ambientcg.com/view?id=Bricks085) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_uk_brick_orm.png` | ORM: R AO, G roughness, B tint mask, A glass | 512x640 | 64 | [Bricks085](https://ambientcg.com/view?id=Bricks085) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_uk_brick_n.png` | normal map (GL) | 512x640 | 64 | [Bricks085](https://ambientcg.com/view?id=Bricks085) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_uk_stone.png` | UK stone: Portland ashlar (tint), balustrade + dentil cornice, architraves and hoods, arched window with balconette, rusticated ground floor with columns | 1024x1280 | 128 (8 x 10 m) | [Concrete034](https://ambientcg.com/view?id=Concrete034) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_uk_stone_orm.png` | ORM: R AO, G roughness, B tint mask, A glass | 512x640 | 64 | [Concrete034](https://ambientcg.com/view?id=Concrete034) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_uk_stone_n.png` | normal map (GL) | 512x640 | 64 | [Concrete034](https://ambientcg.com/view?id=Concrete034) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_brownstone.png` | US East brownstone: smooth brownstone (tint), bracketed metal cornice, hoods, fire escape, cast-iron storefront, striped awnings | 1024x1280 | 128 (8 x 10 m) | [Concrete012](https://ambientcg.com/view?id=Concrete012) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_brownstone_orm.png` | ORM: R AO, G roughness, B tint mask, A glass | 512x640 | 64 | [Concrete012](https://ambientcg.com/view?id=Concrete012) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_brownstone_n.png` | normal map (GL) | 512x640 | 64 | [Concrete012](https://ambientcg.com/view?id=Concrete012) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_modern.png` | US modern: curtain wall (#6F93AE glass, #8E98A3 mullions), concrete spandrels and parapet (tint only on concrete), lobby glazing, louvre panel | 1024x1280 | 128 (8 x 10 m) | [Concrete034](https://ambientcg.com/view?id=Concrete034) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_modern_orm.png` | ORM: R AO, G roughness, B tint mask, A glass | 512x640 | 64 | [Concrete034](https://ambientcg.com/view?id=Concrete034) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_modern_n.png` | normal map (GL) | 512x640 | 64 | [Concrete034](https://ambientcg.com/view?id=Concrete034) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_west.png` | US West: stucco (tint), terracotta tile visor, rafter tails, arched dark-wood windows, iron balconette and gate, striped awning | 1024x1280 | 128 (8 x 10 m) | [Plaster001](https://ambientcg.com/view?id=Plaster001) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_west_orm.png` | ORM: R AO, G roughness, B tint mask, A glass | 512x640 | 64 | [Plaster001](https://ambientcg.com/view?id=Plaster001) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_us_west_n.png` | normal map (GL) | 512x640 | 64 | [Plaster001](https://ambientcg.com/view?id=Plaster001) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_wa_render.png` | West Africa: painted render with rain streaks (tint), bare concrete frame, rusted tin eave, burglar-proof grilles + louvres, AC unit, saturated signboards | 1024x1280 | 128 (8 x 10 m) | [PaintedPlaster017](https://ambientcg.com/view?id=PaintedPlaster017) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_wa_render_orm.png` | ORM: R AO, G roughness, B tint mask, A glass | 512x640 | 64 | [PaintedPlaster017](https://ambientcg.com/view?id=PaintedPlaster017) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_wa_render_n.png` | normal map (GL) | 512x640 | 64 | [PaintedPlaster017](https://ambientcg.com/view?id=PaintedPlaster017) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_generic.png` | Generic: render upper floors (tint), brick ground floor (untinted #A65441), plain windows, fascias | 1024x1280 | 128 (8 x 10 m) | [Plaster001](https://ambientcg.com/view?id=Plaster001), [Bricks085](https://ambientcg.com/view?id=Bricks085) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_generic_orm.png` | ORM: R AO, G roughness, B tint mask, A glass | 512x640 | 64 | [Plaster001](https://ambientcg.com/view?id=Plaster001), [Bricks085](https://ambientcg.com/view?id=Bricks085) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |
| `trims/trim_generic_n.png` | normal map (GL) | 512x640 | 64 | [Plaster001](https://ambientcg.com/view?id=Plaster001), [Bricks085](https://ambientcg.com/view?id=Bricks085) | wall material: stylise pass then greyed to mean 0.8; architecture drawn procedurally (own work), baked bevel light + AO |

## Trim sheet layout (shared by every sheet; place.gd UVs)

| Row | Metres (from top) | Pixels (albedo 1024 x 1280) |
|---|---|---|
| parapet_cornice | 0.0 to 0.6 | 0 to 77 |
| roof_edge | 0.6 to 1.0 | 77 to 128 |
| upper_bay | 1.0 to 4.2 | 128 to 538 |
| string_course | 4.2 to 4.5 | 538 to 576 |
| shopfront | 4.5 to 8.5 | 576 to 1088 |
| plinth | 8.5 to 9.0 | 1088 to 1152 |
| blank_wall | 9.0 to 10.0 | 1152 to 1280 |

Upper bay: x 0-4 m variant A, 4-8 m variant B. Shopfront: x 0-4 m glazing + fascia, 4-6 m door, 6-8 m
roller shutter. Every row tiles horizontally at 8 m. ORM: R AO, G roughness, B tint mask (1 = main wall
material, authored neutral grey with mean luma 0.8: shade with `albedo * mix(vec3(1), tint / 0.8, B)`),
A glass (window panes).

## Not shipped (look-world)
`make_world_art.py` also draws `ground/sand.png`, `ground/ballast.png`, `ground/concrete.png` and `ground/laterite.png`
(art direction 4.5's sand, railway, industrial and Lagos verge ground). The server's ground document does not carry
those land uses yet, so nothing would use them; they are left out of the game pack (about 2.7 MB of ETC2) until it does.
Their sources would be Gravel023, Concrete034/036 and Ground037 (ambientCG, CC0) plus own procedural work.

## Kit meshes (`kit/*.res`)
68 meshes baked by `tools/world/bake_kit.gd` from `world_landmarks.gd` and `world_props.gd`: procedural, own work,
**CC0 1.0**. No third-party geometry. Parked and moving cars reuse the Kenney Car Kit already in `art/city/cars`
(CC0 1.0, `art/city/cars/LICENSE-Kenney-CarKit-CC0.txt`).

## Hero landmarks and the Times Square screens (day1-world)
- Elizabeth Tower, the Times Square screen tower, Hoover Tower, the National Arts Theatre and the generic arch,
  dome, spire and bridge pieces are built in code at load (`world_heroes.gd`, `world_landmarks.gd`): procedural,
  own work, **CC0 1.0**. No third-party geometry, no logos.
- `misc/screens.png`: 16 made-up ads and colour panels drawn by `tools/world/make_screens.py` (own work, **CC0 1.0**).
  Generic words and shapes only, no real brand, product or person. The words are rasterised from DejaVu Sans Bold
  (https://dejavu-fonts.github.io/License.html, Bitstream Vera licence: free to use, embed and redistribute);
  no font file is shipped.

## Build 29 real profile (mid and high tiers): art/world/real and art/street/real

Rebuilt by `tools/world/make_world_art.py <street assets> app/game3d/art/world --profile real` (fid29-street).
No stylise pass. Sources: Poly Haven (CC0 1.0, https://polyhaven.com/license; their preview renders are never
used) and ambientCG (CC0 1.0). Albedo bounds from Physically Based (CC0 1.0). Lettering and maker's marks are
never shipped: the gully grates are drawn by us (only a plain bar's iron grain is taken from Grate001).
Full list with URLs: docs/game3d/fid29/ASSETS-LICENCES-street.md.

| File | What | Size | px/m | Sources (CC0 1.0) | Processing |
|---|---|---|---|---|---|
| `real/ground/flags_uk.png` | London footway: grey concrete flags, dark joints | 1024 | 427 (2.4 m tile) | ph:large_square_pattern_01 | no stylise; mean-matched to linear [0.3, 0.295, 0.28] (chroma x0.55); lin lum mean 0.295, min 0.040, max 0.850 |
| `real/ground/flags_uk_n.png` | normal (GL), source strength | 1024 | 427 (2.4 m tile) | ph:large_square_pattern_01 | resized, renormalised |
| `real/ground/flags_uk_orm.png` | ORM: R AO, G roughness (source), B height | 512 | - | ph:large_square_pattern_01 | packed |
| `real/ground/flags_uk_mid.png` | London footway: grey concrete flags, dark joints (mid) | 512 | 213 (2.4 m tile) | ph:large_square_pattern_01 | no stylise; mean-matched to linear [0.3, 0.295, 0.28] (chroma x0.55); lin lum mean 0.295, min 0.040, max 0.850 |
| `real/ground/flags_uk_mid_n.png` | normal (GL), source strength | 512 | 213 (2.4 m tile) | ph:large_square_pattern_01 | resized, renormalised |
| `real/ground/flags_uk_mid_orm.png` | ORM: R AO, G roughness (source), B height | 256 | - | ph:large_square_pattern_01 | packed |
| `real/ground/plaza_uk.png` | civic square paving, pale slabs | 1024 | 320 (3.2 m tile) | acg:PavingStones133 | no stylise; mean-matched to linear [0.36, 0.345, 0.31] (chroma x0.45); lin lum mean 0.346, min 0.040, max 0.850 |
| `real/ground/plaza_uk_n.png` | normal (GL), source strength | 1024 | 320 (3.2 m tile) | acg:PavingStones133 | resized, renormalised |
| `real/ground/plaza_uk_orm.png` | ORM: R AO, G roughness (source), B height | 512 | - | acg:PavingStones133 | packed |
| `real/ground/plaza_uk_mid.png` | civic square paving, pale slabs (mid) | 512 | 160 (3.2 m tile) | acg:PavingStones133 | no stylise; mean-matched to linear [0.36, 0.345, 0.31] (chroma x0.45); lin lum mean 0.346, min 0.040, max 0.850 |
| `real/ground/plaza_uk_mid_n.png` | normal (GL), source strength | 512 | 160 (3.2 m tile) | acg:PavingStones133 | resized, renormalised |
| `real/ground/plaza_uk_mid_orm.png` | ORM: R AO, G roughness (source), B height | 256 | - | acg:PavingStones133 | packed |
| `real/ground/asphalt_uk.png` | carriageway asphalt, aged grey aggregate | 1024 | 256 (4.0 m tile) | ph:asphalt_04 | no stylise; mean-matched to linear [0.125, 0.122, 0.118] (chroma x0.6); lin lum mean 0.122, min 0.040, max 0.539 |
| `real/ground/asphalt_uk_n.png` | normal (GL), source strength | 1024 | 256 (4.0 m tile) | ph:asphalt_04 | resized, renormalised |
| `real/ground/asphalt_uk_orm.png` | ORM: R AO, G roughness (source), B height | 512 | - | ph:asphalt_04 | packed |
| `real/ground/asphalt_uk_mid.png` | carriageway asphalt, aged grey aggregate (mid) | 512 | 128 (4.0 m tile) | ph:asphalt_04 | no stylise; mean-matched to linear [0.125, 0.122, 0.118] (chroma x0.6); lin lum mean 0.122, min 0.040, max 0.459 |
| `real/ground/asphalt_uk_mid_n.png` | normal (GL), source strength | 512 | 128 (4.0 m tile) | ph:asphalt_04 | resized, renormalised |
| `real/ground/asphalt_uk_mid_orm.png` | ORM: R AO, G roughness (source), B height | 256 | - | ph:asphalt_04 | packed |
| `real/ground/kerb_uk.png` | granite kerb | 512 | 512 (1.0 m tile) | ph:granite_tile | no stylise; mean-matched to linear [0.17, 0.17, 0.168] (chroma x0.6); lin lum mean 0.170, min 0.079, max 0.365 |
| `real/ground/kerb_uk_n.png` | normal (GL), source strength | 512 | 512 (1.0 m tile) | ph:granite_tile | resized, renormalised |
| `real/ground/kerb_uk_orm.png` | ORM: R AO, G roughness (source), B height | 256 | - | ph:granite_tile | packed |
| `real/ground/kerb_uk_mid.png` | granite kerb (mid) | 256 | 256 (1.0 m tile) | ph:granite_tile | no stylise; mean-matched to linear [0.17, 0.17, 0.168] (chroma x0.6); lin lum mean 0.170, min 0.099, max 0.277 |
| `real/ground/kerb_uk_mid_n.png` | normal (GL), source strength | 256 | 256 (1.0 m tile) | ph:granite_tile | resized, renormalised |
| `real/ground/kerb_uk_mid_orm.png` | ORM: R AO, G roughness (source), B height | 128 | - | ph:granite_tile | packed |
| `real/ground/setts_uk.png` | granite setts (gutter channel) | 512 | 445 (1.15 m tile) | acg:PavingStones070 | no stylise; mean-matched to linear [0.16, 0.155, 0.15] (chroma x0.5); lin lum mean 0.156, min 0.040, max 0.539 |
| `real/ground/setts_uk_n.png` | normal (GL), source strength | 512 | 445 (1.15 m tile) | acg:PavingStones070 | resized, renormalised |
| `real/ground/setts_uk_orm.png` | ORM: R AO, G roughness (source), B height | 256 | - | acg:PavingStones070 | packed |
| `real/ground/setts_uk_mid.png` | granite setts (gutter channel) (mid) | 256 | 223 (1.15 m tile) | acg:PavingStones070 | no stylise; mean-matched to linear [0.16, 0.155, 0.15] (chroma x0.5); lin lum mean 0.156, min 0.040, max 0.422 |
| `real/ground/setts_uk_mid_n.png` | normal (GL), source strength | 256 | 223 (1.15 m tile) | acg:PavingStones070 | resized, renormalised |
| `real/ground/setts_uk_mid_orm.png` | ORM: R AO, G roughness (source), B height | 128 | - | acg:PavingStones070 | packed |
| `real/ground/decals.png` | decal atlas 4 x 4: gum (0-3), asphalt cracks/patches (4-7), leaves (8-9), gully grates drawn by us (10-11), damp stain (12), cracks (13-14), tar seal (15) | 1024 RGBA | - | acg:ChewingGum001, acg:ChewingGum002, acg:AsphaltDamageSet001, acg:ScatteredLeaves006, acg:Grate001 (iron grain from a bar with no lettering), ph:asphalt_02, ph:asphalt_04 | crops with source opacity; gully grates drawn (no maker's marks); luminance clamped |
| `real/ground/decals_mid.png` | decal atlas 4 x 4: gum (0-3), asphalt cracks/patches (4-7), leaves (8-9), gully grates drawn by us (10-11), damp stain (12), cracks (13-14), tar seal (15) | 512 RGBA | - | acg:ChewingGum001, acg:ChewingGum002, acg:AsphaltDamageSet001, acg:ScatteredLeaves006, acg:Grate001 (iron grain from a bar with no lettering), ph:asphalt_02, ph:asphalt_04 | crops with source opacity; gully grates drawn (no maker's marks); luminance clamped |
| `real/ground/detail_n.png` | detail normal, world 1.5 m (whiteout blend) | 512 | 341 | ph:asphalt_04 | high-passed normal |
| `real/ground/wear.png` | wear: R grime, G damp patches, B macro brightness (0.5 mean) | 512 | ~21 (24 m) | own work | procedural periodic noise; own work |
| `real/ground/paint_wear.png` | road paint wear mask (1 = paint left), world 1 m | 512 L | 512 | acg:RoadLines020C | opacity inside a worn stripe, crossed with itself |
| `real/trims/leak.png` | rain streaks mask (1 clean, dark = streak) | 512 L | - | acg:Leaking012A | luma, normalised |
| `real/trims/wall_detail_n.png` | masonry micro-detail normal for walls within 15 m (high) | 512 | 256 (2 m) | acg:Bricks097 | high-passed normal |
| `../street/real/medallion.png` | street medallion as a worn stone inlay (same motif), alpha = the disc | 1024 RGBA | 183 (5.6 m) | own: art/street/medallion.png motif, acg:PaintedPlaster017, ph:granite_tile, acg:ChewingGum002 | motif lines inlaid in dark granite; lin lum mean 0.221, min 0.040, max 0.489 |
| `../street/real/medallion_mid.png` | street medallion as a worn stone inlay (same motif), alpha = the disc | 512 RGBA | 91 (5.6 m) | own: art/street/medallion.png motif, acg:PaintedPlaster017, ph:granite_tile, acg:ChewingGum002 | motif lines inlaid in dark granite; lin lum mean 0.221, min 0.040, max 0.489 |
| `../street/real/pavers.png` | the arena floor on mid/high (= real/ground/flags_uk_mid) | 512 | - | ph:large_square_pattern_01 | copy |
| `real/trims/trim_uk_brick.png` | UK brick, London stock (yellow) photo brick, the uk_brick sheet's architecture | 1024x1280 | 128 (8 x 10 m) | acg:Bricks105 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_brick_orm.png` | ORM: R AO, G roughness (source), B tint mask, A glass | 512x640 | 64 | acg:Bricks105 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_brick_n.png` | normal map (GL), full strength, photo normal on the wall | 512x640 | 64 | acg:Bricks105 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_brick_red.png` | UK brick, Victorian red brick with burnt headers (mean = Physically Based brick) | 1024x1280 | 128 (8 x 10 m) | ph:brick_wall_001 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_brick_red_orm.png` | ORM: R AO, G roughness (source), B tint mask, A glass | 512x640 | 64 | ph:brick_wall_001 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_brick_red_n.png` | normal map (GL), full strength, photo normal on the wall | 512x640 | 64 | ph:brick_wall_001 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_stone.png` | UK stone: Portland ashlar coursing (drawn) over a real painted-render grain, tinted per building | 1024x1280 | 128 (8 x 10 m) | acg:PaintedPlaster017 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_stone_orm.png` | ORM: R AO, G roughness (source), B tint mask, A glass | 512x640 | 64 | acg:PaintedPlaster017 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
| `real/trims/trim_uk_stone_n.png` | normal map (GL), full strength, photo normal on the wall | 512x640 | 64 | acg:PaintedPlaster017 | no stylise; albedo mean-matched, every texel's linear luminance in [0.04, 0.85]; no baked light |
