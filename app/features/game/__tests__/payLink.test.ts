// Payments, the app's side (payLink.ts) against a fake server: the check fails
// closed, the hand-off only opens https, the wallet never shows a number the
// server did not send, and the location signals are passed on as the OS gave them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameClient } from "../client.ts";
import { Identity } from "../identity.ts";
import {
  VALUE_STYLE,
  coinsText,
  entryStatusText,
  fetchPayConfig,
  fetchPurchase,
  fetchWallet,
  historyLabel,
  locationSignals,
  paidActionCheck,
  parseCheck,
  parseWallet,
  parseWalletReturn,
  payoutStatusText,
  precisionOf,
  permissionOf,
  receiptText,
  relativeDay,
  regionOf,
  signedCoins,
  startHandoff,
  unavailableText,
  xpText,
} from "../payLink.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeServer(routes: (call: Call) => { status?: number; body: unknown } | undefined | "offline") {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const answer = routes(call);
    if (answer === "offline") throw new Error("offline");
    const a = answer ?? { status: 404, body: { detail: "Not Found" } };
    const text = JSON.stringify(a.body);
    const status = a.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  const client = new GameClient({ baseUrl: "https://x.test", identity: () => new Identity("44".repeat(32), "device"), fetch, sleep: async () => {} });
  return { client, calls };
}

const NOW = Date.parse("2026-11-13T12:00:00Z");
const FIX = { lat: 51.5, lng: -0.12, accuracy: 9, at: NOW - 2500, mocked: false, simulated: null };
const GRANTED_FULL = { status: "granted", granted: true, ios: { accuracy: "full" } };

describe("payLink: location signals", () => {
  it("reads permission and precision as the OS gives them", () => {
    assert.equal(permissionOf(GRANTED_FULL), "granted");
    assert.equal(permissionOf({ status: "denied" }), "denied");
    assert.equal(permissionOf({ status: "undetermined" }), "unknown");
    assert.equal(permissionOf(null), "unknown");
    assert.equal(precisionOf(GRANTED_FULL), "precise");
    assert.equal(precisionOf({ status: "granted", ios: { accuracy: "reduced" } }), "approximate");
    assert.equal(precisionOf({ status: "granted", android: { accuracy: "coarse" } }), "approximate");
    assert.equal(precisionOf({ status: "granted", android: { accuracy: "fine" } }), "precise");
    assert.equal(precisionOf({ status: "denied", ios: { accuracy: "full" } }), "unknown");
  });
  it("sends the fix with its quality, and no fix without permission", () => {
    const s = locationSignals(FIX, GRANTED_FULL, NOW);
    assert.deepEqual(s, { location_permission: "granted", location_precision: "precise", lat: 51.5, lng: -0.12, accuracy_m: 9, fix_age_s: 2.5, mocked: false });
    const denied = locationSignals(FIX, { status: "denied" }, NOW);
    assert.deepEqual(denied, { location_permission: "denied", location_precision: "unknown" });
    assert.deepEqual(locationSignals(null, GRANTED_FULL, NOW), { location_permission: "granted", location_precision: "precise" });
  });
  it("names the phone's region only when the tag has one", () => {
    assert.equal(regionOf("en-GB"), "GB");
    assert.equal(regionOf("zh_Hant_TW"), "TW");
    assert.equal(regionOf("en"), null);
    assert.equal(regionOf(null), null);
  });
});

