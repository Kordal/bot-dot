// The project's calendar on the floor (#695, ADR 116), with its rules in company-calendar.js. The tile: this week's
// days, today lit, a dot under a day with something on it, and the next few items. A click opens the month: its days
// with their items, the picked day's list beside it, where the owner adds an event (title, time) and changes or
// deletes one. What it shows comes from GET /api/company/calendar, asked again when the project or its bots' jobs
// change. company-home.js puts the tile on the floor (Company.calendar.tile) and adds its sig.
(() => {
  const CAL = window.CompanyCalendar;
  const YOU = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  const REPEAT = '<svg class="cf-cal-rep" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>';
  const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>';
  const PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
  const NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  // ---------- what the server says ----------
  // The tile's two weeks from this Monday, asked again when what it is made of changed (`key`).
  const tile = { key: null, items: [], asking: false };
  function sourceKey(c) {
    const jobs = (c.teams || []).flatMap((t) => t.bots).map((id) => [id, (botById(id)?.jobs || []).map((j) => [j.id, j.name, j.cron, j.at, j.enabled, j.approved])]);
    return JSON.stringify([c.id, c.startedAt, c.events, c.todos, c.checkins, c.teams, jobs, CAL.today()]);
  }
  async function ask(from, to) {
    return (await api(`/company/calendar?from=${from}&to=${to}`)).items || [];
  }
  function refresh(c) {
    const key = sourceKey(c);
    if (key === tile.key || tile.asking) return;
    tile.asking = true;
    const from = CAL.monday(CAL.today());
    ask(from, CAL.addDays(from, 13))
      .then((items) => { tile.items = items; tile.key = key; Company.redraw(); if (open) month.load(); })
      .catch((e) => console.warn(e.message))
      .finally(() => { tile.asking = false; });
  }

  // ---------- how an item looks ----------
  const you = `<span class="cf-you sm">${YOU}</span>`;
  const head = (id) => (id === 'chief' ? chiefFigure('sm') : id && id !== 'you' && botById(id) ? botFigure(colorOf(botById(id)), 'idle', 'sm', outfitOf(botById(id))) : you);
  // Who an item belongs to: who added an event, whom a to-do is for, the bot of a job; a check-in is the project's.
  const whoOf = (x) => (x.kind === 'event' ? head(x.by) : x.kind === 'job' ? head(x.bot) : x.kind === 'todo' ? head(x.bot || 'you') : `<span class="cf-you sm">${FLAG}</span>`);
  const titleOf = (x) => (x.kind === 'checkin' ? tr('Day {n} check-in', { n: x.n }) : x.title);
  // The colour of its chip in the month: the bot's, else the project's accent.
  const colorOfItem = (x) => { const id = x.kind === 'event' ? x.by : x.bot; return id && botById(id) ? colorOf(botById(id)) : x.kind === 'checkin' ? '#f5c542' : '#8e7cff'; };
  const short = (day, opts) => new Date(`${day}T12:00:00Z`).toLocaleDateString(I18n.locale, { ...opts, timeZone: 'UTC' });
  // When an item to come is: its time today, "Tomorrow", else its weekday and date.
  function whenOf(x, now) {
    if (x.day === now) return x.time || tr('Today');
    if (x.day === CAL.addDays(now, 1)) return tr('Tomorrow');
    return short(x.day, { weekday: 'short', day: 'numeric' });
  }
  const rowHTML = (x, when) => `<div class="cf-cal-row${x.done ? ' done' : ''}"><span class="cf-cal-when">${esc(when)}</span>${whoOf(x)}<span class="cf-row-text">${esc(titleOf(x))}</span>${x.repeat || (x.runs || 0) > 1 ? REPEAT : ''}</div>`;

  function tileHTML(c) {
    refresh(c);
    const now = CAL.today();
    const days = CAL.byDay(tile.items);
    const week = CAL.week(now).map((d) => `<button type="button" class="cf-cal-day${d === now ? ' today' : ''}${d < now ? ' past' : ''}" data-cf-cal-day="${d}"><span>${esc(short(d, { weekday: 'short' }))}</span><b>${esc(String(Number(d.slice(8))))}</b><i${days.get(d)?.length ? ` style="--c:${esc(colorOfItem(days.get(d)[0]))}"` : ' class="none"'}></i></button>`).join('');
    const next = CAL.next(tile.items, now);
    return `<section class="cf-cal" data-cf-cal tabindex="0" aria-label="${tr('Calendar')}">
      <div class="cf-room-head"><i class="cf-dot"></i>${tr('Calendar')}</div>
      <div class="cf-cal-week">${week}</div>
      ${next.length ? `<div class="cf-cal-next">${next.map((x) => rowHTML(x, whenOf(x, now))).join('')}</div>` : ''}
    </section>`;
  }
  function wire(root) {
    const el = $('[data-cf-cal]', root);
    if (!el) return;
    el.onclick = (e) => { const d = e.target.closest('[data-cf-cal-day]'); month.show(d ? d.dataset.cfCalDay : CAL.today()); };
    el.onkeydown = (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); month.show(CAL.today()); } };
  }

  // ---------- the month ----------
  // The month shown, the day picked, its items, and the event being changed (its id) while its fields are open.
  let open = false;
  const month = { ym: '', day: '', items: [], editing: null };
  month.show = (day) => {
    month.ym = day.slice(0, 7);
    month.day = day;
    month.editing = null;
    month.items = tile.items;
    open = true;
    const m = openModal('<div class="cf-month-box"></div>');
    m.classList.add('cf-cal-modal');
    m.addEventListener('close', () => { open = false; m.classList.remove('cf-cal-modal'); }, { once: true });
    month.draw();
    month.load();
  };
  month.load = async () => {
    const days = CAL.month(month.ym);
    const ym = month.ym;
    try {
      const items = await ask(days[0].day, days.at(-1).day);
      if (open && ym === month.ym) { month.items = items; month.draw(); }
    } catch (e) { toast(e.message, true); }
  };
  month.draw = () => {
    const box = $('#modal .cf-month-box');
    if (!box) return;
    const now = CAL.today();
    const days = CAL.byDay(month.items);
    const title = new Date(`${month.ym}-01T12:00:00Z`).toLocaleDateString(I18n.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const heads = CAL.week(now).map((d) => `<span class="cf-month-wd">${esc(short(d, { weekday: 'short' }))}</span>`).join('');
    const cells = CAL.month(month.ym).map(({ day, out }) => {
      const on = days.get(day) || [];
      const chips = on.slice(0, CAL.IN_DAY).map((x) => `<span class="cf-month-chip" style="--c:${esc(colorOfItem(x))}">${x.time ? `${esc(x.time)} ` : ''}${esc(titleOf(x))}</span>`).join('');
      const more = on.length > CAL.IN_DAY ? `<span class="cf-month-more">+${on.length - CAL.IN_DAY}</span>` : '';
      return `<button type="button" class="cf-month-cell${out ? ' out' : ''}${day === now ? ' today' : ''}${day === month.day ? ' sel' : ''}" data-cf-month-day="${day}"><b>${Number(day.slice(8))}</b>${chips}${more}${on.length ? `<i style="--c:${esc(colorOfItem(on[0]))}"></i>` : ''}</button>`;
    }).join('');
    const picked = days.get(month.day) || [];
    const editing = month.editing && picked.find((x) => x.kind === 'event' && x.id === month.editing);
    const rows = picked.map((x) => (CAL.editable(x)
      ? `<div class="cf-cal-row ev${month.editing === x.id ? ' sel' : ''}"><span class="cf-cal-when">${esc(x.time || '')}</span>${whoOf(x)}<button type="button" class="cf-row-text cf-cal-edit" data-cf-ev="${esc(x.id)}">${esc(x.title)}</button><button type="button" class="icon-btn cf-del" data-cf-ev-del="${esc(x.id)}" aria-label="${tr('Delete')}">${X}</button></div>`
      : rowHTML(x, x.time || ''))).join('');
    const form = `<form class="co-ask small cf-add cf-cal-add" id="cf-cal-add">${you}<input name="title" autocomplete="off" maxlength="200" placeholder="${tr('Add an event')}" aria-label="${tr('Add an event')}" value="${esc(editing ? editing.title : '')}" />
      ${editing ? `<input type="date" name="day" value="${esc(editing.day)}" aria-label="${tr('Day')}" />` : ''}<input type="time" name="time" value="${esc(editing?.time || '')}" aria-label="${tr('Time')}" />
      <button type="submit" class="co-go">${editing ? tr('Save') : tr('Add')}</button></form>`;
    box.innerHTML = `<div class="modal-head cf-month-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-cf-month="-1" aria-label="${tr('Previous month')}">${PREV}</button><button type="button" class="icon-btn" data-cf-month="1" aria-label="${tr('Next month')}">${NEXT}</button><span class="grow"></span><button type="button" class="icon-btn" data-dismiss aria-label="${tr('Close')}">${X}</button></div>
      <div class="cf-month">
        <div class="cf-month-grid">${heads}${cells}</div>
        <aside class="cf-month-day"><h3>${esc(short(month.day, { weekday: 'short', month: 'short', day: 'numeric' }))}</h3><div class="cf-cal-list">${rows}</div>${form}</aside>
      </div>`;
    month.wire(box);
  };
  month.wire = (box) => {
    $('[data-dismiss]', box).onclick = () => $('#modal').close();
    $$('[data-cf-month]', box).forEach((b) => (b.onclick = () => {
      month.ym = CAL.shift(month.ym, Number(b.dataset.cfMonth));
      month.day = month.ym === CAL.today().slice(0, 7) ? CAL.today() : `${month.ym}-01`;
      month.editing = null;
      month.draw();
      month.load();
    }));
    $$('[data-cf-month-day]', box).forEach((b) => (b.onclick = () => {
      month.day = b.dataset.cfMonthDay;
      month.editing = null;
      if (month.day.slice(0, 7) !== month.ym) { month.ym = month.day.slice(0, 7); month.load(); }
      month.draw();
    }));
    $$('[data-cf-ev]', box).forEach((b) => (b.onclick = () => { month.editing = month.editing === b.dataset.cfEv ? null : b.dataset.cfEv; month.draw(); $('#cf-cal-add input[name=title]')?.focus(); }));
    $$('[data-cf-ev-del]', box).forEach((b) => (b.onclick = () => change(`/company/events/${encodeURIComponent(b.dataset.cfEvDel)}`, 'DELETE')));
    const form = $('#cf-cal-add', box);
    form.title.onkeydown = (e) => { if (e.key === 'Escape' && month.editing) { e.preventDefault(); month.editing = null; month.draw(); } };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const title = form.title.value.trim();
      if (!title) return;
      const button = form.querySelector('.co-go');
      if (button.disabled) return;
      button.disabled = true;
      const time = form.time.value || '';
      const ok = month.editing
        ? await change(`/company/events/${encodeURIComponent(month.editing)}`, 'PUT', { title, day: form.day?.value || month.day, time })
        : await change('/company/events', 'POST', { title, day: month.day, ...(time ? { time } : {}) });
      if (ok) { month.editing = null; month.draw(); }
      button.disabled = false;
    };
  };
  // A change to the calendar: the answer is the project; the tile and the month ask again.
  async function change(path, method, body) {
    try {
      Company.changed({ company: await api(path, { method, body }) });
      await month.load();
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }

  Company.calendar = { tile: tileHTML, wire, sig: () => tile.key };
})();
