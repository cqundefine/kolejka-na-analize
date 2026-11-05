'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Starsza wersja miała UNIQUE na name_key i kolumnę priority. Stare wpisy przenosimy w kolejności.
function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  const queueColumns = db
    .prepare('PRAGMA table_info(queue)')
    .all()
    .map((column) => column.name);
  const hasLegacyQueue = queueColumns.includes('priority');
  const missingSignups = queueColumns.length > 0 && !queueColumns.includes('signups');

  db.transaction(() => {
    if (hasLegacyQueue) {
      db.exec('DROP INDEX IF EXISTS queue_name_key');
      db.exec('ALTER TABLE queue RENAME TO queue_old');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS participants (
        name_key     TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        signups      INTEGER NOT NULL DEFAULT 0 CHECK (signups >= 0)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS queue (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name_key  TEXT NOT NULL REFERENCES participants(name_key),
        joined_at INTEGER NOT NULL,
        signups   INTEGER NOT NULL DEFAULT 0 CHECK (signups >= 0)
      );
      CREATE INDEX IF NOT EXISTS queue_name_key ON queue(name_key);

      CREATE TABLE IF NOT EXISTS history (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT NOT NULL,
        signups  INTEGER NOT NULL CHECK (signups >= 0)
      );
    `);

    // Liczba zapisów zapisywana w wpisie. Starsze wpisy biorą ją z participants.
    if (hasLegacyQueue) {
      db.exec(`
        INSERT INTO queue (name_key, joined_at, signups)
        SELECT o.name_key, o.joined_at, COALESCE(p.signups, 0)
        FROM queue_old o LEFT JOIN participants p ON p.name_key = o.name_key
        ORDER BY o.id
      `);
      db.exec('DROP TABLE queue_old');
    } else if (missingSignups) {
      db.exec('ALTER TABLE queue ADD COLUMN signups INTEGER NOT NULL DEFAULT 0');
      db.exec(`
        UPDATE queue SET signups = COALESCE(
          (SELECT p.signups FROM participants p WHERE p.name_key = queue.name_key), 0)
      `);
    }
  })();

  return db;
}

module.exports = { openDatabase };
