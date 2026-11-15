package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext

/**
 * The Board as a phone draws it (BoardDesk, #1372): the Android app's order, colours, notes and taps, from the shared
 * Store, with what a tap sends going to a fake botdot ([FakeServer]).
 */
class BoardDeskTest {
    private fun dash(json: String): Dashboard = Api.JSON.decodeFromString(Dashboard.serializer(), json)
    private fun tile(json: String): Tile = Api.JSON.decodeFromString(Tile.serializer(), json)

    private val board = """{"sections":["Home","Garden"],"tiles":[
        {"id":"t1","kind":"switch","title":"Lamp","section":"Home","bot":"keeper","look":{"dot":{"filled":false},"tap":"toggle"},"confirm":"on"},
        {"id":"t2","kind":"button","title":"Doorbell","section":"Home","look":{"tap":"act"}},
        {"id":"t3","kind":"value","title":"Temperature","section":"Garden","look":{"face":[{"type":"value","text":"21.5"}],"tap":"refresh"},"bot":"keeper"},
        {"id":"g","kind":"group","title":"Lights","look":{"tap":"group"}},
        {"id":"g1","kind":"switch","title":"Hall","parent":"g","bot":"keeper","look":{"dot":{"filled":true},"tap":"toggle"}},
        {"id":"n","kind":"note","title":"Plan","look":{"face":[{"type":"text","text":"x"}],"tap":"chat"},"bot":"keeper"}
        ],"pending":[{"id":"t2","kind":"button","title":"Doorbell"}]}"""

    private fun TestScope.desk(server: FakeServer = FakeServer { 200 to board }): Triple<Store, BoardDesk, FakeServer> {
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.bots.set(listOf(Api.JSON.decodeFromString(Bot.serializer(), """{"id":"keeper","name":"Home Keeper","color":"#336699"}""")))
        store.version.set(VersionInfo(features = listOf(TileAsk.FEATURE)))
        store.dashboard.set(dash(board))
        return Triple(store, BoardDesk(store, server.api, backgroundScope), server)
    }

    @Test fun theBoardIsLaidOutAsOnAndroid() {
        val d = dash(board)
        assertEquals(listOf("g", "n", "h:Home", "t1", "t2", "h:Garden", "t3"), BoardKit.layout(d, "", emptySet()))
        assertEquals(listOf("g", "in:g", "g1", "out:g", "n", "h:Home", "t1", "t2", "h:Garden", "t3"), BoardKit.layout(d, "", setOf("g")))
        assertEquals(listOf("h:Garden", "t3"), BoardKit.layout(d, "Garden", emptySet()))
        assertEquals(listOf("Home", "Garden"), BoardKit.headings(d))
    }

    @Test fun aTapDoesWhatTheTileSays() {
        val bots = setOf("keeper")
        val d = dash(board).tiles.associateBy { it.id }
        assertEquals(BoardTap.Ask(true), BoardTap.of(d.getValue("t1"), false, bots), "a switch that asks before it turns on")
        assertEquals(BoardTap.Send(true), BoardTap.of(d.getValue("t1"), false, bots, asked = true))
        assertEquals(BoardTap.Needs, BoardTap.of(d.getValue("t2"), true, bots), "waiting for the owner's OK")
        assertEquals(BoardTap.Send(null), BoardTap.of(d.getValue("t3"), false, bots))
        assertEquals(BoardTap.Group, BoardTap.of(d.getValue("g"), true, bots), "a group opens even while it waits")
        assertEquals(BoardTap.Chat("keeper"), BoardTap.of(d.getValue("n"), false, bots))
        assertEquals(BoardTap.Quiet, BoardTap.of(d.getValue("n"), false, emptySet()), "a bot that is gone")
        assertEquals(BoardTap.Send(false), BoardTap.of(d.getValue("g1"), false, bots), "on turns off")
        assertEquals(BoardTap.Page("chief", "plan"), BoardTap.of(tile("""{"id":"p","kind":"page","page":{"bot":"chief","slug":"plan"}}"""), false, bots))
        assertEquals("Turn on “Lamp”?", BoardKit.askTitle(d.getValue("t1"), true))
        assertEquals("Turn off", BoardKit.askYes(false))
    }

    @Test fun cellsArePackedIntoRowsByTheirSpan() {
        fun c(k: String, span: Int) = BoardCell(k, BoardCellKind.TILE, span = span)
        val rows = BoardDesk.pack(listOf(c("a", 1), c("b", 2), c("c", 1), c("d", 1), c("e", 1)), 2)
        assertEquals(listOf(listOf("a"), listOf("b"), listOf("c", "d"), listOf("e")), rows.map { r -> r.map { it.key } })
    }

