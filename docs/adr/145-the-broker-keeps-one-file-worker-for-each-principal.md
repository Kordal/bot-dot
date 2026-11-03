# ADR-145: The broker keeps one file worker for each principal

- **Status:** Accepted (2026-11-03, the owner chose "measure, then fix")
- **Owning task:** the hq freezes of 2026-11-03, after [ADR 144](144-the-server-reaches-the-broker-from-a-thread-not-a-process-per-call.md)

## Context

The broker does a bot's or the Chief's file operations as that principal, so that no file of theirs is touched as root or as the server. Until now it started `lib/principal-fs-worker.js` as the principal for every request and let it end after its answer. After ADR 144 took the server's own process start off each call, hq's `[held]` log showed what stayed: about 230 ms per call (p50; 293 ms p90), the cost of that second node start under gVisor. `GET /api/pages` makes about 20 such calls for 7 pages and held the whole server 4 to 5 s every time.

## Decision

The broker keeps one file worker for each principal, started as that principal at its first `files` or `privateFile` request (`principal-fs-worker.js serve`). It reads one request per line on stdin and writes its answer per line on stdout, the same `{ value }` or `{ error }` the one-shot worker printed. The broker sends it one request at a time, in order, and ends it after a minute without one (`BOT_DOT_FILE_WORKER_KEEP_MS`), when the broker stops, or when its answer is over the size limit. A worker that dies fails what it had and the next request starts a new one. The broker's sweep of what a principal left behind spares these workers. Streams (`fileStream`) keep a worker of their own per stream, as before.

## Alternatives

- **Fewer calls per route** (one broker call that resolves and stats all of a request's page files). It removes calls only where it is written, and every new route that reads a principal's files would have to be written that way to stay fast.
- **Async callers.** They stop holding up other requests, but each call still costs a node start, so `/api/pages` would still take seconds.
- **Do the file work in the broker as root, under the principal's identity per thread** (`setfsuid`). Node has no such call, and root doing a principal's file work is what the broker exists to avoid.

## Consequences

- A broker file call costs a pipe round trip plus the operation, instead of a node start.
- A principal's worker lives up to a minute after its last request, as that principal. A process of the same principal can signal it or, where the kernel lets a user trace its own processes, tamper with it; what that reaches is that principal's own files and the server's view of them, which that principal can already change directly. A killed worker costs one failed request.
- One principal's requests wait for each other; a long one (a search, a copy of a large folder) holds the next. The server waited on each call synchronously already, so nothing that was parallel becomes serial.
