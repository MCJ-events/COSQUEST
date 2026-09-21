require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const apiRoutes = require('./src/routes');
const shareRoutes = require('./src/routes/shareRoutes');
const { connectDB } = require('./src/config/db');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');
const { asyncHandler } = require('./src/utils/asyncHandler');
const { renderPostShare, renderChatShare } = require('./src/controllers/contentShareController');
const { initSocket } = require('./src/realtime/socket');

function buildApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // Apple OAuth callback uses form_post.
  app.use(cookieParser(process.env.OAUTH_COOKIE_SECRET || process.env.JWT_SECRET));

  app.get('/health', (req, res) => res.json({ ok: true, service: 'cosquest-backend' }));

  // Shareable profile pages - real HTML with Open Graph tags, not JSON, so a
  // link pasted into Instagram/Facebook/etc. renders a rich preview.
  app.use('/u', shareRoutes);
  app.get('/p/:postId', asyncHandler(renderPostShare));
  app.get('/c/:conversationId', renderChatShare);
  app.get('/c/:conversationId/m/:messageId', renderChatShare);

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

  // Socket.IO needs the raw http.Server (not the Express app) so it can
  // upgrade HTTP connections to WebSocket on the same port - REST and
  // real-time traffic share one listener, no second port to expose/CORS.
  const httpServer = http.createServer(app);
  initSocket(httpServer);

  return new Promise((resolve) => {
    httpServer.listen(PORT, () => {
      console.log(`CosQuest backend listening on http://localhost:${PORT}`);
      resolve(httpServer);
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
