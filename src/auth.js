'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);
const SETTING_KEY = 'admin_password_hash';
// N=131072 + maxmem=128MiB is too close for constrained Docker containers.
// Lower the work factor and keep a comfortable memory ceiling so the password
// hash can be generated reliably in production containers.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LENGTH = 64;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

function validatePassword(password) {
  if (typeof password !== 'string') {
    return 'Podaj hasło.';
  }
  const length = [...password].length;
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) {
    return `Hasło musi mieć od ${PASSWORD_MIN} do ${PASSWORD_MAX} znaków.`;
  }
  return null;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

async function matchesHash(password, stored) {
  const [scheme, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    SCRYPT_OPTIONS
  );
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Hasło administratora trzymamy w bazie (hash scrypt).
 * Sesja zapisuje „odcisk” hasła; zmiana hasła unieważnia wszystkie sesje,
 * także te otwarte w innym procesie (np. przez npm run admin:passwd).
 */
function createAdminAuth(db, { sessionMinutes }) {
  const sessionMs = sessionMinutes * 60 * 1000;
  const sessions = new Map();
  const readHash = db.prepare('SELECT value FROM settings WHERE key = ?');
  const writeHash = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  function currentHash() {
    return readHash.get(SETTING_KEY)?.value ?? null;
  }

  function pruneSessions(now) {
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
  }

  return {
    sessionMs,

    hasPassword: () => currentHash() !== null,

    async verify(password) {
      const stored = currentHash();
      if (!stored || typeof password !== 'string') return false;
      return matchesHash(password, stored);
    },

    async setPassword(password) {
      writeHash.run(SETTING_KEY, await hashPassword(password));
    },

    createSession() {
      const now = Date.now();
      pruneSessions(now);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { expiresAt: now + sessionMs, fingerprint: currentHash() });
      return token;
    },

    isValidSession(token) {
      const session = typeof token === 'string' ? sessions.get(token) : undefined;
      if (!session) return false;
      if (session.expiresAt <= Date.now() || session.fingerprint !== currentHash()) {
        sessions.delete(token);
        return false;
      }
      return true;
    },

    revokeSession(token) {
      sessions.delete(token);
    },
  };
}

module.exports = { createAdminAuth, validatePassword, SETTING_KEY };
