// The shared game layer: config, signing, the client, the Warden's lines and
// the store, against a fake server (no network). The live staging check is
// staging.live.test.ts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { errorFrom, GameClient, GameError, parseDuelStart } from "../client.ts";
import {
  isProductionServer,
  PRODUCTION_GAME_SERVER,
  resolveDuelRenderer,
  resolveGameServer,
  resolveGameUi,
  STAGING_GAME_SERVER,
} from "../config.ts";
import { bearingDeg, distanceM, distanceText, reachM, stepToward, toLocal } from "../geo.ts";
import { bytesToHex, Identity, signingPayload, utf8ToBytes, verifySignature } from "../identity.ts";
import { createGameStore, type KeyStorage } from "../store.ts";
import {
  arriveMoment,
  fallbackLine,
  lineFor,
  lineSeed,
  nudgeMoment,
  reactionMoment,
  WardenMoment,
  wardenStyle,
} from "../warden.ts";
import { flattenExtra, isCooling, parseServerDate, pointPlaysAsDuel, type QuestPoint, type RoamMe } from "../wire.ts";

const SEED = "11".repeat(32);

describe("config", () => {
  it("resolves the server, refusing anything but https", () => {
    assert.equal(resolveGameServer(undefined), PRODUCTION_GAME_SERVER);
    assert.equal(resolveGameServer("staging"), STAGING_GAME_SERVER);
    assert.equal(resolveGameServer("https://x.example/"), "https://x.example");
    assert.equal(resolveGameServer("http://evil.example"), PRODUCTION_GAME_SERVER);
    assert.equal(isProductionServer(STAGING_GAME_SERVER), false);
  });
  it("iOS stays native unless asked; Android is always rn", () => {
    assert.equal(resolveGameUi("ios", undefined), "native");
    assert.equal(resolveGameUi("ios", "rn"), "rn");
    assert.equal(resolveGameUi("android", "native"), "rn");
    assert.equal(resolveGameUi("android", undefined), "rn");
  });
  it("Unity draws the duel only when the build has it and the flag asks", () => {
    assert.equal(resolveDuelRenderer("unity", false), "rn");
    assert.equal(resolveDuelRenderer("unity", true), "unity");
    assert.equal(resolveDuelRenderer(undefined, true), "rn");
  });
});

