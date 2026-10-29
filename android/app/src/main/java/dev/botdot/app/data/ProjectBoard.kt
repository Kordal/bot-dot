package dev.botdot.app.data

/**
 * The pieces botdot can put on a project's board (#780; web: public/company.js, docs/api.md "The board's pieces"):
 * the 90-day line with its check-in, the objectives, the team floor, the Calendar tile and the To-do panel. A project
 * made from now on starts with none and the owner adds them; one without `board` (made before) shows them all.
 */
object ProjectBoard {
    const val FEATURE = "project-board"
    val PIECES = listOf("days", "goals", "teams", "calendar", "todo")

    /** Whether piece [k] is on the board of [c]. */
    fun shows(c: Company, k: String): Boolean = c.board?.contains(k) ?: true

    /** The pieces the owner can add: those not on it, from a botdot that has them. */
    fun missing(features: List<String>, c: Company): List<String> = c.board?.takeIf { FEATURE in features }?.let { on -> PIECES.filter { it !in on } }.orEmpty()

    /** The board with [k] added at its end, or taken off; a project made before starts from every piece. */
    fun toggled(c: Company, k: String): List<String> {
        val now = c.board ?: PIECES
        return if (k in now) now - k else now + k
    }

    fun label(k: String): String = when (k) {
        "days" -> tr("90 days")
        "goals" -> tr("Goals")
        "teams" -> tr("Teams")
        "calendar" -> tr("Calendar")
        else -> tr("To-do")
    }
}
