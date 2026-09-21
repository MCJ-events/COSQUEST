const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { chatUpload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');
const {
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
} = require('../controllers/chatController');

const router = express.Router();

// Every chat endpoint requires a fully onboarded, logged-in user - there is
// no pre-login chat access, unlike the onboarding-step endpoints elsewhere.
router.use(requireAuth, requireCompletedOnboarding);

router.get('/chats', asyncHandler(listChats));
router.post('/chats/dm', asyncHandler(startDirectMessage));
router.get('/chats/:conversationId', asyncHandler(getConversationDetail));
router.get('/chats/:conversationId/share', asyncHandler(getChatShareLink));
router.get('/chats/:conversationId/messages/:messageId', asyncHandler(getMessage));
router.get('/chats/:conversationId/messages/:messageId/share', asyncHandler(getChatShareLink));
router.get('/chats/:conversationId/messages', asyncHandler(listMessages));
router.post('/chats/:conversationId/messages', chatUpload.single('media'), asyncHandler(createMessage));
router.post('/chats/:conversationId/messages/bulk-delete', asyncHandler(bulkDeleteMessages));
router.post('/chats/:conversationId/messages/bulk-forward', asyncHandler(bulkForwardMessages));
router.patch('/chats/:conversationId/messages/:messageId', asyncHandler(editMessage));
router.delete('/chats/:conversationId/messages/:messageId', asyncHandler(deleteMessage));
router.patch('/chats/:conversationId/read', asyncHandler(markRead));
router.patch('/chats/:conversationId/pinned-message', asyncHandler(setPinnedMessage));
router.post('/chats/:conversationId/messages/:messageId/reactions', asyncHandler(setReaction));
router.delete('/chats/:conversationId/messages/:messageId/reactions', asyncHandler(removeReaction));
router.get('/chats/:conversationId/messages/:messageId/seen', asyncHandler(getMessageSeenBy));
router.post('/chats/:conversationId/messages/:messageId/forward', asyncHandler(forwardMessage));

module.exports = router;
