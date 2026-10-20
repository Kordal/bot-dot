// ---------- chief of staff ----------

const CHIEF_SUGGESTIONS = [
  'What bots do I have, and what is each one good at?',
  'Create a bot that checks the news on a topic every morning and sends me the highlights.',
  'Make a bot that uses the computer to work on websites for me.',
  'Make a research bot that finds fresh game design ideas on the web.',
];

// A shared composer: textarea that grows, Enter sends, Shift+Enter adds a line.
function composerHTML(placeholder, ctx = '') {
  return `
    <form class="composer" autocomplete="off">
      <div class="composer-wrap">
        <div class="away-line${away.on ? '' : ' hidden'}" role="status">Can't reach botdot. Trying again…</div>
        <div class="claude-line${signedOut.on && !away.on ? '' : ' hidden'}" role="status">${signedOutHTML()}</div>
        ${ctx ? `<div class="ctx">${ctx}</div>` : ''}
        <div class="send-note hidden" role="status"></div>
        <div class="attach-list hidden"></div>
        <div class="composer-box">
          <button class="attach-btn" type="button" aria-label="Attach files" title="Attach files (or drop them here)">${ICON.clip}</button>
          <input type="file" name="files" multiple hidden>
          <textarea name="text" rows="1" placeholder="${esc(placeholder)}"></textarea>
          <button class="send-btn" type="submit" aria-label="Send">${ICON.send}</button>
        </div>
      </div>
    </form>`;
}

// Files attached in a composer: uploaded right away into the bot's (or the Chief's) workspace, and
// sent with the message. uploadTo() says where: 'bot:<id>' or 'chief'.
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const fileIcon = (name) => ({ xlsx: '📊', xls: '📊', xlsm: '📊', csv: '📊', ods: '📊', tsv: '📊', pdf: '📕', docx: '📝', doc: '📝', odt: '📝', md: '📝', txt: '📝', pptx: '📽', odp: '📽', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', json: '🧾' }[String(name).split('.').pop().toLowerCase()] || '📄');
const fileChipHTML = (f, removable) => `<span class="file-chip ${f.status || ''}" title="${esc(f.name)}${f.size ? ` · ${fmtSize(f.size)}` : ''}">${fileIcon(f.name)} <span class="fname">${esc(f.name)}</span>${f.status === 'uploading' ? ' <i>uploading…</i>' : f.status === 'failed' ? ' <i>failed</i>' : ''}${removable ? `<button type="button" data-unattach="${esc(f.key)}" aria-label="Remove">×</button>` : ''}</span>`;
const filesHTML = (list) => (list?.length ? `<div class="bubble-files">${list.map((f) => fileChipHTML(f, false)).join('')}</div>` : '');
// Files a bot attached to its reply: tap to open (a PDF) or download.
const fileHref = (f) => `/api/files/${String(f.file).split('/').map(encodeURIComponent).join('/')}`;
const isImage = (f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name);
// Pictures show as themselves (a QR code to scan can't wait for a download); tap for full size.
const botFilesHTML = (list) => (list?.length ? `<div class="bubble-files">${list.map((f) => isImage(f) ? `<a class="file-image" href="${esc(fileHref(f))}" target="_blank" rel="noopener" title="${esc(f.name)}"><img src="${esc(fileHref(f))}" alt="${esc(f.name)}" loading="lazy"></a>` : `<a class="file-chip link" href="${esc(fileHref(f))}" ${/\.pdf$/i.test(f.name) ? 'target="_blank" rel="noopener"' : `download="${esc(f.name)}"`} title="${esc(f.name)}${f.size ? ` · ${fmtSize(f.size)}` : ''}">${fileIcon(f.name)} <span class="fname">${esc(f.name)}</span></a>`).join('')}</div>` : '');

// Files botdot already has (those of a message taken back), as the list of a message box holds them: ready to send.
const readyFiles = (list) => (Array.isArray(list) ? list : []).filter((f) => f && typeof f.file === 'string')
  .map(({ name, file, size, readable }) => ({ key: Math.random().toString(36).slice(2), name: String(name ?? file), file, size, readable, status: 'ready' }));

function wireAttachments(form, uploadTo) {
  const list = $('.attach-list', form);
  const input = form.files;
  form._files = [];
  const draw = () => {
    list.classList.toggle('hidden', !form._files.length);
    list.innerHTML = form._files.map((f) => fileChipHTML(f, true)).join('');
    $$('[data-unattach]', list).forEach((b) => (b.onclick = () => { form._files = form._files.filter((f) => f.key !== b.dataset.unattach); draw(); }));
  };
  const add = (files) => {
    for (const file of files) {
      if (form._files.length >= 10) { toast('Attach at most 10 files at a time.', true); break; }
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is over 25 MB.`, true); continue; }
      const f = { key: Math.random().toString(36).slice(2), name: file.name, size: file.size, status: 'uploading' };
      form._files.push(f);
      fetch(`/api/uploads?to=${encodeURIComponent(uploadTo())}`, {
        method: 'POST',
        headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
        body: file,
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Upload failed (${r.status})`);
        Object.assign(f, d, { name: file.name, status: 'ready' });
      }).catch((e) => { f.status = 'failed'; toast(`${file.name}: ${e.message}`, true); }).finally(draw);
    }
    draw();
  };
  $('.attach-btn', form).onclick = () => input.click();
  input.onchange = () => { add([...input.files]); input.value = ''; };
  form.text.addEventListener('paste', (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); add([...e.clipboardData.files]); } });
  // Drop files anywhere on the chat.
  const zone = form.closest('.view') || form;
  zone.ondragover = (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); zone.classList.add('dropping'); } };
  zone.ondragleave = (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dropping'); };
  zone.ondrop = (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); zone.classList.remove('dropping'); add([...e.dataTransfer.files]); };
  return {
    busy: () => form._files.some((f) => f.status === 'uploading'),
    // What take() is about to send, and those files back in the list, in front of any attached since: for a send that failed.
    held: () => form._files.filter((f) => f.status === 'ready'),
    put: (held) => { form._files = [...held, ...form._files]; draw(); },
    take: () => { const ready = form._files.filter((f) => f.status === 'ready').map(({ name, file, size, readable }) => ({ name, file, size, readable })); form._files = []; draw(); return ready; },
    count: () => form._files.filter((f) => f.status === 'ready').length,
  };
}

