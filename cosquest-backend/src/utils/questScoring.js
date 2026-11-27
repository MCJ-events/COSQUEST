// How a quest's points are scored (legal plan, section 4: skill must decide the winner).
//   - published before ticket sales open: a paid quest can't be published without it
//   - locked once the quest is published (or anyone is registered): never changed afterwards
//   - shown to buyers at checkout; its version is saved on each ticket order
const TIE_BREAKS = {
  earliest_completion: 'The player who completed the quest earlier wins the tie.',
  split_prize: 'Tied players share the prize equally.',
};

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

/** From the admin form: { rules, tieBreak } (validated), or undefined when not sent. */
function read(body) {
  if (body.scoring === undefined || body.scoring === null) return undefined;
  if (typeof body.scoring !== 'object') fail(400, 'scoring must be { rules, tieBreak }.');
  const rules = String(body.scoring.rules || '').replace(/\r\n/g, '\n').trim();
  if (rules.length > 4000) fail(400, 'How points are scored: 4,000 characters at most.');
  const tieBreak = body.scoring.tieBreak || 'earliest_completion';
  if (!TIE_BREAKS[tieBreak]) fail(400, `tieBreak must be one of: ${Object.keys(TIE_BREAKS).join(', ')}.`);
  return { rules, tieBreak };
}

const same = (a, b) => (a?.rules || '') === (b?.rules || '') && (a?.tieBreak || 'earliest_completion') === (b?.tieBreak || 'earliest_completion');

/** Locked once ticket sales are open: the quest is published, or someone is registered. */
const locked = (quest) => Boolean(quest.isPublished) || (quest.registrationCount || 0) > 0;

/** The next scoring to save on an existing quest (undefined when unchanged). */
function next(quest, wanted) {
  if (wanted === undefined || same(quest.scoring, wanted)) return undefined;
  if (locked(quest)) fail(409, "How points are scored is locked once ticket sales open (published or anyone registered). It can't change now.");
  return { ...wanted, version: (quest.scoring?.version || 0) + 1, lockedAt: null };
}

/** For a new quest. */
const initial = (wanted) => (wanted && wanted.rules ? { ...wanted, version: 1, lockedAt: null } : undefined);

/** Before publishing: a paid quest must say how points are scored. */
async function checkPublish(quest) {
  const TicketType = require('../models/TicketType');
  const paid = (quest.entryFee?.amount || 0) > 0 || (quest._id && (await TicketType.exists({ quest: quest._id, 'price.amount': { $gt: 0 } })));
  if (paid && (quest.scoring?.rules || '').length < 20) {
    fail(409, 'Add how points are scored (at least a sentence) before publishing a paid quest: the official rules require it before ticket sales open.');
  }
}

function json(quest) {
  const s = quest?.scoring;
  if (!s || !s.rules) return null;
  return { rules: s.rules, tieBreak: s.tieBreak || 'earliest_completion', tieBreakText: TIE_BREAKS[s.tieBreak || 'earliest_completion'], version: s.version || 1, lockedAt: s.lockedAt || null };
}

module.exports = { TIE_BREAKS, read, next, initial, checkPublish, json, locked };
