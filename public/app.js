'use strict';

const REFRESH_MS = 5000;

const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name');
const joinPanel = document.getElementById('join-panel');
const who = document.getElementById('who');
const joinButton = document.getElementById('join');
const backButton = document.getElementById('back');
const message = document.getElementById('message');
const first = document.getElementById('first');
const list = document.getElementById('queue');
const empty = document.getElementById('empty');

// Imię wybrane w kroku 1 i koniec blokady zapisu dla tej osoby. Serwer i tak pilnuje limitu.
let pendingName = null;
let cooldown = { name: null, until: 0 };

function showMessage(text, isError) {
  message.textContent = text;
  message.className = isError ? 'error' : 'ok';
}

function showJoinStep(name) {
  pendingName = name;
  who.textContent = name;
  nameForm.hidden = true;
  joinPanel.hidden = false;
  updateJoinButton();
}

function showNameStep() {
  pendingName = null;
  joinPanel.hidden = true;
  nameForm.hidden = false;
  nameInput.focus();
}

function cooldownLeftMs(name) {
  if (!name || cooldown.name !== name) return 0;
  return Math.max(0, cooldown.until - Date.now());
}

function updateJoinButton() {
  const left = cooldownLeftMs(pendingName);
  joinButton.disabled = left > 0;
  joinButton.textContent = left > 0 ? `Zapisz się za ${Math.ceil(left / 1000)} s` : 'Zapisz się';
}

function startCooldown(name, ms) {
  if (ms > 0) cooldown = { name, until: Date.now() + ms };
  updateJoinButton();
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

nameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    showMessage('Wpisz imię i nazwisko.', true);
    return;
  }
  showMessage('', false);
  showJoinStep(name);
});

backButton.addEventListener('click', () => {
  showMessage('', false);
  showNameStep();
});

joinButton.addEventListener('click', async () => {
  const name = pendingName;
  if (!name) return;
  joinButton.disabled = true;

  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await readJson(response);

    if (data.state) render(data.state);
    const succeeded = data.status === 'joined';
    showMessage(data.message ?? data.error ?? 'Nieoczekiwana odpowiedź serwera.', !succeeded);
    if (succeeded) {
      startCooldown(name, data.cooldownMs ?? 0);
    } else if (response.status === 429) {
      startCooldown(name, Number(response.headers.get('Retry-After')) * 1000);
    }
  } catch {
    showMessage('Brak połączenia z serwerem.', true);
  } finally {
    updateJoinButton();
  }
});

refresh();
setInterval(refresh, REFRESH_MS);
setInterval(updateJoinButton, 1000);
