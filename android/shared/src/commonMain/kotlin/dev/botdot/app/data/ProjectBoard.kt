package dev.botdot.app.data

/**
 * The pieces botdot can put on a project's board (#780; web: public/company.js, docs/api.md "The board's pieces"):
 * the 90-day line with its check-in, the objectives, the team floor, the Calendar tile, the To-do panel and the Files tile;
 * with overview-board (ADR 245) also Needs you, Current work, Blockers and Latest replies. A project
 * made from now on starts with none and the owner adds them; one without `board` (made before) shows them all.
 */
object ProjectBoard {
    const val FEATURE = "project-board"
    val PIECES = listOf("days", "goals", "teams", "calendar", "todo", "files")

    /** The pieces [c] can have: an ongoing project (#925) has no 90 days, so no "days"; Files only where [features] has it. */
    fun piecesOf(c: Company, features: List<String>? = null): List<String> =
        (if (c.ongoing) PIECES - "days" else PIECES).filter { it != ProjectFiles.PIECE || features == null || ProjectFiles.FEATURE in features } +
            (if (features != null && ProjectOverview.BOARD in features) ProjectOverview.PIECES else emptyList())

    /** Whether piece [k] is on the board of [c]. */
    fun shows(c: Company, k: String): Boolean = (k in piecesOf(c) || k in ProjectOverview.PIECES) && (c.board?.contains(k) ?: true)

    /** The pieces the owner can add: those not on it, from a botdot that has them. Needs you is none: it shows first whenever something waits (ADR 249). */
    fun missing(features: List<String>, c: Company): List<String> = c.board?.takeIf { FEATURE in features }?.let { on -> piecesOf(c, features).filter { it !in on && it != NEEDS && (it != ProjectFiles.PIECE || ProjectFiles.FEATURE in features) } }.orEmpty()

    /** Needs you: never hidden, and above the arranged tiles (ADR 249). */
    const val NEEDS = "needs"

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
        "needs" -> tr("Needs you")
        "work" -> tr("Current work")
        "blockers" -> tr("Blockers")
        "replies" -> tr("Latest replies")
        else -> tr("To-do")
    }
}
