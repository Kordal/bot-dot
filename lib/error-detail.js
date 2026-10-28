// @ts-check
// One line of a failed run's error, cut and redacted, for the admin page (ADR 109): the line that names the problem,
// with every address, path, quoted text, number, id and secret replaced by a placeholder. What is left are the error's
// own words ("Cannot find module", "spawn ENOENT", "exited with code 1"), never what the run read or wrote.
// Both sides run it: the account before the ledger keeps it, the front door again before it keeps an answer.

const MAX = 160;
const PROBLEM = /error|fail|cannot|can't|couldn't|denied|refused|not found|invalid|unable|missing|killed|exit|abort|timed? ?out|ENOENT|EACCES|ECONN|EPIPE/i;

const RULES = [
  [/\b(bearer)\s+\S+/gi, '$1 <secret>'],
  [/\b(authorization|token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|cookie)\b(\s*[:=]\s*)\S+/gi, '$1$2<secret>'],
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>'],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '<email>'],
  // Quoted text goes, but a lowercase name of a thing (a JSON key, error_during_execution, a module) stays.
  [/"[^"\n]*"|'[^'\n]{2,}'|`[^`\n]*`|“[^”\n]*”|‘[^’\n]*’/g, (q) => (/^.[a-z_][a-z0-9_-]{0,39}.$/.test(q) ? q : '"…"')],
  [/(?<![\w<>.~-])(?:~|\.{1,2})?\/[^\s:,;)\]}]+/g, '<path>'],
  [/\b[A-Za-z]:\\[^\s:,;)\]}]+/g, '<path>'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<ip>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'],
  [/[A-Za-z0-9_+/=-]{24,}/g, '<secret>'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<id>'],
  [/\b\d{5,}\b/g, '<n>'],
].map(([re, to]) => /** @type {[RegExp, any]} */ ([re, to]));

/** The text's line that names the problem (else its last), cut to MAX and redacted; null when nothing is left. @param {unknown} text */
function detail(text) {
  if (typeof text !== 'string' || !text) return null;
  // eslint-disable-next-line no-control-regex
  const lines = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map((l) => l.replace(/[\x00-\x1f\x7f]/g, ' ').trim()).filter(Boolean);
  if (!lines.length) return null;
  let line = lines.find((l) => PROBLEM.test(l)) || lines[lines.length - 1];
  // Redacted before it is cut, so a secret cut in half is never left.
  for (const [re, to] of RULES) line = line.replace(re, to);
  line = line.replace(/\s+/g, ' ').trim();
  if (line.length > MAX) line = `${line.slice(0, MAX - 1).trimEnd()}…`;
  return /[A-Za-z]{2}/.test(line.replace(/<\w+>/g, '')) ? line : null;
}

module.exports = { detail, MAX };
