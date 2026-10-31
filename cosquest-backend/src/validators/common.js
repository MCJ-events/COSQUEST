// Rules shared by several areas (see src/middleware/validate.js).
const { objectId, string, field, scalarQuery, fail } = require('../middleware/validate');

// Profile text fields, as sent at onboarding (`profile.*`) and on profile edits.
// The username's own rule (3-20 letters, numbers, underscore) and "is it taken"
// stay in the controllers.
function profileFields(prefix = '') {
  return [
    string(`${prefix}firstName`, { max: 50, label: `${prefix}firstName` }),
    string(`${prefix}lastName`, { max: 50, label: `${prefix}lastName` }),
    string(`${prefix}username`, { max: 20, message: `${prefix}username must be 3-20 characters: letters, numbers, underscore only.` }),
    string(`${prefix}gender`, { max: 50, label: `${prefix}gender` }),
    string(`${prefix}avatar`, { max: 100, message: `${prefix}avatar is not a recognized avatar option. See GET /api/meta/avatars.` }),
    field(`${prefix}age`, { nullable: true })
      .custom((v) => v === '' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\d{1,3}$/.test(v)))
      .withMessage(`${prefix}age must be a whole number between 13 and 120.`),
  ];
}

// ?page=&limit= (and friends): plain values only. Controllers keep reading
// them leniently (a bad number falls back to the default).
const paging = () => scalarQuery('page', 'limit', 'offset', 'cursor', 'before', 'after', 'search', 'q');

// An id in the path that has always answered "not found" when malformed.
const pathId = (name, notFoundMessage) => objectId(name, { in: 'param', message: fail(404, notFoundMessage) });

module.exports = { profileFields, paging, pathId };
