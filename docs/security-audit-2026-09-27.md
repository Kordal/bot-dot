# Security audit — 27 September 2026

Historical record: the native Linux GUI app was removed on 29 September 2026. References to its Rust/GTK/Flatpak code, builds and outstanding checks below describe the earlier scope, not current support or release requirements. Linux servers, containers and bots' computers remain supported.

**Recommendation: keep the repository private until S1–S4 are fixed. Address S5–S7 before distributing public application releases.**

The review found one critical release risk, three high-severity findings, and three medium-severity findings. The most serious application issue was reproduced with a real unprivileged Linux process: a bot can bypass its API restrictions and be treated as the owner.

No production credentials were identified by the secret scans. This does not offset the authorization findings.

## Scope and evidence

- Reviewed the server, bot/Chief execution and authorization paths, vault and backup handling, uploads, browser rendering, desktop/mobile update paths, Docker packaging, and GitHub Actions.
- Reviewed 390 tracked files at commit `ae691277d0657da233646c1385a4b92c0a4c5150`. The working changes present at the start were committed during the scan; a final content comparison confirmed that every tracked file matched the source snapshot used for the review. The existing local `.claude/launch.json` change was not altered.
- Confirmed through GitHub's API that `Kordal/bot-dot` is currently private. Repository visibility, workflows, runners, and secrets were not changed.
- Ran `npm test`: **77 passed, 0 failed**, in approximately 104 seconds, using Node 26.8.1. These tests use scratch data and a fake Claude executable.
- Reproduced Linux authorization failures in a disposable container using the reviewed source, separate UIDs, synthetic data, no external network, and no Docker socket. No production service was probed.
- Ran Gitleaks **8.30.1** on the current source and all locally available Git refs. The history contained 116 reachable commits; Gitleaks reported scanning 112 commits with approximately 3.96 MB of content. Both scans flagged the same synthetic password in `test/backup.test.js:30`; manual inspection confirmed a test fixture. **No confirmed real secret found.** Ignored runtime `data/` was intentionally excluded from the source scan.
- Ran cargo-audit **0.22.2** against `linux/Cargo.lock`: **273 dependencies, 0 known vulnerabilities, 0 warnings**. Advisory database revision: `e2111519ba6d14a5da59a7b2e5c8083ae8a37c01`, updated 25 September 2026.
- Resolved Android's `releaseRuntimeClasspath` using Gradle and JDK 21, then queried OSV for **153 resolved Maven package/version pairs**: **0 matching advisories**. Queried `@novnc/novnc` 1.5.0 separately: **0 matching OSV advisories**. Only package names and versions were sent to OSV.

This was a source review with targeted exploit validation, not an exhaustive penetration test. It did not scan the exact deployed container images, their OS packages, globally installed npm/Python tools, every vendored subcomponent, or GitHub release binaries. Native client behavior on physical devices, particularly lock-screen actions and update installation, was not tested. Passing advisory checks means no matches in the queried databases, not proof of safety.

## Findings

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| S1 | Critical before making public | Pull requests execute on persistent self-hosted runners | Workflow and runner setup review |
| S2 | High | Bot bypasses owner API restrictions using another loopback address | Reproduced with Linux UID 61000 |
| S3 | High | Chief can create an already-approved script job through extra tool arguments | Reproduced through the real MCP server as UID 60500 |
| S4 | High | `.env` is included in Docker builds and is not Git-ignored | Reproduced with a synthetic Docker build |
| S5 | Medium | Malformed URL terminates the server | Reproduced against a scratch server |
| S6 | Medium | Desktop updates lack independent publisher authentication | Source review |
| S7 | Medium | Android approval actions do not require device unlock | Source review; device verification outstanding |

### S1 — Public pull requests can compromise the build machines

