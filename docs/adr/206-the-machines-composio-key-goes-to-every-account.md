# ADR-206: The machine's Composio key goes to every account

- **Status:** Accepted
- **Owning task:** the owner's answer in the project thread "Make app less technical for non-IT users": a self-hosted machine sets the Composio key on /admin, a hosted one from the fleet console, and every account connects apps without a key of its own.
- **Builds on:** [ADR 160](160-the-installer-gives-the-admins-account-its-composio-key.md) (the installer's key, handed to the admin's account) and [ADR 162](162-the-fleet-console-gives-a-managed-machine-its-operators-keys.md) (the console's `KEYS` request, one Composio project per machine). Changes ADR 160's "the admin's account's, never the machine's".

## Context

Connecting Gmail asked every account but the admin's for a Composio project key: a step most people can't take. The owner wants the key set once per machine: on /admin when self-hosted, from the console when hosted.

## Decision

- **One Composio key per machine, kept by the front door** in `composio-key.json` (600). The installer's key, the console's `KEYS` and the admin page's **Composio** section (`/admin/composio`, checked with Composio first) all write it. A managed machine has no /admin: only the console sets it there.
- **The front door hands it to every account**, once for each key, again after a restart, and an hour after a refusal. An account takes it while it has no key; an owner's pasted key always stays, and a machine key the owner removed isn't taken again. A key taken from the machine follows it: a new one replaces it, a removed one goes.
- **The Apps page says "Set up for everyone on this botdot"** in place of the key's last characters. Replace and Remove show only with Advanced on.
- **Accounts stay apart inside the project.** Each account has its own Composio user id, and lists and uses only that user's connections (`lib/connectors.js`).

## Alternatives

- **Each account its own key (ADR 160 as it was).** Safest, but it leaves Apps out of reach for anyone who isn't technical.
- **One key for every hosted machine.** Rejected, as in ADR 162: one machine taken over would reach every customer's apps.

## Consequences

- **The risk the owner accepted:** every account on a machine can read the project key, and a bot can too, through its tools. Anyone holding the key reaches every account's connections on that machine, other people's mail included. A self-hosted machine should share it only among people who trust each other. On hosted, the risk stays within one customer's machine, since each machine has its own project.
- Rotating the key on /admin or with `KEYS` moves every account that uses it. Apps connected in the old project need connecting again.
