# Server privilege separation (issue 97)

The application image starts `node lib/privilege-broker.js` under tini. The small
process/file supervisor starts as root; `server.js` runs as UID/GID 60000, with
supplementary groups removed. Bots use distinct principals starting at 61000.
The supervisor provides fixed process/file operations over a private local socket.
It has no Docker socket or registry token. The separate Docker helper remains the
only service with those credentials and host Docker authority.

Both Linux and Mac Compose definitions drop all capabilities, then grant the
supervisor only CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID and KILL. KILL is
needed to terminate a bot process group running under another UID. They also set
`no-new-privileges`. Changing to the server identity must clear effective and
permitted capabilities; the runtime acceptance below checks this directly.
The root supervisor is still a trusted security boundary, not a rootless container.

The helper volume is read-only in the server service. Its root-owned directory
uses group 60000 and mode 0710; the socket uses root:60000 and mode 0660. The
server can connect but cannot unlink or replace the socket. Bot principals receive
neither group 60000 nor permission to traverse this directory. The Docker helper
starts with a restrictive umask, so the socket is private before its final
ownership and permissions are applied.

## Existing installations

Keep the existing `bot-dot-home` named volume mounted at `/root`. It holds Claude
Code sign-in state. The configured Bitwarden CLI cache is in
`/data/bitwarden-cli`, which is preserved in the existing data volume. The supervisor migrates application state in place before starting the server
with `HOME=/root`; the mount path and named volume do not change. The home
directory itself stays root-owned with group 60000 and sticky mode 01770.
Legacy `.docker` credentials stay root-only: the server cannot read, rename or
unlink that directory, including across another migration. Normal Claude state
is owned by UID 60000 and remains writable. Do not create a fresh home volume during the upgrade. The supervisor also
prepares data/config ownership and restores each bot's separate principal.

Recreate both Compose services when upgrading so the changed command, capability
bounds and read-only helper mount take effect. Back up data, config and home
volumes together before an upgrade. A rollback uses the previous image and
Compose file with those same volumes; the former root server can read the migrated
files. Do not claim rollback or sign-in persistence from this design alone: run
the acceptance checks with synthetic credentials in a disposable fixture first.

## Required runtime acceptance

Run these checks in a disposable Linux Docker fixture, including the Mac Compose
networking variant. Do not use production data or Claude/Bitwarden credentials.

- Seed the previous root-owned home with synthetic Claude/Bitwarden state, plus
  synthetic data and a vault key. Upgrade, restart and verify preservation,
  resulting ownership, server writes and successful bot execution.
- Inspect `/proc/<server-pid>/status`: all UIDs/GIDs are 60000, supplementary
  groups exclude root, `CapEff`, `CapPrm` and `CapAmb` are zero, and `NoNewPrivs`
  is 1. Check bot children separately for their assigned UID/GID and zero
  effective/permitted/ambient capabilities.
- Verify the server and supervisor have no `/var/run/docker.sock` or registry
  token. Verify only the helper has the Docker mount/token.
- As UID 60000, connect to the helper successfully, but fail to unlink its socket
  or write its directory. As two distinct bot principals, fail to connect to the
  helper and supervisor sockets and fail to read server home/config secrets or
  each other's private files.
- Exercise bot creation, run/cancel, scheduled script execution, workspace
  file operations and deletion through the public server API. Test rejected
  traversal, symlink and hard-link requests at the broker boundary.
- Exercise computer migration, export/reset/restore, screen and secret typing
  through the helper. Restart both services and repeat the socket checks.
- Restore the previous image/Compose in the fixture and confirm data/sign-in
  preservation before accepting the rollback procedure.

## Observed acceptance, 29 September 2026

The final local verification records below supersede the earlier root-server
acceptance. No production server or real sign-in credentials were used.

