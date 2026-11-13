# ADR-240: Project updates use recorded work in the primary conversation

- **Status:** Accepted (2026-11-13, the approved Projects simplification)
- **Owning task:** [#1332](https://github.com/Kordal/bot-dot/issues/1332), spec [#1327](https://github.com/Kordal/bot-dot/issues/1327)
- **Changes:** The automatic reporting portions of ADR 117 and ADR 118; preserves approved plan work, legacy settings and history.

## Context

The morning standup, each team's report and each new lead's report-preference question overlap. Even with a selected Project Manager, reports land in several chats. A report-generating turn can itself coordinate work, and a summary can accidentally hide an unanswered question by becoming the newest reply.

## Decision

- One project update preference replaces the overlapping report controls on web and Android, negotiated with `project-updates`. New conversational projects default to daily; saved projects combine the union of their existing standup and opted-in team report times until the owner chooses a replacement. Equal due times coalesce. Existing histories and independent bot jobs remain intact. Old-client writes restore that saved-schedules mode. Startup removes queued legacy report-preference interviews and turns queued report work into one pending consolidated update, preserving approved plan and owner work. Off cancels that pending delivery.
- Automatic delivery waits through quiet hours and a busy Chief chat, catches up with only the latest slot within seven days, and persists its cursor. A stable delivery key prevents duplicates across retries and restart. Failures retain their cursor and are visible in settings until a delivery succeeds.
- The server composes a bounded snapshot from the same recorded facts as the fixed overview, plus checked-off items, decisions, current Needs you cards and saved team reports. It names missing reports and includes current goal figures and objective-source failures, even when their original notice went to the Chief. Left-out chat text is not copied; protected questions are named without quoting them. Replies remain replies; no completion is inferred from a success status or from a bot's claim.
- The update goes to the currently selected manager's own chat, or the project's own Chief chat when no manager survives. It is a server-written message with no model turn, tools or team coordination. It cannot approve an action, answer a question or create a reporting loop; later snapshots omit update messages themselves. Server updates are owner-visible receipts, excluded from model chat history and the Chief's digest/notice injection so a later forget cannot be undone by an older copied summary.
- An update counts as a new reply, but does not replace the latest substantive reply for open-question or failure-state purposes. Web and Android leave the Chief's preceding unanswered buttons visible too.
- The existing Chief standup tool also sets the consolidated rhythm, so chat needs no new tool or UI control. Explicit Run now posts recorded facts; it does not reintroduce the old standup engine.

## Alternatives

- Keep the morning standup and add another report: retains the duplication this ticket removes.
- Start every lead and ask the manager to merge their replies: starts autonomous coordination merely to report, and can wait behind approvals or produce report loops.
- Silently replace all saved schedules with a default: discards an owner's opted-in rhythm.

## Consequences

Updates are predictable and based on recorded evidence. They do not verify a file's contents or infer what a bot has not recorded, and they say when a report is missing. The owner can ask the primary contact for investigation or further work in that conversation. Old standup history remains readable, while automatic report generation has one delivery path.
