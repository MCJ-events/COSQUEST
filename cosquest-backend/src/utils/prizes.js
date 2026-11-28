// Prizes: from published results to money paid (PrizeClaim contract, 27 Nov 2026).
//   createForResults()  results published -> one claim per winner with a prize amount (90 days to claim)
//   claim()             the winner: identity and 18+, payout details, tax form (encrypted)
//   verify() / reject() an admin checks the claim
//   requestPayout()     a payout request in Approvals (a second admin; the finance approver
//                       too when the amount is above the payout approval limit)
//   checkPayoutApproval() / applyApproved() / payoutRejected()   called by approvals.decide
//   markPaid()          after the hold: paid with a reference; ledger entries
//   forfeitDue()        unclaimed after the deadline -> forfeited (hourly job)
// Ledger (money book): results published -> settlement (settlement.js): 2010 > 2020 prizes, 2010 > 4020 rest;
//                      paid -> "Prize paid" 2020 Payouts Payable / 1010 Stripe Clearing;
//                      forfeited or rejected -> "Prize returned" 2020 / 4020.
const PrizeClaim = require('../models/PrizeClaim');
const ApprovalRequest = require('../models/ApprovalRequest');
const Counter = require('../models/Counter');
const User = require('../models/User');
const Quest = require('../models/Quest');
const ledger = require('./ledger');
const crypto = require('./payeeCrypto');

const CLAIM_DAYS = () => Number.parseInt(process.env.PRIZE_CLAIM_DAYS, 10) > 0 ? Number.parseInt(process.env.PRIZE_CLAIM_DAYS, 10) : 90;
const HOLD_DAYS = () => (Number.parseInt(process.env.PRIZE_HOLD_DAYS, 10) >= 0 && process.env.PRIZE_HOLD_DAYS !== undefined && process.env.PRIZE_HOLD_DAYS !== '' ? Number.parseInt(process.env.PRIZE_HOLD_DAYS, 10) : 7);
const DAY = 24 * 3600e3;

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}
const step = (status, by, note = '') => ({ at: new Date(), status, by: String(by || 'system'), note: String(note).slice(0, 300) });
const label = (c) => `PC-${c.number}`;

/** Results published: a claim for every winner with a prize amount (once). */
async function createForResults(quest, result, { formulaVersion = null } = {}) {
  const made = [];
  for (const w of result.winners || []) {
    if (!(w.prizeCents > 0)) continue;
    try {
      const claim = await PrizeClaim.create({
        number: await Counter.next('prizeClaim', 1000),
        quest: quest._id,
        ticket: w.ticket,
        user: w.user,
        place: w.place,
        points: w.points ?? null,
        amountCents: w.prizeCents,
        currency: (quest.prizePool?.currency || 'USD').toUpperCase(),
        scoringVersion: quest.scoring?.version || null,
        formulaVersion,
        resultsPublishedAt: result.publishedAt || new Date(),
        claimDeadline: new Date((result.publishedAt || new Date()).getTime() + CLAIM_DAYS() * DAY),
        history: [step('awaiting_claim', 'system', 'results published')],
      });
      made.push(claim);
      require('./notifyPrize').toClaim(claim, quest.title).catch(() => {});
    } catch (error) {
      if (error?.code !== 11000) throw error; // already created
    }
  }
  return made;
}

const masked = (c, { admin = false } = {}) => ({
  id: String(c._id),
  number: label(c),
  quest: c.quest?.title ? { id: String(c.quest._id), title: c.quest.title } : { id: String(c.quest) },
  ...(admin && c.user?.profile ? { member: `@${c.user.profile.username}`, userId: String(c.user._id) } : {}),
  place: c.place,
  points: c.points,
  amountCents: c.amountCents,
  currency: c.currency,
  status: c.status,
  claimDeadline: c.claimDeadline,
  identity: c.identity?.legalName ? { legalName: c.identity.legalName, dateOfBirth: admin ? c.identity.dateOfBirth : null } : null,
  payoutMethod: c.payoutMethod?.type ? { type: c.payoutMethod.type, accountHolder: c.payoutMethod.accountHolder, accountLast4: c.payoutMethod.accountLast4, routingLast4: c.payoutMethod.routingLast4, mailingAddress: c.payoutMethod.mailingAddress } : null,
  tax: { form: c.tax?.form || null, status: c.tax?.status || 'missing', tinLast4: c.tax?.tinLast4 || null, country: c.tax?.country || null },
  holdUntil: c.holdUntil,
  paidAt: c.paidAt,
  paymentRef: c.paymentRef,
  rejectedReason: c.rejectedReason,
  ...(admin ? { history: c.history } : {}),
});

