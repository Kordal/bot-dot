package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Block
import dev.botdot.app.data.TableCell
import dev.botdot.app.data.TableFilter
import dev.botdot.app.data.TableHead
import dev.botdot.app.data.TableSort
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The table block (#396), as the web page sorts, searches, filters and pages it (test/table-block-web.test.js). */
class KitTableTest {
    private val t = Block(
        type = "table", text = "Features", pageSize = 2,
        head = listOf(TableHead("Feature"), TableHead("State", "status"), TableHead("Ref", "ref"), TableHead("Runs", "number")),
        rows = listOf(
            listOf(TableCell("Copy button"), TableCell("Done", level = "ok"), TableCell("#285", n = 285.0), TableCell("3", n = 3.0)),
            listOf(TableCell("Rooms"), TableCell("In progress", level = "info"), TableCell("#371", n = 371.0), TableCell("12", n = 12.0)),
            listOf(TableCell("Board kit"), TableCell("Done", level = "ok"), TableCell("#394", n = 394.0), TableCell("")),
        ),
        filter = TableFilter(1, listOf("Done", "In progress")),
    )
    private fun names(sort: TableSort? = null, q: String = "", f: String = "", page: Int = 0) = KitTable.view(t, sort, q, f, page).rows.map { it[0].text }

    @Test fun sortsByAColumnNumbersAsNumbersAndEmptyLast() {
        assertEquals(listOf("Copy button", "Rooms"), names())
        assertEquals(listOf("Board kit"), names(page = 1))
        assertEquals(1, KitTable.view(t, null, "", "", 9).page)
        assertEquals(listOf("Rooms", "Copy button"), names(TableSort(3, "desc")))
        assertEquals(listOf("Board kit"), names(TableSort(3, "asc"), page = 1))
        assertEquals(listOf("Board kit", "Copy button"), names(TableSort(0, "asc")))
        assertEquals(TableSort(2, "desc"), KitTable.view(t.copy(sort = TableSort(2, "desc")), null, "", "", 0).sort)
    }

    @Test fun searchesEveryCellAndFiltersOnOneColumn() {
        assertEquals(listOf("Copy button", "Board kit"), names(TableSort(0, "desc"), f = "done"))
        assertEquals(listOf("Copy button", "Rooms"), names(f = "Gone"))
        assertEquals(listOf("Rooms"), names(q = "#371"))
        val v = KitTable.view(t, null, "o", "Done", 0)
        assertEquals("2 of 2 · 3 in all", KitTable.count(v))
        assertEquals("2 of 3", KitTable.count(KitTable.view(t, null, "", "", 0)))
    }

    @Test fun aTapOnAHeaderSortsUpThenDown() {
        assertEquals(TableSort(1, "asc"), KitTable.next(null, 1))
        assertEquals(TableSort(1, "desc"), KitTable.next(TableSort(1, "asc"), 1))
        assertEquals(TableSort(1, "asc"), KitTable.next(TableSort(1, "desc"), 1))
        assertEquals(TableSort(0, "asc"), KitTable.next(TableSort(1, "desc"), 0))
    }

    @Test fun aPhoneListsTheFirstColumnWithItsReferenceAndPill() {
        assertEquals(2 to 1, KitTable.listColumns(t))
        assertEquals(null to null, KitTable.listColumns(t.copy(head = listOf(TableHead("A"), TableHead("B")))))
    }

    @Test fun theServersTableIsRead() {
        val b = Api.JSON.decodeFromString(Block.serializer(), """{"type":"table","key":"f0","text":"Issues","head":[{"label":"Title","type":"text"},{"label":"#","type":"ref"}],
            "rows":[[{"text":"A"},{"text":"#1 · PR #2","refs":[{"text":"#1","url":"https://x/1"},{"text":"PR #2"}],"n":1}]],"pageSize":10,"sort":{"column":0,"dir":"desc"},"search":false,"filter":{"column":1,"options":["a","b"]}}""")
        assertEquals("ref", b.head[1].type)
        assertEquals("https://x/1", b.rows[0][1].refs[0].url)
        assertNull(b.rows[0][1].refs[1].url)
        assertEquals(1.0, b.rows[0][1].n)
        assertEquals(false, b.search)
        assertEquals(TableSort(0, "desc"), b.sort)
        assertEquals(listOf("a", "b"), b.filter?.options)
        assertEquals(true, Api.JSON.decodeFromString(Block.serializer(), """{"type":"kpi","columns":2}""").search)
    }
}
