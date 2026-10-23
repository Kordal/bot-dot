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
const { download, downloadHeaders, viewAsked, refusal } = require('./files');
const chief = require('../chief');
const pageBlocks = require('../page-blocks');
const pfs = require('../principal-fs');
const sitesLib = require('../sites');

let board = null; // the Board (lib/dashboard.js), whose tiles a page's blocks read (#395): set by create()

// One page as its routes answer it (#395, lib/page-blocks.js). With ?blocks=1: only its blocks, filled in anew, for
// an open page to redraw them ({ parts, tiles, plain }). With ?view=1: its file as the viewer reads it, with `page`, and when
// it has blocks also `parts` (to draw) and `plain` (its Markdown with the blocks written out as text and tables, for
// a document and its export). Else it downloads; a page with blocks as `plain`. Reading a page reads its stale tiles.
// botId: whose page it is; a tile named by its title is that bot's first, when two tiles share it.
async function pageAnswer(res, url, file, page, botId) {
  const name = `${page.slug}.md`;
  const markdown = () => pfs.readFileSync(file, 'utf8'); // whole: the viewer's text stops at 1,000 lines
  const drawn = (md) => {
    const r = pageBlocks.render(md, board && { tile: (ref) => board.forPage(ref, botId) });
    if (r.tiles.length) board.refresh(r.tiles, { staleOnly: true }).catch(() => {});
    return { ...r, plain: pageBlocks.plainOf(r.parts) };
  };
  if (url.searchParams.has('blocks')) return send(res, 200, drawn(markdown()));
  if (!viewAsked(url)) {
    const md = markdown();
    if (!pageBlocks.hasBlocks(md)) return download(res, file, name, 'no-store');
    const body = Buffer.from(drawn(md).plain);
    res.writeHead(200, downloadHeaders(name, body.length, 'no-store'));
    return res.end(body);
  }
  const view = await fileView.viewFile(file, name, { text: !url.searchParams.has('stat') });
  if (view.text == null || !pageBlocks.hasBlocks(view.text)) return send(res, 200, { ...view, page });
  return send(res, 200, { ...view, page, ...drawn(markdown()) });
}

