# Milestone 9 research: the memory audit, read again

Planning status: stage 6 closed on 2026-10-07; next: delivery, starting with MEM-001 or MEM-002.

Date: 2026-10-06. Revision inspected: `main` at `7a175c3` (`57336cb` plus the two planning commits of Milestone 8). `node scripts/agent-local.mjs phase` prints `delivering`: SURE-001 to SURE-005 of [Milestone 8](milestone8.md) are unfinished, SURE-001 and SURE-004 are claimed. Tests rerun: the store's tests (`test/memory.test.js` and `test/memory-semantic.test.js`: 37 pass, 1 skipped), and the audit's store claims were reproduced with node on a temporary database. No botdot server was started and no message was sent. This note is research evidence, not an implementation plan.

## Why this milestone

On 2026-10-06 the owner handed over [the memory audit](improvements/2026-10-06-memory-audit.md) and asked for a plan that takes in every point of it. The audit read `main` after [Milestone 5](milestone5.md). Since then [Milestone 6](milestone6.md), [Milestone 7](milestone7.md) and the feature "A bot remembers its chat" (CHAT-001) were merged, and Milestone 8 is being delivered. So every claim was read again first.

## What the product delivers today

A bot keeps notes because it called `remember`, the Chief because it called `remember_shared`, the owner because they typed one. Pinned notes are in every prompt, a word lookup adds a few more, `recall` and `read_run` fetch on demand, and a weekly review tidies the notes. Since CHAT-001 a bot is also handed its chat as the owner saw it.

