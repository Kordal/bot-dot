package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * "Duplicate" (#227): a second bot with the same settings, such as Coder 2. The server says what the copy gets
 * ([CopyPlan]), the owner can change the name, and the copy is an ordinary bot of its own. Only from a server whose
 * `features` name `duplicate-bot`.
 */
object Duplicate {
    const val FEATURE = "duplicate-bot"

    /** Whether the botdot this app talks to can duplicate a bot. While its features are not known yet: no. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** While the copy is made, and once it is. */
    fun duplicating(name: String?): String = tr("Duplicating {name}…", "name" to name)
    fun made(name: String): String = tr("{name} made", "name" to name)

    /** What the confirmation says, the server's lines as they are. */
    fun text(plan: CopyPlan): String = buildString {
        append(tr("The copy gets:") + "\n")
        plan.copies.forEach { append("• ").append(it).append('\n') }
        append("\n" + tr("Not copied:") + " ").append(plan.notCopied).append('.')
        if (plan.vaultLocked) append("\n\n" + tr("Bitwarden is locked: unlock it first, so the copy can use the same saved passwords."))
    }
}

/** What a copy of a bot would get (`GET /api/bots/:id/duplicate`). */
@Serializable
data class CopyPlan(
    val name: String = "",
    val copies: List<String> = emptyList(),
    val notCopied: String = "",
    val logins: List<String> = emptyList(),
    val vaultLocked: Boolean = false,
)

/** Duplicate at one moment: the server's plan while the confirmation is open, the copy's name, and what it is doing. */
class DuplicateState(val plan: CopyPlan? = null, val name: String = "", val busy: Boolean = false, val notice: String? = null, val noticeCount: Int = 0) {
    /** What the confirmation says ([Duplicate.text]). */
    val text: String get() = plan?.let(Duplicate::text).orEmpty()
    /** Duplicate is offered: a name, and Bitwarden not locked. */
    val canGo: Boolean get() = plan != null && !plan.vaultLocked && name.isNotBlank() && !busy
}

/**
 * "Duplicate" for both phones (#227, #478; Android's settings): [ask] reads what the copy gets, the name can be
 * changed, and [go] makes the copy, saying "Duplicating…", then the copy's id (its chat opens) or botdot's sentence.
 */
class DuplicateDesk(private val api: Api, private val botId: String, private val botName: String) {
    private val _state = kotlinx.coroutines.flow.MutableStateFlow(DuplicateState())
    val state: kotlinx.coroutines.flow.StateFlow<DuplicateState> = _state

    private fun say(text: String) { val s = _state.value; _state.value = DuplicateState(s.plan, s.name, false, text, s.noticeCount + 1) }

    /** The button: what the copy would get, and its name to change. False (said) when it can't be read. */
    @Throws(Exception::class)
    suspend fun ask(): Boolean = try {
        val p = api.copyPlan(botId)
        _state.value = DuplicateState(p, p.name, false, _state.value.notice, _state.value.noticeCount); true
    } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't load")); false }

    fun setName(name: String) { val s = _state.value; _state.value = DuplicateState(s.plan, name.take(60), s.busy, s.notice, s.noticeCount) }

    fun cancel() { val s = _state.value; _state.value = DuplicateState(null, "", false, s.notice, s.noticeCount) }

    /** Duplicate: the copy made, and its id (its chat opens); null when botdot said no (its sentence is said). */
    @Throws(Exception::class)
    suspend fun go(): String? {
        val s = _state.value
        if (!s.canGo) return null
        _state.value = DuplicateState(s.plan, s.name, true, Duplicate.duplicating(botName), s.noticeCount + 1)
        return try {
            val copy = api.duplicateBot(botId, s.name)
            _state.value = DuplicateState(null, "", false, Duplicate.made(copy.name), _state.value.noticeCount + 1)
            copy.id
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't save")); null }
    }
}