// "@" suggestions above the message box (mentions.js): bots, then jobs, then skills, a few rows, no headings.
// ↑/↓ move, Enter or Tab picks, Esc closes; a tap or click picks too. chat is the Chief's id or a bot id.
function wireMentions(form, chat, grow) {
  const ta = form.text;
  const list = document.createElement('div');
  list.className = 'mention-list hidden';
  list.setAttribute('role', 'listbox');
  $('.composer-wrap', form).append(list);
  let rows = [], sel = 0, picked = -1; // picked: where a bot mention just put in (and its new space) ends
  const label = (r) => {
    const bot = r.bot && mentionCtx(chat).bots.find((b) => b.id === r.bot);
    if (r.kind === 'bot') return botLabel(bot);
    if (r.kind === 'job') return `${botLabel(bot)} · ${esc(bot.jobs.find((j) => j.id === r.job)?.name || '')}`;
    return esc(r.label);
  };
  const draw = () => {
    list.classList.toggle('hidden', !rows.length);
    list.innerHTML = rows.map((r, i) => `<button type="button" role="option" aria-selected="${i === sel}" data-i="${i}">${label(r)}</button>`).join('');
  };
  const close = () => { if (rows.length) { rows = []; draw(); } };
  const update = () => {
    rows = ta.selectionStart === ta.selectionEnd ? Mentions.suggest(ta.value.slice(0, ta.selectionStart), mentionCtx(chat)) : [];
    sel = 0;
    draw();
  };
  const pick = (r) => {
    const done = Mentions.pick(ta.value, ta.selectionStart, r);
    if (!done) return close();
    ta.value = done.text;
    ta.setSelectionRange(done.cursor, done.cursor);
    picked = done.jobsNext ? done.cursor : -1;
    close();
    grow();
  };
  list.onmousedown = (e) => e.preventDefault(); // keep the cursor (and a phone's keyboard) in the box
  list.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { pick(rows[+b.dataset.i]); ta.focus(); } };
  ta.addEventListener('input', () => { picked = -1; update(); });
  ta.addEventListener('click', update);
  ta.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) update(); });
  ta.addEventListener('blur', close);
  return {
    close,
    // A key the list handles, or false.
    key(e) {
      // "/" right after a picked bot: its jobs (the space the pick added goes).
      if (e.key === '/' && picked >= 0 && ta.selectionStart === picked && ta.selectionEnd === picked) {
        e.preventDefault();
        ta.setRangeText('/', picked - 1, picked, 'end');
        picked = -1;
        update();
        return true;
      }
      if (!rows.length || e.isComposing) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { sel = (sel + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length; draw(); }
      else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') pick(rows[sel]);
      else if (e.key === 'Escape') { close(); e.stopPropagation(); }
      else return false;
      e.preventDefault();
      return true;
    },
  };
}

