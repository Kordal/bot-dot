package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.files.SystemTemporaryDirectory

/** Home on the iPhone (HomeStore, HomeState, BoardStore): the folded categories, Allow and No, a chat tile's bot. */
class HomeStoreTest {
    private fun bot(id: String, name: String, group: String = "", running: Boolean = false, pinned: Int = 0) =
        Api.JSON.decodeFromString(Bot.serializer(), """{"id":"$id","name":"$name","group":"$group","running":$running,"pinned":$pinned}""")

    private fun home(bots: List<Bot>, folded: Set<String>) =
        HomeState(bots, emptyList(), emptyList(), null, null, emptyList(), emptyMap(), null, folded = folded)

    private val bots = listOf(bot("a", "Ada", "Work", running = true), bot("b", "Bo", "Work"), bot("c", "Cy"), bot("p", "Pip", "Work", running = true, pinned = 1))

    @Test fun aFoldedCategoryShowsItsHeadingAloneOtherToo() {
        val open = home(bots, emptySet()).rows.layout
        assertTrue(listOf("a", "b", "c").all { it in open }, open.toString())
        val work = home(bots, setOf("Work")).rows.layout
        assertTrue(ListLayout.heading("Work") in work)
        assertFalse("a" in work || "b" in work, "folded: its bots are hidden: $work")
        assertTrue("c" in work)
        val other = home(bots, setOf("")).rows.layout
        assertFalse("c" in other, "Other (\"\") folds as any category: $other")
        assertTrue("a" in other)
    }

    @Test fun aFoldedCategorysDotIsForARunningUnpinnedBotOfIt() {
        assertTrue(home(bots, setOf("Work")).foldedWorks("Work"))
        assertFalse(home(bots, emptySet()).foldedWorks("Work"), "open: no dot")
        assertFalse(home(listOf(bot("b", "Bo", "Work"), bot("p", "Pip", "Work", running = true, pinned = 1)), setOf("Work")).foldedWorks("Work"),
            "only a pinned bot works: it is not in the category's rows")
        assertFalse(home(bots, setOf("")).foldedWorks(""), "Cy rests")
    }

    @Test fun theFoldIsKeptOnThePhone() = runTest {
        val dir = Path(SystemTemporaryDirectory, "home-store-" + newMessageKey()).toString()
        SystemFileSystem.createDirectories(Path(dir))
        val settings = settingsIn(dir)
        val store = HomeStore(Api("https://127.0.0.1:9"))
        store.keep(settings)
        store.toggleFolded("Work")
        assertEquals(setOf("Work"), settings.foldedGroups.first())
        store.toggleFolded("Work")
        assertEquals(emptySet(), settings.foldedGroups.first())
    }

    @Test fun anAnswerThatFailsSaysBotdotsWordsAndWhatWaitsIsReadAgain() = runTest {
        val server = FakeServer { t ->
            if (t.method == "POST" && t.path == "/api/asks/ask1") 409 to """{"error":"It was answered already"}""" else 200 to "[]"
        }
        val home = HomeStore(server.api)
        assertEquals("It was answered already", home.answer("ask1", yes = true))
        val sent = server.sent()
        val post = sent.indexOfFirst { it.method == "POST" }
        assertTrue(post >= 0 && sent.drop(post + 1).any { it.method == "GET" }, "needs read again after it: ${sent.map { it.method + " " + it.path }}")
        val ok = FakeServer { 200 to """{"ok":true}""" }
        assertNull(HomeStore(ok.api).answer("ask2", yes = false))
    }

    @Test fun aChatTileNamesItsBot() {
        val home = HomeStore(Api("https://127.0.0.1:9"))
        home.store.bots.set(listOf(bot("keeper", "Keeper")))
        val board = BoardStore(home)
        assertEquals("Keeper", board.botName("keeper"))
        assertNull(board.botName("gone"))
        board.close()
    }
}
