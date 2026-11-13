// The brief features of 13 Nov (referrals, venue challenges with staff, comic panel puzzles) against a
// fake server: routes, signing, queries, the "feature off" answers, the flag cache and gating, the
// puzzle's tap order and the links.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  badgeFor,
  base64Bytes,
  checkIn,
  clockText,
  completeStation,
  createFlagCache,
  decideCompletion,
  eventWhenText,
  fetchNearbyEvents,
  fetchBriefFlags,
  fetchMyStations,
  fetchReferralMe,
  fetchStaffEvents,
  fetchStaffQueue,
  fetchStations,
  FLAGS_OFF,
  isNotStaff,
  isPuzzleStation,
  isStaffStation,
  joinStaff,
  needFrom,
  normaliseReferralCode,
  normaliseStationCode,
  orderComplete,
  panelsInOrder,
  parseFlags,
  photoFits,
  photoUri,
  redeemErrorText,
  redeemReferral,
  referralCodeFromLink,
  retryAtFrom,
  rewardLine,
  rewardText,
  routeForBriefLink,
  secondsUntil,
  showEvents,
  showPuzzles,
  showReferrals,
  showVenueChallenges,
  stationErrorText,
  stationFromLink,
  stationStep,
  startPuzzle,
  submitPuzzle,
  tapPanel,
  uploadStationPhoto,
  waitText,
  wantsCode,
  wantsPhoto,
  type Panel,
  type Station,
} from "../briefFeatures.ts";
import { GameClient, GameError } from "../client.ts";
import { Identity, signingPayload, utf8ToBytes, verifySignature } from "../identity.ts";
import { routeForUrl } from "../../world/links.ts";

const SEED = "44".repeat(32);
const GID = "3f2a1c0e-1111-4a2b-9c3d-abcdef012345";
const SID = "9e8d7c6b-2222-4f3e-8a1b-0123456789ab";

type Call = { path: string; method: string; headers: Record<string, string>; body?: string; url: string; query: URLSearchParams };

