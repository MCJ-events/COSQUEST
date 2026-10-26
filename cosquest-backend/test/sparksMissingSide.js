/**
 * The team's report of 25 October, end to end on the real server with
 * mock-SDK phones and the real Mongo store: a community voice chat where one
 * side was missing ("Didn't speak") and the other had only two minutes.
 *
 * Cause: SDK 1.2.7 numbers a phone's lines seg_<device>_<n>, n from 1 at every
 * app start, and the store keys lines by that id, so after a restart a phone's
 * lines reused the ids of its earlier calls and were dropped as repeats.
 * Module 1.3.4 stores them under a unique id instead.
 *
 * 1. Replay: Seyi's phone sent ids 1..30 in an earlier chat; after a restart
 *    its lines in the next chat (ids 1..12 again) are all in the transcript.
 *    A resend is still dropped.
 * 2. Honest statuses from SDK 1.2.8's call.listening: silent only when the
 *    phone listened with the mic on; muted; not_listening; no_lines for a
 *    phone too old to say.
 */
const User = require('../src/models/User');
const sparksHost = require('../src/sparks');
const { flushUpdates } = require('../src/controllers/voiceRoomController')._internal;
const { signToken } = require('../src/utils/token');
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
  let n = 0;
  const make = async (firstName) => {
    n += 1;
    const user = await User.create({
      profile: { username: `Miss${n}x${suffix}`, usernameNormalized: `miss${n}x${suffix}`, firstName, lastName: 'Tester', avatarKey: 'green-knight' },
      onboardingComplete: true,
      faction: 'vanguard',
    });
    return { id: user.id, token: signToken(user.id, user.tokenVersion) };
  };

  const store = sparksHost.store;
  const phones = [];
  const seq = (k) => `seg_SEYI01_${String(k).padStart(5, '0')}`;   // SDK 1.2.7's ids for one phone

  try {
    console.log('\n--- sparks: the missing side of a voice chat (25 Oct) ---');
    const seyi = await make('Seyi');
    const rain = await make('Rain');
    const ola = await make('Ola');
    const tobi = await make('Tobi');
    const kemi = await make('Kemi');

    const chats = await request('GET', '/api/chats', seyi.token);
    const room = chats.data.chats.find((chat) => chat.type === 'community') || chats.data.chats.find((chat) => chat.type === 'faction');
    const voicePath = `/api/chats/${room.id}/voice`;
    const openChat = async (people) => {
      const first = await request('POST', `${voicePath}/join`, people[0].token);
      const id = first.data.voiceRoom?.id;
      for (const p of people.slice(1)) await request('POST', `${voicePath}/join`, p.token);
      flushUpdates();
      await waitFor(async () => (await store.getCall(id))?.attendees.length === people.length);
      return id;
    };
    const closeChat = async (id, people) => {
      for (const p of people) await request('POST', `/api/voice/${id}/leave`, p.token);
      flushUpdates();
      await waitFor(async () => (await store.getCall(id))?.status !== 'active');
    };

    // 1. The same phone (same device id) in two voice chats, its app restarted in between.
    let ps = await connectPhone(baseUrl, { userId: seyi.id, token: seyi.token, tier: 'none', transcription: true, deviceId: 'dev_SEYI01', sdkVersion: '1.2.7' });
    const pr = await connectPhone(baseUrl, { userId: rain.id, token: rain.token, tier: 'none', transcription: true, sdkVersion: '1.2.7' });
    phones.push(ps, pr);
    await ps.consent(null, 'accepted', 'always');
    await pr.consent(null, 'accepted', 'always');

    const earlier = await openChat([seyi, rain]);
    for (let k = 1; k <= 30; k++) await ps.speak(earlier, `earlier line ${k}`, k * 2000, k * 2000 + 1500, seq(k));
    await waitFor(async () => (await store.segments(earlier)).length === 30);
    await closeChat(earlier, [seyi, rain]);

    ps.close();
    ps = await connectPhone(baseUrl, { userId: seyi.id, token: seyi.token, tier: 'none', transcription: true, deviceId: 'dev_SEYI01', sdkVersion: '1.2.7' });
    phones.push(ps);
    const chat = await openChat([rain, seyi]);
    for (let k = 1; k <= 12; k++) {
      await pr.speak(chat, `rain line ${k}`, k * 5000);
      await ps.speak(chat, `seyi line ${k}`, k * 5000 + 2500, k * 5000 + 4000, seq(k));   // ids 1..12 again
    }
    await ps.speak(chat, 'seyi line 1', 7500, 9000, seq(1));   // a resend of the first line
    await waitFor(async () => (await store.segments(chat)).length >= 24);
    await new Promise((r) => setTimeout(r, 200));
    const t = await request('GET', `/api/calls/${chat}/transcript`, seyi.token);
    const mine = (t.data.segments || []).filter((s) => s.userId === seyi.id);
    check(
      t.status === 200 && mine.length === 12 && mine.every((s, i) => s.text === `seyi line ${i + 1}`) && new Set(t.data.segments.map((s) => s.segmentId)).size === 24,
      'a restarted phone: all 12 lines whose ids its earlier chat used are in the transcript, ids unique, the resend dropped (before: 0 of 12)',
      { status: t.status, lines: mine.map((s) => [s.segmentId, s.text]) }
    );
    const byId = Object.fromEntries((t.data.participants || []).map((p) => [p.userId, p]));
    check(byId[seyi.id]?.status === 'transcribed' && byId[seyi.id].lines === 12 && byId[rain.id]?.lines === 12, 'both sides are in the transcript', t.data.participants);
    const earlierT = await request('GET', `/api/calls/${earlier}/transcript`, seyi.token);
    check(earlierT.data.segments?.length === 30 && earlierT.data.segments[0].segmentId === seq(1), 'the earlier chat keeps its 30 lines and ids', earlierT.data.segments?.length);
    await closeChat(chat, [rain, seyi]);

    // 2. Why people have no lines, from SDK 1.2.8's call.listening.
    const p8 = async (u) => connectPhone(baseUrl, { userId: u.id, token: u.token, tier: 'none', transcription: true, sdkVersion: '1.2.8' });
    const [qo, qt, qk] = [await p8(ola), await p8(tobi), await p8(kemi)];
    phones.push(qo, qt, qk);
    for (const q of [qo, qt, qk]) await q.consent(null, 'accepted', 'always');
    const quiet = await openChat([rain, ola, tobi, kemi, seyi]);
    await pr.speak(quiet, 'can anyone hear me', 1000);
    const ack1 = await qo.listening(quiet, { state: 'off', listenedMs: 600000, unmutedMs: 540000, lines: 0 });   // mic on 9 min, nothing heard
    await qt.listening(quiet, { state: 'off', listenedMs: 600000, unmutedMs: 2000, lines: 0 });                   // muted all along
    // kemi's phone (1.2.8) never reported: Sparks did not start on it. seyi's phone is 1.2.7: cannot say.
    check(ack1?.ok !== false && !ack1?.error, 'call.listening is accepted by the server', ack1);
    await waitFor(async () => (await store.listeningOfCall(quiet)).length === 2);
    const q = await request('GET', `/api/calls/${quiet}/transcript`, rain.token);
    const st = Object.fromEntries((q.data.participants || []).map((p) => [p.userId, p.status]));
    check(
      st[rain.id] === 'transcribed' && st[ola.id] === 'silent' && st[tobi.id] === 'muted' && st[kemi.id] === 'not_listening' && st[seyi.id] === 'no_lines',
      'statuses: transcribed, silent (listened, mic on), muted, not_listening (Sparks never started), no_lines (too old to say)',
      q.data.participants
    );
    const rows = await store.listeningOfCall(quiet);
    await qo.listening(quiet, { state: 'on', listenedMs: 60000, unmutedMs: 60000, lines: 0 });   // an older report arriving late
    await new Promise((r) => setTimeout(r, 200));
    const after = (await store.listeningOfCall(quiet)).find((r) => r.userId === ola.id);
    check(rows.length === 2 && after?.unmutedMs === 540000 && after?.listenedMs === 600000, 'listening totals never go down', after);
    await closeChat(quiet, [rain, ola, tobi, kemi, seyi]);
  } catch (error) {
    fail += 1;
    console.log('FAIL - missing side suite threw', error?.stack || error);
  } finally {
    for (const p of phones) p.close();
  }
  return { pass, fail };
}

module.exports = { run };
