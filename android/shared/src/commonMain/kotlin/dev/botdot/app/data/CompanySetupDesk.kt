package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlin.random.Random

/**
 * Where a project's setup is on a phone (Android's CompanyScreen): botdot not read yet, the start screen, the
 * conversation with the Chief before its first step, the review of that step and its team, the team being made, the
 * About and Team steps of a setup started without the conversation, and a running project (its page).
 */
enum class SetupPhase { LOADING, START, CONVERSATION, REVIEW, CREATING, STEPS, RUNNING }

/** One objective or card of the starter board (#810) on the review, ticked or not. */
data class StarterRow(val key: String, val label: String, val on: Boolean, val goal: Boolean)

/** A bot of a team just made, with the lead marked where the team has more than one. */
data class MadeBot(val name: String, val color: String?, val lead: Boolean)

/**
 * What a project's setup shows (ADR 242: the iPhone draws it). [sources] are the start screen's, before Go; [scratch]:
 * Start from scratch is offered; [review]: Review first step is (a proposal waits); [approve] is the review's button.
 */
data class SetupState(
    val phase: SetupPhase,
    val company: Company?,
    val name: String,
    val error: String?,
    val conversation: Boolean,
    /** Go is offered: a project the iPhone can set up, with the Chief (its About and Team steps are Android's and the web's). */
    val go: Boolean,
    val scratch: Boolean,
    val sources: List<SourceDraft>,
    val going: Boolean,
    val start: String,
    val firstStep: String,
    val review: Boolean,
    val proposed: List<Proposed>,
    val teamChat: List<TeamLine>,
    val canUndo: Boolean,
    val starter: List<StarterRow>,
    val never: List<String>,
    val facts: Int,
    val approve: String,
    val approveOn: Boolean,
    val creating: Boolean,
    val sending: Boolean,
    val folder: Boolean,
    val made: List<MadeBot>,
    val notice: String?,
    val noticeId: Int,
)

/**
 * A project's setup for both phones (Android's CompanyUi, CompanyScreen's StartForm, ProjectCreationIntro and
 * TeamStep): what each screen shows ([state]) and what each tap sends, from the Store's company. Android draws the same
 * rules in its own screens; the iPhone draws [state].
 */
class CompanySetupDesk(private val store: Store, private val api: Api, private val scope: CoroutineScope) {
    private data class Local(
        val step: String? = null, val sources: List<SourceDraft> = emptyList(), val going: Boolean = false,
        val saving: Int = 0, val sending: Boolean = false, val creating: Boolean = false,
        /** The projects whose Chief chat is being opened: a second tap meanwhile asks nothing. */
        val openingChief: Set<String> = emptySet(),
        val notice: String? = null, val noticeId: Int = 0,
    )

    private val local = MutableStateFlow(Local())

    /** Checks a flag and sets it in one compare-and-set: of two taps at once, from any thread, one goes on. */
    private inline fun claim(crossinline taken: (Local) -> Boolean, crossinline set: (Local) -> Local): Boolean {
        var won = false
        local.update { if (taken(it)) { won = false; it } else { won = true; set(it) } }
        return won
    }
    // The key of a conversational creation (docs/api.md): the same while what Go sends is the same, so a retry after
    // an uncertain answer makes no second project; another one once the words or the files change.
    private var creationKey = newKey()
    private var creationBasis = ""

    val state: StateFlow<SetupState> = combine(store.company.value, store.company.error, store.version.value, store.bots.value, local) { held, error, v, bots, l ->
        of(held, error, v?.features.orEmpty(), bots.orEmpty(), l)
    }.stateIn(scope, SharingStarted.Eagerly, of(null, null, emptyList(), emptyList(), Local()))

    /** Reads the project shown again (the screen opened). */
    fun start() { scope.launch { runCatching { store.company.refresh() } } }

    private fun company(): Company? = store.company.value.value?.company

    private fun say(words: String?) = local.update { it.copy(notice = words ?: tr("That didn't work"), noticeId = it.noticeId + 1) }

