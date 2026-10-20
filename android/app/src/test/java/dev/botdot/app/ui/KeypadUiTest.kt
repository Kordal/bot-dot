package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import dev.botdot.app.data.Bot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The keypad on screen (#496): from 840 dp it stands left of the Chief's chat in place of the list, a key opens its
 * chat in that column and stays lit, Esc and Back bring the Chief back, every page shows at once (#516), and a key
 * pressed, held and dragged moves to another place or page with the list's update (#499). On a phone (#498) the
 * pages are sections of keys, and a key's chat is full screen. The keypad, its keys and the panes are the app's own;
 * the chats, the list and the Board are stand-ins, as no botdot server runs here.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w1280dp-h800dp")
class KeypadUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    // A server without groups and without the Board: bots only, on two pages.
    private val bots = listOf(
        Bot(id = "coder", name = "Coder", color = "#378add", group = "Work", order = 1),
        Bot(id = "reviewer", name = "Reviewer", color = "#1d9e75", group = "Work", order = 2),
        Bot(id = "cook", name = "Cook", color = "#e24b4a", group = "Home"),
    )
    private val pages = Keypad.pages(bots, emptyList()) // Home: Cook; Work: Coder, Reviewer
    private fun look(k: Keypad.Key) = (k as Keypad.Key.OfBot).bot.let { KeyLook(it.name, "Ready", it.color) }

    /** The home of a window [width] dp wide, as MainActivity lays it out, with stand-ins for the list and the chat. */
    @Composable
    private fun Window(width: Int) {
        Row(Modifier.fillMaxSize()) {
            HomePanes(Keypad.home(width), width, listShown = true,
                keypad = { m -> KeypadView(pages, active = null, look = ::look, onKey = {}, onAsk = {}, modifier = m) },
                list = { Text("The list", Modifier.width(300.dp)) },
            ) { m -> Box(m) { Text("The Chief's chat") } }
        }
    }

    @Test @Config(qualifiers = "w840dp-h600dp")
    fun at840TheKeypadAndTheChiefsChatShow() {
        rule.setContent { Window(840) }
        // Every page at once (#516): Home over Work, each its heading over its keys, numbered across the pages.
        val home = rule.onNodeWithText("HOME").assertIsDisplayed().getUnclippedBoundsInRoot()
        val cook = rule.onNodeWithText("Cook").assertIsDisplayed().getUnclippedBoundsInRoot()
        val work = rule.onNodeWithText("WORK").assertIsDisplayed().getUnclippedBoundsInRoot()
        val coder = rule.onNodeWithText("Coder").assertIsDisplayed().getUnclippedBoundsInRoot()
        val ask = rule.onNodeWithText(ASK_FOR_A_BOT).assertIsDisplayed().getUnclippedBoundsInRoot()
        assertTrue("Home's heading, its key, Work's heading, its keys, then the last place", home.bottom <= cook.top && cook.bottom <= work.top && work.bottom <= coder.top && coder.bottom <= ask.bottom)
        rule.onNodeWithText("3").assertIsDisplayed() // Reviewer, the third key
        rule.onNodeWithText("The Chief's chat").assertIsDisplayed()
        rule.onNodeWithText("The list").assertDoesNotExist()
    }

    @Test @Config(qualifiers = "w700dp-h600dp")
    fun at700TheListAndTheChiefsChatShowAsBefore() {
        rule.setContent { Window(700) }
        rule.onNodeWithText("The list").assertIsDisplayed()
        rule.onNodeWithText("The Chief's chat").assertIsDisplayed()
        rule.onNodeWithText("Cook").assertDoesNotExist()
    }

    /** The keypad beside a NavHost of stand-in chats, opened as MainActivity opens them ([openBeside]). */
    @Composable
    private fun WithChats(relay: KeyRelay) {
        val nav = rememberNavController()
        val entry by nav.currentBackStackEntryAsState()
        val active = entry?.arguments?.getString("id")
        val open = { k: Keypad.Key -> nav.openBeside("bot/${k.id}") }
        KeypadKeys(relay, pages, keysShown = true, onKey = open, onChief = { nav.popBackStack("home", inclusive = false) }, onSearch = {})
        Row(Modifier.fillMaxSize()) {
            HomePanes(Keypad.Home.KEYPAD, 1280, listShown = true,
                keypad = { m -> KeypadView(pages, active, ::look, onKey = open, onAsk = {}, modifier = m) },
                list = {},
            ) { m ->
                NavHost(nav, startDestination = "home", modifier = m) {
                    composable("home") { Text("The Chief's chat") }
                    composable("bot/{id}") { e -> Text("The chat of ${e.arguments?.getString("id")}") }
                }
            }
        }
    }

    @Test fun aKeyOpensItsChatBesideTheKeypadAndOnlyThatChat() {
        rule.setContent { WithChats(KeyRelay()) }
        rule.onNodeWithText("Cook").performClick()
        rule.onNodeWithText("The chat of cook").assertIsDisplayed()
        rule.onNodeWithText("The Chief's chat").assertDoesNotExist()
        rule.onNodeWithText("Cook").assertIsSelected() // the opened key stays lit

        // Another key, on another page, takes its place: Back then leads to the Chief, not to the first one.
        rule.onNodeWithText("Coder").performClick()
        rule.onNodeWithText("The chat of coder").assertIsDisplayed()
        rule.onNodeWithText("The chat of cook").assertDoesNotExist()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.onNodeWithText("The Chief's chat").assertIsDisplayed()
        rule.onNodeWithText("The chat of coder").assertDoesNotExist()
        rule.onNodeWithText("Coder").assertIsNotSelected()
    }

    @Test fun aDigitOpensAKeyAndEscBringsTheChiefBack() {
        val relay = KeyRelay()
        rule.setContent { WithChats(relay) }
        // Counted across the pages: 1 is Cook on Home, 3 is Reviewer on Work. Tab is no longer the keypad's.
        assertEquals(false, relay.handler!!(Keypad.Press("Tab"), false))
        rule.runOnUiThread { relay.handler!!(Keypad.Press("3"), false) }
        rule.onNodeWithText("The chat of reviewer").assertIsDisplayed()
        rule.onNodeWithText("Reviewer").assertIsSelected()
        // Esc also from the message box, where a digit would be typed.
        rule.runOnUiThread { relay.handler!!(Keypad.Press("1"), true) }
        rule.onNodeWithText("The chat of reviewer").assertIsDisplayed()
        rule.runOnUiThread { relay.handler!!(Keypad.Press("Escape"), true) }
        rule.onNodeWithText("The Chief's chat").assertIsDisplayed()
        rule.onNodeWithText("The chat of reviewer").assertDoesNotExist()
    }

    /**
     * Presses and holds the key [name], drags it onto the node with the text [onto] (a key, a heading or the last place)
     * and lets go, as a finger would.
     */
    private fun drag(name: String, onto: String) {
        val from = rule.onNodeWithText(name).fetchSemanticsNode().boundsInRoot
        val to = rule.onNodeWithText(onto).fetchSemanticsNode().boundsInRoot
        rule.onNodeWithText(name).performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)
            val end = to.center - from.topLeft // where it is let go, from the dragged key's corner
            for (step in 1..10) moveTo(center + (end - center) * (step / 10f))
            up()
        }
        rule.waitForIdle()
    }

    @Test @Config(qualifiers = "w840dp-h600dp")
    fun at840AKeyDraggedOntoAnotherKeyOrAPagesHeadingSendsTheListsUpdate() {
        val sent = mutableListOf<String>()
        rule.setContent {
            Row(Modifier.fillMaxSize()) {
                HomePanes(Keypad.home(840), 840, listShown = true,
                    keypad = { m ->
                        KeypadView(pages, active = null, look = ::look, onKey = {}, onAsk = {}, modifier = m,
                            onMove = { k, place -> sent += "${k.id} ${ListLayout.change(place, group = k is Keypad.Key.OfGroup, pinned = k.pinned)}" })
                    },
                    list = {},
                ) { m -> Box(m) { Text("The Chief's chat") } }
            }
        }
        drag("Reviewer", onto = "Coder")
        assertEquals(listOf("""reviewer {"group":"Work","order":1}"""), sent)
        drag("Coder", onto = "HOME")
        assertEquals("""coder {"group":"Home","order":2}""", sent.last())
        drag("Cook", onto = "Reviewer")
        assertEquals("onto a key of another page: its place there", """cook {"group":"Work","order":2}""", sent.last())
        drag("Coder", onto = "WORK")
        assertEquals("onto its own page's heading: last there", """coder {"group":"Work","order":2}""", sent.last())
        // Where it is already, and onto the last place when it is last on the last page: nothing is sent.
        drag("Reviewer", onto = "Reviewer")
        drag("Reviewer", onto = ASK_FOR_A_BOT)
        assertEquals(4, sent.size)
        rule.onNodeWithText("The Chief's chat").assertIsDisplayed() // and no chat was opened
    }

    @Test @Config(qualifiers = "w840dp-h600dp")
    fun at840TappingAPagesHeadingFoldsItAndTheDigitsCountOnlyTheKeysShown() {
        val relay = KeyRelay()
        val opened = mutableListOf<String>()
        val working = listOf(bots[0].copy(running = true), bots[1], bots[2]) // Coder works
        val withWork = Keypad.pages(working, emptyList())
        rule.setContent {
            var folded by remember { mutableStateOf(setOf<String>()) }
            val fold = { page: Keypad.Page -> Keypad.foldName(page)?.let { folded = if (it in folded) folded - it else folded + it }; Unit }
            KeypadKeys(relay, withWork, keysShown = true, onKey = { opened += it.id }, onChief = {}, onSearch = {}, folded = folded)
            Row(Modifier.fillMaxSize()) {
                HomePanes(Keypad.home(840), 840, listShown = true,
                    keypad = { m -> KeypadView(withWork, active = null, look = ::look, onKey = {}, onAsk = {}, modifier = m, folded = folded, onFold = fold) },
                    list = {},
                ) { m -> Box(m) { Text("The Chief's chat") } }
            }
        }
        rule.onNodeWithTag(FOLDED_BUSY, useUnmergedTree = true).assertDoesNotExist()
        rule.onNodeWithText("HOME").performClick()
        rule.onNodeWithText("Cook").assertDoesNotExist()
        rule.onNodeWithText("HOME").assertIsDisplayed() // its heading and its count stay
        rule.onNodeWithText(ASK_FOR_A_BOT).assertIsDisplayed()
        rule.runOnUiThread { relay.handler!!(Keypad.Press("1"), false) }
        assertEquals("1 is the first key shown: Coder on Work", listOf("coder"), opened)
        rule.onNodeWithText("WORK").performClick()
        rule.onNodeWithText("Coder").assertDoesNotExist()
        rule.onNodeWithTag(FOLDED_BUSY, useUnmergedTree = true).assertIsDisplayed() // folded, Work says Coder is working
        assertEquals(false, relay.handler!!(Keypad.Press("1"), false)) // no key is shown
        rule.onNodeWithText("HOME").performClick()
        rule.onNodeWithText("Cook").assertIsDisplayed()
    }

    @Test @Config(qualifiers = "w390dp-h800dp")
    fun onAPhoneTappingACategorysHeadingFoldsItsPage() {
        rule.setContent {
            var folded by remember { mutableStateOf(setOf("Work")) } // folded in the list
            KeypadSections(pages, ::look, onKey = {}, onChief = {}, modifier = Modifier.fillMaxSize(), folded = folded,
                onFold = { page -> Keypad.foldName(page)?.let { folded = if (it in folded) folded - it else folded + it } })
        }
        rule.onNodeWithText("WORK").assertIsDisplayed()
        rule.onNodeWithText("Coder").assertDoesNotExist()
        rule.onNodeWithText("Cook").assertIsDisplayed()
        rule.onNodeWithText("WORK").performClick()
        rule.onNodeWithText("Coder").assertIsDisplayed()
    }

    /** A phone's home, as MainActivity lays it out below 600 dp: the sections are the NavHost's home, and a chat takes the whole screen. */
    @Composable
    private fun Phone() {
        val nav = rememberNavController()
        NavHost(nav, startDestination = "home", modifier = Modifier.fillMaxSize()) {
            composable("home") {
                KeypadSections(pages, ::look, onKey = { k -> nav.navigate("bot/${k.id}") }, onChief = { nav.navigate("chief") }, modifier = Modifier.fillMaxSize()) { Text("The Board") }
            }
            composable("bot/{id}") { e -> Text("The chat of ${e.arguments?.getString("id")}") }
            composable("chief") { Text("The Chief's chat") }
        }
    }

    @Test @Config(qualifiers = "w390dp-h800dp")
    fun onAPhoneThePagesAreSectionsOfKeysUnderTheBoardAndOverTheChiefsMessageBox() {
        rule.setContent { Phone() }
        val board = rule.onNodeWithText("The Board").assertIsDisplayed().getUnclippedBoundsInRoot()
        val home = rule.onNodeWithText("HOME").assertIsDisplayed().getUnclippedBoundsInRoot()
        val work = rule.onNodeWithText("WORK").assertIsDisplayed().getUnclippedBoundsInRoot()
        val chief = rule.onNodeWithText(ASK_THE_CHIEF).assertIsDisplayed().getUnclippedBoundsInRoot()
        assertTrue("the Board, then the pages in order, then the Chief's box", board.bottom <= home.top && home.bottom <= work.top && work.bottom <= chief.top)
        // A section's keys stand in a row: Coder and Reviewer side by side.
        val coder = rule.onNodeWithText("Coder").assertIsDisplayed().getUnclippedBoundsInRoot()
        val reviewer = rule.onNodeWithText("Reviewer").assertIsDisplayed().getUnclippedBoundsInRoot()
        assertEquals(coder.top, reviewer.top)
        assertTrue(coder.right <= reviewer.left)
        assertTrue("Work's keys under its name", work.bottom <= coder.top)
        // No digits on a phone: the only "1" is Home's count; no tabs, and no last place.
        rule.onAllNodesWithText("1").assertCountEquals(1)
        rule.onNodeWithText(ASK_FOR_A_BOT).assertDoesNotExist()
    }

    @Test @Config(qualifiers = "w390dp-h800dp")
    fun onAPhoneAKeyOpensItsChatFullScreenAndBackReturnsToTheSections() {
        rule.setContent { Phone() }
        rule.onNodeWithText("Coder").performClick()
        rule.onNodeWithText("The chat of coder").assertIsDisplayed()
        rule.onNodeWithText("WORK").assertDoesNotExist()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.onNodeWithText("WORK").assertIsDisplayed()
        rule.onNodeWithText("The chat of coder").assertDoesNotExist()
        rule.onNodeWithText(ASK_THE_CHIEF).performClick()
        rule.onNodeWithText("The Chief's chat").assertIsDisplayed()
    }
}
