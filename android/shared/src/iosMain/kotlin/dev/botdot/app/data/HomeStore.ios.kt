package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Everything Home draws, at one moment: the shared [Store]'s parts as they are now. null: not loaded yet. The rows
 * come from [ListLayout] and what each says from [botSub], as on Android.
 */
class HomeState(
    val bots: List<Bot>?,
    val groups: List<Group>?,
    val recent: List<Run>?,
    val dashboard: Dashboard?,
    val version: VersionInfo?,
    val waiting: List<Waiting>,
    val lines: Map<String, String>,
    val error: String?,
    /** The front door asks this phone to sign in to this botdot (ADR 028): Home gives way to the sign-in. */
    val signInNeeded: Boolean = false,
    /** The Chief's row, first on Home as on Android: its name (ChiefName), its new replies, whether it works. */
    val chiefName: String = "",
    val chiefUnread: Int = 0,
    val chiefBusy: Boolean = false,
    /** The categories folded to their heading (Settings.foldedGroups, "" for Other). */
    val folded: Set<String> = emptySet(),
) {
    /** The pinned bots and groups in one order (`pins-shared`). */
    val shared: Boolean get() = hasPinsShared(version?.features)
    /** The rows, in the owner's order: [ListLayout.Rows]; a folded category shows its heading alone. */
    val rows: ListLayout.Rows get() = ListLayout.rows(bots.orEmpty(), groups.orEmpty(), folded, shared)
    /** The category [category] is folded. */
    fun isFolded(category: String): Boolean = category in folded
    /** Folded, one of its bots works: a green dot on its heading, as on Android. */
    fun foldedWorks(category: String): Boolean = category in folded && bots.orEmpty().any { it.pinned == 0 && it.group == category && it.running }
    /** Each bot's last run that said something: its row shows that. */
    private val lastRun: Map<String, Run> by lazy { recent.orEmpty().filterNot { it.quiet }.groupBy { it.botId }.mapValues { it.value.first() } }
    fun bot(id: String): Bot? = bots?.firstOrNull { it.id == id }
    fun group(key: String): Group? = if (ListLayout.isGroup(key)) groups?.firstOrNull { it.id == ListLayout.groupOf(key) } else null
    /** What a bot's row says under its name ([botSub]). */
    fun sub(b: Bot): String = botSub(b, lastRun[b.id], lines["bot:${b.id}"])
    /** Its row reads "Asks: …", with the mark. */
    fun asks(b: Bot): Boolean = botAsks(b, lastRun[b.id]) != null
    /** The bots whose computer screen opens from Home's ⋯ menu ([ComputerScreen.opens]). */
    val screens: List<Bot> get() = bots.orEmpty().filter { ComputerScreen.opens(it) }
    /** The Board's cards under Needs you: null before the Board has loaded ([stripTiles]). */
    val board: List<Tile>? get() = stripTiles(dashboard)
    /** The status keypad (#1370): the list's own order cut into pages ([Keypad.pages]). */
    val keypad: List<Keypad.Page> get() = Keypad.pages(bots.orEmpty(), groups.orEmpty(), shared)
    /** Which key each digit opens ([Keypad.digits]); no page is folded on the iPhone yet. */
    val keypadDigits: Map<Int, Keypad.Key> get() = keypad.let { Keypad.digits(it, Keypad.shownKeys(it, emptySet())) }
    /** The digit on [key]; 0: none. */
    fun digitOf(key: Keypad.Key): Int = Keypad.digitOf(keypadDigits, key)
    /** The bots a card in Needs you waits for: their keys say Needs you (#397). */
    private val waitingBots: Set<String> by lazy { waiting.mapNotNull { it.bot?.takeIf(String::isNotEmpty) }.toSet() }
    /** A key's pill, as Android's keypad says it ([Keypad.botStatus]); a group's without its members' turns, not read here yet. */
    fun status(key: Keypad.Key): Keypad.Status = when (key) {
        is Keypad.Key.OfBot -> Keypad.botStatus(key.bot, lastRun[key.bot.id], key.bot.id in waitingBots)
        is Keypad.Key.OfGroup -> Keypad.groupStatus(key.group)
    }
}

/**
 * What the iPhone app keeps for one signed-in botdot: the shared [Store] on its own coroutine scope, as the Android
 * app keeps it for the whole app. [watch] hands Home a new [HomeState] whenever a part changes, on the main thread;
 * looking loads each part, as on Android. [close] it when the phone leaves that botdot.
 */
class HomeStore(val api: Api) {
    private val scope = MainScope()
    val store = Store(scope, MutableStateFlow(api))
    private val folded = MutableStateFlow<Set<String>>(emptySet())
    private var settings: Settings? = null

    /** The phone's settings, where the folded categories are kept: Home follows them. */
    fun keep(settings: Settings) {
        if (this.settings != null) return
        this.settings = settings
        scope.launch { settings.foldedGroups.collect { folded.value = it } }
    }

    /** A category's heading tapped: folded, or open again (kept on the phone). */
    @Throws(Exception::class)
    suspend fun toggleFolded(category: String) { settings?.toggleFolded(category) }

    /** The live feed (docs/api.md): the Store and an open chat follow it while the app is in front. */
    val feed = Feed(scope, LastEvent())

    /** Where the feed was, while the app runs: it resumes after the last event it saw when the app comes to front. */
    private class LastEvent : Feed.Keep {
        private var server: String? = null
        private var id: String? = null
        override fun server() = server
        override fun lastId() = id
        override fun write(server: String, lastId: String?) { this.server = server; id = lastId }
    }

