const { AccessToken } = require('livekit-server-sdk');

function getLivekitConfig() {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) {
    const error = new Error(
      'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.'
    );
    error.status = 503;
    throw error;
  }

  return { url, apiKey, apiSecret };
}

// `sources`: what this person may publish (src/utils/callRoom.js sourcesFor).
// By default microphone and camera; screen sharing is granted only to the one
// person sharing (POST .../screen-share/start), so two can't share at once.
async function createCallToken({ userId, username, name, roomName, sources }) {
  const { apiKey, apiSecret } = getLivekitConfig();
  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity: String(userId),
    name: name || username || 'User',
    ttl: '2h',
  });

  accessToken.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: sources || require('./callRoom').sourcesFor(),
  });

  return accessToken.toJwt();
}

function getLivekitUrl() {
  return getLivekitConfig().url;
}

module.exports = { createCallToken, getLivekitUrl };
