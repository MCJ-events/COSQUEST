// SMTP transport settings (utils/mailer.js): 587 + STARTTLS by default, 465
// with TLS still works, and nothing is ever sent in clear by accident. The
// connection checks talk to a tiny fake SMTP server on 127.0.0.1; no real
// mail server is contacted and no mail is sent.
const net = require('net');
const nodemailer = require('nodemailer');
const { smtpTransportOptions } = require('../src/utils/mailer');

const BASE = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_USER: 'user@example.test',
  SMTP_PASSWORD: 'not-a-real-password',
  SMTP_FROM_EMAIL: 'no-reply@example.test',
};

// A minimal SMTP server. advertiseStartTls: whether EHLO offers STARTTLS.
// silent: accept the connection but never greet (a stalled or filtered port).
function fakeSmtpServer({ advertiseStartTls = false, silent = false } = {}) {
  const log = [];
  const server = net.createServer((socket) => {
    if (silent) return;
    socket.write('220 fake.example.test ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at;
      while ((at = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const verb = line.split(' ')[0].toUpperCase();
        log.push(verb);
        if (verb === 'EHLO') {
          socket.write(`250-fake.example.test\r\n${advertiseStartTls ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN LOGIN\r\n`);
        } else if (verb === 'AUTH') {
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (verb === 'STARTTLS') {
          socket.write('454 4.7.0 TLS not available in this fake\r\n');
        } else if (verb === 'QUIT') {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, log })));
}

async function verifyAgainst(env) {
  const transport = nodemailer.createTransport({ ...smtpTransportOptions(env), host: '127.0.0.1' });
  const started = Date.now();
  try {
    await transport.verify();
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: `${error.code || ''} ${error.message}` };
  } finally {
    transport.close();
  }
}

async function run() {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) {
      pass += 1;
      console.log(`  ok  - ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL - ${name}`, JSON.stringify(value));
    }
  }

  console.log('\n--- SMTP transport (587 STARTTLS by default, 465 still works) ---');

  const defaults = smtpTransportOptions({ ...BASE });
  check(defaults.port === 587 && defaults.secure === false && defaults.requireTLS === true,
    'no SMTP_PORT: port 587 with STARTTLS required', defaults);
  check(defaults.connectionTimeout === 15000 && defaults.greetingTimeout === 15000,
    'connect and greeting time out after 15 s, not 2 min', defaults);

  const submission = smtpTransportOptions({ ...BASE, SMTP_PORT: '587', SMTP_SECURE: 'false' });
  check(submission.port === 587 && !submission.secure && submission.requireTLS, 'SMTP_PORT=587 + SMTP_SECURE=false: STARTTLS required', submission);

  const legacy = smtpTransportOptions({ ...BASE, SMTP_PORT: '465', SMTP_SECURE: 'true' });
  check(legacy.port === 465 && legacy.secure === true && legacy.requireTLS === false, 'SMTP_PORT=465 + SMTP_SECURE=true (the old setting) still uses TLS on 465', legacy);

  const legacyNoFlag = smtpTransportOptions({ ...BASE, SMTP_PORT: '465' });
  check(legacyNoFlag.secure === true, 'SMTP_PORT=465 alone implies TLS from the first byte', legacyNoFlag);

  const spaced = smtpTransportOptions({ ...BASE, SMTP_PORT: ' 587 ', SMTP_SECURE: ' TRUE ' });
  check(spaced.port === 587 && spaced.secure === true, 'values are trimmed and case-insensitive', spaced);

  const relay = smtpTransportOptions({ ...BASE, SMTP_PORT: '25', SMTP_REQUIRE_TLS: 'false' });
  check(relay.port === 25 && !relay.secure && relay.requireTLS === false, 'SMTP_REQUIRE_TLS=false allows a local relay without TLS', relay);

  const quick = smtpTransportOptions({ ...BASE, SMTP_TIMEOUT_MS: '2500' });
  check(quick.connectionTimeout === 2500 && quick.greetingTimeout === 2500, 'SMTP_TIMEOUT_MS overrides the timeout', quick);

  for (const bad of ['abc', '0', '70000', '58 7']) {
    let error;
    try { smtpTransportOptions({ ...BASE, SMTP_PORT: bad }); } catch (e) { error = e; }
    check(error && error.status === 503 && /SMTP_PORT/.test(error.message), `SMTP_PORT="${bad}" is refused with a clear 503`, error?.message);
  }
  {
    let error;
    try { smtpTransportOptions({ SMTP_HOST: 'x' }); } catch (e) { error = e; }
    check(error && error.status === 503 && /SMTP_USER/.test(error.message) && !/SMTP_PORT/.test(error.message),
      'missing settings are listed, and SMTP_PORT is no longer required', error?.message);
  }

  // Real connections to the fake server.
  const plain = await fakeSmtpServer({ advertiseStartTls: false });
  try {
    const refused = await verifyAgainst({ ...BASE, SMTP_PORT: String(plain.port) });
    check(!refused.ok && !plain.log.includes('AUTH'),
      'a server without STARTTLS is refused before the password is sent', { ...refused, log: plain.log });

    plain.log.length = 0;
    const relayed = await verifyAgainst({ ...BASE, SMTP_PORT: String(plain.port), SMTP_REQUIRE_TLS: 'false' });
    check(relayed.ok && plain.log.includes('AUTH'), 'with SMTP_REQUIRE_TLS=false the same server is accepted', { ...relayed, log: plain.log });
  } finally {
    plain.server.close();
  }

  const offersTls = await fakeSmtpServer({ advertiseStartTls: true });
  try {
    const upgraded = await verifyAgainst({ ...BASE, SMTP_PORT: String(offersTls.port) });
    check(offersTls.log.includes('STARTTLS') && !offersTls.log.includes('AUTH'),
      'on 587 the client asks for STARTTLS before logging in', { ...upgraded, log: offersTls.log });
  } finally {
    offersTls.server.close();
  }

  const stalled = await fakeSmtpServer({ silent: true });
  try {
    const timedOut = await verifyAgainst({ ...BASE, SMTP_PORT: String(stalled.port), SMTP_TIMEOUT_MS: '400' });
    check(!timedOut.ok && timedOut.ms < 3000, 'a stalled or filtered port fails within the timeout', timedOut);
  } finally {
    stalled.server.close();
  }

  return { pass, fail };
}

module.exports = { run };

if (require.main === module) {
  run().then(({ pass, fail }) => {
    console.log(`[mailer] ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
}
