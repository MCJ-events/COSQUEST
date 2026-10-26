// Acting on a live LiveKit room from the server: what someone may publish
// (screen sharing, a muted microphone), muting a microphone, removing someone,
// closing a room. Through LiveKit's server API (RoomServiceClient), with the
// same LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET as tokens.
//
// Every call is best effort and never throws into a request: the database is
// the record of who may do what (and tokens follow it when people reconnect),
// LiveKit is told so a connected phone changes at once. Someone who isn't
// connected right now ("not found") is not an error.
//
// Tests (NODE_ENV=test) never reach LiveKit: actions are recorded instead
// (captureForTests / actions).
const { RoomServiceClient, TrackSource } = require('livekit-server-sdk');

let client = null;
let recorded = null;

function service() {
  if (client) return client;
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null;
  // The server API is HTTPS on the same host the apps reach over wss.
  client = new RoomServiceClient(LIVEKIT_URL.replace(/^ws(s?):\/\//, 'http$1://'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  return client;
}

async function run(action, details, fn) {
  if (process.env.NODE_ENV === 'test') {
    if (recorded) recorded.push({ action, ...details });
    return true;
  }
  const api = service();
  if (!api) return false;
  try {
    await fn(api);
    return true;
  } catch (error) {
    if (!/not found|does not exist/i.test(error?.message || '')) {
      console.warn(`[livekit] ${action} failed:`, error?.message);
    }
    return false;
  }
}

// What someone may publish: always data; microphone unless an admin muted
// them; camera; screen share only while they are the one sharing. A listener
// on a stage publishes nothing (listener: true).
function sourcesFor({ microphone = true, camera = true, screenShare = false, listener = false } = {}) {
  if (listener) return [];
  return [
    ...(microphone ? [TrackSource.MICROPHONE] : []),
    ...(camera ? [TrackSource.CAMERA] : []),
    ...(screenShare ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : []),
  ];
}

function setSources(roomName, identity, sources) {
  return run('setSources', { roomName, identity: String(identity), sources }, (api) =>
    api.updateParticipant(roomName, String(identity), {
      permission: { canSubscribe: true, canPublish: sources.length > 0, canPublishData: true, canPublishSources: sources },
    })
  );
}

// Mutes whatever microphone track they are publishing right now.
function muteMicrophone(roomName, identity) {
  return run('muteMicrophone', { roomName, identity: String(identity) }, async (api) => {
    const participant = await api.getParticipant(roomName, String(identity));
    const tracks = (participant.tracks || []).filter((track) => track.source === TrackSource.MICROPHONE);
    await Promise.all(tracks.map((track) => api.mutePublishedTrack(roomName, String(identity), track.sid, true)));
  });
}

function removeFromRoom(roomName, identity) {
  return run('removeFromRoom', { roomName, identity: String(identity) }, (api) => api.removeParticipant(roomName, String(identity)));
}

// Disconnects everyone and closes the room.
function closeRoom(roomName) {
  return run('closeRoom', { roomName }, (api) => api.deleteRoom(roomName));
}

/** Tests: record instead of calling LiveKit. Returns the array actions land in. */
function captureForTests() {
  recorded = [];
  return recorded;
}

module.exports = { sourcesFor, setSources, muteMicrophone, removeFromRoom, closeRoom, captureForTests };
