// Search on the Skills page: one box over your library, the skills on this computer and the ones built
// into Claude Code. A skill stays when every word you typed is somewhere in what it shows (its name,
// description, where it came from, the bots that have it); case doesn't matter. Sections with no match
// are hidden. Loaded after app.js: it adds the box each time the page is drawn, and keeps what you typed.

(function (root) {

const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const skillMatches = (text, q) => { const t = String(text || '').toLowerCase(); return words(q).every((w) => t.includes(w)); };

const api = { skillMatches };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.SkillSearch = api;
if (typeof renderSkills !== 'function') return; // not on the page (the tests)

let query = '';
const ITEMS = [['grid', '.skill-card'], ['machine-skills', '.machine-skill'], ['builtin-skills', '.chip']];

function filterSkills(page) {
  const searching = words(query).length > 0;
  let shown = 0;
  $$('h3.page-sub', page).forEach((head) => {
    const box = head.nextElementSibling;
    const sel = ITEMS.find(([cls]) => box?.classList.contains(cls))?.[1];
    const items = sel ? $$(sel, box) : [];
    const hits = items.filter((el) => !el.classList.toggle('hidden', !skillMatches(el.textContent, query))).length;
    shown += hits;
    [head, box].forEach((el) => el?.classList.toggle('hidden', searching && !hits));
  });
  const none = $('#skill-search-none', page);
  none.classList.toggle('hidden', !searching || shown > 0);
  none.textContent = tr('No skills match "{query}". Try another word.', { query: query.trim() });
}

const draw = renderSkills;
renderSkills = async function (...args) {
  const old = $('#skill-search');
  const caret = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null; // typing while the page redraws
  const out = await draw.apply(this, args);
  const page = $('#view-skills');
  const head = $('.section-head', page);
  if (state.view !== 'skills' || !head) return out;
  head.insertAdjacentHTML('afterend', `<div class="conn-filters"><input type="search" id="skill-search" placeholder="${esc(tr('Search skills'))}" autocomplete="off" value="${esc(query)}"></div><div class="faint hidden" id="skill-search-none"></div>`);
  const box = $('#skill-search');
  box.oninput = () => { query = box.value; filterSkills(page); };
  if (caret) { box.focus(); box.setSelectionRange(...caret); }
  filterSkills(page);
  return out;
};

})(typeof globalThis !== 'undefined' ? globalThis : this);
