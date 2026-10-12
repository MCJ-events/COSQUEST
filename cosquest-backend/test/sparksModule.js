/**
 * End to end: the REAL server (this repo's Express + Socket.IO + Mongo) with
 * the @cosquest/sparks-backend module mounted, and mock-SDK phones
 * (test/helpers/sparksPhone.js) speaking the real wire protocol with real
 * HPKE over Socket.IO. Fake AI on the phones; everything else is the
 * production path: REST message insert -> seq -> onChatMessage -> trigger
 * gate -> detect job leased to a phone -> sealed input -> result -> Spark ->
 * broadcasts (module `sparks` channel AND the app's old spark:* events) ->
 * the old REST API.
 */
const User = require('../src/models/User');
const Message = require('../src/models/Message');
const { signToken } = require('../src/utils/token');
const sparksHost = require('../src/sparks');
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
  async function waitFor(fn, timeoutMs = 8000) {
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
      profile: { username: `Smod${index}${suffix}`, usernameNormalized: `smod${index}${suffix}`, firstName: 'Smod', lastName: `User${index}`, avatarKey: 'green-knight' },
      onboardingComplete: true,
      faction: 'ascendants',
      expertise,
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  };
  const [a, b, c] = [await make(1, 'front_end'), await make(2, 'design'), await make(3)];
  const phones = [];

  try {
    console.log('\n--- sparks module: devices ---');
    check(sparksHost.isModule() && sparksHost.isReady(), 'the module is loaded and is the default engine');
    // Amara-style phone with the model; Bayo's phone has none (tier none: sees Sparks, does no AI work).
    const pa = await connectPhone(baseUrl, { userId: a.id, token: a.token, tier: 'full' });
    const pb = await connectPhone(baseUrl, { userId: b.id, token: b.token, tier: 'none' });
    phones.push(pa, pb);
    check(pa.registerAck?.ok === true && pa.registered?.payload?.deviceId === pa.deviceId, 'device.register -> device.registered round trip over Socket.IO', pa.registerAck);
    check(typeof pa.registered?.payload?.thresholds?.assignMinScore === 'number', 'device.registered carries the thresholds', pa.registered?.payload);
    const stored = await sparksHost.store.devicesOfUsers([a.id, b.id]);
    check(stored.length === 2 && stored.some((d) => d.deviceId === pb.deviceId && d.tier === 'none'), 'both devices are in sparks_devices', stored.map((d) => d.deviceId));
    const beat = await waitFor(async () => (await sparksHost.store.getDevice(pa.deviceId))?.available === true);
    check(beat === true, 'a heartbeat marks the phone with a model available');

    // Someone else's deviceId cannot be taken over.
    const thief = await connectPhone(baseUrl, { userId: c.id, token: c.token, tier: 'full', deviceId: pa.deviceId });
    phones.push(thief);
    check(thief.registerAck?.error === 'device belongs to another user' && (await sparksHost.store.getDevice(pa.deviceId)).userId === a.id, 'a deviceId registered to another account is refused', thief.registerAck);
    const bad = await pa.socket.timeout(5000).emitWithAck('sparks', { v: 1, type: 'job.ack', id: 'x', ts: 'now', payload: {} });
    check(bad?.error === 'schema', 'a malformed envelope is rejected with an ack error', bad);

    // Sends a message over REST; the author's phone tags it (hint) like the SDK does.
    const say = async (user, phone, chatId, content, extra = {}) => {
      const r = await request('POST', `/api/chats/${chatId}/messages`, user.token, { content, ...extra });
      if (r.status === 201 && phone) await phone.hint(r.data.message, chatId);
      return r;
    };

    console.log('\n--- sparks module: a Spark in a group chat ---');
    const group = await request('POST', '/api/groups', a.token, { name: 'Sparks Module Club', kind: 'private', members: [b.id] });
    const groupId = group.data.group.id;
    await pa.join(groupId);
    await pb.join(groupId);
    const g1 = await say(a, pa, groupId, 'Who is bringing the dragon costume to the meetup?');
    await say(b, pb, groupId, 'I can carry the dragon costume, it needs a new tail');
    await say(a, pa, groupId, 'Great, the dragon costume wings are mine then');
    check(typeof g1.data.message.seq === 'number' && g1.data.message.seq >= 1, 'messages get a per-chat seq at insert', g1.data.message);

    const created = await pb.until(() => [...pb.sparks.values()].find((s) => s.chatId === groupId), 10000, 'group Spark on the tier-none phone').catch(() => null);
    check(created && created.messageCount === 3 && created.createdBy.kind === 'bot' && created.state === 'active', '3 messages from 2 people -> a Spark, broadcast to every member (spark.event)', created);
    // Plaintext input is dropped once the result is applied (the broadcast goes out during apply, so wait for it).
    const detectJob = await waitFor(async () => (await sparksHost.store.jobsByStatus(['done'])).find((j) => j.type === 'spark.detect' && j.chatId === groupId && j.input === null), 3000);
    check(detectJob?.resultMeta?.deviceId === pa.deviceId && detectJob.input === null, 'the detect job ran on the phone with the model (sealed input, cleared after)', detectJob && { ...detectJob, input: Boolean(detectJob.input) });

    const sparkId = created?.sparkId;
    const list = await request('GET', `/api/chats/${groupId}/sparks`, b.token);
    const old = list.data.sparks?.[0];
    check(
      list.status === 200 && old && old.id === sparkId && old.conversationId === groupId && old.active === true && old.startedByBot === true &&
        old.messageCount === 3 && old.participantCount === 2 && old.revived === false && old.eras.length === 1 && typeof old.summary === 'string' &&
        Array.isArray(old.keywords) && old.pinned === false,
      'the old REST API returns it in the old shape',
      list.data
    );
    check(list.data.canManage === false && (await request('GET', `/api/chats/${groupId}/sparks`, a.token)).data.canManage === true, 'canManage: owner yes, member no');
    const legacyEvent = await pb.until(() => pb.legacy.find((e) => e.event === 'spark:updated' && e.payload.spark.id === sparkId), 4000, 'spark:updated').catch(() => null);
    check(legacyEvent && legacyEvent.payload.conversationId === groupId && legacyEvent.payload.spark.messageCount >= 3, 'the old spark:updated socket event still fires (old payload shape)', legacyEvent);
    const tagEvent = pb.legacy.find((e) => e.event === 'spark:messages' && e.payload.sparkId === sparkId);
    check(tagEvent && tagEvent.payload.era === 0 && tagEvent.payload.messageIds.length === 3, 'the old spark:messages event lists the tagged messages', tagEvent);
    const page = await request('GET', `/api/chats/${groupId}/messages`, b.token);
    const tagged = page.data.messages.find((m) => m.id === g1.data.message.id);
    check(tagged?.spark?.id === sparkId && tagged.spark.era === 0 && tagged.spark.postedInSpark === false, 'messages carry the old Spark marker', tagged?.spark);

    const panel = await request('GET', `/api/chats/${groupId}/sparks/${sparkId}`, a.token);
    check(panel.status === 200 && panel.data.messages.length === 3 && panel.data.messages[0].id === g1.data.message.id && Array.isArray(panel.data.seams), 'the side panel lists its messages oldest first', panel.data);
    const native = await request('GET', `/api/chats/${groupId}/sparks/native`, a.token);
    check(native.status === 200 && native.data.sparks[0]?.sparkId === sparkId && native.data.sparks[0].version >= 1, 'GET .../sparks/native returns the module Spark objects', native.data);

    const inside = await say(b, pb, groupId, 'count me in for the tail', { sparkId });
    check(inside.status === 201 && inside.data.message.spark?.id === sparkId && inside.data.message.spark.postedInSpark === true, 'a reply posted inside a Spark joins it right away', inside.data.message?.spark);
    const four = await waitFor(async () => (await request('GET', `/api/chats/${groupId}/sparks`, a.token)).data.sparks[0]?.messageCount === 4);
    check(four === true, 'the panel reply is counted');
    check((await request('POST', `/api/chats/${groupId}/messages`, a.token, { content: 'x', sparkId: 'spk_doesnotexist' })).status === 400, 'replying into a Spark that does not exist is rejected');

    console.log('\n--- sparks module: a Spark in a DM ---');
    const dm = await request('POST', '/api/chats/dm', a.token, { username: b.username });
    const dmId = dm.data.chat.id;
    await say(a, pa, dmId, 'Did you book the hotel for the convention?');
    await say(b, pb, dmId, 'Not yet, the convention hotel is nearly full');
    await say(a, pa, dmId, 'Book the convention hotel tonight please');
    const dmSpark = await pa.until(() => [...pa.sparks.values()].find((s) => s.chatId === dmId), 10000, 'DM Spark').catch(() => null);
    check(dmSpark && dmSpark.messageCount === 3 && dmSpark.participantIds.length === 2, 'a DM gets a Spark too (3 messages, 2 people)', dmSpark);
    const dmList = await request('GET', `/api/chats/${dmId}/sparks`, b.token);
    check(dmList.status === 200 && dmList.data.sparks[0]?.id === dmSpark?.sparkId && dmList.data.canManage === true, 'the old REST API serves DM Sparks (both people manage their DM)', dmList.data);

    console.log('\n--- sparks module: admin tools ---');
    const memberPin = await request('PATCH', `/api/chats/${groupId}/sparks/${sparkId}/pin`, b.token, { pinned: true });
    check(memberPin.status === 403, 'a member cannot pin (403)', memberPin);
    check((await request('DELETE', `/api/chats/${groupId}/sparks/${sparkId}`, b.token)).status === 403, 'a member cannot delete (403)');
    const ownerPin = await request('PATCH', `/api/chats/${groupId}/sparks/${sparkId}/pin`, a.token, { pinned: true });
    check(ownerPin.status === 200 && ownerPin.data.spark.pinned === true && ownerPin.data.spark.id === sparkId, 'the owner pins it (module admin.pin)', ownerPin.data);
    const pinnedEvent = await pb.until(() => pb.frames.find((f) => f.type === 'spark.event' && f.payload.kind === 'pinned' && f.payload.spark.sparkId === sparkId), 4000, 'pinned event').catch(() => null);
    check(Boolean(pinnedEvent), 'members get the pinned spark.event');
    const outsider = await request('GET', `/api/chats/${groupId}/sparks`, c.token);
    check(outsider.status === 403, 'people outside the group cannot list its Sparks', outsider);

    console.log('\n--- sparks module: start by hand and delete ---');
    const seed = await say(b, null, groupId, 'anyone know a good wig stylist downtown');
    const started = await request('POST', `/api/chats/${groupId}/sparks`, b.token, { messageId: seed.data.message.id, subject: 'Wig styling' });
    check(started.status === 201 && started.data.spark.startedByBot === false && started.data.spark.createdBy === b.id && started.data.spark.messageCount === 1, 'a member starts a Spark from a message (REST, no SDK)', started.data);
    const similar = await request('POST', `/api/chats/${groupId}/sparks`, a.token, { messageId: g1.data.message.id, subject: 'Wig styles' });
    check(similar.status === 409 && ['already_in_spark', 'similar_sparks'].includes(similar.data.code), 'duplicates and already-tagged messages are refused (409)', similar.data);
    const removed = await request('DELETE', `/api/chats/${groupId}/sparks/${started.data.spark.id}`, a.token);
    check(removed.status === 200 && removed.data.deleted === true, 'the owner deletes it', removed.data);
    const seedAfter = await Message.findById(seed.data.message.id).lean();
    check(seedAfter.sparkId === null, 'its messages stay in the main chat, unmarked', seedAfter.sparkId);
  } finally {
    for (const p of phones) p.close();
  }
  return { pass, fail };
}

module.exports = { run };
