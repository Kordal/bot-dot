// The phone's keyboard on the bot's screen (#1735): a field nobody sees takes the focus, so the phone raises its
// keyboard, and what is typed in it goes to the transport key by key. A phone's keyboard may compose a word before it
// settles it, so the field is read as a text that changes: what the text gained is typed, what it lost is Backspace.
import { KEY, keysymOf } from './keysyms.js';

// A text with something in it to delete: Backspace on an empty field makes no input event at all.
const SEED = '​'.repeat(4);
const SPECIAL = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function setupKeyboard({ field, transport, onChange }) {
  let before = SEED;
  let composing = false;
  const press = (name) => { transport().key(...KEY[name], true); transport().key(...KEY[name], false); };
  const type = (char) => { transport().key(keysymOf(char), undefined, true); transport().key(keysymOf(char), undefined, false); };
  const reset = () => {
    field.value = before = SEED;
    field.setSelectionRange(SEED.length, SEED.length);
  };

  field.addEventListener('input', () => {
    const now = field.value;
    let same = 0;
    while (same < before.length && same < now.length && before[same] === now[same]) same++;
    for (let i = before.length - same; i > 0; i--) press('Backspace');
    for (const char of now.slice(same)) type(char);
    before = now;
    if (!composing) reset();
  });
  field.addEventListener('compositionstart', () => { composing = true; });
  field.addEventListener('compositionend', () => { composing = false; reset(); });
  // Keys that are not characters (and any key of a keyboard that is plugged in): the key itself, not its text.
  field.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229 || !SPECIAL.has(ev.key) || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    ev.preventDefault();
    press(ev.key);
  });
  field.addEventListener('focus', () => { reset(); onChange(true); });
  field.addEventListener('blur', () => onChange(false));
  reset();
  return {
    open: () => field.focus(),
    close: () => field.blur(),
    toggle: () => (document.activeElement === field ? field.blur() : field.focus()),
  };
}
