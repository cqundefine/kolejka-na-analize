'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { normalizeName } = require('./validate');
const {
  HttpError,
  sendJson,
  sendStatic,
  readJsonBody,
  createRateLimiter,
  clientIp,
} = require('./http');
const { createAdminHandler } = require('./admin');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const STATIC_ROUTES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
  ['/admin', { file: 'admin.html', type: 'text/html; charset=utf-8' }],
  ['/admin.js', { file: 'admin.js', type: 'text/javascript; charset=utf-8' }],
]);

const STATIC_CACHE = new Map(
  [...STATIC_ROUTES].map(([route, { file, type }]) => [
    route,
    { type, body: fs.readFileSync(path.join(PUBLIC_DIR, file)) },
  ])
);

const JOIN_MESSAGES = {
  joined: (r) => `Zapisano! Jesteś na pozycji ${r.position} (zapisów: ${r.yourSignups}).`,
  full: () => 'Kolejka jest pełna. Spróbuj później.',
};

const JOIN_STATUS = {
  joined: 201,
  full: 503,
};

function createApp({ config, queue, auth }) {
  const allowJoin = createRateLimiter(config.rateLimit);
  const handleAdmin = createAdminHandler({ config, queue, auth });
  const cooldownMs = config.queue.joinCooldownMs;
  const lastJoinAt = new Map();

  function cooldownRemainingMs(key, now) {
    const last = lastJoinAt.get(key);
    if (last === undefined) return 0;
    return Math.max(0, last + cooldownMs - now);
  }

  function startJoinCooldown(key, now) {
    if (cooldownMs === 0) return;
    if (lastJoinAt.size > 5000) {
      for (const [k, at] of lastJoinAt) {
        if (now - at >= cooldownMs) lastJoinAt.delete(k);
      }
    }
    lastJoinAt.set(key, now);
  }

  async function handleJoin(req, res) {
    if (!allowJoin(clientIp(req, config.server.trustProxy))) {
      sendJson(res, 429, { error: 'Zbyt wiele prób. Odczekaj chwilę.' }, { 'Retry-After': '60' });
      return;
    }

    const body = await readJsonBody(req, config.server.maxBodyBytes);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'Niepoprawne żądanie.');
    }

    const parsed = normalizeName(
      Object.hasOwn(body, 'name') ? body.name : undefined,
      config.name
    );
    if (parsed.error) {
      throw new HttpError(400, parsed.error);
    }

    const now = Date.now();
    const cooldownLeft = cooldownRemainingMs(parsed.key, now);
    if (cooldownLeft > 0) {
      const seconds = Math.ceil(cooldownLeft / 1000);
      sendJson(
        res,
        429,
        { error: `Tę osobę można zapisać ponownie za ${seconds} s.` },
        { 'Retry-After': String(seconds) }
      );
      return;
    }

    const result = queue.join(parsed.name, parsed.key);
    const message = JOIN_MESSAGES[result.status]?.(result);
    if (!message) {
      throw new HttpError(500, 'Wewnętrzny błąd serwera.');
    }
    if (result.status === 'joined') {
      startJoinCooldown(parsed.key, now);
    }

    sendJson(res, JOIN_STATUS[result.status], {
      status: result.status,
      message,
      state: queue.snapshot(),
      cooldownMs,
    });
  }

  function handleState(req, res) {
    sendJson(res, 200, queue.snapshot());
  }

  return async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/queue') {
      if (req.method !== 'GET') throw new HttpError(405, 'Metoda niedozwolona.', { Allow: 'GET' });
      return handleState(req, res);
    }

    if (pathname === '/api/join') {
      if (req.method !== 'POST') throw new HttpError(405, 'Metoda niedozwolona.', { Allow: 'POST' });
      return handleJoin(req, res);
    }

    if (pathname.startsWith('/api/admin/')) {
      return handleAdmin(req, res, pathname);
    }

    const asset = STATIC_CACHE.get(pathname);
    if (asset) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Metoda niedozwolona.');
      }
      return sendStatic(res, asset);
    }

    throw new HttpError(404, 'Nie znaleziono.');
  };
}

function createServer({ config, queue, auth }) {
  const handle = createApp({ config, queue, auth });

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message }, err.headers);
        return;
      }
      console.error('Błąd obsługi żądania:', err.message);
      sendJson(res, 500, { error: 'Wewnętrzny błąd serwera.' });
    }
  });

  server.requestTimeout = config.server.requestTimeoutMs;
  server.headersTimeout = Math.min(config.server.requestTimeoutMs, 10000);
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;

  return server;
}

module.exports = { createServer };
