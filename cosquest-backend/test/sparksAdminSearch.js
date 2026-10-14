/**
 * Sparks module 1.3 on the real server: Manage Sparks (M31: proposed merges,
 * merging several Sparks at once), search inside one Spark (M16), and voice
 * commands that ring people ("calling all Back-end").
 *
 * The first two need backend module 1.3 (vendor/); with an older module they
 * are reported as skipped. Targeted calls work with any module (the reach of
 * a command beyond the call's DM needs 1.3's ports.commandMembers).
 */
const { io } = require('socket.io-client');
const User = require('../src/models/User');
const sparksHost = require('../src/sparks');
const targetedCalls = require('../src/sparks/targetedCalls');
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
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  async function waitFor(fn, timeoutMs = 6000) {
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
      profile: { username: `Sadm${index}${suffix}`, usernameNormalized: `sadm${index}${suffix}`, firstName: 'Sadm', lastName: `User${index}`, avatarKey: 'green-knight' },
      onboardingComplete: true,
      faction: 'ascendants',
      expertise,
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  };
  // A plain app socket: records the events the app listens to.
  const sockets = [];
  const listen = async (user) => {
    const socket = io(baseUrl, { auth: { token: user.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const events = [];
    for (const name of ['spark:merge_suggested', 'notification:new', 'sparks:targeted_call', 'call:incoming', 'spark:deleted']) {
      socket.on(name, (payload) => events.push({ name, payload }));
    }
    sockets.push(socket);
    return { socket, events, saw: (name, pred = () => true) => waitFor(() => events.find((e) => e.name === name && pred(e.payload))) };
  };

  const lead = await make(1, 'front_end');
  const [b, c, d, e, f, g] = [await make(2, 'back_end'), await make(3, 'back_end'), await make(4, 'back_end'), await make(5, 'back_end'), await make(6), await make(7)];
  const outsider = await make(8);
  const h = await make(9);
  const phones = [];
  const backend = sparksHost.backend;
  const has13 = typeof backend?.admin?.mergeMany === 'function' && typeof backend?.sparkHistory === 'function';

  try {
    const leadSocket = await listen(lead);
    const group = await request('POST', '/api/groups', lead.token, { name: 'Sparks Admin Club', kind: 'private', members: [b.id, c.id, d.id, e.id] });
    const groupId = group.data.group.id;
    await leadSocket.socket.timeout(5000).emitWithAck('conversation:join', groupId); // the old spark:* events go to viewers of the chat
    const say = async (user, content, extra = {}) => (await request('POST', `/api/chats/${groupId}/messages`, user.token, { content, ...extra })).data.message;
    const start = async (user, message, subject) => request('POST', `/api/chats/${groupId}/sparks`, user.token, { messageId: message.id, subject, force: true });

    if (!has13) {
      console.log('\n--- sparks 1.3 admin and search: SKIPPED (vendored module is older than 1.3; vendor the 1.3 release) ---');
    } else {
      console.log('\n--- sparks 1.3: proposed merges (M31) ---');
      const m1 = await say(b, 'Who has the Spider-Man suit for Saturday?');
      const m2 = await say(c, 'The Spiderman uniform needs a new mask');
      const s1 = await start(b, m1, 'Spider-Man uniform');
      const s2 = await start(c, m2, 'Spiderman uniform');
      check(s1.status === 201 && s2.status === 201, 'two near-identical Sparks started by hand', [s1.data, s2.data]);
      const live = await leadSocket.saw('spark:merge_suggested');
      check(
        live && live.payload.conversationId === groupId && live.payload.suggestion.sourceSpark.subject === 'Spider-Man uniform' &&
          live.payload.suggestion.targetSpark.subject === 'Spiderman uniform' && /same subject/.test(live.payload.suggestion.reason),
        'the admin gets spark:merge_suggested live (source, target, one-line reason)',
        live
      );
      const bell = await leadSocket.saw('notification:new', (p) => /Sparks bot suggests merging/.test(p.message || ''));
      check(Boolean(bell), 'and a notification in the bell', leadSocket.events.filter((x) => x.name === 'notification:new'));

      check((await request('GET', `/api/chats/${groupId}/sparks/merge-suggestions`, b.token)).status === 403, 'members cannot see proposed merges (403)');
      check((await request('GET', `/api/chats/${groupId}/sparks/merge-suggestions`, outsider.token)).status === 403, 'people outside the group cannot either');
      const listed = await request('GET', `/api/chats/${groupId}/sparks/merge-suggestions`, lead.token);
      const proposal = listed.data?.suggestions?.[0];
      check(
        listed.status === 200 && listed.data.suggestions.length === 1 && proposal.sourceSpark.id === s1.data.spark.id && proposal.targetSpark.id === s2.data.spark.id &&
          proposal.sourceSpark.messageCount === 1 && typeof proposal.targetSpark.participantCount === 'number' && proposal.status === 'pending' && proposal.score >= 0.6,
        'the admin lists pending proposals, Sparks in the app shape',
        listed.data
      );
      check((await request('POST', `/api/chats/${groupId}/sparks/merge-suggestions/${proposal.id}/accept`, b.token)).status === 403, 'a member cannot accept (403)');
      check((await request('POST', `/api/chats/${groupId}/sparks/merge-suggestions/mrg_nope/accept`, lead.token)).status === 404, 'an unknown suggestion is 404');
      const accepted = await request('POST', `/api/chats/${groupId}/sparks/merge-suggestions/${proposal.id}/accept`, lead.token);
      check(accepted.status === 200 && accepted.data.spark.id === s2.data.spark.id && accepted.data.spark.messageCount === 2 && accepted.data.mergedSparkIds[0] === s1.data.spark.id, 'accept merges the pair into the target', accepted.data);
      const again = await request('POST', `/api/chats/${groupId}/sparks/merge-suggestions/${proposal.id}/accept`, lead.token);
      check(again.status === 409 && again.data.code === 'already_decided', 'accepting twice is a 409', again.data);
      const gone = await leadSocket.saw('spark:deleted', (p) => p.sparkId === s1.data.spark.id);
      check(gone?.payload.mergedInto === s2.data.spark.id, 'the old spark:deleted event says where it went (mergedInto)', gone);

      const m3 = await say(b, 'Comic con tickets go on sale Friday');
      const m4 = await say(c, 'Comic-Con tickets: who is buying?');
      await start(b, m3, 'Comic con tickets');
      await start(c, m4, 'Comic-Con tickets');
      const pair = await waitFor(async () => (await request('GET', `/api/chats/${groupId}/sparks/merge-suggestions`, lead.token)).data.suggestions[0]);
      const dismissed = await request('POST', `/api/chats/${groupId}/sparks/merge-suggestions/${pair.id}/dismiss`, lead.token);
      check(dismissed.status === 200 && dismissed.data.dismissed === true, 'the admin dismisses one', dismissed.data);
      await backend.proposeMerges(groupId);
      check((await request('GET', `/api/chats/${groupId}/sparks/merge-suggestions`, lead.token)).data.suggestions.length === 0, 'a dismissed pair is never proposed again');
      const m5 = await say(b, 'Saturday ride to the con?');
      await start(b, m5, 'Saturday ride');
      check((await request('GET', `/api/chats/${groupId}/sparks/merge-suggestions`, lead.token)).data.suggestions.length === 0, 'merely similar subjects are not proposed (conservative)');

      console.log('\n--- sparks 1.3: merging several Sparks at once (M31) ---');
      const routeMsg = await say(b, 'Route map for the walk');
      const muralMsg = await say(c, 'Mural paint colours');
      const nextMsg = await say(b, 'Next CosQuest is at Chicano Park');
      const route = (await start(b, routeMsg, 'Route map')).data.spark.id;
      const mural = (await start(c, muralMsg, 'Mural paint')).data.spark.id;
      const next = (await start(b, nextMsg, 'Next CosQuest')).data.spark.id;
      const mergePath = `/api/chats/${groupId}/sparks/merge`;
      check((await request('POST', mergePath, b.token, { sourceSparkIds: [route, mural], intoSparkId: next })).status === 403, 'a member cannot merge (403)');
      check((await request('POST', mergePath, lead.token, { sourceSparkIds: [route, route], intoSparkId: next })).status === 400, 'the same Spark twice is a 400');
      check((await request('POST', mergePath, lead.token, { sourceSparkIds: [route, next], intoSparkId: next })).status === 400, 'the kept Spark cannot also be a source (400)');
      check((await request('POST', mergePath, lead.token, { sourceSparkIds: [route, 'spk_missing'], intoSparkId: next })).status === 404, 'an unknown Spark is a 404, and nothing merges');
      check((await sparksHost.store.getSpark(route)).state === 'active', '...the valid one is untouched');
      const merged = await request('POST', mergePath, lead.token, { sourceSparkIds: [route, mural], intoSparkId: next });
      check(merged.status === 200 && merged.data.spark.id === next && merged.data.spark.messageCount === 3 && merged.data.mergedSparkIds.length === 2, 'two Sparks into one in one request', merged.data);
      const after = await request('GET', `/api/chats/${groupId}/sparks`, lead.token);
      const ids = after.data.sparks.map((s) => s.id);
      check(ids.includes(next) && !ids.includes(route) && !ids.includes(mural), 'the list shows only the kept Spark', ids);
      const routeRow = await sparksHost.store.getSpark(route);
      check(routeRow.state === 'merged' && routeRow.mergedInto === next, 'the sources are merged into it', routeRow);

      console.log('\n--- sparks 1.3: search inside one Spark (M16) ---');
      // Give "Next CosQuest" a second life: quiet, then a reply inside it revives it (era 1).
      await sparksHost.store.patchSpark(next, { state: 'dormant' });
      const revivalMsg = await say(c, 'Can we use that spare mask this Saturday at Chicano Park?', { sparkId: next });
      await waitFor(async () => (await sparksHost.store.getSpark(next)).state === 'active');
      await say(b, 'the mask from last year still fits', { sparkId: next });
      const hide = await say(c, 'a mask note b hides for themselves', { sparkId: next });
      await request('DELETE', `/api/chats/${groupId}/messages/${hide.id}?scope=me`, b.token);
      const searchPath = `/api/chats/${groupId}/sparks/${next}/search`;
      const found = await request('GET', `${searchPath}?q=mask`, b.token);
      const texts = found.data?.results?.map((r) => r.message.content);
      check(found.status === 200 && texts.length === 2 && texts[0] === 'the mask from last year still fits', 'a query finds the Spark\'s matches, newest first, minus what this user deleted for themselves', found.data);
      check(found.data.results.every((r) => r.context.era === 1 && /· revived$/.test(r.context.label) && r.context.sparkId === next), 'each result has its era and label ("· revived")', found.data.results.map((r) => r.context));
      check(found.data.eras.length === 2 && found.data.eras[0].era === 0 && found.data.spark.id === next && found.data.resolvedFrom === null, 'the response lists the Spark\'s eras', found.data.eras);
      const all = await request('GET', `${searchPath}?limit=2&page=1`, lead.token);
      check(all.status === 200 && all.data.results.length === 2 && all.data.pagination.total === 6 && all.data.pagination.hasMore === true, 'without q: the whole history, paged (merged-in messages included)', all.data?.pagination);
      const firstLife = await request('GET', `${searchPath}?era=0`, lead.token);
      check(firstLife.data.results.length === 3 && firstLife.data.results.every((r) => r.context.era === 0 && /· history$/.test(r.context.label)), 'era=0: only the first life ("· history")', firstLife.data.results.map((r) => r.context));
      const viaOld = await request('GET', `/api/chats/${groupId}/sparks/${route}/search?q=route`, lead.token);
      check(viaOld.status === 200 && viaOld.data.resolvedFrom === route && viaOld.data.spark.id === next && viaOld.data.results[0]?.message.id === routeMsg.id, 'a merged-away Spark id resolves to the Spark it went into', viaOld.data);
      check((await request('GET', `${searchPath}?q=mask`, outsider.token)).status === 403, 'people outside the chat cannot search it');
      check((await request('GET', `/api/chats/${groupId}/sparks/spk_unknown/search`, lead.token)).status === 404, 'an unknown Spark is a 404');
      check((await request('GET', `${searchPath}?q=m`, lead.token)).status === 400, 'a one-letter query is a 400');
      const ctx = await request('GET', `/api/chats/${groupId}/sparks/${next}/messages/${revivalMsg.id}/context?size=2`, b.token);
      check(
        ctx.status === 200 && ctx.data.targetId === revivalMsg.id && ctx.data.era === 1 && ctx.data.messages.length === 4 &&
          ctx.data.messages[2].id === revivalMsg.id && ctx.data.hasOlder === true && ctx.data.messages.every((m) => m.id !== hide.id),
        'jump to message: the Spark conversation around it (2 each way), hidden ones left out',
        ctx.data
      );
      check((await request('GET', `/api/chats/${groupId}/sparks/${next}/messages/${m1.id}/context`, lead.token)).status === 404, 'a message from another Spark is not in this one (404)');
    }

    console.log('\n--- sparks: "calling all Back-end" rings people ---');
    // d has blocked the leader; e is already ringing in another call; b and c can be rung.
    await request('POST', `/api/users/${lead.username}/block`, d.token);
    const gDm = await request('POST', '/api/chats/dm', g.token, { username: e.username });
    const busyCall = await request('POST', `/api/chats/${gDm.data.chat.id}/calls`, g.token, { type: 'audio' });
    check(busyCall.status === 201, 'e is ringing in another call', busyCall.data);

    // The leader is on a call with f (a DM call, answered).
    const fDm = await request('POST', '/api/chats/dm', lead.token, { username: f.username });
    const leadCall = await request('POST', `/api/chats/${fDm.data.chat.id}/calls`, lead.token, { type: 'audio' });
    const callId = leadCall.data.call.id;
    await request('POST', `/api/calls/${callId}/accept`, f.token);
    const sparksCall = await waitFor(async () => ((await sparksHost.store.getCall(callId))?.status === 'active' ? true : null));
    check(sparksCall === true, 'the answered call is a Sparks call');

    const context = await request('GET', `/api/calls/${callId}/command-context`, lead.token);
    check(
      context.status === 200 && context.data.canIssue === true && context.data.roles.includes('Back-end') &&
        [b.id, c.id, d.id, e.id, f.id].every((id) => context.data.members.some((m) => m.userId === id)),
      'command-context: the leader can reach their group and the call (SDK CommandContext)',
      context.data
    );
    check((await request('GET', `/api/calls/${callId}/command-context`, outsider.token)).status === 404, 'command-context: only people in the call');

    const bSocket = await listen(b);
    const cSocket = await listen(c);
    const dSocket = await listen(d);
    process.env.CALL_MAX_INVITES_PER_REQUEST = '1'; // two batches for two people
    const commandId = `cmd_${suffix}`;
    const intent = { action: 'targeted_call_start', targetType: 'role', target: 'Back-end' };
    if (has13) {
      // The whole path: the leader's phone sends the confirmed command, the module resolves the targets.
      const phone = await connectPhone(baseUrl, { userId: lead.id, token: lead.token, tier: 'full' });
      phones.push(phone);
      await phone.send('call.command', { commandId, callId, issuerUserId: lead.id, segmentId: `seg_${suffix}`, utterance: 'calling all back-end', intent });
      const applied = await phone.until(() => phone.frames.find((x) => x.type === 'call.command_applied' && x.payload.commandId === commandId), 5000, 'command_applied').catch(() => null);
      check(applied?.payload.accepted === true && applied.payload.targetUserIds.length === 4, 'the module accepts the command and resolves 4 Back-end people', applied?.payload);
    } else {
      // Module < 1.3 resolves targets in the call's DM only (no commandMembers): ring the same people directly.
      console.log('  (module older than 1.3: ringing through the hook directly)');
      await targetedCalls.ring({ commandId, issuerUserId: lead.id, callId, utterance: 'calling all back-end', intent }, [b.id, c.id, d.id, e.id]);
    }
    const report = await leadSocket.saw('sparks:targeted_call', (p) => p.commandId === commandId);
    const skippedBy = Object.fromEntries((report?.payload.skipped || []).map((s) => [s.userId, s.reason]));
    check(
      report && report.payload.callId === callId && report.payload.started === false && [b.id, c.id].every((id) => report.payload.invited.includes(id)) &&
        skippedBy[d.id] === 'unavailable' && skippedBy[e.id] === 'busy',
      'b and c are rung into the leader\'s call; the blocked and the busy are skipped (in batches of CALL_MAX_INVITES_PER_REQUEST)',
      report?.payload
    );
    check(Boolean(await bSocket.saw('call:incoming', (p) => p.call.id === callId)) && Boolean(await cSocket.saw('call:incoming', (p) => p.call.id === callId)), 'their phones ring (call:incoming)');
    check(!dSocket.events.some((x) => x.name === 'call:incoming'), 'the person who blocked the leader is not rung');
    delete process.env.CALL_MAX_INVITES_PER_REQUEST;
    const incoming = await request('GET', '/api/calls/incoming', b.token);
    check(incoming.data.call?.id === callId && incoming.data.call.members.some((m) => m.user.id === b.id && m.status === 'ringing'), 'b sees the call as incoming and can accept it', incoming.data);

    const end = await targetedCalls.ring({ commandId: 'cmd_end', issuerUserId: lead.id, callId, intent: { action: 'targeted_call_end' } }, [b.id]);
    check(end.invited.length === 0 && end.callId === null, 'targeted_call_end rings nobody');

    // A leader on no call: a new call starts with the first target, the rest are added.
    const cStart = await targetedCalls.ring({ commandId: 'cmd_new', issuerUserId: outsider.id, callId: 'not-a-call', intent: { action: 'targeted_call_start' } }, [h.id, f.id, outsider.id]);
    check(cStart.started === true && cStart.invited[0] === h.id && cStart.skipped.some((s) => s.userId === f.id && s.reason === 'busy'), 'a leader on no call: a new call with the first free target (DM), busy people skipped', cStart);
  } catch (error) {
    fail += 1;
    console.log('FAIL - sparks 1.3 suite threw', error.stack);
  } finally {
    delete process.env.CALL_MAX_INVITES_PER_REQUEST;
    for (const p of phones) p.close();
    for (const s of sockets) s.close();
  }
  return { pass, fail };
}

module.exports = { run };
