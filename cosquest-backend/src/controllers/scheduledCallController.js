const crypto = require('crypto');
const { AccessToken, TrackSource } = require('livekit-server-sdk');
const ScheduledCall = require('../models/ScheduledCall');
const User = require('../models/User');
const { fail, objectId, text, groupFor, projectFor, subjectFor, sparkFor } = require('../utils/projectAccess');
const { timing, occurrences, calendar, rollForward } = require('../utils/meetingTime');
const { notifyMeeting, announceCall } = require('../utils/meetingNotifications');
const { peopleFor, callJson, isHost, canJoin, inviteUrl } = require('../utils/scheduledCallJson');
const { recordScheduledCallMessage } = require('../utils/scheduledCallMessage');
const { getLivekitUrl } = require('../utils/livekit');
const { emitToUser } = require('../realtime/socket');

const REPEATS = ['none', 'daily', 'weekly', 'monthly'];

function changed(c) {
  announceCall(c).catch((e) => console.error('[scheduled calls] live update failed:', e.message));
}

// The app (services/scheduledCalls.ts) names some fields differently from the
// first version of this API; both are accepted:
//   durationMin -> durationMinutes, spark { id } | null -> sparkId,
//   whoCanJoin "members" -> "group", RSVP { status } -> { response }.
function normalize(body) {
  const b = { ...(body || {}) };
  if (b.durationMin !== undefined && b.durationMinutes === undefined) b.durationMinutes = b.durationMin;
  if (b.spark !== undefined && b.sparkId === undefined) {
    if (b.spark !== null && (typeof b.spark !== 'object' || typeof b.spark.id !== 'string')) fail(400, 'spark must be { id, subject } or null.');
    b.sparkId = b.spark ? b.spark.id : null;
  }
  if (b.whoCanJoin === 'members') b.whoCanJoin = 'group';
  if (b.status !== undefined && b.response === undefined) b.response = b.status;
  return b;
}

// Repeating series move to their next occurrence when read, so responses are
// right even if the background sweep (meetingNotifications.rollDue) is behind.
async function fresh(c) {
  if (!rollForward(c)) return c;
  try { await c.save(); changed(c); } catch (e) { if (e.name !== 'VersionError') throw e; return ScheduledCall.findById(c._id).select('+passcode'); }
  return c;
}

async function load(req, { host = false, active = false } = {}) {
  let c = await ScheduledCall.findById(objectId(req.params.callId, 'call ID')).select('+passcode');
  if (!c) fail(404, 'Scheduled call not found.');
  await groupFor(String(c.conversation), req.user);
  c = await fresh(c);
  if (host && !isHost(c, req.userId)) fail(403, 'Only the host can manage this call.');
  if (active && (c.cancelledAt || c.endsAt <= new Date())) fail(409, 'This call is cancelled or has ended.');
  return c;
}
async function participants(groupId, ids, hostId, previous = []) {
  if (!Array.isArray(ids) || ids.length > 100) fail(400, 'Choose up to 100 group members.');
  const unique = [...new Set(ids.map(id => objectId(id, 'participant ID')))].filter(id => id !== String(hostId));
  const users = await User.find({ _id: { $in: unique }, onboardingComplete: true });
  if (users.length !== unique.length) fail(400, 'One or more participants are unavailable.');
  await Promise.all(users.map(u => groupFor(groupId, u)));
  return unique.map(id => ({ user: id, response: previous.find(p => String(p.user) === id)?.response || 'pending' }));
}
async function context(groupId, b, user) {
  let project = null;
  if (b.projectId) {
    project = await projectFor(b.projectId, user, { write: true });
    if (String(project.conversation) !== groupId) fail(400, 'Choose a project in this group.');
  }
  if (b.subjectId && !project) fail(400, 'Select a project before a subject.');
  const subject = project && subjectFor(project, b.subjectId);
  const spark = b.sparkId ? await sparkFor(groupId, b.sparkId) : null;
  return {
    projectId: project?._id || null, subjectId: subject?._id || null,
    sparkId: spark?.id || null, sparkEngine: spark ? require('../sparks').engine() : null, sparkSubject: spark?.subject || null,
  };
}
function settings(b) {
  const out = {};
  for (const key of ['hostVideo', 'participantVideo', 'waitingRoom']) if (b[key] !== undefined) {
    if (typeof b[key] !== 'boolean') fail(400, `${key} must be boolean.`);
    out[key] = b[key];
  }
  if (b.whoCanJoin !== undefined) { if (!['invited', 'group'].includes(b.whoCanJoin)) fail(400, 'whoCanJoin must be invited or members.'); out.whoCanJoin = b.whoCanJoin; }
  return out;
}
const newMeetingCode = () => String(crypto.randomInt(100000000, 1000000000));