Local checks: `npm test` passed 319 tests with 12 environment-dependent skips
(331 total). The Linux users job, including all new broker/filesystem/non-root
tests, passed 25/25 with no skips. Gitleaks reported no leaks. Both Compose
definitions and `git diff --check` passed. The opt-in live helper test passed,
including a separate rendered-screen check; it was repeated after the final
home-directory migration fix.

- The public HTTP/MCP regression fixture starts the actual supervisor/server as
  root/60000 and executes bots as 61000/61001 and Chief as 60500. Owner HTTP
  access from bot processes and reads of server files are denied. Private MCP
  configuration, uploaded attachments, skill loading and scheduled scripts work.
- Encrypted HTTP backup/restore preserves a bot-created 0600 file, its contents
  and its assigned UID after the supervisor restarts.
- Principal filesystem tests execute the worker as UID 65534, including Git
  initialization, binary reads, directory metadata and bounded streaming.
- Broker regressions cover path/identity rejection, inherited object properties,
  fragmented UTF-8, ignored stdin, background process-group cleanup and migration
  of principal-owned FIFOs/hardlinks without modifying their targets. Legacy
  Docker credentials remain unreadable and cannot be renamed by UID 60000,
  while ordinary home writes succeed; both properties survive another migration.
- The disposable two-service Docker fixture verifies the actual server's four
  UIDs/GIDs are 60000, supplementary groups are empty, effective/permitted/ambient
  capabilities are zero and NoNewPrivs is 1, before and after restart. Synthetic
  Claude state, Bitwarden cache and vault key survive legacy ownership migration.
  Both bot UIDs are denied the helper/broker sockets and server secrets.
- The same fixture exercises legacy computer stop/export/reset/restore, helper
  commands, LAN grant/revoke and secret typing in a real browser. The app service
  has no Docker socket. All helper requests originate as server UID 60000.
  Chrome rendered the live noVNC screen through the non-root server WebSocket
  proxy, visibly showing the synthetic secret-typing success marker.

Production signed-image publication and a real published-image upgrade remain
tracked in issue 96. Synthetic state preservation does not prove a live Claude or
Bitwarden session remains authenticated. Rollback to a previous published image
has not been exercised. The fixture uses Docker Desktop Linux containers with
published-port networking; native Linux host networking is not runtime-tested
here. Both Compose definitions parse successfully.

Cancellation kills the run's process group. A descendant that deliberately calls
`setsid()` can escape that group; cgroup-based lifecycle containment remains
outside this change. The root supervisor remains trusted, and a compromised HTTP
server can request the fixed bot/helper operations it normally controls. It cannot
request a root command or access dockerd directly.

## Upgrade audit follow-up

Release acceptance exposed a transition defect: the legacy updater recorded
`update.applied` as root after the supervisor had migrated the data directory.
A previously absent audit log became root-owned and blocked subsequent server
audit writes. That privileged append could also follow a server-controlled link.

The new recorder never opens server data as root. For compatibility with the old
updater command, its root entrypoint finds exactly one running `bot-dot` service
for the install directory, waits for its health check and delegates recording to
UID/GID 60000 inside that container. This works even when the host installation
has mode 0700. Future updater commands explicitly wait for health and execute the
recorder as 60000. The health check uses the public `/api/version` endpoint, so
Mac installations protected by an owner key can become healthy.

Regression checks reproduced the root ownership failure and owner-key health
failure before the fixes. Linux release-CLI tests cover successful non-root
appends, health waiting, ambiguous container selection and a root-only symlink
target remaining unchanged. The complete local server suite passed 321 tests
with 16 environment-dependent skips; the Linux boundary suite passed 30/30 with
no skips. Independent security review and Gitleaks passed.

A disposable Docker daemon exercised the actual legacy updater shell against a
locally built fixed image and a private registry. It used an install directory
with mode 0700 and the Mac Compose owner-key configuration. Synthetic data,
home and config markers survived; the replacement became healthy; its audit log
was UID 60000, mode 0600; an owner HTTP backup succeeded and appended its audit
event. This validates the transition machinery, not production signing. Published
signed-image installation remains the separate issue 96 gate.
