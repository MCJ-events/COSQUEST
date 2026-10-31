# The real place round a fight (cq 019)

Until cq 019 every 3D fight happened in the same night street (cq 016), wherever the Quest Point was.
Now, when the map has the ground round the point, the fight happens in the real place: the buildings,
roads, squares, green, water, trees and landmarks round the point, from OpenStreetMap, laid out round
the fighters and turned so the camera faces the nearest landmark. A short fly-in from the landmark
down to the fight camera opens the fight, with the point's name.

It is recognisable, not photoreal: simple solids with the street's dusk look (lit windows, warm walls).
Photoreal places would be Google 3D Tiles (a billed key, about 4 weeks, no iOS yet): that is Mark's call
(SCOPE-CHECK.md).

## Where the ground comes from
- **In the app:** the store already fetches `/v1/map/ground` (600 m round the player) for the map.
  `Fight3D.tsx placeFile` writes that answer to a cache file and the fight config gets
  `arena: "place"`, `ground_json` and `place_at` (the point in the ground's metres, `fight3d.ts
  placeFrom`). No ground, a ground no archive covers, or a point off it: the street, as before.
  `EXPO_PUBLIC_GAME3D_PLACE=0` keeps the street everywhere.
- **On the server:** `/v1/map/ground` answers from the PMTiles archives published for venues
  (`app/ground.py`). A place no archive covers has no ground yet.
- **For any lat/lon, today:** `costquest-backend tools/arena/osm_ground.py` makes the same answer
  straight from OpenStreetMap (the Overpass API, one request per place, cached), plus the real mapped
  trees and the landmarks (columns, monuments, statues, fountains), which the vector tiles do not carry.
  `--lat --lng --radius --out`. The Trafalgar Square answer is 134 KB (in
  `app/game3d/tests/fixtures/trafalgar_ground.json`).

## How it is built (`place.gd`)
- Coordinates: the ground's x east, z north, turned into the fight's frame so the chosen landmark is
  straight ahead of the camera (the landmark: the most notable one 12 to 140 m away, weighted by kind and
  height; else the tallest building near by).
- **Nothing in the fight's way:** no building, statue or tree inside the fighters' area plus a margin, or
  between the fight and the camera (`CLEAR`). The fighters keep the same 11.2 x 18 m area and every rule:
  a seeded fight in the place gives exactly the street's result.
- Buildings: walls and roofs extruded from the footprints at their heights, in three wall styles
  (Portland stone for the tall ones, brick, stucco), with windows that glow at dusk
  (`vfx/place_facade.gdshader`, the street's facade look on a generated wall texture).
- Roads (asphalt ribbons; footpaths stay paving), paved squares, green, water: flat polygons.
- Trees: one MultiMesh. Landmarks: columns (pedestal, reliefs, shaft, capital, figure), statues on
  plinths, fountains (basin, water, jet), monument platforms.
- The minimap gets the real footprints.
- Everything past 260 m is left out; the camera sees about 150 m.

## Numbers (Trafalgar Square, the fight between the column and the fountains)
- Built in 7 to 9 ms (199 buildings, 181 road pieces, 114 trees, 24 landmarks).
- Frame time: see the cq 019 REPORT (one-thread software GPU, street against place).

## Tests
- Godot `tests/place_test.gd`: the camera faces Nelson's Column, the fight's area is clear, the minimap
  gets the footprints, it builds in under a second, another spot faces something too.
- App `fight3d.test.ts`: where the point stands on the ground, and the config Godot gets.
- Server `tests/test_arena_osm_ground.py`: an Overpass answer becomes the server's ground shape with
  heights, road kinds and widths, trees, landmarks, water and squares.

## Not done
- The intro and the place are drawn with simple solids: the National Gallery is a lit stone block, the
  lions are bronze blocks. Forge station or environment packs could dress a known landmark later.
- Points whose ground the server does not have (no published archive) keep the street. Publishing
  archives for the places that matter (or serving `osm_ground.py`'s answer) is a deploy decision.
