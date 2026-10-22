package dev.botdot.app.feed

import dev.botdot.app.data.FeedEvent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What rings for a shared room (ADR 060; docs/api.md, "A new message in a shared room"): the server's `room_notice`
 * (lib/room-notice.js) under the room's name, with who wrote it as the front door labels them.
 */
class RoomNotifierTest {
    private fun event(data: String, type: String = "room_notice") = FeedEvent("boot.9", type, Json.parseToJsonElement(data).jsonObject)

    @Test fun aMessageOfAnotherAccountRingsUnderTheRoomsName() {
        val n = roomNoticeOf(event("""{"roomId":"0123abcd","roomName":"Garden club","from":{"name":"Scout · ann","account":"ann","botId":"b9"},"preview":"Tomatoes first.","at":"2026-10-22T13:00:00Z"}"""))
        assertEquals(RoomNotice("room:0123abcd", "Garden club", "Scout · ann", "Tomatoes first.", "b9", null), n)
        val person = roomNoticeOf(event("""{"roomId":"0123abcd","roomName":"Garden club","from":{"name":"ann","account":"ann"},"preview":"Hi"}"""))
        assertEquals("ann" to null, person?.from to person?.botId)
    }

    @Test fun aBotOfThisAccountWearsItsColour() {
        val n = roomNoticeOf(event("""{"roomId":"r1","roomName":"Dev","from":{"name":"Coder · bob","account":"bob","botId":"coder","color":"#3b82f6"},"preview":"Done."}"""))
        assertEquals("coder" to "#3b82f6", n?.botId to n?.color)
    }

    @Test fun nothingWhileTheWebPageIsInUseOrWithoutARoom() {
        assertNull(roomNoticeOf(event("""{"roomId":"r1","roomName":"Dev","from":{"name":"ann"},"preview":"x","webActive":true}""")))
        assertNull(roomNoticeOf(event("""{"roomName":"Dev","from":{"name":"ann"},"preview":"x"}""")))
        assertNull("another event", roomNoticeOf(event("""{"roomId":"r1"}""", type = "run_finished")))
        assertEquals("names fall back", "A room" to "Someone", roomNoticeOf(event("""{"roomId":"r1"}"""))?.let { it.room to it.from })
    }
}
