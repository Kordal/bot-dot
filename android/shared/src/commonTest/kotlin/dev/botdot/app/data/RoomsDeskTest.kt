package dev.botdot.app.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Shared rooms as a phone draws them (RoomsDesk, RoomChatDesk, RoomSettingsDesk, #1372): the list, a room's chat and
 * its settings, with what they send going to a fake front door ([FakeServer]).
 */
class RoomsDeskTest {
    private val room = """{"id":"r1","name":"Plans","by":"ann","members":[{"account":"ann"},{"account":"bob"}],
        "bots":[{"account":"ann","id":"scout","name":"Scout","color":"#378ADD"},{"account":"bob","id":"b7","name":"Pip","color":"#AA3300"}],
        "invites":[{"account":"cy","by":"ann"}],"last":{"id":"m2","account":"bob","text":"Lunch?","at":"2026-11-14T12:00:00Z"},"working":[]}"""
    private val made = """{"id":"r9","name":"Trip","by":"ann","members":[{"account":"ann"}]}"""
    private val messages = """{"messages":[
        {"id":"m0","at":"2026-11-14T11:00:00Z","account":"","kind":"notice","text":"bob joined"},
        {"id":"m1","at":"2026-11-14T11:30:00Z","account":"ann","text":"Hi @Pip","mentions":[{"account":"bob","bot":"b7","name":"Pip"}]},
        {"id":"m2","at":"2026-11-14T12:00:00Z","account":"bob","bot":{"id":"b7","name":"Pip"},"text":"Lunch?"}],"more":false}"""

    /** A front door with Rooms on, ann signed in, the room r1 and an invitation to r2, answering what the screens send. */
    private fun server(extra: suspend (Took) -> Pair<Int, String>? = { null }) = FakeServer { t ->
        extra(t) ?: when (t.method to t.path) {
            "GET" to "/front-door/session" -> 200 to """{"rooms":true,"roomLinks":true,"account":"ann"}"""
            "GET" to "/front-door/rooms" -> 200 to """{"rooms":[$room],"invites":[{"room":{"id":"r2","name":"Garden","by":"cy"},"by":"cy"}]}"""
            "POST" to "/front-door/rooms" -> 201 to """{"room":$made}"""
            "POST" to "/front-door/rooms/r9/link" -> 200 to """{"link":{"url":"https://botdot.test/#rooms/join=abc123"}}"""
            "POST" to "/front-door/rooms/r2/accept" -> 200 to """{"room":{"id":"r2","name":"Garden","by":"cy"}}"""
            "POST" to "/front-door/rooms/r2/decline" -> 200 to "{}"
            "GET" to "/front-door/rooms/join/abc123" -> 200 to """{"room":{"id":"r5","name":"Book club","by":"dee"},"member":false}"""
            "POST" to "/front-door/rooms/join/abc123" -> 200 to """{"room":{"id":"r5","name":"Book club","by":"dee"}}"""
            "GET" to "/front-door/rooms/r1" -> 200 to """{"room":$room}"""
            "GET" to "/front-door/rooms/r1/link" -> 200 to """{"link":null}"""
            "GET" to "/front-door/rooms/r1/messages" -> 200 to messages
            "POST" to "/front-door/rooms/r1/messages" -> 201 to """{"message":{"id":"m3","at":"2026-11-14T12:05:00Z","account":"ann","text":"Yes"}}"""
            "POST" to "/front-door/rooms/r1/name" -> 200 to """{"room":${room.replace("\"Plans\"", "\"Plans 2\"")}}"""
            "POST" to "/front-door/rooms/r1/leave" -> 200 to "{}"
            else -> 404 to """{"error":"No such thing"}"""
        }
    }

    private fun TestScope.hub(s: FakeServer) = RoomsHub(backgroundScope, MutableStateFlow(s.api), MutableStateFlow(VersionInfo(features = listOf("accounts"))), MutableStateFlow(false))

    /** Runs what is due until [ready]: the fake front door answers on a thread of its own. */
    private suspend fun TestScope.until(ready: () -> Boolean) {
        repeat(400) {
            runCurrent()
            if (ready()) return
            withContext(Dispatchers.Default) { delay(5) }
        }
        throw AssertionError("never ready")
    }

    private fun body(t: Took): JsonObject = Api.JSON.parseToJsonElement(t.body).jsonObject

    @Test fun theListHasTheInvitationsThenTheRooms() = runTest {
        val s = server()
        val desk = RoomsDesk(hub(s), s.api, backgroundScope) { it.orEmpty() }
        until { desk.state.value.loaded }
        val st = desk.state.value
        assertTrue(st.on)
        assertTrue(st.links)
        assertEquals(listOf(RoomInviteView("r2", "Garden", "cy invites you")), st.invites)
        assertEquals(listOf(RoomRowView("r1", "Plans", "bob: Lunch?", "2026-11-14T12:00:00Z")), st.rooms)
        assertEquals("1 invitation", st.row, "Home's row says what waits")
        assertFalse(st.empty)
    }

    @Test fun aNewRoomIsMadeWithItsLinkAndOpens() = runTest {
        val s = server()
        val hub = hub(s)
        val desk = RoomsDesk(hub, s.api, backgroundScope)
        until { desk.state.value.loaded }
        assertEquals(RoomsDone(room = "r9"), desk.make("  Trip "))
        val posts = s.posts()
        assertEquals("Trip", body(posts[0]).getValue("name").jsonPrimitive.content)
        assertEquals("/front-door/rooms/r9/link", posts[1].path, "its invite link is made with it")
        assertEquals("r9", hub.list.value?.rooms?.first()?.id, "first in the list")
    }

    @Test fun anInvitationIsAcceptedOrDeclined() = runTest {
        val s = server()
        val hub = hub(s)
        val desk = RoomsDesk(hub, s.api, backgroundScope)
        until { desk.state.value.loaded }
        assertEquals(RoomsDone(room = "r2"), desk.accept("r2"))
        runCurrent()
        assertEquals(listOf("r2", "r1"), desk.state.value.rooms.map { it.id })
        assertTrue(desk.state.value.invites.isEmpty())
        assertEquals(RoomsDone(), desk.decline("r2"))
        assertEquals(listOf("/front-door/rooms/r2/accept", "/front-door/rooms/r2/decline"), s.posts().map { it.path })
    }

    @Test fun aLinkIsReadThenJoined() = runTest {
        val s = server()
        val desk = RoomsDesk(hub(s), s.api, backgroundScope)
        assertEquals(RoomWords.NOT_A_LINK, desk.look("hello").failed)
        val seen = desk.look("https://botdot.test/#rooms/join=abc123")
        assertEquals("abc123", seen.token)
        assertEquals("Join Book club?", seen.title)
        assertEquals("dee made this room and shared its invite link.", seen.says)
        assertEquals(RoomsDone(room = "r5"), desk.join("abc123"))
        assertEquals(listOf("/front-door/rooms/join/abc123"), s.posts().map { it.path })
    }

    @Test fun aFailureSaysTheFrontDoorsSentence() = runTest {
        val s = server { t -> if (t.method == "POST" && t.path == "/front-door/rooms") 400 to """{"error":"A room's name is 1 to 60 characters."}""" else null }
        val desk = RoomsDesk(hub(s), s.api, backgroundScope)
        assertEquals("A room's name is 1 to 60 characters.", desk.make("x").failed)
    }

    @Test fun aRoomOpensWithItsMessagesEachUnderWhoWroteIt() = runTest {
        val s = server()
        val hub = hub(s)
        val chat = RoomChatDesk(backgroundScope, s.api, hub, "r1", MutableSharedFlow()) { it.orEmpty() }
        until { hub.list.value != null && hub.account.value != null }
        chat.start()
        until { chat.state.value.loaded }
        val st = chat.state.value
        assertEquals("Plans", st.name)
        assertEquals("Message Plans…", st.placeholder)
        assertEquals(listOf(RoomLineKind.NOTICE, RoomLineKind.MINE, RoomLineKind.THEIRS), st.lines.map { it.kind })
        assertEquals("mentioned @Pip · bob", st.lines[1].mentioned)
        val pip = st.lines[2]
        assertEquals("Pip · bob", pip.author)
        assertTrue(pip.bot)
        assertEquals("#AA3300", pip.color, "in its colour as the room has it")
        assertNull(st.empty)
        chat.stop()
    }

    @Test fun aSentMessageIsInTheChatAndOneThatFailedComesBackWithItsKey() = runTest {
        var refuse = true
        val s = server { t -> if (t.method == "POST" && t.path == "/front-door/rooms/r1/messages" && refuse) 503 to "{}" else null }
        val hub = hub(s)
        val chat = RoomChatDesk(backgroundScope, s.api, hub, "r1", MutableSharedFlow())
        until { hub.account.value != null }
        chat.start()
        until { chat.state.value.loaded }

        assertFalse(chat.send("Yes"))
        val failed = chat.state.value
        assertEquals("Yes", failed.back, "the message waits for the box")
        assertTrue(failed.note.orEmpty().endsWith("Your message is still here."))
        assertEquals("Yes", chat.takeFailed())

        refuse = false
        assertTrue(chat.send("Yes"))
        val keys = s.posts().filter { it.path.endsWith("/messages") }.map { body(it).getValue("key").jsonPrimitive.content }
        assertEquals(2, keys.size)
        assertEquals(keys[0], keys[1], "sent again as it was: the same key, so the front door takes it once")
        val st = chat.state.value
        assertNull(st.note)
        assertNull(st.sent)
        assertEquals(RoomLineKind.MINE, st.lines.last().kind)
        assertEquals("Yes", st.lines.last().text)
        chat.stop()
    }

    @Test fun theRoomsEventsBringItsNewMessages() = runTest {
        val s = server()
        val hub = hub(s)
        val events = MutableSharedFlow<FeedEvent>()
        val chat = RoomChatDesk(backgroundScope, s.api, hub, "r1", events)
        chat.start()
        until { chat.state.value.loaded && events.subscriptionCount.value == 1 }
        fun ev(room: String, id: String) = FeedEvent(null, "room_message", Api.JSON.parseToJsonElement(
            """{"roomId":"$room","message":{"id":"$id","at":"2026-11-14T13:00:00Z","account":"bob","text":"Later"}}""").jsonObject)
        events.emit(ev("r7", "x1")) // another room's
        events.emit(ev("r1", "m4"))
        runCurrent()
        assertEquals(listOf("m0", "m1", "m2", "m4"), chat.state.value.lines.map { it.id })
        chat.stop()
    }

    @Test fun aStoppedChatFollowsNothingNotEvenALoadThatAnswersLate() = runTest {
        val gate = CompletableDeferred<Unit>()
        val s = server { t -> if (t.path == "/front-door/rooms/r1/messages" && t.method == "GET") { gate.await(); null } else null }
        val events = MutableSharedFlow<FeedEvent>()
        val chat = RoomChatDesk(backgroundScope, s.api, hub(s), "r1", events)
        chat.start()
        runCurrent()
        // A pull to refresh is under way when the chat is left; it answers after.
        val pull = backgroundScope.launch { chat.load() }
        chat.stop()
        gate.complete(Unit)
        until { pull.isCompleted }
        runCurrent()
        assertEquals(0, events.subscriptionCount.value, "no stream outlives the screen")
        chat.load()
        runCurrent()
        assertEquals(0, events.subscriptionCount.value, "nor one asked after")

        chat.start() // back on screen: followed again
        until { events.subscriptionCount.value == 1 }
        chat.stop()
        runCurrent()
        assertEquals(0, events.subscriptionCount.value)
    }

    @Test fun theSettingsShowPeopleBotsAndWhatThisAccountMayDo() = runTest {
        val s = server()
        val hub = hub(s)
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.bots.set(listOf(
            Api.JSON.decodeFromString(Bot.serializer(), """{"id":"scout","name":"Scout","rooms":{"allowRooms":true}}"""),
            Api.JSON.decodeFromString(Bot.serializer(), """{"id":"owl","name":"Owl","color":"#123456","rooms":{"allowRooms":true}}"""),
            Api.JSON.decodeFromString(Bot.serializer(), """{"id":"mole","name":"Mole"}"""),
        ))
        val desk = RoomSettingsDesk(hub, s.api, store, "r1", backgroundScope)
        until { desk.state.value.room && desk.state.value.linkShown }
        val st = desk.state.value
        assertEquals(listOf("ann (you)", "bob"), st.people)
        assertEquals(listOf("cy · invited by ann"), st.invited)
        assertNull(st.link, "no link yet: Make an invite link")
        assertEquals(listOf("Scout · ann" to true, "Pip · bob" to false), st.bots.map { it.label to it.removable })
        assertEquals(listOf("owl"), st.addable.map { it.id }, "allowed in rooms and not in it yet")
        assertFalse(st.noneAllowed)
        assertTrue(st.mayDelete)

        desk.rename(" Plans 2 ")
        until { desk.state.value.name == "Plans 2" }
        assertEquals("Saved", desk.state.value.notice)
        assertEquals("Plans 2", body(s.posts().last()).getValue("name").jsonPrimitive.content)

        desk.leave(delete = false)
        until { desk.state.value.gone }
        assertEquals("/front-door/rooms/r1/leave", s.posts().last().path)
        assertTrue(hub.list.value?.rooms.orEmpty().none { it.id == "r1" })
        desk.close()
    }

    @Test fun theMovedWordsAreAndroids() {
        assertNull(RoomWords.rowLine(0))
        assertEquals("3 invitations", RoomWords.rowLine(3))
        assertEquals("Delete Plans?", RoomWords.askTitle(true, "Plans"))
        assertEquals("Leave", RoomWords.askYes(false))
        assertEquals("Message the room…", RoomChat.placeholder(null))
        assertTrue(Rooms.noneAllowed(listOf(Api.JSON.decodeFromString(Bot.serializer(), """{"id":"a","name":"A"}"""))))
    }
}