function fakeServer(route: (call: Call, json: Record<string, unknown>) => { status?: number; body: unknown } | undefined) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const u = new URL(url);
    const call = { url, path: u.pathname, query: u.searchParams, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const json = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const answer = route(call, json) ?? { status: 404, body: { detail: "Not Found" } };
    const status = answer.status ?? 200;
    const text = JSON.stringify(answer.body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

async function setup(route: Parameters<typeof fakeServer>[0]) {
  const id = new Identity(SEED, "device");
  const server = fakeServer(route);
  const client = new GameClient({ baseUrl: "https://game.test", identity: () => id, fetch: server.fetch, sleep: async () => {} });
  return { id, client, calls: server.calls };
}

function signedOk(call: Call, id: Identity): boolean {
  const nonce = Number(call.headers["X-Nonce"]);
  return verifySignature(id.publicKeyHex, signingPayload(call.method, call.path, utf8ToBytes(call.body ?? ""), nonce), call.headers["X-Signature"]);
}

const station = (over: Partial<Station> = {}): Station => ({
  id: SID,
  lat: 51.5,
  lng: -0.12,
  station_type: "carnival",
  name: "Ring toss",
  radius_m: 40,
  xp: 100,
  quest_points: 100,
  verify: "manual",
  qr: "required",
  photo: "optional",
  staff_verified: true,
  puzzle: false,
  ...over,
});

describe("brief features: flags", () => {
  it("reads only true as on, and a server without the route has everything off", async () => {
    assert.deepEqual(parseFlags({ flags: { referrals: true, comic_puzzles: "yes", stations_v2: 1 } }), { ...FLAGS_OFF, referrals: true });
    assert.deepEqual(parseFlags(null), FLAGS_OFF);
    const off = await setup(() => undefined);
    assert.deepEqual(await fetchBriefFlags(off.client), FLAGS_OFF);
    assert.equal(off.calls[0].path, "/v1/brief/flags");
    assert.equal(off.calls[0].headers["X-Signature"], undefined, "public, unsigned");
    const on = await setup(() => ({ body: { flags: { ...FLAGS_OFF, referrals: true, stations_v2: true, venue_challenges: true } } }));
    const f = await fetchBriefFlags(on.client);
    assert.equal(showReferrals(f), true);
    assert.equal(showEvents(f), true);
    assert.equal(showVenueChallenges(f), true);
    assert.equal(showPuzzles(f), false);
  });

  it("a challenge or puzzle flag alone shows nothing without stations", () => {
    assert.equal(showVenueChallenges({ ...FLAGS_OFF, venue_challenges: true }), false);
    assert.equal(showPuzzles({ ...FLAGS_OFF, comic_puzzles: true }), false);
    assert.equal(showReferrals(null), false);
    assert.equal(showEvents(undefined), false);
  });

  it("asks at most once per minute, shares one ask, and a failure never turns a flag on", async () => {
    let t = 0;
    let n = 0;
    let fail = false;
    const cache = createFlagCache(
      async () => {
        n++;
        if (fail) throw new Error("offline");
        return { ...FLAGS_OFF, referrals: true };
      },
      60_000,
      () => t,
    );
    assert.equal(cache.peek(), null);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    assert.equal(n, 1);
    assert.equal(a.referrals && b.referrals, true);
    t = 30_000;
    await cache.get();
    assert.equal(n, 1);
    t = 61_000;
    fail = true;
    const kept = await cache.get();
    assert.equal(n, 2);
    assert.equal(kept.referrals, true, "a failed ask keeps the last answer");
    cache.clear();
    const none = await cache.get();
    assert.deepEqual(none, FLAGS_OFF, "no answer yet and offline: all off");
  });
});

describe("brief features: referrals", () => {
  it("reads your code signed, with the key in the query", async () => {
    const { client, calls, id } = await setup((c) =>
      c.path === "/v1/referrals/me" ? { body: { code: "K7P2QXA", link: "https://game.test/r/K7P2QXA", share_text: "Join me", reward: { kind: "none" }, can_redeem: true } } : undefined,
    );
    const me = await fetchReferralMe(client);
    assert.equal(me.code, "K7P2QXA");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].query.get("device_key"), id.publicKeyHex);
    assert.ok(signedOk(calls[0], id));
  });

  it("redeems a cleaned code, with the install id only when there is one", async () => {
    const { client, calls, id } = await setup((c, json) =>
      c.path === "/v1/referrals/redeem" ? { body: { status: "pending", referrer_handle: "kofi", qualify: "Finish your first quest." , got: json } } : undefined,
    );
    const r = await redeemReferral(client, " k7p-2qxa ", "IDFV-1");
    assert.equal(r.status, "pending");
    const body = JSON.parse(calls[0].body ?? "{}");
    assert.deepEqual(body, { device_key: id.publicKeyHex, code: "K7P2QXA", install_id: "IDFV-1" });
    assert.ok(signedOk(calls[0], id));
    await redeemReferral(client, "abcd", null);
    assert.equal("install_id" in JSON.parse(calls[1].body ?? "{}"), false);
  });

  it("turns each refusal into a sentence", async () => {
    const { client } = await setup(() => ({ status: 409, body: { detail: { reason: "own_code" } } }));
    try {
      await redeemReferral(client, "ABCD", null);
      assert.fail("should refuse");
    } catch (e) {
      assert.match(redeemErrorText(e), /your own code/);
    }
    assert.match(redeemErrorText(new GameError("http", "unknown_code", 404, { reason: "unknown_code" })), /isn't anyone's/);
    assert.match(redeemErrorText(new GameError("network", "x")), /Can't reach/);
    assert.equal(redeemErrorText(new GameError("http", "Some new rule.", 409)), "Some new rule.");
  });

  it("says nothing about a reward that is none, and spells Costcoin", () => {
    assert.equal(rewardLine({ reward: { kind: "none" } }), null);
    assert.equal(rewardLine({ reward: { kind: "costcoin", costcoin: 0 } }), null);
    assert.equal(rewardText({ kind: "costcoin", costcoin: 1500 }), "1,500 Costcoin");
    assert.equal(rewardText({ kind: "cosmetic", cosmetic_id: "frame-gold", cosmetic_name: "Gold frame" }), "Gold frame");
    const line = rewardLine({ reward: { kind: "costcoin", costcoin: 50 }, referee_reward: { kind: "cosmetic", cosmetic_name: "Welcome badge" } }) ?? "";
    assert.match(line, /you get 50 Costcoin and they get Welcome badge/);
    assert.doesNotMatch(line, /CosCoin|coins|XP/);
    assert.equal(normaliseReferralCode("ab-c d1!"), "ABCD1");
  });
});

describe("brief features: stations and venue challenges", () => {
  it("lists stations unsigned and your completions signed", async () => {
    const { client, calls, id } = await setup((c) => {
      if (c.path === `/v1/events/${GID}/stations`) return { body: { stations: [station()] } };
      if (c.path === `/v1/events/${GID}/stations/mine`) return { body: { completions: [{ station_id: SID, status: "pending", claim_code: "7K2P" }] } };
      return undefined;
    });
    assert.equal((await fetchStations(client, GID))[0].name, "Ring toss");
    assert.equal(calls[0].headers["X-Signature"], undefined);
    const mine = await fetchMyStations(client, GID);
    assert.equal(mine[0].claim_code, "7K2P");
    assert.equal(calls[1].query.get("device_key"), id.publicKeyHex);
    assert.ok(signedOk(calls[1], id));
  });

  it("checks in, uploads the photo and completes with the code and photo id, all signed", async () => {
    const { client, calls, id } = await setup((c) => {
      if (c.path.endsWith("/checkin")) return { body: { checked_in: true, already: false, game_id: GID } };
      if (c.path.endsWith("/photo")) return { body: { photo_id: "ph-1" } };
      if (c.path.endsWith("/complete")) return { body: { status: "pending", xp: 0, quest_points: 0, claim_code: "7K2P", attempts: 1 } };
      return undefined;
    });
    const at = { lat: 51.5, lng: -0.12, accuracy_m: 5 };
    await checkIn(client, GID, at);
    await uploadStationPhoto(client, GID, SID, "AAAA");
    const done = await completeStation(client, GID, SID, at, { stationCode: "k7p 2qx", photoId: "ph-1" });
    assert.equal(done.claim_code, "7K2P");
    assert.deepEqual(
      calls.map((c) => c.path),
      [`/v1/events/${GID}/checkin`, `/v1/events/${GID}/stations/${SID}/photo`, `/v1/events/${GID}/stations/${SID}/complete`],
    );
    for (const c of calls) assert.ok(signedOk(c, id), c.path);
    assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), { device_key: id.publicKeyHex, image_b64: "AAAA", mime: "image/jpeg" });
    const body = JSON.parse(calls[2].body ?? "{}");
    assert.equal(body.station_code, "K7P2QX");
    assert.equal(body.photo_id, "ph-1");
    // No code, no photo: neither is sent.
    await completeStation(client, GID, SID, at);
    const bare = JSON.parse(calls[3].body ?? "{}");
    assert.equal("station_code" in bare || "photo_id" in bare, false);
  });

  it("knows what a refusal says is missing", async () => {
    const { client } = await setup(() => ({ status: 403, body: { detail: { reason: "Scan the station's code first.", need: "station_code" } } }));
    try {
      await completeStation(client, GID, SID, { lat: 0, lng: 0, accuracy_m: 5 });
      assert.fail("should refuse");
    } catch (e) {
      assert.equal(needFrom(e), "station_code");
      assert.equal(stationErrorText(e), "Scan the station's code first.");
    }
    assert.equal(needFrom(new GameError("http", "x", 422, { need: "photo" })), "photo");
    assert.equal(needFrom(new Error("x")), null);
    assert.equal(stationErrorText(new GameError("http", "Not Found", 404)), "This isn't open right now.");
    assert.equal(stationErrorText(new GameError("http", "own_completion", 403, { reason: "own_completion" })), "You can't approve your own challenge.");
    assert.equal(stationErrorText(new GameError("http", "cooldown", 429, { reason: "cooldown", retry_at: "x" })), "Wait a moment before the next try.");
  });

  it("steps a station from its completion", () => {
    assert.equal(stationStep(null), "start");
    assert.equal(stationStep({ station_id: SID, status: "pending" }), "pending");
    assert.equal(stationStep({ station_id: SID, status: "verified" }), "done");
    assert.equal(stationStep({ station_id: SID, status: "rejected", can_retry: true }), "retry");
    assert.equal(stationStep({ station_id: SID, status: "rejected", can_retry: false }), "rejected");
    assert.equal(isStaffStation(station()), true);
    assert.equal(isStaffStation(station({ verify: "location", staff_verified: false })), false);
    assert.equal(isPuzzleStation(station({ verify: "puzzle" })), true);
    assert.equal(wantsCode(station()), true);
    assert.equal(wantsCode(station({ qr: "off" })), false);
    assert.equal(wantsPhoto(station({ photo: null })), false);
  });

  it("measures a photo before sending it", () => {
    assert.equal(base64Bytes("AAAA"), 3);
    assert.equal(base64Bytes("AAA="), 2);
    assert.equal(base64Bytes("AA=="), 1);
    assert.equal(photoFits("A".repeat(800_000)), true);
    assert.equal(photoFits("A".repeat(900_000)), false);
    assert.equal(normaliseStationCode("k7-p2 qx!"), "K7P2QX");
  });
});

