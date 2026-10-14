/**
 * Hook 3b: voice chats as Sparks calls. Community and faction rooms have
 * voice chats (src/models/VoiceRoom.js, voiceRoomController.js), not Call
 * documents; this file mirrors them into the module's call layer the way
 * calls.js mirrors DM calls, so consent, transcription segments, live topics,
 * the outline and the post-call write-up work there too.
 *
 * One VoiceRoom document is one voice chat session (it closes when the last
 * person leaves; the next one is a new document), so:
 *   Sparks call id  = the VoiceRoom's _id (what the app gets as voiceRoom.id)
 *   chatId          = the room's conversation (Community or faction room)
 *   attendees       = the voice chat's members
 *   voice chat starts       -> onCallStarted
 *   who is in it changed    -> onCallMembership
 *   it closes               -> onCallEnded (the outline starts after the grace window)
 *
 * Batching (voice chats hold up to VOICE_ROOM_MAX_MEMBERS, 1,000): sync() is
 * called from the controller's coalesced live update (sendVoiceUpdate), which
 * runs at most once per interval per voice chat (CALL_BROADCAST_*) with the
 * latest member list. Here, per voice chat, one sync runs at a time and a sync
 * that arrives meanwhile replaces any waiting one, so 1,000 people joining
 * become a handful of onCallMembership calls, never one per person. People
 * who joined and left inside one interval (the update's `left` list) are still
 * recorded as having attended (outline and transcript access).
 *
 * Privacy is the module's, as for calls: a segment is stored only from
 * someone whose latest decision on the notice for this call is "accepted".
 *
 * A voice chat whose people all vanished (apps killed) is only closed when
 * someone next looks at it (pruneStale). So the Sparks call does not stay
 * live for hours, a light sweep (every SWEEP_MS, started with the first sync)
 * refreshes voice chats that are live Sparks calls; one that closed, or is
 * gone, ends its Sparks call.
 */
const mongoose = require('mongoose');
const VoiceRoom = require('../models/VoiceRoom');
const host = require('./index');

const SWEEP_MS = 60 * 1000;
const slots = new Map(); // roomId -> { next, left, done }
let sweepTimer = null;

const idOf = (v) => String(v?._id || v || '');

async function syncNow(roomId, view, left) {
  const store = host.store;
  const backend = host.backend;
  const existing = await store.getCall(roomId);

  if (!existing) {
    if (!view.active) return;
    const row = {
      callId: roomId,
      chatId: String(view.conversationId),
      startedAt: new Date(view.json?.startedAt || Date.now()).getTime(),
      endedAt: null,
      startedBy: idOf(view.json?.startedBy?.id || view.memberIds[0]),
      status: 'active',
      attendees: [...view.memberIds],
      everAttended: [...new Set([...view.memberIds, ...left])],
    };
    if (await store.insertCall(row)) await backend.onCallStarted(row);
    return;
  }
  if (existing.status !== 'active') return;

  // Joined and left between two updates: never in a member list we saw, but they were there.
  const missed = left.filter((u) => !existing.everAttended.includes(u));
  if (missed.length) await store.patchCall(roomId, { everAttended: [...existing.everAttended, ...missed] });

  if (!view.active) {
    await backend.onCallEnded(roomId);
    return;
  }
  const now = new Set(view.memberIds);
  const same = existing.attendees.length === now.size && existing.attendees.every((u) => now.has(u));
  if (!same) await backend.onCallMembership(roomId, [...now]);
}

/**
 * From voiceRoomController.sendVoiceUpdate (already coalesced). `view` is the
 * controller's room view ({ active, conversationId, memberIds, json });
 * `left` = people who left since the last update. Fire-and-forget: never rejects.
 */
function sync(roomId, view, left = []) {
  if (!host.isModule() || !host.isReady() || !view) return Promise.resolve();
  startSweep();
  const key = String(roomId);
  const slot = slots.get(key);
  if (slot) {
    // A sync is running for this voice chat: wait behind it, keeping only the latest state.
    slot.next = view;
    for (const u of left) slot.left.add(String(u));
    return slot.done;
  }
  const fresh = { next: view, left: new Set(left.map(String)), done: null };
  slots.set(key, fresh);
  fresh.done = (async () => {
    while (fresh.next) {
      const v = fresh.next;
      const l = [...fresh.left];
      fresh.next = null;
      fresh.left = new Set();
      try {
        await syncNow(key, v, l);
      } catch (error) {
        console.warn('[sparks] voice chat sync failed:', error.message);
      }
    }
    slots.delete(key);
  })();
  return fresh.done;
}

/**
 * Live Sparks calls that are voice chats: refresh each (drops people who went
 * quiet, closes it if empty, which syncs here); end the Sparks call of one
 * that is already closed or gone. Never rejects.
 */
async function sweep() {
  if (!host.isModule() || !host.isReady()) return;
  try {
    const live = (await host.store.callsByStatus('active')).map((c) => c.callId).filter((id) => mongoose.isValidObjectId(id));
    if (!live.length) return;
    const rooms = await VoiceRoom.find({ _id: { $in: live } }, '_id active').lean();
    const { refreshVoiceRoom } = require('../controllers/voiceRoomController');
    for (const room of rooms) {
      const roomId = String(room._id);
      if (room.active) await refreshVoiceRoom(roomId);
      // Closed without us hearing (a restart between the close and its update).
      else if ((await host.store.getCall(roomId))?.status === 'active') await host.backend.onCallEnded(roomId);
    }
  } catch (error) {
    console.warn('[sparks] voice chat sweep failed:', error.message);
  }
}

function startSweep() {
  if (sweepTimer || process.env.SPARKS_WORKER === '0') return;
  sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
  sweepTimer.unref?.();
}

function stopSweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

/** Is this Sparks call id a voice chat (rather than a Call)? */
async function isVoiceRoom(callId) {
  return mongoose.isValidObjectId(callId) && Boolean(await VoiceRoom.exists({ _id: callId }));
}

module.exports = { sync, sweep, stopSweep, isVoiceRoom, _idle: () => Promise.all([...slots.values()].map((s) => s.done)) };
