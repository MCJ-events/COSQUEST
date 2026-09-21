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
const { validateChatMedia } = require('../utils/chatMedia');
const { buildContentShare } = require('../utils/shareLinks');
const { isBlockedEitherWay } = require('./publicProfileController');

const EPOCH = new Date(0);
const DELETE_FOR_EVERYONE_WINDOW_MS = 5 * 60 * 1000;
const PIN_DURATIONS = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };
const CLEAR_PIN = { pinnedMessage: null, pinnedAt: null, pinnedUntil: null, pinnedBy: null, pinDuration: null };

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
    name: user.profile.displayName || [user.profile.firstName, user.profile.lastName].filter(Boolean).join(' ') || user.profile.username,
    avatarKey: user.profile.avatarKey,
    avatarPhotoUrl: user.profile.avatarPhotoUrl,
    faction: user.faction,
    lastActiveAt: user.privacy?.showOnlineStatus === false ? null : user.lastActiveAt,
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
  if (message.kind === 'video') return 'Sent a video';
  if (message.kind === 'sticker') return 'Sent a sticker';
  if (message.kind === 'audio') return 'Sent a voice note';
  if (message.kind === 'file') return 'Sent a file';
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

function replyPreview(original, viewerId) {
  if (!original) return null;
  if (viewerId && original.deletedFor?.some((id) => String(id) === String(viewerId))) {
    return { id: String(original._id), senderName: null, preview: 'Message unavailable' };
  }
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
      replyTo: null,
      reactions: reactions || [],
      read,
      deleted: true,
      deletedAt: message.deletedAt,
      editedAt: null,
      forwarded: Boolean(message.forwardedFrom),
      createdAt: message.createdAt,
    };
  }

  return {
    id: String(message._id),
    kind: message.kind,
    content: message.content,
    media: message.media || null,
    sender: message.sender?.profile ? userPreview(message.sender) : undefined,
    replyTo: replyPreview(message.replyTo, viewerId),
    reactions: reactions || [],
    read,
    deleted: false,
    deletedAt: null,
    editedAt: message.editedAt || null,
    forwarded: Boolean(message.forwardedFrom),
    createdAt: message.createdAt,
  };
}

const SENDER_FIELDS = 'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction lastActiveAt privacy.showOnlineStatus';

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

// Shared by "start a DM" and "forward to a user by name" - same rules either
// way: can't message yourself, a block hides the user entirely (404, same as
// everywhere else), and the target's own allowDirectMessages setting is the
// last gate.
async function resolveDmTarget(userId, username) {
  const target = await userModel.findByUsername(username);
  if (!target) return { error: { status: 404, message: 'User not found.' } };
  if (String(target._id) === String(userId)) return { error: { status: 400, message: 'You cannot message yourself.' } };
  if (await isBlockedEitherWay(userId, target._id)) return { error: { status: 404, message: 'User not found.' } };
  if (target.privacy?.allowDirectMessages === false) {
    return { error: { status: 403, message: 'This user is not accepting direct messages.' } };
  }
  return { target };
}

// POST /api/chats/dm - find-or-create a DM by target username.
async function startDirectMessage(req, res) {
  const { target, error } = await resolveDmTarget(req.userId, req.body?.username);
  if (error) return res.status(error.status).json({ error: error.message });

  const conversation = await getOrCreateDmConversation(req.userId, target._id);
  return res.json({ chat: await summarizeConversation(conversation, req.user) });
}

