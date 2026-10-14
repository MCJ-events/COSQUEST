/**
 * Sparks bot posts (module 1.3): messages the Sparks module adds to a chat by
 * itself ("Relevant expertise: Front-end and Back-end.", "Earlier context:
 * Route preview"). Stored as ordinary messages of kind 'sparks_bot' with no
 * user sender, numbered by the Message pre-save hook like every message, and
 * delivered on the usual `message:new` / `message:edited` events. The post
 * itself (the module's SparksBotPost) is in `sparksBot`.
 *
 * ports.postBotMessage / ports.updateBotMessage call into here. These posts
 * never go back to the module's onChatMessage (the module ignores them anyway).
 */
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const members = require('./members');

const BOT_ID = 'sparks-bot';

// Lazy: chatController requires src/sparks (index.js), which requires ports.js, which requires this file.
const chat = () => require('../controllers/chatController');
const realtime = () => require('../realtime/socket');

const deletedForIds = (message) => (message?.deletedFor || []).map(String);

function serializeForBroadcast(message, conversationType) {
  const { serializeMessage, forBroadcast } = chat();
  return forBroadcast(serializeMessage(message, { viewerId: null, conversationType, otherLastReadAt: null, reactions: [] }));
}

/** ports.postBotMessage: store the post as a message and send it live like a new message. */
async function postBotMessage(chatId, draft) {
  if (!mongoose.isValidObjectId(chatId)) return null;
  const conversation = await Conversation.findById(chatId);
  if (!conversation) return null;
  const message = await Message.create({
    conversation: conversation._id,
    sender: null,
    kind: 'sparks_bot',
    content: String(draft.text || '').slice(0, 2000),
    sparksBot: draft.bot,
  });
  await Conversation.updateOne({ _id: conversation._id }, { $inc: { messageCount: 1 } }).catch(() => {});
  const { emitToConversation, emitToUsers } = realtime();
  emitToConversation(conversation.id, 'message:new', { conversationId: conversation.id, message: serializeForBroadcast(message, conversation.type) });
  if (conversation.type === 'dm') {
    emitToUsers(conversation.participants.map(String), 'chat:preview', { conversationId: conversation.id });
  } else if (conversation.type === 'group' && conversation.group?.kind !== 'faction') {
    const memberIds = await chat().explicitGroupMemberIds(conversation);
    emitToUsers(memberIds.map(String), 'chat:preview', { conversationId: conversation.id });
  }
  return { messageId: String(message._id), seq: message.seq };
}

/** ports.updateBotMessage: an admin approved or dismissed a suggested role ping. */
async function updateBotMessage(messageId, update) {
  if (!mongoose.isValidObjectId(messageId)) return;
  const message = await Message.findOne({ _id: messageId, kind: 'sparks_bot' });
  if (!message) return;
  message.content = String(update.text || '').slice(0, 2000);
  message.sparksBot = update.bot;
  message.markModified('sparksBot');
  await message.save();
  const conversation = await Conversation.findById(message.conversation);
  if (!conversation) return;
  realtime().emitToConversationExcept(conversation.id, deletedForIds(message), 'message:edited', {
    conversationId: conversation.id,
    message: serializeForBroadcast(message, conversation.type),
  });
}

/**
 * Per reader (REST): an "Earlier context" post keeps only the quotes this
 * viewer may read (same rule as GET /messages) and that are not deleted for
 * everyone. With none left, `quotes` is [] and `jumpToMessageId` null: the
 * app hides the post. Mutates the serialized messages in place.
 */
async function redactForViewer(serializedMessages, chatId, viewerId) {
  for (const s of serializedMessages) {
    const post = s?.sparksBot;
    if (!post || post.kind !== 'earlier_context' || !Array.isArray(post.quotes) || !post.quotes.length) continue;
    const seqs = post.quotes.map((q) => q.seq);
    const [readable, gone] = await Promise.all([
      members.canReadMany(String(viewerId), String(chatId), seqs),
      Message.find({ conversation: chatId, seq: { $in: seqs }, deletedForEveryone: true }, 'seq').lean(),
    ]);
    const goneSeqs = new Set(gone.map((m) => m.seq));
    const quotes = post.quotes.filter((q, i) => readable[i] && !goneSeqs.has(q.seq));
    s.sparksBot = { ...post, quotes, jumpToMessageId: quotes[0]?.messageId ?? null };
  }
  return serializedMessages;
}

/** The sender shown for a bot post: userPreview's fields, plus isBot. */
function botSender() {
  return { id: BOT_ID, username: BOT_ID, name: 'Sparks bot', displayName: 'Sparks bot', avatarKey: null, avatarPhotoUrl: null, faction: null, lastActiveAt: null, expertise: null, isBot: true };
}

module.exports = { BOT_ID, postBotMessage, updateBotMessage, redactForViewer, botSender };