    // ---------- the start screen ----------

    /** "Add a link": false (said) when it isn't one or there are already [CompanySetup.MAX_SOURCES]. */
    fun addLink(typed: String): Boolean {
        val s = CompanySetup.link(newKey(), typed) ?: return false
        if (local.value.sources.size >= CompanySetup.MAX_SOURCES) { say(tr("Add at most 20 sources.")); return false }
        local.update { it.copy(sources = it.sources + s) }
        return true
    }

    /** "Add files": each is uploaded for the Chief at once, shown as uploading, then as added or failed (red). */
    fun addFile(file: OutgoingFile) {
        if (local.value.sources.size >= CompanySetup.MAX_SOURCES) return say(tr("Add at most 20 sources."))
        if ((file.size ?: 0) > CompanySetup.MAX_FILE) return say(tr("{name} is over 25 MB.", "name" to file.name))
        val s = SourceDraft(newKey(), "file", file.name, size = file.size ?: 0)
        local.update { it.copy(sources = it.sources + s) }
        scope.launch {
            val done = try { Result.success(api.upload(file, "chief")) } catch (e: CancellationException) { throw e } catch (e: Exception) { Result.failure(e) }
            local.update { l ->
                l.copy(sources = l.sources.map { x ->
                    if (x.id != s.id) x else done.fold({ x.copy(upload = it, size = if (it.size > 0) it.size else x.size) }, { x.copy(failed = true) })
                })
            }
            done.exceptionOrNull()?.let { say("${file.name}: ${it.message}") }
        }
    }

    fun removeSource(id: String) = local.update { l -> l.copy(sources = l.sources.filterNot { it.id == id }) }

    /** Go, with what was typed: the project is made, and its setup opens (with the Chief, where botdot has that). */
    @Throws(Exception::class)
    suspend fun go(typed: String): Boolean {
        val start = CompanySetup.creationText(typed)
        if (start.isEmpty()) return false
        val conversation = talks()
        if (!claimGo(conversation)) return false
        val l = local.value
        val basis = CompanySetup.startBody(start, l.sources).toString()
        if (basis != creationBasis) { creationBasis = basis; creationKey = newKey() }
        return made(l.sources) { it.startCompany(start, l.sources, creationKey.takeIf { conversation }) }?.also {
            local.update { it.copy(step = if (conversation) null else "about") }
            creationKey = newKey()
        } != null
    }

    /** "Start from scratch", with the project's name: made empty, its folder named after it. */
    @Throws(Exception::class)
    suspend fun scratch(typed: String): Boolean {
        val name = typed.trim()
        if (name.isEmpty() || !claimGo(false)) return false
        val l = local.value
        return made(l.sources) { it.startEmptyProject(name, l.sources) }?.also { local.update { it.copy(step = null) } } != null
    }

    /** Go or Start from scratch claimed: not while one is on its way, nor while a file uploads (or failed, to the Chief). */
    private fun claimGo(failedStop: Boolean): Boolean {
        var why: String? = null
        val won = claim({ l ->
            why = when {
                l.going -> ""
                l.sources.any { it.uploading } -> tr("Wait for the files to finish uploading.")
                failedStop && l.sources.any { it.failed } -> tr("Remove failed files or add them again.")
                else -> null
            }
            why != null
        }) { it.copy(going = true) }
        why?.takeIf { it.isNotEmpty() }?.let(::say)
        return won
    }

    private suspend fun made(sent: List<SourceDraft>, call: suspend (Api) -> Company): Company? {
        return try {
            call(api).also { c ->
                store.tookProject(c, made = true)
                local.update { l -> l.copy(sources = l.sources - sent.toSet()) }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message); null
        } finally {
            local.update { it.copy(going = false) }
        }
    }

    private fun talks(): Boolean = CONVERSATION in store.version.value.value?.features.orEmpty()

    // ---------- with the Chief, then the review ----------

