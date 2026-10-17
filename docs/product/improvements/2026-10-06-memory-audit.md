# bot·dot memory: audit and redesign proposal

Audit only. Nothing in the repository was changed.

**Revision.** `main` after Milestone 5 (pull request 238 merged; the audited checkout has the same tree).

**Method.** 61 agents in two runs. Audit: 18 readers (14 areas, then 4 gaps a completeness critic found), each finding re-checked by a verifier told to refute it; 141 findings, none refuted outright, about half corrected in detail. Many store behaviours were confirmed by experiment on a temporary database. Design: three independent proposals (minimal evolution, scopes and types, retrieval and lifecycle), scored by three judges (product fit, correctness, delivery risk). Two of three judges chose minimal evolution; the recommendation below is that proposal with the grafts all judges asked for.

**Confirmed vs inferred.** "Confirmed" means read in code and re-read by a verifier; "(E)" means also reproduced by experiment. What a bot *chooses* to save is a model's choice: such claims rest on what the prompts say and are marked *inferred*.

**Severity is graded for this product:** one owner, self-hosted. The verifiers lowered most "high" grades to medium for that reason; I use their grades.

---

## 1. Executive summary

**Three things that are right and must stay**
- **No extraction model, no summariser.** A memory exists only because a bot called `remember`, the Chief called `remember_shared`, or you typed it. The model that did the work decides, with the whole context, at no extra run. An extraction pass per message would double subscription use you cannot see.
- **The prompt is bounded by construction.** Every memory block is capped; prompt size does not grow with notes or runs (E).
- **Bots are isolated on the server.** The bot id comes from the run token, never from the model; experiments could not make bot B read bot A's notes or runs (E). Cross-user leakage is impossible: there is one owner and no user key.

**Finding 1 — "Forget" does not forget**
- Current behaviour: `removeNote` copies the note into `note_versions`, which nothing ever purges (`lib/memory.js:235-245`). The server then writes the forgotten text into the forgetting run's `learned` record (`server.js:1228`), which is indexed. The run where you said it stays indexed and the pre-run lookup feeds it back; the conversation replay ignores "Don't recall" (`lib/bots.js:571-584`); the weekly review can re-save it. (E)
- Problem: "Forget what I told you about X" removes one line from the prompt and leaves X in at least four searchable places, one created by the forget itself. Something said only in chat cannot be forgotten by chat at all.
- Recommendation: two verbs. "No longer true" stays a dated, restorable change. "Forget" erases: note, versions, search rows, vectors, pending rows; the runs that wrote it are left out of everything a model reads; `learned` stores a note id, not its text.
- Priority: **High**

**Finding 2 — the pinned set keeps the newest 30 notes, not the important ones**
- Current behaviour: every saved note is pinned by default. A full set (30 notes / 5,000 characters) unpins by `COALESCE(used_at, updated_at)`, oldest first (`lib/memory.js:150`). `used_at` is set only when a bot's `recall` returns a note, and pinned notes are never recalled because they are already in the prompt. (E)
- Problem: your earliest standing preferences leave the prompt first, silently, during an unrelated run. In the experiment "Use pnpm." left after about 25 later notes; a Chief-saved "lives in Gdańsk" left every bot's prompt after 30 later shared notes.
- Recommendation: record who said a fact (`source`). What you said is never evicted automatically; only a bot's own conclusions give way, visibly.
- Priority: **High**

**Finding 3 — updates, duplicates and contradictions rest wholly on the model**
- Current behaviour: the only check is identical text for the same owner, ASCII case and spacing ignored (`lib/memory.js:168`). "Use pnpm" and "Use pnpm." are two notes; "Use pnpm." and "Use npm instead." both stand pinned (E). Pinned lines carry no date and no author, so the prompt's own rule "newer ones win" cannot be applied.
- Problem: stale and contradictory facts reach the prompt side by side.
- Recommendation: print source and date on every note line; on save, return up to three similar notes as a hint (never a block); normalise the duplicate key.
- Priority: **High**

**Finding 4 — the automatic lookup is literal and has no floor**
- Current behaviour: the first 12 non-filler words of the task, OR-ed, English stemming only (`lib/memory.js:76-82`); the best hit of each kind always scores about 1, and everything within half of it is kept (`:548-574`). It never uses meaning search, even when on. (E)
- Problem: "What package manager do I prefer?" does not find "Use pnpm." and injects five unrelated notes. A keyword at word 21 finds nothing. "Warszawa" misses "Warszawie". It hands over an outdated run and withholds the note that corrected it.
- Recommendation: all meaningful words up to a cap, a floor of two matched words (or one rare one), fixed slots (notes before runs), exclusions before the limit; notes that name their subject.
- Priority: **High**

