package dev.botdot.app.data

import kotlinx.coroutines.CancellationException

/**
 * Home's search (Android's HomeScreen): while two letters or more are typed, the Chief, the bots and the groups that
 * match, then the messages across the chats that botdot finds (`GET /api/search`). A hit opens its chat.
 */
object HomeSearch {
    /** Letters typed before the messages are searched. */
    const val MIN = 2

    /** What is typed, as it is matched: trimmed, lower case. */
    fun query(typed: String): String = typed.trim().lowercase()

    /** The Chief matches by its role or its name. */
    fun chief(q: String, chiefName: String): Boolean =
        q.isNotEmpty() && (ChiefName.role.lowercase().contains(q) || chiefName.lowercase().contains(q))

    /** The bots whose name, description or category has it. */
    fun bots(q: String, bots: List<Bot>): List<Bot> =
        if (q.isEmpty()) emptyList() else bots.filter { "${it.name} ${it.description} ${it.group}".lowercase().contains(q) }

    /** What a group is found by: its name, its category and its members' names. */
    fun groupText(g: Group, bots: List<Bot>): String = "${g.name} ${g.category} ${Groups.members(g, bots).joinToString(" ") { it.name }}".lowercase()

    fun groups(q: String, groups: List<Group>, bots: List<Bot>): List<Group> = if (q.isEmpty()) emptyList() else groups.filter { groupText(it, bots).contains(q) }

    /** The messages botdot finds for [q], none for fewer than [MIN] letters or when it can't be asked. */
    @Throws(Exception::class)
    suspend fun hits(api: Api, q: String): List<ChatHit> {
        if (q.length < MIN) return emptyList()
        return try { api.search(q) } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
    }

    /** Whose chat a hit is in: "Chief · Week", "Scout → Coder" (one bot asked another), or the bot. */
    fun who(h: ChatHit, chiefName: String): String = when {
        h.chatId != null -> listOf(chiefName, h.title.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ")
        h.fromBot != null -> "${h.fromBot.name} → ${h.bot?.name.orEmpty()}"
        else -> h.bot?.name.orEmpty()
    }

    /** A piece of a hit's snippet; [hit]: a word that matched (botdot marks them «so»). */
    data class Piece(val text: String, val hit: Boolean)

    fun snippet(h: ChatHit): List<Piece> = h.snippet.split('«').flatMapIndexed { i, part ->
        if (i == 0) listOf(Piece(part, false))
        else part.split('»', limit = 2).let { listOf(Piece(it[0], true), Piece(it.getOrElse(1) { "" }, false)) }
    }.filter { it.text.isNotEmpty() }

    /** Where a hit opens: the Chief's conversation, or the bot's chat. */
    sealed class Opens {
        data class Chief(val chatId: String) : Opens()
        data class Bot(val id: String, val name: String) : Opens()
    }

    fun opens(h: ChatHit): Opens? = when {
        h.chatId != null -> Opens.Chief(h.chatId)
        h.bot != null -> Opens.Bot(h.bot.id, h.bot.name)
        else -> null
    }
}
