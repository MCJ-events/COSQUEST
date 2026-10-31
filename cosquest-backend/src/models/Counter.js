const mongoose = require('mongoose');

/**
 * Readable, increasing numbers for admin records: reports (CQ-1042) and
 * audit events (EV-2084). One row per sequence; next() is a single atomic
 * $inc, so two requests at once never get the same number.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // the sequence name: 'report', 'audit'
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/** The next number of a sequence (the first one handed out is `start`). */
counterSchema.statics.next = async function next(name, start = 1000) {
  const row = await this.findOneAndUpdate(
    { _id: name },
    [{ $set: { seq: { $add: [{ $ifNull: ['$seq', start - 1] }, 1] } } }],
    { upsert: true, new: true }
  );
  return row.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
