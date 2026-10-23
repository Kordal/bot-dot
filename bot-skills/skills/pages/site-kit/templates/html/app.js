// The page's own code: it reads data.json, draws it with the kit's classes, and keeps a kpi live from a Board tile.
const $ = (s) => document.querySelector(s);
const esc = botdot.esc;
const LEVEL = { Done: 'ok', 'In progress': 'info', Waiting: 'warn', Blocked: 'err', Planned: 'plan' };
let data = { items: [] };
let sort = { key: 'changed', desc: true };
let live = {}; // the Board's values, by the tile names given at publish: they may come before data.json

function kpi(k) {
  // A kpi with a "tile" shows that tile's live value once the app has handed it.
  const now = k.tile && live[k.tile] ? live[k.tile].data?.value : undefined;
  const sub = now !== undefined ? 'live from the Board' : k.sub;
  return `<div class="card kpi"><div class="label">${esc(k.label)}</div>` +
    `<div class="value">${esc(now ?? k.value)}${k.unit ? `<small>${esc(k.unit)}</small>` : ''}</div>` +
    (sub ? `<div class="sub">${esc(sub)}</div>` : '') + botdot.spark(k.points) + '</div>';
}

function drawItems() {
  const q = $('#q').value.trim().toLowerCase();
  const rows = data.items
    .filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, { numeric: true }) * (sort.desc ? -1 : 1));
  $('#rows').innerHTML = rows.map((r) =>
    `<tr><td>${esc(r.name)}</td><td><span class="pill ${LEVEL[r.state] || ''}">${esc(r.state)}</span></td><td class="faint">${esc(r.changed)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="empty">Nothing matches.</td></tr>';
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === sort.key);
    th.classList.toggle('desc', th.dataset.sort === sort.key && sort.desc);
  });
}

function draw() {
  $('#name').textContent = data.name || 'Project';
  $('#asof').textContent = data.asOf ? `As of ${data.asOf}` : '';
  $('#title').textContent = data.title || '';
  $('#lead').textContent = data.lead || '';
  if (data.done != null) botdot.ring($('#ring'), data.done, 'done');
  $('#kpis').innerHTML = (data.kpis || []).map(kpi).join('');
  drawItems();
}

document.querySelectorAll('.nav [data-view]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.nav [data-view]').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.view; });
}));
document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  sort = { key: th.dataset.sort, desc: sort.key === th.dataset.sort ? !sort.desc : false };
  drawItems();
}));
$('#q').addEventListener('input', drawItems);

// Live values: the tiles named in publish_interactive_page's `tiles` (here "Disk"), when the page has loaded and on
// each change.
botdot.onValues((values) => { live = values; $('#kpis').innerHTML = (data.kpis || []).map(kpi).join(''); });

botdot.data().then((d) => { data = { items: [], ...d }; draw(); });
