// ==========================================
// RENDER FORWARDER (temporary)
// ==========================================
// After the move to Mark's server, app builds already in people's hands
// still call https://cosquest-1.onrender.com (the address is built into the
// app). This tiny service replaces the backend on Render and passes every
// request through to Mark's server: HTTP, uploads and the Socket.IO
// websocket, unchanged. No data lives here.
//
// Delete the Render service once the new app build is out and the log
// below shows (almost) no traffic. See cosquest-backend/DEPLOY.md,
// "Leaving Render".
//
//   FORWARD_TO   where to send everything, e.g. https://api.example.com (required)
//   PORT         set by Render
const http = require('http');
const httpProxy = require('http-proxy');

const TARGET = (process.env.FORWARD_TO || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(TARGET)) {
  console.error('FORWARD_TO must be the new backend address, e.g. https://api.example.com');
  process.exit(1);
}

// xfwd appends this hop to X-Forwarded-For, so the backend still sees each
// user's own address (TRUST_PROXY lists Render's outbound IPs).
const proxy = httpProxy.createProxyServer({
  target: TARGET,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  proxyTimeout: 120_000,
  timeout: 120_000,
});

proxy.on('error', (error, req, res) => {
  console.error(`[forwarder] ${req.method} ${req.url}: ${error.message}`);
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'The CosQuest server could not be reached. Please try again.' }));
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

let requests = 0;
let sockets = 0;

const server = http.createServer((req, res) => {
  if (req.url === '/__forwarder') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ forwardingTo: TARGET, requestsLastMinute: requests, socketsLastMinute: sockets }));
    return;
  }
  requests += 1;
  proxy.web(req, res);
});

server.on('upgrade', (req, socket, head) => {
  sockets += 1;
  proxy.ws(req, socket, head);
});

// One line a minute: when these stay at zero for days, Render can go.
setInterval(() => {
  console.log(`[forwarder] last minute: ${requests} requests, ${sockets} new sockets -> ${TARGET}`);
  requests = 0;
  sockets = 0;
}, 60_000).unref();

server.keepAliveTimeout = 65_000;
server.listen(Number(process.env.PORT || 10000), () => {
  console.log(`[forwarder] forwarding everything to ${TARGET}`);
});
