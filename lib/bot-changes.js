// Separate a proposed bot edit from the permissions the owner has already granted.
const { tr } = require('./i18n');
const powerful = (tool) => /^(Bash|WebFetch|WebSearch)(?:\(|$)/.test(tool);
function pendingChanges(before, next) {
  const changes = {};
  for (const field of ['prompt', 'systemPrompt']) if (before[field] !== next[field]) changes[field] = next[field];
  if (next.allowedTools.some((tool) => powerful(tool) && !before.allowedTools.includes(tool))) changes.allowedTools = next.allowedTools;
  if (next.computer !== 'none' && next.computer !== before.computer) changes.computer = next.computer; // a computer, or the other one (ADR 088)
  if (next.connectors.some((app) => !before.connectors.includes(app))) changes.connectors = next.connectors;
  const safe = { ...next };
  for (const field of Object.keys(changes)) safe[field] = before[field];
  // Removals take effect immediately, even if the same edit also proposes additions.
  if (changes.allowedTools) safe.allowedTools = next.allowedTools.filter((tool) => !powerful(tool) || before.allowedTools.includes(tool));
  if (changes.connectors) safe.connectors = next.connectors.filter((app) => before.connectors.includes(app));
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
    ...('prompt' in changes ? [tr(lang, 'new main assignment')] : []),
    ...('systemPrompt' in changes ? [tr(lang, 'new rules')] : []),
  ];
}
module.exports = { pendingChanges, waitingWords };
