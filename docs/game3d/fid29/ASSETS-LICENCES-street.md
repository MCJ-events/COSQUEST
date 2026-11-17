# fid29-street: assets and licences

Every third-party file behind `art/world/real/**` and `art/street/real/**` (build 29, mid and high tiers). All CC0 1.0: no
attribution is required; it is recorded anyway. No NC/ND licence, no Mixamo, MetaHuman, Fab or Megascans, nothing from a
game. Poly Haven preview renders are never used (only the texture maps). Downloaded 2026-11-14 to
`mmfarm:~/realism-20261111/fidelity-29/assets/street/` (208 MB on disk extracted, every download under 10 MB) by
`fetch.sh` (lane kit). Processing: `app/game3d/tools/world/make_world_art.py --profile real` (see `art/world/CREDITS.md`).

Not fetched from the plan: Poly Haven `modular_metal_gutter` (a model for downpipes; downpipes were cut in review).

## Licences

| Source | Licence | Licence line |
|---|---|---|
| ambientCG | CC0 1.0 | "All assets on ambientCG are provided under the Creative Commons CC0 1.0 Universal License." (https://docs.ambientcg.com/license/) |
| Poly Haven | CC0 1.0 | "All assets on Poly Haven are licensed as CC0" (https://polyhaven.com/license) |
| Physically Based (https://physicallybased.info, `physicallybased_materials.json`, albedo ranges only) | CC0 1.0 | "The database is released under the CC0 license" (https://physicallybased.info) |

## Downloads

| Source | Asset | URL | Bytes | sha256 (download, first 16) | Used for |
|---|---|---|---|---|---|
| ambientCG | `PavingStones133` | https://ambientcg.com/get?file=PavingStones133_1K-JPG.zip | 6781899 | `1fb6fbf8750aa835` | civic square paving (plaza_uk) |
| ambientCG | `PavingStones070` | https://ambientcg.com/get?file=PavingStones070_1K-JPG.zip | 9046803 | `84be05ad935c2a8e` | granite setts, gutter channel (setts_uk) |
| ambientCG | `PavingEdge002` | https://ambientcg.com/get?file=PavingEdge002_1K-JPG.zip | 1451957 | `906d1862a2b55a40` | not shipped (downloaded, not used) |
| ambientCG | `TactilePaving006` | https://ambientcg.com/get?file=TactilePaving006_1K-JPG.zip | 9077768 | `ca1431014704da80` | not shipped (downloaded, not used) |
| ambientCG | `Bricks105` | https://ambientcg.com/get?file=Bricks105_1K-JPG.zip | 4840980 | `d81326d3193b279c` | London stock brick facades (trim_uk_brick) |
| ambientCG | `Bricks097` | https://ambientcg.com/get?file=Bricks097_1K-JPG.zip | 5172084 | `97b5df360161e48b` | wall micro-detail normal (high, walls within 15 m) |
| ambientCG | `PaintedPlaster017` | https://ambientcg.com/get?file=PaintedPlaster017_1K-JPG.zip | 4721132 | `bae0380d82b6ccac` | Portland stone facades' render grain (trim_uk_stone), the medallion's pale stone grain |
| ambientCG | `ChewingGum001` | https://ambientcg.com/get?file=ChewingGum001_1K-JPG.zip | 2744604 | `e9657f90607583a0` | gum decals |
| ambientCG | `ChewingGum002` | https://ambientcg.com/get?file=ChewingGum002_1K-JPG.zip | 3422279 | `8a9c64efb5d1a077` | gum decals, medallion gum |
| ambientCG | `AsphaltDamageSet001` | https://ambientcg.com/get?file=AsphaltDamageSet001_1K-JPG.zip | 5052524 | `1be7c8c6beb2d8c5` | asphalt crack and patch decals |
| ambientCG | `ManholeCover009` | https://ambientcg.com/get?file=ManholeCover009_1K-JPG.zip | 7699261 | `e1c36609100260c9` | not shipped (has cast lettering; never used) |
| ambientCG | `Grate001` | https://ambientcg.com/get?file=Grate001_1K-JPG.zip | 7592915 | `75058b4dcd76b4a0` | iron grain of our drawn gully grates (a plain bar only, no lettering) |
| ambientCG | `Leaking012A` | https://ambientcg.com/get?file=Leaking012A_1K-JPG.zip | 2215094 | `fcaa38d082651f4d` | rain streaks under sills |
| ambientCG | `ScatteredLeaves006` | https://ambientcg.com/get?file=ScatteredLeaves006_1K-JPG.zip | 5442843 | `7b9c0b99f5d21cd3` | leaf decals |
| ambientCG | `RoadLines020C` | https://ambientcg.com/get?file=RoadLines020C_1K-JPG.zip | 5574566 | `3bced8c5596160dc` | paint wear mask of our own UK markings (opacity only) |
| Poly Haven | `large_square_pattern_01/diff` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/large_square_pattern_01/large_square_pattern_01_diff_2k.jpg | 2434074 | `c5a8ba7f4b0ddbb1` | grey London footway flags (flags_uk, arena floor) |
| Poly Haven | `large_square_pattern_01/nor_gl` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/large_square_pattern_01/large_square_pattern_01_nor_gl_2k.jpg | 4179150 | `930d3b625e458818` | grey London footway flags (flags_uk, arena floor) |
| Poly Haven | `large_square_pattern_01/arm` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/large_square_pattern_01/large_square_pattern_01_arm_2k.jpg | 456388 | `7e0af2f9edd94e61` | grey London footway flags (flags_uk, arena floor) |
| Poly Haven | `large_square_pattern_01/disp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/large_square_pattern_01/large_square_pattern_01_disp_2k.jpg | 518932 | `bca0f40817fb656a` | grey London footway flags (flags_uk, arena floor) |
| Poly Haven | `large_square_pattern_01/rough` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/large_square_pattern_01/large_square_pattern_01_rough_2k.jpg | 1342592 | `acca3a82a062b8c2` | grey London footway flags (flags_uk, arena floor) |
| Poly Haven | `large_square_pattern_01/ao` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/large_square_pattern_01/large_square_pattern_01_ao_2k.jpg | 2157733 | `3e7f038d0d44f6ab` | grey London footway flags (flags_uk, arena floor) |
| Poly Haven | `asphalt_04/diff` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_04/asphalt_04_diff_2k.jpg | 3999385 | `e02ac16d23ea9700` | carriageway asphalt, detail normal, tar seal decal |
| Poly Haven | `asphalt_04/nor_gl` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_04/asphalt_04_nor_gl_2k.jpg | 4581129 | `16ab393a8e9135ff` | carriageway asphalt, detail normal, tar seal decal |
| Poly Haven | `asphalt_04/arm` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_04/asphalt_04_arm_2k.jpg | 2548131 | `c302965bb3c3efc1` | carriageway asphalt, detail normal, tar seal decal |
| Poly Haven | `asphalt_04/disp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_04/asphalt_04_disp_2k.jpg | 1812846 | `8cd3db77f2d618cb` | carriageway asphalt, detail normal, tar seal decal |
| Poly Haven | `asphalt_04/rough` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_04/asphalt_04_rough_2k.jpg | 2281861 | `4a5090564b400e48` | carriageway asphalt, detail normal, tar seal decal |
| Poly Haven | `asphalt_04/ao` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_04/asphalt_04_ao_2k.jpg | 2143804 | `ba98b9ec276e8eee` | carriageway asphalt, detail normal, tar seal decal |
| Poly Haven | `asphalt_02/diff` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_02/asphalt_02_diff_2k.jpg | 3075676 | `28f5ba8690553f19` | crack decals |
| Poly Haven | `asphalt_02/nor_gl` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_02/asphalt_02_nor_gl_2k.jpg | 4943950 | `ffe49db71a0fd34c` | crack decals |
| Poly Haven | `asphalt_02/arm` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_02/asphalt_02_arm_2k.jpg | 1299186 | `ed70e88640e4ed51` | crack decals |
| Poly Haven | `asphalt_02/disp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_02/asphalt_02_disp_2k.jpg | 1131595 | `943f254ed5e15041` | crack decals |
| Poly Haven | `asphalt_02/rough` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_02/asphalt_02_rough_2k.jpg | 2230457 | `b9a516b61b7040a9` | crack decals |
| Poly Haven | `asphalt_02/ao` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_02/asphalt_02_ao_2k.jpg | 2039487 | `5fe1737cbbcd55f2` | crack decals |
| Poly Haven | `patterned_brick_floor/diff` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/patterned_brick_floor/patterned_brick_floor_diff_1k.jpg | 1037425 | `5825486c31cd54be` | not shipped (downloaded, not used) |
| Poly Haven | `patterned_brick_floor/nor_gl` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/patterned_brick_floor/patterned_brick_floor_nor_gl_1k.jpg | 892122 | `daeecd847e5f02a1` | not shipped (downloaded, not used) |
| Poly Haven | `patterned_brick_floor/arm` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/patterned_brick_floor/patterned_brick_floor_arm_1k.jpg | 616043 | `2138dbb1e10ea9d0` | not shipped (downloaded, not used) |
| Poly Haven | `patterned_brick_floor/disp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/patterned_brick_floor/patterned_brick_floor_disp_1k.jpg | 445082 | `af30e974f39bb7a6` | not shipped (downloaded, not used) |
| Poly Haven | `patterned_brick_floor/rough` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/patterned_brick_floor/patterned_brick_floor_rough_1k.jpg | 482707 | `01fd5eeaf84d75b8` | not shipped (downloaded, not used) |
| Poly Haven | `patterned_brick_floor/ao` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/patterned_brick_floor/patterned_brick_floor_ao_1k.jpg | 653286 | `1814c7828d3d7463` | not shipped (downloaded, not used) |
| Poly Haven | `granite_tile/diff` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/granite_tile/granite_tile_diff_1k.jpg | 676597 | `9df48b6605558870` | granite kerbs, basin coping, medallion granite inlay |
| Poly Haven | `granite_tile/nor_gl` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/granite_tile/granite_tile_nor_gl_1k.jpg | 592362 | `bb9a122e0a1171c5` | granite kerbs, basin coping, medallion granite inlay |
| Poly Haven | `granite_tile/arm` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/granite_tile/granite_tile_arm_1k.jpg | 718960 | `3262e58c2f3bd9ff` | granite kerbs, basin coping, medallion granite inlay |
| Poly Haven | `granite_tile/disp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/granite_tile/granite_tile_disp_1k.jpg | 409126 | `6f37b903963de2bd` | granite kerbs, basin coping, medallion granite inlay |
| Poly Haven | `granite_tile/rough` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/granite_tile/granite_tile_rough_1k.jpg | 674755 | `0bb28aebdb75b850` | granite kerbs, basin coping, medallion granite inlay |
| Poly Haven | `granite_tile/ao` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/granite_tile/granite_tile_ao_1k.jpg | 456910 | `0c780df8928f5462` | granite kerbs, basin coping, medallion granite inlay |
| Poly Haven | `brick_wall_001/diff` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_001/brick_wall_001_diffuse_1k.jpg | 574381 | `6a1233ec0186703d` | Victorian red brick facades (trim_uk_brick_red) |
| Poly Haven | `brick_wall_001/nor_gl` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_001/brick_wall_001_nor_gl_1k.jpg | 295279 | `8afbe3919308b168` | Victorian red brick facades (trim_uk_brick_red) |
| Poly Haven | `brick_wall_001/arm` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_001/brick_wall_001_arm_1k.jpg | 123384 | `8e6ab4cecd82c430` | Victorian red brick facades (trim_uk_brick_red) |
| Poly Haven | `brick_wall_001/disp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_001/brick_wall_001_displacement_1k.jpg | 172991 | `1d9df12c1ca4a6d4` | Victorian red brick facades (trim_uk_brick_red) |
| Poly Haven | `brick_wall_001/rough` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_001/brick_wall_001_rough_1k.jpg | 211093 | `a23342b02e6c5af1` | Victorian red brick facades (trim_uk_brick_red) |
| Poly Haven | `brick_wall_001/ao` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_001/brick_wall_001_ao_1k.jpg | 269071 | `2f31353849465651` | Victorian red brick facades (trim_uk_brick_red) |
| Poly Haven | `painted_metal_shutter/diff` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_diff_1k.jpg | 627333 | `278394aabcb5a5bd` | not shipped (downloaded, not used) |
| Poly Haven | `painted_metal_shutter/nor_gl` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_nor_gl_1k.jpg | 730726 | `7545d778669c55e3` | not shipped (downloaded, not used) |
| Poly Haven | `painted_metal_shutter/arm` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_arm_1k.jpg | 606809 | `26a49a8b60dd2e1f` | not shipped (downloaded, not used) |
| Poly Haven | `painted_metal_shutter/disp` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_disp_1k.jpg | 346308 | `2df680fa77b4a670` | not shipped (downloaded, not used) |
| Poly Haven | `painted_metal_shutter/rough` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_rough_1k.jpg | 547880 | `bb32b8783a96b33e` | not shipped (downloaded, not used) |
| Poly Haven | `painted_metal_shutter/ao` | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/painted_metal_shutter/painted_metal_shutter_ao_1k.jpg | 263990 | `21680c30033442ed` | not shipped (downloaded, not used) |

## Source maps read by the pipeline (full sha256)

```
d050e4d0fcf036340bc6803401c54c621de038f6add0aeffb72cb340b3c6a54b  acg/AsphaltDamageSet001/AsphaltDamageSet001_1K-JPG_Color.jpg
06031cf343bd445878f79b750ebfa7546079c8f55aedcad570d6b3d6a3bd4f48  acg/AsphaltDamageSet001/AsphaltDamageSet001_1K-JPG_Displacement.jpg
f5b8c09c8785671d81b935244b7026db29aa1f34d6b64e5697a4582a990f6e9f  acg/AsphaltDamageSet001/AsphaltDamageSet001_1K-JPG_NormalDX.jpg
f160968694cd3030b2ab947a38b5b13904339d87dc77dce46c7cc4015a8d8373  acg/AsphaltDamageSet001/AsphaltDamageSet001_1K-JPG_NormalGL.jpg
28bd9afde54f8360287795438cc828205c14b808d4f96b0ec7792eebb0fc9098  acg/AsphaltDamageSet001/AsphaltDamageSet001_1K-JPG_Opacity.jpg
fab14b8dadb360586f295f978ef077895d52f7e29ab8530780ba15d633818834  acg/AsphaltDamageSet001/AsphaltDamageSet001_1K-JPG_Roughness.jpg
80e610cfe7149e3759b3c49c93566cbcd07da89fb5de332a4d64b0a1d29acd28  acg/Bricks097/Bricks097_1K-JPG_AmbientOcclusion.jpg
218f7343091f1c0d9044fd642247d23dd322087271df1b45c8f51fdff91042dd  acg/Bricks097/Bricks097_1K-JPG_Color.jpg
01118cacc0b4d8d10b0c9af494d294041e1e3403bf0bc05b8182a91e93c203f7  acg/Bricks097/Bricks097_1K-JPG_Displacement.jpg
18fce615c116cf0292a2cdf93d89352d341ffc99b2df6982c4e4ac6a55ef49bf  acg/Bricks097/Bricks097_1K-JPG_NormalDX.jpg
3c13ff7b8018983e0d1529fa330b2d4494f92da299b72db19dbc76282f3f23e7  acg/Bricks097/Bricks097_1K-JPG_NormalGL.jpg
a629784339b79cff67079a34f313ec5de18b8b6eb478455ac9b8df09c615b37d  acg/Bricks097/Bricks097_1K-JPG_Roughness.jpg
981b41ca74a7f05ff6626713c665612a52c87191f0bf8c747fbe8f97a02d67b4  acg/Bricks105/Bricks105_1K-JPG_AmbientOcclusion.jpg
643bbc3f2eb6de3e5a8ad762553369662aa30e448126057874dbd4342cddbe3e  acg/Bricks105/Bricks105_1K-JPG_Color.jpg
bb45588e3dba3f545d156ce2e019b55f63a0ba7027d41cd0d1db6223684f9eed  acg/Bricks105/Bricks105_1K-JPG_Displacement.jpg
15d4070f589fdeccce98e62b93e6f53db30c79a88b9f53948a83005d937f48af  acg/Bricks105/Bricks105_1K-JPG_NormalDX.jpg
c3a9687ea0501fb566b661e2684e29f5bf59daebaab0271d161d1a5b8d170e9f  acg/Bricks105/Bricks105_1K-JPG_NormalGL.jpg
96fd742c822c40b95c67c51608727121f7dfb0772843118fe7ebff7fb9bcd19e  acg/Bricks105/Bricks105_1K-JPG_Roughness.jpg
c9f06f5d8f4c5607cf6ea17a3c7de7bfffd544c9573573490c8589f225f7c513  acg/ChewingGum001/ChewingGum001_1K-JPG_AmbientOcclusion.jpg
a78819382187bab5157d85c21310e4fead6337dbcae1dde3b04dc5637d75607a  acg/ChewingGum001/ChewingGum001_1K-JPG_Color.jpg
25977fef493ae9e95003ce1c3f601421a8e859337027db06e59b069b83f73463  acg/ChewingGum001/ChewingGum001_1K-JPG_Displacement.jpg
b299e68d225e14a5ed69f2dbef8a323db2dcd696b5da56fa02a18e0a8d2d250a  acg/ChewingGum001/ChewingGum001_1K-JPG_NormalDX.jpg
7a8290f2424c7c4d34ab9619bae526b9ce745d4e1d2cf96b9295394499d1c373  acg/ChewingGum001/ChewingGum001_1K-JPG_NormalGL.jpg
1924e5f4de0ebef5eff931e376b9b42168670723c2f8d2c51ed63cfd73ba87f5  acg/ChewingGum001/ChewingGum001_1K-JPG_Opacity.jpg
1d935afbea4880541de1f0f60d246051bd17eb443c4be41f7824b385e065465f  acg/ChewingGum001/ChewingGum001_1K-JPG_Roughness.jpg
d8ba886efaf51c3d0265b57f72b5cbe4d25b08216f97ad0ce89e0783804ac162  acg/ChewingGum002/ChewingGum002_1K-JPG_AmbientOcclusion.jpg
713d8d228069397628f116d22ca853077f049bdbd1f5b263d4b92ff82675a51a  acg/ChewingGum002/ChewingGum002_1K-JPG_Color.jpg
2d07d287cfa87a9b6fca586e6a275faa74929425f156f9211e4fc11e21f17241  acg/ChewingGum002/ChewingGum002_1K-JPG_Displacement.jpg
d3424e2656eb0a5472f2af7795169a4d3c70d367fef08e4ba22a2dcfc7d12100  acg/ChewingGum002/ChewingGum002_1K-JPG_NormalDX.jpg
f4fd2b855f5cd7e96a785b4475230529f68dfc82e62d62be532f226f0e008e08  acg/ChewingGum002/ChewingGum002_1K-JPG_NormalGL.jpg
19b1911c5945efb5aca43c7808ae788fc0660ca6f690ff5b95fd36b9ac70babb  acg/ChewingGum002/ChewingGum002_1K-JPG_Opacity.jpg
529186988dcfd5fcab1aaf91bb39d70d70311738c2d560c1c613021930925511  acg/ChewingGum002/ChewingGum002_1K-JPG_Roughness.jpg
1c30afeb7f2d8f7070dc6b4f50a1b4dd9951daa5db68537398606e980aad1c6e  acg/Grate001/Grate001_1K-JPG_AmbientOcclusion.jpg
3d1e8be823a2de9cc8120e7a94325807a0f2a3277695f96660fb3c36f8013072  acg/Grate001/Grate001_1K-JPG_Color.jpg
1344c9d19be4f0c667a63cdc272920530038713a2cfda0e17bcce81b3a6d4250  acg/Grate001/Grate001_1K-JPG_Displacement.jpg
7945edd8cb5fe3f8bf094521b5c61494c2a023fe4432f913d9eef7189f471a4f  acg/Grate001/Grate001_1K-JPG_Metalness.jpg
48dbe85016f57d338c310e234d9944d3069cd350cdb9e23eceaa617e912ecf3f  acg/Grate001/Grate001_1K-JPG_NormalDX.jpg
275ababb07fc011ec78b315b88d8802cef22b6c300bba4f07b864f9805c77a1d  acg/Grate001/Grate001_1K-JPG_NormalGL.jpg
b9f2aac08313721cfa734d89417900f09d8a11a4e7ca1321052a812e6382bb1a  acg/Grate001/Grate001_1K-JPG_Opacity.jpg
ab35354cdc51a130a84ca4fd1eae21f9af8571b6bb49e5dff26d86929330a489  acg/Grate001/Grate001_1K-JPG_Roughness.jpg
359e668b01e4ccfbb57df33a951223440cf685b046c096f3a0fd383ad1a8d0b3  acg/Leaking012A/Leaking012A_1K-JPG_Color.jpg
ce18c048ab1691ec1e93db5901df2f5c97848c628ccd46f3ac557b946fa5b8da  acg/Leaking012A/Leaking012A_1K-JPG_Displacement.jpg
bf330263a3129b164e9890e47144565a44be1e000910a8930260a91537175175  acg/Leaking012A/Leaking012A_1K-JPG_Metalness.jpg
5642f5911114175787c836d5556f682da3a69a1b0816a85c63adaf75af20a7ce  acg/Leaking012A/Leaking012A_1K-JPG_NormalDX.jpg
c0ed9d96f6384d65b84efaa7d7d159f44bce47df512124c77906a8bb6add8976  acg/Leaking012A/Leaking012A_1K-JPG_NormalGL.jpg
8da94aa0dfcb73cd33d3da472921d41fe404f7b77480a6629eeddfd310591374  acg/Leaking012A/Leaking012A_1K-JPG_Roughness.jpg
bdde9c294c7fcb807611f644b7114484eaca5c13e492953a14a9e00cead9c58c  acg/ManholeCover009/ManholeCover009_1K-JPG_AmbientOcclusion.jpg
c4fb5ee1019b808f2d027de11f3a89f05bb0f92f5fa8efe4d46e55fb8a43ba08  acg/ManholeCover009/ManholeCover009_1K-JPG_Color.jpg
c55a9a2b73cab8d86be043e4d6bc8d60f9db647f759533d475fe60bfe1b7173c  acg/ManholeCover009/ManholeCover009_1K-JPG_Displacement.jpg
a802280ad09fb6822c071be4a9a7bb699ea0ee262789f35d9da77e845c444f87  acg/ManholeCover009/ManholeCover009_1K-JPG_Metalness.jpg
e8aa953e244ccca79152ba73e3c3564c418c1e7c597651a0d594541c3fa91960  acg/ManholeCover009/ManholeCover009_1K-JPG_NormalDX.jpg
1c3f534ede0d88e9298f94f14d4d264354a92ce3a3d144b97efc4d086a5ccc79  acg/ManholeCover009/ManholeCover009_1K-JPG_NormalGL.jpg
36b3cc00b4a1b9f478c117c424b50c4c8c66cf041f93e5b68d3d8e981b7f204a  acg/ManholeCover009/ManholeCover009_1K-JPG_Opacity.jpg
c2c3bab32c0d3844c72f6e21fe1a39b13821a04870ac138c3fbabadfc73c813d  acg/ManholeCover009/ManholeCover009_1K-JPG_Roughness.jpg
ed8a69a6437de9d41d2cf380f7e6a216232fc4754f256c3405985c857547ffef  acg/PaintedPlaster017/PaintedPlaster017_1K-JPG_Color.jpg
4633e8055001943dc749865e7a4c52ca91b87bf31d8bd78e5c51561bd1a6da7c  acg/PaintedPlaster017/PaintedPlaster017_1K-JPG_Displacement.jpg
d94a1d7db9bbd8f63e47a8379301c06c6e359d952d8ba9c538487b58fc6a9d5d  acg/PaintedPlaster017/PaintedPlaster017_1K-JPG_NormalDX.jpg
1bef1887c10e1ce104be1a557e4dbd7634ef6d5ece6e3b4237dab2d0962f57fa  acg/PaintedPlaster017/PaintedPlaster017_1K-JPG_NormalGL.jpg
a83ecc2ba5b9d80bb9a27381f3389ccdb20c77ef6358b92f3d11455403d651d8  acg/PaintedPlaster017/PaintedPlaster017_1K-JPG_Roughness.jpg
d7b850090f9ea10f45d98ce4ff38bf6e46facab9f08f34b6ab01b8fe1acd6178  acg/PavingEdge002/PavingEdge002_1K-JPG_Color.jpg
f5af70e62e8dbc82f8569283c76aa77a80f47b12a97cb53042b104fc11a27cd7  acg/PavingEdge002/PavingEdge002_1K-JPG_Displacement.jpg
67affd553c500c68f1c1d8a9cceeecd50f50ecb563818134c00b7dbd411bc65d  acg/PavingEdge002/PavingEdge002_1K-JPG_NormalDX.jpg
ece83da72b6ca271aa13bd00f2de5a6e207df17029619165451b60e0832770b6  acg/PavingEdge002/PavingEdge002_1K-JPG_NormalGL.jpg
6e79f1692e3c4006fd22daa14b3ef424c91bf280e599645a4950b0c082ac4f5d  acg/PavingEdge002/PavingEdge002_1K-JPG_Opacity.jpg
b6f56fa7a05bab56f94d9639b86ddfadda3da57fcb2b34a312193a6e38f645b6  acg/PavingEdge002/PavingEdge002_1K-JPG_Roughness.jpg
d5a3cc7c22b4ea761ac225440a4604b7b2fc36c546f6fdf72d431d270b4f2166  acg/PavingStones070/PavingStones070_1K-JPG_AmbientOcclusion.jpg
4dd55b7eaf648810c88f3c3ea96028bb9c99b3c448b3800416f9f2af1a84a57d  acg/PavingStones070/PavingStones070_1K-JPG_Color.jpg
c2692de2264a81169b4b2f38e2f632ccbef2d14f9e6f9f4163f655e49ba8ad99  acg/PavingStones070/PavingStones070_1K-JPG_Displacement.jpg
a81360d79b5854e748a27ee6df24643c3215051b82fd4b67dcf9a7945771bb04  acg/PavingStones070/PavingStones070_1K-JPG_NormalDX.jpg
7ee144389951d74b5f8bf0a31d712382b662bf161c29644392465d069ff57912  acg/PavingStones070/PavingStones070_1K-JPG_NormalGL.jpg
1a974eeeb2419985da74ae53b0ae1706d7ad0220ab52cee2e2ae00f1f32affc7  acg/PavingStones070/PavingStones070_1K-JPG_Roughness.jpg
4c1d9442dceee5f8606e798a829568253e0c01b2a11c278f8573272e07edcb9b  acg/PavingStones133/PavingStones133_1K-JPG_AmbientOcclusion.jpg
62bc0391ae9a13c99c0391b6db33aaef7926cc828aa5fe33b39eec3b6d76bbe1  acg/PavingStones133/PavingStones133_1K-JPG_Color.jpg
e4779a68283aff1c8f5da53bedd25f27443cdf49fe7129132687a0b3623c3170  acg/PavingStones133/PavingStones133_1K-JPG_Displacement.jpg
001e037ce54971e1f9068636f3cb77ec20fe56fb5b912d91c8f7deebde7835d3  acg/PavingStones133/PavingStones133_1K-JPG_NormalDX.jpg
045982cc55ac2445724614457b7357238e624f9e8c178527cd7c0f6250b5987d  acg/PavingStones133/PavingStones133_1K-JPG_NormalGL.jpg
b5c4e9a300c33253ab90914aea124e29aa8d28584cb7fc6905f234fa8e1a298f  acg/PavingStones133/PavingStones133_1K-JPG_Roughness.jpg
e68f7922fea5348cafa6a4a55092f187c940b73e8299ea0df8797a485f9beff8  acg/RoadLines020C/RoadLines020C_1K-JPG_AmbientOcclusion.jpg
52f3793ad96b80c8241708144222fc50116b8c99a300110e1f71cde3b557543b  acg/RoadLines020C/RoadLines020C_1K-JPG_Color.jpg
91493456aa26dfbc80c5ee0807d416d81b926379582ddda7d2d39ad777e1421b  acg/RoadLines020C/RoadLines020C_1K-JPG_Displacement.jpg
78d3f236eefef8f83df611b3999b0c44b9128055c7abbd4fe289bcae9c392597  acg/RoadLines020C/RoadLines020C_1K-JPG_NormalDX.jpg
c92ac9eca85ea69f845d57e3c7636413e4682375ab8457648c2c28cccf124b91  acg/RoadLines020C/RoadLines020C_1K-JPG_NormalGL.jpg
4b2a0284bd5530078595d05465b54caf06ee84ae1fef5b6a9feb6041eb7660a2  acg/RoadLines020C/RoadLines020C_1K-JPG_Opacity.jpg
84da13624efa6e196fbbd891462d12d3eb3b3e7687dbd8a2ab7f53bdeb0450c1  acg/RoadLines020C/RoadLines020C_1K-JPG_Roughness.jpg
a0bcca2c3e26102b3086b3b59b57257296792ae581b3bd960aa7be4fb0affb64  acg/ScatteredLeaves006/ScatteredLeaves006_1K-JPG_Color.jpg
c3f2eaa16d8a0fc0c8b6ef7dc2220c205796561c5ce73908176699b19ea64176  acg/ScatteredLeaves006/ScatteredLeaves006_1K-JPG_Displacement.jpg
09dada8a89e7ff7f3b007f14e257d22c072617610732bbac7cb74db652b71dae  acg/ScatteredLeaves006/ScatteredLeaves006_1K-JPG_NormalDX.jpg
fb1a45ee95f71ae496aca51e7844fd304525c209b9b1c3954fd16768fc993f4e  acg/ScatteredLeaves006/ScatteredLeaves006_1K-JPG_NormalGL.jpg
5d5b211969609126f1fc9c22df6a888548caccb0854da43571399eeb0bf96538  acg/ScatteredLeaves006/ScatteredLeaves006_1K-JPG_Opacity.jpg
e7b81ad169bf1e93574eabd8a5dbfb84c112dd22db117229ee1e25a32a841b00  acg/ScatteredLeaves006/ScatteredLeaves006_1K-JPG_Roughness.jpg
3241faf8ed5290750b37fe1298fea127ff09dd4dc3267d1638749880e76026dd  acg/TactilePaving006/TactilePaving006_1K-JPG_AmbientOcclusion.jpg
8388249db0a88a815d829ad68008d64f2f7c348a0b249cb5de79c7b232d65229  acg/TactilePaving006/TactilePaving006_1K-JPG_Color.jpg
880b75d972c6fe68a44e8fc0b91befd2a55b444af3de1ed92647c0d59d75f215  acg/TactilePaving006/TactilePaving006_1K-JPG_Displacement.jpg
e5832109e2d00f49479c1a15a51cf467e3bc62d0e168baf3109fba3309c1b3b3  acg/TactilePaving006/TactilePaving006_1K-JPG_NormalDX.jpg
30850aa2d6421b80b3db63aa28e800249efff332a44008a0fd91f821213bf1f0  acg/TactilePaving006/TactilePaving006_1K-JPG_NormalGL.jpg
51c85cd707324a0f7f30ac8e7233acf585a6951579b1006522cc19cb0ecb02b2  acg/TactilePaving006/TactilePaving006_1K-JPG_Roughness.jpg
5fe1737cbbcd55f2fec3632d6170762e5733f24bbc7a7816afb22a23c710b11f  ph/asphalt_02/asphalt_02_ao_2k.jpg
ed70e88640e4ed51cf1c3e57cb20db26983599b20b867c2526439e3a2c849fea  ph/asphalt_02/asphalt_02_arm_2k.jpg
28f5ba8690553f192c0e5e1a5ff40f34765b4b93f4cc7059b1a3e9c795b6c28c  ph/asphalt_02/asphalt_02_diff_2k.jpg
943f254ed5e1504131547b35afe3798771cdda33842b7fdc6c0288b8312a44b0  ph/asphalt_02/asphalt_02_disp_2k.jpg
ffe49db71a0fd34c1e259625df66a302a237597d6ef655307987ec4e45bc6f21  ph/asphalt_02/asphalt_02_nor_gl_2k.jpg
b9a516b61b7040a9245ac206642d5f767ad9589a0169c4a1668221429e8a998c  ph/asphalt_02/asphalt_02_rough_2k.jpg
ba98b9ec276e8eee68a5b01b411207f386471ac898bac641380f4f5a5ae7b6ce  ph/asphalt_04/asphalt_04_ao_2k.jpg
c302965bb3c3efc151215a797b9996e941d68f1f167c514f15fb008bdcac2479  ph/asphalt_04/asphalt_04_arm_2k.jpg
e02ac16d23ea97008c2507cf58bfad7c18a3b5933b5bdea14f7f90f33a784976  ph/asphalt_04/asphalt_04_diff_2k.jpg
8cd3db77f2d618cb0c6ed46f043355541cc9e2b725fa335d10e0d2b0511f0aea  ph/asphalt_04/asphalt_04_disp_2k.jpg
16ab393a8e9135ff1f30545bc0bc46b7b7f79da8db881bcb0da22cd12d528257  ph/asphalt_04/asphalt_04_nor_gl_2k.jpg
4a5090564b400e481af564f97e2f8ba0db820a61f6b2d50d0cfe92160a7161ab  ph/asphalt_04/asphalt_04_rough_2k.jpg
2f3135384946565118afd5b17a36c9535a4946445e6b005b406097c6c719828f  ph/brick_wall_001/brick_wall_001_ao_1k.jpg
8e6ab4cecd82c4305c9511065b0795bd579df89df8364a76a7359c1278bed38d  ph/brick_wall_001/brick_wall_001_arm_1k.jpg
6a1233ec0186703de830354d89f122991e61e67fb67e0846c7eaf6c5aefea902  ph/brick_wall_001/brick_wall_001_diffuse_1k.jpg
1d9df12c1ca4a6d47afab93e86caca13e44fc77fe2ef18475f83e02782b6a0eb  ph/brick_wall_001/brick_wall_001_displacement_1k.jpg
8afbe3919308b168a6b7235fe7b930f670cfffa1a34de39ee790d55c9d7bda09  ph/brick_wall_001/brick_wall_001_nor_gl_1k.jpg
a23342b02e6c5af106aaece16130aa9153a801cb1a84d5f3e0d06ce248677f38  ph/brick_wall_001/brick_wall_001_rough_1k.jpg
0c780df8928f5462ae0d721a76788b86062d13871618f36b7dc3a9d7664984df  ph/granite_tile/granite_tile_ao_1k.jpg
3262e58c2f3bd9fff8e374c9aa52ef88c28a4115b550934faa90433dba67470a  ph/granite_tile/granite_tile_arm_1k.jpg
9df48b66055588708d446e69f37ea6146b8d5d3df54cd1ff088ec688acdca95c  ph/granite_tile/granite_tile_diff_1k.jpg
6f37b903963de2bd3eaa28ac18f5f42735087ef26c5ba9e8cba7a50e9e7d557e  ph/granite_tile/granite_tile_disp_1k.jpg
bb9a122e0a1171c52458fc9ac82f588f4e100f1f7b461cc15028bed1c63fe961  ph/granite_tile/granite_tile_nor_gl_1k.jpg
0bb28aebdb75b850714f936bfb180ffcbb6607342f925ad27f0bfcb5a31ca8de  ph/granite_tile/granite_tile_rough_1k.jpg
3e7f038d0d44f6ab2002c901b9d682249c8ade2d8053b98fdb9c40f5f293c2d6  ph/large_square_pattern_01/large_square_pattern_01_ao_2k.jpg
7e0af2f9edd94e61a15f64073d13c6314cb66c33f9b94e5969d5ad06333d8a1d  ph/large_square_pattern_01/large_square_pattern_01_arm_2k.jpg
c5a8ba7f4b0ddbb1400300ebe7af1e3010243e6d5d246caa285efc1e73023eef  ph/large_square_pattern_01/large_square_pattern_01_diff_2k.jpg
bca0f40817fb656a3aadfa21694e578eddf65f16f97fea34fee32794efd73f72  ph/large_square_pattern_01/large_square_pattern_01_disp_2k.jpg
930d3b625e458818752811c469d1ccc8dcb2aa895c162db73a000eabc9eb648d  ph/large_square_pattern_01/large_square_pattern_01_nor_gl_2k.jpg
acca3a82a062b8c28409c1ba3fcb26ce185ac8800749e5f9ed524f184cd068b5  ph/large_square_pattern_01/large_square_pattern_01_rough_2k.jpg
21680c30033442ed5c0fa2424ec1f397acfcc7896016d02eb5b98b19aab5d8b7  ph/painted_metal_shutter/painted_metal_shutter_ao_1k.jpg
26a49a8b60dd2e1fdb325c1488d55d2e6e7362f4505e400ac2243bf0ec67ca56  ph/painted_metal_shutter/painted_metal_shutter_arm_1k.jpg
278394aabcb5a5bd560d9904358682acc5af23666b22bd1f12558789da4aa4d2  ph/painted_metal_shutter/painted_metal_shutter_diff_1k.jpg
2df680fa77b4a670a6739a5557f2d949ba785dc07066738e0bc39074060e3906  ph/painted_metal_shutter/painted_metal_shutter_disp_1k.jpg
7545d778669c55e3e9bdc89355ce7190077c3ffdfb324e988ff9803a5bae5a46  ph/painted_metal_shutter/painted_metal_shutter_nor_gl_1k.jpg
bb32b8783a96b33e5807ecfdc242b69a08f0aeec4e0609f5dc9be62890ed88f2  ph/painted_metal_shutter/painted_metal_shutter_rough_1k.jpg
1814c7828d3d746303bc7188898a2b8e4bcc7c8ebb95f8a83c04e0caef121e21  ph/patterned_brick_floor/patterned_brick_floor_ao_1k.jpg
2138dbb1e10ea9d0ecb42181f864b5c50642ae3275cb901dd9f71609e430fa2c  ph/patterned_brick_floor/patterned_brick_floor_arm_1k.jpg
5825486c31cd54be219ce98280a614e9dfc7080a8cf0b39edab71e12272aa2d9  ph/patterned_brick_floor/patterned_brick_floor_diff_1k.jpg
af30e974f39bb7a6eda5424c8f382099eb12be7733d3f7439fa4fd9a6c670fd2  ph/patterned_brick_floor/patterned_brick_floor_disp_1k.jpg
daeecd847e5f02a1ba3d370be19ed598620c6a3ccc77a37827efb21f336ee6fa  ph/patterned_brick_floor/patterned_brick_floor_nor_gl_1k.jpg
01fd5eeaf84d75b8f322d22d47a372bb70855dc3a3a2bd6af3767df98ad6c50f  ph/patterned_brick_floor/patterned_brick_floor_rough_1k.jpg
```

## Text, logos, graffiti and lettering check

Every photo map that reaches a shipped file was looked at in full (contact sheet `work/sources.jpg` in the lane kit) and
every shipped albedo was looked at after processing:

| Source | Text or marks in the source | What ships |
|---|---|---|
| Grate001 | maker's lettering cast in the frame | only a 32 x 420 px crop of a plain bar (rows 430-462, cols 320-740), used as iron grain; the gully grates are drawn by us |
| ManholeCover009 | cast lettering on the cover | nothing (not used) |
| RoadLines020C | none (yellow paint) | only the opacity of one worn stripe, as a mask over our own markings |
| PavingStones133, PavingStones070, large_square_pattern_01, asphalt_04, asphalt_02, granite_tile | none | albedo, normal, ORM |
| Bricks105, brick_wall_001, Bricks097 | none (no graffiti, no signs) | albedo, normal, ORM (Bricks097 normal only) |
| ChewingGum001/002, AsphaltDamageSet001, ScatteredLeaves006, Leaking012A, PaintedPlaster017 | none | crops / masks |

