package dev.botdot.app.data

// Made once: plainText runs for every notification.
private val MD_HEADING = Regex("^#{1,6}\\s+")
private val MD_ITEM = Regex("^[-*+]\\s+")
private val MD_LINK = Regex("\\[([^\\]]+)]\\([^)]*\\)")
private val MD_BOLD = Regex("\\*\\*(.+?)\\*\\*|__(.+?)__")
private val MD_ITALIC = Regex("(?<![*\\w])\\*([^*]+)\\*(?!\\w)")

/** Replies are Markdown; a notification shows plain text ("## This week" -> "This week"). */
fun plainText(md: String): String = md.lineSequence().map { line ->
    line.trim()
        .replace(MD_HEADING, "")
        .replace(MD_ITEM, "• ")
        .replace(MD_LINK, "$1")
        .replace(MD_BOLD, "$1$2")
        .replace(MD_ITALIC, "$1")
        .replace("`", "")
}.filter { it.isNotBlank() && it != "---" && !it.startsWith("|---") }.joinToString("\n")
