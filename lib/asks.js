// What a bot (or the Chief) asks the owner for and can't give itself: a permission it lacks ("let me
// browse the web"), a skill to install from a link, or a tool to install on the botdot server for one bot
// (tools.js). Each waits in Needs you until the owner says yes or no there; nothing changes before that.
// Kept in the data folder, so a restart doesn't lose one.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const feed = require('./events');
const { linkParts } = require('./tools-link');
const { waitingWords } = require('./bot-changes');

// A permission a bot can ask for: the tools it adds (the same groups as "What it may do" in its settings).
const PERMISSIONS = {
  web: { label: 'browse the web', hint: 'search, and read web pages', tools: ['WebSearch', 'WebFetch'] },
  files: { label: 'change files', hint: 'create and edit files in its folder', tools: ['Edit', 'Write'] },
  commands: { label: 'run commands', hint: 'any shell command in its folder', tools: ['Bash'] },
};

// The permission a refused tool belongs to (Claude Code reports refused tools when a run ends).
const TOOL_PERMISSION = { Bash: 'commands', Edit: 'files', Write: 'files', MultiEdit: 'files', NotebookEdit: 'files', WebSearch: 'web', WebFetch: 'web' };
const DECLINE_DAYS = 7; // after a no, nobody asks for the same permission for that bot again for a week

// A switch of a saved login that a bot can ask the owner to turn on (kind 'vault-switch'), by its field on the
// login (lib/vault.js, lib/bitwarden.js). name: what the Vault's form calls it. title and grant: the card's question
// and what a yes gives, in the owner's words; warning: what the card warns of.
const VAULT_SWITCHES = {
  insecureTls: {
    name: 'Accept self-signed certificate',
    title: (bot, login) => `Let ${bot} accept a self-signed certificate for “${login}”?`,
    grant: (login) => `use “${login}” with a self-signed certificate`,
  },
  inComputer: {
    name: 'Usable in its computer',
    title: (bot, login) => `Let ${bot} use “${login}” in its computer?`,
    grant: (login) => `use “${login}” in your computer with run_with_login`,
    warning: (bot) => `${bot}'s commands will be able to read this secret. Only for a secret that guards something on its own computer.`,
  },
};
// What follows the owner's yes (ADR 009): the runs that wait for an ask carry on for this long after it was
// made, and an ask keeps this many of them.
const CARRY_HOURS = 24;
const RUNS_MAX = 20;
const stillWaits = (ask, now = Date.now()) => now - Date.parse(ask.at) < CARRY_HOURS * 3600e3;