// The line above the message box after a send that failed: why, and that nothing is lost. A request that
// got no answer, a refusal with the server's sentence, and an answer nobody can read the outcome from.
function sendNoteText(err) {
  const kept = 'Your message is still here.';
  if (err?.unsure) return `It may have been sent: check the chat. ${kept}`;
  if (err?.unreached || !err?.message) return `Not sent: can't reach botdot. ${kept}`;
  const said = String(err.message).trim();
  return `Not sent: ${said}${/[.!?…]$/.test(said) ? '' : '.'} ${kept}`;
}
// The line above the message box: one sentence of the page's, or none.
function showBoxNote(form, text) {
  const note = form?.querySelector('.send-note');
  if (!note) return;
  note.textContent = text || '';
  note.classList.toggle('hidden', !text);
}
// err: why the send failed; nothing takes the line away.
function showSendNote(form, err) {
  showBoxNote(form, err ? sendNoteText(err) : '');
}
// The chats with a send under way, by their form: one message goes at a time, from the message box or from
// outside it. A second Send or tap meanwhile sends nothing, and loses nothing.
const sendingIn = new WeakSet();
// A send from outside the message box (a quick answer, a question card, a starter): whether it went. When
// it did not, the line above the box of that chat says why, and what was tapped stays.
async function sendFrom(form, send) {
  if (sendingIn.has(form)) return false;
  sendingIn.add(form);
  showSendNote(form, null);
  try { await send(); return true; } catch (e) { showSendNote(form, e); return false; } finally { sendingIn.delete(form); }
}
// One key for every send of what a button sends, for as long as the button is drawn (a starter, the plan's Approve).
const withKey = (send) => { const key = messageKey(); return () => send(key); };
// A failed message back in the box, in front of what was typed since.
const withFailed = (failed, typedSince) => (failed && typedSince.trim() ? `${failed}\n${typedSince}` : failed || typedSince);

// A message whose send failed after its chat was left (a bot's message box is built again for each bot): kept
// by chat, 'chief' or 'bot:<id>', and put into that chat's box when it is built again.
const failedSends = new Map(); // chat → { text, held, err, sent }

// onSend(text, attachments, key) sends: a promise that rejects when the message did not go. The box empties at
// once, so the next message can be typed, and gets the text and the files back when the send failed. The
// message keeps its key (messageKey) until it went or is changed: sent again as it is, botdot takes it once.
function wireComposer(form, onSend, uploadTo, chat) {
  const ta = form.text;
  const btn = form.querySelector('.send-btn');
  const files = uploadTo ? wireAttachments(form, uploadTo) : null;
  if (!uploadTo) $('.attach-btn', form)?.remove();
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; };
  const mentions = chat ? wireMentions(form, chat, grow) : null;
  // The message that failed last, as it was sent: { text, files, key }. Sent again with this text and these files,
  // it is that message; an edit, or other files, makes a new one.
  let failed = null;
  const same = (a, b) => a.length === b.length && a.every((f, i) => f === b[i]);
  ta.oninput = () => { grow(); showSendNote(form, null); failed = null; }; // edited: the line goes, and its key
  const giveBack = ({ text, held, err, sent }) => {
    ta.value = withFailed(text, ta.value);
    grow();
    files?.put(held);
    showSendNote(form, err);
    failed = sent || null;
  };
  const key = uploadTo?.();
  if (failedSends.has(key)) { giveBack(failedSends.get(key)); failedSends.delete(key); }
  // A waiting message the owner took back (takeBack): its text in front of what was typed since, its files
  // ready to send. It is a new message: it has no key yet.
  form._takeBack = (text, attachments) => giveBack({ text, held: readyFiles(attachments), err: null, sent: null });
  ta.onkeydown = (e) => {
    if (mentions?.key(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (btn.classList.contains('stop') || sendingIn.has(form)) return; // one message at a time: a second Send waits for the first
    const text = ta.value.trim();
    if (files?.busy()) return toast('Wait a moment: the files are still uploading.');
    if (!text && !files?.count()) return;
    if (looksLikeSecret(text) && !confirm('This looks like it contains a password.\n\nMessages are sent to the AI and saved on disk. Let the bot ask for it instead: it opens a secure box that goes straight into your Vault.\n\nSend anyway?')) return;
    const held = files ? files.held() : [];
    const sent = failed && failed.text === text && same(failed.files, held) ? failed : { text, files: held, key: messageKey() };
    failed = null;
    ta.value = '';
    grow();
    mentions?.close();
    showSendNote(form, null);
    sendingIn.add(form);
    btn.disabled = true;
    try {
      await onSend(text, files ? files.take() : [], sent.key);
    } catch (err) {
      if (form.isConnected === false) {
        // This box is gone: the owner opened another bot meanwhile. Said now, and back in the box with that chat.
        // Two messages that wait there together are one new message.
        const waiting = failedSends.get(key);
        failedSends.set(key, { text: withFailed(text, waiting?.text || ''), held: [...held, ...(waiting?.held || [])], err, sent: waiting ? null : sent });
        toast(sendNoteText(err), true);
      } else giveBack({ text, held, err, sent });
    } finally {
      sendingIn.delete(form);
      btn.disabled = false;
    }
  };
}

// Quote (#97, quote.js): text selected in one message of a chat (the Chief's, a bot's, a group's) shows a Quote button
// by it; a tap adds the text to that chat's message box as a Markdown quote, after what was typed, the cursor after it.
// Nothing for a selection in the message box, over two messages, or of spaces only. Above the selection with a mouse
// (the browser's own buttons sit at its end); below it on a touch screen, where the phone's menu is above.
function initQuote() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'quote-btn hidden';
  btn.textContent = 'Quote';
  document.body.append(btn);
  // picked: { form, text, range } of the selection shown; held: that one as the button was pressed (a tap may clear
  // the selection before its click); down: a pointer still selecting.
  let picked = null, held = null, down = false;
  const elementOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement);
  const pick = () => {
    const sel = getSelection();
    if (down || !sel || sel.isCollapsed || !sel.rangeCount) return null;
    const bubble = elementOf(sel.anchorNode)?.closest('.bubble');
    if (!bubble || bubble !== elementOf(sel.focusNode)?.closest('.bubble') || !bubble.closest('.chat-thread')) return null;
    const form = $('form.composer', bubble.closest('.view') || document);
    if (!form) return null;
    const range = sel.getRangeAt(0);
    const text = Quote.read(range.cloneContents(), getComputedStyle(bubble).whiteSpace.startsWith('pre'));
    return Quote.block(text) ? { form, text, range } : null;
  };
  const place = () => {
    picked = pick();
    btn.classList.toggle('hidden', !picked);
    if (!picked) return;
    const r = picked.range.getBoundingClientRect(), w = btn.offsetWidth, h = btn.offsetHeight;
    const above = r.top - h - 8, below = r.bottom + 8;
    let top = matchMedia('(pointer: coarse)').matches ? below : above;
    if (top < 8) top = below;
    if (top + h > innerHeight - 8) top = Math.max(8, above);
    btn.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    btn.style.top = `${top}px`;
  };
  const later = () => requestAnimationFrame(place);
  document.addEventListener('selectionchange', later);
  document.addEventListener('pointerdown', (e) => { if (e.target !== btn) { down = true; later(); } });
  document.addEventListener('pointerup', (e) => { down = false; if (e.target !== btn) later(); });
  document.addEventListener('pointercancel', () => { down = false; later(); });
  document.addEventListener('scroll', () => { if (picked) place(); }, true);
  btn.onpointerdown = (e) => { e.preventDefault(); held = picked; };
  btn.onmousedown = (e) => e.preventDefault(); // the selection stays until the click
  btn.onclick = () => {
    const was = held || picked;
    picked = held = null;
    btn.classList.add('hidden');
    getSelection().removeAllRanges();
    const ta = was?.form.text;
    const done = ta && Quote.add(ta.value, was.text);
    if (!done) return;
    ta.value = done.text;
    ta.dispatchEvent(new Event('input')); // the box grows, and it is an edit: a failed message's line goes
    ta.focus();
    ta.setSelectionRange(done.cursor, done.cursor);
    ta.scrollTop = ta.scrollHeight;
  };
}