**Finding 5 — side doors around memory**
- Current behaviour: (a) pinned notes, shared memory and your recent conversation are passed as a command-line argument (`lib/bots.js:800`), which the code's own comment calls readable by every user; (b) Claude Code's own `CLAUDE.md` loading, auto memory and transcripts are live in bot runs and Chief turns, and botdot switches none off; (c) a note's text enters the system prompt unescaped: a note containing `</memory>` closes the block (E).
- Problem: (a) a bot that may run commands can read another running bot's notes; (b) a bot with Write can leave itself standing instructions outside every cap, approval and forget; (c) planted text can pose as instructions.
- Recommendation: pass the prompt through the private file the code already uses for the MCP config; switch auto memory off; neutralise memory-derived text when it is printed.
- Priority: **High** (a was tagged critical by its reader and lowered by the verifier: it needs a second, misled bot with Bash running at the same moment)

**Finding 6 — only shared notes are guarded, and weakly**
- Current behaviour: the owner's OK is needed only for shared-memory changes after a run read outside content (`server.js:1203`). A private note or a self-written skill from a run that read a web page goes straight in, pinned under "(use it)". Any learning bot can rewrite or delete any shared note, including ones you wrote and pinned (E). The Chief writes shared memory with no gate, also in turns a bot started.
- Problem: one obeyed injected sentence becomes a standing line of a system prompt.
- Recommendation: `source` marks such notes "after outside content" and they never displace what you said; your own notes change only in a run you started, otherwise by a card; the Chief gets no memory-writing tools in turns botdot starts for a bot.
- Priority: **High**

**Finding 7 — a teammate's message is replayed as "Owner:"**
- Current behaviour: the conversation block is the last three runs of any kind, each printed as `Owner: … / You: …` (`lib/bots.js:571-584`). A run started by another bot's message is printed with that message as your words. (E)
- Problem: against the product's own rule that a bot's text is never the owner's instruction; and three scheduled runs push your real last exchange out.
- Recommendation: build the block from exchanges you wrote or saw, labelled by who asked; skip runs left out of recall.
- Priority: **High**

**Finding 8 — the Chief can only remember globally**
- Current behaviour: the Chief has no notes of its own and one write tool, `remember_shared`. It reads every bot's notes and cannot write, list or delete any.
- Problem: everything you tell the Chief becomes pinned for every bot, or lives only in one chat's session. "We decided to use PostgreSQL for this project" has no home.
- Recommendation: the Chief files a note where it belongs: for everyone, for itself, or with a named bot; the chip says where it went.
- Priority: **Medium**

**Finding 9 — a scheduled job knows nothing of its own last run**
- Current behaviour: a job run gets no conversation block; the lookup removes the job's own runs on purpose; a quiet run is indexed with an empty reply (`lib/reporting.js:22-31`). (E)
- Problem: "report only what is new" has no baseline: repeated reports, missed changes.
- Recommendation: one capped block from the job's last run, private reply included; index the private reply.
- Priority: **Medium**

**Finding 10 — "What do you remember?" is answered from a sample**
- Current behaviour: `recall` returns 8 results with no paging or total; with 1,000 notes, 879 were out of reach (E). The Chief cannot list one bot's notes.
- Recommendation: limit, offset and a total; an empty query pages every note.
- Priority: **Medium**

---

## 2. Current memory architecture

```text
WRITE                                                              STORE: data/memory.db (SQLite, 0600)
 bot run ── remember / update_memory / forget / set_pin ──► /api/self/session/memory ─┐
 Chief ──── remember_shared / update_shared / forget_shared ► /api/memory/shared ─────┤
 owner ──── web, Android ─────────────────────────────────► /api/memory/notes ────────┤
 weekly review (one Opus run per bot) ── the same bot tools ──────────────────────────┤
                                                                                       ▼
        shared change after outside content ─► pending ─► owner's card        notes + notes_fts
                                                                               note_versions (never purged)
 every finished run / Chief reply ─► indexRun ─► runs + run_parts (+ FTS), pruned after 365 days
 optional: embeddings (bge-m3 on a local llama-server, off by default)

READ (a bot run: a fresh `claude -p`, no session resume)
 <memory>            every pinned own note      ≤30 notes / 5,000 chars   on every run
 <shared-memory>     every pinned shared note   ≤30 notes / 5,000 chars   on every run
 <possibly-relevant> FTS5 words only            ≤5 items / 1,500 chars    unpinned notes + own past runs
 <conversation>      last 3 runs within 3 days  600 + 1,500 chars each    owner chat messages only
 on demand           recall (8 results), read_run

READ (the Chief): one resumed Claude session per chat; pinned shared notes re-sent every turn;
                  recall over every bot's notes and runs; the owner's rules (≤4,000 chars)
```

