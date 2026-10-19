# Isolated computer/helper acceptance

Current scope update: the owner subsequently authorized issue 97 server privilege reduction. Its implementation and fresh acceptance evidence are recorded in [Server privilege separation](security-nonroot-acceptance.md). References below to that work being deferred describe the earlier scope.

The opt-in harness runs the actual server and Docker helper in two Compose services,
inside a disposable Docker-in-Docker daemon. This matters: helper startup inspects
all `botdot.bot` labels in its daemon, so simply starting a second project against
the host socket could stop a real legacy computer. The harness never gives its
helper the host socket. It removes its daemon, anonymous Docker storage volume,
and scratch service image on completion. No registry credentials or owner data are used.
The outer daemon container is privileged to run nested Docker; only the fixture HTTP
port is published, on loopback. The nested Docker API listens only on its Unix socket.

Run from the repository root with Docker available and `bot-dot/desktop:latest`
already built:

```sh
BOT_DOT_HELPER_TEST=1 node --test test/live/helper-acceptance.test.js
```

It builds a small service fixture from the pinned Node image and Docker CLI, using
the current source. The server has no Docker socket; only the helper has the inner
daemon's socket, and they share a private helper volume. The fixture excludes Claude,
Bitwarden and the embedding model. It is a real helper integration check, not a
build or publication check of the production release image.

The public seams are the owner HTTP API, the helper Unix-socket API, Docker's
migration/export interface, and the rendered noVNC viewer. Automated assertions cover:

- An old computer is stopped and loses its automatic restart policy on helper startup.
- Its file remains exportable; starting the old computer is rejected.
- Owner reset/start creates an isolated computer, and exported files can be restored.
- The helper command channel reads the restored file and answers status requests.
- The server lacks `/var/run/docker.sock`; the computer drops capabilities and joins
  a protected network namespace with `no-new-privileges`.
- A live private HTTP service is blocked by default, reachable after an owner LAN
  change, and blocked again after revocation through the owner HTTP API.
- The server serves its noVNC viewer for the running computer.
- The helper types a synthetic value into an in-memory browser form.

For the separate interactive acceptance, set `BOT_DOT_HELPER_HOLD=1`. The harness
prints a loopback URL, bot ID and daemon name and holds the disposable installation
for up to ten minutes. Open `/computer/<id>/vnc.html?autoconnect=true&resize=scale&path=computer/<id>/websockify`
on that URL. Exercise screen input and observe the resulting pixels. Finish by
creating `/tmp/botdot-helper-acceptance-done` inside the printed daemon; cleanup then
runs normally. A served HTML page alone does not count as rendered screen evidence.

Issue 97 remains partial: the separate process/file broker and server privilege
reduction are outside this acceptance scope. Production installation upgrades and
final release-image publication remain separate checks.

## Verification status (29 September 2026)

The complete integration assertion run passed: 1 test, 0 failures (29.3 seconds).
It reused the already-loaded isolated daemon after updating the scratch server and
helper source and restarting their services; a fresh synthetic bot went through
legacy migration, export/reset/restore, helper commands, LAN grant/revocation and
synthetic secret typing. Chrome's separate rendered-screen/control check also
passed, as described below. The helper and owner-approval suites pass: 8 tests.
Syntax and whitespace checks pass. Production data and computers were not used.


### Manually started computer stopped during owner edits

The retained real installation exposed a product defect: an owner policy PUT
unconditionally reapplied power settings. For a manually started computer with
always-on disabled, that asynchronously stopped the computer. A subsequent
revocation raced the shutdown and failed readiness. The owner HTTP regression
failed with `stopped` instead of `running` on the first LAN edit before the fix.
Power is now reapplied only when the computer type or always-on value changes.
All four helper tests pass, including explicit always-on enable/disable and
computer-disable transitions. The real retained installation remains running
across policy changes with the patched server.

The same defect existed when the owner approved a Chief proposal. Its added HTTP
regression failed with `stopped` after approving LAN access, then passes with the
same power-field guard. Approved task edits also preserve a manually started
computer. The helper and owner-approval suites pass together: 8 tests.

### The secret-typing bridge was blocked by the computer firewall

With Camoufox listening on `127.0.0.1:47111`, the real helper `typeSecret` call
returned “Camoufox isn't open.” The opt-in regression failed with `false` instead
of `true`. The firewall now permits TCP destination 47111 **only on loopback**,
alongside the existing local control/display ports. Private destination blocks
remain unchanged. The same retained computer passed helper secret typing after
reapplying the firewall. Only a synthetic value on an in-memory form was used.

Chrome rendered the live screen through the server and helper and visibly showed
`SYNTHETIC_SECRET_TYPED` beneath a masked password field. Mouse focus, keyboard
input and clearing the field through noVNC also changed the displayed field.
A screenshot obtained independently through the helper screenshot API showed the
same marker. Real LAN grant/revocation probes after both fixes returned `connected`
and `blocked`, respectively, while owner status remained `running`.
