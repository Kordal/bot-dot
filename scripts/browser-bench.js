#!/usr/bin/env node
// Before and after Jev in the browser tools (lib/browser-picker.js), over the tasks of
// test/fixtures/browser-bench-tasks.json: a bot's model (Claude Code, signed in as this machine is, with its default
// model) works a real Camoufox with botdot's own browser tools, as a bot does.
//
//   node scripts/browser-bench.js --bridge=<host:port> --site=<address the browser reaches this machine on>
//       --bridge     a TCP relay to the Camoufox bridge of a bench computer (camoufox-browser --serve), which only
//                    the bench can reach: the relay takes one JSON request per connection, as the bridge's socket.
//       --arms=refs,jev   refs: the tools as they are today. jev: the admin's switch on: a control by what it is,
//                    and browser_navigate, where Jev clicks its way to a page. brief: as jev without
//                    browser_navigate, with browser_find, where Jev reads the page, and actions answer with the title
//                    alone. Jev's key: $OPENROUTER_API_KEY, or the file $OPENROUTER_KEY_FILE.
//       --reps=<n>   runs of each task in each arm (1). --only=<id,…> some tasks. --json the numbers as JSON.
//   node scripts/browser-bench.js --mcp   the browser tools of lib/computer-mcp.js alone, for Claude Code (inner)
//
// Each run: the browser goes to the task's start page, Claude Code gets the task and the browser tools alone, and its
// last line is checked against the task's answer; a form's task is checked by what the site received. The time is
// the run's, the steps its tool calls, the cost Claude Code's own (total_cost_usd) and Jev's (usage.cost).
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };

// ---------- inner: the browser tools for Claude Code ----------
if (args.includes('--mcp')) {
  const mcp = require('../lib/computer-mcp');
  const keep = mcp.TOOLS.filter((t) => t.name.startsWith('browser_'));
  mcp.TOOLS.splice(0, mcp.TOOLS.length, ...keep);
  require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    try { mcp.handle(JSON.parse(line)); } catch { /* ignore bad input */ }
  });
  return;
}

const { tasks } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'browser-bench-tasks.json'), 'utf8'));
const picker = require('../lib/browser-picker');

