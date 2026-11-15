package dev.botdot.app.data

import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The tiles-on-home sheet for both phones (HomeTilesDesk, #447): its rows, a check, a drag, and a save botdot refuses. */
class HomeTilesDeskTest {
    private val tiles = listOf(Tile(id = "led", title = "LED strip"), Tile(id = "g", title = "Servers", kind = "group"),
        Tile(id = "cpu", title = "Proxmox CPU", parent = "g"), Tile(id = "w", title = "Disk", approved = false))

    @Test fun aCheckAndADragSaveTheWholeListAndARefusalPutsItBack() = runTest {
        var status = 200
        val server = FakeServer { t -> if (t.method == "PUT") status to (if (status == 200) "{}" else """{"error":"Nope"}""") else 200 to "{}" }
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.dashboard.set(Dashboard(tiles = tiles, home = listOf("led")))
        val desk = HomeTilesDesk(backgroundScope, server.api, store)
        runCurrent()
        assertEquals(listOf("led"), desk.state.value.on.map { it.id })
        assertEquals(listOf("g" to "Servers", "cpu" to "Proxmox CPU"), desk.state.value.rest.map { it.id to it.title }, "every other approved tile")
        desk.toggle("g")
        assertEquals(listOf("led", "g"), desk.state.value.on.map { it.id })
        desk.move("g", "led")
        assertEquals(listOf("g", "led"), desk.state.value.on.map { it.id }, "shown while it is dragged")
        assertEquals(1, server.posts().size, "a drag saves when it is let go")
        desk.drop()
        assertEquals(listOf("""{"home":["led","g"]}""", """{"home":["g","led"]}"""), server.posts().map { it.body })
        assertEquals("/api/dashboard/layout", server.posts().first().path)
        assertNull(desk.state.value.notice)
        status = 500
        desk.toggle("cpu")
        assertEquals(listOf("g", "led"), desk.state.value.on.map { it.id }, "refused: put back")
        assertEquals("Nope", desk.state.value.notice)
        assertEquals(1, desk.state.value.noticeCount)
    }

    @Test fun aChangeOfTheBoardsListFromElsewhereTakesThePlaceOfTheRows() = runTest {
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.dashboard.set(Dashboard(tiles = tiles, home = listOf("led")))
        val desk = HomeTilesDesk(backgroundScope, FakeServer { 200 to "{}" }.api, store)
        runCurrent()
        store.dashboard.set(Dashboard(tiles = tiles, home = listOf("g", "led")))
        runCurrent()
        assertEquals(listOf("g", "led"), desk.state.value.on.map { it.id })
        desk.order(listOf("led", "g"))
        assertEquals(listOf("led", "g"), desk.state.value.on.map { it.id }, "a whole new order of the same tiles")
        desk.order(listOf("led"))
        assertEquals(listOf("led", "g"), desk.state.value.on.map { it.id }, "not the same tiles: ignored")
    }
    @Test fun aReadOfTheSameListKeepsADragAndASaveOnItsWay() = runTest {
        val held = kotlinx.coroutines.CompletableDeferred<Unit>()
        val server = FakeServer { t -> if (t.method == "PUT") { held.await(); 200 to "{}" } else 200 to "{}" }
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.dashboard.set(Dashboard(tiles = tiles, home = listOf("led", "g")))
        val desk = HomeTilesDesk(backgroundScope, server.api, store)
        runCurrent()
        desk.move("g", "led")
        store.dashboard.set(Dashboard(tiles = tiles, home = listOf("led", "g"))) // Home's minute
        runCurrent()
        assertEquals(listOf("g", "led"), desk.state.value.on.map { it.id }, "the drag stays")
        val renamed = tiles.map { if (it.id == "led") it.copy(title = "LEDs") else it }
        store.dashboard.set(Dashboard(tiles = renamed, home = listOf("led", "g")))
        runCurrent()
        assertEquals("LEDs", desk.state.value.on.first { it.id == "led" }.title, "but the titles follow")
        val toggling = async { desk.toggle("cpu") }
        runCurrent()
        assertEquals(listOf("g", "led", "cpu"), desk.state.value.on.map { it.id })
        store.dashboard.set(Dashboard(tiles = renamed, home = listOf("led", "g")))
        runCurrent()
        assertEquals(listOf("g", "led", "cpu"), desk.state.value.on.map { it.id }, "a save on its way stays")
        held.complete(Unit)
        toggling.await()
        store.dashboard.set(Dashboard(tiles = renamed, home = listOf("cpu")))
        runCurrent()
        assertEquals(listOf("cpu"), desk.state.value.on.map { it.id }, "a new list from botdot takes its place")
    }
}