Each claim below is one the audit made. Each was looked up again at `7a175c3` on 2026-10-06 by three readers (the store and retrieval; a bot's run and what a bot may write; the Chief, the routes, the apps and the documents), each given the audit's claim and told to refute it. "(E)" marks what was also reproduced on a temporary database. All hold unless the table says otherwise.

### Forgetting (audit finding 1)

| Area | Verified at `7a175c3` |
| --- | --- |
| A deleted note | `removeNote` copies it into `note_versions`; nothing ever deletes from that table; `recall` with `history: true` returns it (`lib/memory.js:235-245`, `189-195`, `494-498`). `prune` drops runs only, after 365 days (`:455-462`). (E) |
| The forget re-indexes | The server writes the forgotten text into the forgetting run's `learned` record (`server.js:1444`), which is indexed above the reply's weight (`lib/memory.js:327`, `349`, `504`), returned by `read_run` and printed in the review (`lib/bots.js:2291`). (E) |
| Who honours "Don't recall" | `rank` (recall, the lookup, the Chief's search), the review, the bot's `read_run`, the embeddings, and since CHAT-001 the conversation block. **Not:** the Chief's `get_run`, `list_runs`, `wait_for_run` and the look's digest (`server.js:857-860`, `1804-1841`; `lib/bots.js:518-525`; `lib/look.js:89-110`) |
| A deleted bot | Its notes go without a version. Left: its `note_versions` with their search rows, its `pending` rows, its runs in the index (`forgetRunsOfBot` has no caller outside tests), run files, workspace, Claude home (`lib/bots.js:358-371`, `lib/memory.js:263`). (E) |
| **New since the audit** | Two more files keep text a forget must reach: `chief-waiting-turns.json` (waiting turns, bot replies, the owner's queued messages, Milestone 7) and `looks.json` (unasked messages and the owner's answers, kept after a chat is deleted) |
| The README | Promises the opposite of a purge: "Deleted notes are kept too." (`README.md:123`) |

### Pins and who said it (findings 2 and 3)

| Area | Verified at `7a175c3` |
| --- | --- |
| Eviction | A full pinned set (30 notes / 5,000 characters) unpins by `COALESCE(used_at, updated_at)`, oldest first (`lib/memory.js:150`). The 31st note unpinned "Use pnpm." (E) |
| **Narrower than the audit** | A note the owner typed in an app is pin-locked and exempt (`server.js:834`, `888`). Eviction hits what a bot or the Chief saved: which is everything the owner said in chat |
| **Corrected** | `recall` does return and touch pinned notes; it is the lookup that drops them and touches nothing (`:570`) |
| Duplicates | `lower(text) = lower(?)` per owner after the spaces are collapsed (`:168`). "Use pnpm" and "Use pnpm." are two notes; so are "Mieszka w Łodzi" and "mieszka w łodzi". (E) |
| A pinned line | `- [id] (topic) text`, by `created_at`: no date, no author (`:275`) |
| Who wrote it | `by` is the last writer (`bot`, `bot:<id>`, the owner). Nothing stores who stated the fact. The Chief's deletes carry no author (`lib/learning.js:37`) and its edits no reason |
| Note ids | Six hex characters, one primary key for all owners, no retry: a collision is a raw database error (`:179`). (E) |
| The schema | `CREATE TABLE IF NOT EXISTS` only; no `ALTER TABLE` anywhere. A new column would be the first |

### The lookup and recall (findings 4 and 10)

| Area | Verified at `7a175c3` |
| --- | --- |
| The query | The first 12 distinct non-filler words, OR-ed, prefix match from three letters, the porter (English) tokenizer (`lib/memory.js:77-82`). "Warszawie" misses "Warszawa". (E) |
| No floor | Everything within half of the best score is kept, 5 items / 1,500 characters (`:567-583`). One shared word ("blue") injects a note. (E) |
| No meaning search | The lookup passes an empty map: embeddings are never used, also when on |
| Exclusions after the cut | Only "Don't recall" is in SQL. Pinned notes, the current run and the job's own runs are dropped in JavaScript after the cut to 20: 25 matching pinned notes hide a matching unpinned one, 30 runs of one job hide a matching chat run. (E) |
| `recall` | 8 results, no offset, no total; the route takes a limit up to 25, the tool sends none (`lib/self-mcp.js:66-77`, `server.js:1387-1389`). An empty query reads at most 20 of each kind. (E) |
| Scale | `indexRun` deletes from the search tables on every run, also a new one: a full scan. 0.2 ms empty, 4.6 ms at 10,000 runs, 10.9 ms at 20,000. Linear and small today. (E) |
| Already there | A run keeps which notes it was given (`meta.relevant`, `lib/bots.js:1220`): the record the audit's phase 6 asks for exists for the lookup |

### Side doors (finding 5)

| Area | Verified at `7a175c3` |
| --- | --- |
| The command line | A bot's whole appended prompt is one `--append-system-prompt` argument (`lib/bots.js:876`); the Chief's too, on every resumed turn (`lib/chief.js:563`, `1166`). The MCP config already goes through a private file (`lib/bots.js:931`) |
| **Worse than the audit** | The conversation block of CHAT-001 can be about 36,500 characters (about 58,000 with a tapped answer). With the uncapped main assignment and rules, one argument can pass Linux's limit of 128 KiB for a single argument (inferred, not run) |
| Claude Code's own memory | `runAs` sets `HOME`, `USER`, `LOGNAME` and the token only (`lib/identity.js:118-148`). A bot run has no `--strict-mcp-config` and no `--setting-sources`; the Chief has strict |
| The flag | The Docker image pins Claude Code 2.1.284 (`Dockerfile:52`). `--append-system-prompt-file` is in the CLI reference and in the help of 2.1.292; it was not run on 2.1.284. An install without Docker uses whatever `claude` it finds |
| Unescaped text | **Changed in part:** the conversation block neutralises its own tag and forged `[run …]` lines, not other tags. `<memory>`, `<shared-memory>`, `<possibly-relevant>`, the topic lists and the review's `<your-notes>` and `<recent-runs>` print raw (`lib/memory.js:275`, `lib/bots.js:1211-1253`, `2287-2307`) |

### Guards (finding 6)

| Area | Verified at `7a175c3` |
| --- | --- |
| A bot's writes | The owner's OK is needed for one case: a shared note, after the run read outside content (`server.js:1419`). A private note goes straight in, pinned (`:1428`); the skill route has no such check (`:1457`). Any bot may edit or remove any shared note, pin-locked or not (`:1432-1445`) |
| The outside flag | Set by WebFetch, WebSearch, Bash, the computer, connected apps and the Vault's API request, by a script hand-over, a job that reads outside, a teammate chain (`lib/bots.js:970`, `2348`). **Not** by Read, attachments, a teammate's note, `recall` or `read_run` |
| **New since the audit** | A run that carries on after an OK (Milestone 6) starts with the flag off, though the run it continues may have read the web, and is handed up to 4,000 characters of that run's reply (`lib/bots.js:721`, `778-786`) |
| The Chief's writes | No gate at all (`server.js:886-893`). **Wider than the audit:** a Chief turn does not record who started it. Every chat turn gets all 44 tools: the owner's message, a late result with the bot's reply quoted (Milestone 7), an answer to a card, a tool request. **Refuted:** the look cannot write; but its unasked message is quoted into the owner's next turn |
| Who started a bot's run | The run has no positive mark for the owner: `trigger: 'manual'` and nothing else. `startedBy: 'chief'`, `fromBot`, `jobId`, `continues` mark the others. `sender()` in `lib/chat-history.js:22-29` derives "the owner" for the conversation block; the memory route uses none of it. `isMessage` is true for Chief-started, follow-up and carry-on runs (`lib/bots.js:818`), and a Chief-started run is told "The owner has sent you a message." (`:829`) |
| The review | Sunday 03:30 after three runs, Opus, memory tools only. Its prompt lists every note with no date and no author, uncapped (up to about 445,000 characters at the cap of 1,000 notes). Its writes read like any bot's. Shared changes always become cards; private notes and skills go straight in |
| Audit log | 16 actions, none about memory (`lib/audit.js:5-6`) |

### The conversation block (finding 7): delivered

CHAT-001 replaced it (`lib/chat-history.js`). It names who asked each exchange, skips runs marked "Don't recall", quiet runs, scripts and the review, and takes the newest four exchanges the owner started plus two anyone else started, within seven days. Every part of finding 7 and of its quick win is done. Left from finding 5: other tags inside it are not neutralised.

### The Chief (finding 8)

| Area | Verified at `7a175c3` |
| --- | --- |
| Its tools | `recall`, `memory_status` (counts), `set_memory_settings`, `download_search_model`, `review_memory`, `remember_shared`, `update_shared`, `forget_shared`, `get_run` (`lib/mcp-server.js:373-482`). A note's owner must be `_shared` or a bot; no note route is open to the Chief |
| Its chip | "Remembered for all bots: " plus the model's own `note`, also for a duplicate and for an unchanged edit (`lib/chief.js:452-453`). A bot's chip is built from the store's answer and skipped on a duplicate (`server.js:1429`) |
| Its prompt | Pinned shared memory is sent again on every resumed turn (`lib/chief.js:185-192`, `578`); 44 tools, about 19,200 tokens of schemas |

### Jobs (finding 9)

A job's run gets no conversation block (`lib/bots.js:818-822`), the lookup drops the job's own runs (`lib/memory.js:570`), and a quiet run is indexed from its emptied `result`, not its `rawResult` (`lib/reporting.js:35-44`, `lib/memory.js:325`). Holds. SURE-001 of Milestone 8 changes the same functions: a scheduled run that asks a question stops being quiet.

### The instructions

`learningNote` and the tools' descriptions both state the save rule, the shared scope, pinning and note-versus-skill (`lib/bots.js:1254-1274`, `lib/self-mcp.js:158-203`). No fixed text gives today's date or the time zone. The rule to save: "the owner corrects you or states a preference; you made a mistake and found its cause; or you found a non-obvious fact about your job". Not to save: "one-off results or secrets". "Where they live" is listed as a shared example. Nothing covers decisions, maybes or temporary states.

### The apps and the documents (audit section 14)

| Control | Web page | Android |
| --- | --- | --- |
| Add a note | Yes, with a topic | Yes, no topic; shows an error though the note was saved (`data/Api.kt:326-327`) |
| Edit its text | No | Yes |
| Delete | Yes, no question | Yes |
| Restore, history | Yes | No; the toast points to the web page |
| Pin | Yes | Yes |
| Search | Notes, earlier versions, runs | Notes and runs; an earlier version shows as an empty row |
| "Don't recall" on a run | From a search hit only, no undo | No |
| A waiting shared change | Card, dialog, "Approve all" | Card, notification, "Approve all" |
| Review schedule, model download, retention | In Settings | Not shown |

- `docs/api.md` documents 2 of the 18 routes under `/api/memory`; the bots' three routes are named as a family; the learning routes and a run's `learned` are not written down. The server announces one feature, `memory`.
- The card of a waiting shared change is worded in each app: the server sends the note's text only. Android's yes reads "Forget it" for a removal on the card and "Approve" in the notification.
- `CONTEXT.md` defines no memory term. `SECURITY.md` never names memory or `memory.db`; it says a bot with shell access "can do what you can" without separate users. **Weaker than the audit said:** a bot with Read only is not covered.

### The tests

| File | Covers | Runs in |
| --- | --- | --- |
| `test/memory.test.js` (24) | The store: scope, duplicates, versions, pins, the cap, the lookup, prune | `npm test` |
| `test/memory-api.test.js` (18) | The routes and both MCP servers against a stand-in for Claude | `npm test` |
| `test/memory-semantic.test.js` (13) | Meaning search with a stub embedder | `npm test` |
| `test/chat-history.test.js` (13) | The conversation block | `npm test` |
| `test/live/memory-conversations.test.js` | 7 scenarios, 3 repeats, real Claude, graded on the answer | Opt-in |

No write-side eval exists: what a bot saved is counted in a report line and neither scored nor asserted. **New:** the live baseline is probably invalid (read, not run). Its runs are aged by 5 days, which is inside the new 7-day conversation block, so a "fresh conversation" question now finds the taught fact in the block and no longer exercises recall.

## Evidence boundaries

- The store's behaviour was reproduced. Everything about a bot's run, the Chief, the routes and the apps was read and not exercised.
- What a bot chooses to save is a model's choice. The audit's live baseline (9 of 9 explicit facts saved; one correction saved as a second note) is its own report and was not repeated.
- `--append-system-prompt-file` on the pinned Claude Code 2.1.284, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, and what `--setting-sources` does to a cloned repository's `CLAUDE.md` are read from documentation, not run.
- The 128 KiB argument limit is inferred from the block sizes; no run was made to fail.
- The audit's sizes (17 to 20 days by the proposal, five to seven weeks by the delivery judge) are estimates.
- Milestone 8 changes `lib/bots.js`, `lib/reporting.js`, `lib/self-mcp.js` and `server.js` beside the memory code. Line numbers here are of `7a175c3` and move when it merges.
- Real use of Milestones 5 to 7 on the owner's server is still open, and nothing about the owner's own notes was read: how many are pinned, how often a set is full.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| A forgotten note stays in versions, in the run index and in the forgetting run; four of the Chief's readers ignore "Don't recall" (verified, E). | Two verbs. "No longer true" is a dated change. "Forget" erases the note, its versions, search rows, vectors and pending rows, and leaves the runs that wrote it out of everything a model reads. `learned` keeps an id, not text. Audit finding 1. |
| The oldest thing the owner said in chat leaves the prompt first, silently (verified, E). | The server records who said a fact (`source`: the owner, the bot, after outside content). What the owner said is never unpinned automatically. Finding 2. |
| Near-duplicates and contradictions stand side by side; a pinned line has no date and no author (verified, E). | Source and date on every line; a normalised duplicate key; similar notes returned as a hint on save. Finding 3. |
| The lookup is literal, has no floor and cuts before it excludes (verified, E). | Every meaningful word up to a cap, a floor of two matched words or one rare one, notes before runs, exclusions in SQL; meaning search for notes when it is on. Finding 4. |
| The prompt is on the command line and has grown; Claude Code's own memory is live; note text is printed raw (verified). | The prompt in a private file; auto memory off; strict MCP config; memory text neutralised when printed. Finding 5. |
| A private note or a skill after outside content goes straight in; any bot may rewrite the owner's shared notes; the Chief writes with full tools in turns it did not get from the owner; a carry-on forgets that its run read the web (verified). | `source` marks such notes and they never displace the owner's; the owner's notes change only in a run the owner started, else by a card; the Chief has no memory-writing tools in a turn botdot started; a turn and a run record who started them. Finding 6. |
| The conversation block is delivered (verified). | Only: neutralise other tags inside it. Finding 7. |
| The Chief can only remember for everyone (verified). | The Chief files a note for everyone, for itself or with a named bot, lists a bot's notes, and the chip says where it went, from the store's answer. Finding 8. |
| A job knows nothing of its last run; a quiet run is indexed empty (verified). | One capped block from the job's last run, the private reply included and indexed. Finding 9. |
| `recall` is a sample of 8 (verified, E). | Limit, offset and a total; an empty query pages every note. Finding 10. |
| The two apps differ in six controls; 16 of 18 routes are undocumented; the cards are worded per app (verified). | One list of controls for both apps; the memory routes in `docs/api.md`; the card's words from the server. Audit sections 14 and 17. |
| No write-side eval; the live baseline no longer exercises recall (verified, the second read only). | The live suite repaired first, then a baseline of what bots save, before any wording changes. Audit section 15 and phase 0. |
| The instructions say the save rule twice, give no date, and say nothing of decisions, maybes or temporary states (verified). | One wording, with today's date and the time zone, and the write rules of the audit's section 13. |
| A deleted bot leaves versions, pending rows and indexed runs; no memory action is audited (verified, E). | Bot deletion cleans them; approve, decline and erase are audit events. Audit phases 2 and 6. |

## Where the audit no longer matches the code

Eight things a plan would get wrong by trusting the audit as written:

1. **Finding 7 is done.** CHAT-001 delivered it, with its tests.
2. **The context table is stale.** The conversation block grew from about 1,600 tokens to about 9,000 at its cap. The command-line finding is more urgent for it, and the "context bound" test needs a new number.
3. **Eviction spares what the owner typed in an app.** The harm is to what the owner said in chat, which a bot saved.
4. **The Chief has no "who started this turn".** The audit's rule "no memory-writing tools in turns botdot starts" needs that fact first, and since Milestone 7 a late result is such a turn.
5. **A carry-on run** (Milestone 6) drops the outside flag. "Who said it" must follow the run it continues.
6. **Forget has two more places to reach:** the Chief's waiting turns and the look's file.
7. **Phase 0 cannot start with a baseline.** The live suite must first age its runs past the 7-day window.
8. **`SECURITY.md` says less than the audit quotes.** Writing memory into it is new text, not a correction.

## Carried forward

- Milestone 8 is in delivery. Its tasks change `startRun`, `finishReport`, `quietRun` and the bots' own routes. Milestone 9 starts from `main` after it merges; the claims above are read again at stage 6. Milestone 8 keeps shared-memory changes inside "Approve all".
- Milestone 7: real use (B23); its low findings under Follow-up of [milestone7-test.md](milestone7-test.md). One touches memory: a memory review still starts and fails while Claude is signed out.
- Milestones 3, 5 and 6: real use on the owner's server.
- [The interaction audit](improvements/2026-10-05-bot-interaction-audit.md): its groups 3 ("One voice") and 4 ("The Chief as helper"), and the rest of group 2, were named for Milestone 8 and not chosen. Its row "Settings panels (bot, jobs, memory): trim to what chat cannot do" meets the memory audit's decision 9.
- Browser tests run in no gate: the repository does not carry Playwright.
- Improvement reports: "Board" proposals 4 and 5 are marked later.
- Issues 269, 254 and 9 are not part of this.

## Proposed boundary for the discussion

The owner asked for every point of the audit. They fall into six groups, in the audit's own order of work:

1. **Measure first.** The live suite repaired, a write-side baseline, the memory routes written down, the lookup's fixtures.
2. **Close the side doors.** The prompt off the command line, Claude Code's own memory off, text neutralised, today's date, note-id retry, Android's add, the Chief's chip.
3. **Forget is real.** Erase, the "left out" rule in every reader, removed notes hidden and purged, bot deletion.
4. **Who said it.** `source`, eviction by it, dated and sourced lines, the duplicate key, the hint, the guards, the write rules.
5. **The right note arrives.** The lookup, recall with paging, a job's last run, meaning search in the lookup.
6. **The Chief files a note where it belongs,** and the two apps show the same controls.

Out, whatever is chosen, by the audit's own reasoning: an extraction model or a summariser; a project scope; note types, confidence, importance or expiry columns; a vector database or a reranking model; separate OS users on a Mac; anything that shows costs; the Mac app ([ADR 008](../adr/008-the-mac-app-is-no-longer-developed.md)).

Ten decisions the audit leaves to the owner are taken at stage 3, with the scope.

## Existing solutions

Date: 2026-10-06. The first research on memory: the earlier notes hold almost nothing on it (see Reused). Every page was read raw with curl today: Markdown twins, and for support.claude.com the HTML with the tags stripped by a local script. No summarising tool and no web search was used. "Unverified": the page could not be opened. "Not documented": the pages opened do not say. help.openai.com was tried once and returned 403.

### 1. Forgetting: what a delete removes

#### OpenClaw
https://docs.openclaw.ai/concepts/memory-provenance
- Forget follows recorded lineage, by source session: "`openclaw memory forget` uses that lineage to remove tracked entries and related artifacts, and records the selected sessions as forgotten so later ingestion does not restore them."
- It covers "matching promoted entries, session-corpus lines, memory index chunks and their full-text/vector rows, short-term state, ingestion deduplication state, and dreaming rewrite preimages".
- It says what it leaves: "It does not delete original session transcripts, every freeform memory edit, or copies outside the memory stores it scans." "It is not a certificate that no related information remains."
- Nothing comes back: "A session recorded as forgotten remains excluded." A preview exists (`--dry-run`). A "recently deleted" window: not documented.
- Overlap: the audit's "erase". Better: one stored list of forgotten sessions that every reader and every re-index checks; a report of what was not reached.

#### Claude Managed Agents memory stores
https://platform.claude.com/docs/en/managed-agents/memory
- Delete keeps history for a time: "Versions belong to the store (not the individual memory) and are not deleted when the memory itself is deleted". "Versions are retained for 30 days after they are written".
- Erase is a second verb: "Redact scrubs content out of a historical version while preserving the audit trail (who did what, when)."
- Overlap: the audit's two verbs and its 30 days. Better: an erased entry keeps who and when, not the text.

#### Claude apps
https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context
- By chat or in Settings: "Tell Claude what you'd like it to remember, change, or forget, and the update applies to your next conversation."
- A memory and its chat are separate: "When a conversation expires or is deleted, related memory entries generated from it won’t be removed, but you can delete individual memories at any time."
- A recently-deleted window, and whether chat search still finds the chat a deleted memory came from: not documented.

#### mem0 and Zep
https://docs.mem0.ai/core-concepts/memory-operations/delete, https://docs.mem0.ai/api-reference/memory/history-memory, https://help.getzep.com/deleting-data-from-the-graph, https://help.getzep.com/facts
- mem0 names delete as erasure: "Satisfies user erasure (GDPR/CCPA) without touching the rest of your data." Its history has an `event` of `ADD`, `UPDATE` or `DELETE`. Whether a delete purges that history: not documented.
- Zep: deleting a source deletes a derived fact "only if no other episodes are associated with them". Residue is stated: "This episode information may still exist within these nodes."
- Zep, "no longer true" is not a delete: it "attempts to invalidate the fact that Kendra loves Adidas shoes and creates two new facts".

#### Claude Code, Devin, Letta, Codex
https://code.claude.com/docs/en/memory, https://docs.devin.ai/product-guides/memory, https://docs.letta.com/concepts/memfs, https://learn.chatgpt.com/docs/customization/memories
- Claude Code: "Auto memory files are plain markdown you can edit or delete at any time." No history. Transcripts are apart, deleted "after the `cleanupPeriodDays` retention period".
- Devin: "Ask Devin in a session, for example \"forget that I prefer npm\"". Letta: "Every memory edit is committed to the MemFS git repository." Both keep memory in Git; whether forget removes the text from its history: not documented.
- Codex: a forget command: not documented.

### 2. Provenance and memory poisoning

#### OpenClaw
https://docs.openclaw.ai/concepts/memory-architecture
- Four sources: "`owner` (typed by the owner in a trusted channel), `agent` (derived by the agent from owner content), `untrusted` (derived from external content such as web pages, tool output, or non-owner participants in group chats), and `system`".
- Set by code: "Origin labels live in SQLite columns written by classification code, never parsed out of memory text." "It is never defaulted to `owner`."
- Taint inside a turn: "When a tool result declares network-sourced content (web fetches, browser reads, search results), the rest of that turn is marked tainted". "The taint clears on the next user message."
- What untrusted may do: "Untrusted-origin content can be stored, indexed, and explicitly searched, but it is structurally barred from the curated core and from auto-injection."
- Scheduled and delegated runs: "Cron, heartbeat, and sub-agent sessions do not produce durable memory candidates."
- A stated gap: "only tools that declare their results as network-sourced participate".
- Overlap: the audit's `source` (owner, bot, outside), almost word for word. Better: an outside note never enters the prompt by itself; the audit only stops it displacing the owner's notes.

#### Claude (API and Claude Code)
https://platform.claude.com/docs/en/managed-agents/memory, https://platform.claude.com/docs/en/api/beta/memory_stores/memory_versions/redact, https://code.claude.com/docs/en/memory
- The risk is named: "a successful prompt injection could write malicious content into the store. Later sessions then read that content as trusted memory. Use `read_only` for reference material".
- Each version has `created_by`: "one of `session_actor`, `api_actor`, `user_actor`, or `service_account_actor`".
- Claude Code auto memory has a `type` and a date: "The timestamp shows how current the fact is, both to you and to Claude when it reads the memory back." Who said it, and a guard after untrusted content: not documented.

#### Codex, Devin, mem0, Zep, Cursor
- Codex (https://learn.chatgpt.com/docs/customization/memories): `memories.disable_on_external_context` "keeps chats that used external context such as MCP tool calls, web search, or tool search out of memory generation". It "Defaults to `false`".
- Devin: every line "links back to the session where it was learned", as `[source: https://app.devin.ai/sessions/abc123; added: 2026-10-05]`. The owner sees an "**Updated memory** card".
- mem0 (https://docs.mem0.ai/platform/features/entity-scoped-memory): "each extracted fact is attributed to whoever stated it, so a record carries `user_id` or `agent_id`, not both."
- Zep (https://help.getzep.com/memory-security): "Memory is evidence for a decision. Memory is not an instruction, policy, credential, permission, or authorization to act."
- Cursor automations (https://cursor.com/docs/cloud-agent/automations) only warn: "Inputs may lead to misleading or malicious memories".

### 3. Always in the prompt or retrieved; duplicates and contradictions

#### Claude Code
https://code.claude.com/docs/en/memory
- "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation." Topic files are read on demand.
- Full is said to the writer: "the write still succeeds, but Claude Code returns an error telling Claude to rewrite the index, because everything past the limit is dropped on the next load."
- No check on write: "if two instructions contradict each other, Claude may pick one arbitrarily."
- Where it lands: "CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself."

#### OpenClaw
https://docs.openclaw.ai/concepts/memory, https://docs.openclaw.ai/concepts/memory-architecture
- Two small files at session start; over budget, it "keeps the file on disk intact but truncates the copy injected into context".
- Preferences replace: "A changed preference rewrites the directive; it never appends a contradicting one, because append-only preference history reliably causes models to answer from the stale value."
- Different: duplicates are merged by a background model pass, an extra run the audit rules out.

#### mem0, Zep, Letta, Devin
- mem0 (https://docs.mem0.ai/core-concepts/how-it-works): nothing is pinned, "Your app decides which returned memories to include in the prompt." Writing no longer updates: "Mem0 can store the new fact without silently rewriting the old one."
- Zep: the old fact stays, dated, and the model sees the range: "(2024-11-14 02:03:58+00:00 - present)".
- Letta: "Files at the memory root are loaded into the agent’s system prompt on every turn." What happens at a block's `limit`: not documented.
- Devin: a session "receives `MEMORY.md` as context"; a daily background session "Consolidates overlapping notes", and "Source links and explicit preferences are preserved."

### 4. Automatic retrieval before a turn

- OpenClaw (https://docs.openclaw.ai/concepts/memory-architecture, https://docs.openclaw.ai/concepts/memory-search): the writer attaches trigger phrases to a note; "entries that match strongly (score at or above 0.72) are injected as a compact hidden context block, at most three per turn". "Auto-injection is restricted to the curated tier." A model-run recall happens only when "The message shows recall intent" and the first lane "produced no strong hit". Search is keywords plus embeddings and "falls back to keyword-only ranking when embedding setup or a request fails".
- Devin Knowledge, now deprecated (https://docs.devin.ai/product-guides/knowledge): "Devin will retrieve a Knowledge item when its current work is related to the specified triggers, and all Knowledge requires a trigger description."
- Claude Code: no lookup. The index is loaded; "Claude reads them on demand using its standard file tools".
- Letta: "MemFS does not include a semantic or vector index by default."
- mem0: the app calls `search` itself, with `threshold` and `top_k`; defaults: not documented. Codex: local memories are "off by default"; how they are chosen: not documented.

### 5. Several agents

- Claude Code (https://code.claude.com/docs/en/sub-agents): "The main conversation's auto memory isn't loaded" into a subagent; its own, with scope `user`, `project` or `local`, "is a separate directory". An orchestrator that writes a subagent's memory: not documented.
- Claude Managed Agents: "one read-only store attached to many sessions (standards, conventions, domain knowledge), kept separate from each session's own read-write store". "`access` is enforced at the filesystem level".
- OpenClaw (https://docs.openclaw.ai/concepts/multi-agent): "each agent searches only its own configured memory and eligible same-agent session sources. Put intentionally shared Markdown in an explicit shared `memory.search.extraPaths` directory".
- Letta (https://docs.letta.com/concepts/shared-memory, https://docs.letta.com/v1-sdk/memory/memory-blocks): "Each agent has its own MemFS." A legacy shared block can be read-only: "the agent cannot update the block".
- mem0: four flat keys, `user_id`, `agent_id`, `app_id`, `run_id`. LangMem (https://langchain-ai.github.io/langmem/concepts/conceptual_guide/): a namespace tuple, "Group memories by organization, user, application, or any other hierarchical structure".

### 6. Scheduled runs and their own last run

- OpenClaw (https://docs.openclaw.ai/automation/cron-jobs/payloads): fresh by default, "A new transcript/session id per run." History is a choice: "Use `current` or `session:<id>` when a recurring job should deliberately build on the same conversation context."
- Cursor automations (https://cursor.com/docs/cloud-agent/automations): "Memories let the agent read and write persistent notes across runs for the same automation." "Memories are enabled by default but can be disabled."
- Devin (https://docs.devin.ai/product-guides/memory, https://docs.devin.ai/product-guides/automations): "Sessions started by automations don't read or write your memory." A trigger script has `STATE_FILE`, "A read/write JSON object persisted between successful live runs, up to 64 KiB. Use it for a polling cursor, not a database."
- ChatGPT scheduled tasks (https://learn.chatgpt.com/docs/automations): "Use a standalone scheduled task when each run should start from the saved prompt. Use a scheduled task in a chat when you want ChatGPT to return to the same chat with its existing context."
- Claude routines (https://code.claude.com/docs/en/routines): "Each run creates a new session". Whether a run is handed the last run's result: not documented.
- No product read hands a job its last reply automatically. The job keeps a small state of its own, or runs in one continuing thread.

### 7. The switches of botdot's own engine

https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/env-vars, https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/agent-sdk/claude-code-features
- The flag is `--append-system-prompt-file`: "Load additional system prompt text from a file and append to the default prompt".
- The variable is `CLAUDE_CODE_DISABLE_AUTO_MEMORY`: "When disabled, Claude does not create or load auto memory files". The setting is `autoMemoryEnabled: false`. Both also switch off a subagent's `memory` field.
- `CLAUDE_CODE_DISABLE_CLAUDE_MDS`: "Set to `1` to prevent loading any CLAUDE.md memory files into context, including user, project, and auto memory files".
- `--setting-sources` is finer: project CLAUDE.md loads when the sources include `"project"`, the user's when they include `"user"`. Auto memory is "read regardless". For isolation: "set `settingSources: []` plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `env`".
- `--strict-mcp-config`: "Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations."
- `--bare` skips all of it, but "bare mode doesn't use your subscription login". It "will become the default for `-p` in a future release".

### Reused
- Letta memory blocks have `label`, `description`, `value`, `limit`: Milestone 2 note, 2026-10-02. Still true of the legacy block API; see Refreshed.
- A custom subagent loads CLAUDE.md "unless its definition sets the `omitClaudeMd` field"; a resumed session keeps the system prompt of its first request: Milestone 8 note, section 4, 2026-10-06.
- help.openai.com returns 403: Milestone 2, 3, 5, 6 and 7 notes. Confirmed once today.
- No earlier note studied a memory product; a search of all eight notes found nothing else.

### Refreshed or added
All 2026-10-06.
- Letta: memory is now MemFS, a Git repository of files. "Older Letta API guides use **shared memory blocks**"; "users should migrate to shared memory repositories instead".
- mem0: the write path is additive only. A model that chooses add, update or delete on write is no longer in the documentation.
- Devin: "Knowledge is deprecated and will be removed in a future update." Devin Memory is new.
- Cursor: https://cursor.com/docs/context/memories now redirects to the Rules page, which has no memory feature. Memory is documented only as a tool of automations.
- Questions 1 to 7: new.

### Could not verify
- ChatGPT memory (help.openai.com): not opened, 403. All six questions: unverified.
- Cursor: memories in the editor's chat (page gone).
- Claude apps: a recently-deleted window; caps; what is always loaded; the source of a memory; whether a deleted memory can be saved again from an old chat.
- Claude Code: a guard on auto memory written after untrusted content; an orchestrator writing a subagent's memory; whether 2.1.284, the version botdot pins, accepts `--append-system-prompt-file` (not run).
- Claude routines: whether a run gets its last run's result.
- mem0: whether delete purges the history; the default search threshold.
- Devin, Letta: whether "forget" removes the text from the Git history.
- Letta: what happens when a block reaches its `limit`.
- Codex: a forget command; how memories are chosen for a session; provenance per memory.
- Graphiti's source repository: not opened; the Zep pages were enough.

## Ideas worth adopting
1. (Q1) Two verbs. Remove keeps dated history for 30 days; erase scrubs the text and keeps who and when. Claude Managed Agents.
2. (Q1) One stored list of forgotten runs, checked by every reader and every re-index, so nothing saves them again. OpenClaw.
3. (Q1) Forget answers with a report: what went, what could not be reached. Never "all gone". OpenClaw, Zep.
4. (Q1) "No longer true" closes a fact with a date; it does not delete it. Zep.
5. (Q2) The server sets the source from a closed set and never from the note's text; unknown is never "owner". OpenClaw, Claude Managed Agents.
6. (Q2) After a tool result from outside, all that is saved in that turn is "outside" until the owner's next message. OpenClaw.
7. (Q2) An "outside" note can be searched, never pinned and never in the automatic lookup. OpenClaw.
8. (Q2) Runs botdot starts (jobs, teammate messages) pin nothing. OpenClaw, Devin.
9. (Q2) Print the source run and the date on every note line. Devin, Zep, Claude Code.
10. (Q2, Q5) Shared memory is read-only for bots; only a turn the owner started writes it. Claude Managed Agents, Letta.
11. (Q3) A changed preference replaces the old line; it is never added beside it. OpenClaw.
12. (Q3) When the pinned set is full, say so in the tool's answer and ask the writer to merge; drop nothing silently. Claude Code.
13. (Q4) The writer adds trigger words to a note; the lookup matches them with a floor and at most three notes. OpenClaw, Devin.
14. (Q4) The costly lookup runs only when the message points at the past. OpenClaw.
15. (Q5) One shared store and one private store per bot, flat keys, no hierarchy. Claude Managed Agents, OpenClaw, mem0.
16. (Q6) A job keeps a small capped state of its own between runs, apart from notes. Cursor, Devin.
17. (Q6) A job is fresh by default; one continuing thread is a choice per job. OpenClaw, ChatGPT.
18. (Q7) Bot runs and Chief turns get `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `--setting-sources` without what botdot does not own, `--strict-mcp-config` and `--append-system-prompt-file`. Claude Code.

Where the products differ from the audit: idea 7 is stricter than its rule that an outside note never displaces what the owner said; ideas 16 and 17 replace its block from the job's last run; Zep and Claude Code keep memory out of the system prompt, where the audit puts it; no product documents an orchestrator writing a sub-agent's notes; OpenClaw, Devin, Letta and Codex all run the background consolidation the audit rules out.

Not adopted without an owner decision: an outside note that is never pinned and never in the lookup (idea 7), runs botdot starts that pin nothing (idea 8), shared memory that only a turn of the owner's writes (idea 10), and a job's own state in place of a block from its last run (ideas 16 and 17) each change a recommendation of the audit; they are put to the owner with the scope. Trigger words on a note (idea 13) are a new field the audit does not have. Moving memory out of the system prompt, and a background consolidation pass, are not proposed: the first changes every prompt botdot builds for no measured gain, the second is the extra run the audit rules out.

## Solutions that make part of botdot unnecessary

None. Claude Code's auto memory and subagent memory are files a bot can write, outside botdot's caps, approvals and forget: they are what the audit switches off, not a replacement. Claude Managed Agents memory stores have the versions, redact, read-only access and attribution botdot needs, but belong to the API, not to `claude -p` on a subscription. `--bare` would close every side door at once, but it does not use the subscription login. The switches of section 7 make "close the side doors" a change of flags and environment.

## Decisions of stage 2 and 3

On 2026-10-06 the owner chose the outcome (every point of the audit in one milestone, safety and forgetting first) and took the seventeen decisions listed under Owner decisions in [milestone9.md](milestone9.md): the audit's ten, and seven on the prototype and the scope. Two of them depart from the audit: the apps show no memory screen, and a passing state is kept with its end date. The scope is agreed as written there.

## Uncertainties resolved at stage 4

By reading the code at `7a175c3` and the survey above on 2026-10-06; one thing was looked at outside the repository (the pinned Claude Code binary, searched and not run). Four architecture decisions are proposed: [ADR 014](../adr/014-botdots-memory-is-the-only-memory-a-bot-keeps.md), [ADR 015](../adr/015-the-server-records-who-said-a-note.md), [ADR 016](../adr/016-a-forgotten-note-is-erased-and-a-removed-one-ends.md) and [ADR 017](../adr/017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md). None of the findings changes the agreed outcome or scope. `CONTEXT.md` has the memory terms the plans use.

- **Does the pinned Claude Code know the private prompt file and the memory switches?** Yes, by its binary: the package of 2.1.284 for `darwin-arm64` holds `--append-system-prompt-file`, `--strict-mcp-config`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `CLAUDE_CODE_DISABLE_CLAUDE_MDS`. Not run: MEM-002 runs it first, and ADR 014 says what botdot does with a `claude` that lacks the flag.
- **Do the switches take a bot's skills with them?** No, by the documentation: they stop `CLAUDE.md` and auto memory. A bot's skills arrive through `--plugin-dir` (`lib/skills.js`). `--setting-sources` would drop more, and is not proposed.
- **Can the server tell a run the owner started?** Yes, from what a run records today: no `startedBy`, no `fromBot`, no job, not the review; a carry-on copies these from the run it continues (`lib/bots.js`). One function: ADR 015.
- **Can "after the web" be told from "after a command"?** Yes: the outside mark is set per tool (`lib/bots.js`), so it can keep which kind. Needed for the owner's decision on skills.
- **Is there a place for a new column?** No: the schema is `CREATE TABLE IF NOT EXISTS` only. ADR 015 proposes one place that adds what is missing at start. Two columns are new: a note's source and a note's end.
- **Where do cards for memory come from?** The `pending` table and `GET /api/memory/pending` hold shared changes after outside content. "Approve all" in both apps takes every item of kind `memory`. So "Forget for good" and a change to a note of the owner's must reach the apps where an app from Milestone 8 does not list them: MEM-004 fixes the contract, and the two app tasks wait for it.
- **Is meaning search by default a larger image?** No: the Docker image already carries `llama-server` and the bge-m3 model (`Dockerfile`). The default is one setting, read where the image's two environment variables are set. Its cost on an install with years of runs (vectors made in the background at the first start) is not measured: MEM-005 measures it on the image.
- **The gates.** `MILESTONE_STAGES` is `tools-real`; `RESILIENCE_STAGES` is the Android build, tests and lint. No new stage is needed: the scale test builds its runs by bulk insert and fits the task gate. The live evals need real Claude and run in no gate.
- **Milestone 8.** SURE-001 and SURE-002 change `startRun`, `finishReport`, `quietRun` and the bots' own routes. Milestone 9 starts after it merges. Blocking condition for stage 6: Milestone 8's queue is finished or the owner hands it off; next action: read the line numbers of the plans again on that `main`.
- **Not resolved, and where it is decided:**
  - What bots really save, and whether they ask "until when": model behaviour, D29 and D30.
  - Whether the Chief's shared block survives session compaction: MEM-006, and until shown it stays as it is.
  - What is done with auto-memory files a bot already left: ADR 014, open, for the owner at acceptance.
  - How long the one index rebuild takes on the owner's server (the audit: about 70 seconds per 10,000 runs): MEM-004.

## Read again at stage 6

On 2026-10-07 Milestone 8 was merged (`main` at `37dd09c`, pull request 277; SURE-001 to SURE-006 are done and no task is unfinished). The planning commit was moved onto it without a conflict.

- **Every place the plans name still exists** under its name: `startRun`, `learningNote`, `reviewPrompt`, `noteLearned` and the one `--append-system-prompt` of `lib/bots.js`; the three of `lib/chief.js`, which also start the look; `runAs`; `makeRoom`, `forPrompt`, `ftsQuery`, `relevantFor`, `indexRun`, `removeNote`, `removeOwner`, `prune`, `forgetRunsOfBot`; `sender` in `lib/chat-history.js`; `describeAction` and `perTurn`; `CHIEF_ROUTES`; `finishReport` and `quietRun`; `age` in the live suite; `notesCardHTML`, `#mem-settings` and `[data-learned]` on the web page. Looked up by a search of the merged code; nothing was run.
- **Still as the audit found it:** no `ALTER TABLE`, no `--strict-mcp-config` for a bot, no switch for Claude Code's own memory, the forgotten text written into `learned`, the six-character note id, "The owner has sent you a message." The Docker image still pins Claude Code 2.1.284.
- **Changed by Milestone 8, as the plans expected:** a scheduled run that asks a question is no longer quiet; "Approve all" counts what it approves and leaves scripts out, and still takes every waiting memory change, on the web page and on Android. MEM-005, MEM-007 and MEM-008 say to read those functions again first.
- **Carried forward from Milestone 8:** real use (C18) and the low findings under Follow-up of [milestone8-test.md](milestone8-test.md). Two meet this milestone: the words of a change's card are written once per app and not on the server, which Milestone 9 does for the memory card only; and `test/chief-message-waits.test.js` failed once under load, which a task gate here may meet.
