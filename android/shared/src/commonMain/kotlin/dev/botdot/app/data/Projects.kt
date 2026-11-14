package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * Shared projects (#578; docs/api.md, "Shared projects"): a folder on the account's computer,
 * /workspace/projects/<name>, that the bots in it work in together. Browsed in a member's Workspace as a root of its
 * own. Only from a server whose `features` name `projects`, and only for a bot on the account's computer.
 */
object Projects {
    const val FEATURE = "projects"
    const val ROOT = "project"

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** The projects [botId] is in. */
    fun of(botId: String, all: List<Project>): List<Project> = all.filter { botId in it.bots }

    /** Its bots as the line under its name says them, by name where the bot is known. */
    fun members(p: Project, bots: List<Bot>): String = p.bots.joinToString(", ") { id -> bots.firstOrNull { it.id == id }?.name ?: id }

    /** The bots that can be in a project: those on the account's computer. */
    fun eligible(bots: List<Bot>): List<Bot> = bots.filter { it.computer == "linux" }
}

@Serializable
data class Project(val name: String = "", val bots: List<String> = emptyList(), val folder: String = "")

@Serializable
data class ProjectList(val projects: List<Project> = emptyList())
