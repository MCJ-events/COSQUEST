const fs = require('fs');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');
const MessageReaction = require('../models/MessageReaction');
const User = require('../models/User');
const userModel = require('../models/userModel');
const { getFaction } = require('../models/factionModel');
const { storeChatMedia } = require('../utils/imageHost');

const EPOCH = new Date(0);
const DELETE_FOR_EVERYONE_WINDOW_MS = 5 * 60 * 1000;

function parseLimit(value, fallback = 30) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : fallback;
}

function parsePage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 1000) : 1;
}

function userPreview(user) {
  return {
    id: String(user._id),
    username: user.profile.username,
    name: [user.profile.firstName, user.profile.lastName].filter(Boolean).join(' ') || user.profile.username,
    avatarKey: user.profile.avatarKey,
    avatarPhotoUrl: user.profile.avatarPhotoUrl,
    faction: user.faction,
    lastActiveAt: user.lastActiveAt,
  };
}

function cleanUpLocalFile(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

async function getOrCreateCommunityConversation() {
  const existing = await Conversation.findOne({ type: 'community' });
  if (existing) return existing;
  try {
    return await Conversation.create({ type: 'community' });
  } catch (error) {
    if (error?.code === 11000) return Conversation.findOne({ type: 'community' });
    throw error;
  }
}

async function getOrCreateFactionConversation(factionKey) {
  const existing = await Conversation.findOne({ type: 'faction', factionKey });
  if (existing) return existing;
  try {
    return await Conversation.create({ type: 'faction', factionKey });
  } catch (error) {
    if (error?.code === 11000) return Conversation.findOne({ type: 'faction', factionKey });
    throw error;
  }
}

async function getOrCreateDmConversation(userIdA, userIdB) {
  const dmKey = [String(userIdA), String(userIdB)].sort().join('_');
  let conversation = await Conversation.findOne({ type: 'dm', dmKey });
  if (!conversation) {
    try {
      conversation = await Conversation.create({ type: 'dm', dmKey, participants: [userIdA, userIdB] });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await Conversation.findOne({ type: 'dm', dmKey });
    }
  }
  // Both sides need a membership row up front so the DM shows up in each
  // person's `GET /api/chats` list even before either has read anything.
  await Promise.all(
    [userIdA, userIdB].map((userId) =>
      ConversationMember.updateOne(
        { conversation: conversation._id, user: userId },
        { $setOnInsert: { lastReadAt: EPOCH } },
        { upsert: true }
      )
    )
  );
  return conversation;
}

// Access rules: community is open to any onboarded user, faction rooms follow
// the user's *current* faction (switching factions moves you automatically),
// DMs are restricted to their two participants.
async function loadConversationForUser(conversationId, user) {
  if (!mongoose.isValidObjectId(conversationId)) return { error: { status: 404, message: 'Conversation not found.' } };
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return { error: { status: 404, message: 'Conversation not found.' } };

  const allowed =
    conversation.type === 'community' ||
    (conversation.type === 'faction' && conversation.factionKey === user.faction) ||
    (conversation.type === 'dm' && conversation.participants.some((participantId) => String(participantId) === String(user._id)));
  if (!allowed) return { error: { status: 403, message: 'You do not have access to this conversation.' } };

  return { conversation };
}

function previewMessage(message) {
  if (!message) return null;
  if (message.deletedForEveryone) return 'This message was deleted';
  if (message.kind === 'image') return 'Sent a photo';
  if (message.kind === 'audio') return 'Sent a voice note';
  return message.content;
}

async function summarizeConversation(conversation, me) {
  const [lastMessage, member] = await Promise.all([
    Message.findOne({ conversation: conversation._id, deletedFor: { $ne: me._id } })
      .sort({ createdAt: -1 })
      .populate('sender', 'profile.username profile.firstName'),
    ConversationMember.findOne({ conversation: conversation._id, user: me._id }),
  ]);
  const lastReadAt = member?.lastReadAt || EPOCH;
  const unreadCount = await Message.countDocuments({
    conversation: conversation._id,
    createdAt: { $gt: lastReadAt },
    sender: { $ne: me._id },
    deletedFor: { $ne: me._id },
  });

  const summary = {
    id: String(conversation._id),
    type: conversation.type,
    factionKey: null,
    title: null,
    memberCount: null,
    otherParticipant: null,
    messageCount: conversation.messageCount,
    unreadCount,
    lastMessage: lastMessage
      ? {
          senderName: lastMessage.sender?.profile?.username || lastMessage.sender?.profile?.firstName || 'Someone',
          preview: previewMessage(lastMessage),
          createdAt: lastMessage.createdAt,
        }
      : null,
    updatedAt: lastMessage ? lastMessage.createdAt : conversation.updatedAt,
  };

  if (conversation.type === 'community') {
    summary.title = 'Community';
    summary.memberCount = await User.countDocuments({ onboardingComplete: true });
  } else if (conversation.type === 'faction') {
    const faction = getFaction(conversation.factionKey);
    summary.factionKey = conversation.factionKey;
    summary.title = faction ? faction.name : conversation.factionKey;
    summary.memberCount = await User.countDocuments({ faction: conversation.factionKey });
  } else {
    const otherId = conversation.participants.find((participantId) => String(participantId) !== String(me._id));
    const otherUser = otherId ? await User.findById(otherId) : null;
    summary.otherParticipant = otherUser ? userPreview(otherUser) : null;
    summary.title = summary.otherParticipant?.name || summary.otherParticipant?.username || 'Direct Message';
  }

  return summary;
}

function groupReactions(reactionDocs, viewerId) {
  const byMessage = new Map();
  for (const reaction of reactionDocs) {
    const key = String(reaction.message);
    if (!byMessage.has(key)) byMessage.set(key, new Map());
    const emojiMap = byMessage.get(key);
    if (!emojiMap.has(reaction.emoji)) emojiMap.set(reaction.emoji, { emoji: reaction.emoji, count: 0, mine: false });
    const entry = emojiMap.get(reaction.emoji);
    entry.count += 1;
    if (String(reaction.user) === String(viewerId)) entry.mine = true;
  }
  const result = new Map();
  for (const [key, emojiMap] of byMessage) result.set(key, Array.from(emojiMap.values()));
  return result;
}

function replyPreview(original) {
  if (!original) return null;
  return {
    id: String(original._id),
    senderName: original.sender?.profile?.username || original.sender?.profile?.firstName || 'Someone',
    preview: previewMessage(original),
  };
}

function serializeMessage(message, { viewerId, conversationType, otherLastReadAt, reactions }) {
  const senderId = message.sender?._id || message.sender;
  const isMine = String(senderId) === String(viewerId);
  const read = conversationType === 'dm' && isMine ? Boolean(otherLastReadAt && message.createdAt <= otherLastReadAt) : undefined;

  if (message.deletedForEveryone) {
    return {
      id: String(message._id),
      kind: message.kind,
      content: 'This message was deleted.',
      media: null,
      sender: message.sender?.profile ? userPreview(message.sender) : undefined,
      replyTo: replyPreview(message.replyTo),
      reactions: reactions || [],
      read,
      deleted: true,
      deletedAt: message.deletedAt,
      editedAt: null,
      createdAt: message.createdAt,
    };
  }

  return {
    id: String(message._id),
    kind: message.kind,
    content: message.content,
    media: message.media || null,
    sender: message.sender?.profile ? userPreview(message.sender) : undefined,
    replyTo: replyPreview(message.replyTo),
    reactions: reactions || [],
    read,
    deleted: false,
    deletedAt: null,
    editedAt: message.editedAt || null,
    createdAt: message.createdAt,
  };
}

const SENDER_FIELDS = 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction lastActiveAt';

// GET /api/chats - "Your Space" (community + faction room) plus every DM.
async function listChats(req, res) {
  const me = req.user;
  const rooms = [await getOrCreateCommunityConversation()];
  if (me.faction) rooms.push(await getOrCreateFactionConversation(me.faction));

  const memberships = await ConversationMember.find({ user: me._id }).populate('conversation');
  for (const membership of memberships) {
    if (membership.conversation?.type === 'dm') rooms.push(membership.conversation);
  }

  const chats = await Promise.all(rooms.map((conversation) => summarizeConversation(conversation, me)));
  return res.json({ chats });
}

// POST /api/chats/dm - find-or-create a DM by target username.
async function startDirectMessage(req, res) {
  const target = await userModel.findByUsername(req.body?.username);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (String(target._id) === String(req.userId)) return res.status(400).json({ error: 'You cannot message yourself.' });

  const conversation = await getOrCreateDmConversation(req.userId, target._id);
  return res.json({ chat: await summarizeConversation(conversation, req.user) });
}

// GET /api/chats/:conversationId
async function getConversationDetail(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const summary = await summarizeConversation(conversation, req.user);
  let pinnedMessage = null;
  if (conversation.pinnedMessage) {
    const pinned = await Message.findById(conversation.pinnedMessage).populate('sender', 'profile.username profile.firstName');
    if (pinned) pinnedMessage = { ...replyPreview(pinned), content: pinned.content, kind: pinned.kind, createdAt: pinned.createdAt };
  }
  return res.json({ chat: { ...summary, pinnedMessage } });
}

// GET /api/chats/:conversationId/messages
async function listMessages(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const [messages, total, otherMember] = await Promise.all([
    Message.find({ conversation: conversation._id, deletedFor: { $ne: req.userId } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('sender', SENDER_FIELDS)
      .populate({ path: 'replyTo', populate: { path: 'sender', select: 'profile.username profile.firstName' } }),
    Message.countDocuments({ conversation: conversation._id, deletedFor: { $ne: req.userId } }),
    conversation.type === 'dm'
      ? ConversationMember.findOne({ conversation: conversation._id, user: { $ne: req.userId } })
      : null,
  ]);

  const reactionDocs = await MessageReaction.find({ message: { $in: messages.map((message) => message._id) } });
  const reactionsByMessage = groupReactions(reactionDocs, req.userId);
  const otherLastReadAt = otherMember?.lastReadAt || null;

  return res.json({
    messages: messages.map((message) =>
      serializeMessage(message, {
        viewerId: req.userId,
        conversationType: conversation.type,
        otherLastReadAt,
        reactions: reactionsByMessage.get(String(message._id)) || [],
      })
    ),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

// POST /api/chats/:conversationId/messages - text and/or one attachment (image or voice note).
async function createMessage(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) {
    cleanUpLocalFile(req.file);
    return res.status(error.status).json({ error: error.message });
  }

  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const file = req.file || null;
  if (!content && !file) {
    return res.status(400).json({ error: 'A message needs text or an attachment.' });
  }
  if (content.length > 2000) {
    cleanUpLocalFile(file);
    return res.status(400).json({ error: 'Message content must be at most 2,000 characters.' });
  }

  let replyTo = null;
  if (req.body.replyTo) {
    if (!mongoose.isValidObjectId(req.body.replyTo)) {
      cleanUpLocalFile(file);
      return res.status(400).json({ error: 'replyTo is not a valid message id.' });
    }
    const original = await Message.findById(req.body.replyTo);
    if (!original || String(original.conversation) !== String(conversation._id)) {
      cleanUpLocalFile(file);
      return res.status(400).json({ error: 'replyTo must reference a message in this conversation.' });
    }
    replyTo = original._id;
  }

  let kind = 'text';
  let media = null;
  if (file) {
    kind = file.mimetype.startsWith('audio/') ? 'audio' : 'image';
    media = await storeChatMedia(file, kind);
  }

  let message = await Message.create({ conversation: conversation._id, sender: req.userId, kind, content, media, replyTo });
  await Promise.all([
    Conversation.updateOne({ _id: conversation._id }, { $inc: { messageCount: 1 } }),
    ConversationMember.updateOne(
      { conversation: conversation._id, user: req.userId },
      { $set: { lastReadAt: new Date() } },
      { upsert: true }
    ),
  ]);
  message = await message.populate('sender', SENDER_FIELDS);
  if (replyTo) message = await message.populate({ path: 'replyTo', populate: { path: 'sender', select: 'profile.username profile.firstName' } });

  return res.status(201).json({
    message: serializeMessage(message, { viewerId: req.userId, conversationType: conversation.type, otherLastReadAt: null, reactions: [] }),
  });
}

// PATCH /api/chats/:conversationId/messages/:messageId - sender-only, text edits.
async function editMessage(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const message = await loadMessageInConversation(conversation, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (String(message.sender) !== String(req.userId)) return res.status(403).json({ error: 'You can only edit your own message.' });
  if (message.deletedForEveryone) return res.status(400).json({ error: 'This message was deleted and cannot be edited.' });

  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'content is required.' });
  if (content.length > 2000) return res.status(400).json({ error: 'Message content must be at most 2,000 characters.' });

  message.content = content;
  message.editedAt = new Date();
  await message.save();
  await message.populate('sender', SENDER_FIELDS);
  await message.populate({ path: 'replyTo', populate: { path: 'sender', select: 'profile.username profile.firstName' } });

  const otherMember =
    conversation.type === 'dm' ? await ConversationMember.findOne({ conversation: conversation._id, user: { $ne: req.userId } }) : null;

  return res.json({
    message: serializeMessage(message, {
      viewerId: req.userId,
      conversationType: conversation.type,
      otherLastReadAt: otherMember?.lastReadAt || null,
      reactions: await summarizeReactions(message._id, req.userId),
    }),
  });
}

// DELETE /api/chats/:conversationId/messages/:messageId?scope=me|everyone
// "me" (default): hides it from the caller only, any time, and only the
// database row's deletedFor list changes. "everyone": replaces it with a
// tombstone for every viewer, sender-only, within 5 minutes of sending - the
// row is never actually removed either way, only flagged.
async function deleteMessage(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const message = await loadMessageInConversation(conversation, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';

  if (scope === 'everyone') {
    if (String(message.sender) !== String(req.userId)) {
      return res.status(403).json({ error: 'You can only delete your own message for everyone.' });
    }
    if (!message.deletedForEveryone) {
      const ageMs = Date.now() - new Date(message.createdAt).getTime();
      if (ageMs > DELETE_FOR_EVERYONE_WINDOW_MS) {
        return res.status(403).json({ error: 'Messages can only be deleted for everyone within 5 minutes of sending. You can still delete it for yourself.' });
      }
      message.deletedForEveryone = true;
      message.deletedAt = new Date();
      await message.save();
      if (conversation.pinnedMessage && String(conversation.pinnedMessage) === String(message._id)) {
        conversation.pinnedMessage = null;
        await conversation.save();
      }
    }
    return res.json({ deleted: true, scope: 'everyone', messageId: String(message._id) });
  }

  await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: req.userId } });
  return res.json({ deleted: true, scope: 'me', messageId: String(message._id) });
}

// PATCH /api/chats/:conversationId/read
async function markRead(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  await ConversationMember.updateOne(
    { conversation: conversation._id, user: req.userId },
    { $set: { lastReadAt: new Date() } },
    { upsert: true }
  );
  return res.json({ message: 'Marked read.' });
}

// PATCH /api/chats/:conversationId/pinned-message - any member can pin/unpin; there is no moderator role in this app yet.
async function setPinnedMessage(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  if (req.body.messageId === null || req.body.messageId === undefined) {
    conversation.pinnedMessage = null;
    await conversation.save();
    return res.json({ pinnedMessage: null });
  }

  if (!mongoose.isValidObjectId(req.body.messageId)) return res.status(400).json({ error: 'messageId is not valid.' });
  const message = await Message.findById(req.body.messageId).populate('sender', 'profile.username profile.firstName');
  if (!message || String(message.conversation) !== String(conversation._id)) {
    return res.status(404).json({ error: 'Message not found in this conversation.' });
  }
  conversation.pinnedMessage = message._id;
  await conversation.save();
  return res.json({ pinnedMessage: { ...replyPreview(message), content: message.content, kind: message.kind, createdAt: message.createdAt } });
}

async function summarizeReactions(messageId, viewerId) {
  const docs = await MessageReaction.find({ message: messageId });
  return groupReactions(docs, viewerId).get(String(messageId)) || [];
}

async function loadMessageInConversation(conversation, messageId) {
  if (!mongoose.isValidObjectId(messageId)) return null;
  const message = await Message.findById(messageId);
  if (!message || String(message.conversation) !== String(conversation._id)) return null;
  return message;
}

// POST /api/chats/:conversationId/messages/:messageId/reactions - upsert; a new emoji replaces the caller's old one.
async function setReaction(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const message = await loadMessageInConversation(conversation, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const emoji = typeof req.body.emoji === 'string' ? req.body.emoji.trim() : '';
  if (!emoji || emoji.length > 8) return res.status(400).json({ error: 'emoji is required and must be short.' });

  await MessageReaction.findOneAndUpdate(
    { message: message._id, user: req.userId },
    { $set: { emoji } },
    { upsert: true }
  );
  return res.status(201).json({ reactions: await summarizeReactions(message._id, req.userId) });
}

// DELETE /api/chats/:conversationId/messages/:messageId/reactions
async function removeReaction(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const message = await loadMessageInConversation(conversation, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  await MessageReaction.deleteOne({ message: message._id, user: req.userId });
  return res.json({ reactions: await summarizeReactions(message._id, req.userId) });
}

module.exports = {
  listChats,
  startDirectMessage,
  getConversationDetail,
  listMessages,
  createMessage,
  editMessage,
  deleteMessage,
  markRead,
  setPinnedMessage,
  setReaction,
  removeReaction,
};
