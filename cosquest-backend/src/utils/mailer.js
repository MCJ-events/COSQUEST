const nodemailer = require('nodemailer');

const REQUIRED_ENV = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL'];

// 587 with STARTTLS is the submission port every provider offers, and the
// one cloud hosts leave open (Hetzner, for one, blocks outgoing 465 and 25).
const DEFAULT_PORT = 587;
const IMPLICIT_TLS_PORT = 465;
// Fail in seconds, not nodemailer's 2 minutes, if the port is blocked or the
// server stalls, so a password-reset request does not hang.
const DEFAULT_TIMEOUT_MS = 15_000;

let transporter = null;
// Test-mode only: every "sent" email lands here instead of a real inbox, so
// the smoke suite can read the reset code straight out of it instead of
// needing a real mailbox. Never populated outside NODE_ENV=test.
const testSentEmails = [];

function configError(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

// "true"/"false" (any case, surrounding spaces ignored); anything else is "not set".
function readFlag(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

/**
 * How to reach the SMTP server, from the environment:
 *   SMTP_PORT         default 587
 *   SMTP_SECURE       TLS from the first byte. Default: true on 465, false otherwise.
 *   SMTP_REQUIRE_TLS  when not SMTP_SECURE, insist on STARTTLS (default true), so the
 *                     password and mail never cross the network in clear. Set false
 *                     only for a local relay without TLS.
 *   SMTP_TIMEOUT_MS   connect/greeting timeout, default 15000
 * So SMTP_PORT=587 (or nothing) gives STARTTLS, and the old SMTP_PORT=465 +
 * SMTP_SECURE=true keeps working wherever 465 is allowed.
 */
function smtpTransportOptions(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw configError(`Email is not configured. Missing: ${missing.join(', ')}`);

  const rawPort = String(env.SMTP_PORT ?? '').trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError(`Email is not configured. SMTP_PORT must be a port number (587 for STARTTLS, 465 for TLS), not "${rawPort}".`);
  }
  const secure = readFlag(env.SMTP_SECURE) ?? port === IMPLICIT_TLS_PORT;
  const requireTLS = !secure && (readFlag(env.SMTP_REQUIRE_TLS) ?? true);
  const timeout = Number(env.SMTP_TIMEOUT_MS) > 0 ? Number(env.SMTP_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;

  return {
    host: env.SMTP_HOST,
    port,
    secure,
    requireTLS,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout * 4,
  };
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport(smtpTransportOptions());
  return transporter;
}

/**
 * Sends real mail through the SMTP account configured in .env (Hostinger or
 * otherwise). Never touches a real mail server in tests - same pattern as
 * imageHost.js's Cloudinary calls and transcribeAudio.js's Deepgram call.
 */
async function sendEmail({ to, subject, text, html }) {
  if (process.env.NODE_ENV === 'test') {
    testSentEmails.push({ to, subject, text, html });
    return { skipped: true };
  }
  const from = process.env.SMTP_FROM_NAME ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>` : process.env.SMTP_FROM_EMAIL;
  return getTransporter().sendMail({ from, to, subject, text, html });
}

module.exports = { sendEmail, testSentEmails, smtpTransportOptions };
