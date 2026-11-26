// The language a bot's browser shows sites (BOTDOT_LOCALE of deploy/desktop/camoufox-browser): the account's own,
// so a page, its numbers and its dates come in the owner's language, and not in that of the country the server's
// address is in, which the browser's geoip would give. Read when a browser's bridge starts. Each language's locale is
// its `browser` in the registry (lib/i18n/languages.json, ADR 280): every language the account may choose.
const i18n = require('./i18n');
const LOCALES = Object.fromEntries(i18n.REGISTRY.map((l) => [l.code, l.browser]));
const offered = (lang) => i18n.isOffered(lang);
let languageOf = () => 'en';

function use(fn) { languageOf = fn; }
function language() {
  let lang = 'en';
  try { lang = languageOf() || 'en'; } catch { lang = 'en'; }
  return offered(lang) ? lang : 'en';
}
const browserLocale = () => LOCALES[language()];

// With a Docker helper (lib/docker-helper.js), the bridges start in the helper, which has no settings: each call to it
// carries the account's language (lib/helper-client.js), and the helper starts the bridges with that.
module.exports = { use, language, browserLocale, offered, LOCALES };
