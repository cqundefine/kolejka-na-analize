'use strict';

// Czyści bazę i zaczyna nową kolejkę. Ustawienia: sekcja "reset" w config.json.
// Uruchomienie: npm run reset -- --yes

const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createQueue } = require('../src/queue');

if (!process.argv.includes('--yes')) {
  console.error('Ta operacja usuwa całą kolejkę. Potwierdź flagą: npm run reset -- --yes');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config.database.path);
const { removed, backupFile, clearParticipants } = createQueue(db, config.queue).reset(config.reset);
db.close();

if (backupFile) console.log(`Kopia zapasowa: ${backupFile}`);
console.log(`Usunięto wpisów z kolejki: ${removed}`);
console.log(
  clearParticipants
    ? 'Wyczyszczono listę osób. Nowa kolejka gotowa.'
    : 'Wyzerowano liczniki zapisów. Nowa kolejka gotowa.'
);
