// Pages (#346, ADR 065): a lasting page a bot makes for the owner (a report, a memo, an overview), written in Markdown
// with save_page. The text is the file pages/<slug>.md in the bot's workspace, so the bot reads and rewrites it like
// any of its files; what the page is (its title, when it was made and last saved, what it is built from, the job that
// keeps it up to date) is kept in botdot's own data folder, which no bot writes: { <botId>: [{ slug, title, sources,
// createdAt, updatedAt, keepJobId? }] }. A page is never served as HTML: the apps draw its Markdown with their own code
// (rule 6, ADR 004).
const fs = require('./principal-fs');
const path = require('path');
const crypto = require('crypto');
const fileView = require('./file-view');
const { whenWords } = require('./jobs');

const DIR = 'pages';
const MAX_BYTES = 512 * 1024; // the viewer shows up to 1 MB; a page is for reading, not a dump
const TITLE_MAX = 80;
const SOURCES_MAX = 600;
const SLUG_MAX = 60;

const refused = (message, status = 400) => Object.assign(new Error(message), { status });
// One plain line: a title is drawn as text, never markup.
const line = (s, max) => String(s ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›')).trim().slice(0, max);
// "hq weekly health" -> "hq-weekly-health". Only a-z, 0-9 and dashes, so a slug is always a plain file name.
function slugOf(s) {
  const slug = String(s ?? '').replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '');
  return slug || 'page';
}
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// What a schedule picked on the page's sheet is as a cron, in the server's time zone: every hour, every morning, or
// every Monday at a time ("07:00"). The apps send the words, the server makes the cron, so both draw one sheet.
const EVERY = ['hour', 'day', 'monday'];
function cronOf(every, time = '07:00') {
  if (!EVERY.includes(every)) throw refused('Say how often: hour, day or monday.');
  if (every === 'hour') return '0 * * * *';
  const m = String(time || '').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw refused('Give the time as HH:MM, e.g. 07:00.');
  return `${Number(m[2])} ${Number(m[1])} * * ${every === 'monday' ? '1' : '*'}`;
}

// The other way: the sheet's words for a job's cron, { every, time }, or {} for a schedule set some other way (the
// owner asked the bot or the Chief for one), which the sheet does not draw.
function scheduleOf(cron) {
  if (cron === '0 * * * *') return { every: 'hour' };
  const m = String(cron || '').match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1)$/);
  if (!m) return {};
  return { every: m[3] === '1' ? 'monday' : 'day', time: `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}` };
}

// The task of the job that keeps a page up to date. The page's own words are not in it: the run reads the page.
function keepPrompt(page, { check = '', notify = 'report-only' } = {}) {
  return [
    `Keep your page "${page.title}" up to date (its slug is "${page.slug}"; the text is ${DIR}/${page.slug}.md in your workspace).`,
    'Read the page as it stands, check its sources again, and save the fresh version with save_page, with page set to that slug and the same title. Keep its layout.',
    'Save it even when little changed, so the page shows when it was last checked.',
    check ? `What to check: ${line(check, SOURCES_MAX)}` : '',
    notify === 'always' ? 'End with one or two lines on what changed.' : 'Tell the owner with notify_owner only when something on it needs them; otherwise finish quietly.',
  ].filter(Boolean).join('\n');
}

