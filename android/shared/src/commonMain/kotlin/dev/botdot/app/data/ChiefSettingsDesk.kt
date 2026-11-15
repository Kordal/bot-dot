package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The Chief's settings at one moment (Android's ChiefSettingsScreen): what each part shows, from a botdot that has it. */
class ChiefSettingsState(
    val loaded: Boolean = false,
    /** Its name ("" for the role's), from a botdot with chief-name; null: no field. */
    val name: String? = null,
    /** Its model and reasoning, with Advanced on; [effort] only for a model that reasons. */
    val advanced: Boolean = false,
    val model: String = "",
    val effort: String = "",
    val thinks: Boolean = true,
    val models: List<Option> = emptyList(),
    val efforts: List<Option> = emptyList(),
    val rules: String = "",
    /** Your library skills for it (chief-skills): the ones it has first; null: no section. */
    val skills: List<Skill>? = null,
    val picked: List<String> = emptyList(),
    val grants: List<ChiefGrant> = emptyList(),
    /** Its own jobs (chief-jobs); null: no section. */
    val jobs: List<ChiefJob>? = null,
    /** Its pages (chief-pages); null: no section. */
    val pages: List<PageInfo>? = null,
    /** The checkup's switches (checkup); null: none. */
    val checkup: Checkup? = null,
    val chats: List<ChiefChatSummary> = emptyList(),
    val savedAt: Int = 0,
    val notice: String? = null,
    val noticeCount: Int = 0,
) {
    /** A page's line ([Pages.line]): when it was updated, and what keeps it. */
    fun pageLine(page: PageInfo): String = Pages.line(page)
}

/**
 * The Chief's settings for both phones (#379, #381, #383, #384, #408, #636): its name, model and reasoning, your rules
 * for it and your skills for it are saved by themselves a moment after the last change ([SAVE_MS]), "Saved" each
 * time; a refused name is put back with botdot's sentence and the rest still saves, and a refused change is not sent
 * again until it changes. Revoke, a job's switch and Remove, and the checkup's switches each act at once, and the
 * feed ([events]) brings what changed elsewhere.
 */
class ChiefSettingsDesk(private val scope: CoroutineScope, private val api: Api, private val store: Store, private val events: Flow<FeedEvent>) {
    private var info = SettingsInfo()
    private var edit = AppSettings()
    private var refused: AppSettings? = null
    private var name: String? = null
    private var renamed: String? = null
    private var library: List<Skill>? = null
    private var grants: List<ChiefGrant> = emptyList()
    private var jobs: List<ChiefJob>? = null
    private var pages: List<PageInfo>? = null
    private var checkup: Checkup? = null
    private var loaded = false
    private var savedAt = 0
    private var notice: String? = null
    private var noticeCount = 0
    private var saving: Job? = null
    private val following = mutableListOf<Job>()
    private val _state = MutableStateFlow(ChiefSettingsState())
    val state: StateFlow<ChiefSettingsState> = _state.asStateFlow()

