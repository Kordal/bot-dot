# ADR-019: The botdot server gives the turns in a group

- **Status:** Accepted
- **Owning task:** GRP-002

## Context

[Milestone 10](../product/milestone10.md). In a group the owner writes once and several bots may answer, and the owner chose that the bots also pass work among themselves ("Watch the team work"), with "a quiet, safe chat first". Somebody has to decide who speaks next and when it ends.

Today bots reach each other with `message_bot`: up to twenty hops, each message a run in the other bot's own chat (`lib/messages.js:12`, `lib/bots.js:1919-1973`). A bot does one thing at a time and the owner's message waits ([ADR 011](011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md)); a Stop ends one run, or the runs one Chief reply started, through a link kept in memory only ([ADR 012](012-a-run-keeps-who-ended-it-and-a-stop-ends-what-its-turn-started.md), `lib/chief.js:1408-1427`). A run that has nothing to say is known only for a scheduled run (`quietRun`, `lib/problems.js:59`). A mention sends nothing (`CONTEXT.md`), and is written `@IssueWriter`, the name without its spaces (`public/mentions.js:23-33`).

The products surveyed differ exactly here ([research note](../product/milestone10-research.md), "Existing solutions"): every member answers, only a mentioned one, the bots decide, or a model chooses. Grok Bot, the owner's example, lets the bots decide and its makers report "duplicate work and noisy updates". OpenClaw counts turns per message of the person and lets a member pass.

On 2026-10-08 the owner chose, on the prototype: every member reads a message and answers or passes; a mention picks who answers; a member hands the work on by naming a member; the group stops after 12 replies without the owner.

Tried on real Claude the same day (17 turns, three bots, no tools; research note, "Stage 4"): told these rules in the prompt, a bot passed with the one word where it had nothing to add, a mention brought one bot, and the work was handed on and ended by itself each time. Once in two runs a question ("All clear?") was taken as an order and the three bots did the work.

## Decision

- **The botdot server keeps the line of turns for each message of the owner's.** No bot starts another's turn itself.
- **Without a mention every member gets one turn,** in the group's order. **With mentions, only the members named,** in the group's order.
- **A turn is handed the group's chat as it stands** ([ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md)), so the turns of one message come one after another, never at the same moment.
- **A pass** is a turn whose whole reply is the one word the prompt gives for it. It shows nothing, is no new reply and names nobody.
- **A hand-on** is a member named in a reply, read by the server with the mention rules, among the group's members only. That member gets the next turn, unless one already waits for it in this line. A name that is no member gives nobody a turn.
- **The line ends** when no turn is left. A reply that names nobody adds none.
- **After 12 replies since the owner's last message the line stops,** and the group's chat says so. "Go on", sent by the owner, lets it continue and counts from one; so does any message of the owner's. Passes are not counted.
- **A turn waits in its member's own queue** ([ADR 011](011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md)) as a kind of its own, kept across a restart and a signed-out Claude. A busy member does not hold up the members after it in the line; its turn is given when it is free. Two messages of the owner's have two lines, which can be at work side by side.
- **A turn handed on by a member is not a message from a teammate.** It does not use `fromBot` or the chain of `message_bot`: it is a turn of the group, which says who handed it on.
- **"Stop all" goes by the stored link** of [ADR 018](018-a-group-is-a-chat-of-its-own-and-a-turn-is-a-run-of-its-member.md): every run of the group at work is ended by the owner, and the turns that wait in its lines are dropped. A message of the owner's that waited for a busy member is the owner's and starts next, as in a bot's chat.
- **In a group a mention gives the turn.** Everywhere else it sends nothing, as today.
- **`message_bot`, the inbox and the twenty hops are unchanged.** In a group's turn the prompt tells a bot to name the member in its reply instead.

Resolved by GRP-002 (2026-10-08):