// GET /api/chats/:conversationId
async function getConversationDetail(req, res) {
  let { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  // Existing untimed pins receive a single 7-day window on their first read.
  if (conversation.pinnedMessage && !conversation.pinnedUntil) {
    const now = new Date();
    conversation = await Conversation.findOneAndUpdate(
      { _id: conversation._id, pinnedMessage: conversation.pinnedMessage, pinnedUntil: null },
      { $set: { pinnedAt: now, pinnedUntil: new Date(now.getTime() + PIN_DURATIONS['7d']), pinDuration: '7d' } },
      { new: true }
    ) || await Conversation.findById(conversation._id);
  }

  const summary = await summarizeConversation(conversation, req.user);
  let pinnedMessage = null;
  if (conversation.pinnedMessage && conversation.pinnedUntil > new Date()) {
    const pinned = await Message.findById(conversation.pinnedMessage).populate('sender', 'profile.username profile.firstName');
    if (pinned && !pinned.deletedForEveryone && !hiddenFor(pinned, req.userId)) {
      pinnedMessage = pinPreview(pinned, conversation);
    }
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
      .sort({ createdAt: -1, _id: -1 })
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
  const sendError = await canSendToConversation(conversation, req.userId);
  if (sendError) {
    cleanUpLocalFile(req.file);
    return res.status(sendError.status).json({ error: sendError.message });
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
    if (!original || String(original.conversation) !== String(conversation._id) || original.deletedForEveryone || hiddenFor(original, req.userId)) {
      cleanUpLocalFile(file);
      return res.status(400).json({ error: 'replyTo must reference a message in this conversation.' });
    }
    replyTo = original._id;
  }

  const validation = validateChatMedia(file, req.body);
  if (validation.error) {
    cleanUpLocalFile(file);
    return res.status(validation.status).json({ error: validation.error });
  }
  const { kind, waveform } = validation;
  let media = null;
  if (file) {
    media = await storeChatMedia(file, kind);
    if (waveform) media.waveform = waveform;
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
  if (req.query.scope !== undefined && !['me', 'everyone'].includes(req.query.scope)) {
    return res.status(400).json({ error: 'scope must be me or everyone.' });
  }
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const message = await loadMessageInConversation(conversation, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
  const result = await deleteSelectedMessage(conversation, message, req.userId, scope);
  return res.status(result.status).json(result.body);
}

async function deleteSelectedMessage(conversation, message, userId, scope) {
  if (scope === 'everyone') {
    if (String(message.sender) !== String(userId)) {
      return { status: 403, body: { error: 'You can only delete your own message for everyone.' } };
    }
    if (!message.deletedForEveryone) {
      const ageMs = Date.now() - new Date(message.createdAt).getTime();
      if (ageMs > DELETE_FOR_EVERYONE_WINDOW_MS) {
        return { status: 403, body: { error: 'Messages can only be deleted for everyone within 5 minutes of sending. You can still delete it for yourself.' } };
      }
      message.deletedForEveryone = true;
      message.deletedAt = new Date();
      await message.save();
    }
    await Conversation.updateOne({ _id: conversation._id, pinnedMessage: message._id }, { $set: CLEAR_PIN });
    return { status: 200, body: { deleted: true, scope: 'everyone', messageId: String(message._id) } };
  }

  await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: userId } });
  return { status: 200, body: { deleted: true, scope: 'me', messageId: String(message._id) } };
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

  if (req.body.messageId === undefined) return res.status(400).json({ error: 'messageId is required; use null to unpin.' });
  if (req.body.messageId === null) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: CLEAR_PIN });
    return res.json({ pinnedMessage: null });
  }

  const duration = req.body.duration === undefined ? '7d' : req.body.duration;
  if (typeof duration !== 'string' || !Object.prototype.hasOwnProperty.call(PIN_DURATIONS, duration)) return res.status(400).json({ error: 'duration must be 24h, 7d, or 30d.' });

  if (!mongoose.isValidObjectId(req.body.messageId)) return res.status(400).json({ error: 'messageId is not valid.' });
  const message = await Message.findById(req.body.messageId).populate('sender', 'profile.username profile.firstName');
  if (!message || String(message.conversation) !== String(conversation._id) || hiddenFor(message, req.userId)) {
    return res.status(404).json({ error: 'Message not found in this conversation.' });
  }
  if (message.deletedForEveryone) return res.status(400).json({ error: 'A deleted message cannot be pinned.' });
  conversation.pinnedMessage = message._id;
  conversation.pinnedAt = new Date();
  conversation.pinnedUntil = new Date(conversation.pinnedAt.getTime() + PIN_DURATIONS[duration]);
  conversation.pinnedBy = req.userId;
  conversation.pinDuration = duration;
  await conversation.save();
  return res.json({ pinnedMessage: pinPreview(message, conversation) });
}

