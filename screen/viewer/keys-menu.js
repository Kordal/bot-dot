// The keys a person's own keyboard can't send to the bot's computer (#1735): Ctrl+Alt+Del, Esc (the browser keeps it in
// full screen), Alt+Tab, Super and Ctrl+L, from a menu on every device. Each is a chord: the modifiers down, the key
// pressed, the modifiers up. Only with control: the buttons are not on screen while the viewer only watches, and the
// transport sends nothing then in any case.
import { KEY } from './keysyms.js';

export const CHORDS = [
  { label: 'Ctrl+Alt+Del', keys: ['Control', 'Alt', 'Delete'] },
  { label: 'Esc', keys: ['Escape'] },
  { label: 'Alt+Tab', keys: ['Alt', 'Tab'] },
  { label: 'Super', keys: ['Super'] },
  { label: 'Ctrl+L', keys: ['Control', 'L'] },
];

export function sendChord(transport, keys) {
  for (const name of keys) transport.key(...KEY[name], true);
  for (const name of [...keys].reverse()) transport.key(...KEY[name], false);
}

// The menu's list of buttons, in `menu`; `choose(chord)` is what a press does.
export function buildMenu(menu, choose) {
  menu.replaceChildren(...CHORDS.map((chord) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.dataset.key = chord.label;
    item.textContent = chord.label;
    item.addEventListener('click', () => choose(chord));
    return item;
  }));
}
