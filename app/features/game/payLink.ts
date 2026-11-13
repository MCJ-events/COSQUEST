// Payments, the app's side (payment brief of 12 Nov 2026, section 9 to Subomi:
// "Build the app-to-web handoff, deep link return, and server-driven checks for
// any paid action. The app must not calculate prizes, balances or eligibility
// itself. ... expose location permission and accuracy to the Eligibility
// Service."). Server side: costquest-backend app/pay_link.py (feature pay_link).
//
// What this file holds, all pure (tested in __tests__/payLink.test.ts):
//  - the wire: /v1/pay/config, /v1/pay/check, /v1/pay/handoff, /v1/pay/wallet,
//    /v1/pay/purchase/{id}, read defensively (anything odd is "not available");
//  - the location signals for the check (permission, precise or approximate,
//    accuracy, age, mocked, simulated), taken from the OS as they are;
//  - the deep link back: cosquest://wallet?from=payments&order=...&result=...;
//  - the words, and how the three kinds of value are told apart:
//      XP        earned by playing, never bought (purple, the XP coin)
//      CosCoin   in-game only, no cash value (gold, the coin)
//      money     real money, only ever a receipt for a quest entry (plain ink,
//                a currency code, "paid by card"); never a balance.
//
// Nothing here adds up a balance, works out a price or decides who may pay.
// Spelling: the brief says "Costcoin"; the app says "CosCoin" (left as it is).
import { GameError, type GameClient } from "./client.ts";
import { moneyText } from "./profile.ts";

// ---------- wire ----------

export type PayConfig = {
  /** The server has the payments website and a hand-off secret: show Manage purchases. */
  manage_purchases: boolean;
  payments_service: string;
  eligibility: string;
  note: string | null;
};

export type PaidAction = "buy_costcoin" | "paid_quest_entry";
export type CheckMoment = "view" | "checkout" | "quest_start";
export type LocationPermission = "granted" | "denied" | "unknown";
export type LocationPrecision = "precise" | "approximate" | "unknown";

export type PayCheck = {
  allowed: boolean;
  code: string;
  message: string;
  check_id: string | null;
  expires_at: string | null;
};

export type Handoff = { url: string; expires_at: string | null };

export type Part<T> = { available: true; value: T } | { available: false; reason: string };

export type HistoryRow = { id: string; kind: string; delta: number; label: string | null; at: string; receipt_url: string | null };
export type EntryRow = { id: string; quest_name: string | null; amount_minor: number; currency: string; status: string; at: string; receipt_url: string | null };
export type PayoutRow = { id: string; quest_name: string | null; status: string; at: string };

export type Wallet = {
  service: string;
  balance: Part<{ coins: number; as_of: string | null; frozen: boolean }>;
  history: Part<HistoryRow[]>;
  entries: Part<EntryRow[]>;
  payouts: Part<PayoutRow[]>;
};

export type Purchase = Part<{ status: string; coins: number | null }>;

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const https = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s/]+/i.test(v) ? v : null);

export function parsePayConfig(raw: unknown): PayConfig {
  const r = obj(raw) ?? {};
  return {
    manage_purchases: r.manage_purchases === true,
    payments_service: str(r.payments_service) ?? "unknown",
    eligibility: str(r.eligibility) ?? "unknown",
    note: str(r.note),
  };
}

export function parseCheck(raw: unknown): PayCheck {
  const r = obj(raw) ?? {};
  // Allowed only when the server said so in so many words (fail closed here too).
  const allowed = r.allowed === true && r.decision === "allow";
  return {
    allowed,
    code: str(r.code) ?? (allowed ? "allowed" : "eligibility_unsure"),
    message: str(r.message) ?? (allowed ? "" : NOT_NOW),
    check_id: str(r.check_id),
    expires_at: str(r.expires_at),
  };
}

