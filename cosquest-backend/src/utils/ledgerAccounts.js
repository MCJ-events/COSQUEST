// The chart of accounts (finance's CosQuest Sample Ledger, "Chart of Accounts").
//
//   Book money (US cents):
//     1010  Stripe Clearing    Asset      money held by or owed to us through Stripe
//     2010  Quest Pool         Liability  entry fees held for one quest until settlement (one per quest: 2010:<questId>)
//     2020  Payouts Payable    Liability  winner shares approved but not yet paid out
//     4010  CosCoin Sales     Revenue    money received for CosCoin bundles (revenue timing: the accountant decides)
//     4020  Platform Fees      Revenue    CosQuest's share of each quest pool
//     5010  Stripe Fees        Expense    processor fees
//   Book costcoin (coins):
//     CC-ISSUED  CosCoin Issued  Contra     coins created by purchases
//     CC-WALLET  Wallet           Liability  a player's balance (one per user: CC-WALLET:<userId>)
//     CC-SPENT   CosCoin Spent   Contra     coins used on skins, weapons, faction switches...
//
// The ledger is append-only, so entries written before this chart keep their
// old names (processor_clearing, quest_pool:<id>, ...). They mean the same
// accounts and are READ under the new codes (normalize), so balances and
// exports show one chart.
const CHART = [
  { code: '1010', name: 'Stripe Clearing', type: 'Asset', book: 'money', normal: 'debit', meaning: 'Money held by or owed to us through Stripe' },
  { code: '2010', name: 'Quest Pool', type: 'Liability', book: 'money', normal: 'credit', per: 'quest', meaning: 'Entry fees held for one quest until settlement' },
  { code: '2020', name: 'Payouts Payable', type: 'Liability', book: 'money', normal: 'credit', meaning: 'Winner shares approved but not yet paid out' },
  { code: '4010', name: 'CosCoin Sales', type: 'Revenue', book: 'money', normal: 'credit', meaning: 'Money received for CosCoin bundles (revenue timing to be confirmed by the accountant)' },
  { code: '4020', name: 'Platform Fees', type: 'Revenue', book: 'money', normal: 'credit', meaning: 'Share of each quest pool kept by CosQuest' },
  { code: '5010', name: 'Stripe Fees', type: 'Expense', book: 'money', normal: 'debit', meaning: 'Processor fees' },
  // Not on finance's sample chart: number to confirm with finance.
  { code: '5020', name: 'Chargebacks', type: 'Expense', book: 'money', normal: 'debit', meaning: 'Money taken back by card disputes (returned if the dispute is won)' },
  { code: 'CC-ISSUED', name: 'CosCoin Issued', type: 'Contra', book: 'costcoin', normal: 'debit', meaning: 'Coins created by purchases' },
  { code: 'CC-WALLET', name: 'Wallet', type: 'Liability', book: 'costcoin', normal: 'credit', per: 'user', meaning: "A player's CosCoin balance (one account per user)" },
  { code: 'CC-SPENT', name: 'CosCoin Spent', type: 'Contra', book: 'costcoin', normal: 'credit', meaning: 'Coins used on skins, weapons, faction switches and similar' },
  { code: 'CC-REWARDS', name: 'CosCoin Rewards', type: 'Contra', book: 'costcoin', normal: 'debit', meaning: 'Coins earned in games (not bought): no money behind them' },
];
const BY_CODE = new Map(CHART.map((a) => [a.code, a]));

/** The account ids written on ledger lines. */
const ACCOUNTS = {
  stripeClearing: '1010',
  questPool: (questId) => `2010:${questId}`,
  payoutsPayable: '2020',
  costcoinSales: '4010',
  platformFees: '4020',
  stripeFees: '5010',
  chargebacks: '5020',
  costcoinIssued: 'CC-ISSUED',
  wallet: (userId) => `CC-WALLET:${userId}`,
  costcoinSpent: 'CC-SPENT',
  costcoinRewards: 'CC-REWARDS',
};

// Names used before the chart (same meaning).
const LEGACY = {
  processor_clearing: '1010',
  platform_revenue: '4020',
  payouts_payable: '2020',
  costcoin_issued: 'CC-ISSUED',
  costcoin_spent: 'CC-SPENT',
};

/** Any account id (new or old) -> the chart's id, e.g. 'quest_pool:abc' -> '2010:abc'. */
function normalize(account) {
  const value = String(account || '');
  if (LEGACY[value]) return LEGACY[value];
  if (value.startsWith('quest_pool:')) return `2010:${value.slice('quest_pool:'.length)}`;
  if (value.startsWith('user_costcoin:')) return `CC-WALLET:${value.slice('user_costcoin:'.length)}`;
  return value;
}

/** { id, code, of, name, label, type, book, normal } for an account id (new or old). */
function describe(account, { questLabels = {}, userLabels = {} } = {}) {
  const id = normalize(account);
  const [code, of] = id.includes(':') ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] : [id, null];
  const entry = BY_CODE.get(code);
  if (!entry) return { id, code, of, name: id, label: id, type: 'Unknown', book: null, normal: 'debit' };
  const owner = of ? (entry.per === 'quest' ? questLabels[of] : userLabels[of]) || of : null;
  const name = owner ? (entry.per === 'user' ? `${owner} ${entry.name}` : `${entry.name} ${owner}`) : entry.name;
  return { id, code, of, name, label: code.startsWith('CC-') ? name : `${code} ${name}`, type: entry.type, book: entry.book, normal: entry.normal };
}

/**
 * Raw per-account totals (any names) -> one row per chart account, old and
 * new names merged, with the balance on the account's normal side (as
 * finance's Balances sheet: a liability's balance is credits - debits).
 */
function mergeBalances(rows, labels = {}) {
  const merged = new Map();
  for (const row of rows) {
    const d = describe(row.account, labels);
    const key = `${row.book}|${row.currency}|${d.id}`;
    const into = merged.get(key) || { account: d.id, code: d.code, label: d.label, type: d.type, normal: d.normal, book: row.book, currency: row.currency, debits: 0, credits: 0 };
    into.debits += row.debits;
    into.credits += row.credits;
    merged.set(key, into);
  }
  return [...merged.values()]
    .map((r) => ({ ...r, balance: r.normal === 'credit' ? r.credits - r.debits : r.debits - r.credits }))
    .sort((a, b) => a.book.localeCompare(b.book) || a.account.localeCompare(b.account));
}

module.exports = { CHART, ACCOUNTS, LEGACY, normalize, describe, mergeBalances };
