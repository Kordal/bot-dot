# ADR-273: One embedding server is shared by every account on a botdot machine

- **Status:** Accepted (the owner's decision, spec in [#1704](https://github.com/ladrok/bot-dot/issues/1704)). Amends [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md): its line that each account runs its own botdot server, embedding model and Chief is changed to "its own botdot server and Chief; the embedding model is the machine's, shared".
- **Owning task:** [#1704](https://github.com/ladrok/bot-dot/issues/1704)
- **Builds on:** `lib/embed.js` (meaning search with llama.cpp's `llama-server` and bge-m3, in the image), `lib/memory.js` (`LOOKUP.embedMs`), the front door's socket folder in `install.sh`.

## Context

Meaning search finds a note whose words differ from the question: Polish inflection, another language, a paraphrase. It needs bge-m3 loaded in llama.cpp's `llama-server`. Each account's botdot server started its own (`lib/embed.js`), and ADR 028 measured that process at about 1,131 MiB resident, half of an idle account's roughly 2 GB. Ten accounts load the same 635 MB model ten times. How many accounts fit on a machine is set by that footprint ([ADR 028, Consequences](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)).

The model keeps nothing between requests: text in, a vector out. Sharing it between accounts is a question of how an account reaches it without reaching another account. Each account has its own rootless Docker under gVisor and its own network (`network_mode: bridge`), so no TCP port reaches across them, which is the wall ADR 028 builds.

## Decision

**One embedding service per machine.**

- It is the `embed` service of `compose.front-door.yaml`, in the machine's own Docker beside the front door, from the same image and with the model already in it. It is a small Node program, `lib/embed-share.js`, that starts one `llama-server` on its own loopback and listens on a Unix socket for each account. The container has no network (`network_mode: none`), runs as its own Linux user `botdot-embed`, read-only, without capabilities, and has no part in any account's Docker.
- `llama-server` has several slots (`--parallel`, 4 by default, `BOT_DOT_EMBED_SLOTS`) and keeps the 8,192 tokens of a text in each. One account's indexing does not block another's lookup, because the proxy hands out the slots in turns, account by account, and a request whose caller has gone is taken out of the queue. Its threads are capped as an account's own were (half the CPUs, at most four, `BOT_DOT_EMBED_THREADS`).
- **Every install has it but the desktop app's** (`BOT_DOT_REACH=local`: one account in a VM of its own, where a shared process would be a second process, not a saving). install.sh starts it with the compose profile `embed` and makes its user `botdot-embed`. A machine without it (the desktop app, an install from before this) and `npm start` keep starting `llama-server` per account, as before.

**The way in: a socket per account, in a folder only that account and the service enter.** The mirror of the front door's socket folder ([ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)), the other way round:

- install.sh makes `<BOT_DOT_DIR>/embed/<account>`, owned by the account's botdot server's user (UID 60000 in its containers, the account's subordinate UID + 59999 on the machine), mode 700, with an ACL that lets `botdot-embed` alone in besides (`setfacl -m u:botdot-embed:rwx,m::rwx`). The service looks for these folders every two seconds and makes `embed.sock` in each, mode 666: the folder decides who may reach it. The front door has no way into it, and the service has none into the front door's folders.
- compose.yaml mounts the folder at `/run/embed` of the account's botdot server, whose `.env` has `EMBED_SOCKET=/run/embed/embed.sock`. The server's runtime is already `runsc-uds` (gVisor's `--host-uds=all`, [ADR 028, Spike result](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md#spike-result)), which is what lets a container reach a host socket; a bot's computer, which runs without it and has no mount of it, cannot. No other account has this account's folder in its mounts, and on the machine it is closed to every other user.
- The proxy lets through `GET /health` and `POST /v1/embeddings`, and nothing else of `llama-server`'s (not `/slots`, `/props`, `/metrics` or a completion), forwards only the path and the body, and refuses a request over 16 MB.
- A deleted account's folder is removed with the rest of it (and the service closes its socket within seconds); a suspended account's stays, to start again with; an update makes it for an account made before this, and sets `EMBED_SOCKET` in its `.env`.

**The client.** `lib/embed.js` reads `EMBED_SOCKET` beside `EMBED_URL` (which wins when both are set): HTTP over the Unix socket, `status().server` is `"shared"`, no child is started and no model is downloaded. Meaning search is on by default where the socket is set, as where the image's program and model are. When the service is not there or still loading, `ready()` is false and the search falls back to words alone as for any embedding server that is down.

**What an owner and an admin can rely on.**

- **Notes pass through one process, which keeps nothing.** The text of every account's notes and past runs that meaning search reads goes through the one shared `llama-server`, and it writes down no text and keeps no vector: each account stores its own vectors in its own `memory.db`. The admin, whose root reaches every account anyway ([ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)), reaches nothing new. An account cannot ask the service for anything but a vector of its own text, and cannot see another's.
- **Its CPU and RAM are outside every account's share.** The service runs in the machine's Docker, not in an account's, so the shares the admin sets ([ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md), [ADR 152](152-gvisor-sizes-an-accounts-sandboxes-by-its-share.md)) do not count it. Its threads are capped, and the machine's RAM it uses is about one model (the 1.1 GB ADR 028 measured, plus a little per slot), not one for each account. Planning a machine: subtract that once.
- **Under load the lookup falls back to words.** The lookup before a run waits for meaning search at most 1.5 seconds (`LOOKUP.embedMs` in `lib/memory.js`) and goes on with what the words found: a busy shared service never holds a run. Indexing in the background waits as long as it takes, a few texts at a time.

## Alternatives

- **`llama-server` on a Unix socket itself.** A recent `llama-server` can listen on one, but only one: it cannot give each account a folder of its own, and it would let every account reach all of `llama-server`'s routes and have no turns between accounts. A proxy is needed for both. Not checked against the pinned image.
- **TCP on the machine's loopback or a Docker network shared by the accounts.** Each account's Docker has its own network, and a shared one would let accounts reach each other, which ADR 028 exists to prevent.
- **One Unix socket for all accounts.** An account must not be able to tell whose request is whose to the service: the socket an account holds is its identity, so the fair queue needs no header an account could forge.
- **The front door's folder for the embedding socket too.** The front door would then reach the service and the service every account's server socket: more access than either needs.
- **Keep one model per account.** Costs 1.1 GB per account for a service used a few times an hour, which is what this ADR removes.
- **Drop meaning search where RAM is short.** Word search alone misses Polish inflection, another language and a paraphrase (memory audit of 2026-10-06, finding 4).

## Consequences

- An account's idle footprint falls by about 1.1 GB, and the machine pays about one model once: more accounts fit on a machine. ADR 028's footprint table is the one before this change; its note says so. The saving is ADR 028's own measurement of the embedding process taken out; the shared service's own footprint with four slots, and the time a lookup takes under several accounts' indexing, are not measured yet.
- The service is one more thing that can be down. Without it every account's notes are searched by words, which is what happens today when the model fails to load, and the admin's install check does not depend on it.
- A machine that moves from a version without the service to one with it gets the service when the front door is updated, after the accounts have restarted: until then an account's meaning search is "unreachable" and falls back to words, and it picks the service up by itself.
- `GET /api/memory/semantic` has a third `server`, `"shared"`. The apps do not read it; the Chief's `memory_status` does.
- Nothing about the apps changes, and the web page and Android need nothing: no new control, no setting, no number an owner sees.