function part<T>(raw: unknown, key: string, read: (v: unknown) => T | null): Part<T> {
  const r = obj(raw);
  if (!r || r.available !== true) return { available: false, reason: str(r?.reason) ?? "not_available" };
  const value = read(r[key]);
  return value === null ? { available: false, reason: "bad_answer" } : { available: true, value };
}

function list<T>(read: (v: unknown) => T | null): (v: unknown) => T[] | null {
  return (v) => (Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : null);
}

function historyRow(v: unknown): HistoryRow | null {
  const r = obj(v);
  const delta = int(r?.delta);
  if (!r || delta === null || !str(r.id) || !str(r.at)) return null;
  return { id: r.id as string, kind: str(r.kind) ?? "other", delta, label: str(r.label), at: r.at as string, receipt_url: https(r.receipt_url) };
}

function entryRow(v: unknown): EntryRow | null {
  const r = obj(v);
  const amount = int(r?.amount_minor);
  if (!r || amount === null || amount < 0 || !str(r.id) || !str(r.at) || !/^[A-Z]{3}$/.test(String(r.currency))) return null;
  return { id: r.id as string, quest_name: str(r.quest_name), amount_minor: amount, currency: r.currency as string, status: str(r.status) ?? "other", at: r.at as string, receipt_url: https(r.receipt_url) };
}

function payoutRow(v: unknown): PayoutRow | null {
  const r = obj(v);
  if (!r || !str(r.id) || !str(r.at)) return null;
  // status only: the wallet never shows an amount of cash
  return { id: r.id as string, quest_name: str(r.quest_name), status: str(r.status) ?? "other", at: r.at as string };
}

export function parseWallet(raw: unknown): Wallet {
  const r = obj(raw) ?? {};
  return {
    service: str(r.service) ?? "unknown",
    balance: part(r.costcoin, "balance", (v) => {
      const b = obj(v);
      const coins = int(b?.balance);
      if (!b || coins === null || coins < 0) return null;
      return { coins, as_of: str(b.as_of), frozen: b.frozen === true };
    }),
    history: part(r.history, "items", list(historyRow)),
    entries: part(r.quest_entries, "items", list(entryRow)),
    payouts: part(r.payouts, "items", list(payoutRow)),
  };
}

export function parsePurchase(raw: unknown): Purchase {
  return part(raw, "purchase", (v) => {
    const p = obj(v);
    const status = str(p?.status);
    if (!p || !status) return null;
    const coins = int(p.costcoin);
    return { status, coins: coins !== null && coins >= 0 ? coins : null };
  });
}

// ---------- the phone's location, for the check ----------

/** expo-location's permission answer, only the parts that matter here. */
export type OsPermission = {
  status?: string | null;
  granted?: boolean | null;
  ios?: { accuracy?: string | null; scope?: string | null } | null;
  android?: { accuracy?: string | null } | null;
};

export function permissionOf(p: OsPermission | null | undefined): LocationPermission {
  if (!p) return "unknown";
  if (p.status === "granted" || p.granted === true) return "granted";
  if (p.status === "denied") return "denied";
  return "unknown";
}

/** iOS "full" or "reduced" (Precise Location off); Android "fine" or "coarse". */
export function precisionOf(p: OsPermission | null | undefined): LocationPrecision {
  if (!p || permissionOf(p) !== "granted") return "unknown";
  const a = (p.ios?.accuracy ?? p.android?.accuracy ?? "").toLowerCase();
  if (a === "full" || a === "fine") return "precise";
  if (a === "reduced" || a === "coarse") return "approximate";
  return "unknown";
}

export type FixLike = { lat: number; lng: number; accuracy: number; at: number; mocked?: boolean | null; simulated?: boolean | null };

