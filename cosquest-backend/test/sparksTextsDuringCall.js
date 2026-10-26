/**
 * Emmanuel's report of 26 October: during calls, Sparks did not pick up the
 * texts people sent in the chat, 1:1 calls included. End to end on the real
 * server, real Mongo store and mock-SDK phones.
 *
 * Cause: the call scribe (the phone that watches the call's lines and
 * proposes its topics) holds one job lease for the whole call. Module 1.3.4
 * and older never offered a job to a phone holding any lease, so for the whole
 * call the scribe's phone got none of the chat's jobs. In a DM where that phone
 * is the only one with Sparks, the texts sent during the call waited and ran
 * out of time. Module 1.3.5 asks the store for busy phones without the scribe
 * leases (activeJobDeviceIds({ exceptTypes: ['call.scribe'] })).
 *
 * 1. Store contract: exceptTypes leaves those leases out.
 * 2. A DM call between Ada (a Sparks phone, which becomes the scribe) and Ben
 *    (no Sparks phone): three texts during the call become a Spark, by Ada's
 *    phone, while it still holds the scribe.
 */
const mongoose = require('mongoose');
const User = require('../src/models/User');
const sparksHost = require('../src/sparks');
const { MongoSparksStore } = require('../src/sparks/mongoStore');
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
      profile: { username: `Txt${n}x${suffix}`, usernameNormalized: `txt${n}x${suffix}`, firstName, lastName: 'Tester', avatarKey: 'green-knight' },
      onboardingComplete: true,
      faction: 'vanguard',
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  };
  const phones = [];

  try {
    console.log('\n--- sparks: store, busy phones without the scribe (module 1.3.5) ---');
    const store = new MongoSparksStore(mongoose.connection);
    const tag = `busy${suffix}`;
    const row = (jobId, type, status, leaseDeviceId) => ({
      jobId, type, scopeId: tag, chatId: tag, callId: type === 'call.scribe' ? tag : null, idempotencyKey: `${jobId}_k`, status, attempt: 1,
      leaseToken: 'lt', leaseDeviceId, leaseExpiresAt: Date.now() + 60000, offerExpiresAt: null, deadline: Date.now() + 60000, createdAt: Date.now(),
      nextRetryAt: null, input: null, result: null, resultMeta: null, tipUserId: null, minTier: 'lite', candidateUserIds: [], triedDeviceIds: [],
    });
    await store.insertJob(row(`${tag}_1`, 'call.scribe', 'leased', `dev_scribe_${tag}`));
    await store.insertJob(row(`${tag}_2`, 'spark.detect', 'offered', `dev_detect_${tag}`));
    const all = await store.activeJobDeviceIds();
    const notScribe = await store.activeJobDeviceIds({ exceptTypes: ['call.scribe'] });
    check(all.has(`dev_scribe_${tag}`) && all.has(`dev_detect_${tag}`), 'without options every offered or leased job counts (as before)', [...all]);
    check(!notScribe.has(`dev_scribe_${tag}`) && notScribe.has(`dev_detect_${tag}`), 'exceptTypes [call.scribe]: the scribe holder is not busy, other leases still are', [...notScribe]);
    await store.c.jobs.deleteMany({ scopeId: tag });

    console.log('\n--- sparks: texts sent during a 1:1 call (26 Oct) ---');
    const ada = await make('Ada');
    const ben = await make('Ben');
    const pa = await connectPhone(baseUrl, { userId: ada.id, token: ada.token, tier: 'full', transcription: true, keepScribe: true });
    phones.push(pa);
    const dm = await request('POST', '/api/chats/dm', ada.token, { username: ben.username });
    const dmId = dm.data.chat.id;
    const started = await request('POST', `/api/chats/${dmId}/calls`, ada.token, { type: 'audio' });
    const callId = started.data.call?.id;
    await request('POST', `/api/calls/${callId}/accept`, ben.token);
    const active = await waitFor(async () => ((await sparksHost.store.getCall(callId))?.status === 'active' ? true : null));
    check(active === true, 'the answered DM call is a Sparks call', started.data);
    const scribeJob = await waitFor(async () => (await sparksHost.store.jobsOfCall(callId, 'call.scribe')).find((j) => j.status === 'leased' && j.leaseDeviceId === pa.deviceId) || null);
    check(Boolean(scribeJob), "Ada's phone holds the call's scribe", scribeJob && { status: scribeJob.status, device: scribeJob.leaseDeviceId });

    const say = async (user, content) => {
      const r = await request('POST', `/api/chats/${dmId}/messages`, user.token, { content });
      if (r.status === 201 && user === ada) await pa.hint(r.data.message, dmId);
      return r;
    };
    await say(ben, 'Are we still doing the fountain shoot on Saturday?');
    await say(ada, 'Yes, the fountain at nine, bring the reflector');
    await say(ben, 'Great, I will book the fountain permit tonight');

    const spark = await pa.until(() => [...pa.sparks.values()].find((s) => s.chatId === dmId), 12000, 'a Spark in the DM').catch(() => null);
    check(Boolean(spark) && spark.messageCount === 3, 'the three texts sent during the call become a Spark', spark);
    check(pa.results.some((r) => r.type === 'spark.detect'), "Ada's phone ran the chat's detect job during the call", pa.results.map((r) => r.type));
    const still = (await sparksHost.store.jobsOfCall(callId, 'call.scribe')).find((j) => j.jobId === scribeJob?.jobId);
    check(still?.status === 'leased' && still.leaseDeviceId === pa.deviceId, 'and still holds the scribe (the call is not disturbed)', still && { status: still.status });

    await request('POST', `/api/calls/${callId}/end`, ada.token);
    const ended = await waitFor(async () => ((await sparksHost.store.getCall(callId))?.status !== 'active' ? true : null));
    const scribeAfter = (await sparksHost.store.jobsOfCall(callId, 'call.scribe')).find((j) => j.jobId === scribeJob?.jobId);
    check(ended === true && !['offered', 'leased'].includes(scribeAfter?.status), 'ending the call ends the scribe', scribeAfter && { status: scribeAfter.status });
  } finally {
    for (const p of phones) p.close();
  }

  console.log(`\n[sparks texts during a call] ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
