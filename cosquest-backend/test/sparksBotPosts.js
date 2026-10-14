/**
 * Sparks bot posts (module 1.3), end to end on the real server: a phone runs
 * the role pings job, the module posts "Relevant expertise: ..." through
 * ports.postBotMessage, the post is a kind 'sparks_bot' message (seq, live
 * message:new, GET /messages), the module never treats it as conversation,
 * an admin approves / dismisses a suggested ping over REST, and "Earlier
 * context" quotes are filtered per reader.
 */
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/token');
const sparksHost = require('../src/sparks');
const botPosts = require('../src/sparks/botPosts');
const { connectPhone } = require('./helpers/sparksPhone');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) {
      pass += 1;
      console.log(`  ok  - ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500));
    }
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  async function waitFor(fn, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const make = async (index, expertise = null) => {
    const user = await User.create({
      profile: { username: `Sbot${index}${suffix}`, usernameNormalized: `sbot${index}${suffix}`, firstName: 'Sbot', lastName: `User${index}`, avatarKey: 'green-knight' },
      onboardingComplete: true,
      faction: 'ascendants',
      expertise,
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  };
  const [maya, diego, leo] = [await make(1, 'front_end'), await make(2, 'back_end'), await make(3, 'design')];
  const phones = [];

  try {
    console.log('\n--- sparks bot posts: role pings ---');
    const pm = await connectPhone(baseUrl, { userId: maya.id, token: maya.token, tier: 'full' });
    const pd = await connectPhone(baseUrl, { userId: diego.id, token: diego.token, tier: 'none' });
    phones.push(pm, pd);
    await waitFor(async () => (await sparksHost.store.getDevice(pm.deviceId))?.available === true);
    const group = await request('POST', '/api/groups', maya.token, { name: 'Barrio Logan Ascendants', kind: 'private', members: [diego.id, leo.id] });
    const groupId = group.data.group.id;
    await pm.join(groupId);
    await pd.join(groupId);
    const say = async (user, phone, content) => {
      const r = await request('POST', `/api/chats/${groupId}/messages`, user.token, { content });
      if (r.status === 201 && phone) await phone.hint(r.data.message, groupId);
      return r;
    };
    await say(maya, pm, 'Can we add a route preview before Saturday? We need front-end help');
    await say(diego, pd, 'The route preview needs maybe back-end work too');
    await say(maya, pm, 'Great, the route preview it is');

    const botMsg = await waitFor(() => Message.findOne({ conversation: groupId, kind: 'sparks_bot' }).lean(), 12000);
    const post = botMsg?.sparksBot;
    check(botMsg && botMsg.sender === null && typeof botMsg.seq === 'number' && botMsg.content === 'Relevant expertise: Front-end and Back-end.', 'the role pings job -> a sparks_bot message with a seq and the headline', botMsg);
    check(
      post?.kind === 'role_pings' &&
        post.pings.length === 2 &&
        post.pings[0].role === 'Front-end' && post.pings[0].mode === 'automatic' && post.pings[0].status === 'notified' && post.pings[0].userIds[0] === maya.id &&
        post.pings[1].role === 'Back-end' && post.pings[1].mode === 'suggested' && post.pings[1].status === 'pending' && post.pings[1].userIds[0] === diego.id,
      'automatic (0.8) is notified, suggested (0.6) waits for an admin',
      post
    );
    const liveNew = await pd.until(() => pd.legacy.find((e) => e.event === 'message:new' && e.payload.message.kind === 'sparks_bot'), 4000, 'message:new').catch(() => null);
    check(liveNew && liveNew.payload.conversationId === groupId && liveNew.payload.message.sparksBot?.kind === 'role_pings' && liveNew.payload.message.sender?.isBot === true, 'members get it live on message:new', liveNew);
    const mayaPing = await waitFor(() => Notification.findOne({ user: maya.id, type: 'mention', message: /A Spark needs Front-end/ }).lean());
    check(Boolean(mayaPing), 'the automatic ping is a mention notification');
    check(!(await Notification.exists({ user: diego.id, message: /A Spark needs Back-end/ })), 'the suggestion notifies nobody yet');

    const page = await request('GET', `/api/chats/${groupId}/messages`, leo.token);
    const listed = page.data.messages?.find((m) => m.id === String(botMsg?._id));
    check(
      listed && listed.kind === 'sparks_bot' && listed.content === 'Relevant expertise: Front-end and Back-end.' && listed.sender?.isBot === true &&
        listed.sender.name === 'Sparks bot' && listed.sparksBot?.kind === 'role_pings' && listed.seq === botMsg.seq && listed.spark === null,
      'GET /messages serves it with sparksBot and the Sparks bot as sender',
      listed
    );
    check(page.data.messages?.filter((m) => m.kind !== 'sparks_bot').every((m) => !('sparksBot' in m)), 'other messages carry no sparksBot field');
    const row = await sparksHost.store.getMessage(String(botMsg?._id));
    check(row?.kind === 'system' && row.senderId === 'sparks-bot' && row.bot?.kind === 'role_pings', 'the module sees it as a system message from the bot, with its post', row);
    await new Promise((r) => setTimeout(r, 300));
    const after = await Message.findById(botMsg?._id).lean();
    check(after.sparkId === null && after.sparkHintState === 'none', 'the module never sorts or tags it', after);

    console.log('\n--- sparks bot posts: approve / dismiss ---');
    const decide = (user, messageId, body) => request('POST', `/api/chats/${groupId}/sparks/bot-posts/${messageId}/role-pings/decide`, user.token, body);
    const id = String(botMsg?._id);
    check((await decide(diego, id, { role: 'Back-end', decision: 'approve' })).status === 403, 'a member cannot approve (403)');
    check((await decide(maya, id, { role: 'Back-end', decision: 'maybe' })).status === 400, 'a bad decision is refused (400)');
    check((await decide(maya, String(new mongoose.Types.ObjectId()), { role: 'Back-end', decision: 'approve' })).status === 404, 'an unknown post is 404');
    check((await decide(maya, id, { role: 'Design', decision: 'approve' })).status === 404, 'a role that is not a suggestion is 404');
    const ok = await decide(maya, id, { role: 'Back-end', decision: 'approve' });
    const approved = ok.data.post?.pings?.find((p) => p.role === 'Back-end');
    check(ok.status === 200 && approved?.status === 'notified' && approved.decidedBy === maya.id, 'the admin approves: 200 with the updated post', ok.data);
    const diegoPing = await waitFor(() => Notification.findOne({ user: diego.id, type: 'mention', message: /A Spark needs Back-end/ }).lean());
    check(Boolean(diegoPing), 'approving notifies the role now');
    const edited = await pd.until(() => pd.legacy.find((e) => e.event === 'message:edited' && e.payload.message.id === id), 4000, 'message:edited').catch(() => null);
    check(edited?.payload.message.sparksBot?.pings?.[1]?.status === 'notified', 'members get the updated post on message:edited', edited);
    check((await decide(maya, id, { role: 'Back-end', decision: 'approve' })).status === 200, 'approving again is harmless (200)');
    check((await decide(maya, id, { role: 'Back-end', decision: 'dismiss' })).status === 409, 'dismissing after approving is 409');
    const textMsg = (await Message.findOne({ conversation: groupId, kind: 'text' }).lean())._id;
    check((await decide(maya, String(textMsg), { role: 'Back-end', decision: 'approve' })).status === 404, 'a normal message is not a role pings post (404)');

    // A second post with a pending suggestion, dismissed.
    const spark = (await sparksHost.store.sparksOfChat(groupId))[0];
    const second = await botPosts.postBotMessage(groupId, {
      chatId: groupId, senderId: 'sparks-bot', kind: 'system', text: 'Relevant expertise: Design.', sentAt: new Date().toISOString(),
      bot: { kind: 'role_pings', postId: 'bot_test', sparkId: spark.sparkId, revivalIndex: 7, subject: spark.subject, headline: 'Relevant expertise: Design.', pings: [{ role: 'Design', userIds: [leo.id], mode: 'suggested', status: 'pending', confidence: 0.55 }] },
    });
    const dismissed = await decide(maya, second.messageId, { role: 'Design', decision: 'dismiss' });
    check(dismissed.status === 200 && dismissed.data.post.pings[0].status === 'dismissed' && dismissed.data.post.headline === 'Relevant expertise: none.', 'the admin dismisses a suggestion', dismissed.data);
    check(!(await Notification.exists({ user: leo.id, message: /A Spark needs Design/ })), 'dismissing notifies nobody');
    check((await Message.findById(second.messageId).lean()).content === 'Relevant expertise: none.', 'the stored message text follows the post');

    console.log('\n--- sparks bot posts: earlier context, per reader ---');
    const m1 = await say(maya, null, 'Old route plan: start at Chicano Park');
    const m2 = await say(diego, null, 'And preview it on the map first');
    await request('DELETE', `/api/chats/${groupId}/messages/${m2.data.message.id}?scope=me`, leo.token);
    const quote = (m) => ({ messageId: m.id, seq: m.seq, senderId: m.sender.id, sentAt: m.createdAt, text: m.content });
    const earlier = await botPosts.postBotMessage(groupId, {
      chatId: groupId, senderId: 'sparks-bot', kind: 'system', text: 'Earlier context: Saturday route', sentAt: new Date().toISOString(),
      bot: { kind: 'earlier_context', postId: 'bot_e', sparkId: spark.sparkId, revivalIndex: 0, subject: 'Saturday route', headline: 'Earlier context: Saturday route', relatedSparkId: 'spk_old', quotes: [quote(m1.data.message), quote(m2.data.message)], jumpToMessageId: m1.data.message.id, score: 0.93, method: 'embedding' },
    });
    const forMaya = (await request('GET', `/api/chats/${groupId}/messages`, maya.token)).data.messages.find((m) => m.id === earlier.messageId);
    const forLeo = (await request('GET', `/api/chats/${groupId}/messages`, leo.token)).data.messages.find((m) => m.id === earlier.messageId);
    check(forMaya?.sparksBot?.quotes?.length === 2, 'a reader who can read both quoted messages sees both', forMaya?.sparksBot);
    check(forLeo?.sparksBot?.quotes?.length === 1 && forLeo.sparksBot.quotes[0].messageId === m1.data.message.id && forLeo.sparksBot.jumpToMessageId === m1.data.message.id, 'a reader who deleted one for themselves does not get it quoted', forLeo?.sparksBot);
    const single = await request('GET', `/api/chats/${groupId}/messages/${earlier.messageId}`, leo.token);
    check(single.status !== 200 || single.data.message?.sparksBot?.quotes?.length === 1, 'GET one message filters the same way', single.data);
    check((await request('POST', `/api/chats/${groupId}/messages/${earlier.messageId}/forward`, maya.token, { targetConversationId: groupId })).status === 400, 'a bot post cannot be forwarded');
    check((await request('PATCH', `/api/chats/${groupId}/messages/${earlier.messageId}`, maya.token, { content: 'x' })).status === 403, 'nobody can edit a bot post');
  } finally {
    for (const p of phones) p.close();
  }
  return { pass, fail };
}

module.exports = { run };
