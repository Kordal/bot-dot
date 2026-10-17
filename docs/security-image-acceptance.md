# Release image dependency acceptance — 29 September 2026

This records the image dependency fixes for #96, built from `bf8f5e5` on
Linux/arm64 through Docker Desktop. It is local evidence, not a published release
or an amd64 acceptance result.

## Dependency decisions

| Component | Selected version | Reason |
| --- | --- | --- |
| Official Docker CLI image | 29.7.2, multi-platform digest pinned in `Dockerfile` | Replaces the vulnerable Go runtime and Compose gRPC dependency reported by release CI. Bundles Compose 5.5.0. |
| CUA desktop base | Multi-platform digest pinned in `deploy/desktop/Dockerfile` | Makes both architecture selections reviewable and stable. |
| Desktop npm | 10.9.9, bundled tar 7.5.22 | Fixes CVE-2026-59873 without a major npm upgrade. |
| CUA computer server | 0.3.46 | Supports FastMCP 3.2; inherited 0.3.41 requires vulnerable FastMCP 2.x. |
| FastMCP | 3.2.4 | Fixes CVE-2026-32871 within the computer server's supported range. `pip check` passes. |

The upstream VM-derived desktop filesystem includes a guest kernel that its
container does not boot. The image removes unused kernel images, modules, tools
and development headers. Removing `linux-libc-dev` also removes `libc6-dev`:
**C development headers are no longer preinstalled.** Runtime libc, desktop
libraries, Python and Node remain. This does not update or secure the host kernel.
The test container reports the Docker host's `7.0.12-linuxkit`, rather than the
removed Ubuntu `6.8.0-137` guest kernel.

