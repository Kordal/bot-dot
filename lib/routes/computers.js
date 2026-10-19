// A bot's computer (its desktop, lib/computers.js): what the owner and the Chief do with it (/api/bots/:id/computer),
// and the bot's own computer tools (/api/vault/session/computer/...). bots.js and vault.js hand their requests on here.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const vaultHttp = require('../vault-http');

function create(ctx) {
  const { readyForSecrets, store, bitwarden } = ctx;
  // What a command run in a bot's computer with a saved secret answers (run-with-login, run-with-ssh-key): its output,
  // each part cut at 20000 characters, with `hide` blanking the secret out of everything.
  function ranWithSecret(r, hide) {
    if (r.code == null && !r.stdout && !r.stderr) return { ok: false, error: hide(`Couldn't run it: ${r.error || 'no answer from the computer'}`) };
    const cut = (t) => { t = hide(t || ''); return t.length > 20000 ? `${t.slice(0, 20000)}\n…(cut off)` : t; };
    return { ok: true, stdout: cut(r.stdout), stderr: cut(r.stderr), exitCode: r.code ?? null, ...(r.timedOut ? { timedOut: true } : {}), ...(r.error ? { note: hide(r.error) } : {}) };
  }
  // Handed on from bots.js: NEXT when none of them is asked for.
  async function ofBot(req, res, url, { parts, m, id, bot }) {
    // What the Chief reads to debug it (#59): Docker's state and the last failed start, and its recent logs.
    if (parts[2] === 'computer' && parts[3] === 'status' && m === 'GET') return send(res, 200, await B.computers.health(id));
    if (parts[2] === 'computer' && parts[3] === 'logs' && m === 'GET') {
      const lines = Math.max(1, Math.min(500, Math.floor(Number(url.searchParams.get('lines'))) || 100));
      return send(res, 200, await B.computers.logs(id, lines));
    }
    if (parts[2] === 'computer' && !parts[3] && m === 'GET') return send(res, 200, await B.computers.details(id));
    // Off and on again, for a computer that is stuck or didn't start (#59). It keeps everything on it, so the Chief may
    // do it without an OK; erasing one stays the owner's. A start that fails is the answer, not an error: the Chief says why.
    if (parts[2] === 'computer' && parts[3] === 'restart' && m === 'POST') {
      if (bot.computer !== 'linux') return send(res, 409, { error: 'This bot has no computer' });
      if (B.isBotRunning(id)) return send(res, 409, { error: 'Wait until the bot finishes its run' });
      await B.computers.stop(id);
      try { await B.computers.ensure(id); } catch (e) { return send(res, 200, { ok: false, state: (await B.computers.inspect(id)).state, error: e.message }); }
      return send(res, 200, { ok: true, state: 'running' });
    }
    if (parts[2] === 'computer' && !parts[3] && m === 'POST') {
      const { action } = await readBody(req);
      if (action === 'start') { await B.computers.ensure(id); return send(res, 200, { state: 'running' }); }
      if (B.isBotRunning(id)) return send(res, 409, { error: 'Wait until the bot finishes its run' });
      // Every bot works on the account's one computer, which stays on for all of them (#104, ADR 035).
      if (action === 'stop') {
        B.endComputerHold(id); // it was kept on for the owner's step: the owner ended that (#340)
        return send(res, 409, { error: "The account's computer stays on: every bot with a computer works on it." });
      }
      // Erases the bot's old computer of its own, never the account's computer (#104).
      if (action === 'reset') {
        B.endComputerHold(id);
        await B.computers.reset(id);
        const { state } = await B.computers.inspect(id);
        return send(res, 200, { state });
      }
      return send(res, 400, { error: 'Unknown action' });
    }
    return NEXT;
  }
  // Handed on from vault.js: NEXT when none of them is asked for.
  async function ofSession(req, res, url, { parts, m, session }) {
    // A bot's first computer tool: start its computer now and hand over its address.
    // Start a program on the bot's own desktop, detached (bots can't use Docker themselves).
    if (parts[2] === 'computer' && parts[3] === 'launch' && m === 'POST') {
      const { command } = await readBody(req);
      if (!session.container) return send(res, 200, { ok: false, error: "This bot doesn't have a computer" });
      if (!command || typeof command !== 'string' || command.length > 4000) return send(res, 400, { ok: false, error: 'Say which program to start' });
      try {
        await B.computers.startProgram(session.botId, command);
        return send(res, 200, { ok: true });
      } catch (e) { return send(res, 200, { ok: false, error: `Couldn't start it: ${e.message}` }); }
    }
    if (parts[2] === 'computer' && !parts[3] && m === 'POST') {
      try { await B.computerForRun(session.runId); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: `Couldn't start the computer: ${e.message}` }); }
    }
    // keep_computer_on: the bot waits for the owner to do a step on its computer, which stays on after this run (#340).
    if (parts[2] === 'computer' && parts[3] === 'hold' && m === 'POST') {
      if (!session.container) return send(res, 200, { ok: false, error: "This bot doesn't have a computer" });
      try {
        const kept = await B.keepComputerOn(session.runId);
        if (kept === 'always-on') return send(res, 200, { ok: true, text: 'Your computer is set to stay on all the time, so it stays on after you reply anyway.' });
        return send(res, 200, { ok: true, text: "Your computer stays on after you reply, with everything open on it, until the owner's next message to you or for 1 hour at most. Say that in your reply." });
      } catch (e) { return send(res, 200, { ok: false, error: `Couldn't keep the computer on: ${e.message}` }); }
    }
    // A command for the computer-server (click, type, screenshot, shell…), passed on inside the bot's own computer.
    if (parts[2] === 'computer' && parts[3] === 'cmd' && m === 'POST') {
      if (!session.container) return send(res, 200, { ok: false, error: "This bot doesn't have a computer" });
      const { command, params = {} } = await readBody(req);
      if (!command || typeof command !== 'string') return send(res, 400, { ok: false, error: 'Say which command' });
      try {
        await B.computerForRun(session.runId);
        const timeoutSeconds = Math.min(Math.max(120, (Number(params.timeout) || 0) + 15), 615);
        const r = await B.computers.request(session.botId, '/cmd', { command, params }, { timeoutSeconds });
        return send(res, 200, r.ok ? { ok: true, text: r.text } : { ok: false, error: `${command} failed: ${r.text.slice(0, 300)}` });
      } catch (e) { return send(res, 200, { ok: false, error: `${command} failed: ${e.message}` }); }
    }
    // run_with_login: one command in the bot's computer with a saved login in BOTDOT_USERNAME and BOTDOT_PASSWORD,
    // for a login shared with this bot that the owner marked "Usable in its computer". What comes back has every
    // form of the secret blanked out. The bot controls the command, so this guards against leaks by accident only
    // (docs/DECISIONS.md, 2026-10-18).
    if (parts[2] === 'computer' && parts[3] === 'run-with-login' && m === 'POST') {
      if (!session.container) return send(res, 200, { ok: false, error: "This bot doesn't have a computer" });
      const { login, command, timeoutSeconds } = await readBody(req);
      if (!command || typeof command !== 'string' || command.length > 4000) return send(res, 400, { ok: false, error: 'Say which command to run (at most 4000 characters)' });
      await readyForSecrets(session.botId);
      let creds;
      try { creds = await store().credentials(session.botId, login); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
      if (!creds.inComputer) {
        creds.password = null;
        return send(res, 200, { ok: false, error: `The "${creds.name}" login isn't usable in your computer. Ask the owner for it with ask_vault_switch (switch "inComputer"); don't tell them to change it in the Vault themselves.` });
      }
      const hide = vaultHttp.hideLogin(creds);
      const seconds = Math.min(Math.max(Number(timeoutSeconds) || 120, 1), 600);
      let r;
      try {
        await B.computerForRun(session.runId);
        r = await B.computers.runWithLogin(session.botId, { command, username: creds.username || '', password: creds.password || '', timeoutSeconds: seconds });
      } catch (e) { r = { error: e.message }; }
      creds.password = null;
      console.log(`[vault] ${session.botId} ran a command in its computer with "${creds.name}": ${r.code ?? 'failed'}`);
      return send(res, 200, ranWithSecret(r, hide));
    }
    // run_with_ssh_key: one command in the bot's computer with SSH_AUTH_SOCK set to an ssh-agent that holds an SSH key
    // of the owner's Bitwarden shared with this bot. The private key goes into the agent there (computers.js
    // runWithSshKey) and never to the bot: not in its environment, a file, the answer or the log (docs/DECISIONS.md).
    if (parts[2] === 'computer' && parts[3] === 'run-with-ssh-key' && m === 'POST') {
      if (!session.container) return send(res, 200, { ok: false, error: "This bot doesn't have a computer" });
      const { key, command, timeoutSeconds } = await readBody(req);
      if (!command || typeof command !== 'string' || command.length > 4000) return send(res, 400, { ok: false, error: 'Say which command to run (at most 4000 characters)' });
      if (!bitwarden.configured()) return send(res, 200, { ok: false, error: "SSH keys come from the owner's Bitwarden (its SSH key items), and botdot isn't connected to Bitwarden." });
      await readyForSecrets(session.botId);
      let ssh;
      try { ssh = bitwarden.sshKey(session.botId, key); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
      const hide = vaultHttp.hideSshKey(ssh.privateKey);
      const seconds = Math.min(Math.max(Number(timeoutSeconds) || 120, 1), 600);
      let r;
      try {
        await B.computerForRun(session.runId);
        r = await B.computers.runWithSshKey(session.botId, { command, privateKey: ssh.privateKey, timeoutSeconds: seconds });
      } catch (e) { r = { error: e.message }; }
      ssh.privateKey = null;
      console.log(`[vault] ${session.botId} ran a command in its computer with the SSH key "${ssh.name}": ${r.code ?? 'failed'}`);
      return send(res, 200, ranWithSecret(r, hide));
    }
    // A screenshot of the bot's computer for the owner, attached like a file: a QR code to scan, a 2FA screen…
    if (parts[2] === 'computer' && parts[3] === 'share' && m === 'POST') {
      if (!session.container) return send(res, 200, { ok: false, error: "This bot doesn't have a computer" });
      const { name } = await readBody(req);
      try {
        await B.computerForRun(session.runId);
        const r = await B.computers.request(session.botId, '/cmd', { command: 'screenshot', params: {} }, { timeoutSeconds: 60 });
        if (!r.ok) throw new Error(r.text.slice(0, 300));
        const line = r.text.split('\n').find((l) => l.startsWith('data:')); // one SSE-style line, as in computer-mcp.js
        const shot = JSON.parse(line ? line.slice(5) : r.text);
        const b64 = shot.image_data || shot.screenshot || shot.data;
        if (!b64) throw new Error('the screenshot had no image');
        const base = String(name || '').trim().replace(/\.png$/i, '') || 'Screenshot';
        return send(res, 200, { ok: true, file: B.attachFile(session.runId, `${base}.png`, Buffer.from(b64, 'base64')) });
      } catch (e) { return send(res, 200, { ok: false, error: `Couldn't send a screenshot: ${e.message}` }); }
    }
    return NEXT;
  }
  return { ofBot, ofSession };
}

module.exports = { create };