    init {
        scope.launch { feed.events.collect { store.handle(it) } }
    }

    /**
     * The app came to front ([on]) or went behind: the feed connects, resuming after the last event it saw, or drops
     * its connection. A connection that may be half-open after the phone slept is opened anew.
     */
    fun live(on: Boolean) {
        if (on) { feed.connect(api); feed.reconnect() } else feed.connect(null)
    }

    /** Each chat's plan fold and the stopped plans dismissed (PlanMemory): the app gives one kept on the phone. */
    var plans: PlanMemory = PlanMemory()
    /**
     * Allow or No on a Needs you row that asks for a permission ([Waiting.permission]), as Android's Home: answered on
     * botdot, then what waits read again. Null once it went, else why not.
     */
    @Throws(Exception::class)
    suspend fun answer(permission: String, yes: Boolean): String? {
        val failed = try { api.answerAsk(permission, yes); null } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { e.message ?: tr("Couldn't answer") }
        try { store.needs.refresh() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) {}
        return failed
    }
    /** The "@" of a chat's message box: [chat] a bot's id, or Mentions.CHIEF for the Chief's (MentionBox). */
    fun mentions(chat: String): MentionBox = MentionBox(store, chat)
    /** The scheduled jobs of the bot [botId] (JobsDesk), from the bots as the feed keeps them. */
    fun jobs(botId: String): JobsDesk = JobsDesk(scope, api, store, botId)

    /** Every bot's pages, the Pages list (PagesDesk). */
    fun pages(): PagesDesk = PagesDesk(scope, api, store)
    /** Settings → Storage. */
    fun storage(): StorageDesk = StorageDesk(scope, api)

    /** The chat of the bot [botId], following this botdot's feed. [BotChat.stop] it when it is left. */
    fun chat(botId: String): BotChat = BotChat(scope, api, store, feed.events, botId, plans)

    /** The Chief's chat, following this botdot's feed. [ChiefDesk.stop] it when it is left. */
    fun chief(chatId: String? = null): ChiefDesk = ChiefDesk(scope, api, store, feed.events, chatId, plans)

    /** Home's first reads (FirstRunDesk): the front door's offers, What's new and the Chief's name, in this phone's [zone]. */
    fun firstRun(zone: String): FirstRunDesk = FirstRunDesk(api, scope, zone)

    /** The chat of the group [groupId], following this botdot's feed. [GroupChat.stop] it when it is left. */
    fun groupChat(groupId: String): GroupChat = GroupChat(scope, api, store, feed.events, groupId)

    /** Calls [onChange] with Home's state now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (HomeState) -> Unit): Job = scope.launch {
        val parts = combine(store.bots.value, store.groups.value, store.recent.value, store.dashboard.value, store.version.value) { b, g, r, d, v -> listOf(b, g, r, d, v) }
        val signIn = api.session?.signInNeeded ?: MutableStateFlow(null)
        val chief = combine(store.chief.value, store.chiefName, folded) { c, n, f -> Triple(c, n, f) }
        // What Android's Home says went wrong: reading the bots.
        combine(parts, store.waiting, store.lines.lines, combine(store.bots.error, signIn) { e, s -> e to s }, chief) { p, w, l, (e, s), (c, n, f) ->
            @Suppress("UNCHECKED_CAST")
            HomeState(p[0] as List<Bot>?, p[1] as List<Group>?, p[2] as List<Run>?, p[3] as Dashboard?, p[4] as VersionInfo?, w, l, e,
                signInNeeded = s != null && s == api.baseUrl.trimEnd('/'), chiefName = n, chiefUnread = c?.unread ?: 0, chiefBusy = c?.busy == true, folded = f)
        }.collect { onChange(it) }
    }

    private val moveLock = Mutex()

    /** Pull to refresh, or after a change here: everything Home shows, at once (as Android's Home loads it). */
    @Throws(Exception::class)
    suspend fun refresh() = coroutineScope {
        listOf(store.bots, store.groups, store.chief, store.recent, store.needs, store.dashboard, store.version).forEach { launch { it.refresh() } }
    }

    /**
     * Saves where the row [key] was let go in [order] ([ListLayout.moved]), then reads the list again. Nothing is
     * sent when it stays where it was. A refusal throws its sentence.
     */
    @Throws(Exception::class)
    suspend fun move(order: List<String>, key: String) = moveLock.withLock {
        // One drag's save and the read after it before the next: two quick drags land in the order they were made, and
        // each is read against the list as the server holds it now. Asked here, not through the Store, whose parts
        // keep what they held when a read fails: a failed read throws its sentence instead of "nothing changed".
        val (bots, groups, features) = coroutineScope {
            val version = async { api.version() }
            val bots = async { api.bots() }
            val features = version.await().features
            Triple(bots.await(), api.groupsOf(features), features)
        }
        val m = ListLayout.moved(order, key, bots, groups, hasPinsShared(features))
        try {
            if (m?.group != null) api.updateGroup(m.group, m.change) else if (m?.bot != null) api.updateBot(m.bot, m.change)
        } finally {
            // What the next drag is read against, before it is let in; the rest of Home after.
            coroutineScope { listOf(store.bots, store.groups, store.version).forEach { launch { it.refresh() } } }
            scope.launch { listOf(store.chief, store.recent, store.needs, store.dashboard).forEach { launch { it.refresh() } } }
        }
    }

    fun close() {
        feed.connect(null)
        scope.cancel()
    }
}
