package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** Claude's row in a word or two: what bots run on, or that they can't. */
fun claudeValue(c: ClaudeStatus): String = if (c.mixed) {
    // Claude's own connection first, then the providers connected beside it (ADR 267).
    (listOf(if (c.claudeOnKey) tr("API key") else if (c.claudeOut) tr("Not signed in") else c.email ?: tr("Signed in")) + c.providers.orEmpty().map { it.name }).joinToString(", ")
} else when {
    c.onApiKey -> tr("API key")
    c.onProvider -> c.provider!!.name
    !c.loggedIn -> tr("Not signed in")
    else -> c.email ?: tr("Signed in")
}

/** The rules of the app's Settings (#636), drawn by Android's SettingsScreen and the iPhone's SettingsView. */
object AppSettingsRules {
    /** The account's default Model: Claude Code's own first. */
    fun models(info: SettingsInfo): List<Option> = listOf(Option("", info.defaultModelLabel())) + info.models.map { Option(it.id, it.label.ifBlank { it.id }, it.group) }

    /** The account's default Reasoning: Claude Code's own first. */
    fun efforts(info: SettingsInfo, model: String = info.settings.defaultModel): List<Option> =
        listOf(Option("", if (info.provider == null && !info.mixed) tr("Claude Code's default") else tr("Default"))) + info.availableEfforts(model).map { Option(it.id, it.label) }

    /** botdot's address as its row says it: without the scheme and the last slash. */
    fun address(baseUrl: String): String = baseUrl.removePrefix("https://").removePrefix("http://").trimEnd('/')
}

/** Settings → Usage at one moment: the timeframe picked, and botdot's answer for it, or why there is none. */
class UsageState(val preset: Usage.Preset = Usage.Preset.WEEK, val answer: Usage.Answer? = null, val error: String? = null)

/**
 * The app's Settings at one moment, as the iPhone draws them (#1370): what botdot said of the account, and which rows
 * show. null parts are not read yet, or not there on this server.
 */
class AppSettingsState(
    val info: SettingsInfo = SettingsInfo(),
    val version: VersionInfo? = null,
    val setup: SetupInfo? = null,
    val session: JsonObject? = null,
    val update: OwnUpdate? = null,
    /** What a waiting version brings (#303). */
    val notes: List<WhatsNew.Entry> = emptyList(),
    val usage: UsageState = UsageState(),
    val address: String = "",
    val savedAt: Int = 0,
    val error: String? = null,
) {
    private val features: List<String>? get() = version?.features
    /** Advanced (ADR 205): without it, the models are left out and Usage shows no tokens. */
    val advanced: Boolean get() = Advanced.shows(features, info.settings)
    val models: List<Option> get() = AppSettingsRules.models(info)
    val efforts: List<Option> get() = AppSettingsRules.efforts(info)
    val showsEffort: Boolean get() = advanced && info.canThink(info.settings.defaultModel)
    /** The interface's language (#645), from a server that keeps it. */
    val showsLanguage: Boolean get() = features?.contains(I18n.FEATURE) == true
    val languages: List<Option> get() = I18n.choices.map { Option(it.first, it.second) }
    val language: String get() = I18n.language
    /** Claude's row: what bots run on; null until the setup is read. */
    val claude: String? get() = setup?.claude?.let(::claudeValue)
    /** "Subscription" (ADR 234): a managed machine's billing page, opened in the browser; null: no row. */
    val subscription: String? get() = Subscription.page(features, session)
    /** The Advanced switch, from a server that has it. */
    val showsAdvanced: Boolean get() = features?.contains(Advanced.FEATURE) == true
    /** Usage (#301), from a server that counts it. */
    val showsUsage: Boolean get() = Usage.shows(features)
    /** The timeframes the iPhone offers: a custom one is Android's and the web page's. */
    val presets: List<Usage.Preset> get() = listOf(Usage.Preset.TODAY, Usage.Preset.WEEK, Usage.Preset.MONTH)
    val usageRows: List<Usage.Row> get() = usage.answer?.let { Usage.rows(it, advanced) }.orEmpty()
    val usageRange: String? get() = usage.answer?.let(Usage::range)
    val usageNone: String? get() = usage.answer?.takeIf { it.bots.isEmpty() }?.let { Usage.none(advanced) }
    /** Updates (ADR 053): its value, and its words while a version waits or moves. */
    val updateValue: String? get() = update?.value
    val updateText: String? get() = update?.text()?.takeIf { it.isNotEmpty() }
    /** What's new in the version that waits, under Updates. */
    val updateNotes: List<WhatsNew.Entry> get() = if (update?.ready == true) notes else emptyList()

    internal fun copy(
        info: SettingsInfo = this.info, version: VersionInfo? = this.version, setup: SetupInfo? = this.setup, session: JsonObject? = this.session,
        update: OwnUpdate? = this.update, notes: List<WhatsNew.Entry> = this.notes, usage: UsageState = this.usage, savedAt: Int = this.savedAt,
        error: String? = this.error,
    ) = AppSettingsState(info, version, setup, session, update, notes, usage, address, savedAt, error)
}

