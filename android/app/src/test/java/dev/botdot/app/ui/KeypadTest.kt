package dev.botdot.app.ui

import dev.botdot.app.data.Bot
import dev.botdot.app.data.Group
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The keypad of a wide window (#494, #496): its pages, cut from the list's own order, and what a key of a hardware
 * keyboard does on it. The cases are the spec's, the same as the web page's.
 */
class KeypadTest {
    private fun bot(id: String, category: String = "", order: Int = 0, pinned: Int = 0) = Bot(id = id, name = id.replaceFirstChar { it.uppercase() }, group = category, order = order, pinned = pinned)
    private fun group(id: String, category: String = "", order: Int = 0, pinned: Int = 0) =
        Group.list("""[{"id":"$id","name":"${id.uppercase()}","members":["a","b"],"category":"$category","order":$order,"pinned":$pinned}]""").single()

    /** Each page as its name, then its keys: a bot's id, or a group's row. */
    private fun read(pages: List<Keypad.Page>) = pages.map { p -> "${p.name}: ${p.keys.joinToString(" ") { it.id }}" }

    // Pages

    @Test fun withNoCategoryEveryBotIsOnOnePageCalledOther() {
        val pages = Keypad.pages(listOf(bot("cook"), bot("ann")), emptyList())
        assertEquals(listOf("Other: ann cook"), read(pages))
        assertEquals(Keypad.Kind.OTHER, pages.single().kind)
    }

    @Test fun thePinnedBotsThenThePinnedGroupsAreTheFirstPage() {
        val pages = Keypad.pages(
            listOf(bot("news", pinned = 2), bot("fleet", pinned = 1), bot("cook", "Home")),
            listOf(group("dev", pinned = 2), group("ops", pinned = 1), group("kitchen", "Home")),
        )
        assertEquals(listOf("Pinned: fleet news group:ops group:dev", "Home: cook group:kitchen"), read(pages))
        assertEquals(listOf(Keypad.Kind.PINNED, Keypad.Kind.CATEGORY), pages.map { it.kind })
    }

    @Test fun eachCategoryIsAPageFromAToZAndOtherIsLast() {
        val pages = Keypad.pages(listOf(bot("loose"), bot("coder", "work"), bot("cook", "Home"), bot("saver", "Money")), emptyList())
        assertEquals(listOf("Home: cook", "Money: saver", "work: coder", "Other: loose"), read(pages))
        assertEquals(listOf(Keypad.Kind.CATEGORY, Keypad.Kind.CATEGORY, Keypad.Kind.CATEGORY, Keypad.Kind.OTHER), pages.map { it.kind })
    }

    @Test fun botsInTheirOrderAndThoseNeverPlacedAfterThemFromAToZ() {
        val pages = Keypad.pages(listOf(bot("zed", "Home"), bot("cook", "Home", order = 2), bot("ann", "Home"), bot("lights", "Home", order = 1)), emptyList())
        assertEquals(listOf("Home: lights cook ann zed"), read(pages))
    }

    @Test fun aCategorysGroupsStandAfterItsBots() {
        val pages = Keypad.pages(listOf(bot("cook", "Home", order = 1), bot("lights", "Home", order = 2)),
            listOf(group("evening", "Home", order = 2), group("dinner", "Home", order = 1), group("budget", "Money")))
        assertEquals(listOf("Home: cook lights group:dinner group:evening", "Money: group:budget"), read(pages))
    }

    @Test fun aPageWithNoKeyIsLeftOut() {
        // Nothing pinned: no Pinned page. A category whose bots are all pinned: no page for it.
        assertEquals(listOf("Home: cook"), read(Keypad.pages(listOf(bot("cook", "Home")), emptyList())))
        assertEquals(listOf("Pinned: fleet", "Home: cook"), read(Keypad.pages(listOf(bot("fleet", "Ops", pinned = 1), bot("cook", "Home")), emptyList())))
        assertEquals(emptyList<String>(), read(Keypad.pages(emptyList(), emptyList())))
    }

    @Test fun aPageKeepsAllItsKeysPastNine() {
        val bots = (1..11).map { bot("b%02d".format(it), "Home", order = it) }
        val page = Keypad.pages(bots, listOf(group("crew", "Home"))).single()
        assertEquals(bots.map { it.id } + "group:crew", page.keys.map { it.id })
    }

    // Keys

    private fun press(key: String, ctrl: Boolean = false, shift: Boolean = false, alt: Boolean = false, meta: Boolean = false) = Keypad.Press(key, ctrl, shift, alt, meta)
    private fun on(p: Keypad.Press, typing: Boolean = false, keys: Int = 9) = Keypad.action(p, typing, keys)

    @Test fun aDigitOpensTheKeyWithItsNumber() {
        for (n in 1..9) assertEquals(Keypad.Action.Open(n), on(press("$n")))
    }

    @Test fun aDigitTypedIntoAFieldStaysThere() {
        for (n in 1..9) assertEquals(Keypad.Action.None, on(press("$n"), typing = true))
    }

    @Test fun aDigitPastTheKeysOfAllThePagesDoesNothing() {
        assertEquals(Keypad.Action.Open(4), on(press("4"), keys = 4))
        assertEquals(Keypad.Action.None, on(press("5"), keys = 4))
        assertEquals(Keypad.Action.None, on(press("1"), keys = 0))
    }

    @Test fun aDigitWithAModifierDoesNothing() {
        assertEquals(Keypad.Action.None, on(press("2", ctrl = true)))
        assertEquals(Keypad.Action.None, on(press("2", shift = true)))
        assertEquals(Keypad.Action.None, on(press("2", alt = true)))
        assertEquals(Keypad.Action.None, on(press("2", meta = true)))
    }

    @Test fun tabIsLeftAloneEveryPageIsOnScreen() {
        assertEquals(Keypad.Action.None, on(press("Tab")))
        assertEquals(Keypad.Action.None, on(press("Tab", shift = true)))
        assertEquals(Keypad.Action.None, on(press("Tab"), typing = true))
    }

    @Test fun escapeBringsTheChiefBackAlsoFromAField() {
        assertEquals(Keypad.Action.Chief, on(press("Escape")))
        assertEquals(Keypad.Action.Chief, on(press("Escape"), typing = true))
    }

    @Test fun ctrlKSearchesAlsoFromAField() {
        assertEquals(Keypad.Action.Search, on(press("K", ctrl = true)))
        assertEquals(Keypad.Action.Search, on(press("K", ctrl = true), typing = true))
        assertEquals("a plain K is a letter", Keypad.Action.None, on(press("K")))
    }

    // Moves (#499): where a dragged key lands, the same cases as the web page's

    private val movePages = Keypad.pages(
        listOf(bot("news", "Work", pinned = 1), bot("lights", pinned = 2), bot("garden", "Home", order = 1), bot("mail", "Home", order = 2), bot("cook", "Home", order = 3), bot("notes")),
        listOf(group("evening", pinned = 1), group("kitchen", "Home", order = 1), group("porch", "Home", order = 2)),
    )
    /** Drags the key [id] and drops it on the page [to]: on its key at [at], or on its heading (no [at]). */
    private fun move(id: String, to: Int, at: Int? = null) = Keypad.move(movePages, movePages.flatMap { it.keys }.single { it.id == id }, to, at)
    private fun pinned(at: Int) = ListLayout.Place.Pinned(at)
    private fun inside(category: String, at: Int) = ListLayout.Place.In(category, at)

    @Test fun thePagesTheMovesStartFrom() {
        assertEquals(listOf("Pinned: news lights group:evening", "Home: garden mail cook group:kitchen group:porch", "Other: notes"), read(movePages))
    }

    @Test fun aKeyDroppedOnAnotherKeyOfItsPageTakesItsPlaceAmongItsOwnKind() {
        assertEquals(inside("Home", 1), move("cook", 1, 0))
        assertEquals(inside("Home", 3), move("garden", 1, 2))
        assertEquals(inside("Home", 2), move("garden", 1, 1))
        assertEquals("a group onto the first group", inside("Home", 1), move("group:porch", 1, 3))
        assertEquals(pinned(1), move("lights", 0, 0))
        assertEquals(pinned(2), move("news", 0, 1))
    }

    @Test fun botsStayBeforeGroupsOnAPage() {
        assertEquals("a bot onto a group: the last bot", inside("Home", 3), move("garden", 1, 4))
        assertEquals("a group onto a bot: the first group", inside("Home", 1), move("group:porch", 1, 0))
        assertEquals(pinned(2), move("news", 0, 2))
    }

    @Test fun aKeyDroppedWhereItIsOrOnItsOwnHeadingWhenLastThereDoesNotMove() {
        assertNull(move("mail", 1, 1))
        assertNull(move("group:kitchen", 1, 3))
        assertNull(move("lights", 0, 1))
        assertNull("the last bot of its page", move("cook", 1))
        assertNull(move("group:evening", 0))
        assertNull(move("lights", 0, 2))
    }

    @Test fun onItsOwnPagesHeadingAKeyGoesLastThere() {
        assertEquals(inside("Home", 3), move("mail", 1))
        assertEquals(inside("Home", 2), move("group:kitchen", 1))
        assertEquals(pinned(2), move("news", 0))
    }

    @Test fun onAnotherPagesHeadingAKeyGoesLastThere() {
        assertEquals("onto Pinned: pinned last", pinned(3), move("mail", 0))
        assertEquals("a group: last of the pinned groups", pinned(2), move("group:kitchen", 0))
        assertEquals(inside("Home", 4), move("notes", 1))
        assertEquals("a pinned group to a category", inside("Home", 3), move("group:evening", 1))
        assertEquals("a pinned bot onto Other", inside("", 2), move("lights", 2))
        assertEquals(inside("", 2), move("cook", 2))
    }

    @Test fun aKeyDroppedOnAKeyOfAnotherPageTakesItsPlaceThere() {
        assertEquals(inside("Home", 2), move("notes", 1, 1))
        assertEquals(pinned(1), move("mail", 0, 0))
    }

    @Test fun aKeyOnNoPageOrAPageThatIsNotThereMovesNothing() {
        assertNull(Keypad.move(movePages, Keypad.Key.OfBot(bot("ghost", "Home")), 1))
        assertNull(Keypad.move(movePages, movePages[1].keys[0], 7))
    }

    // The update a move sends: the list's drag's (ListLayout.change), for a bot and for a group

    @Test fun aMoveSendsTheListsUpdate() {
        assertEquals("""{"pinned":3}""", ListLayout.change(pinned(3), group = false, pinned = false).toString())
        assertEquals("""{"pinned":2}""", ListLayout.change(pinned(2), group = true, pinned = true).toString())
        assertEquals("""{"group":"Home","order":2}""", ListLayout.change(inside("Home", 2), group = false, pinned = false).toString())
        assertEquals("""{"category":"","order":1}""", ListLayout.change(inside("", 1), group = true, pinned = false).toString())
        assertEquals("out of the pinned ones: unpinned too", """{"group":"Home","order":4,"pinned":0}""", ListLayout.change(inside("Home", 4), group = false, pinned = true).toString())
        assertEquals("""{"category":"Home","order":3,"pinned":0}""", ListLayout.change(inside("Home", 3), group = true, pinned = true).toString())
    }

    // Width

    @Test fun theKeypadIsTheHomeFrom840AndTheListFrom600() {
        assertEquals(Keypad.Home.PHONE, Keypad.home(599))
        assertEquals(Keypad.Home.LIST, Keypad.home(600))
        assertEquals(Keypad.Home.LIST, Keypad.home(839))
        assertEquals(Keypad.Home.KEYPAD, Keypad.home(840))
    }
}