// POST /api/chats/:conversationId/scheduled-calls (the app),
// POST /api/groups/:groupId/scheduled-calls and /meet-now.
//
// A repeating call is ONE record for the whole series (rollsForward): its
// startsAt is always the next occurrence. Sending `occurrences` > 1 instead
// creates one record per occurrence, as the first version of this API did.
async function create(req, res) {
  const group = await groupFor(req.params.groupId || req.params.conversationId, req.user);
  const b = normalize(req.body);
  const immediate = req.path.endsWith('/meet-now');
  const first = timing(b, { immediate });
  const repeat = immediate ? 'none' : b.repeat ?? 'none';
  if (!REPEATS.includes(repeat)) fail(400, 'repeat must be none, daily, weekly or monthly.');
  const series = b.occurrences !== undefined && b.occurrences !== 1;
  if (series && repeat === 'monthly') fail(400, 'Monthly calls repeat as one series; leave out occurrences.');
  const dates = series ? occurrences(first, repeat, b.occurrences) : [first];
  const base = { conversation: group._id, host: req.userId,
    topic: text(b.topic, 'Topic', 150, true), description: text(b.description ?? '', 'Description', 2000),
    participants: await participants(String(group._id), b.participantIds || [], req.userId),
    ...await context(String(group._id), b, req.user), ...settings(b), repeat,
    rollsForward: !series && repeat !== 'none',
    seriesId: dates.length > 1 ? crypto.randomUUID() : null };
  let calls;
  for (let attempt = 0; ; attempt++) {
    // Validate the complete series before the first write.
    const docs = dates.map((date, i) => new ScheduledCall({ ...base, ...date, occurrence: i + 1,
      anchorStartsAt: base.rollsForward ? date.startsAt : null,
      meetingCode: newMeetingCode(),
      inviteCode: crypto.randomBytes(24).toString('base64url'), passcode: String(crypto.randomInt(100000, 1000000)) }));
    await Promise.all(docs.map(c => c.validate()));
    try { calls = await ScheduledCall.insertMany(docs); break; }
    catch (e) { if (e.code !== 11000 || attempt >= 2) throw e; } // a meeting code was taken: draw new ones
  }
  // One invitation and one chat card for the series; each occurrence remains separately editable.
  await notifyMeeting(calls[0], dates.length > 1 ? `${dates.length} calls scheduled` : 'invitation received');
  recordScheduledCallMessage(calls[0], 'scheduled');
  calls.forEach(changed);
  const people = await peopleFor(calls);
  res.status(201).json({ call: callJson(calls[0], req.userId, people), occurrences: calls.map(c => callJson(c, req.userId, people)) });
}

// GET /api/groups/:groupId/scheduled-calls?view=upcoming|past|cancelled
async function list(req, res) {
  await groupFor(req.params.groupId, req.user);
  const view = req.query.view || 'upcoming';
  if (!['upcoming', 'past', 'cancelled'].includes(view)) fail(400, 'view must be upcoming, past or cancelled.');
  const filter = { conversation: req.params.groupId, cancelledAt: view === 'cancelled' ? { $ne: null } : null, ...(view === 'cancelled' ? {} : { endsAt: view === 'past' ? { $lte: new Date() } : { $gt: new Date() } }) };
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const [calls, total] = await Promise.all([ScheduledCall.find(filter).select('+passcode').sort({ startsAt: view === 'upcoming' ? 1 : -1, _id: 1 }).skip(offset).limit(50), ScheduledCall.countDocuments(filter)]);
  const people = await peopleFor(calls);
  res.json({ calls: calls.map(c => callJson(c, req.userId, people)), total, nextOffset: offset + calls.length < total ? offset + calls.length : null });
}

