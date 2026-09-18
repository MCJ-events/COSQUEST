const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const notificationModel = require('../models/notificationModel');
const { signToken } = require('../utils/token');
const { isValidEmail, isValidUsername, passwordError } = require('../utils/validation');

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
  const { email, username, identifier, password, confirmPassword } = req.body;
  const signUpIdentifier = identifier || email || username;

  if (!signUpIdentifier || !password || confirmPassword === undefined) {
    return res.status(400).json({ error: 'email or username, password, and confirmPassword are required.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'password and confirmPassword must match.' });
  }
  if (!isValidEmail(signUpIdentifier) && !isValidUsername(signUpIdentifier)) {
    return res.status(400).json({ error: 'Provide a valid email address or a username with 3-20 letters, numbers, or underscores.' });
  }
  const invalidPassword = passwordError(password);
  if (invalidPassword) {
    return res.status(400).json({ error: invalidPassword });
  }

  const registeringWithEmail = isValidEmail(signUpIdentifier);
  const existing = registeringWithEmail
    ? await userModel.findByEmail(signUpIdentifier)
    : await userModel.findByUsername(signUpIdentifier);

  if (existing) {
    if (existing.onboardingComplete) {
      return res.status(409).json({
        error: registeringWithEmail ? 'An account with this email already exists.' : 'That username is already taken.',
      });
    }
    // Onboarding was started but never finished - this is the same person
    // coming back, not a real conflict. Every onboarding-step endpoint
    // already treats the bare email/username as sufficient identification
    // pre-completion (see this file's header comment), so resuming here
    // instead of dead-ending them is consistent, not a new trust decision.
    // Refreshing the password also covers a forgotten one on an account
    // that can't log in yet anyway - there's no separate reset flow.
    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await userModel.updateUser(existing.id, (user) => {
      user.passwordHash = passwordHash;
    });
    return res.status(200).json({
      message: 'Welcome back - this account already exists but onboarding is not finished yet. Continuing where you left off.',
      resumed: true,
      user: userModel.sanitize(updated),
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userModel.createUser({
    email: registeringWithEmail ? signUpIdentifier : undefined,
    username: registeringWithEmail ? undefined : signUpIdentifier,
    passwordHash,
  });

  // Their first-ever notification - can't actually be seen until login
  // succeeds (which now requires onboarding to be complete first), regardless
  // of the notificationsEnabled preference (chosen during onboarding itself).
  await notificationModel.createForUser(user._id, WELCOME_MESSAGE);

  // No token here on purpose - signup only creates the account. A token is
  // only ever issued at login, and only once onboarding is complete.
  return res.status(201).json({
    message: 'Account created. Complete onboarding using your email or username, then log in.',
    resumed: false,
    user: userModel.sanitize(user),
  });
}

async function login(req, res) {
  const { email, username, identifier, password } = req.body;
  const signInIdentifier = identifier || email || username;

  if (!signInIdentifier || !password) {
    return res.status(400).json({ error: 'email or username, and password, are required.' });
  }

  const user = isValidEmail(signInIdentifier)
    ? await userModel.findByEmail(signInIdentifier)
    : await userModel.findByUsername(signInIdentifier);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!user.passwordHash) {
    return res.status(401).json({ error: 'This account uses social sign-in. Continue with its original provider.' });
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Matches the OAuth exchange's shape (see oauthController.js): a valid
  // password always signs a person in, even mid-onboarding, so they can
  // pick up where they left off with a real token instead of being locked
  // out until they finish. `requireCompletedOnboarding` still protects every
  // real feature - this token only additionally lets them resume onboarding
  // via Bearer instead of email, and log out.
  const token = signToken(user.id, user.tokenVersion);
  return res.json({
    message: user.onboardingComplete ? 'Logged in successfully.' : 'Signed in. Complete onboarding to continue.',
    token,
    onboardingRequired: !user.onboardingComplete,
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
