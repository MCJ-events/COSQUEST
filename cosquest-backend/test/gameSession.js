/**
 * The CostQuest game's one login: GET /api/game/session (src/routes/gameRoutes.js).
 *
 * Standalone, on its own in-memory MongoDB and Redis like `npm test`:
 *   node test/gameSession.js
 * (Kept out of runWithMemoryMongo.js for now so this change touches no file
 * another open PR touches; it can join that list once they have merged.)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { RedisMemoryServer } = require('redis-memory-server');

const RATE_MAX = 6;

async function main() {
  const mongod = await MongoMemoryServer.create();
  const redisd = await RedisMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.REDIS_URL = `redis://${await redisd.getHost()}:${await redisd.getPort()}`;
  process.env.NODE_ENV = 'test';
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';
  process.env.PORT = '4117';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cosquest-game-session-'));
  process.env.PUBLIC_UPLOAD_PATH = '/uploads';
  process.env.LIVEKIT_URL = 'wss://test.livekit.invalid';
  process.env.LIVEKIT_API_KEY = 'test-api-key';
  process.env.LIVEKIT_API_SECRET = 'test-api-secret-with-enough-entropy';
  // The limiter is off in tests unless this is set: here it is, small.
  process.env.GAME_SESSION_RATE_MAX = String(RATE_MAX);

  const { startServer } = require('../server');
  const { disconnectDB } = require('../src/config/db');
  const { disconnectRedis } = require('../src/config/redis');
  const { closeSocket } = require('../src/realtime/socket');
  const server = await startServer();
  const base = `http://localhost:${process.env.PORT}`;

  const User = require('../src/models/User');
  const { signToken, generateSessionId } = require('../src/utils/token');
  let pass = 0;
  let fail = 0;
  const check = (ok, name, value) => {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)); }
  };
  // Each check from its own address, as the limiter sees it (trust proxy),
  // so the session checks are not themselves rate limited.
  let ip = 1;
  const ask = async (token, from) => {
    const response = await fetch(`${base}/api/game/session`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Forwarded-For': from || `203.0.113.${ip++}`,
      },
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };

  try {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const make = async (index) => {
      const user = await User.create({
        profile: {
          username: `Gam${index}${suffix}`,
          usernameNormalized: `gam${index}${suffix}`,
          firstName: 'Gam',
          lastName: `User${index}`,
          avatarKey: 'green-knight',
        },
        onboardingComplete: true,
        faction: 'icons',
      });
      return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
    };
    const a = await make(1);
    const c = await make(2);

    console.log('\n--- game session (one login) ---');
    const me = await ask(a.token);
    check(me.status === 200 && me.data.user.id === a.id && me.data.user.username === a.username
      && me.data.user.faction === 'icons', 'a live session answers who it is', me.data);
    check(me.data.user.email === undefined && me.data.user.tokenVersion === undefined
      && me.data.user.currentSessionId === undefined, 'and nothing private', me.data);
    check(me.headers.get('cache-control') === 'no-store', 'the answer is never cached', me.headers.get('cache-control'));
    check((await ask(null)).status === 401, 'no token is refused');
    check((await ask(`${a.token}x`)).status === 401, 'a forged token is refused');

    // A sign-in on another phone rotates the session id: the old token is dead.
    const sessionId = generateSessionId();
    await User.updateOne({ _id: c.id }, { $set: { currentSessionId: sessionId } });
    check((await ask(c.token)).status === 401, 'a session replaced by a sign-in elsewhere is refused');
    check((await ask(signToken(c.id, 0, sessionId))).status === 200, 'the current session is accepted');
    // Logging out bumps tokenVersion: every earlier token is dead.
    await User.updateOne({ _id: c.id }, { $inc: { tokenVersion: 1 } });
    check((await ask(signToken(c.id, 0, sessionId))).status === 401, 'a logged-out session is refused');

    console.log('\n--- rate limit (per address) ---');
    const one = '198.51.100.7';
    const codes = [];
    for (let i = 0; i < RATE_MAX + 1; i += 1) codes.push((await ask(a.token, one)).status);
    check(codes.slice(0, RATE_MAX).every((s) => s === 200) && codes[RATE_MAX] === 429,
      `the ${RATE_MAX + 1}th check from one address in 5 minutes is refused`, codes);
    // Forged tokens count too: a guesser cannot hammer the check.
    const other = '198.51.100.8';
    const bad = [];
    for (let i = 0; i < RATE_MAX + 1; i += 1) bad.push((await ask('nope', other)).status);
    check(bad[RATE_MAX] === 429, 'forged tokens count against the address', bad);
    check((await ask(a.token, '198.51.100.9')).status === 200, 'another address is unaffected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeSocket?.();
    await disconnectDB?.();
    await disconnectRedis?.();
    await mongod.stop();
    await redisd.stop();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
