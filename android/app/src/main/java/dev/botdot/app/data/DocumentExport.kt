package dev.botdot.app.data

import java.net.URLDecoder

/**
 * A long reply opened as a document and exported (#348): Word, PDF or Markdown made by the server (POST /api/export).
 * Only from a server whose `features` name `document-export`. Which reply is long is [dev.botdot.app.ui.isDocument].
 */
object DocumentExport {
    const val FEATURE = "document-export"
    /** A reply this long is a document; so is a shorter one with a heading or a table, from [SECTIONED_WORDS]. */
    const val LONG_WORDS = 300
    const val SECTIONED_WORDS = 120

    /** The formats, in the order the sheet lists them: format, label, extension. */
    val FORMATS = listOf(Triple("docx", "Word document", ".docx"), Triple("pdf", "PDF", ".pdf"), Triple("md", "Markdown", ".md"))

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** Words: what stands between white space, as the web page counts them. */
    fun words(text: String): Int = text.split(Regex("\\s+")).count { it.isNotEmpty() }

    /** The file's name from the answer's `Content-Disposition` (filename*=UTF-8''…), else "document.<format>". A name
     *  with a folder in it is cut to its last part. */
    fun fileName(disposition: String?, format: String): String {
        val raw = disposition?.let { Regex("filename\\*=UTF-8''([^;]+)").find(it)?.groupValues?.get(1) }
        val name = raw?.let { runCatching { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }.getOrNull() }
            ?.substringAfterLast('/')?.substringAfterLast('\\')?.trim()
        return if (name.isNullOrEmpty() || name.startsWith(".")) "document.$format" else name
    }

    /** A document's title: its first heading, else the start of its first line, without Markdown's marks. */
    fun title(firstHeading: String?, text: String): String {
        val plain = { s: String -> s.replace(Regex("[*_`~]"), "").trim() }
        if (firstHeading != null) return plain(firstHeading).ifEmpty { "Document" }
        val first = plain(text.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().replace(Regex("^#+\\s*"), "")).ifEmpty { "Document" }
        return if (first.length > 80) first.take(77) + "…" else first
    }
}