function create(dataDir) {
  const metaFile = path.join(dataDir, 'pages.json');
  const readAll = () => { try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')) || {}; } catch { return {}; } };
  function writeAll(all) {
    const tmp = `${metaFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, metaFile);
  }
  const metaOf = (botId) => readAll()[botId] || [];
  function setMeta(botId, list) {
    const all = readAll();
    if (list.length) all[botId] = list; else delete all[botId];
    writeAll(all);
  }

  // Its pages folder, made if missing; never a link out of the workspace (the bot can write there).
  function pagesDir(workspace) {
    fs.mkdirSync(workspace, { recursive: true });
    const dir = path.join(workspace, DIR);
    let st = null;
    try { st = fs.lstatSync(dir); } catch { /* not there yet */ }
    if (st && !st.isDirectory()) throw refused(`${DIR} in your workspace is not a folder. Move it away first.`);
    if (!st) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // The page's file, read through the viewer's own check (no link out of the workspace), or null when it is gone.
  function fileOf(workspace, slug) {
    try { return fileView.inWorkspace(workspace, `${DIR}/${slug}.md`); } catch { return null; }
  }

  // A bot's pages, newest first, whose file is still there (the owner may delete one in the workspace).
  // jobs: the bot's jobs, so that a page whose job is gone no longer says it keeps up to date.
  function list(botId, workspace, jobs = []) {
    return metaOf(botId).filter((p) => fileOf(workspace, p.slug)).map((p) => view(p, jobs))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug));
  }
  // A page as the API hands it out: `keep` with the job's id while the job is there.
  function view(p, jobs = []) {
    const job = p.keepJobId ? jobs.find((j) => j.id === p.keepJobId) : null;
    return { slug: p.slug, title: p.title, sources: p.sources || '', createdAt: p.createdAt, updatedAt: p.updatedAt, file: `${DIR}/${p.slug}.md`, keep: job ? { jobId: job.id, when: whenWords(job), ...scheduleOf(job.cron), notify: job.notify || 'report-only', check: p.keepCheck || '' } : null };
  }
  function find(botId, workspace, slug, jobs = []) {
    const p = metaOf(botId).find((x) => x.slug === String(slug));
    if (!p || !fileOf(workspace, p.slug)) throw refused('That page is gone.', 404);
    return { page: view(p, jobs), file: fileOf(workspace, p.slug) };
  }

  // save_page: write the page and its meta. `page` rewrites the page of that slug; without it the title gives the
  // slug, and a page of the same title is the same page. Returns the page and whether it is new.
  function save(botId, workspace, { title, markdown, page, sources } = {}) {
    const text = String(markdown ?? '');
    if (!text.trim()) throw refused('Write the page in markdown.');
    if (Buffer.byteLength(text) > MAX_BYTES) throw refused(`Keep a page under ${MAX_BYTES / 1024} KB.`);
    const list = metaOf(botId);
    let slug;
    if (page !== undefined && page !== null && String(page).trim()) {
      slug = String(page).trim().replace(/\.md$/, '').replace(/^pages\//, '');
      if (!SLUG_RE.test(slug) || !list.some((p) => p.slug === slug)) throw refused(`You have no page "${slug}". Your pages: ${list.map((p) => p.slug).join(', ') || 'none yet'}.`);
    } else {
      if (!line(title, TITLE_MAX)) throw refused('Give the page a title.');
      slug = slugOf(title);
    }
    const prev = list.find((p) => p.slug === slug);
    const name = line(title, TITLE_MAX) || prev?.title;
    if (!name) throw refused('Give the page a title.');
    const dir = pagesDir(workspace);
    const target = path.join(dir, `${slug}.md`);
    // Written beside it and renamed over it: a link put in its place is replaced, never followed.
    const tmp = path.join(dir, `.${slug}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx' }); // never through a link left at that name
    fs.renameSync(tmp, target);
    const now = new Date().toISOString();
    const next = { ...(prev || { slug, createdAt: now }), title: name, sources: sources !== undefined ? line(sources, SOURCES_MAX) : prev?.sources || '', updatedAt: now };
    setMeta(botId, [...list.filter((p) => p.slug !== slug), next]);
    return { page: view(next), created: !prev };
  }

  // The job that keeps it up to date, with what the owner said to check, or none (jobId null).
  function setKeep(botId, slug, jobId, check = '') {
    const list = metaOf(botId);
    if (!list.some((p) => p.slug === slug)) throw refused('That page is gone.', 404);
    setMeta(botId, list.map((p) => {
      if (p.slug !== slug) return p;
      const { keepJobId: _, keepCheck: __, ...rest } = p;
      return jobId ? { ...rest, keepJobId: jobId, ...(check ? { keepCheck: line(check, SOURCES_MAX) } : {}) } : rest;
    }));
  }
  const keepJobOf = (botId, slug) => metaOf(botId).find((p) => p.slug === slug)?.keepJobId || null;

  const forgetBot = (botId) => setMeta(botId, []);

  // For a run's prompt: the pages it has, so it rewrites one instead of making a second.
  function promptNote(botId, workspace) {
    const mine = list(botId, workspace);
    const names = mine.slice(0, 20).map((p) => `"${p.title}" (page "${p.slug}")`).join(', ');
    return `Pages: when the owner asks for a page, a report, a memo or an overview they will come back to, write it in Markdown and save it with save_page (headings, lists, tables, task lists; never HTML). It shows in a chip under your reply and in your settings, so don't paste it into the reply: say in a line what is on it. To change a page, rewrite it whole with save_page and its page slug.${names ? ` Your pages: ${names}.` : ''}`;
  }

  return { list, find, save, setKeep, keepJobOf, forgetBot, promptNote, DIR };
}

module.exports = { create, slugOf, cronOf, scheduleOf, keepPrompt, EVERY, MAX_BYTES };