describe("brief features: events", () => {
  it("lists events near the fix, or everywhere without one", async () => {
    const { client, calls } = await setup((c) => (c.path === "/v1/games" ? { body: { games: [{ game_id: GID, title: "Fair", status: "live" }] } } : undefined));
    assert.equal((await fetchNearbyEvents(client, { lat: 51.5, lng: -0.1 }))[0].title, "Fair");
    assert.equal(calls[0].query.get("lat"), "51.5");
    assert.equal(calls[0].query.get("radius_m"), "50000");
    await fetchNearbyEvents(client, null);
    assert.equal(calls[1].query.get("lat"), null);
    assert.equal(eventWhenText({ status: "live" }), "Live now");
    assert.equal(eventWhenText({ status: "scheduled", starts_at: "2026-11-14T18:00:00Z" }), "Starts 14 Nov");
    assert.equal(eventWhenText({ status: "finished" }), "Ended");
  });
});

describe("brief features: staff", () => {
  it("joins, lists events, reads the queue and decides, all signed", async () => {
    const { client, calls, id } = await setup((c) => {
      if (c.path.endsWith("/staff/join")) return { body: { staff: true, game_id: GID, title: "Fair" } };
      if (c.path === "/v1/venue/staff/events") return { body: { events: [{ game_id: GID, title: "Fair", status: "live", pending: 2 }] } };
      if (c.path.endsWith("/staff/queue")) return { body: { game_id: GID, title: "Fair", completions: [{ id: 5, claim_code: "7K2P", handle: "ada", station_id: SID, station_name: "Ring toss", station_type: "carnival", status: "pending", submitted_at: "2026-11-13T10:00:00Z", photo_url: "/v1/venue/photos/p1?t=x" }], stations: [{ id: SID, name: "Ring toss", station_type: "carnival", code: "K7P2QX", qr_text: "cosquest://station?game=a&station=b&code=K7P2QX" }] } };
      if (c.path.endsWith("/verify")) return { body: { status: "verified", xp: 100, quest_points: 100 } };
      return undefined;
    });
    await joinStaff(client, GID, "abcd 1234");
    assert.equal(JSON.parse(calls[0].body ?? "{}").code, "ABCD1234");
    assert.equal((await fetchStaffEvents(client))[0].pending, 2);
    const q = await fetchStaffQueue(client, GID);
    assert.equal(calls[2].query.get("status"), "pending");
    assert.equal(q.completions[0].claim_code, "7K2P");
    assert.equal(q.stations[0].code, "K7P2QX");
    await decideCompletion(client, GID, 5, false, "  no rings landed  ");
    assert.equal(calls[3].path, `/v1/events/${GID}/staff/completions/5/verify`);
    assert.deepEqual(JSON.parse(calls[3].body ?? "{}"), { device_key: id.publicKeyHex, approve: false, note: "no rings landed" });
    await decideCompletion(client, GID, 6, true, " ");
    assert.equal("note" in JSON.parse(calls[4].body ?? "{}"), false);
    for (const c of calls) assert.ok(signedOk(c, id), c.path);
    assert.equal(photoUri("https://game.test/", "/v1/venue/photos/p1?t=x"), "https://game.test/v1/venue/photos/p1?t=x");
    assert.equal(photoUri("https://game.test", "https://cdn.test/p.jpg"), "https://cdn.test/p.jpg");
    assert.equal(photoUri("https://game.test", null), null);
  });

  it("a server with staff off has no staff events; not_staff is told apart", async () => {
    const { client } = await setup(() => undefined);
    assert.deepEqual(await fetchStaffEvents(client), []);
    assert.equal(isNotStaff(new GameError("http", "not_staff", 403, { reason: "not_staff" })), true);
    assert.equal(isNotStaff(new GameError("http", "Get closer.", 403)), false);
  });
});

