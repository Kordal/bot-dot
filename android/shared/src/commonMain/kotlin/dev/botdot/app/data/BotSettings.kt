package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
    /** Its place of its own (ADR 261): "" follows the account's, else "linux" or "boat". */
    val computerPlace: String = "",
    /** Its machine of its own on the External Virtual PC (ADR 263); false: the account's one. */
    val boatOwnMachine: Boolean = false,
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
    fun withComputer(on: Boolean) = copy(computer = on)
    fun withUseSkills(on: Boolean) = copy(useSkills = on)
    /** One skill of the library given to it, or taken back. */
    fun withSkill(name: String, on: Boolean) = copy(skills = if (on) skills + name else skills - name)
    /** Where its computer is now ("none", "linux", "boat"), its files copied along ([move]) or not. */
    fun withComputerOn(to: String, move: Boolean) = copy(computer = to != "none", computerOn = if (to != "none") to else computerOn, moveFiles = move)
    /** Its place of its own ([BotSettings.placeChoices]), its files copied along ([move]) or not. */
    fun withComputerPlace(place: String, move: Boolean) = copy(computerPlace = place, moveFiles = move)
    /** Its machine of its own ([BotSettings.ownMachineChoices]), its files copied along ([move]) or not. */
    fun withOwnMachine(own: Boolean, move: Boolean) = copy(boatOwnMachine = own, moveFiles = move)
    fun withProxy(proxy: String) = copy(proxy = proxy)
    fun withApp(c: Connection, on: Boolean) = BotSettings.appToggled(c, on, connectors, accounts).let { (k, a) -> copy(connectors = k, accounts = a) }
    fun withOthersMayAsk(on: Boolean) = copy(othersMayAsk = on)
    /** May be in shared rooms (#316). */
    fun withAllowRooms(on: Boolean) = copy(rooms = rooms.copy(allowRooms = on))
    /** Who may mention it there: [BotRooms.OWNER] or [BotRooms.MEMBERS]. */
    fun withWhoMayMention(who: String) = copy(rooms = rooms.copy(whoMayMention = who))

    companion object {
        /** A draft with nothing in it, for Swift, which sees no default arguments. */
        fun empty() = BotDraft()
    }
}

/** The rules of a bot's settings (#636, ADR 205), drawn by Android's BotSettingsScreen and the iPhone's BotSettingsView. */
object BotSettings {
    /** The apps a bot can be given (Apps): each connected app once, its live connection, and one row per account of an app with two or more (ADR 174). */
    fun appChoices(all: List<Connection>): List<Connection> =
        all.filter { c -> c.status == "ACTIVE" || all.none { x -> x.toolkit == c.toolkit && x.status == "ACTIVE" } }.distinctBy { c -> if (c.accounts > 1) c.id else c.toolkit }

    /** Whether the bot [botId] has app [c]: its app, and for an app with two or more accounts, this account. */
    fun appPicked(c: Connection, connectors: Set<String>, accounts: Map<String, String>, botId: String?): Boolean =
        c.toolkit in connectors && (c.accounts < 2 || accounts[c.toolkit]?.let { it == c.id } ?: (botId in c.usedBy))

    /** An app's row: its name, and which account for an app with two or more. */
    fun appName(c: Connection): String = (c.app?.name ?: c.toolkit) + if (c.accounts > 1) " · " + (c.label ?: c.id) else ""