function ageOn(dob, now = new Date()) {
  const [y, m, d] = String(dob).split('-').map(Number);
  if (!y || !m || !d) return -1;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

/** The winner claims: { legalName, dateOfBirth: 'YYYY-MM-DD', payout: {...}, tax: {...}, certify: true } */
async function claim(userId, claimId, body = {}) {
  if (!crypto.ready()) fail(503, 'Prize claims are not set up on this server yet.', 'not_configured');
  const c = await PrizeClaim.findOne({ _id: claimId, user: userId });
  if (!c) fail(404, 'Prize not found.');
  if (c.status !== 'awaiting_claim') fail(409, 'This prize has already been claimed.', 'already_claimed');
  if (c.claimDeadline < new Date()) fail(409, 'The claim deadline has passed.', 'deadline_passed');
  const legalName = String(body.legalName || '').trim().slice(0, 120);
  if (legalName.length < 3 || !legalName.includes(' ')) fail(400, 'Your full legal name, as on your ID.', 'bad_name');
  const dob = String(body.dateOfBirth || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || ageOn(dob) < 0 || ageOn(dob) > 120) fail(400, 'Date of birth as YYYY-MM-DD.', 'bad_dob');
  if (ageOn(dob) < 18) fail(403, 'Prizes can only be paid to people aged 18 or over.', 'too_young');
  if (body.certify !== true) fail(400, 'Please confirm the information is true and correct.', 'certify_required');

  const p = body.payout || {};
  let payoutMethod;
  let sensitive = {};
  if (p.type === 'ach') {
    const routing = String(p.routingNumber || '').replace(/\D/g, '');
    const account = String(p.accountNumber || '').replace(/\D/g, '');
    const holder = String(p.accountHolder || '').trim().slice(0, 120);
    if (routing.length !== 9) fail(400, 'The routing number has 9 digits.', 'bad_routing');
    if (account.length < 4 || account.length > 17) fail(400, 'The account number has 4 to 17 digits.', 'bad_account');
    if (holder.length < 3) fail(400, 'The account holder name is required.', 'bad_holder');
    payoutMethod = { type: 'ach', accountHolder: holder, routingLast4: routing.slice(-4), accountLast4: account.slice(-4), mailingAddress: null };
    sensitive = { routingNumber: routing, accountNumber: account };
  } else if (p.type === 'check') {
    const address = String(p.mailingAddress || '').trim().slice(0, 300);
    if (address.length < 10) fail(400, 'The full mailing address for the check.', 'bad_address');
    payoutMethod = { type: 'check', accountHolder: null, routingLast4: null, accountLast4: null, mailingAddress: address };
  } else fail(400, 'Choose bank transfer (ach) or check.', 'bad_payout');

  const t = body.tax || {};
  const tin = String(t.tin || '').replace(/[^0-9A-Za-z]/g, '');
  let tax;
  if (t.form === 'w9') {
    if (!/^\d{9}$/.test(tin)) fail(400, 'Your SSN or EIN has 9 digits.', 'bad_tin');
    tax = { form: 'w9', status: 'received', tinLast4: tin.slice(-4), country: 'US', receivedAt: new Date() };
  } else if (t.form === 'w8ben') {
    const country = String(t.country || '').trim().slice(0, 60);
    if (country.length < 2) fail(400, 'Your country of tax residence.', 'bad_country');
    if (tin && (tin.length < 4 || tin.length > 30)) fail(400, 'Your foreign tax ID looks wrong.', 'bad_tin');
    tax = { form: 'w8ben', status: 'received', tinLast4: tin ? tin.slice(-4) : null, country, receivedAt: new Date() };
  } else fail(400, 'Choose the W-9 (US person) or W-8BEN (not a US person) form.', 'bad_tax_form');

  const updated = await PrizeClaim.findOneAndUpdate(
    { _id: c._id, status: 'awaiting_claim' },
    {
      $set: {
        status: 'submitted',
        identity: { legalName, dateOfBirth: dob, confirmedAt: new Date() },
        payoutMethod: { ...payoutMethod, encrypted: Object.keys(sensitive).length ? crypto.seal(sensitive) : null },
        tax: { ...tax, encrypted: tin ? crypto.seal({ tin }) : null },
      },
      $push: { history: step('submitted', `member:${userId}`) },
    },
    { new: true }
  );
  if (!updated) fail(409, 'This prize has already been claimed.', 'already_claimed');
  return updated;
}

async function adminMove(admin, claimId, from, to, extra = {}, note = '') {
  const updated = await PrizeClaim.findOneAndUpdate(
    { _id: claimId, status: { $in: [].concat(from) } },
    { $set: { status: to, ...extra }, $push: { history: step(to, `admin:${admin._id}`, note) } },
    { new: true }
  );
  if (!updated) {
    const c = await PrizeClaim.findById(claimId).lean();
    if (!c) fail(404, 'Prize not found.');
    fail(409, `This prize is ${c.status.replace(/_/g, ' ')}: that step isn't possible now.`, 'wrong_status');
  }
  return updated;
}

const verify = (admin, id) => adminMove(admin, id, 'submitted', 'verified', { verifiedBy: admin._id, verifiedAt: new Date(), 'tax.status': 'verified' });

async function reject(admin, id, reason) {
  const why = String(reason || '').trim();
  if (why.length < 3) fail(400, 'A reason is required.', 'reason_required');
  const c = await adminMove(admin, id, ['awaiting_claim', 'submitted', 'verified'], 'rejected', { rejectedReason: why.slice(0, 300) }, why);
  await require('./settlement').unpaidPrize(c, 'rejected');
  return c;
}

async function requestPayout(admin, id, reason = '') {
  const c = await PrizeClaim.findById(id).populate('quest', 'title').populate('user', 'profile.username');
  if (!c) fail(404, 'Prize not found.');
  if (c.status !== 'verified') fail(409, 'Only a verified claim can be paid.', 'wrong_status');
  if (c.tax?.status !== 'verified') fail(409, 'The tax form must be verified first.', 'tax_missing');
  if (String(c.user?._id || c.user) === String(admin._id)) fail(403, "You can't request the payout of your own prize: another admin must.", 'own_prize');
  const nth = c.place === 1 ? '1st' : c.place === 2 ? '2nd' : c.place === 3 ? '3rd' : `${c.place}th`;
  const why = String(reason || '').trim() || `Prize for ${nth} place in ${c.quest?.title || 'the quest'}`;
  const request = await ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'payout',
    title: `Payout ${label(c)}: $${(c.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} to @${c.user?.profile?.username}`.slice(0, 160),
    changes: { prizeId: String(c._id), number: label(c), member: `@${c.user?.profile?.username}`, amountCents: c.amountCents, quest: c.quest?.title || '' },
    reason: why.slice(0, 500),
    requestedBy: admin._id,
  });
  await adminMove(admin, id, 'verified', 'payout_requested', { approval: request._id }, `AP-${request.number}`);
  return request;
}

