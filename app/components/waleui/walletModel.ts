// The wallet and the hand-off, wired to the phone (features/game/payLink.ts is
// the pure, tested part; this is the glue: expo-location for the permission and
// the fix, expo-web-browser for the payments website, the game's one store).
//
// The flow (payment brief, section 5, "Flow for buying Costcoin"):
//   Manage purchases -> /v1/pay/check (buy_costcoin, with the phone's location
//   signals) -> allowed? -> /v1/pay/handoff -> the website opens with the token
//   -> the player comes back by cosquest://wallet?from=payments&order=...
//   (app/wallet.tsx) or closes the browser -> the wallet and the Home pill are
//   asked of the server again. Nothing here works out a balance.
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import { useSyncExternalStore } from "react";

import {
  fetchPayConfig,
  fetchPurchase,
  fetchWallet,
  locationSignals,
  NOT_NOW,
  OFFLINE,
  type CheckMoment,
  type OsPermission,
  type PayCheck,
  type PayConfig,
  paidActionCheck,
  purchaseStatusText,
  regionOf,
  startHandoff,
  type Wallet,
} from "@/features/game/payLink";
import { gameStore, refreshFix, startLocation } from "@/features/game/runtime";

export type WalletState = {
  /** null: the server has no payments (feature off) or it has not answered yet. */
  config: PayConfig | null;
  wallet: Wallet | null;
  loading: boolean;
  /** Opening the website. */
  busy: boolean;
  /** A line under the button: a refusal, or what happened to the last purchase. */
  notice: string | null;
  error: string | null;
};

let state: WalletState = { config: null, wallet: null, loading: false, busy: false, notice: null, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useWallet(): WalletState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

// A different player (sign-out, sign-in): forget the last one's wallet.
let lastKey: string | null = null;
gameStore.subscribe(() => {
  const key = gameStore.get().session?.playerKey ?? null;
  if (key === lastKey) return;
  lastKey = key;
  state = { config: null, wallet: null, loading: false, busy: false, notice: null, error: null };
  listeners.forEach((l) => l());
});

/** Ask the server again: config, wallet, and the game's own numbers (the Home pill). */
export async function refreshWallet(): Promise<void> {
  set({ loading: true, error: null });
  try {
    const config = await fetchPayConfig(gameStore.client);
    const wallet = config ? await fetchWallet(gameStore.client) : null;
    set({ config, wallet, loading: false });
  } catch {
    set({ loading: false, error: OFFLINE });
  }
  void gameStore.refreshMe().catch(() => {});
}

async function osPermission(ask: boolean): Promise<OsPermission | null> {
  try {
    if (ask) await startLocation(true);
    return (await Location.getForegroundPermissionsAsync()) as OsPermission;
  } catch {
    return null;
  }
}

function deviceRegion(): string | null {
  try {
    return regionOf(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

/**
 * The check before any paid action, with the phone's location as the OS gives
 * it. A paid quest asks for location (the system prompt if never asked) and a
 * fresh fix; buying CosCoins sends what the phone already has. Anything but the
 * server's clear yes is not allowed.
 */
export async function checkPaidAction(input: { action: "buy_costcoin" | "paid_quest_entry"; moment?: CheckMoment; questId?: string | null }): Promise<PayCheck> {
  const quest = input.action === "paid_quest_entry";
  const perm = await osPermission(quest);
  const fix = perm?.granted ? ((quest ? await refreshFix() : null) ?? gameStore.get().fix) : null;
  return paidActionCheck(gameStore.client, {
    action: input.action,
    moment: input.moment,
    questId: input.questId,
    payWith: "card",
    signals: locationSignals(fix, perm, Date.now()),
    region: deviceRegion(),
  });
}

/** Manage purchases: check, get the one-time link, open the website, and ask again when it closes. */
export async function manageNow(): Promise<void> {
  if (state.busy) return;
  set({ busy: true, notice: null });
  try {
    const check = await checkPaidAction({ action: "buy_costcoin", moment: "checkout" });
    if (!check.allowed || !check.check_id) {
      set({ busy: false, notice: check.message || NOT_NOW });
      return;
    }
    const handoff = await startHandoff(gameStore.client, check.check_id);
    set({ busy: false });
    try {
      await WebBrowser.openBrowserAsync(handoff.url, { dismissButtonStyle: "close", showTitle: true });
    } catch {
      // No browser: nothing was opened, the wallet is asked again below anyway.
    }
    await refreshWallet();
  } catch {
    set({ busy: false, notice: NOT_NOW });
  }
}

/** app/wallet.tsx: the link back from the website (params as expo-router gives them). */
export async function handleWalletReturn(params: Record<string, string | string[] | undefined>): Promise<void> {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  if (one(params.from) !== "payments") return refreshWallet();
  try {
    WebBrowser.dismissBrowser();
  } catch {
    // Nothing was open.
  }
  const order = one(params.order);
  const result = one(params.result);
  if (result === "cancel") set({ notice: "No purchase was made." });
  if (order && /^[A-Za-z0-9_.:-]{1,128}$/.test(order) && result !== "cancel") {
    try {
      const p = await fetchPurchase(gameStore.client, order);
      set({ notice: p.available ? purchaseStatusText(p.value.status) || null : "We'll show your purchase here once it's confirmed." });
    } catch {
      set({ notice: "We'll show your purchase here once it's confirmed." });
    }
  }
  await refreshWallet();
}