/**
 * The app's Settings on the iPhone (#1370), with Android's rules: everything read at once, each pick saved as it is
 * made (one that does not save goes back to what was, and says why), and "Saved" a moment after each.
 */
class AppSettingsDesk(private val api: Api, private val store: Store) {
    private val _state = MutableStateFlow(AppSettingsState(address = AppSettingsRules.address(api.baseUrl)))
    val state: StateFlow<AppSettingsState> = _state.asStateFlow()

    private fun said(e: Exception, otherwise: String) { _state.value = _state.value.copy(error = e.message ?: otherwise) }
    private fun saved() { _state.value = _state.value.copy(savedAt = _state.value.savedAt + 1, error = null) }

    /** Everything Settings shows, at once: over Tailscale one after another would take a round trip each. */
    suspend fun load() {
        coroutineScope {
            launch {
                try {
                    val info = api.settings()
                    _state.value = _state.value.copy(info = info)
                    Advanced.take(_state.value.version?.features, info.settings)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    said(e, tr("Couldn't load"))
                }
            }
            launch { runCatching { api.setup() }.onSuccess { _state.value = _state.value.copy(setup = it) } }
            launch {
                val version = runCatching { api.version() }.getOrNull()
                if (version != null) {
                    store.version.set(version)
                    _state.value = _state.value.copy(version = version)
                    Advanced.take(version.features, _state.value.info.settings)
                }
                // Updates and the Subscription: only where the front door says so (ADR 053, ADR 234).
                val session = runCatching { api.frontDoorSession() }.getOrNull()
                val update = if (OwnUpdate.on(version?.features, session)) runCatching { api.ownUpdate() }.getOrNull() else null
                // An older front door has no such route: no notes.
                val notes = if (update?.ready == true) runCatching { api.updateNotes() }.getOrDefault(emptyList()) else emptyList()
                _state.value = _state.value.copy(session = session, update = update, notes = notes)
                if (Usage.shows(version?.features)) firstUsage()
            }
        }
    }

    private suspend fun save(next: AppSettings) {
        try {
            val info = api.saveSettings(next)
            _state.value = _state.value.copy(info = info)
            Advanced.take(_state.value.version?.features, info.settings)
            saved()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            said(e, tr("Couldn't save"))
        }
    }

    /** The account's default model, saved as it is picked. */
    suspend fun setModel(id: String) = save(_state.value.info.settings.copy(defaultModel = id))

    /** The account's default reasoning, saved as it is picked. */
    suspend fun setEffort(id: String) = save(_state.value.info.settings.copy(defaultEffort = id))

    /** Advanced (ADR 205): saved by itself; every screen follows at once. */
    suspend fun setAdvanced(on: Boolean) = save(AppSettings(advanced = on))

    /** The interface's language (#645): saved, and every word drawn again in it. */
    suspend fun setLanguage(to: String) {
        if (to == I18n.language) return
        try {
            api.setLanguage(to)
            I18n.sync(api, _state.value.version?.features)
            saved()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            said(e, tr("Couldn't save"))
        }
    }

    /** "Update automatically" (ADR 053). */
    suspend fun setAutoUpdate(on: Boolean) {
        try {
            _state.value = _state.value.copy(update = api.setAutoUpdate(on))
            saved()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            said(e, tr("Couldn't change it"))
        }
    }

    /** "When" (ADR 271): `ready`, `night` or `manual`. */
    suspend fun setUpdateWhen(updateWhen: String) {
        try {
            _state.value = _state.value.copy(update = api.setUpdateWhen(updateWhen))
            saved()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            said(e, tr("Couldn't change it"))
        }
    }

    // The first answer says the account's today; the 7 days are counted from it.
    private suspend fun firstUsage() {
        try {
            val first = api.usage()
            val r = Usage.rangeOf(Usage.Preset.WEEK, first.today)
            if (r == null) _state.value = _state.value.copy(usage = UsageState(Usage.Preset.WEEK, first)) else usage(Usage.Preset.WEEK, r)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.value = _state.value.copy(usage = UsageState(error = e.message ?: tr("Couldn't load the usage")))
        }
    }

    private suspend fun usage(preset: Usage.Preset, range: Pair<String, String>) {
        try {
            val a = api.usage(range.first, range.second)
            _state.value = _state.value.copy(usage = UsageState(preset, a))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.value = _state.value.copy(usage = UsageState(preset, _state.value.usage.answer, e.message ?: tr("Couldn't load the usage")))
        }
    }

    /** Another timeframe of Usage: its days counted from the account's today. */
    suspend fun pickUsage(preset: Usage.Preset) {
        val today = _state.value.usage.answer?.today ?: return
        val r = Usage.rangeOf(preset, today) ?: return
        usage(preset, r)
    }
}
