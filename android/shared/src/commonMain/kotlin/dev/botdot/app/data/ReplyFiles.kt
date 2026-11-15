package dev.botdot.app.data

import io.ktor.http.Url
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
 * The pictures under replies, saved under [root] (the app's caches) to be drawn: each downloaded once, then read from
 * there, so scrolling back doesn't fetch it again. Each botdot and session has a folder of its own ([place]), so
 * another account or server never reads this one's pictures; signing out or in empties [root] ([forget]).
 */
class ReplyPictures(private val api: Api, private val root: String) {
    /** Where [f] is saved: downloaded the first time. Throws when it couldn't be. */
    @Throws(Exception::class)
    suspend fun picture(f: Attachment): String {
        val name = f.file.split('/').filter { it.isNotBlank() && it != "." && it != ".." }.joinToString("_").ifEmpty { "file" }
        val server = Url(api.baseUrl).let { Session.originOf(it.protocol.name, it.host, it.port) }
        val dest = Path(root, place(server, api.session?.token(server)), name)
        if (!SystemFileSystem.exists(dest)) api.downloadTo(DocumentView.runFile(f.file), dest)
        return dest.toString()
    }

    companion object {
        /** The folder of one botdot's [server] and one session ([account], the session's token, never written itself). */
        internal fun place(server: String, account: String?): String {
            // FNV-1a, 64 bits: a name for the folder, not a secret; the token is not in it.
            var h = -0x340d631b7bdddcdbL
            for (c in "$server\n${account.orEmpty()}") { h = (h xor c.code.toLong()) * 0x100000001b3L }
            return h.toULong().toString(16).padStart(16, '0')
        }

        /** Every picture under [root] gone: on signing out, and on signing in (another account may be next). */
        fun forget(root: String) = gone(Path(root))

        private fun gone(p: Path) {
            if (!SystemFileSystem.exists(p)) return
            if (SystemFileSystem.metadataOrNull(p)?.isDirectory == true) SystemFileSystem.list(p).forEach { gone(it) }
            runCatching { SystemFileSystem.delete(p, mustExist = false) }
        }
    }
}
