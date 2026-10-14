// Size limits for calls and group voice chats, all set through env.
//
// Read on every use (not once at startup), so tests can change them and a
// value only has to be right in the environment, not baked into a model.
// A missing, empty or invalid value falls back to the default below.
//
//   CALL_MAX_IN_CALL              people ringing or in one call at the same time (default 1000)
//   CALL_MAX_EVER_INVITED         everyone who was ever part of one call (default 5000, at least 2)
//   CALL_MAX_INVITES_PER_REQUEST  people added by one "add people" request (default 50)
//   VOICE_ROOM_MAX_MEMBERS        people in one Community/faction voice chat (default 1000)
//   CALL_BROADCAST_INTERVAL_MS    shortest gap between two live updates of one call
//                                 or voice chat (default 250)
//   CALL_BROADCAST_MS_PER_MEMBER  extra gap per person in it, so a very big call is
//                                 not re-sent to every phone four times a second
//                                 (default 2: 500 people -> 1 s, 1000 people -> 2 s)

const DEFAULTS = {
  CALL_MAX_IN_CALL: 1000,
  CALL_MAX_EVER_INVITED: 5000,
  CALL_MAX_INVITES_PER_REQUEST: 50,
  VOICE_ROOM_MAX_MEMBERS: 1000,
  CALL_BROADCAST_INTERVAL_MS: 250,
  CALL_BROADCAST_MS_PER_MEMBER: 2,
};

const MINIMUMS = {
  CALL_MAX_IN_CALL: 2,
  CALL_MAX_EVER_INVITED: 2,
  CALL_MAX_INVITES_PER_REQUEST: 1,
  VOICE_ROOM_MAX_MEMBERS: 1,
  CALL_BROADCAST_INTERVAL_MS: 0,
  CALL_BROADCAST_MS_PER_MEMBER: 0,
};

const warned = new Set();

function read(name) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return DEFAULTS[name];
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < MINIMUMS[name]) {
    if (!warned.has(`${name}=${raw}`)) {
      warned.add(`${name}=${raw}`);
      console.warn(`[calls] ignoring ${name}=${raw} (needs a whole number >= ${MINIMUMS[name]}); using ${DEFAULTS[name]}`);
    }
    return DEFAULTS[name];
  }
  return value;
}

module.exports = {
  DEFAULTS,
  maxInCall: () => read('CALL_MAX_IN_CALL'),
  maxEverInvited: () => read('CALL_MAX_EVER_INVITED'),
  maxInvitesPerRequest: () => read('CALL_MAX_INVITES_PER_REQUEST'),
  voiceRoomMaxMembers: () => read('VOICE_ROOM_MAX_MEMBERS'),
  // How long to wait between two live updates of something with `memberCount` people in it.
  broadcastIntervalMs: (memberCount = 0) =>
    Math.max(read('CALL_BROADCAST_INTERVAL_MS'), memberCount * read('CALL_BROADCAST_MS_PER_MEMBER')),
};
