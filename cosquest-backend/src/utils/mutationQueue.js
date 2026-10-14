// Changes to one document (a call), applied in batches.
//
// Every change to a call loads the whole call, changes it and saves it, and
// the save is refused if someone else saved in between (optimistic
// concurrency), in which case it's tried again. That's fine for a handful of
// people, but when 50 people answer a big call at the same moment, 49 of the
// saves are refused, retried, refused again, and after five tries people get
// "The call changed too quickly".
//
// This queue lines the changes up per document instead. While one save is
// in flight, new changes wait; the next round loads the document once,
// applies every waiting change in order (each sees the ones before it, as if
// they had run one after another), saves once and populates once. 50 answers
// become one or two saves, not 50 competing ones.
//
// The version check stays: another server process can still save the same
// document in between, and then the whole batch is re-applied on a fresh copy.
//
// `mutator(doc)` returns, exactly like before:
//   false                     - nothing changed
//   { error: {status, ...} }  - stop with that error
//   anything else             - save, and pass it back as `result`
// Each caller gets back { doc, changed, error, result } for its own change.

function createMutationQueue({ load, populate, conflictMessage, maxBatch = 500, attempts = 5 }) {
  const queues = new Map(); // id -> array of waiting { mutator, resolve, reject }

  function conflictError() {
    const error = new Error(conflictMessage);
    error.status = 409;
    return error;
  }

  async function applyBatch(key, batch) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const doc = await load(key);
      if (!doc) {
        batch.forEach((item) => item.resolve({ doc: null }));
        return;
      }

      const outcomes = batch.map((item) => {
        try {
          return { result: item.mutator(doc) };
        } catch (thrown) {
          return { thrown };
        }
      });
      const changed = outcomes.some(
        (outcome) => !outcome.thrown && outcome.result !== false && !outcome.result?.error
      );

      if (changed) {
        try {
          await doc.save();
        } catch (error) {
          if (error?.name === 'VersionError') {
            // Changed by another process - reload and re-apply the whole batch.
            await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
            continue;
          }
          if (batch.length > 1) {
            // One change made the document invalid: don't let it fail the
            // others. Apply them one at a time so only that one gets the error.
            for (const item of batch) {
              try {
                await applyBatch(key, [item]);
              } catch (single) {
                item.reject(single);
              }
            }
            return;
          }
          throw error;
        }
      }

      await populate(doc);
      batch.forEach((item, index) => {
        const { result, thrown } = outcomes[index];
        if (thrown) item.reject(thrown);
        else if (result?.error) item.resolve({ doc, error: result.error });
        else if (result === false) item.resolve({ doc, changed: false });
        else item.resolve({ doc, changed: changed, result });
      });
      return;
    }
    throw conflictError();
  }

  async function drain(key, queue) {
    queue.running = true;
    try {
      while (queue.length) {
        const batch = queue.splice(0, maxBatch);
        try {
          await applyBatch(key, batch);
        } catch (error) {
          batch.forEach((item) => item.reject(error));
        }
      }
    } finally {
      queues.delete(key);
    }
  }

  return function mutate(id, mutator) {
    const key = String(id);
    return new Promise((resolve, reject) => {
      let queue = queues.get(key);
      if (!queue) {
        queue = [];
        queues.set(key, queue);
      }
      queue.push({ mutator, resolve, reject });
      if (!queue.running) drain(key, queue);
    });
  };
}

module.exports = { createMutationQueue };
