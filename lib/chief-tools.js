// What the Chief's tools mean for memory (ADR 017): which of them write notes, and which hand it text that
// is not the owner's. And which of them make or change a group, with the words botdot says of that (GRP-007).
// It requires nothing, so the Chief's MCP server (mcp-server.js), the Chief's turns (chief.js) and the botdot
// server read the same lists.

// The Chief's own place for notes, as a note's `owner`: beside a bot's id and the shared notes' "_shared".
// A bot's id is eight hex characters, so no bot has it.
const CHIEF_NOTES = 'chief';

// The tools that write memory. Only a turn the owner started is given them, and the route behind them
// (POST /api/chief/memory) refuses a call from any other turn.
const MEMORY_WRITES = ['remember', 'update_note', 'remove_note', 'restore_note', 'forget'];

// The tools that make or change a group (CONTEXT.md: Group). As for memory, only a turn the owner started is
// given them, and the routes behind them (POST /api/group-chats, PUT /api/group-chats/:id) refuse the Chief's
// call from any other turn: the Chief makes a group when the owner asks for one, never by itself.
const GROUP_WRITES = ['create_group', 'update_group'];
// The tools that make or change an item of the Vault (#181, #182, #183): an SSH key for the bots, which the Chief
// makes, shares and renames but never reads, and the ask to remove an entry, which the owner allows on a card. As
// for a group, only a turn the owner started is given them, and the routes behind them (POST /api/vault/ssh-keys,
// PUT /api/vault/:id, POST /api/vault/remove) refuse the Chief's call from any other turn.
const VAULT_WRITES = ['create_ssh_key', 'update_vault_item', 'remove_vault_item'];
// Every tool that only a turn the owner started is offered.
const OWNERS_TURN_ONLY = [...MEMORY_WRITES, ...GROUP_WRITES, ...VAULT_WRITES];

// What a tool's answer always holds, by kind: a bot's text ('bot': a reply, a run), text from elsewhere
// ('web': a registry, a catalogue, a link, a tile's value), a connected app's ('app') or a file ('file'). A turn that asked for one of
// these has read it: what it saves afterwards is not the owner's word, and a forget or a change to what the
// owner said waits for them.
const READS = {
  get_run: 'bot', wait_for_run: 'bot', list_runs: 'bot', run_job: 'bot', stop_run: 'bot',
  checkup: 'bot', // what botdot recorded of the bots' runs and chats (ADR 023)
  get_bot: 'bot', // a bot in full: with the question its last reply asks, and a change to a job it proposed
  computer_status: 'bot', computer_logs: 'bot', restart_computer: 'bot', // a bot's computer: Docker's words and what its programs printed (#59)
  get_board: 'web', test_tile: 'web', add_tile: 'web', update_tile: 'web', remove_tile: 'web', arrange_board: 'web',
  find_tool: 'web', list_tools: 'web', list_connectors: 'web', list_skills: 'web', ask_install_skill: 'web', ask_install_tool: 'web',
  Read: 'file', Grep: 'file',
  // Claude Code's own search and page reading: a page's text, and what a search found, are the web's.
  WebSearch: 'web', WebFetch: 'web',
  // A connected app (ADR 047): what an action answers is the app's ('app': an email, an issue), and its list of
  // actions is Composio's catalogue.
  connector_run: 'app', connector_actions: 'web',
};

// The tools that bring a web page or a search into the Chief's chat. Once one has been asked for, that chat's
// session holds what the web wrote, and what the Chief changes from then on waits for the owner (server.js
// heldAfterWeb).
const WEB_READS = ['WebSearch', 'WebFetch'];

// The tools whose answer holds nothing of that kind: botdot's own words, settings the owner approved, or what
// the Chief itself just sent. recall and list_notes are here because the botdot server decides for them, by
// what it hands over: a past run, or a note that is not the owner's, marks the turn (server.js).
const CLEAN = [
  ...MEMORY_WRITES, 'recall', 'list_notes',
  'list_bots', 'create_bot', 'duplicate_bot', 'update_bot', 'delete_bot', 'run_bot', // list_bots: the bots' settings alone (mcp-server.js botSummary)
  // A group as the Chief is handed it: its name and its members' names, nothing of its chat (server.js groupForChief).
  'list_groups', ...GROUP_WRITES,
  'add_job', 'update_job', 'remove_job',
  'propose_job_call', 'job_call', 'new_job_call_key', 'job_call_off', // a job's call: botdot's own words, never the key (ADR 026)
  'propose_job_notify', 'new_job_notify_secret', 'job_notify_off', // a job's notify address: never the secret (#37)
  'remind_me', 'list_reminders', 'cancel_reminder',
  'memory_status', 'set_memory_settings', 'download_search_model', 'review_memory',
  'set_quiet_hours', 'writing_first', 'checkup_settings', 'set_your_name', 'create_skill', 'update_skill', 'remove_tool',
  'list_vault', 'request_login',
  ...VAULT_WRITES, // the key's name, its public half, its fingerprint and its bots: never its private key
  'reset_computer', // a card for the owner, in botdot's own words (#107)
  'connector_grants', 'remove_connector_grant', // the Chief's lasting grants in connected apps: an app and an action's name (ADR 047)
  // Claude Code's own: file names, the Chief's skills, which ship with botdot, and its look-up of a tool's schema,
  // which it makes before nearly every call of a botdot tool.
  'Glob', 'Skill', 'ToolSearch', 'TodoWrite',
];

