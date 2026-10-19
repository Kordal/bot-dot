---
name: memory-setup
description: "Set up, check or fix botdot's memory system: the weekly memory review, how long past runs stay searchable, meaning-based search with llama.cpp and bge-m3, and memory changes waiting for the user's OK. Use when the user asks to set up, turn on, check, tune or troubleshoot memory, recall, the memory review or meaning search, or asks why bots don't remember something."
---

# Setting up botdot's memory

botdot's memory has four parts. You set them up with `memory_status`, `set_memory_settings`, `download_search_model` and `review_memory`.

Memory has no screen in the apps: the user asks you, and you answer and change it by chat. What a bot or you hold is not setup: for "what does Coder remember?", "correct that", "forget that", use `list_notes`, `recall`, `remember`, `update_note`, `remove_note`, `restore_note` and `forget`, as your instructions under "Memory" say. Never send the user to a memory page or to Settings for it.

| Part | What it is | Default |
|---|---|---|
| Notes | Each bot's own notes, your own, and the shared notes every bot reads. Pinned notes (up to 30 in each place) are in every prompt; the rest are found with recall. | On, always |
| Past runs | Every finished run is searchable by the bot that did it (and by you). | Kept 12 months |
| Weekly memory review | A short run per bot that tidies its notes and reports in its chat. At the same time, your own review: how-tos in your notes and the shared notes, and skills a bot wrote that other bots could use, each proposed as a skill on a card in Needs you. | On, Sundays 03:30, Opus 5.5 |
| Meaning-based search | Also finds rephrasings ("went down" for "crashed", even across languages) with the bge-m3 model in llama.cpp, run locally by botdot. | On in the Docker image, off elsewhere |

## Steps

1. **Look first.** Call `memory_status`. Never guess the current setup.

2. **Weekly review.** If it's off, turn it on with `set_memory_settings` (`review.enabled: true`), unless the user said they don't want it.
   - Keep the day, time and model unless the user asks for something else.
   - Say in one line that it only runs for bots that did at least 3 runs since their last review.
   - Your own review runs at the same time when your notes, the shared notes or a bot's skills changed since the last one. It changes nothing by itself: each how-to becomes a card in Needs you (the skill's text, which bots get it, which notes it replaces), and a bot's skill can be proposed for other bots. The user's yes creates or gives the skill and removes the notes it replaces; a no is not proposed again. botdot writes one line per proposal, or "nothing to change", in your chat.

3. **How long past runs stay searchable.** Keep 12 months unless the user asks otherwise (`retentionDays`: 90, 180, 365, 730, or 0 for always).

4. **Meaning-based search.** It uses llama.cpp's `llama-server` with the bge-m3 model, which covers over 100 languages (Polish included). botdot starts the server itself; nothing leaves the machine.
   - **botdot runs from its Docker image:** llama.cpp and the model are already inside, and it is on unless the user switched it off. If it is off there, the user chose that: switch it on only when they ask for it.
   - **llama.cpp isn't installed** (`llamaServerInstalled` is false): you can't install software. Tell the user, then stop this part:
     - Easiest: run botdot from its Docker image (`docker compose up -d --build`).
     - Mac: `brew install llama.cpp`
     - Linux: install llama.cpp from their package manager, or use the official release binaries from github.com/ggml-org/llama.cpp.
   - **Installed, but the model isn't downloaded:** ask the user in one line: "It needs a one-time download of about 635 MB (the bge-m3 model, from the llama.cpp project). OK?" Only after a clear yes, call `download_search_model` with `userConfirmed: true`. It waits until the download is done.
   - **Both are there:** switch it on with `set_memory_settings` (`meaningSearch.enabled: true`). botdot starts the server, and indexing runs in the background; `memory_status` shows how far it is ("indexed X of Y"). Don't wait for it to finish.
   - **`lastError` is set:** explain it in plain words, and suggest the fix.

5. **Waiting for the user's OK.** If `waitingForUsersOk` is more than 0, tell the user that some memory changes are waiting for them in Needs you. You can't approve them yourself, and must not.

6. **First review (optional).** For bots with many notes, or many runs and no review yet, offer to run a review now. Run `review_memory` only after the user agrees, and say it reports in each bot's chat. For your own notes and the shared notes, `review_memory` with `botId: "chief"` runs your review now: say its proposals wait in Needs you and botdot reports in this chat.

7. **Report.** Finish with a short summary in plain words:
   - what's on
   - what you changed
   - anything the user still needs to do (install llama.cpp, approve changes)

## Rules

- **Only pass what changes** to `set_memory_settings`; leave everything else as it is.
- **Downloads need the user's yes in this chat,** always.
- **No secrets** (passwords, keys, tokens) go into any note, shared or not.
- **The shared notes reach every bot.** Only lasting facts about the user as a person go there, like their name, city, time zone, family or accounts, and only when the user tells you. What is about one bot's work goes with that bot; how the user wants the team run goes in your own notes.
- **Say it simply.** Don't show tool names, JSON or cron expressions to the user.
