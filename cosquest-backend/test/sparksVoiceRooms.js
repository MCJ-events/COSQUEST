/**
 * Sparks in voice chats (Community and faction rooms), on the real server
 * with mock-SDK phones: a voice chat is a Sparks call (id = voiceRoom.id,
 * chat = the room), membership reaches the module batched, consent gates
 * the transcript, the outline is written by members' phones after it closes,
 * then the full transcript (GET /api/calls/:id/transcript) and sharing the
 * outline into the room (POST /api/calls/:id/outline/share).
 *
 * The transcript and share routes need a module with transcript() and
 * shareOutline() (after 1.3.0); with the vendored 1.3.0 they answer 501 and
 * those checks are reported as skipped. The voice chat wiring works with 1.3.0.
 */
const mongoose = require('mongoose');
const User = require('../src/models/User');
const VoiceRoom = require('../src/models/VoiceRoom');
const sparksHost = require('../src/sparks');
const voiceRooms = require('../src/sparks/voiceRooms');
const { flushUpdates } = require('../src/controllers/voiceRoomController')._internal;
const { signToken } = require('../src/utils/token');
const { connectPhone } = require('./helpers/sparksPhone');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  let skipped = 0;
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
  let n = 0;
  const make = async (faction = 'ascendants') => {
    n += 1;
    const user = await User.create({
      profile: { username: `Svr${n}x${suffix}`, usernameNormalized: `svr${n}x${suffix}`, firstName: 'Svr', lastName: `User${n}`, avatarKey: 'green-knight' },
      onboardingComplete: true,
      faction,
    });
    return { id: user.id, token: signToken(user.id, user.tokenVersion) };
  };
  const [a, b, c, e] = [await make(), await make(), await make(), await make()];
  const other = await make('vanguard');
  const phones = [];
  const backend = sparksHost.backend;
  const store = sparksHost.store;
  const grace = backend.config.callEndGraceMs;
  const hasExtras = typeof backend.transcript === 'function' && typeof backend.shareOutline === 'function';
  const skip = (name) => {
    skipped += 1;
    console.log(`  skip - ${name} (module without transcript/shareOutline)`);
  };
  const realMembership = backend.onCallMembership;
  let membershipCalls = 0;

  try {
    console.log('\n--- sparks in voice chats ---');
    const chats = await request('GET', '/api/chats', a.token);
    const faction = chats.data.chats.find((chat) => chat.type === 'faction');
    check(Boolean(faction), 'the faction room is in the chat list', chats.data.chats?.map((x) => x.type));
    const voicePath = `/api/chats/${faction.id}/voice`;

    const pa = await connectPhone(baseUrl, { userId: a.id, token: a.token, tier: 'full' });
    const pb = await connectPhone(baseUrl, { userId: b.id, token: b.token, tier: 'full' });
    phones.push(pa, pb);
    await pa.join(faction.id);

    // 1. Starting the voice chat starts a Sparks call with the room as its chat.
    const started = await request('POST', `${voicePath}/join`, a.token);
    const roomId = started.data.voiceRoom?.id;
    check(started.status === 201 && Boolean(roomId), 'a starts the faction voice chat', started.data);
    const row = await waitFor(async () => store.getCall(roomId));
    check(
      row?.chatId === faction.id && row.status === 'active' && row.attendees.join() === a.id && row.startedBy === a.id,
      'the voice chat is a Sparks call: id = voiceRoom.id, chat = the faction room, attendee a',
      row
    );
    check(Boolean(await waitFor(async () => (await store.jobsOfCall(roomId, 'call.scribe')).length === 1)), 'onCallStarted ran: the call has its scribe job');

    // 2. Membership: b and c join; 30 more join and leave at once - batched, and nobody is lost.
    backend.onCallMembership = (id, users) => {
      membershipCalls += 1;
      return realMembership(id, users);
    };
    await request('POST', `${voicePath}/join`, b.token);
    await request('POST', `${voicePath}/join`, c.token);
    const three = await waitFor(async () => {
      const r = await store.getCall(roomId);
      return r?.attendees.length === 3 && [a.id, b.id, c.id].every((u) => r.attendees.includes(u)) ? r : null;
    });
    check(Boolean(three), 'b and c joining reach the module (onCallMembership)', await store.getCall(roomId));

    const crowd = [];
    for (let i = 0; i < 30; i += 1) crowd.push(await make());
    membershipCalls = 0;
    await Promise.all(crowd.map((p) => request('POST', `${voicePath}/join`, p.token)));
    flushUpdates();
    const full = await waitFor(async () => (await store.getCall(roomId))?.attendees.length === 33);
    const joinCalls = membershipCalls;
    check(Boolean(full) && joinCalls >= 1 && joinCalls <= 4, `30 people joining at once: all 33 reach the module in ${joinCalls} batched update(s)`, joinCalls);
    await Promise.all(crowd.map((p) => request('POST', `/api/voice/${roomId}/leave`, p.token)));
    flushUpdates();
    await voiceRooms._idle();
    const afterCrowd = await waitFor(async () => {
      const r = await store.getCall(roomId);
      return r && r.attendees.length === 3 && crowd.every((p) => r.everAttended.includes(p.id)) ? r : null;
    });
    check(Boolean(afterCrowd), '30 people joining and leaving at once: all recorded as attended, attendees back to 3', await store.getCall(roomId));
    check(membershipCalls <= 8, `60 membership changes reached the module as ${membershipCalls} updates`, membershipCalls);
    backend.onCallMembership = realMembership;

    // 3. Voice commands: nobody is an admin of a faction room, so none here.
    const ctx = await request('GET', `/api/calls/${roomId}/command-context`, a.token);
    check(ctx.status === 200 && ctx.data.canIssue === false && ctx.data.members.length === 0, 'command-context in a voice chat: 200, canIssue false', ctx.data);
    check((await request('GET', `/api/calls/${roomId}/command-context`, other.token)).status === 404, 'command-context: someone not in the voice chat gets 404');

    // 4. Consent: a accepts the notice, b declines; only a's speech is kept and relayed.
    check((await pa.consent(roomId, 'accepted'))?.ok === true && (await pb.consent(roomId, 'declined'))?.ok === true, 'consent decisions for the voice chat are recorded');
    const lines = ['The quest board needs new bounties this week.', 'Dragon quest bounties go up on the quest board tonight.', 'Agreed, raid route skips the north checkpoint.', 'I will post the raid route tonight.'];
    for (let i = 0; i < lines.length; i += 1) await pa.speak(roomId, lines[i], 1000 + i * 2000);
    await pb.speak(roomId, 'This should never be stored.', 2500);
    const stored = await waitFor(async () => ((await store.segments(roomId)).length === 4 ? store.segments(roomId) : null));
    check(Boolean(stored) && stored.every((s) => s.userId === a.id), 'segments: a\'s four lines stored, nothing from b (declined)', (await store.segments(roomId)).map((s) => s.userId));
    const relayed = await waitFor(() => pb.frames.filter((f) => f.type === 'call.segment' && f.payload.segment.callId === roomId).length >= 4);
    check(Boolean(relayed), 'a\'s lines are relayed live to the other people in the voice chat');

    // 5. The transcript while the voice chat runs.
    if (hasExtras) {
      const t = await request('GET', `/api/calls/${roomId}/transcript`, c.token);
      check(
        t.status === 200 && t.data.status === 'active' && t.data.kind === 'voice_room' && t.data.chatId === faction.id && t.data.segments.length === 4 &&
          t.data.segments.every((s, i) => s.userId === a.id && s.text === lines[i] && s.startMs === 1000 + i * 2000 && s.endMs === s.startMs + 1500) &&
          t.data.speakers[a.id]?.name === 'Svr User1',
        'GET transcript (attendee without a phone): every line in order, speaker, times; speaker names; kind voice_room',
        t.data
      );
      const p1 = await request('GET', `/api/calls/${roomId}/transcript?limit=3`, c.token);
      const p2 = await request('GET', `/api/calls/${roomId}/transcript?limit=3&cursor=${encodeURIComponent(p1.data.nextCursor || '')}`, c.token);
      check(
        p1.data.segments.length === 3 && typeof p1.data.nextCursor === 'string' && p2.data.segments.length === 1 && p2.data.nextCursor === null &&
          p2.data.segments[0].segmentId === t.data.segments[3].segmentId,
        'GET transcript pages: limit + nextCursor, no gaps or repeats',
        [p1.data, p2.data]
      );
      check((await request('GET', `/api/calls/${roomId}/transcript`, e.token)).status === 403, 'GET transcript: a faction member who was not in the voice chat gets 403');
      check((await request('GET', `/api/calls/${roomId}/transcript?cursor=junk`, a.token)).status === 400, 'GET transcript: a bad cursor is 400');
      check((await request('GET', `/api/calls/${new mongoose.Types.ObjectId()}/transcript`, a.token)).status === 404, 'GET transcript: unknown id is 404');
      check((await request('POST', `/api/calls/${roomId}/outline/share`, a.token)).status === 409, 'share while the voice chat runs: 409 (no outline yet)');
    } else {
      check((await request('GET', `/api/calls/${roomId}/transcript`, c.token)).status === 501, 'GET transcript with the vendored module: 501');
      skip('transcript and share checks');
    }

    // 6. Everyone leaves: the voice chat closes, the Sparks call ends, members' phones write the outline.
    backend.config.callEndGraceMs = 200;
    for (const p of [a, b, c]) await request('POST', `/api/voice/${roomId}/leave`, p.token);
    flushUpdates();
    const ended = await waitFor(async () => ((await store.getCall(roomId))?.status !== 'active' ? store.getCall(roomId) : null));
    check(Boolean(ended) && ended.endedAt !== null, 'the last person leaving ends the Sparks call', await store.getCall(roomId));
    const outline = await waitFor(async () => {
      await backend.tick();
      const o = await store.getOutline(roomId);
      return o?.status === 'ready' ? o.outline : null;
    }, 20000);
    check(Boolean(outline) && outline.callId === roomId && outline.chatId === faction.id && outline.topics.length >= 1, 'the outline is written by members\' phones after it closes', outline);
    const readOutline = await request('GET', `/api/calls/${roomId}/outline`, b.token);
    check(readOutline.status === 200 && readOutline.data.status === 'ready', 'GET outline for the voice chat: an attendee reads it', readOutline.data);
    check((await request('GET', `/api/calls/${roomId}/outline`, e.token)).status === 403, 'GET outline: a member who was not in it gets 403');

    // 7. Share the outline into the faction room.
    if (hasExtras) {
      check((await request('POST', `/api/calls/${roomId}/outline/share`, e.token)).status === 403, 'share: a member who was not in the voice chat cannot');
      const shared = await request('POST', `/api/calls/${roomId}/outline/share`, b.token);
      const msg = shared.data.message;
      check(
        shared.status === 201 && shared.data.shared === true && msg?.kind === 'sparks_bot' && msg.sparksBot?.kind === 'call_outline' && msg.sparksBot.callId === roomId &&
          msg.sparksBot.callKind === 'voice_room' && msg.sparksBot.headline === `Voice chat outline: ${outline.title}` && msg.sparksBot.sharedBy === b.id &&
          msg.sparksBot.topics.length === outline.topics.length && msg.sender?.isBot === true,
        'share: an attendee posts it into the room as a Sparks bot post (call_outline, voice_room, links to the call)',
        shared.data
      );
      const live = await waitFor(() => pa.legacy.find((ev) => ev.event === 'message:new' && ev.payload.message?.id === msg?.id));
      check(Boolean(live) && live.payload.message.sparksBot?.kind === 'call_outline', 'everyone viewing the room gets it live (message:new)');
      const again = await request('POST', `/api/calls/${roomId}/outline/share`, a.token);
      check(again.status === 200 && again.data.shared === false && again.data.message?.id === msg?.id, 'share again: 200, the same message, nothing new posted', again.data);
      const history = await request('GET', `/api/chats/${faction.id}/messages?limit=50`, e.token);
      const posts = (history.data.messages || []).filter((m) => m.sparksBot?.kind === 'call_outline' && m.sparksBot.callId === roomId);
      check(posts.length === 1 && posts[0].content === msg.sparksBot.headline, 'the room\'s history has the one outline post, readable by every member', history.data.messages?.length);
      const t = await request('GET', `/api/calls/${roomId}/transcript`, a.token);
      check(t.status === 200 && t.data.status === 'ready' && t.data.endedAt !== null && t.data.segments.length === 4, 'GET transcript after the voice chat: still there, status ready', t.data);
    } else {
      check((await request('POST', `/api/calls/${roomId}/outline/share`, b.token)).status === 501, 'share with the vendored module: 501');
    }

    // 8. A voice chat whose people all vanished is closed by the sweep, ending its Sparks call.
    const quiet = await request('POST', `${voicePath}/join`, e.token);
    const quietId = quiet.data.voiceRoom?.id;
    await waitFor(async () => (await store.getCall(quietId))?.status === 'active');
    await VoiceRoom.updateOne({ _id: quietId }, { $set: { 'members.$[].lastSeenAt': new Date(Date.now() - 10 * 60 * 1000) } });
    await voiceRooms.sweep();
    flushUpdates();
    const swept = await waitFor(async () => (await store.getCall(quietId))?.status !== 'active');
    check(Boolean(swept) && (await VoiceRoom.findById(quietId).lean()).active === false, 'the sweep closes a voice chat nobody checked into and ends its Sparks call');

    // 9. Store contract for the two new optional methods (MongoSparksStore).
    const cid = `store_${suffix}`;
    await store.insertCall({ callId: cid, chatId: faction.id, startedAt: Date.now(), endedAt: null, startedBy: a.id, status: 'ready', attendees: [], everAttended: [a.id] });
    const claim = (by, at) => ({ messageId: null, seq: null, sharedBy: by, sharedAt: at });
    const now = Date.now();
    const wins = await Promise.all([1, 2, 3, 4, 5].map((i) => store.claimOutlineShare(cid, claim(`u${i}`, now), now - 60000)));
    check(wins.filter(Boolean).length === 1, 'store.claimOutlineShare: five racing claims, exactly one wins', wins);
    check((await store.claimOutlineShare(cid, claim('late', now + 1000), now - 60000)) === false, 'store.claimOutlineShare: a fresh claim blocks another');
    check((await store.claimOutlineShare(cid, claim('late', now + 1000), now + 1)) === true, 'store.claimOutlineShare: a claim with no post older than staleBefore is taken over');
    await store.patchCall(cid, { outlineShare: { messageId: 'm1', seq: 9, sharedBy: 'late', sharedAt: now } });
    check((await store.claimOutlineShare(cid, claim('x', now + 2000), now + 99999)) === false, 'store.claimOutlineShare: never over a finished share');
    for (const [id, at] of [['b', 500], ['a', 500], ['c', 100], ['d', 900]]) {
      await store.insertSegment({ segmentId: `${cid}_${id}`, callId: cid, userId: a.id, deviceId: 'd', startMs: at, endMs: at + 10, text: id, final: true, locale: 'en', engine: 'moonshine-base', receivedAt: Date.now() });
    }
    const first = await store.segmentsPage(cid, null, 2);
    const rest = await store.segmentsPage(cid, { startMs: first[1].startMs, segmentId: first[1].segmentId }, 10);
    check([...first, ...rest].map((x) => x.text).join('') === 'cabd' && !('_id' in first[0]), 'store.segmentsPage: (startMs, segmentId) order, keyset paging, rows without _id', [...first, ...rest]);

    // 10. Ranks for voice commands ("calling all sergeants"): members carry their faction rank, in the module's spelling.
    const members = require('../src/sparks/members');
    const ladder = members.rankLadder();
    await request('POST', `/api/chats/${faction.id}/messages`, b.token, { content: 'Ranks check from b.' });
    await User.updateOne({ _id: b.id }, { $set: { pointsBalance: 1600 } });
    members.invalidate(faction.id);
    const listed = (await members.chatMembers(faction.id)).find((m) => m.userId === b.id);
    if (!ladder) {
      check(Boolean(listed) && !('rank' in listed), 'without src/utils/ranks.js (wale-pages-backend) members carry no rank', listed);
      skipped += 1;
      console.log('  skip - rank checks (src/utils/ranks.js is not on this branch)');
    } else {
      check(listed?.rank === 'sergeant', 'a member with 1,600 points is listed with rank "sergeant"', listed);
      check(JSON.stringify(backend.config.ranks) === JSON.stringify(ladder) && backend.config.ranks.indexOf(listed?.rank) === ladder.indexOf('sergeant'), 'the module\'s rank order is the faction ladder, so a rank target resolves', backend.config.ranks);
    }
  } catch (error) {
    fail += 1;
    console.log('FAIL - sparks voice chats threw', error);
  } finally {
    backend.onCallMembership = realMembership;
    backend.config.callEndGraceMs = grace;
    for (const p of phones) p.close();
  }
  console.log(`[sparks voice chats] ${pass} passed, ${fail} failed, ${skipped} skipped`);
  return { pass, fail };
}

module.exports = { run };
