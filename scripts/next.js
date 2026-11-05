'use strict';

// Usuwa osobę z początku kolejki (kończy aktualne zadanie).
// Uruchomienie: npm run next

const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createQueue } = require('../src/queue');

const config = loadConfig();
const db = openDatabase(config.database.path);
const queue = createQueue(db, config.queue);

const finished = queue.next();
db.close();

if (finished === null) {
  console.log('Kolejka jest pusta.');
} else {
  console.log(`Zakończono zadanie: ${finished}`);
}
