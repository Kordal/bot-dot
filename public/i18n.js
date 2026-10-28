// The interface's language (#645, ADR 108): the page's words in English, or in Polish when the account chose it in
// Settings. A string is keyed by its English text: tr('Saved') is "Saved" in English and "Zapisano" in Polish, and a
// string without a translation stays English. trn(n, '{n} bot', '{n} bots') picks the plural form by the language's
// rules. The dictionary comes from the server (GET /api/i18n/pl) and is kept in this browser, so that the words are
// there before the first script draws anything; static text in index.html is marked with data-t (its text),
// data-t-title, data-t-placeholder and data-t-aria-label, and translated when this file loads.
const I18n = (() => {
  const KEY = 'botdot.language';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const kept = read();
  const language = kept?.language === 'pl' ? 'pl' : 'en';
  const strings = language === 'pl' && kept.strings && typeof kept.strings === 'object' ? kept.strings : {};
  const plural = new Intl.PluralRules(language);
  const fill = (text, vars) => (vars ? String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(text));

  function tr(text, vars) {
    const v = strings[text];
    return fill(typeof v === 'string' ? v : text, vars);
  }
  function trn(n, one, other, vars) {
    const all = { n, ...vars };
    const v = strings[other];
    if (v && typeof v === 'object') return fill(v[plural.select(n)] ?? v.many ?? other, all);
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
  // page was drawn with, the page loads again, once: every word is then drawn in the new language.
  async function sync(api, features) {
    if (!features.includes('language')) return;
    let lang;
    try { lang = (await api('/settings')).settings?.language === 'pl' ? 'pl' : 'en'; } catch { return; }
    let next = { language: lang };
    if (lang !== 'en') {
      try { next = { language: lang, strings: (await api(`/i18n/${lang}`)).strings || {} }; } catch { return; }
    }
    const same = lang === language && JSON.stringify(next.strings || {}) === JSON.stringify(lang === 'en' ? {} : strings);
    if (same) return;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { return; } // no storage: stays as it is
    let again = false;
    try { again = sessionStorage.getItem(KEY) === lang; sessionStorage.setItem(KEY, lang); } catch {}
    if (!again) location.reload();
  }

  document.documentElement.lang = language;
  apply();
  return { language, locale: language === 'pl' ? 'pl-PL' : undefined, tr, trn, apply, sync };
})();
const { tr, trn } = I18n;
