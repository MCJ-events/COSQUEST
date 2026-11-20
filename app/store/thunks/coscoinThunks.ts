// CosCoin (services/coscoin.ts):
//   The app:      loadBundles, loadWallet, openTopUp (the website, never a payment in the app)
//   The website:  redeemTopUp (the link, once), payTopUp (Stripe's page), loadTopUpReturn
import { createAsyncThunk } from "@reduxjs/toolkit";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { getBundles, getTopUpOrder, getWallet, redeemTopUpLink, requestTopUpLink, startTopUp } from "@/services/coscoin";
import type { TicketError } from "@/services/tickets";

import type { RootState } from "../store";

const PASS_KEY = "cq_coscoin_pass";
type SavedPass = { token: string; expiresAt: string };

export function savedTopUpPass(): SavedPass | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(PASS_KEY) || "null") as SavedPass | null;
    return saved && new Date(saved.expiresAt).getTime() > Date.now() ? saved : null;
  } catch {
    return null;
  }
}

function savePass(pass: SavedPass | null) {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    if (pass) window.sessionStorage.setItem(PASS_KEY, JSON.stringify(pass));
    else window.sessionStorage.removeItem(PASS_KEY);
  } catch {}
}

export const problem = (e: unknown) => {
  const err = e as TicketError;
  return { message: err?.message || "Something went wrong. Please try again.", code: (err as any)?.code || null };
};

// ---------- the app ----------

export const loadBundles = createAsyncThunk("coscoin/loadBundles", async (_: void, { rejectWithValue }) => {
  try {
    return await getBundles();
  } catch (e) {
    return rejectWithValue(problem(e));
  }
});

export const loadWallet = createAsyncThunk("coscoin/loadWallet", async ({ token, more = false }: { token: string; more?: boolean }, { getState, rejectWithValue }) => {
  try {
    const offset = more ? (getState() as RootState).coscoin.wallet.history.length : 0;
    return { ...(await getWallet(token, offset)), more };
  } catch (e) {
    return rejectWithValue(problem(e));
  }
});

/** Top up on the website (meeting 19 Nov: payments on the web only). */
export const openTopUp = createAsyncThunk("coscoin/openTopUp", async ({ bundleId, token }: { bundleId: string; token: string }, { rejectWithValue }) => {
  try {
    const link = await requestTopUpLink(bundleId, token);
    if (Platform.OS === "web") {
      window.location.assign(link.url);
      return { closed: false };
    }
    await WebBrowser.openBrowserAsync(link.url, { dismissButtonStyle: "close", presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
    return { closed: true };
  } catch (e) {
    return rejectWithValue(problem(e));
  }
});

// ---------- the website ----------

export const redeemTopUp = createAsyncThunk("coscoin/redeemTopUp", async ({ h }: { h: string }, { rejectWithValue }) => {
  try {
    const result = await redeemTopUpLink(h);
    savePass({ token: result.checkoutToken, expiresAt: result.expiresAt });
    return result;
  } catch (e) {
    return rejectWithValue(problem(e));
  }
});

export const payTopUp = createAsyncThunk<{ orderId: string }, void, { state: RootState; rejectValue: ReturnType<typeof problem> }>("coscoin/payTopUp", async (_, { getState, rejectWithValue }) => {
  const pass = getState().coscoin.web.checkoutToken || savedTopUpPass()?.token;
  if (!pass) return rejectWithValue({ message: "This checkout has closed. Go back to CosQuest and tap Top up again.", code: "checkout_expired" });
  try {
    const started = await startTopUp(pass);
    if (started.checkoutUrl && typeof window !== "undefined") window.location.assign(started.checkoutUrl);
    return { orderId: started.order.id };
  } catch (e) {
    return rejectWithValue(problem(e));
  }
});

export const loadTopUpReturn = createAsyncThunk("coscoin/loadTopUpReturn", async ({ orderId }: { orderId: string }, { rejectWithValue }) => {
  const pass = savedTopUpPass();
  if (!pass) return rejectWithValue({ message: "Your top-up is being finished. Open CosQuest to see your balance.", code: "pass_gone" });
  try {
    return await getTopUpOrder(pass.token, orderId);
  } catch (e) {
    return rejectWithValue(problem(e));
  }
});
