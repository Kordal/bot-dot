#!/usr/bin/env node
// Stdio MCP server giving a bot mouse, keyboard, screen and shell access to its own Linux desktop.
// Talks to cua's computer-server inside the bot's container (POST /cmd), through botdot with this
// run's key: the computer itself takes no incoming connections. Shell and file tools go to botdot's own routes, which
// run them with no screen (#134).
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
// What a command is for, in the bot's words: the owner reads it as the bot's working line (#232). The command never is.
const DESCRIBE = { description: { type: 'string', description: 'What this command does, in a few plain words, e.g. "Check disk space". Shown to the owner: never a secret, a path or the command itself' } };

// Actions that change the screen answer with a fresh screenshot, saving the bot a round trip.
const withScreen = (fn) => async (args) => {
  const note = await fn(args);
  await sleep(SETTLE_MS);
  return [{ type: 'text', text: note }, await screenshotContent()];
};

// run_shell, run_with_login, run_with_ssh_key and run_with_file: one command that botdot runs in the computer, with no screen (#134),
// and what came back (botdot blanks a saved secret out of it). Up to 600 s, plus the time to start and load the secret.
async function runCommand(route, body, timeoutSeconds = 120) {
  await ready();
  const seconds = Math.min(Math.max(Number(timeoutSeconds) || 120, 1), 600);
  const r = await vault(`/session/computer/${route}`, { ...body, timeoutSeconds: seconds }, (seconds + 90) * 1000);
  const out = [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, r.exitCode != null && `exit code: ${r.exitCode}`,
    r.timedOut && `It ran out of time after ${seconds} seconds.`, r.note && !r.timedOut && `Note: ${r.note}`].filter(Boolean).join('\n');
  return [{ type: 'text', text: (out || '(no output)').slice(0, 20000) }];
}

// The browser tools (#170): the focused Camoufox page as its accessibility tree, a ref on each control, and actions by
// ref. Each answers with the page's new tree and no screenshot: far cheaper than a screenshot per step.
async function browserTool(body) {
  await ready();
  const r = await vault('/session/computer/browser', body);
  return [{ type: 'text', text: r.snapshot }];
}
const REF = { type: 'string', description: 'A ref from your last browser_snapshot, e.g. "e12"' };

