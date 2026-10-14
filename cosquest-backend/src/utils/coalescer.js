// Coalesces live updates per key (one call, one voice chat).
//
// Re-sending the whole state of a call to everyone in it on every change
// grows with the square of the call's size: 1,000 people joining means
// 1,000 updates, each to up to 1,000 phones, each carrying up to 1,000
// members. Instead:
//
//   - the first change is sent straight away;
//   - further changes inside the next `interval` are held, and only the
//     latest state is sent when the interval is up;
//   - `immediate` (e.g. the call ended) skips the wait.
//
// So a call sends at most one update per interval, always the latest one,
// and a quiet call still gets each change at once.
//
//   const updates = createCoalescer({ interval: (value) => ms, send: (key, value) => {...} });
//   updates.push(key, value, { immediate, merge: (pending, value) => newValue });

function createCoalescer({ interval, send, label = 'updates' }) {
  const state = new Map(); // key -> { value, hasValue, timer }

  function deliver(key, entry) {
    const value = entry.value;
    entry.value = undefined;
    entry.hasValue = false;
    try {
      send(key, value);
    } catch (error) {
      console.error(`[${label}] send failed:`, error.message);
    }
    // Cool down for one interval. Anything that arrives meanwhile is sent
    // when it's over; if nothing does, forget this key.
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.hasValue) deliver(key, entry);
      else if (state.get(key) === entry) state.delete(key);
    }, Math.max(0, interval(value)));
    entry.timer.unref?.();
  }

  function push(key, value, { immediate = false, merge = null } = {}) {
    let entry = state.get(key);
    if (!entry) {
      entry = { value: undefined, hasValue: false, timer: null };
      state.set(key, entry);
    }
    entry.value = merge && entry.hasValue ? merge(entry.value, value) : value;
    entry.hasValue = true;
    if (immediate || !entry.timer) deliver(key, entry);
  }

  // Sends anything still waiting now (used on shutdown and in tests).
  function flushAll() {
    for (const [key, entry] of state) {
      if (entry.hasValue) deliver(key, entry);
      clearTimeout(entry.timer);
    }
    state.clear();
  }

  return { push, flushAll, pending: () => state.size };
}

module.exports = { createCoalescer };
