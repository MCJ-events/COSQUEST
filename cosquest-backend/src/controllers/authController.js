const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const notificationModel = require('../models/notificationModel');
const { signToken, generateSessionId } = require('../utils/token');
const { revokeSession } = require('../realtime/socket');
const { isValidEmail, isValidUsername, passwordError } = require('../utils/validation');

const WELCOME_MESSAGE =
  "🎉 Welcome to CosQuest! 🥷✨ Your account is officially live. This is your new home for everything you love — real-world quests, your faction, your people, all in one place. 🗺️💜 So glad you're here — let's go make some legendary memories. 🏆";

/**
 * Signup starts a session immediately. Save its token and use it throughout
 * onboarding; the same token unlocks the app when onboarding is complete.
 * Feature routes still requireCompletedOnboarding. OAuth has its own controller.
 */

async function signup(req, res) {
  const { email, username, identifier, password, confirmPassword } = req.body;

  const signUpIdentifier = identifier || email || username;

  if (!signUpIdentifier || !password || confirmPassword === undefined) {
    return res.status(400).json({
      error: 'email or username, password, and confirmPassword are required.',
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      error: 'password and confirmPassword must match.',
    });
  }

  if (!isValidEmail(signUpIdentifier) && !isValidUsername(signUpIdentifier)) {
    return res.status(400).json({
      error:
        'Provide a valid email address or a username with 3-20 letters, numbers, or underscores.',
    });
  }

  const invalidPassword = passwordError(password);

  if (invalidPassword) {
    return res.status(400).json({
      error: invalidPassword,
    });
  }

  const registeringWithEmail = isValidEmail(signUpIdentifier);

  const existing = registeringWithEmail
    ? await userModel.findByEmail(signUpIdentifier)
    : await userModel.findByUsername(signUpIdentifier);

  /*
   * Existing account that has not completed onboarding.
   * Allow the user to continue onboarding and authenticate them.
   */
  if (existing) {
    if (existing.onboardingComplete) {
      return res.status(409).json({
        error: registeringWithEmail
          ? 'An account with this email already exists.'
          : 'That username is already taken.',
      });
    }

    // Resuming issues a session, so require the existing account's password.
    if (!existing.passwordHash || !(await bcrypt.compare(password, existing.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email/username or password.' });
    }
    const updated = existing;

    const sessionId = generateSessionId();
    updated.currentSessionId = sessionId;
    await updated.save();
    revokeSession(updated.id);
    const token = signToken(updated.id, updated.tokenVersion, sessionId);

    return res.status(200).json({
      message:
        'Welcome back - this account already exists but onboarding is not finished yet. Continuing where you left off.',
      resumed: true,
      token,
      onboardingRequired: true,
      user: userModel.sanitize(updated),
    });
  }

  /*
   * Create a completely new account.
   */
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await userModel.createUser({
    email: registeringWithEmail ? signUpIdentifier : undefined,
    username: registeringWithEmail ? undefined : signUpIdentifier,
    passwordHash,
  });

  await notificationModel.createForUser(user._id, WELCOME_MESSAGE);

  const sessionId = generateSessionId();
  user.currentSessionId = sessionId;
  await user.save();
  const token = signToken(user.id, user.tokenVersion, sessionId);

  return res.status(201).json({
    message: 'Account created. Continue onboarding.',
    resumed: false,
    token,
    onboardingRequired: true,
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
  //
  // Rotating the session here is what enforces single-device sign-in: it
  // invalidates whatever token was issued to any other device the moment
  // this login succeeds (see requireAuth's sessionId check).
  const sessionId = generateSessionId();
  user.currentSessionId = sessionId;
  await user.save();
  revokeSession(user.id);
  const token = signToken(user.id, user.tokenVersion, sessionId);
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
