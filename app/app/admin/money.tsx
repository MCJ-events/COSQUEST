// ==========================================
// SUPER ADMIN - Ledger & approvals (payment brief 6.1, 6.4, 6.6)
// ==========================================
// Ledger: every money movement, double-entry and append-only; the books check
// (debits = credits); corrections are reversals (never edits); CSV export.
// Regions: where paid quests are allowed (US states); changes are requests.
// Approvals: money settings change only when a SECOND admin approves.
// Finance approvers (the second person) see the ledger, regions and
// approvals, and approve or reject; they can't request or correct anything.
// Approvers (super admins): who the finance approvers are.
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";

import { ConfirmBox, Field, ReasonBox, Select, Tabs } from "@/components/admin/controls";
import { useAdminTheme } from "@/components/admin/theme";
import { Button, Card, CardHeader, Loading, Notice, PageHeader, Pill } from "@/components/admin/ui";
import { FONTS } from "@/constants/fonts";
import { type FinanceApprover, addFinanceApprover, listFinanceApprovers, removeFinanceApprover, useAdminRole } from "@/services/adminFinance";
import {
  type ApprovalRequest,
  type ApprovalStatus,
  type LedgerCheck,
  type LedgerTx,
  type RegionRule,
  type RegionStatus,
  amount,
  decideApproval,
  downloadLedgerCsv,
  getLedgerCheck,
  getRegions,
  listApprovals,
  listLedger,
  requestRegionChanges,
  reverseTx,
  withdrawApproval,
  type PaymentSettings,
  type PriceTable,
  type ItemCatalog,
  type AdminDispute,
  type AdminWallet,
  type AdminRules,
  getAdminRules,
  requestAdjustment,
  type AdminPrize,
  getPrizes,
  verifyPrize,
  rejectPrize,
  requestPrizePayout,
  markPrizePaid,
  downloadPrizesCsv,
  requestRules,
  getWallets,
  freezeWallet,
  unfreezeWallet,
  type StripeCheckDay,
  getStripeCheck,
  runStripeCheck,
  getDisputes,
  unfreezeDisputeWallet,
  getItemCatalog,
  requestItemCatalog,
  getPriceTable,
  requestPriceTable,
  getPaymentSettings,
  requestPaymentSettings,
} from "@/services/adminMoney";

