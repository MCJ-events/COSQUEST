// Super admin dashboard, Phase 2: Moderation (queue, review, assign, decide),
// Feeds (posts, removal that keeps evidence, restore) and Chats (messages in
// context, admin delete, slow mode, mute / remove / ban in groups).
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const Report = require('../src/models/Report');
const AuditEvent = require('../src/models/AuditEvent');
const Conversation = require('../src/models/Conversation');
const ConversationMember = require('../src/models/ConversationMember');
const Message = require('../src/models/Message');
const GroupBan = require('../src/models/GroupBan');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(name, extra = {}) {
    const user = await User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight' },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', ...extra,
    });
    return { user, token: signToken(user.id, user.tokenVersion) };
  }

  const admin = await makeUser('Mod', { platformRole: 'admin', adminSince: new Date() });
  const reporter = await makeUser('Rep');
  const author = await makeUser('Auth');
  const adminToken = (await request('POST', '/api/admin/auth/exchange', admin.token)).data.token;

  console.log('\n--- moderation ---');
  const post = await Post.create({ author: author.user._id, type: 'thought', content: `Free convention passes ${suffix}` });
  const reported = await request('POST', '/api/reports', reporter.token, { targetType: 'post', targetId: post.id, reason: 'spam', statement: 'Credential link' });
  const reportId = reported.data.report.id;
  const stats = await request('GET', '/api/admin/reports/stats', adminToken);
  check(stats.status === 200 && stats.data.open >= 1 && stats.data.high >= 1, 'stats: open and high priority', stats.data);
  const queue = await request('GET', '/api/admin/reports?status=open', adminToken);
  check(queue.status === 200 && queue.data.reports.some((r) => r.id === reportId), 'the queue lists the open report', queue.data);
  const search = await request('GET', `/api/admin/reports?q=${encodeURIComponent(reported.data.report.number)}`, adminToken);
  check(search.data.reports?.length === 1 && search.data.reports[0].id === reportId, 'search by CQ number', search.data);
  const detail = await request('GET', `/api/admin/reports/${reportId}`, adminToken);
  check(detail.status === 200 && detail.data.target.exists && detail.data.actions.includes('remove_post') && detail.data.report.reporters.length === 1, 'detail: live target, actions, reporters', detail.data);
  const assigned = await request('POST', `/api/admin/reports/${reportId}/assign`, adminToken, {});
  check(assigned.status === 200 && assigned.data.report.status === 'in_review' && assigned.data.report.assignee?.id === admin.user.id, 'assign to me -> in review', assigned.data);
  const noReason = await request('POST', `/api/admin/reports/${reportId}/decision`, adminToken, { action: 'remove_post', reason: '' });
  check(noReason.status === 400, 'a decision needs a reason', noReason.data);
  const wrongAction = await request('POST', `/api/admin/reports/${reportId}/decision`, adminToken, { action: 'delete_message', reason: 'Wrong' });
  check(wrongAction.status === 400, 'the action must fit the target', wrongAction.data);
  const decided = await request('POST', `/api/admin/reports/${reportId}/decision`, adminToken, { action: 'remove_post', reason: 'Misleading credential-collection link' });
  check(decided.status === 200 && decided.data.report.status === 'resolved' && /^EV-/.test(decided.data.auditEvent), 'remove the post: report resolved, recorded', decided.data);
  const again = await request('POST', `/api/admin/reports/${reportId}/decision`, adminToken, { action: 'dismiss', reason: 'Twice' });
  check(again.status === 409, 'a decided report cannot be decided again', again.data);

  console.log('\n--- feeds: removal keeps evidence ---');
  const hidden = await request('GET', `/api/posts/${post.id}`, reporter.token);
  check(hidden.status === 404, 'a removed post is gone for members', hidden.status);
  const stillThere = await Post.findOne({ _id: post._id }).setOptions({ includeRemoved: true });
  check(Boolean(stillThere?.removedAt) && stillThere.removedReason, 'the post is kept in the database with its reason', stillThere);
  const visibleCount = await Post.countDocuments({ _id: post._id });
  check(visibleCount === 0, 'normal queries never see it', visibleCount);
  const removedTab = await request('GET', '/api/admin/feeds/posts?tab=removed', adminToken);
  check(removedTab.data.posts?.some((p) => p.id === post.id && p.status === 'removed'), 'the Removed tab shows it', removedTab.data);
  const event = await AuditEvent.findOne({ action: 'post.remove', 'target.id': post.id });
  check(event?.evidence?.text?.includes('Free convention passes') && event.meta?.authorNotified === true, 'the audit event keeps the text as evidence', event);
  const restored = await request('POST', `/api/admin/feeds/posts/${post.id}/restore`, adminToken, { reason: 'Reviewed again: allowed' });
  const back = await request('GET', `/api/posts/${post.id}`, reporter.token);
  check(restored.status === 200 && back.status === 200, 'restore brings it back', { restored: restored.status, back: back.status });
  const direct = await request('POST', `/api/admin/feeds/posts/${post.id}/remove`, adminToken, { reason: 'Removed from the Feeds page' });
  check(direct.status === 200 && direct.data.post.status === 'removed', 'remove from the Feeds page', direct.data);
  const feedStats = await request('GET', '/api/admin/feeds/stats', adminToken);
  check(feedStats.status === 200 && feedStats.data.removed >= 1, 'feed stats', feedStats.data);

  console.log('\n--- chats ---');
  const group = await Conversation.create({ type: 'group', group: { name: `Test group ${suffix}`, kind: 'private', createdBy: author.user._id } });
  await ConversationMember.create({ conversation: group._id, user: author.user._id, role: 'owner', joinedAt: new Date() });
  await ConversationMember.create({ conversation: group._id, user: reporter.user._id, role: 'member', joinedAt: new Date() });
  const bad = await Message.create({ conversation: group._id, sender: reporter.user._id, content: 'You do not belong here' });
  await Message.create({ conversation: group._id, sender: author.user._id, content: 'Keep it kind, please' });
  const msgReport = await request('POST', '/api/reports', author.token, { targetType: 'message', targetId: bad.id, reason: 'harassment' });
  check(msgReport.status === 201, 'a group member reports a message', msgReport.data);
  const conversations = await request('GET', '/api/admin/chats/conversations?filter=reported', adminToken);
  check(conversations.data.conversations?.some((c) => c.id === String(group._id) && c.openReports === 1), 'reported conversations are listed', conversations.data);
  const context = await request('GET', `/api/admin/chats/conversations/${group._id}/messages?around=${bad.id}`, adminToken);
  check(context.status === 200 && context.data.messages.some((m) => m.id === bad.id && m.report?.status === 'new'), 'messages in context, with the report marked', context.data);
  const dmConv = await Conversation.create({ type: 'dm', dmKey: `${admin.user.id}_${reporter.user.id}`, participants: [admin.user._id, reporter.user._id] });
  const dmContext = await request('GET', `/api/admin/chats/conversations/${dmConv._id}/messages`, adminToken);
  check(dmContext.status === 404, 'direct messages are never browsable', dmContext.status);
  const deleted = await request('POST', `/api/admin/chats/messages/${bad.id}/delete`, adminToken, { reason: 'Targeted personal remarks' });
  const badNow = await Message.findById(bad._id);
  const msgReportNow = await Report.findById(msgReport.data.report.id);
  check(deleted.status === 200 && badNow.deletedForEveryone && badNow.deletedByAdmin && msgReportNow.status === 'resolved', 'admin delete: tombstone, report resolved', { deleted: deleted.data, report: msgReportNow?.status });
  const slow = await request('POST', `/api/admin/chats/conversations/${group._id}/slow-mode`, adminToken, { seconds: 30 });
  const slowNow = await Conversation.findById(group._id);
  check(slow.status === 200 && slowNow.group.slowModeSeconds === 30, 'slow mode 30 s', slow.data);
  const badSlow = await request('POST', `/api/admin/chats/conversations/${group._id}/slow-mode`, adminToken, { seconds: 45 });
  check(badSlow.status === 400, 'only the allowed slow mode values', badSlow.data);
  const muted = await request('POST', `/api/admin/chats/conversations/${group._id}/members/${reporter.user.id}/mute`, adminToken, { duration: '1h', reason: 'Cool down' });
  const send = await request('POST', `/api/chats/${group._id}/messages`, reporter.token, { content: 'still here?' });
  check(muted.status === 200 && send.status === 403, 'a muted member can read but not send', { muted: muted.data, send: send.status });
  await request('POST', `/api/admin/chats/conversations/${group._id}/members/${reporter.user.id}/unmute`, adminToken, {});
  const banned = await request('POST', `/api/admin/chats/conversations/${group._id}/members/${reporter.user.id}/ban`, adminToken, { reason: 'Repeated harassment' });
  const banRow = await GroupBan.findOne({ conversation: group._id, user: reporter.user._id });
  const rowNow = await ConversationMember.findOne({ conversation: group._id, user: reporter.user._id });
  check(banned.status === 200 && banRow && !rowNow.role, 'ban: out of the group and kept out', { banned: banned.data, role: rowNow?.role });
  const ownerAct = await request('POST', `/api/admin/chats/conversations/${group._id}/members/${author.user.id}/mute`, adminToken, { duration: '1h', reason: 'Testing owner' });
  check(ownerAct.status === 200, 'super admins can act on a group owner too', ownerAct.data);
  const heir = await makeUser('Heir');
  await ConversationMember.create({ conversation: group._id, user: heir.user._id, role: 'member', joinedAt: new Date() });
  const ownerOut = await request('POST', `/api/admin/chats/conversations/${group._id}/members/${author.user.id}/remove`, adminToken, { reason: 'Running a scam group' });
  const heirRow = await ConversationMember.findOne({ conversation: group._id, user: heir.user._id });
  const groupNow = await Conversation.findById(group._id);
  check(ownerOut.status === 200 && heirRow?.role === 'owner' && !groupNow.group.archived, 'removing the owner hands the group to the next member', { ownerOut: ownerOut.data, heir: heirRow?.role });
  const selfAct = await request('POST', `/api/admin/chats/conversations/${group._id}/members/${admin.user.id}/mute`, adminToken, { duration: '1h', reason: 'Self' });
  check(selfAct.status === 400, "an admin can't act on themselves", selfAct.data);
  const room = await Conversation.findOne({ type: 'community' }) || (await Conversation.create({ type: 'community' }));
  const roomMute = await request('POST', `/api/admin/chats/conversations/${room._id}/members/${reporter.user.id}/mute`, adminToken, { duration: '1h', reason: 'Room' });
  check(roomMute.status === 400, 'member actions are for groups (rooms: Members page)', roomMute.data);
  const noAdmin = await request('POST', `/api/admin/chats/messages/${bad.id}/delete`, reporter.token, { reason: 'x' });
  check(noAdmin.status === 401, 'members cannot use admin chat actions', noAdmin.status);

  console.log(`\nadmin phase 2: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
  