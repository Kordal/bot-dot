// A chat read back up (#1120): when a newer message arrives below what is on screen, one round button stands above
// the message box, a down arrow with the small head of who wrote it, and no words. A tap goes to the end; reaching
// the end hides it. The Android app follows the same rule (data/ToLatest.kt).
// Loaded after app.js, before replies.js, whose holdChatEnd watches each chat with it.
const ToLatest = (() => {
  const NEAR = 160; // px from the end that still reads as being at the end, as the chats' own scrolling
  // Shown next: never at the end; once what is newest changed while the owner reads back up; else as it was.
  const next = (shown, was, now, atEnd) => (atEnd ? false : shown || (was != null && was !== '' && now !== was));
  const atEnd = (t) => t.scrollHeight - t.scrollTop - t.clientHeight < NEAR;
  // What is newest in a chat: its last message, by what it says (its bubble, not its time under it). Older messages
  // loaded above, a chat drawn again with the same messages, a fold opened: none of these change it.
  const newest = (t) => {
    const rows = t.querySelectorAll('.bubble-row');
    const r = rows[rows.length - 1];
    if (!r) return '';
    const s = (r.querySelector('.bubble') || r).textContent.trim();
    return `${s.length}:${s.slice(-80)}`;
  };
  // Its writer's head: the one the last bot's message shows (a group, a room), else the chat's own (the Chief, a bot).
  const headOf = (t, own) => {
    const rows = t.querySelectorAll('.bubble-row.from-bot');
    const av = rows[rows.length - 1]?.querySelector('.avatar');
    return av ? av.outerHTML : own?.() || '';
  };
  const DOWN = '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  const watched = new WeakMap(); // thread -> { btn, own, was, shown }

  function draw(t, w) {
    const now = newest(t);
    const shown = next(w.shown, w.was, now, atEnd(t));
    w.was = now;
    if (shown === w.shown) return;
    w.shown = shown;
    if (shown) w.btn.querySelector('.to-latest-head').innerHTML = headOf(t, w.own);
    w.btn.classList.toggle('hidden', !shown);
  }
  // Watch a chat's thread; `own` draws the head of the chat's one writer. Called again, it only takes the new `own`.
  function watch(t, own = null) {
    if (!t) return;
    const known = watched.get(t);
    if (known) { known.own = own; return; }
    const at = document.createElement('div');
    at.className = 'to-latest-at';
    at.innerHTML = `<button type="button" class="to-latest hidden" aria-label="${esc(tr('Latest'))}" title="${esc(tr('Latest'))}"><span class="to-latest-head"></span>${DOWN}</button>`;
    t.after(at);
    const w = { btn: at.firstElementChild, own, was: newest(t), shown: false };
    watched.set(t, w);
    w.btn.onclick = () => { t.scrollTo({ top: t.scrollHeight, behavior: 'smooth' }); w.shown = false; w.btn.classList.add('hidden'); };
    t.addEventListener('scroll', () => draw(t, w), { passive: true });
    if (typeof MutationObserver === 'function') new MutationObserver(() => draw(t, w)).observe(t, { childList: true, subtree: true, characterData: true });
  }
  return { NEAR, next, newest, headOf, watch };
})();
