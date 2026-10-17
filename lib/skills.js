// Claude Code skills for bots: a library of SKILL.md folders in data/skills, plus read-only
// access to the skills already on this machine (~/.claude/skills, incl. ones synced from claude.ai).
// A run loads its bot's library skills through a throwaway plugin passed with --plugin-dir.
const fs = require('./principal-fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLUGIN_NAME = 'botdot'; // library skills show up to bots as "botdot:<name>"
const SCRIPT_EXT = /\.(py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|php|ps1|bat|exe|bin)$/i;

// ---------- SKILL.md ----------

// Minimal frontmatter parser: `key: value`, quoted values, block scalars (| or >), and "- item" lists.
// Keeps each entry's raw text so unknown keys survive a rewrite.
function parseSkillMd(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, raw: [], body: String(text) };
  const lines = m[1].split(/\r?\n/);
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const km = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!km) { if (raw.length) raw[raw.length - 1].text += '\n' + lines[i]; continue; }
    raw.push({ key: km[1], first: km[2], text: lines[i] });
  }
  const meta = {};
  for (const e of raw) {
    const cont = e.text.split('\n').slice(1);
    let v = e.first.trim();
    if (v === '|' || v === '>' || v === '|-' || v === '>-') {
      const parts = cont.map((l) => l.replace(/^\s+/, ''));
      v = v.startsWith('|') ? parts.join('\n') : parts.join(' ');
    } else if (!v && cont.some((l) => /^\s*-\s+/.test(l))) {
      v = cont.filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
    } else {
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      else if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } } // written by yamlString: undo its escapes (\")
      else v = v.replace(/^'(.*)'$/, '$1');
    }
    meta[e.key] = v;
  }
  return { meta, raw, body: m[2] };
}

const yamlString = (s) => JSON.stringify(String(s)); // JSON strings are valid YAML

function buildSkillMd({ name, description, body, raw = [] }) {
  const keep = raw.filter((e) => e.key !== 'name' && e.key !== 'description').map((e) => e.text);
  return ['---', `name: ${name}`, `description: ${yamlString(description)}`, ...keep, '---', '', String(body || '').trim(), ''].join('\n');
}

const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);

// ---------- helpers ----------

function listFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.botdot.json') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(full, base, out);
    else if (ent.isFile()) out.push({ path: path.relative(base, full), size: fs.statSync(full).size });
  }
  return out;
}

function describeFiles(files) {
  return {
    fileCount: files.length,
    scripts: files.filter((f) => SCRIPT_EXT.test(f.path)).map((f) => f.path),
  };
}

// ---------- library ----------

