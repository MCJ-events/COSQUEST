// Request validation at the route, with express-validator.
//
//   router.post('/me/devices', requireAuth, validate(rules.registerDevice), asyncHandler(registerDevice));
//
// Rules live in src/validators/<area>.js and are built from the helpers below,
// so every route checks the same way and answers in the same shape as the
// controllers already do:
//
//   400 { error: "<the first problem, to show>", errors: [{ field, location, message }] }
//
// A rule can answer with another status (e.g. 404 for a malformed id where the
// endpoint has always said "not found"): withMessage(fail(404, 'Call not found.')).
//
// Rules check types and limits only; they never change the request (no
// sanitizers), so controllers see exactly what was sent. Controllers keep
// their own checks (who may do what, things that need the database).
const { body, param, query, oneOf, validationResult } = require('express-validator');

/** A validation message with its own status code. */
function fail(status, message) {
  return { status, message };
}

const messageOf = (msg) => (msg && typeof msg === 'object' ? msg.message : msg);

/** Runs the rules, then answers with the first problem (or moves on). */
function validate(...rules) {
  const chains = rules.flat(Infinity).filter(Boolean);
  return [
    ...chains,
    (req, res, next) => {
      const result = validationResult(req);
      if (result.isEmpty()) return next();
      const errors = result.array({ onlyFirstError: true });
      const first = errors[0];
      return res.status(first.msg?.status || 400).json({
        error: messageOf(first.msg),
        errors: errors.map((e) => ({ field: e.path ?? null, location: e.location ?? null, message: messageOf(e.msg) })),
      });
    },
  ];
}

const where = { body, param, query };
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Field helpers. `in` is 'body' (default), 'param' or 'query'. Missing fields
 * pass unless `required: true`; `nullable: true` also lets null through.
 * `message` (a string or fail(...)) replaces the default message.
 */
function field(name, { in: at = 'body', required = false, nullable = false } = {}) {
  const chain = where[at](name);
  if (!required) chain.optional({ values: nullable ? 'null' : 'undefined' });
  else chain.exists({ values: nullable ? 'undefined' : 'null' });
  return chain;
}

/** A MongoDB id (24 hex characters). Required unless `required: false`. */
function objectId(name, opts = {}) {
  const { required = true } = opts;
  const msg = opts.message || `Invalid ${opts.label || name}.`;
  const chain = field(name, { ...opts, required });
  if (required) chain.withMessage(msg);
  return chain.bail().isString().withMessage(msg).bail().isMongoId().withMessage(msg);
}

/** A string, with optional length limits (counted after trimming when `trim`). */
function string(name, opts = {}) {
  const { min = 0, max = 10000, label = name, trim = false } = opts;
  const msg = opts.message || (min > 0 ? `${label} must be ${min}-${max} characters.` : `${label} must be text of at most ${max} characters.`);
  const chain = field(name, opts);
  if (opts.required) chain.withMessage(msg);
  return chain.bail()
    .isString().withMessage(msg).bail()
    .custom((v) => {
      const length = (trim ? v.trim() : v).length;
      return length >= min && length <= max;
    }).withMessage(msg);
}

/** true or false (a real JSON boolean, not "true"). */
function boolean(name, opts = {}) {
  const msg = opts.message || `${opts.label || name} must be true or false.`;
  const chain = field(name, opts);
  if (opts.required) chain.withMessage(msg);
  return chain.bail().custom((v) => typeof v === 'boolean').withMessage(msg);
}

/** A JSON number, optionally a whole number, within limits. */
function number(name, opts = {}) {
  const { min = -Infinity, max = Infinity, integer = false, label = name } = opts;
  const range = Number.isFinite(min) && Number.isFinite(max) ? ` between ${min} and ${max}` : '';
  const msg = opts.message || `${label} must be a ${integer ? 'whole ' : ''}number${range}.`;
  const chain = field(name, opts);
  if (opts.required) chain.withMessage(msg);
  return chain.bail()
    .custom((v) => isNumber(v) && (!integer || Number.isInteger(v)) && v >= min && v <= max).withMessage(msg);
}

/** One of a fixed list of values. */
function oneOfValues(name, values, opts = {}) {
  const msg = opts.message || `${opts.label || name} must be one of: ${values.join(', ')}.`;
  const chain = field(name, opts);
  if (opts.required) chain.withMessage(msg);
  return chain.bail().custom((v) => values.includes(v)).withMessage(msg);
}

/** An array, with a maximum length and (optionally) a check on each item. */
function array(name, opts = {}) {
  const { max = 1000, min = 0, label = name, of } = opts;
  const msg = opts.message || `${label} must be a list of at most ${max} items.`;
  const chain = field(name, opts);
  if (opts.required) chain.withMessage(msg);
  chain.bail().custom((v) => Array.isArray(v) && v.length >= min && v.length <= max).withMessage(msg);
  if (of === 'string') chain.bail().custom((v) => v.every((item) => typeof item === 'string')).withMessage(opts.itemMessage || `${label} must contain only text.`);
  if (of === 'objectId') chain.bail().custom((v) => v.every((item) => typeof item === 'string' && /^[a-f\d]{24}$/i.test(item))).withMessage(opts.itemMessage || `${label} must contain only valid ids.`);
  if (of === 'object') chain.bail().custom((v) => v.every(isPlainObject)).withMessage(opts.itemMessage || `${label} must contain only objects.`);
  return chain;
}

/** A JSON object ({ ... }, not a list or text). */
function object(name, opts = {}) {
  const msg = opts.message || `${opts.label || name} must be an object.`;
  const chain = field(name, opts);
  if (opts.required) chain.withMessage(msg);
  return chain.bail().custom(isPlainObject).withMessage(msg);
}

/** A date: an ISO 8601 string (e.g. 2026-10-26 or 2026-10-26T09:30:00Z). */
function isoDate(name, opts = {}) {
  const msg = opts.message || `${opts.label || name} must be an ISO date.`;
  const chain = field(name, opts);
  if (opts.required) chain.withMessage(msg);
  return chain.bail().isString().withMessage(msg).bail().isISO8601().withMessage(msg);
}

/**
 * Query values that must be plain text when present (?a=1&a=2 or ?a[x]=1
 * arrive as lists/objects). Controllers that parse page/limit leniently keep
 * doing so; this only stops values that aren't text at all.
 */
function scalarQuery(...names) {
  return names.map((name) => query(name).optional().isString().withMessage(`${name} must be a single value.`));
}

module.exports = {
  validate, fail, field, objectId, string, boolean, number, oneOfValues, array, object, isoDate, scalarQuery,
  // Raw express-validator builders, for the rare rule the helpers don't cover.
  body, param, query, oneOf,
  isPlainObject,
};
