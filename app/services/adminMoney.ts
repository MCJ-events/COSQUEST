// Money admin: the ledger, regions (paid quests) and two-person approvals.
// Backend: ledger-backend (LEDGER.md).
import { adminRequest } from "./admin";

/** account: the chart code (e.g. 2010:<questId>); label: "2010 Quest Pool Glam zone". */
export type LedgerLine = { account: string; label?: string; debit: number; credit: number };
export type LedgerTx = {
  id: string;
  number: string;
  kind: string;
  /** Finance's words: "Quest entry", "Processor fee", "Payout"... */
  type?: string;
  status?: string;
  itemId?: string | null;
  formulaVersion?: string | null;
  approvedBy?: string[];
  linkedTx?: string | null;
  book: "money" | "costcoin";
  currency: string;
  lines: LedgerLine[];
  total: number;
  order: string | null;
  quest: string | null;
  user: string | null;
  processorRef: string | null;
  memo: string;
  reverses: string | null;
  createdAt: string;
};
export type LedgerCheck = {
  ok: boolean;
  books: { book: string; currency: string; debits: number; credits: number; transactions: number; balanced: boolean }[];
  /** Finance's checks: pass null = not applicable yet. */
  checks?: { name: string; pass: boolean | null; detail: string | number }[];
  checkedAt: string;
};
export type AccountBalance = { account: string; book: string; currency: string; debits: number; credits: number; balance: number };
export type RegionStatus = "allowed" | "blocked" | "needs_license";
export type RegionRule = { region: string; name: string; status: RegionStatus; note: string; updatedAt: string };
export type ApprovalStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type ApprovalRequest = {
  id: string;
  number: string;
  kind: string;
  title: string;
  /** Region rules: a list; money settings: { platformShareBps, payoutApprovalLimitCents, note }. */
  changes: { region: string; name: string; status: RegionStatus; note: string }[] | PaymentSettingsChange | { bundles: PriceBundle[] } | { items: CatalogItem[] } | { transactionId: string; number: string; type: string; book: string; currency: string; total: number };
  reason: string;
  status: ApprovalStatus;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  decisionNote: string;
  decidedAt: string | null;
  createdAt: string;
};

