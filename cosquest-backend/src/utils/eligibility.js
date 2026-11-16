// Can this member pay for this? (Payment brief 6.4: checked by the server,
// BEFORE any payment screen: when the link is made, when the website opens
// it, and in tickets.startCheckout, which every way of paying goes through.
// If a signal is missing or unclear: blocked.)
//
//   PAYMENTS_ELIGIBILITY      'test' or 'live'. Default: live with a live
//                             Stripe key (sk_live_...), otherwise test.
//   PAID_MIN_AGE              18 (paid quests are 18+).
//   PAYMENTS_ALLOWED_REGIONS  live mode: the regions legal approved, e.g.
//                             "US-CA,US-NY" (comma list). Empty: nowhere.
//
// Test mode (Stripe sandbox, test cards, no real money): the region rule is
// off, so the team can test from anywhere. Age always applies.
//
// Region: the member's US state needs a location service the team hasn't
// chosen yet (an IP address alone is only city level, and a phone's GPS can
// be faked). Until resolveRegion() is connected to one, live mode blocks
// paid actions with reason 'missing_signals': the brief's "fail closed".
const MIN_AGE = () => Number(process.env.PAID_MIN_AGE) || 18;

function mode() {
  const set = String(process.env.PAYMENTS_ELIGIBILITY || '').toLowerCase();
  if (set === 'test' || set === 'live') return set;
  return String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'live' : 'test';
}

/** Whole years from account.dateOfBirth (YYYY-MM-DD), else profile.age, else null. */
function ageOf(user, now = new Date()) {
  const dob = user?.account?.dateOfBirth;
  if (dob && /^\d{4}-\d{2}-\d{2}/.test(dob)) {
    const born = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(born.getTime())) {
      let years = now.getUTCFullYear() - born.getUTCFullYear();
      const before = now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
      if (before) years -= 1;
      if (years >= 0 && years < 130) return years;
    }
  }
  const age = Number(user?.profile?.age);
  return Number.isFinite(age) && age > 0 && age < 130 ? age : null;
}

/** The member's region (e.g. "US-CA"), or null when it can't be confirmed. Connect a location service here. */
async function resolveRegion(/* user, { ip, position } */) {
  return null;
}

const allowedRegions = () => String(process.env.PAYMENTS_ALLOWED_REGIONS || '').split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);

// A quest is paid if its entry fee is, or any ticket type for it is (an
// admin can add a paid VIP ticket to a free quest).
async function hasPaidTickets(quest) {
  if (Number(quest.entryFee?.amount) > 0) return true;
  return Boolean(await require('../models/TicketType').exists({ quest: quest._id, 'price.amount': { $gt: 0 } }));
}

/**
 * { allowed: true } or { allowed: false, reason, code, message }.
 * reason: 'age' | 'region' | 'missing_signals'. Free: always allowed.
 * paid: whether this purchase costs money (checkout knows the ticket type);
 * left out, the quest is checked as a whole.
 */
async function checkEligibility(user, { quest = null, paid = null, ip = null, position = null } = {}) {
  const costs = paid ?? (quest ? await hasPaidTickets(quest) : true);
  if (!costs) return { allowed: true, mode: mode() };

  const age = ageOf(user);
  if (age == null) {
    return { allowed: false, reason: 'age', code: 'age_unknown', message: 'Add your date of birth in Settings to join paid quests.', mode: mode() };
  }
  if (age < MIN_AGE()) {
    return { allowed: false, reason: 'age', code: 'too_young', message: `Paid quests are for members aged ${MIN_AGE()} and over.`, mode: mode() };
  }

  if (mode() === 'test') return { allowed: true, mode: 'test' };

  const region = await resolveRegion(user, { ip, position });
  if (!region) {
    return { allowed: false, reason: 'missing_signals', code: 'location_unconfirmed', message: "We can't confirm where you are, so paid quests aren't available right now.", mode: 'live' };
  }
  // The admin's region table (two-person approved); PAYMENTS_ALLOWED_REGIONS only while it's empty.
  const RegionRule = require('../models/RegionRule');
  const rule = await RegionRule.findOne({ region: region.toUpperCase() }).lean();
  const useTable = rule || (await RegionRule.estimatedDocumentCount()) > 0;
  const regionAllowed = useTable ? rule?.status === 'allowed' : allowedRegions().includes(region.toUpperCase());
  if (!regionAllowed) {
    return { allowed: false, reason: 'region', code: 'region_blocked', message: "Paid quests aren't available where you are.", mode: 'live', region };
  }
  return { allowed: true, mode: 'live', region };
}

module.exports = { checkEligibility, ageOf, mode, MIN_AGE, resolveRegion };
