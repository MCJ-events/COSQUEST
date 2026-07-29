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
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    tokenVersion: { type: Number, default: 0 },

    profile: {
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
      username: { type: String, default: '' },
      age: { type: Number, default: null },
      gender: { type: String, default: '' },
      avatarKey: { type: String, default: AVATARS[0].key },
      avatarPhotoUrl: { type: String, default: null },
    },

    faction: { type: String, default: null },
    interests: { type: [String], default: [] },

    preferences: {
      locationEnabled: { type: Boolean, default: false },
      radiusMiles: { type: Number, default: 50 },
      lastKnownLocation: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
      notificationsEnabled: { type: Boolean, default: false },
    },

    devices: [
      {
        _id: false,
        pushToken: String,
        platform: String,
        registeredAt: { type: Date, default: Date.now },
      },
    ],

    onboardingComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
