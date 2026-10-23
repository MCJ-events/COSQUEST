const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const Member = require('../src/models/ConversationMember');
const Spark = require('../src/models/Spark');
const ProjectFile = require('../src/models/ProjectFile');
const ScheduledCall = require('../src/models/ScheduledCall');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/token');
const { localStart, occurrences } = require('../src/utils/meetingTime');
const { remindDue } = require('../src/utils/meetingNotifications');

async function runPlanning(baseUrl) {
  let pass = 0, fail = 0;
  async function check(name, fn) {
    try { await fn(); pass++; console.log(`  ok  - ${name}`); }
    catch (e) { fail++; console.error(`FAIL - ${name}: ${e.stack}`); }
  }
  const suffix = Date.now();
  const users = await Promise.all([0, 1, 2, 3].map(i => User.create({ profile: { username: `Planner${i}${suffix}`, usernameNormalized: `planner${i}${suffix}`, firstName: 'Planner', lastName: String(i), avatarKey: 'green-knight' }, onboardingComplete: true, faction: 'ascendants' })));
  const [host, member, outsider, observer] = users;
  const tokens = users.map(u => signToken(u.id, u.tokenVersion));
  const group = await Conversation.create({ type: 'group', group: { name: 'Planning', kind: 'private', createdBy: host._id } });
  await Member.insertMany([host, member, observer].map((u, i) => ({ conversation: group._id, user: u._id, role: i ? 'member' : 'owner' })));
  await Promise.all([ScheduledCall.init(), Notification.init()]);
  async function req(method, path, user = 0, body) {
    const multipart = body instanceof FormData;
    const r = await fetch(baseUrl + '/api' + path, { method, headers: { ...(user === null ? {} : { Authorization: `Bearer ${tokens[user]}` }), ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) }, body: body ? multipart ? body : JSON.stringify(body) : undefined });
    return { status: r.status, data: r.headers.get('content-type')?.includes('application/json') ? await r.json() : await r.text() };
  }
  const gp = `/groups/${group.id}`;
  let project, subject, file, spark, call;
  await check('project creation requires group membership and authentication', async () => {
    assert.equal((await req('POST', gp + '/projects', null, { name: 'Test' })).status, 401);
    assert.equal((await req('POST', gp + '/projects', 2, { name: 'Test' })).status, 403);
    assert.equal((await req('POST', gp + '/projects', 0, { name: ' ' })).status, 400);
  });
  await check('create project with subjects and searchable overview', async () => {
    const r = await req('POST', gp + '/projects', 0, { name: 'Next CosQuest', description: 'Planning our meetup', location: 'Chicano Park', subjects: [{ name: 'Route & meetup' }, { name: 'Costumes' }] });
    assert.equal(r.status, 201, JSON.stringify(r)); project = r.data.project; subject = project.subjects[0];
    const list = await req('GET', gp + '/projects?q=cosquest', 1);
    assert.equal(list.data.projects[0].subjectCount, 2);
    assert.equal((await req('GET', gp + '/projects?q=%5B')).data.projects.length, 0);
  });
  await check('upload documents and images, reject unsupported files and wrong subjects', async () => {
    const form = () => { const f = new FormData(); f.append('file', new Blob(['%PDF-1.4\nfixture'], { type: 'application/pdf' }), 'route.pdf'); return f; };
    const r = await req('POST', `/projects/${project.id}/subjects/${subject.id}/files`, 1, form());
    assert.equal(r.status, 201, JSON.stringify(r)); file = r.data.file; assert.equal(file.fileName, 'route.pdf'); assert.equal(file.subjectId, subject.id);
    assert.equal((await req('POST', `/projects/${project.id}/files`, 2, form())).status, 403);
    assert.equal((await req('POST', `/projects/${project.id}/subjects/${new mongoose.Types.ObjectId()}/files`, 1, form())).status, 404);
    const bad = new FormData(); bad.append('file', new Blob(['bad'], { type: 'application/javascript' }), 'bad.js');
    assert.equal((await req('POST', `/projects/${project.id}/files`, 1, bad)).status, 400);
    const large = new FormData(); large.append('file', new Blob([new Uint8Array(25 * 1024 * 1024 + 1)], { type: 'application/pdf' }), 'large.pdf');
    assert.equal((await req('POST', `/projects/${project.id}/files`, 1, large)).status, 413);
    const list = await req('GET', `/projects/${project.id}/files?subjectId=${subject.id}`);
    assert.equal(list.data.total, 1); assert.equal(list.data.files[0].publicId, undefined);
  });
  await check('Spark links enforce group, subject and file context', async () => {
    spark = await Spark.create({ conversation: group._id, subject: 'Meet by the mural?', createdBy: host._id, participants: [host._id] });
    const link = await req('POST', `/projects/${project.id}/sparks`, 1, { sparkId: spark.id, subjectId: subject.id, fileId: file.id });
    assert.equal(link.status, 200, JSON.stringify(link));
    assert.equal((await req('POST', `/projects/${project.id}/sparks`, 1, { sparkId: spark.id, subjectId: project.subjects[1].id, fileId: file.id })).status, 404);
    const foreign = await Spark.create({ conversation: new mongoose.Types.ObjectId(), subject: 'Other group' });
    assert.equal((await req('POST', `/projects/${project.id}/sparks`, 1, { sparkId: foreign.id })).status, 404);
    const detail = await req('GET', `/projects/${project.id}`, 1);
    assert.equal(detail.data.sparks[0].fileId, file.id); assert.equal(detail.data.project.fileCount, 1);
  });
  await check('only creator/admin can archive, archive blocks uploads, restore keeps files', async () => {
    assert.equal((await req('PATCH', `/projects/${project.id}`, 1, { archived: true })).status, 403);
    assert.equal((await req('PATCH', `/projects/${project.id}`, 0, { archived: true })).status, 200);
    assert.equal((await req('POST', `/projects/${project.id}/subjects`, 1, { name: 'Blocked' })).status, 409);
    assert.equal((await req('GET', gp + '/projects?status=archived')).data.total, 1);
    await req('PATCH', `/projects/${project.id}`, 0, { archived: false });
    assert.equal((await req('GET', `/projects/${project.id}`)).data.files.length, 1);
  });
  const body = () => ({ topic: 'CosQuest planning call', description: 'Confirm the route', startsAt: new Date(Date.now() + 3600000).toISOString(), timeZone: 'Africa/Lagos', durationMinutes: 30, participantIds: [member.id], projectId: project.id, subjectId: subject.id, sparkId: spark.id });
  await check('schedule linked call, invitation notification, RSVP and calendar', async () => {
    const r = await req('POST', gp + '/scheduled-calls', 0, body());
    assert.equal(r.status, 201, JSON.stringify(r)); call = r.data.call;
    assert.match(call.inviteUrl, /\/call\//); assert.match(call.passcode, /^\d{6}$/);
    assert.equal(await Notification.countDocuments({ user: member._id, scheduledCall: call.id }), 1);
    assert.equal((await req('GET', gp + '/scheduled-calls', 1)).data.total, 1);
    assert.equal((await req('GET', `/projects/${project.id}`)).data.upcomingCalls[0].id, call.id);
    const rsvp = await req('POST', `/scheduled-calls/${call.id}/rsvp`, 1, { response: 'accepted' });
    assert.equal(rsvp.data.call.participants[0].response, 'accepted');
    const ics = await req('GET', `/scheduled-calls/${call.id}/calendar.ics`, 1);
    assert.match(ics.data, /BEGIN:VCALENDAR\r\n/); assert.match(ics.data, /TRIGGER:-PT10M/); assert.match(ics.data, /SUMMARY:CosQuest planning call/);
    assert.equal((await req('GET', `/call-invitations/${call.inviteUrl.split('/').pop()}`, 1)).data.call.id, call.id);
    assert.equal((await req('GET', `/call-invitations/${call.inviteUrl.split('/').pop()}`, 2)).status, 403);
  });
  await check('call validation and invited-only credentials', async () => {
    for (const patch of [{ timeZone: 'Bad/Zone' }, { startsAt: '2020-01-01T00:00:00Z' }, { durationMinutes: -5 }, { participantIds: [outsider.id] }, { hostVideo: 'true' }, { repeat: 'weekly', occurrences: 53 }]) {
      assert.ok([400, 403].includes((await req('POST', gp + '/scheduled-calls', 0, { ...body(), ...patch })).status));
    }
    assert.equal((await req('GET', `/scheduled-calls/${call.id}`, 2)).status, 403);
    const seen = await req('GET', `/scheduled-calls/${call.id}`, 3);
    assert.equal(seen.data.call.passcode, undefined); assert.equal(seen.data.call.inviteUrl, undefined);
    assert.equal((await req('POST', `/scheduled-calls/${call.id}/join`, 3, { passcode: call.passcode })).status, 403);
    assert.equal((await req('POST', `/scheduled-calls/${call.id}/join`, 1, { passcode: call.passcode })).status, 409);
    assert.equal((await req('PATCH', `/scheduled-calls/${call.id}`, 1, { topic: 'Hijack' })).status, 403);
  });
  await check('time zones, invalid calendar dates and recurring wall times across DST', async () => {
    assert.equal(localStart('2027-01-10', '18:00', 'Africa/Lagos').toISOString(), '2027-01-10T17:00:00.000Z');
    assert.throws(() => localStart('2027-02-30', '18:00', 'Africa/Lagos'));
    assert.throws(() => localStart('2027-03-14', '02:30', 'America/Los_Angeles'));
    const first = { startsAt: localStart('2027-03-07', '18:00', 'America/Los_Angeles'), timeZone: 'America/Los_Angeles', durationMinutes: 30 };
    const dates = occurrences(first, 'weekly', 2);
    assert.equal(dates[0].startsAt.toISOString(), '2027-03-08T02:00:00.000Z');
    assert.equal(dates[1].startsAt.toISOString(), '2027-03-15T01:00:00.000Z');
    const series = await req('POST', gp + '/scheduled-calls', 0, { ...body(), repeat: 'weekly', occurrences: 3 });
    assert.equal(series.data.occurrences.length, 3); assert.equal(new Set(series.data.occurrences.map(c => c.seriesId)).size, 1);
  });
  await check('host edits occurrence, resets responses when time changes, then cancels', async () => {
    const updated = await req('PATCH', `/scheduled-calls/${call.id}`, 0, { startsAt: new Date(Date.now() + 7200000).toISOString(), topic: 'Changed topic' });
    assert.equal(updated.status, 200); assert.equal(updated.data.call.participants[0].response, 'pending');
    assert.equal((await req('POST', `/scheduled-calls/${call.id}/cancel`, 1)).status, 403);
    assert.equal((await req('POST', `/scheduled-calls/${call.id}/cancel`)).data.call.status, 'cancelled');
    assert.equal((await req('POST', `/scheduled-calls/${call.id}/join`, 1, { passcode: call.passcode })).status, 409);
  });
  await check('waiting-room admission controls token issuance and camera grants', async () => {
    const r = await req('POST', gp + '/meet-now', 0, { ...body(), waitingRoom: true, participantVideo: false });
    assert.equal(r.status, 201, JSON.stringify(r)); const m = r.data.call;
    assert.equal((await req('POST', `/scheduled-calls/${m.id}/join`, 1, { passcode: '000000' })).status, 403);
    const waiting = await req('POST', `/scheduled-calls/${m.id}/join`, 1, { passcode: m.passcode });
    assert.equal(waiting.status, 202); assert.equal(waiting.data.token, undefined);
    assert.equal((await req('POST', `/scheduled-calls/${m.id}/admission/${member.id}`, 1, { status: 'admitted' })).status, 403);
    assert.equal((await req('POST', `/scheduled-calls/${m.id}/admission/${member.id}`, 0, { status: 'admitted' })).status, 200);
    const joined = await req('POST', `/scheduled-calls/${m.id}/join`, 1, { passcode: m.passcode });
    assert.equal(joined.status, 200, JSON.stringify(joined));
    const claims = JSON.parse(Buffer.from(joined.data.token.split('.')[1], 'base64url'));
    assert.deepEqual(claims.video.canPublishSources, ['microphone']); assert.equal(joined.data.videoEnabled, false);
    const hostJoin = await req('POST', `/scheduled-calls/${m.id}/join`);
    assert.equal(hostJoin.status, 200); assert.equal(hostJoin.data.videoEnabled, true);
    await Member.deleteOne({ conversation: group._id, user: member._id });
    assert.equal((await req('POST', `/scheduled-calls/${m.id}/join`, 1, { passcode: m.passcode })).status, 403);
    await Member.create({ conversation: group._id, user: member._id, role: 'member' });
  });
  await check('ten-minute reminders are durable and do not duplicate on a second sweep', async () => {
    const r = await req('POST', gp + '/scheduled-calls', 0, { ...body(), startsAt: new Date(Date.now() + 5 * 60000).toISOString() });
    await remindDue(); await remindDue();
    assert.equal(await Notification.countDocuments({ scheduledCall: r.data.call.id, user: member._id, message: /starts in 10 minutes/ }), 1);
    assert.ok((await ScheduledCall.findById(r.data.call.id)).reminderSentAt);
  });
  await check('file deletion is restricted and removes stale Spark attachment pointers', async () => {
    assert.equal((await req('DELETE', `/projects/${project.id}/files/${file.id}`, 3)).status, 403);
    assert.equal((await req('DELETE', `/projects/${project.id}/files/${file.id}`, 1)).status, 200);
    assert.equal(await ProjectFile.countDocuments({ project: project.id }), 0);
    assert.equal((await req('GET', `/projects/${project.id}`)).data.sparks[0].fileId, null);
  });
  await check('module-engine Sparks link to projects and scheduled calls alongside legacy links', async () => {
    const engine = require('../src/sparks');
    if (!engine.isReady()) {
      const worker = process.env.SPARKS_WORKER;
      process.env.SPARKS_WORKER = '0';
      try { await engine.init({ getIO: () => null }); }
      finally { if (worker === undefined) delete process.env.SPARKS_WORKER; else process.env.SPARKS_WORKER = worker; }
    }
    assert.ok(engine.isReady());
    const sparkId = `spk_planning_${suffix}`;
    await engine.store.insertSpark({ sparkId, chatId: group.id, subject: 'Supplies needed', state: 'active', pinned: false, revivalIndex: 0, summaryText: null, summaryBasedOnSeq: null, summaryUpdatedAt: null, createdBy: host.id, createdAt: Date.now(), lastMessageAt: Date.now(), mergedInto: null, version: 1, firstUnsummarizedAt: null });
    process.env.SPARKS_ENGINE = 'module';
    try {
      assert.equal((await req('POST', `/projects/${project.id}/sparks`, 1, { sparkId, subjectId: subject.id })).status, 200);
      const detail = await req('GET', `/projects/${project.id}`);
      assert.equal(detail.status, 200); assert.equal(detail.data.sparks.length, 2);
      const scheduled = await req('POST', gp + '/scheduled-calls', 0, { ...body(), sparkId });
      assert.equal(scheduled.status, 201, JSON.stringify(scheduled)); assert.equal(scheduled.data.call.sparkId, sparkId);
      await engine.store.patchSpark(sparkId, { state: 'deleted' });
      assert.equal((await req('GET', `/projects/${project.id}`)).data.sparks.length, 1);
      assert.equal((await req('POST', gp + '/scheduled-calls', 0, { ...body(), sparkId })).status, 404);
    } finally { process.env.SPARKS_ENGINE = 'legacy'; }
  });
  console.log(`[projects/calls] ${pass} passed, ${fail} failed`);
  return { pass, fail };
}
async function run(baseUrl) {
  const previous = process.env.SPARKS_ENGINE;
  process.env.SPARKS_ENGINE = 'legacy';
  try { return await runPlanning(baseUrl); }
  finally { if (previous === undefined) delete process.env.SPARKS_ENGINE; else process.env.SPARKS_ENGINE = previous; }
}
module.exports = { run };
