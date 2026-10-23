const fs = require('fs');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');
const MessageReaction = require('../models/MessageReaction');
const Spark = require('../models/Spark');
const {
  loadConversationForUser,
  loadMessageInConversation,
  serializeMessage,
  canSendToConversation,
  explicitGroupMemberIds,
  hiddenFor,
  groupReactions,
  pollSummaries,
  otherLastReadFor,
  forBroadcast,
  SENDER_FIELDS,
  groupRolesFor,
} = require('./chatController');
const { storeChatMedia, deleteChatMedia } = require('../utils/imageHost');
const { validateChatMedia } = require('../utils/chatMedia');
const sparks = require('../utils/sparks'); // legacy engine (SPARKS_ENGINE=legacy)
const sparksHost = require('../sparks');
const { emitToConversationExcept, emitToUsers } = require('../realtime/socket');

const REPLY_SENDER = 'profile.username profile.firstName';

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanUp(files) {
  for (const file of files || []) if (file?.path) fs.unlink(file.path, () => {});
}

// Who has "deleted [this message] for me" - kept out of live broadcasts, the
// same rule createMessage uses for a reply target.
function deletedForIds(message) {
  return (message?.deletedFor || []).map(String);
}

// Serialize a page of messages for one viewer: reactions and (in DMs) the
// other person's read position included, the same as the normal message list.
async function serializeMany(docs, conversation, viewer) {
  const [reactionDocs, otherLastReadAt, polls, groupRoles] = await Promise.all([
    MessageReaction.find({ message: { $in: docs.map((doc) => doc._id) } }),
    otherLastReadFor(conversation, viewer),
    pollSummaries(docs, viewer._id),
    groupRolesFor(conversation),
  ]);
  const reactionsByMessage = groupReactions(reactionDocs, viewer._id);
  const out = docs.map((doc) =>
    serializeMessage(doc, {
      viewerId: viewer._id,
      conversationType: conversation.type,
      otherLastReadAt,
      reactions: reactionsByMessage.get(String(doc._id)) || [],
      poll: polls.get(String(doc._id)),
      groupRoles,
    })
  );
  // Sparks bot "Earlier context" posts: only the quotes this reader may read.
  return require('../sparks/botPosts').redactForViewer(out, conversation._id, viewer._id);
}

// Where a search result sits: in a Spark (and which part of its history),
// or the main conversation. Figma M16: "Spider-Man uniform · revived",
// "Spider-Man uniform · history", "Original conversation".
function contextLabel(message, spark) {
  if (!spark) return 'Original conversation';
  if (spark.sparkId) {
    // Module Spark: revivalIndex counts the lives; the message's own index says which one.
    if (spark.revivalIndex === 0) return spark.subject;
    return (message.sparkRevivalIndex || 0) >= spark.revivalIndex ? `${spark.subject} · revived` : `${spark.subject} · history`;
  }
  const eras = spark.eras?.length || 1;
  if (eras <= 1) return spark.subject;
  return (message.sparkEra || 0) >= eras - 1 ? `${spark.subject} · revived` : `${spark.subject} · history`;
}

// A `from` / `to` search bound: an ISO date ("2026-10-01") or date-time
// ("2026-10-01T09:30:00Z"). A plain date as `to` means the end of that day
// (UTC), so from=to=2026-10-01 finds everything sent that day.
// Returns undefined (not given), null (invalid) or a Date.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

