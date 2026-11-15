# ADR-245: Every bot writes in the i-have-adhd style by default

- **Status:** Accepted (2026-11-15, the owner: "I would like the bots to use the i-have-adhd skill out of the box")
- **Owning task:** [#1437](https://github.com/Kordal/bot-dot/issues/1437)
- **Builds on:** [the kit, 2026-10-22](../decisions/2026-10-22-the-skills-every-bot-gets-ship-as-one.md)

## Context

The owner wants every bot to write the way the open-source skill [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) describes: the next action first, numbered steps, the state restated, no tangents, concrete time estimates, wins made visible. The skill is MIT-licensed. It is an output style, not a task: it sets `disable-model-invocation: true` and expects to apply to every reply. A kit skill is only listed to a bot, which loads it "when it fits the task", so as one more kit skill it would almost never be loaded, and Claude Code would refuse to load it anyway.

## Decision

- **It ships in the kit as it is,** `bot-skills/skills/i-have-adhd/`, with its licence beside it and a line in `NOTICE`. An update is a copy of the upstream file.
- **A kit skill with `disable-model-invocation: true` is always on.** Its body (without frontmatter) goes into the prompt of every bot run, replay, Chief turn and Chief job (whose message reaches the owner), under one line saying botdot's other rules and the owner's rules win where they differ, not to bring the rules up unless the owner asks how the bot writes, and that "stop adhd mode" lasts for one chat only. It is not listed among the skills to load. A memory review, a checkup and the Chief's internal looks, whose words no person reads, go without it.
- **It is switched off for one bot as any kit skill:** `disabledSkills: ["kit:i-have-adhd"]`, which the Chief sets by chat (its tool says so). A bot with skills off (`useSkills: false`) does not get it either. The Chief always has it.
- **Every bot has it at once,** new and existing: the kit is read fresh each run, so nothing is migrated.

## Alternatives

- **Rewrite the rules into botdot's `REPLY_STYLE`.** Rejected: an update upstream would be a rewrite here, and the owner could not switch it off for one bot.
- **A hook as upstream ships it (SessionStart).** Rejected: botdot passes its prompt as a file per run; a second way in for one skill is more to keep.
- **List it as a skill to load.** Rejected: it is never the task, so it would not be loaded.

## Consequences

- Each prompt is about 7 KB longer. It sits among what is the same from run to run (after the reply style in a bot's run and the Chief's, before the task in a replay), so the prompt cache keeps it. The prompt bounds of the tests grow by 8,000 characters.
- The style applies on every account of every machine, not only the owner's; an account owner who wants it off for a bot asks the Chief.
- A rule of the skill that fights botdot's (the one short line a bot writes before working, cards, the reply sections) loses: the skill itself says the harness outranks it.
