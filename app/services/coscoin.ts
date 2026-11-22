// ==========================================
// COSCOIN: the one wallet (meeting 19 Nov: payments on the web only)
// ==========================================
// Apps and games show the balance and history and spend coins; buying (topping
// up) happens only on the CosQuest website: the app asks for a 20-minute link
// and opens /checkout/coscoin, which pays on Stripe's page. The server credits
// the wallet once (Stripe's signed webhook) and tells the app ("costcoin:credited").
// Server: cosquest-backend/src/utils/costcoin.js, /api/costcoin/*.
import { TicketError } from "./tickets";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

async function request<T>(path: string, { method = "GET", body, token }: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TicketError("No connection. Check your internet and try again - you won't be charged twice.", 0, "offline");
  }
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw new TicketError(data?.error || "Something went wrong. Please try again.", response.status, data?.code, data);
  return data as T;
}

/** A CosCoin bundle on sale (the approved price table). */
export type CosCoinBundle = { id: string; name: string; priceCents: number; costcoin: number; costcoinPerDollar?: number | null; status: "active" | "open"; note?: string };
export type WalletEntry = { id: string; type: string; amount: number; itemId: string | null; description: string; at: string };
export type Wallet = { balance: number; frozen: boolean; frozenReason?: string | null };
export type TopUpOrder = { id: string; number: string; bundleId: string; bundleName: string; costcoin: number; priceCents: number; priceVersion: string; status: "pending" | "paid" | "expired" | "failed" | "refunded"; checkoutUrl: string | null; paidAt: string | null; createdAt: string };

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const coins = (n: number) => `${n.toLocaleString("en-US")} CosCoin`;

// ---------- the app ----------
export const getBundles = () => request<{ priceVersion: string | null; bundles: CosCoinBundle[] }>("/api/costcoin/bundles");
export const getWallet = (token: string, offset = 0) => request<Wallet & { history: WalletEntry[]; offset: number }>(`/api/costcoin/wallet?offset=${offset}`, { token });
/** The 20-minute link to the website's top-up page for one bundle (18+). */
export const requestTopUpLink = (bundleId: string, token: string) => request<{ url: string; expiresAt: string }>("/api/costcoin/handoff", { method: "POST", token, body: { bundleId } });

/** What CosCoin can buy here (owned = how many I have). */
export type CosCoinItem = { id: string; name: string; kind: string; priceCosCoin: number; stackable: boolean; game: string; owned: number };
export const getItems = (token: string, game?: string) => request<{ catalogVersion: string | null; items: CosCoinItem[] }>(`/api/costcoin/items${game ? `?game=${game}` : ""}`, { token });
/** Spend: key = a new random id per tap (a retry with the same key never charges twice). 402 not_enough_coins -> "Top up on the web". */
export const spendCosCoin = (token: string, itemId: string, key: string, game?: string) =>
  request<{ spent: number; item: { id: string }; balance: number; transaction: string | null; replay: boolean }>("/api/costcoin/spend", { method: "POST", token, body: { itemId, key, game } });
export const getInventory = (token: string) => request<{ items: { itemId: string; kind: string; quantity: number }[] }>("/api/costcoin/inventory", { token });

// ---------- the website ----------
export type RedeemedTopUp = { checkoutToken: string; expiresAt: string; member: { name: string; username: string | null }; bundle: CosCoinBundle; priceVersion: string; wallet: Wallet };
export const redeemTopUpLink = (h: string) => request<RedeemedTopUp>("/api/costcoin/handoff/redeem", { method: "POST", body: { h } });
export const startTopUp = (checkoutToken: string) => request<{ order: TopUpOrder; checkoutUrl: string | null }>("/api/costcoin/checkout", { method: "POST", token: checkoutToken, body: {} });
export const getTopUpOrder = (checkoutToken: string, orderId: string) => request<{ order: TopUpOrder; wallet: Wallet }>(`/api/costcoin/orders/${orderId}`, { token: checkoutToken });
