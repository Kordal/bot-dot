package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Every script the card of a waiting tile lists (GET /api/dashboard, `pending`), and a chip's `waits`. */
class TileScriptsTest {
    private fun tile(json: String) = Api.JSON.decodeFromString(Tile.serializer(), json)

    @Test fun theServersListIsWhatTheCardShows() {
        val t = tile("""{"id":"t1","kind":"custom","title":"Lights","scripts":["hue on","hue off","hue state"],"read":{"type":"script","script":"other"}}""")
        assertEquals(listOf("hue on", "hue off", "hue state"), t.scripts)
    }

    @Test fun withoutTheListEverySourceOfTheTileIsRead() {
        // An older server: read, do, turnOn, turnOff, then every named read and action, as the web page gathers them.
        val t = tile("""{"id":"t1","kind":"custom","title":"Lights",
            "read":{"type":"script","script":"state"},"do":{"type":"script","script":"press"},
            "turnOn":{"type":"script","script":"on"},"turnOff":{"type":"script","script":"off"},
            "reads":{"level":{"type":"script","script":"level"},"name":{"type":"bot","script":""}},
            "actions":{"dim":{"type":"script","script":"dim"}}}""")
        assertEquals(listOf("state", "press", "on", "off", "level", "dim"), t.scripts)
        // A tile built from blocks alone: its named read and its named action.
        val blocks = tile("""{"id":"t2","kind":"custom","reads":{"temp":{"type":"script","script":"sensors"}},"actions":{"fan":{"type":"script","script":"fan on"}}}""")
        assertEquals(listOf("sensors", "fan on"), blocks.scripts)
        // The simple tile of before.
        assertEquals(listOf("uptime"), tile("""{"id":"t3","read":{"type":"script","script":"uptime"}}""").scripts)
        assertEquals(emptyList<String>(), tile("""{"id":"t4","read":{"type":"bot","script":""}}""").scripts)
    }

    @Test fun fieldsOfAnUnexpectedKindLeaveTheBoardReadable() {
        val board = Api.JSON.decodeFromString(Dashboard.serializer(), """{"pending":[
            {"id":"t1","title":"A","scripts":"not a list","reads":["x"],"actions":7,"read":{"type":"script","script":"a"}},
            {"id":"t2","title":"B","scripts":["b",3,null,{"x":1}],"reads":{"r":"no source","s":{"type":"script"}}},
            {"id":"t3","title":"C","scripts":[],"turnOn":{"type":"script","script":"c"}}]}""")
        assertEquals(listOf(listOf("a"), listOf("b"), listOf("c")), board.pending.map { it.scripts })
    }

    @Test fun aChipsWaits() {
        val chat = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[{"role":"chief","text":"Made it.","actions":[
            {"kind":"created","text":"Created Web Surfer","botId":"b1","waits":" web access waits for your OK "},
            {"kind":"run","text":"Started Coder","botId":"b2"},
            {"kind":"job","text":"Nightly","waits":""},
            {"kind":"job","text":"Odd","waits":3},
            {"kind":"job","text":"Odder","waits":{"a":1}}]}]}""")
        val actions = chat.messages.single().actions.orEmpty()
        assertEquals("web access waits for your OK", actions[0].waits)
        actions.drop(1).forEach { assertNull(it.text, it.waits) }
        assertEquals("✨ Created Web Surfer", actions[0].label)
    }
}
