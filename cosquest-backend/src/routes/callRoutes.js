const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
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
router.post('/chats/:conversationId/calls', asyncHandler(startCall));
// Sparks: the call's outline (attendees and chat admins).
router.get('/calls/:callId/outline', asyncHandler(require('../sparks/calls').getOutline));
// Sparks: the full transcript (same access as the outline), and sharing the outline into the chat.
// Both take a call id or a voice chat id (voiceRoom.id).
router.get('/calls/:callId/transcript', asyncHandler(require('../sparks/calls').getTranscript));
// Can I open this call's (or voice chat's) Sparks notes, and are there any?
router.get('/calls/:callId/notes', asyncHandler(require('../sparks/calls').getNotes));
router.post('/calls/:callId/outline/share', asyncHandler(require('../sparks/calls').shareOutline));
// Sparks voice commands: what this user can target from this call (the SDK's CommandContext).
router.get('/calls/:callId/command-context', asyncHandler(require('../sparks/targetedCalls').getCommandContext));
router.get('/calls/incoming', asyncHandler(getIncomingCall));
router.get('/calls/:callId', asyncHandler(getCall));
router.post('/calls/:callId/accept', asyncHandler(acceptCall));
router.post('/calls/:callId/decline', asyncHandler(declineCall));
router.post('/calls/:callId/end', asyncHandler(endCall));
router.post('/calls/:callId/invite', asyncHandler(inviteToCall));
router.post('/calls/:callId/join', asyncHandler(rejoinCall));
// Private call on top: a one-to-one call with someone in this call ({ userId }).
router.post('/calls/:callId/private', asyncHandler(startPrivateCall));
// Screen sharing: one person at a time.
router.post('/calls/:callId/screen-share/start', asyncHandler(startScreenShare));
router.post('/calls/:callId/screen-share/stop', asyncHandler(stopScreenShare));
// Moderation by whoever started the call.
router.post('/calls/:callId/members/:userId/mute', asyncHandler(muteCallMember));
router.post('/calls/:callId/members/:userId/unmute', asyncHandler(unmuteCallMember));
router.post('/calls/:callId/members/:userId/remove', asyncHandler(removeCallMember));
router.post('/calls/:callId/members/:userId/allow', asyncHandler(allowCallMember));
// "Faction in danger" from this call ({ message? }).
router.post('/calls/:callId/alert', asyncHandler(alertFromCall));

// Voice chats (Community, faction and group rooms - nobody's phone rings)
router.get('/chats/:conversationId/voice', asyncHandler(getVoiceRoom));
router.post('/chats/:conversationId/voice/join', asyncHandler(joinVoiceRoom));
router.post('/voice/:roomId/ping', asyncHandler(pingVoiceRoom));
router.post('/voice/:roomId/leave', asyncHandler(leaveVoiceRoom));
// Private call on top, from a voice chat ({ userId }).
router.post('/voice/:roomId/private', asyncHandler(startPrivateVoiceCall));
// End for everyone (whoever started it, or a group admin).
router.post('/voice/:roomId/end', asyncHandler(endVoiceRoom));
// Screen sharing: one person at a time.
router.post('/voice/:roomId/screen-share/start', asyncHandler(startVoiceScreenShare));
router.post('/voice/:roomId/screen-share/stop', asyncHandler(stopVoiceScreenShare));
// Moderation by the group's owner/admins, or a Community/faction room's admins.
router.post('/voice/:roomId/members/:userId/mute', asyncHandler(muteMember));
router.post('/voice/:roomId/members/:userId/unmute', asyncHandler(unmuteMember));
router.post('/voice/:roomId/members/:userId/remove', asyncHandler(removeMemberByAdmin));
router.post('/voice/:roomId/members/:userId/allow', asyncHandler(allowMember));
// Stage (speakers and listeners): { on }, { role: 'speaker'|'listener' }, { raised }.
router.post('/voice/:roomId/stage', asyncHandler(setStage));
router.post('/voice/:roomId/members/:userId/role', asyncHandler(setMemberRole));
router.post('/voice/:roomId/hand', asyncHandler(raiseHand));
// "Faction in danger" from this voice chat ({ message? }).
router.post('/voice/:roomId/alert', asyncHandler(alertFromVoice));

// Faction alerts: what the push opens, and "Respond" (join that call or voice chat).
router.get('/alerts/:alertId', asyncHandler(getAlert));
router.post('/alerts/:alertId/respond', asyncHandler(respondToAlert));

module.exports = router;
