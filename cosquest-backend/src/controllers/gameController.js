// The CostQuest game's one login (the merged CosQuest app: the chat and the
// game in one app, signed in once, to the chat).
//
// GET /api/game/session: the game backend (ubmids/costquest-backend,
// POST /v1/sso/cosquest, docs/SSO.md) asks this, with the person's own chat
// token, whether their chat session is still the live one. requireAuth is the
// only check that knows about logouts (tokenVersion) and sign-ins on another
// phone (sessionId), and chat tokens never expire, so the game backend must
// not trust a token without asking. It answers who the person is and nothing
// else: no email, no token version, no session id.

// GET /api/game/session (requireAuth)
async function getGameSession(req, res) {
  const user = req.user;
  // The answer names a person: never cached by a proxy or the HTTP stack.
  res.set('Cache-Control', 'no-store');
  return res.json({
    user: {
      id: String(user._id),
      username: user.profile?.username || null,
      displayName: user.profile?.displayName || null,
      faction: user.faction || null,
      avatarKey: user.profile?.avatarKey || null,
      avatarPhotoUrl: user.profile?.avatarPhotoUrl || null,
      onboardingComplete: Boolean(user.onboardingComplete),
    },
  });
}

module.exports = { getGameSession };
