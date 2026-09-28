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

// Scoped to this router's own paths: it's mounted at '/' ahead of chatRoutes,
// so an unscoped router.use would also run on every /api/chats request and
// look the user up again before chatRoutes does its own check.
router.use(['/calls', '/chats/:conversationId/calls'], requireAuth, requireCompletedOnboarding);
router.post('/chats/:conversationId/calls', asyncHandler(startCall));
router.get('/calls/incoming', asyncHandler(getIncomingCall));
router.get('/calls/:callId', asyncHandler(getCall));
router.post('/calls/:callId/accept', asyncHandler(acceptCall));
router.post('/calls/:callId/decline', asyncHandler(declineCall));
router.post('/calls/:callId/end', asyncHandler(endCall));

module.exports = router;

