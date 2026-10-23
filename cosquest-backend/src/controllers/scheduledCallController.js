const crypto = require('crypto');
const { AccessToken, TrackSource } = require('livekit-server-sdk');
const ScheduledCall = require('../models/ScheduledCall');
const User = require('../models/User');
const { fail, objectId, text, groupFor, projectFor, subjectFor, sparkFor } = require('../utils/projectAccess');
const { timing, occurrences, calendar } = require('../utils/meetingTime');
const { notifyMeeting } = require('../utils/meetingNotifications');
const { getLivekitUrl } = require('../utils/livekit');
const { emitToUser, emitToConversation } = require('../realtime/socket');

const isHost = (c, uid) => String(c.host) === String(uid);
const canJoin = (c, uid) => isHost(c, uid) || c.whoCanJoin === 'group' || c.participants.some(p => String(p.user) === String(uid));
const inviteUrl = c => process.env.APP_WEB_URL ? `${process.env.APP_WEB_URL.replace(/\/+$/, '')}/call/${c.inviteCode}` : `cosquest://call/${c.inviteCode}`;
function changed(c) { emitToConversation(String(c.conversation), 'scheduled-call:updated', { callId: String(c._id), conversationId: String(c.conversation) }); }
function callJson(c, uid) {
  const entitled = canJoin(c, uid);
  return { id: String(c._id), conversationId: c.conversation, hostId: c.host, topic: c.topic, description: c.description,
    startsAt: c.startsAt, endsAt: c.endsAt, timeZone: c.timeZone, durationMinutes: c.durationMinutes, repeat: c.repeat, seriesId: c.seriesId, occurrence: c.occurrence,
    projectId: c.projectId, subjectId: c.subjectId, sparkId: c.sparkId, participants: c.participants.map(p => ({ userId: p.user, response: p.response })),
    hostVideo: c.hostVideo, participantVideo: c.participantVideo, waitingRoom: c.waitingRoom, whoCanJoin: c.whoCanJoin,
    status: c.cancelledAt ? 'cancelled' : c.endsAt <= new Date() ? 'past' : c.startsAt <= new Date() ? 'ongoing' : 'upcoming',
    cancelledAt: c.cancelledAt, canManage: isHost(c, uid), canJoin: entitled,
    ...(entitled ? { inviteUrl: inviteUrl(c), ...(c.passcode ? { passcode: c.passcode } : {}) } : {}),
    admission: c.admission.filter(a => isHost(c, uid) || String(a.user) === String(uid)).map(a => ({ userId: a.user, status: a.status })),
  };
}
async function load(req, { host = false, active = false } = {}) {
  const c = await ScheduledCall.findById(objectId(req.params.callId, 'call ID')).select('+passcode');
  if (!c) fail(404, 'Scheduled call not found.');
  await groupFor(String(c.conversation), req.user);
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
  if (b.sparkId) await sparkFor(groupId, b.sparkId);
  return { projectId: project?._id || null, subjectId: subject?._id || null, sparkId: b.sparkId || null, sparkEngine: b.sparkId ? require('../sparks').engine() : null };
}
function settings(b) {
  const out = {};
  for (const key of ['hostVideo', 'participantVideo', 'waitingRoom']) if (b[key] !== undefined) {
    if (typeof b[key] !== 'boolean') fail(400, `${key} must be boolean.`);
    out[key] = b[key];
  }
  if (b.whoCanJoin !== undefined) { if (!['invited', 'group'].includes(b.whoCanJoin)) fail(400, 'whoCanJoin must be invited or group.'); out.whoCanJoin = b.whoCanJoin; }
  return out;
}
async function create(req, res) {
  const group = await groupFor(req.params.groupId, req.user);
  const b = req.body || {};
  const immediate = req.path.endsWith('/meet-now');
  const first = timing(b, { immediate });
  const repeat = immediate ? 'none' : b.repeat ?? 'none';
  const dates = occurrences(first, repeat, b.occurrences ?? 1);
  const base = { conversation: group._id, host: req.userId,
    topic: text(b.topic, 'Topic', 150, true), description: text(b.description ?? '', 'Description', 2000),
    participants: await participants(String(group._id), b.participantIds || [], req.userId),
    ...await context(String(group._id), b, req.user), ...settings(b), repeat,
    seriesId: dates.length > 1 ? crypto.randomUUID() : null };
  // Validate the complete series before the first write.
  const docs = dates.map((date, i) => new ScheduledCall({ ...base, ...date, occurrence: i + 1, inviteCode: crypto.randomBytes(24).toString('base64url'), passcode: String(crypto.randomInt(100000, 1000000)) }));
  await Promise.all(docs.map(c => c.validate()));
  const calls = await ScheduledCall.insertMany(docs);
  // One invitation for the series; each occurrence remains separately editable.
  await notifyMeeting(calls[0], dates.length > 1 ? `${dates.length} calls scheduled` : 'invitation received');
  calls.forEach(changed);
  res.status(201).json({ call: callJson(calls[0], req.userId), occurrences: calls.map(c => callJson(c, req.userId)) });
}
async function list(req, res) {
  await groupFor(req.params.groupId, req.user);
  const view = req.query.view || 'upcoming';
  if (!['upcoming', 'past', 'cancelled'].includes(view)) fail(400, 'view must be upcoming, past or cancelled.');
  const filter = { conversation: req.params.groupId, cancelledAt: view === 'cancelled' ? { $ne: null } : null, ...(view === 'cancelled' ? {} : { endsAt: view === 'past' ? { $lte: new Date() } : { $gt: new Date() } }) };
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const [calls, total] = await Promise.all([ScheduledCall.find(filter).sort({ startsAt: view === 'upcoming' ? 1 : -1, _id: 1 }).skip(offset).limit(50), ScheduledCall.countDocuments(filter)]);
  res.json({ calls: calls.map(c => callJson(c, req.userId)), total, nextOffset: offset + calls.length < total ? offset + calls.length : null });
}
async function details(req, res) {
  const c = await load(req);
  const people = await User.find({ _id: { $in: [c.host, ...c.participants.map(p => p.user), ...c.admission.map(a => a.user)] } }).select('profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl');
  res.json({ call: callJson(c, req.userId), people: people.map(u => ({ id: u.id, username: u.profile.username, name: [u.profile.firstName, u.profile.lastName].filter(Boolean).join(' ') || u.profile.username, avatarKey: u.profile.avatarKey, avatarPhotoUrl: u.profile.avatarPhotoUrl })) });
}
async function update(req, res) {
  const c = await load(req, { host: true, active: true });
  if (c.startsAt <= new Date()) fail(409, 'Only upcoming calls can be edited.');
  const b = req.body || {};
  if (b.repeat !== undefined || b.occurrences !== undefined) fail(400, 'Edit this occurrence only; create a new series to change repetition.');
  if (b.topic !== undefined) c.topic = text(b.topic, 'Topic', 150, true);
  if (b.description !== undefined) c.description = text(b.description, 'Description', 2000);
  const timingChanged = ['startsAt', 'date', 'startTime', 'timeZone', 'durationMinutes'].some(k => b[k] !== undefined);
  if (timingChanged) {
    const hasLocal = b.date !== undefined || b.startTime !== undefined;
    Object.assign(c, timing({ timeZone: c.timeZone, durationMinutes: c.durationMinutes, ...(!hasLocal ? { startsAt: c.startsAt.toISOString() } : {}), ...b }));
    c.reminderSentAt = null;
    for (const p of c.participants) p.response = 'pending';
  }
  const oldIds = c.participants.map(p => String(p.user));
  if (b.participantIds !== undefined) c.participants = await participants(String(c.conversation), b.participantIds, c.host, c.participants);
  if (['projectId', 'subjectId', 'sparkId'].some(k => b[k] !== undefined)) Object.assign(c, await context(String(c.conversation), { projectId: c.projectId && String(c.projectId), subjectId: c.subjectId && String(c.subjectId), sparkId: c.sparkId, ...b }, req.user));
  Object.assign(c, settings(b));
  c.admission = []; // changed invitations/access never carry old admission forward
  await c.save(); changed(c);
  await notifyMeeting(c, 'call updated', [...new Set([...oldIds, ...c.participants.map(p => String(p.user))])]);
  res.json({ call: callJson(c, req.userId) });
}
async function cancel(req, res) {
  const c = await load(req, { host: true });
  if (!c.cancelledAt) {
    c.cancelledAt = new Date(); c.admission = []; await c.save(); changed(c);
    await notifyMeeting(c, 'call cancelled');
  }
  res.json({ call: callJson(c, req.userId) });
}
async function rsvp(req, res) {
  const c = await load(req, { active: true });
  if (!['accepted', 'declined'].includes(req.body?.response)) fail(400, 'response must be accepted or declined.');
  const p = c.participants.find(p => String(p.user) === req.userId);
  if (!p) fail(403, 'Only an invited participant can RSVP.');
  p.response = req.body.response; await c.save(); changed(c);
  res.json({ call: callJson(c, req.userId) });
}
async function resolveInvite(req, res) {
  if (!/^[\w-]{32}$/.test(req.params.code)) fail(404, 'Invitation not found.');
  const c = await ScheduledCall.findOne({ inviteCode: req.params.code }).select('+passcode');
  if (!c) fail(404, 'Invitation not found.');
  await groupFor(String(c.conversation), req.user);
  if (!canJoin(c, req.userId)) fail(403, 'This invitation is for selected group members.');
  res.json({ call: callJson(c, req.userId) });
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
  res.json({ call: callJson(c, req.userId) });
}
module.exports = { create, list, details, update, cancel, rsvp, resolveInvite, exportCalendar, join, admit };
