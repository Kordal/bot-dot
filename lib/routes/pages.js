// A bot's pages (#346, ADR 065; docs/api.md, "Pages"): /api/bots/<id>/pages…, the owner's alone. The list, one page
// (with ?view=1 or ?stat=1 as the document viewer reads a file, plus `page`; else its Markdown downloads), and the
// job that keeps it up to date: POST …/keep makes it or changes it, DELETE …/keep removes it. The owner's tap is
// the consent, so the job is the owner's and approved at once, with no card (lib/jobs.js autoApproved).
const path = require('path');
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const fileView = require('../file-view');
const pagesLib = require('../pages');
const feed = require('../events');
const { download, viewAsked, refusal } = require('./files');
const chief = require('../chief');

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

// The Chief's pages (#384, ADR 069; docs/api.md, "The Chief's pages"), at a bot's page routes with the id `chief`, so
// that an app that opens a bot's pages opens the Chief's: the list, one page, and what keeps one up to date. The Chief
// has no jobs: its keeping schedule is kept with the page, and "Refresh now" (…/jobs/page-<slug>/run, as for a bot's
// job) starts the Chief's run that keeps it. The owner's alone, as a bot's pages are.
async function chiefPagesRoute(req, res, url, { parts, m, by }) {
  if (by !== 'you') return send(res, 403, { error: "Only the owner opens the Chief's pages." });
  const slug = parts[3] || '';
  const told = (status, page) => {
    feed.emit('page', { botId: chief.PAGES_OF, slug: page.slug, title: page.title, updatedAt: page.updatedAt });
    return send(res, status, { page });
  };
  try {
    if (parts[2] === 'jobs' && parts[3] && parts[4] === 'run' && !parts[5] && m === 'POST') {
      const job = B.pages.ownJobs(chief.PAGES_OF).find((j) => j.id === parts[3]);
      if (!job) return send(res, 404, { error: 'That page is not kept up to date.' });
      // Answered at once: the run takes minutes, and its page is told on the live feed when it is saved.
      chief.findPage(job.slug); // a page whose file is gone is refused here
      if (chief.keepBusy()) return send(res, 409, { error: 'The Chief is busy with another page or a look. Try again in a minute.' });
      chief.keepPage(job.slug).catch((e) => console.error(`[chief pages] ${job.slug}: ${e.message}`));
      return send(res, 202, { ok: true });
    }
    if (parts[2] !== 'pages') return send(res, 404, { error: 'Bot not found' });
    if (!slug && m === 'GET') return send(res, 200, { pages: chief.listPages() });
    if (slug && !parts[4] && m === 'GET') {
      const { page, file } = chief.findPage(slug);
      const name = `${page.slug}.md`;
      if (!viewAsked(url)) return download(res, file, name, 'no-store');
      return send(res, 200, { ...(await fileView.viewFile(file, name, { text: !url.searchParams.has('stat') })), page });
    }
    if (slug && parts[4] === 'keep' && !parts[5]) {
      const { page } = chief.findPage(slug);
      if (m === 'DELETE') {
        B.pages.setOwnKeep(chief.PAGES_OF, page.slug, null);
        return told(200, chief.findPage(page.slug).page);
      }
      if (m === 'POST') {
        const body = (await readBody(req)) || {};
        const had = !!page.keep;
        const cron = pagesLib.cronOf(body.every, body.time);
        B.pages.setOwnKeep(chief.PAGES_OF, page.slug, { cron, notify: body.notify }, String(body.check ?? page.sources ?? ''));
        return told(had ? 200 : 201, chief.findPage(page.slug).page);
      }
    }
  } catch (e) {
    if (e.status) return refusal(res, e);
    throw e;
  }
  return send(res, 405, { error: 'Not here' });
}

// Every page of the account's bots in one list (#361; docs/api.md, "Pages"): GET /api/pages, newest first, each with
// its bot's id and name, and the Chief's pages with the id `chief` (#384). The apps split it into the pages kept up to
// date and the others.
function allPages() {
  const bots = B.bots.list().flatMap((b) => B.pages.list(b.id, path.join(B.WORKSPACES_DIR, b.id), b.jobs || []).map((p) => ({ botId: b.id, bot: b.name, ...p })));
  const own = chief.listPages().map((p) => ({ botId: chief.PAGES_OF, bot: B.settings.chiefName(), ...p }));
  return [...bots, ...own].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.botId.localeCompare(b.botId) || a.slug.localeCompare(b.slug));
}

function create() {
  return async function routes(req, res, url, { parts, m, by, chiefChat }) {
    // save_page of the Chief's turns and of its keeping run (lib/mcp-server.js).
    if (parts[0] === 'chief' && parts[1] === 'pages' && !parts[2]) {
      if (m !== 'POST') return send(res, 405, { error: 'Not here' });
      if (by !== 'chief') return send(res, 403, { error: 'Only the Chief saves its pages.' });
      const body = (await readBody(req)) || {};
      try {
        return send(res, 200, { ok: true, ...chief.savePage({ title: body.title, markdown: body.markdown, page: body.page, sources: body.sources }, chiefChat) });
      } catch (e) {
        if (e.status) return refusal(res, e);
        throw e;
      }
    }
    if (parts[0] === 'bots' && parts[1] === chief.PAGES_OF && (parts[2] === 'pages' || parts[2] === 'jobs')) return chiefPagesRoute(req, res, url, { parts, m, by });
    if (parts[0] !== 'pages' || parts[1]) return NEXT;
    if (m !== 'GET') return send(res, 405, { error: 'Not here' });
    if (by !== 'you') return send(res, 403, { error: "Only the owner opens the bots' pages." });
    return send(res, 200, { pages: allPages() });
  };
}

module.exports = { pagesRoute, chiefPagesRoute, create, allPages };
