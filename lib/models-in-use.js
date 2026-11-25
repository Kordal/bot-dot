// Which model, provider and reasoning level each bot, the Chief, the account default and the background calls run on
// (#1684, ADR 267): what a run would use now, as settings resolves it (forBot, forChief, forHelper), not the saved field,
// so a model whose provider was removed shows the one it really runs on. The Chief reads it (mcp-server.js models_in_use).
// Words for the owner only: never a key, an address or a price.
const groupRouter = require('./group-router');
const groupNotes = require('./group-notes');
const wakeGate = require('./wake-gate');
const followUp = require('./follow-up');
const shadow = require('./shadow');
const companyTeam = require('./company-team');

// The short calls that botdot makes on its own, each with what it is for and the model it asks (a small Claude one for
// most: forHelper turns it into the account default's provider's small model, ADR 255). `on` leaves out one that is off.
// `tries`: the calls the admin's Jev (group router setting) is asked first for.
const BACKGROUND = [
  { what: 'Who a group message is for', model: groupRouter.MODEL, on: groupRouter.on, jev: true },
  { what: "A group's notes", model: groupNotes.MODEL, on: groupNotes.on },
  { what: 'Whether a note needs a run (the wake gate)', model: wakeGate.MODEL, on: wakeGate.on, jev: true },
  { what: 'What a message to a busy bot is', model: followUp.MODEL, on: followUp.on, jev: true },
  { what: "Whether a shadow script told the same as the AI", model: shadow.MODEL },
  { what: "Explaining an app's error", model: 'haiku' },
  { what: "A project's team proposal", model: companyTeam.MODEL },
];

// bots: the account's bots; reviewModel: the memory review's saved model (lib/memory.js reviewSettings).
function build({ settings, bots, reviewModel, router = groupRouter.config().router, lang = 'en' }) {
  const describe = settings.describer(lang);
  const s = settings.get();
  const level = (model) => (settings.supportsEffort(model) ? 'medium' : '');
  const helper = (model, effort = '') => describe(settings.forHelper({ model, effort }));
  return {
    accountDefault: describe(settings.forBot({ model: s.defaultModel, effort: s.defaultEffort })),
    chief: describe(settings.forChief(), { saved: s.chiefModel }),
    bots: bots.map((b) => ({ id: b.id, name: b.name, ...describe(settings.forBot(b), { saved: b.model }) })),
    background: [
      ...BACKGROUND.filter((c) => !c.on || c.on()).map((c) => ({ for: c.what, ...helper(c.model), ...(c.jev && router === 'jev' ? { triedFirst: 'Jev on OpenRouter, which the admin chose for this machine' } : {}) })),
      { for: "Each bot's weekly memory review, and the Chief's", ...helper(reviewModel, level(reviewModel)) },
    ],
    note: 'Background calls follow the account default\'s provider: a small Claude model they ask for runs as that provider\'s small model. A reasoning level of "the model\'s own" means none is sent.',
  };
}

module.exports = { build, BACKGROUND };
