package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * A bot's files (#235): what the owner (or a teammate) gave it, kept in its uploads/ until the owner deletes them.
 * Every run of the bot is told which there are; a file kept in mind (pinned) comes with every task. In the bot's
 * settings the owner opens, pins and deletes them. Only from a server whose `features` name `bot-files`.
 */
object UploadedFiles {
    const val FEATURE = "bot-files"

    /** Whether the botdot this app talks to keeps a bot's files. While its features are not known yet: no. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    fun size(n: Long): String = when {
        n >= 1024 * 1024 -> String.format(java.util.Locale.ROOT, "%.1f MB", n / 1024.0 / 1024.0)
        n >= 1024 -> "${Math.round(n / 1024.0)} KB"
        else -> "$n B"
    }

    /** The line under a file's name: its size and the day it came. */
    fun detail(f: UploadedFile): String = "${size(f.size)} · ${f.at.take(10)}"

    /** The folded section's summary: how many, and how many are kept in mind. */
    fun summary(files: List<UploadedFile>): String = when {
        files.isEmpty() -> "None"
        else -> "${files.size} file${if (files.size == 1) "" else "s"}" + files.count { it.pinned }.let { if (it > 0) ", $it kept in mind" else "" }
    }
}

/** One of a bot's files (`GET /api/bots/:id/files`). [file] is its path in the bot's folder, "uploads/…". */
@Serializable
data class UploadedFile(
    val file: String,
    val name: String = "",
    val size: Long = 0,
    val at: String = "",
    val readable: String? = null,
    val pinned: Boolean = false,
)

@Serializable
data class UploadedFileList(val files: List<UploadedFile> = emptyList(), val maxPinned: Int = 5)
