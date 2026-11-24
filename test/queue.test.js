'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../src/db');
const { createQueue } = require('../src/queue');
const { createWhitelist } = require('../src/whitelist');
const { createAdminAuth, validatePassword } = require('../src/auth');
const { normalizeName } = require('../src/validate');
const { createSettings, JOIN_COOLDOWN_MAX_MS } = require('../src/settings');

const LIMITS = { maxLength: 64 };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kolejka-test-'));
}

const WHITELIST_NAMES = ['Ola Nowak', 'Piotr Zieliński', 'Anna Kowalska', 'Bartek Lis', 'Celina Sosnowska', 'Jan Nowak'];

function writeWhitelist(file, names) {
  const body = names.map((name) => `- ${JSON.stringify(name)}\n`).join('');
  fs.writeFileSync(file, body || '[]\n');
}

function setup(names = WHITELIST_NAMES) {
  const dir = tempDir();
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  const queue = createQueue(db, { maxLength: 50 });
  const file = path.join(dir, 'whitelist.yaml');
  writeWhitelist(file, names);
  const whitelist = createWhitelist({ file, maxLength: LIMITS.maxLength });
  const join = (name) => {
    const parsed = whitelist.resolve(name);
    assert.ok(!parsed.error, parsed.error);
    return queue.join(parsed.name, parsed.key);
  };
  const cleanup = () => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { db, dir, file, queue, whitelist, join, cleanup };
}

test('normalizacja czyści wejście: typ, długość, znaki sterujące i znaczniki, bez wymogu nazwiska', () => {
  assert.equal(normalizeName('Anna', LIMITS).name, 'Anna');
  assert.ok(normalizeName('', LIMITS).error);
  assert.ok(normalizeName('   ', LIMITS).error);
  assert.ok(normalizeName('<script>alert(1)</script>', LIMITS).error);
  assert.ok(normalizeName('Anna Kowalska\u0000', LIMITS).error);
  assert.ok(normalizeName('x'.repeat(65), LIMITS).error);
  assert.ok(normalizeName('x'.repeat(201), LIMITS).error);
  assert.ok(normalizeName(42, LIMITS).error);

  const a = normalizeName('  Anna   Kowalska ', LIMITS);
  const b = normalizeName('ANNA KOWALSKA', LIMITS);
  assert.equal(a.name, 'Anna Kowalska');
  assert.equal(a.key, b.key);
  assert.equal(normalizeName("JAN O'NEIL", LIMITS).name, "Jan O'Neil");
});

test('whitelista dopasowuje osobę bez względu na wielkość liter i spacje, zwraca imię z listy', () => {
  const { whitelist, cleanup } = setup();
  try {
    const found = whitelist.resolve('  anna   KOWALSKA ');
    assert.equal(found.name, 'Anna Kowalska');
    assert.equal(found.key, 'anna kowalska');
  } finally {
    cleanup();
  }
});

test('whitelista odrzuca osoby spoza listy (403) i błędny format (400)', () => {
  const { whitelist, cleanup } = setup(['Jan Nowak']);
  try {
    assert.equal(whitelist.resolve('Anna Kowalska').status, 403);
    assert.equal(whitelist.resolve('<b>Jan Nowak</b>').status, 400);
  } finally {
    cleanup();
  }
});

test('pusta whitelista zwraca osobny komunikat, żeby admin wiedział, co dodać', () => {
  const { whitelist, cleanup } = setup([]);
  try {
    const result = whitelist.resolve('Anna Kowalska');
    assert.equal(result.status, 403);
    assert.match(result.error, /pusta/);
  } finally {
    cleanup();
  }
});

test('plik whitelisty przy starcie musi istnieć i być poprawną listą', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'whitelist.yaml');
    assert.throws(() => createWhitelist({ file, maxLength: 64 }), /whitelist/);

    fs.writeFileSync(file, 'klucz: wartość\n');
    assert.throws(() => createWhitelist({ file, maxLength: 64 }), /listę imion/);

    fs.writeFileSync(file, '- "<script>"\n');
    assert.throws(() => createWhitelist({ file, maxLength: 64 }), /błędne wpisy/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zmiana pliku jest wczytywana bez restartu; usunięta osoba nie może się zapisać, ale zostaje w kolejce', () => {
  const { file, queue, whitelist, join, cleanup } = setup();
  try {
    join('Anna Kowalska');
    writeWhitelist(file, ['Jan Nowak']);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);

    assert.equal(whitelist.resolve('Anna Kowalska').status, 403);
    assert.equal(whitelist.resolve('Jan Nowak').name, 'Jan Nowak');
    assert.deepEqual(queue.snapshot().queue.map((e) => e.name), ['Anna Kowalska']);
  } finally {
    cleanup();
  }
});