// Send stays (docs/api.md, "A message that waits"): a message to a working bot or a replying Chief waits its
// turn on the botdot server, and Stop is the word at the end of the working line (placeStatusLines).
const sendStays = () => state.features.includes('message-waits');
// The box of a server from before that: the Chief's shows Stop while it replies, and sends nothing meanwhile.
function setSendBusy(form, busy, onStop) {
  const btn = form?.querySelector('.send-btn');
  if (!btn) return;
  busy = !!busy && !sendStays();
  btn.classList.toggle('stop', busy);
  btn.innerHTML = busy ? ICON.stop : ICON.send;
  btn.type = busy ? 'button' : 'submit';
  btn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  btn.onclick = busy ? onStop : null;
}

function renderChief() {
  const root = $('#view-chief');
  if (!root.querySelector('#chat-thread')) {
    root.innerHTML = `
      <div class="chat-head">
        ${BACK_BTN}
        <button class="chat-title" id="chief-settings" title="Its settings">
          <div id="chief-avatar">${chiefFigure('sm')}</div>
          <div class="grow"><h2>${esc(chiefName())}</h2><div class="sub" id="chief-sub"></div></div>
        </button>
        <div class="actions-right">
          <button class="icon-btn" id="chief-new" title="New chat">${ICON.compose}</button>
        </div>
      </div>
      <div class="chat-thread" id="chat-thread"></div>
      ${composerHTML('Message the Chief…')}`;
    wireComposer($('form', root), sendToChief, () => 'chief', CHIEF_BOT.id);
    $('#chief-new').onclick = () => { state.chatNew = true; showChat(null); };
    $('#chief-settings').onclick = () => setPanel('toggle');
    // Messenger feel: open the latest conversation unless a new one was asked for.
    if (!state.chatId && !state.chatNew && state.chats.length) state.chatId = state.chats[0].id;
    showChat(state.chatId);
  }
  if (state.chatId) updateChatNeeds($('#chat-thread'), 'chief');
  // Mentions in your messages follow renamed bots, jobs and skills (the bot thread does the same).
  const drawn = $('#chat-thread').dataset.mentions;
  if (state.chatId && drawn && drawn !== mentionSig()) showChat(state.chatId);
  const working = state.bots.filter((b) => b.running).length;
  $('#chief-sub').textContent = `${state.bots.length} bots${working ? ` · ${working} working` : ''}`;
  renderChatList();
}

