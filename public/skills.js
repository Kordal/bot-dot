// ---------- skills ----------

const SOURCE_LABEL = { created: 'Written here', github: 'From GitHub' };

// Where a library skill came from: imported, or written by you, the Chief or a bot (while learning).
function skillOrigin(k) {
  if (k.source !== 'created') return SOURCE_LABEL[k.source] || k.source;
  if (k.createdBy === 'chief') return 'Written by the Chief';
  if (String(k.createdBy).startsWith('bot:')) {
    const b = state.bots.find((x) => x.id === k.createdBy.slice(4));
    return b ? `Written by ${b.name}` : 'Written by a bot';
  }
  return 'Written here';
}

async function renderSkills() {
  const root = $('#view-skills');
  let data = { library: [], machine: [] };
  try { data = await api('/skills'); } catch (e) { toast(e.message, true); }
  if (state.view !== 'skills') return;
  const botChip = (id) => { const b = isChief({ id }) ? CHIEF_BOT : state.bots.find((x) => x.id === id); return b ? `<span class="chip" title="${esc(b.name)}">${botLabel(b)}</span>` : ''; };
  root.innerHTML = `
    ${SUB_BACK}
    <div class="section-head">
      <div><h1>Skills</h1></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="import-skill">Import</button>
        <button class="btn primary" id="new-skill">＋ New skill</button>
      </div>
    </div>
    <h3 class="page-sub">Your library <span class="faint">· give each skill to the bots that need it</span></h3>
    ${data.library.length ? `<div class="grid">${data.library.map((k) => `
      <article class="card skill-card" data-skill="${esc(k.name)}">
        <div class="skill-top"><span class="skill-name">${esc(k.name)}</span><span class="pill">${esc(skillOrigin(k))}</span></div>
        <p class="skill-desc">${esc(k.description)}</p>
        ${k.scripts.length ? `<div class="skill-warn">Includes ${k.scripts.length} script${k.scripts.length === 1 ? '' : 's'} a bot may run</div>` : ''}
        ${k.allowedTools.length ? `<div class="skill-warn">Can use without asking: ${esc(k.allowedTools.join(', '))}</div>` : ''}
        <div class="chips">${k.usedBy.map(botChip).join('') || '<span class="faint" style="font-size:12.5px">No bot has it yet</span>'}</div>
      </article>`).join('')}</div>`
      : `<div class="card empty" style="padding:36px 20px"><div class="big">✦</div>No skills yet. Write one, import one from skills.sh or GitHub, or ask the Chief ("make a skill for how I like my weekly reports"). Bots also write their own as they learn.</div>`}
    <h3 class="page-sub">On this computer</h3>
    <div class="card machine-skills">${data.machine.length ? data.machine.map((k) => `
      <div class="machine-skill"><span class="skill-name">${esc(k.name)}</span><span class="muted">${esc(k.description.slice(0, 160))}${k.description.length > 160 ? '…' : ''}</span><span class="faint">${esc(k.origin)}</span></div>`).join('')
      : '<div class="faint" style="padding:14px 16px">None found in ~/.claude/skills.</div>'}</div>
    ${data.builtin?.length ? `<h3 class="page-sub">Built into Claude Code</h3>
    <div class="card builtin-skills">${data.builtin.map((k) => `<span class="chip mono">${esc(k.name)}</span>`).join('')}</div>` : ''}`;
  $('#new-skill').onclick = () => openSkillEditor();
  $('#import-skill').onclick = () => openSkillImport();
  $$('[data-skill]', root).forEach((el) => (el.onclick = async () => {
    try { openSkillEditor(await api(`/skills/${encodeURIComponent(el.dataset.skill)}`)); } catch (e) { toast(e.message, true); }
  }));
}

// The Chief comes first: you give it a skill as you give one to a bot (its turns load it beside its own).
function botCheckboxes(selected = []) {
  return `<div class="tool-toggles">${[CHIEF_BOT, ...state.bots].map((b) => `<label><input type="checkbox" name="bot" value="${esc(b.id)}" ${selected.includes(b.id) ? 'checked' : ''}${b.useSkills === false ? ' disabled title="Skills are turned off for this bot"' : ''}>${botLabel(b)}</label>`).join('')}</div>`;
}

// The bot boxes under a heading with Select all / Deselect all, as the list of the skills a link holds has (#488).
function botPickHTML(label, selected = []) {
  return `
    <div class="skill-pick-head">
      <span class="muted">${esc(label)}</span>
      <span><button type="button" class="btn ghost" data-bots="all">Select all</button><button type="button" class="btn ghost" data-bots="none">Deselect all</button></span>
    </div>
    <div class="bot-pick">${botCheckboxes(selected)}</div>`;
}

// A bot with skills turned off keeps its box as it is.
function wireBotPick(root) {
  for (const b of $$('[data-bots]', root)) b.onclick = () => { for (const c of $$('input[name=bot]:not(:disabled)', root)) c.checked = b.dataset.bots === 'all'; };
}

