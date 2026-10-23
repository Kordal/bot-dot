// ---------- the live feed ----------

// botdot's live feed (/api/events): refresh right away when something happens, instead of waiting
// for the next periodic check (which stays, in case the feed drops).
function followFeed() {
  if (!window.EventSource) return;
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (!$('#modal').open) refresh(); }, 300); };
  const es = new EventSource('/api/events?guarded=1'); // with the guarded memory changes: each has a card here
  state.feed = es;
  es.onopen = () => { setAway(false); soon(); }; // back after a break: the line goes, and catch up
  // run_waits: a run began to wait for the owner's OK on an action in a connected app, or stopped waiting (its `waitingFor`).
  ['run_started', 'run_finished', 'run_waits', 'bot_message', 'waiting', 'chief_reply', 'chief_suggestion', 'approvals', 'asks', 'bots', 'reset'].forEach((t) => es.addEventListener(t, soon));
  ['login_request', 'login_request_closed'].forEach((t) => es.addEventListener(t, () => { pollLoginRequests(); soon(); })); // soon: the bot's face shows it needs you
  es.addEventListener('run_steered', soon); // a run read a message the owner steered into it (ADR 040): the refresh draws it there
  es.addEventListener('bitwarden', () => pollBitwarden());
  // A bot saved a page (#346): an open page and the bot's list of pages follow (public/pages.js).
  es.addEventListener('page', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (typeof Pages !== 'undefined') Pages.changed(d);
  });
  // The Chief's own jobs changed (#408): their list in its settings follows.
  es.addEventListener('chief_jobs', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (Array.isArray(d.jobs)) drawChiefJobs(d.jobs);
  });
  // A chat's new replies changed: its dots follow, in every app.
  es.addEventListener('unread', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (d.chat) setUnread(d.chat, d);
  });
  // A bot's open question changed (`asks` with `botId`; the event of the same name without it lists what waits in
  // Needs you): its line in the list follows at once, also in a page that did not send the answer.
  es.addEventListener('asks', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (Unread.asked(state.bots, d)) renderContacts();
  });
  es.addEventListener('reset', () => { if (openingLines.clear()) { renderContacts(); placeStatusLines(); } }); // the refresh reads them again
  // What waits for the owner, as the feed lists it, at the start and whenever it changes: a waiting job says
  // there what a yes on it starts (needsItems). The refresh that follows draws it.
  const waits = (of) => (e) => { try { state.approvals = of(JSON.parse(e.data)) || null; } catch { /* not ours */ } };
  es.addEventListener('hello', waits((d) => d.approvals));
  es.addEventListener('approvals', waits((d) => d));
  // Whether Claude is signed in, at the start and whenever it changes: the standing line follows (setSignedOut).
  const claude = (of) => (e) => { try { setSignedOut(of(JSON.parse(e.data))); } catch { /* not ours */ } };
  es.addEventListener('hello', claude((d) => d.claude));
  es.addEventListener('claude', claude((d) => d));
  // The owner's messages that wait in a chat changed: one was taken, started, or was taken back. The whole list
  // comes with it, also to a page that sent none of them.
  es.addEventListener('queued', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (typeof d.chat === 'string') setQueued(d.chat, d.queued);
  });
  es.addEventListener('queued', soon); // and the bots are read again: a list fetched before this one may be drawn meanwhile
  // The Chief began a reply this page may not have asked for: after an OK, for a message that waited, for a late
  // result. Its working line shows, and the chat is read again so that the turn and its reply are followed.
  // While this page is sending there, or follows the reply before it, that is done when that ends.
  // The Chief was given another name (#41), in setup, in an app or by asking it.
  es.addEventListener('chief_name', (e) => {
    if (takeChiefName(JSON.parse(e.data).name)) { renderContacts(); drawChiefName(); drawPanelHead(); }
  });
  es.addEventListener('chief_started', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (typeof d.chatId !== 'string' || !d.chatId) return;
    if (!chiefTurns.has(d.chatId)) chiefTurns.set(d.chatId, '');
    placeStatusLines();
    if (state.view !== 'chief' || d.chatId !== state.chatId || sendingIn.has($('#view-chief form'))) return;
    if (state.chatStream) state.chatReload = true;
    else showChat(d.chatId);
  });
  // A working bot said its opening line: under its chat and as its preview in the list, at once. From a server
  // with the working line a bot's line comes as `working_line` (below); the Chief's comes here as before.
  es.addEventListener('opening_line', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (d.runId && !OpeningLine.says('opening_line', state.features)) return;
    if (openingLines.say(d.chat, d.text, d.runId ?? null)) { renderContacts(); placeStatusLines(); }
  });
  // A working bot's line changed: the server's words for what it is doing now, in the same two places.
  es.addEventListener('working_line', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (openingLines.say(d.chat, d.text, d.runId ?? null)) { renderContacts(); placeStatusLines(); }
  });
  // Its run ended, with an answer or without: the line goes, before the refresh that shows the reply.
  es.addEventListener('run_finished', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (openingLines.end(`bot:${d.botId}`, d.id)) { renderContacts(); placeStatusLines(); }
  });
  // A tile's new value, or the Board changed (the Chief added a tile).
  es.addEventListener('dashboard', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (d.tile && state.dash) { state.dash.tiles = state.dash.tiles.map((t) => (t.id === d.tile.id ? d.tile : t)); if (state.view === 'dashboard') renderDashboard(); }
    else loadDash(state.view !== 'dashboard');
    if (typeof DocViewer !== 'undefined') DocViewer.tileChanged(d.tile?.id); // a page whose blocks read it (#395)
  });
  // A reply in the Chief chat that's open, which this page isn't following: a bot's reply posted there, an unasked
  // message, or the Chief answering a message sent from the phone. Show it (after the Chief's own reply, if that's
  // still coming).
  es.addEventListener('chief_reply', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    // The Chief's own reply ended; a bot's file doesn't end it, nor a "/btw" answer beside it (#386). A reply this page
    // follows ends with its stream (followChief).
    if (!d.from && !d.btw) {
      const followed = state.chatStream && d.chatId === state.chatId;
      if ([openingLines.end(`chief:${d.chatId}`), !followed && chiefTurns.delete(d.chatId)].some(Boolean)) placeStatusLines();
    }
    if (state.view !== 'chief' || d.chatId !== state.chatId) return;
    // The Chief's own reply arrives through its stream; a bot's reply or an unasked message that waited for it doesn't.
    // A "/btw" answer shows at once, above the reply that is still coming.
    if (d.btw) showChat(d.chatId);
    else if (state.chatStream) { if (d.from || d.unasked) state.chatReload = true; }
    else showChat(d.chatId);
  });
  // An unasked message was rated, here or in another app: its thumbs follow, when its chat is on screen.
  es.addEventListener('rating', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    const thread = $('#chat-thread');
    if (!thread || !d.chatId || thread.dataset.chat !== d.chatId || !Number.isInteger(d.index)) return;
    Ratings.show($(`.rate[data-rate="${d.index}"]`, thread), d.rating);
  });
  // The checkup's setting changed, in another app or by the Chief in a chat: the switches follow.
  es.addEventListener('checkup', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (typeof d.on !== 'boolean') return;
    state.checkup = d;
    drawCheckup();
  });
}
