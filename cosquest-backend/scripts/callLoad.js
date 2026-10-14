/**
 * Call load test: how long does it take to get N people into one call?
 *
 *   node scripts/callLoad.js --n 8,50,200,500 [--batch 50] [--timeout 300]
 *                            [--backend <dir>] [--json results.json]
 *
 * For each N it starts a fresh backend in a child process, on the same
 * throwaway in-memory MongoDB + Redis the integration tests use (no real
 * database is touched), creates N users and connects a Socket.IO client for
 * each of them, then:
 *
 *   1. user 0 starts a call in a DM with user 1, and user 1 accepts;
 *   2. user 0 invites everyone else in batches (--batch per request), and
 *      each batch accepts all at once (concurrently);
 *   3. the clock stops when everyone has accepted.
 *
 * It reports the time to seat everyone, the server's event-loop delay over
 * the run (measured inside the server process), and the Socket.IO frames and
 * bytes the server sent, by event name.
 *
 * --backend points at another checkout's cosquest-backend folder, so the
 * same script can measure older code (e.g. main) for a before/after.
 * An accept that fails with 409 ("the call changed too quickly") is retried
 * up to 10 times, the way an app would retry; retries are counted.
 */
const path = require('path');
const net = require('net');
const { fork } = require('child_process');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const BACKEND = path.resolve(arg('backend', path.join(__dirname, '..')));

// ==========================================================================
// CHILD: the backend under test
// ==========================================================================

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function child() {
  const fs = require('fs');
  const os = require('os');
  const { monitorEventLoopDelay } = require('perf_hooks');
  const req = (p) => require(path.join(BACKEND, p));
  const { MongoMemoryServer } = req('node_modules/mongodb-memory-server');
  const { RedisMemoryServer } = req('node_modules/redis-memory-server');

  const mongod = await MongoMemoryServer.create();
  const redisd = await RedisMemoryServer.create();
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosquest-load-'));
  const port = await freePort();

  Object.assign(process.env, {
    MONGODB_URI: mongod.getUri(),
    REDIS_URL: `redis://${await redisd.getHost()}:${await redisd.getPort()}`,
    NODE_ENV: 'test',
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    JWT_SECRET: 'load-test-only-secret',
    JWT_EXPIRES_IN: '1h',
    PORT: String(port),
    UPLOAD_DIR: uploadDir,
    PUBLIC_UPLOAD_PATH: '/uploads',
    LIVEKIT_URL: 'wss://load.livekit.invalid',
    LIVEKIT_API_KEY: 'load-api-key',
    LIVEKIT_API_SECRET: 'load-api-secret-with-enough-entropy',
  });

  const log = console.log;
  console.log = () => {}; // keep the server's own logging out of the report
  const { startServer } = req('server.js');
  await startServer();
  console.log = log;

  const User = req('src/models/User.js');
  const { signToken } = req('src/utils/token.js');
  const { getIO } = req('src/realtime/socket.js');

  // Count every Socket.IO frame the server writes, by event name.
  const stats = { frames: 0, bytes: 0, byEvent: {} };
  getIO().engine.on('connection', (rawSocket) => {
    rawSocket.on('packetCreate', (packet) => {
      if (packet.type !== 'message' || typeof packet.data !== 'string') return;
      const bytes = Buffer.byteLength(packet.data);
      const name = (/^\d+\["([^"]+)"/.exec(packet.data) || [])[1] || 'other';
      stats.frames += 1;
      stats.bytes += bytes;
      const entry = (stats.byEvent[name] ||= { frames: 0, bytes: 0 });
      entry.frames += 1;
      entry.bytes += bytes;
    });
  });

  // The histogram records the time between samples, so the sampling interval
  // itself is subtracted below: 0 ms means the loop was never held up.
  const ELD_RESOLUTION_MS = 5;
  const eld = monitorEventLoopDelay({ resolution: ELD_RESOLUTION_MS });
  eld.enable();

  process.on('message', async (message) => {
    if (message.type === 'setup') {
      const suffix = `${Date.now().toString(36)}`;
      const docs = Array.from({ length: message.n }, (_, i) => ({
        profile: {
          username: `load${i}_${suffix}`,
          usernameNormalized: `load${i}_${suffix}`,
          firstName: 'Load',
          lastName: `User${i}`,
          avatarKey: 'green-knight',
        },
        onboardingComplete: true,
        faction: 'ascendants',
      }));
      const users = await User.insertMany(docs);
      process.send({
        type: 'users',
        users: users.map((user) => ({
          id: String(user._id),
          username: user.profile.username,
          token: signToken(String(user._id), user.tokenVersion),
        })),
      });
    } else if (message.type === 'reset') {
      stats.frames = 0;
      stats.bytes = 0;
      stats.byEvent = {};
      eld.reset();
      process.send({ type: 'reset' });
    } else if (message.type === 'stats') {
      const ms = (ns) => Math.max(0, Math.round((ns / 1e6 - ELD_RESOLUTION_MS) * 10) / 10);
      process.send({
        type: 'stats',
        stats: {
          ...stats,
          eventLoopDelayMs: {
            p50: ms(eld.percentile(50)),
            p99: ms(eld.percentile(99)),
            max: ms(eld.max),
            mean: ms(eld.mean),
          },
          rssMb: Math.round(process.memoryUsage().rss / 1048576),
        },
      });
    } else if (message.type === 'exit') {
      console.error = () => {}; // sockets closing during shutdown log noise
      await mongod.stop().catch(() => {});
      await redisd.stop().catch(() => {});
      fs.rmSync(uploadDir, { recursive: true, force: true });
      process.exit(0);
    }
  });

  process.send({ type: 'ready', port });
}

