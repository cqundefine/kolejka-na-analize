'use strict';

const {
  HttpError,
  sendJson,
  readJsonBody,
  createRateLimiter,
  clientIp,
  readCookie,
} = require('./http');
const { normalizeName } = require('./validate');
const { validatePassword } = require('./auth');

const COOKIE_NAME = 'kolejka_admin';
const PASSWORD_INPUT_LIMIT = 1024;

function createAdminHandler({ config, queue, auth }) {
  const allowSecretCheck = createRateLimiter(config.admin.loginRateLimit);
  const cookieFlags = config.admin.cookieSecure
    ? 'Path=/; HttpOnly; SameSite=Strict; Secure'
    : 'Path=/; HttpOnly; SameSite=Strict';

  function sessionCookie(token) {
    const maxAge = Math.floor(auth.sessionMs / 1000);
    return `${COOKIE_NAME}=${token}; ${cookieFlags}; Max-Age=${maxAge}`;
  }

  function clearedCookie() {
    return `${COOKIE_NAME}=; ${cookieFlags}; Max-Age=0`;
  }

  function requireSession(req) {
    if (!auth.isValidSession(readCookie(req, COOKIE_NAME))) {
      throw new HttpError(401, 'Sesja wygasła. Zaloguj się ponownie.');
    }
  }

  function requireSecretCheckBudget(req) {
    if (!allowSecretCheck(clientIp(req, config.server.trustProxy))) {
      throw new HttpError(429, 'Zbyt wiele prób. Spróbuj za kilka minut.', { 'Retry-After': '900' });
    }
  }

  function readPasswordField(body, field) {
    const value = body?.[field];
    if (typeof value !== 'string' || value.length === 0 || value.length > PASSWORD_INPUT_LIMIT) {
      throw new HttpError(400, 'Podaj hasło.');
    }
    return value;
  }

  function queuePayload(message) {
    return {
      message,
      entries: queue.entries(),
      history: queue.history(),
      maxLength: config.queue.maxLength,
    };
  }

  async function readBody(req) {
    const body = await readJsonBody(req, config.server.maxBodyBytes);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'Niepoprawne żądanie.');
    }
    return body;
  }

  async function login(req, res) {
    requireSecretCheckBudget(req);
    const body = await readBody(req);
    const password = readPasswordField(body, 'password');

    if (!auth.hasPassword()) {
      throw new HttpError(503, 'Hasło administratora nie jest ustawione. Uruchom: npm run admin:passwd');
    }
    if (!(await auth.verify(password))) {
      throw new HttpError(401, 'Nieprawidłowe hasło.');
    }

    const token = auth.createSession();
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token) });
  }

  function logout(req, res) {
    auth.revokeSession(readCookie(req, COOKIE_NAME));
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie() });
  }

  function listQueue(req, res) {
    requireSession(req);
    sendJson(res, 200, queuePayload(null));
  }

  async function addToQueue(req, res) {
    requireSession(req);
    const body = await readBody(req);
    const parsed = normalizeName(Object.hasOwn(body, 'name') ? body.name : undefined, config.name);
    if (parsed.error) {
      throw new HttpError(400, parsed.error);
    }

    const result = queue.addEntry(parsed.name, parsed.key);
    if (result.status === 'full') {
      throw new HttpError(409, 'Kolejka jest pełna.');
    }
    sendJson(
      res,
      201,
      queuePayload(`Dodano: ${parsed.name} (pozycja ${result.position}, zapisów: ${result.yourSignups}).`)
    );
  }

  function removeFromQueue(req, res, match) {
    requireSession(req);
    if (!queue.removeEntry(Number(match[1]))) {
      throw new HttpError(404, 'Nie ma takiej pozycji w kolejce.');
    }
    sendJson(res, 200, queuePayload('Usunięto z kolejki.'));
  }

  function popNext(req, res) {
    requireSession(req);
    const name = queue.next();
    sendJson(
      res,
      200,
      queuePayload(name ? `Usunięto z początku kolejki: ${name}.` : 'Kolejka jest pusta.')
    );
  }

  async function changePassword(req, res) {
    requireSession(req);
    requireSecretCheckBudget(req);
    const body = await readBody(req);
    const current = readPasswordField(body, 'current');
    const next = readPasswordField(body, 'next');

    if (!(await auth.verify(current))) {
      throw new HttpError(403, 'Obecne hasło jest nieprawidłowe.');
    }
    const problem = validatePassword(next);
    if (problem) {
      throw new HttpError(400, problem);
    }

    await auth.setPassword(next);
    sendJson(
      res,
      200,
      { ok: true, message: 'Hasło zmienione. Zaloguj się ponownie.' },
      { 'Set-Cookie': clearedCookie() }
    );
  }

  const routes = [
    ['POST', /^\/api\/admin\/login$/, login],
    ['POST', /^\/api\/admin\/logout$/, logout],
    ['GET', /^\/api\/admin\/queue$/, listQueue],
    ['POST', /^\/api\/admin\/queue$/, addToQueue],
    ['DELETE', /^\/api\/admin\/queue\/(\d{1,12})$/, removeFromQueue],
    ['POST', /^\/api\/admin\/next$/, popNext],
    ['POST', /^\/api\/admin\/password$/, changePassword],
  ];

  return async function handleAdmin(req, res, pathname) {
    let pathMatched = false;
    for (const [method, pattern, handler] of routes) {
      const match = pattern.exec(pathname);
      if (!match) continue;
      if (method === req.method) {
        return handler(req, res, match);
      }
      pathMatched = true;
    }
    if (pathMatched) {
      throw new HttpError(405, 'Metoda niedozwolona.');
    }
    throw new HttpError(404, 'Nie znaleziono.');
  };
}

module.exports = { createAdminHandler };