    @Test fun eachCellHasItsColourNoteAndPlace() = runTest {
        val (_, desk, _) = desk()
        runCurrent()
        val s = desk.state.value
        assertTrue(s.loaded)
        assertEquals(listOf("", "Home", "Garden"), s.filters)
        val cells = s.rows.flatten().associateBy { it.key }
        assertEquals(BoardCellKind.HEADING, cells.getValue("h:Home").kind)
        assertEquals("Home Keeper", cells.getValue("h:Home").bots)
        // The switch and the button under Home read as one Controls box.
        assertEquals(BoardCellKind.CONTROL, cells.getValue("t1").kind)
        assertTrue(cells.getValue("t1").first)
        assertFalse(cells.getValue("t1").last)
        assertTrue(cells.getValue("t2").last)
        assertEquals("Waiting for your OK", cells.getValue("t2").note)
        assertEquals("#336699", cells.getValue("t3").color)
        // A group takes its tiles' bot's colour, and one dot per tile in it.
        assertEquals("#336699", cells.getValue("g").color)
        assertEquals(listOf(BoardDot(true, "#336699")), cells.getValue("g").inside)
        assertEquals(1, cells.getValue("g").holds)
        assertTrue(cells.getValue("g").askable)
    }

    @Test fun theColourWheelIsHueAroundAndWhiteInTheMiddle() {
        assertEquals("#ff0000", BoardKit.wheelHex(1.0, 0.5), "red at the right")
        assertEquals("#ffffff", BoardKit.wheelHex(0.5, 0.5), "white in the middle")
        assertEquals("#00ffff", BoardKit.wheelHex(0.0, 0.5), "cyan across from red")
        assertEquals("#80ff00", BoardKit.wheelHex(0.5 + 0.5 * kotlin.math.cos(kotlin.math.PI / 3 * 1.5), 0.5 + 0.5 * kotlin.math.sin(kotlin.math.PI / 3 * 1.5)), "clockwise: yellow, then green")
        val (x, y) = BoardKit.wheelAt("#ff0000")!!
        assertEquals(1.0, x, 1e-9); assertEquals(0.5, y, 1e-9)
        val (cx, cy) = BoardKit.wheelAt("#ffffff")!!
        assertEquals(0.5, cx, 1e-9); assertEquals(0.5, cy, 1e-9)
        assertNull(BoardKit.wheelAt("warm"), "not a colour: no mark")
        assertEquals("#00ffff", BoardKit.wheelAt("#00ffff")!!.let { (a, b) -> BoardKit.wheelHex(a, b) })
    }

    @Test fun whileTheWheelIsDraggedTheTileStaysAndLettingGoDrawsIt() = runTest {
        val light = """{"id":"l","kind":"light","title":"Lamp","look":{"face":[{"type":"row","blocks":[{"type":"color","key":"c","value":"#ff0000"}]}],"tap":"panel"}}"""
        val answer = """{"id":"l","kind":"light","title":"Lamp","look":{"face":[{"type":"row","blocks":[{"type":"color","key":"c","value":"#00ff00"}]}],"tap":"panel"}}"""
        // A refresh of the Board reads the new colour only once it is let go (the second act), so the test sees the
        // desk's own redraw, not a refresh's.
        var acts = 0
        val (store, desk, server) = desk(FakeServer { t ->
            if (t.path.endsWith("/act")) { acts++; 200 to answer } else 200 to """{"tiles":[${if (acts >= 2) answer else light}]}"""
        })
        store.dashboard.set(dash("""{"tiles":[$light]}"""))
        val face = { BoardKit.faceBlock(store.dashboard.value.value!!.tiles.single().look, "c")?.value?.toString() }
        assertEquals("\"#ff0000\"", face())
        desk.setColor("l", "c", "#00ff00", done = false)
        assertEquals("\"#ff0000\"", face(), "still dragged: the mark stays under the finger")
        assertEquals("""{"block":"c","value":"#00ff00"}""", server.posts().last { it.path.endsWith("/act") }.body)
        desk.setColor("l", "c", "#00ff00", done = true)
        assertEquals("\"#00ff00\"", face(), "let go: botdot's tile")
    }

    @Test fun aSwitchTurnsAtOnceAndTheAnswerSaysWhetherItTook() = runTest {
        val (store, desk, server) = desk(FakeServer { t ->
            if (t.path.endsWith("/tap")) 200 to """{"id":"g1","kind":"switch","title":"Hall","parent":"g","look":{"dot":{"filled":false},"tap":"toggle"}}""" else 200 to board
        })
        runCurrent()
        assertEquals(BoardTap.Send(false), desk.tap("g1"))
        val sent = server.posts().single { it.path.endsWith("/tap") }
        assertEquals("/api/dashboard/tiles/g1/tap", sent.path)
        assertEquals("""{"on":false}""", sent.body)
        assertEquals(false, store.dashboard.value.value!!.tiles.single { it.id == "g1" }.look?.dot?.filled)
    }

