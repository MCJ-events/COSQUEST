// Focused HTTP integration suite: actual MongoDB, no Redis/server processes required.
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const uploadPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cosquest-planning-'));
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'planning-tests-only-secret';
  process.env.SPARKS_ENGINE = 'legacy';
  process.env.PUSH_ENABLED = '0';
  process.env.UPLOAD_DIR = uploadPath;
  process.env.LIVEKIT_URL = 'wss://test.livekit.invalid';
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret-with-enough-entropy';
  delete process.env.APP_WEB_URL;
  let mongo, server;
  try {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    // Mount the production routers without importing unrelated auth rate
    // limiters (those eagerly connect to Redis during server module loading).
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api', require('../src/routes/projectRoutes'));
    app.use('/api', require('../src/routes/scheduledCallRoutes'));
    app.use(require('../src/middleware/errorHandler').errorHandler);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const result = await require('./projectsCalls').run(`http://127.0.0.1:${server.address().port}`);
    process.exitCode = result.fail ? 1 : 0;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    require('../src/sparks').stop();
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
    fs.rmSync(uploadPath, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
