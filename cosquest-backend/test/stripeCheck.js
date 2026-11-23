// The daily Stripe check: the comparison (no server or Stripe needed).
const { compare } = require('../src/utils/stripeReconcile');

async function run() {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  const sale = (number, pi, cents) => ({ number, processorRef: pi, lines: [{ account: '1010', debit: cents, credit: 0 }, { account: '2010:q', debit: 0, credit: cents }] });
  const fee = (pi, cents) => ({ processorRef: pi, lines: [{ account: '5010', debit: cents, credit: 0 }, { account: '1010', debit: 0, credit: cents }] });
  const stripeRows = [
    { type: 'charge', amount: 1200, fee: 65, paymentIntent: 'pi_a' },
    { type: 'charge', amount: 400, fee: 42, paymentIntent: 'pi_b' },
    { type: 'refund', amount: -1200, fee: 0, paymentIntent: 'pi_old' },
    { type: 'payout', amount: -5000, fee: 0, paymentIntent: null },
  ];
  const good = await compare({ stripeRows, sales: [sale(1, 'pi_a', 1200), sale(2, 'pi_b', 400)], fees: [fee('pi_a', 65), fee('pi_b', 42)], daySales: [sale(1, 'pi_a', 1200), sale(2, 'pi_b', 400)], paidInStripe: async () => true });
  check(good.ok && good.totals.stripe.received === 1600 && good.totals.stripe.fees === 107 && good.totals.stripe.refunds === 1200 && good.totals.stripe.payoutsToBank === 5000, 'everything matches: PASS, totals side by side', good);
  const missing = await compare({ stripeRows, sales: [sale(1, 'pi_a', 1200)], fees: [fee('pi_a', 65)], daySales: [sale(1, 'pi_a', 1200)], paidInStripe: async () => true });
  check(!missing.ok && missing.problems.some((p) => p.kind === 'missing_in_ledger' && p.ref === 'pi_b'), 'a Stripe payment with no sale in the ledger: FAIL', missing.problems);
  const differs = await compare({ stripeRows, sales: [sale(1, 'pi_a', 1000), sale(2, 'pi_b', 400)], fees: [fee('pi_a', 60), fee('pi_b', 42)], daySales: [], paidInStripe: async () => true });
  check(differs.problems.some((p) => p.kind === 'amount_differs') && differs.problems.some((p) => p.kind === 'fee_differs'), 'a different amount and a different fee: FAIL', differs.problems);
  const ghost = await compare({ stripeRows, sales: [sale(1, 'pi_a', 1200), sale(2, 'pi_b', 400)], fees: [fee('pi_a', 65), fee('pi_b', 42)], daySales: [sale(9, 'pi_ghost', 999)], paidInStripe: async (pi) => pi !== 'pi_ghost' });
  check(ghost.problems.some((p) => p.kind === 'not_paid_in_stripe' && p.ref === 'pi_ghost'), 'a recorded sale Stripe never received: FAIL', ghost.problems);
  const midnight = await compare({ stripeRows, sales: [sale(1, 'pi_a', 1200), sale(2, 'pi_b', 400)], fees: [fee('pi_a', 65), fee('pi_b', 42)], daySales: [sale(8, 'pi_lastnight', 500)], paidInStripe: async () => true });
  check(midnight.ok, 'a sale paid just before midnight (in Stripe the day before): not a problem', midnight.problems);
  console.log(`\nstripe check: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
