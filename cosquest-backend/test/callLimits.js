// Call and voice-chat size limits (env-driven), calls bigger than the old
// 8-person cap, and coalesced live updates.
const { io } = require('socket.io-client');
const User = require('../src/models/User');
const Call = require('../src/models/Call');
const VoiceRoom = require('../src/models/VoiceRoom');
const limits = require('../src/config/callLimits');
const { createCoalescer } = require('../src/utils/coalescer');
const { signToken } = require('../src/utils/token');

const ENV_KEYS = [
  'CALL_MAX_IN_CALL',
  'CALL_MAX_EVER_INVITED',
  'CALL_MAX_INVITES_PER_REQUEST',
  'VOICE_ROOM_MAX_MEMBERS',
  'CALL_BROADCAST_INTERVAL_MS',
  'CALL_BROADCAST_MS_PER_MEMBER',
];

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;

  function check(ok, name, value) {
    if (ok) {
      pass += 1;
      console.log(`  ok  - ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 2000));
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  let userCounter = 0;
  async function makeUsers(count) {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const users = await User.insertMany(
      Array.from({ length: count }, () => {
        userCounter += 1;
        return {
          profile: {
            username: `Big${userCounter}x${suffix}`,
            usernameNormalized: `big${userCounter}x${suffix}`,
            firstName: 'Big',
            lastName: `Caller${userCounter}`,
            avatarKey: 'green-knight',
          },
          onboardingComplete: true,
          faction: 'ascendants',
        };
      })
    );
    return users.map((user) => ({
      id: String(user._id),
      username: user.profile.username,
      token: signToken(String(user._id), user.tokenVersion),
    }));
  }

  async function startCall(caller, recipient) {
    const dm = await request('POST', '/api/chats/dm', caller.token, { username: recipient.username });
    const started = await request('POST', `/api/chats/${dm.data.chat.id}/calls`, caller.token, { type: 'audio' });
    await request('POST', `/api/calls/${started.data.call.id}/accept`, recipient.token);
    return started.data.call.id;
  }

  async function endForEveryone(callId, people) {
    for (const person of people) await request('POST', `/api/calls/${callId}/end`, person.token);
  }

  function withEnv(values, fn) {
    const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    Object.assign(process.env, values);
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        for (const key of ENV_KEYS) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      });
  }

  console.log('\n--- call limits (env) ---');

  await withEnv({}, () => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    check(
      limits.maxInCall() === 1000 && limits.maxEverInvited() === 5000 && limits.maxInvitesPerRequest() === 50 &&
        limits.voiceRoomMaxMembers() === 1000,
      'defaults: 1000 in a call, 5000 ever invited, 50 per invite, 1000 in a voice chat'
    );
    check(
      limits.broadcastIntervalMs(10) === 250 && limits.broadcastIntervalMs(500) === 1000 && limits.broadcastIntervalMs(1000) === 2000,
      'live updates: every 250 ms for small calls, 2 ms per person for big ones'
    );
    check(Call.MAX_IN_CALL === 1000 && VoiceRoom.MAX_MEMBERS === 1000, 'the old model constants follow the env limits');
  });
  await withEnv({ CALL_MAX_IN_CALL: '12', CALL_MAX_INVITES_PER_REQUEST: '3', VOICE_ROOM_MAX_MEMBERS: '7' }, () => {
    check(
      limits.maxInCall() === 12 && limits.maxInvitesPerRequest() === 3 && limits.voiceRoomMaxMembers() === 7 && Call.MAX_IN_CALL === 12,
      'limits are read from env'
    );
  });
  await withEnv({ CALL_MAX_IN_CALL: 'lots', CALL_MAX_EVER_INVITED: '1', CALL_MAX_INVITES_PER_REQUEST: '0' }, () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      check(
        limits.maxInCall() === 1000 && limits.maxEverInvited() === 5000 && limits.maxInvitesPerRequest() === 50,
        'invalid values (not a number, a call of 1, zero per invite) fall back to the defaults'
      );
    } finally {
      console.warn = warn;
    }
  });

  // A call capped at 3 through env.
  await withEnv({ CALL_MAX_IN_CALL: '3' }, async () => {
    const [a, b, c, d] = await makeUsers(4);
    const callId = await startCall(a, b);
    const invited = await request('POST', `/api/calls/${callId}/invite`, a.token, { userIds: [c.id, d.id] });
    check(
      invited.status === 200 && invited.data.invited.length === 1 &&
        invited.data.skipped.some((entry) => entry.reason === 'call_full') && invited.data.call.maxParticipants === 3,
      'CALL_MAX_IN_CALL=3: a third person is rung, a fourth is skipped as call_full, and the app is told the cap',
      invited
    );
    await request('POST', `/api/calls/${callId}/accept`, c.token);
    await request('POST', `/api/calls/${callId}/end`, b.token);
    const back = await request('POST', `/api/calls/${callId}/invite`, a.token, { userIds: [d.id] });
    await request('POST', `/api/calls/${callId}/accept`, d.token);
    const rejoin = await request('POST', `/api/calls/${callId}/join`, b.token);
    check(
      back.status === 200 && rejoin.status === 409 && /full \(3 people\)/.test(rejoin.data.error),
      'CALL_MAX_IN_CALL=3: rejoining a full call is refused with the configured number',
      { back, rejoin }
    );
    await endForEveryone(callId, [a, c, d]);
  });

  await withEnv({ CALL_MAX_INVITES_PER_REQUEST: '2' }, async () => {
    const [a, b, c, d, e] = await makeUsers(5);
    const callId = await startCall(a, b);
    const tooMany = await request('POST', `/api/calls/${callId}/invite`, a.token, { userIds: [c.id, d.id, e.id] });
    check(
      tooMany.status === 400 && tooMany.data.error === 'You can add up to 2 people at a time.',
      'CALL_MAX_INVITES_PER_REQUEST=2: a request adding three is refused with the configured number',
      tooMany
    );
    const call = await request('GET', `/api/calls/${callId}`, a.token);
    check(call.data.call.maxInvitesPerRequest === 2, 'the call payload carries maxInvitesPerRequest', call.data.call);
    await endForEveryone(callId, [a, b]);
  });

  await withEnv({ CALL_MAX_EVER_INVITED: '3' }, async () => {
    const [a, b, c, d] = await makeUsers(4);
    const callId = await startCall(a, b);
    await request('POST', `/api/calls/${callId}/invite`, a.token, { userIds: [c.id] });
    await request('POST', `/api/calls/${callId}/decline`, c.token);
    const fourth = await request('POST', `/api/calls/${callId}/invite`, a.token, { userIds: [d.id] });
    const again = await request('POST', `/api/calls/${callId}/invite`, a.token, { userIds: [c.id] });
    check(
      fourth.status === 409 && fourth.data.skipped.some((entry) => entry.userId === d.id && entry.reason === 'call_full') &&
        again.status === 200 && again.data.invited.includes(c.id),
      'CALL_MAX_EVER_INVITED=3: a 4th new person is skipped as call_full (not a server error); someone already in it can be re-invited',
      { fourth, again }
    );
    await request('POST', `/api/calls/${callId}/decline`, c.token);
    await endForEveryone(callId, [a, b]);
  });

  console.log('\n--- calls bigger than 8 ---');
  {
    const people = await makeUsers(14);
    const [host, first, ...rest] = people;

    // Two people watch the live updates.
    const watchers = await Promise.all([host, first].map((person) => new Promise((resolve, reject) => {
      const socket = io(baseUrl, { auth: { token: person.token }, transports: ['websocket'], reconnection: false });
      const updates = [];
      socket.on('call:updated', (payload) => updates.push(payload.call));
      socket.once('connect', () => resolve({ socket, updates }));
      socket.once('connect_error', reject);
    })));
    const incoming = [];
    const ringSockets = await Promise.all(rest.map((person) => new Promise((resolve, reject) => {
      const socket = io(baseUrl, { auth: { token: person.token }, transports: ['websocket'], reconnection: false });
      socket.on('call:incoming', (payload) => incoming.push({ to: person.id, call: payload.call }));
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    })));

    const callId = await startCall(host, first);
    await sleep(400); // let the start/answer updates go out before counting
    watchers.forEach((watcher) => watcher.updates.splice(0));

    const invited = await request('POST', `/api/calls/${callId}/invite`, host.token, { userIds: rest.map((p) => p.id) });
    check(
      invited.status === 200 && invited.data.invited.length === 12 && invited.data.skipped.length === 0 &&
        invited.data.call.maxParticipants === 1000 && invited.data.call.maxInvitesPerRequest === 50,
      'twelve people are added to a call in one request (14 ringing or in it)',
      invited.data
    );
    await sleep(100);
    check(
      incoming.length === 12 && new Set(incoming.map((ring) => ring.to)).size === 12 &&
        incoming.every((ring) => ring.call.id === callId),
      'each of the twelve is rung once',
      incoming.length
    );

    const accepts = await Promise.all(rest.map((person) => request('POST', `/api/calls/${callId}/accept`, person.token)));
    check(
      accepts.every((accept) => accept.status === 200 && typeof accept.data.token === 'string'),
      'all twelve answer at the same moment without "changed too quickly" errors',
      accepts.map((accept) => accept.status)
    );

    const call = await request('GET', `/api/calls/${callId}`, host.token);
    const joined = call.data.call.members.filter((member) => member.status === 'joined').length;
    check(joined === 14 && call.data.call.status === 'accepted', '14 people are in the call at once', joined);
    const saved = await Call.findById(callId).select('+active activeMembers');
    check(saved.activeMembers.length === 14 && saved.active === true, 'the stored call agrees: 14 active members', saved.activeMembers.length);

    // Coalescing: 12 answers (plus the invite) were 13 changes; each watcher
    // gets far fewer updates, and the last one is the full, latest state.
    await sleep(limits.broadcastIntervalMs(14) + 300);
    const [hostUpdates, firstUpdates] = watchers.map((watcher) => watcher.updates);
    const last = hostUpdates[hostUpdates.length - 1];
    check(
      hostUpdates.length >= 1 && hostUpdates.length <= 4 && firstUpdates.length === hostUpdates.length,
      `13 changes reach each person as ${hostUpdates.length} coalesced update(s)`,
      hostUpdates.map((update) => update.members.filter((m) => m.status === 'joined').length)
    );
    check(
      last && last.members.filter((member) => member.status === 'joined').length === 14,
      'the last update carries the latest state (everyone joined)',
      last?.members?.map((m) => m.status)
    );

    // Leave and rejoin past 8.
    const left = await request('POST', `/api/calls/${callId}/end`, rest[0].token);
    const back = await request('POST', `/api/calls/${callId}/join`, rest[0].token);
    check(
      left.data.call.status === 'accepted' && back.status === 200 && typeof back.data.token === 'string',
      'someone can leave and rejoin a 14-person call',
      back.data
    );

    // Ending: the final update is sent straight away, not held back.
    watchers.forEach((watcher) => watcher.updates.splice(0));
    await Promise.all(people.slice(1).map((person) => request('POST', `/api/calls/${callId}/end`, person.token)));
    const ended = await request('POST', `/api/calls/${callId}/end`, host.token);
    await sleep(100);
    const lastAfterEnd = watchers[0].updates[watchers[0].updates.length - 1];
    check(
      ended.data.call.status === 'ended' && lastAfterEnd?.status === 'ended',
      'the call ending is sent at once',
      lastAfterEnd?.status
    );

    [...watchers.map((watcher) => watcher.socket), ...ringSockets].forEach((socket) => socket.close());
  }

  console.log('\n--- coalescer ---');
  {
    const sent = [];
    const updates = createCoalescer({ interval: () => 60, send: (key, value) => sent.push([key, value]) });
    updates.push('a', 1);
    updates.push('a', 2);
    updates.push('a', 3);
    updates.push('b', 1);
    check(sent.length === 2 && sent[0][1] === 1 && sent[1][0] === 'b', 'the first change for each key goes out at once');
    await sleep(90);
    check(sent.length === 3 && sent[2][0] === 'a' && sent[2][1] === 3, 'changes inside the interval are merged into one, the latest');
    updates.push('a', 4);
    updates.push('a', 5, { immediate: true });
    check(sent.length === 4 && sent[3][1] === 5, '"immediate" skips the wait and sends the latest');
    await sleep(150);
    check(sent.length === 4 && updates.pending() === 0, 'nothing more is sent, and idle keys are forgotten');
  }

  console.log('\n--- big voice chats ---');
  {
    const chats = await request('GET', '/api/chats', (await makeUsers(1))[0].token);
    const community = chats.data.chats.find((chat) => chat.type === 'community');
    const voicePath = `/api/chats/${community.id}/voice`;

    await withEnv({ VOICE_ROOM_MAX_MEMBERS: '3' }, async () => {
      const people = await makeUsers(6);
      const first = await request('POST', `${voicePath}/join`, people[0].token);
      const rest = await Promise.all(people.slice(1).map((person) => request('POST', `${voicePath}/join`, person.token)));
      const okCount = rest.filter((r) => r.status === 200).length;
      const full = rest.filter((r) => r.status === 409);
      const room = await VoiceRoom.findById(first.data.voiceRoom.id).lean();
      check(
        first.status === 201 && okCount === 2 && full.length === 3 && full.every((r) => /full \(3 people\)/.test(r.data.error)) &&
          room.members.length === 3,
        'VOICE_ROOM_MAX_MEMBERS=3: five people joining at once, exactly two more get in',
        { okCount, full: full.length, members: room.members.length }
      );
      for (const person of people) await request('POST', `/api/voice/${first.data.voiceRoom.id}/leave`, person.token);
    });

    const people = await makeUsers(60);
    const joins = await Promise.all(people.map((person) => request('POST', `${voicePath}/join`, person.token)));
    const roomId = joins.find((join) => join.status === 201)?.data.voiceRoom.id;
    check(
      joins.every((join) => join.status === 200 || join.status === 201) && joins.filter((join) => join.status === 201).length === 1,
      '60 people join a voice chat at the same moment (the old cap was 50)',
      joins.map((join) => join.status)
    );
    const live = await request('GET', voicePath, people[0].token);
    check(live.data.voiceRoom?.memberCount === 60 && live.data.voiceRoom.maxMembers === 1000, 'all 60 are in it, and maxMembers is 1000', live.data.voiceRoom?.memberCount);

    const before = await VoiceRoom.findById(roomId, '__v').lean();
    const pings = await Promise.all(people.slice(0, 20).map((person) => request('POST', `/api/voice/${roomId}/ping`, person.token)));
    const after = await VoiceRoom.findById(roomId, '__v').lean();
    check(
      pings.every((ping) => ping.status === 200 && ping.data.voiceRoom.memberCount === 60) && after.__v === before.__v,
      'check-ins are cheap: they keep people in without changing the voice chat version',
      { before: before.__v, after: after.__v }
    );

    // Someone whose app stopped checking in is removed, atomically.
    await VoiceRoom.updateOne(
      { _id: roomId, 'members.user': people[59].id },
      { $set: { 'members.$.lastSeenAt': new Date(Date.now() - VoiceRoom.STALE_AFTER_MS - 1000) } }
    );
    const pruned = await request('POST', `/api/voice/${roomId}/ping`, people[0].token);
    check(pruned.data.voiceRoom.memberCount === 59, 'a member who stopped checking in is removed', pruned.data.voiceRoom.memberCount);

    const leaves = await Promise.all(people.slice(0, 59).map((person) => request('POST', `/api/voice/${roomId}/leave`, person.token)));
    const closed = await VoiceRoom.findById(roomId).lean();
    check(
      leaves.every((leave) => leave.status === 200) && closed.active === false && closed.members.length === 0 &&
        (await request('GET', voicePath, people[0].token)).data.voiceRoom === null,
      'everyone leaving at once closes the voice chat',
      { active: closed.active, members: closed.members.length }
    );
  }

  return { pass, fail };
}

module.exports = { run };
