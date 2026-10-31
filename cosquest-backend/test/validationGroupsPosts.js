// Request validation on the groups, posts and small routers (quests,
// factions, spotlight, interests, expertise): the rules in
// src/validators/{groups,posts,misc}.js answer as the controllers did, and
// the inputs the controllers used to take unchecked are refused.
const fs = require('fs');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const { signToken } = require('../src/utils/token');
const { uploadDir } = require('../src/middleware/upload');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
  async function request(method, path, token, body) {
    const form = body instanceof FormData;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  // A validator's answer (with `errors`), or the controller's own (`said`).
  const is = (r, status, error) => r.status === status && r.data?.error === error && Array.isArray(r.data.errors);
  const said = (r, status, error) => r.status === status && r.data?.error === error;
  const stagedFiles = () => fs.readdirSync(uploadDir).length;
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 300); });

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(tag) {
    const user = await User.create({
      profile: { username: `Vg${tag}${suffix}`.slice(0, 20), usernameNormalized: `vg${tag}${suffix}`.slice(0, 20).toLowerCase(), firstName: 'Vg', lastName: tag, avatarKey: 'green-knight' },
      email: `vg_${tag}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants',
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  }
  const owner = await makeUser('a');
  const other = await makeUser('b');
  const badId = 'not-an-id';
  const missingId = '000000000000000000000000';

  console.log('\n--- validation (groups): create ---');
  const people = Array.from({ length: 51 }, (_, i) => `person${i}`);
  check(is(await request('POST', '/api/groups', owner.token, { name: ['Owls'], kind: 'open' }), 400, 'Give the group a name (up to 80 characters).'), 'a list as the name gets the controller\'s message');
  check(is(await request('POST', '/api/groups', owner.token, { name: 'x'.repeat(81), kind: 'open' }), 400, 'Give the group a name (up to 80 characters).'), 'a name over 80 characters is refused');
  check(is(await request('POST', '/api/groups', owner.token, { name: 'Owls', kind: 'secret' }), 400, 'kind must be faction, open or private.'), 'kind keeps its message');
  check(is(await request('POST', '/api/groups', owner.token, { name: 'Owls', kind: 'open', description: { a: 1 } }), 400, 'The description must be text.'), 'a description must be text');
  check(is(await request('POST', '/api/groups', owner.token, { name: 'Owls', kind: 'open', members: [{ id: other.id }] }), 400, 'members must be a list of user ids or usernames.'), 'members must be ids/usernames, not objects');
  check(is(await request('POST', '/api/groups', owner.token, { name: 'Owls', kind: 'open', memberUsernames: people }), 400, 'You can add up to 50 people at a time.'), 'more than 50 people: the controller\'s message');
  const created = await request('POST', '/api/groups', owner.token, { name: 'Vg Owls', kind: 'open', description: null, members: [other.id, 'not-an-id'], sizeLimit: '20' });
  check(created.status === 201 && created.data.added.includes(other.id) && created.data.group.sizeLimit === 20, 'a good create still works (null description, text sizeLimit, unknown ids skipped)', created);
  const groupId = created.data.group?.id;

  const before = stagedFiles();
  const form = new FormData();
  form.append('name', '');
  form.append('kind', 'open');
  form.append('photo', new Blob([Buffer.from('fake image bytes')], { type: 'image/png' }), 'group.png');
  const badForm = await request('POST', '/api/groups', owner.token, form);
  await settle();
  check(is(badForm, 400, 'Give the group a name (up to 80 characters).') && stagedFiles() === before, 'a refused multipart create deletes the staged photo', { badForm, before, after: stagedFiles() });
  const goodForm = new FormData();
  goodForm.append('name', 'Vg Form Group');
  goodForm.append('kind', 'private');
  goodForm.append('members', JSON.stringify([other.id]));
  goodForm.append('sizeLimit', '30');
  const formCreated = await request('POST', '/api/groups', owner.token, goodForm);
  check(formCreated.status === 201 && formCreated.data.added.includes(other.id), 'a multipart create with text fields still works', formCreated);

  console.log('\n--- validation (groups): edit ---');
  const groupPath = `/api/groups/${groupId}`;
  check(is(await request('PATCH', groupPath, owner.token, { name: ['Hijack'] }), 400, 'Give the group a name (up to 80 characters).'), 'edit: a list as the name is refused (it used to be stored)');
  check(is(await request('PATCH', groupPath, owner.token, { description: null }), 400, 'The description must be text.'), 'edit: a null description is refused (it used to be stored as "null")');
  check(is(await request('PATCH', groupPath, owner.token, { sizeLimit: ['300'] }), 400, 'sizeLimit must be a number.'), 'edit: a list as sizeLimit is refused (it used to be read as 300)');
  check(is(await request('PATCH', groupPath, owner.token, { joinMode: 'sometimes' }), 400, 'joinMode must be instant or approval.'), 'edit: joinMode keeps its message');
  check(is(await request('PATCH', groupPath, owner.token, { slowModeSeconds: [30] }), 400, 'slowModeSeconds must be one of: 0, 10, 30, 60, 300, 3600.'), 'edit: a list as slowModeSeconds is refused');
  const edited = await request('PATCH', groupPath, owner.token, { name: 'Vg Owls Club', description: 'nightly', slowModeSeconds: '30', sizeLimit: 40, whoCanAdd: 'members' });
  check(edited.status === 200 && edited.data.group.name === 'Vg Owls Club' && edited.data.group.slowModeSeconds === 30 && edited.data.group.sizeLimit === 40, 'edit: a good request still works', edited);
  const sizeTooSmall = await request('PATCH', groupPath, owner.token, { sizeLimit: 1 });
  check(sizeTooSmall.status === 400 && /^The size limit must be between/.test(sizeTooSmall.data.error), 'edit: the size limit range is still the controller\'s', sizeTooSmall.data);

  console.log('\n--- validation (groups): ids and the rest ---');
  check(is(await request('GET', `/api/groups/${badId}`, owner.token), 404, 'Group not found.'), 'a malformed group id is "Group not found." as before');
  check(is(await request('GET', `/api/groups/${badId}/members`, owner.token), 404, 'Group not found.'), 'same on the members list');
  check(is(await request('GET', `${groupPath}/members?page=1&page=2`, owner.token), 400, 'page must be a single value.'), 'paging values must be single');
  check((await request('GET', `${groupPath}/members?page=abc&limit=5`, owner.token)).status === 200, 'lenient paging is still lenient');
  check(is(await request('GET', '/api/groups/discover?search[]=a', owner.token), 400, 'search must be a single value.'), 'discover: search must be a single value');
  check(is(await request('POST', `${groupPath}/members`, owner.token, { userIds: [{ id: 1 }] }), 400, 'userIds must be a list of user ids or usernames.'), 'add people: ids must be text');
  check(is(await request('POST', `/api/groups/${groupId}/join`, other.token, { message: { text: 'hi' } }), 400, 'message must be text of at most 1,000 characters.'), 'join: the introduction must be text');
  check(is(await request('GET', '/api/groups/invite/bad%20code!', owner.token), 404, 'This invite link is no longer valid.'), 'a malformed invite code is "no longer valid" as before');
  check(is(await request('POST', `${groupPath}/requests/${missingId}/maybe`, owner.token), 404, 'Not found.'), 'an unknown decision is still "Not found."');
  check(is(await request('POST', `${groupPath}/requests/${badId}/approve`, owner.token), 404, 'Request not found.'), 'a malformed request id is "Request not found."');
  check(is(await request('POST', `${groupPath}/members/${badId}/remove`, owner.token), 404, 'Person not found.'), 'a malformed member id is "Person not found."');
  check(is(await request('DELETE', `${groupPath}/bans/${badId}`, owner.token), 404, 'Person not found.'), 'unban: a malformed id is "Person not found."');
  check(is(await request('POST', `${groupPath}/members/${other.id}/role`, owner.token, {}), 400, 'role must be admin or member.'), 'role keeps its message');
  check(is(await request('POST', `${groupPath}/members/${other.id}/ban`, owner.token, { reason: ['spam'] }), 400, 'reason must be text of at most 1,000 characters.'), 'a ban reason must be text');
  const promoted = await request('POST', `${groupPath}/members/${other.id}/role`, owner.token, { role: 'admin' });
  check(promoted.status === 200 && promoted.data.role === 'admin', 'a good role change still works', promoted);
  check((await request('GET', `/api/groups/${badId}`)).status === 401, 'sign-in is still checked first');

  console.log('\n--- validation (posts) ---');
  check(is(await request('POST', '/api/posts', owner.token, { type: ['thought'], content: 'hi' }), 400, 'type must be image, reel, or thought.'), 'a list as the type is refused (it used to be read as "thought")');
  check(is(await request('POST', '/api/posts', owner.token, { content: 'hi' }), 400, 'type must be image, reel, or thought.'), 'a missing type keeps its message');
  check(is(await request('POST', '/api/posts', owner.token, { type: 'thought', content: 5 }), 400, 'content must be text.'), 'content must be text');
  check(is(await request('POST', '/api/posts', owner.token, { type: 'thought', content: '   ' }), 400, 'A thought must contain 1 to 2,000 characters.'), 'an empty thought keeps its message');
  check(is(await request('POST', '/api/posts', owner.token, { type: 'image', content: 'x'.repeat(2201) }), 400, 'Post captions must be at most 2,200 characters.'), 'a long caption keeps its message');
  const thought = await request('POST', '/api/posts', owner.token, { type: ' Thought ', content: 'Validated thought' });
  check(thought.status === 201 && thought.data.post.type === 'thought', 'a good post still works (type is still read loosely)', thought);
  const postId = thought.data.post?.id;

  const beforePost = stagedFiles();
  const postForm = new FormData();
  postForm.append('type', 'gallery');
  postForm.append('content', 'pics');
  postForm.append('media', new Blob([Buffer.from('fake image bytes')], { type: 'image/png' }), 'a.png');
  postForm.append('media', new Blob([Buffer.from('more image bytes')], { type: 'image/png' }), 'b.png');
  const badPost = await request('POST', '/api/posts', owner.token, postForm);
  await settle();
  check(is(badPost, 400, 'type must be image, reel, or thought.') && stagedFiles() === beforePost, 'a refused multipart post deletes its staged files', { badPost, beforePost, after: stagedFiles() });

  check(is(await request('GET', '/api/posts?type=bogus'), 400, 'type must be image, reel, thought, or share.'), 'list: an unknown type keeps its message');
  check(is(await request('GET', '/api/posts?type=thought&type=reel'), 400, 'type must be image, reel, thought, or share.'), 'list: a repeated type is refused with the same message');
  check((await request('GET', '/api/posts?type=&limit=abc')).status === 200, 'list: an empty type and a lenient limit still work');
  check(is(await request('GET', `/api/users/${owner.username}/posts?type=bogus`), 400, 'type must be image, reel, thought, or share.'), 'profile posts: type keeps its message');
  check(is(await request('GET', `/api/users/${'x'.repeat(101)}/posts`), 404, 'Profile not found.'), 'profile posts: an over-long username is "Profile not found."');
  check(is(await request('GET', `/api/posts/${badId}`), 404, 'Post not found.'), 'a malformed post id is "Post not found." as before');
  check(is(await request('GET', `/api/posts/${badId}/share`), 404, 'Post not found.'), 'share link: same');
  check(is(await request('POST', `/api/posts/${badId}/likes`, owner.token), 404, 'Post not found.'), 'likes: same');
  check(is(await request('PATCH', `/api/posts/${postId}`, owner.token, {}), 400, 'content is required.'), 'edit: content is required');
  check(is(await request('PATCH', `/api/posts/${postId}`, owner.token, { content: ['x'] }), 400, 'content is required.'), 'edit: content must be text (same message)');
  check((await request('PATCH', `/api/posts/${postId}`, owner.token, { content: 'Edited' })).status === 200, 'edit: a good request still works');
  check(is(await request('POST', `/api/posts/${postId}/share-to-feed`, other.token, { content: { a: 1 } }), 400, 'Your caption must be text.'), 'share-to-feed: the caption must be text');
  check(is(await request('POST', `/api/posts/${postId}/share-to-feed`, other.token, { content: 'x'.repeat(2201) }), 400, 'Your caption must be at most 2,200 characters.'), 'share-to-feed: the length keeps its message');
  check((await request('POST', `/api/posts/${postId}/share-to-feed`, other.token, { content: null })).status === 201, 'share-to-feed: no caption (null) still works');

  console.log('\n--- validation (post comments) ---');
  const commentsPath = `/api/posts/${postId}/comments`;
  check(is(await request('POST', commentsPath, other.token, { body: ['hi'] }), 400, 'A comment must be text.'), 'a comment body must be text');
  check(is(await request('POST', commentsPath, other.token, { body: 'x'.repeat(501) }), 400, 'A comment must be at most 500 characters.'), 'a long comment keeps its message');
  check(said(await request('POST', commentsPath, other.token, {}), 400, 'A comment needs text or a voice attachment.'), 'an empty comment is still the controller\'s answer');
  check(is(await request('POST', commentsPath, other.token, { body: 'hi', parentComment: badId }), 404, 'Comment not found.'), 'a malformed parentComment is "Comment not found." as before');
  check(is(await request('POST', commentsPath, other.token, { body: 'hi', parentComment: [missingId] }), 404, 'Comment not found.'), 'a list as parentComment is "Comment not found."');
  const comment = await request('POST', commentsPath, other.token, { body: 'Nice', parentComment: '' });
  check(comment.status === 201, 'a good comment still works (empty parentComment = top level)', comment);
  const commentId = comment.data.comment?.id;
  check(is(await request('GET', `${commentsPath}?parentComment=${badId}`), 404, 'Comment not found.'), 'list: a malformed parentComment keeps its answer');
  check((await request('GET', `${commentsPath}?parentComment=${commentId}`)).status === 200, 'list: replies still load');
  check(is(await request('POST', `/api/posts/${badId}/comments/${commentId}/likes`, owner.token), 404, 'Comment not found.'), 'comment likes: a malformed post id is "Comment not found." as before');
  check(is(await request('DELETE', `${commentsPath}/${badId}`, other.token), 404, 'Comment not found.'), 'delete: a malformed comment id is "Comment not found."');
  check((await request('POST', `${commentsPath}/${commentId}/likes`, owner.token)).status === 200, 'liking a comment still works');

  console.log('\n--- validation (quests, factions, spotlight, interests, expertise) ---');
  const quest = await Quest.create({
    slug: `vg-quest-${suffix}`, title: 'Vg Quest', status: 'upcoming', isPublished: true,
    startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000),
    location: { name: 'Hall', lat: 6.5, lng: 3.3 }, prizePool: { amount: 0 }, entryFee: { amount: 0 }, maxParticipants: 10,
  });
  check(is(await request('GET', `/api/quests/${badId}`), 404, 'Quest not found.'), 'a malformed quest id is "Quest not found." (it was a 500)');
  check(is(await request('POST', `/api/quests/${badId}/registrations`, owner.token), 409, 'This quest is unavailable or already full.'), 'register: a malformed id answers as an unknown quest (it was a 500)');
  check(is(await request('DELETE', `/api/quests/${badId}/registrations`, owner.token), 404, 'Active quest registration not found.'), 'cancel: a malformed id answers as an unknown quest (it was a 500)');
  check((await request('GET', `/api/quests/${quest.id}`)).status === 200, 'a good quest id still works');
  check(is(await request('GET', '/api/quests?status[a]=b'), 400, 'status must be a single value.'), 'quests: status must be a single value (an object was a 500)');
  check(is(await request('GET', '/api/quests?lat=1&lat=2&lng=3'), 400, 'lat, lng, and radiusMiles must be valid numbers.'), 'quests: a repeated lat gets the controller\'s message');
  check(said(await request('GET', '/api/quests?lat=abc&lng=3'), 400, 'lat, lng, and radiusMiles must be valid numbers.'), 'quests: a bad lat is still the controller\'s answer');
  const quests = await request('GET', '/api/quests?lat=6.5&lng=3.3&radiusMiles=30&status=upcoming&limit=5');
  check(quests.status === 200 && quests.data.quests.some((item) => item.id === quest.id), 'quests: a good list request still works', quests);
  check(is(await request('GET', '/api/factions/nobody/members'), 404, 'Faction not found.'), 'faction members: an unknown key keeps its answer');
  check((await request('GET', '/api/factions/ascendants/members?limit=2')).status === 200, 'faction members: a good request still works');
  check(is(await request('POST', '/api/users/me/faction', owner.token, {}), 400, 'factionKey must be one of the values from GET /api/factions.'), 'set faction: missing key keeps its message');
  check((await request('POST', '/api/users/me/faction', owner.token, { factionKey: 'ascendants' })).status === 200, 'set faction: a good request still works');
  check(is(await request('GET', '/api/spotlight/leaderboard?page=1&page=2', owner.token), 400, 'page must be 1-1000 and limit must be 1-100.'), 'leaderboard: a repeated page is refused (it was read as the first)');
  check(is(await request('GET', '/api/spotlight/leaderboard?limit=101', owner.token), 400, 'page must be 1-1000 and limit must be 1-100.'), 'leaderboard: limit range keeps its message');
  check(is(await request('GET', '/api/spotlight/leaderboard?interest=bogus', owner.token), 400, 'Unknown interest. See GET /api/interests.'), 'leaderboard: interest keeps its message');
  check((await request('GET', '/api/spotlight/leaderboard?interest=anime&page=&limit=10', owner.token)).status === 200, 'leaderboard: a good request still works');
  check(is(await request('PUT', '/api/users/me/interests', owner.token, { interests: 'anime' }), 400, 'interests must be an array of interest keys.'), 'interests: must be a list');
  check(is(await request('PUT', '/api/users/me/interests', owner.token, { interests: ['anime', 'bogus'] }), 400, 'Unknown interest key(s): bogus'), 'interests: unknown keys keep their message');
  check((await request('PUT', '/api/users/me/interests', owner.token, { interests: ['anime', 'comic'] })).status === 200, 'interests: a good request still works');
  check(is(await request('PATCH', '/api/expertise/me', owner.token, {}), 400, 'Send expertise: a role key, or null to clear it.'), 'expertise: must be sent');
  check(is(await request('PATCH', '/api/expertise/me', owner.token, { expertise: ['front_end'] }), 400, 'Choose one of the listed expertise roles.'), 'expertise: must be a listed role');
  check((await request('PATCH', '/api/expertise/me', owner.token, { expertise: 'front_end' })).status === 200, 'expertise: setting still works');
  check((await request('PATCH', '/api/expertise/me', owner.token, { expertise: null })).status === 200, 'expertise: clearing with null still works');

  console.log(`\nvalidationGroupsPosts: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
