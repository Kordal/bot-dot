# Security remediation: issue 90

Current scope update: the owner subsequently authorized issue 97 server privilege reduction. Its implementation and fresh acceptance evidence are recorded in [Server privilege separation](security-nonroot-acceptance.md). References below to that work being deferred describe the earlier scope.

Historical record: the native Linux GUI app was removed on 29 September 2026. References to its Rust/GTK/Flatpak code, builds and outstanding checks below describe the earlier scope, not current support or release requirements. Linux servers, containers and bots' computers remain supported.

Baseline: `ba79a0f`. Scope: issues 91–99. This is implementation and local verification,
not a production rollout or a declaration that all child issues can be closed.

The [29 September acceptance follow-up](security-acceptance-2026-09-29.md) records
fresh checks, remaining release prerequisites, and fixes for combined tool-rule
approval bypasses (#94) and queued LAN grants overriding revocation (#98).

## Trust boundaries

- Owner keys are captured before loading server modules. Spawned bot/Chief environments
  exclude server keys, with the Claude access token explicitly provided where needed.
- Saved-login HTTP calls require an exact owner-selected host. Public DNS names may not
  resolve to private addresses; checked addresses are pinned to the request. Explicit
  internal hosts remain usable. Redirects are not followed and secrets remain header-only.
- Dashboard GETs return cached data. Refreshing reads and images requires a protected POST.
- Bots and the Chief propose task/rule and capability additions in Needs you. Owner approval
  binds the proposal to the previous values; stale edits fail. Removals remain immediate.
  New bots learn memory by default; existing learning settings remain unchanged.
- Connector reads require backend `readOnlyHint` metadata without mutation tags. Writes and
  unknown metadata wait for approval before execution or file upload: the run waits for the
  owner's answer, inside the run, for ten minutes. A one-use grant binds one run, the action
  and the exact arguments: the run that waits for the answer or, when the owner answers after
  it stopped waiting, the run that answer starts
  ([ADR 010](adr/010-a-connected-app-action-waits-in-its-run.md), which changes the earlier
  rule that it binds the current run). Such a late grant is kept with the queued work, bound
  to the new run's id as that run is made, used by one call, and gone when that run ends, used
  or not; other arguments ask again. Only the token of the run that asked can wait for an
  answer, and only the owner can give it. The owner API also supports persistent exact
  action grants (`always: true`) and revocation through `/bots/:id/connector-actions`.
  All four clients expose an explicit persistent-action approval, including after the original
  run ends; the confirmation explains that future arguments may differ. "Allow once" can be
  given after the original run stopped waiting, or ended, as well: the server then starts the
  bot again with the stored arguments, whichever client sends the answer, and no longer
  answers "That run has ended".
- Release verification uses the same canonical P-256 manifest in Swift, Kotlin, Rust and Node.
  Download hashes, app identity and rollback checks precede installation. Remote addresses
  require HTTPS. See [release signing](release-signing.md).
- Compose gives the Docker socket and registry token only to `docker-helper`. The server uses
  a private Unix socket with fixed methods; no caller-supplied Docker argv, mounts, images or
  Compose projects are accepted. Root is retained in the server for distinct-UID process and
  file handling. **A separate process/file broker and server privilege reduction are deferred
  by the owner's explicit scope decision. Issue 97 remains partial.**
- New desktops join a quiet namespace container only after IPv4 and IPv6 rules are installed.
  They have no capabilities and cannot gain privileges. Internet-only is the default; LAN
  requires an owner decision. Exec control and VNC remain local to each desktop. Loopback
  exceptions are limited to the desktop control/display services and established replies.
  Always-on starts go through this preparation, including after Docker restarts. Manual starts
  honor the saved policy, and changing a running or starting desktop's policy reapplies the
  firewall before the owner request succeeds. Changing an idle desktop's policy does not start it.
- Backup format 2 uses scrypt N=131072/r=8/p=1 and a 12-character minimum. Legacy keys and
  format 1 backups retain the old derivation. Backup uploads stop at 256 MiB and remove failed
  temporary files. Office expansion is limited to 8 MiB and 20x per member. The audit log is
  append-only through the application, mode 0600, and is preserved across backup restores.

## Deployment prerequisites and migration

1. Pin a production public key in the four verifiers and configure the private key in the
   protected GitHub `release` environment. The repository currently contains only a **test**
   key. Empty production pins deliberately reject updates; publishing is not ready yet.
2. Recreate **both** Compose services from the reviewed image/configuration. Merely restarting
   an old server container leaves its old Docker socket mount in place. The helper and server
   must come from the same release. Rotate the previous registry token and remove legacy
   Docker credentials from the server's persistent root home after moving to the helper.
3. Old desktop containers cannot acquire a different network namespace without recreation.
   They are stopped, their automatic restart is disabled, and their files are preserved.
   Export needed files from the stopped `botdot-<bot-id>` container using the owner's Docker
   tools, then reset it through botdot and restore the files. No automatic destructive migration
   is attempted. This interruption is intentional: old computers cannot run with the startup gap.
4. The image workflow scans each exact pushed platform digest for critical OS/library
   vulnerabilities and retains CycloneDX SBOM and scan results before promoting the index.
   The signed detached manifest is the `dev.botdot.release` annotation on the `:release` index;
   the updater pulls the signed immutable image reference, never the mutable tag. A fixture
   image containing a known critical global npm dependency must fail the scanner while a clean
   fixture must pass (`deploy/test-critical-scan.sh`); both outcomes were verified locally.

## Initial implementation verification

- Final server suite: 297 passed, 5 environment-dependent skips (302 total).
- Linux container with real UID separation: all 8 owner/authentication and environment tests pass.
- Real Docker desktop: exec control, DNS, capability restrictions and private-address probes pass.
  A live private service is blocked by default, reachable with LAN enabled, and blocked again
  after LAN is revoked. A second container cannot reach control/display during startup.
  Revoking LAN while creation is still pending also ends with the private service blocked.
- Swift package: 82 tests pass; the native Mac app builds.
- Android: debug build, 27 unit tests and lint pass with the final transport/UI changes;
  the additional saved-login host API regression also passes (5 API tests in the targeted run).
- Rust release verifier: shared signature fixture passes in an isolated Cargo harness.
  The full GTK/Flatpak build and interactive Linux/Android checks still require their platform SDKs.
- Web: a proposal displays the old/new task, tools and network policy. Approval applies it;
  after reloading, the bot displays the replacement task and the request no longer waits.
- Gitleaks: tracked source tree passes, with only the existing test-secret exclusions and the
  explicitly marked signing fixture excluded.

Production release signing, registry publication/scan results, upgraded installation rollout,
and real external connector accounts have not been exercised. Fixture keys and fake connectors
are deliberately separated from production credentials.
