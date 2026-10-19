# Memory test report — 2026-09-28

Memory testing found **six distinct defects**, reproduced by ten failing assertions. The tests exercise the real SQLite store, HTTP server, bot and Chief MCP processes, and the existing local bge-m3 model. Application code has not been changed to hide or fix these failures.

Branch: `codex/test-memory`, tested against application commit `9e4b24d`. Runtime: Node 26.8.1 on macOS.

## Results

| Run | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Original suite, before adding memory tests | 113 | 0 | 3 |
| New memory tests, including real bge-m3 | 31 | 10 | 0 |
| Entire suite with new memory tests and real bge-m3 | 144 | 10 | 3 |

The complete run contained 157 tests and finished in 129 seconds. The coverage collector reported `lib/memory.js` at 100% lines, 89.09% branches and 93.52% functions; `lib/embed.js` at 64.67% lines, 65.22% branches and 73.91% functions. These figures describe exercised code, not behavioral correctness or live-agent reasoning coverage.

The three original skips require Linux and root. The real-model test is opt-in and skips when `BOT_DOT_TEST_EMBED_MODEL` is unset. The ten failing tests are ordinary failing assertions, not skipped checks or expected-failure markers: a future fix should turn them green.

All writes used generated test data in temporary directories. The existing GGUF model was read without modification. No production bot, chat, memory database, account, or configuration was changed.

## Confirmed defects

### 1. Editing a note during embedding can permanently retain its old meaning

**Reproduction:** start embedding `Violet original`, hold the embedding response, change the note to `Submarine replacement`, then release the response. The next background indexing pass reports no missing work. Searching `petal` returns the submarine note using the original violet vector.

**Cause:** `embedPending` snapshots the text, awaits the embedding service, then writes the result without checking that the source record still has the same text/version. The edit invalidates any existing vector before the in-flight job inserts its stale result.

**Impact:** semantic recall can return unrelated edited notes and miss their new meaning until another edit happens.

**Fix direction:** associate embeddings with a content hash/version; after the asynchronous request, only store vectors whose source still matches. Apply the same guard to run reindexing and deleted records.

Evidence: [race test](../../test/memory-semantic.test.js), test name `REGRESSION: editing a note during embedding must not permanently attach a stale vector`; [embedding implementation](../../lib/memory.js), `embedPending`.

### 2. `read_run` promises a complete run but returns truncated search data

**Reproduction:** finish a run with a reply longer than 7,000 characters and a unique final-resolution marker at the end. Chief `get_run` returns the intact answer. Bot `read_run` omits the marker.

**Cause:** `/self/session/run` reads the memory index, where `indexRun` clips replies to 6,000 characters and prompts to 1,500. There is no bot tool to retrieve the remainder, despite `read_run` saying it reads a past run “in full.”

**Impact:** a bot can retrieve an earlier report yet never see its conclusion or later details.

**Fix direction:** keep bounded excerpts in recall results, but have `read_run` load the durable full run record after applying the existing ownership and exclusion checks.

Evidence: [MCP integration test](../../test/memory-api.test.js), test name `REGRESSION: read_run must retrieve the complete answer it advertises, including its tail`; [self endpoint](../../server.js), [indexing](../../lib/memory.js), [tool description](../../lib/self-mcp.js).

### 3. A rebuilt index does not recover existing Chief chats

**Reproduction:** create a bot run and a Chief conversation, verify both are recallable, stop the disposable server, remove only its generated memory database, and restart. Bot history is indexed again; the Chief conversation remains intact on disk and through the chat API but returns zero recall hits.

**Cause:** startup backfill enumerates bot run files only. Chief replies enter the index only when a new reply finishes.

**Impact:** recovering a missing index loses recall of earlier Chief conversations. The same omission also matters when a version change clears the FTS index.

**Fix direction:** include durable Chief chat records in backfill, retaining stable message identifiers and deleting records for chats that no longer exist.

Evidence: [restart reproduction](../../test/memory-api.test.js), test name `REGRESSION: rebuilding a missing memory index must recover existing Chief chats as well as bot runs`; [startup indexing](../../lib/bots.js), `startMemoryIndex`; [Chief reply indexing](../../lib/chief.js).

### 4. Edits bypass the pinned-memory character budget

**Reproduction:** pin 30 short notes, then expand each through the normal edit operation while keeping every note below its individual 400-character limit. Pinned text reaches **11,780 characters**, although the advertised combined budget is **5,000**.

**Cause:** `addNote` makes room; `editNote` changes text without rechecking the pinned set.

**Impact:** ordinary corrections can inflate the prompt on every later run, undermining the bounded-memory design.

**Fix direction:** enforce the same combined budget during edits, preserving owner pin locks and explicitly handling an edit that cannot fit.

Evidence: [budget reproduction](../../test/memory.test.js), test name `REGRESSION: editing pinned notes must keep the prompt within its character budget`; [note editing](../../lib/memory.js), `editNote`.

### 5. A failed pin changes unrelated notes

**Reproduction:** use 4,800 characters of owner-locked pins plus one ordinary 100-character pin. Attempt to pin another 300-character note. The operation rejects because the locked notes leave insufficient room, but the existing 100-character note has already been unpinned.

