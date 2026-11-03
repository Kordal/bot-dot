# ADR-144: The server reaches the broker from a thread, not a process per call

- **Status:** Accepted (2026-11-03, the owner chose "measure, then fix")
- **Owning task:** the hq freezes of 2026-11-03 (measured with `lib/held.js`, PR #926)

## Context

Under separate users, the server reads and writes a bot's or the Chief's files through the privilege broker. Most callers need the answer at once (`fs.statSync`-shaped code in `lib/principal-fs.js`, `lib/identity.js`), so `privilege-client.callSync` was a `spawnSync` of a small node process that sent the request over the broker's socket and printed the answer. A Unix socket has no synchronous API in Node, and a process was the simplest way to wait on one.

On hq, inside gVisor, that node start costs 350-500 ms, whatever the call does. `/api/pages`, `/api/dashboard`, a bot's uploads list and a message to the Chief make about 20 such calls in a row, so the server answered nothing for 2 to 10 s at a time: 25 held event loops, 81 s in all, in its first nine minutes, and one `/api/version` of 18.8 s. Only 2 of 213 slow synchronous calls were memory.db's.

## Decision

`callSync` posts the request to one worker thread of the server (`lib/privilege-sync-worker.js`), started at the first call, and waits on a shared flag with `Atomics.wait`; the thread asks the broker over its socket, hands the answer back on a `MessagePort` and wakes the server's thread, which takes it with `receiveMessageOnPort`. Callers don't change: the call is still synchronous and still holds the event loop while the broker works, but no process starts for it. A call the broker doesn't answer within its timeout (120 s, as before) drops the thread and its connection, which makes the broker stop the work, and the next call starts a new thread. The broker, its socket protocol and the async `call()` stay as they are.

## Alternatives

- **Make every caller async.** Right in the end, but it reaches about twenty places across routes, timers and the bots' run start, each with its own tests; this change takes the process start off all of them at once.
- **Batch the calls of each route** (one broker call for the stats of all page files, one for an uploads folder). Still worth it where a route makes many calls, and possible on top of this.
- **Keep one socket open to the broker.** The broker answers one request per connection and closes it; a new connection on a Unix socket is cheap next to a process.

## Consequences

- A broker call costs a socket round trip plus the broker's own work, instead of a node start plus that.
- The broker still starts a file worker as the principal for each `files` call, which is a node start of its own under gVisor; whether that is the next thing to remove is measured with the `[held]` log after this change.
- One more thread in the server, idle between calls and not keeping the process alive.
