// The Forge catalogue against a fake server: the body forge.py writes
// (`_public_element`), tolerant decoding, the 404 of a server from before the
// Forge, the one-minute throttle, and the helpers the cards use.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameClient } from "../client.ts";
import {
  createForgeStore,
  fetchForgeCatalogue,
  FORGE_REFRESH_MS,
  forgeKind,
  forgeNumber,
  forgeThumbnailUrl,
  forgeWeapons,
  parseForgeCatalogue,
  parseForgeElement,
} from "../forge.ts";

// What staging answered for GET v1/catalogue?type=weapon on 2026-10-14.
const EMBER = {
  bounds_m: [
    [-0.1114, -0.0897, -0.025],
    [0.1104, 0.9353, 0.0254],
  ],
  files: [
    {
      bytes: 9760,
      file: "ember_blade__lod0.glb",
      lod: 0,
      sha256: "bc7351eec3d8851fe6f123f352bef9ab37d4dd1238a175ea1fe42b3b7e8d992a",
      url: "/v1/catalogue/files/b0d2c356-d551-411c-9ebd-421060f7a087/1/ember_blade__lod0.glb",
    },
  ],
  id: "b0d2c356-d551-411c-9ebd-421060f7a087",
  name: "Ember Blade",
  published_at: "2026-10-07T09:10:53.826468+00:00",
  rarity: "rare",
  realm: "marvel",
  rigged: null,
  role: null,
  sockets: { grip: [0, 0, 0], tip: [-0.0009, 0.9353, -0.0006] },
  stats: { cooldown_s: 3.0, damage: 15, range_m: 3.0 },
  type: "weapon",
  version: 1,
};

type Call = { url: string; method: string; headers: Record<string, string> };
function fakeFetch(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    const call = { url, method: init.method, headers: init.headers };
    calls.push(call);
    const a = answer(call);
    const status = a.status ?? 200;
    const text = typeof a.body === "string" ? a.body : JSON.stringify(a.body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

describe("forge: wire", () => {
  it("reads a published weapon as forge.py writes it", () => {
    const w = parseForgeElement(EMBER);
    assert.ok(w);
    assert.equal(w.stats?.damage, 15);
    assert.equal(w.files[0].lod, 0);
    assert.equal(w.thumbnail, null);
    assert.equal(w.rigged, null);
  });
  it("drops an element that does not parse rather than the whole catalogue", () => {
    const got = parseForgeCatalogue({
      elements: [EMBER, { id: "x", type: "weapon", name: "No version" }, { ...EMBER, id: "y", stats: "odd", files: [{ file: 3 }], name: "Odd Axe" }, null],
    });
    assert.deepEqual(
      got.map((e) => e.id),
      [EMBER.id, "y"],
    );
    assert.equal(got[1].stats, null);
    assert.deepEqual(got[1].files, []);
    assert.throws(() => parseForgeCatalogue({ nope: 1 }));
  });
  it("keeps weapons only, rarest first, then by name", () => {
    const els = [
      parseForgeElement({ ...EMBER, id: "a", name: "Zed Sword", rarity: "common" })!,
      parseForgeElement({ ...EMBER, id: "b", name: "Hero", type: "character" })!,
      parseForgeElement({ ...EMBER, id: "c", name: "Alpha Mace", rarity: "legendary" })!,
      parseForgeElement({ ...EMBER, id: "d", name: "Beta", rarity: null })!,
      parseForgeElement({ ...EMBER, id: "e", name: "Able Bow", rarity: "common" })!,
    ];
    assert.deepEqual(
      forgeWeapons(els).map((e) => e.id),
      ["c", "e", "a", "d"],
    );
  });
});

describe("forge: look", () => {
  it("reads the kind from the name, as a player would", () => {
    assert.equal(forgeKind("Ember Blade"), "blade");
    assert.equal(forgeKind("Glitch Cleaver"), "axe");
    assert.equal(forgeKind("Storm WAND"), "staff");
    assert.equal(forgeKind("Iron Mace"), "hammer");
    assert.equal(forgeKind("Fist of Ages"), "gauntlet");
    assert.equal(forgeKind("Rainbow"), "bow", "the iOS rule, word inside a word included");
  });
  it("prints stats as iOS does", () => {
    assert.equal(forgeNumber(15), "15");
    assert.equal(forgeNumber(2.5), "2.5");
    assert.equal(forgeNumber(null), "—");
  });
  it("builds the thumbnail URL against the server, with a width", () => {
    const w = parseForgeElement({ ...EMBER, thumbnail: { file: "t.png", url: "/v1/catalogue/files/x/1/t.png" } })!;
    assert.equal(forgeThumbnailUrl("https://g.example/", w, 256), "https://g.example/v1/catalogue/files/x/1/t.png?w=256");
    assert.equal(forgeThumbnailUrl("https://g.example", w), "https://g.example/v1/catalogue/files/x/1/t.png");
    assert.equal(forgeThumbnailUrl("https://g.example", parseForgeElement(EMBER)!), null);
  });
});

describe("forge: fetching", () => {
  it("asks for the weapons, unsigned; a 404 is a server without the Forge", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { elements: [EMBER] } }));
    const client = new GameClient({ baseUrl: "https://g", identity: () => null, fetch });
    const got = await fetchForgeCatalogue(client);
    assert.equal(got.source, "network");
    assert.equal(got.weapons.length, 1);
    assert.equal(calls[0].url, "https://g/v1/catalogue?type=weapon");
    assert.equal(calls[0].headers["X-Signature"], undefined);

    const old = new GameClient({ baseUrl: "https://g", identity: () => null, fetch: fakeFetch(() => ({ status: 404, body: { detail: "Not Found" } })).fetch });
    assert.deepEqual(await fetchForgeCatalogue(old), { weapons: [], source: "unavailable" });
  });
  it("the store skips a refresh inside a minute, and keeps what it had when the server is down", async () => {
    let t = 1_000_000;
    let down = false;
    const { fetch, calls } = fakeFetch(() => (down ? { status: 503, body: "{}" } : { body: { elements: [EMBER] } }));
    const client = new GameClient({ baseUrl: "https://g", identity: () => null, fetch, sleep: async () => {} });
    const store = createForgeStore({ client, now: () => t });
    await store.refresh();
    assert.equal(store.get().weapons.length, 1);
    assert.equal(store.get().source, "network");
    assert.equal(store.weapon(EMBER.id)?.name, "Ember Blade");
    await store.refresh();
    assert.equal(calls.length, 1, "inside the minute");
    t += FORGE_REFRESH_MS + 1;
    down = true;
    await store.refresh();
    assert.equal(store.get().weapons.length, 1);
    assert.equal(store.get().source, "memory");
    assert.equal(store.get().loading, false);
  });
});
