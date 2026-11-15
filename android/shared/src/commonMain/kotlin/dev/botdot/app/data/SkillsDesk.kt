package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The words of a skill in the library, for both phones (Android's SkillsScreen). */
object SkillWords {
    /** Under a skill in the list: who uses it ("Used by the Chief and 2 bots"), or "Not used yet". */
    fun usedLine(k: Skill): String {
        val chief = ChiefSkills.CHIEF_ID in k.usedBy
        val n = k.usedBy.size - if (chief) 1 else 0
        val bots = if (n == 0) "" else trn(n, "{n} bot", "{n} bots")
        return if (n == 0 && !chief) tr("Not used yet")
        else tr("Used by {names}", "names" to listOf(if (chief) tr("the Chief") else "", bots).filter { it.isNotEmpty() }.joinToString(" " + tr("and") + " "))
    }

    /** On a skill's page: who uses it by name, or how to give it to one. */
    fun users(k: Skill, botNames: Map<String, String>): String {
        val users = ChiefSkills.usedBy(k.usedBy, botNames)
        return if (users.isEmpty()) tr("No bot uses it yet. Turn it on in a bot's settings.") else tr("Used by {names}", "names" to users.joinToString(", "))
    }

    /** Who made it: a bot by name, the Chief, or you; null when botdot doesn't say. */
    fun madeBy(k: Skill, botNames: Map<String, String>): String? = k.createdBy?.let {
        if (it.startsWith("bot:")) tr("Made by {name}", "name" to (botNames[it.removePrefix("bot:")] ?: tr("a bot")))
        else if (it == "chief") tr("Made by the Chief") else tr("Made by you")
    }
}

/** Skills at one moment: your library and the ones built into Claude Code, and why it couldn't be read. */
class SkillsState(val library: List<Skill> = emptyList(), val builtin: List<BuiltinSkill> = emptyList(), val loaded: Boolean = false, val error: String? = null)

/** Skills for both phones (Android's SkillsScreen): the library, which bots use each, and the skills built into Claude Code. */
class SkillsDesk(private val scope: CoroutineScope, private val api: Api, private val store: Store) {
    private val _state = MutableStateFlow(SkillsState())
    val state: StateFlow<SkillsState> = _state.asStateFlow()

    fun watch(onChange: (SkillsState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    @Throws(Exception::class)
    suspend fun load() {
        _state.value = try { api.skills().let { SkillsState(it.library, it.builtin, loaded = true) } }
        catch (e: CancellationException) { throw e } catch (e: Exception) { SkillsState(_state.value.library, _state.value.builtin, loaded = true, error = e.message ?: tr("Couldn't load")) }
    }

    /** The bots' names by id, as the store has them now. */
    fun botNames(): Map<String, String> = store.bots.value.value.orEmpty().associate { it.id to it.name }

    fun users(k: Skill): String = SkillWords.users(k, botNames())
    fun madeBy(k: Skill): String? = SkillWords.madeBy(k, botNames())
}
