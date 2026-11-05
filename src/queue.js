'use strict';

/**
 * Logika kolejki.
 *
 * - Każdy wpis zapisuje liczbę zapisów osoby z chwili dołączenia. Kolejka jest
 *   uporządkowana po tej wartości: kto miał mniej zapisów, jest wyżej; przy
 *   równej liczbie obowiązuje kolejność zgłoszeń. Istniejące wpisy się nie przesuwają,
 *   gdy ta sama osoba zapisze się ponownie.
 * - Ponowny zapis osoby już będącej w kolejce tworzy nowy wpis z jej aktualną liczbą zapisów.
 */
const ORDER_BY = 'q.signups ASC, q.joined_at ASC, q.id ASC';
const HISTORY_LIMIT = 200;

function createQueue(db, { maxLength }) {
  const stmt = {
    participant: db.prepare(
      'SELECT display_name, signups FROM participants WHERE name_key = ?'
    ),
    count: db.prepare('SELECT COUNT(*) AS n FROM queue'),
    upsertParticipant: db.prepare(`
      INSERT INTO participants (name_key, display_name, signups) VALUES (?, ?, 1)
      ON CONFLICT(name_key) DO UPDATE SET
        signups = signups + 1,
        display_name = excluded.display_name
    `),
    enqueue: db.prepare('INSERT INTO queue (name_key, joined_at, signups) VALUES (?, ?, ?)'),
    ordered: db.prepare(`
      SELECT q.id, q.name_key, p.display_name, q.signups
      FROM queue q
      JOIN participants p ON p.name_key = q.name_key
      ORDER BY ${ORDER_BY}
    `),
    dequeueById: db.prepare('DELETE FROM queue WHERE id = ?'),
    addHistory: db.prepare('INSERT INTO history (name, signups) VALUES (?, ?)'),
    history: db.prepare('SELECT name, signups FROM history ORDER BY id DESC LIMIT ?'),
  };

  function historyEntries(limit = HISTORY_LIMIT) {
    return stmt.history.all(limit).map((row) => ({ name: row.name, signups: row.signups }));
  }

  function entries() {
    return stmt.ordered.all().map((row, index) => ({
      id: row.id,
      position: index + 1,
      name: row.display_name,
      signups: row.signups,
    }));
  }

  function snapshot() {
    const rows = stmt.ordered.all();
    return {
      first: rows[0]?.display_name ?? null,
      queue: rows.map((row, index) => ({
        position: index + 1,
        name: row.display_name,
        signups: row.signups,
      })),
    };
  }

  function enqueue(name, key) {
    stmt.upsertParticipant.run(key, name);
    const { signups } = stmt.participant.get(key);
    const { lastInsertRowid } = stmt.enqueue.run(key, Date.now(), signups);
    const position =
      stmt.ordered.all().findIndex((row) => row.id === Number(lastInsertRowid)) + 1;
    return { position, yourSignups: signups };
  }

  const join = db.transaction((name, key) => {
    if (stmt.count.get().n >= maxLength) {
      return { status: 'full' };
    }
    return { status: 'joined', ...enqueue(name, key) };
  });

  const addEntry = db.transaction((name, key) => {
    if (stmt.count.get().n >= maxLength) {
      return { status: 'full' };
    }
    return { status: 'added', ...enqueue(name, key) };
  });

  const next = db.transaction(() => {
    const head = stmt.ordered.get();
    if (!head) return null;
    stmt.addHistory.run(head.display_name, head.signups);
    stmt.dequeueById.run(head.id);
    return head.display_name;
  });

  return {
    join: (name, key) => join(name, key),
    addEntry: (name, key) => addEntry(name, key),
    removeEntry: (id) => stmt.dequeueById.run(id).changes > 0,
    entries,
    snapshot,
    next,
    history: historyEntries,
  };
}

module.exports = { createQueue };
