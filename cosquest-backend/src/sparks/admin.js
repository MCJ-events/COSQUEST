/**
 * Manage Sparks (Figma M31, "Proposed Sparks admin panel"), module 1.3:
 * proposed merges and merging several Sparks at once. Admins only (group
 * owners and admins; both people in a DM), the same rule as pin / delete /
 * merge. Spark objects are in the app's existing shape (compat.serializeRow).
 *
 *   GET  /api/chats/:conversationId/sparks/merge-suggestions
 *   POST /api/chats/:conversationId/sparks/merge-suggestions/:suggestionId/accept
 *   POST /api/chats/:conversationId/sparks/merge-suggestions/:suggestionId/dismiss
 *   POST /api/chats/:conversationId/sparks/merge   { sourceSparkIds: [...], intoSparkId }
 *
 * The module proposes a merge when two live Sparks in one chat have nearly the
 * same subject; nothing merges until an admin accepts ("No automatic merge.
 * This requires your confirmation."). A dismissed pair is never proposed again.
 * Admins hear about a new proposal live (`spark:merge_suggested` on their
 * user room) and in their notifications.
 */
const { loadConversationForUser } = require('../controllers/chatController');
const host = require('./index');
const members = require('./members');
const { serializeRow } = require('./compat');

const ADMIN_ONLY = 'Only group admins can delete, merge or pin Sparks.';
const LIVE = ['active', 'dormant'];

// The app's shape for one proposal.
async function serializeProposal(proposal) {
  const [source, target] = await Promise.all([host.store.getSpark(proposal.source.sparkId), host.store.getSpark(proposal.target.sparkId)]);
  if (!source || !target) return null;
  return {
    id: proposal.suggestionId,
    conversationId: proposal.chatId,
    sourceSpark: await serializeRow(host.store, source),
    targetSpark: await serializeRow(host.store, target),
    score: proposal.score,
    reason: proposal.reason,
    method: proposal.method,
    status: proposal.status,
    createdAt: proposal.createdAt,
  };
}

/** ports.onMergeSuggested: a live event and a bell notification for each admin. */
async function notifyAdmins(proposal, adminUserIds) {
  if (!adminUserIds.length) return;
  const { emitToUsers } = require('../realtime/socket');
  const notificationModel = require('../models/notificationModel');
  const suggestion = await serializeProposal(proposal);
  if (!suggestion) return;
  emitToUsers(adminUserIds, 'spark:merge_suggested', { conversationId: proposal.chatId, suggestion });
  const message = `Sparks bot suggests merging "${proposal.source.subject}" into "${proposal.target.subject}". Review it in Manage Sparks.`;
  await Promise.all(adminUserIds.map((userId) => notificationModel.createForUser(userId, message, { type: 'group', conversation: proposal.chatId })));
}

// The chat, for a module-engine request; null (response sent) otherwise.
async function loadChat(req, res, { needs } = {}) {
  if (!host.isModule()) {
    res.status(501).json({ error: 'This needs the Sparks module (SPARKS_ENGINE=module).' });
    return null;
  }
  if (!host.isReady()) {
    res.status(503).json({ error: 'Sparks are unavailable right now.' });
    return null;
  }
  if (needs && typeof needs(host.backend) !== 'function') {
    res.status(501).json({ error: 'This needs Sparks backend module 1.3 or newer.' });
    return null;
  }
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) {
    res.status(error.status).json({ error: error.message });
    return null;
  }
  return conversation;
}

function sendModuleError(res, error, fallback400 = 'Choose different Sparks to merge.') {
  if (error?.status === 403) return res.status(403).json({ error: ADMIN_ONLY });
  if (error?.status === 404) return res.status(404).json({ error: /suggestion/.test(error.message) ? 'Suggestion not found.' : 'Spark not found.' });
  if (error?.status === 409) return res.status(409).json({ code: 'already_decided', error: 'This suggestion was already handled.' });
  if (error?.status === 400) return res.status(400).json({ error: fallback400 });
  throw error;
}

// GET /api/chats/:conversationId/sparks/merge-suggestions - admins.
async function listMergeSuggestions(req, res) {
  const conversation = await loadChat(req, res, { needs: (b) => b.admin.mergeSuggestions });
  if (!conversation) return;
  let proposals;
  try {
    proposals = await host.backend.admin.mergeSuggestions(String(req.userId), String(conversation._id));
  } catch (error) {
    return sendModuleError(res, error);
  }
  const suggestions = (await Promise.all(proposals.map(serializeProposal))).filter(Boolean);
  return res.json({ suggestions, canManage: true });
}

