// The changelog of botdot.app: the notes of the repository's whats-new/ (English), read by the server's own reader
// (lib/whats-new.js) when the site is built: the pages are prerendered and run no code in the browser (ADR 173).
import path from 'node:path';
import { createRequire } from 'node:module';

// The build runs in site/, so the repository is one folder up.
const REPO = path.resolve(process.cwd(), '..');
const whatsNew = createRequire(import.meta.url)(path.join(REPO, 'lib', 'whats-new.js'));

/** The notes newest first, by day: [{ date, notes: [{ id, title, points }] }]. */
export function days(dir = path.join(REPO, 'whats-new')) {
  const byDay = new Map();
  for (const n of whatsNew.read(dir).filter((x) => !x.error).reverse()) {
    const date = n.id.slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push({ id: n.id, title: n.title, points: n.points });
  }
  return [...byDay].map(([date, notes]) => ({ date, notes }));
}

export const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The same notes as Markdown, for agents (llms.txt links it). */
export function markdown(list = days()) {
  return ['# botdot changelog', '', 'What changed in botdot, newest first. Source: https://github.com/Kordal/bot-dot/tree/main/whats-new', '',
    ...list.flatMap(({ date, notes }) => [`## ${date}`, '', ...notes.flatMap((n) => [`### ${n.title}`, '', ...n.points.map((p) => `- ${p}`), ''])]),
  ].join('\n');
}
