// What the viewer adds to the screen for input (#1735): touch on the picture, and two buttons at the bottom while the
// owner has control: Keyboard (the phone's) and Keys (the menu of keys a keyboard can't send). The page tells it its
// state; it is on screen only in "control".
import { setupTouch } from './touch.js';
import { setupKeyboard } from './keyboard.js';
import { buildMenu, sendChord } from './keys-menu.js';
import { guarded } from './guarded.js';

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

export function setupControls({ screen, layer, words, transport: current }) {
  const transport = guarded(current);
  setupTouch({ screen, layer, transport });
  const field = el('textarea', { id: 'typing', rows: '1', 'aria-label': words.keyboard || 'Keyboard', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'enter' });
  const keyboardButton = el('button', { type: 'button', id: 'keyboard-button', 'aria-pressed': 'false' }, words.keyboard || 'Keyboard');
  const keysButton = el('button', { type: 'button', id: 'keys-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, words.keys || 'Keys');
  const menu = el('div', { id: 'keys-menu', role: 'menu', 'aria-label': words.keys || 'Keys', hidden: '' });
  const tools = el('div', { id: 'tools' }, menu, keyboardButton, keysButton);
  document.body.append(field, tools);

  const keyboard = setupKeyboard({ field, transport, onChange: (on) => keyboardButton.setAttribute('aria-pressed', String(on)) });
  const closeMenu = () => { menu.hidden = true; keysButton.setAttribute('aria-expanded', 'false'); };
  buildMenu(menu, (chord) => { closeMenu(); sendChord(transport(), chord.keys); });

  // A press on a button must not take the focus from the typing field: the phone's keyboard stays up.
  tools.addEventListener('mousedown', (ev) => ev.preventDefault());
  keyboardButton.addEventListener('click', () => { closeMenu(); keyboard.toggle(); });
  keysButton.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    keysButton.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('pointerdown', (ev) => { if (!tools.contains(ev.target)) closeMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !menu.hidden) { closeMenu(); keysButton.focus(); } });

  return {
    // Off screen with the control: no menu left open and no keyboard left up.
    state(next) {
      if (next !== 'control') { closeMenu(); keyboard.close(); }
    },
  };
}
