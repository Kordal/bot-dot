package dev.botdot.app.data

/**
 * The pieces botdot can put on a project's board (#780; web: public/company.js, docs/api.md "The board's pieces"):
 * the 90-day line with its check-in, the objectives, the team floor, the Calendar tile, the To-do panel and the Files tile. A project
 * made from now on starts with none and the owner adds them; one without `board` (made before) shows them all.
 */
object ProjectBoard {
    const val FEATURE = "project-board"
    val PIECES = listOf("days", "goals", "teams", "calendar", "todo", "files")

    /** The pieces [c] can have: an ongoing project (#925) has no 90 days, so no "days"; Files only where [features] has it. */
    fun piecesOf(c: Company, features: List<String>? = null): List<String> =
        (if (c.ongoing) PIECES - "days" else PIECES).filter { it != ProjectFiles.PIECE || features == null || ProjectFiles.FEATURE in features }

    /** Whether piece [k] is on the board of [c]. */
    fun shows(c: Company, k: String): Boolean = k in piecesOf(c) && (c.board?.contains(k) ?: true)

    /** The pieces the owner can add: those not on it, from a botdot that has them. */
    fun missing(features: List<String>, c: Company): List<String> = c.board?.takeIf { FEATURE in features }?.let { on -> piecesOf(c).filter { it !in on && (it != ProjectFiles.PIECE || ProjectFiles.FEATURE in features) } }.orEmpty()

    /** The board with [k] added at its end, or taken off; a project made before starts from every piece. */
    fun toggled(c: Company, k: String, features: List<String>? = null): List<String> {
        val now = c.board ?: piecesOf(c, features)
        return if (k in now) now - k else now + k
    }

    fun label(k: String): String = when (k) {
        "days" -> tr("90 days")
        "goals" -> tr("Goals")
        "teams" -> tr("Teams")
        "calendar" -> tr("Calendar")
        "files" -> tr("Files")
        else -> tr("To-do")
    }
}
