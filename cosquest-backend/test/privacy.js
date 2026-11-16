// Privacy that really works: Public / Friends / Private (src/utils/privacy.js).
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const Follow = require('../src/models/Follow');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  async function makeUser(name, visibility = 'public', extra = {}) {
    const user = await User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight' },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants',
      privacy: { profileVisibility: visibility, ...extra },
    });
    return { user, token: signToken(user.id, user.tokenVersion), name: user.profile.username };
  }
  const viewer = await makeUser('PvViewer');
  const friend = await makeUser('PvFriend', 'friends');
  const stranger = await makeUser('PvStrange', 'friends');
  const secret = await makeUser('PvSecret', 'private');
  const open = await makeUser('PvOpen', 'public', { allowFriendRequests: false });
  await Follow.create([{ follower: viewer.user._id, following: friend.user._id }, { follower: friend.user._id, following: viewer.user._id }]);
  const post = async (who, content) => Post.create({ author: who.user._id, type: 'thought', content: `${content} ${suffix}` });
  const friendPost = await post(friend, 'friend post');
  const strangerPost = await post(stranger, 'stranger post');
  const secretPost = await post(secret, 'secret post');
  const openPost = await post(open, 'open post');

  console.log('\n--- the feed ---');
  const feed = await request('GET', '/api/posts?limit=50', viewer.token);
  const ids = new Set((feed.data.posts || []).map((p) => p.id));
  check(ids.has(String(friendPost._id)) && ids.has(String(openPost._id)), 'a friend\'s friends-only post and a public post are in the feed', feed.data);
  check(!ids.has(String(strangerPost._id)) && !ids.has(String(secretPost._id)), 'a non-friend\'s friends-only post and a private post are not', [...ids]);
  const ownFeed = await request('GET', '/api/posts?limit=50', secret.token);
  check((ownFeed.data.posts || []).some((p) => p.id === String(secretPost._id)), 'a private account still sees their own post', null);

  console.log('\n--- single posts, comments, likes, sharing ---');
  check((await request('GET', `/api/posts/${strangerPost._id}`, viewer.token)).status === 404, "a non-friend's friends-only post: not found", null);
  check((await request('GET', `/api/posts/${friendPost._id}`, viewer.token)).status === 200, "a friend's post: shown", null);
  check((await request('GET', `/api/posts/${secretPost._id}`)).status === 404, 'a private post, signed out: not found', null);
  check((await request('GET', `/api/posts/${strangerPost._id}/comments`, viewer.token)).status === 404, '...nor its comments', null);
  check((await request('POST', `/api/posts/${strangerPost._id}/likes`, viewer.token)).status === 404, '...nor a like', null);
  const reshare = await request('POST', `/api/posts/${friendPost._id}/share-to-feed`, viewer.token, {});
  check(reshare.status === 403 && reshare.data.code === 'not_public', "a friend's friends-only post can't be shared to the feed", reshare.data);
  const share = await request('POST', `/api/posts/${openPost._id}/share-to-feed`, viewer.token, {});
  check(share.status === 201, 'a public post can be shared', share.data);

  console.log('\n--- search, follows ---');
  const found = await request('GET', `/api/users/search?search=Pv`, viewer.token);
  const names = (found.data.users || []).map((u) => u.username);
  check(names.includes(friend.name) && !names.includes(secret.name), 'a private account is not in search', names);
  const follow = await request('POST', `/api/users/${open.name}/follow`, viewer.token);
  check(follow.status === 403 && follow.data.code === 'not_accepting_followers', '"Allow new followers" off: no new followers', follow.data);

  console.log('\n--- messages ---');
  check((await request('POST', '/api/chats/dm', viewer.token, { username: friend.name })).status === 200, 'message a friends-only friend: allowed', null);
  const noFriend = await request('POST', '/api/chats/dm', viewer.token, { username: stranger.name });
  check(noFriend.status === 403, 'message a friends-only non-friend: refused', noFriend.data);
  const noChat = await request('POST', '/api/chats/dm', viewer.token, { username: secret.name });
  check(noChat.status === 403, 'start a chat with a private account: refused', noChat.data);
  check((await request('POST', '/api/chats/dm', viewer.token, { username: open.name })).status === 200, 'message a public account: allowed', null);
  check(noFriend.data?.code === 'friends_only' && noChat.data?.code === 'private_account', 'the app is told why (friends_only, private_account)', { noFriend: noFriend.data, noChat: noChat.data });

  console.log('\n--- chats from before, last seen, calls ---');
  // Chats started while both were public; then they changed their privacy.
  const setVisibility = (who, visibility) => User.updateOne({ _id: who.user._id }, { $set: { 'privacy.profileVisibility': visibility } });
  await setVisibility(secret, 'public');
  await setVisibility(stranger, 'public');
  const secretChat = (await request('POST', '/api/chats/dm', viewer.token, { username: secret.name })).data.chat.id;
  const strangerChat = (await request('POST', '/api/chats/dm', viewer.token, { username: stranger.name })).data.chat.id;
  await setVisibility(secret, 'private');
  await setVisibility(stranger, 'friends');
  await User.updateMany({ _id: { $in: [secret.user._id, friend.user._id] } }, { $set: { lastActiveAt: new Date(Date.now() - 5 * 60e3) } });
  const friendChat = (await request('POST', '/api/chats/dm', viewer.token, { username: friend.name })).data.chat.id;
  const chats = (await request('GET', '/api/chats', viewer.token)).data.chats || [];
  const other = (chatId) => chats.find((c) => c.id === chatId)?.otherParticipant;
  check(other(secretChat) && other(secretChat).lastActiveAt === null && other(friendChat)?.lastActiveAt,
    "last seen: a private account's is hidden, a friend's (Friends) is shown to them", { secret: other(secretChat), friend: other(friendChat) });
  const reply = await request('POST', `/api/chats/${secretChat}/messages`, secret.token, { content: 'Still here' });
  const messages = (await request('GET', `/api/chats/${secretChat}/messages`, viewer.token)).data.messages || [];
  const fromSecret = messages.find((m) => m.sender?.id === secret.user.id);
  check(reply.status === 201 && fromSecret && fromSecret.sender.lastActiveAt === null,
    "a private account can still reply in an existing chat, and its messages don't carry its last seen", { reply: reply.status, sender: fromSecret?.sender });
  const call = await request('POST', `/api/chats/${strangerChat}/calls`, viewer.token, { type: 'audio' });
  check(call.status === 403 && call.data.code === 'friends_only', 'calls follow the messages rule (a Friends account: friends only)', call.data);

  console.log(`\nprivacy: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
