const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { chatUpload, albumUpload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { validateUpload } = require('../middleware/validate');
const rules = require('../validators/chat');
const {
  listChats,
  startDirectMessage,
  getConversationDetail,
  listChatMembers,
  listMessages,
  createMessage,
  editMessage,
  rollbackMessage,
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
  setChatNotifications,
} = require('../controllers/chatController');
const { listSparks, listNativeSparks, listSparkMembers, getSpark, startSpark, addToSpark, pinSpark, deleteSpark, mergeSpark } = require('../controllers/sparkController');
const { decideRolePing } = require('../controllers/sparkController');
const { searchMessages, messageContext, createAlbum } = require('../controllers/chatExtrasController');
const sparksAdmin = require('../sparks/admin');
const sparkSearch = require('../sparks/search');
const { createPoll, votePoll, closePoll, listPollVotes } = require('../controllers/pollController');
const { createGameInvite, createGameResult } = require('../controllers/gameController');

const router = express.Router();

// Every chat endpoint requires a fully onboarded, logged-in user - there is
// no pre-login chat access, unlike the onboarding-step endpoints elsewhere.
// Scoped to '/chats' because this router is mounted at '/': unscoped, it would
// also re-check the login on every request that falls through to a later
// router (e.g. /api/spotlight).
router.use('/chats', requireAuth, requireCompletedOnboarding);

// Request rules (src/validators/chat.js) run after the login check and, on
// multipart routes, after the upload (validateUpload also removes the staged
// file(s) when it refuses the request).

router.get('/chats', asyncHandler(listChats));
router.post('/chats/dm', validate(rules.startDirectMessage), asyncHandler(startDirectMessage));
router.get('/chats/:conversationId', validate(rules.chat), asyncHandler(getConversationDetail));
// People in this chat, for the @ mention checkbox picker (?search=&page=&limit=).
router.get('/chats/:conversationId/members', validate(rules.chatPage), asyncHandler(listChatMembers));
router.get('/chats/:conversationId/share', validate(rules.chat), asyncHandler(getChatShareLink));
router.get('/chats/:conversationId/messages/:messageId', validate(rules.message), asyncHandler(getMessage));
router.get('/chats/:conversationId/messages/:messageId/share', validate(rules.message), asyncHandler(getChatShareLink));
router.get('/chats/:conversationId/messages', validate(rules.chatPage), asyncHandler(listMessages));
router.post('/chats/:conversationId/messages', chatUpload.single('media'), validateUpload(rules.createMessage), asyncHandler(createMessage));

// Search in chat (M16), a message with the conversation around it (M16), and
// albums - several photos/videos in one message (M17).
router.get('/chats/:conversationId/search', validate(rules.searchMessages), asyncHandler(searchMessages));
// "Mute only Sparks / thread activity" (just for me).
router.patch('/chats/:conversationId/notifications', validate(rules.setChatNotifications), asyncHandler(setChatNotifications));
router.get('/chats/:conversationId/messages/:messageId/context', validate(rules.messageContext), asyncHandler(messageContext));
router.post('/chats/:conversationId/album', albumUpload.array('media', 10), validateUpload(rules.createAlbum), asyncHandler(createAlbum));
router.post('/chats/:conversationId/messages/bulk-delete', validate(rules.bulkDelete), asyncHandler(bulkDeleteMessages));
router.post('/chats/:conversationId/messages/bulk-forward', validate(rules.bulkForward), asyncHandler(bulkForwardMessages));
router.patch('/chats/:conversationId/messages/:messageId', validate(rules.editMessage), asyncHandler(editMessage));
// Undo the last edit (author only).
router.post('/chats/:conversationId/messages/:messageId/rollback', validate(rules.message), asyncHandler(rollbackMessage));
router.delete('/chats/:conversationId/messages/:messageId', validate(rules.deleteMessage), asyncHandler(deleteMessage));
router.patch('/chats/:conversationId/read', validate(rules.chat), asyncHandler(markRead));
router.patch('/chats/:conversationId/pinned-message', validate(rules.setPinnedMessage), asyncHandler(setPinnedMessage));
router.post('/chats/:conversationId/messages/:messageId/reactions', validate(rules.setReaction), asyncHandler(setReaction));
router.delete('/chats/:conversationId/messages/:messageId/reactions', validate(rules.message), asyncHandler(removeReaction));
router.get('/chats/:conversationId/messages/:messageId/seen', validate(rules.messagePage), asyncHandler(getMessageSeenBy));
router.post('/chats/:conversationId/messages/:messageId/forward', validate(rules.forwardMessage), asyncHandler(forwardMessage));

// Polls (kind 'poll'): create, vote, close, see who voted.
router.post('/chats/:conversationId/polls', validate(rules.createPoll), asyncHandler(createPoll));

// Game invites (kind 'game_invite', the merged app): raid / shrine / duel cards.
router.post('/chats/:conversationId/game-invites', asyncHandler(createGameInvite));
// A game result as a card.
router.post('/chats/:conversationId/game-results', asyncHandler(createGameResult));
router.post('/chats/:conversationId/messages/:messageId/vote', validate(rules.votePoll), asyncHandler(votePoll));
router.post('/chats/:conversationId/messages/:messageId/poll/close', validate(rules.poll), asyncHandler(closePoll));
router.get('/chats/:conversationId/messages/:messageId/poll/votes', validate(rules.poll), asyncHandler(listPollVotes));

// Sparks (sub-conversations) - every chat, DMs included (Sparks module;
// SPARKS_ENGINE=legacy restores the old engine: no DMs). See SPARKS_INTEGRATION.md.
router.get('/chats/:conversationId/sparks', validate(rules.chat), asyncHandler(listSparks));
// The module's own Spark objects (summary, seams, state) - for web clients.
router.get('/chats/:conversationId/sparks/native', validate(rules.moduleChat), asyncHandler(listNativeSparks));
// Members as Sparks sees them (roles, admin flags), for sdk.sparks.setMembers.
router.get('/chats/:conversationId/sparks/members', validate(rules.moduleChat), asyncHandler(listSparkMembers));
// Manage Sparks (M31, admins): proposed merges and merging several at once
// (Sparks module 1.3; src/sparks/admin.js). Before /sparks/:sparkId.
router.get('/chats/:conversationId/sparks/merge-suggestions', validate(rules.moduleChat), asyncHandler(sparksAdmin.listMergeSuggestions));
router.post('/chats/:conversationId/sparks/merge-suggestions/:suggestionId/accept', validate(rules.moduleChat), asyncHandler(sparksAdmin.acceptMergeSuggestion));
router.post('/chats/:conversationId/sparks/merge-suggestions/:suggestionId/dismiss', validate(rules.moduleChat), asyncHandler(sparksAdmin.dismissMergeSuggestion));
router.post('/chats/:conversationId/sparks/merge', validate(rules.mergeManySparks), asyncHandler(sparksAdmin.mergeManySparks));
// Search inside one Spark, every era (M16 limited to a Spark), and jump to a message in it.
router.get('/chats/:conversationId/sparks/:sparkId/search', validate(rules.searchSpark), asyncHandler(sparkSearch.searchSpark));
router.get('/chats/:conversationId/sparks/:sparkId/messages/:messageId/context', validate(rules.sparkMessageContext), asyncHandler(sparkSearch.sparkMessageContext));
// Sparks bot posts: an admin approves or dismisses a suggested role ping.
router.post('/chats/:conversationId/sparks/bot-posts/:messageId/role-pings/decide', validate(rules.decideRolePing), asyncHandler(decideRolePing));
router.post('/chats/:conversationId/sparks', validate(rules.startSpark), asyncHandler(startSpark));
router.get('/chats/:conversationId/sparks/:sparkId', validate(rules.chat), asyncHandler(getSpark));
router.post('/chats/:conversationId/sparks/:sparkId/messages', validate(rules.addToSpark), asyncHandler(addToSpark));
router.patch('/chats/:conversationId/sparks/:sparkId/pin', validate(rules.pinSpark), asyncHandler(pinSpark));
router.delete('/chats/:conversationId/sparks/:sparkId', validate(rules.chat), asyncHandler(deleteSpark));
router.post('/chats/:conversationId/sparks/:sparkId/merge', validate(rules.mergeSpark), asyncHandler(mergeSpark));

module.exports = router;
