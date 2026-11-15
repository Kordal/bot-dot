package dev.botdot.app.ui

import dev.botdot.app.data.Bot
import dev.botdot.app.data.Group
import dev.botdot.app.data.GroupMessage
import dev.botdot.app.data.Groups
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.TurnLine
import dev.botdot.app.data.TurnLines
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import dev.botdot.app.data.plainText

// What the app says of a group, in the words the web page uses for the same thing (public/groups.js), and where
// a group and a bot stand in the list. Nothing here asks the botdot server anything.

/** The grey of a bot that is gone, and of a group whose bots are all gone. */
internal const val GONE_COLOR = "#888780"

/** "Coder", "Coder and Reviewer", "Coder, Reviewer and Issue Writer". */
internal fun namesList(names: List<String>): String =
    if (names.size > 1) tr("{names} and {last}", "names" to names.dropLast(1).joinToString(", "), "last" to names.last()) else names.firstOrNull().orEmpty()

/** What a screen reader is told of the heads of who is next in a group, which carry no words: "Next: Reviewer and Issue Writer". */
internal fun nextWords(names: List<String>): String = if (names.isEmpty()) "" else tr("Next: {names}", "names" to namesList(names))

/** A member's name now, or as the server [said] it for a bot that is gone. */
internal fun memberName(bots: List<Bot>, botId: String?, said: String? = null): String =
    bots.firstOrNull { it.id == botId }?.name ?: said?.trim()?.ifEmpty { null } ?: tr("A bot")

/** A member's colour now, or as the server [said] it for a bot that is gone. */
internal fun memberColor(bots: List<Bot>, botId: String?, said: String? = null): String =
    bots.firstOrNull { it.id == botId }?.color ?: said?.trim()?.ifEmpty { null } ?: GONE_COLOR

/**
 * The line under a group's name in the list. [who]: the bot named before it ("Coder: …"), or "". [working]: a member
 * works, and the line is what it does. [asks]: a member asks the owner something, and the row has the mark in place
 * of the dots. [color]: the colour of the dots and of the mark.
 */
internal data class GroupLine(val who: String, val text: String, val working: Boolean = false, val asks: Boolean = false, val color: String = GONE_COLOR)

/**
 * What a group's row says: while a member works, who it is and its line; else "… asks" when a member asks
 * the owner something; else its newest reply, with the bot's name before it. [lines]: what the turns at work said.
 */
internal fun groupLine(g: Group, bots: List<Bot>, lines: Map<String, TurnLine>): GroupLine {
    val one = { text: String -> plainText(text).replace('\n', ' ').take(120) }
    val dots = memberColor(bots, g.last?.botId ?: g.members.firstOrNull { id -> bots.any { it.id == id } })
    val at = g.working.firstNotNullOfOrNull { id -> bots.firstOrNull { it.id == id } }
    if (at != null) return GroupLine(at.name, "${TurnLines.of(lines, g.id, at.id).ifEmpty { tr("Working") }}…", working = true, color = dots)
    g.asks?.let { a ->
        val text = one(a.text)
        return GroupLine("", tr("{name} asks", "name" to memberName(bots, a.botId, a.botName)) + if (text.isNotEmpty()) ": $text" else "", asks = true, color = memberColor(bots, a.botId))
    }
    g.last?.let { l -> return GroupLine(memberName(bots, l.botId, l.botName), one(l.text).ifBlank { if (l.status == "success") tr("Done.") else tr("Couldn't finish") }, color = dots) }
    return GroupLine("", "", color = dots) // nothing said yet: the row is its name alone (#636)
}

/** What the search box finds a group by: its name, its category and its members' names. */
internal fun groupSearchText(g: Group, bots: List<Bot>): String = dev.botdot.app.data.HomeSearch.groupText(g, bots)

/** Under a message of the owner's that waits for busy members: for whom. "" when it waits for nobody. */
internal fun waitsLine(m: GroupMessage, bots: List<Bot>): String {
    val names = m.waitsFor.map { memberName(bots, it) }
    return if (names.isEmpty()) "" else if (names.size > 1) tr("Waits until {names} are free", "names" to namesList(names)) else tr("Waits until {names} is free", "names" to namesList(names))
}

/** Under a message that waits while Claude is signed out: no turn is given until the sign-in. */
internal val WAITS_FOR_SIGN_IN: String get() = tr("Waits until Claude is signed in")

/**
 * A message none of whose turns has started, and that waits: for a busy member, or for Claude to be signed in. It is
 * drawn at the end of the chat, faded, with "Take back", as a waiting message in a bot's chat is.
 */
internal fun waitsWhole(m: GroupMessage, bots: List<Bot>, signedOut: Boolean): Boolean = !m.byChief && m.canTakeBack && (waitsLine(m, bots).isNotEmpty() || signedOut)

/** What stands under a message that waits whole. */
internal fun waitsWords(m: GroupMessage, bots: List<Bot>): String = waitsLine(m, bots).ifEmpty { WAITS_FOR_SIGN_IN }

/**
 * One working line at the end of a group's chat: its member's name, and what it is doing in the server's words.
 * [line]: what the feed and the chat said of its turn. [opening]: the turn's line as its entry in the chat's
 * `working` has it ([OpeningLine.ofRun]), until they said one.
 */
internal fun workingWords(name: String, line: TurnLine?, opening: String?): String = "$name · " +
    if (line?.held == true) OpeningLine.WAITING_FOR_OK else "${OpeningLine.text(line?.text).ifEmpty { OpeningLine.text(opening) }.ifEmpty { tr("Working") }}…"

/** A group with no message yet: its members, and that all of them read what is written there. */
internal fun emptyGroupWords(names: List<String>): String =
    if (names.isEmpty()) tr("Its bots are all gone. Add one, or delete the group.") else tr("{names}. What you write here, all of them read.", "names" to namesList(names))

/** Under the picker that makes a group from the chat of [bot]: how many are picked ([n]), with that bot. */
internal fun makeHint(n: Int, bot: String): String = dev.botdot.app.data.GroupMaker.hint(n, bot)

/** What a screen reader says of the small plus right of the name in a bot's chat. It has no words beside it. */
internal val ADD_A_BOT: String get() = tr("Add a bot to this chat")

/** Whether a group can be made from a bot's chat: the botdot server has groups, and there is another bot. */
internal fun canMakeGroup(features: Collection<String>?, otherBots: Int): Boolean = dev.botdot.app.data.GroupMaker.canMake(features, otherBots)

/** Under the picker that adds bots to a group of [members] bots called [name]. */
internal fun addHint(n: Int, members: Int, name: String): String = if (n > 0) trn(members + n, "{n} bot in {name}.", "{n} bots in {name}.", "name" to name) else tr("A group has two to six bots.")

/** A card's bot as Needs you names it when the card was asked in a group: "Coder in Dev". */
internal fun Named.inGroup(group: String?): Named = if (group.isNullOrBlank()) this else copy(name = dev.botdot.app.data.nameInGroup(name, group))

