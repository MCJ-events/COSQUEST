/**
 * Runs the full smoke suite against a throwaway server instance backed by
 * an ephemeral, real, in-memory MongoDB (downloaded/managed automatically
 * by mongodb-memory-server - no MongoDB install, Atlas account, or
 * already-running server required). This is what `npm test` runs.
 *
 * It does NOT touch your real .env / MONGODB_URI / PORT - everything here
 * is set explicitly before the app is required, so it can safely run
 * alongside (or instead of) a real dev server without colliding.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

async function main() {
  const mongod = await MongoMemoryServer.create();

  // Isolated per-run temp folder so the smoke suite's real avatar-photo
  // upload test doesn't leave junk files behind in the project's own uploads/.
  const tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosquest-test-uploads-'));

  process.env.MONGODB_URI = mongod.getUri();
  process.env.NODE_ENV = 'test';
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'; // no real Cloudinary call in tests
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production';
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
  process.env.PORT = '4111'; // deliberately not 4000, so it can't collide with a real dev server
  process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || tmpUploadDir;
  process.env.PUBLIC_UPLOAD_PATH = process.env.PUBLIC_UPLOAD_PATH || '/uploads';

  const { startServer } = require('../server');
  const { disconnectDB } = require('../src/config/db');
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
    await mongod.stop();
    fs.rmSync(tmpUploadDir, { recursive: true, force: true });
  }

  console.log(`[integration] ran against an ephemeral in-memory MongoDB - ${result.pass} passed, ${result.fail} failed`);
  process.exit(result.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Integration test run failed:', err);
  process.exit(1);
});
