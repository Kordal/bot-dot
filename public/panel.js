// The settings panel of the web page: a bot's settings, its jobs, the Chief's settings and a group's panel
// (its name and its members), right of the chat they belong to. The chat is the view ('bot', 'chief' or
// 'group'); the panel beside it is closed (null) or shows 'settings' or 'jobs', always those of that chat. This file decides what a click leads to; app.js
// draws it, and the style puts the panel beside the chat or, in a column too narrow for both, over it.
// A plain <script>, as window.Panel; the tests load it the same way.

(function (root) {

// The names the first three had as pages of their own: callers still ask for them, and the address keeps them.
const PAGES = {
  botsettings: { view: 'bot', panel: 'settings' },
  botjobs: { view: 'bot', panel: 'jobs' },
  chiefsettings: { view: 'chief', panel: 'settings' },
  groupsettings: { view: 'group', panel: 'settings' },
};
const NAMES = Object.keys(PAGES);
const CHATS = ['bot', 'chief', 'group'];

// What the panel can show beside a view: only a bot has jobs, and a page that is no chat has no panel.
function fit(view, panel) {
  if (!CHATS.includes(view)) return null;
  if (panel === 'jobs') return view === 'bot' ? 'jobs' : 'settings';
  return panel === 'settings' ? 'settings' : null;
}

// From where the page is, { view, panel }, and what was asked, to where it goes. Asked is one of:
//   { view, covered }   a view by name, also one of the three names above (the list, a link, the address);
//                       covered: the panel is over the chat, in a column too narrow for both
//   { panel: 'toggle' } the figure and name in a chat
//   { panel: 'close' }  the panel's close button
//   { panel: 'back' }  the panel's back button: from the jobs to the settings they were opened from, else to the chat
//   { gone: true }      the bot, or the group, of the chat was deleted
// via, beside view and panel: the jobs in the panel were opened from the settings of the same chat.
function next(cur, req) {
  const to = step(cur, req);
  return { ...to, via: to.panel === 'jobs' && !!to.via };
}
function step(cur, req) {
  const view = cur.view;
  const panel = fit(view, cur.panel);
  const via = panel === 'jobs' && !!cur.via;
  if (req.gone) return { view: 'chief', panel: null };
  if (req.view) {
    // The jobs asked for while the settings are open come from them; asked for again, they keep where they came from.
    if (req.view === 'botjobs') return { ...PAGES.botjobs, via: view === 'bot' && (panel === 'settings' || via) };
    if (PAGES[req.view]) return { ...PAGES[req.view] };
    // Another chat keeps the panel open, on that chat's settings; a panel that covers the chat makes way
    // for it, since a chat was asked for.
    return { view: req.view, panel: fit(req.view, panel && !req.covered ? 'settings' : null) };
  }
  if (req.panel === 'toggle') return { view, panel: panel ? null : fit(view, 'settings') };
  if (req.panel === 'close') return { view, panel: null };
  if (req.panel === 'back') return { view, panel: via ? 'settings' : null };
  return { view, panel, via };
}

// Which of them the panel draws: null when it is closed.
function page(view, panel) {
  const p = fit(view, panel);
  return (p && NAMES.find((n) => PAGES[n].view === view && PAGES[n].panel === p)) || null;
}

// The view's name in the address.
const name = (view, panel) => page(view, panel) || view;

root.Panel = { NAMES, next, page, name };

})(typeof window !== 'undefined' ? window : globalThis);