// opts.forBot: pre-tick this bot. opts.onDone(name|null): called when the dialog closes (used by a bot's settings).
function openSkillEditor(skill, opts = {}) {
  const isNew = !skill;
  const k = skill || { name: '', description: '', instructions: '', usedBy: opts.forBot ? [opts.forBot] : [], source: 'created', scripts: [], allowedTools: [], fileCount: 0 };
  const m = openModal(`
    <form id="skill-form" autocomplete="off">
      <div class="modal-head"><h2>${isNew ? 'New skill' : esc(k.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <div class="row">
          <label class="field" title="lowercase-with-dashes">Name<input type="text" name="name" value="${esc(k.name)}" placeholder="weekly-report" required pattern="[a-z0-9][a-z0-9-]*"></label>
          <label class="field" title="Bots decide from this">When to use it<input type="text" name="description" value="${esc(k.description)}" placeholder="Use when writing the weekly status report" required></label>
        </div>
        <label class="field" title="Markdown: steps, rules, templates, examples">Instructions
          <textarea name="instructions" rows="12" class="mono" placeholder="# Weekly report&#10;1. Start with the three biggest wins…" required>${esc(k.instructions)}</textarea></label>
        ${String(k.createdBy).startsWith('bot:') ? `<div class="req-note">${esc(skillOrigin(k))} while learning. It may keep improving it, and its changes reach every bot that has this skill.</div>` : ''}
        ${k.source === 'github' ? `<div class="req-note">Imported from <a href="${esc(k.sourceUrl)}" target="_blank" rel="noopener">${esc(k.sourceUrl)}</a> · ${k.fileCount + 1} files${k.scripts.length ? ` · scripts: ${esc(k.scripts.join(', '))}` : ''}${k.allowedTools.length ? ` · can use without asking: ${esc(k.allowedTools.join(', '))}` : ''}</div>` : ''}
        <fieldset><legend>Bots with this skill</legend>${botCheckboxes(k.usedBy)}</fieldset>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" class="btn danger left" id="delete-skill">Delete</button>'}
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" type="submit">${isNew ? 'Create skill' : 'Save'}</button>
      </div>
    </form>`);
  const form = $('#skill-form', m);
  let doneName = null;
  if (opts.onDone) m.addEventListener('close', () => opts.onDone(doneName), { once: true });
  const del = $('#delete-skill', m);
  if (del) del.onclick = async () => {
    if (!confirm(`Delete the skill "${k.name}"? Bots that have it will stop using it.`)) return;
    await api(`/skills/${encodeURIComponent(k.name)}`, { method: 'DELETE' });
    m.close();
    toast('Skill deleted');
    await refresh();
    renderSkills();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: form.name.value.trim().toLowerCase(),
      description: form.description.value.trim(),
      instructions: form.instructions.value,
      bots: $$('input[name=bot]:checked', form).map((c) => c.value),
    };
    try {
      const saved = await api(isNew ? '/skills' : `/skills/${encodeURIComponent(k.name)}`, { method: isNew ? 'POST' : 'PUT', body });
      doneName = saved.name;
      m.close();
      toast(isNew ? 'Skill created' : 'Saved');
      await refresh();
      if (state.view === 'skills') renderSkills();
    } catch (err) { toast(err.message, true); }
  };
}

// The skills a link to several holds (#30): each with a box, ticked unless it can't be imported; the ones the
// library has are flagged, and are skipped unless "Replace the ones I have" is ticked.
function skillPickHTML(p) {
  const row = (k) => `
    <label class="skill-pick-row${k.problem ? ' off' : ''}">
      <input type="checkbox" name="pick" value="${esc(k.folder)}" ${k.problem ? 'disabled' : 'checked'}${k.exists ? ' data-exists' : ''}>
      <span class="skill-pick-text">
        <span class="skill-name">${esc(k.name || k.folder)}</span>${k.exists ? ' <span class="pill warn">You already have it</span>' : ''}
        <span class="skill-pick-desc">${esc(k.problem || k.description || '(no description)')}</span>
        ${k.scripts.length ? `<span class="skill-pick-desc">⚠︎ Scripts a bot may run: ${esc(k.scripts.join(', '))}</span>` : ''}
        ${k.allowedTools.length ? `<span class="skill-pick-desc">⚠︎ Used without asking: ${esc(k.allowedTools.join(', '))}</span>` : ''}
      </span>
    </label>`;
  return `
    <div class="skill-pick-head">
      <span class="muted">${p.skills.length} skills found</span>
      <span><button type="button" class="btn ghost" data-pick="all">Select all</button><button type="button" class="btn ghost" data-pick="none">Deselect all</button></span>
    </div>
    <div class="skill-pick">${p.skills.map(row).join('')}</div>
    ${p.skills.some((k) => k.exists) ? '<label class="skill-pick-over"><input type="checkbox" name="overwrite"> Replace the ones I have</label>' : ''}
    ${p.skills.some((k) => k.scripts.length) ? '<div class="skill-warn">⚠︎ Some include scripts a bot may run. Only import skills from people you trust.</div>' : ''}`;
}

