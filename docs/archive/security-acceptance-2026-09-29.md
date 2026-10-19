# Security acceptance check: issues 91–99

Current scope update: the owner subsequently authorized issue 97 server privilege reduction. Its implementation and fresh acceptance evidence are recorded in [Server privilege separation](security-nonroot-acceptance.md). References below to that work being deferred describe the earlier scope.

Historical record: the native Linux GUI app was removed on 29 September 2026. References to its Rust/GTK/Flatpak code, builds and outstanding checks below describe the earlier scope, not current support or release requirements. Linux servers, containers and bots' computers remain supported.

Baseline: `a6e48f3a49552275767474fe38d494f6cda825ce`. Checked on 29 September 2026.
This checks the implementation against the GitHub tickets, using scratch servers,
fixture credentials and disposable containers. It does not certify a production rollout.
The earlier implementation record is [security-issue-90.md](security-issue-90.md).

## Defects found and fixed

### Issue 94: combined tool rules bypassed approval

The Chief could send `allowedTools: ["Read,Bash"]` or `["Read Bash"]`.
The API saved it immediately without a pending approval. Claude Code splits these
arguments into separate tool names, so the run received Bash without owner approval.

Bot normalization now rejects combined or ambiguous array entries before saving or
creating a proposal. Scoped rules such as `Bash(git diff *)` and `Bash(echo a,b)`
remain intact and still require approval. The HTTP regression covers creation and
updates, checks that the saved tools do not change after rejection, then approves
a valid scoped rule and checks the spawned process arguments. The regression
failed with HTTP 200 before the fix and passes with HTTP 400 afterwards.

### Issue 98: a queued LAN grant survived a later revocation

While an internet start was pending, a LAN request queued behind it. A later
internet request incorrectly shared the first promise, ignoring the queued grant.
After all three requests completed, a live private service was still reachable.

Final review found the same ordering failure without a pending start: two changes
could complete their Docker inspections in reverse order and apply a stale LAN grant.
A controlled Docker CLI regression reproduced that case independently of the live test.

Computer policy changes now queue before inspecting Docker, and matching requests
share only the latest compatible queued operation. Completion removes only its own
queue entry. A reconfiguration leaves an idle computer off; a start cannot be lost
by sharing that no-start operation. The real Docker regression failed with `connected`
before the fix and returns `blocked` afterwards. The delayed-inspection regression
also failed before the fix and passes afterwards.

## Acceptance status

