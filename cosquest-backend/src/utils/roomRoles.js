// Who runs a chat's calls and voice chats: 'owner' | 'admin' | 'member' | null.
//
//   groups              the group's own roles (owner / admin / member)
//   Community, faction  everyone with access is a member; a room admin is a
//   rooms               ConversationMember row with role 'admin' on that
//                       room, set by hand with scripts/setRoomAdmin.js (rank
//                       alone never gives permissions)
//   DMs                 nobody (a DM call's moderator is whoever started it)
//
// Admins act on members, only the owner acts on admins, nobody on the owner
// (chatController.canActOn).
const ConversationMember = require('../models/ConversationMember');
const { groupRoleOf, isAdminRole, canActOn } = require('../controllers/chatController');

async function roleIn(conversation, userOrId) {
  if (!conversation) return null;
  if (conversation.type === 'group') return groupRoleOf(conversation, userOrId);
  if (conversation.type !== 'community' && conversation.type !== 'faction') return null;
  const userId = userOrId?._id || userOrId;
  const row = await ConversationMember.findOne({ conversation: conversation._id, user: userId }, 'role').lean();
  return isAdminRole(row?.role) ? row.role : 'member';
}

module.exports = { roleIn, isAdminRole, canActOn };