// ---------- the bench's own site ----------
const SHOES = ['Trail Runner 3', 'Trail Runner 2', 'Road Racer', 'City Walker', 'Peak Hiker', 'Mud Master', 'Sprint Pro', 'Court Classic', 'Desert Boot', 'Rain Stomper', 'Trail Runner 3 GTX', 'Cloud Step'];
const PRICES = ['89.00', '74.50', '120.00', '65.00', '149.90', '99.00', '110.00', '79.95', '134.00', '58.00', '119.00', '92.00'];
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const CITIES = Array.from({ length: 150 }, (_, i) => (i === 70 ? 'Kraków' : `${['North', 'South', 'East', 'West', 'Upper', 'Lower'][i % 6]} ${['Harbor', 'Field', 'Ridge', 'Vale', 'Brook', 'Port', 'Hill', 'Moor', 'Glen', 'Ford', 'Haven', 'Mill', 'Cross', 'Bay', 'Wood', 'Gate', 'Marsh', 'Crest', 'Dale', 'Point', 'Lake', 'Stone', 'Burn', 'Court', 'Green'][Math.floor(i / 6)]}`));
const STATUSES = ['Shipped', 'Delivered', 'Processing', 'Cancelled'];
const orderStatus = (n) => (n === 1047 ? 'Returned' : STATUSES[n % 4]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} – Acme</title></head><body>`
  + '<nav><a href="/">Home</a> <a href="/shop">Shop</a> <a href="/docs">Docs</a> <a href="/orders">Orders</a> <a href="/offices">Offices</a> <a href="/newsletter">Newsletter</a> <a href="/settings">Settings</a> <a href="/help">Help</a></nav>'
  + `<main><h1>${esc(title)}</h1>${body}</main><footer><a href="/about">About</a> <a href="/careers">Careers</a> <a href="/privacy">Privacy</a></footer></body></html>`;
const DOCS = { 'rate-limits': ['API rate limits', '<p>Each key may make 120 requests per minute. Past it the API answers 429.</p>'], 'auth': ['Authentication', '<p>Send the key in the Authorization header.</p>'], 'rate-of-change': ['Rate of change charts', '<p>Charts show the rate of change per day, at most 30 days.</p>'], 'webhooks': ['Webhooks', '<p>Webhooks are retried 5 times.</p>'], 'limits-storage': ['Storage limits', '<p>Each account may keep 10 GB.</p>'] };
const HELP = { billing: { refunds: ['Refund policy', '<p>A refund can be asked for within 30 days of the purchase.</p>'], invoices: ['Invoices', '<p>Invoices are sent on the 1st of each month.</p>'], cards: ['Changing your card', '<p>Change it under Settings, Account.</p>'] }, shipping: { times: ['Delivery times', '<p>Orders arrive within 5 working days.</p>'], returns: ['Returning an order', '<p>Returns are free within 14 days.</p>'] }, account: { delete: ['Deleting your account', '<p>Write to support.</p>'] } };

function site(posted) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const say = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { posted.push({ path: u.pathname, fields: Object.fromEntries(new URLSearchParams(body)) }); say(200, page('Saved', '<p role="status">Thank you: it is saved.</p>')); });
      return;
    }
    const p = u.pathname.replace(/\/+$/, '') || '/';
    if (p === '/') return say(200, page('Welcome to Acme', '<p>Shoes, jackets and bags since 1990.</p><ul><li><a href="/shop">Visit the shop</a></li><li><a href="/help">Get help</a></li></ul>'));
    if (p === '/shop') return say(200, page('Shop', '<ul><li><a href="/shop/shoes">Shoes</a></li><li><a href="/shop/jackets">Jackets</a></li><li><a href="/shop/bags">Bags</a></li></ul>'));
    if (p === '/shop/shoes') return say(200, page('Shoes', SHOES.map((s) => `<section><h2>${esc(s)}</h2><p>Light and strong.</p><a href="/shop/p/${slug(s)}">View</a> <button type="button">Add to cart</button></section>`).join('')));
    if (p === '/shop/jackets' || p === '/shop/bags') return say(200, page(p.endsWith('bags') ? 'Bags' : 'Jackets', '<section><h2>Storm Shell</h2><a href="/shop/p/storm-shell">View</a></section>'));
    const prod = p.match(/^\/shop\/p\/([a-z0-9-]+)$/);
    if (prod) { const i = SHOES.findIndex((s) => slug(s) === prod[1]); return i < 0 ? say(404, page('Not found', '<p>No such product.</p>')) : say(200, page(SHOES[i], `<p>Price: $${PRICES[i]}</p><button type="button">Add to cart</button><p>Free returns.</p>`)); }
    if (p === '/docs') return say(200, page('Docs', '<form action="/docs/search" method="get" role="search"><input type="search" name="q" aria-label="Search the docs"><button>Search</button></form><ul>' + Object.entries(DOCS).map(([k, [t]]) => `<li><a href="/docs/${k}">${t}</a></li>`).join('') + '</ul>'));
    if (p === '/docs/search') { const q = (u.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean); const hits = Object.entries(DOCS).filter(([k, [t]]) => q.some((w) => (k + ' ' + t).toLowerCase().includes(w))); return say(200, page('Search results', hits.length ? '<ol>' + hits.map(([k, [t]]) => `<li><a href="/docs/${k}">${t}</a></li>`).join('') + '</ol>' : '<p>Nothing found.</p>')); }
    const doc = p.match(/^\/docs\/([a-z-]+)$/);
    if (doc && DOCS[doc[1]]) return say(200, page(DOCS[doc[1]][0], DOCS[doc[1]][1]));
    if (p === '/orders') { const n = Math.min(Math.max(Number(u.searchParams.get('page')) || 1, 1), 6); const rows = Array.from({ length: 10 }, (_, i) => 1000 + (n - 1) * 10 + i + 1).map((o) => `<tr><td>#${o}</td><td>2026-0${1 + (o % 9)}-1${o % 10}</td><td>${orderStatus(o)}</td></tr>`).join(''); return say(200, page('Orders', `<p>Page ${n} of 6</p><table><thead><tr><th>Order</th><th>Date</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>${n > 1 ? `<a href="/orders?page=${n - 1}">Previous</a> ` : ''}${n < 6 ? `<a href="/orders?page=${n + 1}">Next</a>` : ''}`)); }
    if (p === '/offices') return say(200, page('Our offices', '<ul>' + CITIES.map((c) => `<li><a href="/offices/${slug(c)}">${esc(c)}</a></li>`).join('') + '</ul>'));
    const office = p.match(/^\/offices\/([a-z0-9-]+)$/);
    if (office) { const i = CITIES.findIndex((c) => slug(c) === office[1]); if (i >= 0) return say(200, page(`${CITIES[i]} office`, `<p>Phone: +48 12 555 ${String(i === 70 ? 147 : 200 + i).padStart(4, '0')}</p>`)); }
    if (p === '/newsletter') return say(200, page('Newsletter', '<form method="post" action="/newsletter"><label>Name <input name="name"></label><label>Email <input name="email" type="email"></label><fieldset><legend>Topic</legend><label><input type="radio" name="topic" value="release-notes"> Release notes</label><label><input type="radio" name="topic" value="offers"> Offers</label><label><input type="radio" name="topic" value="events"> Events</label></fieldset><label><input type="checkbox" name="agree"> I agree to the terms</label><button>Subscribe</button></form>'));
    if (p === '/settings') return say(200, page('Settings', '<ul><li><a href="/settings/profile">Profile</a></li><li><a href="/settings/account">Account</a></li><li><a href="/settings/security">Security</a></li></ul>'));
    if (p === '/settings/account') return say(200, page('Account', '<ul><li><a href="/settings/billing">Billing</a></li><li><a href="/settings/notifications">Email notifications</a></li></ul>'));
    if (p === '/settings/notifications') return say(200, page('Email notifications', '<form method="post" action="/settings/notifications"><label><input type="checkbox" name="weekly"> Weekly digest</label><label><input type="checkbox" name="news" checked> Product news</label><label><input type="checkbox" name="tips" checked> Tips</label><button>Save</button> <button type="reset">Undo changes</button></form>'));
    if (p === '/help') return say(200, page('Help', Object.keys(HELP).map((s) => `<h2>${s[0].toUpperCase() + s.slice(1)}</h2><ul>${Object.entries(HELP[s]).map(([k, [t]]) => `<li><a href="/help/${s}/${k}">${t}</a></li>`).join('')}</ul>`).join('')));
    const help = p.match(/^\/help\/([a-z]+)\/([a-z]+)$/);
    if (help && HELP[help[1]]?.[help[2]]) return say(200, page(HELP[help[1]][help[2]][0], HELP[help[1]][help[2]][1]));
    if (['/about', '/careers', '/privacy', '/settings/profile', '/settings/security', '/settings/billing'].includes(p)) return say(200, page(p.split('/').pop(), '<p>Nothing to see here.</p>'));
    say(404, page('Not found', '<p>No such page.</p>'));
  });
}

