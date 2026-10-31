// Super admin dashboard, Phase 4: Sparks (module rows in sparks_sparks):
// Active / Quiet / Dormant from the last reply, never DM Sparks, merged and
// deleted hidden, reply counts, detail with history.
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
  async function request(method, path, token) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }

  const savedEngine = process.env.SPARKS_ENGINE;
  process.env.SPARKS_ENGINE = 'module';
  const sparks = mongoose.connection.collection('sparks_sparks');
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const ids = [];
  try {
    const admin = await User.create({ profile: { username: `Sp${suffix}`, usernameNormalized: `sp${suffix}`, firstName: 'Spark', lastName: 'Admin', avatarKey: 'green-knight' }, email: `sp_${suffix}@example.com`, onboardingComplete: true, platformRole: 'admin' });
    const nia = await User.create({ profile: { username: `Nia${suffix}`, usernameNormalized: `nia${suffix}`, firstName: 'Nia', lastName: 'Brooks', avatarKey: 'green-knight' }, email: `nia_${suffix}@example.com`, onboardingComplete: true });
    const exchanged = await fetch(`${baseUrl}/api/admin/auth/exchange`, { method: 'POST', headers: { Authorization: `Bearer ${signToken(admin.id, admin.tokenVersion)}` } });
    const adminToken = (await exchanged.json()).token;

    const group = await Conversation.create({ type: 'group', group: { name: `Barrio ${suffix}`, kind: 'open', createdBy: nia._id } });
    const dm = await Conversation.create({ type: 'dm', dmKey: `${admin.id}_${nia.id}_${suffix}`, participants: [admin._id, nia._id] });
    const now = Date.now();
    const row = (id, chat, last, extra = {}) => ({ _id: id, sparkId: id, chatId: String(chat._id), subject: `Topic ${id}`, state: 'dormant', pinned: false, revivalIndex: 0, summaryText: null, createdBy: String(nia._id), createdAt: now - 2 * 3600e3, lastMessageAt: last, mergedInto: null, version: 1, ...extra });
    const s = (name) => { const id = `spk_${name}_${suffix}`; ids.push(id); return id; };
    const active = s('active'); const quiet = s('quiet'); const old = s('old'); const merged = s('merged'); const dmSpark = s('dm');
    await sparks.insertMany([
      row(active, group, now - 3600e3, { subject: `Next CosQuest ${suffix}` }),
      row(quiet, group, now - 3 * 86400e3),
      row(old, group, now - 9 * 86400e3, { createdBy: null }),
      row(merged, group, now - 3600e3, { state: 'merged', mergedInto: active }),
      row(dmSpark, dm, now - 3600e3),
    ]);
    await Message.create({ conversation: group._id, sender: nia._id, content: 'Route at the park', sparkId: active, sparkRevivalIndex: 0 });
    await Message.create({ conversation: group._id, sender: admin._id, content: 'I will bring the camera', sparkId: active, sparkRevivalIndex: 0 });

    console.log('\n--- sparks ---');
    const list = await request('GET', `/api/admin/sparks?group=${group._id}`, adminToken);
    const byId = new Map((list.data.sparks || []).map((x) => [x.id, x]));
    check(list.status === 200 && byId.get(active)?.state === 'active' && byId.get(quiet)?.state === 'quiet' && byId.get(old)?.state === 'dormant', 'Active / Quiet / Dormant from the last reply', list.data);
    check(!byId.has(merged), 'merged Sparks are hidden', [...byId.keys()]);
    check(byId.get(active)?.replies === 2 && byId.get(active)?.participants === 2, 'reply and participant counts', byId.get(active));
    check(byId.get(old)?.startedByBot === true && byId.get(old)?.creator === null, 'bot-started Sparks', byId.get(old));
    const all = await request('GET', '/api/admin/sparks', adminToken);
    check(!(all.data.sparks || []).some((x) => x.id === dmSpark), 'DM Sparks never appear', all.data.sparks?.map((x) => x.id));
    const activeTab = await request('GET', `/api/admin/sparks?tab=active&group=${group._id}`, adminToken);
    check(activeTab.data.sparks?.length === 1 && activeTab.data.sparks[0].id === active, 'the Active tab', activeTab.data);
    const search = await request('GET', `/api/admin/sparks?q=${encodeURIComponent(`Next CosQuest ${suffix}`)}`, adminToken);
    check(search.data.sparks?.length === 1, 'search by subject', search.data);
    const detail = await request('GET', `/api/admin/sparks/${active}`, adminToken);
    check(detail.status === 200 && detail.data.history.length === 2 && detail.data.history[0].text === 'Route at the park' && detail.data.related.length === 2, 'detail: history oldest first, related topics', detail.data);
    const dmDetail = await request('GET', `/api/admin/sparks/${dmSpark}`, adminToken);
    check(dmDetail.status === 404, 'a DM Spark cannot be opened', dmDetail.status);
    const stats = await request('GET', '/api/admin/sparks/stats', adminToken);
    check(stats.status === 200 && stats.data.active >= 1 && stats.data.quiet >= 1 && stats.data.dormant >= 1 && stats.data.newThisWeek >= 3, 'stats', stats.data);
    process.env.SPARKS_ENGINE = 'legacy';
    const legacy = await request('GET', '/api/admin/sparks', adminToken);
    check(legacy.status === 503 && legacy.data.code === 'sparks_legacy', 'on the legacy engine the page says so', legacy.data);
  } catch (error) {
    check(false, 'sparks suite threw', error.stack);
  } finally {
    await sparks.deleteMany({ _id: { $in: ids } });
    if (savedEngine === undefined) delete process.env.SPARKS_ENGINE;
    else process.env.SPARKS_ENGINE = savedEngine;
  }

  console.log(`\nadmin phase 4: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