These are package changes, not scanner exclusions. Ubuntu still lists Noble's
kernel source as vulnerable for [CVE-2026-53398](https://ubuntu.com/security/CVE-2026-53398).
The upstream fixes are documented by [node-tar](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw)
and [FastMCP](https://github.com/PrefectHQ/fastmcp/security/advisories/GHSA-vv7q-7jx5-f767).
Docker documents the [shared host kernel](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/).

## Checks

- Fresh app and desktop builds use the committed default base arguments, with no
  base overrides. The model checksum and Docker build-context allowlist are unchanged.
- App health check passes; an HTTP request inside the container returns 200.
  Installed commands report Node 24.21.0, Claude Code 2.1.284, Bitwarden 2026.9.0,
  Docker 29.7.2 and Compose 5.5.0. The selected Docker client queries the host daemon;
  Compose parses a minimal project successfully.
- On the exact final desktop image, all four supervisor services remain running:
  XFCE/VNC, computer-server, cua-driver-mcp and noVNC. noVNC returns HTTP 200.
  Computer-server `/cmd` successfully handles keyboard shortcuts, text entry,
  Enter and screenshots. Camoufox renders the entered local HTML page; the final
  screenshot was visually inspected. The Python dependency consistency check passes.
- The existing `bot-dot/desktop:latest` image was not replaced or removed.

## Scan evidence

Trivy `0.74.0` is pinned by image digest
`sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969`.
The scan includes OS and language packages, filters reporting to CRITICAL, and
uses `--exit-code 1` without ignoring unfixed vulnerabilities. A fresh database
setup exceeded the default five-minute timeout while downloading the Java DB;
subsequent scans use `--timeout 15m`.

Final local image IDs and results:

| Image | Image ID | Critical findings | Exit status |
| --- | --- | --- | --- |
| App | `sha256:ac4ca79d126510b211ce8e69ff91a32d718d8b7c57a2b64be0bf2f4b5c8a5322` | 0 | 0 |
| Desktop | `sha256:47b83aeb3b76644691778d38217a29cf6b887f94343f8f85e6833a08d5a61ba1` | 0 | 0 |

Raw local evidence is retained under `/tmp/issue96-scans/` (`app-fixed.json` and
`desktop-pinned-fixed.json`), build logs under `/tmp/issue96-*-build.log`, and the
rendered desktop screenshot at `/tmp/issue96-pinned-smoke.png`. These temporary
files are not release artifacts; release CI must retain its own SBOM and scan
reports for each published platform digest. Signed publication, amd64 execution
and an installed-release update remain separate acceptance requirements.

## Fresh two-platform scans, revision f00e452

[Self-hosted workflow 36589456967](https://github.com/Kordal/bot-dot/actions/runs/36589456967)
built and scanned both images on both architectures. All four SBOM generation
and critical-vulnerability gates passed; server, real-UID and secret checks
also passed. The app amd64 job passed the deliberately vulnerable/clean scanner
fixtures. No critical advisory exclusion was added.

| Image | Architecture | Scanned immutable digest | Critical findings | SBOM components |
| --- | --- | --- | --- | --- |
| bot-dot | amd64 | `sha256:c696086f422aa4c1bb7ac8124a24f926c04b4032d842128016bfb76ceaf9587a` | 0 | 1014 |
| bot-dot | arm64 | `sha256:f6c7b87e9ee5edce10565681ff11ebeca250251f1d39548573c1fccc5d7ee361` | 0 | 1008 |
| bot-dot-desktop | amd64 | `sha256:4e7cc2080c2b5a8c66f38abf8da08055c915cbb78d73947386e23fadcab48b7d` | 0 | 1400 |
| bot-dot-desktop | arm64 | `sha256:89e526588d110776d9aff68dd8c6e8647be577a4d91ceaa856556b021d040885` | 0 | 1396 |

Every mandatory artifact upload failed with GitHub's artifact-storage-quota
error, so index publication and signing were correctly skipped. An authenticated
inventory at approximately 15:38 UTC found zero Actions artifacts across all 54
accessible repositories owned by Kordal, including bot-dot. GitHub's error says
usage is recalculated every 6–12 hours; no further deletion is justified by this
inventory, and the next successful upload time is not known.

The runner's four evidence directories were copied locally and validated for the
exact image, revision, workflow run, attempt and architecture. Each includes a
CycloneDX SBOM, zero-critical vulnerability report and release-input record.
Logs, workflow metadata and SHA-256 checksums are retained under
`~/Backups/security-acceptance/2026-09-29/image-run-36589456967/`.
These local copies preserve evidence; they do not substitute for authenticated
workflow artifact transfer into the signing job.

Issue 96 remains open. This run is superseded by the upgrade audit/readiness fix in `866eb61`; do not
rerun it for publication. Use the newer run described below. Rerunning only
failed jobs would mix attempts and must remain rejected. Then verify both signed index manifests and execute the
owner HTTP update against a disposable installation, checking the installed
immutable digests, preserved data and UID 60000 after restart. No production
upgrade, signed publication or rollback is claimed from this blocked run.

## Fixed upgrade revision 866eb61

[Run 36594383513](https://github.com/Kordal/bot-dot/actions/runs/36594383513)
passed all server/UID/secret checks and all four image builds, SBOM generation
and critical scans, with zero CRITICAL findings. Every mandatory SBOM upload
again failed with GitHub's storage-quota error; signing and publication were
skipped. All four exact-revision/run/attempt/platform evidence sets and workflow
logs are backed up and SHA-256 checksummed under
`~/Backups/security-acceptance/2026-09-29/image-run-36594383513/`.

This revision fixes a root-owned audit-log defect in the first update to the
non-root server and corrects owner-key health readiness. The actual legacy
updater shell passed in an isolated daemon with synthetic state and a private
install directory. See [transition acceptance](security-nonroot-acceptance.md#upgrade-audit-follow-up).
It does not constitute production signed-image installation.

That attempt used mandatory Actions artifact uploads. It cannot be resumed
under the release-evidence transport described below: a fresh workflow run must
build and scan all four platform images from the new revision. Verify signed
publication and an isolated signed-image upgrade before closing issue 96. Do
not publish the superseded `f00e452` revision.

## Superseded storage preflight

The Images workflow previously uploaded a tiny, one-day-retention probe on a
local runner before starting server tests and image builds. GitHub rejected it
even after all 54 accessible repositories reported zero stored Actions
artifacts. This preflight is historical; the current workflow does not use
Actions artifact storage for release evidence.

## Quota-independent release evidence transport

The Images workflow now retains each pushed-digest scan on the local runner
share. After all four builds and zero-critical scans pass, a separate job
validates their image names, platform digests, commit, run ID and attempt. It
publishes the four CycloneDX SBOMs, four vulnerability reports and four release
input records as checksummed assets of an `image-evidence-<run>-<attempt>`
GitHub Release. A manifest lists every asset's SHA-256. Its own SHA-256 passes
as a same-run job output to the protected signing jobs. Each signer downloads
only its two platforms' evidence, verifies the manifest and every downloaded
file against that output, then forms and signs the index from the validated
digests. The evidence is a visible prerelease once scans pass; its notes direct
readers to the workflow run for the separate signing result.

This moves the authenticated evidence handoff from Actions artifacts to GitHub
Release assets. It does not relax the critical-vulnerability gate, accept
local backups as publication inputs, or permit evidence from another workflow
attempt. The helper's public CLI regressions and a disposable draft release
upload/download of all 13 files (22,625,919 bytes) passed locally. That payload
was historical scan data used only to verify transport; a fresh run on the
revised workflow and the isolated signed-image upgrade remain required for
release acceptance. Run `36621522348` validated all four scans and published
the draft evidence, but the read-only signer token could not see a draft GitHub
Release (`release not found`). Both signers stopped before moving any tags. A
visible prerelease lets the signer retain read-only repository access.

## Publication toolchain prerequisite

[Run 36623277890](https://github.com/Kordal/bot-dot/actions/runs/36623277890)
passed all tests, four pushed-digest scans, release-evidence upload and both
read-only signer downloads. Its Linux runner retained distro Buildx 0.30.1.
Index creation failed with `unknown flag: --metadata-file`, before tags moved
or signing started. The 13 evidence assets remain published and have a verified
local backup under
`~/Backups/security-acceptance/2026-09-29/image-evidence-run-36623277890/`.

Images now pins Buildx v0.32.0 on every build and signing runner. An initial
toolchain job checks `imagetools create --metadata-file` support before tests
or image builds, and each signing runner repeats the capability check. Docker
[added that flag in v0.32.0](https://github.com/docker/buildx/releases/tag/v0.32.0).
The helper still consumes the created index's immutable descriptor; it does
not rediscover a digest through a mutable tag.

## Signed publication, revision 3b64714

[Run 36625499597](https://github.com/Kordal/bot-dot/actions/runs/36625499597)
passed the pinned-toolchain preflight, 332 server tests (16 environment skips),
all 30 real-UID boundary tests, the 232-commit Gitleaks history scan, all four
builds and zero-critical scan gates, evidence publication and both protected
signing jobs. The scanner fixtures also passed.

| Image | Architecture | Scanned immutable digest | Critical findings | SBOM components |
| --- | --- | --- | --- | --- |
| bot-dot | amd64 | `sha256:a976c3e1a18cf09d50a78c165540822cd54010432b7ba5127930e8687801bd68` | 0 | 1014 |
| bot-dot | arm64 | `sha256:7a7546ae67935555f7f1588f7b540c8b6c4f42243555dcd1662be463aee3054e` | 0 | 1008 |
| bot-dot-desktop | amd64 | `sha256:549e8c7d0afb30fc7612f4d3ca71f26ed37ce40b0ea8c15ad6e5780fef6a29f6` | 0 | 1400 |
| bot-dot-desktop | arm64 | `sha256:61d990abbdd167ae0d60db8d404617af11641a4358e4d46b29c324aaa034c659` | 0 | 1396 |

The [13 release evidence assets](https://github.com/Kordal/bot-dot/releases/tag/image-evidence-36625499597-1)
were independently downloaded and verified against the same-run manifest
checksum, `05f90012686bfac2cb786e19317a2e1fa3c9889b59f661b6ba4047e479f58fc9`.
Both signing jobs consumed only those exact platform digests. Release version
201 signs these immutable indexes at full revision
`3b647143d5a020f9b943cd5a046964d20fdae0fa`:

- Server: `ghcr.io/kordal/bot-dot@sha256:449ae2621f5742214ca73323b7f3c1682d6dd37935c9c107b1a3be2dcb04b917`
- Desktop: `ghcr.io/kordal/bot-dot-desktop@sha256:871abed4802b6330adfc30abc9ea282b428f7439539fb6aa2c128f5d9810b5d3`

The signer-produced manifests also pass an independent production-key
verification. Raw assets, manifests, workflow metadata and logs are backed up
under
`~/Backups/security-acceptance/2026-09-29/image-evidence-run-36625499597/`.
An authenticated registry readback also confirms that each signed index contains
exactly its two same-attempt scanned platform digests. Those index manifests are
retained in the backup.

## Isolated signed-image upgrade

[Acceptance run 36627061472](https://github.com/Kordal/bot-dot/actions/runs/36627061472)
passed on the local Mac runner. The fixture reconstructs the legacy HTTP updater
from source revision `3fbb904` in a small bootstrap image, then installs the actual
signed release 201 server and desktop images through the owner HTTP endpoints.
Its installation, registry login, synthetic state and Compose volumes live in
a disposable nested Docker daemon with no host Docker socket or published ports.

The probe verifies both GHCR release manifests with the production key before
starting. HTTP check/apply returns 200/202; the server restarts at full revision
`3b647143d5a020f9b943cd5a046964d20fdae0fa`. Server and Docker helper both run the
signed server index digest, the signed desktop digest is installed, and both
image references in the installation's environment file are pinned. The server
becomes healthy. Synthetic bot metadata and markers in data, home and config
survive. Its server process runs as UID 60000; `update.applied` is recorded in a
UID-60000, mode-0600 audit log. Only the helper has the Docker socket and registry
token. A second HTTP update check reports no error, the exact signed digest and
no available update.

The probe removes its daemon, anonymous Docker volume, bootstrap image and
temporary source/config files. Cleanup was independently confirmed. Logs and
workflow metadata are checksummed under
`~/Backups/security-acceptance/2026-09-29/signed-image-upgrade-run-36627061472/`.
This installation acceptance ran Linux/arm64; both amd64 and arm64 images were
built and scanned in the publication workflow. Issue 96's signing and update
acceptance is complete. The broader issue 9 gate still requires credential
scanning of the exact image layers and final repository/release policy review.