- **Creation.** Tool calls only. `remember` → `POST /api/self/session/memory` → `memory.addNote` (`lib/self-mcp.js:156-180`, `server.js:1209-1215`, `lib/memory.js:162-186`). No code reads messages and writes notes (confirmed; looked in `memory.js`, `learning.js`, `bots.js`, `server.js`, `chief.js`).
- **Storage.** One SQLite file through `node:sqlite`. `notes(id, owner, text, topic, pinned, pin_locked, by, run_id, created_at, updated_at, used_at, uses)`; `note_versions` for every edit and delete; `pending`; `runs(run_id, bot_id, …, asked, reply, steps, learned, excluded)`; `run_parts`; `embeddings`; `meta`; four FTS5 tables.
- **Retrieval.** `forPrompt` (all pinned), `relevantFor` (the lookup), `rank` behind `recall` and the search screens. Score = bm25 ÷ best of its kind × (1 + 0.3·recency + 0.1 pinned + up to 0.05 use + 0.1 for notes); with meaning search, 0.6·cosine + 0.4·words.
- **Prompt injection.** `startRun` joins every block into one `--append-system-prompt` argument (`lib/bots.js:796-800`).
- **Updates.** `editNote` rewrites the row and keeps the old text as a dated version with a reason.
- **Deletion.** `removeNote` is a soft delete. Deleting a bot removes its notes with no version, and leaves its old versions, pending rows, runs, workspace and Claude files.

---

## 3. Memory types

| Memory type | Exists now? | Scope | Storage | Retrieval | Problems |
|---|---|---|---|---|---|
| Conversation | Chief: yes. Bots: partly | Chief chat; bot | Claude session file; run files | Chief: resume. Bots: last 3 runs, clipped | Bots: any run counts, teammates shown as "Owner:"; a Chief session unused 30 days is lost with no fallback |
| Short-term | Partly | bot | that replay; inbox (20 messages, 7 days) | automatic | no task or session state |
| Long-term | Yes | bot, shared | `notes`, `runs` | pinned + lookup + recall | this report |
| User | Partly | `_shared` | `notes`, Chief rules | every bot, every run | mixed with anything a bot or the Chief chose to share |
| Bot-specific | Yes | bot id | `notes` | pinned + lookup | eviction, no provenance shown |
| Project / workspace | **No** | — | files in a bot's workspace only | when the model opens them | a decision is one bot's or everybody's |
| Procedural | Yes | skill name + bot | skill files; main assignment and rules | descriptions automatic, body on demand | skills written after outside content are not gated |
| Episodic | Yes | bot; Chief | run files, run index | lookup, recall, `read_run` | keeps superseded and forgotten facts; quiet runs empty |
| Semantic | Partly | bot, shared | free-text notes; optional vectors | as long-term | no types, no confidence: free text |
| Generated summaries | **No** | — | — | — | none made by botdot; the weekly review rewrites notes |

---

## 4. Memory scope matrix

| Information | Global user (shared) | Project | Bot | Conversation | Should persist? |
|---|---|---|---|---|---|
| Who you are: name, city, time zone, language you write in | ✔ | | | | Yes |
| Your language preference for code ("I prefer TypeScript") | | | ✔ each bot it applies to | | Yes |
| Project DB decision ("PostgreSQL for BotDot") | | = the bot that works on it | ✔ with the project named | | Yes |
| "Don't use Redis anymore" | | | ✔ as a current prohibition | | Yes |
| Bot-specific instruction ("for this bot, Go") | | | ✔ | | Yes |
| How you like to be answered by the Chief | | | ✔ Chief's own | | Yes |
| Current task | | | | ✔ | No |
| "I'm in London this weekend" | | | | ✔ | No (if needed: with real dates) |
| A how-to ("when I ask for a PR review, run tests first") | | | skill, not a note | | Yes |
| GitHub default branch, a price, a status | | | | | No: ask the tool again |

**Why no project scope.** A bot has exactly one workspace folder, fixed to its id (`lib/bots.js:725`, `lib/identity.js:123`); files reach a teammate as copies. One bot per project already gives hard separation. Inside one bot, a project note carries the project's name in its text and topic. A project entity would be a new concept, a new key in every query and a new place for the model to misfile, with no product object behind it.

---

## 5. Critical problems

Graded for one owner, none is Critical. By risk class:

- **Cross-user leakage:** not possible. No table has a user column; every allowed Tailscale login is the owner (`server.js:154, 1694-1696`).
- **Cross-bot leakage:** not through queries (E). Through the command line: yes, for a bot with Bash while another bot runs (finding 5a). Without separate OS users (plain `node`, a Mac), a bot with Read or Bash can open `memory.db` and other workspaces; documented in SECURITY.md.
- **Wrong memories:** a teammate's message replayed as yours (finding 7); two contradicting pinned notes (finding 3); an outdated run offered without its correction (finding 4).
- **Permanent incorrect facts:** a temporary fact saved as a pinned, undated note stays until someone deletes it; nothing reviews shared memory.
- **Memory poisoning:** private notes and skills after outside content; any bot rewriting your shared notes; the Chief writing shared memory in bot-started turns; unescaped note text (findings 5c, 6).
- **Uncontrolled prompt growth:** none in ordinary runs. Uncapped: the weekly review's prompt lists every note (up to about 445,000 characters at the 1,000-note cap); the main assignment and rules have no cap.
- **Data that cannot be forgotten:** finding 1; plus run files, logs and screenshots are never deleted by any route, and Claude Code's transcripts keep 30 days.