// GET /api/chats/:conversationId/scheduled-calls -> { calls } for the app's
// Calls tab: every upcoming call (soonest first, cancelled ones included so
// the app can show them as cancelled), then the 50 most recent past ones.
async function listForChat(req, res) {
  const group = await groupFor(req.params.conversationId, req.user);
  const now = new Date();
  const [upcoming, past] = await Promise.all([
    ScheduledCall.find({ conversation: group._id, $or: [{ endsAt: { $gt: now } }, { rollsForward: true, cancelledAt: null }] }).select('+passcode').sort({ startsAt: 1, _id: 1 }).limit(200),
    // A live series is never past; a cancelled one whose last occurrence ended is.
    ScheduledCall.find({ conversation: group._id, endsAt: { $lte: now }, $or: [{ rollsForward: { $ne: true } }, { cancelledAt: { $ne: null } }] }).select('+passcode').sort({ startsAt: -1, _id: 1 }).limit(50),
  ]);
  const current = await Promise.all(upcoming.map(fresh));
  current.sort((a, b) => a.startsAt - b.startsAt);
  const calls = [...current, ...past];
  const people = await peopleFor(calls);
  res.json({ calls: calls.map(c => callJson(c, req.userId, people)) });
}
async function details(req, res) {
  const c = await load(req);
  const people = await peopleFor([c]);
  res.json({ call: callJson(c, req.userId, people), people: [...people.values()].map(u => ({ id: String(u._id), username: u.profile?.username, name: [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ') || u.profile?.username, avatarKey: u.profile?.avatarKey, avatarPhotoUrl: u.profile?.avatarPhotoUrl })) });
}
async function update(req, res) {
  const c = await load(req, { host: true, active: true });
  if (c.startsAt <= new Date()) fail(409, 'Only upcoming calls can be edited.');
  const b = normalize(req.body);
  if (b.occurrences !== undefined) fail(400, 'Edit this occurrence only; create a new series to change the number of calls.');
  if (b.repeat !== undefined && b.repeat !== c.repeat) {
    if (c.seriesId) fail(400, 'This call is one occurrence of a series; create a new series to change repetition.');
    if (!REPEATS.includes(b.repeat)) fail(400, 'repeat must be none, daily, weekly or monthly.');
    c.repeat = b.repeat;
    c.rollsForward = b.repeat !== 'none';
  }
  if (b.topic !== undefined) c.topic = text(b.topic, 'Topic', 150, true);
  if (b.description !== undefined) c.description = text(b.description, 'Description', 2000);
  const timingChanged = ['startsAt', 'date', 'startTime', 'timeZone', 'durationMinutes'].some(k => b[k] !== undefined);
  if (timingChanged) {
    const hasLocal = b.date !== undefined || b.startTime !== undefined;
    Object.assign(c, timing({ timeZone: c.timeZone, durationMinutes: c.durationMinutes, ...(!hasLocal ? { startsAt: c.startsAt.toISOString() } : {}), ...b }));
    c.reminderSentAt = null;
    for (const p of c.participants) p.response = 'pending';
  }
  // A series counts its occurrences from the (possibly new) start.
  if (c.rollsForward && (timingChanged || b.repeat !== undefined)) { c.anchorStartsAt = c.startsAt; c.occurrence = 1; }
  const oldIds = c.participants.map(p => String(p.user));
  if (b.participantIds !== undefined) c.participants = await participants(String(c.conversation), b.participantIds, c.host, c.participants);
  if (['projectId', 'subjectId', 'sparkId'].some(k => b[k] !== undefined)) Object.assign(c, await context(String(c.conversation), { projectId: c.projectId && String(c.projectId), subjectId: c.subjectId && String(c.subjectId), sparkId: c.sparkId, ...b }, req.user));
  Object.assign(c, settings(b));
  c.admission = []; // changed invitations/access never carry old admission forward
  await c.save(); changed(c);
  await notifyMeeting(c, 'call updated', [...new Set([...oldIds, ...c.participants.map(p => String(p.user))])]);
  res.json({ call: callJson(c, req.userId, await peopleFor([c])) });
}
// Cancels the call (for a repeating series: the whole series).
async function cancel(req, res) {
  const c = await load(req, { host: true });
  if (!c.cancelledAt) {
    c.cancelledAt = new Date(); c.admission = []; await c.save(); changed(c);
    await notifyMeeting(c, 'call cancelled');
    recordScheduledCallMessage(c, 'cancelled');
  }
  res.json({ call: callJson(c, req.userId, await peopleFor([c])) });
}
async function rsvp(req, res) {
  const c = await load(req, { active: true });
  const b = normalize(req.body);
  if (!['accepted', 'declined'].includes(b.response)) fail(400, 'status must be accepted or declined.');
  const p = c.participants.find(p => String(p.user) === req.userId);
  if (!p) fail(403, 'Only an invited participant can RSVP.');
  p.response = b.response; await c.save(); changed(c);
  res.json({ call: callJson(c, req.userId, await peopleFor([c])) });
}
async function resolveInvite(req, res) {
  if (!/^[\w-]{32}$/.test(req.params.code)) fail(404, 'Invitation not found.');
  let c = await ScheduledCall.findOne({ inviteCode: req.params.code }).select('+passcode');
  if (!c) fail(404, 'Invitation not found.');
  await groupFor(String(c.conversation), req.user);
  if (!canJoin(c, req.userId)) fail(403, 'This invitation is for selected group members.');
  c = await fresh(c);
  res.json({ call: callJson(c, req.userId, await peopleFor([c])) });
}
async function exportCalendar(req, res) {
  const c = await load(req);
  if (!canJoin(c, req.userId)) fail(403, 'You are not invited to this call.');
  res.type('text/calendar').set('Content-Disposition', 'attachment; filename="cosquest-call.ics"').send(calendar(c, inviteUrl(c)));
}
async function join(req, res) {
  const c = await load(req, { active: true });
  if (!canJoin(c, req.userId)) fail(403, 'Only invited group members can join.');
  if (c.startsAt.getTime() - Date.now() > 10 * 60000) fail(409, 'Joining opens 10 minutes before the call.');
  const host = isHost(c, req.userId);
  if (!host && (typeof req.body?.passcode !== 'string' || req.body.passcode !== c.passcode)) fail(403, 'Incorrect meeting passcode.');
  if (!host && c.waitingRoom) {
    let admission = c.admission.find(a => String(a.user) === req.userId);
    if (admission?.status === 'denied') fail(403, 'The host declined your join request.');
    if (admission?.status !== 'admitted') {
      if (!admission) {
        if (c.admission.length >= 500) fail(409, 'The waiting room is full.');
        c.admission.push({ user: req.userId, status: 'waiting' }); await c.save();
        emitToUser(String(c.host), 'scheduled-call:waiting', { callId: String(c._id), userId: req.userId });
      }
      return res.status(202).json({ status: 'waiting', callId: String(c._id) });
    }
  }
  const livekitUrl = getLivekitUrl();
  const roomName = `scheduled-${c._id}`;
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: req.userId, name: req.user.profile.firstName || req.user.profile.username, ttl: Math.max(1, Math.min(300, Math.floor((c.endsAt - Date.now()) / 1000))) });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE, ...(host || c.participantVideo ? [TrackSource.CAMERA] : [])] });
  res.json({ status: 'ready', token: await token.toJwt(), livekitUrl, roomName, videoEnabled: host ? c.hostVideo : c.participantVideo });
}
async function admit(req, res) {
  const c = await load(req, { host: true, active: true });
  const userId = objectId(req.params.userId, 'participant ID');
  if (!['admitted', 'denied'].includes(req.body?.status)) fail(400, 'status must be admitted or denied.');
  const a = c.admission.find(a => String(a.user) === userId);
  if (!a) fail(404, 'Waiting participant not found.');
  const user = await User.findById(userId);
  if (!user || !canJoin(c, userId)) fail(403, 'This user is no longer invited.');
  await groupFor(String(c.conversation), user);
  a.status = req.body.status; await c.save();
  emitToUser(userId, 'scheduled-call:admission', { callId: String(c._id), status: a.status });
  res.json({ call: callJson(c, req.userId, await peopleFor([c])) });
}
module.exports = { create, list, listForChat, details, update, cancel, rsvp, resolveInvite, exportCalendar, join, admit };
