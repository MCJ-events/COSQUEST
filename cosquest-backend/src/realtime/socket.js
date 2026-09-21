const { Server } = require('socket.io');
const { verifyToken } = require('../utils/token');
const userModel = require('../models/userModel');
// NOT required at top level: chatController.js requires this file back (to
// emit events after a mutation), so requiring it here up-front would create
// a load-order circle. Required lazily inside initSocket() instead, which
// only ever runs after the whole app - including chatController - has
// already finished loading (server.js calls it from startServer()).

/**
 * Real-time layer for everything that needs an instant push instead of the
 * client polling REST: new/edited/deleted chat messages, reactions, read
 * receipts, typing indicators, and (optionally) notifications.
 *
 * This does NOT replace the REST API - every mutation still goes through
 * the normal controllers (auth, validation, persistence). Socket.IO is only
 * used to fan the *result* of a successful REST call out to whoever else is
 * looking at that conversation right now. If a client is offline when an
 * event fires, it simply falls back to what it gets from REST (GET
 * /api/chats, GET /api/chats/:id/messages) the next time it loads.
 *
 * Rooms:
 *  - `user:<userId>`         every socket for a given account joins this on
 *                             connect - used for account-wide pushes
 *                             (notifications, DM previews) that don't need
 *                             the client to have a conversation open.
 *  - `conversation:<id>`     joined on request (`conversation:join`) after
 *                             the same membership check the REST layer uses
 *                             (loadConversationForUser), so someone can't
 *                             listen in on a faction room they're not in or
 *                             a DM that isn't theirs.
 */

let io = null;

function initSocket(httpServer) {
  const { loadConversationForUser } = require('../controllers/chatController');

  io = new Server(httpServer, {
    cors: { origin: '*' }, // tighten to your real frontend origin(s) in production
  });

  // Handshake auth: client connects with `io(url, { auth: { token: '<JWT>' } })`,
  // the same bearer token already used for REST. Mirrors requireAuth in
  // src/middleware/auth.js, including the tokenVersion/logout check.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Missing auth token'));

      const decoded = verifyToken(token);
      const user = await userModel.findById(decoded.sub);
      if (!user) return next(new Error('User no longer exists'));
      if (decoded.tokenVersion !== user.tokenVersion) return next(new Error('Session logged out'));

      socket.userId = String(user._id);
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);

    socket.on('conversation:join', async (conversationId, ack) => {
      const user = await userModel.findById(socket.userId);
      const { conversation, error } = user ? await loadConversationForUser(conversationId, user) : { error: { message: 'User no longer exists.' } };
      if (error) return ack?.({ ok: false, error: error.message });
      socket.join(`conversation:${conversation.id}`);
      ack?.({ ok: true });
    });

    socket.on('conversation:leave', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Typing indicator: purely ephemeral, never persisted. `payload` is just
    // the conversationId; we trust room membership (join already checked
    // access) rather than re-validating on every keystroke.
    socket.on('typing:start', (conversationId) => {
      socket.to(`conversation:${conversationId}`).emit('typing:start', { conversationId, userId: socket.userId });
    });
    socket.on('typing:stop', (conversationId) => {
      socket.to(`conversation:${conversationId}`).emit('typing:stop', { conversationId, userId: socket.userId });
    });
  });

  return io;
}

function getIO() {
  return io;
}

/** Push to everyone currently viewing a conversation (has joined its room). */
function emitToConversation(conversationId, event, payload) {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
}

/** Push to every connected socket for one account, regardless of what they have open. */
function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Push the same event to several accounts in one call. */
function emitToUsers(userIds, event, payload) {
  if (!userIds?.length) return;
  io?.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
}

module.exports = { initSocket, getIO, emitToConversation, emitToUser, emitToUsers };