// ---------- the bridge, through the bench computer's relay ----------
function bridge(body, ms = 60_000) {
  const [host, port] = opt('bridge', '').split(':');
  return new Promise((resolve) => {
    const s = net.connect(Number(port), host);
    let out = '';
    const t = setTimeout(() => { s.destroy(); resolve({ ok: false, error: 'The browser did not respond.' }); }, ms);
    s.on('connect', () => s.end(JSON.stringify(body)));
    s.on('data', (c) => { out += c; });
    s.on('close', () => { clearTimeout(t); try { resolve(JSON.parse(out)); } catch { resolve({ ok: false, error: 'The browser answered no JSON.' }); } });
    s.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: `The browser was not reached: ${e.message}` }); });
  });
}

// ---------- botdot's routes for the browser tools, as lib/routes/computers.js has them ----------
function vault(state) {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/session/computer') return send({ ok: true });
      if (req.url !== '/session/computer/browser') return send({ ok: false, error: 'Not in the bench' });
      const body = JSON.parse(raw || '{}');
      const payload = { op: body.op };
      for (const k of ['ref', 'text', 'key', 'url', 'what', 'question', 'goal']) if (body[k] !== undefined) payload[k] = String(body[k]).slice(0, 10000);
      if (body.seconds !== undefined) payload.seconds = Math.min(Math.max(Number(body.seconds) || 10, 1), 15);
      const { picked, picks, ...r } = await state.picker.handle(payload, (p) => bridge(p));
      state.calls.push(payload.op + (payload.what !== undefined && !payload.ref ? ':what' : '') + (picks ? `:${picks.length}` : ''));
      state.jev.push(...(picks || (picked ? [picked] : [])));
      send(r);
    });
  });
}

