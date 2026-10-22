package dev.botdot.app.ui

import dev.botdot.app.data.Bot
import dev.botdot.app.data.Group
import dev.botdot.app.data.GroupMessage
import dev.botdot.app.data.Groups
import dev.botdot.app.data.hasGroups
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.TurnLine
import dev.botdot.app.data.TurnLines
import dev.botdot.app.feed.plainText
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// What the app says of a group, in the words the web page uses for the same thing (public/groups.js), and where
// a group and a bot stand in the list. Nothing here asks the botdot server anything.

/** The grey of a bot that is gone, and of a group whose bots are all gone. */
internal const val GONE_COLOR = "#888780"

/** "Coder", "Coder and Reviewer", "Coder, Reviewer and Issue Writer". */
internal fun namesList(names: List<String>): String =
    if (names.size > 1) "${names.dropLast(1).joinToString(", ")} and ${names.last()}" else names.firstOrNull().orEmpty()

/** What a screen reader is told of the heads of who is next in a group, which carry no words: "Next: Reviewer and Issue Writer". */
internal fun nextWords(names: List<String>): String = if (names.isEmpty()) "" else "Next: ${namesList(names)}"

/** A member's name now, or as the server [said] it for a bot that is gone. */
internal fun memberName(bots: List<Bot>, botId: String?, said: String? = null): String =
    bots.firstOrNull { it.id == botId }?.name ?: said?.trim()?.ifEmpty { null } ?: "A bot"

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
    if (at != null) return GroupLine(at.name, "${TurnLines.of(lines, g.id, at.id).ifEmpty { "Working" }}…", working = true, color = dots)
    g.asks?.let { a ->
        val text = one(a.text)
        return GroupLine("", "${memberName(bots, a.botId, a.botName)} asks${if (text.isNotEmpty()) ": $text" else ""}", asks = true, color = memberColor(bots, a.botId))
    }
    g.last?.let { l -> return GroupLine(memberName(bots, l.botId, l.botName), one(l.text).ifBlank { if (l.status == "success") "Done." else "Couldn't finish" }, color = dots) }
    return GroupLine("", "No messages yet", color = dots)
}

/** What the search box finds a group by: its name, its category and its members' names. */
internal fun groupSearchText(g: Group, bots: List<Bot>): String = "${g.name} ${g.category} ${Groups.members(g, bots).joinToString(" ") { it.name }}".lowercase()

/** Under a message of the owner's that waits for busy members: for whom. "" when it waits for nobody. */
internal fun waitsLine(m: GroupMessage, bots: List<Bot>): String {
    val names = m.waitsFor.map { memberName(bots, it) }
    return if (names.isEmpty()) "" else "Waits until ${namesList(names)} ${if (names.size > 1) "are" else "is"} free"
}

/** Under a message that waits while Claude is signed out: no turn is given until the sign-in. */
internal const val WAITS_FOR_SIGN_IN = "Waits until Claude is signed in"

/**
 * A message none of whose turns has started, and that waits: for a busy member, or for Claude to be signed in. It is
 * drawn at the end of the chat, faded, with "Take back", as a waiting message in a bot's chat is.
 */
internal fun waitsWhole(m: GroupMessage, bots: List<Bot>, signedOut: Boolean): Boolean = m.canTakeBack && (waitsLine(m, bots).isNotEmpty() || signedOut)

/** What stands under a message that waits whole. */
internal fun waitsWords(m: GroupMessage, bots: List<Bot>): String = waitsLine(m, bots).ifEmpty { WAITS_FOR_SIGN_IN }

/**
 * One working line at the end of a group's chat: its member's name, and what it is doing in the server's words.
 * [line]: what the feed and the chat said of its turn. [opening]: the turn's line as its entry in the chat's
 * `working` has it ([OpeningLine.ofRun]), until they said one.
 */
internal fun workingWords(name: String, line: TurnLine?, opening: String?): String = "$name · " +
    if (line?.held == true) OpeningLine.WAITING_FOR_OK else "${OpeningLine.text(line?.text).ifEmpty { OpeningLine.text(opening) }.ifEmpty { "Working" }}…"

/** A group with no message yet: its members, and that all of them read what is written there. */
internal fun emptyGroupWords(names: List<String>): String =
    if (names.isEmpty()) "Its bots are all gone. Add one, or delete the group." else "${namesList(names)}. What you write here, all of them read."

/** Under the picker that makes a group from the chat of [bot]: how many are picked ([n]), with that bot. */
internal fun makeHint(n: Int, bot: String): String =
    if (n > 0) "${n + 1} bots in the group, with $bot." else "Pick one to five bots to join $bot. Its own chat stays as it is."

/** What a screen reader says of the small plus right of the name in a bot's chat. It has no words beside it. */
internal const val ADD_A_BOT = "Add a bot to this chat"

/** Whether a group can be made from a bot's chat: the botdot server has groups, and there is another bot. */
internal fun canMakeGroup(features: Collection<String>?, otherBots: Int): Boolean = hasGroups(features) && otherBots > 0

/** Under the picker that adds bots to a group of [members] bots called [name]. */
internal fun addHint(n: Int, members: Int, name: String): String = if (n > 0) "${members + n} bots in $name." else "A group has two to six bots."

