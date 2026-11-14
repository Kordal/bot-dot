package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The "@" file picker (#604): the search, the folder walk, back, and the pick; the server's answers stood in for. */
class FileMentionsTest {
    private val asked = mutableListOf<String>()
    private val picker = FileMentions(
        find = { q ->
            asked += "find $q"
            if (q == "reports") listOf(FoundFile("Reports", "old/Reports", "folder", "computer"), FoundFile("reports", "reports", "folder", "server"))
            else listOf(
                FoundFile("summaries", "summaries", "folder", "server"),
                FoundFile("summary.md", "summary.md", "file", "project", "Website"),
                FoundFile("summary-w42.md", "archive/summary-w42.md", "file", "computer"),
                FoundFile("sum].md", "sum].md", "file", "server"),
                FoundFile("summary-w43.md", "reports/summary-w43.md", "file", "server"),
                FoundFile("summary-x.md", "summary-x.md", "file", "server"),
            )
        },
        list = { d ->
            asked += "list ${d.root} ${d.path}"
            when (d.path) {
                "reports" -> listOf(WorkspaceEntry("2026-w43", "reports/2026-w43", "folder"), WorkspaceEntry("prices-w43.csv", "reports/prices-w43.csv"), WorkspaceEntry(".hidden", "reports/.hidden"))
                "reports/2026-w43" -> listOf(WorkspaceEntry("Q3 notes", "reports/2026-w43/Q3 notes", "folder"))
                "reports/2026-w43/Q3 notes" -> listOf(WorkspaceEntry("a.md", "reports/2026-w43/Q3 notes/a.md"))
                else -> emptyList()
            }
        },
    )

    @Test fun aSearchListsFourFilesAndFoldersAMentionCanHold() = runBlocking {
        val v = picker.look("Send @sum")
        assertNull(v.dir)
        assertEquals(listOf("@[botdot:summaries]", "@[project:Website/summary.md]", "@[computer:archive/summary-w42.md]", "@[botdot:reports/summary-w43.md]"), v.rows.map { it.text })
        assertEquals(listOf("On botdot", "Website", "archive", "reports"), v.rows.map { FileMentions.whereOf(it.ref) })
        picker.look("Send @sum")
        assertEquals(1, asked.size) // kept for a while
        assertEquals(FileMentions.View(), picker.look("Send @"))
    }

    @Test fun aSlashAfterAFolderOpensItAndAPickedFolderOpensWithItsNameSpacesAndAll() = runBlocking {
        var v = picker.look("Check @reports/")
        assertEquals(FileMentions.Dir("server", "reports"), v.dir) // the name as typed, before one in another case
        assertEquals(listOf("2026-w43", "prices-w43.csv"), v.rows.map { it.name })
        assertEquals(listOf("@[botdot:reports/prices-w43.csv]"), picker.look("Check @reports/pri").rows.map { it.text })
        v = picker.look("Check @reports/")
        val (opened, at) = picker.enter("Check @reports/", 15, v.rows[0])!!
        assertEquals("Check @2026-w43/" to 16, opened to at)
        v = picker.look(opened)
        assertEquals("reports/2026-w43", v.dir?.path)
        val (spaced, at2) = picker.enter(opened, at, v.rows[0])!!
        assertEquals("Check @Q3 notes/", spaced)
        v = picker.look(spaced)
        assertEquals(listOf("@[botdot:reports/2026-w43/Q3 notes/a.md]"), v.rows.map { it.text })
        assertEquals("@[botdot:reports/2026-w43/Q3 notes]", picker.self())
        assertEquals("Check @[botdot:reports/2026-w43/Q3 notes/a.md] " to 47, picker.put(spaced, at2, v.rows[0].text))
    }

    @Test fun backGoesUpOneFolderAndFromThePlacesTopBackToTheAt() = runBlocking {
        picker.look("@reports/2026-w43/")
        val (up, at) = picker.back("@reports/2026-w43/", 18)!!
        assertEquals("@reports/" to 9, up to at)
        picker.look(up)
        assertEquals("@" to 1, picker.back(up, at))
    }

    @Test fun whatAFileLooksLike() {
        assertEquals(listOf("table", "image", "doc", "folder"), listOf(FileMentions.kindOf("a.CSV", "file"), FileMentions.kindOf("a.png", "file"), FileMentions.kindOf("a", "file"), FileMentions.kindOf("a.csv", "folder")))
    }
}
