// ---------- runs ----------

function renderRuns() {
  const root = $('#view-runs');
  if (!root.querySelector('.runs-layout')) {
    root.innerHTML = `
      ${SUB_BACK}
      <div class="section-head"><div><h1>Activity</h1><p>Every bot run, live and past.</p></div>
        <select id="run-filter" style="width:auto"><option value="">All bots</option></select></div>
      <div class="runs-layout">
        <div class="card run-list" id="run-list"></div>
        <div class="card run-view" id="run-view"><div class="empty">Pick a run, or message a bot to start one.</div></div>
      </div>`;
    $('#run-filter').onchange = renderRunList;
  }
  const f = $('#run-filter');
  const cur = f.value;
  f.innerHTML = '<option value="">All bots</option>' + state.bots.map((b) => `<option value="${esc(b.id)}" ${b.id === cur ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  renderRunList();
  if (state.selectedRun && !$('#run-view').dataset.id) showRun(state.selectedRun);
}

function renderRunList() {
  const filter = $('#run-filter')?.value;
  const runs = state.runs.filter((r) => !filter || r.botId === filter);
  $('#run-list').innerHTML = runs.length
    ? runs.map((r) => `
      <button class="run-item ${r.id === state.selectedRun ? 'active' : ''}" data-id="${esc(r.id)}" style="--bot-color:${esc(r.botColor || '#6c7cff')}">
        ${runFigure(r)}
        <div class="grow">
          <div class="title">${esc(r.botName)}</div>
          <div class="sub">${ago(r.startedAt)} · ${r.jobName ? `⏰ ${esc(r.jobName)} · ` : r.trigger === 'schedule' ? '⏰ ' : ''}${[r.kind === 'script' ? 'no AI' : null, r.durationMs ? dur(r.durationMs) : null].filter(Boolean).join(' · ')}</div>
        </div>
        ${statusPill(r.reporting === 'held' ? 'held' : r.quiet ? 'quiet' : r.status)}
      </button>`).join('')
    : '<div class="empty" style="padding:30px">No runs yet</div>';
  $$('.run-item').forEach((el) => (el.onclick = () => openRun(el.dataset.id)));
}

function openRun(id) {
  state.selectedRun = id;
  const view = $('#run-view');
  if (view) view.dataset.id = '';
  setView('runs'); // renderRuns() opens the selected run
}

function toolArg(input) {
  if (!input) return '';
  return input.command || input.file_path || input.pattern || input.path || input.url || input.query || input.description || JSON.stringify(input).slice(0, 120);
}

function contentText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x.type === 'text' ? x.text : x.type === 'image' ? '[image]' : JSON.stringify(x))).join('\n');
  return JSON.stringify(c, null, 2);
}

// Turn a stream-json event into transcript HTML.
function renderEvent(ev, ctx) {
  if (ev.type === 'assistant') {
    return (ev.message?.content || []).map((c) => {
      if (c.type === 'text' && c.text.trim()) return `<div class="msg text md">${md(c.text)}</div>`;
      if (c.type === 'tool_use') {
        ctx.tools[c.id] = true;
        return `<details class="tool" id="tool-${esc(c.id)}"><summary><span class="tname">${esc(c.name)}</span><span class="targ">${esc(toolArg(c.input))}</span><span class="tstatus faint">…</span></summary><pre>${esc(JSON.stringify(c.input, null, 2))}</pre></details>`;
      }
      return '';
    }).join('');
  }
  if (ev.type === 'user') {
    for (const c of ev.message?.content || []) {
      if (c.type !== 'tool_result') continue;
      const images = Array.isArray(c.content) ? c.content.filter((x) => x.type === 'image' && (x.source?.data || x.source?.url)) : [];
      const textPart = Array.isArray(c.content) ? c.content.filter((x) => x.type !== 'image') : c.content;
      ctx.results.push({ id: c.tool_use_id, isError: c.is_error, text: contentText(textPart), images });
    }
    return '';
  }
  if (ev.type === 'stderr') return `<div class="msg stderr">${esc(ev.text)}</div>`;
  if (ev.type === 'script_output') return `<pre class="msg script-out">${esc(ev.text || '(no output)')}</pre>`;
  if (ev.type === 'raw') return `<div class="msg stderr">${esc(ev.text)}</div>`;
  return '';
}

function applyToolResults(root, ctx) {
  for (const r of ctx.results.splice(0)) {
    const el = root.querySelector(`#tool-${CSS.escape(r.id)}`);
    if (!el) continue;
    el.classList.toggle('err', !!r.isError);
    el.querySelector('.tstatus').textContent = r.isError ? 'error' : '✓';
    if (r.text) el.insertAdjacentHTML('beforeend', `<pre>${esc(r.text.slice(0, 8000))}${r.text.length > 8000 ? '\n…(truncated)' : ''}</pre>`);
    for (const img of r.images || []) {
      const src = img.source.url && img.source.url.startsWith('/api/runs/') ? img.source.url : `data:${img.source.media_type || 'image/png'};base64,${String(img.source.data || '').replace(/[^A-Za-z0-9+/=]/g, '')}`;
      el.insertAdjacentHTML('beforeend', `<img class="shot" alt="Screenshot" loading="lazy" src="${esc(src)}">`);
    }
  }
}
