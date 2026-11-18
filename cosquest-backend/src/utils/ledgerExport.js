// The ledger as finance's sheets (CosQuest Sample Ledger): the same columns,
// in the same order, one file per book.
//
//   Cash Ledger:     Txn id, Timestamp (UTC), User id, Type, Quest id, Item id, Description,
//                    Debit account, Credit account, Amount (cents), Amount (USD), Processor ref,
//                    Status, Jurisdiction, Price version, Formula version, Approver
//   CosCoin Ledger: Txn id, Timestamp (UTC), User id, Type, Item id, Description,
//                    Debit account, Credit account, CosCoin, Linked cash txn, Status, Price version
//
// One row = one debit account and one credit account, as in the sheet. A
// transaction with more lines (one debit, several credits, or the other way
// round) becomes one row per pair; anything else, one row per line with the
// other side left empty, so totals always match the ledger.
const chart = require('./ledgerAccounts');

const CASH_HEADERS = ['Txn id', 'Timestamp (UTC)', 'User id', 'Type', 'Quest id', 'Item id', 'Description', 'Debit account', 'Credit account', 'Amount (cents)', 'Amount (USD)', 'Processor ref', 'Status', 'Jurisdiction', 'Price version', 'Formula version', 'Approver'];
const COSTCOIN_HEADERS = ['Txn id', 'Timestamp (UTC)', 'User id', 'Type', 'Item id', 'Description', 'Debit account', 'Credit account', 'CosCoin', 'Linked cash txn', 'Status', 'Price version'];

/** [{ debit, credit, amount }]: the debit / credit pairs of a transaction. */
function pairs(lines) {
  const debits = lines.filter((l) => l.debit > 0);
  const credits = lines.filter((l) => l.credit > 0);
  if (debits.length === 1) return credits.map((c) => ({ debit: debits[0].account, credit: c.account, amount: c.credit }));
  if (credits.length === 1) return debits.map((d) => ({ debit: d.account, credit: credits[0].account, amount: d.debit }));
  return [...debits.map((d) => ({ debit: d.account, credit: null, amount: d.debit })), ...credits.map((c) => ({ debit: null, credit: c.account, amount: c.credit }))];
}

const timestamp = (date) => new Date(date).toISOString().replace('T', ' ').slice(0, 19);
const usd = (cents) => (cents / 100).toFixed(2);

/**
 * The rows of one book's sheet (arrays of cell values, headers first).
 * names: { users: { id: username }, quests: { id: title }, txs: { id: 'TX-12' } }
 */
function financeRows(txs, book, names = {}) {
  const users = names.users || {};
  const quests = names.quests || {};
  const txLabels = names.txs || {};
  const labels = { questLabels: quests, userLabels: users };
  const account = (id) => (id ? chart.describe(id, labels).label : '');
  const who = (id) => (id ? users[String(id)] || String(id) : '');
  const rows = [book === 'costcoin' ? COSTCOIN_HEADERS : CASH_HEADERS];
  for (const tx of txs) {
    const type = require('./ledger').typeOf(tx.kind);
    const label = `TX-${tx.number}`;
    for (const p of pairs(tx.lines)) {
      if (book === 'costcoin') {
        rows.push([label, timestamp(tx.createdAt), who(tx.user), type, tx.itemId || '', tx.memo || '', account(p.debit), account(p.credit), p.amount, tx.linkedTx ? txLabels[String(tx.linkedTx)] || String(tx.linkedTx) : '', tx.status || 'posted', tx.priceVersion || '']);
      } else {
        rows.push([label, timestamp(tx.createdAt), who(tx.user), type, tx.quest ? quests[String(tx.quest)] || String(tx.quest) : '', tx.itemId || '', tx.memo || '', account(p.debit), account(p.credit), p.amount, usd(p.amount), tx.processorRef || '', tx.status || 'posted', tx.jurisdiction || '', tx.priceVersion || '', tx.formulaVersion || '', (tx.approvedBy || []).map(who).join(' + ')]);
      }
    }
  }
  return rows;
}

/** Spreadsheet-safe CSV (quoted; formulas neutralised), with a BOM so Excel reads UTF-8. */
function toCsv(rows) {
  const cell = (value) => {
    const s = value == null ? '' : String(value);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { CASH_HEADERS, COSTCOIN_HEADERS, pairs, financeRows, toCsv };
