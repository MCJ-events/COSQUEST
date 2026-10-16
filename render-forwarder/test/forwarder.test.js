// Tests for the Render forwarder. Run with `npm test` (node --test).
//
// The sign-in tests act like a browser: cookies are kept per HOST name, the
// way a phone's in-app browser keeps them. The forwarder listens on
// 127.0.0.1 ("onrender") and the stand-in backend on localhost ("the new
// address"), so a cookie set through the forwarder is NOT sent to the
// backend's callback, exactly as in production.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createForwarder, oauthRedirectFor, normaliseTarget } = require('../server');

// ---------- a stand-in backend with the same cookie rules as utils/oauth.js ----------
let backend;
let backendBase; // http://localhost:<port>  (the "new address")
const seen = [];

function startBackend() {
  return new Promise((resolve) => {
    backend = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, host: req.headers.host, body, xff: req.headers['x-forwarded-for'] });
        if (url.pathname === '/api/auth/oauth/google' || url.pathname === '/api/auth/oauth/apple') {
          // Host-only cookie, like res.cookie() in startAuthorization().
          const state = crypto.randomBytes(8).toString('hex');
          const redirectTo = url.searchParams.get('redirectUri') || 'cosquest://oauth/google';
          const callback = `${backendBase}${url.pathname}/callback`; // GOOGLE_/APPLE_OAUTH_CALLBACK_URL
          res.writeHead(302, {
            'Set-Cookie': `oauth=${encodeURIComponent(JSON.stringify({ state, redirectTo }))}; Path=/api/auth/oauth; HttpOnly`,
            // Stand-in for accounts.google.com: it sends the person straight back to the callback.
            Location: `${callback}?state=${state}&code=fake-code`,
          });
          res.end();
          return;
        }
        if (url.pathname.endsWith('/callback')) {
          const cookie = (req.headers.cookie || '').split('; ').find((c) => c.startsWith('oauth='));
          const session = cookie ? JSON.parse(decodeURIComponent(cookie.slice(6))) : null;
          const ok = session && session.state === url.searchParams.get('state');
          const back = new URL(session?.redirectTo || 'cosquest://oauth/google');
          back.searchParams.set(ok ? 'oauthCode' : 'oauthError', ok ? 'one-time-code' : 'OAuth state check failed. Please try again.');
          res.writeHead(302, { Location: back.toString() });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: url.pathname, body }));
      });
    });
    backend.listen(0, 'localhost', () => {
      backendBase = `http://localhost:${backend.address().port}`;
      resolve();
    });
  });
}

function startForwarder(options) {
  return new Promise((resolve) => {
    const forwarder = createForwarder({ target: backendBase, log: { error() {} }, ...options });
    forwarder.server.listen(0, '127.0.0.1', () => {
      resolve({ ...forwarder, base: `http://127.0.0.1:${forwarder.server.address().port}` });
    });
  });
}

// ---------- a tiny browser: follows redirects, keeps cookies per host ----------
async function browse(startUrl) {
  const jar = new Map(); // host name -> Map(cookie name -> value)
  const hops = [];
  let url = startUrl;
  for (let i = 0; i < 10; i += 1) {
    const parsed = new URL(url);
    if (parsed.protocol === 'cosquest:') return { finalUrl: url, hops, jar };
    const cookies = jar.get(parsed.hostname);
    const headers = cookies ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {};
    const res = await fetch(url, { redirect: 'manual', headers });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (!jar.has(parsed.hostname)) jar.set(parsed.hostname, new Map());
      jar.get(parsed.hostname).set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    hops.push({ url, status: res.status });
    const location = res.headers.get('location');
    if (!location) return { finalUrl: url, hops, jar, status: res.status };
    url = new URL(location, url).toString();
  }
  throw new Error('too many redirects');
}

before(startBackend);
after(() => new Promise((resolve) => backend.close(resolve)));

test('FORWARD_TO must be a bare http(s) address', () => {
  assert.equal(normaliseTarget('https://api.example.com/'), 'https://api.example.com');
  for (const bad of ['', 'api.example.com', 'ftp://api.example.com', 'https://api.example.com/some/path']) {
    assert.throws(() => normaliseTarget(bad), /FORWARD_TO/, bad);
  }
});

