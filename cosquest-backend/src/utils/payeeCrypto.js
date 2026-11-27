// Bank account numbers and tax IDs: encrypted with AES-256-GCM before they are stored.
// The key comes from PAYEE_DATA_KEY (on Render, never in the code or the app). Without it,
// nothing sensitive can be saved (claims answer 503 not_configured).
const crypto = require('crypto');

function key() {
  const raw = process.env.PAYEE_DATA_KEY;
  if (!raw || raw.length < 16) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

const ready = () => Boolean(key());

function seal(value) {
  const k = key();
  if (!k) throw Object.assign(new Error('Prize claims are not set up on this server yet (PAYEE_DATA_KEY).'), { status: 503, code: 'not_configured' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

function open(sealed) {
  if (!sealed) return null;
  const k = key();
  if (!k) throw Object.assign(new Error('PAYEE_DATA_KEY is not set.'), { status: 503, code: 'not_configured' });
  const [version, iv, tag, data] = String(sealed).split(':');
  if (version !== 'v1') throw new Error('Unknown sealed format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
}

module.exports = { ready, seal, open };
