// Request validation on the call routes (src/validators/calls.js: calls,
// voice chats, the stage, faction alerts) and the planning routes
// (src/validators/planning.js: projects and scheduled calls). Each refused
// request keeps the status and message the controller gave before; good
// requests still work.
const fs = require('fs');
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const Member = require('../src/models/ConversationMember');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
  async function request(method, path, token, body) {
    const multipart = body instanceof FormData;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  // A refusal in the shared shape, with this status and message.
  const refused = (r, status, message) => r.status === status && r.data?.error === message && Array.isArray(r.data.errors);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const factionKey = `vc${suffix}`;
  const made = await Promise.all(['Ann', 'Ben', 'Cal'].map((name) => User.create({
    profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Val', avatarKey: 'green-knight' },
    email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: factionKey,
  })));
  const [ann, ben, cal] = made.map((user) => ({ id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) }));
  const dm = await Conversation.create({ type: 'dm', dmKey: [ann.id, ben.id].sort().join('_'), participants: [ann.id, ben.id] });
  const factionRoom = await Conversation.create({ type: 'faction', factionKey });
  const group = await Conversation.create({ type: 'group', group: { name: `Validation ${suffix}`, kind: 'private', createdBy: ann.id } });
  await Member.insertMany([ann, ben].map((u, i) => ({ conversation: group._id, user: u.id, role: i ? 'member' : 'owner' })));
  const badId = 'not-an-id';
  const otherId = '0123456789abcdef01234567';

  console.log('\n--- validation: calls ---');
  const callsPath = `/api/chats/${dm.id}/calls`;
  check(refused(await request('POST', callsPath, ann.token, { type: 'phone' }), 400, 'Call type must be audio or video.'), 'start: an unknown type keeps its 400 message');
  check(refused(await request('POST', callsPath, ann.token, { type: ['audio'] }), 400, 'Call type must be audio or video.'), 'start: a list for type is refused');
  check(refused(await request('POST', `/api/chats/${badId}/calls`, ann.token, { type: 'audio' }), 404, 'Conversation not found.'), 'start: a malformed chat id is still 404 "Conversation not found."');
  const started = await request('POST', callsPath, ann.token, { type: 'audio' });
  check(started.status === 201, 'start: a good request still starts the call', started);
  const callId = started.data?.call?.id;

  check(refused(await request('GET', `/api/calls/${badId}`, ann.token), 404, 'Call not found.'), 'a malformed call id is still 404 "Call not found."');
  check(refused(await request('POST', `/api/calls/${badId}/accept`, ben.token), 404, 'Call not found.'), 'accept: a malformed call id is 404');
  check(refused(await request('POST', `/api/calls/${callId}/invite`, ann.token, { userIds: cal.id }), 400, 'userIds must be a list of user ids.'), 'invite: userIds as text is refused (was silently ignored)');
  check(refused(await request('POST', `/api/calls/${callId}/invite`, ann.token, { usernames: { first: cal.username } }), 400, 'usernames must be a list of usernames.'), 'invite: usernames as an object is refused');
  const tooMany = Array.from({ length: 51 }, (_, i) => `${i}`.padStart(24, 'a'));
  check(refused(await request('POST', `/api/calls/${callId}/invite`, ann.token, { userIds: tooMany }), 400, 'You can add up to 50 people at a time.'), 'invite: the per-request limit keeps its message');
  check((await request('POST', `/api/calls/${callId}/invite`, ann.token, {})).data.error === 'Choose at least one person to add.', 'invite: nobody named still answers from the controller');
  const invited = await request('POST', `/api/calls/${callId}/invite`, ann.token, { userIds: null, usernames: [cal.username] });
  check(invited.status === 200 && invited.data.invited.includes(cal.id), 'invite: a good request (userIds null) still adds people', invited);
  const privatePath = `/api/calls/${callId}/private`;
  check(refused(await request('POST', privatePath, ann.token, { userId: 42 }), 400, 'Choose who to call privately (userId).'), 'private: a number for userId keeps the 400 message');
  check(refused(await request('POST', privatePath, ann.token, {}), 400, 'Choose who to call privately (userId).'), 'private: userId is required');
  check(refused(await request('POST', `/api/calls/${callId}/members/${badId}/mute`, ann.token), 400, 'Invalid user ID.'), 'moderation: a malformed user id is still 400 "Invalid user ID."');
  check(refused(await request('POST', `/api/calls/${badId}/members/${ben.id}/remove`, ann.token), 404, 'Call not found.'), 'moderation: a malformed call id is 404 first');
  check(refused(await request('POST', `/api/calls/${callId}/alert`, ann.token, { message: 7 }), 400, 'message must be text.'), 'call alert: a number for message is refused (same message)');
  check(refused(await request('POST', `/api/calls/${callId}/alert`, ann.token, { message: 'x'.repeat(201) }), 400, 'Keep the message under 200 characters.'), 'call alert: over 200 characters is refused (same message)');
  const alerted = await request('POST', `/api/calls/${callId}/alert`, ann.token, { message: `  ${'y'.repeat(200)}  ` });
  check(alerted.status === 201 && alerted.data.alert.message === 'y'.repeat(200), 'call alert: 200 characters plus spaces is still accepted (counted after trimming)', alerted);
  const transcriptPath = `/api/calls/${callId}/transcript`;
  check(refused(await request('GET', `${transcriptPath}?limit=1&limit=2`, ann.token), 400, 'limit must be a single value.'), 'transcript: a repeated ?limit is refused');
  check((await request('GET', `${transcriptPath}?limit=abc`, ann.token)).status !== 400, 'transcript: a lenient ?limit still reaches the handler');

  console.log('\n--- validation: voice chats and the stage ---');
  const voicePath = `/api/chats/${factionRoom.id}/voice`;
  check(refused(await request('GET', `/api/chats/${badId}/voice`, ann.token), 404, 'Conversation not found.'), 'voice: a malformed chat id is still 404');
  const joined = await request('POST', `${voicePath}/join`, ann.token);
  check(joined.status === 201, 'voice: joining still works', joined);
  await request('POST', `${voicePath}/join`, ben.token);
  const roomId = joined.data?.voiceRoom?.id;
  check(refused(await request('POST', `/api/voice/${badId}/ping`, ann.token), 404, 'Voice chat not found.'), 'voice: a malformed room id is still 404 "Voice chat not found."');
  check(refused(await request('POST', `/api/voice/${roomId}/stage`, ann.token, { on: 'true' }), 400, 'on must be true or false.'), 'stage: "true" as text is refused (same message)');
  check(refused(await request('POST', `/api/voice/${roomId}/stage`, ann.token, {}), 400, 'on must be true or false.'), 'stage: on is required');
  check((await request('POST', `/api/voice/${roomId}/stage`, ann.token, { on: true })).status === 200, 'stage: a good request still turns it on');
  check(refused(await request('POST', `/api/voice/${roomId}/hand`, ben.token, { raised: 1 }), 400, 'raised must be true or false.'), 'hand: 1 is not true/false');
  check((await request('POST', `/api/voice/${roomId}/hand`, ben.token, { raised: true })).data?.handRaised === true, 'hand: a good request still raises it');
  check(refused(await request('POST', `/api/voice/${roomId}/members/${ben.id}/role`, ann.token, { role: 'boss' }), 400, 'role must be speaker or listener.'), 'role: an unknown role keeps its message');
  check(refused(await request('POST', `/api/voice/${roomId}/members/${badId}/role`, ann.token, { role: 'speaker' }), 400, 'Invalid user ID.'), 'role: a malformed user id is 400');
  check((await request('POST', `/api/voice/${roomId}/members/${ben.id}/role`, ann.token, { role: 'speaker' })).status === 200, 'role: a good request still promotes');
  check(refused(await request('POST', `/api/voice/${roomId}/private`, ann.token, { userId: [ben.id] }), 400, 'Choose who to call privately (userId).'), 'voice private: a list for userId is refused');
  check(refused(await request('POST', `/api/voice/${roomId}/members/${badId}/remove`, ann.token), 400, 'Invalid user ID.'), 'voice moderation: a malformed user id is 400');
  check(refused(await request('POST', `/api/voice/${roomId}/alert`, ben.token, { message: ['help'] }), 400, 'message must be text.'), 'voice alert: a list for message is refused');
  check(refused(await request('GET', `/api/alerts/${badId}`, ben.token), 404, 'Alert not found.'), 'alerts: a malformed id is still 404 "Alert not found."');
  check((await request('GET', `/api/alerts/${alerted.data?.alert?.alertId}`, ben.token)).status === 200, 'alerts: a good request still works');

  console.log('\n--- validation: projects ---');
  const gp = `/api/groups/${group.id}`;
  check(refused(await request('POST', `/api/groups/${badId}/projects`, ann.token, { name: 'X' }), 400, 'Invalid group ID.'), 'project: a malformed group id is still 400 "Invalid group ID."');
  check(refused(await request('POST', `${gp}/projects`, ann.token, { name: ['Plan'] }), 400, 'Project name must be 1-100 characters.'), 'project: a list for name is refused (same message)');
  check(refused(await request('POST', `${gp}/projects`, ann.token, { name: 'Plan', subjects: 'Costumes' }), 400, 'Provide up to 100 subjects.'), 'project: subjects must be a list');
  check(refused(await request('POST', `${gp}/projects`, ann.token, { name: 'Plan', subjects: ['Costumes'] }), 400, 'Subject name must be 1-100 characters.'), 'project: a subject must be { name }');
  check(refused(await request('POST', `${gp}/projects`, ann.token, { name: 'Plan', subjects: [{ name: 'x'.repeat(101) }] }), 400, 'Subject name must be 1-100 characters.'), 'project: subject names are at most 100 characters');
  check(refused(await request('POST', `${gp}/projects`, ann.token, { name: 'Plan', dueAt: 5 }), 400, 'dueAt must be an ISO date or null.'), 'project: dueAt must be a date');
  const project = await request('POST', `${gp}/projects`, ann.token, { name: '  Plan  ', description: null, location: '', dueAt: '', subjects: [{ name: 'Route', description: null }] });
  check(project.status === 201 && project.data.project.name === 'Plan', 'project: a good request (nulls and blanks where allowed) still creates it', project);
  const projectId = project.data?.project?.id;
  check(refused(await request('GET', `${gp}/projects?status=closed`, ann.token), 400, 'status must be active or archived.'), 'projects list: an unknown status keeps its message');
  check(refused(await request('GET', `${gp}/projects?q=a&q=b`, ann.token), 400, 'Search must be 0-100 characters.'), 'projects list: a repeated ?q keeps its message');
  check(refused(await request('GET', `${gp}/projects?offset=1&offset=2`, ann.token), 400, 'offset must be a single value.'), 'projects list: a repeated ?offset is refused');
  check((await request('GET', `${gp}/projects?q=plan&offset=abc`, ann.token)).data?.projects?.length === 1, 'projects list: good (and lenient) queries still work');
  check(refused(await request('GET', `/api/projects/${badId}`, ann.token), 400, 'Invalid project ID.'), 'project: a malformed id is still 400 "Invalid project ID."');
  check(refused(await request('PATCH', `/api/projects/${projectId}`, ann.token, { name: '  ' }), 400, 'Project name must be 1-100 characters.'), 'project edit: a blank name is refused');
  check(refused(await request('PATCH', `/api/projects/${projectId}`, ann.token, { description: null }), 400, 'Description must be 0-2000 characters.'), 'project edit: null is not a description');
  check(refused(await request('PATCH', `/api/projects/${projectId}`, ann.token, { archived: 'false' }), 400, 'archived must be boolean.'), 'project edit: archived must be true/false');
  check((await request('PATCH', `/api/projects/${projectId}`, ann.token, { dueAt: null, location: 'Park' })).status === 200, 'project edit: a good request still works');
  check(refused(await request('POST', `/api/projects/${projectId}/subjects`, ann.token, {}), 400, 'Subject name must be 1-100 characters.'), 'subject: name is required');
  check(refused(await request('GET', `/api/projects/${projectId}/files?subjectId=nope`, ann.token), 400, 'Invalid subject ID.'), 'files: a malformed ?subjectId keeps its message');
  check(refused(await request('GET', `/api/projects/${projectId}/files?sort=size`, ann.token), 400, 'sort must be newest, oldest or name.'), 'files: an unknown sort keeps its message');
  check((await request('GET', `/api/projects/${projectId}/files?subjectId=&sort=`, ann.token)).status === 200, 'files: empty filters are still fine');
  const form = new FormData();
  form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  const staged = () => (process.env.UPLOAD_DIR && fs.existsSync(process.env.UPLOAD_DIR) ? fs.readdirSync(process.env.UPLOAD_DIR).length : 0);
  const stagedBefore = staged();
  check(refused(await request('POST', `/api/projects/${projectId}/subjects/nope/files`, ann.token, form), 400, 'Invalid subject ID.'), 'upload: a malformed subject id is refused before the upload');
  check(staged() === stagedBefore, 'upload: a refused upload leaves no staged file on disk', { before: stagedBefore, after: staged() });
  check(refused(await request('DELETE', `/api/projects/${projectId}/files/nope`, ann.token), 400, 'Invalid file ID.'), 'files: a malformed file id is still 400');
  check(refused(await request('POST', `/api/projects/${projectId}/sparks`, ann.token, { sparkId: 5 }), 400, 'Invalid Spark ID.'), 'link Spark: a number for sparkId is refused');
  check(refused(await request('POST', `/api/projects/${projectId}/sparks`, ann.token, { sparkId: 'spk_1', subjectId: 'nope' }), 400, 'Invalid subject ID.'), 'link Spark: a malformed subjectId keeps its message');
  check(refused(await request('POST', `/api/projects/${projectId}/sparks`, ann.token, { sparkId: 'spk_1', fileId: { id: 1 } }), 400, 'Invalid file ID.'), 'link Spark: an object for fileId is refused');

  console.log('\n--- validation: scheduled calls ---');
  const when = () => ({ topic: 'Route walk', startsAt: new Date(Date.now() + 3600000).toISOString(), timeZone: 'Africa/Lagos', durationMinutes: 30 });
  const sp = `${gp}/scheduled-calls`;
  check(refused(await request('POST', `/api/chats/${badId}/scheduled-calls`, ann.token, when()), 400, 'Invalid group ID.'), 'schedule: a malformed chat id is still 400 "Invalid group ID."');
  check(refused(await request('POST', sp, ann.token, { ...when(), topic: 5 }), 400, 'Topic must be 1-150 characters.'), 'schedule: a number for topic keeps its message');
  check(refused(await request('POST', sp, ann.token, { ...when(), topic: 'x'.repeat(151) }), 400, 'Topic must be 1-150 characters.'), 'schedule: topics are at most 150 characters');
  check(refused(await request('POST', sp, ann.token, { ...when(), timeZone: undefined }), 400, 'Choose an IANA time zone, for example Africa/Lagos.'), 'schedule: timeZone is required');
  check(refused(await request('POST', sp, ann.token, { ...when(), startsAt: 1767225600000 }), 400, 'startsAt must be an ISO timestamp with a UTC offset.'), 'schedule: a number for startsAt keeps its message');
  check(refused(await request('POST', sp, ann.token, { ...when(), durationMinutes: undefined, durationMin: '45' }), 400, 'Duration must be 5-480 whole minutes.'), 'schedule: durationMin (the app name) is checked too');
  check(refused(await request('POST', sp, ann.token, { ...when(), participantIds: ben.id }), 400, 'Choose up to 100 people from this chat.'), 'schedule: participantIds must be a list');
  check(refused(await request('POST', sp, ann.token, { ...when(), participantIds: ['nope'] }), 400, 'Invalid participant ID.'), 'schedule: participant ids must be ids');
  check(refused(await request('POST', sp, ann.token, { ...when(), spark: 'spk_1' }), 400, 'spark must be { id, subject } or null.'), 'schedule: spark must be { id } or null');
  check(refused(await request('POST', sp, ann.token, { ...when(), whoCanJoin: 'all' }), 400, 'whoCanJoin must be invited or members.'), 'schedule: whoCanJoin keeps its message');
  check(refused(await request('POST', sp, ann.token, { ...when(), waitingRoom: 'yes' }), 400, 'waitingRoom must be boolean.'), 'schedule: settings must be true/false');
  check(refused(await request('POST', sp, ann.token, { ...when(), subjectId: otherId }), 400, 'Select a project before a subject.'), 'schedule: a subject needs a project (same message)');
  check(refused(await request('POST', sp, ann.token, { ...when(), repeat: 'weekly', occurrences: 60 }), 400, 'Choose 1-52 occurrences (1 for a one-time call).'), 'schedule: occurrences keeps its message');
  const monthly = await request('POST', sp, ann.token, { ...when(), repeat: 'monthly', occurrences: 3 });
  check(monthly.status === 400 && monthly.data.error === 'Monthly calls repeat as one series; leave out occurrences.', 'schedule: monthly + occurrences still answers from the controller', monthly);
  const scheduled = await request('POST', sp, ann.token, { ...when(), spark: null, participantIds: [ben.id], whoCanJoin: 'members', repeat: null, description: null });
  check(scheduled.status === 201, 'schedule: a good request (app names, nulls where allowed) still works', scheduled);
  const meet = await request('POST', `${gp}/meet-now`, ann.token, { topic: 'Now', timeZone: 'Africa/Lagos', startsAt: 'ignored' });
  check(meet.status === 201, 'meet now: startsAt is still not read', meet);
  const sid = scheduled.data?.call?.id;
  check(refused(await request('GET', `${sp}?view=later`, ann.token), 400, 'view must be upcoming, past or cancelled.'), 'scheduled list: an unknown view keeps its message');
  check((await request('GET', `${sp}?view=&offset=x`, ann.token)).status === 200, 'scheduled list: empty view and a lenient offset still work');
  check(refused(await request('GET', `/api/scheduled-calls/${badId}`, ann.token), 400, 'Invalid call ID.'), 'scheduled call: a malformed id is still 400 "Invalid call ID."');
  check(refused(await request('PATCH', `/api/scheduled-calls/${sid}`, ann.token, { occurrences: 1 }), 400, 'Edit this occurrence only; create a new series to change the number of calls.'), 'edit: occurrences keeps its message');
  check(refused(await request('PATCH', `/api/scheduled-calls/${sid}`, ann.token, { topic: '' }), 400, 'Topic must be 1-150 characters.'), 'edit: a blank topic is refused');
  check(refused(await request('PATCH', `/api/scheduled-calls/${sid}`, ann.token, { timeZone: null }), 400, 'Choose an IANA time zone, for example Africa/Lagos.'), 'edit: null is not a time zone');
  check(refused(await request('PATCH', `/api/scheduled-calls/${sid}`, ann.token, { participantIds: null }), 400, 'Choose up to 100 people from this chat.'), 'edit: null is not a participant list');
  check((await request('PATCH', `/api/scheduled-calls/${sid}`, ann.token, { topic: 'Route walk 2', durationMin: 45 })).data?.call?.durationMin === 45, 'edit: a good request still works');
  check(refused(await request('POST', `/api/scheduled-calls/${sid}/rsvp`, ben.token, { status: 'maybe' }), 400, 'status must be accepted or declined.'), 'rsvp: an unknown status keeps its message');
  check(refused(await request('POST', `/api/scheduled-calls/${sid}/rsvp`, ben.token, {}), 400, 'status must be accepted or declined.'), 'rsvp: a response is required');
  check((await request('POST', `/api/scheduled-calls/${sid}/rsvp`, ben.token, { status: 'accepted' })).status === 200, 'rsvp: the app name (status) still works');
  check(refused(await request('POST', `/api/scheduled-calls/${sid}/admission/nope`, ann.token, { status: 'admitted' }), 400, 'Invalid participant ID.'), 'admission: a malformed user id keeps its message');
  check(refused(await request('POST', `/api/scheduled-calls/${sid}/admission/${ben.id}`, ann.token, { status: 'yes' }), 400, 'status must be admitted or denied.'), 'admission: an unknown status keeps its message');
  check(refused(await request('GET', '/api/call-invitations/short', ann.token), 404, 'Invitation not found.'), 'invitation: a malformed code is still 404 "Invitation not found."');

  console.log(`\nvalidation (calls and planning): ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
