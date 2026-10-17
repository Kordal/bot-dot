# ADR-026: A call is let in on the job's key alone

- **Status:** Accepted (2026-10-14); where a call comes in, partly superseded by [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md): since [#472](https://github.com/Kordal/bot-dot/issues/472) the call address is at the front door, `/call/<account>/<bot>/<job>`, a call is let in from wherever the front door can be reached on the job's key alone, the front door slows down wrong keys, and the tailnet checks of `refusal` below are gone. The key, its hash, the answers and the run's trigger stay as decided here.
- **Owning task:** [#407](https://github.com/Kordal/bot-dot/issues/407), of the spec [#405](https://github.com/Kordal/bot-dot/issues/405)

## Context

Until now every request botdot takes comes from the owner, the Chief or a bot's own run. A job that runs **when called** ([#405](https://github.com/Kordal/bot-dot/issues/405)) is started by another device on the owner's tailnet: a Home Assistant box, a NAS, a phone shortcut. Such a device is not the owner. A tagged device has no Tailscale login at all (Tailscale Serve sends no identity headers for it), and another person's device has a login that is not in `BOT_DOT_ALLOWED_USERS`. On a Mac-hosted botdot (ADR 0002) it has no owner key either. So a call fails the owner's checks by design, and needs a path of its own.

The research for this ([`docs/product/research/call-request-checks.md` on the `research/call-request-checks` branch](https://github.com/Kordal/bot-dot/blob/research/call-request-checks/docs/product/research/call-request-checks.md)) read `gate()`, the UID lookup, the owner key and Tailscale Serve's source.

## Decision

- **A call has one address per job:** `POST /api/bots/<botId>/jobs/<jobId>/call` on botdot's own tailnet name. It is the only path into botdot that is not the owner's, the Chief's or a bot's own run.
- **It has its own branch in the request check** (`gate()` in `server.js`, `refusal` in `lib/calls.js`), placed after a connection whose user botdot cannot tell is refused and **before** the Chief is let through everything. The branch:
  - refuses every connection that is not the owner's side by its user: a bot, the Chief, the tools user;
  - refuses a request that carries the Chief's key or a run's key: on a Mac those are the only signs of the Chief or a bot;
  - refuses a request that came through Funnel (`Tailscale-Funnel-Request`): no call comes from the internet;
  - refuses a request through Tailscale from this machine itself, **with or without** a login header: a tagged device has no login, so the owner's check, which looks only when there is one, would let a bot's request through the machine's own tailnet address pass;
  - requires `X-Forwarded-For` to be one tailnet address (`100.64.0.0/10` or `fd7a:115c:a1e0::/48`): behind Serve it is the one address the call came from, which the sender cannot choose, and a request that did not come through Serve has none;
  - keeps the host check (DNS rebinding);
  - skips **only** the owner's two checks, `BOT_DOT_ALLOWED_USERS` and the Mac owner key.
  Every other path keeps exactly the checks it had.
- **The job's key lets a call in.** It is sent as `Authorization: Bearer <key>`; a key in the address is not read (it would end up in logs, and a key-less cross-site request needs no preflight). A key in a header forces a CORS preflight that botdot never approves, so the call path asks no `X-Bot-Dot`.
- **Only the key's hash is kept, apart from the job**, in `data/call-keys.json` (`{ <botId>: { <jobId>: { hash } } }`, the key's SHA-256). A job as the routes hand it out reaches the bots, the Chief and the apps, so the key is no field of it, and no route reads the file. The key is long and random, so a fast hash is enough; it is compared in constant time.
- **A refusal starts nothing.** The answers are `202 { runId }` when the job was started, `401` for a missing or wrong key (also for a job that has no key, or does not exist, so that a sender without the key learns nothing of the jobs), `403` from the request check, `413` above the body's limit (`BODY_MAX` in `lib/calls.js`, one constant), each with `{ error }`, a sentence a sender can log.
- **The run's trigger is `call`.** A script job gets the call's body on its stdin.

## Alternatives

- **The owner's checks with an exception for one path.** Rejected: the call path would inherit the condition on the login header, which a tagged device and a bot's request through the machine's tailnet address both lack.
- **A path outside `/api/`.** It would need no exemption from `X-Bot-Dot`, but the spec puts the call address under the API, where `docs/api.md` describes it with the job's other routes.
- **The key on the job.** Rejected: `jobView` reaches the bot the job wakes; a bot that reads its own key could call its own jobs.
- **A slow password hash.** Not needed: the key is made by botdot, random and long.

## Consequences

- On Linux with separate users, a bot is kept out by its connection before the key is looked at. On a Mac-hosted botdot nothing in a request tells a tailnet device from a bot (ADR 0002): there **the key is the only check**, so it must never be given to a bot or the Chief, and a bot that reads `data/` (the Mac's shared folder enforces no owner) finds only a hash.
- `X-Forwarded-For` is the sender's address only behind Serve, and botdot trusts it as it trusts Serve's login header on the owner's path: with botdot bound to loopback (the supported setup), only Serve and programs on the machine reach it. A botdot bound to a LAN address would let a LAN device name a tailnet address, and then the key is the only check. Where Tailscale runs outside botdot's container, the machine's own tailnet address is not among botdot's interfaces, so the "from this machine" refusal cannot see it; on Linux a bot is still told by its connection's user.
- A job is callable when its `call` is on and its key's hash is kept. The key is made on the owner's yes to the Chief's proposal and kept in the Vault ([#408](https://github.com/Kordal/bot-dot/issues/408)); a call to a job whose call is off answers `409`, so the hash stays when it is turned off, and the next yes makes a new key.
- In the first step only a script job took a call. Since [#409](https://github.com/Kordal/bot-dot/issues/409) an AI job takes one too: its run reads the body after the job's task as outside content of the kind `call` (ADR 015), and it waits its turn as other work does (ADR 011), at most three per job ([#410](https://github.com/Kordal/bot-dot/issues/410)). The answers `409` (switched off, paused, `bypassPermissions`, calls off) and `429` (too many waiting) are in `docs/api.md`.
