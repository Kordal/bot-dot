package dev.botdot.app.data

import kotlinx.serialization.Serializable

/** Recorded project activity from the server, with no inferred progress score (ADR 236). */
@Serializable
data class ProjectOverview(val projectId: String, val at: String, val work: List<OverviewEntry> = emptyList(), val blockers: List<OverviewEntry> = emptyList(), val replies: List<OverviewEntry> = emptyList()) {
    /** The questions waiting for the owner (a bot's, a team chat's, the Chief's): they stand in Needs you, not under Blockers. */
    fun questions(): List<OverviewEntry> = blockers.filter { it.state == ASKS }
    /** What Blockers shows: failed work, not the questions Needs you already holds. */
    fun failures(): List<OverviewEntry> = blockers.filter { it.state != ASKS }
    companion object {
        const val FEATURE = "project-overview"
        /** The overview is the board (ADR 245): its sections are board pieces, with no separate overview. */
        const val BOARD = "overview-board"
        /** Its sections as board pieces, in the order they first stand. */
        val PIECES = listOf("needs", "work", "blockers", "replies")
        const val ASKS = "asks"
        /** Needs you on the overview shows only when something waits: a card or a question. */
        fun needsYouShows(cards: Int, questions: Int): Boolean = cards > 0 || questions > 0
        /** A question in a chat that already has a card in Needs you (the Chief's chat) is that card's: shown once, as the card. */
        fun withoutCarded(questions: List<OverviewEntry>, cardChats: Set<String?>): List<OverviewEntry> = questions.filter { it.chatId == null || it.chatId !in cardChats }
    }
}

@Serializable
data class OverviewEntry(val id: String, val botId: String? = null, val chatId: String? = null, val groupId: String? = null, val name: String = "", val state: String = "", val text: String = "", val at: String = "") {
    /** An owner-assigned to-do has no actor: it uses the same primary contact as the project field. */
    fun destination(project: Company, bots: List<Bot>?, features: Collection<String>?): String? = when {
        groupId != null -> "group/$groupId"
        chatId != null -> "chief/$chatId"
        botId != null -> "bot/$botId"
        else -> Spaces.defaultChat(project, bots, features)
    }
}
