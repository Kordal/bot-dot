package dev.botdot.app.data

import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem

/**
 * The files under a reply (a bot's, the Chief's, a group's): pictures shown as themselves, the rest as chips, and a tap
 * opens one in the viewer, as Android's BotFilesRow. A file named only (no `file`, a mail draft's) opens nothing.
 */
object ReplyFiles {
    private val pictureTypes = setOf("png", "jpg", "jpeg", "gif", "webp")

    fun isPicture(f: Attachment): Boolean = f.file.isNotEmpty() && f.name.substringAfterLast('.', "").lowercase() in pictureTypes

    fun pictures(files: List<Attachment>): List<Attachment> = files.filter { isPicture(it) }

    fun others(files: List<Attachment>): List<Attachment> = files.filterNot { isPicture(it) }

    fun opens(f: Attachment): Boolean = f.file.isNotEmpty()

    /** What a tap on [f] hands the viewer: the run's file ("<runId>/<name>"), from [from] (who sent it). */
    fun opening(f: Attachment, from: String): DocumentView.Opening = DocumentView.Opening(DocumentView.runFile(f.file), f.name, from)
}

/**
 * The pictures under replies, saved in [dir] (the app's caches) to be drawn: each downloaded once, then read from
 * there, so scrolling back doesn't fetch it again.
 */
class ReplyPictures(private val api: Api, private val dir: String) {
    /** Where [f] is saved: downloaded the first time. Throws when it couldn't be. */
    @Throws(Exception::class)
    suspend fun picture(f: Attachment): String {
        val name = f.file.split('/').filter { it.isNotBlank() && it != "." && it != ".." }.joinToString("_").ifEmpty { "file" }
        val dest = Path(dir, name)
        if (!SystemFileSystem.exists(dest)) api.downloadTo(DocumentView.runFile(f.file), dest)
        return dest.toString()
    }
}
