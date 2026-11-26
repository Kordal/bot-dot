// A new version that waits for the account is said in its Chief's chat (#1690, ADR 271). The front door decides every switch
// and tells the account its update state on a change and every minute (POST /api/update/offer, lib/routes/update-offer.js):
// { state: "ready" | "moving" | "none", version, from, when, plan, deadline, notes, busy? }. Here the account
//   - keeps one `update` card in Needs you (kind 'update', the Chief's, no bot) while a version waits or moves: Now and
//     Tonight, whose buttons call the front door's own routes with the owner's session, never this server (lib/asks.js
//     updateWords); `moving` says it is moving, `none` takes the card away;
//   - says the version once, as a plain botdot note (chief.post: no turn, not counted in the Chief's daily messages) that
//     lists the What's new titles and names the card (ADR 252), with the same note as `versionUpdate` data for the apps' card, held through quiet hours as lib/backup-alert.js holds
//     what it says.
// What was told and said is kept in data/update-offer.json, so a restart neither repeats nor loses it.
const fs = require('./principal-fs');
const path = require('path');
const reporting = require('./reporting');
const cardRefs = require('./card-refs');
const { tr } = require('./i18n');
const { updateWords } = require('./asks');

const STATES = ['ready', 'moving', 'none'];
const WHENS = ['ready', 'night', 'manual'];
const TITLE_MAX = 80;
const TITLES_KEPT = 5; // the note lists the newest few; the card is where the rest is a tap away (What's new)
const SAID_KEPT = 10; // versions remembered as said
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const plain = (v, max) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null : null);

// A title as the note lists it: one line of plain text, with no card id in it (what the front door sends comes from
// What's new, which is ours, but an id in a line would be drawn as a card).
const titleOf = (v) => {
  const text = typeof v === 'string' ? v : typeof v?.title === 'string' ? v.title : '';
  const one = cardRefs.take(text).text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one;
};

// What the front door said, checked field by field: { state, version, from, when, plan, deadline, notes, busy? }, or it throws
// a 400 with the sentence for the front door's log.
function normalize(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Say what the update is.');
  if (!STATES.includes(b.state)) throw bad('state is ready, moving or none.');
  if (b.state === 'none') return { state: 'none' };
  const when = b.when === undefined || b.when === null ? 'night' : b.when;
  if (!WHENS.includes(when)) throw bad('when is ready, night or manual.');
  if (b.plan !== undefined && b.plan !== null && b.plan !== 'night') throw bad('plan is night, or none.');
  if (b.busy !== undefined && b.busy !== null && typeof b.busy !== 'boolean') throw bad('busy is true or false.');
  if (b.notes !== undefined && b.notes !== null && !Array.isArray(b.notes)) throw bad('notes is a list.');
  const out = { state: b.state, version: plain(b.version, 40), from: plain(b.from, 40), when, plan: b.plan === 'night' ? 'night' : null };
  const at = typeof b.deadline === 'string' ? Date.parse(b.deadline) : NaN;
  if (Number.isNaN(at)) {
    if (b.state === 'ready') throw bad('deadline is a date.');
    out.deadline = null;
  } else out.deadline = new Date(at).toISOString();
  out.notes = (b.notes || []).slice(0, 20).map(titleOf).filter(Boolean).slice(0, TITLES_KEPT).map((title) => ({ title }));
  if (typeof b.busy === 'boolean') out.busy = b.busy;
  return out;
}

// asks: lib/asks.js. post(message): a Chief message (chief.post). quietHours(): the account's (settings). language(): its own.
function create({ dataDir, asks, post, quietHours = () => ({}), language = () => 'en', now = () => Date.now() }) {
  const FILE = path.join(dataDir, 'update-offer.json');
  const read = () => {
    try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return j && typeof j === 'object' ? { offer: j.offer || null, said: Array.isArray(j.said) ? j.said : [], waiting: j.waiting || null } : { offer: null, said: [], waiting: null }; } catch { return { offer: null, said: [], waiting: null }; }
  };
  const write = (j) => fs.writeFileSync(FILE, JSON.stringify(j), { mode: 0o600 });
  const quiet = () => { try { return reporting.inQuietHours(new Date(now()), quietHours()); } catch { return false; } };
  const zone = () => { const z = quietHours()?.timeZone; return typeof z === 'string' && z ? z : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; };
  const keyOf = (o) => o.version || o.deadline || 'update';
  const card = () => asks.list().find((a) => a.kind === 'update') || null;

  // The one card: made when a version waits, told again as it changes (the owner's choice, "Tonight", busy), gone with `none`.
  function sync(o) {
    const had = card();
    if (o.state === 'none') { if (had) asks.drop((a) => a.kind === 'update'); return null; }
    const fields = { state: o.state, version: o.version, from: o.from, when: o.when, plan: o.plan, deadline: o.deadline, busy: o.busy, timeZone: zone() };
    if (!had) return asks.add({ kind: 'update', botId: null, ...fields });
    if (Object.keys(fields).some((k) => JSON.stringify(had[k]) !== JSON.stringify(fields[k]))) asks.mark((a) => a.kind === 'update', fields);
    return card();
  }

  function check() {
    const j = read();
    if (!j.waiting || !j.offer || j.offer.state !== 'ready' || quiet()) return;
    const lang = language();
    const mine = card();
    const words = updateWords(mine || { ...j.offer, timeZone: zone() }, { lang, now: now() });
    const titles = (j.waiting.notes || []).map((n) => n.title).filter(Boolean);
    const text = [
      `${tr(lang, 'A new version of botdot is ready.')} ${words.body}`,
      ...(titles.length ? [`${tr(lang, "What's new:")}\n${titles.map((t) => `- ${t}`).join('\n')}`] : []),
    ].join('\n\n');
    // `versionUpdate` is the same note as data, for the apps that draw it as a card (docs/api.md, `version-update-card`, #1759);
    // `text` stays as it was. Every word is the owner's language; the titles are drawn as plain text.
    const versionUpdate = { head: tr(lang, 'A new version of botdot is ready'), ...(j.offer.version ? { version: j.offer.version } : {}), body: words.body, ...(titles.length ? { heading: tr(lang, "What's new"), notes: titles.map((title) => ({ title })) } : { notes: [] }), ...(mine ? { cardId: mine.id } : {}) };
    post({ role: 'chief', text, notice: true, versionUpdate, ...(mine ? { cards: [mine.id] } : {}) });
    write({ ...j, said: [...j.said.filter((k) => k !== j.waiting.key), j.waiting.key].slice(-SAID_KEPT), waiting: null });
  }

  // What the front door says of this account's update.
  function tell(body) {
    const o = normalize(body);
    const j = read();
    const same = JSON.stringify(j.offer) === JSON.stringify(o);
    sync(o);
    if (o.state === 'ready') {
      const key = keyOf(o);
      // A version said already is not said again; one that waits to be said keeps what it will list.
      if (!j.said.includes(key) && j.waiting?.key !== key) j.waiting = { key, notes: o.notes };
    } else j.waiting = null; // moved, or gone, before the owner's quiet hours ended: the note is moot
    j.offer = o.state === 'none' ? null : o;
    if (!same || j.waiting) write(j);
    check();
  }

  const current = () => read().offer;

  function start() {
    setTimeout(() => { try { check(); } catch (e) { console.error(`[update-offer] ${e.message}`); } }, 60_000).unref();
    setInterval(() => { try { check(); } catch (e) { console.error(`[update-offer] ${e.message}`); } }, 10 * 60_000).unref();
  }

  return { tell, check, current, start };
}

module.exports = { create, normalize };
