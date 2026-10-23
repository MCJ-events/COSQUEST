const { fail } = require('./projectAccess');
function formatter(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 100) fail(400, 'Choose an IANA time zone, for example Africa/Lagos.');
  try { return new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { fail(400, 'Choose a valid IANA time zone.'); }
}
function wallTime(date, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}
function fromWallTime(wall, timeZone) {
  let instant = wall;
  for (let i = 0; i < 6; i++) {
    const delta = wall - wallTime(new Date(instant), timeZone);
    if (!delta) return new Date(instant);
    instant += delta;
  }
  fail(400, 'This local time does not exist because the clocks change. Choose another time.');
}
function localStart(date, time, timeZone) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'Use date YYYY-MM-DD and startTime HH:mm.');
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== date) fail(400, 'Invalid calendar date.');
  return fromWallTime(wall, timeZone);
}
function timing(body, { immediate = false } = {}) {
  formatter(body.timeZone);
  let startsAt;
  if (immediate) startsAt = new Date();
  else if (body.startsAt !== undefined) {
    if (typeof body.startsAt !== 'string' || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(body.startsAt) || !Number.isFinite(Date.parse(body.startsAt))) fail(400, 'startsAt must be an ISO timestamp with a UTC offset.');
    startsAt = new Date(body.startsAt);
  } else startsAt = localStart(body.date, body.startTime, body.timeZone);
  if (!immediate && startsAt.getTime() <= Date.now()) fail(400, 'Schedule the call in the future.');
  if (startsAt.getTime() > Date.now() + 366 * 86400000) fail(400, 'Schedule within the next year.');
  const durationMinutes = body.durationMinutes ?? 30;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) fail(400, 'Duration must be 5-480 whole minutes.');
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60000), timeZone: body.timeZone, durationMinutes };
}
function occurrences(first, repeat, count) {
  if (!['none', 'daily', 'weekly'].includes(repeat)) fail(400, 'repeat must be none, daily or weekly.');
  if (!Number.isInteger(count) || count < 1 || count > 52 || (repeat === 'none' && count !== 1)) fail(400, 'Choose 1-52 occurrences (1 for a one-time call).');
  const wall = wallTime(first.startsAt, first.timeZone);
  return Array.from({ length: count }, (_, i) => {
    const startsAt = i ? fromWallTime(wall + i * (repeat === 'weekly' ? 7 : 1) * 86400000, first.timeZone) : first.startsAt;
    return { ...first, startsAt, endsAt: new Date(startsAt.getTime() + first.durationMinutes * 60000) };
  });
}
// The nth occurrence (1 = the anchor itself) of a repeating call, at the same
// local wall time in its time zone. Monthly calls keep the anchor's day of the
// month, or the month's last day when it is shorter (31st -> Feb 28/29). A
// local time skipped by a clock change moves an hour later instead of failing.
function nthOccurrence(anchorStartsAt, timeZone, repeat, n) {
  if (n <= 1 || repeat === 'none') return new Date(anchorStartsAt);
  const wall = new Date(wallTime(new Date(anchorStartsAt), timeZone));
  let target;
  if (repeat === 'monthly') {
    const months = wall.getUTCMonth() + (n - 1);
    const year = wall.getUTCFullYear() + Math.floor(months / 12);
    const month = months % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    target = Date.UTC(year, month, Math.min(wall.getUTCDate(), lastDay), wall.getUTCHours(), wall.getUTCMinutes());
  } else {
    target = wall.getTime() + (n - 1) * (repeat === 'weekly' ? 7 : 1) * 86400000;
  }
  try { return fromWallTime(target, timeZone); }
  catch { return fromWallTime(target + 3600000, timeZone); }
}

// Moves a repeating series (rollsForward) to its next occurrence once the
// current one has ended. Each new occurrence gets a fresh reminder and an
// empty waiting room; RSVPs are for the series and stay. Returns whether
// anything changed (the caller saves).
function rollForward(call, now = new Date()) {
  if (!call.rollsForward || call.repeat === 'none' || call.cancelledAt || call.endsAt > now) return false;
  const anchor = call.anchorStartsAt || call.startsAt;
  let n = call.occurrence || 1;
  let startsAt = call.startsAt;
  // Daily calls left unopened for years still finish quickly; the cap only
  // guards against a corrupt record.
  for (let i = 0; i < 5000 && startsAt.getTime() + call.durationMinutes * 60000 <= now.getTime(); i++) {
    n += 1;
    startsAt = nthOccurrence(anchor, call.timeZone, call.repeat, n);
  }
  call.anchorStartsAt = anchor;
  call.occurrence = n;
  call.startsAt = startsAt;
  call.endsAt = new Date(startsAt.getTime() + call.durationMinutes * 60000);
  call.reminderSentAt = null;
  call.admission = [];
  return true;
}

function calendar(call, url) {
  const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const escape = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  // Fold by UTF-8 octets, never in the middle of a code point (RFC 5545).
  const fold = line => {
    let out = '', part = '';
    for (const c of line) { if (Buffer.byteLength(part + c) > 75) { out += part + '\r\n'; part = ' '; } part += c; }
    return out + part;
  };
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CosQuest//Scheduled Calls//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${call._id}@cosquest`, `DTSTAMP:${stamp(call.updatedAt)}`, `DTSTART:${stamp(call.startsAt)}`, `DTEND:${stamp(call.endsAt)}`,
    `SUMMARY:${escape(call.topic)}`, `DESCRIPTION:${escape(call.description + '\n' + url)}`, `URL:${url}`,
    `STATUS:${call.cancelledAt ? 'CANCELLED' : 'CONFIRMED'}`, `SEQUENCE:${call.__v || 0}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:Call starts in 10 minutes', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].map(fold).join('\r\n');
}
module.exports = { timing, occurrences, calendar, localStart, nthOccurrence, rollForward };
