# ADR-185: A card that holds nothing waits for the morning brief

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots")
- **Changes:** ADR 056 (one card, one ring) for a card that holds no run: it no longer rings
- **Keeps:** ADR 175 (the brief and its daily cap); every card that holds a run, the Chief's cards, room cards, logins, payments and Vault cards ring as before

## Context

A bot's ask that no run waits on (a permission for its next task, a skill, a tool, a change to a bot, an app's action whose run already ended) rang the phone at once. Nothing was lost by waiting, yet the owner was called away to answer it.

## Decision

- **Which cards.** An ask in the `asks` feed has `waitsForBrief: true` when the Chief's looks are on (`unaskedPerDay` is not 0) and no run waits on it: not the Chief's, not one asked from a Chief chat, not a `chief-action`, a computer step or a room's card, and a connected app's action only once its run no longer waits (`stoppedAt`).
- **No ring.** The web page's push follower and the Android app ring no notification for a card whose asks all have `waitsForBrief`. The card is in Needs you as before, and an older notification of it still closes when it is answered.
- **In the brief.** The Chief's first look of the day is given these cards (at most 20, each with its bot and since when) and names them under "needs your decision".

## Alternatives

- **Hold every card until the brief.** Rejected: a run that waits would stall for hours.
- **A setting per card kind.** Rejected: one more thing to mind; with the looks off, every card rings as before.

## Consequences

- The phone rings for what holds work up now; the rest comes once, in the morning.
- With the looks off, nothing changes.
