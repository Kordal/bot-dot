package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The colours a bot can have (= COLORS in lib/bots.js). The Chief is coral, like the logo's dot. */
val BotColors: List<Pair<String, String>> get() = listOf(
    "#1d9e75" to tr("Teal"), "#378add" to tr("Blue"), "#7f77dd" to tr("Purple"), "#d4537e" to tr("Pink"),
    "#e24b4a" to tr("Red"), "#ef9f27" to tr("Amber"), "#639922" to tr("Green"), "#888780" to tr("Grey"),
)

/** The name of an outfit's icon, or "" when it has none. */
fun iconOf(outfit: JsonElement?): String = (((outfit as? JsonObject)?.get("icon") as? JsonPrimitive)?.takeIf { it.isString }?.content).orEmpty()

/** The outfit with [icon] on it (none: as it is), for drawing what a pick will look like. */
fun withIcon(outfit: JsonElement?, icon: String): JsonElement? =
    if (icon.isEmpty()) outfit else JsonObject(((outfit as? JsonObject) ?: JsonObject(emptyMap())) + ("icon" to JsonPrimitive(icon)))

/** One choice of a picker: its wire value and its words. */
data class Option(val id: String, val label: String)

/**
 * A bot's settings as they are being edited: they start as the bot's own ([BotSettings.draft]), and what differs from
 * the bot as botdot has it is what a save sends ([BotSettings.changes]). The Android screen and the iPhone's alike.
 */
data class BotDraft(
    val color: String = "",
    /** Its icon (ADR 169): "" until it has one. */
    val icon: String = "",
    val name: String = "",
    val description: String = "",
    val group: String = "",
    val pinned: Boolean = false,
    val task: String = "",
    val model: String = "",
    val effort: String = "",
    val computer: Boolean = false,
    /** Where its computer is: this machine, or boat.dev (ADR 088). */
    val computerOn: String = "linux",
    /** "Copy files" for its new computer (#556). */
    val moveFiles: Boolean = false,
    /** Its proxy (ADR 171): "" the account's, "none", or one by id. */
    val proxy: String = "",
    val useSkills: Boolean = true,
    val skills: Set<String> = emptySet(),
    val disabled: Set<String> = emptySet(),
    val connectors: Set<String> = emptySet(),
    /** Its account of an app with two or more (ADR 174). */
    val accounts: Map<String, String> = emptyMap(),
    /** A server from before ADR 192 only. */
    val mayMessage: Set<String> = emptySet(),
    val othersMayAsk: Boolean = true,
    /** Shared rooms (#316), when the server keeps them. */
    val rooms: BotRooms = BotRooms(),
    val hotkey: Int = 0,
) {
    // One field changed, for Swift, which sees no default arguments of copy.
    fun withColor(color: String) = copy(color = color)
    fun withIconNamed(icon: String) = copy(icon = icon)
    fun withName(name: String) = copy(name = name)
    fun withDescription(description: String) = copy(description = description)
    fun withGroup(group: String) = copy(group = group)
    fun withPinned(pinned: Boolean) = copy(pinned = pinned)
    fun withTask(task: String) = copy(task = task)
    fun withModel(model: String) = copy(model = model)
    fun withEffort(effort: String) = copy(effort = effort)
    fun withHotkey(hotkey: Int) = copy(hotkey = hotkey)
}

/** The rules of a bot's settings (#636, ADR 205), drawn by Android's BotSettingsScreen and the iPhone's BotSettingsView. */
object BotSettings {
    /** A change is saved by itself this long after the last one (#636). */
    const val SAVE_MS = 800L
    /** The longest name and category a bot has. */
    const val NAME_LONGEST = 60
    const val GROUP_LONGEST = 40

    /** What the settings start as: [b]'s own, its teammates [others] for a server that still limits who it may message. */
    fun draft(b: Bot, others: List<Bot>) = BotDraft(
        color = b.color.orEmpty(), icon = iconOf(b.outfit), name = b.name, description = b.description, group = b.group,
        pinned = b.pinned > 0, task = b.prompt, model = b.model.orEmpty(), effort = b.effort.orEmpty(),
        computer = b.computer == "linux" || b.computer == "boat", computerOn = if (b.computer == "boat") "boat" else "linux",
        proxy = b.proxy, useSkills = b.useSkills, skills = b.skills.toSet(), disabled = b.disabledSkills.toSet(),
        connectors = b.connectors.toSet(), accounts = b.accounts,
        mayMessage = if (b.mayMessageAll) others.map { it.id }.toSet() else b.mayMessage.toSet(),
        othersMayAsk = b.othersMayAsk != false, rooms = b.rooms ?: BotRooms(), hotkey = b.hotkey ?: 0,
    )

