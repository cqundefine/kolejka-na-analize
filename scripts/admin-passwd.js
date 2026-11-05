'use strict';

// Ustawia hasło administratora (hash trafia do bazy). Uruchomienie: npm run admin:passwd
// Hasła nie podajemy jako argument, żeby nie trafiło do historii powłoki ani listy procesów.

const readline = require('node:readline');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createAdminAuth, validatePassword } = require('../src/auth');

let rl;
let lines;
let muted = false;

// Jeden interfejs dla obu pytań: przy wejściu z potoku readline czytałby drugą linię w pustkę.
function ask(question) {
  const terminal = Boolean(process.stdin.isTTY);
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal });
    lines = rl[Symbol.asyncIterator]();
    if (terminal) {
      rl._writeToOutput = (text) => {
        if (!muted) rl.output.write(text);
      };
    }
  }
  process.stdout.write(question);
  muted = terminal;
  return lines.next().then(({ value, done }) => {
    muted = false;
    process.stdout.write('\n');
    return done ? '' : value;
  });
}

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.database.path);

  try {
    const password = await ask('Nowe hasło administratora: ');
    const problem = validatePassword(password);
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
      return;
    }

    const repeated = await ask('Powtórz hasło: ');
    if (password !== repeated) {
      console.error('Hasła się nie zgadzają.');
      process.exitCode = 1;
      return;
    }

    await createAdminAuth(db, config.admin).setPassword(password);
    console.log('Hasło administratora zapisane. Aktywne sesje panelu zostały unieważnione.');
  } finally {
    rl?.close();
    db.close();
  }
}

main();
