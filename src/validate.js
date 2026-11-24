'use strict';

// Imion nie walidujemy wzorcem – o dopuszczeniu decyduje whitelista (src/whitelist.js).
// Tutaj tylko czyścimy wejście: typ, długość i znaki sterujące.
const RAW_INPUT_LIMIT = 200;
const CONTROL_CHARS = /[\p{Cc}<>]/u;

function canonicalizeName(value) {
  return value
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(?<![\p{L}\p{N}])(\p{L})/gu, (match) => match.toUpperCase());
}

function normalizeName(input, { maxLength }) {
  if (typeof input !== 'string') {
    return { error: 'Podaj imię.' };
  }
  if (input.length > RAW_INPUT_LIMIT) {
    return { error: 'Imię jest za długie.' };
  }

  const name = canonicalizeName(input);
  if (name.length === 0) {
    return { error: 'Podaj imię.' };
  }
  if (CONTROL_CHARS.test(name)) {
    return { error: 'Imię zawiera niedozwolone znaki.' };
  }
  if ([...name].length > maxLength) {
    return { error: `Imię może mieć najwyżej ${maxLength} znaków.` };
  }

  return { name, key: name.toLowerCase() };
}

module.exports = { normalizeName };