/** Before a payout is approved: the claim is still waiting, and above the limit only the finance approver may approve. */
async function checkPayoutApproval(request, admin) {
  const c = await PrizeClaim.findById(request.changes?.prizeId).lean();
  if (!c || c.status !== 'payout_requested') fail(409, 'This prize is no longer waiting for a payout.', 'wrong_status');
  if (String(c.user) === String(admin._id)) fail(403, "You can't approve the payout of your own prize.", 'own_prize');
  const limit = (await require('./paymentSettings').current()).payoutApprovalLimitCents;
  if (limit !== null && limit !== undefined && c.amountCents > limit && admin.platformRole !== 'finance') {
    fail(403, `Above the payout approval limit ($${(limit / 100).toLocaleString('en-US')}): the finance approver must approve this payout.`, 'finance_required');
  }
}

async function applyApproved(request, admin) {
  const c = await PrizeClaim.findOneAndUpdate(
    { _id: request.changes?.prizeId, status: 'payout_requested' },
    { $set: { status: 'held', holdUntil: new Date(Date.now() + HOLD_DAYS() * DAY) }, $push: { history: { $each: [step('approved', `admin:${admin._id}`, `AP-${request.number}`), step('held', 'system', `until the dispute window clears (${HOLD_DAYS()} days)`)] } } },
    { new: true }
  );
  if (!c) return;
  // The money was booked when results were published (settlement.js): approval books nothing.
  require('./notifyPrize').approved(c).catch(() => {});
}

