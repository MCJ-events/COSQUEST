import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  buildFightConfig,
  FIGHT3D_NOTE,
  fight3dFlags,
  fightLod,
  godotArgs,
  localPath,
  opponentIndex,
  parseFightResult,
  parseMode,
  parseStatus,
  pickAlly,
  pickCast,
  pickOpponent,
  quitResult,
  rewardFrom3D,
  runFromParams,
} from "../fight3d.ts";

const android = { os: "android", version: 35 };

test("the flag is off unless EXPO_PUBLIC_GAME3D=1, and off below Android 10 and on the web", () => {
  assert.equal(fight3dFlags({}, android).on, false);
  assert.equal(fight3dFlags({ EXPO_PUBLIC_GAME3D: "1" }, android).on, true);
  assert.equal(fight3dFlags({ EXPO_PUBLIC_GAME3D: "1" }, { os: "android", version: 28 }).on, false);
  assert.equal(fight3dFlags({ EXPO_PUBLIC_GAME3D: "1" }, { os: "ios", version: "18.0" }).on, true);
  assert.equal(fight3dFlags({ EXPO_PUBLIC_GAME3D: "1" }, { os: "web", version: 0 }).on, false);
});

test("knobs: keep, autostart, cycle, lod; autostart and cycle need the flag", () => {
  const f = fight3dFlags(
    { EXPO_PUBLIC_GAME3D: "1", EXPO_PUBLIC_GODOT_KEEP: "1", EXPO_PUBLIC_GAME3D_AUTOSTART: "arena", EXPO_PUBLIC_GAME3D_CYCLE: "10", EXPO_PUBLIC_GAME3D_CYCLE_MS: "5000", EXPO_PUBLIC_GAME3D_LOD: "2" },
    android,
  );
  assert.deepEqual(
    { keep: f.keep, autostart: f.autostart, cycle: f.cycle, cycleMs: f.cycleMs, lod: f.lod },
    { keep: true, autostart: "arena", cycle: 10, cycleMs: 5000, lod: 2 },
  );
  const off = fight3dFlags({ EXPO_PUBLIC_GAME3D_AUTOSTART: "arena", EXPO_PUBLIC_GAME3D_CYCLE: "10" }, android);
  assert.equal(off.autostart, null);
  assert.equal(off.cycle, 0);
  const d = fight3dFlags({ EXPO_PUBLIC_GAME3D: "1", EXPO_PUBLIC_GAME3D_AUTOSTART: "bogus", EXPO_PUBLIC_GAME3D_CYCLE: "x" }, android);
  assert.deepEqual({ keep: d.keep, autostart: d.autostart, cycle: d.cycle, cycleMs: d.cycleMs, lod: d.lod }, { keep: false, autostart: null, cycle: 0, cycleMs: 8000, lod: null });
  assert.equal(parseMode("chars"), "chars");
  assert.equal(parseMode("CHARS"), null);
});

test("the test link's parameters, with the build's knobs as defaults", () => {
  const flags = fight3dFlags({ EXPO_PUBLIC_GAME3D: "1" }, android);
  assert.deepEqual(runFromParams({ mode: "arena", cycle: "10", ms: "6000" }, flags), { mode: "arena", cycle: 10, cycleMs: 6000, autoplay: true });
  assert.deepEqual(runFromParams({}, flags), { mode: "full", cycle: 0, cycleMs: 8000, autoplay: false });
  assert.deepEqual(runFromParams({ mode: ["chars"], autoplay: "0", cycle: "3" }, flags), { mode: "chars", cycle: 3, cycleMs: 8000, autoplay: false });
});

test("LOD 1 on low and mid phones (the emulator), 0 on high ones, the knob wins", () => {
  assert.equal(fightLod("low", null), 1);
  assert.equal(fightLod("mid", null), 1);
  assert.equal(fightLod("high", null), 0);
  assert.equal(fightLod("high", 2), 2);
});

