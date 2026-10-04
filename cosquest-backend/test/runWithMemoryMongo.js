/**
 * Runs the full smoke suite against a throwaway server instance backed by
 * an ephemeral, real, in-memory MongoDB (downloaded/managed automatically
 * by mongodb-memory-server) and an ephemeral, real Redis (same idea, via
 * redis-memory-server) - no MongoDB or Redis install, Atlas/cloud account,
 * or already-running server required. This is what `npm test` runs.
 *
 * It does NOT touch your real .env / MONGODB_URI / REDIS_URL / PORT -
 * everything here is set explicitly before the app is required, so it can
 * safely run alongside (or instead of) a real dev server without colliding.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { RedisMemoryServer } = require('redis-memory-server');

async function main() {
  const mongod = await MongoMemoryServer.create();
  const redisd = await RedisMemoryServer.create();

  // Isolated per-run temp folder so the smoke suite's real avatar-photo
  // upload test doesn't leave junk files behind in the project's own uploads/.
  const tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosquest-test-uploads-'));

  process.env.MONGODB_URI = mongod.getUri();
  process.env.REDIS_URL = `redis://${await redisd.getHost()}:${await redisd.getPort()}`;
  process.env.NODE_ENV = 'test';
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'; // no real Cloudinary call in tests
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
  process.env.PORT = '4111'; // deliberately not 4000, so it can't collide with a real dev server
  process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || tmpUploadDir;
  process.env.PUBLIC_UPLOAD_PATH = process.env.PUBLIC_UPLOAD_PATH || '/uploads';
  process.env.LIVEKIT_URL = 'wss://test.livekit.invalid';
  process.env.LIVEKIT_API_KEY = 'test-api-key';
  process.env.LIVEKIT_API_SECRET = 'test-api-secret-with-enough-entropy';

  // Attachment fixtures use fake hosted audio; never submit them to Deepgram.
  require('../src/utils/transcribeAudio').transcribeAudio = async () => 'Test voice note.';
  const { startServer } = require('../server');
  const { disconnectDB } = require('../src/config/db');
  const { disconnectRedis } = require('../src/config/redis');
  const { closeSocket } = require('../src/realtime/socket');
  const server = await startServer();

  const { run } = require('./smoke');
  let result = { pass: 0, fail: 1 };
  try {
    result = await run(`http://localhost:${process.env.PORT}`);
    const additions = await require('./communitySettings').run(`http://localhost:${process.env.PORT}`);
    result.pass += additions.pass;
    result.fail += additions.fail;
    const attachments = await require('./chatAttachments').run(`http://localhost:${process.env.PORT}`);
    result.pass += attachments.pass;
    result.fail += attachments.fail;
    const discovery = await require('./discoverUsers').run(`http://localhost:${process.env.PORT}`);
    result.pass += discovery.pass;
    result.fail += discovery.fail;
    const calls = await require('./calls').run(`http://localhost:${process.env.PORT}`);
    result.pass += calls.pass;
    result.fail += calls.fail;
    const oauthRedirect = await require('./oauthRedirect').run(`http://localhost:${process.env.PORT}`);
    result.pass += oauthRedirect.pass;
    result.fail += oauthRedirect.fail;
    const avatarCatalog = await require('./avatarCatalog').run(`http://localhost:${process.env.PORT}`);
    result.pass += avatarCatalog.pass;
    result.fail += avatarCatalog.fail;
    const postShares = await require('./postShares').run(`http://localhost:${process.env.PORT}`);
    result.pass += postShares.pass;
    result.fail += postShares.fail;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeSocket(); // quits the adapter's dedicated pub/sub Redis connections - see socket.js
    await disconnectDB();
    await disconnectRedis();
    await mongod.stop();
    await redisd.stop();
    fs.rmSync(tmpUploadDir, { recursive: true, force: true });
  }

  console.log(`[integration] ran against an ephemeral in-memory MongoDB + Redis - ${result.pass} passed, ${result.fail} failed`);
  process.exit(result.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Integration test run failed:', err);
  process.exit(1);
});