- **The word for a pass is `PASS`,** the one the spike on real Claude used. A turn is a pass when its run ended well and its whole reply is that word, in any case, alone or with the signs a model puts around a word (`PASS.`, `**PASS**`), with no file attached and no question. Its run is marked `passed` and is `quiet`, as a scheduled run that reported nothing is: every reader that leaves out a quiet run leaves out a pass, and it never counts as a new reply. Its record keeps the word as its `result`.
- **The line is kept on the owner's message** (`group-messages/<id>.json`, `lib/group-chat.js`): the members it was for (`to`), those whose turn has not come (`line`) and the turns given, each with the id of its run (`turns`). A turn is written there before its run exists. After a restart a member with a turn written has had its turn, whatever became of the run, so no member has two on one message; a turn that was written and is nowhere, neither a run nor waiting, is given again under the same id.
- **Where the count is kept is GRP-004's to say,** with the limit it delivers. What it counts is there for it: a group's replies are its turns that ended and are no pass, each with the message it belongs to (`groupMessageId`).
- **A failed turn leaves a failed run under its member's name, and its member has had its turn.** The line goes on with the next member. So does a turn that could not start, and one that could not even be queued: each is a failed run of the group with the reason. A paused member, a deleted one and one that has left the group are skipped and leave nothing, also one that became so while its turn waited for it: the turn is taken out of its queue as it comes up.
- **One turn of a message is at work at a time, a turn that waited included.** A turn that waited for a busy member comes before the members after it once that member is free. It does not start beside another turn of its message: in its member's queue it is passed over while one is at work, and holds up nothing else that waits for that bot. Two messages of the owner's have two lines, and those can be at work side by side.
- **A waiting turn is the kind `turn` in its member's queue.** It is the owner's message to the group: it starts as early as the owner's own message to that bot, and shares its ten places. A message for whose member ten of the owner's wait already is refused whole, with the sentence of a bot's chat, and nothing is kept.
- **While Claude is signed out no turn is given.** The message is taken and its line waits; it goes on with the sign-in. A turn that already waited in a queue stays there, as any work does.
- **A mention of a member's job names that member.** A message that mentions only bots that are no members names nobody, so every member has a turn. Two members that answer to one mention name, which a rename since they joined can cause, both have the turn.
- **The owner takes a message back while none of its turns has started:** its waiting turns leave the queues and the message's key is free again. A Stop on one waiting turn takes that turn alone; its message stays and keeps its key.
- **"Stop all" ends a line by its message:** every run at work whose `groupId` is the group's is ended as the owner's Stop, and each message with a turn that started loses the turns that wait and those to come, and is marked stopped. A message none of whose turns has started is left as it is.
- **A group's new replies have an event of their own, `group_unread`,** and so have its messages (`group_message`, `group_message_gone`). `unread` is an event an app from before groups acts on ([ADR 018](018-a-group-is-a-chat-of-its-own-and-a-turn-is-a-run-of-its-member.md)). `group_run_finished` carries `new` for a new reply and `notify: false`; since GRP-003 a reply that asks the owner has `notify: true` ([ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md)).
- **A turn is handed the owner's message alone until GRP-003:** nothing of the bot's own chat with the owner, and its inbox is left alone ([ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md)).
- **Deleting a group drops the turns that wait for its members.** A run of it that is at work ends by itself; its reply is in no chat.

Resolved by GRP-004 (2026-10-08), which delivers the hand-on and the limit:

- **The wording has one place: `RULES` in `lib/group-chat.js`,** four sentences that `turnNote` puts into a turn's prompt and nothing else repeats. Answer what is yours to add and pass otherwise; a question is answered and not acted on; name a member, as a mention is written, only to hand the work on, with what it needs, and write its name without the "@" when merely speaking of it; name nobody when the work is done or the next step is the owner's, and never reply only to thank, agree or confirm. It also says never to use `message_bot` for a member of the group. A turn that carries on after the owner's OK is told how to hand on and how to end, and not to pass.
- **A reply is read for the members it names as its line goes on,** with the rule that reads the owner's message (`namedIn`): a mention of a member, or of a member's job, in any case. Each turn's reply is read once (`read` on the turn), also when botdot restarted between the reply and the reading. The reply of a run that carried on is no turn of the line and has no such mark: it is read as the run ends, and a restart in that moment loses its hand-on. Only a reply hands on: a pass, a failed and a stopped turn name nobody, and so does a bot that has left the group. Since GRP-010 a reply is read without what the apps draw as code, a span between two backticks and a block between two lines of three (`withoutCode`): the apps draw no mention there, and a member that writes "`@Coder`" speaks of a name. The owner's own message is read whole.
- **The member named goes to the end of the line,** with who handed the work on (`handed` on the message, `by` on the turn), unless it is the writer itself or a turn already waits for it there: in the line, in its queue, or lost. So a member that waits for its first turn of a message has it as the owner's, and a member that had its turn can have another. A turn handed on is asked with the owner's message, is told who handed it on and that this member is a bot, and its run has `handedBy`: a run a teammate started ([ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md)).
- **A handed-on turn that waits for a busy member is the kind `turn` like any,** and shares the owner's ten places. A member for whom ten wait already gets a failed run with that reason, as any turn that cannot be queued does; since GRP-010 the reason of a handed-on turn names who handed it on, and not "your messages".
- **The count is not kept: it is read.** A line's replies are the runs of its message in the run index that ended and are no pass, a failed and a stopped one too, and the reply of a run that carried on after the owner's OK; the count since the owner is that number less the number the message had at the last "Go on" (`wentOn`). At 12, with a turn still to come, the line stops (`limit` on the message). A line whose twelfth reply names nobody is done, and nothing is said.
- **A stopped line holds everything that waits in one place.** A turn that waited in a busy member's queue is taken out and stands first in the line again, so nothing of the line starts by itself; a waiting turn is also held in its queue for the moment between the twelfth reply and the stop. A restart and a signed-out Claude leave the line as it is. "Stop all" drops its turns as it drops any that wait. A line does not stop for members that get no turn: when all that waits is a member that left the group, was deleted or is paused, the line ends as any does, and a stopped line whose waiting members leave the group ends then (`membersChanged`). A member paused while the line is stopped has no such moment: the line stays stopped until "Go on", which skips it. (Until GRP-010 any save of the group, a pin or a rename too, ended such a line: `membersChanged` asked who still gets a turn, where it has to ask who is still a member.)
- **"Go on" is the owner's, by a route or typed.** `POST /api/group-chats/:id/go-on`, or a message that is the words "Go on" and nothing else while a line is stopped: no message is kept for it. Every stopped line of the group goes on, or the one named, and counts from one.
- **A new message of the owner's is a line of its own with its own count, and does not start a stopped line again.** The stopped line stays, with its "Go on", until the owner taps it or stops all. This reads "so does any message of the owner's" in the decision above as "counts from one", which is what the plan and scenario G22 say.
- **The reply of a run that carried on hands on too,** also when its line had ended: the line is open again for the member it names. That reply counts towards the 12, since the owner's OK on a card is no message to the group.
- **The stopped line is said once for the group:** `limit` on the group and on its chat, with the sentence to show ("The group stopped after 12 replies without you.", the words of the prototype) and who waits, and the event `group_limit`. It notifies nobody: only a card and a question ring in a group.

