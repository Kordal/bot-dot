// Separate a proposed bot edit from the permissions the owner has already granted.
const { tr } = require('./i18n');
const powerful = (tool) => /^(Bash|WebFetch|WebSearch)(?:\(|$)/.test(tool);
function pendingChanges(before, next) {
  const changes = {};
  for (const field of ['prompt', 'systemPrompt']) if (before[field] !== next[field]) changes[field] = next[field];
  if (next.allowedTools.some((tool) => powerful(tool) && !before.allowedTools.includes(tool))) changes.allowedTools = next.allowedTools;
  if (next.computer !== 'none' && next.computer !== before.computer) changes.computer = next.computer; // a computer, or the other one (ADR 088)
  if (next.connectors.some((app) => !before.connectors.includes(app))) changes.connectors = next.connectors;
  // Another account of an app it has (ADR 174) acts on another real account: the owner's, as a new app is.
  const moved = Object.keys(next.accounts || {}).filter((app) => (before.connectors || []).includes(app) && next.accounts[app] !== (before.accounts || {})[app]);
  const heldApp = Object.keys(next.accounts || {}).some((app) => !(before.connectors || []).includes(app));
  if (moved.length || (changes.connectors && heldApp)) changes.accounts = next.accounts;
  const safe = { ...next };
  for (const field of Object.keys(changes)) safe[field] = before[field];
  // Removals take effect immediately, even if the same edit also proposes additions.
  if (changes.allowedTools) safe.allowedTools = next.allowedTools.filter((tool) => !powerful(tool) || before.allowedTools.includes(tool));
  if (changes.connectors) safe.connectors = next.connectors.filter((app) => before.connectors.includes(app));
  if (changes.accounts) {
    safe.accounts = { ...(next.accounts || {}) };
    for (const app of moved) { if ((before.accounts || {})[app]) safe.accounts[app] = before.accounts[app]; else delete safe.accounts[app]; }
  }
  // An app the change holds back takes its account with it.
  if (safe.accounts) for (const app of Object.keys(safe.accounts)) if (!(safe.connectors || []).includes(app)) delete safe.accounts[app];
  if (safe.computer !== 'linux') safe.computerAlwaysOn = false;
  return { safe, changes };
}
// What of an edit was held back for the owner, in the owner's words: one entry per held thing (`waiting`,
// docs/api.md). changes and safe: what pendingChanges gave. appName: an app's name by its slug.
// lang: the language a card says them in (ADR 108).
function waitingWords(changes, safe, appName = (app) => app, lang = 'en') {
  const held = (changes.allowedTools || []).filter((tool) => powerful(tool) && !safe.allowedTools.includes(tool));
  return [
    ...(held.some((tool) => /^Web(Search|Fetch)/.test(tool)) ? [tr(lang, 'web access')] : []),
    ...(held.some((tool) => /^Bash/.test(tool)) ? [tr(lang, 'commands')] : []),
    ...(changes.computer ? [tr(lang, 'the computer')] : []),
    ...((changes.mayMessage || []).some((id) => !(safe.mayMessage || []).includes(id)) ? [tr(lang, 'messaging bots')] : []),
    ...(changes.connectors || []).filter((app) => !safe.connectors.includes(app)).map((app) => appName(app)),
    ...Object.keys(changes.accounts || {}).filter((app) => (safe.connectors || []).includes(app) && changes.accounts[app] !== (safe.accounts || {})[app]).map((app) => tr(lang, 'another {app} account', { app: appName(app) })),
    ...('prompt' in changes ? [tr(lang, 'new main assignment')] : []),
    ...('systemPrompt' in changes ? [tr(lang, 'new rules')] : []),
  ];
}
module.exports = { pendingChanges, waitingWords };
