package dev.botdot.app.feed

import dev.botdot.app.data.Bot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Chats as Android conversations (#1116): which conversation a chat is, what its shortcut opens, which go. */
class ConversationsTest {
    @Test fun aChatIsItsConversationAndTheChiefsChatsAreOne() {
        assertEquals("bot:news", Conversations.of("bot:news"))
        assertEquals("group:launch", Conversations.of("group:launch"))
        assertEquals(Conversations.CHIEF, Conversations.of("chief:c1"))
        assertEquals(Conversations.CHIEF, Conversations.of("chief:c2"))
        assertNull(Conversations.of("needs"))
        assertNull(Conversations.of("room:abc"))
        assertNull(Conversations.of("bot:"))
    }

    @Test fun itsShortcutOpensTheChatAndTheChiefsLatest() {
        assertEquals("bot:news", Conversations.opens("bot:news"))
        assertEquals("group:launch", Conversations.opens("group:launch"))
        assertEquals("chief:", Conversations.opens(Conversations.CHIEF))
    }

    @Test fun theLauncherOffersTheChiefAndThePinnedBotsInTheirOrder() {
        val bots = listOf(
            Bot(id = "a", name = "A"), Bot(id = "b", name = "B", pinned = 2), Bot(id = "c", name = "C", pinned = 1),
            Bot(id = "d", name = "D", pinned = 4), Bot(id = "e", name = "E", pinned = 3),
        )
        assertEquals(listOf("chief", "bot:c", "bot:b", "bot:e"), Conversations.offered(bots))
        assertEquals(listOf("chief"), Conversations.offered(emptyList()))
    }

    @Test fun aDeletedBotsOrGroupsShortcutGoes() {
        val have = listOf("chief", "bot:news", "bot:old", "group:launch", "group:gone")
        assertEquals(listOf("bot:old", "group:gone"), Conversations.gone(have, bots = setOf("news"), groups = setOf("launch")))
        assertEquals("groups not read: none of theirs goes", listOf("bot:old"), Conversations.gone(have, bots = setOf("news"), groups = null))
    }
}
