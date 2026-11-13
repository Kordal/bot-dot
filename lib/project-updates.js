// One recorded project update in its primary conversation (ADR 240).
const { tr } = require('./i18n');
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
  if (!c || c.archived || c.phase !== 'running' || quiet(at)) return null;
  const end = at.getTime();
  const floor = Math.max(Date.parse(c.updateThrough || c.updatesFrom || c.startedAt || c.createdAt) || 0, end - 7 * DAY);
  const found = [];
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
  const t = (s, vars) => tr(language, s, vars);
  const recent = (at) => at && (!since || at > since);
  const section = (name, lines, empty) => [t(name), ...(lines.length ? lines.slice(0, 8).map((x) => `• ${words(x)}`) : [t(empty)])].join('\n');
  const done = (c.todos || []).filter((x) => x.done && recent(x.doneAt)).sort((a, b) => b.doneAt.localeCompare(a.doneAt)).map((x) => x.text);
  const work = snapshot.work.map((x) => `${x.name ? `${x.name}: ` : ''}${x.text || t('Working')}`);
  const blocked = snapshot.blockers.filter((x) => x.state !== 'asks').map((x) => `${x.name}: ${x.text}`);
  const needs = [...cards, ...snapshot.blockers.filter((x) => x.state === 'asks').map((x) => `${x.name}: ${x.text}`)];
  const decisions = (c.decisions || []).filter((x) => recent(x.at)).sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.text);
  const replies = snapshot.replies.filter((x) => recent(x.at)).map((x) => `${x.name}: ${x.text}`);
  const reportLines = c.teams.map((team) => team.lastReport && recent(team.lastReport.at)
    ? `${team.name}: ${words(team.lastReport.text)}` : t('No new recorded team report: {team}.', { team: team.name }));
  return [
    t('Project update: {name}', { name: words(c.name || c.start, 80) }),
    section('Marked done', done, 'No newly completed items recorded.'),
    section('Current work', work, 'No current work recorded.'),
    section('Blockers', blocked, 'No current failure recorded.'),
    section('Needs you', needs, 'Nothing currently asks for your answer or approval.'),
    section('Decisions', decisions, 'No new decisions recorded.'),
    section('Latest replies and reports', [...replies, ...reportLines], 'No new replies or reports recorded.'),
    t('This update uses recorded activity. It starts no work and answers or approves nothing.'),
  ].join('\n\n');
}
function view(c, { timeZone, language } = {}) {
  const schedulesText = schedules(c, timeZone).map((s) => {
    const [h, m] = s.time.split(':').map(Number);
    const cron = `${m} ${h} * * ${s.days.length === 7 ? '*' : s.days.join(',')}`;
    return `${require('./cron-words').describe(cron, language)} (${s.timeZone})`;
  });
  return { ...setting(c), schedules: [...new Set(schedulesText)] };
}
module.exports = { EVERY, setting, schedules, due, text, view };