// The Chief's previous chats, in its settings. Picking one shows it: a panel that covers the chat makes way.
function renderChatList() {
  const el = $('#chief-chats');
  if (!el) return;
  el.innerHTML = state.chats.length
    ? state.chats.map((c) => `
      <button type="button" class="settings-link ${c.id === state.chatId ? 'active' : ''}" data-chat="${esc(c.id)}">
        <span class="grow">${esc(c.title)}</span><span class="faint">${esc(shortTime(c.updatedAt))}</span>
      </button>`).join('')
    : '<div class="faint" style="padding:11px 0;font-size:12.5px">No previous chats</div>';
  $$('[data-chat]', el).forEach((b) => (b.onclick = () => { setView('chief'); showChat(b.dataset.chat); renderChatList(); }));
}

function actionBot(a) {
  const botId = a.botId || state.runs.find((r) => r.id === a.runId)?.botId;
  return state.bots.find((b) => b.id === botId);
}

function actionChip(a) {
  // from: a late result, a short turn of the Chief for what a bot found: "↩ From Web Surfer" opens that bot's chat.
  const icon = { created: '✨', updated: '✏️', run: '→', deleted: '🗑', stopped: '■', skill: '✦', job: '⏰', from: '↩' }[a.kind] || '';
  const screen = a.kind === 'run' && actionBot(a)?.computer === 'linux';
  // waits: what still waits for the owner's OK, in the server's words ("web access waits for your OK").
  const waits = typeof a.waits === 'string' && a.waits.trim() ? ` · <span class="waits">${esc(a.waits.trim())}</span>` : '';
  return `<button class="action-chip" data-kind="${esc(a.kind)}" ${a.botId ? `data-bot="${esc(a.botId)}"` : ''} ${a.runId ? `data-run-id="${esc(a.runId)}"` : ''}>${icon} ${esc(a.text)}${waits}${screen ? ' · View live screen' : ''}</button>`;
}

// What the Chief is doing in a reply it is still writing, in words: its activity as the server says it
// (`{ tool, text }`, in the chat's pending reply and on its stream), '' when it said none. The words are the
// server's, the same as a bot's line for the same step (docs/api.md, "The working line"): the page has none of
// its own for a tool. A server from before it had words for every tool names the tool alone: "Working".
const chiefActivity = (a) => (a ? OpeningLine.text(a.text) || OpeningLine.NO_WORDS : '');
// The Chief's replies that are going on, by chat: what it is doing, '' until it says ("Thinking" on the line).
// The working line of the Chief's chat is drawn from it (placeStatusLines): a replying Chief is that line, with Stop.
const chiefTurns = new Map();
// The owner's messages that wait for the Chief, by chat, as the server lists them (a chat's `queued`).
const chiefQueued = new Map();

// index: the message's place in the whole chat (the server's), where it has one: an unasked message gets 👍 and 👎.
// A reply that failed or was stopped has `error`: alone it is the problem bubble, after text it is a block
// of its own under the text: the server's sentence, which names the runs that were stopped with it. A reply with
// neither has no bubble: the page writes no words of its own. A reply that is still being written (`pending`) has
// none either, only its chips so far: the working line under the chat says what the Chief is doing.
// A reply about a bot's result carries that run's `files` (docs/api.md, A late result): they are drawn in the
// bubble as under a bot's own message, under the text and above the problem, and alone when the reply has no words.
function chiefBubble(m, last = false, index = null) {
  const files = !m.pending && Array.isArray(m.files) && m.files.length ? botFilesHTML(m.files) : '';
  const body = m.pending
    ? ''
    : m.error && !m.text
      ? `<div class="md">${md(m.error)}</div>${files}`
      : m.text
        ? `<div class="md">${md(m.text)}</div>${files}${m.error ? `<div class="problem-line"><div class="md">${md(m.error)}</div></div>` : ''}`
        : files;
  return `
    <div class="bubble-row from-bot"${m.pending ? ' data-pending' : ''}>
      <div class="stack">
        ${body ? `<div class="bubble from-bot ${m.error && !m.text ? 'problem' : ''}">${body}</div>` : ''}
        <div class="actions">${(m.actions || []).map(actionChip).join('')}</div>
        ${!m.pending && (m.text || m.error) ? `<div class="bubble-meta">${esc(msgTime(m.endedAt || m.at))}${copyBtn(m.text || m.error)}${Ratings.shows(m, state.features, index) ? Ratings.html(m.rating, index, CHIEF_COLOR) : ''}</div>` : ''}
        ${last && !m.pending ? choicesHTML(m.choices) + questionsHTML(m.questions) : ''}
      </div>
    </div>`;
}

