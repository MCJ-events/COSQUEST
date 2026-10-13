// The TypeScript client against the real STAGING game server: the signing
// scheme, a signed write, a point fetch, and (if a point is in reach) the
// challenge flow. Never production. Off unless asked for:
//
//   CQ_LIVE_STAGING=1 node --test features/game/__tests__/staging.live.test.ts
//
// Each run makes a fresh throwaway player (a random key) on staging.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { GameClient, GameError } from "../client.ts";
import { STAGING_GAME_SERVER } from "../config.ts";
import { Identity } from "../identity.ts";

const live = process.env.CQ_LIVE_STAGING === "1";
// Trafalgar Square: a dense, stable set of points on staging.
const HERE = { lat: 51.5074, lng: -0.1278 };

describe("staging game server (live)", { skip: !live && "set CQ_LIVE_STAGING=1" }, () => {
  const identity = new Identity(randomBytes(32).toString("hex"), "device");
  const client = new GameClient({ baseUrl: STAGING_GAME_SERVER, identity: () => identity });

  it("is staging, and up", async () => {
    assert.match(client.baseUrl, /staging/);
    assert.equal((await client.health()).status, "ok");
  });

  it("a signed write is accepted (the signing scheme matches the server)", async () => {
    await client.saveProfile("TS Interop", { face: 1, mark: 2, tint: "#3FA7D6" });
    const me = await client.chooseFaction("gaming");
    assert.equal(me.faction, "gaming");
    assert.equal(me.device_key, identity.publicKeyHex);
  });

  it("a bad signature is refused with the server's reason", async () => {
    const wrong = new Identity(randomBytes(32).toString("hex"), "device");
    const liar = new GameClient({
      baseUrl: STAGING_GAME_SERVER,
      identity: () => ({ ...wrong, publicKeyHex: identity.publicKeyHex, signedHeaders: (m: string, p: string, b: Uint8Array) => ({ ...wrong.signedHeaders(m, p, b), "X-Device-Key": identity.publicKeyHex }) }) as unknown as Identity,
    });
    await assert.rejects(liar.chooseFaction("dc"), (error: unknown) => error instanceof GameError && error.status === 401);
  });

  it("signed GET of the points around a place", async () => {
    const got = await client.questPoints(HERE.lat, HERE.lng);
    assert.ok(got.points.length > 0, "points near Trafalgar Square");
    const me = await client.roamMe();
    assert.equal(me.faction, "gaming");
    assert.ok(Array.isArray(me.dailies));
  });

  it("opens the nearest point as the server's mode says (duel or quiz)", async () => {
    const me = await client.roamMe();
    const { points } = await client.questPoints(HERE.lat, HERE.lng);
    const near = [...points].sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9))[0];
    const asDuel = me.features?.duel?.point_mode === "duel" || near.challenge === "duel";
    if (asDuel) {
      const start = await client.duelStart({ mode: "point", target: near.id, lat: near.lat, lng: near.lng, accuracy_m: 5 });
      assert.equal(start.mode, "point");
      assert.ok(start.duel_id.length >= 8);
      assert.ok(start.setup && typeof start.setup === "object");
    } else {
      const attempt = await client.openPoint(near.id, near.lat, near.lng, 5);
      assert.ok(attempt.attempt_id);
    }
  });
});
