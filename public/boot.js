// ---------- boot ----------

$('#more-btn').onclick = () => setView('settings');
$('#feedback-btn').onclick = () => openFeedback();
initSideGrip();
initChatGrip();
initQuote(); // the Quote button by text selected in a chat (chief.js)
// The pages opened from Settings go back to it.
document.addEventListener('click', (e) => { if (e.target.closest('[data-to-settings]')) setView('settings'); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-sign-in]')) setView('setup'); }); // the standing line's "Sign in"
$('#contact-search').oninput = () => { searchChats(); renderContacts(); markSearch(); };
addEventListener('keydown', onKeypadKey); // the keypad's keys, where it is shown
document.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) showList(); });
// A picture in a chat opens big on this page (served as a download, a plain link would save it).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.file-image, img.shot');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const src = a.tagName === 'IMG' ? a.src : a.getAttribute('href');
  const d = document.createElement('dialog');
  d.className = 'viewer';
  d.innerHTML = `<img src="${esc(src)}" alt="${esc(a.title || a.alt || '')}">`;
  d.onclick = () => d.close();
  d.onclose = () => d.remove();
  document.body.append(d);
  d.showModal();
});

(async () => {
  const figure = loadFigure();
  state.status = await api('/status').catch(() => null);
  await loadFeatures();
  showAdminLink();
  await figure;
  const [view, sub] = location.hash.slice(1).split('/');
  if (sub && view === 'runs') state.selectedRun = sub;
  if (sub && (view === 'chief' || view === 'chiefsettings')) state.chatId = sub;
  await refresh();
  renderStatus();
  // First start, or Claude isn't signed in: open the setup page.
  const setupNow = await api('/setup').catch(() => null);
  if (opensSetup(setupNow)) {
    setView('setup');
  } else {
    const known = ['chief', 'dashboard', 'bot', 'group', 'needs', ...Panel.NAMES, 'runs', 'vault', 'skills', 'settings', 'setup', 'connectors'].includes(view);
    setView(known ? view : 'chief', BOT_NAMES.includes(view) || GROUP_NAMES.includes(view) ? sub : undefined);
    if (!known) showList(); // phones start on the contact list
    showWhatsNew(); // after an update: what changed, once (whats-new.js)
  }
  // Keep things fresh without clobbering an open dialog. The live feed says when something changed, so while
  // it's connected this only checks once a minute; nothing while the page is hidden.
  const live = () => state.feed?.readyState === 1;
  const due = (at, ms) => !live() || away.on || Date.now() - (at || 0) >= ms; // away: asked again soon, also when a proxy holds the feed open
  setInterval(() => { if (!document.hidden && !$('#modal').open && due(state.refreshedAt, 60_000)) refresh(); }, 8000);
  pollLoginRequests();
  setInterval(() => { if (!document.hidden && due(loginReq.polledAt, 60_000)) pollLoginRequests(); }, 3000);
  pollBitwarden();
  setInterval(() => { if (!document.hidden && due(bwUi.polledAt, 60_000)) pollBitwarden(); }, 4000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!$('#modal').open) refresh();
    pollLoginRequests();
    pollBitwarden();
  });
  followFeed();
  if (state.feed) followGroups(state.feed); // what happens in the groups (groups.js)
  // Notifications on this device (push.js): botdot is given this browser's subscription again, and a tap on one
  // of them opens what it is about.
  if (state.features.includes('web-push') && Push.supported(window)) {
    Push.again(window, api);
    Push.onTap(window, openTarget);
  }
})();