// An interactive page (#399, ADR 072). With ?view=1: what the viewer shows, `interactive` with the address of its frame
// on the sandbox's own address (signed for a short while, made anew on each opening), its versions and the values of
// the tiles it reads; `kind` "none", so that an app older than #399 offers only the download. ?version=<n> shows a
// version still kept instead of the current one. With ?values=1: only those values, for an open page to hand on to
// its frame. Else the version downloads as a zip.
function valuesOf(site, botId) {
  const values = {};
  const ids = [];
  for (const ref of site.tiles) {
    const v = board?.forPage(ref, botId);
    if (!v || v.tile.approved === false) continue;
    values[ref] = { title: v.tile.title, data: v.data, at: v.at };
    ids.push(v.tile.id);
  }
  if (ids.length) board.refresh(ids, { staleOnly: true }).catch(() => {});
  return { values, tiles: ids };
}
function interactiveAnswer(req, res, url, page, site, botId) {
  const asked = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : site.current;
  const shown = site.versions.find((v) => v.n === asked);
  if (!shown) return send(res, 404, { error: `Version ${url.searchParams.get('version')} of this page is no longer kept.` });
  if (url.searchParams.has('values')) return send(res, 200, valuesOf(site, botId));
  if (!viewAsked(url)) {
    const body = sitesLib.zip(B.pages.sites.filesOf(botId, page.slug, shown.n));
    res.writeHead(200, downloadHeaders(`${page.slug}${shown.n === site.current ? '' : `-v${shown.n}`}.zip`, body.length, 'no-store'));
    return res.end(body);
  }
  const origin = sitesLib.sitesOrigin(req);
  const account = String(req.headers['x-botdot-account'] || '');
  const signed = origin && account ? sitesLib.sign({ botId, slug: page.slug, version: shown.n }) : null;
  return send(res, 200, {
    name: `${page.slug}.zip`, kind: 'none', size: shown.bytes, at: shown.at, page,
    interactive: { current: site.current, shown: shown.n, versions: site.versions, frame: signed ? sitesLib.frameUrl(origin, account, signed.token) : null, origin, expires: signed?.expires || null, ...valuesOf(site, botId) },
  });
}

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
    if (!slug && m === 'GET') return send(res, 200, { pages: B.pages.list(bot.id, ws, jobs()).map((p) => withBoard(bot.id, p)) });
    if (slug && !parts[4] && m === 'GET') {
      const { page, file, site } = B.pages.find(bot.id, ws, slug, jobs());
      if (site) return interactiveAnswer(req, res, url, withBoard(bot.id, page), site, bot.id);
      return pageAnswer(res, url, file, withBoard(bot.id, page), bot.id);
    }
    if (slug && parts[4] === 'board' && !parts[5] && m === 'PUT') return boardAnswer(req, res, bot.id, B.pages.find(bot.id, ws, slug, jobs()).page);
    // Roll back (#399): a version still kept becomes the current one: POST …/versions/<n>.
    if (slug && parts[4] === 'versions' && /^[1-9][0-9]{0,5}$/.test(parts[5] || '') && !parts[6] && m === 'POST') {
      B.pages.find(bot.id, ws, slug, jobs());
      return told(200, { page: B.pages.setCurrent(bot.id, slug, Number(parts[5])) });
    }
    if (slug && parts[4] === 'keep' && !parts[5]) {
      const { page, site } = B.pages.find(bot.id, ws, slug, jobs());
      if (site) return send(res, 400, { error: 'An interactive page shows its live values by itself. For a new version, ask the bot.' });
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
    if (!slug && m === 'GET') return send(res, 200, { pages: chief.listPages().map((p) => withBoard(chief.PAGES_OF, p)) });
    if (slug && !parts[4] && m === 'GET') {
      const { page, file } = chief.findPage(slug);
      return pageAnswer(res, url, file, withBoard(chief.PAGES_OF, page), chief.PAGES_OF);
    }
    if (slug && parts[4] === 'board' && !parts[5] && m === 'PUT') return boardAnswer(req, res, chief.PAGES_OF, chief.findPage(slug).page);
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
  const bots = B.bots.list().flatMap((b) => B.pages.list(b.id, path.join(B.WORKSPACES_DIR, b.id), b.jobs || []).map((p) => ({ botId: b.id, bot: b.name, ...withBoard(b.id, p) })));
  const own = chief.listPages().map((p) => ({ botId: chief.PAGES_OF, bot: B.settings.chiefName(), ...withBoard(chief.PAGES_OF, p) }));
  return [...bots, ...own].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.botId.localeCompare(b.botId) || a.slug.localeCompare(b.slug));
}

// ---------- a page on the Board (#451) ----------

// Whether a page is on the Board, for the apps' "On Board" button and switch.
const withBoard = (botId, p) => (board ? { ...p, onBoard: !!board.pageTile(botId, p.slug) } : p);