    /** An app ticked ([on]) or not: its toolkit, and the account for an app with two or more. */
    fun appToggled(c: Connection, on: Boolean, connectors: Set<String>, accounts: Map<String, String>): Pair<Set<String>, Map<String, String>> =
        (if (on) connectors + c.toolkit else connectors - c.toolkit) to (if (on && c.accounts > 1) accounts + (c.toolkit to c.id) else accounts - c.toolkit)

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
        computerPlace = b.computerPlace, boatOwnMachine = b.boatOwnMachine, proxy = b.proxy, useSkills = b.useSkills, skills = b.skills.toSet(), disabled = b.disabledSkills.toSet(),
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
        val placeChanged = d.computerPlace != b.computerPlace
        if (placeChanged) put("computerPlace", d.computerPlace) // the server decides where it works then, and copies its files if asked
        val ownChanged = d.boatOwnMachine != b.boatOwnMachine
        if (ownChanged) put("boatOwnMachine", d.boatOwnMachine) // the owner's own change is saved at once; the Chief's waits for a card
        if ((nextComputer != b.computer || placeChanged || ownChanged) && d.moveFiles) put("moveFiles", true)
        if (d.proxy != b.proxy) put("proxy", d.proxy)
        if (d.useSkills != b.useSkills) put("useSkills", d.useSkills)
        if (d.skills != b.skills.toSet()) put("skills", JsonArray(d.skills.map { JsonPrimitive(it) }))
        if (d.disabled != b.disabledSkills.toSet()) put("disabledSkills", JsonArray(d.disabled.map { JsonPrimitive(it) }))
        if (d.connectors != b.connectors.toSet()) put("connectors", JsonArray(d.connectors.map { JsonPrimitive(it) }))
        if (d.accounts != b.accounts) put("accounts", JsonObject(d.accounts.mapValues { JsonPrimitive(it.value) }))
        // Every bot may message every other since ADR 192: only a server from before limits it.
        if (limits(features)) {
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
    fun efforts(info: SettingsInfo, model: String = info.settings.defaultModel): List<Option> =
        listOf(Option("", tr("Default"))) + info.availableEfforts(model).map { Option(it.id, it.label) }

    /** A server from before every bot may message every other (ADR 192): it still limits who may. */
    fun limits(features: Collection<String>?): Boolean = "everything-allowed" !in features.orEmpty()

    /**
     * "Browser", whether it has a computer: a server from before every bot has one; on one since, it shows not. While
     * the server's features are not known, neither: a current server would show a row it has no use for.
     */
    fun showsBrowser(features: Collection<String>?): Boolean = features != null && limits(features)

    /** "Other bots may ask it": a server known to limit it that says so, and another bot to ask it. */
    fun showsOthersMayAsk(b: Bot, others: List<Bot>, features: Collection<String>?): Boolean =
        features != null && limits(features) && others.isNotEmpty() && b.othersMayAsk != null

    /** Its shared-room settings: a server that keeps them (`room-settings`) and has them for this bot. */
    fun showsRooms(b: Bot, features: Collection<String>?): Boolean = BotRooms.shows(features) && b.rooms != null

    /**
     * Whether the server lets every bot be in shared rooms (`rooms-every-bot`, ADR 269): then there is no "May be in
     * shared rooms" switch and no hint to switch it on. A server without it, or whose features are not known yet, still
     * keeps the switch per bot, so the app draws it as before.
     */
    fun everyBotInRooms(features: Collection<String>?): Boolean = features != null && "rooms-every-bot" in features

    /** Undo last change (#596): the card's change [change] undone on botdot, and the bot as it is now. */
    @Throws(Exception::class)
    suspend fun undo(api: Api, botId: String, change: String): Bot { api.undoChange(botId, change); return api.bot(botId) }

    /**
     * Where its computer is (ADR 088), with Advanced on: None (unless every bot has one, ADR 192), this machine or the
     * External Virtual PC; null where the account chooses it in Settings (account-computer, #579), on a botdot
     * without boat.dev, or with Advanced off.
     */
    fun computerChoices(advanced: Boolean, features: Collection<String>?, boat: Boolean, b: Bot): List<Option>? {
        val f = features.orEmpty()
        if (!advanced || "account-computer" in f || "boat-computer" !in f || !(boat || b.computer == "boat")) return null
        return (if (limits(features)) listOf(Option("none", tr("None"))) else emptyList()) +
            listOf(Option("linux", tr("This machine")), Option("boat", tr("External Virtual PC")))
    }

    /**
     * Its place of its own (ADR 261, `bot-computer-place`), with Advanced on: the account's, this machine or the
     * External Virtual PC. Offered where boat.dev has a key, and for a bot that is there already, so it can come back;
     * null otherwise. [account]: where the account has its computer, when known.
     */
    fun placeChoices(advanced: Boolean, features: Collection<String>?, boat: Boolean, b: Bot, account: String? = null): List<Option>? {
        if (!advanced || "bot-computer-place" !in features.orEmpty() || !(boat || b.computerPlace == "boat")) return null
        val where = ComputerPlace.options.toMap()
        val own = account?.let { where[it] }?.let { tr("Account's ({name})", "name" to it) } ?: tr("Account's choice")
        return listOf(Option("", own)) + ComputerPlace.options.map { Option(it.first, it.second) }
    }

    /**
     * Its machine on the External Virtual PC (ADR 263, `bot-own-machine`), with Advanced on: shared with the account's bots (the
     * default) or one of its own. Only for a bot that works there and while the account pays with its own boat.dev key
     * ([ownKey], from [ComputerPlace.ownKey]), or for a bot that has one already, so it can come back; null otherwise.
     */
    fun ownMachineChoices(advanced: Boolean, features: Collection<String>?, ownKey: Boolean, b: Bot): List<Option>? {
        if (!advanced || "bot-own-machine" !in features.orEmpty() || b.computer != "boat" || !(ownKey || b.boatOwnMachine)) return null
        return listOf(Option("", tr("Shared with the account's bots")), Option("own", tr("Its own machine")))
    }

    /** The question before its machine changes, and its two answers: its files are asked about as a move of its computer's. */
    fun ownMachineQuestion(own: Boolean): String = if (own) tr("Copy its files to its own machine?") else tr("Copy its files to the account's machine?")

    /** The computer's pick as it stands: where it is, or "none". */
    fun computerValue(d: BotDraft): String = if (d.computer) d.computerOn else "none"

    /** Between this machine and boat.dev its files go along or not: asked first (#556, computer-move). */
    fun asksMove(features: Collection<String>?, b: Bot, to: String): Boolean =
        "computer-move" in features.orEmpty() && to != b.computer && to != "none" && b.computer != "none"

    /** The question before a move, and its two answers. */
    fun moveQuestion(to: String): String = if (to == "boat") tr("Copy its files to the External Virtual PC?") else tr("Copy its files to this machine?")

    /**
     * Its proxy (ADR 171), with Advanced on: on the account's computer only (boat.dev's browser uses the account's);
     * the account's, none, or one of the account's proxies. Null: no row.
     */
    fun proxyChoices(advanced: Boolean, features: List<String>?, b: Bot, list: ProxyList?): List<Option>? {
        if (!advanced || b.computer != "linux" || !Proxies.shows(features) || list == null) return null
        if (list.proxies.isEmpty() && b.proxy.isEmpty()) return null
        val account = list.proxies.firstOrNull { it.id == list.default }?.name ?: tr("No proxy")
        return listOf(Option("", tr("Account's ({name})", "name" to account)), Option("none", tr("No proxy"))) + list.proxies.map { Option(it.id, it.name) }
    }

    /** Its jobs you said to always approve (#474): their later changes need no OK. */
    fun trusted(b: Bot): List<dev.botdot.app.data.Job> = b.jobs.filter { it.alwaysApprove }

    /** Under a job always approved: when it runs, and whether it uses AI. */
    fun trustedLine(j: dev.botdot.app.data.Job): String = "${scheduleWords(j)} · " + if (j.kind == "script") tr("a script, no AI") else tr("uses AI")

    /** A lasting grant in a connected app, in words: its label, else its action. */
    fun grantName(g: AlwaysAllowed): String = g.label.ifBlank { g.action }

    /** The "Always approved" summary: the jobs and the grants by name. */
    fun alwaysLine(b: Bot): String = (trusted(b).map { it.name } + b.alwaysAllowed.map(::grantName)).joinToString(", ")

    /** Under a rule lifted for it ("Allow always for this bot", #253): the rule. */
    fun overrideLine(o: BotOverride): String = tr("Its rule: {rule}", "rule" to o.rule)

    val JOB_REVOKED: String get() = tr("Revoked: its next change waits for your OK")
    val REVOKED: String get() = tr("Revoked: it asks you again")

    /** What botdot did for a Revoke: [step] makes the bot as it is when botdot answered say so, and what to [say]. */
    class Revoked(val step: (Bot) -> Bot, val say: String)

    /** Revoke a job always approved: its next change waits for the owner's OK. A refusal throws botdot's sentence. */
    @Throws(Exception::class)
    suspend fun revokeJob(api: Api, botId: String, jobId: String): Revoked {
        val saved = api.setJobAlwaysApprove(botId, jobId, false)
        return Revoked({ b -> b.copy(jobs = b.jobs.map { if (it.id == saved.id) it.copy(alwaysApprove = false) else it }) }, JOB_REVOKED)
    }

    /** Revoke a lasting grant in a connected app: it asks again. Every grant of that action goes, whatever its label. */
    @Throws(Exception::class)
    suspend fun revokeGrant(api: Api, botId: String, action: String): Revoked {
        api.revokeAlwaysAllowed(botId, action)
        return Revoked({ b -> b.copy(alwaysAllowed = b.alwaysAllowed.filter { it.action != action }) }, REVOKED)
    }

    /** Revoke a rule lifted for it: it asks again; the rules left are botdot's. */
    @Throws(Exception::class)
    suspend fun revokeOverride(api: Api, botId: String, id: String): Revoked {
        val left = api.revokeOverride(botId, id).overrides
        return Revoked({ b -> b.copy(overrides = left) }, REVOKED)
    }

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
    /** The skill library's skills, one switch each while its skills are on. */
    val library: List<String> = emptyList(),
    /** The server's features; null until they are known. */
    val features: List<String>? = null,
    val error: String? = null,
    /** It was deleted: the screen leaves. */
    val deleted: Boolean = false,
    /** Its apps to pick from ([BotSettings.appChoices]); empty from a botdot without connected apps. */
    val apps: List<Connection> = emptyList(),
    /** Its pages (#346), from a botdot with pages; null: no section. */
    val pages: List<PageInfo>? = null,
    /** The botdot has boat.dev (the admin set its key), and the account's proxies when read. */
    val boat: Boolean = false,
    val proxyList: ProxyList? = null,
    /** The account pays for boat.dev with its own key (ADR 263, [ComputerPlace.ownKey]). */
    val ownKey: Boolean = false,
) {
    /** Computer and proxy pickers ([BotSettings.computerChoices], [BotSettings.proxyChoices]); null: no row. */
    val computers: List<Option>? get() = bot?.let { BotSettings.computerChoices(advanced, features, boat, it) }
    val computerValue: String get() = BotSettings.computerValue(draft)
    fun asksMove(to: String): Boolean = bot?.let { BotSettings.asksMove(features, it, to) } == true
    fun moveQuestion(to: String): String = BotSettings.moveQuestion(to)
    /** Its machine on the External Virtual PC ([BotSettings.ownMachineChoices]); null: no row. */
    val ownMachines: List<Option>? get() = bot?.let { BotSettings.ownMachineChoices(advanced, features, ownKey, it) }
    val proxies: List<Option>? get() = bot?.let { BotSettings.proxyChoices(advanced, features, it, proxyList) }
    /** Whether it has app [c] as the draft stands. */
    fun hasApp(c: Connection): Boolean = BotSettings.appPicked(c, draft.connectors, draft.accounts, bot?.id)
    fun appName(c: Connection): String = BotSettings.appName(c)
    /** The Apps section's summary: the apps it has, or None. */
    val appsLine: String get() = apps.filter(::hasApp).joinToString(", ", transform = BotSettings::appName).ifBlank { tr("None") }
    /** A page's line ([Pages.line]). */
    fun pageLine(page: PageInfo): String = Pages.line(page)
    /** Always approved: its jobs and its grants in connected apps; and the rules lifted for it. */
    val trusted: List<dev.botdot.app.data.Job> get() = bot?.let(BotSettings::trusted).orEmpty()
    val grants: List<AlwaysAllowed> get() = bot?.alwaysAllowed.orEmpty()
    val overrides: List<BotOverride> get() = bot?.overrides.orEmpty()
    fun trustedLine(j: dev.botdot.app.data.Job): String = BotSettings.trustedLine(j)
    fun grantName(g: AlwaysAllowed): String = BotSettings.grantName(g)
    fun overrideLine(o: BotOverride): String = BotSettings.overrideLine(o)

    val models: List<Option> get() = BotSettings.models(info)
    val efforts: List<Option> get() = BotSettings.efforts(info)
    val hotkeys: List<Option> get() = BotSettings.hotkeys(others)
    /** Its Reasoning shows with Advanced on, for a model that takes one. */
    val showsEffort: Boolean get() = advanced && BotSettings.canThink(info.models, draft.model)
    /** Its key on the keypad shows only from a server that has hotkeys. */
    val showsHotkey: Boolean get() = bot?.hotkey != null
    /** "Other bots may ask it": a server from before every bot may message every other (ADR 192) that says so. */
    val showsOthersMayAsk: Boolean get() = bot?.let { BotSettings.showsOthersMayAsk(it, others, features) } == true
    /** Its "Browser" switch: a server from before every bot has a computer. */
    val showsBrowser: Boolean get() = BotSettings.showsBrowser(features)
    /** Its shared-room settings, from a server that keeps them (`room-settings`). */
    val showsRooms: Boolean get() = bot?.let { BotSettings.showsRooms(it, features) } == true
    /** Every bot is in shared rooms (ADR 269): no "May be in shared rooms" switch. */
    val everyBotInRooms: Boolean get() = BotSettings.everyBotInRooms(features)
    /** Who may mention it in a room: the owner, or anyone in it. */
    val whoMayMention: List<Option> get() = BotRooms.WHO.map { (id, label) -> Option(id, label) }
    /** Undo last change: a change a card made to its assignment or rules that one tap undoes (#596). */
    val undoes: Boolean get() = bot?.undo != null

    internal fun copy(
        bot: Bot? = this.bot, draft: BotDraft = this.draft, others: List<Bot> = this.others, info: SettingsInfo = this.info,
        advanced: Boolean = this.advanced, saving: Boolean = this.saving, savedAt: Int = this.savedAt, error: String? = this.error,
        deleted: Boolean = this.deleted, library: List<String> = this.library, features: List<String>? = this.features,
        apps: List<Connection> = this.apps, pages: List<PageInfo>? = this.pages, boat: Boolean = this.boat, proxyList: ProxyList? = this.proxyList,
    ) = BotSettingsState(bot, draft, others, info, advanced, saving, savedAt, library, features, error, deleted, apps, pages, boat, proxyList)
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
                version?.let { _state.value = _state.value.copy(features = it.features, boat = it.boat) }
                if (Proxies.shows(version?.features)) runCatching { api.proxies() }.onSuccess { _state.value = _state.value.copy(proxyList = it) }
                runCatching { api.settings() }.onSuccess { info ->
                    Advanced.take(version?.features, info.settings)
                    _state.value = _state.value.copy(info = info, advanced = Advanced.on.value)
                }
            }
            launch {
                // The library, for the skills it may use: as the store has it, else read once.
                val skills = store.skills.value.value ?: try { store.skills.refresh(); store.skills.value.value } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                _state.value = _state.value.copy(library = skills?.library.orEmpty().map { it.name })
            }
            launch { runCatching { api.connectors() }.onSuccess { _state.value = _state.value.copy(apps = BotSettings.appChoices(it.connections)) } }
            launch {
                val version = store.version.value.value ?: runCatching { api.version() }.getOrNull()
                if (Pages.shows(version?.features)) runCatching { api.pages(botId) }.onSuccess { _state.value = _state.value.copy(pages = it) }
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

    /** Undo last change: the change a card made, undone on botdot; the bot read again. Null once done, else why not. */
    @Throws(Exception::class)
    suspend fun undo(): String? {
        val change = _state.value.bot?.undo ?: return null
        return try {
            val b = BotSettings.undo(api, botId, change)
            _state.value = _state.value.copy(bot = b, draft = BotSettings.draft(b, _state.value.others))
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            e.message ?: tr("Couldn't undo")
        }
    }

    /** Revoke a job always approved: its next change waits for the owner's OK. What to say. */
    @Throws(Exception::class)
    suspend fun revokeJob(jobId: String): String = revoked { BotSettings.revokeJob(api, botId, jobId) }

    /** Revoke a lasting grant in a connected app: it asks again. What to say. */
    @Throws(Exception::class)
    suspend fun revokeGrant(action: String): String = revoked { BotSettings.revokeGrant(api, botId, action) }

    /** Revoke a rule lifted for it: it asks again. What to say. */
    @Throws(Exception::class)
    suspend fun revokeOverride(id: String): String = revoked { BotSettings.revokeOverride(api, botId, id) }

    /** Asks botdot, then applies its answer to the bot as it is by then: a load or a save that landed meanwhile stays. */
    private suspend fun revoked(call: suspend () -> BotSettings.Revoked): String {
        if (_state.value.bot == null) return ""
        return try {
            val r = call()
            _state.update { s -> s.copy(bot = s.bot?.let(r.step)) }
            r.say
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            e.message ?: tr("Couldn't save")
        }
    }

    /** "Delete {name}", once the owner said yes: its settings and jobs go; the screen leaves. A refusal throws its sentence. */
    @Throws(Exception::class)
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
