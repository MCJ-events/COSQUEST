const mongoose = require('mongoose');
const { AVATARS } = require('./avatarModel');

/**
 * Mongoose schema - the MongoDB-backed replacement for the old JSON-file
 * user record. Field shape is unchanged from before so every controller
 * that reads/writes `user.profile.*`, `user.preferences.*`, etc. keeps
 * working untouched; only userModel.js's internals changed.
 *
 * `tokenVersion` exists purely to support logout (see src/utils/token.js
 * and POST /api/auth/logout): every issued JWT embeds the tokenVersion that
 * was current at sign-time, and requireAuth rejects a token whose embedded
 * version no longer matches the user's current one. Logging out just bumps
 * this number, which invalidates every token issued before that moment.
 */
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    // Password is optional for accounts created with Google or Apple OAuth.
    passwordHash: { type: String, default: undefined },
    tokenVersion: { type: Number, default: 0 },

    profile: {
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
      username: { type: String, default: '' },
      // Stored separately so MongoDB can enforce a case-insensitive unique username.
      usernameNormalized: { type: String, default: undefined },
      age: { type: Number, default: null },
      gender: { type: String, default: '' },
      bio: { type: String, default: '', trim: true, maxlength: 500 },
      category: { type: String, default: null },
      showCategoryOnProfile: { type: Boolean, default: true },
      avatarKey: { type: String, default: AVATARS[0].key },
      avatarPhotoUrl: { type: String, default: null },
    },

    faction: { type: String, default: null },
    interests: { type: [String], default: [] },
    // The balance is read by the profile page now. A points ledger/reward
    // system can safely award or deduct points later without changing the API.
    pointsBalance: { type: Number, default: 0, min: 0 },
    // Separate from the private account email. These are deliberately public
    // details entered by the user on the Contact options screen.
    contact: {
      email: { type: String, default: '', trim: true, lowercase: true },
      phone: { type: String, default: '', trim: true },
      businessAddress: { type: String, default: '', trim: true, maxlength: 250 },
    },

    preferences: {
      notificationsEnabled: { type: Boolean, default: false },
      locationEnabled: { type: Boolean, default: false },
      radiusMiles: { type: Number, default: 50, min: 5, max: 100 },
      // Separate from the master notificationsEnabled switch above - these
      // only matter once that master switch (or, for email, real email
      // sending infrastructure - not built yet) is on.
      emailWeeklyNewsletter: { type: Boolean, default: false },
    },
    notificationCategories: {
      eventReminders: { type: Boolean, default: true },
    },
    // Mirrors the Settings > Privacy & Visibility screen. Defaults match the
    // fully-public behavior every existing account already had.
    privacy: {
      profileVisibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
      showActivityFeed: { type: Boolean, default: true },
      allowDirectMessages: { type: Boolean, default: true },
    },
    // The user's own device coordinates, captured during onboarding - separate
    // from DASHBOARD_DEFAULT_LAT/LNG, which is now only a fallback for an
    // account that somehow reaches the dashboard without this set.
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },

    devices: [
      {
        _id: false,
        pushToken: String,
        platform: String,
        registeredAt: { type: Date, default: Date.now },
      },
    ],

    // Best-effort "last seen" signal for chat presence ("Active 7h ago").
    // Touched by requireAuth, throttled there so it isn't a write on every request.
    lastActiveAt: { type: Date, default: Date.now },

    onboardingComplete: { type: Boolean, default: false },
    // These flags distinguish a deliberate "off" preference from an untouched default.
    onboarding: {
      avatarChosen: { type: Boolean, default: false },
      notificationPreferenceChosen: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

// `sparse` lets accounts exist before their profile step assigns a username.
userSchema.index({ 'profile.usernameNormalized': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', userSchema);
