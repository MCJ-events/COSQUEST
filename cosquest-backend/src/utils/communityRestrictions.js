// CosQuest-wide restrictions set by super admins (admin dashboard, Members):
//
//   mute     can read and browse, can't post, comment or send messages anywhere
//   suspend  can't use CosQuest at all (requireAuth answers 403 account_suspended)
//
// Stored on the user (User.moderation) so every check is a field read, no
// extra query. Group-only mutes and bans stay where they were
// (ConversationMember.mutedByAdminUntil, GroupBan).
const fs = require('fs');

const DURATIONS = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  forever: 100 * 365 * 24 * 60 * 60 * 1000,
};
const LABELS = { '1h': '1 hour', '1d': '1 day', '1w': '1 week', '30d': '30 days', forever: 'until an admin lifts it' };
const FOREVER_AFTER = 50 * 365 * 24 * 60 * 60 * 1000;

const isActive = (until) => Boolean(until) && new Date(until).getTime() > Date.now();
const mutedUntil = (user) => (isActive(user?.moderation?.mutedUntil) ? user.moderation.mutedUntil : null);
const suspendedUntil = (user) => (isActive(user?.moderation?.suspendedUntil) ? user.moderation.suspendedUntil : null);
const isForever = (until) => new Date(until).getTime() - Date.now() > FOREVER_AFTER;

function untilText(until) {
  return isForever(until) ? 'until a CosQuest admin lifts it' : `until ${new Date(until).toUTCString().replace(/:\d\d GMT$/, ' GMT')}`;
}

function cleanUpUploads(req) {
  const files = [req.file, ...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())];
  files.forEach((file) => file?.path && fs.unlink(file.path, () => {}));
}

/**
 * In createPost / createComment / createMessage (and anything else that
 * publishes): `if (refuseIfMuted(req, res)) return;`. Answers 403
 * community_muted and deletes any staged upload.
 */
function refuseIfMuted(req, res) {
  const until = mutedUntil(req.user);
  if (!until) return false;
  cleanUpUploads(req);
  res.status(403).json({
    error: `A CosQuest admin has paused your posting ${untilText(until)}. You can still read and browse.`,
    code: 'community_muted',
    mutedUntil: until,
  });
  return true;
}

/** In requireAuth: a suspended account can't use CosQuest. */
function suspendedAnswer(user) {
  const until = suspendedUntil(user);
  if (!until) return null;
  return {
    error: `This account has been suspended by CosQuest's admins ${untilText(until)}.`,
    code: 'account_suspended',
    suspendedUntil: until,
  };
}

module.exports = { DURATIONS, LABELS, isActive, mutedUntil, suspendedUntil, isForever, refuseIfMuted, suspendedAnswer };
