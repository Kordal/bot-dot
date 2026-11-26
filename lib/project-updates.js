// One recorded project update in its primary conversation (ADR 240).
const { tr, trn } = require('./i18n');
const { snippet } = require('./project-overview');
const EVERY = ['existing', 'off', 'daily', 'twice-weekly', 'weekly'];
const setting = (c) => ({ every: EVERY.includes(c?.updates?.every) ? c.updates.every : 'existing' });
const DAY = 864e5;
const days = { daily: [0, 1, 2, 3, 4, 5, 6], 'twice-weekly': [2, 5], weekly: [5] };
const words = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function schedules(c, timeZone) {
  const every = setting(c).every;
  if (every === 'off') return [];
  if (every !== 'existing') return [{ days: days[every], time: '09:00', timeZone, from: c.updatesFrom }];
  const old = [];
  if (c.standup.on && c.teams.length) old.push({ days: [1, 2, 3, 4, 5], time: c.standup.time, timeZone, standup: true });
  for (const t of c.teams) if (days[t.report]) old.push({ days: days[t.report], time: '17:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, from: t.reportFrom });
  return old;
}
// Convert one local wall-clock time. A skipped DST time is due after the jump; a repeated time has one key.
function localTime(day, time, timeZone) {
  const target = Date.parse(`${day}T${time}:00Z`);
  let value = target;
  let later = value;
  for (let i = 0; i < 4; i++) {
    const local = require('./company').localDay(new Date(value), timeZone);
    const wall = Date.parse(`${local.day}T00:00:00Z`) + local.minute * 60_000;
    const next = value + target - wall;
    if (next === value) return value;
    later = Math.max(value, next);
    value = next;
  }
  return later;
}
// One latest overdue slot, never a backlog of messages. Preserve the union of old opted-in schedules.
function due(c, at, { timeZone, quiet = () => false } = {}) {
  if (!c || c.archived || c.phase !== 'running' || setting(c).every === 'off' || quiet(at)) return null;
  const end = at.getTime();
  const floor = Math.max(Date.parse(c.updateThrough || c.updatesFrom || c.startedAt || c.createdAt) || 0, end - 7 * DAY);
  const found = [];
  const pending = Date.parse(c.updatePendingAt);
  if (pending > floor && pending <= end) found.push(pending);
  for (const s of schedules(c, timeZone)) for (let back = 0; back < 8; back++) {
    const d = require('./company').localDay(new Date(end - back * DAY), s.timeZone);
    if (!s.days.includes(d.weekday)) continue;
    if (s.standup && c.standups.some((x) => x.day === d.day && x.merged)) continue;
    const stamp = localTime(d.day, s.time, s.timeZone);
    if (stamp <= floor || stamp > end || stamp <= (Date.parse(s.from) || 0)) continue;
    found.push(stamp);
  }
  const latest = found.length ? Math.max(...found) : null;
  return latest == null ? null : { key: `scheduled:${new Date(latest).toISOString()}`, through: at.toISOString() };
}

// A receipt is a plain record, never model text or an instruction to start another turn.
function text(c, snapshot, { cards = [], since, language = 'en' } = {}) {
  const recent = (at) => at && (!since || at > since);
  const section = (name, lines, empty) => [name, ...(lines.length ? lines.slice(0, 8).map((x) => `• ${words(x)}`) : [empty])].join('\n');
  const done = (c.todos || []).filter((x) => x.done && recent(x.doneAt)).sort((a, b) => b.doneAt.localeCompare(a.doneAt)).map((x) => x.text);
  const work = snapshot.work.map((x) => `${x.name ? `${x.name}: ` : ''}${x.text || tr(language, 'Working')}`);
  const sourceFailures = c.objectives.filter((o) => o.source?.failed).map((o) => `${o.name}: ${o.source.failed}`);
  const goals = c.objectives.map((o) => {
    const progress = o.steps?.length ? tr(language, '{done} of {total} steps marked done', { done: o.steps.filter((s) => s.done).length, total: o.steps.length })
      : o.target > 0 || o.source ? `${o.current}${o.target ? ` / ${o.target}` : ''}`
        : o.done ? tr(language, 'Done') : tr(language, 'Not marked done');
    return `${o.name}: ${progress}`;
  });
  const blocked = [...sourceFailures, ...snapshot.blockers.filter((x) => x.state !== 'asks').map((x) => `${x.name}: ${x.text}`)];
  const needs = [...cards, ...snapshot.blockers.filter((x) => x.state === 'asks').map((x) => `${x.name}: ${x.text}`)];
  const decisions = (c.decisions || []).filter((x) => recent(x.at)).sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.text);
  const replies = snapshot.replies.filter((x) => recent(x.at)).map((x) => `${x.name}: ${x.text}`);
  const reportLines = c.teams.map((team) => team.lastReport?.unavailable ? tr(language, 'Saved report unavailable for this update: {team}.', { team: team.name }) : team.lastReport && recent(team.lastReport.at)
    ? `${team.name}: ${words(team.lastReport.text)}` : tr(language, 'No new recorded team report: {team}.', { team: team.name }));
  return [
    tr(language, 'Project update: {name}', { name: words(c.name || c.start, 80) }),
    section(tr(language, 'Marked done'), done, tr(language, 'No newly completed items recorded.')),
    section(tr(language, 'Goal progress'), goals, tr(language, 'No goal figures recorded.')),
    section(tr(language, 'Current work'), work, tr(language, 'No current work recorded.')),
    section(tr(language, 'Blockers'), blocked, tr(language, 'No current failure recorded.')),
    section(tr(language, 'Needs you'), needs, tr(language, 'Nothing currently asks for your answer or approval.')),
    section(tr(language, 'Decisions'), decisions, tr(language, 'No new decisions recorded.')),
    section(tr(language, 'Latest replies and reports'), [...replies, ...reportLines], tr(language, 'No new replies or reports recorded.')),
    tr(language, 'This update uses recorded activity. It starts no work and answers or approves nothing.'),
  ].join('\n\n');
}
// The same update as data, for the apps that draw it as a card of the block kit (#1755): what the text says, in
// the order the card shows it, with the ids its rows link by (a bot, its chat, a card). Item texts stay the
// Markdown their author wrote; the apps draw them as they draw a reply's preview, never as markup (ADR 004). The
// words the card is made of (the pills, the figure of a goal) come in the owner's language, so every app says the same.
// notes: [string], the teams whose report is missing or unavailable, worded as `text` words them.
// needs: [{ botId, name, text, cardId? }], the cards that wait in Needs you (bots.cardItemsOfBots).
const CAP = 20;
const keep = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
function card(c, snapshot, { needs = [], since, language = 'en' } = {}) {
  const recent = (at) => at && (!since || at > since);
  const done = (c.todos || []).filter((x) => x.done && recent(x.doneAt)).sort((a, b) => b.doneAt.localeCompare(a.doneAt)).slice(0, CAP).map((x) => ({ id: x.id, text: x.text }));
  const asks = snapshot.blockers.filter((x) => x.state === 'asks');
  const link = (x) => keep({ botId: x.botId, groupId: x.groupId, chatId: x.chatId, runId: x.chatId || x.state === 'planned' ? undefined : x.id });
  const needList = [
    ...needs.slice(0, CAP).map((x) => keep({ botId: x.botId, name: x.name, text: x.text, cardId: x.cardId })),
    ...asks.map((x) => keep({ ...link(x), name: x.name, text: x.text })),
  ].slice(0, CAP);
  const blockers = [
    ...c.objectives.filter((o) => o.source?.failed).map((o) => ({ name: o.name, text: String(o.source.failed) })),
    ...snapshot.blockers.filter((x) => x.state !== 'asks').map((x) => keep({ ...link(x), name: x.name, text: x.text })),
  ].slice(0, CAP);
  const asking = new Set(asks.map((x) => x.botId).filter(Boolean));
  const work = snapshot.work.slice(0, CAP).map((x) => keep({ ...link(x), name: x.name, text: x.text, state: x.state === 'planned' ? 'planned' : asking.has(x.botId) ? 'asks' : 'working' }));
  const goals = c.objectives.flatMap((o) => {
    if (o.steps?.length) { const n = o.steps.filter((s) => s.done).length; return [{ id: o.id, name: o.name, value: String(n), of: tr(language, 'of {total} steps', { total: o.steps.length }), ratio: n / o.steps.length, level: 'ok' }]; }
    if (o.target > 0 || o.source) return [keep({ id: o.id, name: o.name, value: String(o.current), of: o.target ? `/ ${o.target}` : '', ratio: o.target > 0 ? Math.min(1, Math.max(0, o.current / o.target)) : undefined, level: o.target > 0 && o.current > o.target ? 'warn' : 'ok' })];
    return o.done ? [{ id: o.id, name: o.name, value: tr(language, 'Done'), of: '', ratio: 1, level: 'ok' }] : [];
  });
  const decisions = (c.decisions || []).filter((x) => recent(x.at)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, CAP).map((x) => ({ id: x.id, text: x.text }));
  const reports = c.teams.filter((t) => t.lastReport?.text && recent(t.lastReport.at)).map((t) => keep({ botId: t.lastReport.bot, runId: t.lastReport.runId, name: t.name, text: snippet(t.lastReport.text), at: t.lastReport.at }));
  const replies = [...snapshot.replies.filter((x) => recent(x.at)).map((x) => keep({ ...link(x), name: x.name, text: x.text, at: x.at })), ...reports].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const pills = [
    needList.length ? { level: 'warn', text: trn(language, needList.length, '{n} needs you', '{n} need you') } : { level: 'ok', text: tr(language, 'Nothing needs you') },
    blockers.length ? { level: 'err', text: trn(language, blockers.length, '{n} blocker', '{n} blockers') } : { level: 'ok', text: tr(language, 'No blockers') },
    ...(done.length ? [{ level: 'ok', text: tr(language, '{n} done', { n: done.length }) }] : []),
    ...(work.length ? [{ level: 'info', text: tr(language, '{n} in progress', { n: work.length }) }] : []),
  ];
  const empty = [[done, tr(language, 'nothing marked done')], [goals, tr(language, 'no goal figures')], [decisions, tr(language, 'no new decisions')], [work, tr(language, 'nothing in progress')], [replies, tr(language, 'no new replies or reports')]].filter(([list]) => !list.length).map(([, said]) => said);
  // A team whose report is missing or unavailable is named, as `text` names it: that is a reason to ask, not a quiet section.
  const notes = c.teams.flatMap((t) => (t.lastReport?.unavailable ? [tr(language, 'Saved report unavailable for this update: {team}.', { team: t.name })]
    : t.lastReport?.text && recent(t.lastReport.at) ? [] : [tr(language, 'No new recorded team report: {team}.', { team: t.name })])).slice(0, CAP);
  const quiet = empty.length ? `${empty.join(', ').replace(/^./u, (m) => m.toUpperCase())}.` : undefined;
  return keep({ project: { id: c.id, name: words(c.name || c.start, 80) }, since: since || '', summary: [...pills.filter((p, i) => i !== 1 || blockers.length).map((p) => p.text)].join(', '), pills, needs: needList, blockers, goals, done, work, decisions, replies, quiet, notes: notes.length ? notes : undefined });
}
function view(c, { timeZone, language } = {}) {
  const schedulesText = schedules(c, timeZone).map((s) => {
    const [h, m] = s.time.split(':').map(Number);
    const cron = `${m} ${h} * * ${s.days.length === 7 ? '*' : s.days.join(',')}`;
    return `${require('./cron-words').describe(cron, language)} (${s.timeZone})`;
  });
  return { ...setting(c), schedules: [...new Set(schedulesText)] };
}
module.exports = { EVERY, setting, schedules, due, text, card, view };
