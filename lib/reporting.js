// Scheduled AI output (and a called job's, likeScheduled) is private unless the run explicitly reports it, or its job is a one-time one.
// A scheduled job's failure is said once per row of failures, and held at night.
const { holds } = require('./choices');

// Whether a run started this way behaves like a scheduled run of its job: it reaches the owner by its job's
// notify, its report is held at night, and its failure counts in the job's row of failures. The one place that
// answers it: every check of notifying, night holds and the row asks here. A job's run when called (ADR 026) is one.
const likeScheduled = (trigger) => trigger === 'schedule' || trigger === 'call';

const DEFAULT_QUIET_HOURS = { start: 22, end: 7 };
function quietHours(input = {}) {
  const value = { ...DEFAULT_QUIET_HOURS, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...input };
  for (const k of ['start', 'end']) if (!Number.isInteger(value[k]) || value[k] < 0 || value[k] > 23) throw new Error(`quietHours.${k} must be an hour from 0 to 23`);
  new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format();
  return value;
}
function inQuietHours(now, config) {
  const q = quietHours(config);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: q.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return q.start > q.end ? hour >= q.start || hour < q.end : hour >= q.start && hour < q.end;
}
// Whole-message matching: never hide real news because one sentence says "no updates".
// This covers common phrases; the explicit-report gate works independently of language.
function noNews(text) {
  const t = String(text || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return !t || /^(nothing new|no (changes|updates|news)|all quiet|nothing to report|no news to report|nic nowego|bez zmian|brak (zmian|aktualizacji|nowości)|rien de nouveau|aucun changement|pas de nouvelles|nichts neues|keine (änderungen|neuigkeiten)|nada nuevo|sin novedades|nessuna novità|niente di nuovo|geen nieuws|geen wijzigingen|niets nieuws|sem novidades|ничего нового|нет изменений|没有更新|暂无更新|変化なし|更新なし)$/.test(t);
}
// A failed scheduled run of a repeating job that counts in the job's row: its failed scheduled runs one after
// another (docs/api.md, "A job's line"). Not a one-time job's, which is told once, and not a run that a sign-out
// of Claude ended: that run was going, and the sign-out is said once by itself.
const rowFailure = (meta) => likeScheduled(meta.trigger) && meta.status === 'error' && !!meta.jobId && !meta.oneTime && meta.endedBy !== 'signout';
// row: the job's row before this run ({ failures, since }), or null.
function finishReport(meta, now, config, row = null) {
  // A repeating job's failure is said once and not at night: after the first of its row it is quiet, and the first
  // is held in quiet hours, as a report is. "Run now" and the owner's own message are told at once, as before.
  if (likeScheduled(meta.trigger) && meta.status === 'error' && meta.jobId && !meta.oneTime) {
    if (meta.endedBy === 'signout' || row?.failures) meta.reporting = 'quiet';
    else if (inQuietHours(now, config)) meta.reporting = 'held';
    return;
  }
  if (!likeScheduled(meta.trigger) || meta.status !== 'success' || !meta.notify) return;
  meta.rawResult = meta.result;
  const report = meta.ownerReport;
  // A one-time job: the owner asked for it once, at a time they chose. Its final reply is delivered as it is:
  // not quiet, not taken for "nothing new", not held by quiet hours. A report it sent goes the usual way below.
  if (meta.oneTime && !report) { meta.reporting = 'delivered'; return; }
  // A reply that holds a question for the owner ([[choices: …]], [[ask: …]]: choices.js) is never private, whatever
  // the job's report setting, and is not taken for "nothing new": it is delivered as a reply, the report it sent
  // above it, and held through quiet hours as a report is.
  if (holds(meta)) {
    const said = report && !noNews(report.message) ? report.message.trim() : '';
    const reply = String(meta.result ?? '').trim();
    meta.result = [said, reply === said ? '' : reply].filter(Boolean).join('\n\n');
    meta.reporting = report?.urgent || !inQuietHours(now, config) ? 'delivered' : 'held';
    return;
  }
  const message = report ? report.message : meta.notify === 'always' ? meta.result : '';
  if (!report && meta.notify !== 'always') meta.reporting = 'quiet';
  else if (noNews(message)) meta.reporting = 'suppressed';
  else meta.reporting = report?.urgent || !inQuietHours(now, config) ? 'delivered' : 'held';
  meta.result = ['held', 'delivered'].includes(meta.reporting) ? message : '';
}
module.exports = { DEFAULT_QUIET_HOURS, quietHours, inQuietHours, noNews, finishReport, rowFailure, likeScheduled };
