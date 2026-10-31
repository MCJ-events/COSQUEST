const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { validateUpload } = require('../middleware/validate');
const rules = require('../validators/groups');
const {
  createGroup,
  discoverGroups,
  getGroup,
  updateGroup,
  listGroupMembers,
  addGroupMembers,
  joinGroup,
  getInvite,
  joinByInvite,
  resetInviteLink,
  leaveGroup,
  muteGroup,
  listJoinRequests,
  decideJoinRequest,
  setMemberRole,
  removeMember,
  banMember,
  listBans,
  unbanMember,
  muteMember,
  unmuteMember,
  cancelMyRequest,
} = require('../controllers/groupController');

const router = express.Router();

// User-created groups (group chat spec). The group's messages use the normal
// chat endpoints: /api/chats/:groupId/messages etc. (a group's id IS its
// conversation id).
// Scoped to '/groups' because this router is mounted at '/'.
router.use('/groups', requireAuth, requireCompletedOnboarding);

// Multipart routes validate after multer (the fields only exist then); a
// refused request's staged photo is deleted.
router.post('/groups', upload.single('photo'), validateUpload(rules.createGroup), asyncHandler(createGroup));
router.get('/groups/discover', validate(rules.discover), asyncHandler(discoverGroups));
// Invite links - placed before /groups/:groupId so "invite" is never read as an id.
router.get('/groups/invite/:code', validate(rules.getInvite), asyncHandler(getInvite));
router.post('/groups/invite/:code/join', validate(rules.joinByInvite), asyncHandler(joinByInvite));

router.get('/groups/:groupId', validate(rules.groupId), asyncHandler(getGroup));
router.patch('/groups/:groupId', upload.single('photo'), validateUpload(rules.updateGroup), asyncHandler(updateGroup));
router.get('/groups/:groupId/members', validate(rules.listMembers), asyncHandler(listGroupMembers));
router.post('/groups/:groupId/members', validate(rules.addMembers), asyncHandler(addGroupMembers));
router.post('/groups/:groupId/join', validate(rules.join), asyncHandler(joinGroup));
router.post('/groups/:groupId/leave', validate(rules.groupId), asyncHandler(leaveGroup));
router.patch('/groups/:groupId/mute', validate(rules.groupId), asyncHandler(muteGroup));
router.post('/groups/:groupId/invite-link/reset', validate(rules.groupId), asyncHandler(resetInviteLink));
router.get('/groups/:groupId/requests', validate(rules.groupId), asyncHandler(listJoinRequests));
router.delete('/groups/:groupId/requests/mine', validate(rules.groupId), asyncHandler(cancelMyRequest));
router.post('/groups/:groupId/requests/:requestId/:decision', validate(rules.decideRequest), asyncHandler(decideJoinRequest));

// Admins (Phase 3)
router.post('/groups/:groupId/members/:userId/role', validate(rules.setRole), asyncHandler(setMemberRole));
router.post('/groups/:groupId/members/:userId/remove', validate(rules.member), asyncHandler(removeMember));
router.post('/groups/:groupId/members/:userId/ban', validate(rules.ban), asyncHandler(banMember));
router.post('/groups/:groupId/members/:userId/mute', validate(rules.member), asyncHandler(muteMember));
router.delete('/groups/:groupId/members/:userId/mute', validate(rules.member), asyncHandler(unmuteMember));
router.get('/groups/:groupId/bans', validate(rules.groupId), asyncHandler(listBans));
router.delete('/groups/:groupId/bans/:userId', validate(rules.member), asyncHandler(unbanMember));

module.exports = router;
