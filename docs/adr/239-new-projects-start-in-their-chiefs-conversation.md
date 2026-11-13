# ADR-239: New projects start in their Chief's conversation

- **Status:** Accepted (2026-11-13, the owner approved the five-PR simplification and asked to implement PR 4)
- **Owning task:** [#1331](https://github.com/Kordal/bot-dot/issues/1331), spec [#1327](https://github.com/Kordal/bot-dot/issues/1327)
- **Changes:** Mandatory setup screens of ADR 226 for new projects on apps with `project-conversation`. Retains the proposal review and grants of ADR 128, the project chat of ADR 217 and the primary conversation of ADR 235. Legacy setup remains supported.

## Context

The owner should describe an outcome and continue talking to the Chief, without completing a wizard of questions, stories, SWOT, Board design and team configuration. Replacing the review cards with a conversational yes would also remove the explicit boundary around access, logins and recurring work.

## Decision

- A negotiated creation request stores its description, optional sources and retry key on a project marked `conversation`, and opens its existing project Chief chat. A retry uses that same project and first message. The chat stores follow-up answers and files as ordinary messages, so reopening it continues the conversation.
- The Chief asks only what changes the next action and proposes one concrete first step with the smallest useful team. Its project brief explicitly removes mandatory wizard steps. This is model guidance, not a claim that every model response will follow it.
- While this project is in setup, calls from its Chief chat may read and stage a first-step proposal, but cannot create bots, run work, add schedules, share logins or change other account data. The existing `set_company_team` tool stages the proposal through the scoped teams route; it does not grant anything. Login and SSH needs are matched by the server by name, never accepted from model-supplied ids. Copy ids and already-created bot ids from a model proposal are discarded.
- Review first step opens the existing team cards, with the concrete first step shown above them. Editing is optional. Approve first step is the owner's approval of the shown team, access and recurring work, as Create was in ADR 128. It includes the server's review token; a changed proposal or rules refuse a stale approval. Pending edits disable approval. Once approved, a partial start can be retried but its proposal cannot be changed underneath it.
- Approval creates the reviewed bots and schedules using the existing owner-only start path, then tells the same Chief chat to carry out only the reviewed first step. Existing external-action and login approvals still apply. This system turn is never presented as a typed owner message.
- Apps without the feature keep the wizard. Existing projects and unfinished legacy setup are neither migrated nor marked conversational. The web and Android use the same API and review boundary.

## Alternatives

- Merely hide wizard screens: leaves separate setup helpers responsible for a conversation they cannot remember.
- Create the team immediately from the description: grants access before the owner has seen the proposal.
- Add a second chat or a new execution engine for setup: duplicates history and approval handling already provided by the Chief.

## Consequences

The description and settled answers live with the project and its Chief. Failed creation requests retain text and source selections in the apps; accepted requests remain resumable from the server. An upload that did not finish must be retried or removed, never silently omitted. The old wizard remains for compatibility. Consolidated project updates remain #1332.
