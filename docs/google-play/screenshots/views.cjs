// The answer views of the Play screenshots' scene (docs/google-play/README.md; ADR 264): each is a ```ui fence a bot or the
// Chief writes in a reply, in the format lib/ui-catalog.json defines, with made-up figures. scene.cjs puts them in the
// replies; test/google-play.test.js reads each with the app's own validator and fails on anything it cuts or leaves out,
// so a view that an app would draw as less than written never reaches a picture.
const fence = (type, v) => `\`\`\`${type}\n${JSON.stringify(v)}\n\`\`\``;

// The Chief's plan for the bot it made (Chief, first turn).
const CHIEF_PLAN = {
  alt: 'The plan for Recipe Finder: made, first dinner ideas at 17:00, then tell it what is in the fridge.',
  root: { type: 'steps', items: [
    { title: 'Recipe Finder is made', text: 'One job: three dinners from what is in the fridge.', state: 'done' },
    { title: 'First ideas', text: 'Today at 17:00, then every day, the quickest first.', state: 'current' },
    { title: 'Tell it what you have', text: 'Or say “add it to the shopping list” under any recipe.', state: 'todo' },
  ] },
};

// Server Watch: its gauges and numbers read the Board's tiles (Disk; CPU and RAM), so they are live; the written values stay under them.
const SERVER_NOW = {
  alt: 'The home server now: disk 62%, CPU 24%, RAM 60%, 48 °C.',
  root: { type: 'grid', columns: 2, children: [
    { type: 'gauge', label: 'Disk', value: 62, unit: '%', tone: 'good', tile: 'Disk', bind: 'value.used', source: 'the Disk tile' },
    { type: 'gauge', label: 'CPU', value: 24, unit: '%', tone: 'good', tile: 'CPU and RAM', bind: 'value.cpu', source: 'the CPU and RAM tile' },
    { type: 'gauge', label: 'RAM', value: 60, unit: '%', tone: 'good', tile: 'CPU and RAM', bind: 'value.ram', source: 'the CPU and RAM tile' },
    { type: 'gauge', label: 'Temperature', value: 48, unit: '°C', max: 90, tone: 'good', source: 'the sensors' },
  ] },
};

// Money Tracker: a trend in a chart, with the figures that matter above it.
const SPENDING = {
  alt: 'Monthly spending, May to October, by rent, groceries and the rest: €1,840 in October, down from €2,102 in August.',
  root: { type: 'stack', children: [
    { type: 'stat-row', children: [
      { type: 'kpi', label: 'October', value: '€1,840', points: [2102, 1960, 1840], good: 'down', source: 'bank-export.csv' },
      { type: 'kpi', label: 'Groceries', value: '€401', points: [452, 418, 401], good: 'down', source: 'bank-export.csv' },
    ] },
    { type: 'chart', title: 'Spending a month, in €', style: 'stacked', labels: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'], series: [
      { label: 'Rent', points: [720, 720, 720, 720, 720, 720] },
      { label: 'Groceries', points: [410, 395, 430, 452, 418, 401] },
      { label: 'The rest', points: [560, 640, 810, 930, 822, 719] },
    ], source: 'bank-export.csv' },
  ] },
};

// Spanish Coach: a quiz the owner answers; the progress above it.
const QUIZ = {
  alt: 'Spanish quiz, question 1 of 5: how to ask for the bill.',
  root: { type: 'stack', children: [
    { type: 'progress', label: 'Restaurant Spanish', value: 20, text: 'Question 1 of 5', tone: 'accent' },
    { type: 'quiz', question: 'How do you ask the waiter for the bill?', options: ['La cuenta, por favor', 'El menú, por favor', 'Una mesa, por favor', 'Otra agua, por favor'], answer: 0, explain: 'Cuenta is the bill; menú is the menu.' },
  ] },
};

// Quote Chaser, in the team's chat: three contractors side by side, the pick marked.
const QUOTES = {
  alt: 'Three kitchen quotes compared on price, start, length and warranty; Brightwood is recommended.',
  root: { type: 'comparison', title: 'Kitchen quotes', options: ['Oakline', 'Brightwood', 'Northside'], pick: 1, rows: [
    { label: 'Price', values: ['€14,800', '€13,900', 'waiting'] },
    { label: 'Starts', values: ['6 Jan', '13 Jan', '—'] },
    { label: 'Takes', values: ['3 weeks', '2 weeks', '—'] },
    { label: 'Warranty', values: ['5 years', '2 years', '—'] },
  ] },
};

const VIEWS = { CHIEF_PLAN, SERVER_NOW, SPENDING, QUIZ, QUOTES };

module.exports = { VIEWS, fence, ui: (view) => fence('ui', view) };
