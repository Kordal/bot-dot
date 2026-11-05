package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings → Storage (docs/api.md, Storage): the server's answer, sizes as a Mac counts them, and where a row opens. */
class StorageTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
    private val answer = json.decodeFromString<Storage.Answer>("""
        {"checking":false,"checkedAt":"2026-11-05T09:00:00.000Z","computer":"running","total":30000000,"groups":[
          {"id":"computer","bytes":20000000,"kids":[
            {"name":"Researcher","bytes":15000000,"dir":true,"files":3,"place":{"bot":"r1","root":"computer"},"path":"","kids":[
              {"name":"node_modules","bytes":14000000,"dir":true,"files":2,"kids":[{"name":"big.js","bytes":9000000,"dir":false}]}]},
            {"name":"system","label":"system","bytes":5000000,"dir":false}]},
          {"id":"bots","bytes":0,"kids":[]},
          {"id":"projects","bytes":10000000,"kids":[{"name":"Launch","bytes":10000000,"dir":true,"place":{"project":"Launch"},"path":""}]}],
        "largest":[{"name":"big.js","path":"node_modules/big.js","bytes":9000000,"place":{"bot":"r1","root":"computer"},"owner":"Researcher"}],
        "something":"new"}
    """)

    @Test fun reads_the_answer() {
        assertEquals(30_000_000L, answer.total)
        assertEquals("Researcher", answer.largest.first().owner)
        assertEquals(Storage.Place(bot = "r1", root = "computer"), answer.largest.first().place)
    }

    @Test fun sizes_count_by_thousands() {
        assertEquals("14 GB", Storage.size(14_200_000_000))
        assertEquals("6.4 GB", Storage.size(6_400_000_000))
        assertEquals("6 MB", Storage.size(6_000_000))
        assertEquals("812 MB", Storage.size(812_000_000))
        assertEquals("4.1 KB", Storage.size(4_096))
        assertEquals("0 B", Storage.size(0))
    }

    @Test fun a_trail_opens_a_folder_and_its_rows_know_their_files_place() {
        val o = Storage.open(answer, listOf("computer", "Researcher", "node_modules"))!!
        assertEquals(listOf("Computer", "Researcher", "node_modules"), o.crumbs)
        assertEquals(Storage.Place(bot = "r1", root = "computer"), o.place)
        assertEquals("node_modules", o.base)
        val w = Storage.where(o.node.kids.first(), o)!!
        assertEquals("node_modules/big.js", w.path)
        assertTrue(Storage.deletable(w))
        assertEquals("r1", Storage.ownerOf(w.place))
        assertEquals("computer", Storage.rootOf(w.place))
        assertNull(Storage.open(answer, listOf("computer", "Gone")))
    }

    @Test fun what_files_does_not_open_has_no_place_and_a_whole_folder_is_never_deleted() {
        val top = Storage.open(answer, listOf("computer"))!!
        val system = top.node.kids.first { it.label == "system" }
        assertEquals("Installed programs", Storage.nameOf(system))
        assertNull(Storage.where(system, top))
        val bot = Storage.where(top.node.kids.first(), top)!!
        assertFalse(Storage.deletable(bot))
        assertFalse(Storage.deletable(Storage.Where(Storage.Place(bot = "r1", root = "server"), "uploads")))
        val project = Storage.open(answer, listOf("projects"))!!.node.kids.first()
        val pw = Storage.where(project, null)!!
        assertEquals("project:Launch", Storage.ownerOf(pw.place))
        assertEquals("project/Launch", Storage.rootOf(pw.place))
    }

    @Test fun the_bar_shows_only_groups_that_hold_something() {
        val bar = Storage.bar(answer)
        assertEquals(listOf("computer", "projects"), bar.map { it.first })
        assertEquals(1f, bar.sumOf { it.second.toDouble() }.toFloat(), 0.001f)
    }
}
