// ==========================================
// RENDER FORWARDER (temporary)
// ==========================================
// After the move to Mark's server, app builds already in people's hands
// still call https://cosquest-1.onrender.com (the address is built into the
// app). This tiny service replaces the backend on Render and passes every
// request through to Mark's server: HTTP, uploads and the Socket.IO
// websocket, unchanged. No data lives here.
//
// One exception: Google and Apple sign-in. Those start in the phone's
// in-app browser (or the website's tab) at /api/auth/oauth/google or
// /api/auth/oauth/apple. The backend keeps the sign-in state in a cookie on
// the address the browser is looking at, and Google/Apple then call back to
// the NEW address (GOOGLE_OAUTH_CALLBACK_URL / APPLE_OAUTH_CALLBACK_URL). If
// the start went through this proxy, that cookie would belong to
// onrender.com and the callback would fail with "OAuth state check failed".
// So the start of sign-in is answered with a redirect to the same path on
// the new address instead: the browser then sets the cookie there, and the
// whole sign-in runs on the new address exactly as it does for new builds.
// The app only waits for the final cosquest:// (or website) address, so the
// extra hop is invisible to it.
//
// Delete the Render service once the new app build is out and the log
// below shows (almost) no traffic. See cosquest-backend/DEPLOY.md,
// "Leaving Render".
//
//   FORWARD_TO      where to send everything, e.g. https://api.example.com (required)
//   OAUTH_REDIRECT  "false" turns the sign-in redirect off (everything proxied); default on
//   PORT            set by Render
const http = require('http');
const httpProxy = require('http-proxy');

// Only the two sign-in START pages are redirected. Callbacks and
// /api/auth/oauth/exchange (an app fetch) are still proxied as before.
const OAUTH_START_PATHS = new Set(['/api/auth/oauth/google', '/api/auth/oauth/apple']);

function normaliseTarget(value) {
  const target = String(value || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(target)) {
    throw new Error('FORWARD_TO must be the new backend address with no path, e.g. https://api.example.com');
  }
  return target;
}

// Returns where to send the browser for a sign-in start, or null to proxy.
// The address is always FORWARD_TO plus this request's own path and query,
// so it can never be turned into a redirect to anywhere else.
function oauthRedirectFor(req, target) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const raw = req.url || '';
  const queryAt = raw.indexOf('?');
  const pathname = queryAt === -1 ? raw : raw.slice(0, queryAt);
  if (!OAUTH_START_PATHS.has(pathname)) return null;
  return `${target}${pathname}${queryAt === -1 ? '' : raw.slice(queryAt)}`;
}

function createForwarder({ target: rawTarget, oauthRedirect = true, log = console } = {}) {
  const target = normaliseTarget(rawTarget);

  // xfwd appends this hop to X-Forwarded-For, so the backend still sees each
  // user's own address (TRUST_PROXY lists Render's outbound IPs).
  const proxy = httpProxy.createProxyServer({
    target,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    proxyTimeout: 120_000,
    timeout: 120_000,
  });

  proxy.on('error', (error, req, res) => {
    log.error(`[forwarder] ${req.method} ${req.url}: ${error.message}`);
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'The CosQuest server could not be reached. Please try again.' }));
    } else if (res && typeof res.destroy === 'function') {
      res.destroy();
    }
  });

  const counters = { requests: 0, sockets: 0, signIns: 0 };

  const server = http.createServer((req, res) => {
    if (req.url === '/__forwarder') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        forwardingTo: target,
        oauthRedirect,
        requestsLastMinute: counters.requests,
        socketsLastMinute: counters.sockets,
        signInsLastMinute: counters.signIns,
      }));
      return;
    }
    counters.requests += 1;
    const location = oauthRedirect ? oauthRedirectFor(req, target) : null;
    if (location) {
      counters.signIns += 1;
      // 302 + no-store: browsers must not remember the hop, so a later
      // change of FORWARD_TO takes effect at once.
      res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    proxy.web(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    counters.sockets += 1;
    proxy.ws(req, socket, head);
  });

  server.on('close', () => proxy.close());
  server.keepAliveTimeout = 65_000;
  return { server, proxy, counters, target };
}

if (require.main === module) {
  const oauthRedirect = String(process.env.OAUTH_REDIRECT || 'true').toLowerCase() !== 'false';
  let forwarder;
  try {
    forwarder = createForwarder({ target: process.env.FORWARD_TO, oauthRedirect });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const { server, counters, target } = forwarder;

  // One line a minute: when these stay at zero for days, Render can go.
  setInterval(() => {
    console.log(`[forwarder] last minute: ${counters.requests} requests, ${counters.sockets} new sockets, ${counters.signIns} sign-in starts -> ${target}`);
    counters.requests = 0;
    counters.sockets = 0;
    counters.signIns = 0;
  }, 60_000).unref();

  server.listen(Number(process.env.PORT || 10000), () => {
    console.log(`[forwarder] forwarding everything to ${target} (sign-in starts ${oauthRedirect ? 'redirected' : 'proxied'})`);
  });
}

module.exports = { createForwarder, oauthRedirectFor, normaliseTarget, OAUTH_START_PATHS };