describe("payLink: the paid action check fails closed", () => {
  it("is allowed only on the server's clear yes", () => {
    assert.equal(parseCheck({ allowed: true, decision: "allow", code: "allowed", check_id: "c1" }).allowed, true);
    assert.equal(parseCheck({ allowed: true }).allowed, false);
    assert.equal(parseCheck({ decision: "allow" }).allowed, false);
    assert.equal(parseCheck(null).allowed, false);
    assert.ok(parseCheck({}).message.length > 0);
  });
  it("sends the action, the moment, the quest and the signals, signed", async () => {
    const { client, calls } = fakeServer((c) => (c.url.endsWith("/v1/pay/check") ? { body: { allowed: true, decision: "allow", code: "allowed", message: "", check_id: "c1" } } : undefined));
    const got = await paidActionCheck(client, { action: "paid_quest_entry", moment: "view", questId: "q-9", payWith: "card", signals: locationSignals(FIX, GRANTED_FULL, NOW), region: "GB" });
    assert.equal(got.allowed, true);
    assert.equal(got.check_id, "c1");
    const body = JSON.parse(calls[0].body!);
    assert.equal(body.action, "paid_quest_entry");
    assert.equal(body.moment, "view");
    assert.equal(body.quest_id, "q-9");
    assert.equal(body.pay_with, "card");
    assert.equal(body.device_region, "GB");
    assert.equal(body.location_precision, "precise");
    assert.equal(body.accuracy_m, 9);
    assert.ok(calls[0].headers["X-Signature"]);
  });
  it("turns a switched-off server, an error or no network into not allowed", async () => {
    for (const answer of [undefined, { status: 500, body: { detail: "boom" } }, "offline" as const]) {
      const { client } = fakeServer(() => answer);
      const got = await paidActionCheck(client, { action: "buy_costcoin", signals: {} });
      assert.equal(got.allowed, false);
      assert.ok(got.message.length > 0);
    }
  });
  it("passes a refusal on in the server's words", async () => {
    const { client } = fakeServer(() => ({ body: { allowed: false, decision: "block", code: "need_location", message: "Turn on location." } }));
    const got = await paidActionCheck(client, { action: "paid_quest_entry", questId: "q", signals: {} });
    assert.deepEqual([got.allowed, got.code, got.message], [false, "need_location", "Turn on location."]);
  });
});

describe("payLink: hand-off and config", () => {
  it("hides everything when the server has no payments (404)", async () => {
    const { client } = fakeServer(() => undefined);
    assert.equal(await fetchPayConfig(client), null);
  });
  it("shows Manage purchases only when the server says so", async () => {
    const off = fakeServer(() => ({ body: { manage_purchases: false } }));
    assert.equal((await fetchPayConfig(off.client))?.manage_purchases, false);
    const on = fakeServer(() => ({ body: { manage_purchases: true, payments_service: "not_configured" } }));
    assert.equal((await fetchPayConfig(on.client))?.manage_purchases, true);
  });
  it("opens only an https link, and sends the check it rests on", async () => {
    const { client, calls } = fakeServer(() => ({ body: { url: "https://pay.test/start?handoff=abc", expires_at: "2026-11-13T12:03:00Z" } }));
    const h = await startHandoff(client, "check-1");
    assert.equal(h.url, "https://pay.test/start?handoff=abc");
    assert.equal(JSON.parse(calls[0].body!).check_id, "check-1");
    const bad = fakeServer(() => ({ body: { url: "javascript:alert(1)" } }));
    await assert.rejects(startHandoff(bad.client, "check-1"));
    const plain = fakeServer(() => ({ body: { url: "http://pay.test/start" } }));
    await assert.rejects(startHandoff(plain.client, "check-1"));
  });
  it("reads the way back from the website", () => {
    assert.deepEqual(parseWalletReturn("cosquest://wallet?from=payments&order=ord_1&result=success"), { fromPayments: true, order: "ord_1", result: "success" });
    assert.deepEqual(parseWalletReturn("cosquest://wallet"), { fromPayments: false, order: null, result: null });
    assert.equal(parseWalletReturn("cosquest://wallet?from=payments&order=%3Cscript%3E")?.order, null);
    assert.equal(parseWalletReturn("cosquest://coins?order=1"), null);
    assert.equal(parseWalletReturn("https://evil.test/wallet"), null);
  });
});

