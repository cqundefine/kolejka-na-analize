'use strict';

const loginSection = document.getElementById('login');
const panel = document.getElementById('panel');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password');
const message = document.getElementById('message');
const list = document.getElementById('queue');
const empty = document.getElementById('empty');
const historyList = document.getElementById('history');
const historyEmpty = document.getElementById('history-empty');
const taken = document.getElementById('taken');
const capacity = document.getElementById('capacity');
const addForm = document.getElementById('add-form');
const newNameInput = document.getElementById('new-name');
const nextButton = document.getElementById('next');
const resetButton = document.getElementById('reset');
const logoutButton = document.getElementById('logout');
const passwordForm = document.getElementById('password-form');

function showMessage(text, isError) {
  message.textContent = text;
  message.className = isError ? 'error' : 'ok';
}

async function request(method, url, body) {
  const options = { method, cache: 'no-store', headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Odpowiedź bez JSON-a – zostawiamy pusty obiekt.
  }
  return { status: response.status, ok: response.ok, data };
}

const REFRESH_MS = 5000;
let refreshTimer = null;

function showLogin(text) {
  stopAutoRefresh();
  panel.hidden = true;
  loginSection.hidden = false;
  passwordInput.value = '';
  if (text) showMessage(text, true);
}

function showPanel() {
  loginSection.hidden = true;
  panel.hidden = false;
}

function render(data) {
  taken.textContent = String(data.entries.length);
  capacity.textContent = String(data.maxLength);

  const items = data.entries.map((entry) => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `zapisy: ${entry.signups}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Usuń';
    remove.addEventListener('click', () => removeEntry(entry.id, entry.name));

    li.append(name, ' ', count, ' ', remove);
    return li;
  });

  list.replaceChildren(...items);
  empty.hidden = items.length > 0;

  const historyItems = data.history.map((entry) => {
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

  historyList.replaceChildren(...historyItems);
  historyEmpty.hidden = historyItems.length > 0;
}

// Każda odpowiedź API przechodzi tędy: 401 oznacza wygasłą sesję.
function handle(result, onSuccess) {
  if (result.status === 401) {
    showLogin(result.data.error ?? 'Sesja wygasła. Zaloguj się ponownie.');
    return;
  }
  if (!result.ok) {
    showMessage(result.data.error ?? 'Wystąpił błąd.', true);
    return;
  }
  if (result.data.entries) render(result.data);
  if (onSuccess) onSuccess(result.data);
}

// Zmiany od innych osób (zapisy, następny) pojawiają się bez ręcznego odświeżania.
function startAutoRefresh() {
  if (refreshTimer === null) refreshTimer = setInterval(refreshSilently, REFRESH_MS);
}

function stopAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

async function refreshSilently() {
  try {
    const result = await request('GET', '/api/admin/queue');
    if (result.status === 401) {
      showLogin(result.data.error ?? 'Sesja wygasła. Zaloguj się ponownie.');
      return;
    }
    if (result.ok) render(result.data);
  } catch {
    // Błąd sieci – spróbujemy przy następnym odświeżeniu.
  }
}

async function loadQueue() {
  try {
    const result = await request('GET', '/api/admin/queue');
    if (result.status === 401) {
      showLogin();
      return;
    }
    showPanel();
    handle(result);
    startAutoRefresh();
  } catch {
    showMessage('Brak połączenia z serwerem.', true);
  }
}

async function removeEntry(id, name) {
  if (!window.confirm(`Usunąć z kolejki: ${name}?`)) return;
  const result = await request('DELETE', `/api/admin/queue/${id}`);
  handle(result, (data) => showMessage(data.message, false));
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await request('POST', '/api/admin/login', { password: passwordInput.value });
  if (result.ok) {
    passwordInput.value = '';
    showMessage('', false);
    await loadQueue();
  } else {
    showMessage(result.data.error ?? 'Nie udało się zalogować.', true);
  }
});

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await request('POST', '/api/admin/queue', { name: newNameInput.value });
  handle(result, (data) => {
    showMessage(data.message, false);
    newNameInput.value = '';
  });
});

nextButton.addEventListener('click', async () => {
  const result = await request('POST', '/api/admin/next');
  handle(result, (data) => showMessage(data.message, false));
});

resetButton.addEventListener('click', async () => {
  if (!confirm('Na pewno zresetować wszystko? Kolejka i historia zostaną usunięte.')) return;
  const result = await request('POST', '/api/admin/reset', { confirm: 'RESET' });
  handle(result, (data) => showMessage(data.message, false));
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const current = document.getElementById('current-password');
  const next = document.getElementById('new-password');
  const result = await request('POST', '/api/admin/password', {
    current: current.value,
    next: next.value,
  });
  current.value = '';
  next.value = '';
  if (result.ok) {
    showLogin(result.data.message);
    showMessage(result.data.message, false);
  } else {
    handle(result);
  }
});

logoutButton.addEventListener('click', async () => {
  await request('POST', '/api/admin/logout');
  showLogin();
  showMessage('Wylogowano.', false);
});

loadQueue();