---

## 6. Memory quality problems

- **Duplicates.** Exact text only. A missing full stop, a paraphrase or a Polish capital makes a new pinned note (E). The same sentence in a bot's notes and in shared memory is stored twice.
- **Stale memories.** No expiry, no date shown on pinned lines. The run index keeps the old statement and the lookup feeds it back.
- **Contradictions.** Nothing detects them. Own versus shared has no precedence rule.
- **Poor extraction.** There is no extractor to be poor; the weakness is guidance. The instructions say "lasting" and "no one-off results" and nothing about decisions, maybes ("we might use Redis") or passing states; "location" is even listed as a shared example.
- **Irrelevant retrieval.** One shared word puts an item into the prompt (finding 4). A job with its own task fills the lookup with copies of its own prompt after about 20 runs.
- **Missing memories.** The earliest pinned notes are evicted (finding 2). A decision told to the Chief is kept only by chance. Whether a bot saves at all is its choice: the live baseline saved 9 of 9 explicit facts, and saw one correction saved as a second note.
- **Incorrect inference.** A note cannot say whether you stated it or the bot concluded it; the model sees neither.

---

## 7. Context efficiency

Measured from the constants and the fixed prompt texts (characters ÷ 4). Claude Code's own base prompt is not included; it was not measured.

```text
CURRENT, one bot run                 small        typical       every cap hit
Fixed instructions                   ~1.6k        ~3.1k         ~4.3k tokens
Main assignment + rules              ~0.2k        ~0.25k        no cap in code
Conversation (last 3 runs)            0           ~0.3k         ~1.6k
Pinned own memory                    ~0.1k        ~0.7k         ~1.8k
Shared memory                        ~0.1k        ~0.2k         ~1.8k
Possibly relevant                     0           ~0.2k         ~0.5k
Appended prompt, total               ~2.7k        ~4.7k         ~10k
Tool definitions (not in the total)  ~6.3k–8.2k tokens, more with a computer and connected apps

CURRENT, one Chief turn
Fixed instructions                   ~5.8k tokens (sent once per change)
Shared memory                        up to ~1.7k, re-sent on every resumed turn
Owner's rules                        up to ~1k
Tool definitions                     ~19k tokens (44 tools)
Conversation                         the Claude session; botdot does not bound it
```

- Memory is at most about half of a bot's appended prompt and usually a fifth. **Fixed instructions and tool definitions outweigh the memory they frame**; one tool schema is larger than a full pinned set.
- Unnecessary growth: the Chief gets the whole pinned shared memory again on every resumed turn although the session holds it; the memory rules are said twice; the lookup fires on small talk.
- Not a problem: prompt size against the number of notes or runs. It is capped.

**Suggested:** keep every cap. Do not chase tokens here; fix what the blocks contain. The one saving worth taking is the Chief's repeated block, and only after it is shown to survive Claude Code's session compaction.

---

## 8. Memory lifecycle

**Today**

```text
Created     by a tool call; pinned by default; no source the model can see
Active      pinned (in every prompt) or searchable (after unpinning or eviction)
Updated     in place, old text kept as a dated version; only if the model chooses update over add
Superseded  only as an old version, or as two live notes side by side
Forgotten   a "deleted" version, restorable, recallable with history: true, never purged
```

**Recommended**

```text
Created     source set by the server: owner / bot / outside; pinned while there is room
Active      pinned or searchable; your statements are never evicted automatically
Updated     in place, dated version with a reason (as today)
Superseded  an old version: in your history, never in a model's default recall (as today)
Removed     hidden from every model at once; in your "Recently deleted" for 30 days; then purged
Erased      "forget it": purged at once, its runs left out of everything a model reads
```

Not recommended now: expiry dates and decay scores. A verifier called an `until` column "not the simplest design"; dated lines and the instruction to write real dates cover most of it. Build it only if the evals show temporary facts being saved pinned.

---

## 9. Multi-bot memory model

Three flat places, one rule each. No hierarchy.

| Place | Key | Holds | Example |
|---|---|---|---|
| About you | `_shared` | facts about you as a person that any bot could use | "Lives in Brussels", "Writes Polish and English", "Works Monday to Thursday" |
| One bot | the bot's id | everything about its work, and anything said "for this bot" or "for this project" | Coder: "BotDot uses PostgreSQL, not MongoDB (decided 2026-10-05)"; News Watcher: "Skip crypto stories" |
| The Chief | `chief` (new value) | how you want the team run and how the Chief should work with you | "Ask before creating more than one bot", "Morning reports go out at 8" |