**Cause:** `makeRoom` mutates the pinned set while looking for room. `setPinned` does not roll those mutations back when making room fails.

**Impact:** a rejected action silently changes which memories enter future prompts.

**Fix direction:** determine whether enough room can be made before mutating, or make the entire pin operation transactional and roll it back on failure.

Evidence: [atomicity reproduction](../../test/memory.test.js), test name `REGRESSION: a refused pin must not silently unpin unrelated notes`; [pin implementation](../../lib/memory.js), `makeRoom` and `setPinned`.

### 6. Semantic index accounting includes removed or excluded records

**Reproduction:** embed one record, then remove its owner, delete its bot's indexed runs, delete its Chief chat, prune it through retention, or exclude it. Each independent case reports **1 indexed of 0 eligible records**.

**Cause:** those paths do not reconcile the embeddings table, and `semanticStatus` counts all embeddings against only active notes and non-excluded runs.

**Impact:** misleading progress/status counts and retained orphan vectors after deletion/pruning. The scope joins correctly prevent these records from being returned; these tests did not find a recall privacy leak.

**Fix direction:** clean up vectors for deleted/pruned source records and count only eligible vectors in status. An excluded run's retained vector must not count as an active indexed item.

Evidence: [five cleanup/accounting tests](../../test/memory-semantic.test.js), named `REGRESSION: semantic index accounting stays valid after …`; [storage and status implementation](../../lib/memory.js).

## What was exercised

| Surface | Checks |
| --- | --- |
| Bot MCP | `remember` for own/shared and pinned/searchable notes; `update_memory`; `forget`; `set_pin`; `recall` with default/everything, notes, runs and day filters; `read_run`; tool discovery and initialization |
| Chief MCP | `recall` across bots and its own chats; bot/shared/kind/day filters; `get_run`; `list_runs`; shared add/update/remove; `memory_status`; `set_memory_settings`; `review_memory`; model-download consent rejection |
| Storage and lexical search | Notes, topics, shared facts, prompts, replies, steps and learned facts; stemming, prefixes, diacritics and query punctuation; bounds, date windows, ranking and usage counters |
| Memory lifecycle | Whitespace and duplicate handling; invalid writes; 1,000-note cap; pin count/character pressure; dated edited/deleted versions; restore; provenance; legacy migration and backup; consistent SQLite snapshot |
| Permissions | Foreign notes/runs rejected even by known IDs; owner/shared pins protected; invalid and expired run tokens rejected; learning-off writes blocked; shared proposals gated by owner approval; Chief cannot approve them |
| Run/chat retrieval | Full-run expansion, exclusions, owner chat search, all-term matching, Chief chat deletion, retention, backfill, restart persistence, next-run prompt injection, review context/model and completion bookkeeping |
| Deterministic semantic tests | Real HTTP transport with controlled vectors; normalization and out-of-order batch results; scope/kind/date/exclusion filtering; invalidation, concurrent edits/batches, retry, outages, recovery and cleanup accounting |
| Real bge-m3 | English paraphrase, Polish-to-English retrieval, semantically related past-run retrieval, unrelated-query rejection, foreign-bot isolation and lexical fallback after stopping llama-server |

Real-model queries and expected top results:

| Query | Expected top result | Result |
| --- | --- | --- |
| `decaffeinated beverage` | “The owner prefers drinking coffee without caffeine.” | Pass |
| `W jakim mieście mieszka właściciel?` | “The owner lives in Warsaw, Poland.” | Pass |
| `storage service outage recovery` | Run: “The database server stopped responding and had to be restarted.” | Pass |

All three queries were first verified to return no lexical matches with meaning search disabled. The Polish query also returned the coffee note as a lower-ranked result. Top-result retrieval passed; this small sample is not evidence of perfect semantic precision.

The bot/Chief integration tests deliberately drive the actual MCP tools themselves; Claude is the repository's offline stand-in. They verify retrieval, permissions, persistence and prompt construction, not whether a live Claude model spontaneously chooses to recall, interprets every historical version correctly, or resists every prompt injection. Weekly review execution/configuration and proposals were tested; autonomous review quality and the real calendar tick were not. Browser/native UI interaction and the 635 MB download were not exercised. No model download was necessary.

## Reproduce

Run the memory suite with an installed local model:

```sh
BOT_DOT_TEST_EMBED_MODEL="$PWD/data/models/bge-m3-q8_0.gguf" npm run test:memory
```

Set `BOT_DOT_TEST_EMBED_BIN` if `llama-server` is not on PATH. Without the model environment variable, the deterministic tests and real HTTP/MCP integration tests still run; only the real-model smoke test skips.

Run the full suite with the same model:

```sh
BOT_DOT_TEST_EMBED_MODEL="$PWD/data/models/bge-m3-q8_0.gguf" npm test
```

These commands currently return a nonzero status because of the ten reproducible failures described above.

The recorded full-suite run enabled Node's coverage collector:

```sh
BOT_DOT_TEST_EMBED_MODEL="$PWD/data/models/bge-m3-q8_0.gguf" \
  node --experimental-test-coverage \
  --test-coverage-include='lib/memory.js' --test-coverage-include='lib/embed.js' \
  --test --test-concurrency=4 'test/*.test.js'
```