// What Approve sends to answer a bot's plan for the Chief (the server knows it).
const PLAN_APPROVAL = 'Approved. Go ahead.';
// A bot's suggestion for the Chief: nothing happens until you answer it.
const suggestionBubble = (m) => `
  <div class="bubble-row from-me"><div class="stack from-bot-msg">
    <div class="bot-msg-label">Suggestion from ${m.from ? botLabel(m.from) : 'a bot'}</div>
    <div class="bubble from-other-bot suggestion-msg" data-expand><div class="md clamp">${md(m.text)}</div></div>
    <div class="bubble-meta">${copyBtn(m.text)}</div>
    ${m.status === 'pending' ? `<div class="suggestion-actions"><button class="btn" data-sug-dismiss>Decline</button><button class="btn primary" data-sug-build>Approve</button></div>` : m.status === 'dismissed' ? '<div class="bot-msg-label">You declined it</div>' : ''}
  </div></div>`;

// A bot the Chief handed a task, with its final reply once the teammates it asked had answered.
const reportBubble = (m) => `
  <div class="bubble-row from-me"><div class="stack from-bot-msg">
    <div class="bot-msg-label">Message from ${m.from ? botLabel(m.from) : 'a bot'}</div>
    ${m.text ? `<div class="bubble from-other-bot report-msg"><div class="md">${md(m.text)}</div>${botFilesHTML(m.files)}</div>
    <div class="bubble-meta">${copyBtn(m.text)}</div>` : `<div class="bubble from-other-bot report-msg">${botFilesHTML(m.files)}</div>`}
  </div></div>`;

// at: the message's place in the whole chat (the chat may have come in part, from `offset` on).
const messageHTML = (m, i, all, at = i) => (m.role === 'user' ? userBubble(m) : m.role === 'suggestion' ? suggestionBubble(m) : m.role === 'report' ? reportBubble(m) : steeredBubbles(m.steered) + chiefBubble(m, i === all.length - 1, at));
// What the owner steered into a reply while the Chief worked (ADR 040): their messages, before that reply, without buttons.
const steeredBubbles = (list) => (Array.isArray(list) ? list : []).map((x) => `<div class="bubble-row from-me" data-steered><div class="stack mine"><div class="bubble from-me">${escMentions(String(x.text || ''), CHIEF_BOT.id)}${filesHTML(Array.isArray(x.attachments) ? x.attachments : [])}</div><div class="bubble-meta"><span>Steered · ${esc(msgTime(x.at))}</span>${copyBtn(String(x.text || ''))}</div></div></div>`).join('');

const userBubble = (m) => `<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me">${escMentions(m.text, CHIEF_BOT.id)}${filesHTML(m.attachments)}</div>${m.text ? `<div class="bubble-meta">${copyBtn(m.text)}</div>` : ''}</div></div>`;

function wireActions(root) {
  $$('.action-chip', root).forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.kind === 'skill') return setView('skills');
      const a = { botId: b.dataset.bot, runId: b.dataset.runId };
      let bot = actionBot(a);
      try {
        // Older chats only stored a run ID, which may be outside the recent-run list.
        if (!bot && a.runId) {
          const run = await api(`/runs/${encodeURIComponent(a.runId)}`);
          bot = state.bots.find((x) => x.id === run.botId);
        }
        if (bot) {
          setView('bot', bot.id);
          if (b.dataset.kind === 'run' && bot.computer === 'linux') openScreen(bot.id);
        } else if (a.runId) openRun(a.runId);
      } catch (e) { toast(e.message, true); }
    };
  });
}

// Open the Chief on this chat (null: a new one), whether or not its page is built yet.
function openChiefChat(id) {
  const built = !!$('#chat-thread');
  state.chatId = id;
  state.chatNew = !id;
  setView('chief');
  if (built) showChat(id);
}

