// The language a bot's browser shows sites (BOTDOT_LOCALE of deploy/desktop/camoufox-browser): the account's own,
// so a page, its numbers and its dates come in the owner's language, and not in that of the country the server's
// address is in, which the browser's geoip would give. Read when a browser's bridge starts.
const LOCALES = { en: 'en-US', pl: 'pl-PL' };
let languageOf = () => 'en';

function use(fn) { languageOf = fn; }
function language() {
  let lang = 'en';
  try { lang = languageOf() || 'en'; } catch { lang = 'en'; }
  return LOCALES[lang] ? lang : 'en';
}
const browserLocale = () => LOCALES[language()];

// With a Docker helper (lib/docker-helper.js), the bridges start in the helper, which has no settings: each call to it
// carries the account's language (lib/helper-client.js), and the helper starts the bridges with that.
module.exports = { use, language, browserLocale, LOCALES };
