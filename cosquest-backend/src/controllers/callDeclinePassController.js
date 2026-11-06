// POST /api/call-decline/:callId  { pass }
//
// Declining a call on Android while CosQuest is fully closed: the phone's
// call screen hands the decline to the app's native receiver, which can't
// use the app's login. The ring push (callPush.js) carries a pass for THIS
// call and THIS person, 2 minutes; the receiver posts it here. Then the
// same as POST /api/calls/:callId/decline (callController.declineCall), as
// that person. A pass can only decline: nothing else accepts it.
//
// Not under /api/calls, which needs the session.
const mongoose = require('mongoose');
const { verifyDeclinePass } = require('../utils/callPush');

async function declineByPass(req, res) {
  const { callId } = req.params;
  if (!mongoose.isValidObjectId(callId)) return res.status(404).json({ error: 'Call not found.' });
  const userId = verifyDeclinePass(req.body?.pass, callId);
  if (!userId) return res.status(401).json({ error: 'This decline link has expired.' });
  req.userId = userId;
  return require('./callController').declineCall(req, res);
}

module.exports = { declineByPass };
