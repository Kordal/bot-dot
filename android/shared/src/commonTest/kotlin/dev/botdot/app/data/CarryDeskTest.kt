package dev.botdot.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** Move to… and Copy to… for both phones (CarryDesk): the tree, what can't be picked, New folder, and the carry. */
class CarryDeskTest {
    private val docs = WorkspaceEntry(name = "docs", path = "docs", type = "folder")
    private val plan = WorkspaceEntry(name = "plan.md", path = "docs/plan.md")

    private suspend fun kotlinx.coroutines.test.TestScope.until(what: String, done: () -> Boolean) {
        repeat(200) { if (done()) return; runCurrent(); withContext(Dispatchers.Default) { delay(5) } }
        fail("never: $what")
    }

    @Test fun theTreeOffersEveryFolderButTheOneItIsInAndCarriesItToThePickedOne() = runTest {
        val server = FakeServer { t ->
            when {
                t.method == "GET" && "path=docs" in t.query -> 200 to """{"entries":[{"name":"old","path":"docs/old","type":"folder"}]}"""
                t.method == "GET" && "path=notes" in t.query -> 200 to """{"entries":[{"name":"new","path":"notes/new","type":"folder"}]}"""
                t.method == "GET" -> 200 to """{"entries":[{"name":"docs","path":"docs","type":"folder"},{"name":"notes","path":"notes","type":"folder"},{"name":"a.txt","path":"a.txt"}]}"""
                t.path.endsWith("/folder") -> 200 to """{"path":"notes/new"}"""
                else -> 200 to """{"path":"notes/plan.md"}"""
            }
        }
        val said = mutableListOf<String>()
        val desk = CarryDesk(backgroundScope, server.api, "b1", move = true, from = WorkspaceFiles.SERVER, entries = listOf(plan), places = listOf(WorkspaceFiles.SERVER), say = { said += it })
        until("the place's folders") { desk.state.value.nodes.size == 3 }
        val s = desk.state.value
        assertEquals("Move plan.md", s.title)
        assertEquals(listOf("", "docs", "notes"), s.nodes.map { it.path }, "folders only, the place first")
        assertFalse(s.nodes.first { it.path == "docs" }.takes, "the folder it is in")
        assertTrue(s.nodes.first { it.path == "notes" }.takes)
        desk.pick(WorkspaceFiles.SERVER, "docs")
        assertNull(desk.state.value.to, "not offered: nothing picked")
        desk.toggle(WorkspaceFiles.SERVER, "docs")
        until("docs opened") { desk.state.value.nodes.any { it.path == "docs/old" } }
        assertEquals(2, desk.state.value.nodes.first { it.path == "docs/old" }.depth)
        desk.pick(WorkspaceFiles.SERVER, "notes")
        assertTrue(desk.state.value.nodes.first { it.path == "notes" }.picked)
        assertTrue(desk.makeFolder(" new "))
        assertEquals("notes/new", desk.state.value.folder, "the new folder is picked")
        assertEquals("Moved plan.md to ${FilesExplorer.placeName(WorkspaceFiles.SERVER)} / new", desk.go())
        val carried = server.posts().last()
        assertTrue(carried.path.substringBefore('?').endsWith("/move"), carried.path)
        assertTrue("\"into\":\"notes/new\"" in carried.body && "\"from\":\"docs/plan.md\"" in carried.body, carried.body)
        assertTrue(said.isEmpty())
    }

    @Test fun anItemBotdotWontCarryIsNamedWithWhy() = runTest {
        val server = FakeServer { t -> if (t.method == "GET") 200 to """{"entries":[]}""" else 409 to """{"error":"It is there already"}""" }
        val desk = CarryDesk(backgroundScope, server.api, "b1", move = false, from = WorkspaceFiles.SERVER, entries = listOf(plan), places = listOf(WorkspaceFiles.SERVER), say = {})
        until("the place") { desk.state.value.nodes.size == 1 }
        assertEquals("", desk.go(), "nothing picked: nothing carried")
        desk.pick(WorkspaceFiles.SERVER, "")
        assertEquals("Copy here", desk.state.value.goWords)
        assertEquals("plan.md: It is there already", desk.go())
    }
}
