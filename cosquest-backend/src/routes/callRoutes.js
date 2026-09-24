const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  startCall,
  getIncomingCall,
  getCall,
  acceptCall,
  declineCall,
  endCall,
} = require('../controllers/callController');

const router = express.Router();

router.use(requireAuth, requireCompletedOnboarding);
router.post('/chats/:conversationId/calls', asyncHandler(startCall));
router.get('/calls/incoming', asyncHandler(getIncomingCall));
router.get('/calls/:callId', asyncHandler(getCall));
router.post('/calls/:callId/accept', asyncHandler(acceptCall));
router.post('/calls/:callId/decline', asyncHandler(declineCall));
router.post('/calls/:callId/end', asyncHandler(endCall));

module.exports = router;