test("the opponent pick is the game server's (roam_forge.opponent_character)", () => {
  // Python: int(sha256("forge-opponent|guardian|P1".encode()).hexdigest()[:12], 16) % n
  const expect = (role: string, key: string, n: number) => parseInt(createHash("sha256").update(`forge-opponent|${role}|${key}`).digest("hex").slice(0, 12), 16) % n;
  for (const key of ["P1", "W0123456789abcdef", "trial:red:3"]) {
    for (const n of [1, 2, 3, 7]) assert.equal(opponentIndex("guardian", key, n), expect("guardian", key, n));
  }
  assert.equal(opponentIndex("boss", "x", 0), -1);
});

const ch = (id: string, name: string, role: string | null, avatar = false) => ({ id, name, type: "character", gameplay: { role, avatar } });
const entries = [
  ch("c-3", "Old Samurai", "guardian"),
  ch("a-1", "Armstrong", "hero", true),
  ch("b-2", "Street Kid", "hero", true),
  ch("d-4", "Knight Woman", "guardian"),
  ch("e-5", "Big Boss", "boss"),
  { id: "w-1", name: "Axe", type: "weapon", gameplay: {} },
];

test("guardians are ordered by id before the pick; bosses for raids", () => {
  const g = pickOpponent(entries, "guardian", "P1");
  const ids = ["c-3", "d-4"];
  assert.equal(g?.id, ids[opponentIndex("guardian", "P1", 2)]);
  assert.equal(pickOpponent(entries, "boss", "R1")?.id, "e-5");
  assert.equal(pickOpponent([], "guardian", "P1"), null);
});

test("the ally is another hero, by name; the cast prefers the duel's own opponent", () => {
  assert.equal(pickAlly(entries, "a-1")?.id, "b-2");
  assert.equal(pickAlly(entries, "b-2")?.id, "a-1");
  assert.equal(pickAlly(entries, null)?.id, "a-1");
  const cast = pickCast(entries, { avatarId: "a-1", enemyId: "d-4", role: "guardian", key: "P1" });
  assert.deepEqual([cast.hero?.id, cast.ally?.id, cast.enemy?.id], ["a-1", "b-2", "d-4"]);
  const none = pickCast([], { avatarId: "a-1", role: "guardian", key: null });
  assert.deepEqual([none.hero, none.ally, none.enemy], [null, null, null]);
  // A weapon id is not a character.
  assert.equal(pickCast(entries, { avatarId: "w-1", role: "guardian", key: null }).hero, null);
});

test("file URIs become absolute paths; anything else is empty", () => {
  assert.equal(localPath("file:///data/user/0/com.x/cache/forge/a%20b/1/m.glb"), "/data/user/0/com.x/cache/forge/a b/1/m.glb");
  assert.equal(localPath("/abs/path.glb"), "/abs/path.glb");
  assert.equal(localPath("https://x/y.glb"), "");
  assert.equal(localPath("relative.glb"), "");
  assert.equal(localPath(null), "");
});

test("the config Godot gets: paths, names with fallbacks, 45 s, 2/3 players", () => {
  const c = buildFightConfig({
    hero: { path: "file:///c/hero.glb", name: "Ada" },
    ally: { path: null, name: null },
    enemy: { path: "file:///c/g.glb", name: "  " },
    pointName: "Trafalgar",
    mode: "full",
    seed: -42.7,
    autoplay: false,
  });
  assert.deepEqual(c, {
    hero_glb: "/c/hero.glb",
    ally_glb: "",
    enemy_glb: "/c/g.glb",
    hero_name: "Ada",
    ally_name: "Ally",
    enemy_name: "Guardian",
    duration_s: 45,
    players_text: "2/3 players",
    point_name: "Trafalgar",
    mode: "full",
    seed: 42,
    autoplay: false,
  });
  assert.equal(buildFightConfig({ hero: { path: null, name: null }, ally: { path: null, name: null }, enemy: { path: null, name: null }, pointName: "p", mode: "arena", seed: 1, autoplay: true, tilesUrl: "https://t/{z}/{x}/{y}.png" }).tiles_url, "https://t/{z}/{x}/{y}.png");
  // JSON round trip (what start_fight receives).
  assert.equal(JSON.parse(JSON.stringify(c)).hero_glb, "/c/hero.glb");
});