- **Shared between bots:** only the first row. Today shared memory also collects whatever a bot or the Chief chose to put there, which is how a coding preference ends up in the weather bot's prompt.
- **Isolated per bot:** notes, past runs, recall, the conversation block. This holds today.
- **Projects:** the bot is the project.
- **A work preference that fits several bots** ("I prefer TypeScript", told to the Chief): no proposal settled this. Recommended: the Chief files one note with each bot it applies to and says which. The alternative is one shared note in every bot's prompt, including the weather bot's.
- **Precedence, stated once in every prompt:** your current message, then the bot's own notes, then shared notes, then past runs. What you said beats what the bot concluded. Among equals the newer date wins.

---

## 10. Recommended architecture

Keep the model that exists. Most root causes are not missing machinery: they are places where the server leaves to the model a decision it could make itself, or shows the model less than it stores.

```text
WRITE
 You say something worth keeping
   ↓
 The working model calls remember (no extraction step, no second model)
   ↓
 Server: where does it belong?  the bot's own (default) / shared / the Chief's / a named bot (Chief only)
   ↓
 Server: who said it?  source = owner   in a run you started, saved before the run read outside content
                                bot     its own conclusion
                                outside saved after web, commands, connected apps, files from others
   ↓
 Server: duplicate? (normalised text + topic)   similar notes? (returned as a hint, never a block)
   ↓
 Server: pin while there is room; your statement may displace a bot's conclusion, never the reverse
   ↓
 The tool's answer is the sentence to relay: "saved", "already there", "waits for your OK", "not saved"

READ
 A run starts
   ↓
 Scopes: the bot's own + shared (as today); the Chief: its own + shared
   ↓
 Pinned lines, each with source and date:  - [id] (topic, you said, 2026-09-12) text
   ↓
 Lookup: every meaningful word (cap about 40) → floor: two matched words, or one rare one
         → up to 3 notes, then up to 2 runs → never a run left out of recall
   ↓
 Conversation: the last three exchanges you wrote or saw, labelled by who asked
 A job: one block from its own last run
   ↓
 Everything memory-derived is neutralised when printed, and passed in a private file, not on the command line
```

**Forgetting, one server function**

```text
"That is no longer true"  →  update or remove, dated history kept (as today)
"Forget it"               →  delete the note, every version, search rows, vectors, pending rows
                             leave the runs that wrote it out of recall, lookup, conversation, review, the Chief's tools
                             answer with what still matches, so the model can extend it in the same turn
                             immediate only in a run you started that read nothing outside; otherwise a card
```

---

## 11. Recommended memory schema

One new column. Everything else reuses what exists.

| Change | Why it is needed |
|---|---|
| `notes.source` TEXT: `owner` / `bot` / `outside`; copied to `note_versions` and `pending` | Root of findings 2, 3 and 6: `by` is the last writer, not who said the fact, and the model never sees it. It decides eviction, precedence between contradicting notes, and how a planted note reads |
| `notes.owner` may hold `chief` (no DDL) | Finding 8 |
| `runs.learned` holds a kind and a note id, never the note text (index rebuild) | Finding 1: the forget itself re-indexes the forgotten text |
| Deleted versions get an end: purged 30 days after deletion, at once on erase, and with their bot | Finding 1 |
| Duplicate key: Unicode-lower-cased text without end punctuation, plus topic; computed, not stored | Finding 3 |
| A quiet run's private reply is indexed, marked as not sent | Finding 9 |
| Note ids: retry on collision (6 hex characters, shared by all owners, collide today) | A raw database error on save (E) |

**Deliberately not added:** `type`, `confidence`, `importance`, `status`, `project_id`, `user_id`, `until`. `source` is the only kind of confidence this product can know for certain. Status already exists as "current row versus version row".

---

## 12. Recommended retrieval strategy

- **Scope filtering:** as today, on the server: the bot's own notes and runs plus shared. Do not widen.
- **Always in the prompt:** the pinned set, capped as today (30 notes / 5,000 characters per place).
- **Automatic lookup:** every distinct meaningful word of the task, capped near 40; an item needs two matched words, or one that is rare in that bot's memory; up to 3 notes, then up to 2 runs; pinned notes, the current run and the job's own runs removed in SQL before the limit; a newer note that matches the same words is never cut in favour of an older one. Budget stays 5 items / 1,500 characters.
- **Meaning search:** keep it optional and local. When it is on, let the lookup use it for notes only, merged by rank under a short timeout. It is the only real fix for paraphrase and Polish inflection; whether it should be on by default in the Docker image is your decision.
- **Recall:** limit, offset and a total; an empty query pages all notes; lines show source and date; removed notes never appear.
- **Ranking:** bm25 with the existing recency and pin boosts is enough. No scoring formula with importance × confidence × scope: none of those values exist, and inventing them means a model guessing numbers.
- **Not needed:** a vector database, a reranking model, per-note embeddings by default. Brute-force vectors cost +187 MB and 82 ms at 24,000 vectors, and the cap is 1,000 notes per owner.

