// Posts the "scheduled call" card in the group chat when a call is scheduled,
// and again when it is cancelled, and sends it live like any new message
// (message:new to the chat room + chat:preview to the group's members). The
// host is the sender. The app shows it as a card with "View call".
//
// Like call entries, these cards cannot be edited or forwarded, are skipped
// by Sparks and by message search, and never notify (the invitation itself
// is the notification, see meetingNotifications.js).
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { emitToConversation, emitToUsers } = require('../realtime/socket');

async function postScheduledCallMessage(call, status) {
  const {
    serializeMessage, SENDER_FIELDS, groupRolesFor, explicitGroupMemberIds, forBroadcast,
  } = require('../controllers/chatController');

  const message = await Message.create({
    conversation: call.conversation,
    sender: call.host,
    kind: 'scheduled_call',
    content: '',
    scheduledCall: {
      callId: call._id,
      topic: call.topic,
      startsAt: call.startsAt,
      durationMin: call.durationMinutes,
      hostId: call.host,
      status,
    },
  });

  const conversation = await Conversation.findByIdAndUpdate(call.conversation, { $inc: { messageCount: 1 } }, { new: true });
  await message.populate('sender', SENDER_FIELDS);
  const serialized = serializeMessage(message, {
    viewerId: call.host,
    conversationType: 'group',
    otherLastReadAt: null,
    reactions: [],
    groupRoles: conversation ? await groupRolesFor(conversation) : undefined,
  });
  emitToConversation(String(call.conversation), 'message:new', { conversationId: String(call.conversation), message: forBroadcast(serialized) });
  // Same rule as a normal group message: faction-wide groups are too big to
  // fan out chat-list updates to.
  if (conversation && conversation.group?.kind !== 'faction') {
    const memberIds = await explicitGroupMemberIds(conversation);
    emitToUsers(memberIds.map(String), 'chat:preview', { conversationId: String(call.conversation) });
  }
  return message;
}

// Fire-and-forget: a failed card never fails scheduling or cancelling.
function recordScheduledCallMessage(call, status) {
  postScheduledCallMessage(call, status).catch((error) =>
    console.error('[scheduled calls] failed to post the chat card:', error.message)
  );
}

module.exports = { postScheduledCallMessage, recordScheduledCallMessage };