    @Test fun aTileThatAsksFirstSendsNothingUntilTheYes() = runTest {
        val (_, desk, server) = desk()
        runCurrent()
        assertEquals(BoardTap.Ask(true), desk.tap("t1"))
        assertTrue(server.posts().none { it.path.endsWith("/tap") })
        assertEquals(BoardTap.Send(true), desk.tap("t1", asked = true))
        assertEquals("""{"on":true}""", server.posts().single { it.path.endsWith("/tap") }.body)
    }

    @Test fun aBusyBotSaysItWillDoItWhenItIsFree() = runTest {
        val (_, desk, _) = desk(FakeServer { t -> if (t.path.endsWith("/tap")) 200 to """{"queued":true}""" else 200 to board })
        runCurrent()
        desk.tap("t3")
        runCurrent()
        assertEquals("Home Keeper will do it when it is free", desk.state.value.rows.flatten().single { it.key == "t3" }.note)
        advanceTimeBy(BoardDesk.FLASH_MS + 1)
        runCurrent()
        assertNull(desk.state.value.rows.flatten().single { it.key == "t3" }.note)
    }

    @Test fun theBoardIsReadOnlyWhileTheAppIsInFrontAndAtOnceWhenItComesBack() = runTest {
        val server = FakeServer { 200 to board }
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = listOf(TileAsk.FEATURE)))
        val ticks = Channel<Unit>() // each one is the 15 seconds between two reads; taken only by a poll that waits
        val desk = BoardDesk(store, server.api, backgroundScope) { ticks.receive() }
        suspend fun reads() = server.sent().count { it.path.contains("/dashboard") }
        suspend fun until(n: Int) { repeat(400) { if (reads() >= n) return; runCurrent(); withContext(Dispatchers.Default) { delay(5) } }; fail("never $n reads") }
        suspend fun stays(n: Int) { repeat(20) { runCurrent(); withContext(Dispatchers.Default) { delay(5) } }; assertEquals(n, reads()) }

        until(1) // read as it opens
        stays(1)
        desk.active(false) // the phone was locked
        repeat(4) { ticks.trySend(Unit) } // a minute goes by
        stays(1) // nothing is read in the background
        desk.active(true)
        until(2) // back in front: read at once
        desk.active(true) // already on: no second loop
        stays(2)
        ticks.trySend(Unit)
        until(3) // then every 15 seconds
        stays(3)
        desk.close()
    }

    @Test fun aRefusedTapIsSaid() = runTest {
        val (_, desk, _) = desk(FakeServer { t -> if (t.path.endsWith("/tap")) 409 to """{"error":"The lamp is offline."}""" else 200 to board })
        runCurrent()
        desk.tap("t3")
        runCurrent()
        assertEquals("The lamp is offline.", desk.state.value.notice)
    }

    @Test fun aGroupOpensHereAndShowsItsTiles() = runTest {
        val (_, desk, server) = desk()
        runCurrent()
        assertEquals(BoardTap.Group, desk.tap("g"))
        runCurrent()
        val keys = desk.state.value.rows.flatten().map { it.key }
        assertEquals(listOf("g", "in:g", "g1", "out:g"), keys.take(4))
        assertTrue(server.posts().none { it.path.contains("/tiles/") })
    }

    @Test fun theRefreshButtonReadsEveryTileAndAFilterShowsOneHeading() = runTest {
        val (_, desk, server) = desk()
        runCurrent()
        desk.load(all = true)
        assertTrue(server.posts().any { it.path == "/api/dashboard/refresh" && it.body == """{"all":true}""" })
        desk.filter("Garden")
        runCurrent()
        assertEquals(listOf("h:Garden", "t3"), desk.state.value.rows.flatten().map { it.key })
        desk.filter("Gone")
        runCurrent()
        assertEquals("", desk.state.value.filter, "a heading no longer there shows them all")
    }

    @Test fun aChangeAskedGoesToTheChiefAndASuggestionIsAnswered() = runTest {
        val (_, desk, server) = desk()
        runCurrent()
        assertFalse(desk.askChange("t3", "  "))
        assertTrue(desk.askChange("t3", " Show it in °F "))
        assertEquals("""{"text":"Show it in °F"}""", server.posts().single { it.path == "/api/dashboard/tiles/t3/change" }.body)
        runCurrent()
        assertEquals("Sent to Chief of Staff", desk.state.value.rows.flatten().single { it.key == "t3" }.note)
        desk.remove("g", withTiles = true)
        assertTrue(server.sent().any { it.method == "DELETE" && it.path == "/api/dashboard/tiles/g" })
    }

    @Test fun aSliderLandsOnItsSteps() {
        val b = Block(type = "slider", min = 10.0, max = 30.0, step = 5.0, unit = "°C")
        assertEquals(20.0, BoardKit.snap(b, 21.9))
        assertEquals("20 °C", BoardKit.sliderText(b, 20.0))
        assertEquals("50 %", BoardKit.sliderText(b.copy(percent = true), 20.0))
        assertEquals("Lamp on\nToday", BoardKit.plain("**Lamp** on\n\n- Today"))
    }
}