---

## 13. Recommended memory write strategy

| Kind | Rule |
|---|---|
| Explicit ("Remember that…") | Always saved, `source: owner`, pinned; the reply says "saved" only after the tool answered so |
| Implicit, stated by you ("I always use pnpm") | Saved by the working model under the same rule; the note names its subject ("Package manager: pnpm for JavaScript") |
| Decisions | Saved as a decision with the date and what it replaces |
| Reversals ("Don't use Redis anymore") | Always leave a current note "Do not use Redis", also when no Redis note exists |
| Maybes ("we might use Redis") | Not saved |
| Temporary state ("in London this weekend") | Not saved; if another bot needs it, with real dates |
| The bot's own inferences | Saved as `source: bot`; pinned only while there is room; never displace what you said |
| Tool results (GitHub default branch) | Not saved: ask the tool again. A lesson about a source's quirk may be saved, as `outside` |
| After outside content | Saved as `outside`, labelled so in the prompt; never to shared memory without your OK (as today) |

No extraction model. The weekly review stays the net for missed saves; it needs dates and sources on its note list, and a stated rule for what source its own writes get.

---

## 14. User experience

- **Remember.** You say it to a bot or the Chief. A chip under the reply says what was stored and where: "Remembered", "Remembered for all bots", "Remembered for Coder", "Noted for myself". The chip is written by the server from the store's answer, never from the model's words. Today the Chief's chip says "Remembered" for a duplicate.
- **Correct.** "No, I switched to Svelte" → one note, the old one in history.
- **Forget.** One sentence. The chip says what was erased; if other records still mention it, the reply says so.
- **Inspect.** By chat: "What do you remember about me?" gets a complete, paged answer that says how many notes there are. By screen: each bot's memory and the shared one, as today.
- **Bot-specific and project memory.** No new screen. A note's topic names the project.
- **Parity.** Web cannot edit a note's text; Android cannot restore, show history or mark "Don't recall", and reports a failed add after the note was saved (`data/Api.kt:316-317`). One list of controls, decided once.
- **Minimal UI.** Web Settings shows the review schedule, the model download and retention, all of which the Chief runs by chat. Removing them is your call.
- **Not shown:** scopes, sources as jargon, scores, retention. "You said" and a date are enough.

---

## 15. Tests

Deterministic (store and prompt builder; run in the task gate):

1. **Bot isolation:** B's recall, lookup, `read_run`, edit and delete never reach A's notes or runs; a deleted bot's runs do not return after a restart.
2. **The "you said" invariant:** no page, file, teammate, scheduled run or review can produce `source: owner`.
3. **Eviction:** a note you stated is never unpinned automatically; a bot's conclusion never displaces one; every unpin is reported.
4. **Forget:** after erase, the text is found by no reader: recall with history, lookup, conversation block, review list, the Chief's `get_run`, `list_runs`, `wait_for_run`, the look's digest.
5. **Updates and contradictions:** an edit leaves one current note and one dated version; "Use pnpm" and "Use pnpm." are one note; the similar-notes hint names the note to update.
6. **Lookup fixtures:** the pnpm paraphrase, the Redis correction, a keyword at word 21, Warszawa / Warszawie, 30 runs of one job, 25 matching pinned notes.
7. **Tag escape:** a note containing `</memory>` cannot close its block; the same for topics, lookup excerpts and the conversation block.
8. **Context bound:** the whole appended prompt stays under a stated size with every cap hit.
9. **Conversation block:** a teammate's or the Chief's message is never labelled as yours.
10. **Scale:** indexing a run and recall stay under a stated time at 10,000 runs.

Scripted, against real Claude (opt-in, graded on the store afterwards, three repeats): your five phrases; a preference repeated in other words (one note); small talk (no note); a guess (no note); "in London this weekend" (no note); "because a file said so" (no note). **Record a baseline before any wording change.** Today the live suite grades reading only.

Not applicable: user isolation (no second user); project isolation (no project scope).

---

## 16. Quick wins

| Change | Impact | Effort |
|---|---|---|
| Pass the prompt through a private file instead of the command line (`lib/bots.js:800`, `lib/chief.js:490, 898`) | High | Small |
| Switch Claude Code's auto memory off in `runAs()`; add `--strict-mcp-config` to bot runs | High | Small |
| Neutralise angle brackets when memory text is printed into a prompt | High | Small |
| Conversation block: only exchanges you wrote or saw, labelled by who asked, skipping "Don't recall" | High | Small |
| Stop writing forgotten text into `learned` (`server.js:1228`) | High | Small |
| Hide removed notes from the bots' and the Chief's recall | High | Small |
| Print the date on pinned lines; add today's date and time zone to bot prompts | Medium | Small |
| Normalise the duplicate key; retry on a note-id collision | Medium | Small |
| `recall`: limit, offset, total (the route already honours a limit up to 25) | Medium | Small |
| Android: read the `note` field of the add answer; write the memory routes into `docs/api.md` | Medium | Small |
| Build the Chief's chip from the store's answer | Medium | Small |
| Lookup: every meaningful word up to a cap; exclusions before the limit | Medium | Small |

