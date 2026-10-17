#!/usr/bin/env node
// Stdio MCP server giving a bot mouse, keyboard, screen and shell access to its own Linux desktop.
// Talks to cua's computer-server inside the bot's container (POST /cmd), through botdot with this
// run's key: the computer itself takes no incoming connections.
const readline = require('readline');

const CONTAINER = process.env.COMPUTER_CONTAINER; // for launching GUI programs detached
const VAULT_URL = process.env.VAULT_URL;
const VAULT_TOKEN = process.env.VAULT_TOKEN;

// bot-dot types saved logins itself; this process only ever sees the login's name.
async function vault(pathname, body, timeoutMs = 90_000) { // may wait for the owner to unlock Bitwarden
  if (!VAULT_URL || !VAULT_TOKEN) throw new Error('Saved logins are not available on this computer');
  const res = await fetch(`${VAULT_URL}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Vault-Token': VAULT_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// The computer is off until a tool needs it; the first call asks botdot to start it (about 20 s,
// longer the very first time while the desktop image downloads).
let started = false;
let starting = null;
async function ready() {
  if (started) return;
  starting ||= vault('/session/computer', {}, 20 * 60_000).then(() => { started = true; }).finally(() => { starting = null; });
  return starting;
}

// computer-server's shell waits for every child to exit, so GUI apps are started detached, by
// botdot (`docker exec -d` in this bot's own container; the bot itself can't use Docker).
async function startDetached(command) {
  await ready();
  if (!CONTAINER) throw new Error('Starting programs is not available on this computer');
  await vault('/session/computer/launch', { command });
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const SETTLE_MS = 600; // let the UI react before the follow-up screenshot

async function cmd(command, params = {}) {
  await ready();
  const { text } = await vault('/session/computer/cmd', { command, params }, Math.max(120, (params.timeout || 0) + 30) * 1000);
  // Response is one SSE-style line: "data: {...}"
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  const data = JSON.parse(line ? line.slice(5) : text);
  if (data.success === false) throw new Error(data.error || `${command} failed`);
  return data;
}

async function screenshotContent() {
  const shot = await cmd('screenshot');
  const b64 = shot.image_data || shot.screenshot || shot.data;
  if (!b64) throw new Error('Screenshot returned no image');
  return { type: 'image', data: b64, mimeType: 'image/png' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xy = { x: { type: 'integer', description: 'Pixels from the left' }, y: { type: 'integer', description: 'Pixels from the top' } };

// Actions that change the screen answer with a fresh screenshot, saving the bot a round trip.
const withScreen = (fn) => async (args) => {
  const note = await fn(args);
  await sleep(SETTLE_MS);
  return [{ type: 'text', text: note }, await screenshotContent()];
};

const TOOLS = [
  {
    name: 'screenshot',
    description: 'See the current screen of your computer. Start with this.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => [await screenshotContent()],
  },
  {
    name: 'send_screenshot',
    description: 'Send the owner a screenshot of your screen right now, e.g. a QR code they must scan or a 2FA prompt. ' +
      'It reaches them at once, while you keep working (say, to watch the page until they have scanned it). No need to save or attach a file.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'A plain file name, e.g. "ING-QR-code"' } } },
    run: async ({ name }) => {
      await ready();
      const { file } = await vault('/session/computer/share', { name });
      return [{ type: 'text', text: `Sent ${file.name} to the owner.` }];
    },
  },
  {
    name: 'screen_size',
    description: 'Get the screen width and height in pixels.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await cmd('get_screen_size');
      return [{ type: 'text', text: JSON.stringify(r.size || { width: r.width, height: r.height }) }];
    },
  },
  {
    name: 'click',
    description: 'Click at a screen position. Returns a new screenshot.',
    inputSchema: {
      type: 'object',
      properties: { ...xy, button: { type: 'string', enum: ['left', 'right'], default: 'left' }, double: { type: 'boolean', description: 'Double-click' } },
      required: ['x', 'y'],
    },
    run: withScreen(async ({ x, y, button = 'left', double = false }) => {
      await cmd(double ? 'double_click' : button === 'right' ? 'right_click' : 'left_click', { x, y });
      return `${double ? 'Double-clicked' : button === 'right' ? 'Right-clicked' : 'Clicked'} at ${x},${y}`;
    }),
  },
  {
    name: 'move_mouse',
    description: 'Move the mouse pointer (e.g. to hover). Returns a new screenshot.',
    inputSchema: { type: 'object', properties: xy, required: ['x', 'y'] },
    run: withScreen(async ({ x, y }) => { await cmd('move_cursor', { x, y }); return `Moved to ${x},${y}`; }),
  },
  {
    name: 'drag',
    description: 'Drag with the left button from one position to another. Returns a new screenshot.',
    inputSchema: {
      type: 'object',
      properties: { fromX: { type: 'integer' }, fromY: { type: 'integer' }, toX: { type: 'integer' }, toY: { type: 'integer' } },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
    run: withScreen(async ({ fromX, fromY, toX, toY }) => {
      await cmd('move_cursor', { x: fromX, y: fromY });
      await cmd('drag_to', { x: toX, y: toY });
      return `Dragged to ${toX},${toY}`;
    }),
  },
  {
    name: 'type_text',
    description: 'Type text with the keyboard into the focused field. Returns a new screenshot.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: withScreen(async ({ text }) => { await cmd('type_text', { text }); return `Typed ${text.length} characters`; }),
  },
  {
    name: 'press_keys',
    description: 'Press a key or a key combination, e.g. ["enter"], ["ctrl","l"], ["alt","tab"]. Returns a new screenshot.',
    inputSchema: { type: 'object', properties: { keys: { type: 'array', items: { type: 'string' } } }, required: ['keys'] },
    run: withScreen(async ({ keys }) => {
      if (keys.length === 1) await cmd('press_key', { key: keys[0] });
      else await cmd('hotkey', { keys });
      return `Pressed ${keys.join('+')}`;
    }),
  },
  {
    name: 'scroll',
    description: 'Scroll at a position. Returns a new screenshot.',
    inputSchema: {
      type: 'object',
      properties: { ...xy, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer', description: 'Wheel clicks, default 5' } },
      required: ['direction'],
    },
    run: withScreen(async ({ x, y, direction, amount = 5 }) => {
      if (x != null && y != null) await cmd('move_cursor', { x, y });
      const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
      const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
      await cmd('scroll', { x: dx, y: dy });
      return `Scrolled ${direction}`;
    }),
  },
  {
    name: 'open_browser',
    description: 'Open the Camoufox web browser at a URL. If it is already open, use its address bar instead (ctrl+l). Returns a screenshot.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    run: async ({ url = 'about:blank' }) => {
      const running = await cmd('run_command', { command: "pgrep -f 'camoufox-[b]in' >/dev/null && echo yes || echo no", timeout: 10 });
      if (String(running.stdout).trim() === 'yes') {
        return [{ type: 'text', text: 'Camoufox is already open. Click its window, press ctrl+l and type the address.' }, await screenshotContent()];
      }
      await startDetached(`camoufox-browser ${shq(url)} >/tmp/camoufox.log 2>&1`);
      await sleep(7000); // first launch takes a few seconds
      return [{ type: 'text', text: `Opened Camoufox at ${url}` }, await screenshotContent()];
    },
  },
  {
    name: 'type_login',
    description: 'Type a saved username, password or two-step code (totp, from Bitwarden) into the box you just clicked in Camoufox. botdot types it for you: you never see it. The browser must be on the login\'s website, or exactly on one of its allowedHosts, and the right box must be selected.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'Login name or website from list_logins' },
        field: { type: 'string', enum: ['username', 'password', 'totp'] },
        submit: { type: 'boolean', description: 'Press Enter afterwards' },
      },
      required: ['login', 'field'],
    },
    run: async ({ login, field, submit = false }) => {
      const r = await vault('/session/type', { login, field, submit });
      await sleep(submit ? 2500 : 400);
      // For passwords, no automatic screenshot: take one yourself if you need to check the result.
      const note = `Typed the saved ${field} for ${r.name}${submit ? ' and pressed Enter' : ''}.`;
      return field === 'password' ? [{ type: 'text', text: note }] : [{ type: 'text', text: note }, await screenshotContent()];
    },
  },
  {
    name: 'type_card',
    description:
      'Type a detail of a saved payment card (from list_logins) into the checkout box you just clicked in Camoufox. You never see the card. ' +
      'Only pay when the owner asked for this purchase. The first time on a site, the owner gets a pop-up to approve it (with your reason and the amount), and this waits for their answer; ' +
      'after that you can type the other fields. Fields: number, code (CVC), expiry (MM/YY), expMonth, expYear, cardholderName.',
    inputSchema: {
      type: 'object',
      properties: {
        card: { type: 'string', description: 'Card name from list_logins' },
        field: { type: 'string', enum: ['number', 'code', 'expiry', 'expMonth', 'expYear', 'cardholderName'] },
        reason: { type: 'string', description: 'What you are buying and why, shown to the owner' },
        amount: { type: 'string', description: 'Total to pay, e.g. "€24.90"' },
        submit: { type: 'boolean', description: 'Press Enter afterwards' },
      },
      required: ['card', 'field', 'reason', 'amount'],
    },
    run: async (args) => {
      let r = await vault('/session/card', args);
      if (r.needsApproval) {
        const until = Date.now() + 10 * 60_000;
        let answer = null;
        while (Date.now() < until) {
          const w = await vault(`/session/request/${r.id}/wait`);
          if (w.status !== 'pending') { answer = w.status; break; }
        }
        if (answer !== 'allowed') return [{ type: 'text', text: answer === 'declined' ? 'The owner declined this payment. Do not pay; explain what happened.' : 'The owner did not approve the payment in time. Do not pay; stop and explain.' }];
        r = await vault('/session/card', args);
      }
      await sleep(400);
      return [{ type: 'text', text: `Typed the card ${args.field} for ${r.name}. Check the page before you confirm the payment.` }];
    },
  },
  {
    name: 'type_identity',
    description: "Type a detail of a saved identity (from list_logins: name, email, phone, address…) into the form box you just clicked in Camoufox.",
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string', description: 'Identity name from list_logins' },
        field: { type: 'string', enum: ['title', 'firstName', 'middleName', 'lastName', 'fullName', 'company', 'email', 'phone', 'address1', 'address2', 'address3', 'city', 'state', 'postalCode', 'country', 'username'] },
        submit: { type: 'boolean' },
      },
      required: ['identity', 'field'],
    },
    run: async ({ identity, field, submit = false }) => {
      await vault('/session/identity', { identity, field, submit });
      await sleep(300);
      return [{ type: 'text', text: `Typed ${field}.` }, await screenshotContent()];
    },
  },
  {
    name: 'start_program',
    description: 'Start a long-running or GUI program in the background (it keeps running after this returns), e.g. "xfce4-terminal" or "python3 -m http.server 8080".',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    run: withScreen(async ({ command }) => { await startDetached(command); await sleep(1500); return `Started: ${command}`; }),
  },
  {
    name: 'keep_computer_on',
    description: 'Keep your computer on after you reply, with its windows and programs, because your reply asks the owner to do a step by hand on it ' +
      "(type a password into a program you started, say). Call it just before you reply. It stays on until the owner's next message to you, or 1 hour at most.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      await ready();
      const { text } = await vault('/session/computer/hold', {});
      return [{ type: 'text', text }];
    },
  },
  {
    name: 'run_shell',
    description: 'Run a shell command on your computer (Ubuntu) and get its output. Waits until it finishes, so use start_program for anything that keeps running.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeoutSeconds: { type: 'number', description: 'Default 120' } }, required: ['command'] },
    run: async ({ command, timeoutSeconds = 120 }) => {
      const r = await cmd('run_command', { command, timeout: Math.min(timeoutSeconds, 600) });
      const out = [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, r.return_code != null && `exit code: ${r.return_code}`].filter(Boolean).join('\n');
      return [{ type: 'text', text: (out || '(no output)').slice(0, 20000) }];
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file from your computer.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path }) => {
      const r = await cmd('read_text', { path });
      return [{ type: 'text', text: String(r.content ?? '').slice(0, 50000) }];
    },
  },
  {
    name: 'write_file',
    description: 'Write a text file on your computer.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async ({ path, content }) => { await cmd('write_text', { path, content }); return [{ type: 'text', text: `Wrote ${path}` }]; },
  },
];

// ---------- JSON-RPC plumbing ----------

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle({ id, method, params }) {
  if (id === undefined) return;
  if (method === 'initialize') {
    return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'computer', version: '0.1.0' } } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool ${params.name}` } });
    try {
      return send({ id, result: { content: await tool.run(params.arguments || {}) } });
    } catch (e) {
      return send({ id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } });
    }
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); } catch { /* ignore bad input */ }
});