// What a turn has read once it asks for this tool (Claude Code's name for it), or null for nothing. A tool
// that neither list names counts as read ('unknown'): a new tool is clean only when someone says so here.
function readKind(name) {
  const tool = String(name || '').replace(/^mcp__(botdot|connectors)__/, '');
  if (CLEAN.includes(tool)) return null;
  return READS[tool] || 'unknown';
}

// ---------- an SSH key the Chief makes ----------

const VAULT_SAY = {
  notNow: 'Not done: you make an SSH key only in a turn the user started by writing to you. Nothing was made. Say what you would have done; the user can tell you to.',
  noBitwarden: "No SSH key was made: SSH keys are kept in the user's Bitwarden, which is not connected. Tell them in one line to connect it on the Vault page.",
  locked: "No SSH key was made: the user's Bitwarden is locked. Tell them in one line to unlock it in botdot, then ask again.",
  noPaste: 'A private key never goes through your chat: you only make a new one. The user adds a key of their own on the Vault page.',
  self: 'You cannot use an SSH key: only bots do. Nothing was made.',
  selfChange: 'You cannot use an SSH key: only bots do. Nothing was changed.',
  noBot: (word, what = 'made') => `There is no bot "${String(word).slice(0, 60)}". Nothing was ${what}.`,
  notNowChange: 'Not done: you change an SSH key only in a turn the user started by writing to you. Nothing was changed. Say what you would have done; the user can tell you to.',
  noBitwardenChange: "Nothing was changed: SSH keys are kept in the user's Bitwarden, which is not connected. Tell them in one line to connect it on the Vault page.",
  lockedChange: "Nothing was changed: the user's Bitwarden is locked. Tell them in one line to unlock it in botdot, then ask again.",
  noKey: (word) => `There is no SSH key "${String(word).slice(0, 60)}" in the Vault. list_vault shows them. Nothing was changed.`,
  onlyKeys: (name) => `Not changed: "${String(name).slice(0, 60)}" is no SSH key, and you change only SSH keys. The user changes a password, a token or a card on the Vault page.`,
  nothing: 'Say what to change: the bots to add or take off, or a new name.',
  notNowRemove: 'Not done: you ask to remove an entry of the Vault only in a turn the user started by writing to you. Nothing was asked. Say what you would have asked; the user can tell you to.',
  remove: {
    noEntry: 'Say which entry to remove, by the name list_vault shows. Nothing was asked.',
    noTrash: "Nothing was asked: the user's Vault is not in Bitwarden, and only Bitwarden keeps a removed entry in its Trash. Tell the user which entry is no longer needed.",
    locked: "Nothing was asked: the user's Bitwarden is locked. Tell them in one line to unlock it in botdot, then ask again.",
    list: 'list_vault',
    declined: "The user said no to removing this recently. Don't ask again; leave the entry as it is.",
  },
  emptyVault: "Nothing was changed: the Vault lists nothing, so the user's Bitwarden is locked or not connected. Tell them in one line to unlock it in botdot, then ask again.",
};

// ---------- a group the Chief makes or changes ----------

const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`); // "A, B and C"

const GROUP_SAY = {
  self: 'You cannot be in a group: its members are bots. Nothing was made or changed.',
  notNow: 'Not done: you make and change a group only in a turn the user started by writing to you. Nothing was made or changed. Say what you would have done; the user can tell you to.',
  nothing: "Say what to change: the group's name, or the bots to add or take out.",
};

// What botdot says of a group the Chief made (before: null) or changed, written from the records as they were
// stored: { say, chip }. `say` is the sentence for the Chief to pass on; `chip` is the line the apps print under
// its reply, absent when the call changed nothing. names: a bot's id -> its name.
function groupChange(before, after, names = {}) {
  const of = (ids) => listed(ids.map((id) => names[id] || id));
  const members = of(after.members);
  if (!before) return { say: `The group ${after.name} is made, with ${members}. It is in the user's list now: they write to it there.`, chip: `Made the group ${after.name}: ${members}` };
  const added = after.members.filter((id) => !before.members.includes(id));
  const out = before.members.filter((id) => !after.members.includes(id));
  const did = [
    ...(before.name !== after.name ? [`Renamed the group ${before.name} to ${after.name}`] : []),
    ...(added.length ? [`Added ${of(added)} to ${after.name}`] : []),
    ...(out.length ? [`Took ${of(out)} out of ${after.name}`] : []),
  ];
  // The same members in another order: the order the turns are given in.
  if (!did.length && before.members.join() !== after.members.join()) did.push(`Changed the order in ${after.name}`);
  if (!did.length) return { say: `Nothing changed: the group ${after.name} has ${members}.` };
  return { say: `${did.join('. ')}. The group ${after.name} now has ${members}.`, chip: did.join(' · ') };
}

module.exports = { WEB_READS, CHIEF_NOTES, MEMORY_WRITES, GROUP_WRITES, VAULT_WRITES, OWNERS_TURN_ONLY, READS, CLEAN, readKind, GROUP_SAY, VAULT_SAY, groupChange };
