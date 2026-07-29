const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const notificationModel = require('../models/notificationModel');
const { signToken } = require('../utils/token');

const WELCOME_MESSAGE =
  "🎉 Welcome to CosQuest! 🥷✨ Your account is officially live. This is your new home for everything you love — real-world quests, your faction, your people, all in one place. 🗺️💜 So glad you're here — let's go make some legendary memories. 🏆";

/**
 * NOTE: The front-end onboarding step 0 (Continue with Google / Apple / email)
 * is intentionally NOT implemented here - per scope, we start at step 1
 * (profile creation). Email verification is intentionally skipped, as requested.
 *
 * Signup is just the first step of one continuous onboarding process, not a
 * separate thing: it creates the account, and every onboarding step after it
 * is identified by the plain `email` the client already has (no token, and
 * no server-generated id handed out as a stand-in credential either). A
 * token is only ever issued at login, and login itself now refuses to
 * proceed until onboardingComplete is true - onboarding has to be finished
 * before the account can actually be logged into.
 */

async function signup(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters.' });
  }

  const existing = await userModel.findByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userModel.createUser({ email, passwordHash });

  // Their first-ever notification - can't actually be seen until login
  // succeeds (which now requires onboarding to be complete first), regardless
  // of the notificationsEnabled preference (chosen during onboarding itself).
  await notificationModel.createForUser(user._id, WELCOME_MESSAGE);

  // No token here on purpose - signup only creates the account. A token is
  // only ever issued at login, and only once onboarding is complete.
  return res.status(201).json({
    message: 'Account created. Complete onboarding using your email, then log in.',
    user: userModel.sanitize(user),
  });
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!user.onboardingComplete) {
    return res.status(403).json({ error: 'Please complete onboarding before logging in.' });
  }

  const token = signToken(user.id, user.tokenVersion);
  return res.json({
    message: 'Logged in successfully.',
    token,
    user: userModel.sanitize(user),
  });
}

/**
 * POST /api/auth/logout (protected - requires the token being logged out)
 * Stateless JWTs can't be "deleted" server-side, so logout works by bumping
 * tokenVersion: any token already issued (including the one used to call
 * this endpoint) stops passing requireAuth's tokenVersion check immediately.
 * This logs out every device/session at once - there's no per-device
 * session tracking in this build, only a single bearer token per user.
 */
async function logout(req, res) {
  const updated = await userModel.updateUser(req.userId, (user) => {
    user.tokenVersion += 1;
  });
  return res.json({ message: 'Logged out successfully.', user: userModel.sanitize(updated) });
}

module.exports = { signup, login, logout };
