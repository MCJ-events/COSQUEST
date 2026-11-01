// GET /api/quests/:questId/joins - the latest people who joined a quest
// (the home page's "Bigtooth Joined · Wagm Joined" under the big pin).
// Signed-in members only; public profile bits only (username, display
// name, faction), never emails. Accounts that are suspended are left out,
// and so is anyone whose profile this viewer can't see (blocked either way,
// private, or friends-only and not friends): the same gate as their quest
// history on the profile page.
const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const QuestRegistration = require('../models/QuestRegistration');
const { canViewProfile } = require('./publicProfileController');

async function recentJoins(req, res) {
  if (!mongoose.isValidObjectId(req.params.questId)) return res.status(404).json({ error: 'Quest not found.' });
  const quest = await Quest.findOne({ _id: req.params.questId, isPublished: true }).select('registrationCount');
  if (!quest) return res.status(404).json({ error: 'Quest not found.' });
  const rows = await QuestRegistration.find({ quest: quest._id, status: { $in: ['registered', 'completed', 'winner'] } })
    .sort({ createdAt: -1 })
    .limit(12)
    .populate('user', 'profile.username profile.displayName profile.firstName faction moderation privacy.profileVisibility');
  const now = Date.now();
  const joins = [];
  for (const r of rows) {
    if (joins.length === 4) break;
    if (!r.user || (r.user.moderation?.suspendedUntil && new Date(r.user.moderation.suspendedUntil).getTime() > now)) continue;
    if (!(await canViewProfile(r.user, req.userId))) continue;
    joins.push({
      username: r.user.profile?.username || null,
      name: r.user.profile?.displayName || r.user.profile?.firstName || r.user.profile?.username || 'Someone',
      faction: r.user.faction || null,
      you: String(r.user._id) === String(req.userId),
      at: r.createdAt,
    });
  }
  // A few seconds of caching per viewer is plenty (the app checks every 20 s).
  res.set('Cache-Control', 'private, max-age=10');
  return res.json({ joins, total: quest.registrationCount || 0 });
}

module.exports = { recentJoins };