function pinPreview(message, conversation) {
  return { ...replyPreview(message), content: message.content, kind: message.kind, createdAt: message.createdAt,
    pinnedAt: conversation.pinnedAt, expiresAt: conversation.pinnedUntil,
    pinnedBy: conversation.pinnedBy ? String(conversation.pinnedBy) : null, duration: conversation.pinDuration };
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
  if (!message || hiddenFor(message, req.userId)) return res.status(404).json({ error: 'Message not found.' });
  if (message.deletedForEveryone) return res.status(400).json({ error: 'A deleted message cannot receive reactions.' });

  const emoji = typeof req.body.emoji === 'string' ? req.body.emoji.trim() : '';
  if (!emoji || emoji.length > 32) return res.status(400).json({ error: 'emoji is required and must be short.' });

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

// POST /api/chats/:conversationId/messages/:messageId/forward - body needs
// exactly one of targetConversationId (an existing conversation you're
// already in - Community, your faction room, or a DM) or targetUsername (any
// user, found via GET /api/users/search - the DM is found-or-created for you,
// same as tapping "+" to start a chat and then forwarding into it, subject to
// the same block/allowDirectMessages rules as starting a DM directly).
// Copies content/media into a brand-new message rather than moving or
// re-uploading anything; deleting or editing the original never touches it.
async function forwardMessage(req, res) {
  const { conversation: sourceConversation, error: sourceError } = await loadConversationForUser(req.params.conversationId, req.user);
  if (sourceError) return res.status(sourceError.status).json({ error: sourceError.message });

  const original = await loadMessageInConversation(sourceConversation, req.params.messageId);
  if (!original) return res.status(404).json({ error: 'Message not found.' });
  if (original.deletedForEveryone) return res.status(400).json({ error: 'This message was deleted and cannot be forwarded.' });
  if (original.deletedFor.some((userId) => String(userId) === String(req.userId))) {
    return res.status(404).json({ error: 'Message not found.' });
  }

  const { targetConversationId, targetUsername } = req.body;
  if (Boolean(targetConversationId) === Boolean(targetUsername)) {
    return res.status(400).json({ error: 'Provide exactly one of targetConversationId or targetUsername.' });
  }

  let targetConversation;
  if (targetUsername) {
    const { target, error: dmError } = await resolveDmTarget(req.userId, targetUsername);
    if (dmError) return res.status(dmError.status).json({ error: dmError.message });
    targetConversation = await getOrCreateDmConversation(req.userId, target._id);
  } else {
    const { conversation, error: targetError } = await loadConversationForUser(targetConversationId, req.user);
    if (targetError) return res.status(targetError.status).json({ error: 'You do not have access to that conversation.' });
    targetConversation = conversation;
  }

  const sendError = await canSendToConversation(targetConversation, req.userId);
  if (sendError) return res.status(sendError.status).json({ error: sendError.message });

  return res.status(201).json(await forwardCopy(original, targetConversation, req.userId));
}

async function forwardCopy(original, targetConversation, userId) {
  let message = await Message.create({
    conversation: targetConversation._id,
    sender: userId,
    kind: original.kind,
    content: original.content,
    media: original.media,
    forwardedFrom: original._id,
  });
  await Promise.all([
    Conversation.updateOne({ _id: targetConversation._id }, { $inc: { messageCount: 1 } }),
    ConversationMember.updateOne(
      { conversation: targetConversation._id, user: userId },
      { $set: { lastReadAt: new Date() } },
      { upsert: true }
    ),
  ]);
  message = await message.populate('sender', SENDER_FIELDS);

  return {
    conversationId: String(targetConversation._id),
    message: serializeMessage(message, { viewerId: userId, conversationType: targetConversation.type, otherLastReadAt: null, reactions: [] }),
  };
}

function selectedIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50 || value.some((id) => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) return null;
  return [...new Set(value.map((id) => id.toLowerCase()))];
}

