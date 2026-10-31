const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/calls');
const {
  startCall,
  getIncomingCall,
  getCall,
  acceptCall,
  declineCall,
  endCall,
  rejoinCall,
  inviteToCall,
  startPrivateCall,
  startPrivateVoiceCall,
  startScreenShare,
  stopScreenShare,
  muteCallMember,
  unmuteCallMember,
  removeCallMember,
  allowCallMember,
} = require('../controllers/callController');
const { alertFromCall, alertFromVoice, getAlert, respondToAlert } = require('../controllers/alertController');
const {
  getVoiceRoom,
  joinVoiceRoom,
  pingVoiceRoom,
  leaveVoiceRoom,
  endVoiceRoom,
  startScreenShare: startVoiceScreenShare,
  stopScreenShare: stopVoiceScreenShare,
  muteMember,
  unmuteMember,
  removeMemberByAdmin,
  allowMember,
  setStage,
  setMemberRole,
  raiseHand,
} = require('../controllers/voiceRoomController');

const router = express.Router();

// Scoped to this router's own paths: it's mounted at '/' ahead of chatRoutes,
// so an unscoped router.use would also run on every /api/chats request and
// look the user up again before chatRoutes does its own check.
router.use(
  ['/calls', '/chats/:conversationId/calls', '/voice', '/chats/:conversationId/voice', '/alerts'],
  requireAuth,
  requireCompletedOnboarding
);

// Calls (start in a DM; anyone in the call can add more people)
router.post('/chats/:conversationId/calls', validate(rules.startCall), asyncHandler(startCall));
// Sparks: the call's outline (attendees and chat admins).
// (The Sparks routes take the id as text and answer 503 first when Sparks is
// off, so their ids are left to the handlers.)
router.get('/calls/:callId/outline', asyncHandler(require('../sparks/calls').getOutline));
// Sparks: the full transcript (same access as the outline), and sharing the outline into the chat.
// Both take a call id or a voice chat id (voiceRoom.id).
router.get('/calls/:callId/transcript', validate(rules.transcript), asyncHandler(require('../sparks/calls').getTranscript));
// Can I open this call's (or voice chat's) Sparks notes, and are there any?
router.get('/calls/:callId/notes', asyncHandler(require('../sparks/calls').getNotes));
router.post('/calls/:callId/outline/share', asyncHandler(require('../sparks/calls').shareOutline));
// Sparks voice commands: what this user can target from this call (the SDK's CommandContext).
router.get('/calls/:callId/command-context', asyncHandler(require('../sparks/targetedCalls').getCommandContext));
router.get('/calls/incoming', asyncHandler(getIncomingCall));
router.get('/calls/:callId', validate(rules.callId), asyncHandler(getCall));
router.post('/calls/:callId/accept', validate(rules.callId), asyncHandler(acceptCall));
router.post('/calls/:callId/decline', validate(rules.callId), asyncHandler(declineCall));
router.post('/calls/:callId/end', validate(rules.callId), asyncHandler(endCall));
router.post('/calls/:callId/invite', validate(rules.inviteToCall), asyncHandler(inviteToCall));
router.post('/calls/:callId/join', validate(rules.callId), asyncHandler(rejoinCall));
// Private call on top: a one-to-one call with someone in this call ({ userId }).
router.post('/calls/:callId/private', validate(rules.startPrivateCall), asyncHandler(startPrivateCall));
// Screen sharing: one person at a time.
router.post('/calls/:callId/screen-share/start', validate(rules.callId), asyncHandler(startScreenShare));
router.post('/calls/:callId/screen-share/stop', validate(rules.callId), asyncHandler(stopScreenShare));
// Moderation by whoever started the call.
router.post('/calls/:callId/members/:userId/mute', validate(rules.moderateCallMember), asyncHandler(muteCallMember));
router.post('/calls/:callId/members/:userId/unmute', validate(rules.moderateCallMember), asyncHandler(unmuteCallMember));
router.post('/calls/:callId/members/:userId/remove', validate(rules.moderateCallMember), asyncHandler(removeCallMember));
router.post('/calls/:callId/members/:userId/allow', validate(rules.moderateCallMember), asyncHandler(allowCallMember));
// "Faction in danger" from this call ({ message? }).
router.post('/calls/:callId/alert', validate(rules.alertFromCall), asyncHandler(alertFromCall));

// Voice chats (Community, faction and group rooms - nobody's phone rings)
router.get('/chats/:conversationId/voice', validate(rules.conversationId), asyncHandler(getVoiceRoom));
router.post('/chats/:conversationId/voice/join', validate(rules.conversationId), asyncHandler(joinVoiceRoom));
router.post('/voice/:roomId/ping', validate(rules.roomId), asyncHandler(pingVoiceRoom));
router.post('/voice/:roomId/leave', validate(rules.roomId), asyncHandler(leaveVoiceRoom));
// Private call on top, from a voice chat ({ userId }).
router.post('/voice/:roomId/private', validate(rules.startPrivateVoiceCall), asyncHandler(startPrivateVoiceCall));
// End for everyone (whoever started it, or a group admin).
router.post('/voice/:roomId/end', validate(rules.roomId), asyncHandler(endVoiceRoom));
// Screen sharing: one person at a time.
router.post('/voice/:roomId/screen-share/start', validate(rules.roomId), asyncHandler(startVoiceScreenShare));
router.post('/voice/:roomId/screen-share/stop', validate(rules.roomId), asyncHandler(stopVoiceScreenShare));
// Moderation by the group's owner/admins, or a Community/faction room's admins.
router.post('/voice/:roomId/members/:userId/mute', validate(rules.moderateVoiceMember), asyncHandler(muteMember));
router.post('/voice/:roomId/members/:userId/unmute', validate(rules.moderateVoiceMember), asyncHandler(unmuteMember));
router.post('/voice/:roomId/members/:userId/remove', validate(rules.moderateVoiceMember), asyncHandler(removeMemberByAdmin));
router.post('/voice/:roomId/members/:userId/allow', validate(rules.moderateVoiceMember), asyncHandler(allowMember));
// Stage (speakers and listeners): { on }, { role: 'speaker'|'listener' }, { raised }.
router.post('/voice/:roomId/stage', validate(rules.setStage), asyncHandler(setStage));
router.post('/voice/:roomId/members/:userId/role', validate(rules.setMemberRole), asyncHandler(setMemberRole));
router.post('/voice/:roomId/hand', validate(rules.raiseHand), asyncHandler(raiseHand));
// "Faction in danger" from this voice chat ({ message? }).
router.post('/voice/:roomId/alert', validate(rules.alertFromVoice), asyncHandler(alertFromVoice));

// Faction alerts: what the push opens, and "Respond" (join that call or voice chat).
router.get('/alerts/:alertId', validate(rules.alertId), asyncHandler(getAlert));
router.post('/alerts/:alertId/respond', validate(rules.alertId), asyncHandler(respondToAlert));

module.exports = router;
