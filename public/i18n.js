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
  // The language's elision rule (lib/i18n/elision.js, French's "d'Anna" for "de Anna"): { words, silentH } from the
  // server, kept with the dictionary; null when the language has none. Only a text of the dictionary elides.
  const elision = (() => {
    const e = kept.elision;
    const words = e && e.words && typeof e.words === 'object' ? Object.entries(e.words).filter(([w, f]) => /^\p{L}+$/u.test(w) && typeof f === 'string' && f) : [];
    if (language === 'en' || !words.length) return null;
    return { words: Object.fromEntries(words), silentH: Array.isArray(e.silentH) ? e.silentH.map((h) => String(h).toLowerCase()) : [] };
  })();
  const VOWELS = 'aeiouàâäéèêëîïôöùûüœæ';
  const FIRST_WORD = /^([\p{L}\p{M}][\p{L}\p{M}'’-]*)(?=$|[\s,;:!?)»…])/u;
  // A value that starts with a vowel or a mute h, as a word of letters alone ("Anna", "ouvrir"; not "app.js" or "Yann").
  const soft = (value) => {
    const lower = FIRST_WORD.exec(value)?.[1].toLowerCase();
    return !!lower && (VOWELS.includes(lower[0]) || (lower[0] === 'h' && elision.silentH.includes(lower.split('-')[0])));
  };
  const elide = elision && new RegExp(`(?<![\\p{L}\\p{N}'’])(${Object.keys(elision.words).join('|')})([ \\u00a0\\u202f])\\{(\\w+)\\}|\\{(\\w+)\\}`, 'giu');
  const fill = (text, vars, rule = false) => {
    if (!vars) return String(text);
    if (!rule || !elide) return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return String(text).replace(elide, (m, word, space, k, plain) => {
      const key = k ?? plain;
      if (!(key in vars)) return m;
      const value = String(vars[key]);
      const form = word && elision.words[word.toLowerCase()];
      if (!form || !soft(value)) return word ? `${word}${space}${value}` : value;
      return (word[0] === word[0].toUpperCase() ? form[0].toUpperCase() + form.slice(1) : form) + value;
    });
  };

  function tr(text, vars) {
    const v = strings[text];
    return typeof v === 'string' ? fill(v, vars, true) : fill(text, vars);
  }
  // A plural's forms are keyed by the language's CLDR categories; a missing one is "other", then "few" (a Polish or
  // Russian fraction takes the few form's words), then "many".
  function trn(n, one, other, vars) {
    const all = { n, ...vars };
    const v = strings[other];
    if (v && typeof v === 'object') {
      const t = v[plural.select(n)] ?? v.other ?? v.few ?? v.many;
      return t === undefined ? fill(other, all) : fill(t, all, true);
    }
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
        next = { language: lang, strings: lang === 'en' ? {} : d.strings || {}, ...(many ? { languages: d.languages || [], phrases: d.phrases || {}, elision: d.elision || null } : {}) };
      } catch { return; }
    }
    const was = { language, strings: language === 'en' ? {} : strings, ...(many ? { languages: kept.languages || [], phrases: kept.phrases || {}, elision: kept.elision || null } : {}) };
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
