package dev.botdot.app.data

import kotlinx.coroutines.CancellationException

/**
 * Making a group from a bot's chat (Android's BotPicker under the "+" beside the bot's name): who can join, in what
 * order, what the picker says, and the making itself. A group has two to [GROUP_MAX] bots: this one and one to five
 * picked.
 */
object GroupMaker {
    /** The most bots that can be picked beside the chat's own. */
    const val PICKS = GROUP_MAX - 1

    /** Whether a group can be made from a bot's chat: the botdot has groups, and there is another bot. */
    fun canMake(features: Collection<String>?, otherBots: Int): Boolean = hasGroups(features) && otherBots > 0

    /** The bots that can join [bot]: every other one, its own category's first, then by name. */
    fun others(bots: List<Bot>, bot: Bot): List<Bot> =
        bots.filter { it.id != bot.id }.sortedWith(compareBy<Bot> { it.group != bot.group }.thenBy { it.name.lowercase() })

    /** Under the picker: how many are picked ([n]), with [bot]. */
    fun hint(n: Int, bot: String): String =
        if (n > 0) trn(n + 1, "{n} bot in the group, with {bot}.", "{n} bots in the group, with {bot}.", "bot" to bot)
        else tr("Pick one to five bots to join {bot}. Its own chat stays as it is.", "bot" to bot)

    /** What a group can be made of now: one to [PICKS] picked. */
    fun ready(picked: Int): Boolean = picked in 1..PICKS

    /** What the making answers: the group made, or botdot's words why not. */
    data class Made(val group: Group?, val failed: String?)

    /**
     * The group of [bot] and [picked], called [name] (the botdot names it when blank); the list of groups read again so
     * Home has it. Nothing is made with none picked or too many.
     */
    @Throws(Exception::class)
    suspend fun make(api: Api, store: Store, bot: String, picked: List<String>, name: String): Made {
        if (!ready(picked.size)) return Made(null, tr("Pick one to five bots to join {bot}. Its own chat stays as it is.", "bot" to bot))
        return try {
            val g = api.makeGroup(name.trim(), listOf(bot) + picked)
            try { store.groups.refresh() } catch (e: CancellationException) { throw e } catch (_: Exception) {}
            Made(g, null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Made(null, e.message ?: tr("Couldn't create the group"))
        }
    }
}