    /**
     * The project's Chief chat, where its first step is talked over: its id, or "" when it couldn't be opened (said) or
     * is being opened by a tap before. Android's CompanyUi.openChief has the same rules.
     */
    @Throws(Exception::class)
    suspend fun chiefChat(): String {
        val c = company() ?: return ""
        c.chiefChat?.takeIf { it.isNotEmpty() && (!c.conversation || c.creationSent) }?.let { return it }
        if (!claim({ c.id in it.openingChief }) { it.copy(openingChief = it.openingChief + c.id) }) return ""
        return try {
            val chat = api.projectChiefChat(c.id)
            if (company()?.id == c.id && chat.isNotEmpty()) { runCatching { store.company.refresh() }; chat } else ""
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message ?: tr("Couldn't open the chat")); ""
        } finally {
            local.update { it.copy(openingChief = it.openingChief - c.id) }
        }
    }

    /** "Review first step": the proposal the Chief staged, its team's cards. */
    fun review() = local.update { it.copy(step = "team") }

    /** Back from the review: to the conversation, or to About in a setup without it. */
    fun back() = local.update { it.copy(step = if (company()?.conversation == true) null else "about") }

    fun rename(key: String, name: String) {
        val c = company() ?: return
        val n = name.trim()
        if (n.isEmpty()) return
        saveProposal(CompanySetup.edited(c.proposal.orEmpty(), key, mapOf("name" to JsonPrimitive(n))))
    }

    fun remove(key: String) {
        val c = company() ?: return
        saveProposal(CompanySetup.removed(c.proposal.orEmpty(), key))
    }

    private fun saveProposal(next: List<kotlinx.serialization.json.JsonObject>) = save(CompanySetup.patch(next)) { it.copy(proposal = next) }

    /** A starter board's objective or card ticked or not (#810). */
    fun tick(key: String, on: Boolean) {
        val s = company()?.starter ?: return
        val next = ProjectStarter.ticked(s, key, on)
        save(ProjectStarter.patch(next)) { it.copy(starter = next) }
    }

    /** One of "Never without asking" taken off. */
    fun removeNever(index: Int) {
        val c = company() ?: return
        val next = c.never.filterIndexed { i, _ -> i != index }
        save(CompanySetup.patchLines("never", next)) { it.copy(never = next) }
    }

    /** "Change the team…" with what was typed: true once the Chief took it, so the field empties. */
    @Throws(Exception::class)
    suspend fun changeTeam(typed: String): Boolean {
        val text = typed.trim()
        if (text.isEmpty() || !claim({ it.sending }) { it.copy(sending = true) }) return false
        return try { call { it.changeTeam(text) } } finally { local.update { it.copy(sending = false) } }
    }

    /** Undo the Chief's last change of the team. */
    @Throws(Exception::class)
    suspend fun undo() {
        local.update { it.copy(saving = it.saving + 1) }
        try { call { it.undoTeam() } } finally { local.update { it.copy(saving = it.saving - 1) } }
    }

    /**
     * "Approve first step" (or "Create N bots" in a setup without the conversation): the team is made from the proposal
     * reviewed; a refusal goes back to the review. Nothing goes while an edit is on its way (docs/api.md).
     */
    @Throws(Exception::class)
    suspend fun approve(): Boolean {
        val c = company() ?: return false
        if (c.proposed().isNullOrEmpty()) return false
        if (!claim({ it.creating || (c.conversation && (it.saving > 0 || it.sending)) }) { it.copy(creating = true, step = "start") }) return false
        val ok = try { call { it.createTeam(c.creationReview) } } finally { local.update { it.copy(creating = false) } }
        if (!ok) local.update { it.copy(step = "team") }
        return ok
    }

    /** "Delete project", and with a folder whether it goes too: the next project shows, or the start screen. */
    @Throws(Exception::class)
    suspend fun delete(dropFolder: Boolean): Boolean {
        val c = company() ?: return false
        return try {
            api.deleteCompany(dropFolder, c.id)
            local.update { it.copy(step = null) }
            store.projectGone(c.id)
            if (!ManyProjects.many(store.version.value.value?.features)) store.company.set(CompanyHeld(null))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message); false
        }
    }

    /** Saves [fields], drawn at once as [now] has them; a refused save says why and takes botdot's project back. */
    private fun save(fields: kotlinx.serialization.json.JsonObject, now: (Company) -> Company) {
        store.company.update { h -> CompanyHeld(h.company?.let(now)) }
        local.update { it.copy(saving = it.saving + 1) }
        scope.launch {
            try {
                store.tookProject(api.patchCompany(fields))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                say(e.message)
                runCatching { store.company.refresh() }
            } finally {
                local.update { it.copy(saving = it.saving - 1) }
            }
        }
    }

    private suspend fun call(block: suspend (Api) -> Company): Boolean = try {
        store.tookProject(block(api))
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        say(e.message); false
    }

    private fun of(held: CompanyHeld?, error: String?, features: List<String>, bots: List<Bot>, l: Local): SetupState {
        val c = held?.company
        val talks = CONVERSATION in features
        val phase = when {
            held == null -> SetupPhase.LOADING
            c == null -> SetupPhase.START
            c.running -> SetupPhase.RUNNING
            c.conversation && talks && l.step !in listOf("team", "start") -> SetupPhase.CONVERSATION
            else -> when (CompanySetup.stepOf(c, l.step)) {
                "team" -> if (c.conversation) SetupPhase.REVIEW else SetupPhase.STEPS
                "start" -> SetupPhase.CREATING
                else -> SetupPhase.STEPS
            }
        }
        val proposed = c?.proposed().orEmpty()
        val starter = c?.starter?.takeIf { ProjectStarter.FEATURE in features }
        return SetupState(
            phase = phase,
            company = c,
            name = c?.let(ManyProjects::nameOf).orEmpty(),
            error = error.takeIf { held == null },
            conversation = talks,
            go = talks,
            scratch = CompanySetup.EMPTY in features && !talks,
            sources = l.sources,
            going = l.going,
            start = c?.start.orEmpty(),
            firstStep = c?.firstStep.orEmpty(),
            review = !c?.proposal.isNullOrEmpty(),
            proposed = proposed,
            teamChat = c?.teamChat.orEmpty(),
            canUndo = c?.canUndo == true,
            starter = starter?.let { s -> s.goals.map { StarterRow(it.key, ProjectStarter.label(it), it.on, true) } + s.cards.map { StarterRow(it.key, it.ask, it.on, false) } }.orEmpty(),
            never = c?.never.orEmpty(),
            facts = c?.facts ?: 0,
            approve = if (c?.conversation == true) tr("Approve first step") else trn(proposed.size, "Create {n} bot", "Create {n} bots"),
            approveOn = proposed.isNotEmpty() && !l.creating && (c?.conversation != true || (l.saving == 0 && !l.sending)),
            creating = l.creating,
            sending = l.sending,
            folder = c?.folder != null,
            made = proposed.map { b -> MadeBot(bots.firstOrNull { it.id == b.bot }?.name ?: b.name, bots.firstOrNull { it.id == b.bot }?.color ?: b.color, false) },
            notice = l.notice,
            noticeId = l.noticeId,
        )
    }

    companion object {
        /** Conversational project creation (docs/api.md). */
        const val CONVERSATION = "project-conversation"

        /**
         * Whether [c] opens its setup on a phone that draws only the conversation's (the iPhone): a project not running
         * yet, set up with the Chief on a botdot that has that. Another one (About and Team steps) opens its page.
         */
        fun opensSetup(c: Company?, features: List<String>?): Boolean =
            c != null && !c.running && c.conversation && CONVERSATION in features.orEmpty()

        private fun newKey(): String = (1..16).map { "0123456789abcdef"[Random.nextInt(16)] }.joinToString("")
    }
}
