'use strict';
// The app's one screen: a botdot address and a button. The rest happens in the browser and on the front door's page.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const WORDS = {
  en: { address: 'botdot address', go: 'Continue', invalid: "That's not a botdot address.", unreachable: "Can't reach botdot there.", failed: "The sign-in didn't finish. Try again." },
  pl: { address: 'Adres botdota', go: 'Dalej', invalid: 'To nie jest adres botdota.', unreachable: 'Nie mogę połączyć się z botdotem pod tym adresem.', failed: 'Logowanie się nie udało. Spróbuj jeszcze raz.' },
};
const words = navigator.language.toLowerCase().startsWith('pl') ? WORDS.pl : WORDS.en;

const form = document.getElementById('connect');
const address = document.getElementById('address');
const go = document.getElementById('go');
const said = document.getElementById('said');

address.placeholder = words.address;
address.setAttribute('aria-label', words.address);
go.textContent = words.go;

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

listen('sign-in-failed', () => { said.textContent = words.failed; });

invoke('start').then((start) => {
  if (start.entering) return;
  address.value = start.address || '';
  if (start.error) said.textContent = words[start.error];
  form.hidden = false;
  address.focus();
});
