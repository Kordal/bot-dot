package dev.botdot.app.ui

import dev.botdot.app.data.Bot
import dev.botdot.app.data.Group

/**
 * The keypad: the home of a window from 840 dp wide (#494). Its pages are the list's own order ([ListLayout.rows])
 * cut where a category begins, so the list and the keypad never disagree: the pinned bots and groups (in one order
 * where the server shares it, #276, else the bots first), each category A to Z with its bots and then its groups,
 * and Other last. Its keys answer a hardware keyboard. The
 * web page and the Mac draw the same rule. Nothing here asks the botdot server anything.
 */
internal object Keypad {
    /** The narrowest window, in dp, whose home is the keypad: three keys and a chat fit. Narrower ones keep the list. */
    const val WIDE = 840
    /** The narrowest window, in dp, that shows the list beside the chat. */
    const val LIST = 600
    /** The least and the most the chat beside the keypad takes, in dp; between them, two fifths of the window. */
    const val CHAT_LEAST = 360
    const val CHAT_MOST = 480

    /** The name of the first page, of the pinned bots and groups, and of the last, of the bots in no category. */
    const val PINNED = "Pinned"
    const val OTHER = "Other"

    /** What a window shows as its home: the list alone (a phone), the list beside the chat, or the keypad beside the chat. */
    enum class Home { PHONE, LIST, KEYPAD }

    /** The home of a window [width] dp wide. */
    fun home(width: Int) = when {
        width >= WIDE -> Home.KEYPAD
        width >= LIST -> Home.LIST
        else -> Home.PHONE
    }

    /** How wide the chat beside the keypad is in a window [window] dp wide. */
    fun chatWidth(window: Int) = (window * 2 / 5).coerceIn(CHAT_LEAST, CHAT_MOST)

    enum class Kind { PINNED, CATEGORY, OTHER }

    /** One place on a page: a bot, or a group. */
    sealed interface Key {
        /** As the list's rows name it: a bot's id, or a group's row ("group:<id>"), which is also whose chat is open. */
        val id: String
        /** It is on the Pinned page. */
        val pinned: Boolean

        data class OfBot(val bot: Bot) : Key {
            override val id: String get() = bot.id
            override val pinned: Boolean get() = bot.pinned > 0
        }

        data class OfGroup(val group: Group) : Key {
            override val id: String get() = ListLayout.groupRow(group.id)
            override val pinned: Boolean get() = group.pinned > 0
        }
    }

    /** [shared]: its keys are in one order of bots and groups (the Pinned page of a server with `pins-shared`). */
    data class Page(val name: String, val kind: Kind, val keys: List<Key>, val shared: Boolean = false)

    /**
     * The pages, first to last, with their keys in the order of the list's rows. A page with no key is left out.
     * [shared]: the server counts the pinned bots and groups in one order (`pins-shared`, #276).
     */
    fun pages(bots: List<Bot>, groups: List<Group>, shared: Boolean = false): List<Page> {
        val rows = ListLayout.rows(bots, groups, folded = emptySet(), shared = shared)
        val botOf = bots.associateBy { it.id }
        val groupOf = groups.associateBy { ListLayout.groupRow(it.id) }
        fun key(row: String): Key? = botOf[row]?.let { Key.OfBot(it) } ?: groupOf[row]?.let { Key.OfGroup(it) }
        val pages = mutableListOf(Page(PINNED, Kind.PINNED, rows.pins.mapNotNull(::key), shared))
        // Rows under no heading are those of the one category there is: bots in none, Other.
        var category = ""
        val keys = mutableListOf<Key>()
        fun close() {
            pages += if (category.isEmpty()) Page(OTHER, Kind.OTHER, keys.toList()) else Page(category, Kind.CATEGORY, keys.toList())
            keys.clear()
        }
        for (row in rows.layout) when {
            row == ListLayout.PINS -> Unit
            ListLayout.isHeading(row) -> { close(); category = ListLayout.categoryOf(row) }
            else -> key(row)?.let { keys += it }
        }
        close()
        return pages.filter { it.keys.isNotEmpty() }
    }

    /** The name a page folds under in the list's folded categories (#171): its category, "" for Other; Pinned never folds. */
    fun foldName(page: Page): String? = when (page.kind) { Kind.PINNED -> null; Kind.CATEGORY -> page.name; Kind.OTHER -> "" }

    /** [page] is folded: only its heading shows, as the list's category with the same name in [folded]. */
    fun isFolded(page: Page, folded: Set<String>): Boolean = foldName(page)?.let { it in folded } == true

    /** The keys shown, in reading order across the pages: a folded page's are not, so the digits do not count them. */
    fun shownKeys(pages: List<Page>, folded: Set<String>): List<Key> = pages.filterNot { isFolded(it, folded) }.flatMap { it.keys }

