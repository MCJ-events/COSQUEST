// A quest's status from the clock (Emmanuel's suggestion, like
// scheduledCallJson.js does for calls): only `draft` and `cancelled` are
// decisions stored on the quest. Everything else is worked out when read,
// so nothing goes stale and no timer job is needed:
//
//   before startsAt          upcoming
//   startsAt .. endsAt       live
//   from endsAt              completed
//
// The stored `status` field is kept (draft / upcoming / cancelled are the
// values written now; old rows may still say live or completed, which the
// clock overrides).
const STORED_DECISIONS = ['draft', 'cancelled'];

function effectiveStatus(quest, now = new Date()) {
  if (!quest) return null;
  if (STORED_DECISIONS.includes(quest.status)) return quest.status;
  const start = new Date(quest.startsAt).getTime();
  const end = new Date(quest.endsAt).getTime();
  const t = now.getTime();
  if (t < start) return 'upcoming';
  if (t < end) return 'live';
  return 'completed';
}

/** MongoDB conditions for an effective status (for list filters). */
function statusFilter(status, now = new Date()) {
  const notDecided = { status: { $nin: STORED_DECISIONS } };
  if (status === 'draft' || status === 'cancelled') return { status };
  if (status === 'upcoming') return { ...notDecided, startsAt: { $gt: now } };
  if (status === 'live') return { ...notDecided, startsAt: { $lte: now }, endsAt: { $gt: now } };
  if (status === 'completed') return { ...notDecided, endsAt: { $lte: now } };
  return {};
}

/** Members can register while it hasn't ended and isn't a draft or cancelled. */
function openForRegistration(now = new Date()) {
  return { status: { $nin: STORED_DECISIONS }, endsAt: { $gt: now } };
}

module.exports = { effectiveStatus, statusFilter, openForRegistration, STORED_DECISIONS };
