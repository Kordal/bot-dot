// The account's usage on one finished UTC day, as counts alone (ADR 105; docs/api.md, Usage summary): GET
// /api/usage-summary?day=YYYY-MM-DD, asked by the front door alone, once a day, for the admin page. How the bots' runs
// went (the outcome ledger, ADR 099), the owner's activity (lib/activity.js), and which features the account has now.
// No text, no name, no address, nothing from a computer, no cost (AGENTS.md rule 5). Every read here is of the
// account's own data folder: nothing asks the privilege broker or a workspace.
const { NEXT, send } = require('./http');
const B = require('../bots');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return DAY.test(d) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d; };

// What the account has set up now, as yes or no each.
function features({ vault }) {
  const bots = B.bots.list();
  const jobs = bots.flatMap((b) => b.jobs || []);
  return {
    groups: B.groups.list().length > 0,
    pages: B.pages.count() > 0,
    jobs: jobs.some((j) => j.kind !== 'script'),
    scripts: jobs.some((j) => j.kind === 'script'),
    computer: bots.some((b) => b.computer === 'linux' || b.computer === 'boat'),
    vaultLogins: (() => { try { return vault.list().length > 0; } catch { return false; } })(),
    connectors: bots.some((b) => (b.connectors || []).length > 0),
    rooms: bots.some((b) => B.bots.roomSettings(b.id)?.allowRooms),
    boat: bots.some((b) => b.computer === 'boat'),
  };
}

function create({ fromFrontDoor, activity, vault, versionInfo }) {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'usage-summary' || parts[1]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door asks for the usage summary.' });
    if (m !== 'GET') return send(res, 405, { error: 'Not here' });
    const day = url.searchParams.get('day') || '';
    if (!validDay(day)) return send(res, 400, { error: 'day is a date: YYYY-MM-DD.' });
    const from = `${day}T00:00:00.000Z`;
    const to = new Date(Date.parse(from) + 864e5).toISOString();
    if (to > new Date().toISOString()) return send(res, 400, { error: 'Only a day that has ended.' });
    const { version } = await versionInfo();
    const bots = B.bots.list();
    const number = new Map(bots.map((b, i) => [b.id, i + 1])); // a bot by its place in the list, never its id or name
    return send(res, 200, {
      day, version,
      bots: bots.length,
      ...B.memory.outcomes.counts(from, to),
      failures: B.memory.outcomes.failures(from, to, (id) => number.get(id) ?? null),
      ...activity.day(day),
      features: features({ vault }),
    });
  };
}

module.exports = { create, validDay };