**Locations:** [tests.yml](../.github/workflows/tests.yml), lines 9–10, 24–64; [runner setup](https://github.com/Kordal/bot-dot/blob/f86dacaa249b307ecbb6f162ee8cf09df003c76b/deploy/runners/setup.sh), lines 19 onward; [Linux releases](https://github.com/Kordal/bot-dot/blob/ae691277d0657da233646c1385a4b92c0a4c5150/.github/workflows/linux.yml).

The `pull_request` workflow checks out contributor-controlled code and runs `npm test`, Gradle, Xcode, and Flatpak builds on `botdot-mac` and `botdot-linux`. The Mac runners run under the owner's account. The Linux runners are privileged containers with persistent state, their own Docker engines, and a shared release-artifact directory. The release workflows use the same runner labels.

After publication, when a fork PR workflow is permitted to run, its author can change a test or build script to execute arbitrary code on these machines. The potential impact includes host-accessible credentials and files, persistent modification of later builds, and tampering with release artifacts. Withholding GitHub secrets from fork jobs does not protect credentials already on the runner or future jobs on a compromised runner. Fork workflow approval can delay execution; it does not sandbox it.

**Fix:** run public PR validation on disposable GitHub-hosted runners. Keep signing and publication in a separate trusted workflow and environment, with no persistent filesystem or artifact handoff shared with untrusted jobs. If self-hosting remains necessary, use genuinely disposable, isolated workers without access to personal machines, internal services, or release credentials.

GitHub explicitly warns against running public-repository PR code on self-hosted machines: [GitHub runner security guidance](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners).

**Acceptance:** a fork PR cannot schedule a job on either existing personal runner label; its modified build scripts execute only in disposable infrastructure. Release jobs cannot consume artifacts or caches writable by untrusted PR jobs without a verified trust boundary.

### S2 — Alternate loopback source address becomes the owner

**Locations:** [identity.js](../lib/identity.js), lines 171–200; [server.js](../server.js), lines 1329–1348.

`identify()` begins with `who = 'owner'` and looks up the connection UID only for three exact source addresses: `127.0.0.1`, `::1`, and `::ffff:127.0.0.1`. Linux permits an unprivileged client to bind a connection to another address in `127.0.0.0/8`, such as `127.0.0.2`. That connection skips the UID lookup and retains owner privileges.

The test enabled separate users and configured `BOT_DOT_ALLOWED_USERS`. It supplied a synthetic allowed Tailscale login and external-looking `X-Forwarded-For`; the server accepts these headers without verifying a trusted proxy connection. The same bot process then made the same owner-settings request from two addresses:

```text
UID 61000, source 127.0.0.1 → GET /api/settings → 403
UID 61000, source 127.0.0.2 → GET /api/settings → 200, owner settings returned
```

No run token was supplied. A bot with shell/network capability can therefore reach owner controls instead of being confined to its own run endpoints. Those controls include changing bot permissions, granting vault access, and configuring/downloading backups. The configured owner login is not an authentication secret.

There are related fail-open behaviors: a missing UID lookup also leaves the caller as owner, and the socket-table lookup matches only the source port instead of the full connection tuple. Direct non-loopback exposure through `HOST` also trusts client-supplied Tailscale identity headers. Do not treat `BOT_DOT_ALLOWED_USERS` as authentication for a directly exposed listener.

**Fix:** make unknown identities fail closed. Prefer separate authenticated channels for owner, Chief, and bot requests, with explicit scoped capabilities. If retaining UID checks, handle all loopback addresses, match both addresses and ports, and reject lookup failures. Accept Tailscale identity only from a verified proxy path; otherwise require independent application authentication.

**Acceptance:** real Linux processes running under bot UIDs receive 403 for every owner endpoint from all supported source addresses, with missing/forged tokens and proxy headers. A failed or ambiguous UID lookup also receives 403. Include these tests in CI with user separation enabled.

### S3 — Chief tool arguments bypass script approval

**Locations:** [mcp-server.js](../lib/mcp-server.js), lines 317–320 and 447–452; [server.js](../server.js), lines 1052–1055 and 1085–1100; [bots.js](../lib/bots.js), line 193; [jobs.js](../lib/jobs.js), `autoApproved()` and `normalizeJob()`.

The MCP dispatcher does not validate arguments against its schemas. `create_bot` forwards the entire argument object to `/api/bots`, including fields absent from `BOT_FIELDS`. Unlike `update_bot`, it does not add `_by: 'chief'`. The API determines the actor from this optional body field and otherwise assumes `you`.

A `create_bot` call containing an extra `jobs` array therefore creates script jobs as owner-authored and immediately approved. A real MCP call under the Chief UID reproduced this with a disabled no-op job:

```json
{
  "name": "Audit probe",
  "prompt": "Do nothing",
  "jobs": [{
    "name": "No-op probe",
    "kind": "script",
    "cron": "0 0 1 1 *",
    "script": ":",
    "enabled": false
  }]
}
```

The returned job had **`approved: true`**. The probe kept it disabled and did not execute a script. An enabled job would be eligible to run without the promised owner review. Other owner-only routes also trust `_by` or the absence of a tool in the Chief's advertised tool list, rather than enforcing the role at the API boundary.

**Fix:** derive the actor from authenticated server-side identity, never from request JSON. Enforce owner-only permissions and approval rules on every API endpoint. Validate MCP arguments, reject unknown fields, and explicitly whitelist fields forwarded by `create_bot`. Adding `_by: 'chief'` alone addresses this particular path but leaves the underlying authorization weakness.

**Acceptance:** the same real MCP request is rejected or produces an unapproved script job. A Chief connection cannot approve jobs, grant unrestricted permission modes, answer owner-only requests, or impersonate `you` by omitting/changing a JSON field.

### S4 — Local credentials can enter Git and public images

**Locations:** [.gitignore](../.gitignore); [.dockerignore](../.dockerignore); [Dockerfile](../Dockerfile), `COPY . .`; README Docker setup instructions.

The documented setup writes the registry token and optional Claude token into a root `.env`. Neither ignore file excludes `.env`. A normal `git add .` can commit it; a Docker build from that folder copies it into `/opt/bot-dot/.env` regardless of whether Git tracks it. Clearing tokens from the process environment does not remove a file baked into an image.

**Reproduction:** used the repository's `.dockerignore` in a separate build context with a synthetic `.env`, then performed a `FROM scratch` / `COPY . /opt/bot-dot/` build and exported its filesystem. The resulting filesystem contained `/opt/bot-dot/.env`.

No actual credential file was built or published, and the source/history scan did not identify a committed real token. This is a confirmed packaging flaw, not evidence that an existing image contains a secret.

**Fix:** exclude real environment files, signing material, and private keys from both Git and Docker contexts, while explicitly allowing templates such as `*.env.example`. Prefer an allowlist of runtime paths in the Dockerfile over copying the whole checkout. Before publishing existing images, inspect their contents and layers; rotate any credential actually found in a published or shared artifact.

**Acceptance:** a synthetic `.env` is ignored by Git and absent from the built image and its layers. Required example files remain available. Secret scanning runs on PRs and history.

### S5 — One malformed static URL crashes the server

**Locations:** [server.js](../server.js), lines 152–160 and 1380–1401.

Static serving calls `decodeURIComponent()` outside the request handler's `try/catch`. A request such as `GET /%zz` throws `URIError`; because the HTTP callback is async, it becomes an unhandled rejection and terminates Node under its default behavior.

**Reproduction:** a scratch server exited with status **1** and logged `URIError` after a single request to `/%zz`. The client received a disconnected socket. The request must pass the Host/user gate; local access needs no application session. Repeated requests can keep a restarting deployment unavailable.

**Fix:** place URL parsing, gating, static serving, and routing inside a common error boundary; return 400 for invalid encodings. Handle stream errors. Also enforce the JSON body's byte limit while reading: `readBody()` currently rejects its promise at the limit but continues appending incoming data.

**Acceptance:** malformed percent escapes, invalid request targets, disappearing static files, and oversized bodies return bounded errors while the process remains healthy. A subsequent `/api/version` succeeds.

### S6 — Mac/Linux updates authenticate a checksum, not a publisher

**Locations:** [Mac updater](https://github.com/Kordal/bot-dot/blob/ae691277d0657da233646c1385a4b92c0a4c5150/macos/BotDot/Data/AppUpdate.swift), lines 29–49; [Linux updater](https://github.com/Kordal/bot-dot/blob/ae691277d0657da233646c1385a4b92c0a4c5150/linux/src/update.rs), `download_and_install()`; Mac release workflow; [Linux release workflow](https://github.com/Kordal/bot-dot/blob/ae691277d0657da233646c1385a4b92c0a4c5150/.github/workflows/linux.yml).

Both clients obtain update metadata and the binary from the same botdot server and compare the download with the checksum that server provided. Neither updater verifies an independent publisher signature. The Mac release uses ad-hoc signing; the Linux release builds bundles without a configured release-signing key. The Mac updater replaces and launches the downloaded app.

A compromised update server can provide matching malicious bytes and a matching hash. An active network attacker can do the same when a desktop client uses a non-loopback plain-HTTP address, which both clients permit. A user still has to initiate the update. This is a source-confirmed trust weakness; a malicious native update was not installed during this scan. Android additionally benefits from the OS enforcing the existing app's signing identity for an in-place update.

**Fix:** sign release metadata/artifacts with a dedicated release key and pin the verification key in the client. Verify identity, version, and artifact before extraction or installation; reject rollback. Use an authenticated signed Flatpak repository or equivalent verification, and authenticated Mac releases. Require HTTPS for non-loopback server addresses. A hash remains useful for integrity but is not a substitute for publisher authentication.

**Acceptance:** replacing both an artifact and its server-provided checksum is rejected without a valid release signature. Test valid signatures, wrong keys, modified files, and rollback.

### S7 — Sensitive Android notification actions lack an unlock requirement

**Locations:** [Notifier.kt](../android/app/src/main/java/dev/botdot/app/feed/Notifier.kt), lines 223–242; [Receivers.kt](../android/app/src/main/java/dev/botdot/app/feed/Receivers.kt), `answer()`.

Approve buttons send broadcast PendingIntents directly to the API handlers for jobs, permissions/skills, shared-memory changes, and Chief plans. They do not set `setAuthenticationRequired(true)`, and the receiver does not check whether the device is unlocked. The receiver is correctly non-exported, but that does not enforce lock-screen authentication for its notification action.

This leaves sensitive authorization dependent on the OS/device's default lock-screen behavior. The source gap is confirmed; approval while locked was **not reproduced on a physical phone** and should not be reported as universally possible. Android documents the explicit unlock requirement for sensitive actions: [Notification action authentication](https://developer.android.com/reference/androidx/core/app/NotificationCompat.Action.Builder#setAuthenticationRequired(boolean)).

**Fix:** require authentication for sensitive notification actions on supported Android versions. On older versions, route approvals through an activity that requires unlock before sending the API request. Use a redacted lock-screen notification where its text may disclose private bot output.

**Acceptance:** test locked devices with lock-screen notifications enabled, including a pre-Android-12 device or emulator. No approval request is sent until authentication succeeds; cancellation sends nothing.

## Additional release work

- Add a root `LICENSE` reflecting the license you choose, plus a `SECURITY.md` with a private vulnerability-reporting route and a supported-version policy. The Linux crate declares MIT, but there is no root license file. Preserve third-party notices, including noVNC's MPL license.
- Pin CI actions to reviewed commit SHAs and container bases to digests. Record and scan the actual shipped versions of Claude Code, Bitwarden CLI, Camoufox, browser binaries, and OS packages; the Dockerfiles currently install several moving versions. Generate an SBOM for each release image.
- Add security checks to public PR CI: secrets, dependency advisories, static analysis, and the Linux boundary regression tests. The current test helper sets `BOT_DOT_SEPARATE_USERS=0`, which explains why the existing green suite did not cover S2.
- Tighten network/transport documentation: the supported default is loopback behind Tailscale Serve, not an unauthenticated public or LAN listener. Document that assigning a connector currently grants its write actions too; natural-language instructions are not an enforced per-action approval boundary.
- Add a suitable Content Security Policy, frame restrictions for the dashboard, and MIME-sniffing protection. Keep the same-origin live-screen embedding requirement in mind.

## Release gate

1. Fix S1–S4 and add regression checks for the actual role/UID boundaries.
2. Fix the server crash, authenticate desktop releases, and verify Android approval behavior.
3. Scan the exact final container digests and release artifacts, including image layers for credentials.
4. Re-run tests and secret scans on the final commit; review repository settings and signing/release separation before changing visibility.

This audit changed no application code and published nothing. The findings are open.