// The suggestion must belong to this chat (the module checks the admin).
async function suggestionInChat(conversation, suggestionId) {
  const row = typeof host.store.getMergeSuggestion === 'function' ? await host.store.getMergeSuggestion(String(suggestionId)) : null;
  return row && row.chatId === String(conversation._id) ? row : null;
}

// POST /api/chats/:conversationId/sparks/merge-suggestions/:suggestionId/accept - admins.
async function acceptMergeSuggestion(req, res) {
  const conversation = await loadChat(req, res, { needs: (b) => b.admin.acceptMergeSuggestion });
  if (!conversation) return;
  if (!(await members.isAdmin(String(req.userId), String(conversation._id)))) return res.status(403).json({ error: ADMIN_ONLY });
  const row = await suggestionInChat(conversation, req.params.suggestionId);
  if (!row) return res.status(404).json({ error: 'Suggestion not found.' });
  let kept;
  try {
    kept = await host.backend.admin.acceptMergeSuggestion(String(req.userId), row.suggestionId);
  } catch (error) {
    return sendModuleError(res, error);
  }
  return res.json({ spark: await serializeRow(host.store, await host.store.getSpark(kept.sparkId)), mergedSparkIds: [row.sourceSparkId] });
}

// POST /api/chats/:conversationId/sparks/merge-suggestions/:suggestionId/dismiss - admins.
async function dismissMergeSuggestion(req, res) {
  const conversation = await loadChat(req, res, { needs: (b) => b.admin.dismissMergeSuggestion });
  if (!conversation) return;
  if (!(await members.isAdmin(String(req.userId), String(conversation._id)))) return res.status(403).json({ error: ADMIN_ONLY });
  const row = await suggestionInChat(conversation, req.params.suggestionId);
  if (!row) return res.status(404).json({ error: 'Suggestion not found.' });
  try {
    await host.backend.admin.dismissMergeSuggestion(String(req.userId), row.suggestionId);
  } catch (error) {
    return sendModuleError(res, error);
  }
  return res.json({ dismissed: true, id: row.suggestionId });
}

// POST /api/chats/:conversationId/sparks/merge  { sourceSparkIds: [...], intoSparkId } - admins.
// Every source merges into intoSparkId in one operation: all or nothing.
async function mergeManySparks(req, res) {
  const conversation = await loadChat(req, res, { needs: (b) => b.admin.mergeMany });
  if (!conversation) return;
  const chatId = String(conversation._id);
  if (!(await members.isAdmin(String(req.userId), chatId))) return res.status(403).json({ error: ADMIN_ONLY });
  const sourceIds = Array.isArray(req.body?.sourceSparkIds) ? req.body.sourceSparkIds : [];
  const intoId = req.body?.intoSparkId;
  const max = host.backend.config.mergeMaxSources || 20;
  if (!sourceIds.length || !sourceIds.every((id) => typeof id === 'string' && id) || typeof intoId !== 'string') {
    return res.status(400).json({ error: 'Choose the Sparks to merge (sourceSparkIds) and the one to keep (intoSparkId).' });
  }
  if (sourceIds.length > max) return res.status(400).json({ error: `You can merge up to ${max} Sparks at a time.` });
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.includes(intoId)) {
    return res.status(400).json({ error: 'Each Spark can be chosen once, and not as both a source and the one to keep.' });
  }
  const rows = await Promise.all([intoId, ...sourceIds].map((id) => host.store.getSpark(id)));
  if (rows.some((row) => !row || row.chatId !== chatId || !LIVE.includes(row.state))) return res.status(404).json({ error: 'Spark not found.' });
  try {
    await host.backend.admin.mergeMany(String(req.userId), sourceIds, intoId);
  } catch (error) {
    return sendModuleError(res, error);
  }
  return res.json({ spark: await serializeRow(host.store, await host.store.getSpark(intoId)), mergedSparkIds: sourceIds });
}

module.exports = { listMergeSuggestions, acceptMergeSuggestion, dismissMergeSuggestion, mergeManySparks, notifyAdmins, serializeProposal };