function parseSearchDate(value, endOfDay) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const dateOnly = ISO_DATE.test(text);
  if (!dateOnly && !ISO_DATE_TIME.test(text)) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(text);
  // No time zone given: UTC (never the server's local time).
  const date = new Date(dateOnly ? `${text}T00:00:00.000Z` : zoned ? text : `${text}Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Impossible days roll over in Date (2026-02-31 -> March 3): refuse them.
  if (!(zoned && !text.endsWith('Z')) && date.toISOString().slice(0, 10) !== text.slice(0, 10)) return null;
  if (dateOnly && endOfDay) return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
  return date;
}

// ==========================================================================
// M16 · SEARCH IN CHAT
// GET /api/chats/:conversationId/search?q=spider-man+mask&page=1&limit=20
//   &from=2026-10-01&to=2026-10-14&sort=newest|oldest
// Text and voice-note transcripts, newest first (sort=oldest for oldest
// first). from / to (optional, inclusive) limit it to messages sent in that
// range. Each result has its context label and the Spark it belongs to (if any).
// ==========================================================================
async function searchMessages(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) return res.status(400).json({ error: 'Type at least 2 characters to search.' });
  if (q.length > 100) return res.status(400).json({ error: 'That search is too long.' });

  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.min(500, Math.max(1, Number(req.query.page) || 1));
  const pattern = new RegExp(escapeRegex(q), 'i');

  const from = parseSearchDate(req.query.from, false);
  const to = parseSearchDate(req.query.to, true);
  if (from === null) return res.status(400).json({ error: 'from must be a date like 2026-10-01 or 2026-10-01T09:30:00Z.' });
  if (to === null) return res.status(400).json({ error: 'to must be a date like 2026-10-14 or 2026-10-14T18:00:00Z.' });
  if (from && to && from > to) return res.status(400).json({ error: 'from must be on or before to.' });
  const sort = req.query.sort === undefined || req.query.sort === '' ? 'newest' : req.query.sort;
  if (sort !== 'newest' && sort !== 'oldest') return res.status(400).json({ error: 'sort must be newest or oldest.' });
  const direction = sort === 'oldest' ? 1 : -1;

  const filter = {
    conversation: conversation._id,
    deletedForEveryone: { $ne: true },
    deletedFor: { $ne: req.userId },
    kind: { $nin: ['call', 'scheduled_call'] },
    $or: [{ content: pattern }, { 'media.transcript': pattern }],
  };
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const [docs, total] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: direction, _id: direction })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('sender', SENDER_FIELDS)
      .populate({ path: 'replyTo', populate: { path: 'sender', select: REPLY_SENDER } }),
    Message.countDocuments(filter),
  ]);

  const sparkIds = sparksHost.isModule() ? [] : [...new Set(docs.map((doc) => doc.spark).filter(Boolean).map(String))];
  const sparkDocs = sparkIds.length ? await Spark.find({ _id: { $in: sparkIds }, deletedAt: null }) : [];
  const sparkById = new Map(sparkDocs.map((spark) => [String(spark._id), spark]));
  // Module Sparks (string ids); only live ones label a result.
  const moduleIds = sparksHost.isModule() ? [...new Set(docs.map((doc) => doc.sparkId).filter(Boolean))] : [];
  for (const id of moduleIds) {
    const row = sparksHost.store ? await sparksHost.store.getSpark(id) : null;
    if (row && (row.state === 'active' || row.state === 'dormant')) sparkById.set(id, row);
  }
  const messages = await serializeMany(docs, conversation, req.user);

  return res.json({
    query: q,
    results: messages.map((message, index) => {
      const key = sparksHost.isModule() ? docs[index].sparkId || null : docs[index].spark ? String(docs[index].spark) : null;
      const spark = key ? sparkById.get(key) : null;
      return {
        message,
        context: {
          label: contextLabel(docs[index], spark),
          sparkId: spark ? String(spark.sparkId || spark._id) : null,
          sparkSubject: spark ? spark.subject : null,
        },
      };
    }),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

// ==========================================================================
// M16 · JUMP TO MESSAGE
// GET /api/chats/:conversationId/messages/:messageId/context?size=12
// The message with the conversation around it (oldest first), so a search
// result "opens with the surrounding conversation".
// ==========================================================================
async function messageContext(req, res) {
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const target = await loadMessageInConversation(conversation, req.params.messageId);
  if (!target || hiddenFor(target, req.userId)) return res.status(404).json({ error: 'Message not found.' });

  const size = Math.min(30, Math.max(1, Number(req.query.size) || 12));
  const base = { conversation: conversation._id, deletedFor: { $ne: req.userId } };
  const populate = (query) =>
    query.populate('sender', SENDER_FIELDS).populate({ path: 'replyTo', populate: { path: 'sender', select: REPLY_SENDER } });

  // Messages sent in the same instant are ordered by _id, so none of them is skipped.
  const sameTime = { createdAt: target.createdAt };
  const [olderPlusOne, middle, newerPlusOne] = await Promise.all([
    populate(
      Message.find({ ...base, $or: [{ createdAt: { $lt: target.createdAt } }, { ...sameTime, _id: { $lt: target._id } }] })
        .sort({ createdAt: -1, _id: -1 })
        .limit(size + 1)
    ),
    populate(Message.findById(target._id)),
    populate(
      Message.find({ ...base, $or: [{ createdAt: { $gt: target.createdAt } }, { ...sameTime, _id: { $gt: target._id } }] })
        .sort({ createdAt: 1, _id: 1 })
        .limit(size + 1)
    ),
  ]);

  // One extra row each way tells us whether there is more without guessing.
  const before = olderPlusOne.slice(0, size);
  const after = newerPlusOne.slice(0, size);
  const docs = [...before.reverse(), middle, ...after].filter(Boolean);
  return res.json({
    targetId: String(target._id),
    messages: await serializeMany(docs, conversation, req.user),
    hasOlder: olderPlusOne.length > size,
    hasNewer: newerPlusOne.length > size,
  });
}

// ==========================================================================
// M17 · ALBUM (several photos/videos in one message)
// POST /api/chats/:conversationId/album   multipart: media (1-10 files,
// images or videos), content (caption), replyTo?, sparkId?
// ==========================================================================
async function createAlbum(req, res) {
  const files = Array.isArray(req.files) ? req.files : [];
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) {
    cleanUp(files);
    return res.status(error.status).json({ error: error.message });
  }

  const sendError = await canSendToConversation(conversation, req.userId);
  if (sendError) {
    cleanUp(files);
    return res.status(sendError.status).json({ error: sendError.message, ...(sendError.extra || {}) });
  }

  if (files.length < 1 || files.length > 10) {
    cleanUp(files);
    return res.status(400).json({ error: 'Choose 1 to 10 photos or videos.' });
  }

  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (content.length > 2000) {
    cleanUp(files);
    return res.status(400).json({ error: 'The caption must be at most 2,000 characters.' });
  }

  // Each file must be a photo or a video (same checks as single uploads).
  const kinds = [];
  for (const file of files) {
    const validation = validateChatMedia(file, {});
    if (validation.error || !['image', 'video'].includes(validation.kind)) {
      cleanUp(files);
      return res.status(validation.status || 400).json({ error: validation.error || 'Albums can only contain photos and videos.' });
    }
    kinds.push(validation.kind);
  }

  let replyTo = null;
  if (req.body.replyTo) {
    if (!mongoose.isValidObjectId(req.body.replyTo)) {
      cleanUp(files);
      return res.status(400).json({ error: 'replyTo is not a valid message id.' });
    }
    const original = await loadMessageInConversation(conversation, req.body.replyTo);
    if (!original || original.deletedForEveryone || hiddenFor(original, req.userId)) {
      cleanUp(files);
      return res.status(400).json({ error: 'replyTo must reference a message in this conversation.' });
    }
    replyTo = original._id;
  }

  // Same rule as a normal message: a Spark that is gone is an error, not ignored.
  let sparkId = null;
  let moduleSpark = null;
  if (req.body.sparkId && sparksHost.isModule()) {
    moduleSpark = await sparksHost.replyFields(conversation._id, String(req.body.sparkId));
    if (!moduleSpark) {
      cleanUp(files);
      return res.status(400).json({ error: 'That Spark no longer exists.' });
    }
  } else if (req.body.sparkId) {
    const spark = mongoose.isValidObjectId(req.body.sparkId)
      ? await Spark.findOne({ _id: req.body.sparkId, conversation: conversation._id, deletedAt: null }, '_id')
      : null;
    if (!spark) {
      cleanUp(files);
      return res.status(400).json({ error: 'That Spark no longer exists.' });
    }
    sparkId = spark._id;
  }

  // Upload in order; each item keeps its kind. If one upload fails, remove the
  // ones already stored and the temp files left behind, so nothing is orphaned.
  const album = [];
  try {
    for (let i = 0; i < files.length; i += 1) {
      const media = await storeChatMedia(files[i], kinds[i]);
      album.push({ ...media, kind: kinds[i] });
    }
  } catch (uploadError) {
    cleanUp(files);
    await Promise.all(album.map((item) => deleteChatMedia(item).catch(() => {})));
    throw uploadError;
  }

  const now = new Date();
  const message = await Message.create({
    conversation: conversation._id,
    sender: req.userId,
    kind: 'album',
    content,
    album,
    replyTo,
    ...(moduleSpark || {}),
  });

  await Promise.all([
    Conversation.updateOne({ _id: conversation._id }, { $inc: { messageCount: 1 } }),
    ConversationMember.updateOne(
      { conversation: conversation._id, user: req.userId },
      { $set: { lastReadAt: now, ...(conversation.type === 'group' ? { lastMessageAt: now } : {}) } },
      { upsert: true }
    ),
    message.populate('sender', SENDER_FIELDS),
  ]);
  if (replyTo) await message.populate({ path: 'replyTo', populate: { path: 'sender', select: REPLY_SENDER } });

  if (sparkId) {
    const spark = await sparks.handleNewMessage(conversation, message, { sparkId }).catch((err) => {
      console.error('[sparks] album reply failed:', err.message);
      return null;
    });
    if (spark) {
      message.spark = spark._id;
      message.sparkEra = Math.max(0, (spark.eras?.length || 1) - 1);
      message.postedInSpark = true;
    }
  }

  const [serialized] = await serializeMany([message], conversation, req.user);
  // The reply target's content rides along in `replyTo`, so anyone who has
  // deleted that message for themselves must not receive it live (see createMessage).
  emitToConversationExcept(String(conversation._id), deletedForIds(message.replyTo), 'message:new', {
    conversationId: String(conversation._id),
    message: forBroadcast(serialized),
  });

  if (conversation.type === 'dm') {
    emitToUsers(conversation.participants.map(String), 'chat:preview', { conversationId: String(conversation._id) });
  } else if (conversation.type === 'group' && conversation.group?.kind !== 'faction') {
    const memberIds = await explicitGroupMemberIds(conversation);
    emitToUsers(memberIds.map(String), 'chat:preview', { conversationId: String(conversation._id) });
  }

  if (sparksHost.isModule()) {
    sparksHost.onMessage(message);
  } else if (!sparkId && content && sparks.SPARK_CHAT_TYPES.includes(conversation.type)) {
    sparks.handleNewMessage(conversation, message).catch((err) => {
      console.error('[sparks] detection failed:', err.message);
    });
  }

  return res.status(201).json({ message: serialized });
}

module.exports = { searchMessages, messageContext, createAlbum, contextLabel, escapeRegex };
