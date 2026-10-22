package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Shared rooms (ADR 060, #318, #316): what the app reads of the front door's rooms and of a bot's room settings. */
class RoomsTest {
    private fun obj(s: String): JsonObject = Api.JSON.parseToJsonElement(s).jsonObject
    private fun ev(type: String, data: String) = FeedEvent(null, type, obj(data))

    private val room = """{"id":"r1","name":"Plans","by":"ann","members":[{"account":"ann"},{"account":"bob"}],
        "bots":[{"account":"ann","id":"scout","name":"Scout","color":"#378ADD"},{"account":"bob","id":"b7","name":"Pip"}],
        "invites":[{"account":"cy","by":"ann"}],"last":null,"working":[{"account":"bob","bot":"b7"}],"extra":1}"""

    @Test fun roomsShowOnlyWhenTheFrontDoorSaysSo() {
        assertTrue(Rooms.on(listOf("accounts"), obj("""{"rooms":true,"account":"ann"}""")))
        assertFalse(Rooms.on(listOf("accounts"), obj("""{"rooms":false}""")))
        assertFalse(Rooms.on(listOf("accounts"), obj("""{"rooms":"true"}""")))
        assertFalse(Rooms.on(listOf("accounts"), obj("{}"))) // an older front door
        assertFalse(Rooms.on(emptyList(), obj("""{"rooms":true}"""))) // no front door
        assertFalse(Rooms.on(null, obj("""{"rooms":true}""")))
        assertEquals("ann", Rooms.account(obj("""{"account":"ann"}""")))
        assertNull(Rooms.account(obj("{}")))
        assertNull(Rooms.account(null))
    }

    @Test fun aRoomIsReadAsTheFrontDoorSendsIt() {
        val a = Api.JSON.decodeFromString<RoomsAnswer>("""{"rooms":[$room],"invites":[{"room":{"id":"r2","name":"Trip","by":"cy"},"by":"cy","at":"2026-10-22T13:00:00Z"}]}""")
        val r = a.rooms.single()
        assertEquals("Plans", r.name)
        assertEquals(listOf("ann", "bob"), r.members.map { it.account })
        assertEquals("Pip · bob", Rooms.label(r.bots[1].name, r.bots[1].account))
        assertEquals("Pip · bob is writing…", Rooms.workingLine(r))
        assertEquals("2 people, 2 bots", Rooms.summary(r))
        assertEquals("r2", a.invites.single().room.id)
    }

    @Test fun aMessageSaysWhoWroteItAndWhomItMentioned() {
        val bot = Api.JSON.decodeFromString<RoomMessage>("""{"id":"m2","at":"2026-10-22T13:01:00Z","account":"bob","bot":{"id":"b7","name":"Pip"},"text":"Sure","mentions":[]}""")
        val person = Api.JSON.decodeFromString<RoomMessage>("""{"id":"m1","account":"ann","bot":null,"text":"@Pip what now?","mentions":[{"account":"bob","bot":"b7","name":"Pip"},{"account":"bob","bot":"b7","name":"Pip"}]}""")
        val notice = Api.JSON.decodeFromString<RoomMessage>("""{"id":"m3","account":"","text":"bob joined","kind":"notice"}""")
        assertEquals("Pip · bob", Rooms.author(bot))
        assertEquals("ann", Rooms.author(person))
        assertEquals("", Rooms.author(notice))
        assertTrue(notice.notice)
        assertEquals("mentioned @Pip · bob", Rooms.mentionLine(person))
        assertEquals("", Rooms.mentionLine(bot))
    }

    @Test fun theMentionPickerOffersTheRoomsBotsWithTheirAccounts() {
        val r = Api.JSON.decodeFromString<Room>(room)
        val w = Rooms.world(r)!!
        val rows = Mentions.suggest("hi @", w)
        assertEquals(listOf("@Scout", "@Pip"), rows.map { it.text })
        assertEquals(listOf("Scout · ann", "Pip · bob"), rows.map { it.label })
        assertEquals(listOf("bob/b7"), Mentions.find("ask @pip", w).map { it.bot }) // matched whatever its case
        assertNull(Rooms.world(null))
    }

    @Test fun liveEventsKeepTheListUpToDate() {
        val start = RoomsAnswer()
        val withRoom = Rooms.applied(start, ev("room", """{"room":$room}"""))
        assertEquals(listOf("r1"), withRoom.rooms.map { it.id })
        val invited = Rooms.applied(withRoom, ev("invite", """{"room":{"id":"r2","name":"Trip","by":"cy"},"by":"cy"}"""))
        assertEquals(listOf("r2"), invited.invites.map { it.room.id })
        assertEquals(1, Rooms.applied(invited, ev("invite", """{"room":{"id":"r2","name":"Trip","by":"cy"},"by":"cy"}""")).invites.size) // told twice: one invitation
        val said = Rooms.applied(invited, ev("room_message", """{"roomId":"r1","message":{"id":"m9","account":"ann","text":"hello"}}"""))
        assertEquals("ann: hello", Rooms.summary(said.rooms.single()))
        assertEquals(said, Rooms.applied(said, ev("something_new", "{}")))
        assertTrue(Rooms.applied(said, ev("invite_gone", """{"id":"r2"}""")).invites.isEmpty())
        assertTrue(Rooms.applied(said, ev("room_gone", """{"id":"r1"}""")).rooms.isEmpty())
        // Accepted: the room is in, and its invitation no longer waits.
        val accepted = Rooms.withRoom(invited, Api.JSON.decodeFromString<Room>(room).copy(id = "r2"))
        assertEquals(listOf("r2", "r1"), accepted.rooms.map { it.id })
        assertTrue(accepted.invites.isEmpty())
    }

    @Test fun aRoomScreenTakesOnlyItsOwnMessages() {
        val e = ev("room_message", """{"roomId":"r1","message":{"id":"m9","account":"ann","text":"hello"}}""")
        assertEquals("m9", Rooms.messageOf(e, "r1")?.id)
        assertNull(Rooms.messageOf(e, "r2"))
        assertNull(Rooms.messageOf(ev("room", """{"room":$room}"""), "r1"))
    }

    @Test fun messagesMergeByIdOldestFirst() {
        fun m(id: String, at: String, text: String = id) = RoomMessage(id = id, at = at, account = "ann", text = text)
        val held = listOf(m("a", "2026-10-22T10:00:00Z"), m("b", "2026-10-22T11:00:00Z"))
        val merged = Rooms.merge(held, listOf(m("c", "2026-10-22T12:00:00Z"), m("b", "2026-10-22T11:00:00Z", "edited")))
        assertEquals(listOf("a", "b", "c"), merged.map { it.id })
        assertEquals("edited", merged[1].text)
        assertEquals(listOf("z", "a", "b"), Rooms.merge(held, listOf(m("z", "2026-10-22T09:00:00Z"))).map { it.id })
    }

    @Test fun onlyYourOwnAllowedBotsCanBeAddedAndOnlyTheMakerDeletes() {
        val r = Api.JSON.decodeFromString<Room>(room)
        val allowed = obj("""{"allowRooms":true,"whoMayMention":"owner"}""")
        val mine = listOf(
            Bot(id = "scout", name = "Scout", roomsValue = allowed), // in already
            Bot(id = "b7", name = "Seven", roomsValue = allowed), // bob's b7 is another bot
            Bot(id = "kept", name = "Kept", roomsValue = obj("""{"allowRooms":false}""")),
            Bot(id = "old", name = "Old"),
        )
        assertEquals(listOf("b7"), Rooms.addable(r, mine, "ann").map { it.id })
        assertTrue(Rooms.mayDelete(r, "ann"))
        assertFalse(Rooms.mayDelete(r, "bob"))
        assertFalse(Rooms.mayDelete(r, null))
    }

    @Test fun aBotsRoomSettingsAreReadAndChangedAsTheServerKeepsThem() {
        assertNull(BotRooms.of(null))
        assertEquals(BotRooms(false, BotRooms.OWNER), BotRooms.of(obj("{}")))
        assertEquals(BotRooms(true, BotRooms.MEMBERS), BotRooms.of(obj("""{"allowRooms":true,"whoMayMention":"anyone"}""")))
        assertEquals(BotRooms(true, BotRooms.MEMBERS), BotRooms.of(obj("""{"allowRooms":true,"whoMayMention":"room members"}""")))
        assertEquals(BotRooms(false, BotRooms.OWNER), BotRooms.of(obj("""{"allowRooms":"true","whoMayMention":"everyone"}""")))
        val was = BotRooms(false, BotRooms.OWNER)
        assertNull(BotRooms.change(was, was))
        assertEquals(obj("""{"allowRooms":true}"""), BotRooms.change(was, was.copy(allowRooms = true)))
        assertEquals(obj("""{"allowRooms":true,"whoMayMention":"anyone"}"""), BotRooms.change(was, BotRooms(true, BotRooms.MEMBERS)))
        assertFalse(BotRooms.shows(null))
        assertFalse(BotRooms.shows(listOf("accounts")))
        assertTrue(BotRooms.shows(listOf(BotRooms.FEATURE)))
        assertEquals(BotRooms(true, BotRooms.MEMBERS), Api.JSON.decodeFromString<Bot>("""{"id":"x","name":"X","rooms":{"allowRooms":true,"whoMayMention":"anyone"}}""").rooms)
    }

    @Test fun aMessageGoesWithItsKey() {
        assertEquals(obj("""{"text":"hi","key":"k1"}"""), Rooms.messageBody("hi", "k1"))
        assertEquals(obj("""{"text":"hi"}"""), Rooms.messageBody("hi", null))
    }
}