describe("brief features: comic panel puzzle", () => {
  const panels: Panel[] = [
    { idx: 0, caption: "The gate glows." },
    { idx: 1, caption: "DeathSpeed arrives." },
    { idx: 2, caption: "The six gather." },
  ];

  it("starts and submits the order through the station's puzzle routes", async () => {
    const { client, calls, id } = await setup((c) => {
      if (c.path.endsWith("/puzzle")) return { body: { test_id: "t1", expires_at: "2026-11-13T10:01:30Z", time_limit_s: 90, puzzle: { title: "Trial", prompt: "Put the panels in story order.", panels } } };
      if (c.path.endsWith("/puzzle/submit")) return { body: { passed: false, outcome: "submitted", solution: [2, 0, 1], retry_at: "2026-11-13T10:03:00Z", completion: null } };
      return undefined;
    });
    const paper = await startPuzzle(client, GID, SID, { lat: 1, lng: 2, accuracy_m: 5 });
    assert.equal(paper.puzzle.panels.length, 3);
    const v = await submitPuzzle(client, GID, SID, "t1", [1, 0, 2]);
    assert.equal(v.passed, false);
    assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), { device_key: id.publicKeyHex, test_id: "t1", order: [1, 0, 2] });
    assert.equal(calls[1].path, `/v1/events/${GID}/stations/${SID}/puzzle/submit`);
    for (const c of calls) assert.ok(signedOk(c, id));
    assert.deepEqual(
      panelsInOrder(panels, v.solution).map((p) => p.idx),
      [2, 0, 1],
    );
  });

  it("numbers panels in tap order, and a second tap takes one off without leaving a gap", () => {
    let order: number[] = [];
    order = tapPanel(order, 2);
    order = tapPanel(order, 0);
    order = tapPanel(order, 1);
    assert.deepEqual(order, [2, 0, 1]);
    assert.equal(orderComplete(order, panels), true);
    assert.deepEqual([0, 1, 2].map((i) => badgeFor(order, i)), [2, 3, 1]);
    order = tapPanel(order, 2);
    assert.deepEqual(order, [0, 1]);
    assert.deepEqual([0, 1, 2].map((i) => badgeFor(order, i)), [1, 2, null]);
    assert.equal(orderComplete(order, panels), false);
    assert.equal(orderComplete([0, 0, 1], panels), false);
    assert.equal(orderComplete([0, 1, 7], panels), false);
  });

  it("counts down and says when to try again", () => {
    const now = Date.parse("2026-11-13T10:00:00Z");
    assert.equal(secondsUntil("2026-11-13T10:01:05Z", now), 65);
    assert.equal(secondsUntil("2026-11-13T09:59:00Z", now), 0);
    assert.equal(secondsUntil("nonsense", now), 0);
    assert.equal(clockText(65), "1:05");
    assert.equal(clockText(9), "0:09");
    assert.equal(waitText("2026-11-13T10:00:30Z", now), "Try again in 30 s");
    assert.equal(waitText("2026-11-13T10:05:00Z", now), "Try again in 5 min");
    assert.equal(waitText(null, now), null);
    assert.equal(retryAtFrom(new GameError("http", "cooldown", 429, { reason: "cooldown", retry_at: "x" })), "x");
    assert.equal(retryAtFrom(new Error("x")), null);
  });
});

