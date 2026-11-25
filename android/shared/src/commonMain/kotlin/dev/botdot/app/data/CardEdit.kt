package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * The pencil on a board tile (ADR 275; web: public/board-edit.js). A tile that has a title of its own has a pencil: it
 * opens the project's own chat, the project manager's, with a chip above the message box that names the tile. The
 * message then carries the tile's id (`card`) and its project, which botdot checks against the board and tells the
 * manager. Taking the chip off sends a plain message; sending clears the chip. Drawn only when `features` has
 * [ManyProjects.CARD_EDIT].
 */
object CardEdit {
    /** The tile the owner pointed at: its id as the board's layout names it (`replies`, `card:<id>`), its name, and the chat the chip stands in. */
    data class Target(val project: String, val id: String, val label: String, val chat: ProjectChats.Open) {
        /** The chat's own box carries it only while that chat is the project's manager's. */
        fun isIn(open: ProjectChats.Open): Boolean = chat == open
    }

    /** The tiles with a pencil: the pieces that have a title of their own, and a card made by Claude (`card:<id>`). */
    val PIECES = listOf("work", "blockers", "replies", "calendar", "todo", "files")

    /**
     * The project's own chat the pencil opens, as the web page's Dock picks it: the Project Manager bot's while the
     * server has that and the project has one, else the project's own Chief chat; null when the server has no
     * [ManyProjects.CARD_EDIT], the project is not running, or it has no chat to open.
     */
    fun chatOf(c: Company, features: List<String>, bots: List<Bot>): ProjectChats.Open? {
        if (ManyProjects.CARD_EDIT !in features || c.phase != "running") return null
        if (ManyProjects.MANAGER_BOT in features) ManyProjects.manager(c, bots)?.let { return ProjectChats.Open(ProjectChats.BOT, it.id) }
        return c.chiefChat?.takeIf { it.isNotEmpty() }?.let { ProjectChats.Open(ProjectChats.CHIEF, it) }
    }

    fun id(card: ProjectCard): String = "card:${card.id}"

    /**
     * The tile's name above a message that was about it. botdot stores a piece's name in English, so a piece is named
     * by its id in the owner's language, as the chip was; only a card made by Claude has a name of its own (its title).
     */
    fun nameOf(ref: TileRef): String = if (ref.id in PIECES) ProjectBoard.label(ref.id) else ref.label

    /** The tile's id and project as a message sends them, or null for a plain message. */
    fun ids(t: Target?): Pair<String, String>? = t?.let { it.id to it.project }
}

/** What a message that pointed at a tile keeps: shown small above it, and so the history names the tile. */
@Serializable
data class TileRef(val id: String = "", val label: String = "")
