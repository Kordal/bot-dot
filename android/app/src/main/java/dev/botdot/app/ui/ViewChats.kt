package dev.botdot.app.ui

import dev.botdot.app.answerview.ViewBubble
import dev.botdot.app.data.ChatOrder
import dev.botdot.app.data.ChiefMessage
import dev.botdot.app.data.GroupItem
import dev.botdot.app.data.Run
import dev.botdot.app.data.Unread

// A chat's messages as its answer views read them (#1628, ADR 265): which bot message is the newest one a view may answer,
// and the owner's message after each. Only the order and who spoke matter; the shared rules are ViewForm's.

/** [Run]s drawn as a reply to the owner: a run that ended, whole, and is no talk between bots. */
private fun Run.isBetweenBots() = (fromBot != null && trigger == "bot" || startedBy == "chief") && status == "success" && notificationAudience != "owner"

/** A bot's chat: each run's owner message (what they typed, and what they steered into it), then its reply; [later] are the owner's messages still on their way. */
internal fun botBubbles(runs: List<Run>, later: List<String>): List<ViewBubble> = buildList {
    ChatOrder.rounds(runs).flatten().forEach { r ->
        if (Unread.asked(r) == Unread.Asked.MINE) add(ViewBubble.owner(r.prompt))
        r.steered.filter { it.fromBot == null }.forEach { add(ViewBubble.owner(it.text)) }
        add(ViewBubble.bot(r.id, working = r.isRunning, problem = !r.isRunning && r.status != "success", folded = r.isBetweenBots()))
    }
    later.forEach { add(ViewBubble.owner(it)) }
}

/** The id of the Chief's message at [index] of the chat [chatId]: the Chief has several chats, and what a view remembers is kept by this id. */
internal fun chiefViewId(chatId: String?, index: Int) = "${chatId.orEmpty()}:$index"

/** The Chief's chat: a bot message is the Chief's own or a report; a message of the owner is theirs. Ids are [chiefViewId]s, the messages' places in the chat from [first]. */
internal fun chiefBubbles(chatId: String?, messages: List<ChiefMessage>, first: Int, later: List<String>): List<ViewBubble> = buildList {
    messages.forEachIndexed { i, m ->
        when (m.role) {
            "user" -> add(ViewBubble.owner(m.text))
            "chief", "report" -> {
                m.steered.filter { it.fromBot == null }.forEach { add(ViewBubble.owner(it.text)) } // steered into the reply: drawn before it
                add(ViewBubble.bot(chiefViewId(chatId, first + i), working = m.pending, problem = m.failed))
            }
        }
    }
    later.forEach { add(ViewBubble.owner(it)) }
}

/** A group's chat, in the order it is read: the owner's messages and each member's reply. */
internal fun groupBubbles(rows: List<GroupItem>, later: List<String>): List<ViewBubble> = buildList {
    rows.forEach { x ->
        when (x) {
            is GroupItem.Message -> if (!x.message.byChief) add(ViewBubble.owner(x.message.text))
            is GroupItem.Reply -> add(ViewBubble.bot(x.id, working = x.run.isRunning, problem = !x.run.isRunning && x.run.status != "success"))
        }
    }
    later.forEach { add(ViewBubble.owner(it)) }
}