function batchResponse(res, results) {
  const succeeded = results.filter((item) => item.status < 300).length;
  return res.status(succeeded === results.length ? 200 : 207).json({ results, summary: { total: results.length, succeeded, failed: results.length - succeeded } });
}

async function bulkDeleteMessages(req, res) {
  const ids = selectedIds(req.body.messageIds);
  const scope = req.body.scope === undefined ? 'me' : req.body.scope;
  if (!ids || !['me', 'everyone'].includes(scope)) return res.status(400).json({ error: 'Provide 1-50 valid messageIds and scope me or everyone.' });
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });
  const results = [];
  for (const messageId of ids) {
    try {
      const message = await loadMessageInConversation(conversation, messageId);
      const result = message ? await deleteSelectedMessage(conversation, message, req.userId, scope) : { status: 404, body: { error: 'Message not found.' } };
      results.push({ messageId, status: result.status, ...result.body });
    } catch (error) {
      console.error('Bulk delete failed:', error);
      results.push({ messageId, status: 500, error: 'Deletion could not be confirmed. Refresh before retrying.' });
    }
  }
  return batchResponse(res, results);
}

async function bulkForwardMessages(req, res) {
  const ids = selectedIds(req.body.messageIds);
  if (!ids) return res.status(400).json({ error: 'Provide 1-50 valid messageIds.' });
  let targets = req.body.targets;
  if (targets === undefined) targets = [{ targetConversationId: req.body.targetConversationId, targetUsername: req.body.targetUsername }];
  else if (req.body.targetConversationId !== undefined || req.body.targetUsername !== undefined) return res.status(400).json({ error: 'Use targets or a single target, not both.' });
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 10 || targets.some((target) => !target || typeof target !== 'object' || Boolean(target.targetConversationId) === Boolean(target.targetUsername) || (target.targetConversationId && (typeof target.targetConversationId !== 'string' || !/^[a-f\d]{24}$/i.test(target.targetConversationId))) || (target.targetUsername && typeof target.targetUsername !== 'string'))) {
    return res.status(400).json({ error: 'Provide 1-10 targets, each with exactly one targetConversationId or targetUsername.' });
  }
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });
  const originals = await Message.find({ _id: { $in: ids }, conversation: conversation._id, deletedForEveryone: false, deletedFor: { $ne: req.userId } }).sort({ createdAt: 1, _id: 1 });
  if (originals.length !== ids.length) return res.status(404).json({ error: 'One or more selected messages are unavailable in this conversation.' });

  // Validate all destinations before creating a DM or sending any copy.
  const destinations = [];
  for (const target of targets) {
    if (target.targetUsername) {
      const resolved = await resolveDmTarget(req.userId, target.targetUsername);
      if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
      destinations.push({ user: resolved.target });
    } else {
      const resolved = await loadConversationForUser(target.targetConversationId, req.user);
      if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
      const sendError = await canSendToConversation(resolved.conversation, req.userId);
      if (sendError) return res.status(sendError.status).json({ error: sendError.message });
      destinations.push({ conversation: resolved.conversation });
    }
  }
  const conversations = new Map();
  for (const destination of destinations) {
    const target = destination.conversation || await getOrCreateDmConversation(req.userId, destination.user._id);
    conversations.set(target.id, target);
  }
  const results = [];
  for (const target of conversations.values()) {
    for (const original of originals) {
      const result = { sourceMessageId: original.id, conversationId: target.id };
      try {
        // Recheck per copy so a block or deletion during a batch is respected.
        const sendError = await canSendToConversation(target, req.userId);
        const current = await loadMessageInConversation(conversation, original.id);
        if (sendError) results.push({ ...result, status: sendError.status, error: sendError.message });
        else if (!current || current.deletedForEveryone || hiddenFor(current, req.userId)) results.push({ ...result, status: 404, error: 'Message unavailable.' });
        else results.push({ ...result, status: 201, ...await forwardCopy(current, target, req.userId) });
      } catch (error) {
        console.error('Bulk forward failed:', error);
        results.push({ ...result, status: 500, error: 'Forward could not be confirmed. Refresh before retrying.' });
      }
    }
  }
  return batchResponse(res, results);
}