async function payoutRejected(request, admin) {
  await PrizeClaim.updateOne({ _id: request.changes?.prizeId, status: 'payout_requested' }, { $set: { status: 'verified', approval: null }, $push: { history: step('verified', `admin:${admin._id}`, `payout AP-${request.number} rejected`) } });
}

async function markPaid(admin, id, reference) {
  const ref = String(reference || '').trim();
  if (ref.length < 3) fail(400, 'The payment reference (ACH trace or check number) is required.', 'reference_required');
  const c = await PrizeClaim.findById(id).lean();
  if (!c) fail(404, 'Prize not found.');
  if (c.status !== 'held') fail(409, 'Only an approved prize can be marked paid.', 'wrong_status');
  if (c.holdUntil > new Date()) fail(409, `On hold until ${c.holdUntil.toISOString().slice(0, 10)} (dispute window).`, 'on_hold');
  const paid = await adminMove(admin, id, 'held', 'paid', { paidAt: new Date(), paymentRef: ref.slice(0, 80) }, ref);
  await ledger.record({
    key: `prize-paid-${c._id}`,
    kind: 'prize.paid',
    book: 'money',
    currency: c.currency,
    lines: [{ account: ledger.ACCOUNTS.payoutsPayable, debit: c.amountCents }, { account: ledger.ACCOUNTS.stripeClearing, credit: c.amountCents }],
    user: c.user,
    quest: c.quest,
    processorRef: ref.slice(0, 80),
    memo: `${label(c)}: prize paid (${c.payoutMethod?.type === 'check' ? 'check' : 'bank transfer'} ${ref})`.slice(0, 300),
    createdBy: admin._id,
  });
  require('./notifyPrize').paid(paid).catch(() => {});
  return paid;
}

async function forfeitDue() {
  const due = await PrizeClaim.find({ status: 'awaiting_claim', claimDeadline: { $lt: new Date() } }).select('_id').limit(200).lean();
  for (const c of due) {
    const r = await PrizeClaim.updateOne({ _id: c._id, status: 'awaiting_claim' }, { $set: { status: 'forfeited' }, $push: { history: step('forfeited', 'system', 'claim deadline passed') } });
    if (r.modifiedCount) await require('./settlement').unpaidPrize(await PrizeClaim.findById(c._id).lean(), 'forfeited');
  }
  return due.length;
}

async function mine(userId) {
  const rows = await PrizeClaim.find({ user: userId }).sort({ createdAt: -1 }).populate('quest', 'title').limit(100).lean();
  return rows.map((c) => masked(c));
}

async function list({ status } = {}) {
  const filter = status && PrizeClaim.STATUSES.includes(status) ? { status } : {};
  const rows = await PrizeClaim.find(filter).sort({ createdAt: -1 }).populate('quest', 'title').populate('user', 'profile.username').limit(300).lean();
  return rows.map((c) => masked(c, { admin: true }));
}

/** Super admins only (audited by the controller): the full bank and tax numbers. */
async function reveal(id) {
  const c = await PrizeClaim.findById(id).lean();
  if (!c) fail(404, 'Prize not found.');
  return { payout: crypto.open(c.payoutMethod?.encrypted), tax: crypto.open(c.tax?.encrypted) };
}

module.exports = { createForResults, claim, verify, reject, requestPayout, checkPayoutApproval, applyApproved, payoutRejected, markPaid, forfeitDue, mine, list, reveal, masked, ageOn };