    /** What differs in [d] from [b] as botdot has it: what a save sends. [features]: the server's; [others]: its teammates. */
    fun changes(b: Bot, d: BotDraft, features: Collection<String>?, others: List<Bot>): JsonObject = buildJsonObject {
        if (d.color != b.color.orEmpty()) put("color", d.color)
        if (d.icon.isNotEmpty() && d.icon != iconOf(b.outfit)) put("outfit", buildJsonObject { put("icon", d.icon) }) // its hat stays
        if (d.name != b.name) put("name", d.name)
        if (d.description != b.description) put("description", d.description)
        if (d.group != b.group) put("group", d.group)
        if (d.pinned != (b.pinned > 0)) put("pinned", d.pinned) // pinning puts it last; drag it on the home screen to move it
        if (d.task != b.prompt) put("prompt", d.task)
        if (d.model != b.model.orEmpty()) put("model", d.model)
        if (d.effort != b.effort.orEmpty()) put("effort", d.effort)
        val nextComputer = if (d.computer) d.computerOn else "none"
        if (nextComputer != b.computer) put("computer", nextComputer)
        if (nextComputer != b.computer && d.moveFiles) put("moveFiles", true)
        if (d.proxy != b.proxy) put("proxy", d.proxy)
        if (d.useSkills != b.useSkills) put("useSkills", d.useSkills)
        if (d.skills != b.skills.toSet()) put("skills", JsonArray(d.skills.map { JsonPrimitive(it) }))
        if (d.disabled != b.disabledSkills.toSet()) put("disabledSkills", JsonArray(d.disabled.map { JsonPrimitive(it) }))
        if (d.connectors != b.connectors.toSet()) put("connectors", JsonArray(d.connectors.map { JsonPrimitive(it) }))
        if (d.accounts != b.accounts) put("accounts", JsonObject(d.accounts.mapValues { JsonPrimitive(it.value) }))
        // Every bot may message every other since ADR 192: only a server from before limits it.
        if ("everything-allowed" !in features.orEmpty()) {
            val everyone = others.all { it.id in d.mayMessage }
            if (everyone != b.mayMessageAll) put("mayMessageAll", everyone)
            if (!everyone && (b.mayMessageAll || d.mayMessage != b.mayMessage.toSet())) put("mayMessage", JsonArray(d.mayMessage.map { JsonPrimitive(it) }))
            if (b.othersMayAsk != null && d.othersMayAsk != b.othersMayAsk) put("othersMayAsk", d.othersMayAsk)
        }
        b.rooms?.let { was -> BotRooms.change(was, d.rooms)?.let { put("rooms", it) } }
        if (b.hotkey != null && d.hotkey != b.hotkey) put("hotkey", d.hotkey)
    }

    /** Whether [model] of [models] takes a reasoning effort: one botdot does not list does. */
    fun canThink(models: List<ModelChoice>, model: String): Boolean = models.firstOrNull { it.id == model }?.effort ?: true

    /** The choices of a bot's Model, its own default first. */
    fun models(info: SettingsInfo): List<Option> = listOf(Option("", tr("Default"))) + info.models.map { Option(it.id, it.label.ifBlank { it.id }) }

    /** The choices of a bot's Reasoning, its own default first. */
    fun efforts(info: SettingsInfo): List<Option> = listOf(Option("", tr("Default"))) + info.efforts.map { Option(it.id, it.label) }

    /** The choices of its key on the keypad (#366): by its place, or a digit, saying which bot holds it now. */
    fun hotkeys(others: List<Bot>): List<Option> = listOf(Option("0", tr("By its place"))) +
        (1..9).map { d -> Option("$d", others.firstOrNull { it.hotkey == d }?.let { "$d · " + tr("Now {name}'s", "name" to it.name) } ?: "$d") }
}

/**
 * A bot's settings at one moment, as the iPhone draws them: [bot] as botdot has it (null until it is read), [draft] as
 * it is edited, the pickers' choices, and what happened. [advanced]: the account's Advanced (ADR 205) is on, so its
 * Model shows.
 */
class BotSettingsState(
    val bot: Bot? = null,
    val draft: BotDraft = BotDraft(),
    val others: List<Bot> = emptyList(),
    val info: SettingsInfo = SettingsInfo(),
    val advanced: Boolean = false,
    val saving: Boolean = false,
    /** Counts the saves that went through: "Saved" shows a moment after each. */
    val savedAt: Int = 0,
    val error: String? = null,
    /** It was deleted: the screen leaves. */
    val deleted: Boolean = false,
) {
    val models: List<Option> get() = BotSettings.models(info)
    val efforts: List<Option> get() = BotSettings.efforts(info)
    val hotkeys: List<Option> get() = BotSettings.hotkeys(others)
    /** Its Reasoning shows with Advanced on, for a model that takes one. */
    val showsEffort: Boolean get() = advanced && BotSettings.canThink(info.models, draft.model)
    /** Its key on the keypad shows only from a server that has hotkeys. */
    val showsHotkey: Boolean get() = bot?.hotkey != null

    internal fun copy(
        bot: Bot? = this.bot, draft: BotDraft = this.draft, others: List<Bot> = this.others, info: SettingsInfo = this.info,
        advanced: Boolean = this.advanced, saving: Boolean = this.saving, savedAt: Int = this.savedAt, error: String? = this.error,
        deleted: Boolean = this.deleted,
    ) = BotSettingsState(bot, draft, others, info, advanced, saving, savedAt, error, deleted)
}

