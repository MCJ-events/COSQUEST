// GET /api/admin/overview?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 7
// days) - the Overview page of the admin dashboard.
//
// {
//   window: { from, to },
//   stats: {
//     activeMembers:   { value, change, series },  people who posted, commented, liked or sent a message
//     interactions:    { value, change, series },  reactions + comments + replies + chat messages
//     activeGroups:    { value, newThisPeriod, total },
//     openReports:     { value, high, new, inReview, series },
//   },
//   engagement: { current: [{ date, interactions }], previous: [...] },
//   pulse: { feedPosts, chatMessages, newSparks, mix: { reactions, comments, replies, total }, newMembers: { value, change } },
//   queue: [report preview x3],
//   recentActivity: [audit event x4],
//   activeGroups: [{ id, name, members, messages, openReports } x3],
// }
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Post = require('../models/Post');
const Report = require('../models/Report');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const { auditJson } = require('../utils/audit');
const { reportLabel } = require('./reportController');
const stats = require('../utils/adminStats');

function personJson(user) {
  if (!user?.profile) return null;
  const p = user.profile;
  return {
    id: String(user._id),
    username: p.username || null,
    name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || 'Member',
    avatarKey: p.avatarKey || null,
    avatarPhotoUrl: p.avatarPhotoUrl || null,
  };
}

function reportPreview(report) {
  return {
    id: String(report._id),
    number: reportLabel(report.number),
    targetType: report.targetType,
    reason: report.reason,
    priority: report.priority,
    status: report.status,
    reporterCount: report.reporterCount,
    snapshot: report.snapshot,
    targetUser: personJson(report.targetUser),
    createdAt: report.createdAt,
  };
}

async function newSparksCount(w) {
  // Legacy engine only for now; the Sparks module's count comes with the Sparks page.
  try {
    if (require('../sparks').isModule()) return await require('./adminSparksController').newSparksBetween(w);
    return await require('../models/Spark').countDocuments(stats.inWindow(w));
  } catch {
    return null;
  }
}

async function busiestGroups(w, limit = 3) {
  const top = await Message.aggregate([
    { $match: stats.chatFilter(w) },
    { $group: { _id: '$conversation', messages: { $sum: 1 } } },
    { $sort: { messages: -1 } },
    { $limit: 50 },
  ]);
  const groups = await Conversation.find({ _id: { $in: top.map((row) => row._id) }, type: 'group', 'group.archived': { $ne: true } });
  const { countGroupMembers } = require('./chatController');
  const picked = top.map((row) => ({ row, group: groups.find((g) => String(g._id) === String(row._id)) })).filter((x) => x.group).slice(0, limit);
  return Promise.all(
    picked.map(async ({ row, group }) => ({
      id: String(group._id),
      name: group.group.name,
      kind: group.group.kind,
      photoUrl: group.group.photoUrl || null,
      members: await countGroupMembers(group),
      messages: row.messages,
      openReports: await Report.countDocuments({ conversation: group._id, status: { $in: Report.OPEN_STATUSES } }),
    }))
  );
}

async function overview(req, res) {
  const { current, previous } = stats.windows(req.query);
  const open = { status: { $in: Report.OPEN_STATUSES } };

  const [
    activeNow, activeBefore,
    mixNow, mixBefore,
    messagesNow, messagesBefore,
    seriesNow, seriesBefore,
    groupIdsNow, totalGroups, newGroups,
    openReports, highReports, newReports, inReviewReports,
    feedPosts, newSparks,
    newMembers, newMembersBefore,
    queue, recent, groups,
  ] = await Promise.all([
    stats.activePeople(current), stats.activePeople(previous),
    stats.interactionMix(current), stats.interactionMix(previous),
    Message.countDocuments(stats.chatFilter(current)), Message.countDocuments(stats.chatFilter(previous)),
    stats.dailySeries(current), stats.dailySeries(previous),
    Message.distinct('conversation', stats.chatFilter(current)),
    Conversation.countDocuments({ type: 'group', 'group.archived': { $ne: true } }),
    Conversation.countDocuments({ type: 'group', ...stats.inWindow(current) }),
    Report.countDocuments(open), Report.countDocuments({ ...open, priority: 'high' }),
    Report.countDocuments({ status: 'new' }), Report.countDocuments({ status: 'in_review' }),
    Post.countDocuments(stats.inWindow(current)), newSparksCount(current),
    User.countDocuments({ onboardingComplete: true, ...stats.inWindow(current) }),
    User.countDocuments({ onboardingComplete: true, ...stats.inWindow(previous) }),
    Report.find(open).sort({ priority: 1, createdAt: -1 }).limit(3).populate('targetUser', 'profile'),
    AuditEvent.find({ area: { $ne: 'auth' } }).sort({ createdAt: -1 }).limit(4).populate('actor', 'profile'),
    busiestGroups(current),
  ]);

  const activeGroups = await Conversation.countDocuments({ _id: { $in: groupIdsNow }, type: 'group' });
  const reportSeries = await Promise.all(
    seriesNow.map(async (day) => {
      const from = new Date(`${day.date}T00:00:00.000Z`);
      return { date: day.date, value: await Report.countDocuments({ createdAt: { $gte: from, $lt: new Date(from.getTime() + stats.DAY) } }) };
    })
  );

  const interactionsNow = mixNow.total + messagesNow;
  const interactionsBefore = mixBefore.total + messagesBefore;

  return res.json({
    window: { from: current.from, to: current.to },
    stats: {
      activeMembers: { value: activeNow, change: stats.change(activeNow, activeBefore) },
      interactions: {
        value: interactionsNow,
        change: stats.change(interactionsNow, interactionsBefore),
        series: seriesNow.map((day) => ({ date: day.date, value: day.interactions })),
      },
      activeGroups: { value: activeGroups, newThisPeriod: newGroups, total: totalGroups },
      openReports: { value: openReports, high: highReports, new: newReports, inReview: inReviewReports, series: reportSeries },
    },
    engagement: {
      current: seriesNow.map((day) => ({ date: day.date, interactions: day.interactions })),
      previous: seriesBefore.map((day) => ({ date: day.date, interactions: day.interactions })),
    },
    pulse: {
      feedPosts,
      chatMessages: messagesNow,
      newSparks,
      mix: mixNow,
      newMembers: { value: newMembers, change: stats.change(newMembers, newMembersBefore) },
    },
    queue: queue.map(reportPreview),
    recentActivity: recent.map(auditJson),
    activeGroups: groups,
  });
}

module.exports = { overview, personJson, reportPreview };
