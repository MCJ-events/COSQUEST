// The JSON for a scheduled call, in the shape the app's Calls tab reads
// (services/scheduledCalls.ts): host and participants as people, durationMin,
// spark { id, subject }, meetingCode, passcode, inviteUrl, status
// scheduled|cancelled. The older fields (hostId, durationMinutes, sparkId,
// timing, canJoin...) stay alongside, so existing clients keep working.
const User = require('../models/User');

const PERSON_FIELDS = 'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl';

const isHost = (c, uid) => String(c.host) === String(uid);
const canJoin = (c, uid) => isHost(c, uid) || c.whoCanJoin === 'group' || c.participants.some((p) => String(p.user) === String(uid));

function person(user, id) {
  const profile = user?.profile || {};
  return {
    id: String(user?._id || id),
    username: profile.username || null,
    name: profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.username || 'User',
    avatarKey: profile.avatarKey || null,
    avatarPhotoUrl: profile.avatarPhotoUrl || null,
  };
}

// Everyone shown on these calls (hosts, invitees, people waiting), in one query.
async function peopleFor(calls) {
  const ids = new Set();
  for (const c of calls) {
    ids.add(String(c.host));
    c.participants.forEach((p) => ids.add(String(p.user)));
    (c.admission || []).forEach((a) => ids.add(String(a.user)));
  }
  const users = await User.find({ _id: { $in: [...ids] } }).select(PERSON_FIELDS).lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

function inviteUrl(c) {
  const base = (process.env.APP_WEB_URL || 'https://cosquest.vercel.app').replace(/\/+$/, '');
  return `${base}/call/scheduled/${c._id}`;
}

const meetingCode = (c) => (c.meetingCode ? c.meetingCode.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3') : null);

function timingOf(c, now = new Date()) {
  if (c.cancelledAt) return 'cancelled';
  if (c.endsAt <= now) return 'past';
  return c.startsAt <= now ? 'ongoing' : 'upcoming';
}

// What every member of the group may see: no passcode, invite link or
// viewer-specific flags. Used for live updates sent to the whole chat.
function publicCallJson(c, people) {
  const who = (id) => person(people.get(String(id)), id);
  return {
    id: String(c._id),
    conversationId: String(c.conversation),
    topic: c.topic,
    description: c.description,
    spark: c.sparkId ? { id: c.sparkId, subject: c.sparkSubject || null } : null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    durationMin: c.durationMinutes,
    timeZone: c.timeZone,
    repeat: c.repeat,
    host: who(c.host),
    participants: c.participants.map((p) => ({ ...who(p.user), status: p.response, userId: String(p.user), response: p.response })),
    hostVideo: c.hostVideo,
    participantVideo: c.participantVideo,
    whoCanJoin: c.whoCanJoin === 'group' ? 'members' : 'invited',
    waitingRoom: c.waitingRoom,
    meetingCode: meetingCode(c),
    status: c.cancelledAt ? 'cancelled' : 'scheduled',
    timing: timingOf(c),
    createdAt: c.createdAt,
    // Older field names, kept for existing clients.
    hostId: String(c.host),
    durationMinutes: c.durationMinutes,
    sparkId: c.sparkId,
    projectId: c.projectId,
    subjectId: c.subjectId,
    seriesId: c.seriesId,
    occurrence: c.occurrence,
    cancelledAt: c.cancelledAt,
  };
}

// The full call for one viewer: the passcode and invite link only for people
// who may join it, the waiting room only for the host (and each person's own row).
function callJson(c, uid, people) {
  const entitled = canJoin(c, uid);
  return {
    ...publicCallJson(c, people),
    passcode: entitled ? c.passcode || null : null,
    inviteUrl: entitled ? inviteUrl(c) : null,
    canManage: isHost(c, uid),
    canJoin: entitled,
    admission: (c.admission || []).filter((a) => isHost(c, uid) || String(a.user) === String(uid)).map((a) => ({ userId: String(a.user), status: a.status })),
  };
}

module.exports = { peopleFor, callJson, publicCallJson, person, isHost, canJoin, inviteUrl };
