package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Block
import dev.botdot.app.data.BlockDelta
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Dashboard
import dev.botdot.app.data.Tile
import dev.botdot.app.data.TileLook
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Board drawn from blocks (#394), as the web page draws it (test/board-blocks-web.test.js). */
class BoardKitTest {
    private fun tile(id: String, kind: String, face: List<Block> = emptyList(), size: String = "small", bot: String? = null, source: String? = null) =
        Tile(id = id, kind = kind, size = size, bot = bot, source = source, look = TileLook(face = face))

    @Test fun theLiveMarkerSaysTheAgeOfTheNewestValue() {
        assertEquals("a tile and a heading say only how long ago it read", "1 min ago", BoardKit.ageWords(65))
        assertEquals("Live · updated 3s ago", BoardKit.liveWords(3))
        assertEquals("Live · updated 0s ago", BoardKit.liveWords(-2))
        assertEquals("Live · updated 2 min ago", BoardKit.liveWords(125))
        assertEquals("Live · updated 2 h ago", BoardKit.liveWords(7300))
        val tiles = listOf(Tile(id = "a", at = "2026-10-22T08:00:00Z"), Tile(id = "b"), Tile(id = "c", at = "2026-10-22T09:00:00Z"))
        assertEquals(java.time.Instant.parse("2026-10-22T09:00:00Z").toEpochMilli(), BoardKit.newestAt(tiles))
        assertEquals(0L, BoardKit.newestAt(emptyList()))
    }

    @Test fun switchesAndButtonsAsTheyComeAreRowsOfTheControlsBox() {
        assertTrue(BoardKit.isControlRow(tile("a", "switch")))
        assertTrue(BoardKit.isControlRow(tile("b", "button")))
        assertFalse(BoardKit.isControlRow(tile("c", "switch", size = "wide")))
        assertFalse(BoardKit.isControlRow(tile("d", "switch", face = listOf(Block("switch")))))
        assertFalse(BoardKit.isControlRow(tile("e", "value")))
    }

    @Test fun aTileOfOneNumberIsAKpiTwoAcrossOnAPhone() {
        val kpi = tile("k", "value", listOf(Block("value", text = "14")))
        assertTrue(BoardKit.isKpiTile(kpi))
        assertFalse(BoardKit.isKpiTile(tile("x", "custom", listOf(Block("kpi"), Block("callout")))))
        assertEquals(1, BoardKit.span(kpi, 2))
        assertEquals("one across", 2, BoardKit.span(tile("l", "list"), 2))
        assertEquals(1, BoardKit.span(tile("l", "list"), 4))
        assertEquals(2, BoardKit.span(tile("w", "note", size = "wide"), 4))
        assertEquals(3, BoardKit.span(tile("r", "note", size = "row"), 3))
        assertEquals(2, BoardKit.columns(390f))
        assertEquals(3, BoardKit.columns(700f))
        assertEquals(4, BoardKit.columns(1000f))
    }

    @Test fun aHeadingNamesItsBotsAndOneSource() {
        val bots = listOf(Bot(id = "b1", name = "Home Helper"), Bot(id = "b2", name = "Server Watch"))
        val tiles = listOf(tile("a", "value", bot = "b1", source = "script · 30 s"), tile("b", "value", bot = "b2"), tile("c", "value", bot = "b1", source = "script · 30 s"), tile("d", "value", bot = "gone"))
        assertEquals("Home Helper, Server Watch", BoardKit.sectionBots(tiles, bots))
        assertEquals("script · 30 s", BoardKit.sectionSource(tiles))
        assertEquals("", BoardKit.sectionSource(tiles + tile("e", "value", source = "http · 1 min")))
    }

    @Test fun aKpiSaysHowItChangedAndSinceWhen() {
        val b = Block("kpi", delta = BlockDelta("0.8", "up", true), since = "2026-10-22T08:00:00Z")
        assertEquals("▲ 0.8 since 08:00", BoardKit.deltaLine(b) { java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneOffset.UTC).let { t -> "%02d:%02d".format(t.hour, t.minute) } })
        assertEquals("▼ 2", BoardKit.deltaLine(Block("kpi", delta = BlockDelta("2", "down", false))))
        assertEquals("", BoardKit.deltaLine(Block("kpi")))
        assertTrue(BoardKit.hasMarkdown(listOf(Block("row", blocks = listOf(Block("text", markdown = true))))))
        assertEquals("info", BoardKit.level("purple"))
    }

    @Test fun theBoardReadsTheNewBlocksAndAnOldServersToo() {
        val json = """{"sections":["Server"],"tiles":[{"id":"t1","kind":"custom","title":"CPU","section":"Server","at":"2026-10-22T08:00:00Z","source":"script · 30 s","ai":false,
            "look":{"dot":null,"tap":"none","short":"","face":[
              {"type":"kpi","text":"62","unit":"%","of":"4","sub":"380 GB free","subColor":"muted","points":[60,62],"times":[1,2],"delta":{"text":"2","dir":"up","good":null},"since":"2026-10-22T08:00:00.000Z","ratio":0.62},
              {"type":"chart","style":"area","points":[1,2],"series":[{"points":[1,null,2],"label":"CPU","color":"#3b82f6"}],"labels":["a","b","c"]},
              {"type":"chart","style":"hbar","points":[],"bars":[{"label":"Inbox","text":"14","ratio":1}]},
              {"type":"status","text":"All good","level":"ok"},{"type":"callout","text":"Restart","title":"Waiting","level":"warn"},{"type":"sparkles"}]}}]}"""
        val d = Api.JSON.decodeFromString(Dashboard.serializer(), json)
        val face = d.tiles[0].look!!.face
        assertEquals("script · 30 s", d.tiles[0].source)
        assertEquals("4", face[0].of)
        assertEquals(null, face[0].delta!!.good)
        assertEquals(listOf(1.0, null, 2.0), face[1].series[0].points)
        assertEquals("Inbox", face[2].bars[0].label)
        assertEquals("ok", face[3].level)
        assertEquals("Waiting", face[4].title)
        assertEquals("sparkles", face[5].type)
    }
}
