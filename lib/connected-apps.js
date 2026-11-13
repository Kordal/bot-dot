// Apps botdot connects through Composio (lib/connectors.js), seen from the side of a login. A website that is
// one of them is never asked for as a password: Google, Slack, GitHub… take a connected app, which signs in
// with the app's own page and keeps the token on the server. A bot that needs one it wasn't given asks for it
// (ask_chief_for_app): the owner gets its card (ADR 168).

// The sites of the apps people connect most, by the app's Composio slug. A site matches itself and what is under it.
const APPS = {
  googlecalendar: { name: 'Google Calendar', sites: ['calendar.google.com'] },
  gmail: { name: 'Gmail', sites: ['mail.google.com', 'gmail.com'] },
  googledrive: { name: 'Google Drive', sites: ['drive.google.com'] },
  googledocs: { name: 'Google Docs', sites: ['docs.google.com'] },
  googlesheets: { name: 'Google Sheets', sites: ['sheets.google.com'] },
  googletasks: { name: 'Google Tasks', sites: ['tasks.google.com'] },
  googlephotos: { name: 'Google Photos', sites: ['photos.google.com'] },
  youtube: { name: 'YouTube', sites: ['youtube.com'] },
  outlook: { name: 'Outlook', sites: ['outlook.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com'] },
  slack: { name: 'Slack', sites: ['slack.com'] },
  github: { name: 'GitHub', sites: ['github.com'] },
  notion: { name: 'Notion', sites: ['notion.so', 'notion.com'] },
  linear: { name: 'Linear', sites: ['linear.app'] },
  todoist: { name: 'Todoist', sites: ['todoist.com'] },
  trello: { name: 'Trello', sites: ['trello.com'] },
  asana: { name: 'Asana', sites: ['asana.com'] },
  dropbox: { name: 'Dropbox', sites: ['dropbox.com'] },
  discord: { name: 'Discord', sites: ['discord.com'] },
  spotify: { name: 'Spotify', sites: ['spotify.com'] },
};
const { TYPE: GITHUB_APP } = require('./github-app');
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// The app a website is, or null: calendar.google.com -> { slug: 'googlecalendar', name: 'Google Calendar' }.
// accounts.google.com, google.com and other sites of a company are no one app, so they are null.
function appForSite(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  for (const [slug, app] of Object.entries(APPS)) {
    if (app.sites.some((s) => h === s || h.endsWith(`.${s}`))) return { slug, name: app.name };
  }
  return null;
}

// What a login request for such a site is told instead. A token for an API (type "api-token") and a GitHub App's
// key (type "github-app", #155) are still asked for: a GitHub token for api_request is a login like any other.
const toBot = (host, app) => `${host} is ${app.name}, an app botdot connects: don't ask for its password. Ask for it with ask_chief_for_app (app "${app.slug}"): the owner gets one card to connect it or give it to you, and botdot starts you again on this work once it is done. Then say in one line that you asked.`;
const toChief = (host, app) => `${host} is ${app.name}, an app botdot connects: don't ask for its password. Check list_connectors: when it is connected, give it to the bot (update_bot connectors); when it isn't, offer its card with offer_connect_app (app "${app.slug}", bot the one that needs it) and say in one line that it waits.`;
const refused = (host, type) => (type === 'api-token' || type === GITHUB_APP ? null : appForSite(host));

const REQUESTS_AN_HOUR = 3;
const HOUR = 60 * 60_000;

// connectAsks: lib/connect-asks.js. post(what, runIds): a line in the Chief's chat (lib/chief.js post), the one
// that started one of runIds, else the one the owner last used.
function create({ connectAsks, post }) {
  let requests = []; // { botId, slug, at }
  const recent = () => (requests = requests.filter((r) => Date.now() - r.at < HOUR));

  // A bot asks for a connected app its work needs: one card for the owner, made here, with no Chief turn (ADR 168).
  // A Connect (or Reconnect) card when the app isn't connected, the card for the Composio key when there is none
  // that works, and a changed bot's card that gives it when it is connected already. Either way, the run that asked
  // carries on once it is done. Only the owner connects an app, and only the owner's press gives a bot one. The
  // Chief's chat gets the bot's line, as it did when it was told. Returns { asked, name, mode?, card } or
  // { held: 'day' | 'week', name } after the owner's no, or { already: true }.
  async function request({ bot, session, app, reason }) {
    const slug = String(app || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    reason = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!slug || !SLUG_RE.test(slug)) throw new Error('Name one app, e.g. "googlecalendar" or "slack".');
    if (!reason) throw new Error('Say in one sentence what you need it for.');
    const own = (bot.connectors || []).find((s) => connectAsks.sameApp(s, slug));
    if (own) throw new Error(`${APPS[slug]?.name || own} is already yours: use it with connector_actions and connector_run.`);
    if (recent().some((r) => r.botId === bot.id && r.slug === slug)) return { already: true };
    if (recent().filter((r) => r.botId === bot.id).length >= REQUESTS_AN_HOUR) throw new Error('You have asked for several apps already. Wait for the owner; say in one line what is missing.');
    const asked = { botId: bot.id, slug, at: Date.now() };
    requests.push(asked);
    let r;
    try { r = await connectAsks.need({ bot, app: String(app).trim(), reason, runId: session.runId }); } catch (e) {
      requests = requests.filter((x) => x !== asked);
      throw e;
    }
    const name = r.name || r.ask?.name || APPS[slug]?.name || slug;
    if (r.held) return { held: r.given ? 'week' : 'day', name };
    try {
      post({ role: 'report', from: { id: bot.id, name: bot.name, emoji: bot.emoji, color: bot.color }, text: `Asked for a connected app: ${name}. Why: ${reason}`, runId: session.runId }, [session.runId, session.chainId].filter(Boolean));
    } catch (e) { console.error(`[connectors] ${bot.name}'s ask for ${name} was not written in the Chief's chat: ${e.message}`); }
    return { asked: true, name, ...(r.given ? { given: true } : { mode: r.ask.mode }), card: r.ask.id };
  }

  return { request };
}

module.exports = { create, appForSite, refused, toBot, toChief, APPS };