/** The signals sent with every check: what the OS said, as it said it. Nothing is judged here. */
export function locationSignals(fix: FixLike | null | undefined, perm: OsPermission | null | undefined, now: number) {
  const permission = permissionOf(perm);
  const out: Record<string, unknown> = { location_permission: permission, location_precision: precisionOf(perm) };
  if (permission === "granted" && fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)) {
    out.lat = fix.lat;
    out.lng = fix.lng;
    if (Number.isFinite(fix.accuracy) && fix.accuracy >= 0) out.accuracy_m = Math.min(100000, fix.accuracy);
    if (Number.isFinite(fix.at) && fix.at > 0) out.fix_age_s = Math.round(Math.max(0, now - fix.at) / 100) / 10;
    if (typeof fix.mocked === "boolean") out.mocked = fix.mocked;
    if (typeof fix.simulated === "boolean") out.simulated = fix.simulated;
  }
  return out;
}

/** "en-GB" -> "GB"; null when the tag names no region. A weak signal only. */
export function regionOf(tag: string | null | undefined): string | null {
  const m = (tag ?? "").match(/^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2})(?:[-_]|$)/);
  return m ? m[1].toUpperCase() : null;
}

// ---------- the deep link back ----------

export const WALLET_LINK = "cosquest://wallet";