// describe: what the feed says about each ask (the phone notifies with it), given by the server that knows the bots.
function create(dataDir, { describe = (a) => a } = {}) {
  const file = path.join(dataDir, 'asks.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
  const save = (list) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(list, null, 2)); fs.renameSync(`${file}.tmp`, file); };
  const changed = () => { const list = load(); feed.emit('asks', { waiting: list.length, list: list.map(describe) }); };
  // Permissions the owner said no to: { botId, permission, at }.
  const declinedFile = path.join(dataDir, 'asks-declined.json');
  const declines = () => { try { return JSON.parse(fs.readFileSync(declinedFile, 'utf8')); } catch { return []; } };
  const fresh = (d) => Date.now() - Date.parse(d.at) < DECLINE_DAYS * 864e5;
  const declinedRecently = (botId, permission) => declines().some((d) => d.botId === botId && d.permission === permission && fresh(d));
  // When the owner said no to this tool for this bot within the week (an ISO time), or null.
  const toolDeclined = (botId, name) => declines().find((d) => d.botId === botId && d.tool === name && fresh(d))?.at || null;
  // Whether the owner said no to turning on this switch of this login for this bot within the week.
  const switchDeclined = (botId, loginId, field) => declines().some((d) => d.botId === botId && d.vaultSwitch === `${loginId}:${field}` && fresh(d));

  // kind 'permission': { botId, permission, reason }. kind 'skill': { botId|null (the Chief), forBots, url, skill: { name, description, files }, reason }.
  // A skill the bot wrote itself after its run read content from others (ADR 015) is a 'skill' ask too, with no
  // link: { botId, forBots: [botId], url: '', written: { name, description, instructions, reason, runId }, skill, reason }.
  // One card per bot and name: written again while it waits, the card holds the newer text. It keeps no `runs`:
  // the run that wrote it went on, and the yes saves the skill and starts nothing. The card gets the text to read
  // (server.js, `skill.instructions`); the feed's short entry does not.
  // kind 'tool': { botId, tool: { name, version, summary, source, platform, size, list }, reason, askedBy, chatId }: one card per bot and tool.
  // A tool from a link has no list: its source is { type: 'link', url, sha256, command, from: 'owner' | 'chief' }.
  // kind 'connector-action': { botId, runId, app, action, arguments, fingerprint }: a write in a connected app that
  // the run `runId` waits for, inside the run (lib/connector-approvals.js, ADR 010). `stoppedAt`: since when that
  // run no longer waits; without it the ask is held. It keeps no `runs`: its yes starts the bot by itself.
  // kind 'vault-switch': { botId, loginId, loginName, site, vaultSwitch: 'insecureTls' | 'inComputer', reason }: a switch of
  // a login shared with the bot, which the bot asks the owner to turn on (VAULT_SWITCHES). One card per bot, login and switch.
  // runId: the bot's run that asks (a permission or a skill). The ask keeps it in `runs`, [{ id, at }], oldest
  // first: the runs that wait for the owner's answer and may carry on after a yes (ADR 009). An entry can have
  // `allowed` and `declined`: what the owner already answered of that run's other asks (answered()).
  // A changed bot that waits and would give this bot this permission. bot: the bot as it is now. A change whose
  // yes would be refused, because its bot changed since (staleChange), gives nothing: the permission gets its own card.
  const holds = (botId, permission, bot) => (a) => a.kind === 'bot-change' && a.botId === botId && heldPermissions(a).includes(permission) && !staleChange(a, bot);
  // Such a card waits: a run that lacks the permission joins it, also in the week after a no to the permission.
  const changeHolds = (botId, permission, bot = null) => load().some(holds(botId, permission, bot));

  // One card per grant: while a changed bot that holds a permission waits, a run that asks for that permission
  // joins that card, and a changed bot takes over the permission's own card as it is made (heldPermissions).
  // The runs on a changed bot count from `runsAt`, when the first of them asked: the card itself may be older.
  // chatId: the Chief chat a changed bot or a skill was asked for in (ADR 009). Asked for again there, the card
  // counts from that moment (`chatAt`).
  // bot: the ask's bot as it is now, where the caller has it (a permission).
  function add(ask, { runId = null, bot = null } = {}) {
    const list = load();
    const at = new Date().toISOString();
    const joins = (a, runs, since) => {
      const fresh = runs.filter((r) => !(a.runs || []).some((x) => x.id === r.id));
      if (!fresh.length) return false;
      a.runs = [...(a.runs || []), ...fresh].sort((x, y) => String(x.at).localeCompare(String(y.at))).slice(-RUNS_MAX);
      if (a.kind === 'bot-change') a.runsAt = [a.runsAt, since].filter(Boolean).sort()[0];
      return true;
    };
    const holder = ask.kind === 'permission' ? list.find(holds(ask.botId, ask.permission, bot)) : null;
    if (holder) {
      if (runId && joins(holder, [{ id: runId, at }], at)) { save(list); changed(); }
      return holder;
    }
    const same = list.find((a) => a.kind === ask.kind && a.botId === ask.botId && (ask.kind === 'permission' ? a.permission === ask.permission : ask.kind === 'tool' ? a.tool.name === ask.tool.name : ask.kind === 'bot-change' ? JSON.stringify([a.changes, a.before]) === JSON.stringify([ask.changes, ask.before]) : ask.kind === 'connector-action' ? a.runId === ask.runId && a.app === ask.app && a.action === ask.action && a.fingerprint === ask.fingerprint : ask.kind === 'vault-switch' ? a.loginId === ask.loginId && a.vaultSwitch === ask.vaultSwitch : a.url === ask.url && (a.written?.name || '') === (ask.written?.name || '')));
    // A changed bot that gives a permission a card already asks for: that card goes, and its runs wait here.
    const takesOver = (a) => {
      const taken = a.kind === 'bot-change' ? list.filter((x) => x.kind === 'permission' && x.botId === a.botId && heldPermissions(a).includes(x.permission)) : [];
      for (const x of taken) { joins(a, x.runs || [], x.at); list.splice(list.indexOf(x), 1); }
      return taken.length > 0;
    };
    if (same) {
      // Asked already: one card is enough. A run that asks for it now waits for it too, and the card may say so.
      let news = !!runId && joins(same, [{ id: runId, at }], at);
      if (ask.chatId && ['bot-change', 'skill'].includes(ask.kind)) { Object.assign(same, { chatId: ask.chatId, chatAt: at }); news = true; }
      if (takesOver(same)) news = true;
      if (ask.written) { Object.assign(same, { written: ask.written, skill: ask.skill, reason: String(ask.reason || '').trim().slice(0, 300) }); news = true; }
      if (news) { save(list); changed(); }
      return same;
    }
    const a = { id: crypto.randomUUID().slice(0, 8), ...ask, reason: String(ask.reason || '').trim().slice(0, 300), at, ...(runId ? { runs: [{ id: runId, at }] } : {}) };
    takesOver(a);
    save([...list, a]);
    changed();
    return a;
  }

  // declined: the owner said no (a permission then isn't asked for again for a while).
  function take(id, { declined = false } = {}) {
    const list = load();
    const a = list.find((x) => x.id === id);
    if (!a) throw new Error('That request was already answered.');
    save(list.filter((x) => x.id !== id));
    if (declined && ['permission', 'tool', 'vault-switch'].includes(a.kind)) {
      const what = a.kind === 'tool' ? { tool: a.tool.name } : a.kind === 'vault-switch' ? { vaultSwitch: `${a.loginId}:${a.vaultSwitch}` } : { permission: a.permission };
      const [key, value] = Object.entries(what)[0];
      const kept = declines().filter((d) => fresh(d) && !(d.botId === a.botId && d[key] === value));
      fs.writeFileSync(declinedFile, JSON.stringify([...kept, { botId: a.botId, ...what, at: new Date().toISOString() }], null, 2));
    }
    changed();
    return a;
  }

  // The owner answered `a`, which take() has removed. A run that waited for it may wait for another ask too:
  // that ask keeps this answer for it. Returns the runs that got their last answer with this one, each with
  // everything it was allowed and declined, in the owner's words: [{ id, at, allowed, declined }].
  function answered(a, yes) {
    const what = grantWords(a);
    const list = load();
    const done = [];
    let kept = false;
    for (const r of a.runs || []) {
      const allowed = [...(r.allowed || []), ...(yes ? what : [])];
      const declined = [...(r.declined || []), ...(yes ? [] : what)];
      const elsewhere = list.flatMap((x) => (x.runs || []).filter((e) => e.id === r.id));
      for (const e of elsewhere) { e.allowed = allowed; e.declined = declined; kept = true; }
      if (!elsewhere.length) done.push({ id: r.id, at: r.at, allowed, declined });
    }
    if (kept) save(list);
    return done;
  }

  // The asks that match go, unanswered: nobody said yes or no. Returns them.
  function drop(match) {
    const list = load();
    const gone = list.filter(match);
    if (gone.length) { save(list.filter((a) => !gone.includes(a))); changed(); }
    return gone;
  }
  // The asks that match get these fields, as one change. Returns them as they are now.
  function mark(match, fields) {
    const list = load();
    const marked = list.filter(match);
    if (marked.length) { for (const a of marked) Object.assign(a, fields); save(list); changed(); }
    return marked;
  }
  // A bot that's deleted can't use what it asked for.
  const forgetBot = (botId) => { drop((a) => a.botId === botId); };

  return { list: load, add, take, answered, drop, mark, forgetBot, declinedRecently, toolDeclined, switchDeclined, changeHolds };
}

