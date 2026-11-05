'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.json');

function readInt(obj, key, section, min, max) {
  const value = obj?.[key];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`config: ${section}.${key} musi być liczbą całkowitą z zakresu ${min}-${max}`);
  }
  return value;
}

function readBool(obj, key, section) {
  if (typeof obj?.[key] !== 'boolean') {
    throw new Error(`config: ${section}.${key} musi być true lub false`);
  }
  return obj[key];
}

function readString(obj, key, section, maxLength = 255) {
  const value = obj?.[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`config: ${section}.${key} musi być niepustym tekstem`);
  }
  return value;
}

function loadConfig(file = DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { server, database, name, queue, rateLimit, reset, admin } = raw;

  const nameMinLength = readInt(name, 'minLength', 'name', 1, 100);
  const nameMaxLength = readInt(name, 'maxLength', 'name', nameMinLength, 100);

  return {
    server: {
      host: readString({ host: process.env.KOLEJKA_HOST || server?.host }, 'host', 'server', 255),
      port: readInt(
        { port: process.env.KOLEJKA_PORT ? Number(process.env.KOLEJKA_PORT) : server?.port },
        'port',
        'server',
        1,
        65535
      ),
      trustProxy: readBool(server, 'trustProxy', 'server'),
      maxBodyBytes: readInt(server, 'maxBodyBytes', 'server', 64, 65536),
      requestTimeoutMs: readInt(server, 'requestTimeoutMs', 'server', 1000, 60000),
    },
    database: {
      path: path.resolve(ROOT, readString(database, 'path', 'database')),
    },
    name: { minLength: nameMinLength, maxLength: nameMaxLength },
    queue: {
      maxLength: readInt(queue, 'maxLength', 'queue', 1, 10000),
      joinCooldownMs: readInt(queue, 'joinCooldownMs', 'queue', 0, 3600000),
    },
    rateLimit: {
      windowMs: readInt(rateLimit, 'windowMs', 'rateLimit', 1000, 3600000),
      maxRequests: readInt(rateLimit, 'maxRequests', 'rateLimit', 1, 10000),
    },
    admin: {
      cookieSecure: readBool(admin, 'cookieSecure', 'admin'),
      sessionMinutes: readInt(admin, 'sessionMinutes', 'admin', 5, 1440),
      loginRateLimit: {
        windowMs: readInt(admin?.loginRateLimit, 'windowMs', 'admin.loginRateLimit', 1000, 3600000),
        maxRequests: readInt(admin?.loginRateLimit, 'maxRequests', 'admin.loginRateLimit', 1, 100),
      },
    },
    reset: {
      backup: readBool(reset, 'backup', 'reset'),
      backupDir: path.resolve(ROOT, readString(reset, 'backupDir', 'reset')),
      clearParticipants: readBool(reset, 'clearParticipants', 'reset'),
    },
  };
}

module.exports = { loadConfig, ROOT };