// Every bot of the account works on its computer as box with sudo (ADR 035): what botdot types or hands to a command
// there, each of them can read. Said in every tool that uses a saved secret there (#106).
const SHARED = " Every other bot on the account's computer can read what botdot types or hands to a command there, as they all have sudo: never use sudo to read another bot's.";

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
      // Its own Camoufox, on its own screen (#105): another bot's open browser is not this one's.
      const running = await cmd('run_command', { command: 'camoufox-browser --is-open && echo yes || echo no', timeout: 10 });
      if (String(running.stdout).trim() === 'yes') {
        return [{ type: 'text', text: 'Camoufox is already open. Click its window, press ctrl+l and type the address.' }, await screenshotContent()];
      }
      await startDetached(`camoufox-browser ${shq(url)} >/tmp/camoufox.log 2>&1`);
      await sleep(7000); // first launch takes a few seconds
      return [{ type: 'text', text: `Opened Camoufox at ${url}` }, await screenshotContent()];
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Read the page open in Camoufox as text: its accessibility tree, where each control has a ref, e.g. button "Log in" [ref=e12]. ' +
      'Prefer this and the other browser_ tools to screenshots for web pages: they are faster and never miss. ' +
      'Use a screenshot for captchas, drawings, maps and anything the tree does not show. Open the browser with open_browser first.',
    inputSchema: { type: 'object', properties: {} },
    run: () => browserTool({ op: 'snapshot' }),
  },
  {
    name: 'browser_click',
    description: 'Click a control of the page by its ref from your last browser_snapshot. Returns the new snapshot.',
    inputSchema: { type: 'object', properties: { ref: REF }, required: ['ref'] },
    run: ({ ref }) => browserTool({ op: 'click', ref }),
  },
  {
    name: 'browser_fill',
    description: 'Replace the text of a box of the page, by its ref from your last browser_snapshot. Returns the new snapshot. ' +
      'Refused for password, card and two-step code boxes: click those and use type_login, type_card or type_identity.',
    inputSchema: { type: 'object', properties: { ref: REF, text: { type: 'string' } }, required: ['ref', 'text'] },
    run: ({ ref, text }) => browserTool({ op: 'fill', ref, text }),
  },
  {
    name: 'browser_press',
    description: 'Press a key in the page, e.g. "Enter", "Tab", "PageDown", "Escape" or "Control+a". Returns the new snapshot.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: ({ key }) => browserTool({ op: 'press', key }),
  },
  {
    name: 'browser_goto',
    description: 'Go to an http or https address in the open Camoufox tab. Returns the new snapshot.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    run: ({ url }) => browserTool({ op: 'goto', url }),
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a text, or a control by its ref, shows on the page, up to 15 seconds. Returns the new snapshot.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, ref: REF, seconds: { type: 'number', description: 'Default 10, max 15' } } },
    run: ({ text, ref, seconds }) => browserTool({ op: 'wait', text, ref, seconds }),
  },
  {
    name: 'type_login',
    description: 'Type a saved username, password or two-step code (totp, from Bitwarden) into the box you just clicked in Camoufox. botdot types it for you: you never see it. The browser must be on the login\'s website, or exactly on one of its allowedHosts, and the right box must be selected.' + SHARED,
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
      'after that you can type the other fields. Fields: number, code (CVC), expiry (MM/YY), expMonth, expYear, cardholderName.' + SHARED,
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
    description: "Type a detail of a saved identity (from list_logins: name, email, phone, address…) into the form box you just clicked in Camoufox." + SHARED,
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
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, ...DESCRIBE }, required: ['command'] },
    run: withScreen(async ({ command }) => { await startDetached(command); await sleep(1500); return `Started: ${command}`; }),
  },
  {
    name: 'keep_computer_on',
    description: "You need not call this: the account's computer stays on after you reply, with your screen's windows and programs, " +
      'also when your reply asks the owner to do a step by hand on it. Calling it changes nothing.',
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
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, ...DESCRIBE, timeoutSeconds: { type: 'number', description: 'Default 120' } }, required: ['command'] },
    run: ({ command, timeoutSeconds }) => runCommand('shell', { command }, timeoutSeconds),
  },
  {
    name: 'run_with_login',
    description:
      'Run one shell command on your computer with a saved login filled in as the environment variables BOTDOT_USERNAME and BOTDOT_PASSWORD, ' +
      'e.g. to sign in to a program that runs there: curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/INBOX, ' +
      'or python3 -c "import os, imaplib; m = imaplib.IMAP4(\'127.0.0.1\', 1143); m.login(os.environ[\'BOTDOT_USERNAME\'], os.environ[\'BOTDOT_PASSWORD\']); print(m.select(\'INBOX\'))". ' +
      'For several saved logins in one command (an API that signs each request with several secrets), give logins, a list of up to 8 names, instead of login: ' +
      'each login is then in BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD, <NAME> its name in list_logins in capitals with every other character than A-Z and 0-9 turned into _ ' +
      '(OVH_APPLICATION_KEY gives "$BOTDOT_OVH_APPLICATION_KEY_PASSWORD"), and BOTDOT_USERNAME and BOTDOT_PASSWORD are not set. ' +
      'Only refer to them as "$BOTDOT_USERNAME" and "$BOTDOT_PASSWORD" (or os.environ in a script), and with logins as "$BOTDOT_<NAME>_PASSWORD". Never print, store or encode a password, and never write it to a file: ' +
      'it is blanked out of the output anyway. Returns stdout, stderr and the exit code; waits until the command finishes. ' +
      'Works only with logins the owner shared with you and marked "Usable in its computer" (inComputer in list_logins); otherwise ask the owner for each with ask_vault_switch (switch "inComputer").' + SHARED,
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'Login name or address from list_logins' },
        logins: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Instead of login: up to 8 login names from list_logins, each in its own BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD' },
        command: { type: 'string', description: 'One shell command, run with sh -c, that uses "$BOTDOT_USERNAME" and "$BOTDOT_PASSWORD" (with logins: "$BOTDOT_<NAME>_PASSWORD")' },
        ...DESCRIBE,
        timeoutSeconds: { type: 'number', description: 'Default 120, max 600' },
      },
      required: ['command'],
    },
    run: ({ login, logins, command, timeoutSeconds }) => runCommand('run-with-login', { login, logins, command }, timeoutSeconds),
  },
  {
    name: 'run_with_ssh_key',
    description:
      'Run one shell command on your computer with a saved SSH key (kind "ssh-key" in list_logins) loaded into an ssh-agent, so ssh, scp and git use it: ' +
      'e.g. ssh -o StrictHostKeyChecking=accept-new admin@server.example.ts.net uptime. SSH_AUTH_SOCK points to that agent for this command only; ' +
      'you never see the private key, and the agent and the key are gone when the command ends. Returns stdout, stderr and the exit code; waits until the command finishes, so the command must not ask for input. ' +
      'Works only with an SSH key the owner shared with you; for one listed with shared: false, ask the owner to share it with you in the Vault.' +
      ' While the command runs, other bots could use the agent too.' + SHARED,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The SSH key\'s name from list_logins' },
        command: { type: 'string', description: 'One shell command, run with sh -c, e.g. ssh user@host \'df -h\'' },
        ...DESCRIBE,
        timeoutSeconds: { type: 'number', description: 'Default 120, max 600' },
      },
      required: ['key', 'command'],
    },
    run: ({ key, command, timeoutSeconds }) => runCommand('run-with-ssh-key', { key, command }, timeoutSeconds),
  },
  {
    name: 'run_with_file',
    description:
      'Run one shell command on your computer with a saved file (kind "file" in list_logins, e.g. a .pem key, a certificate or a config file) at the path in the environment variable BOTDOT_FILE: ' +
      'e.g. openssl dgst -sha256 -sign "$BOTDOT_FILE" -out sig.bin data.txt, or curl --cert "$BOTDOT_FILE" https://host/api. ' +
      'The file exists for this command only, with mode 0600, and is removed when the command ends, fails or runs out of time. ' +
      'Only refer to it as "$BOTDOT_FILE": never print, copy, store or encode its content; it is blanked out of the output anyway. Returns stdout, stderr and the exit code; waits until the command finishes. ' +
      'Works only with a file the owner shared with you; for one listed with shared: false, ask the owner to share it with you in the Vault.' + SHARED,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'The file\'s name from list_logins' },
        command: { type: 'string', description: 'One shell command, run with sh -c, that uses "$BOTDOT_FILE"' },
        ...DESCRIBE,
        timeoutSeconds: { type: 'number', description: 'Default 120, max 600' },
      },
      required: ['file', 'command'],
    },
    run: ({ file, command, timeoutSeconds }) => runCommand('run-with-file', { file, command }, timeoutSeconds),
  },
  {
    name: 'read_file',
    description: 'Read a text file from your computer.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path }) => {
      await ready();
      const r = await vault('/session/computer/read', { path });
      return [{ type: 'text', text: String(r.content ?? '').slice(0, 50000) }];
    },
  },
  {
    name: 'write_file',
    description: 'Write a text file on your computer.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async ({ path, content }) => {
      await ready();
      await vault('/session/computer/write', { path, content });
      return [{ type: 'text', text: `Wrote ${path}` }];
    },
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
