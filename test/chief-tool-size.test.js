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
    assert.deepEqual(Object.keys(own), ['id', ...Object.keys(made)], changes);
    for (const [f, schema] of Object.entries(made)) assert.deepEqual(own[f], strip(schema), `${changes}.${f}`);
    assert.doesNotMatch(JSON.stringify(own), /"description":"/, `${changes} says no field's words`);
    assert.match(tool(changes).description, new RegExp(`Its fields are ${makes}'s`));
  }
  for (const [f, schema] of Object.entries(tool('test_tile').inputSchema.properties)) assert.deepEqual(schema, strip(tool('add_tile').inputSchema.properties[f]), `test_tile.${f}`);
  assert.ok(tool('update_bot').inputSchema.properties.description, 'a field named "description" stays');
});

test("the Chief's tools are about 25k characters shorter", () => {
  const size = TOOLS.reduce((n, x) => n + JSON.stringify(x).length, 0);
  // 111k: set_company_team's proposal lists its bots' fields (a bare object refused every field as unknown).
  // 111.2k: set_project_goal, the goal's sentence and a new objective, which project settings no longer show.
  assert.ok(size < 111_200, `${size} characters`);
});
