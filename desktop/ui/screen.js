'use strict';
// The app's one screen: a botdot address and a button, and on a Mac a second button that runs botdot on it (ADR 136).
// The rest happens in the browser and on the front door's page.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const WORDS = {
  en: { address: 'botdot address', go: 'Continue', invalid: "That's not a botdot address.", unreachable: "Can't reach botdot there.", failed: "The sign-in didn't finish. Try again.", here: 'Run botdot on this Mac', small: 'This Mac needs at least 12 GB of memory and 40 GB of free disk.', setting: 'Setting up botdot…', passkey: 'Make your passkey in the browser.', stopped: "botdot didn't start on this Mac. Try again." },
  pl: { address: 'Adres botdota', go: 'Dalej', invalid: 'To nie jest adres botdota.', unreachable: 'Nie mogę połączyć się z botdotem pod tym adresem.', failed: 'Logowanie się nie udało. Spróbuj jeszcze raz.', here: 'Uruchom botdota na tym Macu', small: 'Ten Mac potrzebuje co najmniej 12 GB pamięci i 40 GB wolnego miejsca.', setting: 'Konfiguruję botdota…', passkey: 'Utwórz klucz dostępu w przeglądarce.', stopped: 'Botdot nie uruchomił się na tym Macu. Spróbuj jeszcze raz.' },
};
const words = navigator.language.toLowerCase().startsWith('pl') ? WORDS.pl : WORDS.en;

const form = document.getElementById('connect');
const address = document.getElementById('address');
const go = document.getElementById('go');
const here = document.getElementById('here');
const said = document.getElementById('said');
const line = document.getElementById('line');
const last = document.getElementById('last');

address.placeholder = words.address;
address.setAttribute('aria-label', words.address);
go.textContent = words.go;
here.textContent = words.here;

// While the setup runs, one line says what it is doing.
function setting(text) {
  form.hidden = true;
  line.textContent = text;
  line.hidden = false;
}

function ended() {
  line.hidden = true;
  form.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  go.disabled = true;
  said.textContent = '';
  try {
    await invoke('connect', { address: address.value });
  } catch (error) {
    said.textContent = words[error] || words.failed;
  } finally {
    go.disabled = false;
  }
});

here.addEventListener('click', async () => {
  said.textContent = '';
  last.hidden = true;
  setting(words.setting);
  try {
    await invoke('run_here');
  } catch (error) {
    ended();
    said.textContent = words[error] || words.stopped;
  }
});

listen('local-line', ({ payload }) => setting(payload));
listen('local-passkey', () => {
  setting(words.passkey);
  form.hidden = false;
  address.hidden = go.hidden = true;
});
listen('local-failed', ({ payload }) => {
  ended();
  said.textContent = words.stopped;
  last.textContent = payload.join('\n');
  last.hidden = !payload.length;
});
listen('sign-in-failed', () => {
  ended();
  address.hidden = go.hidden = false;
  said.textContent = words.failed;
});

invoke('start', { adding: new URLSearchParams(location.search).has('add') }).then((start) => {
  if (start.entering) return;
  address.value = start.address || '';
  if (start.error) said.textContent = words[start.error];
  here.hidden = !start.here;
  if (start.running) return setting(words.setting);
  form.hidden = false;
  address.focus();
});
