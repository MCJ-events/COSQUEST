// Saves the "call entry" message in the DM where a call started, once the
// call has finished, and sends it live - exactly like a normal new message
// (message:new to the conversation room + chat:preview to the DM's two
// people, so the chat list updates too).
//
// Called from callController's broadcastCallUpdate(), which runs on every
// call status change - so declined / missed / cancelled / ended are all
// covered from one place.
//
// Group calls: the entry still goes in the DM the call started in, and also
// records that it was a group call and how many people took part.

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const VoiceRoom = require('../models/VoiceRoom');
const {
  serializeMessage, SENDER_FIELDS, groupRolesFor, explicitGroupMemberIds, forBroadcast,
} = require('../controllers/chatController');
const { emitToConversation, emitToUsers } = require('../realtime/socket');

const FINISHED_STATUSES = ['declined', 'missed', 'cancelled', 'ended'];

function durationSeconds(call) {
  if (call.status !== 'ended' || !call.answeredAt || !call.endedAt) return null;
  return Math.max(0, Math.round((new Date(call.endedAt) - new Date(call.answeredAt)) / 1000));
}

// Everyone who was actually in the call at some point.
function participantCount(call) {
  const members = call.members || [];
  if (!members.length) return call.status === 'ended' ? 2 : null;
  return members.filter((member) => member.joinedAt).length;
}

async function recordCallMessage(call) {
  if (!call || !FINISHED_STATUSES.includes(call.status)) return;

  const conversationId = call.conversation?._id || call.conversation;
  const callerId = call.caller?._id || call.caller;

  // Already saved for this call? (status can be broadcast more than once)
  if (await Message.exists({ 'callLog.callId': call._id })) return;

  let message;
  try {
    message = await Message.create({
      conversation: conversationId,
      // The caller "sent" the call entry - so a missed call counts as
      // unread for the other person, and the app can tell who called.
      sender: callerId,
      kind: 'call',
      content: '',
      callLog: {
        callId: call._id,
        type: call.type,
        status: call.status,
        durationSeconds: durationSeconds(call),
        callerId,
        groupCall: Boolean(call.isGroup),
        participantCount: participantCount(call),
      },
    });
  } catch (error) {
    // Two status updates raced: the unique index kept only one. Fine.
    if (error?.code === 11000) return;
    throw error;
  }

  const conversation = await Conversation.findById(conversationId).select('participants');
  await Conversation.updateOne({ _id: conversationId }, { $inc: { messageCount: 1 } });
  await message.populate('sender', SENDER_FIELDS);

  const serialized = serializeMessage(message, {
    viewerId: callerId,
    conversationType: 'dm',
    otherLastReadAt: null,
    reactions: [],
  });

  emitToConversation(String(conversationId), 'message:new', {
    conversationId: String(conversationId),
    message: serialized,
  });

  // Only the DM's own two people - people added to a group call aren't part
  // of that DM.
  const dmPeople = (conversation?.participants || []).map(String);
  emitToUsers(dmPeople, 'chat:preview', {
    conversationId: String(conversationId),
  });
}

// The "voice chat ended" entry, saved in the voice chat's own chat (a group,
// a faction room or the Community room) once it closes - so it stays in the
// chat and its Sparks notes can be reopened later (callId = the voice chat's
// id, which is also its Sparks call id: /api/calls/:id/outline). Called from
// voiceRoomController's closeIfEmpty(), the one place a voice chat closes.
// Sent by whoever started the voice chat; the same unique index as call
// entries keeps it to one per voice chat.
async function recordVoiceChatMessage(roomId) {
  const room = await VoiceRoom.findById(roomId, 'conversation startedBy createdAt endedAt everJoined active').lean();
  if (!room || room.active) return;
  if (await Message.exists({ 'callLog.callId': room._id })) return;

  const endedAt = room.endedAt || new Date();
  let message;
  try {
    message = await Message.create({
      conversation: room.conversation,
      sender: room.startedBy,
      kind: 'call',
      content: '',
      callLog: {
        callId: room._id,
        type: 'audio',
        status: 'ended',
        durationSeconds: Math.max(0, Math.round((new Date(endedAt) - new Date(room.createdAt)) / 1000)),
        callerId: room.startedBy,
        groupCall: true,
        // Voice chats from before everJoined was kept don't know their count.
        participantCount: room.everJoined?.length || null,
        voiceChat: true,
      },
    });
  } catch (error) {
    if (error?.code === 11000) return; // closed twice at the same moment
    throw error;
  }

  const conversation = await Conversation.findByIdAndUpdate(room.conversation, { $inc: { messageCount: 1 } }, { new: true });
  await message.populate('sender', SENDER_FIELDS);
  const serialized = serializeMessage(message, {
    viewerId: room.startedBy,
    conversationType: conversation?.type,
    otherLastReadAt: null,
    reactions: [],
    groupRoles: conversation ? await groupRolesFor(conversation) : undefined,
  });
  emitToConversation(String(room.conversation), 'message:new', {
    conversationId: String(room.conversation),
    message: forBroadcast(serialized),
  });
  // Same rule as a normal message: user-made groups' members get a chat-list
  // update; faction-wide groups and the big rooms are too big to fan out to.
  if (conversation?.type === 'group' && conversation.group?.kind !== 'faction') {
    const memberIds = await explicitGroupMemberIds(conversation);
    emitToUsers(memberIds.map(String), 'chat:preview', { conversationId: String(room.conversation) });
  }
}

module.exports = { recordCallMessage, recordVoiceChatMessage };