test('błędna zmiana pliku zostawia ostatnią poprawną listę', () => {
  const { file, whitelist, cleanup } = setup(['Jan Nowak']);
  try {
    fs.writeFileSync(file, '- "<b>"\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    assert.equal(whitelist.resolve('Jan Nowak').name, 'Jan Nowak');
  } finally {
    cleanup();
  }
});

test('nowa osoba z mniejszą liczbą zapisów wbija się przed osobę z większą', () => {
  const { queue, join, cleanup } = setup();
  try {
    join('Ola Nowak');
    queue.next();
    join('Ola Nowak');
    assert.deepEqual(queue.snapshot().queue.map((e) => e.name), ['Ola Nowak']);

    const newcomer = join('Piotr Zieliński');
    assert.equal(newcomer.status, 'joined');
    assert.equal(newcomer.position, 1);
    assert.deepEqual(queue.snapshot().queue.map((e) => e.name), ['Piotr Zieliński', 'Ola Nowak']);
  } finally {
    cleanup();
  }
});

test('osoba już w kolejce może zapisać się ponownie; nowy wpis idzie wg liczby zapisów', () => {
  const { queue, join, cleanup } = setup();
  try {
    join('Ola Nowak');
    join('Piotr Zieliński');
    const again = join('Ola Nowak');
    assert.equal(again.status, 'joined');
    assert.equal(again.yourSignups, 2);
    assert.deepEqual(
      queue.snapshot().queue.map((e) => [e.name, e.signups]),
      [
        ['Ola Nowak', 1],
        ['Piotr Zieliński', 1],
        ['Ola Nowak', 2],
      ]
    );
  } finally {
    cleanup();
  }
});

test('ponowny zapis nie przesuwa istniejącego wpisu osoby', () => {
  const { queue, join, cleanup } = setup();
  try {
    join('Ola Nowak');
    join('Piotr Zieliński');
    join('Ola Nowak');
    assert.deepEqual(queue.snapshot().queue.map((e) => e.name), [
      'Ola Nowak',
      'Piotr Zieliński',
      'Ola Nowak',
    ]);
  } finally {
    cleanup();
  }
});

test('przy równej liczbie zapisów obowiązuje kolejność zgłoszeń', () => {
  const { queue, join, cleanup } = setup();
  try {
    join('Anna Kowalska');
    join('Bartek Lis');
    join('Celina Sosnowska');
    assert.deepEqual(queue.snapshot().queue.map((e) => e.name), [
      'Anna Kowalska',
      'Bartek Lis',
      'Celina Sosnowska',
    ]);
  } finally {
    cleanup();
  }
});

test('admin może dodać tę samą osobę kilka razy i usunąć wybraną pozycję', () => {
  const { queue, cleanup } = setup();
  try {
    const key = normalizeName('Ola Nowak', LIMITS).key;
    queue.addEntry('Ola Nowak', key);
    const second = queue.addEntry('Ola Nowak', key);
    assert.equal(second.status, 'added');
    assert.equal(second.yourSignups, 2);

    const [first, other] = queue.entries();
    assert.equal(first.name, 'Ola Nowak');
    assert.equal(other.name, 'Ola Nowak');

    assert.equal(queue.removeEntry(first.id), true);
    assert.equal(queue.removeEntry(first.id), false);
    assert.deepEqual(queue.entries().map((e) => e.id), [other.id]);
  } finally {
    cleanup();
  }
});

test('next usuwa osobę z początku kolejki', () => {
  const { queue, join, cleanup } = setup();
  try {
    join('Anna Kowalska');
    join('Bartek Lis');
    assert.equal(queue.next(), 'Anna Kowalska');
    assert.equal(queue.next(), 'Bartek Lis');
    assert.equal(queue.next(), null);
  } finally {
    cleanup();
  }
});

test('next zapisuje w historii imię i liczbę zapisów z chwili dołączenia wpisu', () => {
  const { queue, join, cleanup } = setup();
  try {
    join('Anna Kowalska');
    join('Bartek Lis');
    join('Anna Kowalska');
    assert.equal(queue.next(), 'Anna Kowalska');
    assert.equal(queue.next(), 'Bartek Lis');
    assert.equal(queue.next(), 'Anna Kowalska');
    assert.deepEqual(queue.history(), [
      { name: 'Anna Kowalska', signups: 2 },
      { name: 'Bartek Lis', signups: 1 },
      { name: 'Anna Kowalska', signups: 1 },
    ]);
  } finally {
    cleanup();
  }
});

test('hasło administratora jest hashowane, a zmiana hasła unieważnia sesje', async () => {
  const { db, cleanup } = setup();
  try {
    const auth = createAdminAuth(db, { sessionMinutes: 60 });
    assert.equal(auth.hasPassword(), false);

    await auth.setPassword('correct horse battery');
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get().value;
    assert.ok(stored.startsWith('scrypt:'));
    assert.ok(!stored.includes('correct horse'));

    assert.equal(await auth.verify('correct horse battery'), true);
    assert.equal(await auth.verify('wrong password here'), false);

    const token = auth.createSession();
    assert.equal(auth.isValidSession(token), true);

    await auth.setPassword('another long password');
    assert.equal(auth.isValidSession(token), false);
  } finally {
    cleanup();
  }
});

test('walidacja hasła wymaga 12–128 znaków', () => {
  assert.ok(validatePassword('short'));
  assert.ok(validatePassword('x'.repeat(129)));
  assert.equal(validatePassword('x'.repeat(12)), null);
});

test('stara baza z kolumną priority jest przenoszona bez utraty kolejki', () => {
  const dir = tempDir();
  const file = path.join(dir, 'legacy.sqlite');
  try {
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE participants (
        name_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        signups INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_key TEXT NOT NULL UNIQUE REFERENCES participants(name_key),
        joined_at INTEGER NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO participants VALUES ('ola nowak', 'Ola Nowak', 1), ('piotr zielinski', 'Piotr Zielinski', 2);
      INSERT INTO queue (name_key, joined_at, priority) VALUES ('ola nowak', 1, 0), ('piotr zielinski', 2, 0);
    `);
    legacy.close();

    const db = openDatabase(file);
    const names = db
      .prepare('SELECT p.display_name FROM queue q JOIN participants p USING (name_key) ORDER BY q.id')
      .all()
      .map((row) => row.display_name);
    assert.deepEqual(names, ['Ola Nowak', 'Piotr Zielinski']);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('usunięcie wszystkich zapisów osoby czyści jej wpisy i licznik, reszta kolejki zostaje', () => {
  const { db, queue, join, cleanup } = setup();
  try {
    join('Ola Nowak');
    join('Piotr Zieliński');
    join('Ola Nowak');
    queue.next();
    const olaEntry = queue.entries().find((e) => e.name === 'Ola Nowak');

    const result = queue.removePerson(olaEntry.id);
    assert.deepEqual(result, { name: 'Ola Nowak', removed: 1 });
    assert.deepEqual(queue.snapshot().queue.map((e) => e.name), ['Piotr Zieliński']);
    assert.equal(db.prepare("SELECT signups FROM participants WHERE name_key = 'ola nowak'").get().signups, 0);
    assert.deepEqual(queue.history(), [{ name: 'Ola Nowak', signups: 1 }]);
    assert.equal(queue.removePerson(999999), null);

    const again = join('Ola Nowak');
    assert.equal(again.yourSignups, 1);
  } finally {
    cleanup();
  }
});

test('ustawienie cooldownu z panelu ma pierwszeństwo nad config.json i przetrwa ponowne otwarcie bazy', () => {
  const { db, dir } = setup();
  try {
    const settings = createSettings(db, { joinCooldownMs: 60000 });
    assert.equal(settings.joinCooldownMs(), 60000);

    settings.setJoinCooldownMs(0);
    assert.equal(settings.joinCooldownMs(), 0);
    settings.setJoinCooldownMs(JOIN_COOLDOWN_MAX_MS);

    db.close();
    const reopened = openDatabase(path.join(dir, 'test.sqlite'));
    assert.equal(createSettings(reopened, { joinCooldownMs: 60000 }).joinCooldownMs(), JOIN_COOLDOWN_MAX_MS);
    reopened.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reset czyści kolejkę i historię, zachowuje ustawienia i zapisuje kopię', () => {
  const { db, queue, join, cleanup } = setup();
  const backupDir = tempDir();
  try {
    join('Anna Kowalska');
    join('Jan Nowak');
    queue.next();
    db.prepare("INSERT INTO settings (key, value) VALUES ('keep', 'yes')").run();

    const result = queue.reset({ backup: true, backupDir, clearParticipants: false });

    assert.equal(result.removed, 1);
    assert.ok(result.backupFile && fs.existsSync(result.backupFile));
    assert.deepEqual(queue.entries(), []);
    assert.deepEqual(queue.history(), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants WHERE signups > 0').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 2);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'keep'").get().value, 'yes');
  } finally {
    cleanup();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});
