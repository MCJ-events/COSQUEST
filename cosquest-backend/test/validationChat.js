// Request validation on the chat routes (src/validators/chat.js): the same
// answers as the controllers gave before, plus the inputs that were never
// checked (numbers where ids belong used to crash with a 500, closesIn could
// name an object property, lists slipped in where text belongs).
const fs = require('fs');
const User = require('../src/models/User');
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
  const is = (r, status, error) => r.status === status && r.data?.error === error;
  const isShape = (r) => typeof r.data?.error === 'string' && Array.isArray(r.data.errors) && r.data.errors.every((e) => 'field' in e && 'location' in e && typeof e.message === 'string');

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const make = async (index) => {
    const user = await User.create({
      profile: { username: `VChat${index}${suffix}`, usernameNormalized: `vchat${index}${suffix}`, firstName: 'Val', lastName: `Chat${index}`, avatarKey: 'green-knight' },
      email: `vchat${index}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants',
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  };
  const [a, b, c] = [await make(1), await make(2), await make(3)];
  const badId = 'not-an-id';
  const missingId = '64b000000000000000000000';

  const group = await request('POST', '/api/groups', a.token, { name: 'Validation Club', kind: 'private', members: [b.id] });
  const groupId = group.data.group?.id;
  const chat = `/api/chats/${groupId}`;
  const first = await request('POST', `${chat}/messages`, a.token, { content: 'First message' });
  const messageId = first.data.message?.id;
  check(group.status === 201 && first.status === 201, 'setup: a group with a message', { group: group.status, first: first.data });

  console.log('\n--- validation (chat): ids in the path ---');
  const noToken = await request('GET', `/api/chats/${badId}`);
  check(noToken.status === 401, 'the login check still comes first (401, not a validation answer)', noToken);
  const badChat = await request('GET', `/api/chats/${badId}/messages`, a.token);
  check(is(badChat, 404, 'Conversation not found.') && isShape(badChat) && badChat.data.errors[0].location === 'params', 'a malformed chat id -> 404 "Conversation not found." (as before), in the shared shape', badChat.data);
  const badMessage = await request('GET', `${chat}/messages/${badId}`, a.token);
  check(is(badMessage, 404, 'Message not found.'), 'a malformed message id -> 404 "Message not found."', badMessage.data);
  const badPoll = await request('POST', `${chat}/messages/${badId}/poll/close`, a.token);
  check(is(badPoll, 404, 'Poll not found.'), 'poll routes keep "Poll not found."', badPoll.data);
  const goodRead = await request('PATCH', `${chat}/read`, a.token);
  check(goodRead.status === 200, 'a good request still works', goodRead);

  console.log('\n--- validation (chat): sending ---');
  const listContent = await request('POST', `${chat}/messages`, a.token, { content: ['hi'] });
  check(is(listContent, 400, 'content must be text.'), 'a list as the message text -> 400', listContent.data);
  const longContent = await request('POST', `${chat}/messages`, a.token, { content: 'x'.repeat(2001) });
  check(is(longContent, 400, 'Message content must be at most 2,000 characters.'), 'too long -> 400 with the same message as before', longContent.data);
  const numberReply = await request('POST', `${chat}/messages`, a.token, { content: 'hi', replyTo: 123 });
  check(is(numberReply, 400, 'replyTo is not a valid message id.'), 'replyTo as a number -> 400 (was a 500)', numberReply.data);
  const numberSpark = await request('POST', `${chat}/messages`, a.token, { content: 'hi', sparkId: 123 });
  check(is(numberSpark, 400, 'That Spark no longer exists.'), 'sparkId must be text (same answer as before)', numberSpark.data);
  const badKind = await request('POST', `${chat}/messages`, a.token, { content: 'hi', kind: 'gif' });
  check(is(badKind, 400, 'kind must be text, image, video, audio, file, or sticker.'), 'kind keeps its message', badKind.data);
  const objectMentions = await request('POST', `${chat}/messages`, a.token, { content: 'hi', mentions: { id: b.id } });
  check(is(objectMentions, 400, 'mentions must be a list of user ids.'), 'mentions as an object -> 400', objectMentions.data);
  const okSend = await request('POST', `${chat}/messages`, a.token, { content: 'Hello @b', replyTo: '', mentions: JSON.stringify([b.id]), mentionsEveryone: 'false' });
  check(okSend.status === 201 && okSend.data.message.mentions?.length === 1, 'empty replyTo, mentions as a JSON string and "false" still work', okSend.data);
  const okReply = await request('POST', `${chat}/messages`, b.token, { content: 'Reply', replyTo: messageId, mentions: [a.id], mentionsEveryone: true });
  check(okReply.status === 201 && okReply.data.message.replyTo?.id === messageId, 'a normal reply with mentions still works', okReply.data);

  const filesBefore = fs.readdirSync(uploadDir).length;
  const form = new FormData();
  form.append('media', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'x.png');
  form.append('replyTo', 'nope');
  const badUpload = await request('POST', `${chat}/messages`, a.token, form);
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(is(badUpload, 400, 'replyTo is not a valid message id.'), 'multipart: rules run after the upload (body fields are read)', badUpload.data);
  check(fs.readdirSync(uploadDir).length === filesBefore, 'multipart: a refused upload leaves no temp file behind', fs.readdirSync(uploadDir).length - filesBefore);
  const albumForm = new FormData();
  albumForm.append('media', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'x.png');
  albumForm.append('content', 'x'.repeat(2001));
  const badAlbum = await request('POST', `${chat}/album`, a.token, albumForm);
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(is(badAlbum, 400, 'The caption must be at most 2,000 characters.') && fs.readdirSync(uploadDir).length === filesBefore, 'album: a too-long caption -> 400, temp files removed', badAlbum.data);

  const outsider = await request('POST', `${chat}/messages`, c.token, { content: 'Let me in' });
  check(outsider.status === 403, 'a well-formed request from a non-member is still 403', outsider);

  console.log('\n--- validation (chat): editing, pins, reactions ---');
  const numberEdit = await request('PATCH', `${chat}/messages/${messageId}`, a.token, { content: 42 });
  check(is(numberEdit, 400, 'content is required.'), 'edit: text that is not text -> "content is required." (as before)', numberEdit.data);
  const okEdit = await request('PATCH', `${chat}/messages/${messageId}`, a.token, { content: 'First message (edited)' });
  check(okEdit.status === 200, 'edit: a good edit still works', okEdit.status);
  const badScope = await request('DELETE', `${chat}/messages/${messageId}?scope=all`, a.token);
  check(is(badScope, 400, 'scope must be me or everyone.'), 'delete: scope keeps its message', badScope.data);
  const numberPin = await request('PATCH', `${chat}/pinned-message`, a.token, { messageId: 123 });
  check(is(numberPin, 400, 'messageId is not valid.'), 'pin: messageId as a number -> 400 (was a 500)', numberPin.data);
  const noPin = await request('PATCH', `${chat}/pinned-message`, a.token, {});
  check(is(noPin, 400, 'messageId is required; use null to unpin.'), 'pin: messageId is required', noPin.data);
  const badDuration = await request('PATCH', `${chat}/pinned-message`, a.token, { messageId, duration: '1y' });
  check(is(badDuration, 400, 'duration must be 24h, 7d, or 30d.'), 'pin: duration keeps its message', badDuration.data);
  const okPin = await request('PATCH', `${chat}/pinned-message`, a.token, { messageId, duration: '24h' });
  check(okPin.status === 200 && okPin.data.pinnedMessage?.id === messageId, 'pin: a good pin still works', okPin.data);
  const unpin = await request('PATCH', `${chat}/pinned-message`, a.token, { messageId: null, duration: 'ignored' });
  check(unpin.status === 200 && unpin.data.pinnedMessage === null, 'unpin: duration is still ignored when unpinning', unpin.data);
  const longEmoji = await request('POST', `${chat}/messages/${messageId}/reactions`, b.token, { emoji: 'x'.repeat(33) });
  check(is(longEmoji, 400, 'emoji is required and must be short.'), 'reaction: emoji keeps its rule', longEmoji.data);
  const okReaction = await request('POST', `${chat}/messages/${messageId}/reactions`, b.token, { emoji: '🔥' });
  check(okReaction.status === 201, 'reaction: a good one still works', okReaction.status);
  const muted = await request('PATCH', `${chat}/notifications`, a.token, { sparksMuted: 'yes' });
  check(is(muted, 400, 'sparksMuted must be true or false.'), 'notifications: sparksMuted must be true/false', muted.data);

  console.log('\n--- validation (chat): DMs and forwarding ---');
  const listName = await request('POST', '/api/chats/dm', a.token, { username: [b.username] });
  check(is(listName, 400, 'username must be text.'), 'dm: a list as the username -> 400 (was read as the name)', listName.data);
  const dm = await request('POST', '/api/chats/dm', a.token, { username: b.username });
  check(dm.status === 200 && dm.data.chat?.type === 'dm', 'dm: a good request still works', dm.data);
  const noOne = await request('POST', '/api/chats/dm', a.token, {});
  check(is(noOne, 404, 'User not found.'), 'dm: no username is still 404 "User not found."', noOne.data);
  const numberTarget = await request('POST', `${chat}/messages/${messageId}/forward`, a.token, { targetConversationId: 123 });
  check(is(numberTarget, 404, 'You do not have access to that conversation.'), 'forward: a number as the target chat -> 404 (was a 500)', numberTarget.data);
  const bothTargets = await request('POST', `${chat}/messages/${messageId}/forward`, a.token, { targetConversationId: dm.data.chat.id, targetUsername: b.username });
  check(is(bothTargets, 400, 'Provide exactly one of targetConversationId or targetUsername.'), 'forward: exactly one target, same message', bothTargets.data);
  const listTarget = await request('POST', `${chat}/messages/${messageId}/forward`, a.token, { targetUsername: [b.username] });
  check(is(listTarget, 400, 'targetUsername must be text.'), 'forward: a list as the username -> 400', listTarget.data);
  const okForward = await request('POST', `${chat}/messages/${messageId}/forward`, a.token, { targetUsername: b.username });
  check(okForward.status === 201 && okForward.data.conversationId === dm.data.chat.id, 'forward: a good forward still works', okForward.data);
  const bulkBad = await request('POST', `${chat}/messages/bulk-delete`, a.token, { messageIds: [123] });
  check(is(bulkBad, 400, 'Provide 1-50 valid messageIds and scope me or everyone.'), 'bulk delete: same message as before', bulkBad.data);
  const bulkBoth = await request('POST', `${chat}/messages/bulk-forward`, a.token, { messageIds: [messageId], targets: [{ targetUsername: b.username }], targetUsername: b.username });
  check(is(bulkBoth, 400, 'Use targets or a single target, not both.'), 'bulk forward: targets or a single target', bulkBoth.data);
  const bulkOk = await request('POST', `${chat}/messages/bulk-forward`, a.token, { messageIds: [messageId], targetConversationId: dm.data.chat.id });
  check(bulkOk.status === 200 && bulkOk.data.summary?.succeeded === 1, 'bulk forward: a single target in the body still works', bulkOk.data);

  console.log('\n--- validation (chat): lists and search ---');
  const twoPages = await request('GET', `${chat}/messages?page=1&page=2`, a.token);
  check(is(twoPages, 400, 'page must be a single value.'), 'page given twice -> 400', twoPages.data);
  const allMessages = await request('GET', `${chat}/messages?limit=all&page=abc`, a.token);
  check(allMessages.status === 200, 'lenient values (limit=all, a bad page) still fall back as before', allMessages.status);
  const listQ = await request('GET', `${chat}/search?q=ab&q=cd`, a.token);
  check(is(listQ, 400, 'Type at least 2 characters to search.'), 'search: q given twice -> the same answer as before', listQ.data);
  const listFrom = await request('GET', `${chat}/search?q=first&from=2026-01-01&from=2026-01-02`, a.token);
  check(is(listFrom, 400, 'from must be a date like 2026-10-01 or 2026-10-01T09:30:00Z.'), 'search: from given twice -> the same answer as before', listFrom.data);
  const badSort = await request('GET', `${chat}/search?q=first&sort=up`, a.token);
  check(is(badSort, 400, 'sort must be newest or oldest.'), 'search: sort keeps its message', badSort.data);
  const okSearch = await request('GET', `${chat}/search?q=first&sort=oldest&from=2020-01-01`, a.token);
  check(okSearch.status === 200 && okSearch.data.results?.length >= 1, 'search: a good search still works', okSearch.data);

  console.log('\n--- validation (chat): polls ---');
  const protoClose = await request('POST', `${chat}/polls`, a.token, { question: 'Q?', options: ['a', 'b'], closesIn: 'toString' });
  check(is(protoClose, 400, 'closesIn must be 1h, 1d or 1w (or left out for no end).'), 'closesIn "toString" -> 400 (was a 500: it named an object property)', protoClose.data);
  const listClose = await request('POST', `${chat}/polls`, a.token, { question: 'Q?', options: ['a', 'b'], closesIn: ['1h'] });
  check(listClose.status === 400, 'closesIn as a list -> 400 (was accepted as "1h")', listClose.data);
  const numberPollReply = await request('POST', `${chat}/polls`, a.token, { question: 'Q?', options: ['a', 'b'], replyTo: 123 });
  check(is(numberPollReply, 400, 'replyTo must reference a message in this conversation.'), 'poll replyTo as a number -> 400 (was a 500)', numberPollReply.data);
  const textOptions = await request('POST', `${chat}/polls`, a.token, { question: 'Q?', options: 'a,b' });
  check(is(textOptions, 400, 'A poll needs 2 to 12 options.'), 'options must be a list, same message as before', textOptions.data);
  const textMultiple = await request('POST', `${chat}/polls`, a.token, { question: 'Q?', options: ['a', 'b'], multiple: 'true' });
  check(is(textMultiple, 400, 'multiple must be true or false.'), 'multiple must be a real true/false (was silently false)', textMultiple.data);
  const okPoll = await request('POST', `${chat}/polls`, a.token, { question: 'Lunch?', options: ['Pizza', 'Tacos', ''], multiple: false, closesIn: '1d', replyTo: messageId });
  const pollId = okPoll.data.message?.id;
  check(okPoll.status === 201 && okPoll.data.message.poll.options.length === 2, 'a good poll still works (blank options still skipped)', okPoll.data);
  const objectVote = await request('POST', `${chat}/messages/${pollId}/vote`, b.token, { optionIds: [{}] });
  check(is(objectVote, 400, 'That option is not in this poll.'), 'vote: only option ids', objectVote.data);
  const okVote = await request('POST', `${chat}/messages/${pollId}/vote`, b.token, { optionIds: ['o1'] });
  check(okVote.status === 200, 'vote: a good vote still works', okVote.status);

  console.log('\n--- validation (chat): Sparks ---');
  const engine = process.env.SPARKS_ENGINE;
  try {
    process.env.SPARKS_ENGINE = 'legacy';
    const numberSeed = await request('POST', `${chat}/sparks`, a.token, { subject: 'Lunch plans', messageId: 123 });
    check(is(numberSeed, 404, 'Message not found.'), 'start a Spark: messageId as a number -> 404 (was a 500)', numberSeed.data);
    const numberInto = await request('POST', `${chat}/sparks/${missingId}/merge`, a.token, { intoSparkId: 123 });
    check(is(numberInto, 404, 'Spark not found.'), 'merge: intoSparkId as a number -> 404 (was a 500)', numberInto.data);
    const textPinned = await request('PATCH', `${chat}/sparks/${missingId}/pin`, a.token, { pinned: 'false' });
    check(is(textPinned, 400, 'pinned must be true or false.'), 'pin a Spark: "false" as text -> 400 (was read as pin)', textPinned.data);
    const okSpark = await request('POST', `${chat}/sparks`, a.token, { subject: 'Lunch plans', messageId, force: true });
    check(okSpark.status === 201, 'start a Spark: a good request still works', okSpark.data);
    const legacyNative = await request('GET', `/api/chats/${badId}/sparks/native`, a.token);
    check(is(legacyNative, 404, 'Not available on the legacy Sparks engine.'), 'module-only routes answer as before on the legacy engine', legacyNative.data);
    const legacyMerge = await request('POST', `${chat}/sparks/merge`, a.token, { sourceSparkIds: 'x' });
    check(legacyMerge.status === 501, 'module-only routes: no rules on the legacy engine (501 as before)', legacyMerge.data);

    process.env.SPARKS_ENGINE = 'module';
    const moduleBadChat = await request('GET', `/api/chats/${badId}/sparks/merge-suggestions`, a.token);
    check(is(moduleBadChat, 404, 'Conversation not found.'), 'module: a malformed chat id -> 404', moduleBadChat.data);
    const moduleMerge = await request('POST', `${chat}/sparks/merge`, a.token, { sourceSparkIds: 'spk_1', intoSparkId: 'spk_2' });
    check(is(moduleMerge, 400, 'Choose the Sparks to merge (sourceSparkIds) and the one to keep (intoSparkId).'), 'module: merge many keeps its message', moduleMerge.data);
    const moduleDecide = await request('POST', `${chat}/sparks/bot-posts/${messageId}/role-pings/decide`, a.token, { role: 'design', decision: 'maybe' });
    check(is(moduleDecide, 400, "Send a role and a decision ('approve' or 'dismiss')."), 'module: role ping decision keeps its message', moduleDecide.data);
    const moduleEra = await request('GET', `${chat}/sparks/spk_x/search?era=-1`, a.token);
    check(is(moduleEra, 400, 'era must be 0 or more.'), 'module: in-Spark search era keeps its message', moduleEra.data);
  } finally {
    if (engine === undefined) delete process.env.SPARKS_ENGINE;
    else process.env.SPARKS_ENGINE = engine;
  }

  console.log(`\nvalidation (chat): ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
