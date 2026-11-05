'use strict';

// Czyści bazę i zaczyna nową kolejkę. Ustawienia: sekcja "reset" w config.json.
// Uruchomienie: npm run reset -- --yes

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');

if (!process.argv.includes('--yes')) {
  console.error('Ta operacja usuwa całą kolejkę. Potwierdź flagą: npm run reset -- --yes');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config.database.path);

if (config.reset.backup) {
  fs.mkdirSync(config.reset.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(config.reset.backupDir, `kolejka-${stamp}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backupFile);
  console.log(`Kopia zapasowa: ${backupFile}`);
}

const removed = db.transaction(() => {
  const { changes } = db.prepare('DELETE FROM queue').run();
  db.prepare('DELETE FROM history').run();
  if (config.reset.clearParticipants) {
    db.prepare('DELETE FROM participants').run();
  } else {
    db.prepare('UPDATE participants SET signups = 0').run();
  }
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('queue', 'history')").run();
  return changes;
})();

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

console.log(`Usunięto wpisów z kolejki: ${removed}`);
console.log(
  config.reset.clearParticipants
    ? 'Wyczyszczono listę osób. Nowa kolejka gotowa.'
    : 'Wyzerowano liczniki zapisów. Nowa kolejka gotowa.'
);
