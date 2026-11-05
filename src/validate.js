'use strict';

// Co najmniej dwa wyrazy (imię i nazwisko), każdy zaczyna się literą;
// w wyrazach dozwolone są litery, apostrof i myślnik (np. „Anna Kowalska-Nowak”, „Jan O'Neil”).
const FULL_NAME = /^\p{L}[\p{L}'’-]*(?: \p{L}[\p{L}'’-]*)+$/u;
const RAW_INPUT_LIMIT = 200;

function normalizeName(input, { minLength, maxLength }) {
  if (typeof input !== 'string') {
    return { error: 'Podaj imię.' };
  }
  if (input.length > RAW_INPUT_LIMIT) {
    return { error: 'Imię jest za długie.' };
  }

  const name = input.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = [...name].length;

  if (length < minLength || length > maxLength) {
    return { error: `Imię musi mieć od ${minLength} do ${maxLength} znaków.` };
  }
  if (!FULL_NAME.test(name)) {
    return {
      error: 'Podaj imię i nazwisko (np. Anna Kowalska). Dozwolone są litery, apostrof i myślnik.',
    };
  }

  return { name, key: name.toLowerCase() };
}

module.exports = { normalizeName };