const qs = (params: Record<string, string | number | undefined | null>) => {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export const listLedger = (filters: { book?: string; kind?: string; account?: string; offset?: number }) =>
  adminRequest<{ transactions: LedgerTx[]; total: number; offset: number; pageSize: number }>(`/ledger/transactions${qs(filters)}`);
export const getLedgerCheck = () => adminRequest<LedgerCheck>("/ledger/check");
export const getBalances = (book: string, prefix?: string) => adminRequest<{ balances: AccountBalance[] }>(`/ledger/balances${qs({ book, prefix })}`);
/** Asks for a correction (reversal): recorded only once a second person approves it. */
export const reverseTx = (txId: string, reason: string) => adminRequest<{ request: { id: string; number: string; title: string }; auditEvent: string }>(`/ledger/transactions/${txId}/reverse`, { method: "POST", body: { reason } });
export const getRegions = () => adminRequest<{ mode: "test" | "live"; regions: RegionRule[] }>("/regions");
/** Money settings (finance's "Assumptions"). null = OPEN (not decided). */
export type PaymentSettings = { formulaVersion: string | null; platformShareBps: number | null; winnerShareBps: number | null; payoutApprovalLimitCents: number | null; note: string; approvedAt: string | null };
export type PaymentSettingsChange = { platformShareBps: number | null; payoutApprovalLimitCents: number | null; note?: string };
export const getPaymentSettings = () => adminRequest<{ current: PaymentSettings; history: PaymentSettings[] }>("/payment-settings");
export const requestPaymentSettings = (body: { platformSharePercent: string; payoutApprovalLimitDollars: string; reason: string; note?: string }) =>
  adminRequest<{ request: { id: string; number: string; title: string }; auditEvent: string }>("/payment-settings/requests", { method: "POST", body });

/** The CosCoin price table (finance's "Price Table"). status open = not decided, never sold. */
export type PriceBundle = { id: string; name: string; priceCents: number; costcoin: number | null; costcoinPerDollar?: number | null; status: "active" | "open"; note: string };
export type PriceTable = { priceVersion: string | null; bundles: PriceBundle[]; approvedAt: string | null };
export const getPriceTable = () => adminRequest<{ current: PriceTable; history: PriceTable[] }>("/price-table");
export const requestPriceTable = (bundles: { id: string; name: string; price: string; costcoin: string; status: "active" | "open"; note?: string }[], reason: string) =>
  adminRequest<{ request: { id: string; number: string; title: string }; auditEvent: string }>("/price-table/requests", { method: "POST", body: { bundles, reason } });

/** What CosCoin can buy (never quest entry, XP or cash). status open = not decided, never sold. */
export type CatalogItem = { id: string; name: string; kind: string; priceCosCoin: number | null; stackable: boolean; game: string; status: "active" | "open"; note?: string };
export type ItemCatalog = { catalogVersion: string | null; items: CatalogItem[]; approvedAt: string | null };
export const getItemCatalog = () => adminRequest<{ current: ItemCatalog; history: ItemCatalog[]; kinds: string[]; games: string[] }>("/item-catalog");
export const requestItemCatalog = (items: { id: string; name: string; kind: string; priceCosCoin: string; game: string; status: "active" | "open" }[], reason: string) =>
  adminRequest<{ request: { id: string; number: string; title: string }; auditEvent: string }>("/item-catalog/requests", { method: "POST", body: { items, reason } });

/** A card dispute (chargeback) from Stripe. */
export type AdminDispute = { id: string; stripeDisputeId: string; amount: number; currency: string; reason: string; status: string; outcome: "open" | "won" | "lost"; paymentType: "ticket" | "coscoin" | "unknown"; orderLabel: string | null; member: string | null; walletFrozen: boolean; evidenceDueBy: string | null; openedAt: string; closedAt: string | null };
export const getDisputes = () => adminRequest<{ disputes: AdminDispute[] }>("/disputes");
export const unfreezeDisputeWallet = (id: string, reason: string) => adminRequest<{ dispute: AdminDispute; auditEvent: string }>(`/disputes/${id}/unfreeze`, { method: "POST", body: { reason } });

/** One day of the daily check against Stripe's records. */
export type StripeCheckDay = { day: string; ok: boolean; problems: { kind: string; ref: string; detail: string }[]; totals: { stripe?: { payments: number; received: number; fees: number; refunds: number; disputes: number; payoutsToBank: number }; ledger?: { sales: number; received: number } }; error: string | null; ranAt: string };
export const getStripeCheck = () => adminRequest<{ days: StripeCheckDay[] }>("/ledger/stripe-check");
export const runStripeCheck = (day: string) => adminRequest<StripeCheckDay>("/ledger/stripe-check/run", { method: "POST", body: { day } });

export const requestRegionChanges = (changes: { region: string; name?: string; status: RegionStatus; note?: string }[], reason: string) =>
  adminRequest<{ request: ApprovalRequest; auditEvent: string }>("/regions/requests", { method: "POST", body: { changes, reason } });
export const listApprovals = (status: ApprovalStatus) => adminRequest<{ requests: ApprovalRequest[]; pending: number; me: string }>(`/approvals${qs({ status })}`);
export const decideApproval = (id: string, approve: boolean, note: string) =>
  adminRequest<{ request: ApprovalRequest; auditEvent: string }>(`/approvals/${id}/${approve ? "approve" : "reject"}`, { method: "POST", body: { note } });
export const withdrawApproval = (id: string) => adminRequest<{ request: ApprovalRequest }>(`/approvals/${id}/withdraw`, { method: "POST" });

/** The ledger as a CSV file (one row per line), for the finance spreadsheets. */
export async function downloadLedgerCsv(book: string) {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem("cq_admin_session") : null;
  const token = raw ? JSON.parse(raw).token : null;
  const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/admin/ledger/export${qs({ book })}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Couldn't export the ledger.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cosquest-ledger-${book}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Cents (or whole CosCoin) for display. */
export const amount = (minor: number, currency: string) =>
  currency === "CQC" ? `${minor.toLocaleString("en-US")} CosCoin` : `${(minor / 100).toLocaleString("en-US", { style: "currency", currency })}`;