    fun watch(onChange: (ChiefSettingsState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    private val features: List<String>? get() = store.version.value.value?.features

    /** Everything it shows, then what the feed and the store bring while it is open. */
    @Throws(Exception::class)
    suspend fun load() {
        val f = features
        try { info = api.settings(); edit = info.settings } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't load")) }
        if (ChiefName.FEATURE in f.orEmpty()) name = ChiefName.field(store.chiefName.value)
        if (ChiefSkills.shows(f)) library = runCatching { api.skills().library }.getOrElse { say(it.message ?: tr("Couldn't load")); emptyList() }
        grants = ChiefGrant.kinds(f).flatMap { k -> runCatching { api.chiefGrants(k) }.getOrNull().orEmpty() }
        jobs = if (ChiefJobs.shows(f)) runCatching { api.chiefJobs() }.getOrNull() else null
        checkup = if (Checkup.shows(f)) runCatching { api.checkup() }.getOrElse { say(it.message ?: tr("Couldn't load")); null } else null
        readPages()
        val first = !loaded
        loaded = true
        publish()
        if (!first) return
        following += scope.launch { events.collect { ev -> Checkup.event(ev)?.let { checkup = it; publish() }; ChiefJobs.event(ev)?.let { jobs = it; publish() } } }
        following += scope.launch { store.pageSaves.value.collect { readPages(); publish() } }
        following += scope.launch { store.chief.value.collect { publish() } }
    }

    /** The settings went: they follow the feed and the store no more. A change on its way is still saved. */
    fun close() { following.forEach { it.cancel() }; following.clear() }

    private suspend fun readPages() { pages = if (Pages.showsChief(features)) runCatching { api.pages(Pages.CHIEF) }.getOrNull() else null }

    /** The viewer closed: its pages read again (their keeping may have changed there). */
    @Throws(Exception::class)
    suspend fun pagesAgain() { readPages(); publish() }

    fun setName(text: String) { if (name != null) { name = text.take(ChiefName.MAX); changed() } }
    fun setRules(text: String) { edit = edit.copy(chiefRules = text.take(4000)); changed() }
    fun setModel(id: String) { edit = edit.copy(chiefModel = id); changed() }
    fun setEffort(id: String) { edit = edit.copy(chiefEffort = id); changed() }
    fun setSkill(skill: String, on: Boolean) { edit = edit.copy(chiefSkills = ChiefSkills.toggle(edit.chiefSkills, skill, on)); changed() }

    /** A change: shown, and saved a moment after the last one. */
    private fun changed() {
        publish()
        saving?.cancel()
        saving = scope.launch { delay(SAVE_MS); save() }
    }

    private suspend fun save() {
        val n = name
        val rename = n != null && ChiefName.changed(n, store.chiefName.value) && n.trim() != renamed
        if (rename) {
            try { renamed = n!!.trim(); name = ChiefName.field(api.renameChief(n.trim())); savedAt++ }
            catch (e: CancellationException) { throw e } catch (e: Exception) { name = ChiefName.field(store.chiefName.value); say(e.message ?: tr("Couldn't rename")) }
        }
        if (edit != info.settings && edit != refused) {
            val sent = edit
            try { info = api.saveSettings(sent); if (edit == sent) edit = info.settings; savedAt++ }
            catch (e: CancellationException) { throw e } catch (e: Exception) { refused = sent; say(e.message ?: tr("Couldn't save")) }
        }
        publish()
    }

    /** Revoke: it asks again next time. */
    @Throws(Exception::class)
    suspend fun revoke(g: ChiefGrant) {
        try { api.revokeChiefGrant(g); grants = grants - g; say(ChiefGrant.REVOKED) }
        catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't save")) }
    }

    /** A job's switch: paused or on. */
    @Throws(Exception::class)
    suspend fun setJobOn(id: String, on: Boolean) {
        try { val now = api.setChiefJobOn(id, on); jobs = jobs.orEmpty().map { if (it.id == now.id) now else it }; publish() }
        catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't save")) }
    }

    @Throws(Exception::class)
    suspend fun removeJob(id: String) {
        try { api.removeChiefJob(id); jobs = jobs.orEmpty().filter { it.id != id }; say(tr("Removed.")) }
        catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't remove")) }
    }

    /** One of the checkup's switches ("on", "webSearch"): shown at once, back with why when refused (not over what the feed said meanwhile). */
    @Throws(Exception::class)
    suspend fun setCheckup(field: String, on: Boolean) {
        val before = checkup ?: return
        val now = if (field == "on") before.copy(on = on) else before.copy(webSearch = on)
        checkup = now; publish()
        try { api.setCheckup(field, on)?.let { checkup = it }; publish() }
        catch (e: CancellationException) { throw e } catch (e: Exception) { if (checkup == now) checkup = before; say(e.message ?: tr("Couldn't save")) }
    }

    private fun say(text: String) { notice = text; noticeCount++; publish() }

    private fun publish() {
        val thinks = { m: String -> info.models.firstOrNull { it.id == m }?.effort ?: true }
        val saved = info.settings.chiefSkills.orEmpty()
        _state.value = ChiefSettingsState(
            loaded = loaded, name = name,
            advanced = Advanced.on.value,
            model = edit.chiefModel, effort = edit.chiefEffort, thinks = thinks(edit.chiefModel.ifBlank { edit.defaultModel }),
            models = listOf(Option("", tr("Same as the default"))) + info.models.map { Option(it.id, it.label.ifBlank { it.id }) },
            efforts = listOf(Option("", tr("Same as the default"))) + info.efforts.map { Option(it.id, it.label) },
            rules = edit.chiefRules,
            // The ones it has come first, as saved, so rows don't jump while they are ticked.
            skills = library?.sortedBy { it.name !in saved },
            picked = edit.chiefSkills.orEmpty(),
            grants = grants, jobs = jobs, pages = pages, checkup = checkup,
            chats = store.chief.value.value?.chats.orEmpty().take(15),
            savedAt = savedAt, notice = notice, noticeCount = noticeCount,
        )
    }

    companion object {
        /** A change is saved this long after the last one. */
        const val SAVE_MS = 800L
    }
}
