const User = require('../src/models/User');
const { signToken } = require('../src/utils/token');

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

  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const make = async (index, faction) => {
    const user = await User.create({
      profile: {
        username: `Grp${index}${suffix}`,
        usernameNormalized: `grp${index}${suffix}`,
        firstName: 'Grp',
        lastName: `User${index}`,
        avatarKey: 'green-knight',
      },
      onboardingComplete: true,
      faction,
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  };
  const [a, b, c, d] = [
    await make(1, 'ascendants'),
    await make(2, 'ascendants'),
    await make(3, 'ascendants'),
    await make(4, 'everborns'),
  ];

  console.log('\n--- groups: private group ---');
  check((await request('POST', '/api/groups', null, { name: 'x', kind: 'private' })).status === 401, 'creating a group requires authentication');
  check((await request('POST', '/api/groups', a.token, { name: '', kind: 'private' })).status === 400, 'a group needs a name');
  check((await request('POST', '/api/groups', a.token, { name: 'Bad', kind: 'secret' })).status === 400, 'kind must be faction, open or private');

  const created = await request('POST', '/api/groups', a.token, {
    name: 'Night Owls',
    description: 'late chats',
    kind: 'private',
    members: [b.id, 'not-an-id'],
  });
  const groupId = created.data.group?.id;
  check(
    created.status === 201 && created.data.group.myRole === 'owner' && created.data.added.includes(b.id) &&
      created.data.skipped.some((entry) => entry.reason === 'not_found') && created.data.chat.type === 'group',
    'creating a group makes the creator the owner and adds the listed people',
    created
  );
  check(created.data.group.joinMode === 'approval', 'private groups default to admin approval', created.data.group);

  const bChats = await request('GET', '/api/chats', b.token);
  check(bChats.data.chats.some((chat) => chat.id === groupId && chat.title === 'Night Owls'), 'an added person sees the group in their chat list');
  check(!(await request('GET', '/api/chats', c.token)).data.chats.some((chat) => chat.id === groupId), 'people who are not in the group do not see it');
  check((await request('GET', `/api/groups/${groupId}`, c.token)).status === 404, 'a private group is hidden from non-members');
  check((await request('GET', `/api/chats/${groupId}/messages`, c.token)).status === 403, 'non-members cannot read the group chat');

  const sent = await request('POST', `/api/chats/${groupId}/messages`, b.token, { content: 'hello owls', mentions: [a.id] });
  check(sent.status === 201 && sent.data.message.mentions.includes(a.id), 'members can chat and mention each other in a group', sent);
  check((await request('POST', `/api/chats/${groupId}/messages`, c.token, { content: 'let me in' })).status === 403, 'non-members cannot post');

  check((await request('POST', `/api/groups/${groupId}/members`, b.token, { userIds: [c.id] })).status === 403, 'only admins can add people while "who can add" is admins');
  check((await request('PATCH', `/api/groups/${groupId}`, b.token, { name: 'Hijack' })).status === 403, 'only admins can edit the group');
  const renamed = await request('PATCH', `/api/groups/${groupId}`, a.token, { name: 'Night Owls Club', whoCanAdd: 'members' });
  check(renamed.status === 200 && renamed.data.group.name === 'Night Owls Club' && renamed.data.group.whoCanAdd === 'members', 'an admin can edit the group', renamed);

  console.log('\n--- groups: invite link and approval ---');
  const info = await request('GET', `/api/groups/${groupId}`, a.token);
  const code = info.data.group.inviteCode;
  check(typeof code === 'string' && code.length > 6, 'admins get an invite code', info.data.group);
  check((await request('GET', `/api/groups/invite/${code}`, c.token)).data.preview?.name === 'Night Owls Club', 'the invite link shows a preview');
  check((await request('POST', `/api/groups/${groupId}/join`, c.token)).status === 403, 'the Join button is not available for private groups');

  const requested = await request('POST', `/api/groups/invite/${code}/join`, c.token);
  check(requested.status === 202 && requested.data.requested === true, 'joining by link needs approval and is held as a request', requested);
  const requests = await request('GET', `/api/groups/${groupId}/requests`, a.token);
  check(requests.data.requests.length === 1 && requests.data.requests[0].user.id === c.id, 'admins see the pending request', requests);
  check((await request('GET', `/api/groups/${groupId}/requests`, b.token)).status === 403, 'regular members cannot see requests');

  const approved = await request('POST', `/api/groups/${groupId}/requests/${requests.data.requests[0].id}/approve`, a.token);
  check(approved.status === 200 && approved.data.approved === true, 'an admin can approve a request', approved);
  check((await request('GET', `/api/chats/${groupId}/messages`, c.token)).status === 200, 'the approved person can now read the chat');

  const reset = await request('POST', `/api/groups/${groupId}/invite-link/reset`, a.token);
  check(reset.data.inviteCode && reset.data.inviteCode !== code, 'resetting the invite link gives a new code', reset);
  check((await request('GET', `/api/groups/invite/${code}`, d.token)).status === 404, 'the old invite link stops working');

  console.log('\n--- groups: open and faction groups ---');
  const open = await request('POST', '/api/groups', a.token, { name: 'Everyone Welcome', kind: 'open' });
  const openId = open.data.group.id;
  check(open.data.group.joinMode === 'instant', 'open groups let people in instantly by default', open.data.group);
  const found = await request('GET', '/api/groups/discover?search=Everyone', d.token);
  check(found.data.groups.some((group) => group.id === openId), 'open groups can be found by anyone', found);
  const joined = await request('POST', `/api/groups/${openId}/join`, d.token);
  check(joined.status === 200 && joined.data.joined === true, 'the Join button lets people into an open group', joined);
  check(!(await request('GET', '/api/groups/discover?search=Everyone', d.token)).data.groups.some((group) => group.id === openId), 'a group you joined no longer shows in discover');

  check((await request('POST', '/api/groups', a.token, { name: 'Wrong', kind: 'faction', factionKey: 'everborns' })).status === 403, 'you can only create a faction group for your own faction');
  const factionGroup = await request('POST', '/api/groups', a.token, { name: 'Ascendants HQ', kind: 'faction' });
  const factionId = factionGroup.data.group.id;
  const bFactionChats = await request('GET', '/api/chats', b.token);
  check(bFactionChats.data.chats.some((chat) => chat.id === factionId), 'faction group members see it without being added');
  check(!(await request('GET', '/api/chats', d.token)).data.chats.some((chat) => chat.id === factionId), 'people from another faction do not see it');
  const stuck = await request('POST', `/api/groups/${factionId}/leave`, b.token);
  check(stuck.status === 400, 'people in a faction group because of their faction cannot leave it', stuck);
  const muted = await request('PATCH', `/api/groups/${factionId}/mute`, b.token, { muted: true, duration: '8h' });
  check(muted.status === 200 && muted.data.muted === true && muted.data.mutedUntil, 'they can mute it instead', muted);

  console.log('\n--- groups: leaving ---');
  const ownerLeft = await request('POST', `/api/groups/${groupId}/leave`, a.token);
  check(ownerLeft.status === 200 && ownerLeft.data.left === true, 'the owner can leave', ownerLeft);
  const after = await request('GET', `/api/groups/${groupId}`, b.token);
  check(after.data.group?.myRole === 'owner', 'the longest-serving member becomes owner', after);
  check((await request('GET', `/api/chats/${groupId}/messages`, a.token)).status === 403, 'someone who left can no longer read the chat');

  return { pass, fail };
}

module.exports = { run };
