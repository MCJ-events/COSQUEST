// Points and the ranking (lock-in WE1).
//   POST /api/quests/:questId/scores                 game server (x-game-key): { userId, points, completedAt }
//   PUT  /api/admin/quests/:questId/scores           admin: { scores: [{ ticketId, points, completedAt? }], reason }
//   GET  /api/admin/quests/:questId/ranking          the ranking, tie-break and suggested prizes
//   POST /api/admin/quests/:questId/ranking/draft    results draft from the ranking (then review and publish)
const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const User = require('../models/User');
const ranking = require('../utils/questRanking');
const { recordAudit } = require('../utils/audit');

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

async function questOr404(id) {
  if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error('Quest not found.'), { status: 404 });
  const q = await Quest.findById(id);
  if (!q) throw Object.assign(new Error('Quest not found.'), { status: 404 });
  return q;
}

async function gameScore(req, res) {
  try {
    const quest = await questOr404(req.params.questId);
    if (!mongoose.isValidObjectId(req.body?.userId)) return res.status(400).json({ error: 'userId is a CosQuest member id.', code: 'bad_user' });
    const s = await ranking.setScore(quest, { userId: req.body.userId, points: req.body.points, completedAt: req.body.completedAt, source: 'game', by: `game:${String(req.body.game || 'game').slice(0, 20)}` });
    return res.json({ ok: true, points: s.points, completedAt: s.completedAt });
  } catch (error) {
    return answer(res, error);
  }
}

async function adminScores(req, res) {
  try {
    const quest = await questOr404(req.params.questId);
    const list = Array.isArray(req.body?.scores) ? req.body.scores.slice(0, 500) : [];
    if (!list.length) return res.status(400).json({ error: 'No points to save.' });
    for (const s of list) {
      if (!mongoose.isValidObjectId(s?.ticketId)) return res.status(400).json({ error: 'Each score needs a ticketId.', code: 'bad_ticket' });
      await ranking.setScore(quest, { ticketId: s.ticketId, points: s.points, completedAt: s.completedAt, source: 'admin', by: `admin:${req.admin._id}`, reason: req.body.reason });
    }
    const event = await recordAudit(req.admin, { action: 'quest.scores', area: 'quests', target: { type: 'quest', id: quest._id, label: quest.title }, reason: String(req.body.reason || ''), after: { scores: list.length } });
    return res.json({ ok: true, saved: list.length, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function getRanking(req, res) {
  try {
    const quest = await questOr404(req.params.questId);
    const r = await ranking.ranking(quest);
    const users = await User.find({ _id: { $in: r.rows.map((x) => x.user) } }).select('profile.username profile.firstName').lean();
    const names = new Map(users.map((u) => [String(u._id), u.profile?.username ? `@${u.profile.username}` : u.profile?.firstName || 'Member']));
    return res.json({ ...r, rows: r.rows.map((x) => ({ ...x, member: names.get(x.user) || 'Member' })) });
  } catch (error) {
    return answer(res, error);
  }
}

async function draft(req, res) {
  try {
    const quest = await questOr404(req.params.questId);
    const saved = await ranking.draftResults(quest, req.admin);
    const event = await recordAudit(req.admin, { action: 'quest.results_draft', area: 'quests', target: { type: 'quest', id: quest._id, label: quest.title }, after: { winners: saved.winners.map((w) => ({ place: w.place, points: w.points, prizeCents: w.prizeCents })) } });
    return res.json({ ok: true, winners: saved.winners.length, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { gameScore, adminScores, getRanking, draft };
