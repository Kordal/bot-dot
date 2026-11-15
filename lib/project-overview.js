// A read-only project snapshot (ADR 236): recorded bot activity, never an inferred progress score.
const { membersOf } = require('./company');
const text = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 600);
// An entry's Markdown as the bot wrote it, with its lines, so the apps draw it as the chat does: at most 600
// characters and an ending …, cut at a space and never inside a [link](address), a code block, a `code` or a **bold**.
function snippet(s) {
  let t = String(s || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= 600) return t;
  t = t.slice(0, 600);
  const space = t.search(/\s\S*$/);
  if (space > 0) t = t.slice(0, space);
  const link = t.search(/\[[^\]\n]*(?:\]\([^)\s]*)?$/);
  if (link >= 0) t = t.slice(0, link);
  const fences = [...t.matchAll(/^\s*```/gm)];
  if (fences.length % 2) t = t.slice(0, fences.at(-1).index);
  // A mark left open would show as text: the cut goes before it.
  for (const mark of [/`/g, /\*\*/g]) {
    const outside = t.replace(/^\s*```.*$/gm, (f) => ' '.repeat(f.length));
    const found = [...outside.matchAll(mark)];
    if (found.length % 2) t = t.slice(0, found.at(-1).index);
  }
  return `${t.trimEnd()}…`;
}
const replyText = (r) => snippet(r.result || r.text) || text((r.files || []).map((f) => f.name || f.file || '').filter(Boolean).join(', '));
const time = (x) => x.endedAt || x.startedAt || x.at || '';
const newest = (a, b) => time(b).localeCompare(time(a));

function overview(c, { bots = [], runs = [], groups = [], asks = new Map(), line = () => '', chief = null, now = new Date().toISOString() } = {}) {
  const ids = new Set([...membersOf(c), ...(c.lead ? [c.lead] : [])]);
  const teamIds = new Set((c.teams || []).map((t) => t.id));
  const chats = new Set(groups.filter((g) => teamIds.has(g.team)).map((g) => g.id));
  const names = new Map(bots.map((b) => [b.id, b.name]));
  const relevant = [...new Map(runs.map((r) => [r.id, r])).values()].filter((r) => ids.has(r.botId) && names.has(r.botId) && !r.passed && r.kind !== 'project-update' && (!r.groupId || chats.has(r.groupId))).sort(newest);
  const entry = (r, state, value) => ({ id: r.id, botId: r.botId, ...(r.groupId ? { groupId: r.groupId } : {}), name: names.get(r.botId), state, text: snippet(value), at: time(r) });
  const work = relevant.filter((r) => r.status === 'running').map((r) => entry(r, 'working', line(r.id)));
  const blockers = [];
  const seen = new Set();
  for (const r of relevant) {
    // A historical failure is not a current blocker after newer work by that bot.
    if (seen.has(r.botId)) continue;
    seen.add(r.botId);
    if (['error', 'failed', 'timeout', 'interrupted'].includes(r.status)) blockers.push(entry(r, 'failed', r.problem || r.error || r.jobName || r.prompt));
  }
  for (const [id, q] of asks) if (ids.has(id) && names.has(id)) blockers.push({ id: q.runId, botId: id, name: names.get(id), state: 'asks', text: snippet(q.text), at: q.at });
  for (const g of groups) if (chats.has(g.id) && g.asks) blockers.push({ id: g.asks.runId, groupId: g.id, botId: g.asks.botId, name: g.asks.botName || g.name || '', state: 'asks', text: snippet(g.asks.text), at: g.asks.at });
  const replies = relevant.filter((r) => r.status === 'success' && !r.error && r.notificationAudience !== 'internal' && !['quiet', 'held'].includes(r.reporting) && replyText(r)).map((r) => entry(r, 'reply', replyText(r)));
  for (const todo of c.todos || []) if (!todo.done) work.push({ id: todo.id, ...(todo.bot ? { botId: todo.bot } : {}), name: names.get(todo.bot) || '', state: 'planned', text: snippet(todo.text), at: todo.due || todo.at || '' });
  if (chief?.chatId) {
    const base = { chatId: chief.chatId, name: chief.name, state: 'reply' };
    const messages = (chief.messages || []).filter((m) => m.role === 'chief' && !m.projectUpdate);
    const last = (chief.messages || []).filter((m) => !m.projectUpdate).at(-1);
    if (chief.busy) work.unshift({ ...base, id: 'chief', state: 'working', text: snippet(chief.line), at: now });
    else if (last?.role === 'chief' && !last.pending && (last.questions?.length || last.choices?.length)) blockers.unshift({ ...base, id: 'chief', state: 'asks', text: snippet(require('./choices').line(last)), at: time(last) });
    else if (last?.role === 'chief' && last.error) blockers.unshift({ ...base, id: 'chief', state: 'failed', text: snippet(last.error === true ? last.text : last.error), at: time(last) });
    messages.forEach((m, i) => { if (!m.pending && !m.error && !m.notice && replyText(m)) replies.push({ ...base, id: `chief-${i}`, text: replyText(m), at: time(m) }); });
  }
  return { projectId: c.id, at: now, goal: text(c.goal), work: work.slice(0, 20), blockers: blockers.slice(0, 20), replies: replies.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5) };
}
module.exports = { overview };