/** A card's bot as Needs you names it when the card was asked in a group: "Coder in Dev". */
internal fun Named.inGroup(group: String?): Named = if (group.isNullOrBlank()) this else copy(name = "$name in $group")

/** The list: the big figures on top, then each category's heading, its bots and, after them, its groups (ADR 018). */
internal object ListLayout {
    const val PINS = "pins" // the row of big figures: drag a bot or a group above it to pin it
    private const val HEADING = "g:"
    private const val GROUP = "group:"

    fun heading(category: String) = "$HEADING$category"
    fun isHeading(key: String) = key.startsWith(HEADING)
    fun categoryOf(key: String) = key.removePrefix(HEADING)
    fun groupRow(id: String) = "$GROUP$id"
    fun isGroup(key: String) = key.startsWith(GROUP)
    fun groupOf(key: String) = key.removePrefix(GROUP)

    /** [pins]: the pinned bots' ids and the pinned groups' rows, in their order. [layout]: every row's key, top to bottom. */
    class Rows(val pins: List<String>, val layout: List<String>)

    /**
     * The rows as the server's places say them. A category is one of the bots' or of the groups': it can hold groups
     * and no bot. Bots never placed show A to Z. [folded]: the categories whose heading alone shows. [shared]: the
     * server counts the pinned bots and groups in one order (`pins-shared`, #276); else the pinned bots come first.
     */
    fun rows(bots: List<Bot>, groups: List<Group>, folded: Set<String>, shared: Boolean = false): Rows {
        val (pinned, rest) = bots.partition { it.pinned > 0 }
        val loose = groups.filter { it.pinned <= 0 }
        val categories = (rest.map { it.group } + loose.map { it.category }).distinct().sortedWith(compareBy<String> { it.isEmpty() }.thenBy { it.lowercase() })
        val layout = buildList {
            add(PINS)
            for (category in categories) {
                val named = categories.size > 1 || category.isNotEmpty()
                if (named) add(heading(category))
                if (named && category in folded) continue // dropped on its heading, a bot still lands in it
                addAll(rest.filter { it.group == category }.sortedWith(compareBy<Bot> { if (it.order > 0) it.order else Int.MAX_VALUE }.thenBy { it.name.lowercase() }).map { it.id })
                addAll(Groups.inCategory(groups, category).map { groupRow(it.id) })
            }
        }
        val pins = if (!shared) pinned.sortedBy { it.pinned }.map { it.id } + Groups.pinned(groups).map { groupRow(it.id) }
        // One order; a bot and a group on the same place (kept from before it): the bot first, as the server sorts them.
        else (pinned.map { Triple(it.pinned, 0, it.id) } + Groups.pinned(groups).map { Triple(it.pinned, 1, groupRow(it.id)) })
            .sortedWith(compareBy({ it.first }, { it.second })).map { it.third }
        return Rows(pins, layout)
    }

    /** Where a dragged row was let go: pinned at a place, or in a category at a place. Both count from 1, among its own
     *  kind, except a pinned place where the server shares one order: among the pinned bots and groups together. */
    sealed interface Place {
        data class Pinned(val at: Int) : Place
        data class In(val category: String, val at: Int) : Place
    }

    /**
     * The place of the row [key] in the list as it is drawn while dragging. A bot's place is among the bots and a
     * group's among the groups (docs/api.md, Groups): a group let go between two bots is the first group of that
     * category, and a bot let go under a group is the last bot there. Among the big figures, with [shared] (one order
     * for the pinned bots and groups, #276), either kind is counted among all of them. null for a row that is not in
     * the list.
     */
    fun dropped(layout: List<String>, pins: List<String>, key: String, shared: Boolean = false): Place? {
        val group = isGroup(key)
        val same = { k: String -> k != PINS && !isHeading(k) && isGroup(k) == group }
        val pinned = { k: String -> shared || same(k) }
        val pin = pins.indexOf(key)
        if (pin >= 0) return Place.Pinned(pins.take(pin).count(pinned) + 1) // a big figure, moved among the others
        val at = layout.indexOf(key)
        val line = layout.indexOf(PINS)
        if (at < 0) return null
        if (at < line) return Place.Pinned(pins.count(pinned) + 1) // above the big figures: the last of the pinned ones
        val head = (at - 1 downTo line + 1).firstOrNull { isHeading(layout[it]) }
        return Place.In(head?.let { categoryOf(layout[it]) }.orEmpty(), layout.subList((head ?: line) + 1, at).count(same) + 1)
    }

    /**
     * The update that puts a bot ([group] false) or a group at [place], as the list's drag and the keypad's send it:
     * `pinned` for a place among the pinned ones, else its category (a bot's `group`, a group's `category`) and its
     * `order` there, and `pinned: 0` when it was [pinned] and leaves the pinned ones.
     */
    fun change(place: Place, group: Boolean, pinned: Boolean): JsonObject = buildJsonObject {
        when (place) {
            is Place.Pinned -> put("pinned", place.at)
            is Place.In -> {
                put(if (group) "category" else "group", place.category)
                put("order", place.at)
                if (pinned) put("pinned", 0)
            }
        }
    }
}