    /**
     * Which key each digit opens (#366). A bot with its own [Bot.hotkey] (1 to 9) has it wherever it stands on [pages],
     * also on a folded page; the digits no bot holds go, in reading order, to the [shown] keys that have none (bots
     * without one, and groups), until they run out. A server without hotkeys: the first nine shown keys. The web page
     * has the same rule.
     */
    fun digits(pages: List<Page>, shown: List<Key>): Map<Int, Key> {
        val map = sortedMapOf<Int, Key>()
        for (k in pages.flatMap { it.keys }) if (k is Key.OfBot) k.bot.hotkey?.takeIf { it in 1..9 && it !in map }?.let { map[it] = k }
        val held = map.values.map { it.id }.toSet()
        val free = (1..9).filter { it !in map }.iterator()
        for (k in shown) { if (!free.hasNext()) break; if (k.id !in held) map[free.next()] = k }
        return map
    }

    /** The digit on [key] in [digits]; 0: none. */
    fun digitOf(digits: Map<Int, Key>, key: Key): Int = digits.entries.firstOrNull { it.value.id == key.id }?.key ?: 0

    /**
     * Where a dragged key lands (#499): [key] dropped on the page at [to], on its key at [at] (it takes that one's
     * place) or on its heading (no [at]: last there, on its own page too, #516). The place is the one the list's drag gives a row, counted among its
     * own kind as the server counts it: pinned on Pinned, else in the page's category ("" for Other). The bots stand
     * before the groups on a page, so a bot dropped on a group is the last bot and a group dropped on a bot the first
     * group, except on a [Page.shared] Pinned page: there both kinds are one order and a key lands where it is dropped
     * (#276). null: it stays where it is, or there is no such key or page. The web page has the same rule.
     */
    fun move(pages: List<Page>, key: Key, to: Int, at: Int? = null): ListLayout.Place? {
        val target = pages.getOrNull(to) ?: return null
        val from = pages.indexOfFirst { p -> p.keys.any { it.id == key.id } }
        if (from < 0) return null
        val kin = { k: Key -> target.shared || (k is Key.OfGroup) == (key is Key.OfGroup) }
        val rest = target.keys.filter { it.id != key.id }
        val place = (if (at == null) rest else rest.take(at.coerceAtLeast(0))).count(kin) + 1
        if (from == to && place == target.keys.filter(kin).indexOfFirst { it.id == key.id } + 1) return null
        return when (target.kind) {
            Kind.PINNED -> ListLayout.Place.Pinned(place)
            Kind.CATEGORY -> ListLayout.Place.In(target.name, place)
            Kind.OTHER -> ListLayout.Place.In("", place)
        }
    }

    /** A press of a key of a hardware keyboard: its name ("1" to "9", "Tab", "Escape", "K") and what was held with it. */
    data class Press(val key: String, val ctrl: Boolean = false, val shift: Boolean = false, val alt: Boolean = false, val meta: Boolean = false)

    /** What a press does on the keypad. */
    sealed interface Action {
        /** Opens the key this digit (1 to 9) belongs to ([digits], #366). */
        data class Open(val number: Int) : Action
        /** Opens the Chief's chat again. */
        data object Chief : Action
        /** Puts the owner in the search box. */
        data object Search : Action
        /** Leaves the press to what has focus. */
        data object None : Action
    }

    /**
     * What [press] does while [digits] open a key ([Keypad.digits]). [typing]: a text field has focus, and it
     * keeps every press but Esc and Ctrl+K, so "3 pm" stays in a message. Tab is left alone: every page is on screen,
     * so there is none to move to (#516).
     */
    fun action(press: Press, typing: Boolean, digits: Set<Int>): Action {
        val plain = !press.ctrl && !press.shift && !press.alt && !press.meta
        val digit = press.key.singleOrNull()?.digitToIntOrNull()?.takeIf { it in 1..9 }
        return when {
            press.key == "Escape" && plain -> Action.Chief
            press.key.equals("K", ignoreCase = true) && press.ctrl && !press.shift && !press.alt && !press.meta -> Action.Search
            typing -> Action.None
            digit != null -> if (plain && digit in digits) Action.Open(digit) else Action.None
            else -> Action.None
        }
    }

    /**
     * A key's status pill (#397), the web page's rule (keypad.js, status): [kind] is also its colour. Working while a run
     * is going, Needs you while it asks or a card waits for it, its unread replies, else what its newest run did
     * ([last], its status: Done, Couldn't finish; Idle for none, or one the owner stopped).
     */
    data class Status(val kind: StatusKind, val text: String)
    enum class StatusKind { WORKING, NEEDS, UNREAD, DONE, FAILED, IDLE }

    fun status(running: Boolean = false, needs: Boolean = false, unread: Int = 0, last: String? = null): Status = when {
        running -> Status(StatusKind.WORKING, "Working")
        needs -> Status(StatusKind.NEEDS, "Needs you")
        unread > 0 -> Status(StatusKind.UNREAD, "$unread unread")
        last == "success" -> Status(StatusKind.DONE, "Done")
        last != null && last != "stopped" && last != "running" -> Status(StatusKind.FAILED, "Couldn't finish")
        else -> Status(StatusKind.IDLE, "Idle")
    }

    /** How long a run has been going, beside a Working pill: "<1 min", "2 min", "1 h 5 min". [ms]: since its start. */
    fun since(ms: Long): String {
        val m = ms.coerceAtLeast(0) / 60_000
        return when {
            m < 1 -> "<1 min"
            m < 60 -> "$m min"
            else -> "${m / 60} h" + if (m % 60 > 0) " ${m % 60} min" else ""
        }
    }
}
