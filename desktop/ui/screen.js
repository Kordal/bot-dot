'use strict';
// The app's one screen: a botdot address and a button, and on a Mac, a PC or a Linux computer a second button that runs
// botdot on it (ADR 136, ADR 170). The rest happens in the browser and on the front door's page.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const WORDS = {
  en: { address: 'botdot address', go: 'Continue', invalid: "That's not a botdot address.", unreachable: "Can't reach botdot there.", failed: "The sign-in didn't finish. Try again.", here: 'Run botdot on this Mac', small: 'This Mac needs at least 12 GB of memory and 40 GB of free disk.', setting: 'Installing botdot and what it needs…', passkey: 'Make your passkey in the browser.', stopped: "botdot didn't start on this Mac. Try again." },
  pl: { address: 'Adres botdota', go: 'Dalej', invalid: 'To nie jest adres botdota.', unreachable: 'Nie mogę połączyć się z botdotem pod tym adresem.', failed: 'Logowanie się nie udało. Spróbuj jeszcze raz.', here: 'Uruchom botdota na tym Macu', small: 'Ten Mac potrzebuje co najmniej 12 GB pamięci i 40 GB wolnego miejsca.', setting: 'Instaluję botdota i to, czego potrzebuje…', passkey: 'Utwórz klucz dostępu w przeglądarce.', stopped: 'Botdot nie uruchomił się na tym Macu. Spróbuj jeszcze raz.' },
};
// On Windows the computer is a PC, and WSL may need a restart first.
const PC = {
  en: { here: 'Run botdot on this PC', small: 'This PC needs at least 16 GB of memory and 40 GB of free disk.', stopped: "botdot didn't start on this PC. Try again.", restart: 'Restart Windows to carry on.' },
  pl: { here: 'Uruchom botdota na tym komputerze', small: 'Ten komputer potrzebuje co najmniej 16 GB pamięci i 40 GB wolnego miejsca.', stopped: 'Botdot nie uruchomił się na tym komputerze. Spróbuj jeszcze raz.', restart: 'Uruchom Windows ponownie, żeby kontynuować.' },
};
// On Linux the computer is a computer, and botdot runs on it beside the owner's own work (ADR 170).
const LINUX = {
  en: { here: 'Run botdot on this computer', small: 'This computer needs at least 12 GB of memory and 40 GB of free disk.', stopped: "botdot didn't start on this computer. Try again." },
  pl: { here: 'Uruchom botdota na tym komputerze', small: 'Ten komputer potrzebuje co najmniej 12 GB pamięci i 40 GB wolnego miejsca.', stopped: 'Botdot nie uruchomił się na tym komputerze. Spróbuj jeszcze raz.' },
};
// While the botdot on this computer is being removed.
const REMOVING = { en: 'Removing botdot…', pl: 'Usuwam botdota…' };
const language = navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
const system = navigator.userAgent.includes('Windows') ? PC : /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent) ? LINUX : null;
const words = system ? { ...WORDS[language], ...system[language] } : WORDS[language];

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

// While the setup runs, one plain line and a spinner; the installer's own lines show only when it fails.
function setting(text, busy = true) {
  form.hidden = true;
  line.textContent = text;
  line.classList.toggle('busy', busy);
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

listen('local-line', () => setting(words.setting));
// The passkey is made in the browser: the window says so and offers nothing else.
listen('local-passkey', () => setting(words.passkey, false));
listen('local-failed', ({ payload }) => {
  ended();
  said.textContent = words.stopped;
  last.textContent = payload.join('\n');
  last.hidden = !payload.length;
});
listen('local-restart', () => setting(words.restart, false));
// The iOS app's sign-in sheet was closed (#965): the address again, with nothing to say.
listen('sign-in-closed', () => {
  ended();
  address.hidden = go.hidden = false;
  said.textContent = '';
});
listen('sign-in-failed', () => {
  ended();
  address.hidden = go.hidden = false;
  said.textContent = words.failed;
});

invoke('start', { adding: new URLSearchParams(location.search).has('add') }).then((start) => {
  if (start.entering) return;
  if (start.removing) return setting(REMOVING[language]);
  address.value = start.address || '';
  if (start.error) said.textContent = words[start.error];
  here.hidden = !start.here;
  if (start.running) return setting(words.setting);
  form.hidden = false;
  address.focus();
});
