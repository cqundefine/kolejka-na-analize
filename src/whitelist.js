'use strict';

const fs = require('node:fs');
const YAML = require('yaml');
const { normalizeName } = require('./validate');

const MAX_FILE_BYTES = 256 * 1024;

// Plik to lista YAML z imionami, po jednym w wierszu: "- Anna Kowalska".
function parseWhitelist(text, maxLength) {
  const data = YAML.parse(text) ?? [];
  if (!Array.isArray(data)) {
    throw new Error('plik musi zawierać listę imion (wiersze zaczynające się od "- ")');
  }

  const people = new Map();
  const invalid = [];
  for (const item of data) {
    const parsed = normalizeName(item, { maxLength });
    if (parsed.error) {
      invalid.push(JSON.stringify(item));
      continue;
    }
    people.set(parsed.key, parsed.name);
  }
  if (invalid.length > 0) {
    throw new Error(`błędne wpisy: ${invalid.slice(0, 5).join(', ')}`);
  }
  return people;
}

/**
 * Whitelista osób, które mogą się zapisać, czytana z pliku YAML. Plik jest źródłem prawdy:
 * przy starcie musi być poprawny, a zmiany wczytujemy przy kolejnym zapytaniu. Gdy nowy plik
 * jest błędny, zostaje ostatnia poprawna lista.
 */
function createWhitelist({ file, maxLength }) {
  function stamp() {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  }

  function load() {
    if (fs.statSync(file).size > MAX_FILE_BYTES) {
      throw new Error('plik jest za duży');
    }
    return parseWhitelist(fs.readFileSync(file, 'utf8'), maxLength);
  }

  let people;
  let seen;
  try {
    seen = stamp();
    people = load();
  } catch (err) {
    throw new Error(`whitelist (${file}): ${err.message}`);
  }

  function refresh() {
    let current;
    try {
      current = stamp();
    } catch (err) {
      console.error(`whitelist: nie można odczytać ${file}: ${err.message}`);
      return;
    }
    if (current === seen) return;

    seen = current;
    try {
      people = load();
      console.log(`whitelist: wczytano ${people.size} osób z ${file}`);
    } catch (err) {
      console.error(`whitelist: błędny plik, zostaje poprzednia lista: ${err.message}`);
    }
  }

  // Zwraca dane osoby z listy albo błąd z kodem HTTP (400 – format, 403 – brak na liście).
  function resolve(input) {
    const parsed = normalizeName(input, { maxLength });
    if (parsed.error) return { error: parsed.error, status: 400 };

    refresh();
    const name = people.get(parsed.key);
    if (name) return { name, key: parsed.key };

    if (people.size === 0) {
      return { error: 'Lista uprawnionych osób jest pusta. Poproś administratora o dodanie.', status: 403 };
    }
    return { error: 'Tej osoby nie ma na liście uprawnionych.', status: 403 };
  }

  return { resolve };
}

module.exports = { createWhitelist };
