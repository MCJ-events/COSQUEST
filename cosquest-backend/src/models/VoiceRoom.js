const mongoose = require('mongoose');
const limits = require('../config/callLimits');

// A live voice chat in the Community room, a faction room or a group - like WhatsApp's
// group voice chat. Nobody's phone rings: members see it's live and can join
// and leave whenever they like. It closes when the last person leaves.
//
// Members' apps check in every 30 seconds (POST /api/voice/:roomId/ping).
// Anyone who hasn't checked in for 90 seconds (app closed, lost signal) is
// removed automatically, so a voice chat never stays "live" with nobody in it.
// People away in a private call (src/models/Call.js) are never removed this way.

// How many people can be in one voice chat: VOICE_ROOM_MAX_MEMBERS (default
// 1000, see src/config/callLimits.js).
const STALE_AFTER_MS = 90 * 1000;

const voiceMemberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const voiceRoomSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    conversationType: { type: String, enum: ['community', 'faction', 'group'], required: true },
    factionKey: { type: String, default: null },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [voiceMemberSchema], default: [] },
    // Everyone who was in it at some point, for the "voice chat ended" entry's
    // participant count (src/utils/callMessage.js).
    everJoined: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    // Who is sharing their screen (one person at a time), or null.
    screenShare: {
      type: new mongoose.Schema({ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, startedAt: Date }, { _id: false }),
      default: null,
    },
    // Moderation by admins (a group's owner/admins, a Community or faction
    // room's admins - src/utils/roomRoles.js), for this voice chat only (a new
    // voice chat starts clean): muted people can't turn their microphone on,
    // removed people can't join again.
    mutedUsers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    removedUsers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    // Stage (town hall): only speakers may talk; everyone else listens (their
    // LiveKit token can't publish, so their phone only receives the speakers).
    // Off: everyone may talk. The starter and admins switch it and promote or
    // demote people; listeners can raise a hand.
    stage: { type: Boolean, default: false },
    speakers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    raisedHands: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    // A "faction in danger" alert sent from here (the flare on the sender's
    // circle), until expiresAt. src/controllers/alertController.js.
    activeAlert: {
      type: new mongoose.Schema({ alert: { type: mongoose.Schema.Types.ObjectId, ref: 'FactionAlert' }, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date, expiresAt: Date }, { _id: false }),
      default: null,
    },
    // Ended for everyone (POST /api/voice/:roomId/end) rather than emptied.
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    roomName: { type: String, required: true, unique: true },
    active: { type: Boolean, default: true },
    endedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Two people joining at the same moment can't overwrite each other.
    optimisticConcurrency: true,
  }
);

// One live voice chat per room, even when two people start one together.
voiceRoomSchema.index(
  { conversation: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

// "Which voice chat is this person in?"
voiceRoomSchema.index({ 'members.user': 1, active: 1 });

const VoiceRoom = mongoose.model('VoiceRoom', voiceRoomSchema);

Object.defineProperty(VoiceRoom, 'MAX_MEMBERS', { get: () => limits.voiceRoomMaxMembers() });
VoiceRoom.STALE_AFTER_MS = STALE_AFTER_MS;

module.exports = VoiceRoom;