**The live walk** (G25, first run; 2026-10-08, `claude-opus-5-5`, Claude Code 2.1.293, three bots with file tools, a fresh group for each exchange, twelve exchanges, 67 turns, 8.5 minutes). The exchanges are in the Notes of GRP-004's plan.

- **"All clear?"** was answered and not acted on, three of three: Issue Writer answered and the others passed twice, all three answered in a sentence once. Nobody answered twice and no work started, where the first wording had started the work once in two.
- **A mention** brought one reply from the member named, three of three.
- **Work for three** was handed on and ended by itself, three of three, in five or six replies: after each member's first turn, Reviewer and Coder named each other until Reviewer had no finding, or Coder had fixed the last one, and named nobody. No reply thanked or confirmed.
- **Two bots told to keep correcting each other** were stopped by the limit at the twelfth reply, three of three, with the thirteenth turn waiting; the third member passed each time.
- **Not shown:** "Go on" (tested on the stand-in), a member naming another in passing (none did in 67 turns), and a turn that uses its tools: none called one.

## Alternatives

- **The bots decide among themselves with `message_bot`.** Nothing to build on the server. Rejected: the limit is twenty hops per chain and not per message of the owner's, the messages are folded into each bot's own chat, and nothing but a model's judgement ends the exchange.
- **Every member answers at the same moment.** The fastest. Rejected: no member reads another's reply, so the duplicates the survey reports are built in, and replies arrive in any order (OpenClaw).
- **A model chooses the next speaker** (AutoGen, LobeHub). One answer at a time, for one more model call per turn and a choice the owner cannot predict. Excluded by the scope.
- **Only a mentioned bot answers** (Poe, Open WebUI). The quietest and cheapest. Offered to the owner and not chosen.
- **A turn that waited starts as soon as its member is free, also beside a later member's turn.** Less to keep track of. Rejected: the later member would not have read the reply of the one before it, which is what the order is for.
- **Every member's turn put in its queue at once,** and the queues left to start them. Rejected: all would start together, the members that are free at the same moment.
- **The pass as an empty reply.** Rejected: a run that ends without a result line is a failure of Claude Code today (`unreadableReply`), and a model asked to say nothing writes a sentence about saying nothing.
- **Tools instead of words:** a bot calls `pass` or `hand_on`. Not open to a reply that merely names a bot. Kept as the way out if replies in real use name members without meaning to hand on: the spike saw none in 17 turns.

## Consequences

- **Every member runs once for a message without a mention,** also to pass. A group of six that has nothing to say is six runs, one after another. On real Claude a turn without tools took 2.5 to 6 seconds.
- **The limit is the only thing that ends two bots that keep naming each other.** Whether a bot ends the work by naming nobody is model behaviour; it rests on the prompt and is seen in the live walk (G25).
- **A stopped line can stand beside a newer line of the same group.** The apps show one "Go on" for the group; it starts every stopped line.
- **A reply that names a member in passing starts that member's turn.** The prompt says to name a member only to hand on.
- **`CONTEXT.md` changes the meaning of a mention** for a group, and gains turn, pass and hand on.
- **Two bots with the same short name cannot both be members,** or a mention could not tell them apart.
