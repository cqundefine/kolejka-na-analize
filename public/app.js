'use strict';

const REFRESH_MS = 5000;

const form = document.getElementById('join-form');
const input = document.getElementById('name');
const submitButton = form.querySelector('button');
const message = document.getElementById('message');
const first = document.getElementById('first');
const list = document.getElementById('queue');
const empty = document.getElementById('empty');

function showMessage(text, isError) {
  message.textContent = text;
  message.className = isError ? 'error' : 'ok';
}

function render(state) {
  first.textContent = state.first ?? 'nikt';

  const items = state.queue.map((entry) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `zapisy: ${entry.signups}`;

    li.append(name, ' ', count);
    return li;
  });

  list.replaceChildren(...items);
  empty.hidden = items.length > 0;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/queue', { cache: 'no-store' });
    if (response.ok) render(await readJson(response));
  } catch {
    // Błąd sieci – spróbujemy ponownie przy następnym odświeżeniu.
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;

  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.value }),
    });
    const data = await readJson(response);

    if (data.state) render(data.state);
    const succeeded = data.status === 'joined';
    showMessage(data.message ?? data.error ?? 'Nieoczekiwana odpowiedź serwera.', !succeeded);
    if (succeeded) input.value = '';
  } catch {
    showMessage('Brak połączenia z serwerem.', true);
  } finally {
    submitButton.disabled = false;
  }
});

refresh();
setInterval(refresh, REFRESH_MS);
