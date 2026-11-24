// #1106: the Chief's tools say each field's words once, on the tool that makes the thing (add_tile, create_bot). The
// tools that change or try it (update_tile, test_tile, update_bot) take the same fields with the same types, enums and
// shapes, so a call is checked as before, without the prose.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TOOLS } = require('../lib/mcp-server');

const tool = (name) => TOOLS.find((x) => x.name === name);
const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'description' && typeof v === 'string' ? undefined : v)));

test('a tool that changes another one\'s thing takes its fields without their words', () => {
  for (const [changes, makes] of [['update_tile', 'add_tile'], ['update_bot', 'create_bot']]) {
    const own = tool(changes).inputSchema.properties;
    const made = tool(makes).inputSchema.properties;
    // update_bot alone has the two of a bot's machine on the External Virtual PC (ADR 263), with their words: a new bot shares the account's.
    const extra = changes === 'update_bot' ? ['boatOwnMachine', 'moveFiles'] : [];
    assert.deepEqual(Object.keys(own), ['id', ...Object.keys(made), ...extra], changes);
    for (const [f, schema] of Object.entries(made)) assert.deepEqual(own[f], strip(schema), `${changes}.${f}`);
    const { boatOwnMachine: _a, moveFiles: _b, ...theRest } = own;
    assert.doesNotMatch(JSON.stringify(theRest), /"description":"/, `${changes} says no field's words`);
    assert.match(tool(changes).description, new RegExp(`Its fields are ${makes}'s`));
  }
  for (const [f, schema] of Object.entries(tool('test_tile').inputSchema.properties)) assert.deepEqual(schema, strip(tool('add_tile').inputSchema.properties[f]), `test_tile.${f}`);
  assert.ok(tool('update_bot').inputSchema.properties.description, 'a field named "description" stays');
});

test("the Chief's tools are about 25k characters shorter", () => {
  const size = TOOLS.reduce((n, x) => n + JSON.stringify(x).length, 0);
  // 111k: set_company_team's proposal lists its bots' fields (a bare object refused every field as unknown).
  // 111.2k: set_project_goal, the goal's sentence and a new objective, which project settings no longer show.
  // 111.3k: arrange_project_board hides and shows pieces, the overview's four among them (ADR 245).
  // 111.4k: update_bot's disabledSkills names the kit's always-on writing style (ADR 246).
  // 113.1k: watch, list_watches and stop_watch, the Chief's waits that botdot reads without AI (ADR 248).
  // 113.2k: change_project_card's textSize, how large a card's text is drawn.
  // 113.4k: create_bot and update_bot take verbatim, a task the owner dictated, which hints leave alone (#1543).
  // 113.8k: update_bot's boatOwnMachine and moveFiles, a bot's machine of its own on boat.dev (ADR 263).
  // 114.9k: list_mcp_servers and offer_mcp_server, the owner's own remote MCP servers (ADR 266).
  // 115.7k: around on add_job, update_job, add_my_job and update_my_job, a job the owner named no clock time for (#1667).
  assert.ok(size < 115_700, `${size} characters`);
});
