// A bot's pages (#346, ADR 065; docs/api.md, "Pages"): /api/bots/<id>/pages…, the owner's alone. The list, one page
// (with ?view=1 or ?stat=1 as the document viewer reads a file, plus `page`; else its Markdown downloads), and the
// job that keeps it up to date: POST …/keep makes it or changes it, DELETE …/keep removes it. The owner's tap is
// the consent, so the job is the owner's and approved at once, with no card (lib/jobs.js autoApproved).
const path = require('path');
const { send, readBody } = require('./http');
const B = require('../bots');
const fileView = require('../file-view');
const pagesLib = require('../pages');
const feed = require('../events');
const { download, viewAsked, refusal } = require('./files');

async function pagesRoute(req, res, url, { parts, m, by, bot, changeJob }) {
  if (by !== 'you') return send(res, 403, { error: "Only the owner opens a bot's pages." });
  const ws = path.join(B.WORKSPACES_DIR, bot.id);
  const jobs = () => B.bots.get(bot.id)?.jobs || [];
  const slug = parts[3] || '';
  // A change of what keeps a page up to date is told on the live feed as a save is, so that every app redraws it.
  const told = (status, body) => {
    feed.emit('page', { botId: bot.id, slug: body.page.slug, title: body.page.title, updatedAt: body.page.updatedAt });
    return send(res, status, body);
  };
  try {
    if (!slug && m === 'GET') return send(res, 200, { pages: B.pages.list(bot.id, ws, jobs()) });
    if (slug && !parts[4] && m === 'GET') {
      const { page, file } = B.pages.find(bot.id, ws, slug, jobs());
      const name = `${page.slug}.md`;
      if (!viewAsked(url)) return download(res, file, name, 'no-store');
      return send(res, 200, { ...(await fileView.viewFile(file, name, { text: !url.searchParams.has('stat') })), page });
    }
    if (slug && parts[4] === 'keep' && !parts[5]) {
      const { page } = B.pages.find(bot.id, ws, slug, jobs());
      const had = B.pages.keepJobOf(bot.id, page.slug);
      const kept = had && jobs().find((j) => j.id === had);
      if (m === 'DELETE') {
        if (kept) changeJob(B.bots.get(bot.id), 'remove', { id: kept.id }, { by: 'you' });
        B.pages.setKeep(bot.id, page.slug, null);
        return told(200, { page: B.pages.find(bot.id, ws, page.slug, jobs()).page });
      }
      if (m === 'POST') {
        const body = (await readBody(req)) || {};
        const cron = pagesLib.cronOf(body.every, body.time);
        const notify = body.notify === 'always' ? 'always' : 'report-only';
        const check = String(body.check ?? page.sources ?? '');
        const job = { name: `Keep "${page.title}" up to date`.slice(0, 60), kind: 'ai', cron, notify, prompt: pagesLib.keepPrompt(page, { check, notify }), assessment: 'Needs AI: it reads the sources again and rewrites the page.', enabled: true };
        const made = kept ? changeJob(B.bots.get(bot.id), 'update', { ...job, id: kept.id }, { by: 'you' }).job : changeJob(B.bots.get(bot.id), 'add', job, { by: 'you' }).job;
        B.pages.setKeep(bot.id, page.slug, made.id, check);
        return told(kept ? 200 : 201, { page: B.pages.find(bot.id, ws, page.slug, jobs()).page, job: made });
      }
    }
  } catch (e) {
    if (e.status) return refusal(res, e);
    throw e;
  }
  return send(res, 405, { error: 'Not here' });
}

module.exports = { pagesRoute };
