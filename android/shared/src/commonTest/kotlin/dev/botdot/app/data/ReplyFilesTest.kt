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
        ReplyPictures.forget(dir)
        assertFalse(SystemFileSystem.exists(Path(dir)))
    }

    /** A session kept in memory, as the Keychain keeps it. */
    private class Kept(var token: String?) : Session.Keep {
        override fun read(server: String) = token
        override fun write(server: String, token: String?) { this.token = token }
    }

    @Test fun anotherAccountsPictureIsItsOwnAndSigningOutEmptiesTheCache() = runTest {
        val dir = Path(SystemTemporaryDirectory, "reply-pictures-" + newMessageKey()).toString()
        val kept = Kept("first-account")
        var answer = "first"
        val first = FakeServer(Session(kept)) { 200 to answer }
        val mine = ReplyPictures(first.api, dir).picture(photo)
        kept.token = "second-account"
        answer = "second"
        val theirs = ReplyPictures(first.api, dir).picture(photo)
        assertTrue(mine != theirs, "the same run and name, another account: another file")
        assertEquals("second", SystemFileSystem.source(Path(theirs)).buffered().use { it.readString() }, "downloaded, not the first account's")
        assertEquals("first", SystemFileSystem.source(Path(mine)).buffered().use { it.readString() })
        val other = FakeServer(Session(kept), base = "https://other.test") { 200 to "third" }
        assertTrue(ReplyPictures(other.api, dir).picture(photo) !in listOf(mine, theirs), "another botdot: its own folder")
        ReplyPictures.forget(dir)
        assertFalse(SystemFileSystem.exists(Path(mine)) || SystemFileSystem.exists(Path(theirs)), "signed out: none left")
    }
}
