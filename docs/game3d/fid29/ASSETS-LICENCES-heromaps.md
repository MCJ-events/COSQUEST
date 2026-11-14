# fid29-heromaps: tools, assets and licences

Client work for Mark Jones (CosQuest). Everything this lane ships is made from the heroes' own build 28 files and from
data the earlier hero lanes kept on our machines; nothing was downloaded for a shipped texel, nothing was generated anew
(no TRELLIS sampling, no image model run), no paid service or GPU was used, and nothing from another game was used.
Dates: 14 Nov 2026.

## What ships (inside `cast/heroes/*_lod0r.glb` and `*_lod1r.glb`)

| Content | Made from | Licence of the source | Attribution |
|---|---|---|---|
| Body geometry, rig, weights | build 28's own hero files (`cast/heroes/<key>_lod0.glb`, `_lod1.glb`), triangles deleted only (`tears.py`, `clean.py`) | ours (made by earlier hero lanes; see the provenance note below) | none needed |
| Body colour 4K (lod0) / 2K (lod1) | build 28's body colour (tone, metal and skin passes) as a low-frequency correction on a clean source in the same UVs: the lift's own lossless 2K colour (`asset/data/jobs/<job>/assets/<key>/raw.glb`) or, for Imani and Zuri, the 4096 projection of their accepted FLUX.2 klein redraw views (`asset/work/hero_<key>/redraw_run/redraw/rf/lod0_base_4096.png`) | ours; klein views made with FLUX.2 klein 4B, Apache-2.0 (https://huggingface.co/black-forest-labs/FLUX.2-klein-4B, model card "apache-2.0"), output unrestricted | none needed |
| Body normal 2K / 1K | the lift's own lossless 2K normal (`raw.glb`) where it agrees with build 28's (99.1 to 99.9 % of texels), else build 28's | ours | none |
| Hands of Kofi and Tavo | forge-q2's kept curled hands (`mm1:~/cq-overflow/forge-q2/hm/out/<key>_g10`, copied to `~/cq-overflow/b29/heromaps/hands_src/`): MakeHuman / MPFB2 base hand | CC0 1.0 (MPFB2 assets: https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.ASSETS.md, "CC0"; checked by the hybrid lane) | none needed (CC0) |
| Hand maps (all six) | the hand's existing colour baked across a new UV island; normal from the same hand subdivided twice (Catmull-Clark in Blender) plus a procedural grain of ours | CC0 (MPFB2) and ours | none |
| Head, hair, eyes | build 28's, unchanged (re-encoded only) | as build 28 | |

## Tools (none ship)

| Tool | Version | Licence | Source | Where it ran |
|---|---|---|---|---|
| KTX-Software (`toktx`, `ktx`; bundles astcenc, Basis Universal, zstd) | 4.4.2 Linux x86_64 | Apache-2.0 (bundled parts under compatible open licences, LICENSE.md) | https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2; tarball sha256 a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245 (sha1 c6b08c817f8c8dd299deccae4f2fbb8d55e9acd2 as released); downloaded by the characters lane, 7 MB | farm, mm1 |
| Blender | 4.5.3 LTS | GPL-3.0 (binds the tool, not its output) | https://www.blender.org/download/ (copy on mm1, as earlier lanes) | mm1 CPU (Cycles CPU bakes) |
| xatlas (python binding) | 0.0.11 | MIT | https://github.com/mworchel/xatlas-python, https://github.com/jpcy/xatlas | mm1 |
| trimesh | 5.2.1 | MIT | https://github.com/mikedh/trimesh | mm1 |
| rtree | 1.4.1 | MIT | https://github.com/Toblerity/rtree | mm1 |
| numpy 1.26.4, scipy 1.17.1, Pillow 13.0.0, OpenCV headless 4.11.0.86, scikit-image 0.26.0 | | BSD-3 / BSD-3 / MIT-CMU / Apache-2.0 / BSD-3 | PyPI | mm1, farm |
| Godot | 4.5.1 (lookfight build, as every fid29 lane) | MIT | https://godotengine.org | mm1 (llvmpipe) |

The lane's own code: `app/game3d/tools/heroes/` (ours).

## Provenance note: TRELLIS.2 and DINOv3

The six hero bodies were lifted earlier (11 and 12 Nov, the asset lane) with TRELLIS.2 (MIT code and weights,
https://github.com/microsoft/TRELLIS.2), whose image encoder is DINOv3, a model on the project's excluded list. This
lane adds no new DINOv3 use: it ran no TRELLIS sampling, no decoder and no image encoder. It reads only what those
lifts already wrote to disk (the shipped meshes and the lift's own 2K colour and normal in `raw.glb`), as build 28
already ships. The planned re-bake from the kept decoded meshes (`lift_mesh.pt`) was not run either (see heromaps.md,
"Known limits").

## Looked at and not used

| Item | Why |
|---|---|
| Real-ESRGAN realesr-general-x4v3 (BSD-3) for JPEG clean-up | not needed: every hero keeps a lossless colour source (`raw.glb`, the klein projection) |
| Intrinsic, Marigold-IID, StableDelight, IntrinsicAnything (de-lighting models) | licences (academic only, OpenRAIL, unclear, none); the de-lighting here is a fitted SH light and AO, no model |
| Mixamo, MetaHuman, Fab, Megascans | not on the allowed list; not used |
