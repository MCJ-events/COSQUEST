/**
 * Search inside one Spark (Figma M16 "Search in chat", limited to a Spark),
 * module 1.3. Every message of the Spark across all its lives (eras: the
 * first conversation, then one per revival), merged-in messages included,
 * newest first, paged. Each result says which era it is from and has the
 * same context label as in-chat search ("Spider-Man uniform · revived",
 * "... · history"). "Jump to message" opens the surrounding conversation
 * inside the Spark with the context route below (or the main-chat context
 * route, GET /api/chats/:id/messages/:messageId/context).
 *
 *   GET /api/chats/:conversationId/sparks/:sparkId/search?q=&era=&page=&limit=
 *       q optional (2-100 characters; without it: the Spark's whole history, newest first)
 *       era optional (0 = the first conversation, 1 = the first revival, ...)
 *   GET /api/chats/:conversationId/sparks/:sparkId/messages/:messageId/context?size=12
 *
 * Visibility: the chat's access rule (as GET /messages), minus messages the
 * user deleted "for me" or that were deleted for everyone, and every result
 * also passes the module's readableSeqs (ports.canReadMany), so a future
 * join-date window applies here without changes. A Spark id that was merged
 * into another resolves to the surviving Spark (`resolvedFrom`).
 */
const Message = require('../models/Message');
const MessageReaction = require('../models/MessageReaction');
const {
  loadConversationForUser,
  serializeMessage,
  groupReactions,
  pollSummaries,
  hiddenFor,
  SENDER_FIELDS,
} = require('../controllers/chatController');
const { contextLabel, escapeRegex } = require('../controllers/chatExtrasController');
const host = require('./index');
const { serializeRow, legacySeams } = require('./compat');

const REPLY_SENDER = 'profile.username profile.firstName';

async function loadSpark(req, res) {
  if (!host.isModule()) {
    res.status(501).json({ error: 'This needs the Sparks module (SPARKS_ENGINE=module).' });
    return null;
  }
  if (!host.isReady()) {
    res.status(503).json({ error: 'Sparks are unavailable right now.' });
    return null;
  }
  if (typeof host.backend.sparkHistory !== 'function' || typeof host.backend.readableSeqs !== 'function') {
    res.status(501).json({ error: 'This needs Sparks backend module 1.3 or newer.' });
    return null;
  }
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) {
    res.status(error.status).json({ error: error.message });
    return null;
  }
  const history = typeof req.params.sparkId === 'string' ? await host.backend.sparkHistory(req.params.sparkId) : null;
  if (!history || history.spark.chatId !== String(conversation._id)) {
    res.status(404).json({ error: 'Spark not found.' });
    return null;
  }
  return { conversation, history };
}

const populate = (query) => query.populate('sender', SENDER_FIELDS).populate({ path: 'replyTo', populate: { path: 'sender', select: REPLY_SENDER } });

async function serialize(docs, conversation, viewerId) {
  const [reactions, polls] = await Promise.all([MessageReaction.find({ message: { $in: docs.map((d) => d._id) } }), pollSummaries(docs, viewerId)]);
  const byMessage = groupReactions(reactions, viewerId);
  return docs.map((doc) =>
    serializeMessage(doc, { viewerId, conversationType: conversation.type, otherLastReadAt: null, reactions: byMessage.get(String(doc._id)) || [], poll: polls.get(String(doc._id)) })
  );
}

// Of these docs, the ones the module says this user may read (history window).
async function readableOnly(docs, userId, chatId) {
  const ok = new Set(await host.backend.readableSeqs(String(userId), chatId, docs.map((d) => d.seq)));
  return docs.filter((d) => ok.has(d.seq));
}

const eraOf = (doc) => doc.sparkRevivalIndex || 0;

