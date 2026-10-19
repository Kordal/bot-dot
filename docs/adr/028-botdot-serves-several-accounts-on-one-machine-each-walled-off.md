# ADR-028: botdot serves several accounts on one machine, each walled off

- **Status:** Accepted (2026-10-16, the owner's decision). Supersedes [ADR 027](027-botdot-trusts-one-owner-on-a-server-of-its-own-reached-through-tailscale.md).
- **Owning task:** the spec [#463](https://github.com/Kordal/bot-dot/issues/463)

## Context

[ADR 027](027-botdot-trusts-one-owner-on-a-server-of-its-own-reached-through-tailscale.md) proposed that a botdot server belongs to one person, on a machine of its own, reached only through Tailscale, with no accounts and no login. On 2026-10-16 the owner decided the opposite: one public VPS should hold botdot for several people who do not know each other, with one install and one update for all of them.

The code knows no person today (the map of 2026-10-16):

- A request is the owner, the Chief, a bot or unknown. Every Linux user on the machine counts as the owner (`lib/identity.js`), and the Android app sends no credential at all; Tailscale's login is the only identity, and every allowed login is the same owner.
- There is one of everything per server: one Claude sign-in that the server renews and hands to every bot, one Vault key, one Bitwarden account, one Composio account, one feed that sends every event to every app, one process-wide time zone.
- `lib/bots.js` and `lib/chief.js` are module singletons bound to one data folder, and the Chief has one fixed Linux UID.
- Every bot runs Claude Code with Bash, holds its owner's logins, and asks botdot's docker-helper, which holds the Docker socket, for its computer.

A stranger is someone who may try to break out on purpose. Every bot holds its owner's logins, so one hole would hand one stranger another stranger's Vault.

## Decision

**Accounts.** A machine botdot runs on holds one or more accounts (`CONTEXT.md`). Nothing crosses accounts: no shared groups, notes, skills, installed tools or caches.

**One botdot server per account, walled off on one machine.**

- Each account is its own Linux user on the machine with its own rootless Docker. Its botdot server, its bots' computers and its data run there and nowhere else.
- Every container runs under gVisor (`runsc`), which works on a VPS without nested virtualisation.
- A spike comes first. It must show that botdot's identity check (`/proc/net/tcp`), the bot's desktop and Camoufox work under gVisor. If it fails, this ADR is revisited before anything else is built on it. It passed, with four changes: [Spike result](#spike-result).
- Each account signs in to Claude with its own login, and has its own Vault key, Bitwarden and Composio account.

**One front door.**

- It is the only program people reach, and the only place that checks who someone is.
- A botdot server listens only on a socket the front door can reach, and trusts the account the front door names. Today's owner checks go away: every local Linux user counting as the owner, `BOT_DOT_ALLOWED_USERS` and the Mac owner key. The Chief and bot checks inside a botdot server stay.
- The front door keeps the rate limits on sign-in and on wrong call keys.

**Sign-in.**

- Passkeys, with one web address for everyone; the passkey says whose account it is.
- An account is created only from a single-use sign-up link. The link expires after 7 days and the admin can revoke it.
- Before the passkey is made, the sign-up page says in one sentence that the admin of the server can technically reach everything in the account.
- Each app (a browser, the Android app, the Mac app) signs in once and keeps its own session until it is signed out. Settings has "Sign out everywhere". The Chief of Staff has no access to sign-ins.

**Reached in one of two ways, chosen at install.**

- **A public domain**, with Caddy in front of the front door for HTTPS. Caddy is the one new technology this ADR adds.
- **A tailnet only**, with Tailscale Serve giving the front door its HTTPS name and nothing on the internet; strangers reach it through node sharing.
- One name per install, because a passkey belongs to one address.

**Calls.** Calls ([ADR 026](026-a-call-is-let-in-on-the-jobs-key-alone.md)) are accepted from wherever the front door is reachable, on the job's key alone. The call address carries the account: `/call/<account>/<bot>/<job>`.

**The admin.**

- The person who runs the machine has an ordinary account, plus the admin page: web only, at `/admin` on the front door.
- There they create and revoke sign-up links, suspend or delete accounts, set each account's share of the machine, see its load, and update every account at once.
- The admin page never shows what is inside an account. An account's own Settings has no update.

**An account's lifecycle.**

- A fresh install asks for the domain or the tailnet and prints the first sign-up link, which makes the admin's account.
- A new account first sees today's setup page, now per account: Claude sign-in and time zone. Then an empty list with its own Chief of Staff.
- Suspend stops an account's botdot server and computers and keeps its data. Delete erases its data, containers and Linux user after the admin types its name.
- The owner of an account can download its backup, but only the admin deletes it.

**Shares of the machine.** Each account has a ceiling the admin sets, the same default for all unless changed:

- **CPU and RAM:** hard limits. Work slows down and nothing is shown.
- **Bots' computers:** at most a set number run at once. The next one waits, and its working line says "Waiting for a free computer".
- **Disk:** a full disk fails the run with "No space left on the server", and the admin page marks the account.

No account ever sees a ceiling, a gauge or a cost.

**Every install has a front door and passkeys,** even with one account. The Mac app's local botdot server ([ADR 0002](0002-mac-hosting-in-docker.md)) is always exactly one account, with no sign-up links and no admin page. Docker Desktop has neither per-account users nor gVisor, which one account does not need.

**No migration.** The new version is not offered as an update to an existing install. Its owner installs again, and the old data folder stays on disk untouched until they delete it.

**Two exceptions to the rules in `AGENTS.md`:**

- The admin page is drawn on the web only, not three times: it belongs to the front door, not to a botdot server.
- "No costs, budgets or usage limits" now means nowhere in an account. The admin page shows shares and load.

## Spike result

2026-10-16, [#464](https://github.com/Kordal/bot-dot/issues/464), `make gvisor-real`. **Kept**, with the four changes below, which tickets 2 to 10 build on.

Where it ran: a nested rootless Docker (`docker:28-dind-rootless`) whose every container runs under gVisor `release-20261005.0`, inside Docker Desktop's Linux VM on an arm64 Mac. The VM has no `/dev/kvm`, so gVisor used its systrap platform, as on a VPS without nested virtualisation. botdot's real server and computer images were built from this source.

What works under gVisor:

- **The identity check.** gVisor's own `/proc/net/tcp` names the user of each socket. From inside botdot's container, the owner gets in, the Chief gets its routes and is refused the owner's, a bot's user is refused everything but its run's tools, and the tools user is refused as unknown.
- **botdot itself.** The server, its privilege broker, the docker-helper reaching the account's Docker, the embedding model and Claude Code all run.
- **The bot's desktop.** TigerVNC with XFCE, noVNC and the computer-server start as `bot`. The live screen answers through botdot's own WebSocket route with the VNC greeting.
- **Camoufox.** Camoufox and its bridge run as `browser`. A page opens when the bot asks. A secret sent through the bridge reaches the page in full, the bot cannot open the bridge's socket, and the secret is on no command line.

What must change:

1. **botdot has a network of its own, not the host's.** Under gVisor, host networking gives a container the host's network stack, whose sockets gVisor's `/proc/net/tcp` does not list. In a rootless Docker it cannot even listen on 127.0.0.1. The front door reaches botdot on its own network or socket, which this ADR wants anyway.
2. **A computer owns its network and sets its firewall from inside.** Each gVisor sandbox has a network stack of its own. A computer that joins another container's network (`--network container:`, as `lib/computers.js` does today) gets loopback alone, and a firewall set from a second container reaches nothing. botdot's own start fails at "Could not secure the computer" (`iptables: Failed to initialize nft`).
   - What works: the computer is on its per-computer network itself and starts with nothing running. root sets the firewall inside its sandbox (a privileged `docker exec`). Then the desktop starts.
   - gVisor's iptables are legacy only, and have no conntrack, state or TCP flag matches. So only what leaves is filtered: the internet is open, the machine's and the LAN's addresses are rejected, and on its own loopback the computer reaches only botdot's ports. The bot cannot change the rules.
3. **runsc needs three flags in an account's Docker.**
   - `--ignore-cgroups`: rootless Docker cannot hand runsc cgroups without systemd delegation. Docker's `--memory` is then not enforced, so an account's RAM and CPU ceiling has to come from the account's own systemd slice.
   - `--host-uds=all`: botdot's services meet through Unix sockets in their mounts (the docker-helper's, and the Docker socket). Since #72 only they get it: install.sh gives the account's Docker a second runtime, `runsc-uds`, with this flag, which `compose.yaml` names for the server and the helper, and the default `runsc` (a bot's computer) runs without it.
   - `--net-raw`: gVisor turns on its iptables only with raw sockets. Only a process with `CAP_NET_RAW` gets one, and no botdot container keeps it.
4. **Each account stores its own images.** Every account has its own rootless Docker, so botdot's two images are unpacked once per account.

**One account's footprint** (memory in MiB, from the machine's cgroup and from gVisor's own count per sandbox):

| | Idle | One computer running, Camoufox open |
| --- | --- | --- |
| Held in RAM by the whole account (processes and gVisor's memory) | 717 | 1,772 |
| botdot's sandbox, its own count (with the files it caches) | 1,519 | 1,222 |
| The computer's sandbox, its own count | none | 1,834 |
| botdot server and privilege broker (resident) | 136 | 136 |
| Embedding model, llama-server with bge-m3 (resident, mostly the mapped model file) | 1,131 | 1,131 |
| Claude Code idle as the Chief's user, the cost of one Chief turn at rest | 391 | not running |

- **RAM.** Plan on about 2 GB for an idle account: the memory it holds, plus the model file, which must stay in the page cache to be fast. Add about 0.4 GB while the Chief replies, and about 1 to 2 GB per running computer.
- **Disk.** The account's Docker holds 7.2 GB: the server image is 2.2 GB and the computer image 4.5 GB, unpacked. Docker reports about 1 GB written by each running container. Ten accounts need about 72 GB before any data.

**Not verified.**

- An x86_64 VPS: this ran on arm64 in a VM.
- A rootless Docker started by systemd with cgroup delegation, and so the RAM and CPU limits.
- A real Chief turn: it needs a Claude sign-in, so Claude Code idling as the Chief's user stands in.
- The size of an account's data folder.

## Alternatives

- **Accounts inside one botdot server** (one process, data split per account). Rejected: one bug in botdot, or one prompt-injected bot, reaches every account, and the singletons would need rewriting.
- **One Docker for every account**, with each docker-helper limited to its account's containers by label. Rejected: a bug in that check lets one stranger start root containers on the host.
- **A VM per account.** Strongest, but a VPS seldom runs VMs inside it, and the owner needs one server.
- **Each account updates itself.** Rejected: mixed versions on one machine break one install and one update.
- **Password with a two-step code, an e-mail link each time, or "Sign in with Google/GitHub".** Rejected: a password store to protect, a mail service, or hand-written OAuth with a third party to depend on.
- **A subdomain per account.** Rejected: wildcard DNS and certificates and a passkey per subdomain, for nothing the passkey does not already say.
- **One shared Claude login.** Rejected: a Claude subscription is for one person, and one account's busy bots would use up everyone's limits.
- **Keeping today's install without a login beside the new one.** Rejected by the owner: one way to install, one code path.
- **Moving today's data into the first account.** Rejected by the owner: no install in use needs it.

## Consequences

- botdot now has a login page on the internet. The front door, its sessions and its rate limits are the most security-critical code in botdot.
- A botdot server must never be reachable except through the front door. The admin's root can still reach every account, and the sign-up page says so.
- Each account runs its own botdot server, embedding model and Chief. How many accounts fit on a VPS is set by that footprint, not by the front door.
- The apps learn to sign in with a passkey and keep a session. Android, which sends no credential today, changes the most.
- The README's "One owner. botdot has no accounts and no login page" is replaced when this is built, and the install asks for a domain or a tailnet.
- Tailscale becomes optional, and a call reaches a job from the internet when the install is public.
- Existing installs end. Their owners install again.
