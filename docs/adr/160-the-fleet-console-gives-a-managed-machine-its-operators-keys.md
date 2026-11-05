# ADR-160: The fleet console gives a managed machine its operator's keys

- **Status:** Accepted
- **Owning task:** the owner's request in the project thread "Share my API keys across all servers": every machine the owner runs from the console uses only the owner's own keys, safely, for Jev and Composio.
- **Builds on:** [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (the console reaches a machine only through its agent and root's requests), [ADR 082](082-the-admin-chooses-haiku-or-jev-to-pick-who-answers-in-a-group.md) (Jev and its OpenRouter key) and the Connectors' own Composio key (`lib/connectors.js`).

## Context

On a managed machine neither Jev nor Connectors could work. Jev's OpenRouter key is set on the admin page, which a managed machine doesn't have, and a machine of one account had no group router at all. The installer takes `BOT_DOT_OPENROUTER_KEY`, but only at the first install, and the console didn't give it. Connectors need a Composio key that each account's owner pastes; the operator, who runs these machines, had to paste a key into each account by hand. boat.dev isn't wanted on managed machines: their bots' computers are the machine's own.

## Decision

- **The console holds the operator's keys and gives each machine its own.** For Jev, a key of the operator's OpenRouter account per machine, made with a provisioning key that stays in the console, with a limit of its own, and revoked when the machine is deleted. For Composio, the key of a Composio project made for that machine: connections in one project are reachable with its key, so a key shared by every machine would let any one of them reach every machine's connected apps.
- **At the install, from the installer's settings.** `BOT_DOT_OPENROUTER_KEY` as before and, on a managed machine alone, `BOT_DOT_COMPOSIO_KEY`, checked with one call and handed to the front door in `data/install-keys.json`.
- **After the install, a root request `KEYS`.** Root's alone like `BACKUP` and `OFFSITE`: lines of `openrouter <key>` and `composio <key>`, written 600 by the console's agent and removed as soon as it is read. Root's step writes them to `install-keys.json`, which the front door takes within a minute without a restart, and says which it handed in `status/keys.json`, never a key. A new key replaces the old one: that is how a key is rotated.
- **The front door keeps them as it keeps the installer's.** Jev's in `group-router.json`, which a managed machine of one account now has too; the Composio key in `composio.json` (600), a managed machine's alone. Each account's botdot server is handed them every minute and keeps them in memory alone.
- **An account's own Composio key wins.** Connectors use the machine's key while the account has none (`account: "machine"`), and show neither its end nor Replace and Remove: it is the operator's to change. When Composio refuses it, Connectors say so and nothing else.

## Alternatives

- **A proxy in the console that adds the keys to every call.** No key on any machine. Rejected: every Jev decision, which must answer in a fraction of a second, and every Composio action would go through one service, which would be every machine's single point of failure, and the console would sit in the path of what the bots do in the owner's apps.
- **One key of each for every machine.** Simplest. Rejected: one machine taken over would expose every machine's Composio connections, and the one key could only be revoked for all of them at once.
- **The agent writes the front door's files itself.** Rejected as in ADR 159: root's setup would live in a second place, against ADR 154's rule that the agent only writes requests and reads status.
- **The console pastes the Composio key into each account's Connectors.** Rejected: the key would be stored inside the account as the owner's own, and the console never reaches into an account (ADR 154).

## Consequences

- Jev and Connectors work on a managed machine with no admin page and no step of the owner's.
- Root on a machine, and only root, can read that machine's keys, as it can read the Vault's key today. A container escape there reaches that machine's OpenRouter key, within its limit, and its own Composio project, not another machine's.
- The operator pays for the OpenRouter use of every managed machine given a key; the limit on each key bounds it.
- A machine that isn't managed is unchanged: its keys stay on its admin page, and it gets no machine Composio key.
