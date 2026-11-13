package dev.botdot.app.data

import kotlinx.serialization.Serializable

/** Recorded project activity from the server, with no inferred progress score (ADR 236). */
@Serializable
data class ProjectOverview(val projectId: String, val at: String, val goal: String = "", val work: List<OverviewEntry> = emptyList(), val blockers: List<OverviewEntry> = emptyList(), val replies: List<OverviewEntry> = emptyList()) {
    companion object { const val FEATURE = "project-overview" }
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
