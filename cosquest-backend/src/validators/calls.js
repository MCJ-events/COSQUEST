// Request rules for src/routes/callRoutes.js (see src/middleware/validate.js):
// calls, voice chats, screen sharing, moderation, the stage and faction alerts.
// Messages match the controllers' own (callController, voiceRoomController,
// alertController), so the app sees the same answers. The controllers keep
// their checks; who may do what still needs the database.
const { objectId, boolean, oneOfValues, array, field, body } = require('../middleware/validate');
const limits = require('../config/callLimits');
const common = require('./common');

// Path ids. A malformed one has always answered "not found"; a malformed
// :userId (moderation, stage roles) has always been 400 "Invalid user ID.".
const callId = common.pathId('callId', 'Call not found.');
const roomId = common.pathId('roomId', 'Voice chat not found.');
const conversationId = common.pathId('conversationId', 'Conversation not found.');
const alertId = common.pathId('alertId', 'Alert not found.');
const memberId = objectId('userId', { in: 'param', message: 'Invalid user ID.' });

// { message? } on a faction alert: text, at most 200 characters once trimmed
// (FactionAlert.message maxlength).
const ALERT_MESSAGE_MAX = 200;
const alertMessage = field('message', { nullable: true })
  .custom((v) => typeof v === 'string').withMessage('message must be text.').bail()
  .custom((v) => v.trim().length <= ALERT_MESSAGE_MAX).withMessage(`Keep the message under ${ALERT_MESSAGE_MAX} characters.`);

// { userId } for a private call on top of a call or voice chat.
const privateTarget = objectId('userId', { message: 'Choose who to call privately (userId).' });

// POST /api/chats/:conversationId/calls { type }. The controller checks the
// type before it looks up the chat, so the type comes first here too.
const startCall = [
  oneOfValues('type', ['audio', 'video'], { required: true, message: 'Call type must be audio or video.' }),
  conversationId,
];

// POST /api/calls/:callId/invite { userIds?, usernames? }: lists (null counts
// as none). Bad entries inside them are still skipped, not refused (the
// answer's `skipped` says why). The size limit is CALL_MAX_INVITES_PER_REQUEST,
// read when the request arrives, like the controller does.
const countOf = (v) => (Array.isArray(v) ? v.length : 0);
const inviteToCall = [
  callId,
  array('userIds', { nullable: true, max: Infinity, message: 'userIds must be a list of user ids.' }),
  array('usernames', { nullable: true, max: Infinity, message: 'usernames must be a list of usernames.' }),
  body('userIds')
    .custom((v, { req }) => countOf(v) + countOf(req.body?.usernames) <= limits.maxInvitesPerRequest())
    .withMessage(() => `You can add up to ${limits.maxInvitesPerRequest()} people at a time.`),
];

const startPrivateCall = [callId, privateTarget];
const moderateCallMember = [callId, memberId];
const alertFromCall = [callId, alertMessage];

const startPrivateVoiceCall = [roomId, privateTarget];
const moderateVoiceMember = [roomId, memberId];
const setStage = [roomId, boolean('on', { required: true, message: 'on must be true or false.' })];
const setMemberRole = [roomId, memberId, oneOfValues('role', ['speaker', 'listener'], { required: true, message: 'role must be speaker or listener.' })];
const raiseHand = [roomId, boolean('raised', { required: true, message: 'raised must be true or false.' })];
const alertFromVoice = [roomId, alertMessage];

// GET /api/calls/:callId/transcript?cursor=&limit=: single values (the
// handler still reads them leniently).
const transcript = [common.paging()];

module.exports = {
  callId, roomId, conversationId, alertId,
  startCall, inviteToCall, startPrivateCall, moderateCallMember, alertFromCall,
  startPrivateVoiceCall, moderateVoiceMember, setStage, setMemberRole, raiseHand, alertFromVoice,
  transcript,
};
