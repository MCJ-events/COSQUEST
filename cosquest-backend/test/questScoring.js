// How points are scored: required to publish a paid quest, locked once sales open.
const User = require('../src/models/User');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const before = process.env.QUEST_SCORING_REQUIRED;
  process.env.QUEST_SCORING_REQUIRED = '1';
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const u = await User.create({ profile: { username: `QsA${suffix}`, usernameNormalized: `qsa${suffix}`, firstName: 'Ada', avatarKey: 'green-knight' }, email: `qsa_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
  const admin = (await request('POST', '/api/admin/auth/exchange', signToken(u.id, u.tokenVersion))).data.token;
  const start = new Date(Date.now() + 3 * 24 * 3600e3);
  const base = { title: `Scored quest ${suffix}`, kind: 'event', format: 'virtual', placeLabel: 'Tokyo · Hanuma', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3 * 3600e3).toISOString(), entryFee: { amount: 5 }, prizePool: { amount: 100 }, maxParticipants: 20 };

  const draft = await request('POST', '/api/admin/quests', admin, base);
  check(draft.status === 201, 'a paid quest can be saved as a draft without scoring', draft.data);
  const id = draft.data.quest?.id || draft.data.quest?._id;
  const early = await request('POST', `/api/admin/quests/${id}/publish`, admin, {});
  check(early.status === 409, 'but not published without how points are scored', early.data);
  const rules = '10 points per checkpoint found, 50 points for finishing; points come only from what you do in the quest.';
  const set = await request('PATCH', `/api/admin/quests/${id}`, admin, { scoring: { rules, tieBreak: 'earliest_completion' } });
  check(set.status === 200 && set.data.quest?.scoring?.version === 1, 'scoring added before publishing (version 1)', set.data);
  const bad1 = await request('PATCH', `/api/admin/quests/${id}`, admin, { scoring: { rules, tieBreak: 'coin_flip' } });
  check(bad1.status === 400, 'an unknown tie-break is refused (no chance-based tie-breaks)', bad1.data);
  const pub = await request('POST', `/api/admin/quests/${id}/publish`, admin, {});
  check(pub.status === 200, 'with scoring, the paid quest can be published', pub.data);
  const change = await request('PATCH', `/api/admin/quests/${id}`, admin, { scoring: { rules: `${rules} Double points at night.`, tieBreak: 'earliest_completion' } });
  check(change.status === 409, 'once published, the scoring is locked', change.data);
  const sameAgain = await request('PATCH', `/api/admin/quests/${id}`, admin, { scoring: { rules, tieBreak: 'earliest_completion' }, description: 'Updated description' });
  check(sameAgain.status === 200, 'other edits still work when the scoring is unchanged', sameAgain.data);
  delete process.env.QUEST_SCORING_REQUIRED;
  const loose = await request('POST', '/api/admin/quests', admin, { ...base, title: `Test-mode quest ${suffix}`, publish: true });
  check(loose.status === 201, 'test mode, rule not switched on: a paid quest still publishes without scoring', loose.data);

  if (before === undefined) delete process.env.QUEST_SCORING_REQUIRED;
  else process.env.QUEST_SCORING_REQUIRED = before;
  console.log(`\nquest scoring: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