type TabKey = "ledger" | "regions" | "settings" | "prices" | "items" | "disputes" | "wallets" | "rules" | "payouts" | "approvals" | "approvers";
const STATUS_LABEL: Record<RegionStatus, string> = { allowed: "Allowed", blocked: "Blocked", needs_license: "Needs licence" };
const STATUS_TONE: Record<RegionStatus, "green" | "red" | "amber"> = { allowed: "green", blocked: "red", needs_license: "amber" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function MoneyAdmin() {
  const role = useAdminRole();
  const finance = role === "finance";
  const [tab, setTab] = useState<TabKey>("ledger");
  // A finance approver arrives for the approvals.
  useEffect(() => {
    if (finance) setTab("approvals");
  }, [finance]);
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    listApprovals("pending").then((r) => setPending(r.pending)).catch(() => setPending(null));
  }, [tab]);
  return (
    <View style={{ gap: 20 }}>
      <PageHeader title="Ledger & approvals" subtitle="Every money movement, where paid quests are allowed, and changes waiting for a second admin." />
      <Tabs<TabKey>
        tabs={[
          { key: "ledger", label: "Ledger" },
          { key: "regions", label: "Regions" },
          { key: "settings", label: "Settings" },
          { key: "prices", label: "Prices" },
          { key: "items", label: "Items" },
          { key: "disputes", label: "Disputes" },
          { key: "payouts", label: "Payouts" },
          { key: "wallets", label: "Wallets" },
          { key: "rules", label: "Rules" },
          { key: "approvals", label: "Approvals", count: pending },
          ...(role === "admin" ? [{ key: "approvers" as TabKey, label: "Approvers" }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "ledger" ? (
        <LedgerTab canCorrect={!finance} />
      ) : tab === "regions" ? (
        <RegionsTab canRequest={!finance} onRequested={() => setTab("approvals")} />
      ) : tab === "payouts" ? (
        <PayoutsTab canChange={!finance} />
      ) : tab === "rules" ? (
        <RulesTab canRequest={!finance} onRequested={() => setTab("approvals")} />
      ) : tab === "wallets" ? (
        <WalletsTab canChange={!finance} />
      ) : tab === "disputes" ? (
        <DisputesTab canUnfreeze={!finance} />
      ) : tab === "items" ? (
        <ItemsTab canRequest={!finance} onRequested={() => setTab("approvals")} />
      ) : tab === "prices" ? (
        <PricesTab canRequest={!finance} onRequested={() => setTab("approvals")} />
      ) : tab === "settings" ? (
        <SettingsTab canRequest={!finance} onRequested={() => setTab("approvals")} />
      ) : tab === "approvers" ? (
        <ApproversTab />
      ) : (
        <ApprovalsTab onChanged={() => listApprovals("pending").then((r) => setPending(r.pending)).catch(() => {})} />
      )}
    </View>
  );
}

// ---------- Ledger ----------

function LedgerTab({ canCorrect }: { canCorrect: boolean }) {
  const t = useAdminTheme();
  const [book, setBook] = useState<"money" | "costcoin">("money");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ transactions: LedgerTx[]; total: number; pageSize: number } | null>(null);
  const [books, setBooks] = useState<LedgerCheck | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<LedgerTx | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const load = useCallback(() => {
    setError("");
    listLedger({ book, offset }).then(setData).catch((e) => setError(e?.message || "Couldn't load the ledger."));
    getLedgerCheck().then(setBooks).catch(() => setBooks(null));
  }, [book, offset]);
  useEffect(load, [load]);

  const reverse = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const result = await reverseTx(picked.id, reason.trim());
      setDone(`The correction of ${picked.number} is waiting for a second person in Approvals (${result.request.number}). Recorded as ${result.auditEvent}.`);
      setPicked(null);
      setReason("");
      load();
    } catch (e: any) {
      setError(e?.message || "Couldn't reverse it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      {books ? (
        books.books.every((b) => b.balanced) ? (
          <Notice icon="checkmark-circle-outline" tone="green" title="The books balance" text={books.books.length ? books.books.map((b) => `${b.book} ${b.currency}: ${b.transactions} transactions, debits = credits`).join(" · ") : "No entries yet."} />
        ) : (
          <Notice icon="alert-circle-outline" tone="red" title="The books don't balance" text="Debits and credits differ. Tell the backend team at once; the details are in the server log." />
        )
      ) : null}
      <StripeCheckCard />
      {books?.checks?.length ? (
        <Card>
          <CardHeader title="Checks" subtitle="Finance's checks from the sample ledger, run on every entry." />
          <View style={{ marginTop: 12, gap: 8 }}>
            {books.checks.map((c) => (
              <View key={c.name} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <Pill label={c.pass === true ? "PASS" : c.pass === false ? "FAIL" : "N/A"} tone={c.pass === true ? "green" : c.pass === false ? "red" : "blue"} />
                <Text style={{ flex: 1, minWidth: 200, fontFamily: FONTS.medium, fontSize: 13.5, color: t.text }}>{c.name}</Text>
                <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>{String(c.detail)}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      {done ? <Notice icon="checkmark-circle-outline" tone="green" text={done} /> : null}
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      <Card>
        <CardHeader
          title="Transactions"
          subtitle="Append-only: a mistake is corrected by a reversal, never edited."
          right={
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <Select value={book} options={[{ value: "money", label: "Money (USD)" }, { value: "costcoin", label: "CosCoin" }]} onChange={(v) => { setBook(v); setOffset(0); }} />
              {Platform.OS === "web" ? <Button label="Export CSV" icon="download-outline" onPress={() => downloadLedgerCsv(book).catch((e) => setError(e.message))} /> : null}
            </View>
          }
        />
        {!data ? (
          <Loading />
        ) : !data.transactions.length ? (
          <Text style={{ marginTop: 16, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>No transactions in this book yet. Paid tickets appear here automatically.</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {data.transactions.map((tx) => (
              <View key={tx.id} style={{ padding: 14, borderRadius: 16, borderWidth: 1, borderColor: picked?.id === tx.id ? t.pink : t.border, backgroundColor: t.cardSoft, gap: 6 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{tx.number}</Text>
                  <Pill label={tx.type || tx.kind} tone={tx.kind === "reversal" ? "amber" : tx.kind.endsWith("refund") ? "red" : "blue"} />
                  <Text style={{ flex: 1, minWidth: 160, fontFamily: FONTS.regular, fontSize: 13, color: t.muted }} numberOfLines={1}>{tx.memo}</Text>
                  <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{amount(tx.total, tx.currency)}</Text>
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.faint }}>{when(tx.createdAt)}</Text>
                </View>
                {tx.lines.map((l, i) => (
                  <Text key={i} style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>
                    {l.debit ? `Debit  ${l.label || l.account}  ${amount(l.debit, tx.currency)}` : `Credit ${l.label || l.account}  ${amount(l.credit, tx.currency)}`}
                  </Text>
                ))}
                {canCorrect && tx.kind !== "reversal" ? (
                  <View style={{ flexDirection: "row" }}>
                    <Button label="Correct (reverse)…" variant="ghost" icon="return-up-back-outline" onPress={() => { setPicked(tx); setReason(""); setDone(""); }} />
                  </View>
                ) : null}
              </View>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: t.muted }}>
                {offset + 1}–{Math.min(offset + data.pageSize, data.total)} of {data.total}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button label="Previous" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - data.pageSize))} />
                <Button label="Next" disabled={offset + data.pageSize >= data.total} onPress={() => setOffset(offset + data.pageSize)} />
              </View>
            </View>
          </View>
        )}
      </Card>
      {picked ? (
        <Card>
          <CardHeader title={`Correct ${picked.number}`} subtitle="Once another admin or the finance approver approves it: a new transaction with debits and credits swapped. The original stays, both are in the export." />
          <View style={{ marginTop: 14, gap: 12 }}>
            <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Booked twice by mistake." />
            <ConfirmBox
              title={`Reverse ${picked.number}?`}
              text={`${amount(picked.total, picked.currency)} goes back the other way. This can't be undone, only corrected again.`}
              confirmLabel="Send the correction for approval"
              onConfirm={reverse}
              onCancel={() => setPicked(null)}
              busy={busy}
              disabled={reason.trim().length < 3}
            />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- Regions ----------

function RegionsTab({ canRequest, onRequested }: { canRequest: boolean; onRequested: () => void }) {
  const t = useAdminTheme();
  const [data, setData] = useState<{ mode: "test" | "live"; regions: RegionRule[] } | null>(null);
  const [error, setError] = useState("");
  const [region, setRegion] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<RegionStatus>("allowed");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getRegions().then(setData).catch((e) => setError(e?.message || "Couldn't load the regions."));
  }, []);
  useEffect(load, [load]);

  const input = { height: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 14, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await requestRegionChanges([{ region: region.trim(), name: name.trim(), status, note: note.trim() }], reason.trim());
      setRegion("");
      setName("");
      setNote("");
      setReason("");
      onRequested();
    } catch (e: any) {
      setError(e?.message || "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      {data?.mode === "test" ? (
        <Notice icon="flask-outline" tone="amber" title="Test mode" text="Payments use Stripe's sandbox, and the region rules are not applied yet (the team tests from anywhere). They apply in live mode. Paid quests are 18+ in both." />
      ) : null}
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      <Card>
        <CardHeader title="Where paid quests are allowed" subtitle="Set from legal advice. In live mode, a region that isn't listed as allowed is blocked." />
        {!data ? (
          <Loading />
        ) : !data.regions.length ? (
          <Text style={{ marginTop: 16, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>No regions yet. Add them below when legal sends the list.</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {data.regions.map((r) => (
              <View key={r.region} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                <Text style={{ width: 70, fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{r.region}</Text>
                <Text style={{ flex: 1, minWidth: 120, fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>{r.name || "—"}</Text>
                <Pill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                {r.note ? <Text style={{ width: "100%", fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>{r.note}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </Card>
      {canRequest ? (
      <Card>
        <CardHeader title="Request a change" subtitle="Another admin or a finance approver must approve it before it applies. You can't approve your own request." />
        <View style={{ marginTop: 14, gap: 12 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <View style={{ width: 160 }}>
              <Field label="Region code">
                <TextInput value={region} onChangeText={setRegion} placeholder="US-CA" autoCapitalize="characters" placeholderTextColor={t.faint} style={input} />
              </Field>
            </View>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Field label="Name">
                <TextInput value={name} onChangeText={setName} placeholder="California" placeholderTextColor={t.faint} style={input} />
              </Field>
            </View>
            <View>
              <Field label="Status">
                <Select<RegionStatus> value={status} options={[{ value: "allowed", label: "Allowed" }, { value: "blocked", label: "Blocked" }, { value: "needs_license", label: "Needs licence" }]} onChange={setStatus} minWidth={170} />
              </Field>
            </View>
          </View>
          <Field label="Note (optional)">
            <TextInput value={note} onChangeText={setNote} placeholder="e.g. Allowed for skill contests; age 18+" placeholderTextColor={t.faint} style={input} />
          </Field>
          <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Legal advice of 20 Nov (Peter)." />
          <View style={{ flexDirection: "row" }}>
            <Button label="Send for approval" variant="primary" icon="send-outline" loading={busy} disabled={!/^[A-Za-z]{2}(-[A-Za-z0-9]{1,3})?$/.test(region.trim()) || reason.trim().length < 3} onPress={submit} />
          </View>
        </View>
      </Card>
      ) : null}
    </View>
  );
}

// ---------- Approvals ----------

function ApprovalsTab({ onChanged }: { onChanged: () => void }) {
  const t = useAdminTheme();
  const [status, setStatus] = useState<ApprovalStatus>("pending");
  const [data, setData] = useState<{ requests: ApprovalRequest[]; me: string } | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState("");

  const load = useCallback(() => {
    listApprovals(status).then(setData).catch((e) => setError(e?.message || "Couldn't load approvals."));
  }, [status]);
  useEffect(load, [load]);

  const act = async (r: ApprovalRequest, what: "approve" | "reject" | "withdraw") => {
    setBusy(r.id + what);
    setError("");
    try {
      if (what === "withdraw") await withdrawApproval(r.id);
      else {
        const result = await decideApproval(r.id, what === "approve", (notes[r.id] || "").trim());
        setDone(`${r.number} ${what === "approve" ? "approved and applied" : "rejected"}. Recorded as ${result.auditEvent}.`);
      }
      load();
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Couldn't do that.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <Tabs<ApprovalStatus>
        tabs={[
          { key: "pending", label: "Waiting" },
          { key: "approved", label: "Approved" },
          { key: "rejected", label: "Rejected" },
          { key: "withdrawn", label: "Withdrawn" },
        ]}
        value={status}
        onChange={setStatus}
      />
      {done ? <Notice icon="checkmark-circle-outline" tone="green" text={done} /> : null}
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      {!data ? (
        <Loading />
      ) : !data.requests.length ? (
        <Card>
          <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>{status === "pending" ? "Nothing waiting for approval." : "Nothing here."}</Text>
        </Card>
      ) : (
        data.requests.map((r) => {
          const mine = r.requestedBy.id === data.me;
          return (
            <Card key={r.id}>
              <CardHeader title={`${r.number} · ${r.title}`} subtitle={`Requested by ${mine ? "you" : r.requestedBy.name} · ${when(r.createdAt)}`} right={<Pill label={r.status} tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "red"} />} />
              <View style={{ marginTop: 12, gap: 6 }}>
                {Array.isArray(r.changes) ? (
                  r.changes.map((c) => (
                    <Text key={c.region} style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                      {c.region}{c.name ? ` (${c.name})` : ""} → {STATUS_LABEL[c.status]}{c.note ? ` · ${c.note}` : ""}
                    </Text>
                  ))
                ) : "prizeId" in r.changes ? (
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                    Pay {r.changes.number}: ${(r.changes.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} to {r.changes.member} ({r.changes.quest})
                  </Text>
                ) : "member" in r.changes ? (
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                    {r.changes.amount > 0 ? "Add" : "Remove"} {Math.abs(r.changes.amount).toLocaleString("en-US")} CosCoin {r.changes.amount > 0 ? "to" : "from"} {r.changes.member}
                  </Text>
                ) : "body" in r.changes ? (
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                    Publish “{r.changes.title}” ({r.changes.body.length.toLocaleString("en-US")} characters)
                  </Text>
                ) : "transactionId" in r.changes ? (
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                    Reverse {r.changes.number} ({r.changes.type}): {r.changes.book === "money" ? `$${(r.changes.total / 100).toFixed(2)}` : `${r.changes.total} CosCoin`} goes back the other way
                  </Text>
                ) : "items" in r.changes ? (
                  r.changes.items.map((i) => (
                    <Text key={i.id} style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                      {i.id} {i.name} ({i.kind}, {i.game}): {i.priceCosCoin === null ? "OPEN" : `${i.priceCosCoin} CosCoin`}{i.status === "open" ? " (not on sale)" : ""}
                    </Text>
                  ))
                ) : "bundles" in r.changes ? (
                  r.changes.bundles.map((b) => (
                    <Text key={b.id} style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                      {b.id} {b.name}: ${(b.priceCents / 100).toFixed(2)} → {b.costcoin === null ? "OPEN" : `${b.costcoin} CosCoin`}{b.status === "open" ? " (not on sale)" : ""}
                    </Text>
                  ))
                ) : (
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>
                    Platform share {r.changes.platformShareBps === null ? "OPEN" : `${r.changes.platformShareBps / 100}%`} · payout limit {r.changes.payoutApprovalLimitCents === null ? "OPEN" : `$${(r.changes.payoutApprovalLimitCents / 100).toLocaleString("en-US")}`}
                  </Text>
                )}
                <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: t.muted }}>Reason: {r.reason}</Text>
                {r.decidedBy ? <Text style={{ fontFamily: FONTS.regular, fontSize: 13, color: t.muted }}>{r.status === "approved" ? "Approved" : "Rejected"} by {r.decidedBy.name}{r.decisionNote ? `: ${r.decisionNote}` : ""}</Text> : null}
              </View>
              {r.status === "pending" ? (
                mine ? (
                  <View style={{ marginTop: 14, gap: 10 }}>
                    <Notice icon="people-outline" text="Another admin or a finance approver must approve this. You can withdraw it." />
                    <View style={{ flexDirection: "row" }}>
                      <Button label="Withdraw" loading={busy === r.id + "withdraw"} onPress={() => act(r, "withdraw")} />
                    </View>
                  </View>
                ) : (
                  <View style={{ marginTop: 14, gap: 10 }}>
                    <ReasonBox label="Note · needed to reject" value={notes[r.id] || ""} onChange={(text) => setNotes((n) => ({ ...n, [r.id]: text }))} placeholder="e.g. Checked against Peter's list." />
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <Button label="Approve and apply" variant="primary" icon="checkmark-outline" loading={busy === r.id + "approve"} onPress={() => act(r, "approve")} />
                      <Button label="Reject" loading={busy === r.id + "reject"} disabled={(notes[r.id] || "").trim().length < 3} onPress={() => act(r, "reject")} />
                    </View>
                  </View>
                )
              ) : null}
            </Card>
          );
        })
      )}
    </View>
  );
}

// ---------- Approvers (super admins) ----------

function ApproversTab() {
  const t = useAdminTheme();
  const [rows, setRows] = useState<FinanceApprover[] | null>(null);
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<FinanceApprover | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(() => {
    listFinanceApprovers().then((r) => setRows(r.approvers)).catch((e) => setError(e?.message || "Couldn't load the approvers."));
  }, []);
  useEffect(load, [load]);

  const input = { height: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 14, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await addFinanceApprover(username.trim(), reason.trim());
      setDone(`@${r.approver.username || username} is now a finance approver. Recorded as ${r.auditEvent}.`);
      setUsername("");
      setReason("");
      load();
    } catch (e: any) {
      setError(e?.message || "Couldn't add them.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const r = await removeFinanceApprover(removing.id, removeReason.trim());
      setDone(`${removing.name} is no longer a finance approver. Recorded as ${r.auditEvent}.`);
      setRemoving(null);
      setRemoveReason("");
      load();
    } catch (e: any) {
      setError(e?.message || "Couldn't remove them.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <Notice
        icon="people-outline"
        title="Two people for every money change"
        text="Whoever asks for a money change can't approve it. A finance approver is a trusted second person (for example from the payment task force or the accountant) who signs in to the dashboard but only sees Ledger & approvals: they approve or reject, and can't change anything else."
      />
      {done ? <Notice icon="checkmark-circle-outline" tone="green" text={done} /> : null}
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      <Card>
        <CardHeader title="Finance approvers" subtitle="They sign in with their own CosQuest account." />
        {!rows ? (
          <Loading />
        ) : !rows.length ? (
          <Text style={{ marginTop: 14, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>None yet. With only one admin, nothing can be approved: add one below.</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {rows.map((r) => (
              <View key={r.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                <Text style={{ flex: 1, minWidth: 160, fontFamily: FONTS.medium, fontSize: 14, color: t.text }}>
                  {r.name}{r.username ? ` · @${r.username}` : ""}
                </Text>
                {r.since ? <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>Since {new Date(r.since).toLocaleDateString()}</Text> : null}
                <Button label="Remove…" variant="ghost" onPress={() => { setRemoving(r); setRemoveReason(""); }} />
              </View>
            ))}
          </View>
        )}
      </Card>
      {removing ? (
        <Card>
          <ReasonBox value={removeReason} onChange={setRemoveReason} placeholder="e.g. Left the task force." />
          <View style={{ marginTop: 12 }}>
            <ConfirmBox
              title={`Remove ${removing.name}?`}
              text="Their dashboard session ends at once. Requests they already decided stay decided."
              confirmLabel="Remove"
              onConfirm={remove}
              onCancel={() => setRemoving(null)}
              busy={busy}
              disabled={removeReason.trim().length < 3}
            />
          </View>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Add a finance approver" subtitle="Their CosQuest username. They must already have an account." />
        <View style={{ marginTop: 14, gap: 12 }}>
          <Field label="Username">
            <TextInput value={username} onChangeText={setUsername} placeholder="@adewale" autoCapitalize="none" placeholderTextColor={t.faint} style={input} />
          </Field>
          <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Second approver for money changes, agreed with Mark." />
          <View style={{ flexDirection: "row" }}>
            <Button label="Add finance approver" variant="primary" icon="person-add-outline" loading={busy && !removing} disabled={username.trim().replace(/^@/, "").length < 3 || reason.trim().length < 3} onPress={add} />
          </View>
        </View>
      </Card>
    </View>
  );
}

// ---------- Money settings (finance's "Assumptions") ----------

function SettingsTab({ canRequest, onRequested }: { canRequest: boolean; onRequested: () => void }) {
  const t = useAdminTheme();
  const [data, setData] = useState<{ current: PaymentSettings; history: PaymentSettings[] } | null>(null);
  const [share, setShare] = useState("");
  const [limit, setLimit] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getPaymentSettings()
      .then((d) => {
        setData(d);
        setShare(d.current.platformShareBps === null ? "" : String(d.current.platformShareBps / 100));
        setLimit(d.current.payoutApprovalLimitCents === null ? "" : String(d.current.payoutApprovalLimitCents / 100));
      })
      .catch((e) => setError(e?.message || "Couldn't load the settings."));
  }, []);
  useEffect(load, [load]);

  const input = { height: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 14, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };
  const pct = (bps: number | null) => (bps === null ? "OPEN" : `${bps / 100}%`);
  const usd = (cents: number | null) => (cents === null ? "OPEN" : `$${(cents / 100).toLocaleString("en-US")}`);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await requestPaymentSettings({ platformSharePercent: share.trim(), payoutApprovalLimitDollars: limit.trim(), reason: reason.trim() });
      setReason("");
      onRequested();
    } catch (e: any) {
      setError(e?.message || "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const c = data?.current;
  return (
    <View style={{ gap: 16 }}>
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      <Card>
        <CardHeader title="Money settings" subtitle={c?.formulaVersion ? `Version ${c.formulaVersion}. Each settlement records the version it used.` : "No version approved yet: everything is OPEN until Mark decides."} />
        {!c ? (
          <Loading />
        ) : (
          <View style={{ marginTop: 14, gap: 10 }}>
            {[
              ["Platform share of each quest pool", pct(c.platformShareBps), "Mark decides (30% was only an example)."],
              ["Winners' share of each quest pool", pct(c.winnerShareBps), "Whatever the platform doesn't keep."],
              ["Payouts above this need a second admin", usd(c.payoutApprovalLimitCents), "Mark decides."],
              ["Stripe fee", "Recorded from Stripe", "The ledger records Stripe's real fee on each payment."],
            ].map(([name, value, hint]) => (
              <View key={name} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                <View style={{ flex: 1, minWidth: 200 }}>
                  <Text style={{ fontFamily: FONTS.medium, fontSize: 14, color: t.text }}>{name}</Text>
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>{hint}</Text>
                </View>
                <Pill label={value} tone={value === "OPEN" ? "amber" : "green"} />
              </View>
            ))}
          </View>
        )}
      </Card>
      {canRequest ? (
        <Card>
          <CardHeader title="Request a change" subtitle="Another admin or a finance approver must approve it. Leave a field empty to keep it OPEN." />
          <View style={{ marginTop: 14, gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <View style={{ width: 220 }}>
                <Field label="Platform share (%)">
                  <TextInput value={share} onChangeText={(v) => setShare(v.replace(/[^0-9.]/g, "").slice(0, 6))} placeholder="OPEN" keyboardType="decimal-pad" placeholderTextColor={t.faint} style={input} />
                </Field>
              </View>
              <View style={{ width: 260 }}>
                <Field label="Payout approval limit ($)">
                  <TextInput value={limit} onChangeText={(v) => setLimit(v.replace(/[^0-9.]/g, "").slice(0, 10))} placeholder="OPEN" keyboardType="decimal-pad" placeholderTextColor={t.faint} style={input} />
                </Field>
              </View>
            </View>
            <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Mark approved a 30% platform share on 20 Nov." />
            <View style={{ flexDirection: "row" }}>
              <Button label="Send for approval" variant="primary" icon="send-outline" loading={busy} disabled={reason.trim().length < 3} onPress={submit} />
            </View>
          </View>
        </Card>
      ) : null}
      {data?.history?.length ? (
        <Card>
          <CardHeader title="History" subtitle="Every approved version (never edited)." />
          <View style={{ marginTop: 12, gap: 6 }}>
            {data.history.map((v) => (
              <Text key={v.formulaVersion || "none"} style={{ fontFamily: FONTS.regular, fontSize: 13.5, color: t.text }}>
                {v.formulaVersion} · platform {pct(v.platformShareBps)} · winners {pct(v.winnerShareBps)} · payout limit {usd(v.payoutApprovalLimitCents)}
                {v.approvedAt ? ` · ${new Date(v.approvedAt).toLocaleDateString()}` : ""}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- CosCoin price table (finance's "Price Table") ----------

type BundleRow = { id: string; name: string; price: string; costcoin: string; status: "active" | "open"; note: string };
// Until a table is approved, start from the Sep 2 meeting's agreed bundles.
const AGREED_BUNDLES: BundleRow[] = [
  { id: "B-80", name: "Small bundle", price: "1", costcoin: "80", status: "active", note: "Agreed data point (Sep 2)" },
  { id: "B-500", name: "Medium bundle", price: "4", costcoin: "500", status: "active", note: "Agreed data point (Sep 2)" },
  { id: "B-STARTER", name: "Starter pack", price: "20", costcoin: "", status: "open", note: "Coin amount not decided. Includes character items and a basic weapon." },
];

function PricesTab({ canRequest, onRequested }: { canRequest: boolean; onRequested: () => void }) {
  const t = useAdminTheme();
  const [data, setData] = useState<{ current: PriceTable; history: PriceTable[] } | null>(null);
  const [rows, setRows] = useState<BundleRow[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getPriceTable()
      .then((d) => {
        setData(d);
        setRows(
          d.current.bundles.length
            ? d.current.bundles.map((b) => ({ id: b.id, name: b.name, price: String(b.priceCents / 100), costcoin: b.costcoin === null ? "" : String(b.costcoin), status: b.status, note: b.note }))
            : AGREED_BUNDLES,
        );
      })
      .catch((e) => setError(e?.message || "Couldn't load the price table."));
  }, []);
  useEffect(load, [load]);

  const input = { height: 40, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 13.5, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };
  const set = (i: number, patch: Partial<BundleRow>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await requestPriceTable(rows.map((r) => ({ id: r.id.trim(), name: r.name.trim(), price: r.price.trim(), costcoin: r.costcoin.trim(), status: r.status, note: r.note })), reason.trim());
      setReason("");
      onRequested();
    } catch (e: any) {
      setError(e?.message || "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const c = data?.current;
  return (
    <View style={{ gap: 16 }}>
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      <Card>
        <CardHeader title="CosCoin price table" subtitle={c?.priceVersion ? `Version ${c.priceVersion}. Each purchase records the version it was sold at.` : "No table approved yet: nothing is on sale."} />
        {!c ? (
          <Loading />
        ) : !c.bundles.length ? (
          <Text style={{ marginTop: 14, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>Request the first table below (it starts from the bundles agreed on Sep 2).</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {c.bundles.map((b) => (
              <View key={b.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                <Text style={{ width: 100, fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{b.id}</Text>
                <Text style={{ flex: 1, minWidth: 140, fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>{b.name}</Text>
                <Text style={{ fontFamily: FONTS.medium, fontSize: 14, color: t.text }}>{money(b.priceCents)} → {b.costcoin === null ? "OPEN" : `${b.costcoin} coins`}</Text>
                {b.costcoinPerDollar ? <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>{b.costcoinPerDollar} per $1</Text> : null}
                <Pill label={b.status === "active" ? "On sale" : "OPEN"} tone={b.status === "active" ? "green" : "amber"} />
              </View>
            ))}
          </View>
        )}
      </Card>
      {canRequest ? (
        <Card>
          <CardHeader title="Request a new table" subtitle="The whole table becomes a new version once another admin or a finance approver approves it. Open bundles are never sold." />
          <View style={{ marginTop: 14, gap: 10 }}>
            {rows.map((r, i) => (
              <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <TextInput value={r.id} onChangeText={(v) => set(i, { id: v.toUpperCase().slice(0, 22) })} placeholder="B-1000" placeholderTextColor={t.faint} style={[input, { width: 110 }]} accessibilityLabel="Bundle id" />
                <TextInput value={r.name} onChangeText={(v) => set(i, { name: v.slice(0, 40) })} placeholder="Name" placeholderTextColor={t.faint} style={[input, { flex: 1, minWidth: 140 }]} accessibilityLabel="Bundle name" />
                <TextInput value={r.price} onChangeText={(v) => set(i, { price: v.replace(/[^0-9.]/g, "").slice(0, 7) })} placeholder="Price $" keyboardType="decimal-pad" placeholderTextColor={t.faint} style={[input, { width: 90 }]} accessibilityLabel="Price in dollars" />
                <TextInput value={r.costcoin} onChangeText={(v) => set(i, { costcoin: v.replace(/[^0-9]/g, "").slice(0, 7) })} placeholder="Coins" keyboardType="number-pad" placeholderTextColor={t.faint} style={[input, { width: 90 }]} accessibilityLabel="CosCoin" />
                <Select<"active" | "open"> value={r.status} options={[{ value: "active", label: "On sale" }, { value: "open", label: "OPEN" }]} onChange={(v) => set(i, { status: v })} minWidth={110} />
                <Button label="Remove" variant="ghost" onPress={() => setRows((all) => all.filter((_, j) => j !== i))} />
              </View>
            ))}
            <View style={{ flexDirection: "row" }}>
              <Button label="Add a bundle" variant="ghost" icon="add-outline" onPress={() => setRows((all) => [...all, { id: "B-", name: "", price: "", costcoin: "", status: "open", note: "" }])} />
            </View>
            <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Agreed bundles from the Sep 2 meeting (Adewale, Emaculate); approved by Mark." />
            <View style={{ flexDirection: "row" }}>
              <Button label="Send for approval" variant="primary" icon="send-outline" loading={busy} disabled={!rows.length || reason.trim().length < 3} onPress={submit} />
            </View>
          </View>
        </Card>
      ) : null}
      {data?.history?.length ? (
        <Card>
          <CardHeader title="History" subtitle="Every approved table (never edited)." />
          <View style={{ marginTop: 12, gap: 6 }}>
            {data.history.map((v) => (
              <Text key={v.priceVersion || "none"} style={{ fontFamily: FONTS.regular, fontSize: 13.5, color: t.text }}>
                {v.priceVersion} · {v.bundles.map((b) => `${b.id} ${money(b.priceCents)} = ${b.costcoin ?? "OPEN"}`).join(" · ")}
                {v.approvedAt ? ` · ${new Date(v.approvedAt).toLocaleDateString()}` : ""}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- What CosCoin can buy (the item catalog) ----------

type ItemRow = { id: string; name: string; kind: string; priceCosCoin: string; game: string; status: "active" | "open"; boughtCoinsOnly: boolean; imageUrl: string; subtitle: string; section: string; isNew: boolean; dropEndsAt: string; free: boolean };
const ITEM_KINDS = ["cosmetic", "skin", "weapon", "ammo", "bundle", "faction_switch", "other"];
const ITEM_GAMES = ["all", "social", "costquest", "trivia", "parlay"];

function ItemsTab({ canRequest, onRequested }: { canRequest: boolean; onRequested: () => void }) {
  const t = useAdminTheme();
  const [data, setData] = useState<{ current: ItemCatalog; history: ItemCatalog[] } | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getItemCatalog()
      .then((d) => {
        setData(d);
        setRows(d.current.items.map((i) => ({ id: i.id, name: i.name, kind: i.kind, priceCosCoin: i.priceCosCoin === null ? "" : String(i.priceCosCoin), game: i.game, status: i.status, boughtCoinsOnly: Boolean(i.boughtCoinsOnly), imageUrl: i.imageUrl || "", subtitle: i.subtitle || "", section: i.section || "elite_merch", isNew: Boolean(i.isNew), dropEndsAt: i.dropEndsAt ? i.dropEndsAt.slice(0, 10) : "", free: Boolean(i.free) })));
      })
      .catch((e) => setError(e?.message || "Couldn't load the catalog."));
  }, []);
  useEffect(load, [load]);

  const input = { height: 40, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 13.5, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };
  const set = (i: number, patch: Partial<ItemRow>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await requestItemCatalog(rows.map((r) => ({ ...r, id: r.id.trim(), name: r.name.trim(), priceCosCoin: r.priceCosCoin.trim() })), reason.trim());
      setReason("");
      onRequested();
    } catch (e: any) {
      setError(e?.message || "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const c = data?.current;
  return (
    <View style={{ gap: 16 }}>
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      <Card>
        <CardHeader title="What CosCoin can buy" subtitle={c?.catalogVersion ? `Catalog ${c.catalogVersion}. Never quest entry, XP or cash.` : "No catalog approved yet: nothing can be bought with CosCoin."} />
        {!c ? (
          <Loading />
        ) : !c.items.length ? (
          <Text style={{ marginTop: 14, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>Add items below (prices come from Adewale's game mechanics document).</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {c.items.map((i) => (
              <View key={i.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                <Text style={{ width: 90, fontFamily: FONTS.semibold, fontSize: 13.5, color: t.text }}>{i.id}</Text>
                <Text style={{ flex: 1, minWidth: 140, fontFamily: FONTS.regular, fontSize: 14, color: t.text }}>{i.name}</Text>
                <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>{i.kind}{i.stackable ? " · stacks" : ""}{i.boughtCoinsOnly ? " · bought coins only" : ""} · {i.game}</Text>
                <Text style={{ fontFamily: FONTS.medium, fontSize: 14, color: t.text }}>{i.priceCosCoin === null ? "OPEN" : `${i.priceCosCoin} CosCoin`}</Text>
                <Pill label={i.status === "active" ? "On sale" : "OPEN"} tone={i.status === "active" ? "green" : "amber"} />
              </View>
            ))}
          </View>
        )}
      </Card>
      {canRequest ? (
        <Card>
          <CardHeader title="Request a new catalog" subtitle="The whole list becomes a new version once another admin or a finance approver approves it." />
          <View style={{ marginTop: 14, gap: 10 }}>
            {rows.map((r, i) => (
              <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <TextInput value={r.id} onChangeText={(v) => set(i, { id: v.toUpperCase().slice(0, 27) })} placeholder="SK-07" placeholderTextColor={t.faint} style={[input, { width: 100 }]} accessibilityLabel="Item id" />
                <TextInput value={r.name} onChangeText={(v) => set(i, { name: v.slice(0, 60) })} placeholder="Name" placeholderTextColor={t.faint} style={[input, { flex: 1, minWidth: 140 }]} accessibilityLabel="Item name" />
                <Select<string> value={r.kind} options={ITEM_KINDS.map((k) => ({ value: k, label: k.replace("_", " ") }))} onChange={(v) => set(i, { kind: v })} minWidth={130} />
                <TextInput value={r.priceCosCoin} onChangeText={(v) => set(i, { priceCosCoin: v.replace(/[^0-9]/g, "").slice(0, 7) })} placeholder="CosCoin" keyboardType="number-pad" placeholderTextColor={t.faint} style={[input, { width: 90 }]} accessibilityLabel="Price in CosCoin" />
                <Select<string> value={r.game} options={ITEM_GAMES.map((g) => ({ value: g, label: g }))} onChange={(v) => set(i, { game: v })} minWidth={110} />
                <Select<"any" | "bought"> value={r.boughtCoinsOnly ? "bought" : "any"} options={[{ value: "any", label: "Any coins" }, { value: "bought", label: "Bought coins only" }]} onChange={(v) => set(i, { boughtCoinsOnly: v === "bought" })} minWidth={150} />
                <Select<string> value={r.section} options={[{ value: "elite_merch", label: "Shop: Elite Merch" }, { value: "remix", label: "Shop: Manny's Remix" }, { value: "deals", label: "Shop: Deals" }, { value: "wardrobe", label: "Not in the shop" }]} onChange={(v) => set(i, { section: v })} minWidth={170} />
                <Select<"no" | "yes"> value={r.free ? "yes" : "no"} options={[{ value: "no", label: "Paid" }, { value: "yes", label: "Free reward" }]} onChange={(v) => set(i, { free: v === "yes", priceCosCoin: v === "yes" ? "" : r.priceCosCoin })} minWidth={120} />
                <Select<"no" | "yes"> value={r.isNew ? "yes" : "no"} options={[{ value: "no", label: "Not new" }, { value: "yes", label: "NEW tag" }]} onChange={(v) => set(i, { isNew: v === "yes" })} minWidth={110} />
                <TextInput value={r.subtitle} onChangeText={(v) => set(i, { subtitle: v.slice(0, 80) })} placeholder="Subtitle (e.g. Shimmer queen)" placeholderTextColor={t.faint} style={[input, { flex: 1, minWidth: 160 }]} accessibilityLabel="Subtitle" />
                <TextInput value={r.imageUrl} onChangeText={(v) => set(i, { imageUrl: v.trim().slice(0, 500) })} placeholder="Picture URL (https://…)" autoCapitalize="none" placeholderTextColor={t.faint} style={[input, { flex: 1, minWidth: 200 }]} accessibilityLabel="Picture URL" />
                <TextInput value={r.dropEndsAt} onChangeText={(v) => set(i, { dropEndsAt: v.replace(/[^0-9-]/g, "").slice(0, 10) })} placeholder="Ends YYYY-MM-DD" placeholderTextColor={t.faint} style={[input, { width: 140 }]} accessibilityLabel="Offer ends (date)" />
                <Select<"active" | "open"> value={r.status} options={[{ value: "active", label: "On sale" }, { value: "open", label: "OPEN" }]} onChange={(v) => set(i, { status: v })} minWidth={100} />
                <Button label="Remove" variant="ghost" onPress={() => setRows((all) => all.filter((_, j) => j !== i))} />
              </View>
            ))}
            <View style={{ flexDirection: "row" }}>
              <Button label="Add an item" variant="ghost" icon="add-outline" onPress={() => setRows((all) => [...all, { id: "", name: "", kind: "skin", priceCosCoin: "", game: "all", status: "open", boughtCoinsOnly: false, imageUrl: "", subtitle: "", section: "elite_merch", isNew: false, dropEndsAt: "", free: false }])} />
            </View>
            <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Items and prices from Adewale's game mechanics document, approved by Mark." />
            <View style={{ flexDirection: "row" }}>
              <Button label="Send for approval" variant="primary" icon="send-outline" loading={busy} disabled={!rows.length || reason.trim().length < 3} onPress={submit} />
            </View>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- Disputes (chargebacks) ----------

function DisputesTab({ canUnfreeze }: { canUnfreeze: boolean }) {
  const t = useAdminTheme();
  const [rows, setRows] = useState<AdminDispute[] | null>(null);
  const [picked, setPicked] = useState<AdminDispute | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(() => {
    getDisputes()
      .then((d) => setRows(d.disputes))
      .catch((e) => setError(e?.message || "Couldn't load the disputes."));
  }, []);
  useEffect(load, [load]);

  const unfreeze = async () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const result = await unfreezeDisputeWallet(picked.id, reason.trim());
      setDone(`${picked.member || "The member"} can spend CosCoin again. Recorded as ${result.auditEvent}.`);
      setPicked(null);
      setReason("");
      load();
    } catch (e: any) {
      setError(e?.message || "Couldn't unfreeze the wallet.");
    } finally {
      setBusy(false);
    }
  };

  const money = (cents: number, currency: string) => `${currency === "USD" ? "$" : `${currency} `}${(cents / 100).toFixed(2)}`;
  return (
    <View style={{ gap: 16 }}>
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      {done ? <Notice icon="checkmark-circle-outline" tone="green" text={done} /> : null}
      <Card>
        <CardHeader title="Disputes" subtitle="Card disputes (chargebacks) from Stripe. The money moves are in the ledger (5020 Chargebacks). Answer them in Stripe before the due date." />
        {!rows ? (
          <Loading />
        ) : !rows.length ? (
          <Text style={{ marginTop: 14, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>No disputes. Good.</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {rows.map((d) => (
              <View key={d.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                <Pill label={d.outcome === "open" ? "Open" : d.outcome === "won" ? "Won" : "Lost"} tone={d.outcome === "open" ? "amber" : d.outcome === "won" ? "green" : "red"} />
                <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{money(d.amount, d.currency)}</Text>
                <Text style={{ flex: 1, minWidth: 180, fontFamily: FONTS.regular, fontSize: 13.5, color: t.text }}>
                  {d.orderLabel || "Unknown payment"} · {d.paymentType === "coscoin" ? "CosCoin top-up" : d.paymentType === "ticket" ? "Ticket" : "?"} · {d.member || "?"} · {d.reason.replace(/_/g, " ")}
                </Text>
                {d.evidenceDueBy && d.outcome === "open" ? <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>Answer by {new Date(d.evidenceDueBy).toLocaleDateString()}</Text> : null}
                {d.walletFrozen ? <Pill label="Wallet frozen" tone="red" /> : null}
                {d.walletFrozen && canUnfreeze ? <Button label="Unfreeze wallet…" variant="ghost" icon="lock-open-outline" onPress={() => { setPicked(d); setReason(""); setDone(""); }} /> : null}
              </View>
            ))}
          </View>
        )}
      </Card>
      {picked ? (
        <Card>
          <CardHeader title={`Unfreeze ${picked.member || "the member"}'s wallet`} subtitle="They can spend their CosCoin again. Do this after reviewing the dispute." />
          <View style={{ marginTop: 14, gap: 12 }}>
            <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Dispute won; the member confirmed the purchase." />
            <ConfirmBox title="Unfreeze the wallet?" text="This is recorded in the audit log with your name." confirmLabel="Unfreeze" onConfirm={unfreeze} onCancel={() => setPicked(null)} busy={busy} disabled={reason.trim().length < 3} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- The daily check against Stripe ----------

function StripeCheckCard() {
  const t = useAdminTheme();
  const [days, setDays] = useState<StripeCheckDay[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getStripeCheck()
      .then((d) => setDays(d.days))
      .catch((e) => setError(e?.message || "Couldn't load the Stripe check."));
  }, []);
  useEffect(load, [load]);

  const runAgain = async (day: string) => {
    setBusy(true);
    setError("");
    try {
      await runStripeCheck(day);
      load();
    } catch (e: any) {
      setError(e?.message || "Couldn't run the check.");
    } finally {
      setBusy(false);
    }
  };

  const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const usd = (cents?: number) => (typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "-");
  return (
    <Card>
      <CardHeader title="Stripe check (daily)" subtitle="Every day after 02:00 UTC, yesterday's payments and fees in Stripe are matched with the ledger. It only reports, it never changes anything." />
      {error ? <View style={{ marginTop: 10 }}><Notice icon="alert-circle-outline" tone="red" text={error} /></View> : null}
      {!days ? (
        <Loading />
      ) : (
        <View style={{ marginTop: 12, gap: 8 }}>
          {!days.length ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>No check has run yet.</Text> : null}
          {days.map((d) => (
            <View key={d.day} style={{ gap: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
              <Pressable onPress={() => setOpen(open === d.day ? null : d.day)} accessibilityRole="button" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <Pill label={d.ok ? "PASS" : "FAIL"} tone={d.ok ? "green" : "red"} />
                <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{d.day}</Text>
                <Text style={{ flex: 1, minWidth: 200, fontFamily: FONTS.regular, fontSize: 13, color: t.muted }}>
                  {d.error ? `Couldn't ask Stripe: ${d.error}` : `${d.totals?.stripe?.payments ?? 0} payment(s), ${usd(d.totals?.stripe?.received)} received, fees ${usd(d.totals?.stripe?.fees)}${d.problems.length ? ` · ${d.problems.length} problem(s)` : ""}`}
                </Text>
              </Pressable>
              {open === d.day ? (
                <View style={{ gap: 4 }}>
                  {d.problems.map((p, i) => (
                    <Text key={i} selectable style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.text }}>• {p.kind.replace(/_/g, " ")}: {p.ref} ({p.detail})</Text>
                  ))}
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>
                    Stripe: refunds {usd(d.totals?.stripe?.refunds)} · disputes {usd(d.totals?.stripe?.disputes)} · paid out to the bank {usd(d.totals?.stripe?.payoutsToBank)}
                  </Text>
                  <View style={{ flexDirection: "row" }}>
                    <Button label="Run again" variant="ghost" icon="refresh-outline" loading={busy} onPress={() => runAgain(d.day)} />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
          {!days.some((d) => d.day === yesterday) ? (
            <View style={{ flexDirection: "row" }}>
              <Button label={`Check ${yesterday} now`} variant="ghost" icon="play-outline" loading={busy} onPress={() => runAgain(yesterday)} />
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
}

// ---------- CosCoin wallets (fraud flags) ----------

function WalletsTab({ canChange }: { canChange: boolean }) {
  const t = useAdminTheme();
  const [rows, setRows] = useState<AdminWallet[] | null>(null);
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(() => {
    getWallets()
      .then((d) => setRows(d.wallets))
      .catch((e) => setError(e?.message || "Couldn't load the wallets."));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<{ auditEvent: string }>, text: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setDone(`${text} Recorded as ${r.auditEvent}.`);
      setReason("");
      setUsername("");
      load();
    } catch (e: any) {
      setError(e?.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const input = { height: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 14, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };
  return (
    <View style={{ gap: 16 }}>
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      {done ? <Notice icon="checkmark-circle-outline" tone="green" text={done} /> : null}
      <Card>
        <CardHeader title="Flagged and frozen wallets" subtitle="A frozen wallet can't spend or earn CosCoin until it's unfrozen. Flags come from card disputes, the games (fraud checks) and admins." />
        {!rows ? (
          <Loading />
        ) : !rows.length ? (
          <Text style={{ marginTop: 14, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>No flagged wallets.</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {rows.map((w) => (
              <View key={w.userId} style={{ gap: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  <Pill label={w.frozen ? "Frozen" : "Flagged"} tone={w.frozen ? "red" : "amber"} />
                  <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{w.member}</Text>
                  <Text style={{ flex: 1, minWidth: 180, fontFamily: FONTS.regular, fontSize: 13, color: t.muted }}>
                    {w.balance} CosCoin ({w.bought} bought, {w.earned} earned)
                  </Text>
                  {w.frozen && canChange ? (
                    <Button label="Unfreeze" variant="ghost" icon="lock-open-outline" loading={busy} disabled={reason.trim().length < 3} onPress={() => run(() => unfreezeWallet(w.userId, reason.trim()), `${w.member} can spend again.`)} />
                  ) : null}
                </View>
                {w.flags.map((f, i) => (
                  <Text key={i} style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>• {f.reason} ({f.by}, {new Date(f.at).toLocaleDateString()})</Text>
                ))}
              </View>
            ))}
          </View>
        )}
      </Card>
      {canChange ? <AdjustCard /> : null}
      {canChange ? (
        <Card>
          <CardHeader title="Freeze or unfreeze" subtitle="Type the reason first: it's needed for both, and kept in the audit log." />
          <View style={{ marginTop: 14, gap: 12 }}>
            <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Rewards farmed with a script (game report R-881)." />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <TextInput value={username} onChangeText={setUsername} placeholder="@username" autoCapitalize="none" placeholderTextColor={t.faint} style={[input, { width: 220 }]} accessibilityLabel="Member's username" />
              <Button label="Freeze wallet" variant="primary" icon="lock-closed-outline" loading={busy} disabled={!username.trim() || reason.trim().length < 3} onPress={() => run(() => freezeWallet(username.trim(), reason.trim()), `${username.trim()}'s wallet is frozen.`)} />
            </View>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- Official rules (legal plan, section 9) ----------

function RulesTab({ canRequest, onRequested }: { canRequest: boolean; onRequested: () => void }) {
  const t = useAdminTheme();
  const [data, setData] = useState<{ current: AdminRules | null; history: { version: number; title: string; publishedAt: string }[] } | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getAdminRules()
      .then((d) => {
        setData(d);
        setTitle(d.current?.title || "CosQuest Official Contest Rules");
        setBody(d.current?.body || "");
      })
      .catch((e) => setError(e?.message || "Couldn't load the rules."));
  }, []);
  useEffect(load, [load]);

  const input = { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 14, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await requestRules(title.trim(), body, reason.trim());
      setReason("");
      onRequested();
    } catch (e: any) {
      setError(e?.message || "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const c = data?.current;
  return (
    <View style={{ gap: 16 }}>
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      <Card>
        <CardHeader title="Official rules" subtitle={c ? `Version ${c.version}, published ${new Date(c.publishedAt).toLocaleDateString()}. Every ticket accepts the current version at checkout.` : "No rules published yet: checkout doesn't ask for acceptance until the first version is approved."} />
        {c ? <Text style={{ marginTop: 10, fontFamily: FONTS.regular, fontSize: 13.5, color: t.muted }}>Public page: cosquest.vercel.app/rules</Text> : null}
        {data?.history?.length ? (
          <View style={{ marginTop: 10, gap: 4 }}>
            {data.history.map((v) => (
              <Text key={v.version} style={{ fontFamily: FONTS.regular, fontSize: 13, color: t.text }}>v{v.version} · {v.title} · {new Date(v.publishedAt).toLocaleDateString()}</Text>
            ))}
          </View>
        ) : null}
      </Card>
      {canRequest ? (
        <Card>
          <CardHeader title="Publish a new version" subtitle="Paste the lawyer-reviewed text. Use # for headings and - for bullet points. Another admin or the finance approver approves it." />
          <View style={{ marginTop: 14, gap: 12 }}>
            <Field label="Title">
              <TextInput value={title} onChangeText={(v) => setTitle(v.slice(0, 120))} placeholderTextColor={t.faint} style={[input, { height: 44 }]} />
            </Field>
            <Field label="Rules text">
              <TextInput value={body} onChangeText={(v) => setBody(v.slice(0, 60000))} multiline placeholder={"# Who can enter\n- 18 or over\n..."} placeholderTextColor={t.faint} style={[input, { minHeight: 260, textAlignVertical: "top" }]} />
            </Field>
            <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Rules reviewed by counsel on 28 Nov." />
            <View style={{ flexDirection: "row" }}>
              <Button label="Send for approval" variant="primary" icon="send-outline" loading={busy} disabled={title.trim().length < 3 || body.trim().length < 50 || reason.trim().length < 3} onPress={submit} />
            </View>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- CosCoin adjustments (a second person approves) ----------

function AdjustCard() {
  const t = useAdminTheme();
  const [username, setUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const n = Number.parseInt(amount, 10);
  const valid = username.trim() && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 10000 && reason.trim().length >= 3;
  const input = { height: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 14, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };
  const submit = async () => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const r = await requestAdjustment(username.trim(), n, reason.trim());
      setDone(`Sent for approval as ${r.request.number}. Another admin or the finance approver approves it in Approvals.`);
      setUsername("");
      setAmount("");
      setReason("");
    } catch (e: any) {
      setError(e?.message || "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Add or remove CosCoin" subtitle="For compensation or corrections. Added coins count as earned (not bought). Never below zero. A second person approves; the ledger keeps who asked and who approved." />
      <View style={{ marginTop: 14, gap: 12 }}>
        {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
        {done ? <Notice icon="checkmark-circle-outline" tone="green" text={done} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <TextInput value={username} onChangeText={setUsername} placeholder="@username" autoCapitalize="none" placeholderTextColor={t.faint} style={[input, { width: 200 }]} accessibilityLabel="Member's username" />
          <TextInput value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9-]/g, "").slice(0, 6))} placeholder="+200 or -150" keyboardType="numbers-and-punctuation" placeholderTextColor={t.faint} style={[input, { width: 140 }]} accessibilityLabel="CosCoin to add (or remove with a minus)" />
        </View>
        <ReasonBox value={reason} onChange={setReason} placeholder="e.g. Compensation for a raid reward lost in the 26 Nov outage." />
        <View style={{ flexDirection: "row" }}>
          <Button label="Send for approval" variant="primary" icon="send-outline" loading={busy} disabled={!valid} onPress={submit} />
        </View>
      </View>
    </Card>
  );
}

// ---------- Payouts: prizes won, claims, payouts (PrizeClaim contract) ----------

const PRIZE_STATUS: Record<AdminPrize["status"], { label: string; tone: "green" | "amber" | "red" | "blue" | "pink" }> = {
  awaiting_claim: { label: "Awaiting claim", tone: "pink" },
  submitted: { label: "Claim to check", tone: "amber" },
  verified: { label: "Verified", tone: "blue" },
  payout_requested: { label: "Payout in Approvals", tone: "blue" },
  held: { label: "Held (dispute window)", tone: "blue" },
  paid: { label: "Paid", tone: "green" },
  forfeited: { label: "Forfeited", tone: "red" },
  rejected: { label: "Rejected", tone: "red" },
};

function PayoutsTab({ canChange }: { canChange: boolean }) {
  const t = useAdminTheme();
  const [status, setStatus] = useState<string>("");
  const [rows, setRows] = useState<AdminPrize[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(() => {
    getPrizes(status || undefined)
      .then((d) => setRows(d.prizes))
      .catch((e) => setError(e?.message || "Couldn't load the prizes."));
  }, [status]);
  useEffect(load, [load]);

  const run = async (id: string, fn: () => Promise<{ auditEvent: string; request?: { number: string } }>, text: string) => {
    setBusy(id);
    setError("");
    setDone("");
    try {
      const r = await fn();
      setDone(`${text}${r.request ? ` Waiting in Approvals as ${r.request.number}.` : ""} Recorded as ${r.auditEvent}.`);
      setNote("");
      load();
    } catch (e: any) {
      setError(e?.message || "That didn't work.");
    } finally {
      setBusy(null);
    }
  };
  const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const input = { height: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft, fontFamily: FONTS.regular, fontSize: 14, color: t.text, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) };

  return (
    <View style={{ gap: 16 }}>
      {error ? <Notice icon="alert-circle-outline" tone="red" text={error} /> : null}
      {done ? <Notice icon="checkmark-circle-outline" tone="green" text={done} /> : null}
      <Card>
        <CardHeader
          title="Prizes and payouts"
          subtitle="Winners claim with identity, payout details and the tax form. Check the claim, request the payout (a second admin approves; the finance approver above the limit), wait for the hold, then mark it paid with the reference."
          right={
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <Select<string> value={status} options={[{ value: "", label: "All" }, ...Object.entries(PRIZE_STATUS).map(([value, s]) => ({ value, label: s.label }))]} onChange={setStatus} minWidth={170} />
              {Platform.OS === "web" ? <Button label="Export CSV" icon="download-outline" onPress={() => downloadPrizesCsv().catch((e) => setError(e.message))} /> : null}
            </View>
          }
        />
        {canChange ? (
          <View style={{ marginTop: 12 }}>
            <TextInput value={note} onChangeText={setNote} placeholder="Reason (to reject) or payment reference (to mark paid)" placeholderTextColor={t.faint} style={input} accessibilityLabel="Reason or payment reference" />
          </View>
        ) : null}
        {!rows ? (
          <Loading />
        ) : !rows.length ? (
          <Text style={{ marginTop: 14, fontFamily: FONTS.regular, fontSize: 14, color: t.muted }}>No prizes here yet. Prizes appear when results with a prize amount are published.</Text>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            {rows.map((p) => {
              const holdOver = p.holdUntil ? new Date(p.holdUntil) <= new Date() : false;
              return (
                <View key={p.id} style={{ gap: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardSoft }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <Pill label={PRIZE_STATUS[p.status].label} tone={PRIZE_STATUS[p.status].tone} />
                    <Text style={{ fontFamily: FONTS.semibold, fontSize: 14, color: t.text }}>{p.number} · {p.member}</Text>
                    <Text style={{ flex: 1, minWidth: 200, fontFamily: FONTS.regular, fontSize: 13, color: t.muted }}>
                      {p.quest.title} · place {p.place}
                    </Text>
                    <Text style={{ fontFamily: FONTS.bold, fontSize: 15, color: t.text }}>{usd(p.amountCents)}</Text>
                  </View>
                  <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: t.muted }}>
                    {p.identity ? `${p.identity.legalName}${p.identity.dateOfBirth ? ` · born ${p.identity.dateOfBirth}` : ""}` : `Claim by ${new Date(p.claimDeadline).toLocaleDateString()}`}
                    {p.payoutMethod ? ` · ${p.payoutMethod.type === "ach" ? `ACH ••••${p.payoutMethod.accountLast4} (routing ••••${p.payoutMethod.routingLast4})` : `Check to ${p.payoutMethod.mailingAddress}`}` : ""}
                    {p.tax.form ? ` · ${p.tax.form === "w9" ? "W-9" : "W-8BEN"} ${p.tax.status}${p.tax.tinLast4 ? ` ••••${p.tax.tinLast4}` : ""}${p.tax.country && p.tax.form === "w8ben" ? ` (${p.tax.country})` : ""}` : ""}
                    {p.holdUntil && p.status === "held" ? ` · hold until ${new Date(p.holdUntil).toLocaleDateString()}` : ""}
                    {p.paymentRef ? ` · ref ${p.paymentRef}` : ""}
                    {p.rejectedReason ? ` · ${p.rejectedReason}` : ""}
                  </Text>
                  {canChange ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {p.status === "submitted" ? <Button label="Verify claim" variant="primary" icon="checkmark-outline" loading={busy === p.id} onPress={() => run(p.id, () => verifyPrize(p.id), `${p.number} verified.`)} /> : null}
                      {p.status === "verified" ? <Button label="Request payout" variant="primary" icon="send-outline" loading={busy === p.id} onPress={() => run(p.id, () => requestPrizePayout(p.id), `Payout for ${p.number} requested.`)} /> : null}
                      {p.status === "held" ? <Button label={holdOver ? "Mark paid" : "On hold"} variant="primary" icon="cash-outline" loading={busy === p.id} disabled={!holdOver || note.trim().length < 3} onPress={() => run(p.id, () => markPrizePaid(p.id, note.trim()), `${p.number} marked paid.`)} /> : null}
                      {["awaiting_claim", "submitted", "verified"].includes(p.status) ? <Button label="Reject" variant="ghost" icon="close-outline" loading={busy === p.id} disabled={note.trim().length < 3} onPress={() => run(p.id, () => rejectPrize(p.id, note.trim()), `${p.number} rejected.`)} /> : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </View>
  );
}
