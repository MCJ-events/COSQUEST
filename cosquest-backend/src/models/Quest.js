const mongoose = require('mongoose');
const { FACTION_KEYS } = require('./factionModel');

const moneySchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    // USD unless QUEST_CURRENCY says otherwise (CosQuest is international).
    currency: { type: String, default: () => (process.env.QUEST_CURRENCY || 'USD').toUpperCase(), trim: true, uppercase: true },
  },
  { _id: false }
);

const questSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
    coverImageUrl: { type: String, default: '' },
    hostName: { type: String, default: 'CosQuest', trim: true },
    status: {
      type: String,
      enum: ['draft', 'upcoming', 'live', 'completed', 'cancelled'],
      default: 'draft',
      index: true,
    },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    location: {
      // The venue: only for in-person quests (virtual ones have a placeLabel).
      name: { type: String, required: function () { return this.format !== 'virtual'; }, trim: true },
      address: { type: String, default: '', trim: true },
      city: { type: String, default: '', trim: true },
      country: { type: String, default: '', trim: true },
      lat: { type: Number, required: function () { return this.format !== 'virtual'; }, min: -90, max: 90 },
      lng: { type: Number, required: function () { return this.format !== 'virtual'; }, min: -180, max: 180 },
    },
    prizePool: { type: moneySchema, required: true },
    entryFee: { type: moneySchema, required: true },
    maxParticipants: { type: Number, required: true, min: 1 },
    registrationCount: { type: Number, default: 0, min: 0 },
    interests: { type: [String], default: [] },
    // Optional label, not a registration gate - anyone can register for any
    // quest regardless of their own faction. Only used to tally a faction's
    // "Active Quests" count and any faction-branded display.
    faction: { type: String, enum: FACTION_KEYS, default: null, index: true },
    isPublished: { type: Boolean, default: false, index: true },
    isSeedData: { type: Boolean, default: false, index: true },
    // A quest (game activity, often live) or an event (scheduled, ticketed).
    kind: { type: String, enum: ['quest', 'event'], default: 'quest', index: true },
    // In person (a venue on the map) or virtual (online, from anywhere: no venue,
    // shown to everyone, no distance filter).
    format: { type: String, enum: ['in_person', 'virtual'], default: 'in_person', index: true },
    // Virtual: where it's "set", shown on the card (e.g. "Tokyo · Hanuma").
    placeLabel: { type: String, default: '', trim: true, maxlength: 80 },
    // Joining / check-in only within venueRadiusMeters of the venue (optional).
    requireAtVenue: { type: Boolean, default: false },
    venueRadiusMeters: { type: Number, default: 200, min: 50, max: 5000 },
    // Admin dashboard bookkeeping. Status: only draft and cancelled are
    // decisions; upcoming / live / completed come from the clock
    // (src/utils/questStatus.js).
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

questSchema.index({ isPublished: 1, status: 1, startsAt: 1 });
// Lists by the clock: published, not ended yet.
questSchema.index({ isPublished: 1, endsAt: 1 });

module.exports = mongoose.model('Quest', questSchema);