const listen = (srv, host) => new Promise((resolve) => srv.listen(0, host, () => resolve(srv.address().port)));

function claude(task, mcpFile, ms) {
  const system = 'You are a bot of botdot working on your own computer. Its web browser, Camoufox, is already open at the page the task starts on: '
    + 'work it with your browser tools alone. End your reply with one line: ANSWER: <the answer>.';
  return new Promise((resolve) => {
    const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
    delete env.CLAUDECODE;
    const child = spawn(process.env.CLAUDE_BIN || 'claude', ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', system, '--setting-sources', '', '--tools', '',
      '--mcp-config', mcpFile, '--strict-mcp-config', '--allowedTools', 'mcp__computer', '--no-session-persistence', '--max-turns', '40'], { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'ignore'] });
    const t = setTimeout(() => child.kill('SIGKILL'), ms);
    let buf = '';
    let result = null;
    let model = null;
    child.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const e = JSON.parse(line); if (e.type === 'result') result = e; if (e.type === 'system' && e.model) model = e.model; } catch { /* not JSON */ }
      }
    });
    child.on('close', () => { clearTimeout(t); resolve({ result, model }); });
    child.stdin.end(task);
  });
}

function checked(task, text, posted) {
  const last = String(text || '').trim().split('\n').reverse().find((l) => /ANSWER:/i.test(l)) || '';
  const answer = last.replace(/.*ANSWER:\s*/i, '');
  let ok = new RegExp(task.answer, 'i').test(answer);
  if (task.id === 'missing' && /\$\s?\d/.test(answer)) ok = false;
  if (task.posted) {
    const got = posted.filter((p) => p.path === task.posted.path).pop();
    ok = ok && !!got && Object.entries(task.posted.fields).every(([k, v]) => (v === null ? !(k in got.fields) : got.fields[k] === v));
  }
  return { ok, answer: answer.slice(0, 120) };
}

const PROBES = [
  ['/', 'click', 'the link to the shop'], ['/shop/shoes', 'click', 'View Trail Runner 3'], ['/shop/shoes', 'click', 'the View link of Trail Runner 3'],
  ['/shop/p/trail-runner-3', 'find', 'the price of Trail Runner 3'], ['/orders?page=5', 'find', 'the status of order #1047'], ['/offices', 'click', 'Kraków'],
  ['/docs', 'fill', 'the search box'], ['/newsletter', 'click', 'Release notes'], ['/settings/notifications', 'click', 'Weekly digest checkbox'], ['/help', 'click', 'Refund policy'],
  ['/orders', 'click', 'next page'], ['/offices/krakow', 'find', 'phone number'],
];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