// A page as its tile on the Board shows it: its title, when it was saved, and its look: up to three of its first kpis,
// else its first chart, else its first lines. An interactive page shows its title only. ref: its slug or its title.
// Null when the bot, or the page, is gone.
function pageTileInfo(botId, ref) {
  if (botId !== chief.PAGES_OF && !B.bots.get(botId)) return null;
  const read = tileRead(botId, ref);
  if (!read) return null;
  const { page, markdown } = read;
  const out = { slug: page.slug, title: page.title, updatedAt: page.updatedAt, kind: page.kind || 'markdown', face: [], short: '' };
  if (markdown == null) return out;
  try { Object.assign(out, faceOf(markdown, page.title, botId)); } catch { /* blocks it can't draw: a bare tile */ }
  return out;
}
// What a page's tile reads of its page, kept while that read goes through the privilege broker (#468): there every
// file call in a workspace is a process the whole server waits for, and the Board is read with every refresh of every
// app. Read again once pages.json changes (a page saved, published, kept or forgotten) or after a minute (a file
// deleted in the workspace). Without the broker each read costs nothing and is made every time. Its look is drawn
// each time: the tiles it shows change without the page.
const TILE_READ_FOR = 60_000;
const tileReads = new Map(); // `${botId}\0${ref}` -> { stamp, at, read }
function tileRead(botId, ref) {
  if (!process.env.BOT_DOT_PRIVILEGE_SOCKET) return readTile(botId, ref);
  const key = `${botId}\0${ref}`;
  const stamp = B.pages.stamp();
  const kept = tileReads.get(key);
  if (kept && kept.stamp === stamp && Date.now() - kept.at < TILE_READ_FOR) return kept.read;
  const read = readTile(botId, ref);
  if (tileReads.size > 500) tileReads.clear();
  if (read?.markdown !== null) tileReads.set(key, { stamp, at: Date.now(), read }); // a file being written: read again
  else tileReads.delete(key);
  return read;
}
// { page, markdown } (markdown null for an interactive page, or a file being written), or null when it is gone.
function readTile(botId, ref) {
  const own = botId === chief.PAGES_OF;
  const find = (slug) => (own ? chief.findPage(slug) : B.pages.find(botId, path.join(B.WORKSPACES_DIR, botId), slug, B.bots.get(botId).jobs || []));
  let found;
  try { found = find(ref); } catch { /* not a slug: its title, below */ }
  if (!found) {
    try {
      const list = own ? chief.listPages() : B.pages.list(botId, path.join(B.WORKSPACES_DIR, botId), B.bots.get(botId).jobs || []);
      const p = list.find((x) => x.title.toLowerCase() === String(ref).toLowerCase());
      if (!p) return null;
      found = find(p.slug);
    } catch { return null; }
  }
  const { page, file } = found;
  if (!file) return { page, markdown: undefined };
  try { return { page, markdown: pfs.readFileSync(file, 'utf8') }; } catch { return { page, markdown: null }; }
}
const LINES_MAX = 240;
function faceOf(markdown, title, botId) {
  const { parts } = pageBlocks.render(markdown, board && { tile: (ref) => board.forPage(ref, botId) });
  const blocks = parts.filter((p) => p.block && p.block.type !== 'error').flatMap((p) => (p.block.type === 'grid' ? p.block.blocks : [p.block]));
  const kpis = blocks.filter((b) => b.type === 'kpi').slice(0, 3);
  const shortOf = (b) => (b?.text ? `${b.text}${b.unit ? ` ${b.unit}` : ''}` : '');
  // Side by side they are too narrow for a sparkline: only one alone keeps its line.
  if (kpis.length) return { face: kpis.length === 1 ? kpis : [{ type: 'row', blocks: kpis.map(({ points: _, times: __, ...k }) => k) }], short: shortOf(kpis[0]) };
  const chart = blocks.find((b) => b.type === 'chart');
  if (chart) return { face: [chart], short: '' };
  // Its first lines, as plain words: no heading that repeats its title, no Markdown marks.
  const words = parts.filter((p) => p.md != null).map((p) => p.md).join('\n').split('\n')
    .map((l) => l.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '').replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, (m, link) => link ?? '').trim())
    .filter((l, i) => l && !/^[-=|: ]+$/.test(l) && !(i < 3 && l.toLowerCase() === String(title).toLowerCase()));
  const text = words.join(' ').slice(0, LINES_MAX);
  return { face: text ? [{ type: 'text', text, lines: 3 }] : [], short: '' };
}

// Show a page on the Board or take it off (PUT …/pages/<slug>/board, { on }): its tile, under "Pages".
async function boardAnswer(req, res, botId, page) {
  if (!board) return send(res, 404, { error: 'Not here' });
  const body = (await readBody(req)) || {};
  if (typeof body.on !== 'boolean') return send(res, 400, { error: 'Say on: true or false.' });
  try {
    if (body.on) board.showPage(botId, page.slug); else board.hidePage(botId, page.slug);
  } catch (e) { return send(res, 400, { error: e.message }); }
  return send(res, 200, { page: withBoard(botId, page) });
}

function create(ctx = {}) {
  board = ctx.board || null;
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

module.exports = { pagesRoute, chiefPagesRoute, create, allPages, pageTileInfo };