test('only the two sign-in start pages are redirected, to the same path and query on FORWARD_TO', () => {
  const t = 'https://api.example.com';
  const at = (method, url) => oauthRedirectFor({ method, url }, t);
  assert.equal(at('GET', '/api/auth/oauth/google?redirectUri=cosquest%3A%2F%2Fonboarding%2FoauthGoogle'),
    'https://api.example.com/api/auth/oauth/google?redirectUri=cosquest%3A%2F%2Fonboarding%2FoauthGoogle');
  assert.equal(at('GET', '/api/auth/oauth/apple'), 'https://api.example.com/api/auth/oauth/apple');
  assert.equal(at('HEAD', '/api/auth/oauth/apple'), 'https://api.example.com/api/auth/oauth/apple');
  for (const [method, url] of [
    ['GET', '/api/auth/oauth/google/callback?state=a&code=b'],
    ['POST', '/api/auth/oauth/apple/callback'],
    ['POST', '/api/auth/oauth/exchange'],
    ['POST', '/api/auth/oauth/google'],
    ['GET', '/api/auth/login'],
    ['GET', '//evil.example/api/auth/oauth/google'],
    ['GET', '/api/auth/oauth/google/'],
    ['GET', '/API/AUTH/OAUTH/GOOGLE'],
  ]) {
    assert.equal(at(method, url), null, `${method} ${url}`);
  }
});

test('old build, Google: sign-in started on onrender finishes with a code (redirect mode)', async () => {
  const fwd = await startForwarder();
  try {
    const result = await browse(`${fwd.base}/api/auth/oauth/google?redirectUri=${encodeURIComponent('cosquest://onboarding/oauthGoogle')}`);
    assert.equal(result.hops[0].status, 302);
    assert.ok(result.hops[1].url.startsWith(`${backendBase}/api/auth/oauth/google?redirectUri=`), 'second hop is the new address');
    assert.ok(result.finalUrl.startsWith('cosquest://onboarding/oauthGoogle?oauthCode='), result.finalUrl);
    assert.equal(result.jar.has('127.0.0.1'), false, 'no sign-in cookie is left on the old address');
  } finally {
    await new Promise((resolve) => fwd.server.close(resolve));
  }
});

test('old build, Apple: same hand-off for the Apple start page', async () => {
  const fwd = await startForwarder();
  try {
    const result = await browse(`${fwd.base}/api/auth/oauth/apple?redirectUri=${encodeURIComponent('cosquest://onboarding/oauthApple')}`);
    assert.ok(result.finalUrl.startsWith('cosquest://onboarding/oauthApple?oauthCode='), result.finalUrl);
  } finally {
    await new Promise((resolve) => fwd.server.close(resolve));
  }
});

test('without the redirect (plain proxy) the same flow fails: this is the bug being fixed', async () => {
  const fwd = await startForwarder({ oauthRedirect: false });
  try {
    const result = await browse(`${fwd.base}/api/auth/oauth/google?redirectUri=${encodeURIComponent('cosquest://onboarding/oauthGoogle')}`);
    assert.ok(result.finalUrl.includes('oauthError='), result.finalUrl);
    assert.equal(result.jar.has('127.0.0.1'), true, 'the cookie landed on the old address');
  } finally {
    await new Promise((resolve) => fwd.server.close(resolve));
  }
});

test('everything else is still proxied unchanged: callbacks, the code exchange, normal API calls', async () => {
  const fwd = await startForwarder();
  try {
    seen.length = 0;
    const exchange = await fetch(`${fwd.base}/api/auth/oauth/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oauthCode: 'abc' }),
    });
    assert.equal(exchange.status, 200);
    assert.deepEqual(await exchange.json(), { ok: true, path: '/api/auth/oauth/exchange', body: '{"oauthCode":"abc"}' });

    const appleCallback = await fetch(`${fwd.base}/api/auth/oauth/apple/callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'state=s&code=c', redirect: 'manual',
    });
    assert.equal(appleCallback.status, 302, 'the callback reached the backend (it answered, not the forwarder)');

    const health = await fetch(`${fwd.base}/health`);
    assert.equal(health.status, 200);

    assert.deepEqual(seen.map((r) => `${r.method} ${r.url.split('?')[0]}`), [
      'POST /api/auth/oauth/exchange',
      'POST /api/auth/oauth/apple/callback',
      'GET /health',
    ]);
    assert.ok(seen.every((r) => r.host === new URL(backendBase).host), 'Host header is rewritten to the new address');
    assert.ok(seen.every((r) => r.xff), 'X-Forwarded-For is added');
  } finally {
    await new Promise((resolve) => fwd.server.close(resolve));
  }
});

test('/__forwarder reports the target, the redirect switch and the counters', async () => {
  const fwd = await startForwarder();
  try {
    await fetch(`${fwd.base}/api/auth/oauth/google`, { redirect: 'manual' });
    await fetch(`${fwd.base}/health`);
    const info = await (await fetch(`${fwd.base}/__forwarder`)).json();
    assert.equal(info.forwardingTo, backendBase);
    assert.equal(info.oauthRedirect, true);
    assert.equal(info.requestsLastMinute, 2);
    assert.equal(info.signInsLastMinute, 1);
  } finally {
    await new Promise((resolve) => fwd.server.close(resolve));
  }
});
