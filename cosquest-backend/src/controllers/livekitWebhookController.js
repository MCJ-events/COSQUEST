// POST /api/livekit/webhook - LiveKit tells us who connected to and dropped
// out of each room. Set this address as the webhook URL in the LiveKit
// project (Cloud: Settings > Webhooks; self-hosted: `webhook.urls` in the
// server config), signed with the same API key as the tokens.
//
// Why: the apps' 30-second check-ins (voice chats) and "hang up" requests
// (calls) are how the backend knows who is in a call, and a phone that
// crashes, loses signal or is killed sends neither. With the webhook:
//   - participant_left: they get RECONNECT_GRACE_MS (20 s) to come back. A
//     network switch or a restart of either server reconnects within that
//     and nothing changes; still gone after it, they are taken out (voice
//     chat count right within seconds, a call no longer stuck as "busy").
//   - participant_joined: they are back (or here) - the grace is cancelled.
// Room names: call_<callId> (calls), voice_<voiceRoomId> (voice chats).
// Scheduled-call rooms and everything else are acknowledged and ignored.
const mongoose = require('mongoose');
const { WebhookReceiver } = require('livekit-server-sdk');

let receiver = null;
function verifier() {
  if (!receiver) receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  return receiver;
}

function target(roomName) {
  const match = /^(call|voice)_([a-f\d]{24})$/i.exec(roomName || '');
  if (!match || !mongoose.isValidObjectId(match[2])) return null;
  return { kind: match[1], id: match[2] };
}

async function receive(req, res) {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'LiveKit is not configured.' });
  }
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
  let event;
  try {
    event = await verifier().receive(body, req.get('Authorization'));
  } catch (error) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  const where = target(event.room?.name);
  const identity = event.participant?.identity;
  if (where && identity && mongoose.isValidObjectId(identity) && ['participant_joined', 'participant_left'].includes(event.event)) {
    const controller = where.kind === 'call' ? require('./callController') : require('./voiceRoomController');
    const handler = event.event === 'participant_left' ? controller.participantLeft : controller.participantJoined;
    try {
      await handler(where.id, identity);
    } catch (error) {
      // Acknowledge anyway: LiveKit retries failed webhooks, and a later
      // check-in or event puts things right.
      console.error(`[livekit] ${event.event} for ${event.room.name} failed:`, error.message);
    }
  }
  return res.json({ ok: true });
}

module.exports = { receive };
