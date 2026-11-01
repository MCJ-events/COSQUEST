// In-app banners: people with the app open get the `banner` socket event
// (title, text, who, where to open) instead of a push - for chat messages,
// mentions, follows, post activity and scheduled calls - and people with the
// app closed, or in the background with its socket still open (app:state),
// still get the push.
const { io } = require('socket.io-client');
const User = require('../src/models/User');
const push = require('../src/utils/push');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)); }
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitFor(list, predicate, ms = 2000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = list.find(predicate);
      if (found) return found;
      await sleep(25);
    }
    return null;
  }

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const made = await Promise.all(['Ana', 'Ben', 'Cy'].map((name) => User.create({
    profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Banner', avatarKey: 'green-knight' },
    onboardingComplete: true, faction: 'ascendants',
    preferences: { notificationsEnabled: true },
    devices: [{ pushToken: `ExponentPushToken[${name}${suffix}]`, platform: 'ios', authed: true }],
  })));
  const [ana, ben, cy] = made.map((user) => ({ id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion), pushToken: user.devices[0].pushToken }));

  const sent = push.captureForTests();
  const banners = [];
  // Ben has the app open; Cy doesn't.
  const socket = io(baseUrl, { auth: { token: ben.token }, transports: ['websocket'], reconnection: false });
  socket.on('banner', (banner) => banners.push(banner));
  await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  await sleep(200); // presence is marked just after connecting

  try {
    console.log('\n--- in-app banners ---');
    const post = (await request('POST', '/api/posts', ben.token, { type: 'thought', content: 'Banner test' })).data.post;
    await request('POST', `/api/posts/${post.id}/likes`, ana.token);
    const like = await waitFor(banners, (b) => b.data?.type === 'like');
    check(like && like.body === `${ana.username} liked your post.` && like.data.postId === post.id && like.actor?.username === ana.username && like.actor.avatarKey === 'green-knight' && like.id && like.at,
      'app open: a like pops up as an in-app banner (text, who, the post to open)', like);
    await sleep(150);
    check(!sent.some((m) => m.to === ben.pushToken), 'app open: no push on top of the banner', sent.filter((m) => m.to === ben.pushToken));

    const cyPost = (await request('POST', '/api/posts', cy.token, { type: 'thought', content: 'Offline test' })).data.post;
    await request('POST', `/api/posts/${cyPost.id}/likes`, ana.token);
    const toCy = await waitFor(sent, (m) => m.to === cy.pushToken);
    check(toCy && toCy.body === `${ana.username} liked your post.` && toCy.data.postId === cyPost.id, 'app closed: the push still goes', toCy);

    const dm = (await request('POST', '/api/chats/dm', ana.token, { username: ben.username })).data.chat.id;
    await request('POST', `/api/chats/${dm}/messages`, ana.token, { content: 'Meet at the shrine at six' });
    const message = await waitFor(banners, (b) => b.data?.type === 'message');
    check(message && message.title === ana.username && message.body === 'Meet at the shrine at six' && message.data.chatId === dm && message.channel === 'messages' && message.actor?.id === ana.id,
      'a chat message pops up with the sender and the chat to open', message);

    await request('POST', `/api/users/${ben.username}/follow`, cy.token);
    const follow = await waitFor(banners, (b) => b.data?.type === 'follow');
    check(follow && follow.body === `${cy.username} started following you.` && follow.actor?.username === cy.username, 'a follow pops up', follow);

    await request('POST', `/api/posts/${post.id}/comments`, cy.token, { body: 'Nice one' });
    const comment = await waitFor(banners, (b) => b.data?.type === 'comment');
    check(comment && /commented on your post: "Nice one"/.test(comment.body) && comment.data.commentId && comment.data.postId === post.id, 'a comment pops up with the comment to open', comment);

    // Friend activity switched off: no banner for likes either.
    await User.updateOne({ _id: ben.id }, { $set: { 'notificationCategories.friendActivity': false } });
    const before = banners.length;
    await request('POST', `/api/posts/${post.id}/likes`, cy.token);
    await sleep(300);
    check(!banners.slice(before).some((b) => b.data?.type === 'like'), 'a kind switched off in settings doesn\'t pop up', banners.slice(before));
    await User.updateOne({ _id: ben.id }, { $set: { 'notificationCategories.friendActivity': true } });

    console.log('\n--- app in the background, socket still open ---');
    // A locked phone keeps its socket for a while: the app says it went to
    // the background, and messages come as a push (a banner can't show).
    socket.emit('app:state', { active: false });
    await sleep(150);
    sent.length = 0;
    const beforeBackground = banners.length;
    await request('POST', `/api/chats/${dm}/messages`, ana.token, { content: 'Are you coming?' });
    const backgroundPush = await waitFor(sent, (m) => m.to === ben.pushToken && m.data?.type === 'message');
    check(backgroundPush && backgroundPush.body === 'Are you coming?' && !banners.slice(beforeBackground).some((b) => b.data?.type === 'message'),
      'app in the background (socket still open): the message comes as a push, not a banner', { backgroundPush, banners: banners.slice(beforeBackground) });
    socket.emit('app:state', { active: true });
    await sleep(150);
    sent.length = 0;
    await request('POST', `/api/chats/${dm}/messages`, ana.token, { content: 'On my way' });
    const backOnScreen = await waitFor(banners, (b) => b.data?.type === 'message' && b.body === 'On my way');
    await sleep(150);
    check(backOnScreen && !sent.some((m) => m.to === ben.pushToken), 'back on screen: a banner again, no push', { backOnScreen, sent });
    // Connecting while in the background (auth.active false) counts as background.
    const quiet = io(baseUrl, { auth: { token: cy.token, active: false }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => { quiet.on('connect', resolve); quiet.on('connect_error', reject); });
    sent.length = 0;
    await request('POST', `/api/users/${cy.username}/follow`, ana.token);
    const quietPush = await waitFor(sent, (m) => m.to === cy.pushToken && m.data?.type === 'follow');
    check(quietPush, 'connected from the background (auth.active false): a push, not a banner', quietPush);
    quiet.disconnect();
  } finally {
    socket.disconnect();
    push.resetForTests();
  }

  return { pass, fail };
}

module.exports = { run };
