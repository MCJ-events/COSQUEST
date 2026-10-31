// Super admin dashboard, Phase 3: Members (directory, details, CosQuest-wide
// mute and suspension) and Groups (directory, health, settings, join
// requests, archive / restore).
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const Conversation = require('../src/models/Conversation');
const ConversationMember = require('../src/models/ConversationMember');
const GroupJoinRequest = require('../src/models/GroupJoinRequest');
const { io } = require('socket.io-client');
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

  const admin = await makeUser('Chief', { platformRole: 'admin', adminSince: new Date() });
  const member = await makeUser('Theo');
  const owner = await makeUser('Owner');
  const other = await makeUser('Other', { platformRole: 'admin' });
  const half = await makeUser('Half', { onboardingComplete: false });
  const adminToken = (await request('POST', '/api/admin/auth/exchange', admin.token)).data.token;

  console.log('\n--- members ---');
  const mstats = await request('GET', '/api/admin/members/stats', adminToken);
  check(mstats.status === 200 && mstats.data.total >= 5 && mstats.data.pending >= 1, 'member stats', mstats.data);
  const found = await request('GET', `/api/admin/members?q=${encodeURIComponent(`theo${suffix}`)}`, adminToken);
  check(found.data.members?.length === 1 && found.data.members[0].id === member.user.id && found.data.members[0].status === 'active', 'search a member by @handle', found.data);
  const pending = await request('GET', '/api/admin/members?tab=pending', adminToken);
  check(pending.data.members?.some((m) => m.id === half.user.id && m.status === 'pending'), 'Pending tab: sign-up not finished', pending.data);
  const admins = await request('GET', '/api/admin/members?role=admin', adminToken);
  check(admins.data.members?.every((m) => m.role === 'super_admin'), 'role filter', admins.data);
  const detail = await request('GET', `/api/admin/members/${member.user.id}`, adminToken);
  check(detail.status === 200 && detail.data.restrictions.muted === null && Array.isArray(detail.data.groups), 'member details', detail.data);

  // Something to edit, forward and share while muted.
  const dm = (await request('POST', '/api/chats/dm', member.token, { username: owner.user.profile.username })).data.chat.id;
  const sent = (await request('POST', `/api/chats/${dm}/messages`, member.token, { content: 'before the mute' })).data.message;
  const ownPost = (await request('POST', '/api/posts', member.token, { type: 'thought', content: `mine ${suffix}` })).data.post;
  const othersPost = (await request('POST', '/api/posts', owner.token, { type: 'thought', content: `theirs ${suffix}` })).data.post;

  const noReason = await request('POST', `/api/admin/members/${member.user.id}/mute`, adminToken, { duration: '1h', reason: '' });
  check(noReason.status === 400, 'a mute needs a reason', noReason.data);
  const muted = await request('POST', `/api/admin/members/${member.user.id}/mute`, adminToken, { duration: '1d', reason: 'Repeated personal remarks' });
  check(muted.status === 200 && muted.data.member.status === 'muted', 'mute CosQuest-wide', muted.data);
  const post = await request('POST', '/api/posts', member.token, { type: 'thought', content: 'can I post?' });
  check(post.status === 403 && post.data.code === 'community_muted', 'a muted member cannot post', post.data);
  const otherWays = await Promise.all([
    request('POST', `/api/chats/${dm}/polls`, member.token, { question: 'Still here?', options: ['yes', 'no'] }),
    request('PATCH', `/api/chats/${dm}/messages/${sent.id}`, member.token, { content: 'edited while muted' }),
    request('POST', `/api/chats/${dm}/messages/${sent.id}/forward`, member.token, { targetConversationId: dm }),
    request('PATCH', `/api/posts/${ownPost.id}`, member.token, { content: 'edited while muted' }),
    request('POST', `/api/posts/${othersPost.id}/share-to-feed`, member.token, { content: 'sharing while muted' }),
  ]);
  check(otherWays.every((r) => r.status === 403 && r.data.code === 'community_muted'), 'muted: no polls, edits, forwards or shares either', otherWays.map((r) => r.status));
  const reading = await request('GET', '/api/posts', member.token);
  check(reading.status === 200, 'a muted member can still read', reading.status);
  const unmuted = await request('POST', `/api/admin/members/${member.user.id}/unmute`, adminToken, {});
  const post2 = await request('POST', '/api/posts', member.token, { type: 'thought', content: `back ${suffix}` });
  check(unmuted.status === 200 && post2.status === 201, 'unmute: posting works again', { unmuted: unmuted.status, post: post2.status });
  const unmuteAgain = await request('POST', `/api/admin/members/${member.user.id}/unmute`, adminToken, {});
  check(unmuteAgain.status === 409, 'unmuting someone not muted -> 409', unmuteAgain.status);

  // Their live connection, to see the suspension close it.
  const live = io(baseUrl, { auth: { token: member.token }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => { live.on('connect', resolve); live.on('connect_error', reject); });
  const revoked = new Promise((resolve) => live.on('session:revoked', (payload) => resolve(payload)));
  const suspended = await request('POST', `/api/admin/members/${member.user.id}/suspend`, adminToken, { duration: '1w', reason: 'Scam links after a warning' });
  const blocked = await request('GET', '/api/users/me/notifications', member.token);
  check(suspended.status === 200 && blocked.status === 403 && blocked.data.code === 'account_suspended', 'a suspended account cannot use CosQuest', blocked.data);
  const revokedWith = await Promise.race([revoked, new Promise((resolve) => setTimeout(() => resolve(null), 2000))]);
  check(revokedWith?.reason === 'account_suspended', 'suspending closes their live connection', revokedWith);
  live.disconnect();
  const reconnect = io(baseUrl, { auth: { token: member.token }, transports: ['websocket'], reconnection: false });
  const refused = await new Promise((resolve) => { reconnect.on('connect', () => resolve(null)); reconnect.on('connect_error', (error) => resolve(error.message)); });
  reconnect.disconnect();
  check(refused === 'Account suspended', 'a suspended account cannot reconnect live', refused);
  const hourSuspend = await request('POST', `/api/admin/members/${owner.user.id}/suspend`, adminToken, { duration: '1h', reason: 'Too short' });
  check(hourSuspend.status === 400, 'suspensions are at least a day', hourSuspend.data);
  await request('POST', `/api/admin/members/${member.user.id}/unsuspend`, adminToken, { reason: 'Appeal accepted' });
  const back = await request('GET', '/api/users/me/notifications', member.token);
  check(back.status === 200, 'unsuspend: the account works again', back.status);
  const onAdmin = await request('POST', `/api/admin/members/${other.user.id}/mute`, adminToken, { duration: '1h', reason: 'No' });
  check(onAdmin.status === 403, 'super admins cannot be restricted here', onAdmin.data);
  const onSelf = await request('POST', `/api/admin/members/${admin.user.id}/suspend`, adminToken, { duration: '1d', reason: 'No' });
  check(onSelf.status === 400, "an admin can't restrict themselves", onSelf.data);
  const history = await request('GET', `/api/admin/members/${member.user.id}`, adminToken);
  check(history.data.history?.some((e) => e.action === 'member.suspend'), 'the actions show in the member history', history.data?.history);

  console.log('\n--- groups ---');
  const group = await Conversation.create({ type: 'group', group: { name: `Barrio ${suffix}`, kind: 'private', createdBy: owner.user._id, joinMode: 'approval' } });
  await ConversationMember.create({ conversation: group._id, user: owner.user._id, role: 'owner', joinedAt: new Date() });
  const joinRequest = await GroupJoinRequest.create({ conversation: group._id, user: member.user._id, message: 'Local cosplay' });
  const gstats = await request('GET', '/api/admin/groups/stats', adminToken);
  check(gstats.status === 200 && gstats.data.total >= 1 && gstats.data.joinRequests >= 1, 'group stats', gstats.data);
  const glist = await request('GET', `/api/admin/groups?q=${encodeURIComponent(`Barrio ${suffix}`)}`, adminToken);
  check(glist.data.groups?.[0]?.id === String(group._id) && glist.data.groups[0].health === 'quiet' && glist.data.groups[0].owner?.id === owner.user.id, 'directory: owner and health', glist.data);
  const gdetail = await request('GET', `/api/admin/groups/${group._id}`, adminToken);
  check(gdetail.status === 200 && gdetail.data.requests.length === 1 && gdetail.data.group.settings.joinMode === 'approval', 'group details with join requests', gdetail.data);
  const approved = await request('POST', `/api/admin/groups/${group._id}/requests/${joinRequest.id}/approve`, adminToken, {});
  const row = await ConversationMember.findOne({ conversation: group._id, user: member.user._id });
  check(approved.status === 200 && row?.role === 'member', 'approve a join request', approved.data);
  const twice = await request('POST', `/api/admin/groups/${group._id}/requests/${joinRequest.id}/approve`, adminToken, {});
  check(twice.status === 404, 'an answered request cannot be answered again', twice.status);
  const settings = await request('PATCH', `/api/admin/groups/${group._id}/settings`, adminToken, { joinMode: 'instant', whoCanAdd: 'members' });
  const after = await Conversation.findById(group._id);
  check(settings.status === 200 && after.group.joinMode === 'instant' && after.group.whoCanAdd === 'members', 'change joining settings', settings.data);
  const badSetting = await request('PATCH', `/api/admin/groups/${group._id}/settings`, adminToken, { joinMode: 'sometimes' });
  check(badSetting.status === 400, 'settings are validated', badSetting.data);
  const archived = await request('POST', `/api/admin/groups/${group._id}/archive`, adminToken, { reason: 'Abandoned and spammed' });
  const memberView = await request('GET', `/api/chats/${group._id}/messages`, member.token);
  check(archived.status === 200 && memberView.status === 404, 'archive: members lose the group', { archived: archived.data, view: memberView.status });
  const archivedTab = await request('GET', '/api/admin/groups?tab=archived', adminToken);
  check(archivedTab.data.groups?.some((g) => g.id === String(group._id)), 'the Archived tab', archivedTab.data);
  const restored = await request('POST', `/api/admin/groups/${group._id}/restore`, adminToken, { reason: 'Owner asked' });
  const memberBack = await request('GET', `/api/chats/${group._id}/messages`, member.token);
  check(restored.status === 200 && memberBack.status === 200, 'restore brings it back', { restored: restored.status, back: memberBack.status });

  console.log(`\nadmin phase 3: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
