const User = require('./User');

/**
 * Same public function names/signatures as the old JSON-file version (see
 * README "Swapping in a real database later") - every controller calls
 * these exactly as before. The only difference callers must account for:
 * these are now all `async` (they hit MongoDB), so every call site needs
 * `await`.
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createUser({ email, passwordHash }) {
  return User.create({ email: email.toLowerCase().trim(), passwordHash });
}

async function findByEmail(email) {
  return User.findOne({ email: email.toLowerCase().trim() });
}

async function findById(id) {
  try {
    return await User.findById(id);
  } catch (err) {
    return null; // malformed id (e.g. not a valid ObjectId) - treat like "not found"
  }
}

async function isUsernameTaken(username, excludeUserId) {
  const query = { 'profile.username': new RegExp(`^${escapeRegex(username)}$`, 'i') };
  if (excludeUserId) query._id = { $ne: excludeUserId };
  const existing = await User.findOne(query);
  return Boolean(existing);
}

/**
 * Loads the user, hands the live Mongoose document to patchFn to mutate
 * in place (e.g. `user.profile.firstName = 'x'`), then saves it. This
 * preserves the exact same call pattern every controller already used
 * against the old JSON store.
 */
async function updateUser(id, patchFn) {
  const user = await User.findById(id);
  if (!user) return null;
  await patchFn(user);
  await user.save();
  return user;
}

function sanitize(user) {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : user;
  const { passwordHash, tokenVersion, __v, _id, ...safe } = obj;
  safe.id = String(_id);
  return safe;
}

module.exports = {
  createUser,
  findByEmail,
  findById,
  isUsernameTaken,
  updateUser,
  sanitize,
};
