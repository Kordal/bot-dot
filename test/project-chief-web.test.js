// The Chief's head beside a project's gear (project-chief): drawn only from a server that has it, in the header after
// the gear, opening the project's own Chief chat in the column (Dock.openChief), made on the first tap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test("the head is drawn only with project-chief, after the gear, with what waits there as its number", () => {
  const co = read('company.js');
  const html = co.slice(co.indexOf('const chiefHTML = () =>'), co.indexOf('async function openProjectChief'));
  assert.match(html, /includes\('project-chief'\)/);
  assert.match(html, /data-project-chief/);
  assert.match(html, /co-chief-n/);
  const waiting = co.slice(co.indexOf('function chiefWaiting'), co.indexOf('const chiefHTML'));
  assert.match(waiting, /Unread\.count/);
  assert.match(waiting, /a\?\.chatId === id/);
  const home = read('company-home.js');
  assert.ok(home.indexOf('Company.gearHTML()') < home.indexOf('Company.chiefHTML()'), 'after the gear');
});

test('a tap opens its saved chat, or resumes an interrupted creation before opening it', async () => {
  const vm = require('node:vm');
  const opened = [], requests = [];
  const state = { company: { id: 'p', chiefChat: 'saved' }, view: 'company' };
  const ctx = vm.createContext({ state, place: 'company', Dock: { openChief: (id) => opened.push(id) },
    at: (p) => p, projects: () => [], changed: (d) => { state.company = d.company; }, toast: () => {},
    api: async (p) => { requests.push(p); return { chatId: 'saved', company: { creationSent: true } }; },
  });
  const co = read('company.js');
  vm.runInContext(co.slice(co.indexOf('  const openingChief ='), co.indexOf('  function wirePick')), ctx);
  await ctx.openProjectChief();
  assert.deepEqual(opened, ['saved']);
  assert.deepEqual(requests, []);
  state.company = { ...state.company, conversation: true, creationSent: false };
  await ctx.openProjectChief();
  assert.deepEqual(requests, ['/company/chief-chat']);
  assert.equal(state.company.creationSent, true);
  assert.deepEqual(opened, ['saved', 'saved']);
});

test("the compass is always the Chief's, and the Project Manager the owner picked has its own head beside it, opening its chat (ADR 230)", () => {
  const co = read('company.js');
  const chief = co.slice(co.indexOf('const chiefHTML = () =>'), co.indexOf('const managerHTML'));
  assert.match(chief, /chiefFigure\('sm'\)/);
  assert.doesNotMatch(chief, /botFigure|\.lead/, "the project's lead no longer takes the Chief's place");
  const manager = co.slice(co.indexOf('const managerHTML'), co.indexOf('// Tidy up (board-tidy)'));
  assert.match(manager, /includes\('project-manager-bot'\) && state\.company\?\.lead \? botById\(state\.company\.lead\) : null/);
  assert.match(manager, /if \(!b\) return '';/);
  assert.match(manager, /data-project-manager="\$\{esc\(b\.id\)\}"/);
  assert.match(manager, /botFigure\(b\.color, b\.state, 'sm', b\.outfit, b\.id\)/);
  assert.match(chief, /\$\{managerHTML\(\)\}/, 'right after the Chief');
  assert.match(co, /\$\$\('\[data-project-manager\]', root\)\.forEach\(\(b\) => \(b\.onclick = \(\) => Dock\.kinds\.bot\.open\(b\.dataset\.projectManager\)\)\)/);
});
