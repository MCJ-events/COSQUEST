// After the event (super admin dashboard): who came, who didn't, who won.
//
//   GET  /api/admin/quests/:questId/attendance        checked in + no-shows (ticket holders who never checked in)
//   GET  /api/admin/quests/:questId/results           the winners (draft or published)
//   PUT  /api/admin/quests/:questId/results           { winners: [{ ticketId, place, prizeNote? }] }  (draft; once it has ended)
//   POST /api/admin/quests/:questId/results/publish   tells the winners; the place shows on their ticket
//
// No-shows are for admins only: the member is not told (it would feel like a
// punishment). Only people who were checked in can win.
const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const QuestResult = require('../models/QuestResult');
const notificationModel = require('../models/notificationModel');
const { placeLabel } = require('../utils/events');
const { recordAudit } = require('../utils/audit');
const { personJson } = require('./adminOverviewController');

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}
function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}
async function loadQuest(id) {
  if (!mongoose.isValidObjectId(id)) fail(404, 'Quest not found.');
  const quest = await Quest.findById(id);
  if (!quest) fail(404, 'Quest not found.');
  return quest;
}

async function people(ids) {
  const users = await User.find({ _id: { $in: ids } }).select('profile');
  return new Map(users.map((u) => [String(u._id), personJson(u)]));
}

async function attendance(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    const tickets = await Ticket.find({ quest: quest._id, status: { $in: ['valid', 'checked_in'] } }).select('user status checkedInAt').limit(5000);
    const who = await people(tickets.map((t) => t.user));
    const ended = quest.endsAt <= new Date();
    const row = (t) => ({ ticketId: String(t._id), person: who.get(String(t.user)) || null, checkedInAt: t.checkedInAt });
    // Virtual quests have no door: every ticket holder counts (until the game
    // reports who actually played), so no "not here yet" and no no-shows.
    const virtual = quest.format === 'virtual';
    const attendees = tickets.filter((t) => virtual || t.status === 'checked_in').map(row);
    const notIn = virtual ? [] : tickets.filter((t) => t.status === 'valid').map(row);
    return res.json({
      virtual,
      ended,
      tickets: tickets.length,
      checkedIn: attendees.length,
      attendees,
      // Before the end these are "not here yet"; after it, no-shows.
      noShows: ended ? notIn : [],
      notYetIn: ended ? [] : notIn,
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function resultJson(result) {
  if (!result) return { winners: [], publishedAt: null };
  const who = await people(result.winners.map((w) => w.user));
  return {
    winners: result.winners
      .slice()
      .sort((a, b) => a.place - b.place)
      .map((w) => ({ ticketId: String(w.ticket), place: w.place, placeLabel: placeLabel(w.place), prizeNote: w.prizeNote, prizeCents: w.prizeCents || 0, person: who.get(String(w.user)) || null })),
    publishedAt: result.publishedAt,
  };
}

async function getResults(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    return res.json(await resultJson(await QuestResult.findOne({ quest: quest._id })));
  } catch (error) {
    return answer(res, error);
  }
}

async function saveResults(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    if (quest.endsAt > new Date()) fail(409, 'Results can be set once it has ended.', 'not_ended');
    const existing = await QuestResult.findOne({ quest: quest._id });
    if (existing?.publishedAt) fail(409, 'The results are already published.', 'published');
    const input = Array.isArray(req.body.winners) ? req.body.winners : [];
    if (input.length > 100) fail(400, 'At most 100 winners.');
    const ticketIds = input.map((w) => String(w?.ticketId || ''));
    if (ticketIds.some((id) => !mongoose.isValidObjectId(id))) fail(400, 'Choose winners from the people who were checked in.', 'bad_ticket');
    if (new Set(ticketIds).size !== ticketIds.length) fail(400, 'Each person can win once.', 'duplicate_winner');
    // In person: only people who were checked in. Virtual: any ticket holder.
    const virtualQuest = quest.format === 'virtual';
    const tickets = await Ticket.find({ _id: { $in: ticketIds }, quest: quest._id, status: virtualQuest ? { $in: ['valid', 'checked_in'] } : 'checked_in' }).select('user');
    if (tickets.length !== ticketIds.length) fail(400, virtualQuest ? 'Only ticket holders can win.' : 'Only people who were checked in can win.', 'not_checked_in');
    const byId = new Map(tickets.map((t) => [String(t._id), t]));
    const winners = input.map((w) => {
      const place = Number(w.place);
      if (!Number.isInteger(place) || place < 1 || place > 100) fail(400, 'Places are whole numbers from 1.', 'bad_place');
      const prizeCents = w.prizeCents === undefined || w.prizeCents === null || w.prizeCents === '' ? 0 : Number(w.prizeCents);
      if (!Number.isInteger(prizeCents) || prizeCents < 0 || prizeCents > 100000000) fail(400, 'Prize amounts are whole cents, 0 or more.', 'bad_prize');
      return { user: byId.get(String(w.ticketId)).user, ticket: w.ticketId, place, prizeNote: String(w.prizeNote || '').trim().slice(0, 200), prizeCents };
    });
    const saved = await QuestResult.findOneAndUpdate(
      { quest: quest._id, publishedAt: null },
      { $set: { winners, updatedBy: req.admin._id } },
      { upsert: true, new: true }
    );
    return res.json(await resultJson(saved));
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'The results are already published.', code: 'published' });
    return answer(res, error);
  }
}

async function publishResults(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    const draft = await QuestResult.findOne({ quest: quest._id });
    if (!draft?.winners?.length) fail(400, 'Add at least one winner first.', 'no_winners');
    // Publish once (two admins clicking at the same time).
    const published = await QuestResult.findOneAndUpdate({ _id: draft._id, publishedAt: null }, { $set: { publishedAt: new Date(), publishedBy: req.admin._id } }, { new: true });
    if (!published) fail(409, 'The results are already published.', 'published');
    for (const w of published.winners) {
      const place = placeLabel(w.place);
      notificationModel.createForUser(w.user, `You won ${place} place in ${quest.title}!${w.prizeNote ? ` Prize: ${w.prizeNote}.` : ''}`, { type: 'system' }).catch(() => {});
      require('../utils/push').sendToUsers([String(w.user)], { title: `🏆 You won ${place} place!`, body: `${quest.title}${w.prizeNote ? ` · ${w.prizeNote}` : ''}`, data: { type: 'ticket', ticketId: String(w.ticket) }, channel: 'default', category: 'questUpdates', skipOnline: false }).catch(() => {});
      require('../models/QuestRegistration').updateOne({ quest: quest._id, user: w.user }, { $set: { status: 'winner' } }).catch(() => {});
    }
    // The prize pool is settled (prizes to Payouts Payable, the rest to Platform Fees),
    // then winners with a prize amount get a prize to claim (PrizeClaim).
    const settled = await require('../utils/settlement').settle(quest, published, req.admin);
    await require('../utils/prizes').createForResults(quest, published, { formulaVersion: settled.formulaVersion });
    const event = await recordAudit(req.admin, {
      action: 'quest.results',
      area: 'quests',
      target: { type: 'quest', id: quest._id, label: quest.title },
      after: { winners: published.winners.map((w) => ({ place: w.place, prizeNote: w.prizeNote })) },
    });
    return res.json({ ...(await resultJson(published)), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { attendance, getResults, saveResults, publishResults };
