package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** The Chief's settings at one moment (Android's ChiefSettingsScreen): what each part shows, from a botdot that has it. */
class ChiefSettingsState(
    val loaded: Boolean = false,
    /** Its name ("" for the role's), from a botdot with chief-name; null: no field. */
    val name: String? = null,
    /** Its model and reasoning, with Advanced on; [effort] only for a model that reasons. */
    val advanced: Boolean = false,
    val model: String = "",
    /** The model as its row says it, with its provider when it is not Claude's (ADR 267); "" for none picked. */
    val modelName: String = "",
    /** The server lists every connected provider's models (ADR 267): the picker is grouped and searchable. */
    val grouped: Boolean = false,
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
    val chats: List<ChiefChatSummary> = emptyList(),
    val savedAt: Int = 0,
    val notice: String? = null,
    val noticeCount: Int = 0,
    /** The first read failed: the form waits, with Try again (load once more). */
    val failed: Boolean = false,
    /** Its files and workspace (#383) open in Files (#603), from a botdot that has both ([FilesExplorer.opensFor]). */
    val files: Boolean = false,
) {
    /** A page's line ([Pages.line]): when it was updated, and what keeps it. */
    fun pageLine(page: PageInfo): String = Pages.line(page)
}

/**
 * The Chief's settings for both phones (#379, #381, #383, #384, #408, #636): its name, model and reasoning, your rules
 * for it and your skills for it are saved by themselves a moment after the last change ([SAVE_MS]), "Saved" each
 * time; a refused name is put back with botdot's sentence and the rest still saves, and a refused change is not sent
 * again until it changes. Revoke, a job's switch and Remove each act at once, and the
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
    private var loaded = false
    private var savedAt = 0
    private var notice: String? = null
    private var noticeCount = 0
    private var saving: Job? = null
    /** The features last read for: a change of them reads what they bring. */
    private var seenFeatures: List<String>? = null
    /** A name typed here that waits to be saved: a rename from elsewhere doesn't take its place. */
    private var nameEdited = false
    /** The settings were read once: before, nothing is saved (blank defaults would go over the Chief's own). */
    private var settingsRead = false
    /** A first read was tried and failed. */
    private var tried = false
    /** A change waits its moment to be saved ([close] saves it at once). */
    private var waiting = false
    private val following = mutableListOf<Job>()
    private val _state = MutableStateFlow(ChiefSettingsState())
    val state: StateFlow<ChiefSettingsState> = _state.asStateFlow()

    fun watch(onChange: (ChiefSettingsState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    private val features: List<String>? get() = store.version.value.value?.features

    /** Everything it shows, then what the feed and the store bring while it is open. */
    @Throws(Exception::class)
    suspend fun load() {
        try {
            val before = info.settings
            info = api.settings()
            // Read again: an edit not saved yet (it differs from what was read before) stays.
            if (!settingsRead || edit == before) edit = info.settings
            settingsRead = true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't load")); if (!settingsRead) { tried = true; publish(); return } }
        val f = features
        readFeatured(f)
        val first = !loaded
        loaded = true
        publish()
        if (!first) return
        // The features may come after the settings opened (a cold start, a reconnect): what they bring is read then.
        following += scope.launch { store.version.value.collect { v -> val now = v?.features; if (now != seenFeatures) { readFeatured(now); publish() } } }
        // The name renamed elsewhere (the feed, another phone): the field follows, unless a name typed here waits to be saved.
        following += scope.launch { store.chiefName.collect { n -> if (name != null && !nameEdited) { name = ChiefName.field(n); publish() } } }
        following += scope.launch { events.collect { ev -> ChiefJobs.event(ev)?.let { jobs = it; publish() } } }
        following += scope.launch { store.pageSaves.value.collect { readPages(); publish() } }
        following += scope.launch { store.chief.value.collect { publish() } }
    }

    /**
     * The settings went: they follow the feed and the store no more. A change that waited its moment is saved at
     * once, and one on its way still finishes.
     */
    fun close() {
        following.forEach { it.cancel() }; following.clear()
        if (waiting) { saving?.cancel(); waiting = false; saving = scope.launch { withContext(NonCancellable) { save() } } }
    }

    /** What only a botdot with its feature has: the name, the skills, what you always approved, its jobs and its pages. */
    private suspend fun readFeatured(f: List<String>?) {
        seenFeatures = f
        name = if (ChiefName.FEATURE in f.orEmpty()) (if (nameEdited) name else ChiefName.field(store.chiefName.value)) else null
        library = if (ChiefSkills.shows(f)) runCatching { api.skills().library }.getOrElse { say(it.message ?: tr("Couldn't load")); emptyList() } else null
        grants = ChiefGrant.kinds(f).flatMap { k -> runCatching { api.chiefGrants(k) }.getOrNull().orEmpty() }
        jobs = if (ChiefJobs.shows(f)) runCatching { api.chiefJobs() }.getOrNull() else null
        readPages()
    }

    private suspend fun readPages() { pages = if (Pages.showsChief(features)) runCatching { api.pages(Pages.CHIEF) }.getOrNull() else null }

    /** The viewer closed: its pages read again (their keeping may have changed there). */
    @Throws(Exception::class)
    suspend fun pagesAgain() { readPages(); publish() }

    fun setName(text: String) { if (name != null) { name = text.take(ChiefName.MAX); nameEdited = true; changed() } }
    fun setRules(text: String) { edit = edit.copy(chiefRules = text.take(4000)); changed() }
    fun setModel(id: String) { edit = edit.copy(chiefModel = id); changed() }
    fun setEffort(id: String) { edit = edit.copy(chiefEffort = id); changed() }
    fun setSkill(skill: String, on: Boolean) { edit = edit.copy(chiefSkills = ChiefSkills.toggle(edit.chiefSkills, skill, on)); changed() }

    /** A change: shown, and saved a moment after the last one. */
    private fun changed() {
        publish()
        saving?.cancel()
        // Only the wait is put off by the next change: a save already on its way finishes (a cancelled rename would be lost).
        waiting = true
        saving = scope.launch { delay(SAVE_MS); waiting = false; withContext(NonCancellable) { save() } }
    }

    /** One save at a time: the next waits for the one on its way, and sees what it sent. */
    private val saveLock = kotlinx.coroutines.sync.Mutex()

    private suspend fun save() = saveLock.withLock { saveNow() }

    private suspend fun saveNow() {
        val n = name
        val rename = n != null && ChiefName.changed(n, store.chiefName.value) && n.trim() != renamed
        if (rename) {
            try { val sent = n!!.trim(); name = ChiefName.field(api.renameChief(sent)); renamed = sent; savedAt++ }
            catch (e: CancellationException) { throw e } catch (e: Exception) { name = ChiefName.field(store.chiefName.value); say(e.message ?: tr("Couldn't rename")) }
        }
        nameEdited = false // saved, or the same as botdot's: a rename from elsewhere may take its place again
        if (settingsRead && edit != info.settings && edit != refused) {
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

    private fun say(text: String) { notice = text; noticeCount++; publish() }

    private fun publish() {
        val saved = info.settings.chiefSkills.orEmpty()
        val shown = info.shownModel(edit.chiefModel)
        val model = shown.ifBlank { edit.defaultModel }
        _state.value = ChiefSettingsState(
            loaded = loaded && settingsRead, failed = tried && !settingsRead, name = name,
            advanced = Advanced.on.value,
            model = shown, modelName = if (shown.isEmpty()) "" else info.modelLabel(shown), grouped = info.mixed,
            effort = info.shownEffort(edit.chiefEffort, model), thinks = info.canThink(model),
            models = listOf(Option("", info.inheritedModelLabel())) + info.models.map { Option(it.id, it.label.ifBlank { it.id }, it.group) },
            efforts = listOf(Option("", info.inheritedEffortLabel(model))) + info.availableEfforts(model).map { Option(it.id, it.label) },
            rules = edit.chiefRules,
            // The ones it has come first, as saved, so rows don't jump while they are ticked.
            skills = library?.sortedBy { it.name !in saved },
            picked = edit.chiefSkills.orEmpty(),
            grants = grants, jobs = jobs, pages = pages,
            chats = store.chief.value.value?.chats.orEmpty().take(15),
            savedAt = savedAt, notice = notice, noticeCount = noticeCount,
            files = FilesExplorer.opensFor(UploadedFiles.CHIEF, features),
        )
    }

    companion object {
        /** A change is saved this long after the last one. */
        const val SAVE_MS = 800L
    }
}
