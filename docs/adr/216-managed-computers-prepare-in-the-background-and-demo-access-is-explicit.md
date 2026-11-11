# ADR 216: Managed computers prepare in the background and demo access is explicit

- Status: Accepted (2026-11-11, owner's provisioning request)
- Task: [#1268](https://github.com/Kordal/bot-dot/issues/1268)

## Context

A managed install currently waits for an optional computer image of about 7 GB. Re-running the installer after any failure repeats work. A selected release should be installed directly. App reviewers also need repeatable access to a dedicated machine with fictional data, without changing normal customer authentication.

## Decision

A managed account receives the checked server image from the machine's Docker by save/load. Both commands must succeed. Its signed computer digest is placed in a root-owned durable queue. A separate worker, lock and systemd timer download computers after the application is ready; transient failures keep the pending task, permanent failures keep a blocked task for explicit retry, and both write `front-door/status/computer-preparation.json`. Root's normal request lock is never held by that download. A machine without systemd starts a detached worker, as it already starts its request loop. Ordinary self-hosted installs retain their synchronous computer download.

Image pulls have a deadline and retry only transient transport errors, throttling or server errors. Signature, authentication and disk failures stop. First installs accept `BOT_DOT_INSTALL_TO` with the same signed-release and source checks used by a named update. `--prerequisites` stops before accounts and application images, for the hosting base-image builder. `BOT_DOT_IMAGE_BUILD=1` on that prerequisites-only path skips daemon-dependent checks inside the offline image chroot; a normal boot must validate the runtime before that image can be activated.

A review demo is a separate managed one-account machine, explicitly enabled with `BOT_DOT_DEMO_CODE_SHA256` at its first install. The front door receives only that hash, creates its demo account and accepts the reusable random code through the existing sign-in route. Normal machines never offer this path. Sign-in rate limits, access blocks, suspension, agreement requirements and native app hand-off still apply. The console seals the code and reveals it only after an operator passkey. Changing or removing the hash and restarting the front door revokes code access; existing sessions must also be ended when revoking all access.

The installer seeds a fictional project and tasks through the demo account API. It does not connect real mailboxes, calendars or other external accounts, and a retry keeps the existing project and reviewer edits. An old image without demo support is refused explicitly. The optional worker's status is a fixed machine-status file for the hosting agent, with no customer content.

## Alternatives

More whole-installer retries delay permanent failures. Requiring reviewers to consume a single-use registration link does not support repeat visits. Enabling code login on customer machines, or a universal review password in the application, would widen access beyond the dedicated demo.

## Consequences

Application readiness and computer readiness differ. Computer downloads recover after reboot with systemd; without systemd a failed worker needs another install or manual worker start. Demo data is shared by reviewers and is disposable. Demo access needs a release containing this change and the hosting orchestration from Kordal/botdot-hosting#100. No deployment or real Google review is implied by local tests.