describe("payLink: the wallet shows only what the server sent", () => {
  it("is not available, with no numbers, when the payments service is not connected", async () => {
    const off = { available: false, reason: "not_configured" };
    const { client } = fakeServer(() => ({ body: { service: "not_configured", costcoin: off, history: off, quest_entries: off, payouts: off } }));
    const w = await fetchWallet(client);
    for (const p of [w.balance, w.history, w.entries, w.payouts]) {
      assert.equal(p.available, false);
    }
    assert.equal(unavailableText("not_configured"), "Purchases aren't connected yet.");
  });
  it("reads a connected wallet and drops what it cannot use", () => {
    const w = parseWallet({
      service: "connected",
      costcoin: { available: true, balance: { balance: 380, as_of: "2026-11-13T09:06:00Z", frozen: false } },
      history: { available: true, items: [{ id: "h1", kind: "purchase", delta: 500, at: "2026-11-13T09:00:00Z" }, { id: "x", delta: "lots", at: "t" }] },
      quest_entries: { available: true, items: [{ id: "e1", quest_name: "Night Run", amount_minor: 500, currency: "USD", status: "paid", at: "2026-11-12T18:00:00Z", receipt_url: "javascript:x" }, { id: "e2", amount_minor: 5, currency: "usd", at: "t" }] },
      payouts: { available: true, items: [{ id: "p1", status: "pending_review", at: "2026-11-13T08:00:00Z", amount_minor: 2500 }] },
    });
    assert.deepEqual(w.balance, { available: true, value: { coins: 380, as_of: "2026-11-13T09:06:00Z", frozen: false } });
    assert.equal(w.history.available && w.history.value.length, 1);
    assert.ok(w.entries.available && w.entries.value.length === 1 && w.entries.value[0].receipt_url === null);
    assert.ok(w.payouts.available && !("amount_minor" in w.payouts.value[0]));
  });
  it("treats a negative or missing balance as not available, never zero", () => {
    assert.equal(parseWallet({ costcoin: { available: true, balance: { balance: -1 } } }).balance.available, false);
    assert.equal(parseWallet({ costcoin: { available: true } }).balance.available, false);
    assert.equal(parseWallet(null).balance.available, false);
  });
  it("asks for a purchase's status after the link back", async () => {
    const { client, calls } = fakeServer(() => ({ body: { available: true, purchase: { order_id: "ord_1", status: "paid", costcoin: 500 } } }));
    const p = await fetchPurchase(client, "ord_1");
    assert.deepEqual(p, { available: true, value: { status: "paid", coins: 500 } });
    assert.match(calls[0].url, /\/v1\/pay\/purchase\/ord_1\?device_key=/);
  });
});

describe("payLink: XP, CosCoins and money look and read differently", () => {
  it("words each kind its own way", () => {
    assert.equal(coinsText(1200), "1,200 CosCoins");
    assert.equal(coinsText(1), "1 CosCoin");
    assert.equal(xpText(4500), "4,500 XP");
    assert.match(receiptText(500, "USD"), /USD|US\$/);
    assert.match(receiptText(500, "USD"), /5\.00/);
    assert.equal(signedCoins(-120), "−120");
    const colours = new Set([VALUE_STYLE.xp.color, VALUE_STYLE.coin.color, VALUE_STYLE.money.color]);
    assert.equal(colours.size, 3);
  });
  it("labels rows and statuses in plain words", () => {
    assert.equal(historyLabel({ id: "1", kind: "spend", delta: -5, label: null, at: "t", receipt_url: null }), "Spent in game");
    assert.equal(historyLabel({ id: "1", kind: "purchase", delta: 5, label: "Starter pack", at: "t", receipt_url: null }), "Starter pack");
    assert.equal(entryStatusText("pending"), "Processing");
    assert.equal(payoutStatusText("pending_review"), "Being reviewed");
    assert.equal(payoutStatusText("weird"), "Unknown");
    assert.equal(relativeDay("2026-11-13T09:00:00.123456Z", "en-GB"), "13 Nov 2026");
    assert.equal(relativeDay("junk"), "");
  });
});
