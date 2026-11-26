// Copy and paste between the owner's computer and the bot's screen (ADR 279, #1734). The page knows no RFB: it talks
// to the transport's clipboard surface (`clipboard` event, `pasteText`, `typeText`).
//   - Text copied on the bot's screen lands in the owner's clipboard. Where the browser refuses that without a tap
//     (Safari), a chip says so and the tap does it.
//   - The owner's own paste keys (⌘+V on a Mac, Ctrl+V elsewhere) send the owner's clipboard to the bot's screen and
//     paste it there; with no text in it, the computer gets a plain Ctrl+V. Every other key goes through as it is.
//   - "Type it" types a text key by key, for fields that refuse a paste.
// Nothing crosses while the owner only watches: every entry point does nothing then. Nor does it throw while there is no
// connection (reconnecting, turned off): its transport is the guarded one (guarded.js), a transport that does nothing.
import { guarded } from './guarded.js';

// The owner's clipboard written on a tap: the browser lets this through (the chip's click is the tap).
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall back to the old way below */ }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(field);
  field.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* refused */ }
  field.remove();
  return ok;
}

// `current()` is the live transport, or null while there is none; `viewOnly()` whether the owner only watches now.
export function initClipboard({ words, viewOnly, transport: current }) {
  const transport = guarded(current);
  const chip = document.getElementById('clip-chip');
  const typeBox = document.getElementById('type-box');
  const typeOpen = document.getElementById('type-open');
  const typeForm = document.getElementById('type-form');
  const typeField = document.getElementById('type-field');
  const typeGo = document.getElementById('type-go');
  chip.textContent = words.copied || 'copied';
  typeOpen.textContent = words.typeIt || 'type';
  typeField.setAttribute('aria-label', words.typeText || 'text');
  typeField.placeholder = words.typeText || '';
  typeGo.textContent = words.typeIt || 'type';

  let live = false; // a picture is showing
  let pending = null; // text copied on the bot's screen that the browser did not let through yet

  const showChip = (text) => { pending = text; chip.hidden = false; };
  const hideChip = () => { pending = null; chip.hidden = true; };
  const closeTyping = () => { typeForm.hidden = true; typeOpen.setAttribute('aria-expanded', 'false'); };

  // Copied on the bot's screen.
  async function fromBot(text) {
    if (viewOnly() || !text) return;
    try {
      await navigator.clipboard.writeText(text);
      hideChip();
    } catch {
      showChip(text);
    }
  }
  chip.addEventListener('click', async () => {
    if (pending !== null && await writeClipboard(pending)) hideChip();
    transport().focus();
  });

  // The owner's paste keys: they are not sent as they are (the bot's screen would paste what it had); the owner's text
  // is, and then the paste. The browser's own paste event carries the text without asking for permission. Only that one
  // chord is held back: Ctrl+V on a Mac and Super+V elsewhere are ordinary keys for the computer, and noVNC sends them.
  const inField = (e) => e.target instanceof Element && e.target.closest('input, textarea');
  // What the owner holds right now (the DOM codes of Ctrl and ⌘): noVNC has these down on the computer, and the paste,
  // which lets go of them for a moment, puts them back.
  const HOLDABLE = new Set(['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight']);
  const held = new Set();
  const holding = () => [...held];
  // A held-back chord is not lost: if the browser makes no paste event, or one without text (an image in the
  // clipboard), the computer gets the Ctrl+V it would have had. `waiting` is that wait; `sentAt` dates the Ctrl+V it
  // sent, so a paste event that comes later still is not pasted a second time.
  const PASTE_WAIT_MS = 100;
  let waiting = null;
  let sentAt = -Infinity;
  const plainPaste = () => {
    clearTimeout(waiting);
    waiting = null;
    sentAt = performance.now();
    transport().pasteKeys(holding);
  };
  document.addEventListener('keydown', (e) => {
    if (viewOnly() || inField(e)) return;
    if (HOLDABLE.has(e.code)) held.add(e.code);
    if (transport().isPasteChord(e)) {
      e.stopPropagation();
      clearTimeout(waiting);
      waiting = setTimeout(plainPaste, PASTE_WAIT_MS);
    }
  }, true);
  document.addEventListener('keyup', (e) => { held.delete(e.code); }, true);
  addEventListener('blur', () => held.clear());
  document.addEventListener('paste', (e) => {
    if (viewOnly() || inField(e)) return;
    const text = e.clipboardData?.getData('text/plain');
    e.preventDefault();
    if (waiting === null && performance.now() - sentAt < PASTE_WAIT_MS * 10) return; // too late: the Ctrl+V went already
    if (text) {
      clearTimeout(waiting);
      waiting = null;
      transport().pasteText(text, holding);
    } else if (waiting !== null) plainPaste();
  });

  // Type it.
  typeOpen.addEventListener('click', () => {
    typeForm.hidden = !typeForm.hidden;
    typeOpen.setAttribute('aria-expanded', String(!typeForm.hidden));
    if (!typeForm.hidden) typeField.focus(); else transport().focus();
  });
  typeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = typeField.value;
    if (!text) return;
    const t = transport();
    typeField.value = '';
    closeTyping();
    t.focus();
    await t.typeText(text);
  });
  typeField.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeTyping(); transport().focus(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) typeForm.requestSubmit();
  });

  return {
    // The viewer has a picture and the owner may use it.
    connected(t) {
      live = true;
      t.addEventListener('clipboard', (e) => { if (t === transport()) fromBot(e.detail?.text); });
      typeBox.hidden = viewOnly();
    },
    // The owner took control, or went back to watching, on the picture already showing.
    control(on) {
      if (live) typeBox.hidden = !on;
      if (!on) { closeTyping(); hideChip(); }
    },
    // It ended: nothing is left to type into.
    gone() {
      live = false;
      typeBox.hidden = true;
      closeTyping();
      hideChip();
    },
  };
}
