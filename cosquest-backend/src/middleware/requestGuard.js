// Refuses request bodies and query strings that carry MongoDB operators as
// field names ({ "email": { "$ne": null } }, ?username[$regex]=.*). Values like
// these turn a lookup into a query the client controls, so they are stopped
// for every route before any controller runs: 400, nothing read or written.
//
// Only names are checked (a "$" inside a message's text is fine), at any
// depth up to MAX_DEPTH; deeper nesting is refused too.
const MAX_DEPTH = 20;

function findOperatorKey(value, depth = 0) {
  if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return null;
  if (depth > MAX_DEPTH) return '(too deeply nested)';
  for (const key of Object.keys(value)) {
    if (key.startsWith('$')) return key;
    const found = findOperatorKey(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function rejectOperatorKeys(req, res, next) {
  const key = findOperatorKey(req.body) || findOperatorKey(req.query);
  if (!key) return next();
  return res.status(400).json({
    error: key === '(too deeply nested)' ? 'The request is nested too deeply.' : 'Field names cannot start with "$".',
    errors: [{ field: key, location: findOperatorKey(req.body) ? 'body' : 'query', message: 'Field names cannot start with "$".' }],
  });
}

module.exports = { rejectOperatorKeys, findOperatorKey };
