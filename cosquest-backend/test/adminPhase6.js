// Super admin dashboard, Phase 6: exports, search, the bell, triage
// handoff, creating a group and a text post, contacting a group owner.
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const Conversation = require('../src/models/Conversation');
const ConversationMember = require('../src/models/ConversationMember');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
  async function request(method, path, token, body, raw = false) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (raw) return { status: response.status, text, type: response.headers.get('content-type') };
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

  const admin = await makeUser('Six', { platformRole: 'admin', adminSince: new Date() });
  const owner = await makeUser('Owner');
  const reporter = await makeUser('Rep');
  const adminToken = (await request('POST', '/api/admin/auth/exchange', admin.token)).data.token;
  const post = await Post.create({ author: owner.user._id, type: 'thought', content: `Glitter cannon tutorial ${suffix}` });
  const report = await request('POST', '/api/reports', reporter.token, { targetType: 'post', targetId: post.id, reason: 'spam' });

  console.log('\n--- exports ---');
  for (const path of ['/api/admin/overview/export', '/api/admin/reports/export?status=open', '/api/admin/members/export', '/api/admin/groups/export', '/api/admin/feeds/posts/export']) {
    const csv = await request('GET', path, adminToken, undefined, true);
    check(csv.status === 200 && /text\/csv/.test(csv.type) && csv.text.split('\n').length >= 2, `CSV: ${path.split('?')[0]}`, csv.text.slice(0, 200));
  }
  const reportsCsv = await request('GET', '/api/admin/reports/export?status=open', adminToken, undefined, true);
  check(reportsCsv.text.includes(report.data.report.number), 'the reports export contains the open report', reportsCsv.text.slice(0, 300));
  const memberCsv = await request('GET', '/api/admin/members/export', reporter.token, undefined, true);
  check(memberCsv.status === 401, 'members cannot export', memberCsv.status);

  console.log('\n--- search and the bell ---');
  const found = await request('GET', `/api/admin/search?q=${encodeURIComponent(`Glitter cannon tutorial ${suffix}`)}`, adminToken);
  check(found.status === 200 && found.data.posts.some((p) => p.id === post.id) && found.data.reports.length >= 1, 'search finds the post and its report', found.data);
  const byHandle = await request('GET', `/api/admin/search?q=${encodeURIComponent(`@owner${suffix}`)}`, adminToken);
  check(byHandle.data.members?.some((m) => m.id === owner.user.id), 'search a member by @handle', byHandle.data);
  const tiny = await request('GET', '/api/admin/search?q=a', adminToken);
  check(tiny.status === 200 && !tiny.data.members.length, 'one letter searches nothing', tiny.data);
  const bell = await request('GET', '/api/admin/alerts', adminToken);
  check(bell.status === 200 && bell.data.items.some((i) => i.kind === 'high_priority_report' && i.link.report === report.data.report.id), 'the bell shows the new high-priority report', bell.data);

  console.log('\n--- triage ---');
  await request('POST', `/api/admin/reports/${report.data.report.id}/assign`, adminToken, {});
  const triage = await request('GET', '/api/admin/reports/triage', adminToken);
  check(triage.status === 200 && triage.data.admins.some((a) => a.id === admin.user.id && a.inReview >= 1 && a.you), 'triage handoff counts reports in review per admin', triage.data);
  const bell2 = await request('GET', '/api/admin/alerts', adminToken);
  check(bell2.data.items.some((i) => i.kind === 'assigned_to_you'), 'the bell shows reports assigned to you', bell2.data);

  console.log('\n--- groups and posts ---');
  const created = await request('POST', '/api/admin/groups', adminToken, { name: `Official ${suffix}`, description: 'Announcements', kind: 'open', joinMode: 'approval' });
  const ownerRow = created.data.group ? await ConversationMember.findOne({ conversation: created.data.group.id, user: admin.user._id }) : null;
  check(created.status === 201 && ownerRow?.role === 'owner', 'create a group (the admin owns it)', created.data);
  const privateGroup = await request('POST', '/api/admin/groups', adminToken, { name: `Staff ${suffix}`, kind: 'private' });
  const privateRow = privateGroup.data.group ? await Conversation.findById(privateGroup.data.group.id) : null;
  check(privateRow?.group?.joinMode === 'approval' && typeof privateRow.group.inviteCode === 'string' && privateRow.group.inviteCode.length > 0,
    'same defaults as the app: private groups ask for approval, and every group has an invite link', privateRow?.group);
  const badKind = await request('POST', '/api/admin/groups', adminToken, { name: 'Faction', kind: 'faction' });
  check(badKind.status === 400, 'faction groups are not created here', badKind.data);
  const group = await Conversation.create({ type: 'group', group: { name: `Ownerland ${suffix}`, kind: 'private', createdBy: owner.user._id } });
  await ConversationMember.create({ conversation: group._id, user: owner.user._id, role: 'owner', joinedAt: new Date() });
  const contacted = await request('POST', `/api/admin/groups/${group._id}/contact-owner`, adminToken, { message: 'Two reports need your attention.' });
  const notice = await Notification.findOne({ user: owner.user._id, message: { $regex: 'CosQuest admins about' } });
  check(contacted.status === 200 && notice, 'contact the owner (an in-app notice)', { contacted: contacted.data, notice });
  const empty = await request('POST', `/api/admin/groups/${group._id}/contact-owner`, adminToken, { message: '' });
  check(empty.status === 400, 'the message is required', empty.data);
  const posted = await request('POST', '/api/admin/feeds/posts', adminToken, { content: `Weekend meetup at Chicano Park ${suffix}` });
  const inFeed = await request('GET', `/api/posts/${posted.data?.post?.id}`, owner.token);
  check(posted.status === 201 && inFeed.status === 200, 'create a community text post (visible in the feed)', { posted: posted.data, inFeed: inFeed.status });
  const tooLong = await request('POST', '/api/admin/feeds/posts', adminToken, { content: 'x'.repeat(2001) });
  check(tooLong.status === 400, 'posts are at most 2,000 characters', tooLong.data);

  console.log(`\nadmin phase 6: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
