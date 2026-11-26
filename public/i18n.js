// The interface's language (#645, ADR 108, ADR 280): the page's words in English, or in the language the account chose
// in Settings. A string is keyed by its English text: tr('Saved') is "Saved" in English and "Zapisano" in Polish, and a
// string without a translation stays English. trn(n, '{n} bot', '{n} bots') picks the plural form by the language's
// CLDR rules (Intl.PluralRules). The dictionary comes from the server (GET /api/i18n/<code>) with the languages the
// account may choose and the words the page reads in what a bot wrote (phrases), and is kept in this browser, so that
// the words are there before the first script draws anything; static text in index.html is marked with data-t (its
// text), data-t-title, data-t-placeholder and data-t-aria-label, and translated when this file loads.
const I18n = (() => {
  const KEY = 'botdot.language';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const kept = read() || {};
  const code = (v) => (typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) ? v : 'en');
  const language = code(kept.language);
  const strings = language !== 'en' && kept.strings && typeof kept.strings === 'object' ? kept.strings : {};
  // The languages the account may choose: { code, name, locale, … } from the server; until it said, this one's.
  const languages = Array.isArray(kept.languages) && kept.languages.length ? kept.languages.filter((l) => l && typeof l.code === 'string') : [{ code: 'en', name: 'English' }];
  const phrases = kept.phrases && typeof kept.phrases === 'object' ? kept.phrases : {};
  const here = languages.find((l) => l.code === language);
  let plural;
  try { plural = new Intl.PluralRules(language); } catch { plural = new Intl.PluralRules('en'); }
  const fill = (text, vars) => (vars ? String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(text));

  function tr(text, vars) {
    const v = strings[text];
    return fill(typeof v === 'string' ? v : text, vars);
  }
  // A plural's forms are keyed by the language's CLDR categories; a missing one is "other", then "few" (a Polish or
  // Russian fraction takes the few form's words), then "many".
  function trn(n, one, other, vars) {
    const all = { n, ...vars };
    const v = strings[other];
    if (v && typeof v === 'object') return fill(v[plural.select(n)] ?? v.other ?? v.few ?? v.many ?? other, all);
    return fill(n === 1 ? one : other, all);
  }

  // The marked static text of `root` in the page's language.
  function apply(root = document) {
    if (language === 'en') return;
    root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = tr(el.dataset.t || el.textContent.trim()); });
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      root.querySelectorAll(`[data-t-${attr}]`).forEach((el) => el.setAttribute(attr, tr(el.getAttribute(attr) || '')));
    }
  }

  // The account's language from the server, with its dictionary, kept for the next load. When either is not what this
  // page was drawn with, the page loads again, once: every word is then drawn in the new language. A server that
  // offers languages (`languages` in features, ADR 280) answers English too, with the languages and the phrases; an
  // older one has only Polish's dictionary.
  // settings: GET /settings's answer when it was already asked for (boot.js asks it beside the rest, #1103).
  async function sync(api, features, settings = null) {
    if (!features.includes('language')) return;
    const many = features.includes('languages');
    let lang;
    try { lang = code((await (settings || api('/settings'))).settings?.language); } catch { return; }
    let next = { language: lang };
    if (lang !== 'en' || many) {
      try {
        const d = await api(`/i18n/${encodeURIComponent(lang)}`);
        next = { language: lang, strings: lang === 'en' ? {} : d.strings || {}, ...(many ? { languages: d.languages || [], phrases: d.phrases || {} } : {}) };
      } catch { return; }
    }
    const was = { language, strings: language === 'en' ? {} : strings, ...(many ? { languages: kept.languages || [], phrases: kept.phrases || {} } : {}) };
    const same = JSON.stringify({ ...next, strings: next.strings || {} }) === JSON.stringify(was);
    if (same) return;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { return; } // no storage: stays as it is
    let again = false;
    try { again = sessionStorage.getItem(KEY) === lang; sessionStorage.setItem(KEY, lang); } catch {}
    if (!again) location.reload();
  }

  document.documentElement.lang = language;
  apply();
  // locale: for dates and numbers, the language's own (its `locale`); English keeps the browser's own conventions.
  return { language, locale: language === 'en' ? undefined : here?.locale || language, languages, phrases, tr, trn, apply, sync };
})();
const { tr, trn } = I18n;
