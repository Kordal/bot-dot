// Copy and paste between the owner's computer and the bot's screen (ADR 279, #1734). The page knows no RFB: it talks
// to the transport's clipboard surface (`clipboard` event, `pasteText`, `typeText`).
//   - Text copied on the bot's screen lands in the owner's clipboard. Where the browser refuses that without a tap
//     (Safari), a chip says so and the tap does it.
//   - Ctrl/⌘+V on the viewer sends the owner's clipboard to the bot's screen and pastes it there.
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

// `current()` is the live transport, or null while there is none.
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

  let pending = null; // text copied on the bot's screen that the browser did not let through yet

  const showChip = (text) => { pending = text; chip.hidden = false; };
  const hideChip = () => { pending = null; chip.hidden = true; };
  const closeTyping = () => { typeForm.hidden = true; typeOpen.setAttribute('aria-expanded', 'false'); };

  // Copied on the bot's screen.
  async function fromBot(text) {
    if (viewOnly || !text) return;
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

  // Ctrl/⌘+V: the keys are not sent as they are (the bot's screen would paste what it had); the owner's text is, and
  // then the paste. The browser's own paste event carries the text without asking for permission.
  const isPasteKey = (e) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V');
  const inField = (e) => e.target instanceof Element && e.target.closest('input, textarea');
  document.addEventListener('keydown', (e) => {
    if (viewOnly || inField(e) || !isPasteKey(e)) return;
    e.stopPropagation();
  }, true);
  document.addEventListener('paste', (e) => {
    if (viewOnly || inField(e)) return;
    const text = e.clipboardData?.getData('text/plain');
    e.preventDefault();
    if (text) transport().pasteText(text);
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
      if (viewOnly) return;
      t.addEventListener('clipboard', (e) => { if (t === transport()) fromBot(e.detail?.text); });
      typeBox.hidden = false;
    },
    // It ended: nothing is left to type into.
    gone() {
      typeBox.hidden = true;
      closeTyping();
      hideChip();
    },
  };
}