describe("signing (docs/API.md §1)", () => {
  it("the payload matches the server's definition byte for byte", () => {
    const body = utf8ToBytes('{"device_key":"ab","faction":"dc"}');
    // Reference values from Python hashlib (the server's own primitives).
    assert.equal(
      bytesToHex(signingPayload("put", "/v1/roam/faction", body, 1760000000000)),
      "a40105d5226988dfcf64ffb815123d5b477f589eb4903d09863d1cd73751d2d8",
    );
    assert.equal(
      bytesToHex(signingPayload("GET", "/v1/roam/points", new Uint8Array(), 42)),
      "812f63123338582185f397546a441894032cc22e6519604c982784917b7138b7",
    );
  });
  it("signs verifiably and never reuses a nonce", () => {
    const id = new Identity(SEED, "device");
    const a = id.signedHeaders("GET", "/x", new Uint8Array(), 1000);
    const b = id.signedHeaders("GET", "/x", new Uint8Array(), 1000);
    assert.ok(Number(b["X-Nonce"]) > Number(a["X-Nonce"]));
    assert.ok(verifySignature(id.publicKeyHex, signingPayload("GET", "/x", new Uint8Array(), Number(a["X-Nonce"])), a["X-Signature"]));
  });
  it("starts above the server's nonce floor (an account's key on two phones)", () => {
    const id = new Identity(SEED, "account", 9_000_000_000_000);
    assert.equal(id.nextNonce(1000), 9_000_000_000_001);
  });
  it("refuses a malformed seed", () => {
    assert.throws(() => new Identity("zz", "device"));
  });
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(routes: (call: Call) => { status?: number; body: unknown } | undefined) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const answer = routes(call) ?? { status: 404, body: { detail: "Not Found" } };
    const text = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

describe("client", () => {
  it("signs the path only, never the query, and sends the exact body it signed", async () => {
    const id = new Identity(SEED, "device");
    const { fetch, calls } = fakeFetch(() => ({ body: { region: "r", day: "d", points: [], attribution: "" } }));
    const client = new GameClient({ baseUrl: "https://g.example/", identity: () => id, fetch });
    await client.questPoints(51.5, -0.12);
    const call = calls[0];
    assert.match(call.url, /^https:\/\/g\.example\/v1\/roam\/points\?lat=51\.5&lng=-0\.12&radius_m=600&device_key=/);
    const nonce = Number(call.headers["X-Nonce"]);
    assert.ok(verifySignature(id.publicKeyHex, signingPayload("GET", "/v1/roam/points", new Uint8Array(), nonce), call.headers["X-Signature"]));

    const { fetch: f2, calls: c2 } = fakeFetch(() => ({ body: { device_key: id.publicKeyHex } }));
    const c = new GameClient({ baseUrl: "https://g.example", identity: () => id, fetch: f2 });
    await c.chooseFaction("dc");
    const body = utf8ToBytes(c2[0].body ?? "");
    assert.ok(verifySignature(id.publicKeyHex, signingPayload("PUT", "/v1/roam/faction", body, Number(c2[0].headers["X-Nonce"])), c2[0].headers["X-Signature"]));
  });
  it("turns the server's refusals into its own sentences", () => {
    assert.equal(errorFrom(409, '{"detail":"Get closer."}').message, "Get closer.");
    assert.equal(errorFrom(403, '{"detail":{"reason":"Recharging until 3pm."}}').message, "Recharging until 3pm.");
    assert.equal(errorFrom(401, '{"detail":"stale nonce"}').kind, "stale_nonce");
    assert.equal(errorFrom(401, '{"detail":"bad signature"}').kind, "bad_signature");
    assert.equal(errorFrom(503, "oops").retryable, true);
    assert.equal(errorFrom(409, "{}").retryable, false);
  });
  it("retries a stale nonce once, not a refusal", async () => {
    const id = new Identity(SEED, "device");
    let n = 0;
    const { fetch } = fakeFetch(() => (n++ === 0 ? { status: 401, body: { detail: "stale nonce" } } : { body: { attempt_id: "a" } }));
    const client = new GameClient({ baseUrl: "https://g", identity: () => id, fetch, sleep: async () => {} });
    await client.answer("a", [1]);
    assert.equal(n, 2);
    let m = 0;
    const { fetch: f2 } = fakeFetch(() => (m++, { status: 409, body: { detail: "Get closer." } }));
    const c2 = new GameClient({ baseUrl: "https://g", identity: () => id, fetch: f2, sleep: async () => {} });
    await assert.rejects(c2.openPoint("p", 0, 0, 5), /Get closer/);
    assert.equal(m, 1);
  });
  it("no player, no signed call", async () => {
    const client = new GameClient({ baseUrl: "https://g", identity: () => null, fetch: fakeFetch(() => undefined).fetch });
    await assert.rejects(client.roamMe(), (e: unknown) => e instanceof GameError && e.kind === "not_signed_in");
  });
  it("keeps the 62-bit duel seed exact", () => {
    const text = '{"duel_id":"d1234567","mode":"point","target":"p","seed":4227330082013244087,"setup":{"seed":4227330082013244087}}';
    const start = parseDuelStart(text);
    assert.equal(start.seed_text, "4227330082013244087");
    assert.notEqual(String(start.seed), "4227330082013244087", "JSON.parse alone would lose it");
  });
  it("duel start omits what it does not know (the server's accuracy_m is not nullable)", async () => {
    const id = new Identity(SEED, "device");
    const { fetch, calls } = fakeFetch(() => ({ body: '{"duel_id":"d1234567","mode":"trial","target":"dc","seed":5,"setup":{}}' }));
    const client = new GameClient({ baseUrl: "https://g", identity: () => id, fetch });
    await client.duelStart({ mode: "trial", target: "dc" });
    assert.deepEqual(Object.keys(JSON.parse(calls[0].body ?? "{}")).sort(), ["device_key", "mode", "target"]);
  });
});

describe("wire", () => {
  it("flattens feature extras like the iOS decoder", () => {
    assert.deepEqual(flattenExtra({ guardian: "Keeper", hp: 3, siege: { guardian_hp: 40 }, list: [1], none: null }), {
      guardian: "Keeper",
      hp: "3",
      siege: "object",
      "siege.guardian_hp": "40",
    });
  });
  it("reads Python's microsecond timestamps", () => {
    assert.equal(parseServerDate("2026-10-13T13:03:12.642358+00:00"), Date.parse("2026-10-13T13:03:12.642+00:00"));
    assert.equal(parseServerDate(null), null);
  });
  it("the server's point mode decides duel or quiz", () => {
    const p = { challenge: "trivia" } as QuestPoint;
    assert.equal(pointPlaysAsDuel(p, { features: { duel: { point_mode: "duel" } } } as RoamMe), true);
    assert.equal(pointPlaysAsDuel({ challenge: "duel" } as QuestPoint, { features: { duel: { point_mode: "quiz" } } } as RoamMe), false);
    assert.equal(pointPlaysAsDuel({ challenge: "duel" } as QuestPoint, null), true);
  });
  it("cooling follows the server's clock", () => {
    const p = { cooling_until: "2026-10-13T14:00:00+00:00" } as QuestPoint;
    assert.equal(isCooling(p, Date.parse("2026-10-13T13:00:00Z")), true);
    assert.equal(isCooling(p, Date.parse("2026-10-13T15:00:00Z")), false);
  });
});

describe("geo", () => {
  it("distances, bearings and the local plane", () => {
    const a = { lat: 51.5074, lng: -0.1278 };
    const b = { lat: 51.5083, lng: -0.1278 };
    assert.ok(Math.abs(distanceM(a, b) - 100.1) < 0.5);
    assert.ok(Math.abs(bearingDeg(a, b)) < 0.01);
    const local = toLocal(a, b);
    assert.ok(Math.abs(local.z - 100.2) < 0.5 && Math.abs(local.x) < 1e-9);
    assert.equal(reachM(80, 100), 105);
    assert.equal(distanceText(42), "40 m");
    assert.equal(distanceText(1234), "1.2 km");
    const stepped = stepToward(a, b, 50);
    assert.ok(Math.abs(distanceM(a, stepped) - 50) < 0.5);
  });
});

describe("the Warden", () => {
  it("picks the variant exactly as Swift does", () => {
    // Python emulation of Swift's (seed &* 31 &+ scalar) & 0x7fffffff.
    assert.equal(lineSeed("moment: correct | style: arcade | name: Ada | place: Caffè Nero 🍵 | challenge: duel"), 1209235477);
  });
  it("styles follow the faction", () => {
    assert.equal(wardenStyle("gaming"), "arcade");
    assert.equal(wardenStyle("marvel"), "quippy");
    assert.equal(wardenStyle(null), "neutral");
  });
  it("lines use only the facts given", () => {
    const m = new WardenMoment("correct", "arcade", [["name", "Ada"], ["place", "Caffè Nero 🍵"], ["challenge", "duel"]]);
    assert.equal(m.input, "moment: correct | style: arcade | name: Ada | place: Caffè Nero 🍵 | challenge: duel");
    assert.equal(fallbackLine(m), "GG, Ada. That's how it's done.");
  });
  it("arrive and nudge moments carry the player's real numbers", () => {
    const me = {
      faction: "dc",
      day: "2026-10-13",
      streak: { days: 3, best: 3, played_today: false },
      standing: { level: 4, rank: "Scout", into_level: 50, level_span: 200, max_level: false },
      dailies: [{ id: "d", title: "Play 3 points", progress: 1, target: 3, done: false, reward: { xp: 50, coins: 5 } }],
    } as unknown as RoamMe;
    const p = { id: "p", name: "Nelson", lat: 51.5078, lng: -0.1279, tier: "epic", challenge: "duel", realm: "dc" } as QuestPoint;
    const arrive = arriveMoment({ me, playerName: "Ada" }, p);
    assert.equal(arrive.style, "mythic");
    assert.equal(arrive.fact("streak"), "3 days");
    assert.equal(arrive.fact("to_next"), "150 XP");
    const nudge = nudgeMoment({ me, playerName: "Ada" }, { lat: 51.5, lng: -0.1278 }, [p], 80, null);
    assert.equal(nudge?.fact("nearest"), "Nelson");
    assert.equal(nudge?.fact("daily_left"), "Play 3 points");
  });
  it("the model is optional: a failing writer falls back at once", async () => {
    const m = reactionMoment({ me: null, playerName: "Ada" }, false, { name: "Here" }, "trivia");
    assert.deepEqual(await lineFor(m, async () => { throw new Error("no model"); }), { text: fallbackLine(m), fromModel: false });
    assert.deepEqual(await lineFor(m, async () => " Generated. "), { text: "Generated.", fromModel: true });
  });
});

function memoryStorage(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

const ME = (key: string, faction: string | null = null) => ({
  device_key: key,
  faction,
  standing: { level: 1, rank: "Rookie", xp: 0, level_floor_xp: 0, next_level_xp: 100, into_level: 0, level_span: 100, max_level: false },
  coins: 0,
  faction_points: 0,
  streak: { days: 0, best: 0, played_today: false },
  tutorial_done: false,
  dailies: [],
  day: "2026-10-13",
});

describe("store", () => {
  it("one login unavailable: plays on this phone's own key, kept across launches", async () => {
    const storage = memoryStorage();
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/v1/sso/cosquest")) return { status: 503, body: { detail: "not configured" } };
      if (call.url.includes("/v1/roam/config")) return { body: { factions: [{ id: "dc", name: "DC" }], ranks: [], max_level: 40, open_radius_m: 80, cooldown_s: 600 } };
      if (call.url.includes("/v1/roam/me")) return { body: ME(call.url.split("device_key=")[1]) };
      return undefined;
    });
    const store = createGameStore({ baseUrl: "https://g", storage, randomSeedHex: () => randomBytes(32).toString("hex"), fetch });
    await store.setSession("chat-token");
    const first = store.get().session;
    assert.equal(first?.source, "device");
    assert.equal(store.needsOnboarding, true, "no faction yet: onboarding");
    assert.ok(calls.some((c) => c.url.endsWith("/v1/sso/cosquest") && c.body === '{"token":"chat-token"}'));
    const again = createGameStore({ baseUrl: "https://g", storage, randomSeedHex: () => randomBytes(32).toString("hex"), fetch });
    await again.setSession("chat-token");
    assert.equal(again.get().session?.playerKey, first?.playerKey, "the same phone key next launch");
    await again.setSession(null);
    assert.equal(again.get().session, null);
    assert.equal(again.signedIn(), false);
  });

  it("one login works: the account's player, points around the fix, cooling shown at once", async () => {
    const seed = "22".repeat(32);
    const pub = new Identity(seed, "account").publicKeyHex;
    const point = { id: "p1", name: "Nelson", lat: 51.5078, lng: -0.1279, source: "landmark", place_kind: "artwork", tier: "epic", realm: "dc", challenge: "trivia", extra: { guardian: "Keeper" } };
    const { fetch } = fakeFetch((call) => {
      if (call.url.endsWith("/v1/sso/cosquest")) return { body: { provider: "cosquest", subject: "u", created: true, player: { device_key: pub }, key: { alg: "ed25519", seed_hex: seed }, nonce_floor: 0 } };
      if (call.url.includes("/v1/roam/config")) return { body: { factions: [], ranks: [], max_level: 40, open_radius_m: 80, cooldown_s: 600 } };
      if (call.url.includes("/v1/roam/me")) return { body: { ...ME(pub, "dc"), tutorial_done: true } };
      if (call.url.includes("/v1/roam/points")) return { body: { region: "london", day: "d", points: [point], attribution: "" } };
      if (call.url.includes("/v1/roam/answer")) return { body: { point_id: "p1", cooling_until: "2999-01-01T00:00:00+00:00", me: { ...ME(pub, "dc"), coins: 7 } } };
      if (call.url.includes("/v1/roam/war") || call.url.includes("/v1/roam/leaders") || call.url.includes("/v1/map/ground")) return { status: 503, body: {} };
      return undefined;
    });
    const store = createGameStore({ baseUrl: "https://g", storage: memoryStorage(), randomSeedHex: () => "00".repeat(32), fetch });
    store.resume();
    await store.setSession("tok");
    assert.equal(store.get().session?.source, "account");
    assert.equal(store.get().session?.playerKey, pub);
    store.setFix({ lat: 51.5074, lng: -0.1278, accuracy: 5, at: 0 });
    await store.refreshPoints(true);
    assert.equal(store.get().points.length, 1);
    assert.equal(store.get().ready, true);
    assert.equal(store.inReach(point), true, "45 m is within 80 m + 5 m");
    await store.submit({ attempt_id: "a" } as never, [0]);
    assert.equal(store.isCooling(store.get().points[0]), true);
    assert.equal(store.get().me?.coins, 7);
  });
});