---

## 17. Structural improvements

1. **Real forgetting.** One server function with one "left out" rule honoured by every reader. Worth doing: it is the one request the product cannot honour today. Needs an ADR.
2. **Provenance and the pin rule.** The `source` column, the backfill, the "run you started" fact (new: `isMessage` at `lib/bots.js:747` is also true for Chief-started and follow-up runs), eviction by source. Worth doing: it fixes eviction, contradiction and poisoning with one stored fact.
3. **The Chief files notes where they belong.** Its own notes, a target bot, listing, a lookup before its turn, no memory-writing tools in turns botdot starts, and a rule for turns that have read a bot's reply. Needs an ADR: the Chief gains write access to every bot's notes.
4. **The lookup's floor and slots.** Needs per-word match counting, which FTS5 does not return: count on the candidates in JavaScript.
5. **Job continuity.** The last-run block and the indexed private reply.
6. **One memory contract.** `docs/api.md` documents 2 of 18 memory routes; both apps hard-code card wording; web and Android differ.
7. **Write-side evals.** The only way to know whether a wording change made bots save better or worse.

---

## 18. Recommended implementation order

**Phase 0 — measure first.** The write-side eval baseline; the memory API written into `docs/api.md`; the lookup fixture tests, failing.

**Phase 1 — close the side doors** (no decision of yours needed): prompt off the command line; auto memory off; strict MCP config; print-time neutralising; conversation block labels; today's date; note-id retry; Android's add; the Chief's chip.

**Phase 2 — forgetting.** The "left out" rule in every reader; `learned` as ids with the one index rebuild; erase with its gate and audit event; removed notes hidden from models; the 30-day purge; bot deletion cleaning versions, pending rows and the index. ADR.

**Phase 3 — provenance and pins.** `source` with backfill; the "run you started" fact; sourced and dated lines; eviction by source; duplicate key; the similar-notes hint; the tool's answer sentences; then the guidance wording, re-running the evals.

**Phase 4 — retrieval.** The lookup's query, floor and slots; recall paging; the job's last-run block; quiet replies indexed; meaning search in the lookup when on.

**Phase 5 — the Chief.** Its own notes; filing with a named bot; listing; the pre-turn lookup; no memory tools in bot-started turns. ADR.

**Phase 6 — parity and upkeep.** The same controls on web and Android; a run-log record of which notes a run was given; audit events for approve and decline; the review's input; skip the needless index deletes (the first scale limit: index writes scan whole FTS tables on the one server thread).

Honest size: the winning proposal estimated 17 to 20 days; the delivery judge called that optimistic by half again to double. Plan on five to seven weeks of delivery.

---

## 19. Files that should change

