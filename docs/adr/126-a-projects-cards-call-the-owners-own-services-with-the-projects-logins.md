# ADR-126: A project's cards call the owner's own services with the project's logins

- **Status:** Accepted (2026-10-30)
- **Owning task:** [#804](https://github.com/Kordal/bot-dot/issues/804)
- **Builds on:** [ADR 123](123-a-card-on-a-projects-board-is-built-and-kept-fresh-by-a-run-of-the-chiefs.md) (a card is built by a run of the Chief's), [ADR 125](125-a-cards-build-reads-its-own-projects-folder-with-a-key-of-its-run.md) (a key of the run names the project), [ADR 085](085-a-script-job-calls-apis-with-the-logins-its-job-lists.md) (botdot calls an API with a login for others)

## Context

A card "Proxmox VM Status" failed: "no Proxmox tunnel address or access in the project; the web tools can't reach it". A card's build reads the web, the owner's connected apps and its project's folder, but not a self-hosted service: those sit on a private or tailnet address behind a token in the Vault. botdot already calls such services for others without handing out the secret (`lib/vault-http.js`: a bot's `api_request`, a Board tile, a script job): private and tailnet addresses for a login whose site is one, a self-signed certificate when the login accepts it, the secret only in a header and blanked out of the answer. A login is shared with bots, and a card's build is no bot's.

## Decision

- **A project has logins:** the ids of the Vault logins its cards may call with (`logins`, at most 8). The owner picks them in the project's settings; the Chief cannot set them. The apps get each one's name and site.
- **A card's build gets `api_request`, GET only,** when its project has logins, beside the folder tools (ADR 125). It names a login of its project by name; botdot finds that login by the build's key (`POST /api/company/card-request`, `X-Card-Key`), never by a project the call names, and refuses any other login and any other method. The request goes through `vault-http` as a bot's does, so the secret never reaches the run, the card or the log.
- **The build is told the project's logins** (each one's name and site) and asks the owner for one it lacks with `NEEDS LOGIN: host` on its last line. Such a card fails with `needsLogin`, and the apps show "No login for host" and Add login, which opens the project's Logins.
- A login is read by its id (`projectCredentials`), without a bot's share: the owner's pick for the project is the share.

## Alternatives

- **Share the login with a pseudo-bot of the project** (`project:<id>` in `allowedBots`): no new lookup, but every Vault editor sends `allowedBots` as its checkboxes and would drop it.
- **Refresh without a Claude run**, botdot calling the API the run found: cheaper, but a follow-up; the card still needs a run to find the endpoint first.
- **The account's computer** (it reaches the local network, ADR 034): starts a computer for one number, and the run would hold the secret in a command.

## Consequences

- A card reaches what botdot's server reaches: a tailnet address only when the machine runs Tailscale.
- A GET that changes something on a badly made API would change it, as a bot's GET would.
- The answer of a service is data, never instructions, as a page's is: the build's prompt says so.
