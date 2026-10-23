/**
 * The team's report of 22 October, end to end on the real server with
 * mock-SDK phones: a voice chat where nobody's phone has the Sparks model
 * (two phones have only the speech files, one person has no Sparks at all).
 *
 * 1. The merged transcript has both speakers' lines, attributed by name, and
 *    says who is missing and why (participants: no_sparks for the person
 *    without Sparks).
 * 2. With SPARKS_OUTLINE_FALLBACK on, the call's notes still appear: the
 *    backend writes quick notes from the transcript (generatedBy.modelVersion
 *    'server-extractive'), and GET outline names the speakers.
 * 3. SPARKS_OUTLINE_FALLBACK / SPARKS_OUTLINE_FALLBACK_AFTER_S parsing.
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
      profile: { username: `Note${n}x${suffix}`, usernameNormalized: `note${n}x${suffix}`, firstName, lastName: 'Tester', avatarKey: 'green-knight' },
      onboardingComplete: true,
      faction: 'vanguard',
    });
    return { id: user.id, token: signToken(user.id, user.tokenVersion) };
  };

  const backend = sparksHost.backend;
  const store = sparksHost.store;
  const config = backend.config;
  const saved = { grace: config.callEndGraceMs, fallback: config.outlineServerFallback, after: config.outlineFallbackAfterMs };
  const phones = [];
  const env = { on: process.env.SPARKS_OUTLINE_FALLBACK, after: process.env.SPARKS_OUTLINE_FALLBACK_AFTER_S };

  try {
    console.log('\n--- sparks call transcript and quick notes ---');

    // 3. The env switch (read when the module is created).
    const parse = (on, after) => {
      process.env.SPARKS_OUTLINE_FALLBACK = on;
      if (after === undefined) delete process.env.SPARKS_OUTLINE_FALLBACK_AFTER_S;
      else process.env.SPARKS_OUTLINE_FALLBACK_AFTER_S = after;
      return sparksHost._internal.outlineFallback();
    };
    check(JSON.stringify(parse('', undefined)) === '{}', 'SPARKS_OUTLINE_FALLBACK unset: quick notes off (module default)');
    check(JSON.stringify(parse('1', undefined)) === JSON.stringify({ outlineServerFallback: true }), 'SPARKS_OUTLINE_FALLBACK=1: quick notes on');
    check(JSON.stringify(parse('true', '45')) === JSON.stringify({ outlineServerFallback: true, outlineFallbackAfterMs: 45000 }), 'SPARKS_OUTLINE_FALLBACK_AFTER_S=45: phones get 45 s first');
    check(JSON.stringify(parse('0', '45')) === '{}', 'SPARKS_OUTLINE_FALLBACK=0: off');
    check(config.outlineServerFallback === false, 'the module default is off (no env in tests)', config.outlineServerFallback);

    const amara = await make('Amara');
    const tunde = await make('Tunde');
    const chidi = await make('Chidi');

    // Amara and Tunde have Sparks' speech files but no model; Chidi has no Sparks on his phone at all.
    const pa = await connectPhone(baseUrl, { userId: amara.id, token: amara.token, tier: 'none', transcription: true });
    const pt = await connectPhone(baseUrl, { userId: tunde.id, token: tunde.token, tier: 'none', transcription: true });
    phones.push(pa, pt);

    const chats = await request('GET', '/api/chats', amara.token);
    const faction = chats.data.chats.find((chat) => chat.type === 'faction');
    const voicePath = `/api/chats/${faction.id}/voice`;
    const started = await request('POST', `${voicePath}/join`, amara.token);
    const roomId = started.data.voiceRoom?.id;
    await request('POST', `${voicePath}/join`, tunde.token);
    await request('POST', `${voicePath}/join`, chidi.token);
    flushUpdates();
    const three = await waitFor(async () => (await store.getCall(roomId))?.attendees.length === 3);
    check(Boolean(three), 'three people in the voice chat', await store.getCall(roomId));

    await pa.consent(roomId, 'accepted');
    await pt.consent(roomId, 'accepted');
    const script = [
      [pa, 1000, 'So the guild raid on Saturday needs a proper raid route this time.'],
      [pt, 4000, 'The raid route through the northern pass is shorter but the bridge is risky.'],
      [pa, 8000, 'I think the northern pass works if we bring two healers for the bridge.'],
      [pt, 12000, "Okay let's go with the northern pass and two healers."],
      [pa, 16000, "I'll post the raid route in the guild chat tonight."],
      [pt, 20000, 'Amara, can you also book the voice room for Saturday evening?'],
    ];
    for (const [phone, at, text] of script) await phone.speak(roomId, text, at);
    await waitFor(async () => (await store.segments(roomId)).length === script.length);

    // 1. The merged transcript: both speakers by name, Chidi's lines missing because he has no Sparks.
    const t = await request('GET', `/api/calls/${roomId}/transcript`, chidi.token);
    const speakersOk = t.data.segments?.length === 6 && t.data.segments.every((s, i) => s.userId === script[i][0].userId && s.text === script[i][2]);
    check(t.status === 200 && speakersOk, 'transcript: every line from both phones, in call order, with its speaker', t.data);
    check(
      t.data.speakers?.[amara.id]?.name === 'Amara Tester' && t.data.speakers?.[tunde.id]?.name === 'Tunde Tester' && t.data.speakers?.[chidi.id]?.name === 'Chidi Tester',
      'transcript: names for both speakers and for the person with no lines',
      t.data.speakers
    );
    const byId = Object.fromEntries((t.data.participants || []).map((p) => [p.userId, p]));
    check(
      byId[amara.id]?.status === 'transcribed' && byId[amara.id].lines === 3 && byId[tunde.id]?.status === 'transcribed' && byId[tunde.id].lines === 3 &&
        byId[chidi.id]?.status === 'no_sparks' && byId[chidi.id].lines === 0 && byId[chidi.id].displayName === 'Chidi Tester',
      'transcript participants: Amara and Tunde transcribed, Chidi no_sparks (no Sparks on his phone)',
      t.data.participants
    );

    // 2. Everyone leaves. No phone has the model, so nobody writes the notes: the backend does.
    config.outlineServerFallback = true;
    config.outlineFallbackAfterMs = 300;
    config.callEndGraceMs = 200;
    for (const p of [amara, tunde, chidi]) await request('POST', `/api/voice/${roomId}/leave`, p.token);
    flushUpdates();
    await waitFor(async () => (await store.getCall(roomId))?.status !== 'active');
    const outline = await waitFor(async () => {
      await backend.tick();
      const o = await store.getOutline(roomId);
      return o?.status === 'ready' ? o.outline : null;
    }, 20000);
    check(Boolean(outline) && outline.generatedBy.modelVersion === 'server-extractive', 'no phone with the model: the backend writes quick notes (server-extractive)', outline);
    const actions = outline ? outline.topics.flatMap((x) => x.actionItems) : [];
    check(
      actions.some((a) => a.ownerUserId === amara.id && a.text === "I'll post the raid route in the guild chat tonight.") &&
        actions.some((a) => a.ownerUserId === amara.id && a.text === 'Tunde: Amara, can you also book the voice room for Saturday evening?') &&
        outline.topics.some((x) => x.decisions.includes("Tunde: Let's go with the northern pass and two healers.")) &&
        /^(Amara|Tunde): /.test(outline.topics[0].summary) && outline.summary === 'Amara and Tunde talked about Raid Route and Northern Pass.',
      'quick notes: the decision and both action items, by name, owned by the right person (people who only joined the voice chat are named too)',
      outline?.topics
    );
    const read = await request('GET', `/api/calls/${roomId}/outline`, chidi.token);
    check(
      read.status === 200 && read.data.status === 'ready' && read.data.quickNotes === true && read.data.outline?.generatedBy?.modelVersion === 'server-extractive' &&
        read.data.speakers?.[amara.id]?.name === 'Amara Tester' && read.data.speakers?.[tunde.id]?.name === 'Tunde Tester',
      'GET outline: the quick notes, with names for the speakers and owners',
      read.data
    );

    // 4. A call where nobody had Sparks on: once it is over, GET outline says there will be no notes (the app stops waiting).
    const quiet = await request('POST', `${voicePath}/join`, chidi.token);
    const quietId = quiet.data.voiceRoom?.id;
    await waitFor(async () => (await store.getCall(quietId))?.status === 'active');
    const during = await request('GET', `/api/calls/${quietId}/outline`, chidi.token);
    check(during.status === 200 && during.data.status === 'pending', 'GET outline while the call runs: pending', during.data);
    await request('POST', `/api/voice/${quietId}/leave`, chidi.token);
    flushUpdates();
    const none = await waitFor(async () => {
      await backend.tick();
      const r = await request('GET', `/api/calls/${quietId}/outline`, chidi.token);
      return r.data.status === 'none' ? r : null;
    }, 20000);
    check(Boolean(none) && none.data.reason === 'no_transcript' && none.data.outline === null, 'GET outline after a call nobody was transcribed on: status none, reason no_transcript', none?.data);
  } catch (error) {
    fail += 1;
    console.log('FAIL - call notes suite threw', error?.stack || error);
  } finally {
    config.callEndGraceMs = saved.grace;
    config.outlineServerFallback = saved.fallback;
    config.outlineFallbackAfterMs = saved.after;
    for (const [k, v] of [['SPARKS_OUTLINE_FALLBACK', env.on], ['SPARKS_OUTLINE_FALLBACK_AFTER_S', env.after]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const p of phones) p.close();
  }
  return { pass, fail };
}

module.exports = { run };
