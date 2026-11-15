package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Making a group from a bot's chat (GroupMaker) and Home's search (HomeSearch), as Android's. */
class GroupMakerTest {
    private fun bot(id: String, name: String, group: String = "") = Api.JSON.decodeFromString(Bot.serializer(), """{"id":"$id","name":"$name","group":"$group"}""")
    private val coder = bot("c", "Coder", "Work")
    private val bots = listOf(coder, bot("z", "Zed", "Work"), bot("a", "Ada", "Home"), bot("w", "Web", "Work"))

    @Test fun itsOwnCategorysBotsComeFirstAndTheHintCounts() {
        assertEquals(listOf("w", "z", "a"), GroupMaker.others(bots, coder).map { it.id })
        assertEquals("Pick one to five bots to join Coder. Its own chat stays as it is.", GroupMaker.hint(0, "Coder"))
        assertEquals("3 bots in the group, with Coder.", GroupMaker.hint(2, "Coder"))
        assertTrue(GroupMaker.canMake(listOf("groups"), 1))
        assertFalse(GroupMaker.canMake(null, 1), "the features not known yet")
        assertFalse(GroupMaker.canMake(listOf("groups"), 0), "no other bot")
        assertFalse(GroupMaker.ready(0))
        assertFalse(GroupMaker.ready(6), "a group has six bots at most")
    }

    @Test fun aGroupIsMadeOfThisBotAndThePickedOrBotdotSaysWhyNot() = runTest {
        var refuse = false
        val server = FakeServer { t ->
            when {
                t.method == "POST" && t.path == "/api/group-chats" ->
                    if (refuse) 400 to """{"error":"A group has two to six bots."}""" else 201 to """{"id":"g1","name":"Team","members":["c","w"]}"""
                t.path == "/api/group-chats" -> 200 to "[]"
                else -> 404 to "{}"
            }
        }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        store.version.set(VersionInfo(features = listOf("groups"))) // groups are read from a botdot that has them
        val made = GroupMaker.make(server.api, store, "c", listOf("w"), " Team ")
        assertEquals("g1", made.group?.id)
        assertNull(made.failed)
        val body = Api.JSON.parseToJsonElement(server.posts().single().body).jsonObject
        assertEquals("Team", body.getValue("name").jsonPrimitive.content)
        assertEquals(listOf("c", "w"), body.getValue("members").jsonArray.map { it.jsonPrimitive.content }, "this bot first")
        assertTrue(server.sent().any { it.method == "GET" && it.path == "/api/group-chats" }, "the groups read again")
        refuse = true
        assertEquals("A group has two to six bots.", GroupMaker.make(server.api, store, "c", listOf("w"), "").failed)
        assertEquals(2, server.posts().size)
        GroupMaker.make(server.api, store, "c", emptyList(), "")
        assertEquals(2, server.posts().size, "none picked: nothing sent")
    }

    @Test fun homeFindsTheChiefBotsAndGroupsThenSaysWhoseEachMessageIs() {
        val q = HomeSearch.query("  WEB ")
        assertEquals("web", q)
        assertEquals(listOf("w"), HomeSearch.bots(q, bots).map { it.id })
        assertTrue(HomeSearch.chief("chief", "Alfred"))
        assertTrue(HomeSearch.chief("alf", "Alfred"))
        assertFalse(HomeSearch.chief("", "Alfred"))
        val chiefHit = ChatHit(chatId = "c1", title = "Week", snippet = "the «web» page")
        assertEquals("Alfred · Week", HomeSearch.who(chiefHit, "Alfred"))
        assertEquals(listOf(HomeSearch.Piece("the ", false), HomeSearch.Piece("web", true), HomeSearch.Piece(" page", false)), HomeSearch.snippet(chiefHit))
        assertEquals(HomeSearch.Opens.Chief("c1"), HomeSearch.opens(chiefHit))
        val between = ChatHit(runId = "r1", bot = BotRef("w", "Web"), fromBot = BotRef("c", "Coder"), snippet = "x")
        assertEquals("Coder → Web", HomeSearch.who(between, "Alfred"))
        assertEquals(HomeSearch.Opens.Bot("w", "Web"), HomeSearch.opens(between))
    }
}
