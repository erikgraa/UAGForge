#!/usr/bin/env node
// Gateway Forge local helper (optional).
//
// A static web page cannot open a TLS connection to read a server's certificate. This tiny,
// dependency-free helper runs on YOUR machine, connects to the host you ask about, and returns only the
// certificate's public fingerprints so Gateway Forge can auto-fill thumbprint fields.
//
//   node helper/gateway-forge-helper.mjs [--port 47821] [--origin https://you.github.io]
//
// Security model: binds to 127.0.0.1 only, rejects unexpected Host headers (DNS rebinding), only answers
// browsers whose Origin is allow-listed (localhost, *.github.io, or --origin), never stores or logs anything,
// and never sends your configuration anywhere. No private data is read - only the peer certificate.
import http from 'node:http';
import tls from 'node:tls';
import { createHash } from 'node:crypto';
import { X509Certificate } from 'node:crypto';

const VERSION = '1.0.0';
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(opt('port', process.env.GATEWAY_FORGE_HELPER_PORT ?? 47821));
const extraOrigins = args.flatMap((a, i) => (a === '--origin' && args[i + 1] ? [args[i + 1]] : []));

const originAllowed = (origin) => {
  if (!origin) return false;
  if (extraOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return u.protocol === 'https:' && (u.hostname.endsWith('.github.io') || u.hostname === 'gateway-forge.graa.dev');
  } catch {
    return false;
  }
};

const hostOk = (host) => host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
const colon = (buf) => [...buf].map((b) => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
const hash = (alg, raw) => colon(createHash(alg).update(raw).digest());

function fetchCert(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: /^[\d.]+$/.test(host) ? undefined : host, rejectUnauthorized: false, timeout: 8000 }, () => {
      const peer = socket.getPeerCertificate();
      socket.end();
      if (!peer || !peer.raw) return reject(new Error('Server presented no certificate'));
      const x = new X509Certificate(peer.raw);
      resolve({
        host,
        port,
        subject: x.subject.replace(/\n/g, ', '),
        validTo: x.validTo,
        sha1: hash('sha1', peer.raw),
        sha256: hash('sha256', peer.raw),
        sha384: hash('sha384', peer.raw),
        sha512: hash('sha512', peer.raw)
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timed out'));
    });
    socket.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const send = (status, body) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (originAllowed(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
      headers['Access-Control-Allow-Private-Network'] = 'true';
      headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  if (!hostOk(req.headers.host ?? '')) return send(403, { error: 'Unexpected Host header' });
  if (origin && !originAllowed(origin)) return send(403, { error: `Origin ${origin} is not allowed; restart with --origin ${origin}` });
  if (req.method === 'OPTIONS') return send(204, {});
  if (req.method !== 'GET') return send(405, { error: 'GET only' });

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/ping') return send(200, { app: 'gateway-forge-helper', version: VERSION });
  if (url.pathname === '/thumbprint') {
    const host = url.searchParams.get('host') ?? '';
    const port = Number(url.searchParams.get('port') ?? 443);
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return send(400, { error: 'Invalid host' });
    if (!Number.isInteger(port) || port < 1 || port > 65535) return send(400, { error: 'Invalid port' });
    try {
      return send(200, await fetchCert(host, port));
    } catch (e) {
      return send(502, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return send(404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Gateway Forge helper ${VERSION} listening on http://127.0.0.1:${PORT} (Ctrl+C to stop)`);
  console.log('Allowed origins: localhost, 127.0.0.1, https://*.github.io, https://gateway-forge.graa.dev' + (extraOrigins.length ? ', ' + extraOrigins.join(', ') : ''));
});