// ---------- a changed bot, in the owner's words ----------

// The permissions a waiting change to a bot would give it: 'web', 'commands'. A tool it adds counts by its name,
// also where the rule is narrower ("Bash(git log:*)"), as the words of bot-changes.js count it.
function addedTools(a) {
  const had = a.before?.allowedTools || [];
  return (a.kind === 'bot-change' && Array.isArray(a.changes?.allowedTools) ? a.changes.allowedTools : []).filter((tool) => !had.includes(tool));
}
const permissionOf = (tool) => TOOL_PERMISSION[String(tool).replace(/\(.*$/s, '')];
const heldPermissions = (a) => Object.keys(PERMISSIONS).filter((p) => addedTools(a).some((tool) => permissionOf(tool) === p));
// Whether all a change does is give the bot permissions: it changes its tools alone, takes none away, and every
// tool it adds belongs to a permission. Its card then asks "Let it …?", and its yes button reads "Allow".
function onlyGivesPermissions(a) {
  const tools = a.changes?.allowedTools;
  if (a.kind !== 'bot-change' || Object.keys(a.changes || {}).length !== 1 || !Array.isArray(tools)) return false;
  const added = addedTools(a);
  return added.length > 0 && added.every((tool) => permissionOf(tool)) && (a.before?.allowedTools || []).every((tool) => tools.includes(tool));
}
// A waiting change whose bot is no longer as it was when the change was proposed: a field it changes has another
// value now. Its yes is refused, so that it overwrites nothing (docs/security-issue-90.md), and it starts nothing.
// bot: the bot as it is now; with none at hand nothing is known to be stale.
const staleChange = (a, bot) => !!bot && Object.entries(a.before || {}).some(([field, value]) => JSON.stringify(bot[field]) !== JSON.stringify(value));
// What the change holds back, one entry per held thing: "web access", "its own computer", "Gmail", "new rules".
const changeWords = (a, appName) => waitingWords(a.changes || {}, { allowedTools: [], connectors: [], ...a.before }, appName);
// Its card's title (docs/api.md): one permission and nothing else is "Let News Watcher browse the web?".
function changeTitle(a, botName, appName) {
  const words = changeWords(a, appName);
  const [permission, more] = heldPermissions(a);
  if (words.length === 1 && permission && !more && Object.keys(a.changes).length === 1) return `Let ${botName} ${PERMISSIONS[permission].label}?`;
  return `Change ${botName}: ${listed(words) || 'its settings'}?`;
}
// Its card's body: one entry per changed field. A text has what it was and what it becomes, both in full;
// anything else its label and what the bot gets. Never a field's own name, a tool's or an app's slug.
function changeParts(a, appName) {
  const before = a.before || {};
  return Object.entries(a.changes || {}).map(([field, next]) => {
    if (field === 'prompt' || field === 'systemPrompt') return { label: field === 'prompt' ? 'Main assignment' : 'Rules', was: String(before[field] ?? ''), now: String(next ?? '') };
    if (field === 'allowedTools') return { label: 'What it may do', now: listed(heldPermissions(a).map((p) => PERMISSIONS[p].label)) || 'more than before' };
    if (field === 'computer') return { label: 'Computer', now: 'a computer of its own' };
    if (field === 'connectors') return { label: 'Connected apps', now: listed((Array.isArray(next) ? next : []).filter((app) => !(before.connectors || []).includes(app)).map((app) => appName(app))) || 'more than before' };
    if (field === 'computerEgress') return { label: "Its computer's network", now: 'your home network' };
    return { label: 'Settings', now: 'changed' };
  });
}

// A download's size as the card says it: "14 MB", "650 kB".
const sizeText = (bytes) => (bytes >= 1e6 ? `${Math.max(1, Math.round(bytes / 1e6))} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);
const TOOL_SOURCE = "botdot's registry (conda-forge), checksum verified";
// A tool from a link: what the card warns of, in the owner's words (their test of Milestone 4, TOOL-010), and
// what it says of the program in place of the registry's summary.
const LINK_WARNING = 'Not from the approved list. Make sure you trust the source.';
const LINK_UNCHECKED = 'botdot has not checked what this program does.';

// What a card shows, as data the apps only draw (ADR 003). botName: the bot as it is called now. appName: an
// app's name by its slug, where the server knows it. short: for the feed's entry, where a connected-app action
// has the start of its rows and says where it was cut.
function proposalView(a, botName = a.botName || 'this bot', { appName = appWord, short = false } = {}) {
  if (a.kind === 'tool') {
    // The wording of the approved prototype (Milestone 4).
    const t = a.tool;
    const asked = a.askedBy && a.askedBy !== 'chief' ? `${botName} asked the Chief` : 'asked by the Chief';
    const version = { label: 'Version', value: t.replaces ? `${t.version} (now ${t.replaces})` : t.version };
    if (t.source?.type === 'link') {
      // A tool from a link: the warning, whose link it is, and the facts the owner can check it by.
      const { source, file } = linkParts(t.source.url);
      return {
        title: `Install ${t.name} for ${botName}?`,
        meta: `from a link ${t.source.from === 'owner' ? 'you gave' : 'the Chief proposed'} · ${asked}`,
        body: [[t.summary ? `${t.summary}, as described on its page.` : '', LINK_UNCHECKED].filter(Boolean).join(' '), a.reason ? `Why: ${a.reason}` : ''].filter(Boolean).join('\n\n'),
        warning: LINK_WARNING,
        facts: [
          ...(t.version ? [version] : []),
          { label: 'Source', value: source },
          { label: 'File', value: file },
          { label: 'Checksum', value: `sha256 ${t.source.sha256.slice(0, 4)}…${t.source.sha256.slice(-4)}` },
          { label: 'Size', value: sizeText(t.size) },
          { label: 'Runs as', value: `${botName} only` },
        ],
      };
    }
    return {
      title: `Install ${t.name} for ${botName}?`,
      meta: asked,
      body: [t.summary, a.reason ? `Why: ${a.reason}` : ''].filter(Boolean).join('\n\n'),
      facts: [
        version,
        { label: 'Source', value: TOOL_SOURCE },
        { label: 'Size', value: sizeText(t.size) },
        { label: 'Runs as', value: `${botName} only` },
        { label: 'Stays', value: 'across botdot updates' },
      ],
    };
  }
  if (a.kind === 'bot-change') {
    // `details` is what an app from before `parts` shows.
    const labels = { prompt: 'Main assignment', systemPrompt: 'Rules', allowedTools: 'Tools', computer: 'Computer', connectors: 'Connected apps', computerEgress: 'Computer network' };
    const value = (v) => Array.isArray(v) ? v.join(', ') || 'None' : String(v ?? 'None');
    // `yes`: what the yes button reads where "Approve" is not the word: a change that only gives permissions is allowed.
    return { title: changeTitle(a, botName, appName), parts: changeParts(a, appName), ...(onlyGivesPermissions(a) ? { yes: 'Allow' } : {}), details: Object.entries(a.changes).map(([field, next]) => `${labels[field] || field}\nNow: ${value(a.before[field])}\nProposed: ${value(next)}`).join('\n\n') };
  }
  if (a.kind === 'vault-switch') {
    // Every word is the server's: the login by its name and address, the switch by the name the Vault's form gives it.
    const sw = VAULT_SWITCHES[a.vaultSwitch];
    const login = oneLine(a.loginName);
    return {
      title: sw.title(botName, login),
      parts: [
        { label: 'Login', now: a.site ? `${login} (${oneLine(a.site)})` : login },
        { label: 'Switch', now: sw.name },
        { label: 'Only for', now: 'this login, for every bot it is shared with' },
      ],
      ...(sw.warning ? { warning: sw.warning(botName) } : {}),
      yes: 'Allow',
    };
  }
  if (a.kind === 'connector-action') {
    // `details` is what an app from before `rows` shows: the rule of the two answers, and the arguments as they were sent.
    const details = `Allow once applies to this action with exactly these arguments, once: in the run that waits for your answer or, when it has stopped waiting, in the run your answer starts. Always allow grants this exact action for this bot in future runs, with any arguments.\n\n${JSON.stringify(a.arguments, null, 2)}`;
    return { title: actionTitle(a, appName), ...actionRows(a.arguments, { short }), held: !a.stoppedAt, details };
  }
  return {};
}

// ---------- a connected-app action, in the owner's words (docs/api.md, "An action in a connected app") ----------

// An action and its app as they stand after "Wants to": "send email with Gmail". The action in lowercase words
// from its name alone, the app by its name where the server knows it.
const actionPhrase = (a, appName = appWord) => `${clipTo(actionWords(a.action, a.app), 80)} with ${clipTo(oneLine(appName(a.app) || appWord(a.app)), 60)}`;
// Its card's title: "Send email with Gmail?".
const actionTitle = (a, appName) => { const s = actionPhrase(a, appName); return `${s[0].toUpperCase()}${s.slice(1)}?`; };
// The usual names of a recipient, a subject and a body, as a letter has them. Gmail's own is recipient_email.
const USUAL_ARGUMENTS = new Map(Object.entries({ to: 'To', recipient: 'To', recipients: 'To', recipient_email: 'To', subject: 'Subject', body: 'Text', text: 'Text', message: 'Text' }));
// What the feed's entry holds of an action (the short form): this much of one label and of one value, and this
// many rows.
const LABEL_MAX = 60;
const ROW_MAX = 500;
const ROWS_MAX = 30;
// What a card of the list holds of an action: this many rows, and this many characters of labels and values
// together. A card is drawn whole, by an app and on a phone: what a bot sends must not make one too large to draw.
const CARD_ROWS = 200;
const CARD_CHARS = 100_000;
// A name's words, in lowercase: its letters and digits in any script, with the marks that belong to them, split
// where anything else stands between them and where a small letter or a digit meets a capital. A character that
// draws nothing (a filler, a variation selector) is no letter here, though Unicode files some as one: two names
// that differ only by it read the same, and get their numbers as two that are spelled the same do.
const nameWords = (name) => String(name ?? '').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').split(/(?:[^\p{L}\p{M}\p{N}]|\p{Default_Ignorable_Code_Point})+/u).filter(Boolean).map((w) => w.toLowerCase());
// An argument's own name in words, every letter and digit of it: is_html is "Is html", replyTo "Reply to", Imię
// "Imię". Never clipped: two names that differ at their end are two labels. "Value" for a name without either,
// also one of marks alone: an accent with no letter under it is no name to read.
function ownLabel(name) {
  const s = nameWords(name).join(' ');
  if (!/[\p{L}\p{N}]/u.test(s)) return 'Value';
  const first = String.fromCodePoint(s.codePointAt(0));
  const capital = first.toUpperCase();
  return (capital.length === first.length ? capital : first) + s.slice(first.length); // ß stays ß, not "SS"
}
// The labels of arguments that stand side by side, each once, so that no two rows of a card read the same: an
// argument reads by its usual name ("To", "Subject", "Text") while that is free, else by its own name, and where
// that is taken too, by its own name and a number: "Text (2)". A name in words has no bracket, so a numbered
// label is never another argument's: the next number of a name is counted, not searched for, however many
// arguments read the same.
function argumentLabels(names) {
  const taken = new Set();
  const count = new Map(); // an own name -> how many numbered labels it has
  return names.map((name) => {
    const own = ownLabel(name);
    let label = [USUAL_ARGUMENTS.get(nameWords(name).join('_')), own].find((l) => l && !taken.has(l));
    if (!label) {
      const n = (count.get(own) || 1) + 1;
      count.set(own, n);
      label = `${own} (${n})`;
    }
    taken.add(label);
    return label;
  });
}
// An argument's value as text, all of it: a list joined with commas, a nested value as "Name: value" pairs, a file
// by its name. Nothing is left out however deep it is nested: past DEEP levels, which no action's description
// asks for, what is left is written as it was sent, so that neither a word is lost nor the card fails to be made.
const DEEP = 50;
function argumentText(v, depth = 0) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v !== 'object') return String(v).trim();
  if (depth > DEEP) return JSON.stringify(v);
  if (Array.isArray(v)) return v.map((x) => argumentText(x, depth + 1)).filter((t) => t !== '').join(', ');
  const keys = Object.keys(v);
  if (keys.length === 1 && typeof v.$file === 'string') return `the file ${v.$file.trim()}`; // botdot puts the file in (connectors.js)
  const labels = argumentLabels(keys);
  const pairs = keys.map((k, i) => `${labels[i]}: ${argumentText(v[k], depth + 1)}`).join(', ');
  return depth ? `(${pairs})` : pairs;
}
// Its card's body: one row per argument, in the order the bot gave them, every argument and every value in full.
// The owner's yes sends the stored arguments, so the card that asks for it leaves none of them out.
// An action of more than CARD_ROWS arguments, or whose rows hold more than CARD_CHARS characters together, is too
// long to show in full: its rows are the first that fit both limits, each whole, with `more: true` beside them.
// "Allow once" would send what no card shows, so such an action cannot be allowed once (server.js allowAction).
// short: the feed's entry. A label and a value are clipped and rows are left out, and each cut is marked with
// `more: true`, on the row whose label or value was clipped and beside the rows when some were left out: a card
// drawn from it is not all the yes approves. The list's labels stay whole. Returns { rows, more? }.
function actionRows(args, { short = false } = {}) {
  const all = args && typeof args === 'object' ? Object.entries(args) : [];
  // Neither form reads more arguments than it can show: a label depends only on the arguments before it.
  const shown = all.slice(0, short ? ROWS_MAX : CARD_ROWS);
  const labels = argumentLabels(shown.map(([name]) => name));
  if (!short) {
    const rows = [];
    let room = CARD_CHARS;
    for (const [i, [, value]] of shown.entries()) {
      const row = { label: labels[i], value: argumentText(value) };
      room -= row.label.length + row.value.length;
      if (room < 0) break; // this row and every row after it: no value is cut in the middle
      rows.push(row);
    }
    return rows.length < all.length ? { rows, more: true } : { rows };
  }
  const rows = shown.map(([, value], i) => ({ label: labels[i], value: argumentText(value) }));
  const start = rows.map((r) => (r.label.length > LABEL_MAX || r.value.length > ROW_MAX ? { label: clipTo(r.label, LABEL_MAX), value: clipTo(r.value, ROW_MAX), more: true } : r));
  return all.length > ROWS_MAX ? { rows: [...start, { label: 'More', value: `${all.length - ROWS_MAX} more that this card does not show` }], more: true } : { rows: start };
}
// `then` of such an ask once its run stopped waiting (ADR 010): one sentence, whoever started that run.
const ACTION_THEN = { who: 'bot', text: 'It carries on when you allow it.' };

// ---------- the line a notification shows ----------

// What waits for the owner, as one line that can stand under the bot's name: `text` of every ask and of every
// waiting job and tile (docs/api.md). Worded here, beside the cards, and only shown by the apps. A line never
// holds a script or an argument of an action, and never more than TEXT_MAX characters.
const TEXT_MAX = 160;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clipTo = (s, max) => (s.length > max ? `${s.slice(0, Math.max(max - 1, 0))}…` : s);
// "A", "A and B", "A, B and C".
const listed = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
// A sentence around a name the owner or a bot chose: the name gives way, clipped with "…", so the line fits.
function around(name, say) {
  const clean = oneLine(name);
  return clipTo(say(clipTo(clean, Math.max(TEXT_MAX - say('').length, 1))), TEXT_MAX);
}
// A changed field of a bot, in the owner's words.
const CHANGED = { prompt: 'its main assignment', systemPrompt: 'its rules', allowedTools: 'what it may do', computer: 'its computer', connectors: 'its connected apps', computerEgress: "its computer's network" };
// An app as it is called when its name is not at hand: "gmail" is "Gmail".
const appWord = (slug) => { const s = oneLine(String(slug ?? '').replace(/[_-]+/g, ' ')); return s ? s[0].toUpperCase() + s.slice(1) : 'an app'; };
// An action of a connected app in lowercase words, from its name alone: GMAIL_SEND_EMAIL of gmail is "send email".
function actionWords(action, app) {
  const words = String(action ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const own = String(app ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  // The app's own name leads the action's: one word, or several ("GOOGLE_CALENDAR_…" of googlecalendar).
  for (let n = 1; own && n < words.length; n++) if (words.slice(0, n).join('') === own) return words.slice(n).join(' ');
  return words.join(' ') || 'do something';
}

// appName: an app's name by its slug, where the server knows it.
function askText(a, { appName = () => null } = {}) {
  if (a.kind === 'permission') return clipTo(`Asks to ${oneLine(PERMISSIONS[a.permission]?.label || a.permission)}`, TEXT_MAX);
  if (a.kind === 'skill' && a.written) return around(a.skill?.name, (name) => (a.skill?.exists ? `Wants to change its skill “${name}”` : `Wants to keep a skill it wrote: “${name}”`));
  if (a.kind === 'skill') return around(a.skill?.name, (name) => `Asks to install the skill “${name}”`);
  if (a.kind === 'tool') return around(a.tool?.name, (name) => `Asks to install ${name}${a.tool?.source?.type === 'link' ? ' from a link' : ''}`);
  if (a.kind === 'bot-change') {
    const what = [...new Set(Object.keys(a.changes || {}).map((field) => CHANGED[field] || 'its settings'))];
    return clipTo(`${a.by === 'bot' ? 'Wants' : 'The Chief wants'} to change ${listed(what) || 'its settings'}`, TEXT_MAX);
  }
  if (a.kind === 'connector-action') return around(appName(a.app) || appWord(a.app), (app) => `Wants to ${clipTo(actionWords(a.action, a.app), 80)} with ${app}`);
  if (a.kind === 'vault-switch') return around(a.loginName, (login) => `Asks to turn on “${VAULT_SWITCHES[a.vaultSwitch]?.name}” for “${login}”`);
  return '';
}
// A job that waits for the owner's OK. when: its schedule in words (lib/cron-words.js).
const jobText = (job, when) => around(job.name, (name) => `Wants to add a ${job.kind === 'script' ? 'script' : 'job'}: ${name}, ${oneLine(when)}`);
// What the no on a job or a tile that was never approved says, and what its card reads after it: the no removes it.
// The server's words, the same on the web page, on Android and in the notification (docs/api.md, "Decline").
const DECLINE_NEW = 'Decline and remove';
const DECLINED_NEW = 'Declined and removed';
// A tile that waits for the owner's OK: it waits because it runs a script.
const tileText = (tile) => around(tile.title, (title) => `Wants to put “${title}” on your Board (a script)`);
// A change that waits beside an approved job or tile (ADR 013; docs/api.md, "A change that waits"): the line of
// its notification, what its two buttons read, and what its card reads after the answer. Its no removes nothing.
// job: the job as proposed, with the name it has; when: the proposed schedule in words.
const jobChangeText = (job, when) => around(job.name, (name) => `Wants to change a ${job.kind === 'script' ? 'script' : 'job'}: ${name}, ${oneLine(when)}`);
const tileChangeText = (tile) => around(tile.title, (title) => `Wants to change “${title}” on your Board (a script)`);
const KEEP = 'Keep as it is';
const APPROVE_CHANGE = 'Approve the change';
const changedWords = (when) => clipTo(`Changed: ${oneLine(when)}`, TEXT_MAX);
const keptWords = (when) => clipTo(`Kept as it was: ${oneLine(when)}`, TEXT_MAX);

// ---------- what carries on after a yes (ADR 009) ----------

// What a yes gives a run that waited for it, each as it stands after "may now" and "allowed you to": "browse the
// web", "use the skill “pdf”". A changed bot gives the permissions it holds; one it gives in part is said with
// the rules it adds, "run commands (only Bash(git log:*))", so the run is not told more than it got.
function grantWords(a) {
  // What a bot proposed in a run and the owner answered (a job, a tile, its instructions): in the words it was handed in.
  if (a.kind === 'proposal') return a.words || [];
  if (a.kind === 'bot-change' && a.by === 'bot') return Object.keys(a.changes || {}).map((field) => `change ${field === 'prompt' ? 'your main assignment' : field === 'systemPrompt' ? 'your rules' : 'your settings'}`);
  if (a.kind === 'skill') return [`use the skill “${oneLine(a.skill?.name)}”`];
  if (a.kind === 'vault-switch') return [VAULT_SWITCHES[a.vaultSwitch].grant(oneLine(a.loginName))];
  if (a.kind === 'bot-change') return heldPermissions(a).map((p) => {
    const rules = addedTools(a).filter((tool) => permissionOf(tool) === p);
    return PERMISSIONS[p].tools.every((tool) => rules.includes(tool)) ? PERMISSIONS[p].label : `${PERMISSIONS[p].label} (only ${oneLine(rules.join(', '))})`;
  });
  return [oneLine(PERMISSIONS[a.permission]?.label || a.permission)];
}

// The owner's answer on what the Chief asked for in a chat, as botdot says it there (ADR 009). what: what stands
// after "Approved:" and "Declined:"; done: one plain line of what is true after a yes. Of a changed bot or a
// skill (an ask), a script job ({ job }) or a Board tile ({ tile }), and of a permission that a run the Chief
// started asked for. botName: the bot as it is called now.
const PERMISSION_NOUN = { web: 'web access', files: 'changing files', commands: 'commands' }; // as a changed bot's words have them
function answerWords(thing, { botName = 'the bot', appName = appWord } = {}) {
  const name = (s) => clipTo(oneLine(s), 60);
  // A permission a run asked for, where botdot says in a Chief chat that it was approved: "web access for Scout".
  if (thing.kind === 'permission') {
    const label = oneLine(PERMISSIONS[thing.permission]?.label || thing.permission);
    return { what: `${PERMISSION_NOUN[thing.permission] || label} for ${botName}`, done: `${botName} can ${label} now.` };
  }
  // A call turned on (ADR 026): the Chief writes the call address and where the key is next.
  if (thing.job && thing.change && thing.callOn) return { what: `calls to the ${thing.job.kind === 'script' ? 'script' : 'job'} “${name(thing.job.name)}” of ${botName}`, done: `The ${thing.job.kind === 'script' ? 'script' : 'job'} “${name(thing.job.name)}” of ${botName} takes calls now. Its key is in the Vault; use job_call for its address and the item's name.` };
  if (thing.job && thing.change) return { what: `the change to the ${thing.job.kind === 'script' ? 'script' : 'job'} “${name(thing.job.name)}” of ${botName}`, done: `The ${thing.job.kind === 'script' ? 'script' : 'job'} “${name(thing.job.name)}” of ${botName} is changed now.` };
  if (thing.tile && thing.change) return { what: `the change to the tile “${name(thing.tile.title)}” on your Board`, done: `“${name(thing.tile.title)}” on your Board is changed now.` };
  if (thing.job) return { what: `the ${thing.job.kind === 'script' ? 'script' : 'job'} “${name(thing.job.name)}” for ${botName}`, done: `${botName} has the ${thing.job.kind === 'script' ? 'script' : 'job'} “${name(thing.job.name)}” now.` };
  if (thing.tile) return { what: `the tile “${name(thing.tile.title)}” on your Board`, done: `“${name(thing.tile.title)}” is on your Board now.` };
  if (thing.kind === 'skill') return { what: `the skill “${name(thing.skill?.name)}”`, done: `The skill “${name(thing.skill?.name)}” is installed.` };
  if (thing.kind === 'vault-switch') {
    const sw = VAULT_SWITCHES[thing.vaultSwitch];
    return { what: `“${sw.name}” on “${name(thing.loginName)}” for ${botName}`, done: `“${sw.name}” is on for the login “${name(thing.loginName)}” now.` };
  }
  const words = listed(changeWords(thing, appName)) || 'its settings';
  const [permission, more] = heldPermissions(thing);
  const one = permission && !more && Object.keys(thing.changes || {}).length === 1;
  return { what: `${words} for ${botName}`, done: one ? `${botName} can ${PERMISSIONS[permission].label} now.` : `Changed ${botName}: ${words}.` };
}

// Who started a run, which decides what follows the owner's yes: 'owner' (their message, or their tap on a tile
// of the Board), 'chief', 'teammate' (another bot's message) or 'job' (at its time, "Run now", or a call). null for a run
// that nothing carries on from: a follow-up after teammates' answers, a memory review.
function starterOf(run) {
  if (!run) return null;
  if (run.startedBy === 'chief') return 'chief';
  if (run.trigger === 'bot') return run.fromBot?.id ? 'teammate' : null;
  if (run.jobId) return ['schedule', 'manual', 'call'].includes(run.trigger) ? 'job' : null;
  return run.trigger === 'manual' ? 'owner' : null;
}
// What a bot itself proposed in a run, for the owner to approve: a job, a tile of the Board, or a change to its
// instructions. After the yes the bot carries on with the request of that run, where the owner or a teammate
// started it; a job's own run is not repeated for it, and a run the Chief started is not handed back.
const proposed = (ask) => !!ask && (ask.proposal === true || ask.kind === 'proposal' || (ask.kind === 'bot-change' && ask.by === 'bot'));
// The owner wrote, in the chat this run is in: their message to the bot, or their message to a group that gave
// this turn. Not a job's "Run now", not the Chief's task, not a run botdot started, and not a turn in a group that
// a member handed on (`handedBy`, ADR 020): a bot named this one, the owner wrote nothing. Which chat it is in is
// asked beside it (sameChat). Not lib/read.js ownChatMessage, which is the bot's own chat alone.
const ownerWroteThere = (run) => starterOf(run) === 'owner' && !run.continues && !run.handedBy;
// Whether two runs are in one chat: the bot's own, or the same group (`groupId` on a turn there, ADR 018).
const sameChat = (a, b) => (a.groupId || null) === (b.groupId || null);
// A bot whose jobs are all switched off is paused: its face says so (server.js botStates). After a yes that stops
// a job's run from being repeated, and nothing else: what the owner, the Chief or a teammate asked of it carries on.
const paused = (bot) => (bot.jobs || []).length > 0 && !bot.jobs.some((j) => j.enabled);

// The rules of what a yes starts, in one place: the card's `then`, the yes itself and the queued work as it
// starts all ask here, so they cannot disagree. Pure: everything it decides from is handed in.
//   ask: `at` is when it was made, and its `runs` are the runs that wait for it, each with `at`, when it asked
//     (the queued work as it starts hands in the moment since when a message of the owner counts for it:
//     lib/bots.js startQueued); they count from `runsAt` where the card is older than its first run (a changed bot). `chatId`: the Chief chat that asked for it, at
//     `chatAt`, or when the ask was made. A waiting job and a waiting tile are handed in as { chatId, at }.
//     `startsBot`: its yes starts the bot itself also from a run the Chief started (a late yes on an action in a
//     connected app, ADR 010): the Chief gets no turn, so what the owner wrote in its chat does not count.
//   bot: the ask's bot as it is now, or null when it is gone.
//   stopped: { <run id>: the record of that waiting run }; a run that is missing here is no longer found.
//   later: records of the bot's runs that started since the ask was made, or since the oldest waiting run started,
//     and, as { trigger: 'manual', sentAt, startedAt }, each message of the owner that still waits for the bot.
//   chats: { <run id>: { id, title, wroteAt } }, the Chief chat whose reply started that run, and when the owner
//     last wrote in it.
//   chat: where botdot tells the Chief of an answer on what it asked for in `chatId`: that chat, { id, title,
//     wroteAt } (when the owner last wrote in it), or the one it tells in its place when that chat is gone; null
//     when a new chat would be made.
// The Chief carries on with what it asked for in a chat for 24 hours, and not once the owner wrote in that chat
// after it asked: they have taken it up themselves. It comes first of what carries on.
// Of the runs, nothing carries on when the bot is gone, or 24 hours after the first of them asked. Each then
// carries on unless its record is gone, the owner stopped it, a run already carried on from it, or the owner sent
// the bot a message after that run asked (its own `at` among the ask's runs), in the chat that run is in: the
// bot's own chat, or the group the run is a turn in (ADR 020). That message stands for what they want now. So of two requests that were refused the same and wait for one card the later carries on, and a job's
// run does not once the owner's request joined its card; where the later message was not refused it is on no
// card, and nothing that asked before it carries on. A run that asks after that message counts for itself, as
// does one the owner's message was sent before it asked, while it was still going. A job runs again once: for the
// latest of its runs, while the job is there, approved and, for a run at its time, switched on (a one-time job is
// gone as its run starts, and still runs), not when it ran again since, and not while the bot is paused: that
// holds for a job's run alone. A run the Chief started needs the
// chat that started it, and carries on once: of the runs it started from one chat only the latest counts, not
// once the Chief was told to start it again (`handedBackAt` on its record), and, where the Chief would get the
// turn, not once the owner wrote in that chat after that run asked (its own `at` among the ask's runs): then they
// have taken the work up there. Counted for each run from the moment it asked itself, not from when the card was
// made: a run can join a card that is older than the owner's request that led to it, and that request, like
// anything they wrote while the run was still going, is not the owner taking up what stopped. Returns what carries on,
// the Chief's own turn first, then the run that asked last:
// [{ who: 'chief', asker: true, chat: { id, title } | null, asked }] and
// [{ run, who: 'owner' | 'chief' | 'teammate' | 'job', at, asked, job?, chat? }]; asked: when it was asked for.
function whatCarriesOn({ ask, bot, stopped = {}, later = [], chats = {}, chat = null, now = Date.now() }) {
  if (!ask) return [];
  const out = [];
  const inChat = ask.chatId ? ask.chatAt || ask.at : null;
  const wroteSince = !!inChat && !!chat && chat.id === ask.chatId && Date.parse(chat.wroteAt) > Date.parse(inChat);
  if (inChat && stillWaits({ at: inChat }, now) && !wroteSince) out.push({ who: 'chief', asker: true, chat: chat ? { id: chat.id, title: chat.title } : null, asked: inChat });
  return [...out, ...runsThatCarryOn({ ask, bot, stopped, later, chats, now }).carry];
}
// The Chief chats in which a run that waits for this ask would carry on, had the owner not written there after
// that run asked: [{ id, title }], each once. A yes changes the setting, and botdot says so there in one line.
// Takes what whatCarriesOn takes.
function chatsTakenUp({ ask, bot, stopped = {}, later = [], chats = {}, now = Date.now() }) {
  return ask ? runsThatCarryOn({ ask, bot, stopped, later, chats, now }).takenUp : [];
}
// The newest first: the run that asked last, and of two that asked in one moment the one that started last.
const newestFirst = (a, b) => String(b.at).localeCompare(String(a.at)) || String(b.run.startedAt).localeCompare(String(a.run.startedAt));
function runsThatCarryOn({ ask, bot, stopped, later, chats, now }) {
  const asked = ask.runsAt || ask.at;
  if (!bot || !ask.runs?.length || !stillWaits({ at: asked }, now)) return { carry: [], takenUp: [] };
  const waiting = ask.runs.map((entry) => ({ run: stopped[entry.id], at: entry.at })).filter((w) => w.run && w.run.botId === bot.id).sort(newestFirst);
  // Of the runs the Chief started from one chat, the latest is the one that counts, whatever became of it.
  const latestOf = new Map();
  for (const w of waiting) if (starterOf(w.run) === 'chief' && chats[w.run.id] && !latestOf.has(chats[w.run.id].id)) latestOf.set(chats[w.run.id].id, w.run.id);
  const carry = [];
  const takenUp = [];
  for (const { run, at } of waiting) {
    if (run.status === 'stopped' || run.handedBackAt) continue;
    const who = starterOf(run);
    if (!who || later.some((r) => r.continues === run.id)) continue;
    if (proposed(ask) && (who === 'job' || who === 'chief')) continue;
    // The owner sent the bot a message after this run asked: what they wrote then stands for what they want now.
    // A message that waited its turn counts from when it was sent (`sentAt`, ADR 011), not from when its run started.
    // In the chat that run is in (ADR 020): what they wrote to a group stands for what they want there, and takes
    // up nothing in the bot's own chat; what they wrote in the bot's own chat takes up nothing in a group.
    if (later.some((r) => ownerWroteThere(r) && sameChat(r, run) && Date.parse(r.sentAt || r.startedAt) > Date.parse(at))) continue;
    const found = { run, who, at, asked };
    if (who === 'job') {
      const job = (bot.jobs || []).find((j) => j.id === run.jobId) || null;
      if (paused(bot) || (job ? !job.approved || (['schedule', 'call'].includes(run.trigger) && !job.enabled) : !run.oneTime)) continue;
      if (later.some((r) => r.id !== run.id && r.jobId === run.jobId && r.startedAt > run.startedAt)) continue;
      if (job) found.job = job;
    }
    if (who === 'chief') {
      const chat = chats[run.id];
      if (!chat || latestOf.get(chat.id) !== run.id) continue;
      found.chat = { id: chat.id, title: chat.title };
      // The owner wrote in that chat after this run asked: they have taken the work up there themselves.
      if (!ask.startsBot && Date.parse(chat.wroteAt) > Date.parse(at)) { takenUp.push(found.chat); continue; }
    }
    carry.push(found);
  }
  return { carry, takenUp };
}

// `then` of an ask (docs/api.md): one sentence for its card about what a yes starts, from the first of what
// carries on. Nothing when a yes only changes the setting.
const REQUEST_MAX = 80;
function thenOf(found) {
  const first = found[0];
  if (!first) return null;
  const { run, who } = first;
  // No chat is left to carry on in (the one that asked is gone, and there is no other): a new one is made.
  if (who === 'chief' && !first.chat) return { who: 'chief', text: 'The Chief carries on in a new chat when you allow it.' };
  if (who === 'chief') return { who: 'chief', text: `The Chief carries on in “${oneLine(first.chat.title)}” when you allow it.`, chatId: first.chat.id, here: 'The Chief carries on in this chat when you allow it.' };
  if (who === 'job') return { who: 'bot', text: `It runs “${oneLine(first.job?.name || run.jobName)}” again when you allow it.` };
  if (who === 'teammate') return { who: 'bot', text: `It carries on with ${oneLine(run.fromBot.name)}'s request when you allow it.` };
  return { who: 'bot', text: `It carries on with “${clipTo(oneLine(run.prompt), REQUEST_MAX)}” when you allow it.` };
}

module.exports = { DECLINE_NEW, DECLINED_NEW, KEEP, APPROVE_CHANGE, changedWords, keptWords, jobChangeText, tileChangeText, proposed, create, proposalView, sizeText, askText, jobText, tileText, listed, appWord, actionPhrase, actionRows, ACTION_THEN, grantWords, heldPermissions, staleChange, answerWords, starterOf, paused, stillWaits, whatCarriesOn, chatsTakenUp, thenOf, PERMISSIONS, TOOL_PERMISSION, VAULT_SWITCHES, DECLINE_DAYS, CARRY_HOURS, TEXT_MAX };
