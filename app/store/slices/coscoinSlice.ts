// CosCoin state (the one wallet). The app: bundles, balance, history; the
// website: the top-up page. Live: "costcoin:credited" -> coinsCredited.
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { CosCoinBundle, RedeemedTopUp, TopUpOrder, WalletEntry } from "@/services/coscoin";

import { loadBundles, loadTopUpReturn, loadWallet, openTopUp, payTopUp, redeemTopUp } from "../thunks/coscoinThunks";

type Problem = { message: string; code: string | null } | null;

type CosCoinState = {
  bundles: CosCoinBundle[];
  priceVersion: string | null;
  bundlesStatus: "idle" | "loading" | "ready" | "error";
  wallet: { balance: number | null; frozen: boolean; history: WalletEntry[]; end: boolean; status: "idle" | "loading" | "ready" | "error"; error: Problem };
  topUp: { status: "idle" | "opening" | "error"; error: Problem };
  /** The last credit heard live (to show "500 CosCoin added"). */
  lastCredit: { added: number; at: number } | null;
  web: {
    status: "idle" | "redeeming" | "ready" | "paying" | "error";
    checkoutToken: string | null;
    expiresAt: string | null;
    member: RedeemedTopUp["member"] | null;
    bundle: CosCoinBundle | null;
    priceVersion: string | null;
    balance: number | null;
    error: Problem;
    order: TopUpOrder | null;
    returnStatus: "idle" | "loading" | "ready" | "error";
  };
};

const initialState: CosCoinState = {
  bundles: [],
  priceVersion: null,
  bundlesStatus: "idle",
  wallet: { balance: null, frozen: false, history: [], end: false, status: "idle", error: null },
  topUp: { status: "idle", error: null },
  lastCredit: null,
  web: { status: "idle", checkoutToken: null, expiresAt: null, member: null, bundle: null, priceVersion: null, balance: null, error: null, order: null, returnStatus: "idle" },
};

const slice = createSlice({
  name: "coscoin",
  initialState,
  reducers: {
    /** Socket "costcoin:credited": the wallet changed (a top-up landed). */
    coinsCredited(state, action: PayloadAction<{ added: number; balance: number | null }>) {
      if (action.payload.balance !== null && action.payload.balance !== undefined) state.wallet.balance = action.payload.balance;
      else if (state.wallet.balance !== null) state.wallet.balance += action.payload.added;
      state.lastCredit = { added: action.payload.added, at: Date.now() };
    },
    clearLastCredit(state) {
      state.lastCredit = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(loadBundles.pending, (s) => { s.bundlesStatus = "loading"; })
      .addCase(loadBundles.fulfilled, (s, a) => { s.bundlesStatus = "ready"; s.bundles = a.payload.bundles; s.priceVersion = a.payload.priceVersion; })
      .addCase(loadBundles.rejected, (s) => { s.bundlesStatus = "error"; })
      .addCase(loadWallet.pending, (s) => { s.wallet.status = "loading"; s.wallet.error = null; })
      .addCase(loadWallet.fulfilled, (s, a) => {
        s.wallet.status = "ready";
        s.wallet.balance = a.payload.balance;
        s.wallet.frozen = a.payload.frozen;
        s.wallet.history = a.payload.more ? [...s.wallet.history, ...a.payload.history] : a.payload.history;
        s.wallet.end = a.payload.history.length < 30;
      })
      .addCase(loadWallet.rejected, (s, a) => { s.wallet.status = "error"; s.wallet.error = (a.payload as Problem) || { message: "Couldn't load your wallet.", code: null }; })
      .addCase(openTopUp.pending, (s) => { s.topUp = { status: "opening", error: null }; })
      .addCase(openTopUp.fulfilled, (s) => { s.topUp = { status: "idle", error: null }; })
      .addCase(openTopUp.rejected, (s, a) => { s.topUp = { status: "error", error: (a.payload as Problem) || { message: "Couldn't open the website.", code: null } }; })
      .addCase(redeemTopUp.pending, (s) => { s.web.status = "redeeming"; s.web.error = null; })
      .addCase(redeemTopUp.fulfilled, (s, a) => {
        s.web = { ...s.web, status: "ready", checkoutToken: a.payload.checkoutToken, expiresAt: a.payload.expiresAt, member: a.payload.member, bundle: a.payload.bundle, priceVersion: a.payload.priceVersion, balance: a.payload.wallet.balance, error: null };
      })
      .addCase(redeemTopUp.rejected, (s, a) => { s.web.status = "error"; s.web.error = (a.payload as Problem) || { message: "This link can't be used.", code: null }; })
      .addCase(payTopUp.pending, (s) => { s.web.status = "paying"; s.web.error = null; })
      .addCase(payTopUp.fulfilled, (s) => { s.web.status = "paying"; })
      .addCase(payTopUp.rejected, (s, a) => { s.web.status = "ready"; s.web.error = (a.payload as Problem) || { message: "Couldn't open the payment page.", code: null }; })
      .addCase(loadTopUpReturn.pending, (s) => { s.web.returnStatus = "loading"; })
      .addCase(loadTopUpReturn.fulfilled, (s, a) => { s.web.returnStatus = "ready"; s.web.order = a.payload.order; s.web.balance = a.payload.wallet.balance; })
      .addCase(loadTopUpReturn.rejected, (s, a) => { s.web.returnStatus = "error"; s.web.error = (a.payload as Problem) || null; });
  },
});

export const { coinsCredited, clearLastCredit } = slice.actions;
export default slice.reducer;
