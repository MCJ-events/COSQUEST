const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { chatUpload, albumUpload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');
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
} = require('../controllers/chatController');
const { listSparks, getSpark, startSpark, addToSpark, pinSpark, deleteSpark, mergeSpark } = require('../controllers/sparkController');
const { searchMessages, messageContext, createAlbum } = require('../controllers/chatExtrasController');

const router = express.Router();

// Every chat endpoint requires a fully onboarded, logged-in user - there is
// no pre-login chat access, unlike the onboarding-step endpoints elsewhere.
// Scoped to '/chats' because this router is mounted at '/': unscoped, it would
// also re-check the login on every request that falls through to a later
// router (e.g. /api/spotlight).
router.use('/chats', requireAuth, requireCompletedOnboarding);

router.get('/chats', asyncHandler(listChats));
router.post('/chats/dm', asyncHandler(startDirectMessage));
router.get('/chats/:conversationId', asyncHandler(getConversationDetail));
// People in this chat, for the @ mention checkbox picker (?search=&page=&limit=).
router.get('/chats/:conversationId/members', asyncHandler(listChatMembers));
router.get('/chats/:conversationId/share', asyncHandler(getChatShareLink));
router.get('/chats/:conversationId/messages/:messageId', asyncHandler(getMessage));
router.get('/chats/:conversationId/messages/:messageId/share', asyncHandler(getChatShareLink));
router.get('/chats/:conversationId/messages', asyncHandler(listMessages));
router.post('/chats/:conversationId/messages', chatUpload.single('media'), asyncHandler(createMessage));

// Search in chat (M16), a message with the conversation around it (M16), and
// albums - several photos/videos in one message (M17).
router.get('/chats/:conversationId/search', asyncHandler(searchMessages));
router.get('/chats/:conversationId/messages/:messageId/context', asyncHandler(messageContext));
router.post('/chats/:conversationId/album', albumUpload.array('media', 10), asyncHandler(createAlbum));
router.post('/chats/:conversationId/messages/bulk-delete', asyncHandler(bulkDeleteMessages));
router.post('/chats/:conversationId/messages/bulk-forward', asyncHandler(bulkForwardMessages));
router.patch('/chats/:conversationId/messages/:messageId', asyncHandler(editMessage));
// Undo the last edit (author only).
router.post('/chats/:conversationId/messages/:messageId/rollback', asyncHandler(rollbackMessage));
router.delete('/chats/:conversationId/messages/:messageId', asyncHandler(deleteMessage));
router.patch('/chats/:conversationId/read', asyncHandler(markRead));
router.patch('/chats/:conversationId/pinned-message', asyncHandler(setPinnedMessage));
router.post('/chats/:conversationId/messages/:messageId/reactions', asyncHandler(setReaction));
router.delete('/chats/:conversationId/messages/:messageId/reactions', asyncHandler(removeReaction));
router.get('/chats/:conversationId/messages/:messageId/seen', asyncHandler(getMessageSeenBy));
router.post('/chats/:conversationId/messages/:messageId/forward', asyncHandler(forwardMessage));

// Sparks (sub-conversations) - Community, faction rooms and groups.
router.get('/chats/:conversationId/sparks', asyncHandler(listSparks));
router.post('/chats/:conversationId/sparks', asyncHandler(startSpark));
router.get('/chats/:conversationId/sparks/:sparkId', asyncHandler(getSpark));
router.post('/chats/:conversationId/sparks/:sparkId/messages', asyncHandler(addToSpark));
router.patch('/chats/:conversationId/sparks/:sparkId/pin', asyncHandler(pinSpark));
router.delete('/chats/:conversationId/sparks/:sparkId', asyncHandler(deleteSpark));
router.post('/chats/:conversationId/sparks/:sparkId/merge', asyncHandler(mergeSpark));

module.exports = router;
