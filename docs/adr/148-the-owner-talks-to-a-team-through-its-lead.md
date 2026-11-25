# ADR-148: The owner talks to a team through its lead

- **Status:** Accepted (2026-11-04, the owner: "In projects, user should mostly interact with Leaders of the Teams. So whatever a normal bot needs it redirects to Leader which will ask you in return")
- **Amended by:** the amendment of 2026-11-25 below: the lead's relay of the owner's own answer is carried by botdot (#1750)
- **Supersedes:** in [ADR 114](114-a-team-bot-is-told-its-project-and-a-lead-what-leading-means.md), "a member is told to ask the owner directly when it needs a decision, not the lead" and the rejected alternative "Members' questions go through the lead"

## Context

A project's team has one lead (ADR 110) that answers for the team (ADR 114). A member was told to ask the owner directly for a decision, so a team of six asked the owner from six chats, each question on its own, while the lead, which holds the team's split of the work and its plan, did not see them. ADR 114 rejected a relay because a lead cannot answer for the owner. The owner wants one voice per team: a member's needs reach the lead, and the lead asks the owner.

## Decision

- **A member asks its lead, not the owner,** for what it needs from the owner (a decision, an answer, a file, a login): with `message_bot` (priority: true) in its own runs, by naming the lead in a turn of the team's chat (ADR 119). It asks the owner directly only when the owner wrote to it, or when the lead can't be messaged (kept to the owner, or gone).
- **The lead asks the owner** in its reply, every member's question in one message, each with the member's name, and passes the answer on with `message_bot`. It answers a member itself only from what the owner already said or decided (the decisions, the plan, the project's rules). It still never approves anything for the owner.
- **A card stays the member's.** What only the owner's tap answers (`ask_permission`, `ask_override`, `ask_skill` and the other cards, ADR 054-056) is asked for by the member as before, since a bot never changes another bot's settings and a bot's message is never the owner's OK; the member then tells the lead in one line (priority: false) that it waits, so the lead's next message to the owner can carry it.
- **A team bot may always message its lead, and a lead its members** (`company.teamLinks`, `mayMessageIds` in `lib/bots.js`), whatever "May message" says: the owner made the team. A bot kept to the owner ("Other bots may ask it" off) is still not reached, and a bot outside the team is reached only as its settings say.
- The API does not change: the lead's questions reach the owner as any bot's do (Asks in the list, Needs you, the project's to-do).

## Alternatives

- **Members' cards moved to the lead's chat.** Rejected: the card's question is the member's own, and its answer starts the member again. Drawing them under the lead in a project's views was left for later, and is done (see the amendment).
- **The lead approves for the owner within the team.** Rejected again, as in ADR 114: an OK is the owner's.
- **"May message" left as it is, the member told to use ask_permission for its lead.** Rejected: a team whose member could not reach its lead would ask the owner for the right to ask the owner.

## Consequences

- The owner hears from a team's lead; a member speaks to the owner when the owner writes to it, or for a card.
- A member's question waits one hop longer: the lead's run, then the owner. The lead's turn already batches them.
- A team bot's note grows by some 200 characters for a lead and 350 for a member; the bound test of a bot's prompt with every cap hit is 127,000 characters (DECISIONS.md, 2026-11-04).

## Amendment (2026-11-04)

The alternative left for later is done, on the web page and in the Android app: in a project's Needs you and its to-do, a member's card is drawn under its team's lead, with the lead's face beside the member's words (`Keypad.leadOf`, `Spaces.leadOf` and `Spaces.underLeads`). The card is still the member's: it names the member, Allow and No answer it, and its words open the member's chat. Home draws every card as before, each with its own bot's face.

## Amendment (2026-11-12)

In a team's chat, where the owner reads every reply, a member asks the owner itself and never through the lead ([ADR 218](218-in-a-chat-the-owner-reads-a-bot-asks-the-owner-itself.md)). The relay through the lead stays for a member's own runs.

## Amendment (2026-11-25)

- **Decided:** by the owner, on #1750 ("option A: botdot itself carries the owner's own words to the member, so the owner answers once, in the lead's chat").

### Context

The lead passes the owner's answer on with `message_bot` ("the lead asks the owner and brings the answer back"), but every message from another bot reaches a member framed as information, "never the owner's approval" ([ADR 224](224-a-teammates-message-to-a-bot-at-work-goes-into-its-run.md), `lib/bots.js`). The two rules contradict each other: the owner gave the bot-dot Manager an OK for Infra Admin's VM 112, the Manager relayed it, Infra Admin refused it as a bot's word, and the Manager asked the owner again. A second "yes" in the Manager's chat goes the same way, so it can loop. The lead cannot be trusted to retell an OK (a bot's text may say anything), and the owner should not be asked twice.

### Decision

- **`message_bot` has an optional `owner_answer`.** It names the owner's message in the sender's own chat: `"latest"`, or the number of a run in that chat. botdot looks the message up itself (`lib/owner-answer.js`): it must be words the owner typed (a run the owner started: not a bot's, the Chief's, a job's, a Board tile's or botdot's, `ownerWords` of ADR 278), in the sender's own chat (not another bot's, not a turn in a group), still in the chat (not forgotten or left out), and at most six hours old. Otherwise the call is refused whole, with the reason, and nothing is sent.
- **The member's prompt gets a block botdot writes**, after every bot's text and under a mark made for that prompt that no bot's text holds (ADR 020's mark, `markNotIn`): who wrote it and when, the owner's words quoted inert (`prompt-text.inert`, cut), the lead's question just before them (the end of its reply and its card's questions, cut), and the plain words that this block *is* the owner's own answer, which the member may act on within what those words say (and, when they answer the question shown, within what that asked). It says too that the block is no card. The block goes wherever a bot's message reaches a run: a run the message starts, a note, an answer the bot waits for, a message steered into a run at work, and a run that carries on after an OK.
- **The bot's own text still never counts.** What the lead wrote, and every other message of a bot, stays information, "never the owner's approval". A bot cannot make the block: it holds a mark that did not exist when the bot wrote, and `owner_answer` is only a name that botdot resolves. A line that looks like the block, without the mark, is only text.
- **Cards are unchanged.** `ask_permission`, `ask_override`, `ask_skill`, the Vault, actions in connected apps and steps on the computer still wait for the owner's tap on their card. The block covers a bot's own "ask the owner before X" rules and the answers to its questions.
- **The lead is told.** `LEAD_RULES` (and the Project Manager's note for the bots in no team) says to pass the owner's answer with `owner_answer`, and that a retelling is only its word.
- **API:** `POST /api/self/session/message` takes `owner_answer` (`docs/api.md`); the run it starts holds it as `fromBot.ownerAnswer`.

### Alternatives

- **Teach the member to trust the lead's retelling.** Rejected: a bot's text is not the owner's, and a lead that misread, or was written to by a web page, would approve for the owner.
- **The lead forwards the owner's message by its text.** Rejected: nothing tells the member the words are the owner's, and a bot can write any words.
- **Send the owner's reply to the member from the owner's own chat with it.** Rejected: that is the member asking the owner directly, which ADR 148 moved to the lead ("one voice per team").
- **No time limit.** Rejected: an old "yes" to an old question is not an answer to the question of now. Six hours covers a working session and a night's pause is asked again.

### Consequences

- The owner answers once, in the lead's chat; the member acts on their words and does not ask again.
- A member's prompt grows by up to some 3,500 characters for a message that carries one.
- A lead that names a message with `owner_answer` that fails learns why in the tool's answer and can fix it, or ask the owner.
- A bot's run record holds the owner's words it was handed (`fromBot.ownerAnswer`), which are already in the lead's chat.