// ==========================================================================
// PARENT: the driver (the people in the call)
// ==========================================================================

function startBackend() {
  const proc = fork(__filename, ['--child', '--backend', BACKEND], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const waiters = new Map();
  proc.on('message', (message) => {
    const resolve = waiters.get(message.type);
    if (resolve) {
      waiters.delete(message.type);
      resolve(message);
    }
  });
  const next = (type) => new Promise((resolve) => waiters.set(type, resolve));
  const ask = (message, replyType) => {
    const reply = next(replyType);
    proc.send(message);
    return reply;
  };
  return { proc, next, ask };
}

async function runOnce(n, { batch, timeoutMs }) {
  const { io } = require(path.join(BACKEND, 'node_modules/socket.io-client'));
  const backend = startBackend();
  const { port } = await backend.next('ready');
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, urlPath, token, body) {
    const response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: response.status, data, bytes: Buffer.byteLength(text) };
  }

  const { users } = await backend.ask({ type: 'setup', n }, 'users');

  // One socket per person, like N phones with the app open.
  let clientEvents = 0;
  const sockets = await Promise.all(users.map((user) => new Promise((resolve, reject) => {
    const socket = io(baseUrl, { auth: { token: user.token }, transports: ['websocket'], reconnection: false });
    socket.onAny(() => { clientEvents += 1; });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  })));

  await backend.ask({ type: 'reset' }, 'reset');

  const result = { n, batch, joined: 0, seconds: null, finished: false, acceptRetries: 0, errors: {}, httpResponseBytes: 0 };
  const countError = (status, message) => {
    const key = `${status} ${message || ''}`.trim();
    result.errors[key] = (result.errors[key] || 0) + 1;
  };

  const started = Date.now();
  const deadline = started + timeoutMs;

  async function accept(callId, user) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const r = await request('POST', `/api/calls/${callId}/accept`, user.token);
      result.httpResponseBytes += r.bytes;
      if (r.status === 200) {
        result.joined += 1;
        return true;
      }
      if (r.status === 409 && Date.now() < deadline) {
        result.acceptRetries += 1;
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30));
        continue;
      }
      countError(r.status, r.data?.error);
      return false;
    }
    countError(409, 'gave up after 10 tries');
    return false;
  }

  const [caller, first, ...rest] = users;
  try {
    const dm = await request('POST', '/api/chats/dm', caller.token, { username: first.username });
    const start = await request('POST', `/api/chats/${dm.data.chat.id}/calls`, caller.token, { type: 'audio' });
    if (start.status !== 201) throw new Error(`start failed: ${start.status} ${JSON.stringify(start.data)}`);
    const callId = start.data.call.id;
    result.joined = 1; // the caller
    await accept(callId, first);

    for (let i = 0; i < rest.length; i += batch) {
      if (Date.now() > deadline) break;
      const group = rest.slice(i, i + batch);
      const invite = await request('POST', `/api/calls/${callId}/invite`, caller.token, { userIds: group.map((u) => u.id) });
      result.httpResponseBytes += invite.bytes;
      if (invite.status !== 200) {
        countError(invite.status, invite.data?.error);
        break;
      }
      const invited = new Set(invite.data.invited);
      (invite.data.skipped || []).forEach((entry) => countError('skipped', entry.reason));
      await Promise.all(group.filter((u) => invited.has(u.id)).map((u) => accept(callId, u)));
    }
    result.seconds = (Date.now() - started) / 1000;
    result.finished = result.joined === n;

    // Let any delayed (coalesced) broadcasts go out before counting frames.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const check = await request('GET', `/api/calls/${callId}`, caller.token);
    result.serverJoined = (check.data?.call?.members || []).filter((m) => m.status === 'joined').length;
    result.maxParticipants = check.data?.call?.maxParticipants ?? null;
  } catch (error) {
    result.crash = error.message;
  }

  const { stats } = await backend.ask({ type: 'stats' }, 'stats');
  result.server = stats;
  result.clientEventsReceived = clientEvents;

  sockets.forEach((socket) => socket.close());
  await new Promise((resolve) => setTimeout(resolve, 500));
  backend.proc.send({ type: 'exit' });
  await new Promise((resolve) => backend.proc.once('exit', resolve));
  return result;
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function parent() {
  const sizes = String(arg('n', '8,50,200,500')).split(',').map(Number).filter(Boolean);
  const batch = Number(arg('batch', 50));
  const timeoutMs = Number(arg('timeout', 300)) * 1000;
  const results = [];

  console.log(`backend: ${BACKEND}`);
  for (const n of sizes) {
    const r = await runOnce(n, { batch: Math.min(batch, Math.max(1, n - 2)), timeoutMs });
    results.push(r);
    const s = r.server;
    console.log(
      `N=${n}: ${r.finished ? 'all in' : `NOT all in (${r.joined}/${n})`} in ${r.seconds ?? '-'} s` +
        ` | server joined ${r.serverJoined ?? '-'} | retries ${r.acceptRetries}` +
        ` | frames ${s.frames} (${mb(s.bytes)})` +
        ` | call:updated ${s.byEvent['call:updated']?.frames || 0} (${mb(s.byEvent['call:updated']?.bytes || 0)})` +
        ` | call:incoming ${s.byEvent['call:incoming']?.frames || 0} (${mb(s.byEvent['call:incoming']?.bytes || 0)})` +
        ` | loop delay p50 ${s.eventLoopDelayMs.p50} / p99 ${s.eventLoopDelayMs.p99} / max ${s.eventLoopDelayMs.max} ms` +
        ` | rss ${s.rssMb} MB` +
        (Object.keys(r.errors).length ? ` | errors ${JSON.stringify(r.errors)}` : '') +
        (r.crash ? ` | crash: ${r.crash}` : '')
    );
  }

  const out = arg('json', null);
  if (out) require('fs').writeFileSync(out, JSON.stringify(results, null, 2));
  process.exit(0);
}

if (process.argv.includes('--child')) {
  child().catch((error) => {
    console.error('[callLoad child]', error);
    process.exit(1);
  });
} else {
  parent().catch((error) => {
    console.error('[callLoad]', error);
    process.exit(1);
  });
}
