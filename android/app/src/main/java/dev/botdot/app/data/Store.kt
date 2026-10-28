package dev.botdot.app.data

import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * What several screens show, kept once for the whole app: the bots, the groups, the Chief's chats, what waits for
 * you, the Board. A screen shows what's here at once, and it's brought up to date behind it.
 *
 * It follows the live feed: each event refreshes only the parts it changes, a burst of events refreshes once, and
 * only while something looks at that part (a screen, or the background connection's notification). A part nobody
 * looks at is refreshed when someone does again.
 */
class Store(private val scope: CoroutineScope, private val api: StateFlow<Api?>) {

    /** One thing botdot has, as the app last heard it (null: not loaded yet). */
    inner class Part<T : Any>(private val fetch: suspend (Api) -> T) {
        private val _value = MutableStateFlow<T?>(null)
        val value: StateFlow<T?> = _value.asStateFlow()
        private val _error = MutableStateFlow<String?>(null)
        /** Why the last refresh failed (null once one works again). */
        val error: StateFlow<String?> = _error.asStateFlow()

        private var stale = true
        private var loadedAt = 0L
        private val lock = Mutex()
        private val kicks = Channel<Boolean>(Channel.CONFLATED) // true: soon (after a burst), false: now

        init {
            scope.launch {
                for (soon in kicks) {
                    if (soon) delay(BURST_MS)
                    refresh()
                }
            }
            // Someone started looking: bring it up to date if it's out of date.
            scope.launch {
                _value.subscriptionCount.map { it > 0 }.distinctUntilChanged().collect { if (it && stale) kicks.trySend(false) }
            }
        }

        private val watched get() = _value.subscriptionCount.value > 0

        /** Get it again now, and wait for it (pull to refresh, after you changed something). */
        suspend fun refresh() {
            val a = api.value ?: return
            lock.withLock {
                stale = false
                runCatching { fetch(a) }
                    .onSuccess { if (api.value === a) { _value.value = it; _error.value = null; loadedAt = SystemClock.elapsedRealtime() } }
                    .onFailure { if (it is kotlinx.coroutines.CancellationException) throw it; stale = true; _error.value = it.message }
            }
        }

        /** It changed on botdot: refresh soon if someone looks, otherwise when someone does. */
        fun changed() {
            stale = true
            if (watched) kicks.trySend(true)
        }

        /** Only if it wasn't just loaded (the feed's hello right after a screen's first load). */
        fun changedIfOld() { if (SystemClock.elapsedRealtime() - loadedAt > 1_500) changed() }

        /** What an event said, without asking botdot. */
        fun set(v: T) { _value.value = v; stale = false; loadedAt = SystemClock.elapsedRealtime() }
        fun update(f: (T) -> T) { _value.value?.let { _value.value = f(it) } }

        /** Another botdot: forget what this one had. */
        fun clear() { _value.value = null; _error.value = null; stale = true; if (watched) kicks.trySend(false) }
    }

    val bots = Part { it.bots() }
    /** What each working bot's line reads, and what the Chief said it is about to do: the server's words, per chat (OpeningLine). */
    val lines = OpeningLines()
    /** Who carries on after the yes on a waiting job: the feed's words, per job (JobThens). */
    val jobThens = JobThens()
    /** Whether Claude is signed out, as the feed says: no bot can work until the owner signs in. */
    val claude = ClaudeState()

    private val _chiefName = MutableStateFlow(ChiefName.role)
    /** The Chief's name (ChiefName): from the Chief's list, and at once from the feed's `chief_name`. */
    val chiefName: StateFlow<String> = _chiefName.asStateFlow()

    // The lines are read from the lists of the botdot the app is on now: not from an answer of the one before.
    val chief = Part { a -> a.chief().also { c -> if (api.value === a) { lines.sync(OpeningLine.live(c)) { it.startsWith("chief:") }; _chiefName.value = ChiefName.of(c) } } }
    /** The latest runs of every bot, newest first: what the list shows under a bot's name. */
    val recent = Part { a -> a.recentRuns(100).also { runs -> if (api.value === a) lines.sync(OpeningLine.live(runs, lines.features)) { it.startsWith("bot:") } } }
    val dashboard = Part { it.dashboard(quiet = true) }
    // Its features say whether a bot's line is its working line: known here too, when the feed has not said hello yet.
    val version = Part { a -> a.version().also { v -> if (api.value === a) lines.serverHas(v.features) } }
    /**
     * The groups, each with what its chat holds now. None from a botdot server without groups, which is asked
     * nothing about them: its features are read first where they are not known yet.
     */
    val groups: Part<List<Group>> = Part { a ->
        // Features that cannot be read are a failed read, not a botdot server without groups: what is held stays.
        val features = (version.value.value ?: a.version().also { if (api.value === a) version.set(it) }).features
        a.groupsOf(features)
    }
    /** What each member at work in a group is doing, by its run (TurnLines): its working line from a server that has one. */
    val turnLines = TurnLines { lines.features }
    /** The groups that waiting jobs and tiles were asked in: the feed's words, per card (CardGroups). */
    val cardGroups = CardGroups()
    /** Asks answered on the Needs you screen, for the chats their cards stood in to say so (AnsweredAway). */
    val answeredAway = AnsweredAway()
    /** Pages bots saved (#346), from the feed's `page`: an open page and a bot's list of pages follow. */
    val pageSaves = PageSaves()
    val tileTicks = TileTicks() // a page's blocks read tiles (#395)
    /** The skill library and the Claude account's skills (for mentions and the skills "/" runs: see Mentions). */
    val skills = Part { a -> a.skills() }
    /** Every page of the account, for mentions of pages (#473): none from a botdot without `page-mentions`. */
    val pages = Part { a ->
        val features = (version.value.value ?: a.version().also { if (api.value === a) version.set(it) }).features
        if (Mentions.PAGE_MENTIONS in features) a.allPages() else emptyList()
    }
    /** Logins and payments, Bitwarden, memory changes, permissions, skills and tools asked for. (Jobs waiting for your OK
     *  come with [bots], plans for the Chief with [chief], the Board's tiles with [dashboard]: see [waiting].) */
    val needs = Part { a ->
        coroutineScope {
            val requests = async { runCatching { a.loginRequests() } }
            val bw = async { runCatching { a.bitwarden() } }
            val memory = async { runCatching { a.memoryChanges() } }
            val asks = async { runCatching { a.asks() } }
            val all = listOf(requests, bw, memory, asks).awaitAll()
            all.firstOrNull { it.isSuccess } ?: all.first().getOrThrow() // all failed: say why
            Needs(requests.await().getOrDefault(emptyList()), bw.await().getOrNull(), memory.await().getOrDefault(emptyList()), asks.await().getOrDefault(emptyList()))
        }
    }

    private val parts = listOf(bots, chief, recent, dashboard, version, needs, skills, groups, pages)

    /** Everything that waits for you, from the parts above: one list, so every screen counts the same. */
    val waiting: Flow<List<Waiting>> = combine(bots.value, chief.value, needs.value, dashboard.value) { b, c, n, d -> waitingOf(b.orEmpty(), c, n, d) }

    init {
        // The botdot is known (right after the app starts) or another one was chosen: what's looked at loads (again).
        scope.launch {
            var had: String? = null
            api.collect { a -> if (a?.baseUrl != had) { lines.serverHas(null); lines.clear(); jobThens.clear(); claude.clear(); _chiefName.value = ChiefName.role; turnLines.clear(); cardGroups.clear(); answeredAway.clear(); pageSaves.clear(); parts.forEach { it.clear() }; had = a?.baseUrl } }
        }
    }

    /** A feed event: refresh what it changed. */
    fun handle(ev: FeedEvent) {
        lines.handle(ev) // a working bot's line: said, changed, or gone with its run
        jobThens.handle(ev) // who carries on after the yes on a waiting job
        claude.handle(ev) // Claude signed out, or in again
        turnLines.handle(ev) // what a member at work in a group said it is doing
        cardGroups.handle(ev) // the group a waiting job or tile was asked in
        pageSaves.handle(ev) // a bot saved a page (#346)
        if (ev.type == "page") pages.changed() // its title can be mentioned (#473)
        // What happens in a group: who works in it, its newest reply, its question, its stopped line, its new replies.
        // At once, and again from botdot where a list fetched meanwhile may be from before the event.
        if (ev.type.startsWith("group_")) {
            groups.update { Groups.on(it, ev) }
            if (ev.type == "group_run_started" || ev.type == "group_run_finished" || ev.type == "group_unread") groups.changed()
        }
        bots.update { Asks.on(it, ev) } // a bot asks the owner something, or no longer does: its row says so at once
        when (ev.type) {
            "hello" -> {
                // It carries botdot's version: no need to ask.
                runCatching { Api.JSON.decodeFromJsonElement(VersionInfo.serializer(), ev.data) }.getOrNull()?.takeIf { it.version.isNotEmpty() }?.let { version.set(it) }
                ev.data.str("chiefName").ifEmpty { null }?.let { _chiefName.value = ChiefName.named(it) } // where it stands, also with no screen open
                listOf(bots, chief, recent, dashboard, needs, skills, groups).forEach { it.changedIfOld() } // what happened while the phone was away
            }
            "reset" -> parts.forEach { it.changed() }
            "run_started", "run_finished", "waiting", "bot_message" -> { bots.changed(); recent.changed() }
            "bots" -> { bots.changed(); skills.changed() } // a bot may have made or picked a skill
            "groups" -> groups.changed() // a group was made, changed or deleted, or a deleted bot left one
            "approvals" -> { bots.changed(); needs.changed(); dashboard.changed() }
            "chief_started", "chief_reply", "chief_suggestion", "plan_closed" -> chief.changed()
            "chief_name" -> { _chiefName.value = ChiefName.named(ev.data.str("name")); chief.changed() } // the owner gave the Chief another name
            "login_request", "login_request_closed", "asks", "bitwarden" -> { needs.changed(); bots.changed() } // a bot's figure says it needs you
            "update_available" -> version.changed()
            // The owner's messages that wait for a bot changed: one was taken, started, or was taken back. The list
            // at once, and again from botdot, as with `unread` below. (A Chief chat's list is kept by its chat.)
            "queued" -> if (Queued.event(ev)?.first?.startsWith("bot:") == true) {
                bots.update { queuedOn(it, ev) }
                bots.changed()
            }
            // A chat's new replies changed: a new one came, or an app read the chat.
            "unread" -> {
                val chat = ev.data.str("chat")
                val n = (ev.data["unread"] as? JsonPrimitive)?.intOrNull ?: 0
                when {
                    chat.startsWith("bot:") -> {
                        // At once, and again from botdot: a list that was being fetched meanwhile may be from before this.
                        bots.update { Unread.set(it, chat.removePrefix("bot:"), n, ev.data.str("firstUnread").ifEmpty { null }) }
                        bots.changed()
                    }
                    chat.startsWith("chief:") -> chief.changed() // the Chief's place in the list shows the server's sum
                }
            }
            "dashboard" -> {
                // One tile's new value: put it in place. Otherwise the Board itself changed.
                val tile = (ev.data["tile"] as? JsonObject)?.let { runCatching { Api.JSON.decodeFromJsonElement(Tile.serializer(), it) }.getOrNull() }
                if (tile != null) dashboard.update { d -> d.copy(tiles = d.tiles.map { if (it.id == tile.id) tile else it }) } else dashboard.changed()
                tileTicks.tick(tile?.id)
            }
        }
    }

    /** The server took this app's report: that chat is read, so its dots go here too, also while the live feed is down. */
    fun read(chat: String) {
        when {
            chat.startsWith("bot:") -> bots.update { Unread.set(it, chat.removePrefix("bot:"), 0, null) }
            chat.startsWith("group:") -> groups.update { Groups.setUnread(it, chat.removePrefix("group:"), 0, null) }
            chat.startsWith("chief:") -> if (chief.value.value?.chats?.any { it.id == chat.removePrefix("chief:") && it.unread > 0 } == true) chief.changed()
        }
    }

    companion object {
        private const val BURST_MS = 250L
    }
}

/**
 * Who carries on after the yes on a waiting job (`then`, docs/api.md "What follows a yes"). The feed says it, in the
 * `jobs` of its `approvals` ("hello", and the `approvals` event): a bot's own list of jobs, which the cards are drawn
 * from, does not carry it. Kept by "<botId>/<jobId>" as the feed last said where things stand: an event the feed
 * replays from before "hello" is older than what "hello" said.
 */
class JobThens {
    private val _value = MutableStateFlow<Map<String, Then>>(emptyMap())
    val value: StateFlow<Map<String, Then>> = _value.asStateFlow()
    private var helloAt: String? = null

    fun handle(ev: FeedEvent) {
        when (ev.type) {
            "hello" -> {
                helloAt = ev.data.str("lastEventId").ifBlank { null }
                _value.value = (ev.data["approvals"] as? JsonObject)?.let(Then::ofJobs).orEmpty()
            }
            "approvals" -> if (!isReplayOf(ev.id, helloAt)) Then.ofJobs(ev.data)?.let { _value.value = it }
        }
    }

    /** Another botdot: forget what this one said. */
    fun clear() { helloAt = null; _value.value = emptyMap() }
}

/**
 * Whether Claude is signed out, as the feed last said it: `claude` in "hello", then the `claude` event
 * (docs/api.md). A "hello" that does not say leaves what was known; an event the feed replays from before "hello" is
 * older than what "hello" said. Only for a botdot of Milestone 7 on ([saysSignedOut]): one from before sends the
 * same words, and its screens stay as they were.
 */
class ClaudeState {
    private val _signedOut = MutableStateFlow(false)
    val signedOut: StateFlow<Boolean> = _signedOut.asStateFlow()
    private var helloAt: String? = null

    private var says = false // this botdot's apps say it ([saysSignedOut]), as its "hello" named its features

    fun handle(ev: FeedEvent) {
        when (ev.type) {
            "hello" -> {
                helloAt = ev.data.str("lastEventId").ifBlank { null }
                says = saysSignedOut(ev.data.arr("features")?.mapNotNull { (it as? JsonPrimitive)?.content })
                if (!says) _signedOut.value = false else claudeSignedOut(ev.data["claude"])?.let { _signedOut.value = it }
            }
            "claude" -> if (says && !isReplayOf(ev.id, helloAt)) claudeSignedOut(ev.data)?.let { _signedOut.value = it }
        }
    }

    /** Another botdot: forget what this one said. */
    fun clear() { helloAt = null; says = false; _signedOut.value = false }
}

/**
 * The bots after the feed's `queued` event about a bot's chat: that bot with the event's list of what waits for it,
 * the others as they were. Any other event, and one about a Chief chat, changes nothing.
 */
fun queuedOn(bots: List<Bot>, ev: FeedEvent): List<Bot> {
    val (chat, list) = Queued.event(ev) ?: return bots
    if (!chat.startsWith("bot:")) return bots
    val id = chat.removePrefix("bot:")
    return bots.map { if (it.id == id) it.copy(queuedValue = list) else it }
}

data class Needs(
    val requests: List<LoginRequest> = emptyList(),
    val bitwarden: BitwardenStatus? = null,
    val memory: List<MemoryChange> = emptyList(),
    val asks: List<Ask> = emptyList(),
) {
    val bitwardenLocked get() = bitwarden?.let { it.configured && !it.unlocked } == true
}

/**
 * One thing that waits for you: the colour and outfit of the bot it's about (no colour: it is about no bot, and its
 * mark is the Chief's), what it is in words, and that [bot]'s id (null: the Chief's), whose key says Needs you (#397).
 */
/**
 * One thing that waits for the owner, as home's Needs you rows show it. [permission]: the id of a permission a bot asks
 * for, whose row says all there is to it, so the row itself answers it with No and Allow; anything else opens Needs you.
 */
data class Waiting(val color: String?, val text: String, val outfit: JsonElement? = null, val bot: String? = null, val permission: String? = null)

private const val NO_COLOR = "#888780" // the grey of a bot without a colour (FigureDef.GREY)

fun waitingOf(bots: List<Bot>, chief: ChiefOverview?, needs: Needs?, dash: Dashboard?): List<Waiting> {
    val byId = bots.associateBy { it.id }
    // As the web page marks it: a bot as it looks now, in the colour the server sent for one that is gone, else grey.
    val about = { ref: BotRef?, text: String ->
        if (ref == null) Waiting(null, text) else byId[ref.id].let { b -> Waiting(b?.color ?: ref.color ?: NO_COLOR, text, b?.outfit, ref.id) }
    }
    val nameOf = { id: String?, fallback: String -> byId[id]?.name ?: fallback }
    return buildList {
        needs?.requests?.forEach { r ->
            val who = r.bot?.name ?: if (r.from == "chief") tr("The Chief") else tr("A bot")
            add(about(r.bot, if (r.kind == "card") tr("{who} wants to pay on {site}", "who" to who, "site" to r.site) else tr("{who} needs a login for {site}", "who" to who, "site" to r.site)))
        }
        if (needs?.bitwardenLocked == true) add(about(needs.bitwarden?.wantedBy, tr("Bitwarden is locked")))
        bots.forEach { b -> b.jobs.filter { it.waits }.forEach { j -> add(Waiting(b.color ?: NO_COLOR, "${b.name}: ${jobWaits(j)}", b.outfit, b.id)) } }
        // A guarded change is not one to the shared memory: its line is the server's title ("Forget for good").
        needs?.memory?.forEach { m ->
            val who = nameOf(m.botId, m.bot?.name ?: tr("A bot"))
            val title = m.titleValue.textOrNull().takeIf { m.guarded }
            add(about(m.bot ?: byId[m.botId]?.let { BotRef(it.id) }, if (title != null) "$who: $title" else tr("{who} wants to change the shared memory", "who" to who)))
        }
        chief?.chats?.forEach { c -> c.waiting?.let { w -> add(about(w.from, tr("{name} sent the Chief a plan: {title}", "name" to w.from.name, "title" to c.title))) } }
        needs?.asks?.forEach { a ->
            val who = a.bot?.name ?: tr("The Chief")
            if (a.kind == "permission") {
                add(about(a.bot, tr("{who} asks to {what}", "who" to who, "what" to (a.what?.label ?: a.permission))).copy(permission = a.id))
                return@forEach
            }
            add(about(a.bot, when {
                // A tool: what its notification says under the bot's name ("Asks to install gh"), as one line. The
                // words are made here, because `GET /api/asks` has no such line; without the tool's name, the title.
                ToolCard.isTool(a) -> ToolCard.name(a).let { tool -> if (tool.isNotEmpty()) tr("{who} asks to install {tool}", "who" to who, "tool" to tool) else if (a.title.isNotBlank()) "$who: ${a.title}" else tr("{who} asks to install a tool", "who" to who) }
                a.title.isNotBlank() -> "$who: ${a.title}"
                a.written && a.line.isNotBlank() -> "$who: ${a.line}" // a skill it wrote: the server's line, nothing is installed
                else -> tr("{who} asks to install the skill {name}", "who" to who, "name" to (a.skill?.name ?: "")).trim()
            }))
        }
        dash?.waiting?.forEach { t ->
            add(about(byId[t.bot]?.let { BotRef(it.id) }, nameOf(t.bot, tr("The Chief")) + ": " + if (t.approved && t.change != null) tr("a change to “{title}” on the Board waits for your OK", "title" to t.title) else tr("“{title}” on the Board waits for your OK", "title" to t.title)))
        }
    }
}

/** What waits on a job, in a few words: the job itself, before its first OK, or a change beside the approved one. */
fun jobWaits(j: Job): String = if (j.approved && j.change != null) tr("a change to a job waits for your OK") else tr("a job waits for your OK")
