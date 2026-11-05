'use strict';

const net = require('node:net');

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
    "img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendStatic(res, { type, body }) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': body.length,
  });
  res.end(body);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const mediaType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      reject(new HttpError(415, 'Oczekiwano application/json.'));
      return;
    }

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, 'Żądanie jest za duże.'));
      return;
    }

    const chunks = [];
    let size = 0;
    let failed = false;

    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(new HttpError(413, 'Żądanie jest za duże.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Niepoprawny JSON.'));
      }
    });

    req.on('error', () => reject(new HttpError(400, 'Błąd odczytu żądania.')));
  });
}

function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();

  return function allow(key) {
    const now = Date.now();

    if (hits.size > 5000) {
      for (const [k, entry] of hits) {
        if (now - entry.start >= windowMs) hits.delete(k);
      }
    }

    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= maxRequests;
  };
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const last = forwarded.split(',').pop().trim();
      if (net.isIP(last)) return last;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

module.exports = {
  SECURITY_HEADERS,
  HttpError,
  sendJson,
  sendStatic,
  readJsonBody,
  createRateLimiter,
  clientIp,
  readCookie,
};
