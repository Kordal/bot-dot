// The setup page (/api/setup, lib/setup.js): where setup stands, and signing Claude in or out from the browser.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const chief = require('../chief');
const fs = require('../principal-fs');
const { signedIn } = require('../setup');

function create(ctx) {
  const { bitwarden, setup, claudeStatus, ALLOWED_HOSTS, PORT, sawClaude, saysHeld, nameChief } = ctx;
  return async function routes(req, res, url, { parts, m }) {
    // First-run setup: what's ready, what's left, and signing in to Claude from the browser.
    if (parts[0] === 'setup') {
      if (!parts[1] && m === 'GET') {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        const docker = await B.computers.dockerStatus();
        const bw = await bitwarden.status();
        const meaning = await B.memory.semanticStatus().catch(() => null);
        return send(res, 200, {
          ...setup.get(),
          chiefName: B.settings.chiefName(),
          claude: await claudeStatus(url.searchParams.has('fresh')),
          running: B.activeCount() + chief.activeCount(),
          docker: { ok: docker.ok, error: docker.error, image: docker.image },
          access: {
            host,
            tailnet: !!req.headers['tailscale-user-login'] || host.endsWith('.ts.net'),
            tailnetHost: [...ALLOWED_HOSTS].find((h) => h.endsWith('.ts.net')) || null,
            port: PORT,
            docker: fs.existsSync('/.dockerenv'),
          },
          bitwarden: { installed: bw.installed, configured: bw.configured, unlocked: bw.unlocked },
          connectors: { configured: B.connectors.configured() },
          meaning: meaning ? { enabled: !!meaning.enabled, available: meaning.server === 'external' || !!(meaning.binary && meaning.modelFile) } : null,
        });
      }
      if (!parts[1] && m === 'PUT') {
        const b = await readBody(req);
        // The answer to the question for the Chief's name (#41): '' keeps "Chief of Staff". It counts as asked either way.
        if (b.chiefName !== undefined) {
          try { nameChief(b.chiefName); } catch (e) { return send(res, 400, { error: e.message }); }
        }
        return send(res, 200, { ...setup.update({ done: b.done, timezone: b.timezone, deviceTimezone: b.deviceTimezone, ...(b.chiefName !== undefined ? { chiefNameAsked: true } : {}) }), chiefName: B.settings.chiefName() });
      }
      if (parts[1] === 'claude' && parts[2] === 'login' && m === 'POST') return send(res, 200, await setup.startLogin());
      if (parts[1] === 'claude' && parts[2] === 'login' && m === 'DELETE') { setup.cancelLogin(); return send(res, 200, { ok: true }); }
      // Sign out of Claude: stop what's running first, since nothing can go on without it.
      if (parts[1] === 'claude' && !parts[2] && m === 'DELETE') {
        if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return send(res, 409, { error: "Claude is signed in with a token from the server's settings, so it can't be signed out here." });
        // Nothing to sign out of: nothing is held or stopped for it (a hold would stand for good, with no check that can tell).
        if (!B.CLAUDE_BIN) return send(res, 409, { error: "Claude Code isn't installed on this machine." });
        // On the API key, runs don't use the subscription: signing it out stops and holds nothing.
        if (setup.usesApiKey()) return send(res, 200, { claude: sawClaude(await setup.logout()), stopped: 0 });
        B.claudeIs(false); // before the runs end: what waits for a bot stays waiting, where its turn would fail as not signed in
        const stopped = B.stopAllRuns('signout') + chief.stopAll('signout'); // each keeps who ended it (ADR 012)
        try {
          const claude = sawClaude(await setup.logout());
          if (signedIn(claude) === null) saysHeld(); // it could not tell, and botdot holds: the apps that are open hear it
          return send(res, 200, { claude, stopped });
        } catch (e) {
          // It could not sign out: its own check said Claude is signed in, so what waits goes on, also when the check
          // made here cannot tell.
          if (signedIn(await claudeStatus(true).catch(() => null)) === null) B.claudeIs(true);
          throw e;
        }
      }
      // An Anthropic API key instead of the subscription (#35): saved (and picked), which one runs use, removed.
      if (parts[1] === 'claude' && parts[2] === 'key' && m === 'PUT') return send(res, 200, { claude: sawClaude(await setup.saveApiKey((await readBody(req)).key)) });
      if (parts[1] === 'claude' && parts[2] === 'key' && m === 'DELETE') return send(res, 200, { claude: sawClaude(await setup.removeApiKey()) });
      if (parts[1] === 'claude' && parts[2] === 'use' && m === 'PUT') return send(res, 200, { claude: sawClaude(await setup.useClaude((await readBody(req)).use)) });
      if (parts[1] === 'claude' && parts[2] === 'code' && m === 'POST') {
        const { code } = await readBody(req);
        return send(res, 200, { claude: sawClaude(await setup.submitCode(code)) });
      }
    }
    return NEXT;
  };
}

module.exports = { create };
