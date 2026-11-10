package dev.botdot.app.data

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The Files tile of a project's board (`project-files`; web: public/company-files-view.js, docs/api.md "The Files
 * tile"): the newest files of the project's folder, from GET /api/company/files. The server never starts the account's
 * computer for it: while it is off the answer is `off` with no files. This file draws nothing (ui/ProjectFilesTile.kt).
 */
@Serializable
data class RecentFile(val name: String = "", val path: String = "", val size: Long = 0, val at: Long = 0)

@Serializable
data class RecentFiles(val state: String = "off", val files: List<RecentFile> = emptyList())

object ProjectFiles {
    const val FEATURE = "project-files"
    const val PIECE = "files"
    /** Asked again at most this often while the board is on screen. */
    const val AGAIN_MS = 60_000L

    /** The folder a file is in, from the project's folder: "" at its top. */
    fun folderOf(path: String): String = path.substringBeforeLast('/', "")

    /**
     * The Files route a tap on one of the tile's files goes to: the project's folder at the file's folder, the file
     * opened over it (web: Files.openFolderFile). [encode] is Uri.encode on the phone.
     */
    fun fileRoute(folder: String, path: String, encode: (String) -> String): String =
        "files/${encode(UploadedFiles.FOLDER + folder)}?root=&path=${encode(folderOf(path))}&file=${encode(path)}"

    /** When a file changed, as Files says it: its time today, "Yesterday", else its day ("4 Nov"). */
    fun whenOf(at: Long, zone: ZoneId = ZoneId.systemDefault(), today: LocalDate = LocalDate.now(zone)): String {
        if (at <= 0) return ""
        val t = Instant.ofEpochMilli(at).atZone(zone)
        val day = t.toLocalDate()
        return when (day) {
            today -> t.format(DateTimeFormatter.ofPattern("HH:mm"))
            today.minusDays(1) -> tr("Yesterday")
            else -> t.format(DateTimeFormatter.ofPattern(if (day.year == today.year) "d MMM" else "d MMM yyyy", I18n.locale))
        }
    }
}