function hiddenFor(message, userId) {
  return message.deletedFor?.some((id) => String(id) === String(userId));
}

async function canSendToConversation(conversation, senderId) {
  if (conversation.type !== 'dm') return null;
  const otherId = conversation.participants.find((id) => String(id) !== String(senderId));
  const other = await User.findById(otherId);
  if (!other || await isBlockedEitherWay(senderId, otherId)) return { status: 403, message: 'Direct messages are unavailable for this conversation.' };
  if (other.privacy?.allowDirectMessages === false) return { status: 403, message: 'This user is not accepting direct messages.' };
  return null;
}

// Deep-link resolution checks membership, including for a message outside the first page.
async function getMessage(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });
  const message = await loadMessageInConversation(conversation, req.params.messageId);
  if (!message || hiddenFor(message, req.userId)) return res.status(404).json({ error: 'Message not found.' });
  await message.populate('sender', SENDER_FIELDS);
  await message.populate({ path: 'replyTo', populate: { path: 'sender', select: 'profile.username profile.firstName' } });
  const other = conversation.type === 'dm' ? await ConversationMember.findOne({ conversation: conversation._id, user: { $ne: req.userId } }) : null;
  return res.json({ message: serializeMessage(message, {
    viewerId: req.userId, conversationType: conversation.type, otherLastReadAt: other?.lastReadAt,
    reactions: await summarizeReactions(message._id, req.userId),
  }) });
}

async function getChatShareLink(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });
  let path = `/c/${conversation.id}`;
  if (req.params.messageId) {
    const message = await loadMessageInConversation(conversation, req.params.messageId);
    if (!message || message.deletedForEveryone || hiddenFor(message, req.userId)) return res.status(404).json({ error: 'Message not found.' });
    path += `/m/${message.id}`;
  }
  return res.json({ ...buildContentShare(req, path, 'CosQuest chat', 'Open this conversation in CosQuest.'), requiresAuthentication: true });
}

// GET /api/chats/:conversationId/messages/:messageId/seen - who has read up to
// (and including) this message, excluding the sender. In a DM this is
// naturally 0 or 1 person; in community/faction rooms it can be many, hence
// the pagination. Relies on the same ConversationMember.lastReadAt the unread
// badge and DM read-receipt already use - no new schema needed.
async function getMessageSeenBy(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const message = await loadMessageInConversation(conversation, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const query = {
    conversation: conversation._id,
    user: { $ne: message.sender },
    lastReadAt: { $gte: message.createdAt },
  };
  const [members, total] = await Promise.all([
    ConversationMember.find(query)
      .populate('user', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
      .sort({ lastReadAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ConversationMember.countDocuments(query),
  ]);

  return res.json({
    seenBy: members.filter((member) => member.user).map((member) => ({ ...userPreview(member.user), seenAt: member.lastReadAt })),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
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
  getMessageSeenBy,
  forwardMessage,
  bulkDeleteMessages,
  bulkForwardMessages,
  getMessage,
  getChatShareLink,
  loadConversationForUser,
  loadMessageInConversation,
};