describe("brief features: links", () => {
  it("reads a friend's code from the app link and the server's page", () => {
    assert.equal(referralCodeFromLink("cosquest://referral?code=k7p2qxa"), "K7P2QXA");
    assert.equal(referralCodeFromLink("cosquest://referral/K7P2QXA"), "K7P2QXA");
    assert.equal(referralCodeFromLink("https://api.cosquest.test/r/K7P2QXA"), "K7P2QXA");
    assert.equal(referralCodeFromLink("cosquest://r/K7P2QXA"), null);
    assert.equal(referralCodeFromLink("cosquest://referral?code=ab"), null);
    assert.equal(referralCodeFromLink("cosquest://chat/abc"), null);
    assert.equal(referralCodeFromLink(null), null);
  });

  it("reads a booth's QR and an event link", () => {
    assert.deepEqual(stationFromLink(`cosquest://station?game=${GID}&station=${SID}&code=k7p2qx`), { game: GID, station: SID, code: "K7P2QX" });
    assert.deepEqual(stationFromLink(`cosquest://station?game=${GID}&station=${SID}`), { game: GID, station: SID, code: null });
    assert.deepEqual(stationFromLink(`cosquest://event?game=${GID}`), { game: GID, station: null, code: null });
    assert.equal(stationFromLink("cosquest://station?station=x"), null);
    assert.equal(stationFromLink(`cosquest://station?game=${GID}&station=bad/../x`), null);
    assert.equal(stationFromLink(`cosquest://station/extra?game=${GID}`), null);
  });

  it("routes both through the app's link table", () => {
    assert.equal(routeForBriefLink("cosquest://referral?code=K7P2QXA"), "/wale/invite?code=K7P2QXA");
    assert.equal(routeForUrl("cosquest://referral?code=K7P2QXA"), "/wale/invite?code=K7P2QXA");
    assert.equal(routeForUrl(`cosquest://station?game=${GID}&station=${SID}&code=K7P2QX`), `/wale/challenge?game=${GID}&station=${SID}&code=K7P2QX`);
    assert.equal(routeForUrl(`cosquest://event?game=${GID}`), `/wale/event?game=${GID}`);
    assert.equal(routeForUrl("https://api.cosquest.test/r/K7P2QXA"), "/wale/invite?code=K7P2QXA");
    // Unchanged: the links that were there before.
    assert.equal(routeForUrl("cosquest://chat/abc"), "/chat/abc");
    assert.equal(routeForUrl("cosquest://play"), "/play");
    assert.equal(routeForUrl("cosquest://station"), null);
  });
});