function openSkillImport(opts = {}) {
  const m = openModal(`
    <form id="import-form" autocomplete="off">
      <div class="modal-head"><h2>Import a skill</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <label class="field" title="On skills.sh, or its folder on GitHub; a repository of several lists them all">Link to the skill
          <input type="text" name="url" placeholder="https://skills.sh/vercel-labs/skills/find-skills" required></label>
        <div id="import-preview"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" type="submit" id="import-go">Preview</button>
      </div>
    </form>`);
  const form = $('#import-form', m);
  let preview = null;
  let doneName = null;
  // Closed, or once its import ends when the dialog went away at once (#478).
  let importing = false;
  const finish = () => { if (importing) return; m.removeEventListener('close', finish); opts.onDone?.(doneName); };
  m.addEventListener('close', finish);
  const imported = async () => { await refresh(); if (state.view === 'skills') renderSkills(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const go = $('#import-go', m);
    if (!preview) {
      go.disabled = true;
      go.textContent = 'Fetching…';
      try {
        preview = await api('/skills/import/preview', { method: 'POST', body: { url: form.url.value.trim() } });
      } catch (err) {
        toast(err.message, true);
        go.disabled = false;
        go.textContent = 'Preview';
        return;
      }
      form.url.readOnly = true;
      if (preview.many) {
        $('#import-preview', m).innerHTML = `${skillPickHTML(preview)}
          ${botPickHTML('Give them to', opts.forBot ? [opts.forBot] : [])}`;
        wireBotPick(form);
        const picks = () => $$('input[name=pick]:not(:disabled)', form);
        // The count is what goes in: a ticked one the library has goes in only when it is replaced.
        const count = () => {
          const n = picks().filter((c) => c.checked && (!('exists' in c.dataset) || form.overwrite?.checked)).length;
          go.textContent = `Import selected (${n})`;
          go.disabled = !n;
        };
        for (const b of $$('[data-pick]', form)) b.onclick = () => { for (const c of picks()) c.checked = b.dataset.pick === 'all'; count(); };
        for (const c of [...picks(), ...$$('input[name=overwrite]', form)]) c.onchange = count;
        count();
        return;
      }
      $('#import-preview', m).innerHTML = `
        <div class="row">
          <label class="field">Name<input type="text" name="name" value="${esc(preview.name)}" pattern="[a-z0-9][a-z0-9-]*"></label>
          <label class="field">Files<div class="muted" style="font-weight:400;padding-top:6px">${preview.files.length} file${preview.files.length === 1 ? '' : 's'} · ${(preview.totalBytes / 1024 / 1024).toFixed(1)} MB${preview.folder ? ` · from <span class="mono">${esc(preview.folder)}</span>` : ''}</div></label>
        </div>
        ${preview.exists ? '<div class="skill-warn">You already have a skill with this name. Importing replaces it.</div>' : ''}
        <div class="req-note"><b>${esc(preview.description || '(no description)')}</b></div>
        ${preview.scripts.length ? `<div class="skill-warn">⚠︎ Includes scripts a bot may run: ${esc(preview.scripts.join(', '))}. Only import skills from people you trust.</div>` : ''}
        ${preview.allowedTools.length ? `<div class="skill-warn">⚠︎ Lets a bot use these without asking while the skill is active: ${esc(preview.allowedTools.join(', '))}</div>` : ''}
        <details class="tool" open><summary><span class="tname">SKILL.md</span><span class="targ">what the bot will read</span></summary><div class="md skill-preview">${md(preview.instructions)}</div></details>
        ${botPickHTML('Give it to', opts.forBot ? [opts.forBot] : [])}`;
      wireBotPick(form);
      go.disabled = false;
      go.textContent = 'Import skill';
      return;
    }
    const bots = $$('input[name=bot]:checked', form).map((c) => c.value);
    // The dialog goes away at once and the import runs on with the corner pill (#478).
    importing = true;
    if (preview.many) {
      const body = { id: preview.id, skills: $$('input[name=pick]:checked', form).map((c) => c.value), overwrite: !!form.overwrite?.checked, bots };
      m.close();
      // A used or expired preview can't be sent again: its error offers nothing to try again (paste the link again).
      let done = null;
      await inBackground('Importing skills…', async () => { done = await api('/skills/import/confirm', { method: 'POST', body }); }, { ok: () => done.text });
      if (done?.failed.length) cornerPill('err', done.text);
      doneName = done?.imported[0] || null;
      importing = false;
      finish();
      if (done) await imported();
      return;
    }
    const body = { id: preview.id, name: form.name.value.trim().toLowerCase(), bots };
    // Refused (a name in use, say): the dialog comes back as it was, with the server's sentence.
    if (await setAside(m, 'Importing the skill…', async () => { doneName = (await api('/skills/import/confirm', { method: 'POST', body })).name; }, { ok: 'Skill imported' })) {
      importing = false;
      finish();
      await imported();
    } else importing = false;
  };
}
