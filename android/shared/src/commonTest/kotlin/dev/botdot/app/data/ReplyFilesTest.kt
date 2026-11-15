package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.files.SystemTemporaryDirectory
import kotlinx.io.readString

class ReplyFilesTest {
    private val photo = Attachment("Chart.PNG", "run-1/Chart.PNG")
    private val report = Attachment("report.pdf", "run-1/report.pdf")
    private val named = Attachment("draft.png") // a mail draft's file, named only

    @Test
    fun picturesShowAsThemselvesTheRestAsChips() {
        assertEquals(listOf(photo), ReplyFiles.pictures(listOf(photo, report, named)))
        assertEquals(listOf(report, named), ReplyFiles.others(listOf(photo, report, named)))
        assertTrue(ReplyFiles.opens(report))
        assertFalse(ReplyFiles.opens(named))
    }

    @Test
    fun aTapOpensTheRunsFileInTheViewer() {
        val o = ReplyFiles.opening(Attachment("a b.pdf", "run-1/a b.pdf"), "Scout")
        assertEquals("/files/run-1/a%20b.pdf", o.src)
        assertEquals("a b.pdf", o.name)
        assertEquals("Scout", o.from)
    }

    @Test
    fun aPictureIsDownloadedOnceThenReadFromTheCache() = runTest {
        val server = FakeServer { 200 to "picture" }
        val dir = Path(SystemTemporaryDirectory, "reply-pictures-" + newMessageKey()).toString()
        val pictures = ReplyPictures(server.api, dir)
        val first = pictures.picture(photo)
        assertEquals("picture", SystemFileSystem.source(Path(first)).buffered().use { it.readString() })
        assertEquals(first, pictures.picture(photo))
        assertEquals(listOf("/api/files/run-1/Chart.PNG"), server.sent().map { it.path })
        SystemFileSystem.delete(Path(first))
        SystemFileSystem.delete(Path(dir))
    }
}