async function showChat(id) {
  if (state.chatStream) { state.chatStream.close(); state.chatStream = null; }
  state.chatReload = false; // this is the chat read again
  state.chatId = id;
  if (id) state.chatNew = false;
  if (state.view === 'chief') writeHash();
  sayPresent();
  syncRead();
  const thread = $('#chat-thread');
  const form = $('#view-chief form');
  if (!thread) return;
  if (!id) {
    delete thread.dataset.mentions;
    delete thread.dataset.chat;
    thread.innerHTML = `
      <div class="chief-empty">
        ${chiefFigure('lg')}
        <h3>What should the team work on?</h3>
        <p class="muted">Ask for anything. I'll hand it to the right bot, or build a new one.</p>
        <div class="suggestions">${CHIEF_SUGGESTIONS.map((t) => `<button class="suggestion">${esc(t)}</button>`).join('')}</div>
      </div>`;
    $$('.suggestion', thread).forEach((b) => (b.onclick = withKey((key) => sendFrom(form, () => sendToChief(b.textContent, [], key)))));
    setSendBusy(form, false);
    placeStatusLines(); // a line of the chat that was here goes
    if (!matchMedia('(pointer: coarse)').matches) form.text.focus();
    return;
  }
  let chat;
  try { chat = await api(`/chief/chats/${id}`); } catch (e) { toast(e.message, true); return; }
  if (state.chatId !== id) return;
  thread.innerHTML = chat.messages.map((m, i, all) => messageHTML(m, i, all, (chat.offset || 0) + i).replace('class="bubble-row', `data-msg="${i}" class="bubble-row`)).join('');
  thread.dataset.mentions = mentionSig(); // what its mentions were matched against (see renderChief)
  thread.dataset.chat = id; // whose messages these are (see placeChiefLine)
  thread._mine = chat.messages.filter((m) => m.role === 'user'); // what the owner wrote in it, as botdot has it (see ownWords)
  thread._from = chat.offset || 0; // the place of its first row in the whole chat (see chiefArrives)
  wireActions(thread);
  wireChoices(thread, (t, key) => sendFrom(form, () => sendToChief(t, [], key)));
  $$('[data-expand]', thread).forEach((el) => (el.onclick = (e) => { if (!e.target.closest('a') && getSelection().isCollapsed) el.firstElementChild.classList.toggle('clamp'); })); // a click that ends a selection (to quote it) folds nothing
  const build = $('[data-sug-build]', thread);
  if (build) build.onclick = withKey(async (key) => { if (await sendFrom(form, () => sendToChief(PLAN_APPROVAL, [], key))) build.closest('.suggestion-actions')?.remove(); });
  const dismiss = $('[data-sug-dismiss]', thread);
  if (dismiss) dismiss.onclick = () => api(`/chief/chats/${id}/dismiss`, { method: 'POST' }).then(() => showChat(id)).catch((e) => toast(e.message, true));
  if (chat.busy) openingLines.say(`chief:${id}`, chat.openingLine); else openingLines.end(`chief:${id}`);
  // Its reply that is going on, and what waits for it: both as the server has them now.
  if (chat.busy) chiefTurns.set(id, chiefActivity(chat.messages.filter((m) => m.pending).pop()?.activity)); else chiefTurns.delete(id);
  chiefQueued.set(id, queuedList(chat.queued));
  placeStatusLines();
  updateChatNeeds(thread, 'chief');
  thread.scrollTop = thread.scrollHeight;
  placeChiefLine(); // the "New" line, when this chat was opened with new replies
  markSearch(); // what you searched for, marked in the chat
  if (state.jump?.chatId === id) jumpTo($(`[data-msg="${state.jump.index}"]`, thread)); // from a search match
  setSendBusy(form, chat.busy, stopChief);
  if (chat.busy) followChief(id);
}

// Stop the Chief's reply in a chat: the open one, from the box of a server that has no Send while it replies.
const stopChief = (id = state.chatId) => api(`/chief/chats/${encodeURIComponent(typeof id === 'string' ? id : state.chatId)}/stop`, { method: 'POST' }).catch(() => {});

// Rejects when the message did not go, with nothing added to the chat: the caller keeps what was typed or
// tapped and says why (wireComposer, sendFrom). key: the message's (messageKey), the same when it is sent again.
// From Send until botdot answers the message stands in the chat as the page's own bubble (sentAtOnce), with
// "Working" under it; the answer puts botdot's version in its place, and a send that failed takes it away.
async function sendToChief(text, attachments = [], key = messageKey()) {
  let id = state.chatId;
  const fresh = !id;
  let at = `chief:${id || ''}`; // the chat the bubble stands in: the new one has no id until it is made
  sentAtOnce(at, { key, text, attachments });
  showSent($('#chat-thread'));
  let took;
  try {
    if (fresh) {
      // No message was sent yet: whatever failed here, it was not sent.
      const chat = await api('/chief/chats', { method: 'POST' }).catch((e) => { throw Object.assign(e, { unsure: false }); });
      id = chat.id;
      state.chatId = id; // kept when the message then fails: sending again uses this chat
      state.chatNew = false;
      sentMoved(at, at = `chief:${id}`);
    }
    took = await api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text, attachments, key } });
  } catch (e) {
    sentOver(at, key, false); // it did not go: nothing of it stays in the chat
    placeStatusLines();
    throw e;
  }
  // The message went. Nothing from here on may reject: the caller would put a sent message back into the box.
  try {
    // botdot had it already, from a send whose answer was lost: the chat as botdot has it, with the message once.
    if (took?.again) { await showChat(id); loadChief().then(markMore); return; }
    // The Chief is replying: the message waits its turn on the botdot server (the chat's `queued`). It is drawn
    // from that list, faded, and the page adds no bubble of its own. The reply that is going on is followed
    // already; a second stream is opened only when this page follows none.
    const queued = queuedList(took?.queued);
    if (queued.length) {
      if (state.chatId !== id) return;
      if (!state.chatStream || $('#chat-thread').dataset.chat !== id) { await showChat(id); return; }
      chiefQueued.set(id, queued);
      placeStatusLines();
      const t = $('#chat-thread');
      t.scrollTop = t.scrollHeight;
      return;
    }
    const thread = $('#chat-thread');
    // The page still follows a reply here, and botdot took this message at once: that reply ended a moment ago,
    // and its end has not reached the page. The chat as botdot has it shows both, and follows the new reply.
    if (state.chatStream && thread.dataset.chat === id) { await showChat(id); loadChief().then(markMore); return; }
    if (fresh || !thread.dataset.chat) {
      thread.innerHTML = ''; // the empty chat's greeting is gone, now that the message went
      thread.dataset.chat = id;
      thread._mine = [];
      thread._from = 0;
      syncRead(); // the new chat is on screen: its reply is read as it arrives
    }
    $$('.choices, .ask-card', thread).forEach((c) => c.remove()); // answered
    sentOver(at, key); // the message as botdot took it stands where the page's own stood
    thread.insertAdjacentHTML('beforeend', userBubble({ text: text || 'Have a look at the attached files.', attachments }) + chiefBubble({ pending: true }));
    (thread._mine ||= []).push({ text, attachments });
    updateChatNeeds(thread, 'chief'); // the cards stay last
    chiefTurns.set(id, ''); // its reply began: the working line says so, with Stop
    placeStatusLines();
    thread.scrollTop = thread.scrollHeight;
    setSendBusy($('#view-chief form'), true, stopChief);
    writeHash(); // state.chatId is this chat
    followChief(id);
    loadChief().then(markMore);
  } catch (e) { console.error(e); } finally {
    // Whichever way the chat was drawn from the answer: the page's own bubble is over.
    sentOver(at, key);
    placeStatusLines();
  }
}

