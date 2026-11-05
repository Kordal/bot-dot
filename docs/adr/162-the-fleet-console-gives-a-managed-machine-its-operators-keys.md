# ADR-162: The fleet console gives a managed machine its operator's keys

- **Status:** Accepted
- **Owning task:** the owner's request in the project thread "Share my API keys across all servers": every machine the owner runs from the console uses only the owner's own keys, safely, for Jev and Composio.
- **Builds on:** [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (the console reaches a machine only through its agent and root's requests), [ADR 082](082-the-admin-chooses-haiku-or-jev-to-pick-who-answers-in-a-group.md) (Jev and its OpenRouter key) and [ADR 160](160-the-installer-gives-the-admins-account-its-composio-key.md) (the installer's Composio key, handed to the admin's account).

## Context

On a managed machine Jev could not work: its OpenRouter key is set on the admin page, which a managed machine doesn't have, and a machine of one account had no group router at all. The installer takes `BOT_DOT_OPENROUTER_KEY` and `BOT_DOT_COMPOSIO_KEY`, but only while it installs, and the console runs nothing on a machine after that but its agent's requests. boat.dev isn't wanted on managed machines: their bots' computers are the machine's own.

## Decision

- **The console holds the operator's keys and gives each machine its own.** For Jev, a key of the operator's OpenRouter account per machine, made with a provisioning key that stays in the console, with a limit of its own, and deleted when the machine is. For Composio, the key of a Composio project made for that machine: connections in one project are reachable with its key, so one key for every machine would let any of them reach every machine's connected apps.
- **After the install, a root request `KEYS`.** Root's alone like `BACKUP` and `OFFSITE`: lines of `openrouter <key>` and `composio <key>`, written 600 by the console's agent and removed as soon as it is read. Root's step writes them to `install-keys.json`, which the front door takes within a minute without a restart, as it takes the installer's, and says which it handed in `status/keys.json`, never a key. The Composio key then goes the way of ADR 160: to the admin's account, which is the managed machine's first, and only while it has no key of its own.
- **A managed machine of one account has the group router.** Its front door keeps `group-router.json` and hands Jev's key to the account as a machine of several does. A new OpenRouter key replaces the old one: that is how it is rotated.

## Alternatives

- **A proxy in the console that adds the keys to every call.** No key on any machine. Rejected: every Jev decision, which must answer in a fraction of a second, and every Composio action would go through one service, every machine's single point of failure, and the console would sit in the path of what the bots do in the owner's apps.
- **One key of each for every machine.** Simplest. Rejected: one machine taken over would expose every machine's Composio connections, and the key could only be revoked for all of them at once.
- **The agent writes the front door's files itself.** Rejected as in ADR 159: root's setup would live in a second place, against ADR 154's rule that the agent only writes requests and reads status.

## Consequences

- Jev and Connectors work on a managed machine with no admin page and no step of the owner's.
- Root on a machine, and only root, can read that machine's OpenRouter key, as it can read the Vault's key today. A container escape there reaches that machine's key, within its limit, and its own Composio project, not another machine's.
- The operator pays for the OpenRouter use of every managed machine given a key; the limit on each key bounds it.
- A Composio key the account already has stays (ADR 160): to replace it, it is removed on the Connectors page first.
