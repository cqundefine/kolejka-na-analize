'use strict';

const JOIN_COOLDOWN_KEY = 'join_cooldown_ms';
const JOIN_COOLDOWN_MAX_MS = 3600000;

// Ustawienia zmieniane z panelu admina, zapisane w tabeli `settings`.
// Dopóki admin ich nie zmieni, obowiązują wartości z config.json.
function createSettings(db, { joinCooldownMs: defaultJoinCooldownMs }) {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  return {
    joinCooldownMs() {
      const stored = read.get(JOIN_COOLDOWN_KEY)?.value;
      return stored === undefined ? defaultJoinCooldownMs : Number(stored);
    },
    setJoinCooldownMs(ms) {
      write.run(JOIN_COOLDOWN_KEY, String(ms));
    },
  };
}

module.exports = { createSettings, JOIN_COOLDOWN_MAX_MS };
