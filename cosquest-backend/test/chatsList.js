/**
 * GET /api/chats - pins the response shape (keys AND their order, which the
 * shipped iOS / Android / web apps read) and checks the numbers the batched
 * chat list computes against the one-chat paths: member counts (community,
 * faction room, a private group with a ban and a deleted account, a faction
 * group), unread counts (deleted-for-me and my own messages excluded), the
 * last message preview, and GET /api/chats/:id agreeing with the list row.
 */
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const ConversationMember = require('../src/models/ConversationMember');
const Message = require('../src/models/Message');
const { signToken } = require('../src/utils/token');
const { countGroupMembers } = require('../src/controllers/chatController');

const CHAT_KEYS = ['id', 'type', 'factionKey', 'title', 'memberCount', 'otherParticipant', 'messageCount', 'unreadCount', 'sparksMuted', 'lastMessage', 'updatedAt'];
const GROUP_KEYS = ['kind', 'scope', 'description', 'photoUrl', 'myRole', 'muted', 'mutedUntil', 'mutedByAdminUntil', 'slowModeSeconds', 'nextSendAt'];
const LAST_MESSAGE_KEYS = ['senderName', 'preview', 'createdAt'];
const PARTICIPANT_KEYS = ['id', 'username', 'name', 'avatarKey', 'avatarPhotoUrl', 'faction', 'lastActiveAt', 'expertise', 'rank', 'isOnline', 'lastReadAt'];

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;

  function check(ok, name, value) {
    if (ok) {
      pass += 1;
      console.log(`  ok  - ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL - ${name}`, JSON.stringify(value));
    }
  }

  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  const sameKeys = (object, keys) => Boolean(object) && JSON.stringify(Object.keys(object)) === JSON.stringify(keys);

  console.log('\n--- chat list: response shape and counts ---');
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const created = await Promise.all([1, 2, 3, 4, 5].map((index) => User.create({
    profile: {
      username: `List${index}${suffix}`,
      usernameNormalized: `list${index}${suffix}`,
      firstName: 'List',
      lastName: `User${index}`,
      avatarKey: 'green-knight',
    },
    onboardingComplete: true,
    faction: 'celestials',
  })));
  const [a, b, c, d, e] = created.map((user) => ({
    id: user.id,
    username: user.profile.username,
    token: signToken(user.id, user.tokenVersion),
  }));

  // DM: b sends one, a replies, b sends two more; a deletes b's newest for herself.
  const dm = await request('POST', '/api/chats/dm', a.token, { username: b.username });
  const dmId = dm.data.chat.id;
  await request('POST', `/api/chats/${dmId}/messages`, b.token, { content: 'one' });
  await request('POST', `/api/chats/${dmId}/messages`, a.token, { content: 'mine' });
  await request('POST', `/api/chats/${dmId}/messages`, b.token, { content: 'two' });
  const hidden = await request('POST', `/api/chats/${dmId}/messages`, b.token, { content: 'hidden from a' });
  await request('DELETE', `/api/chats/${dmId}/messages/${hidden.data.message.id}?scope=me`, a.token);

  // Private group: a (owner), b, c, d, e; d is banned, e's account is deleted.
  const group = await request('POST', '/api/groups', a.token, {
    name: 'Shape Crew',
    kind: 'private',
    members: [b.id, c.id, d.id, e.id],
  });
  const groupId = group.data.group.id;
  await request('POST', `/api/groups/${groupId}/members/${d.id}/ban`, a.token, {});
  await User.deleteOne({ _id: e.id });
  await request('POST', `/api/chats/${groupId}/messages`, c.token, { content: 'hello crew' });

  // Faction group for celestials (everyone in the faction is pulled in).
  const hq = await request('POST', '/api/groups', a.token, { name: 'Celestials HQ', kind: 'faction' });
  const hqId = hq.data.group.id;

  const list = await request('GET', '/api/chats', a.token);
  check(list.status === 200 && Array.isArray(list.data.chats) && sameKeys(list.data, ['chats']), 'GET /api/chats returns { chats: [...] }', list);
  const chats = list.data.chats || [];
  const byId = new Map(chats.map((chat) => [chat.id, chat]));

  check(chats[0]?.type === 'community' && chats[1]?.type === 'faction', 'community first, then my faction room', chats.map((chat) => chat.type));
  check(
    chats.every((chat) => sameKeys(chat, chat.type === 'group' ? [...CHAT_KEYS, 'group'] : CHAT_KEYS)),
    'every row has exactly the documented keys, in order',
    chats.map((chat) => Object.keys(chat))
  );
  check(
    chats.filter((chat) => chat.type === 'group').every((chat) => sameKeys(chat.group, GROUP_KEYS)),
    'group rows: the group block keys, in order',
    chats.filter((chat) => chat.type === 'group').map((chat) => Object.keys(chat.group))
  );
  check(
    chats.filter((chat) => chat.lastMessage).every((chat) => sameKeys(chat.lastMessage, LAST_MESSAGE_KEYS)),
    'lastMessage keys, in order',
    chats.map((chat) => chat.lastMessage && Object.keys(chat.lastMessage))
  );

  const community = chats[0];
  check(
    community.title === 'Community' && community.factionKey === null && community.otherParticipant === null &&
      community.memberCount === (await User.countDocuments({ onboardingComplete: true })),
    'community: title and member count (every onboarded user)',
    community
  );
  const factionRoom = chats[1];
  check(
    factionRoom.factionKey === 'celestials' && factionRoom.memberCount === (await User.countDocuments({ faction: 'celestials' })),
    'faction room: member count (everyone in the faction)',
    factionRoom
  );

  const dmRow = byId.get(dmId);
  check(Boolean(dmRow) && dmRow.type === 'dm' && dmRow.memberCount === null && dmRow.title === 'List User2', 'DM row: title is the other person\'s name', dmRow);
  check(sameKeys(dmRow?.otherParticipant, PARTICIPANT_KEYS) && dmRow.otherParticipant.id === b.id, 'DM row: otherParticipant keys, in order', dmRow?.otherParticipant);
  // Sending marks the chat read, so only 'two' counts ('hidden from a' is deleted for me).
  check(dmRow?.unreadCount === 1, 'DM unread: the other person\'s messages since I last read, not ones I deleted for myself', dmRow);
  check(
    dmRow?.lastMessage?.preview === 'two' && dmRow.lastMessage.senderName === b.username && dmRow.messageCount === 4,
    'DM last message skips the one I deleted for myself',
    dmRow
  );

  const groupRow = byId.get(groupId);
  check(groupRow?.memberCount === 3, 'private group: banned and deleted accounts are not counted (a, b, c)', groupRow);
  check(groupRow?.group?.myRole === 'owner' && groupRow.group.kind === 'private' && groupRow.unreadCount === 1, 'private group: my role and unread', groupRow);
  check(groupRow?.lastMessage?.preview === 'hello crew' && groupRow.lastMessage.senderName === c.username, 'private group: last message and sender', groupRow?.lastMessage);

  const hqRow = byId.get(hqId);
  const hqConversation = await Conversation.findById(hqId);
  check(
    Boolean(hqRow) && hqRow.factionKey === 'celestials' && hqRow.memberCount === (await countGroupMembers(hqConversation)),
    'faction group: same member count as the one-chat path',
    hqRow
  );

  // The header endpoint builds its row the one-chat way; it must agree.
  for (const id of [community.id, factionRoom.id, dmId, groupId, hqId]) {
    const detail = await request('GET', `/api/chats/${id}`, a.token);
    const { pinnedMessage, onlineCount, ...row } = detail.data.chat || {};
    check(
      detail.status === 200 && sameKeys(detail.data.chat, [...Object.keys(byId.get(id)), 'pinnedMessage', 'onlineCount']) &&
        JSON.stringify(row) === JSON.stringify(byId.get(id)),
      `GET /api/chats/:id matches the list row (${byId.get(id).type})`,
      { detail: detail.data, row: byId.get(id) }
    );
  }

  // Reading clears the unread count.
  await request('PATCH', `/api/chats/${dmId}/read`, a.token);
  const after = await request('GET', '/api/chats', a.token);
  check(after.data.chats.find((chat) => chat.id === dmId)?.unreadCount === 0, 'reading a DM clears its unread count', after.data);

  // Not in the list: a group I left (row without a role).
  await ConversationMember.updateOne({ conversation: groupId, user: a.id }, { $set: { role: null } });
  const left = await request('GET', '/api/chats', a.token);
  check(!left.data.chats.some((chat) => chat.id === groupId), 'a group I am no longer a member of is not listed', left.data.chats.map((chat) => chat.id));
  await ConversationMember.updateOne({ conversation: groupId, user: a.id }, { $set: { role: 'owner' } });

  // Clean up what other suites might count.
  await Message.deleteMany({ conversation: { $in: [dmId, groupId, hqId] } });

  return { pass, fail };
}

module.exports = { run };