| Issue | Evidence from this pass | Status / remaining work |
| --- | --- | --- |
| [91](https://github.com/Kordal/bot-dot/issues/91) Owner key isolation | Real Linux bot/Chief UIDs; child environment and `/proc/self/environ`; owner header/cookie, wrong/missing keys, Chief authentication | Local acceptance met. Upgrade of an installed server remains unverified. |
| [92](https://github.com/Kordal/bot-dot/issues/92) Exact saved-login hosts | HTTP fixture, owner-only additional hosts, subdomain/suffix rejection, DNS-to-loopback rejection, unfollowed redirect, header-only secrets | Local regression criteria met. No credentials sent to an external service. |
| [93](https://github.com/Kordal/bot-dot/issues/93) Read-only dashboard GET | Real HTTP requests with foreign Origin, script marker and counted HTTP/image requests; protected refresh POST | Local server acceptance met. Client refresh calls and API docs inspected; no new interactive client walkthrough. |
| [94](https://github.com/Kordal/bot-dot/issues/94) Owner approval gates | Real HTTP/MCP fixture paths, task/tool/computer/connector proposals, decline/stale handling, connector read/write/unknown classification, exact once-only and persistent grants, combined-rule regression | Local acceptance met after the fix. Real connector accounts not exercised. |
| [95](https://github.com/Kordal/bot-dot/issues/95) Signed client updates | Node, Swift, Android and Rust fixture verification; tampering, wrong app and rollback rejection; native transport checks; Swift download/unpack checks | Verification code passes locally. Production pins are empty; production signing and native installation remain outstanding. Rust was tested independently of GTK. |
| [96](https://github.com/Kordal/bot-dot/issues/96) Image provenance | Dockerfile base/package pins and unchanged model checksum inspected; signed-image updater regressions; actual Trivy critical/clean image fixtures; workflow scans the pushed digest before release promotion | Implementation and local fixture checks pass. No production build, signed registry publication or scan of final release digests in this pass. |
| [97](https://github.com/Kordal/bot-dot/issues/97) Docker helper | Unix-socket helper rejects arbitrary operations, mounts, foreign project and invalid IDs; owner policy forwarding regression; Compose socket/token placement inspected | Partial by explicit owner decision. Server is still root; process/file broker and privilege reduction remain deferred. Real two-service upgrade and helper-mediated screen/secret typing remain rollout checks. |
| [98](https://github.com/Kordal/bot-dot/issues/98) Computer isolation | Real Docker startup probes from another container, private destination blocks, DNS, exec control, capability settings, live LAN grant/revocation and queued-grant regression | Network acceptance checks pass after the fix. Current live test calls the computer module directly; it does not prove a deployed helper migration or rendered live screen. |
| [99](https://github.com/Kordal/bot-dot/issues/99) Backup/upload/audit hardening | 11/12-character boundary, saved scrypt parameters, legacy backup restore, declared and chunked size limits, aborted-upload cleanup, Office expansion rejection, audit permissions/redaction and survival across restore | Local automated acceptance met. The supported HOST comment and audit event call sites were inspected. |

## Reproduction and validation

- Final `npm test`: 300 passed, 0 failed, 5 environment-dependent skips (305 total).
  The skipped Linux UID and Docker network checks were run explicitly below;
  the optional real bge-m3 model check was not part of this security pass.
- `node --test test/owner-approval.test.js test/backup.test.js test/data.test.js`:
  19 passed. The upload test actually streams 257 MiB without Content-Length and
  separately aborts a partial upload; both leave no temporary upload file.
- `BOT_DOT_DOCKER_TEST=1 node --test test/computer-network.test.js`: passed against
  the local desktop image. Scratch containers and their network are removed by the test.
- `node --test test/docker-helper.test.js`: 3 passed, including the deliberately
  delayed inspection that previously allowed a stale grant to override revocation.
- Linux UID tests in the pinned Node image, with a read-only source mount,
  `--network none` and `BOT_DOT_TEST_UIDS=1`: 8 passed.
- `sh deploy/test-critical-scan.sh`: critical jsonpath-plus fixture rejected;
  clean fixture accepted by the same pinned scanner used in CI.
- Xcode toolchain, `swift test --filter 'ReleaseManifestTests|MacAppUpdateTests'`:
  5 passed. The Command Line Tools toolchain lacks the Testing module; use
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` on this Mac.
- JDK 21, Android `testDebugUnitTest`, filtered to `ReleaseManifestTest`, `ApiTest`
  and `WaitingTest`: 9 passed; Kotlin compilation succeeded.
- Rust `release_manifest.rs`, included directly in a temporary Cargo harness with
  its existing dependencies: shared signature fixture test passed. Full GTK/Flatpak
  build and installation were not run.
- Gitleaks 8.30.1: tracked source snapshot passed with the existing fixture exclusions.
- JavaScript syntax checks and `git diff --check` passed. No typecheck script is
  configured in this JavaScript repository.

## Remaining release work

1. Provision the protected release signing key and pin its public key in all four
   verifiers. Follow [release-signing.md](../release-signing.md); never use the fixture key.
2. Build, scan and sign actual release artifacts and both platform image digests.
   Retain the SBOMs and scan results from that workflow run.
3. Verify an isolated two-service Compose upgrade, legacy computer migration,
   helper-mediated screen/secret typing, and native update installation.
4. Keep issue 97 partial until its deferred privilege reduction is separately authorized.

GitHub tickets and production settings were not changed by this pass. Local acceptance
is evidence for triage, not a reason to mark deployment prerequisites complete.

## Standards review

No findings in the final diff. The shared queue preserves distinct start/reconfigure
behavior, registers operations before asynchronous inspection, and removes only its
own completed entry. The Docker boundary regression restores its replacement after
the test. No unrelated refactoring was requested.

## Spec review

No remaining actionable findings in the final diff. Issue 94's combined tool rules
are rejected before mutation; issue 98's two ordering failures have regressions;
issue 99's missing upload, passphrase and audit checks now run at their public
boundaries. Production prerequisites and the deferred issue 97 scope remain explicit.

Final review: 0 Standards findings; 0 Spec findings.
