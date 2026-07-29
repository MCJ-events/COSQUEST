require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const apiRoutes = require('./src/routes');
const { connectDB } = require('./src/config/db');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');

function buildApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve locally-stored avatar photos (local disk fallback - see README)
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
  app.use(process.env.PUBLIC_UPLOAD_PATH || '/uploads', express.static(uploadDir));

  // Serve the bundled preset-avatar illustrations (see src/models/avatarModel.js)
  app.use('/avatars', express.static(path.resolve(__dirname, 'public/avatars')));

  app.get('/health', (req, res) => res.json({ ok: true, service: 'cosquest-backend' }));

  app.use('/api', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * Connects to MongoDB, then starts listening. Exported (rather than just
 * run at the bottom of this file) so test/runWithMemoryMongo.js can boot
 * the exact same app against an ephemeral in-memory MongoDB instead of a
 * real one - see README "Testing".
 */
async function startServer() {
  await connectDB();
  const app = buildApp();
  const PORT = process.env.PORT;

  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`CosQuest backend listening on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

module.exports = { buildApp, startServer };
