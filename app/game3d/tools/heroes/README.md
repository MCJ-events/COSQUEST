# tools/heroes: the fid29-heromaps pipeline (build 29)

Builds each faction hero's compressed, denser, de-lit "r" files from its build 28 files. Never writes into the game
tree; the finished files are copied into `cast/heroes/` by hand (or by `final.sh install` on mm1). Docs:
`docs/game3d/fid29/heromaps.md`, licences `docs/game3d/fid29/ASSETS-LICENCES-heromaps.md`.

Run on mm1's CPU (Blender 4.5.3 Cycles CPU, numpy, scipy, trimesh, xatlas, OpenCV in a private `pylib`), one hero:

    heromaps.sh HERO_KEY            # src tears0 tears1 body0 clean0 delight0 folds0 hands0 body1 clean1 hands1 ktx verify

| File | Step |
|---|---|
| `heromaps.sh` | the pipeline, stage by stage (see its header) |
| `graft.py` | Kofi and Tavo: build 28 plus forge-q2's kept curled MakeHuman hands (index buffer, cut ring, hands mesh), bare hands toned to the head |
| `colsrc.py` | farm: the clean colour source in build 28's UVs (build 28's tone on the lift's lossless colour or the klein 4096 projection; JPEG blocks and specks out) |
| `tears.py` | webbing between the legs that tears in the hero's own clips (deleted; legs only) |
| `repack.py` | visibility-weighted xatlas repack; unseen triangles get zero UV area |
| `build_body.py`, `bake_bl.py` | re-bake colour, normal, ORM, emissive onto the new UVs (Blender selected-to-active, same mesh) |
| `clean.py` | loose components under 0.3 % and hidden two-sided fins on the legs |
| `delight.py` | SH light times AO fitted per colour cluster and divided out; painted speculars inpainted; neck feathered |
| `folds.py` | crotch web triangles that turn over in the clips darkened like a fold (geometry and weights kept) |
| `hands.py` | hands on their own UV island; colour baked across; normal from the hand subdivided twice plus skin grain |
| `ktx_glb.py` | KTX2 (ASTC 4x4 / 8x8, Basis ETC1S) inside the GLB, offline mips, Toksvig; disk-cap steps |
| `verify.py` | an r file keeps its source's nodes, skin, animations, morphs and every untouched primitive; edited vertices exist in the source |
| `hglb.py` | the small GLB reader/writer every step uses |
| `texel.py`, `waste.py` | texel density and atlas visibility (from the fid29 characters research) |
| `flagview.py` | rest-pose views with flagged triangles in red (checking a clean-up by eye) |
| `cmp_shots.py` | Delta E76 between two folders of renders |
| `final.sh`, `trace.sh`, `fs.sh`, `fa.sh`, `fb.sh`, `ma.sh`, `sbs.py` | acceptance runs on mm1 and the farm: tests, records, low-tier load trace, measure, dumps, frames, side-by-sides |