// The Chief's reply in a chat as it happens: what it is doing goes to the working line, a chip under the reply's
// row, and the reply in that row's place when it is done. One stream at a time: the one before is closed.
function followChief(id) {
  const thread = $('#chat-thread');
  const rows = $$('[data-pending]', thread);
  const row = rows[rows.length - 1]; // the reply being written; none when this page did not draw it
  if (state.chatStream) state.chatStream.close();
  const es = new EventSource(`/api/chief/chats/${id}/stream`);
  state.chatStream = es;
  es.onmessage = (msg) => {
    if (state.chatId !== id) return es.close();
    const ev = JSON.parse(msg.data);
    if (ev.type === 'activity') {
      if (chiefTurns.get(id) !== chiefActivity(ev)) { chiefTurns.set(id, chiefActivity(ev)); placeStatusLines(); }
    } else if (ev.type === 'opening_line') {
      if (openingLines.say(`chief:${id}`, ev.text)) placeStatusLines();
    } else if (ev.type === 'action') {
      row?.querySelector('.actions')?.insertAdjacentHTML('beforeend', actionChip(ev.action));
      wireActions(row);
      refresh();
    } else if (ev.type === 'steered') {
      // The reply read a steered message: the owner's messages it read stand before it, in place of what was there.
      if (row?.isConnected) {
        while (row.previousElementSibling?.matches('[data-steered]')) row.previousElementSibling.remove();
        row.insertAdjacentHTML('beforebegin', steeredBubbles(ev.steered));
      } else state.chatReload = true;
    } else if (ev.type === 'file') {
      row?.insertAdjacentHTML('beforebegin', reportBubble(ev.message)); // a bot's file, while the Chief still waits for it
      placeStatusLines(); // it arrives (chiefArrives)
    } else if (ev.type === 'done') {
      es.close();
      if (state.chatStream === es) state.chatStream = null;
      openingLines.end(`chief:${id}`);
      chiefTurns.delete(id);
      placeStatusLines(); // the reply is here, or it couldn't finish: the line goes
      // A bot's reply that came in meanwhile, or the next turn that began (see followFeed): show the whole chat again.
      if (state.chatReload) { state.chatReload = false; return showChat(id); }
      if (ev.message) {
        // In the place of the row this page drew for it; a reply it drew none for goes to the end.
        if (row && row.isConnected !== false) { row.outerHTML = chiefBubble(ev.message, true); placeStatusLines(); } // the reply arrives (chiefArrives)
        else { thread.insertAdjacentHTML('beforeend', chiefBubble(ev.message, true)); updateChatNeeds(thread, 'chief'); placeStatusLines(); }
        wireActions(thread);
        wireChoices(thread, (t, key) => sendFrom($('#view-chief form'), () => sendToChief(t, [], key)));
      }
      thread.scrollTop = thread.scrollHeight;
      setSendBusy($('#view-chief form'), false);
      refresh();
    }
    if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160) thread.scrollTop = thread.scrollHeight;
  };
  // EventSource reconnects after transport errors; the server replays current activity.
  es.onerror = () => { if (state.chatId !== id) es.close(); };
}
