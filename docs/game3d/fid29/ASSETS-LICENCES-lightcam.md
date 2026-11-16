# fid29-lightcam: assets and licences

Every third-party file this lane used. All CC0; nothing paid, nothing over 1 GB, nothing from a game. The source files
were downloaded on mm1 (`~/cq-overflow/b29/lightcam/dl/`, 14 Nov 2026); only the derived sky maps ship
(`app/game3d/art/sky/*.png`, made by `tools/look/make_sky.py`).

| File | Source URL | Licence (quoted) | Date | sha256 | Used for |
|---|---|---|---|---|---|
| kloppenheim_06_puresky_2k.hdr (Greg Zaal, sky edits Jarod Guest) | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_06_puresky_2k.hdr (page: https://polyhaven.com/a/kloppenheim_06_puresky) | Poly Haven, https://polyhaven.com/license: "Our assets are all licensed as CC0" | 2026-11-14 | 99451201586489ef3288c97bfac2a2ac232a5491c51a1faf0ec8ea39f3ccd533 | `art/sky/golden_hi.png`, `golden_mid.png` |
| kloppenheim_05_puresky_2k.hdr (Greg Zaal, sky edits Jarod Guest) | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_05_puresky_2k.hdr | as above, CC0 | 2026-11-14 | e27abb53a2e14b1d791b43c182a7e86261e16cf4a284becb8904cf335c34a624 | `art/sky/day_hi.png`, `day_mid.png` |
| qwantani_dusk_2_puresky_2k.hdr (Greg Zaal, processing Jarod Guest) | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_dusk_2_puresky_2k.hdr | as above, CC0 | 2026-11-14 | 440d1b5d29c79bea0985a13777642df6829e80399602a9d5f39bc20203ae6d1b | `art/sky/dusk_hi.png`, `dusk_mid.png` (also the night look) |
| qwantani_sunset_puresky_2k.hdr | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_sunset_puresky_2k.hdr | as above, CC0 | 2026-11-14 | d66e08231e9c09ca40c6d035214ae8efb638782745c82addbb2a063fa32cabef | golden candidate, not shipped |
| kloofendal_overcast_puresky_2k.hdr (Greg Zaal) | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_overcast_puresky_2k.hdr | as above, CC0 | 2026-11-14 | 312b1b04b7f10057a4f1418abc59d1166c8933cc93fc72051502edaf8d6b2fcd | overcast candidate, not shipped |
| LDR_RGB1_0.png, 64 x 64 blue noise (Christoph Peters) | https://momentsingraphics.de/BlueNoise.html (archive `Media/BlueNoise/FreeBlueNoiseTextures.zip`) | "I have placed them in the public domain through CC0-licensing" | 2026-11-14 | d5ff9533f386f22d8d2707a4ad7cb58a7f609d432e11432b663056e826d551df | the sky maps' dither (baked in; the file itself does not ship) |
| LDR_LLL1_0.png (same archive) | as above | as above, CC0 | 2026-11-14 | 140c55bd97c21b9b22008d7054b492333fec67fbfc1a1b266e5b0209b647eed4 | not used |

CC0 needs no attribution. The credits are kept here anyway.
