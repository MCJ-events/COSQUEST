# 3D game asset licences

Every downloaded asset used by the 3D game, with its source and licence. Only CC0 (or MIT/Apache with attribution recorded) is allowed; nothing from Mixamo, non-CC0 Sketchfab or ripped games.

## Weapons (cq 234)

| asset | used as | author | source | licence | checked |
|---|---|---|---|---|---|
| sword_1handed.gltf | Knight's Arming Sword | Kay Lousberg (KayKit) | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (addons/kaykit_character_pack_adventures/Assets/gltf) | CC0 1.0 (LICENSE.txt in the repo: "License: (Creative Commons Zero, CC0)") | 2026-10-29 |
| sword_2handed_color.gltf | Crown Greatsword | Kay Lousberg (KayKit) | same | CC0 1.0 | 2026-10-29 |
| axe_1handed.gltf | Barbarian War Axe | Kay Lousberg (KayKit) | same | CC0 1.0 | 2026-10-29 |
| staff.gltf | Arcane Staff | Kay Lousberg (KayKit) | same | CC0 1.0 | 2026-10-29 |
| dagger.gltf | Rogue's Dagger | Kay Lousberg (KayKit) | same | CC0 1.0 | 2026-10-29 |
| crossbow_2handed.gltf | Hunter's Crossbow | Kay Lousberg (KayKit) | same | CC0 1.0 | 2026-10-29 |
| shield_round_color.gltf | Knight's Round Shield | Kay Lousberg (KayKit) | same | CC0 1.0 | 2026-10-29 |
| knight_texture.png, barbarian_texture.png, mage_texture.png, rogue_texture.png | the palette textures of the above, and of the Forge Warhammer | Kay Lousberg (KayKit) | same | CC0 1.0 | 2026-10-29 |
| (none: made here) | Forge Warhammer: geometry built in Blender by cq 234 (`build_weapons.py kitbash_hammer`), UV-mapped onto KayKit's CC0 knight palette | cq 234 | `app/game3d/tools/weapons/build_weapons.py` | CC0 1.0 (ours; the texture is KayKit's CC0) | 2026-10-29 |
| blaster-repeater.glb + Textures/colormap.png | Repeater Rifle | Kenney (kenney.nl), Blaster Kit model as shipped in Starter-Kit-FPS | https://github.com/KenneyNL/Starter-Kit-FPS (models/) | CC0 1.0 for the models, sprites and sounds (README: "Assets included in this package (2D sprites, 3D models and sound effects) are CC0 licensed"); the kit's code is MIT and is not used | 2026-10-29 |

Notes:
- kenney.nl answers 403 to scripted downloads from this machine, so the Kenney model came from Kenney's own GitHub starter kit, which ships the same Blaster Kit models.
- The Repeater Rifle is the Kenney model with its cross-section slimmed to 60 % (`girth` in weapons.json), so the chunky toy blaster reads as a rifle; CC0 allows changes.
- Crediting Kay Lousberg and Kenney is not required by CC0; they are named here as thanks.

## Characters

The cast (Armstrong, Bobo, Cat-Boy, Crystal-Z, Elvis, Hoof, Nebul-X, Vanessa) are CosQuest's own deck characters made by the Forge pipeline (cq 060), not downloaded assets.

## Engines and libraries

See `docs/game3d/G0_VERDICT.md` (Godot MIT, LibGodot, react-native-godot) and `docs/forge/DROP-IN.md` (react-native-filament MIT, Filament Apache-2.0).
