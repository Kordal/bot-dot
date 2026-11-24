// The prompts the eval of answer views (ui-eval.test.js) puts to a bot, and what each is scored on (ui-scoring.js,
// score()). Each is one message to a plain bot with every figure it needs inside it, so that the run is one turn with
// no lookup and no tool but the Skill tool. The data is made up.
//
// A case: { id, says (what the owner types), view: true (a view is right: the skill should be picked and a valid view
// drawn), false (prose is right: no skill, no fence) or 'either' (the form: inputs are wave 2 of #1622, so for now a
// view or a written list is fine, and a fence written must still be valid), fits?: components one of which a view
// that answers it uses, wave? }.

const CASES = [
  {
    id: 'compare-three',
    view: true,
    fits: ['comparison', 'table'],
    says: 'Compare these three standing desks for me and tell me which to buy. Lift Pro 140: €379, 2 motors, 10-year frame warranty, 4.6 stars. Ergo Frame S2: €339, 1 motor, 5-year warranty, 4.4 stars. Flex Desk 120: €299, 1 motor, 2-year warranty, 4.1 stars.',
  },
  {
    id: 'time-series',
    view: true,
    fits: ['chart', 'sparkline'],
    says: 'Here are my monthly sign-ups for this year: January 120, February 128, March 135, April 149, May 158, June 166, July 171, August 160. Show me the trend and say what stands out.',
  },
  {
    id: 'four-field-form',
    view: 'either',
    wave: 2,
    says: 'Help me plan a weekend trip. You need four things from me before you start: the destination, the dates, my budget and how many people come. Ask me for all four at once.',
  },
  {
    id: 'one-line-fact',
    view: false,
    says: 'What is the capital of Poland?',
  },
  {
    id: 'apology',
    view: false,
    says: 'You sent me last week\'s report again instead of this week\'s, and I noticed only in the meeting. I was not happy. What do you say to me?',
  },
  {
    id: 'yes-no',
    view: false,
    says: 'Is 2027 a leap year? Just yes or no, please.',
  },
];

module.exports = { CASES };