function create(dataDir) {
  const DIR = path.join(dataDir, 'skills');
  const PACKS = path.join(dataDir, 'skill-packs');
  fs.mkdirSync(DIR, { recursive: true });

  const dirOf = (name) => {
    if (!NAME_RE.test(String(name))) throw new Error('Skill names use lowercase letters, numbers and dashes, e.g. "weekly-report"');
    return path.join(DIR, name);
  };

  function read(name) {
    const dir = dirOf(name);
    const file = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(file)) return null;
    const { meta, body } = parseSkillMd(fs.readFileSync(file, 'utf8'));
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(dir, '.botdot.json'), 'utf8')); } catch { /* none */ }
    const files = listFiles(dir);
    return {
      name,
      description: String(meta.description || ''),
      instructions: body.trim(),
      allowedTools: toList(meta['allowed-tools']),
      source: info.source || 'created',
      sourceUrl: info.url || null,
      createdBy: info.createdBy || 'you',
      updatedAt: info.updatedAt || fs.statSync(file).mtime.toISOString(),
      ...describeFiles(files.filter((f) => f.path !== 'SKILL.md')),
    };
  }

  function list() {
    return fs.readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NAME_RE.test(d.name))
      .map((d) => read(d.name))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function writeInfo(dir, info) {
    fs.writeFileSync(path.join(dir, '.botdot.json'), JSON.stringify({ ...info, updatedAt: new Date().toISOString() }, null, 2));
  }

  function validate({ name, description, instructions }) {
    dirOf(name);
    if (!String(description || '').trim()) throw new Error('Describe when the skill should be used');
    if (String(description).length > 1024) throw new Error('Keep the description under 1024 characters');
    if (!String(instructions || '').trim()) throw new Error('Write the instructions');
  }

  // Create or update an instruction-only skill (or edit the SKILL.md of an imported one).
  function save(input, { createdBy = 'you', allowNew = true } = {}) {
    const name = String(input.name || '').trim().toLowerCase();
    validate({ ...input, name });
    const dir = dirOf(name);
    const file = path.join(dir, 'SKILL.md');
    const exists = fs.existsSync(file);
    if (!exists && !allowNew) throw new Error(`No skill called "${name}"`);
    let raw = [];
    let info = { source: 'created', createdBy };
    if (exists) {
      raw = parseSkillMd(fs.readFileSync(file, 'utf8')).raw;
      try { info = JSON.parse(fs.readFileSync(path.join(dir, '.botdot.json'), 'utf8')); } catch { /* keep default */ }
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buildSkillMd({ name, description: input.description, body: input.instructions, raw }));
    writeInfo(dir, info);
    return read(name);
  }

  function rename(oldName, input) {
    const next = String(input.name || oldName).trim().toLowerCase();
    if (next !== oldName) {
      if (fs.existsSync(dirOf(next))) throw new Error(`There's already a skill called "${next}"`);
      fs.renameSync(dirOf(oldName), dirOf(next));
    }
    return save({ ...input, name: next }, { allowNew: false });
  }

  function remove(name) {
    const dir = dirOf(name);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  // ---------- import from GitHub (preview first, then confirm) ----------

  const previews = new Map(); // id -> { name, files: [{ path, content: Buffer }], url, at }

  function parseGitHubUrl(url) {
    const u = new URL(url);
    // skills.sh/<owner>/<repo>/<skill>: the skill folder of that name in github.com/<owner>/<repo>.
    if (/^(www\.)?skills\.sh$/.test(u.hostname)) {
      const [owner, repo, want] = u.pathname.replace(/^\/|\/$/g, '').split('/');
      if (!owner || !repo) throw new Error('That skills.sh link is missing the repository');
      return { owner, repo, ref: undefined, path: '', want: want ? want.toLowerCase() : undefined };
    }
    if (u.hostname !== 'github.com') throw new Error('Paste a github.com or skills.sh link to a skill');
    const [owner, repo, kind, ref, ...rest] = u.pathname.replace(/^\/|\/$/g, '').split('/');
    if (!owner || !repo) throw new Error('That link is missing the repository');
    let p = rest.join('/');
    if (kind === 'blob' && /(^|\/)SKILL\.md$/i.test(p)) p = p.replace(/\/?SKILL\.md$/i, '');
    return { owner, repo: repo.replace(/\.git$/, ''), ref: kind ? ref : undefined, path: kind ? p : '' };
  }

  // Where GitHub is read. The variables are for the tests, which stand in for it: no test reaches GitHub.
  const GITHUB_API = process.env.BOT_DOT_GITHUB_API_URL || 'https://api.github.com';
  const GITHUB_RAW = process.env.BOT_DOT_GITHUB_RAW_URL || 'https://raw.githubusercontent.com';
  async function gh(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'bot-dot', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) throw new Error('Not found on GitHub (is the repository public?)');
    if (res.status === 403) throw new Error('GitHub rate limit reached, try again in a while');
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res;
  }

  const LIMITS = { files: 400, fileBytes: 10 * 1024 * 1024, totalBytes: 60 * 1024 * 1024 };
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  // List every file under a folder with one Git trees call (plus one to find the default branch).
  async function listTree({ owner, repo, ref, path: p }) {
    let branch = ref;
    if (!branch) branch = (await (await gh(`${GITHUB_API}/repos/${owner}/${repo}`)).json()).default_branch;
    const treeish = p ? `${branch}:${p}` : branch;
    const tree = await (await gh(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encPath(treeish).replace(/%3A/gi, ':')}?recursive=1`)).json();
    if (tree.truncated) throw new Error('That folder is too big to read. Link to the skill folder itself.');
    return { branch, blobs: (tree.tree || []).filter((x) => x.type === 'blob') };
  }

  // Download files with a few requests in flight at a time.
  async function download({ owner, repo }, branch, base, blobs) {
    const files = new Array(blobs.length);
    let next = 0;
    const worker = async () => {
      while (next < blobs.length) {
        const i = next++;
        const x = blobs[i];
        const url = `${GITHUB_RAW}/${owner}/${repo}/${encPath(branch)}/${encPath(base ? `${base}/${x.path}` : x.path)}`;
        files[i] = { path: x.path, content: Buffer.from(await (await gh(url)).arrayBuffer()) };
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, blobs.length) }, worker));
    return files;
  }

  // Find the skill folder (the link may point at the repo root) and fetch its files.
  async function fetchSkill(loc) {
    let { branch, blobs } = await listTree(loc);
    let base = loc.path;
    if (!blobs.some((x) => x.path === 'SKILL.md')) {
      const found = blobs.filter((x) => x.path.endsWith('/SKILL.md')).map((x) => x.path.slice(0, -'/SKILL.md'.length));
      if (!found.length) throw new Error('No SKILL.md found there. Link to the folder that contains it.');
      // A skills.sh link names the skill: its folder.
      if (loc.want) {
        const named = found.filter((d) => d.split('/').pop().toLowerCase() === loc.want);
        if (named.length !== 1) throw new Error(`No skill called "${loc.want}" in ${loc.owner}/${loc.repo}. Open it on GitHub and paste the link to its folder.`);
        found.splice(0, found.length, named[0]);
      }
      // Only pick automatically when there's exactly one skill; otherwise ask for the folder.
      if (found.length > 1) {
        const names = found.map((d) => d.split('/').pop()).slice(0, 8).join(', ');
        throw new Error(`That repository has ${found.length} skills (${names}${found.length > 8 ? ', …' : ''}). Open the one you want on GitHub and paste the link to its folder.`);
      }
      const dir = found[0];
      blobs = blobs.filter((x) => x.path.startsWith(dir + '/')).map((x) => ({ ...x, path: x.path.slice(dir.length + 1) }));
      base = base ? `${base}/${dir}` : dir;
    }
    if (blobs.length > LIMITS.files) throw new Error(`That skill has ${blobs.length} files; the limit is ${LIMITS.files}.`);
    const big = blobs.find((x) => (x.size || 0) > LIMITS.fileBytes);
    if (big) throw new Error(`${big.path} is too large (over ${LIMITS.fileBytes / 1024 / 1024} MB).`);
    const total = blobs.reduce((n, x) => n + (x.size || 0), 0);
    if (total > LIMITS.totalBytes) throw new Error(`That skill is ${(total / 1024 / 1024).toFixed(0)} MB; the limit is ${LIMITS.totalBytes / 1024 / 1024} MB.`);
    const files = await download(loc, branch, base, blobs);
    return { files, folder: base, branch };
  }

  async function previewImport(url) {
    const loc = parseGitHubUrl(url);
    const { files, folder } = await fetchSkill(loc);
    const skillFile = files.find((f) => f.path === 'SKILL.md');
    const { meta, body } = parseSkillMd(skillFile.content.toString('utf8'));
    const folderName = (folder.split('/').pop() || loc.repo).toLowerCase();
    const name = String(meta.name || folderName).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    const id = crypto.randomUUID().slice(0, 8);
    previews.set(id, { name, files, url, at: Date.now() });
    setTimeout(() => previews.delete(id), 30 * 60_000).unref();
    return {
      id,
      name,
      exists: fs.existsSync(dirOf(name)),
      description: String(meta.description || ''),
      allowedTools: toList(meta['allowed-tools']),
      instructions: body.trim().slice(0, 6000),
      files: files.map((f) => ({ path: f.path, size: f.content.length })),
      folder,
      totalBytes: files.reduce((n, f) => n + f.content.length, 0),
      ...describeFiles(files.filter((f) => f.path !== 'SKILL.md')),
      url,
    };
  }

  function confirmImport(id, { name } = {}) {
    const p = previews.get(id);
    if (!p) throw new Error('This preview expired. Paste the link again.');
    const finalName = String(name || p.name).toLowerCase();
    const dir = dirOf(finalName);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const f of p.files) {
      const target = path.join(dir, f.path);
      if (!target.startsWith(dir + path.sep)) continue; // no path tricks
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.content);
    }
    // Make the name inside SKILL.md match the folder.
    const file = path.join(dir, 'SKILL.md');
    const parsed = parseSkillMd(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, buildSkillMd({ name: finalName, description: parsed.meta.description || '', body: parsed.body, raw: parsed.raw }));
    writeInfo(dir, { source: 'github', url: p.url, createdBy: 'you', importedAt: new Date().toISOString() });
    previews.delete(id);
    return read(finalName);
  }

  // ---------- skills already on this machine (read-only) ----------

  function machineSkills() {
    const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills');
    const out = [];
    const walk = (dir, depth, synced) => {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (!e.isDirectory()) continue;
        const full = path.join(dir, e.name);
        const md = path.join(full, 'SKILL.md');
        if (fs.existsSync(md)) {
          try {
            const { meta } = parseSkillMd(fs.readFileSync(md, 'utf8'));
            out.push({ name: String(meta.name || e.name), description: String(meta.description || ''), origin: synced ? 'Your Claude account' : 'Your Claude Code' });
          } catch { /* unreadable */ }
        } else if (depth < 3) walk(full, depth + 1, synced || e.name === 'synced');
      }
    };
    walk(root, 0, false);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- per-run plugin ----------

  // Returns the plugin folder to pass with --plugin-dir, or null when the bot has no library skills.
  function buildPack(runId, names) {
    const wanted = [...new Set(names || [])].filter((n) => NAME_RE.test(n) && fs.existsSync(path.join(DIR, n, 'SKILL.md')));
    if (!wanted.length) return null;
    const dir = path.join(PACKS, runId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: PLUGIN_NAME, description: "Skills from botdot's library", version: '1.0.0' }, null, 2));
    for (const n of wanted) {
      fs.cpSync(path.join(DIR, n), path.join(dir, 'skills', n), { recursive: true, filter: (src) => path.basename(src) !== '.botdot.json' });
    }
    return { dir, skills: wanted.map((n) => read(n)).filter(Boolean) };
  }

  const removePack = (runId) => fs.rmSync(path.join(PACKS, runId), { recursive: true, force: true });

  // ---------- skill names as Claude Code reports them (e.g. "anthropic-skills:pdf") ----------
  // Every run's init event lists the skills it can see; keeping the latest list lets bot-dot show
  // Claude Code's built-in skills and block a switched-off skill by its exact name.
  const SEEN_FILE = path.join(dataDir, 'seen-skills.json');
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')).skills || []; } catch { /* none yet */ }

  function noteSeen(list) {
    const next = [...new Set((list || []).map(String))].filter((n) => !n.startsWith(`${PLUGIN_NAME}:`)).sort();
    if (next.join('|') === seen.join('|')) return;
    seen = next;
    fs.writeFileSync(SEEN_FILE, JSON.stringify({ skills: seen, at: new Date().toISOString() }, null, 2));
  }

  // The start of a file (Claude Code's "init" line comes near the top of a run's log, which can be large).
  const head = (file, bytes = 1024 * 1024) => {
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(bytes); return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, bytes, 0)); } finally { fs.closeSync(fd); }
  };
  // Seed from the newest run log if we haven't seen a run since this feature was added.
  if (!seen.length) {
    try {
      const runsDir = path.join(dataDir, 'runs');
      const logs = fs.readdirSync(runsDir).filter((f) => f.endsWith('.ndjson')).sort().reverse().slice(0, 20);
      for (const f of logs) {
        const line = head(path.join(runsDir, f)).split('\n').find((l) => l.includes('"subtype":"init"'));
        const ev = line && JSON.parse(line);
        if (ev && Array.isArray(ev.skills) && ev.skills.length) { noteSeen(ev.skills); break; }
      }
    } catch { /* no runs yet */ }
  }

  // Claude Code's own skills: seen in runs but not on disk here and not from bot-dot's library.
  function builtinSkills() {
    const onDisk = new Set(machineSkills().map((k) => k.name));
    return seen.filter((n) => !n.includes(':') && !onDisk.has(n)).map((name) => ({ name, origin: 'Built into Claude Code' }));
  }

  // Permission rules that block the given skills, covering namespaced variants ("anthropic-skills:pdf").
  function denyRules(keys) {
    const rules = new Set();
    for (const key of keys || []) {
      rules.add(`Skill(${key})`);
      for (const n of seen) if (n.endsWith(`:${key}`)) rules.add(`Skill(${n})`);
    }
    return [...rules];
  }

  return { list, read, validate, save, rename, remove, previewImport, confirmImport, machineSkills, builtinSkills, noteSeen, denyRules, buildPack, removePack, PLUGIN_NAME, NAME_RE };
}

module.exports = { create, parseSkillMd, buildSkillMd, PLUGIN_NAME };
