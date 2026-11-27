// Results by points (lock-in WE1, legal plan section 4: skill decides the winner).
//   setScore()      the game server reports points (verified), or an admin enters them (verified,
//                   with a reason); only ticket holders who may win can have a score
//   rank()          pure: highest points first; ties by the quest's published tie-break
//                   (earlier completion wins, or tied players share the prize)
//   prizesFor()     pure: prize amounts per place from the quest's prize pool and split
//   ranking()       the current ranking of a quest, with eligibility and suggested prizes
//   draftResults()  writes the results draft from the ranking (still reviewed, then published once)
const mongoose = require('mongoose');
const QuestScore = require('../models/QuestScore');
const QuestResult = require('../models/QuestResult');
const Ticket = require('../models/Ticket');

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** Who may win: in person, checked-in players; virtual, any ticket holder. */
const eligibleStatuses = (quest) => (quest.format === 'virtual' ? ['valid', 'checked_in'] : ['checked_in']);

async function setScore(quest, { userId, ticketId, points, completedAt, source, by, reason }) {
  const p = Number(points);
  if (!Number.isFinite(p) || p < 0 || p > 1e9) fail(400, 'Points are a number, 0 or more.', 'bad_points');
  const filter = ticketId ? { _id: ticketId, quest: quest._id } : { user: userId, quest: quest._id };
  const ticket = await Ticket.findOne({ ...filter, status: { $in: ['valid', 'checked_in'] } }).select('user status').lean();
  if (!ticket) fail(404, 'No ticket for this player in this quest.', 'no_ticket');
  if (source === 'admin' && String(reason || '').trim().length < 3) fail(400, 'A reason is required to enter points.', 'reason_required');
  const when = completedAt ? new Date(completedAt) : null;
  if (when && Number.isNaN(when.getTime())) fail(400, 'completedAt must be a date.', 'bad_date');
  const published = await QuestResult.exists({ quest: quest._id, publishedAt: { $ne: null } });
  if (published) fail(409, 'The results are published: points are locked.', 'published');
  return QuestScore.findOneAndUpdate(
    { quest: quest._id, user: ticket.user },
    {
      $set: { ticket: ticket._id, points: Math.round(p * 100) / 100, completedAt: when, source, verified: true },
      $push: { history: { $each: [{ at: new Date(), points: p, completedAt: when, source, by: String(by || source), reason: String(reason || '').slice(0, 200) }], $slice: -50 } },
    },
    { upsert: true, new: true }
  );
}

/** Pure ranking: [{ ...row, place, tied }] highest points first. */
function rank(rows, tieBreak = 'earliest_completion') {
  const ms = (d) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER);
  const sorted = rows.slice().sort((a, b) => b.points - a.points || (tieBreak === 'earliest_completion' ? ms(a.completedAt) - ms(b.completedAt) : 0));
  const out = [];
  sorted.forEach((r, i) => {
    const prev = out[i - 1];
    const sameAsPrev = prev && prev.points === r.points && (tieBreak === 'split_prize' || ms(prev.completedAt) === ms(r.completedAt));
    out.push({ ...r, place: sameAsPrev ? prev.place : i + 1, tied: false });
  });
  for (const r of out) r.tied = out.filter((x) => x.place === r.place).length > 1;
  return out;
}

/** Pure: prize cents per ranked row. Tied players share the prizes of the places they cover, equally. */
function prizesFor(ranked, poolCents, splitPct) {
  const split = (splitPct && splitPct.length ? splitPct : [100]).map(Number);
  const byPlace = split.map((pct) => Math.floor((poolCents * pct) / 100));
  const groups = new Map();
  for (const r of ranked) groups.set(r.place, [...(groups.get(r.place) || []), r]);
  const out = new Map();
  for (const [place, group] of groups) {
    const covered = byPlace.slice(place - 1, place - 1 + group.length).reduce((s, c) => s + c, 0);
    const each = Math.floor(covered / group.length);
    group.forEach((r) => out.set(String(r.ticket), each));
  }
  return out;
}

async function ranking(quest) {
  const tickets = await Ticket.find({ quest: quest._id, status: { $in: eligibleStatuses(quest) } }).select('user status').lean();
  const scores = await QuestScore.find({ quest: quest._id, verified: true }).lean();
  const byUser = new Map(scores.map((s) => [String(s.user), s]));
  const rows = tickets.filter((t) => byUser.has(String(t.user))).map((t) => {
    const s = byUser.get(String(t.user));
    return { ticket: String(t._id), user: String(t.user), points: s.points, completedAt: s.completedAt, source: s.source };
  });
  const tieBreak = quest.scoring?.tieBreak || 'earliest_completion';
  const ranked = rank(rows, tieBreak);
  const poolCents = Math.round((quest.prizePool?.amount || 0) * 100);
  const prizes = prizesFor(ranked, poolCents, quest.prizeSplitPct);
  return {
    tieBreak,
    scoringVersion: quest.scoring?.version || null,
    prizePoolCents: poolCents,
    prizeSplitPct: quest.prizeSplitPct?.length ? quest.prizeSplitPct : [100],
    withoutScore: tickets.length - rows.length,
    rows: ranked.map((r) => ({ ...r, prizeCents: prizes.get(r.ticket) || 0 })),
  };
}

/** Writes the draft results from the ranking: the places with a prize (or the top 3 when there is no prize pool). */
async function draftResults(quest, admin) {
  if (quest.endsAt > new Date()) fail(409, 'Results can be set once it has ended.', 'not_ended');
  const existing = await QuestResult.findOne({ quest: quest._id });
  if (existing?.publishedAt) fail(409, 'The results are already published.', 'published');
  const r = await ranking(quest);
  if (!r.rows.length) fail(400, 'No verified points yet: the game reports them, or enter them first.', 'no_scores');
  const winners = r.rows
    .filter((row) => (r.prizePoolCents > 0 ? row.prizeCents > 0 : row.place <= 3))
    .map((row) => ({ user: new mongoose.Types.ObjectId(row.user), ticket: new mongoose.Types.ObjectId(row.ticket), place: row.place, points: row.points, prizeNote: row.tied ? 'Tie' : '', prizeCents: row.prizeCents }));
  return QuestResult.findOneAndUpdate(
    { quest: quest._id, publishedAt: null },
    { $set: { winners, updatedBy: admin._id, rankedFromPoints: true, scoringVersion: r.scoringVersion } },
    { upsert: true, new: true }
  );
}

module.exports = { setScore, rank, prizesFor, ranking, draftResults, eligibleStatuses };
