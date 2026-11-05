# ADR-154: One VPS per customer, a managed machine of one or several accounts, run from a fleet console

- **Status:** Accepted (2026-11-04, the owner's decision on the spec [#977](https://github.com/Kordal/bot-dot/issues/977)). Amends [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md) (the admin is an account on the machine) and [ADR 146](146-only-the-admin-moves-an-accounts-computer.md) (the admin page moves an account's computer): on a managed machine both are the fleet console's.
- **Owning task:** [#978](https://github.com/Kordal/bot-dot/issues/978)
- **Amended by:** [ADR 164](164-a-managed-machines-feedback-goes-to-the-fleet-console-through-an-outbox.md): the agent also sends the front door's Feedback outbox

## Context

botdot is to be sold as hosting: each customer gets a botdot machine of their own, and the project's admin runs all of them. On 2026-11-03 the plan was one shared public machine for many customers, as ADR 028 has it, with its admin page (#909). A production readiness audit of 2026-11-04 found that this does not hold for paying customers:

- A public install is always a machine of several accounts whose admin is an account on that same machine (ADR 028). The one-account front door exists only for `BOT_DOT_REACH=local` (ADR 136).
- One shared machine is one failure, one update and one kernel for every customer: a bad release, a full disk or an escape from a container reaches them all.
- Nothing outside a machine knows whether it is up, and every admin action needs a session on that machine's admin page.

The owner chose one VPS per customer, at first a Contabo Cloud VPS 6 (6 vCPU, 12 GB of RAM, 100 GB NVMe), and asked that a machine can hold one account or several.

## Decision

- **One VPS per customer.** Each VPS has a subdomain of its own, with its own Caddy and certificate. At first every customer gets a Contabo Cloud VPS 6.
- **Two variants of a machine, chosen when it is made:** one account, or several accounts within the machine's capacity. A one-account machine grows into a several-account one without a reinstall when it has room for another share.
- **A guaranteed share per account of at least 4 CPUs and 8 GB of RAM, never overcommitted.** A managed machine's capacity is the sum of its accounts' shares plus a reserve for the system, not the free resources of the moment. A Cloud VPS 6 therefore holds one account and a Cloud VPS 8 (8 vCPU, 24 GB) two. The default share there is 4 CPUs, 8 GB and 40 GB of disk.
- **The managed mode.** `managed` is an answer to the installer, kept in the machine's settings and, like `local`, never offered in its question. A managed machine has no admin page: the front door serves no `/admin` (404). With one account, the front door runs in its one-account mode (`FRONT_DOOR_ONE_ACCOUNT`) on a public or tailnet reach, as on `local`, and the passkey is made with the setup key. With several, accounts are made only from links that root's step makes on request.
- **The admin is the fleet console,** a separate service in a private repository (`botdot-hosting`), outside this one. What ADR 028 gives the admin page (sign-up links, suspending and erasing accounts, shares, load, updates) and what ADR 146 gives it (moving an account's computer) is the console's on a managed machine. The console, like the admin page, never shows what is inside an account.
- **The console reaches a machine only through an agent on it.** The agent connects out to the console, so the machine opens no port for it and the console holds no SSH key. It runs only a closed list of signed commands, and only through what root's step already has: request files beside the ones the front door writes in `front-door/requests` (an update, a switch, a link, a version), the status files root writes (`version.json`, `update.json`, `account-*.json`) and the load files. The product gets no new network API for the console. The agent lives in `botdot-hosting`.
- **gVisor stays on a one-account machine.** Every account's containers keep running under runsc, as on a machine of several.

## Alternatives

- **One shared machine for many customers, as decided on 2026-11-03 (#909).** One install and one update for everyone, and the cheapest per account. Rejected: one failure, one release and one kernel for every customer, a noisy neighbour on shared hardware, and an admin who signs in on a machine that holds strangers' data.
- **A VM per account on one large server** (Proxmox on a dedicated machine). Hard walls between accounts with one bill. Rejected for now: a Cloud VPS has no nested virtualization, a dedicated server is one failure for every customer again, and running a hypervisor is work a VPS provider already does. It can come back for a large customer.
- **SSH from the console to each machine.** Needs no agent. Rejected: the console would hold a root key to the whole fleet, every VPS opens a port to it, and what the console may do is whatever a shell can, not a closed list. A console taken over would own every machine.
- **runc without gVisor on a one-account machine.** No account is there to wall off from another, and runc is faster and gives the bots every syscall. Rejected: gVisor walls the bots off from the VPS's kernel, not only one account from another. The bots have sudo on their computer, run any code and can be steered by prompt injection. Without gVisor, an escape from a container is root on the VPS, and root there holds the agent's console key, the Composio gateway token, the backup keys and the disk key, so one escape would reach the whole fleet. It would also make two install paths where ADR 028 and ADR 136 keep one, and a one-account machine that grows into several would have to change runtime under running accounts.

## Consequences

- The product repository gets what a managed machine needs, each in a ticket of #977: the managed mode with its share and capacity rules (#983), an update to a named version with a snapshot of each account's data before its switch (#979), bounded container logs (#980), an egress guard (#984), a machine-readable install result (#981), sign-in and sign-up links without the admin page (#985), and removal of an account's boat.dev machine when the account is erased (#982).
- A public or tailnet install that isn't managed stays as ADR 028 has it: several accounts and an admin page whose admin is an account on the machine. `local` stays as ADR 136 has it.
- A customer has no admin page and no way to reach the machine itself. Root on the VPS still reaches every account (ADR 028), and the console's operator holds root through the agent's commands only; a customer is never root on their machine.
- A machine with no console still runs: its accounts, updates and backups keep working as on any install, and only what the console asks for waits.
- Each customer costs a VPS of their own. Plans count €10 per account per month before VAT, which covers a Cloud VPS 6 after its promotion, the off-site backup and a share of the console.
- Under gVisor on a Cloud VPS, which has no nested virtualization, runsc runs on its systrap platform, as on hq.