// GET /api/chats/:conversationId/sparks/:sparkId/search?q=&era=&page=&limit=
async function searchSpark(req, res) {
  const loaded = await loadSpark(req, res);
  if (!loaded) return;
  const { conversation, history } = loaded;
  const chatId = String(conversation._id);

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q && q.length < 2) return res.status(400).json({ error: 'Type at least 2 characters to search.' });
  if (q.length > 100) return res.status(400).json({ error: 'That search is too long.' });
  let era = null;
  if (req.query.era !== undefined && req.query.era !== '') {
    era = Number(req.query.era);
    if (!Number.isInteger(era) || era < 0) return res.status(400).json({ error: 'era must be 0 or more.' });
  }
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.min(500, Math.max(1, Number(req.query.page) || 1));

  const filter = {
    conversation: conversation._id,
    sparkId: history.spark.sparkId,
    seq: { $type: 'number' },
    deletedForEveryone: { $ne: true },
    deletedFor: { $ne: req.userId },
    kind: { $nin: ['call', 'scheduled_call'] },
    ...(q ? { $or: [{ content: new RegExp(escapeRegex(q), 'i') }, { 'media.transcript': new RegExp(escapeRegex(q), 'i') }] } : {}),
    ...(era === null ? {} : era === 0 ? { sparkRevivalIndex: { $in: [0, null] } } : { sparkRevivalIndex: era }),
  };
  const [found, total] = await Promise.all([
    populate(Message.find(filter).sort({ seq: -1 }).skip((page - 1) * limit).limit(limit)),
    Message.countDocuments(filter),
  ]);
  const docs = await readableOnly(found, req.userId, chatId);
  const messages = await serialize(docs, conversation, req.userId);
  const eraStart = new Map(history.eras.map((e) => [e.era, e.startedAt]));
  const row = await host.store.getSpark(history.spark.sparkId);

  return res.json({
    query: q,
    spark: await serializeRow(host.store, row),
    resolvedFrom: history.resolvedFrom,
    eras: history.eras,
    results: messages.map((message, index) => ({
      message,
      context: {
        label: contextLabel(docs[index], history.spark),
        sparkId: history.spark.sparkId,
        sparkSubject: history.spark.subject,
        era: eraOf(docs[index]),
        eraStartedAt: eraStart.get(eraOf(docs[index])) || null,
      },
    })),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

// GET /api/chats/:conversationId/sparks/:sparkId/messages/:messageId/context?size=12
// The message with up to `size` Spark messages before and after it (oldest
// first), the Spark's labelled seams, and whether there is more each way.
async function sparkMessageContext(req, res) {
  const loaded = await loadSpark(req, res);
  if (!loaded) return;
  const { conversation, history } = loaded;
  const chatId = String(conversation._id);
  const sparkId = history.spark.sparkId;

  const target = await Message.findOne({ _id: req.params.messageId, conversation: conversation._id }).catch(() => null);
  if (!target || target.sparkId !== sparkId || typeof target.seq !== 'number' || target.deletedForEveryone || hiddenFor(target, req.userId)) {
    return res.status(404).json({ error: 'Message not found in this Spark.' });
  }
  if (!(await readableOnly([target], req.userId, chatId)).length) return res.status(404).json({ error: 'Message not found in this Spark.' });

  const size = Math.min(30, Math.max(1, Number(req.query.size) || 12));
  const base = { conversation: conversation._id, sparkId, deletedFor: { $ne: req.userId } };
  const [olderPlusOne, newerPlusOne] = await Promise.all([
    populate(Message.find({ ...base, seq: { $lt: target.seq } }).sort({ seq: -1 }).limit(size + 1)),
    populate(Message.find({ ...base, seq: { $gt: target.seq } }).sort({ seq: 1 }).limit(size + 1)),
  ]);
  const middle = await populate(Message.findById(target._id));
  const docs = await readableOnly([...olderPlusOne.slice(0, size).reverse(), middle, ...newerPlusOne.slice(0, size)].filter(Boolean), req.userId, chatId);
  return res.json({
    targetId: String(target._id),
    sparkId,
    era: eraOf(target),
    messages: await serialize(docs, conversation, req.userId),
    seams: await legacySeams(host.store, sparkId),
    hasOlder: olderPlusOne.length > size,
    hasNewer: newerPlusOne.length > size,
  });
}

module.exports = { searchSpark, sparkMessageContext };
