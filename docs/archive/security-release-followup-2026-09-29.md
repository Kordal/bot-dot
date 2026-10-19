# Release and helper follow-up — 29 September 2026

Current scope update: the owner subsequently authorized issue 97 server privilege reduction. Its implementation and fresh acceptance evidence are recorded in [Server privilege separation](security-nonroot-acceptance.md). References below to that work being deferred describe the earlier scope.

Historical record: the native Linux GUI app was removed on 29 September 2026. References to its Rust/GTK/Flatpak code, builds and outstanding checks below describe the earlier scope, not current support or release requirements. Linux servers, containers and bots' computers remain supported.

Current image result: [Images run 36625499597](https://github.com/Kordal/bot-dot/actions/runs/36625499597)
and [signed upgrade run 36627061472](https://github.com/Kordal/bot-dot/actions/runs/36627061472)
passed. Release 201 signs both image indexes at revision `3b64714`; all four
platform scans report zero CRITICAL findings. The evidence handoff now uses
checksummed GitHub Release assets, with Buildx v0.32.0 pinned and checked before
builds. References below to the artifact-storage blocker describe earlier runs.
See [signed publication and installation evidence](security-image-acceptance.md#signed-publication-revision-3b64714).
The remaining issue 9 release gate includes image-layer credential scanning and
final repository/release policy review.

Continues [the acceptance audit](security-acceptance-2026-09-29.md), from
`4caf62d2ba7bcd214e0fa2a1f93feac4e300d042`. Independent work used isolated worktrees
for image dependencies, release workflows/Linux packaging, and helper acceptance.

## Production signing

The original pass pinned the production P-256 public key in Node, Swift, Kotlin
and Rust. After Linux GUI removal, Node, Swift and Kotlin remain supported; their
pins match the fingerprint in [release-signing.md](../release-signing.md).
The private key was uploaded to GitHub's `release` environment, restricted to
`main`; the temporary local key and smoke artifacts were removed. All six manifest
types signed and verified with that key before removal. Fixture signatures are
rejected by the default production verifiers.

Swift release/update tests passed 5/5. Android debug assembly, unit tests (9/9),
and lint passed. The standalone Rust verifier passed. Native release publication
and installation are separate acceptance requirements.

## Image publication

Both fresh local arm64 images report zero CRITICAL vulnerabilities. Dependency
choices, runtime checks and the removed C development headers are documented in
[the image acceptance record](security-image-acceptance.md).

Review found a race between scanning and signing: publication resolved mutable
platform tags after their original digests had been scanned. The workflow now
retains successful scan records in authenticated, same-run/attempt artifacts,
validates their identity, assembles only their immutable digests, and signs the
index digest returned by Buildx's metadata file. It never resolves a mutable tag
to select the content to sign. Missing or mismatched evidence fails publication.
Recovery must rerun all builds; mixed-attempt evidence is rejected.

Four release-command boundary regressions pass. A real disposable registry test
also passed: after both platform tags moved to an unscanned third digest, the
created index still contained exactly the two original scanned digests. Installed
Buildx 0.36.1 emitted the expected `containerimage.descriptor.digest` metadata.

The workflow provisions Node 24 before signing/scanner fixtures, uses the upstream
Trivy database, permits twenty minutes for full scans, keeps a runner-local copy
of evidence and still requires GitHub artifact upload. There are no vulnerability
exclusions. SBOMs and findings have seven-day artifact retention.

## Helper acceptance

See [the helper acceptance record](security-helper-acceptance.md) for the isolated
two-service harness, migration and owner-policy checks. The helper receives only
the disposable inner daemon's socket; the real host's computers are not managed
by this fixture. Issue 97's server privilege reduction remains explicitly deferred.

The real integration found and fixed two defects. Owner edits and approved Chief
proposals reapplied power settings even when only policy or text changed, stopping
manually started computers. Power handling now runs only for actual computer-type
or always-on changes; HTTP regressions cover both paths and explicit transitions.
The firewall also blocked Camoufox's local secret bridge despite a live listener.
TCP port 47111 is now permitted only on loopback; private-network blocks remain.
Both defects have observed red/green evidence.

The final retained-fixture replay passed migration/export/reset/restore, helper
commands, Docker-socket separation, capability checks, live LAN grant/revocation
and synthetic secret typing. Chrome rendered the noVNC screen and accepted input;
an independently retrieved screenshot showed the synthetic success marker. Fixture
containers and images were removed. This remains a source-level two-service check,
not an upgrade of production release images.

## Historical Linux GUI acceptance (client removed)

The Flatpak module then preserved the repository's source hierarchy and staged the
shared signature vectors. The old staging failed Rust compilation because the
fixture was absent; the corrected layout passed that regression.
The actual GNOME 51 Flatpak build on aarch64 passed: release compilation,
all 11 native tests, Clippy with warnings denied, and metadata/export/finish.
Its verifier source matched the production-pinned source exactly. This proved the
native build and checks, not Flatpak self-installation or a rendered Linux UI.

## Review and delivery

Final `npm test`: 306 passed, zero failed, five environment-dependent skips (311
total). The real Docker network test passed separately after the firewall change.
Gitleaks passed with the exact public verification key recognized as public data;
production paths and arbitrary key values are not excluded. Workflow actionlint
and `git diff --check` passed. This JavaScript project has no typecheck script.

### Standards

Independent review found no documented violations or actionable code smells in
the final implementation, including both power-edit paths and the loopback exception.

### Spec

Review identified the mutable-tag publication race and the missing approval-path
power fix. Both were corrected and reviewed again. No actionable implementation
findings remain in this scope. Published platform digests, native installation,
and a signed-image upgrade still require their own release acceptance evidence.
Issue 97 remains partial by explicit scope decision.

## Final scope: Linux GUI removed

At the owner's request, the Linux GUI source, Flatpak build and release workflow,
CI inputs/jobs, bundle fetching, image allowlist, updater endpoints, advertised
version/capability, and release-signing types were removed. Current documentation
lists web, Android and Mac clients. Linux servers, containers, runners and bots'
computers remain supported. Historical audit links point to their original commits.

The post-removal suite passed 309 tests with zero failures and five environment
skips (314 total). Public-boundary regressions reject retired update routes and
signing types even when old bundle files exist. Actionlint, documentation links,
Gitleaks and whitespace checks passed. Independent Standards and Spec reviews
found no actionable findings in the removal.

With separate owner approval, GitHub releases and tags `linux-v1.0.9`,
`linux-v1.0.10`, `linux-v1.0.12` and `linux-v1.0.13` were deleted after their
metadata and assets were backed up and verified locally. Both release and remote
tag absence were checked. Backups and deletion receipts remain under
`~/Backups/linux-gui-removal/2026-09-29/releases/`.

### Image publication blocked by artifact quota

Self-hosted image run [36578884042](https://github.com/Kordal/bot-dot/actions/runs/36578884042)
passed the ARM64 server SBOM and critical-vulnerability scan, then GitHub rejected
its mandatory artifact upload because artifact storage quota was still exceeded.
GitHub reports that usage recalculates every 6–12 hours. The earlier cleanup
backed up, verified and deleted 63 old artifacts (about 18.2 GiB); deletion does
not prove uploads are available immediately.

Publication requires authenticated scan records, so this run cannot publish signed
images. Rerun all jobs after quota recalculation; mixed-attempt evidence remains
invalid. The waiting isolated upgrade fixture was removed, including its daemon,
volumes and bootstrap image. No production credentials were loaded or signed-image
upgrade performed. Issue 96 remains open for complete publication and upgrade
acceptance.

Production [Android 0.1.74](https://github.com/Kordal/bot-dot/releases/tag/android-v0.1.74)
and [Mac 1.0.10](https://github.com/Kordal/bot-dot/releases/tag/mac-v1.0.10) releases
were published by the self-hosted workflows. Their actual Node/Kotlin/Swift
production verifiers accepted the downloaded signatures and hashes and rejected
tampering, wrong-app manifests and rollback. Android APK signing and the Mac's
strict code-signature check passed; the Mac archive contains Intel and ARM code.
This does not claim installation on a user's device.

## Actual Android update acceptance

The published Android app completed an actual **0.1.74 → 0.1.75** update in a
disposable Google Play ARM64 emulator running API 37.1 with 16 KB pages. Emulator
37.1.11 used the already installed system image and an isolated AVD/data directory;
no SDK image was downloaded and no existing AVD or physical device was used.

| Artifact | Source revision | APK SHA-256 |
| --- | --- | --- |
| Android 0.1.74, versionCode 74 | `c735a3152487cba2e33ad5c8355d8cf98064e62e` | `18bb757a57f51360d8d0316b982aa3841eb896e5dd43d71d6168bcb199639dbe` |
| [Android 0.1.75](https://github.com/Kordal/bot-dot/releases/tag/android-v0.1.75), versionCode 75 | `3fbb9049505541bbae0c0a552554deb08cdd4d55` | `a94a13af5c72b29092cf130b87f3a52ba50dbba204ea1314a9e79236b9c5531f` |

ADB installed only the starting version 74. The actual botdot server at revision
`3fbb9049505541bbae0c0a552554deb08cdd4d55` ran with fresh synthetic data and served
the unchanged published version 75 manifest and APK. The app connected through a
dedicated ADB reverse mapping to `http://127.0.0.1:18495`, displayed the update
banner, and used its production signature/hash verification and download path.
After granting this disposable app permission to install updates, its Install
button opened Android's package installer. Play Protect offered an optional scan;
“Install without scanning” continued without uploading the APK for a scan.

The installer displayed “App updated”. PackageManager changed from versionCode 74
to 75 while retaining the original first-install time. The installed `base.apk`
was pulled back and its SHA-256 matched the published version 75 hash above.
Reopening the app showed the connected home screen without an update banner;
Settings reported “This phone / Newest version”. The Change address screen still
contained `http://127.0.0.1:18495`, proving the synthetic connection survived the
update. Loopback HTTP worked on this image despite the source-level concern about
the cleartext policy; no transport defect was reproduced and no code was changed.

Screenshots, UI hierarchy XML, filtered installer logs, before/after package
metadata and `result.json` were retained locally in
`/var/folders/75/hzrfgp5566x_36cczglstpw40000gn/T/botdot-android-acceptance.bycixetz`.
The key screenshots are `installer-result.png`, `published75-settings.png` and
`published75-connection.png`. These temporary local artifacts are not repository
fixtures. The emulator and scratch server were stopped, their disposable AVD and
server data removed, and cleanup confirmed no attached ADB devices and no listener
on port 18495.

This proves the published Android update and connection retention on the observed
API 37.1 emulator. It does not claim physical-phone or Tailscale installation,
compatibility across other Android versions, or installation of the Mac release.
Actual Mac update installation was subsequently verified below.


## Actual Mac update installation

The unchanged published Mac 1.0.10 app updated to
[1.0.11](https://github.com/Kordal/bot-dot/releases/tag/mac-v1.0.11) through
Settings → Updates → This Mac. Release 11 was built from
`52b1843600b702b1c9d3d38489c248b2aa955123` by self-hosted
[run 36582586539](https://github.com/Kordal/bot-dot/actions/runs/36582586539).
Its archive SHA256 is
`497413d963cb6b73c426d11b84e5abfdbf34f02700f32776764843422ccec370`.

A scratch server served the production-signed manifest and archive. The real
update button downloaded, verified, replaced and automatically relaunched the app.
The installed bundle reports build 11 and matches every file in the downloaded
release archive. Strict code-signature verification passed. The saved synthetic
server address and preference marker survived; the relaunched UI connected to the
scratch server and displayed “Up to date”. The release also passed the production
Swift signature/hash verifier and tamper, wrong-app and rollback rejection checks.

The test used a writable temporary installation on this Apple Silicon Mac running
macOS 27. It does not claim Intel runtime coverage or replacement in a protected,
non-writable Applications directory. Both architectures are present in the release.

Preference-isolation probes failed on this host. With explicit owner approval,
the original app was quit, its preferences backed up, and synthetic preferences
used for the test. Afterwards, the test app and scratch server were stopped,
the original preference domain was restored with exact dictionary equality,
and the unchanged original app was reopened and visibly reconnected to its
normal server. Its executable checksum was unchanged. No product changes were
needed. Evidence and the settings screenshot are retained locally under
`~/Backups/security-acceptance/2026-09-29/mac-10-to-11/`.

Together with the actual Android update above, this completes issue 95's native
release installation acceptance. Image publication/upgrade remains tracked in
issue 96; deferred server privilege reduction remains in issue 97.
