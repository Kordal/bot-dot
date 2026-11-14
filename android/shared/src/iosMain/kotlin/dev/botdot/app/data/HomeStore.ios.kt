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
) {
    /** The pinned bots and groups in one order (`pins-shared`). */
    val shared: Boolean get() = hasPinsShared(version?.features)
    /** The rows, in the owner's order: [ListLayout.Rows]; no category is folded on the iPhone yet. */
    val rows: ListLayout.Rows get() = ListLayout.rows(bots.orEmpty(), groups.orEmpty(), emptySet(), shared)
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
}

/**
 * What the iPhone app keeps for one signed-in botdot: the shared [Store] on its own coroutine scope, as the Android
 * app keeps it for the whole app. [watch] hands Home a new [HomeState] whenever a part changes, on the main thread;
 * looking loads each part, as on Android. [close] it when the phone leaves that botdot.
 */
class HomeStore(val api: Api) {
    private val scope = MainScope()
    val store = Store(scope, MutableStateFlow(api))

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

    /** The chat of the bot [botId], following this botdot's feed. [BotChat.stop] it when it is left. */
    fun chat(botId: String): BotChat = BotChat(scope, api, store, feed.events, botId)

    /** The chat of the group [groupId], following this botdot's feed. [GroupChat.stop] it when it is left. */
    fun groupChat(groupId: String): GroupChat = GroupChat(scope, api, store, feed.events, groupId)

    /** Calls [onChange] with Home's state now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (HomeState) -> Unit): Job = scope.launch {
        val parts = combine(store.bots.value, store.groups.value, store.recent.value, store.dashboard.value, store.version.value) { b, g, r, d, v -> listOf(b, g, r, d, v) }
        val signIn = api.session?.signInNeeded ?: MutableStateFlow(null)
        // What Android's Home says went wrong: reading the bots.
        combine(parts, store.waiting, store.lines.lines, store.bots.error, signIn) { p, w, l, e, s ->
            @Suppress("UNCHECKED_CAST")
            HomeState(p[0] as List<Bot>?, p[1] as List<Group>?, p[2] as List<Run>?, p[3] as Dashboard?, p[4] as VersionInfo?, w, l, e,
                signInNeeded = s != null && s == api.baseUrl.trimEnd('/'))
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
