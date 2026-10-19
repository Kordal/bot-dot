# ADR-013: A change to an approved job or tile waits beside it

- **Status:** Accepted
- **Owning task:** SURE-002

## Context

[Milestone 8](../product/milestone8.md). A job has one definition (`lib/jobs.js`, `normalizeJob`). When a bot or the Chief changes what an approved job does, the job is written over in place with `approved: false`, and the scheduler runs only a job that is `enabled && approved`. So a proposed change stops a job the owner approved, its card says "Wants to add a job", and the owner's Decline removes the whole job (`server.js`, the route `POST /api/bots/:id/jobs/:jobId/approve`). A Board tile whose script changed behaves the same (`lib/dashboard.js`).

On 2026-10-06 the owner approved, on the prototype: a changed job keeps running as approved until they answer, its card says it is a change and shows what changes, and its no reads "Keep as it is" and keeps the job.

n8n and Zapier keep the published version running while an edit is a draft, and deleting the draft leaves the published version as it was ([research note](../archive/product/milestone8-research.md), section 1).

## Decision

- **An approved job keeps its approved definition.** A change that needs the owner's OK does not replace it: it is stored beside it, as the whole proposed definition with who proposed it and when.
- **The scheduler, "Run now" and the Chief's `run_job` read the approved definition only.** A waiting change never runs.
- **A yes puts the change in the approved one's place. A no drops the change and nothing else.** The route that answers a job stays the one it is; on a job with a change waiting, `approve: false` keeps the job and answers that it was kept.
- **One change waits per job.** A second change replaces the first; the card compares the newest with the approved one.
- **The owner's own edit is approved at once, as today, and drops a waiting change.**
- **A job that was never approved is as today.** It has no approved definition to keep: it waits, and its Decline removes it.
- **What asks again is unchanged** (`substance`, `autoApproved`, `alwaysApprove`).
- **The same for a Board tile** whose scripts changed: the approved tile keeps reading and acting until the answer.

Resolved by SURE-002:

- **The names are those of the plan's contract**, written in `docs/api.md`, "A change that waits": `change`, `no`, `yes`, `kept`, the features `staged-changes` and `proposal-carries-on`.
- **A job's change is what the approval covers.** The fields that `substance` compares, the ones that ask again (`kind`, `script`, `prompt`, `cron`, `at`, `aiWhen`, `notify`), and the name, time limit and assessment sent in the same edit: until the answer the job is as approved in all of them. It is kept on the job as `change: { job, by, at }`, with `chatId` or `runId` (below). The route hands it out as the contract has it, with the schedule in words; since the contract's `at` is when it was proposed, the one-time moment of the job as proposed is `once`.
- **An edit that needs no OK is made at once and reaches both definitions.** A new name, time limit or assessment is written on the approved job and on the waiting change, so that the yes does not take it back. On or off is no part of a change and is the job's alone: the Chief can pause a job whose change waits. This holds for the owner's edit of those fields too.
- **The owner's edit drops a waiting change when it changes what the job does.** Their version is then the approved one. Any edit that is approved at once and changes what the job does drops it the same way (the Chief's of an AI job, one of a job that is always approved): the change was proposed against a definition that is gone. Saving the job without touching its definition, and what botdot saves in the owner's name (a one-time job removed as it starts), leaves the change waiting.
- **A second change is laid over the approved job, not over the first change.** The route builds an edit from the job as it is handed out, which is the approved one. A proposer that wants both of two changes sends both.
- **The same change asked for again** waits as it did, since when it did.
- **A tile's change is the whole tile as proposed**, `change: { tile, by, at }`. A tile's sources, blocks and kind are checked together, so they wait together. Its yes puts the proposed tile where the tile sits now (its heading and its group), since the owner may have moved it meanwhile. An edit that changes no script is made at once and reaches the waiting change too, as a job's does; where it does not fit the tile as proposed, the change waits as it was. The owner's change of a script is approved and drops it.
- **An approved tile with a change is in two places of `GET /api/dashboard`:** in `tiles`, where it is drawn and works on, and in `pending`, in full with its approved `scripts`, where the card is drawn from. Both have `change`.
- **Where it was asked for travels with the change** ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md)): the Chief's chat as `chatId`, counted from the change's `at`, and the bot's run as `runId`. The Chief is told in that chat of the yes and of the no, in words of their own ("the change to the script “Disk check” of Disk Keeper").
- **The no removes only what was never approved.** `approve: false` on an approved job or tile keeps it, with a change beside it or without: before, the no of a card that was out of date removed an approved job. So "Keep as it is" can never remove, whatever happened to the change meanwhile.
- **A script's change is approved on its card** (`yesOn: "card"`), also where it turns an AI job into a script job, and its yes and its no are in the audit log as `job.approved` and `job.declined`, `tile.approved` and `tile.declined`.
- **An app that does not know `change`** finds waiting jobs by `approved: false` and sees an approved job, running: it draws no card for the change. The feed's `approvals.jobs` has the entry, so its notification comes, with the server's words where the app reads them; its Approve approves the change and its Decline keeps the job. Such an app draws a tile's change from `pending` as a new tile: its Approve approves the change, and its Decline removes nothing.
- **Jobs and tiles saved before this decision** that were approved once and wait again have no approved definition left: they wait whole, as a job never approved, and their no removes them.

A bot carries on after the yes on its own proposal ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md), resolved by this task under its rules):

- **What a bot proposes in a run keeps that run**: a job it adds (`runId`, `askedAt`), a change to its job (`runId` in the change), a tile it suggests (`runId` on the suggestion), and a change to its instructions (the ask's `runs`, as a permission has them). The API sends none of them.
- **The yes is answered as an ask's is** (`carryOnAfter`, `whatCarriesOn`): one new run with the request, the bot's reply and what was approved; not after 24 hours, not once the owner sent the bot a message after the proposal, and once for a run that waits for several answers.
- **Only a request of the owner or of a teammate carries on.** A job's run is not repeated for a proposal it made: it would propose again. A run the Chief started is not handed back to the Chief: the Chief has no turn for a bot's own proposal, and the scope leaves the Chief's carry-on as it is.

## Alternatives

- **Keep one definition and run the last approved one from the bot's history.** The history of instructions exists; jobs have none, and it would have to be built for this.
- **Let the change apply at once and only the risky step ask again**, as OpenClaw does for a changed script. It changes which edits ask, which the scope leaves as it is.

## Consequences

- A job has two definitions while a change waits, and one field decides which runs: nothing reads `change` but the card and the yes.
- The no of a job or tile that is approved removes nothing any more. Whoever wants an approved job gone removes it.
- A proposer cannot take a change back: the owner's "Keep as it is", their own edit, or the job's removal ends it. Editing a change that waits is out of scope.
- The yes approves the change as it is at that moment. A second change that replaces the first between the card being drawn and the tap is approved by a card that showed the first; the same holds, as before, for a job never approved that is changed again. Closing it needs the card to say which change it answers, a field the contract of this milestone does not have.
- A one-time job whose change waits runs at its approved time and is then removed, with the change.
- A bot that is started again after the yes on its job may add that job a second time: the run is told what was approved, and that it must not repeat what is done.
- The run that carries on after a proposal is told "the owner allowed you to: add the job …" in the words of a permission's carry-on; a wording of its own would need a second prompt.
