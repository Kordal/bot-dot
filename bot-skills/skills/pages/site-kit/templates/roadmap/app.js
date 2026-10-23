// The roadmap page of the approved mockup, built with the kit: views in the nav, a hero with a ring, chips that
// filter by area, a sort, a kanban of cards that open, a table of releases and the bots. All of it from data.json.
const $ = (s) => document.querySelector(s);
const esc = botdot.esc;
const COLOR = { waiting: 'var(--warn)', doing: 'var(--blue)', done: 'var(--ok)' };
let data = { columns: [], items: [], areas: [], releases: [], bots: [] };
let area = 'All';
let open = null;

const refs = (list) => (list || []).map((r) => {
  const n = String(r).match(/\d+/)?.[0];
  const href = data.repo && n ? `${data.repo}/${/PR/.test(r) ? 'pull' : 'issues'}/${n}` : null;
  return href ? `<a class="ref" href="${esc(href)}">${esc(r)}</a>` : `<span class="ref">${esc(r)}</span>`;
}).join('');

function card(it, col) {
  const bots = (it.bots || []).map((b) => data.bots.find((x) => x.name === b)).filter(Boolean);
  const sub = [
    bots.length ? `<span class="avatars">${bots.map((b) => `<i style="--c:${esc(b.color)}"></i>`).join('')}</span>` : '',
    refs(it.refs),
    it.note ? `<span>${it.refs?.length ? '· ' : ''}${esc(it.note)}</span>` : '',
  ].join('');
  return `<button class="fc${open === it.id ? ' open' : ''}" data-id="${esc(it.id)}">` +
    `<div class="t">${esc(it.title)}</div>${sub ? `<div class="s">${sub}</div>` : ''}` +
    (it.progress != null ? `<div class="progress"><i style="--p:${Number(it.progress)};--c:${COLOR[col.id] || 'var(--blue)'}"></i></div>` : '') +
    (open === it.id && it.more ? `<div class="more">${esc(it.more)}</div>` : '') + '</button>';
}

function drawBoard() {
  const q = $('#q').value.trim().toLowerCase();
  const key = $('#sort').value;
  const shown = data.items
    .filter((it) => area === 'All' || it.area === area)
    .filter((it) => !q || [it.title, it.note, it.more, ...(it.refs || [])].join(' ').toLowerCase().includes(q))
    .sort((a, b) => key === 'title' ? a.title.localeCompare(b.title) : key === 'progress' ? (b.progress ?? 100) - (a.progress ?? 100) : String(b.changed).localeCompare(String(a.changed)));
  $('#board').style.setProperty('--cols', data.columns.length || 3);
  $('#board').innerHTML = data.columns.map((col) => {
    const list = shown.filter((it) => it.column === col.id);
    return `<div class="col"><h4><i style="--c:${COLOR[col.id] || 'var(--muted)'}"></i>${esc(col.title)} <em>${list.length}</em></h4>` +
      (list.map((it) => card(it, col)).join('') || '<div class="empty">Nothing here.</div>') + '</div>';
  }).join('');
}

function drawAreas() {
  $('#areas').innerHTML = ['All', ...data.areas].map((a) => `<button class="chip${a === area ? ' on' : ''}" data-area="${esc(a)}">${esc(a)}</button>`).join('');
}

function draw() {
  $('#name').textContent = data.name || '';
  $('#asof').textContent = data.asOf ? `As of ${data.asOf}` : '';
  // The title's highlighted words: *like this* in data.json.
  $('#title').innerHTML = esc(data.title || '').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
  $('#lead').textContent = data.lead || '';
  const total = data.items.length;
  const done = data.items.filter((it) => it.column === 'done').length;
  botdot.ring($('#ring'), data.done ?? (total ? (done / total) * 100 : 0), 'done');
  drawAreas();
  drawBoard();
  $('#releases').innerHTML = data.releases.map((r) =>
    `<tr><td class="mono">${esc(r.version)}</td><td class="faint">${esc(r.date)}</td><td>${esc(r.what)}</td><td><span class="pill ${esc(r.level || 'ok')}">${esc(r.state)}</span></td></tr>`).join('');
  $('#bots').innerHTML = data.bots.map((b) =>
    `<div class="card"><h3><span class="avatars"><i style="--c:${esc(b.color)}"></i></span> ${esc(b.name)}</h3><div class="muted">${esc(b.job)}</div>` +
    `<div style="margin-top:10px"><span class="pill ${esc(b.level || 'ok')}">${esc(b.state)}</span></div></div>`).join('');
}

document.querySelectorAll('.nav [data-view]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.nav [data-view]').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = !p.dataset.panel.split(' ').includes(b.dataset.view); });
}));
$('#areas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-area]');
  if (b) { area = b.dataset.area; drawAreas(); drawBoard(); }
});
$('#board').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const c = e.target.closest('.fc');
  if (c) { open = open === c.dataset.id ? null : c.dataset.id; drawBoard(); }
});
$('#sort').addEventListener('change', drawBoard);
$('#q').addEventListener('input', drawBoard);
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('#q').focus(); } });

botdot.data().then((d) => { data = { ...data, ...d }; draw(); });
