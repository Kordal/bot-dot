// A bot takes back a card of its own that it no longer needs (withdraw_card, ADR 228): the owner changed plans, or the
// work went another way. The card goes from Needs you and from its chat as if nobody answered it: no yes, no no, and
// nothing carries on. A run that waits for it is told it was withdrawn and goes on without it. A bot may withdraw a
// card of a teammate too (the bots its prompt lists cards of), so whoever the owner tells "we won't need it" can clear
// it. Ids are the ones its prompt names after each card (`[card …]`).

// The card ids a bot's prompt names: an ask's id, or a login request's.
const cardTag = (id) => `[card ${id}]`;

// asks: lib/asks.js; loginRequests: lib/login-requests.js; connectorApprovals, irreversibleSteps: their stores, told
// when a card a run waits for goes.
function create({ asks, loginRequests, connectorApprovals, irreversibleSteps }) {
  // Withdraws the card `id` of one of `botIds`. Returns { ok, text } with what the bot is told; throws when there is no
  // such card of those bots.
  function withdraw(botIds, id) {
    const want = String(id ?? '').replace(/^\[?card\s+/i, '').replace(/\]$/, '').trim();
    if (!want) throw new Error('Say which card with id, as your prompt names it after the card: [card <id>].');
    const mine = (botId) => !!botId && botIds.includes(botId);
    const r = loginRequests.get(want);
    if (r && r.status === 'pending' && mine(r.botId)) {
      loginRequests.withdraw(r.id);
      return { ok: true, text: `Withdrawn: the ${r.kind === 'card' ? 'card payment' : 'login'} request for ${r.site} is gone from Needs you. Don't ask for it again unless the owner asks you to.` };
    }
    const [a] = asks.drop((x) => x.id === want && mine(x.botId));
    if (a) {
      if (a.kind === 'connector-action') connectorApprovals.withdrawn(a);
      if (a.kind === 'computer-step') irreversibleSteps.withdrawn(a);
      return { ok: true, text: "Withdrawn: the card is gone from Needs you, and nothing of it was done. Don't ask for it again unless the owner asks you to." };
    }
    throw new Error(`No card ${want} of yours waits in Needs you now: it was answered or is gone. Nothing to withdraw.`);
  }
  return { withdraw };
}

module.exports = { create, cardTag };
