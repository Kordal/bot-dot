# ADR-243: Two runs that ask keep two questions

- **Status:** Accepted (2026-11-14, the owner: "When two instances of the same bot asked me questions that I need to answer (the card) the first card disappeared and was overwritten by the 2nd", #1377)
- **Supersedes in part:** the "newest reply" rule of a bot's open question (docs/api.md, A bot that asks; SURE-001)
- **Builds on:** [ADR 062](062-a-message-to-a-busy-bot-starts-beside-the-run-that-is-going.md), [ADR 211](211-a-bot-asks-in-one-place-at-a-time.md)

## Context

A bot's open question was the question of its newest reply to the owner. That held while a bot ran one run at a time: a newer reply was the next turn of the same conversation. Since ADR 062 up to three runs of one bot go at once. Two of them that ask the owner something end one after the other, and the second reply took the place of the first question: its answer buttons or its card of questions were gone, though nobody had answered it. A tapped answer to the older question could not reach it either: the server took a tapped answer as one to the newest reply, and a message to a busy bot could be sorted into the other run at work.

## Decision

- **A bot can have several open questions.** A reply that asks stays open until it is answered, as before, or a newer reply ends it. A newer reply ends it only when its run started after the question reached the chat: the next turn, as before. A run that went beside it ends nothing, and neither does the run of an answer to another of its questions.
- **An answer names its question.** A tapped answer and a sent card of questions carry the run they answer (`answers`); that question ends alone, and the others stay. A typed message names none and ends them all, as before. Reply on a run (`replyTo`) names that run too.
- **An answer goes to a run of its own.** It is never sorted into another run at work (ADR 106): it is handed the question it answers.
- **The API keeps its shape.** `asks` on a bot is the newest question as before, and lists every open one in `open` (`asks-several`). The web page and Android draw the answers under each of them; an older app draws them under the newest only, as before.

## Alternatives

- **One question per bot, the newest, with the older one in Needs you.** Rejected: the owner answers where the question stands, and an answer typed for one would end the other.
- **Every reply that asks stays open until a message names it.** Rejected: a bot's next turn that asks again would leave its earlier, stale buttons beside the new ones.

## Consequences

- A typed answer to one of two questions ends both: the owner taps or uses Reply to answer one of them alone.
- An older app that taps the older question's answer sends no `answers`: the server takes it as a message as before.