test("Godot's arguments: the asset folder on Android, the bundle's pack on iOS", () => {
  assert.deepEqual(godotArgs("android"), ["--path", "/game3d", "--rendering-driver", "opengl3", "--rendering-method", "gl_compatibility", "--display-driver", "embedded"]);
  const ios = godotArgs("ios", { bundleDir: "file:///var/containers/Bundle/Application/X/cosquest.app/" });
  assert.deepEqual(ios.slice(0, 2), ["--main-pack", "/var/containers/Bundle/Application/X/cosquest.app/game3d.pck"]);
  assert.ok(ios.includes("embedded"));
  assert.deepEqual(godotArgs("ios", { bundleDir: "/b", iosSimulator: true }).slice(2, 6), ["--rendering-driver", "metal", "--rendering-method", "mobile"]);
});

test("the result JSON is checked and cleaned", () => {
  const r = parseFightResult(
    JSON.stringify({ outcome: "win", damage_dealt: 120.6, damage_taken: "40", time_s: 31.26, hits: 9, skill_uses: 2, enemy_hp_left: 0, hero_hp_left: -5, mode: "full" }),
  );
  assert.deepEqual(r, { outcome: "win", damage_dealt: 121, damage_taken: 40, time_s: 31.3, hits: 9, skill_uses: 2, enemy_hp_left: 0, hero_hp_left: 0, mode: "full" });
  assert.equal(parseFightResult({ outcome: "TIMEOUT" })?.outcome, "timeout");
  assert.equal(parseFightResult({ outcome: "draw" }), null);
  assert.equal(parseFightResult("not json"), null);
  assert.equal(parseFightResult("[]"), null);
  assert.equal(parseFightResult(null), null);
  assert.equal(quitResult("arena", 3).outcome, "quit");
});

test("the status JSON's state", () => {
  assert.equal(parseStatus('{"state":"fighting","t":3}')?.state, "fighting");
  assert.equal(parseStatus("{}"), null);
  assert.equal(parseStatus(null), null);
  assert.equal(parseStatus("oops"), null);
});

test("the reward for a 3D fight: Godot's numbers, no pay, and it says so", () => {
  const standing = { level: 4, rank: "Scout", xp: 300, level_floor_xp: 250, next_level_xp: 400, into_level: 50, level_span: 150, max_level: false };
  const win = rewardFrom3D({ outcome: "win", damage_dealt: 121, damage_taken: 40, time_s: 31.3, hits: 9, skill_uses: 2, enemy_hp_left: 0, hero_hp_left: 60, mode: "full" }, { name: "Trafalgar", realm: "fantasy" }, standing);
  assert.equal(win.win, true);
  assert.equal(win.headline, "Guardian down!");
  assert.deepEqual([win.xp, win.coins, win.factionPoints, win.lines.length, win.leveledUp], [0, 0, 0, 0, false]);
  assert.equal(win.before, standing);
  assert.equal(win.after, standing);
  assert.equal(win.note, FIGHT3D_NOTE);
  assert.deepEqual(
    win.stats?.map((s) => [s.id, s.value]),
    [
      ["outcome", "Guardian down!"],
      ["damage-dealt", "121"],
      ["damage-taken", "40"],
      ["time", "31 s"],
    ],
  );
  const lose = rewardFrom3D({ ...quitResult("full"), outcome: "lose", time_s: 75 }, { name: "P", realm: "r" }, null);
  assert.equal(lose.win, false);
  assert.equal(lose.headline, "The Guardian held");
  assert.equal(lose.stats?.find((s) => s.id === "time")?.value, "1:15");
  assert.equal(rewardFrom3D(quitResult("full"), { name: "P", realm: "r" }, null).headline, "You left the fight");
});