async function main() {
  const key = process.env.OPENROUTER_API_KEY || (process.env.OPENROUTER_KEY_FILE && fs.readFileSync(process.env.OPENROUTER_KEY_FILE, 'utf8').trim());
  const arms = opt('arms', 'refs,jev').split(',');
  if (arms.some((a) => a !== 'refs') && !key) throw new Error('The jev arm needs $OPENROUTER_API_KEY or $OPENROUTER_KEY_FILE.');
  const reps = Number(opt('reps', '1'));
  const only = opt('only', '') ? opt('only').split(',') : null;
  const siteBase = opt('site', '').replace(/\/+$/, '');
  const posted = [];
  const srv = site(posted);
  await new Promise((r) => srv.listen(Number(opt('site-port', '8099')), '0.0.0.0', r));
  const state = { calls: [], jev: [], picker: null };
  const vaultPort = await listen(vault(state), '127.0.0.1');
  if (args.includes('--probe')) { // what Jev picks on the bench's pages: one line per question, in PROBES
    const p = picker.create({ config: () => ({ router: 'jev', key, browserPicker: true }) });
    for (const [where, op, said] of PROBES) {
      await bridge({ op: 'goto', url: siteBase + where });
      const r = op === 'find' ? await p.find({ question: said }, bridge) : await p.pick({ op, what: said }, bridge);
      const shown = op === 'find' ? r.snapshot : r.likely?.map((l) => `${l.label} ${l.p.toFixed(2)}`).join('; ');
      console.log(`${where} ${op} ${JSON.stringify(said)} -> ${String(shown || r.error).replace(/\n/g, ' | ').slice(0, 300)} (${r.picked?.ms} ms)`);
    }
    return;
  }
  const runs = [];
  for (let rep = 0; rep < reps; rep++) {
    for (const task of tasks.filter((t) => !only || only.includes(t.id))) {
      for (const arm of arms) {
        state.picker = picker.create({ config: () => ({ router: 'jev', key, browserPicker: arm !== 'refs' }), brief: arm === 'brief' });
        state.calls = []; state.jev = []; posted.length = 0;
        const start = task.start.replace('{site}', siteBase);
        await bridge({ op: 'goto', url: start });
        const mcpFile = path.join(os.tmpdir(), `browser-bench-${process.pid}.json`);
        fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { computer: { command: process.execPath, args: [__filename, '--mcp'], env: { VAULT_URL: `http://127.0.0.1:${vaultPort}`, VAULT_TOKEN: 'bench', ...(arm !== 'refs' ? { BROWSER_PICKER: arm === 'brief' ? 'brief' : 'on' } : {}) } } } }));
        const t0 = Date.now();
        const { result, model } = await claude(`${task.task}\nThe task starts on ${start}.`, mcpFile, 300_000);
        const secs = (Date.now() - t0) / 1000;
        const check = checked(task, result?.result, posted);
        const run = { task: task.id, arm, rep, ok: check.ok, answer: check.answer, secs, steps: state.calls.length, calls: state.calls, turns: result?.num_turns ?? null,
          claudeCost: result?.total_cost_usd ?? null, inputTokens: result?.usage ? (result.usage.input_tokens || 0) + (result.usage.cache_read_input_tokens || 0) + (result.usage.cache_creation_input_tokens || 0) : null,
          outputTokens: result?.usage?.output_tokens ?? null, jevCalls: state.jev.length, jevCost: state.jev.reduce((a, j) => a + j.cost, 0), jevMs: median(state.jev.map((j) => j.ms)), unsure: state.jev.filter((j) => j.p < picker.SURE).length, model, live: !!task.live };
        runs.push(run);
        console.error(`${task.id.padEnd(12)} ${arm.padEnd(4)} ${run.ok ? 'ok  ' : 'FAIL'} ${secs.toFixed(0).padStart(4)} s ${String(run.steps).padStart(3)} steps $${(run.claudeCost ?? 0).toFixed(3)} jev $${run.jevCost.toFixed(5)}  ${run.answer}`);
        fs.appendFileSync(opt('log', path.join(os.tmpdir(), 'browser-bench.jsonl')), JSON.stringify(run) + '\n');
      }
    }
  }
  srv.close();
  const table = arms.map((arm) => {
    const rs = runs.filter((r) => r.arm === arm);
    return { arm, runs: rs.length, success: rs.filter((r) => r.ok).length, medianSecs: median(rs.map((r) => r.secs)), meanSteps: rs.reduce((a, r) => a + r.steps, 0) / (rs.length || 1),
      claudeCost: rs.reduce((a, r) => a + (r.claudeCost || 0), 0), jevCost: rs.reduce((a, r) => a + r.jevCost, 0), inputTokens: rs.reduce((a, r) => a + (r.inputTokens || 0), 0) };
  });
  if (args.includes('--json')) return console.log(JSON.stringify({ table, runs }, null, 2));
  for (const r of table) console.log(`${r.arm}: ${r.success}/${r.runs} ok, median ${r.medianSecs.toFixed(0)} s, ${r.meanSteps.toFixed(1)} steps, Claude $${r.claudeCost.toFixed(2)}, Jev $${r.jevCost.toFixed(4)}, ${r.inputTokens} input tokens`);
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