/**
 * A bot's settings on the iPhone (#1370), with Android's rules: read from [store] (or botdot), each change saved by
 * itself [BotSettings.SAVE_MS] after the last one, changed again while it saved: what is typed stays and the next save
 * sends it; else botdot's answer is shown as it keeps it. A change botdot refused is said once and not sent again until
 * it is changed.
 */
class BotSettingsDesk(private val api: Api, val botId: String, private val store: Store, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(BotSettingsState())
    val state: StateFlow<BotSettingsState> = _state.asStateFlow()
    private var refused: JsonObject? = null
    private var waiting: Job? = null

    private val features: List<String>? get() = store.version.value.value?.features

    /** Reads the bot, its teammates and the account's models, all at once (one round trip each over Tailscale). */
    suspend fun load() {
        coroutineScope {
            launch {
                try {
                    val all = store.bots.value.value ?: api.bots()
                    val others = all.filter { it.id != botId }
                    val b = all.firstOrNull { it.id == botId }
                    _state.value = _state.value.copy(others = others, bot = b, draft = b?.let { BotSettings.draft(it, others) } ?: _state.value.draft,
                        error = if (b == null) tr("Couldn't load") else null)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.value = _state.value.copy(error = e.message ?: tr("Couldn't load"))
                }
            }
            launch {
                val version = store.version.value.value ?: runCatching { api.version() }.getOrNull()?.also { store.version.set(it) }
                runCatching { api.settings() }.onSuccess { info ->
                    Advanced.take(version?.features, info.settings)
                    _state.value = _state.value.copy(info = info, advanced = Advanced.on.value)
                }
            }
        }
    }

    /**
     * What the owner changed, applied to the settings as they are now (two changes in one moment both stay): kept, and
     * saved by itself a moment after the last change. Nothing before the bot is read.
     */
    fun edit(change: (BotDraft) -> BotDraft) {
        if (_state.value.bot == null) return
        val draft = change(_state.value.draft)
        val d = draft.copy(name = draft.name.take(BotSettings.NAME_LONGEST), group = draft.group.take(BotSettings.GROUP_LONGEST))
        _state.value = _state.value.copy(draft = d, error = null)
        later()
    }

    private fun later() {
        waiting?.cancel()
        val s = _state.value
        val b = s.bot ?: return
        val now = BotSettings.changes(b, s.draft, features, s.others)
        if (s.saving || s.draft.name.isBlank() || now.isEmpty() || now == refused) return
        waiting = scope.launch {
            delay(BotSettings.SAVE_MS)
            scope.launch { save() } // a change made while it saves waits for it, and does not end it
        }
    }

    private suspend fun save() {
        val s = _state.value
        val b = s.bot ?: return
        val sent = BotSettings.changes(b, s.draft, features, s.others)
        if (sent.isEmpty() || s.saving) return
        _state.value = s.copy(saving = true)
        try {
            val saved = api.updateBot(botId, sent)
            val now = _state.value
            _state.value = if (BotSettings.changes(b, now.draft, features, now.others) == sent) {
                now.copy(bot = saved, draft = BotSettings.draft(saved, now.others), saving = false, savedAt = now.savedAt + 1)
            } else {
                now.copy(bot = saved, draft = now.draft.copy(moveFiles = false), saving = false, savedAt = now.savedAt + 1)
            }
            store.bots.refresh()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            refused = sent
            _state.value = _state.value.copy(saving = false, error = e.message ?: tr("Couldn't save"))
        }
        later()
    }

    /** "Delete {name}", once the owner said yes: its settings and jobs go; the screen leaves. A refusal throws its sentence. */
    suspend fun delete() {
        api.deleteBot(botId)
        _state.value = _state.value.copy(deleted = true)
        store.bots.refresh()
    }

    /** What the Delete question says: its screen and logins on the account's computer go too, where it has one (#109). */
    fun deleteText(): String = if (_state.value.bot?.computer == "linux") {
        tr("Its settings and jobs go, and so do the skills it wrote itself, and its screen and its browser's logins on the account's computer. Its folder {folder} there stays, and so does the computer, which the other bots use. Its past runs stay.", "folder" to "/workspace/$botId")
    } else {
        tr("Its settings and jobs go, and so do the skills it wrote itself. Its past runs stay.")
    }
}
