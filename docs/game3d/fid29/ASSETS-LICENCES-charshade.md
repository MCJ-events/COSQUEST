# fid29 charshade: assets and licences

Every third-party file this lane uses, and what was made from it. Nothing else was downloaded. Total download 45 MB
(six 1K JPG packs), well under the 1 GB cap; nothing was paid for.

## ambientCG (CC0 1.0)

Licence line, as ambientCG states it on every asset page and at https://docs.ambientcg.com/license/ :
"All assets on ambientCG are provided under the Creative Commons CC0 1.0 Universal License." No attribution is
required; it is recorded here anyway.

Downloaded 14 Nov 2026 (about 15:09 UTC) onto mm1 (`~/cq-overflow/b29/charshade/dl/`), the 1K-JPG pack of each.

| Asset | Page | Download | sha256 of the zip | Used for |
|---|---|---|---|---|
| Fabric030 | https://ambientcg.com/view?id=Fabric030 | https://ambientcg.com/get?file=Fabric030_1K-JPG.zip | `82d4d00ccf901cf4707c5489005945ab8574933fc60437e26c6737f0436699e0` | woven cotton tile (top left) of `art/char/detail/cloth_sheet.png` |
| Fabric061 | https://ambientcg.com/view?id=Fabric061 | https://ambientcg.com/get?file=Fabric061_1K-JPG.zip | `537a84d3a91d50bc907d2e86f4f024041643eb6a04c10b115cdf308f29508eb2` | knit tile (top right) |
| Leather037 | https://ambientcg.com/view?id=Leather037 | https://ambientcg.com/get?file=Leather037_1K-JPG.zip | `7ec86a1e5e4a1a8ddf1db9bf999dd3f495eaa109b72406d7ff2eb65f1b6775fc` | grained leather tile (bottom left) |
| Leather026 | https://ambientcg.com/view?id=Leather026 | https://ambientcg.com/get?file=Leather026_1K-JPG.zip | `6af2f446f9855c641da2a072f128d30965431ffae3306d22d75dbfff99c04646` | smooth leather tile (bottom right) |
| Scratches005 | https://ambientcg.com/view?id=Scratches005 | https://ambientcg.com/get?file=Scratches005_1K-JPG.zip | `22dee57dad7d7658bf7b0073d8da2948df8bd47da594c78a89ed14d6432a3c2c` | R channel of `art/char/detail/metal_breakup.png` (256 px) |
| SurfaceImperfections003 | https://ambientcg.com/view?id=SurfaceImperfections003 | https://ambientcg.com/get?file=SurfaceImperfections003_1K-JPG.zip | `9b3e0a617c6514da0bb3fd41e3be0a46a4261badad1d5b6d66e8a8594777df5d` | G channel of `metal_breakup.png` |

Only the NormalGL maps (cloth, leather) and the single-channel masks (scratches, imperfections) were used, resampled
and repacked by `tools/char/detail_sheet.py`. The zips stay on mm1 and are not in the repository.

## Ours (made by this lane, no third-party content)

| File | Made by | From |
|---|---|---|
| `art/char/masks/<hero>_lod0.png`, `_lod1r.png`, `<hero>.json` | `tools/char/matid.py` | the build 28 hero files and the handsmetal lane's texel classes (our renderer code, `metal_mat.py apply --maps`) |
| `art/char/hair/<hero>_hi.png`, `_mid.png`, `<hero>_hair.json` | `tools/char/hair_atlas.py` | each hero's own procedural hair-card atlas (the hybrid stage's `hair_cards.py` / `hair_styles.py`, ours) |

No game's asset, character, map or UI was copied, traced or recreated. No Mixamo, MetaHuman, Fab or Megascans content.