/** cosquest://wallet?from=payments&order=...&result=success|cancel|done, or null for any other link. */
export function parseWalletReturn(url: string): { fromPayments: boolean; order: string | null; result: string | null } | null {
  const m = url.match(/^cosquest:\/\/wallet\/?(?:\?([^#]*))?/i);
  if (!m) return null;
  const q = new Map<string, string>();
  for (const pair of (m[1] ?? "").split("&")) {
    if (!pair) continue;
    const [k, v = ""] = pair.split("=");
    try {
      q.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, " ")));
    } catch {
      q.set(k, v);
    }
  }
  const order = q.get("order") ?? null;
  return {
    fromPayments: q.get("from") === "payments",
    order: order && /^[A-Za-z0-9_.:-]{1,128}$/.test(order) ? order : null,
    result: q.get("result") ?? null,
  };
}

// ---------- the routes ----------

/** Null when the server has no payments (feature off: 404), so the app shows nothing payment-shaped. */
export async function fetchPayConfig(client: GameClient): Promise<PayConfig | null> {
  try {
    return parsePayConfig(await client.retrying(() => client.request<unknown>("GET", "v1/pay/config")));
  } catch (e) {
    if (e instanceof GameError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Ask the server before any paid action. Anything but its clear yes (an
 * error, a feature that is off, no answer) comes back as not allowed.
 */
export async function paidActionCheck(
  client: GameClient,
  input: { action: PaidAction; moment?: CheckMoment; questId?: string | null; payWith?: "card" | "costcoin"; signals: Record<string, unknown>; region?: string | null },
): Promise<PayCheck> {
  const body: Record<string, unknown> = {
    device_key: client.deviceKey(),
    action: input.action,
    moment: input.moment ?? "checkout",
    ...input.signals,
  };
  if (input.questId) body.quest_id = input.questId;
  if (input.payWith) body.pay_with = input.payWith;
  if (input.region) body.device_region = input.region;
  try {
    return parseCheck(await client.request<unknown>("POST", "v1/pay/check", { body, signed: true }));
  } catch (e) {
    const message = e instanceof GameError && e.status === 404 ? NOT_NOW : e instanceof GameError && e.kind === "network" ? OFFLINE : NOT_NOW;
    return { allowed: false, code: "unavailable", message, check_id: null, expires_at: null };
  }
}

/** The one-time link to the payments website (the token is on it). Only https is opened. */
export async function startHandoff(client: GameClient, checkId: string): Promise<Handoff> {
  const raw = await client.request<Record<string, unknown>>("POST", "v1/pay/handoff", {
    body: { device_key: client.deviceKey(), purpose: "manage_purchases", check_id: checkId },
    signed: true,
  });
  const url = https(raw?.url);
  if (!url) throw new GameError("decoding", "The server sent something unexpected.");
  return { url, expires_at: str(raw.expires_at) };
}

export async function fetchWallet(client: GameClient): Promise<Wallet> {
  const key = client.deviceKey();
  return parseWallet(await client.retrying(() => client.request<unknown>("GET", "v1/pay/wallet", { query: { device_key: key }, signed: true })));
}

export async function fetchPurchase(client: GameClient, orderId: string): Promise<Purchase> {
  const key = client.deviceKey();
  return parsePurchase(await client.request<unknown>("GET", `v1/pay/purchase/${encodeURIComponent(orderId)}`, { query: { device_key: key }, signed: true }));
}

// ---------- the words ----------

export const NOT_NOW = "Purchases and paid quests aren't available right now.";
export const OFFLINE = "Can't reach CosQuest right now.";
export const NOT_CONNECTED = "Purchases aren't connected yet.";
export const NO_CASH_NOTE = "CosCoins are for use in CosQuest. They have no cash value and can't be withdrawn. XP is earned by playing and can't be bought.";

/** The three kinds of value, each with its own look (the brief: "clearly different in the UI"). */
export const VALUE_STYLE = {
  xp: { label: "XP", color: "#6A3FD0", tint: "#EEE8FB", note: "Earned by playing. Can't be bought." },
  coin: { label: "CosCoin", color: "#9A6A00", tint: "#FFF4D6", note: "In-game only. No cash value." },
  money: { label: "Paid by card", color: "#28424E", tint: "#FFFFFF", note: "Real money, shown as a receipt only." },
} as const;

export function coinsText(n: number): string {
  return `${grouped(n)} CosCoin${n === 1 ? "" : "s"}`;
}

export function xpText(n: number): string {
  return `${grouped(n)} XP`;
}

/** A receipt in real money: the currency is always named, so it is never read as CosCoins. */
export function receiptText(minor: number, currency: string): string {
  const shown = moneyText(minor, currency);
  return shown.includes(currency) ? shown : `${shown} ${currency}`;
}

export function signedCoins(delta: number): string {
  return delta >= 0 ? `+${grouped(delta)}` : `−${grouped(-delta)}`;
}

export function historyLabel(row: HistoryRow): string {
  if (row.label) return row.label;
  switch (row.kind) {
    case "purchase":
      return "Bought CosCoins";
    case "spend":
      return "Spent in game";
    case "refund":
      return "Refund";
    case "chargeback":
      return "Payment reversed";
    case "grant":
      return "From CosQuest";
    case "reversal":
      return "Correction";
    default:
      return "CosCoins";
  }
}

export function entryStatusText(status: string): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "pending":
      return "Processing";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Didn't go through";
    default:
      return "Unknown";
  }
}

export function payoutStatusText(status: string): string {
  switch (status) {
    case "pending_review":
      return "Being reviewed";
    case "approved":
      return "Approved";
    case "queued":
      return "On its way";
    case "paid":
      return "Paid out";
    case "held":
      return "On hold";
    case "failed":
      return "Didn't go through";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function purchaseStatusText(status: string): string {
  switch (status) {
    case "paid":
      return "Payment received. Your CosCoins are in.";
    case "created":
    case "pending":
      return "Payment is still being confirmed.";
    case "failed":
      return "The payment didn't go through.";
    case "expired":
      return "That checkout ran out of time.";
    case "refunded":
      return "That purchase was refunded.";
    case "disputed":
      return "That purchase is being disputed.";
    default:
      return "";
  }
}

/** "13 Nov 2026" in the phone's language; "" for a date it cannot read. */
export function relativeDay(iso: string, locale?: string): string {
  const t = Date.parse(iso.replace(/(\.\d{3})\d+/, "$1"));
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(t);
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** Why a part of the wallet is empty, in words. */
export function unavailableText(reason: string): string {
  if (reason === "not_configured") return NOT_CONNECTED;
  if (reason === "unreachable") return "Couldn't load this right now.";
  return "Not available right now.";
}

function grouped(n: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${out}` : out;
}
