// Super admin dashboard, Phase 5: Roles & permissions (invite -> accept,
// revoke, never the last admin), Settings (version check, allowed fields,
// audit of changes) and the Audit log (filters, detail, CSV export).
const User = require('../src/models/User');
const AdminInvitation = require('../src/models/AdminInvitation');
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

  const boss = await makeUser('Sarthak', { platformRole: 'admin', adminSince: new Date() });
  const priya = await makeUser('Priya');
  const bossToken = (await request('POST', '/api/admin/auth/exchange', boss.token)).data.token;

  console.log('\n--- roles: invite and accept ---');
  const roles = await request('GET', '/api/admin/roles', bossToken);
  check(roles.status === 200 && roles.data.admins.some((a) => a.id === boss.user.id && a.you) && roles.data.matrix.length >= 8, 'admins and the permission matrix', roles.data);
  const noReason = await request('POST', '/api/admin/roles/invitations', bossToken, { member: `@${priya.user.profile.username}`, reason: '' });
  check(noReason.status === 400, 'an invitation needs a reason', noReason.data);
  const nobody = await request('POST', '/api/admin/roles/invitations', bossToken, { member: '@nobody_here_at_all', reason: 'Weekend support' });
  check(nobody.status === 404, 'only existing CosQuest members can be invited', nobody.data);
  const invited = await request('POST', '/api/admin/roles/invitations', bossToken, { member: priya.user.email, reason: 'Help review reports during weekend events' });
  check(invited.status === 201 && invited.data.invitation.status === 'pending', 'invite by email', invited.data);
  const twice = await request('POST', '/api/admin/roles/invitations', bossToken, { member: `@${priya.user.profile.username}`, reason: 'Again' });
  check(twice.status === 409, 'one pending invitation per person', twice.data);
  const stillMember = await User.findById(priya.user._id);
  check(stillMember.platformRole !== 'admin', 'an invitation grants nothing until accepted', stillMember.platformRole);
  const stranger = await makeUser('Stranger');
  const notMine = await request('POST', `/api/admin/invitations/${invited.data.invitation.id}/accept`, stranger.token);
  check(notMine.status === 404, "nobody else can accept someone's invitation", notMine.status);
  const mine = await request('GET', '/api/admin/invitations/mine', priya.token);
  check(mine.data.invitations?.length === 1, 'the invited person sees it', mine.data);
  const accepted = await request('POST', `/api/admin/invitations/${invited.data.invitation.id}/accept`, priya.token);
  const nowAdmin = await User.findById(priya.user._id);
  check(accepted.status === 200 && nowAdmin.platformRole === 'admin' && String(nowAdmin.adminAssignedBy) === boss.user.id, 'accepting makes them a super admin', accepted.data);
  const priyaToken = (await request('POST', '/api/admin/auth/exchange', priya.token)).data?.token;
  check(Boolean(priyaToken), 'the new admin can sign in to the dashboard', priyaToken);

  console.log('\n--- roles: revoke ---');
  const self = await request('POST', `/api/admin/roles/admins/${boss.user.id}/revoke`, bossToken, { reason: 'Leaving' });
  check(self.status === 400, "you can't remove your own access", self.data);
  const recruit = await makeUser('Recruit');
  const priyaInvite = await request('POST', '/api/admin/roles/invitations', priyaToken, { member: `@${recruit.user.profile.username}`, reason: 'Help on Sundays' });
  const revoked = await request('POST', `/api/admin/roles/admins/${priya.user.id}/revoke`, bossToken, { reason: 'Event over' });
  const gone = await request('GET', '/api/admin/overview', priyaToken);
  check(revoked.status === 200 && gone.status === 401, 'revoking ends their dashboard access at once', { revoked: revoked.data, gone: gone.status });
  const orphan = await request('POST', `/api/admin/invitations/${priyaInvite.data.invitation.id}/accept`, recruit.token);
  check(priyaInvite.status === 201 && orphan.status === 409 && (await User.findById(recruit.user._id)).platformRole !== 'admin', "a removed admin's pending invitations are withdrawn", { invite: priyaInvite.status, accept: orphan.data });
  const ghost = await AdminInvitation.create({ user: recruit.user._id, reason: 'Sent by a non-admin', invitedBy: stranger.user._id, expiresAt: new Date(Date.now() + 60000) });
  const ghostAccept = await request('POST', `/api/admin/invitations/${ghost.id}/accept`, recruit.token);
  check(ghostAccept.status === 409 && /no longer has admin access/.test(ghostAccept.data.error), 'an invitation from someone who is not a super admin grants nothing', ghostAccept.data);
  await AdminInvitation.updateOne({ _id: ghost._id }, { $set: { status: 'revoked' } });
  const third = await makeUser('Third');
  const inv2 = await request('POST', '/api/admin/roles/invitations', bossToken, { member: `@${third.user.profile.username}`, reason: 'Testing revoke' });
  const revokeInv = await request('POST', `/api/admin/roles/invitations/${inv2.data.invitation.id}/revoke`, bossToken, { reason: 'Changed plans' });
  const late = await request('POST', `/api/admin/invitations/${inv2.data.invitation.id}/accept`, third.token);
  check(revokeInv.status === 200 && late.status === 409, 'a revoked invitation cannot be accepted', { revoke: revokeInv.status, late: late.status });
  const inv3 = await AdminInvitation.create({ user: third.user._id, reason: 'Old', invitedBy: boss.user._id, expiresAt: new Date(Date.now() - 1000) });
  const expired = await request('POST', `/api/admin/invitations/${inv3.id}/accept`, third.token);
  check(expired.status === 410, 'an expired invitation cannot be accepted', expired.status);
  const reviewed = await request('POST', '/api/admin/roles/review', bossToken, { note: 'Monthly check' });
  check(reviewed.status === 200 && reviewed.data.accessReview.nextAt, 'record an access review', reviewed.data);

  console.log('\n--- settings ---');
  const settings = await request('GET', '/api/admin/settings', bossToken);
  check(settings.status === 200 && settings.data.settings.identity.name && settings.data.version >= 1 && settings.data.needsEmail.includes('notifications.dailyDigest'), 'read the settings', settings.data);
  const v = settings.data.version;
  const saved = await request('PATCH', '/api/admin/settings', bossToken, { version: v, changes: { moderation: { newGroupSlowMode: 30 }, notifications: { dailyDigest: true } }, reason: 'Calmer new groups' });
  check(saved.status === 200 && saved.data.changed === 2 && saved.data.version === v + 1 && saved.data.settings.moderation.newGroupSlowMode === 30, 'save two settings', saved.data);
  const stale = await request('PATCH', '/api/admin/settings', bossToken, { version: v, changes: { privacy: { showMemberDirectory: false } } });
  check(stale.status === 409 && stale.data.code === 'stale_settings', "an old version can't overwrite newer settings", stale.data);
  const unknown = await request('PATCH', '/api/admin/settings', bossToken, { version: v + 1, changes: { identity: { secretFlag: true } } });
  check(unknown.status === 400, 'unknown settings are refused', unknown.data);
  const badValue = await request('PATCH', '/api/admin/settings', bossToken, { version: v + 1, changes: { moderation: { newGroupSlowMode: 45 } } });
  check(badValue.status === 400, 'invalid values are refused', badValue.data);
  const scriptUrl = await request('PATCH', '/api/admin/settings', bossToken, { version: v + 1, changes: { identity: { url: 'javascript:alert(1)' } } });
  check(scriptUrl.status === 400, 'the community URL must be an http(s) address', scriptUrl.data);
  const routeToMember = await request('PATCH', '/api/admin/settings', bossToken, { version: v + 1, changes: { moderation: { reportRouting: third.user.id } } });
  check(routeToMember.status === 400, 'reports can only be routed to a super admin', routeToMember.data);
  const memberTry = await request('GET', '/api/admin/settings', priya.token);
  check(memberTry.status === 401, 'members cannot read the settings', memberTry.status);

  console.log('\n--- audit log ---');
  const stats = await request('GET', '/api/admin/audit/stats', bossToken);
  check(stats.status === 200 && stats.data.actions >= 3, 'today stats', stats.data);
  const roleEvents = await request('GET', '/api/admin/audit?area=roles', bossToken);
  check(roleEvents.data.events?.length >= 3 && roleEvents.data.events.every((e) => e.area === 'roles'), 'filter by area', roleEvents.data);
  const setEvent = (await request('GET', '/api/admin/audit?action=settings.update', bossToken)).data.events?.[0];
  check(setEvent && setEvent.before?.['moderation.newGroupSlowMode'] === 0 && setEvent.after?.['moderation.newGroupSlowMode'] === 30, 'settings changes keep before and after', setEvent);
  const found = await request('GET', `/api/admin/audit?q=${encodeURIComponent(setEvent.number)}`, bossToken);
  check(found.data.events?.length === 1, 'search by EV number', found.data);
  const detail = await request('GET', `/api/admin/audit/${setEvent.id}`, bossToken);
  check(detail.status === 200 && detail.data.event.id === setEvent.id, 'event detail', detail.data);
  const csv = await request('GET', '/api/admin/audit/export?area=roles', bossToken, undefined, true);
  check(csv.status === 200 && /text\/csv/.test(csv.type) && csv.text.startsWith('event,time_utc,admin,action'), 'CSV export', csv.text.slice(0, 200));

  console.log(`\nadmin phase 5: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
