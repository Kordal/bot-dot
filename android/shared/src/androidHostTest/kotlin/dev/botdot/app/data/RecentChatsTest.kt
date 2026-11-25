package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Chief's row of earlier chats: which chats it shows. `test/chief-recent-web.test.js` holds the web page's side. */
class RecentChatsTest {
    private fun chats(vararg ids: String) = ids.map { ChiefChatSummary(id = it, title = "Chat $it") }
    private fun ids(list: List<ChiefChatSummary>) = list.map { it.id }

    @Test fun showsTheThreeLatestOtherThanTheOpenOne() {
        val all = chats("c1", "c2", "c3", "c4", "c5")
        assertEquals(listOf("c2", "c3", "c4"), ids(RecentChats.of(all, "c1")))
        assertEquals("a tap opens c3: the strip shows the three latest other than it", listOf("c1", "c2", "c4"), ids(RecentChats.of(all, "c3")))
        assertEquals("the open chat sits low in the list: it is not counted", listOf("c1", "c2", "c3"), ids(RecentChats.of(all, "c5")))
    }

    @Test fun aNewChatShowsTheThreeLatest() {
        assertEquals(listOf("c1", "c2", "c3"), ids(RecentChats.of(chats("c1", "c2", "c3", "c4"), null)))
    }

    @Test fun fewerThanThreeShowsFewerAndNoneShowsNothing() {
        assertEquals(listOf("c2"), ids(RecentChats.of(chats("c1", "c2"), "c1")))
        assertEquals("the only chat is the open one: no row", emptyList<String>(), ids(RecentChats.of(chats("c1"), "c1")))
        assertEquals(emptyList<String>(), ids(RecentChats.of(emptyList(), null)))
    }

    @Test fun aChatWithNewRepliesIsMarked() {
        assertTrue(RecentChats.marked(ChiefChatSummary(id = "c1", unread = 2)))
        assertFalse(RecentChats.marked(ChiefChatSummary(id = "c1", unread = 0)))
    }
}
