# ADR-052: The owner may lift a bot's rule on a card

- **Status:** Accepted (by the owner, 2026-10-21)
- **Owning task:** [#253](https://github.com/Kordal/bot-dot/issues/253)
- **Changes:** a bot's own rules (its prompt and botdot's rules in it) were final: a bot refused when one of them stopped what the owner asked, and the owner could do nothing but do it by hand

## Context

A bot's rules are text in its prompt. When one of them stops what the owner asked ("never touch other bots' files"), the bot refuses, and the only way out was to change the bot's rules for good or do the work by hand. The owner wants a way to say "yes, this once" or "yes, always for this bot" without rewriting the bot.

## Decision

- **The bot asks instead of refusing.** Its tool `ask_override` (`{ rule, action, reason }`) adds a card of kind `override`: "Let <bot> do this, though its rules say no?", with the rule and the one action it would take, and Decline, "Allow once" and "Allow always for this bot".
- **Allow once** lets the waiting run carry on, told in botdot's words that the owner allowed that action once, in this run. When no run can carry on (it was stopped, or 24 hours passed), the bot's next run is told instead, and no later one. Nothing else is kept.
- **Allow always** also keeps the grant (`{ id, rule, action, at }`) in the bot's `overrides`, at most 10. Every later run of the bot is told the lifted rules at the start of its task, in botdot's words, not in the system prompt (it is near its size cap).
- **Only the owner's card gives a grant.** `overrides` is set through a symbol the routes never read from a body: the owner's settings, the Chief and a bot cannot write it. The Chief and a bot's run get `403` on the card.
- **The owner sees and revokes them.** The bot's settings list "Rules you lifted" with Revoke (web and Android). Every yes and every revoke is in the audit log, with ids and never the words.
- **The bot's words are never markup.** The rule and the action are kept on one line, with `<` and `>` replaced, as they are printed into its runs' prompts.
- **A no lasts a week**, as for every other card.
- **Some things are not a bot's rule and stay:** a secret value in a chat or in the model's context, a bot answering its own card, and another account's data. Code enforces these, whatever a card says.

## Alternatives

- **Let the owner edit the bot's rules.** It already exists and changes them for every case, not for the one action.
- **Grant by rule only, for any action.** Too wide: the owner approves what they read on the card, so a grant covers that rule and that action.

## Consequences

- A bot may now do what its rules forbid, once the owner says so. A permanent grant stays until revoked.
- An app from before draws no override card (it asks for it with `?override=1`) and shows no "Rules you lifted"; a notification still offers Decline.