- **Store:** `lib/memory.js` (`addNote`, `editNote`, `removeNote`, `removeOwner`, `makeRoom`, `forPrompt`, `ftsQuery`, `rank`, `relevantFor`, `indexRun`, `prune`, `backfill`, the schema block), `lib/learning.js`.
- **Bot runs:** `lib/bots.js` (`startRun`, `recentConversation`, `learningNote`, `relevantNote`, `reviewPrompt`, `finish`, the outside-content flag, bot deletion), `lib/identity.js` (`runAs`), `lib/reporting.js`.
- **Bot tools:** `lib/self-mcp.js` (`remember`, `update_memory`, `forget`, `recall` and their descriptions).
- **The Chief:** `lib/chief.js` (`MEMORY_NOTE`, `chiefInstructions`, `describeAction`, `replyRecord`, the turn's arguments), `lib/mcp-server.js` (memory tools, `runSummary`), `lib/look.js` (the digest).
- **Routes:** `server.js` (`/api/self/session/memory`, `/recall`, `/api/memory/*`, `CHIEF_ROUTES`, the pending answers), `lib/audit.js`.
- **Web:** `public/app.js` (memory sections, learned chips, the shared-memory card, Settings → Memory).
- **Android:** `ui/MemorySection.kt`, `ui/NeedsYouScreen.kt`, `feed/Notifier.kt`, `data/Api.kt`, `data/Models.kt`.
- **Docs:** `docs/api.md`, `README.md` ("Bots that learn", "Memory"), `SECURITY.md`, `CONTEXT.md` (it defines none of the memory terms), new ADRs for forgetting and for the Chief's reach.
- **Tests:** `test/memory.test.js`, `test/memory-api.test.js`, `test/memory-semantic.test.js`, `test/security.test.js`, `test/live/memory-conversations.test.js`, `test/live/report.js`; new: forget, eviction, lookup fixtures, tag escape, conversation block, scale.
- **No schema migration tool exists:** the schema is `CREATE TABLE IF NOT EXISTS`; `source` would be the first `ALTER TABLE`.

---

## Decisions that are yours

1. **Removed notes purged after 30 days.** README says deleted notes are kept.
2. **How far "forget" reaches:** only what a model reads (recommended), or also run files, logs and Claude transcripts (a secret typed in chat).
3. **"You said" after outside content.** If a bot already ran a command before saving, is your statement still labelled yours? Recommended: no; the bot is told to save what you said first.
4. **`CLAUDE.md` loading off for bots.** Closes the second memory, but a coding bot loses a cloned repository's own file. Auto memory off needs no decision.
5. **A work preference told to the Chief:** filed with each bot it applies to (recommended), or one shared note.
6. **Changes to notes you stated**, made by the weekly review or a scheduled run: a card in Needs you (more cards), or the review leaves them alone (recommended).
7. **May the Chief write a bot's notes directly** in a turn you started?
8. **Meaning search on by default** in the Docker image.
9. **The web Settings memory controls:** remove, or keep.
10. **Running the live evals** on your subscription before and after each wording change.

---

## 20. Top 5 memory changes to make first

**1. Make "forget" real**
- Problem it solves: forgotten text survives in versions, the run index, the lookup and the review, and the forget itself re-indexes it.
- Current code: `lib/memory.js` `removeNote`, `keepVersion`, `rank`, `prune`; `server.js:1228`; `lib/bots.js` `recentConversation`, `reviewPrompt`; `lib/mcp-server.js` run tools; `lib/look.js`.
- Proposed solution: one erase function; one "left out" rule in every reader; `learned` as ids; removed notes hidden from models and purged after 30 days.
- Expected improvement: "Forget what I told you about X" works by one sentence and stays true.
- Complexity: **Medium** · Risk: **Medium** (changes documented, tested behaviour; needs an ADR and one index rebuild, about 70 seconds per 10,000 runs)

**2. Record who said it, and pin by that**
- Problem it solves: the earliest preferences are evicted; contradictions cannot be judged; planted notes read as facts.
- Current code: `lib/memory.js` schema, `addNote`, `makeRoom`, `forPrompt`; `server.js` memory routes; `lib/bots.js` `learningNote` and the outside flag.
- Proposed solution: `source` (owner / bot / outside), set by the server; lines show source and date; your statements are never evicted, a bot's conclusions give way among themselves.
- Expected improvement: what you said stays in the prompt; "newer wins" and "you beat my guess" become applicable.
- Complexity: **Medium** · Risk: **Medium** (the first `ALTER TABLE`; the backfill cannot tell what you dictated to a bot before the change)

**3. Close the side doors**
- Problem it solves: notes readable on the command line; Claude Code's own memory outside every control; unescaped note text; a teammate replayed as you.
- Current code: `lib/bots.js:800`, `lib/chief.js:490, 898`, `lib/identity.js:118`, `lib/bots.js` `recentConversation`, `lib/memory.js` `forPrompt`.
- Proposed solution: the private prompt file; `CLAUDE_CODE_DISABLE_AUTO_MEMORY`; `--strict-mcp-config`; neutralise on print; label the conversation by who asked.
- Expected improvement: memory.db becomes the only long-term memory, and another bot cannot read it from a process list.
- Complexity: **Small** · Risk: **Low** (check the pinned Claude Code version has `--append-system-prompt-file`)

**4. Fix the automatic lookup**
- Problem it solves: paraphrased questions find nothing, one shared word injects noise, late keywords are ignored, a job floods itself.
- Current code: `lib/memory.js` `ftsQuery`, `rank`, `relevantFor`; `lib/self-mcp.js` `recall`; `server.js:1169-1173`.
- Proposed solution: all meaningful words, a two-word floor, fixed slots, exclusions before the limit; recall with paging and a total; notes that name their subject.
- Expected improvement: the right note reaches the prompt without a tool call; "what do you remember" is complete.
- Complexity: **Medium** · Risk: **Low** (the 60-question live baseline must hold)

**5. Let the Chief file a note where it belongs**
- Problem it solves: everything told to the Chief becomes global or is lost; a project decision has no home.
- Current code: `lib/mcp-server.js` memory tools; `server.js` `/api/memory/shared`, `CHIEF_ROUTES`; `lib/chief.js` `MEMORY_NOTE`, `describeAction`.
- Proposed solution: the Chief's own notes; `remember` with a target (everyone, itself, a named bot); a chip that names the target; no memory-writing tools in turns botdot starts for a bot.
- Expected improvement: "We decided to use PostgreSQL for this project" lands with the bot that works on it, and you see where.
- Complexity: **Medium** · Risk: **Medium** (the Chief reads every bot's output, so its new reach needs the turn-you-started rule and an ADR)
