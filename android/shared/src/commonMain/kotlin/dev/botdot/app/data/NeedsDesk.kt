package dev.botdot.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.random.Random
import kotlin.time.Clock
import kotlin.time.Instant

// Needs you as a list of cards a phone draws and nothing more (ADR 242, #1363): every card's words, its blocks and its
// buttons, and what each button does, from the same rules as the Android app's NeedsYouScreen (NeedsCards.kt). The
// iPhone draws [NeedsState] and hands each tap back to [NeedsDesk].

/** Whose card it is, as its small mark draws it: the bot as it looks now, or the Chief. */
data class NeedsWho(val name: String, val color: String?, val outfit: JsonElement?)

/** How a block of a card is drawn: a line of text, muted or faint, a grey box (in a monospaced font: [CODE]), what goes above what comes, rows of facts, a warning in amber, a secret's row. */
enum class NeedsLook { TEXT, MUTED, FAINT, BOX, CODE, WAS_NOW, FACTS, WARNING, SECRET }

/**
 * One block of a card's body. [was]: what goes, struck, above [text] ([NeedsLook.WAS_NOW]). [label]: what a changed text
 * is, faint above it, and the label of a [NeedsLook.SECRET] row, whose [text] is dots until Show.
 */
data class NeedsBlock(val look: NeedsLook, val text: String = "", val was: String = "", val label: String = "", val rows: List<ToolCard.Fact> = emptyList())

/** How a button is drawn: filled, outlined, as a link, or as a row of its own across the card. */
enum class NeedsButtonLook { PRIMARY, SECONDARY, LINK, WIDE }

/**
 * The question a tap asks before its answer goes: [text] (under [title]), answered with [yes], or with [other] where
 * there is a second answer, or Cancel. Pressed, [yes] is the button's own id and [other] the id with [NeedsDesk.OTHER].
 */
data class NeedsQuestion(val title: String?, val text: String, val yes: String, val other: String? = null)

/** A button of a card: what it reads now (its busy word while its answer goes), and whether it takes a tap. [tint]: a filled answer in the asking bot's colour. */
data class NeedsButton(val id: String, val label: String, val look: NeedsButtonLook, val enabled: Boolean = true, val ask: NeedsQuestion? = null, val tint: String? = null)

data class NeedsOption(val id: String, val label: String)

/**
 * The new-login fields of a login's card (VaultTypes): the type, when the server keeps types, the username's label (null:
 * none), the secret's label, in a box of several lines when [multiline], and Bitwarden's master password when it is
 * locked ([master]). Save takes a tap only with a secret typed.
 */
data class NeedsLoginForm(
    val types: List<NeedsOption>, val typeLabel: String, val type: String,
    val username: String?, val typed: String, val secret: String, val multiline: Boolean, val master: String?,
    val save: String, val decline: String, val busy: Boolean,
)

/** A locked Bitwarden's card: its master password and Unlock. */
data class NeedsUnlockForm(val label: String, val button: String)

/**
 * A bot's open question with a box for each of [questions] and its choices under it ([picks]), or, with [reply], one
 * box for the answer. Send posts them as one message.
 */
data class NeedsAnswerForm(val questions: List<String>, val picks: List<List<String>>, val reply: Boolean, val send: String)

/** One card of Needs you. [inner]: one of the asks under a card of several. [done]: answered here, faded. [busy]: a line with a pulsing dot in the card's place. */
data class NeedsCard(
    val key: String, val who: NeedsWho?, val title: String, val meta: String?, val blocks: List<NeedsBlock>, val buttons: List<NeedsButton>,
    val failed: String? = null, val done: Boolean = false, val inner: Boolean = false, val busy: String? = null,
    val login: NeedsLoginForm? = null, val unlock: NeedsUnlockForm? = null, val answer: NeedsAnswerForm? = null,
)

/**
 * Needs you at one moment. [approveAll]: what the one button above the cards reads ("Approve 3"), null without it;
 * [approveAllLine]: what it leaves for the cards' own buttons. [allDone]: the line of an empty list. [notice]: a
 * message for a moment, new with each [noticeId]. [leave]: the last card was answered here, back where Needs you was
 * opened from (NeedsLeave).
 */
data class NeedsState(
    val cards: List<NeedsCard> = emptyList(), val loaded: Boolean = false, val allDone: String? = null,
    val approveAll: String? = null, val approveAllLine: String? = null,
    val notice: String? = null, val noticeId: Int = 0, val leave: Boolean = false,
    /** "Approve N" was pressed and its answers are on their way: it takes no second tap. */
    val approving: Boolean = false,
    /** How many cards stand open, once the lists were read since the screen opened; -1 before. */
    val open: Int = -1,
)

/**
 * The answers of a card of several questions as one message (lib/choices.js): each question, then its answer on a line
 * `→ answer`, `→ –` for one left empty.
 */
fun questionsAnswer(questions: List<String>, answers: List<String>): String =
    questions.mapIndexed { i, q -> "$q\n→ ${answers.getOrNull(i).orEmpty().trim().ifEmpty { "–" }}" }.joinToString("\n\n")

/** Why Bitwarden did not unlock, in the app's words. */
fun unlockFailed(e: Throwable): String = if (e.message.orEmpty().contains("not right")) tr("Wrong master password") else e.message ?: tr("That didn't work")

/** Why a login was not saved, in the app's words: Bitwarden locked, a wrong master password, or the server's reason. */
fun loginNotSaved(e: Throwable): String = when {
    e is ApiException && e.status == 423 -> tr("Bitwarden is locked: enter your master password too.")
    e.message.orEmpty().contains("not right") -> tr("Wrong master password, login not saved")
    else -> tr("Login not saved: {why}", "why" to (e.message ?: tr("that didn't work")))
}

/** A new key for a message the owner sends (docs/api.md `key`). */
internal fun newMessageKey(): String = Random.nextBytes(16).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

/**
 * Needs you for one botdot: the shared [Store]'s parts as cards ([state]), and each answer sent through [api] as the
 * Android app sends it. What was answered here stays, faded, until the screen closes; why an answer did not go stays on
 * its card until the next tap on it. [time] says a moment the server wrote, as the phone shows times ("13:52").
 */
class NeedsDesk(private val store: Store, private val api: Api, scope: CoroutineScope, private val time: (String) -> String = { "" }) {
    private val job = SupervisorJob(scope.coroutineContext[Job])
    private val own = CoroutineScope(scope.coroutineContext + job)

    private data class Done(val key: String, val who: NeedsWho?, val title: String, val label: String)
    private enum class Connect { OPENING, WAITING, FAILED }

    /** What the owner did on this screen, beside what botdot says. */
    private data class Local(
        val done: List<Done> = emptyList(),
        val failures: Map<String, String> = emptyMap(),
        val pressing: Map<String, String> = emptyMap(),
        val types: Map<String, String> = emptyMap(),
        val typed: Map<String, String> = emptyMap(),
        val saving: Set<String> = emptySet(),
        val unlocking: Boolean = false,
        val unlockError: String? = null,
        val revealed: Map<String, String> = emptyMap(),
        val connect: Map<String, Pair<Connect, String?>> = emptyMap(),
        val runs: Map<String, Run> = emptyMap(),
        val fresh: Boolean = false,
        val notice: String? = null,
        val noticeId: Int = 0,
        val leave: Boolean = false,
        val approving: Boolean = false,
    )

    private val local = MutableStateFlow(Local())
    private var actions: Map<String, Map<String, suspend () -> String?>> = emptyMap()
    private var approveAllAction: (suspend () -> Unit)? = null

    private class Parts(val needs: Needs?, val bots: List<Bot>?, val chief: ChiefOverview?, val dash: Dashboard?, val version: VersionInfo?)

    private val parts: Flow<Parts> = combine(store.needs.value, store.bots.value, store.chief.value, store.dashboard.value, store.version.value) { n, b, c, d, v -> Parts(n, b, c, d, v) }
    private class Names(val cardGroups: Map<String, GroupRef>, val groups: List<Group>?, val chief: String)
    private val names: Flow<Names> = combine(store.cardGroups.value, store.groups.value, store.chiefName) { cg, g, c -> Names(cg, g, c) }

    /** Needs you as it is now, after every change of what botdot says or the owner does here. */
    val state: StateFlow<NeedsState> = combine(parts, names, local) { p, n, l -> build(p, n, l) }.stateIn(own, SharingStarted.Eagerly, NeedsState())

    private var seen = false
    private var leaving: Job? = null

    init {
        // The questions' runs: their choices, read once each.
        own.launch { store.bots.value.collect { bots -> bots?.let { askedRuns(it) } } }
        // The last open card answered here: back where Needs you was opened from, after a moment (NeedsLeave).
        own.launch {
            state.map { it.open }.distinctUntilChanged().collect { open ->
                if (open < 0) return@collect
                leaving?.cancel()
                val step = NeedsLeave.step(seen, open, local.value.done.isNotEmpty())
                seen = step.seen
                if (step.leave) leaving = own.launch { delay(NeedsLeave.DELAY_MS); local.update { it.copy(leave = true) } }
            }
        }
        own.launch { load(); local.update { it.copy(fresh = true) } }
    }

    /** Pull to refresh, and after an answer: every list Needs you reads, at once. */
    @Throws(Exception::class)
    suspend fun load() = coroutineScope {
        listOf(store.needs, store.bots, store.chief, store.dashboard).forEach { launch { it.refresh() } }
    }

    /**
     * A tap on the button [button] of the card [key]. Its answer goes, the lists are read again, and the card says
     * why when it did not go. Returns the address to open in the browser, for a Connect that has a sign-in page.
     */
    @Throws(Exception::class)
    suspend fun press(key: String, button: String): String? {
        val act = actions[key]?.get(button) ?: return null
        if (key in local.value.pressing) return null
        local.update { it.copy(pressing = it.pressing + (key to button), failures = it.failures - key) }
        try {
            return act()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            local.update { it.copy(failures = it.failures + (key to (e.message ?: tr("That didn't work")))) }
            return null
        } finally {
            local.update { it.copy(pressing = it.pressing - key) }
        }
    }

    /** "Approve N": every job and memory change a card shows in words, at once, then the lists once (#1112). */
    @Throws(Exception::class)
    suspend fun approveAll() {
        val act = approveAllAction ?: return
        if (local.value.approving) return
        local.update { it.copy(approving = true) }
        try { act() } finally { local.update { it.copy(approving = false) } }
    }

    /** The type picked on a login's card: its fields follow it. */
    fun choose(key: String, type: String) = local.update { it.copy(types = it.types + (key to type)) }

    /**
     * A login's new fields saved (VaultTypes): the card is taken down while it saves, and comes back as it was left when it
     * failed. Returns whether it was saved: until then the phone keeps what was typed, so a failed save loses nothing.
     */
    @Throws(Exception::class)
    suspend fun saveLogin(key: String, type: String, username: String, secret: String, master: String): Boolean {
        val r = store.needs.value.value?.requests?.firstOrNull { "r:${it.id}" == key } ?: return false
        if (r.id in local.value.saving) return false
        val features = store.version.value.value?.features
        local.update { it.copy(saving = it.saving + r.id, types = it.types + (key to type), typed = it.typed + (key to username)) }
        val error = runCatching { api.answerRequest(r.id, VaultTypes.requestSave(VaultTypes.sent(type, username, features), secret, master)) }.exceptionOrNull()
        runCatching { store.needs.refresh() }
        local.update { it.copy(saving = it.saving - r.id) }
        tell(error?.let(::loginNotSaved) ?: tr("Saved. {botName} will continue.", "botName" to (r.bot?.name ?: tr("The bot"))))
        return error == null
    }

    /** Bitwarden's master password: unlocked, the bots can use the saved logins. Returns whether it unlocked: a wrong one stays typed. */
    @Throws(Exception::class)
    suspend fun unlock(master: String): Boolean {
        if (local.value.unlocking) return false
        local.update { it.copy(unlocking = true, unlockError = null) }
        val error = runCatching { api.unlockBitwarden(master) }.exceptionOrNull()?.let(::unlockFailed)
        local.update { it.copy(unlocking = false, unlockError = error) }
        tell(error ?: tr("Bitwarden is unlocked"))
        runCatching { load() }
        return error == null
    }

    /** The answers typed on a question's card ([NeedsAnswerForm]) go to its bot as one message, as the chat sends them. */
    @Throws(Exception::class)
    suspend fun answer(key: String, answers: List<String>) {
        val act = answerActions[key] ?: return
        if (key in local.value.pressing) return
        local.update { it.copy(pressing = it.pressing + (key to SEND), failures = it.failures - key) }
        try {
            act(answers)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            local.update { it.copy(failures = it.failures + (key to (e.message ?: tr("That didn't work")))) }
        } finally {
            local.update { it.copy(pressing = it.pressing - key) }
        }
    }

    /**
     * Back in the app after a Connect's sign-in page: how each Connect that waits stands. Connected, or answered elsewhere
     * meanwhile: the card goes with the next list. Failed or expired: its button again.
     */
    @Throws(Exception::class)
    suspend fun back() {
        val waiting = local.value.connect.filterValues { it.first == Connect.WAITING }.keys.toList()
        if (waiting.isEmpty()) return
        var changed = false
        for (id in waiting) {
            val s = runCatching { api.askConnectStatus(id) }.getOrElse { e -> if ((e as? ApiException)?.status == 404) AskConnect(settled = true) else null } ?: continue
            when (s.outcome) {
                AskConnect.Outcome.Connected -> { local.update { it.copy(connect = it.connect - id) }; changed = true }
                AskConnect.Outcome.Ended -> local.update { it.copy(connect = it.connect - id) }
                AskConnect.Outcome.Waiting -> {}
            }
        }
        if (changed) runCatching { store.needs.refresh() }
    }

    fun close() = job.cancel()

    // A question's answer keeps its key while its text is the same: sent again after a failed send, it is not a second message.
    private val sentKeys = mutableMapOf<String, Pair<String, String>>()
    private fun keyOf(card: String, text: String): String =
        (sentKeys[card]?.takeIf { it.first == text } ?: (text to newMessageKey()).also { sentKeys[card] = it }).second

    private var answerActions: Map<String, suspend (List<String>) -> Unit> = emptyMap()

    private fun tell(text: String) = local.update { it.copy(notice = text, noticeId = it.noticeId + 1) }

    private suspend fun askedRuns(bots: List<Bot>) {
        val ids = bots.flatMap { it.asks?.runs.orEmpty() }.distinct().filter { it !in local.value.runs }
        for (id in ids) runCatching { api.run(id) }.onSuccess { r -> local.update { it.copy(runs = it.runs + (id to r)) } }
    }

    /** An answer recorded on its card: faded, with what the owner said. [ask]: its chat says so too (AnsweredAway). */
    private fun record(key: String, who: NeedsWho?, title: String, label: String, ask: Ask? = null) {
        local.update { it.copy(done = it.done + Done(key, who, title, label), failures = it.failures - key) }
        ask?.let { store.answeredAway.add(it, title, label) }
    }

    private suspend fun after() { runCatching { load() } }

    private fun build(p: Parts, n: Names, l: Local): NeedsState {
        val acts = mutableMapOf<String, MutableMap<String, suspend () -> String?>>()
        val answers = mutableMapOf<String, suspend (List<String>) -> Unit>()
        val features = p.version?.features
        val bots = p.bots.orEmpty()
        val needs = p.needs
        val decided = l.done.map { it.key }
        val chief = NeedsWho(ChiefName.named(n.chief), CHIEF_COLOR, FigureDef.CHIEF)
        val groupName = { g: GroupRef? -> g?.let { ref -> n.groups?.firstOrNull { it.id == ref.id }?.name ?: ref.name } }
        val inGroup = { who: NeedsWho, g: GroupRef? -> who.copy(name = nameInGroup(who.name, groupName(g))) }
        val whoOf = { id: String?, name: String -> bots.firstOrNull { it.id == id }.let { b -> NeedsWho(name, b?.color, b?.outfit) } }
        val botWho = { b: Bot -> NeedsWho(b.name, b.color, b.outfit) }
        val cards = mutableListOf<NeedsCard>()

        fun on(key: String, id: String, act: suspend () -> String?) { acts.getOrPut(key) { mutableMapOf() }[id] = act }
        // The buttons of a card while one of its answers goes: the pressed one says so, none takes a tap.
        fun buttons(key: String, list: List<NeedsButton>, connects: Boolean = false): List<NeedsButton> {
            val pressed = l.pressing[key] ?: return list
            return list.map { b -> b.copy(enabled = false, label = if (b.id == pressed) busyWord(b.label, connects && b.look == NeedsButtonLook.PRIMARY) else b.label) }
        }
        fun card(c: NeedsCard, connects: Boolean = false) { cards += c.copy(buttons = buttons(c.key, c.buttons, connects), failed = c.failed ?: l.failures[c.key]) }
        // A yes or a no that the server answers with its words: recorded with them, then the lists again.
        fun decide(key: String, who: NeedsWho?, title: String, yes: Boolean, label: String? = null, ask: Ask? = null, send: suspend () -> Answered?): suspend () -> String? = {
            val said = send()
            record(key, who, title, answeredLabel(answeredWord(label, said, yes), said?.carriesOn.takeIf { yes }), ask)
            after()
            null
        }
        val yesNo = { yes: String, no: String -> listOf(NeedsButton(NO, no, NeedsButtonLook.SECONDARY), NeedsButton(YES, yes, NeedsButtonLook.PRIMARY)) }

        // Logins and payments the bots asked for, and a locked Bitwarden.
        val requests = needs?.requests.orEmpty()
        val bw = needs?.bitwarden
        val locked = bw?.configured == true && !bw.unlocked
        if (locked) {
            val key = BITWARDEN
            if (l.unlocking) cards += NeedsCard(key, null, tr("Bitwarden is locked"), null, emptyList(), emptyList(), busy = tr("Unlocking Password Manager…"))
            else cards += NeedsCard(key, bw.wantedBy?.let { whoOf(it.id, it.name) }, tr("Bitwarden is locked"), null,
                listOfNotNull(
                    NeedsBlock(NeedsLook.MUTED, bw.wantedBy?.let { tr("{name} needs a saved login. Unlock Bitwarden so bots can use your logins.", "name" to it.name) }
                        ?: tr("Bots can't use your saved logins until you unlock it. The master password is only kept in botdot's memory, never saved.")),
                ), emptyList(), failed = l.unlockError, unlock = NeedsUnlockForm(tr("Master password"), tr("Unlock")))
        }
        for (r in requests) {
            val key = "r:${r.id}"
            if (key in decided) continue
            val who = inGroup(if (r.bot == null && r.from == "chief") chief else whoOf(r.bot?.id, r.bot?.name ?: tr("A bot")), r.group)
            val botName = r.bot?.name ?: tr("The bot")
            val answer = { done: String, body: kotlinx.serialization.json.JsonObject ->
                suspend { api.answerRequest(r.id, body); tell(done); after(); null }
            }
            val decline = answer(tr("Declined"), buildJsonObject { put("action", "decline") })
            if (r.kind == "card") {
                val with = r.card?.let { "${it.name}${it.last4?.let { l4 -> " ••$l4" } ?: ""}" } ?: tr("a saved card")
                on(key, YES, answer(tr("Allowed for this task"), buildJsonObject { put("action", "approve") }))
                on(key, NO, decline)
                card(NeedsCard(key, who, tr("Pay on {site}", "site" to r.site), null, listOfNotNull(
                    NeedsBlock(NeedsLook.MUTED, tr("With {card}{amount}.", "card" to with, "amount" to if (r.amount.isNotBlank()) ", ${r.amount}" else "")),
                    r.reason.takeIf { it.isNotBlank() }?.let { NeedsBlock(NeedsLook.MUTED, "“$it”") },
                    NeedsBlock(NeedsLook.MUTED, tr("Your OK covers this task, this card and this site for 15 minutes. The bot never sees the card number.")),
                ), yesNo(tr("Allow"), tr("Decline"))))
                continue
            }
            if (r.id in l.saving) { cards += NeedsCard(key, who, tr("A login for {site}", "site" to r.site), null, emptyList(), emptyList(), busy = tr("Saving login…")); continue }
            val type = l.types[key] ?: VaultTypes.of(r.type).id
            val fields = VaultTypes.requestFields(type, features)
            val usable = r.existing.filter { !it.allowed }
            usable.forEach { e -> on(key, "use:${e.id}", answer(tr("{name} can use it now", "name" to botName), buildJsonObject { put("action", "allow"); put("loginId", e.id) })) }
            on(key, NO, decline)
            val blocks = buildList {
                if (r.reason.isNotBlank()) add(NeedsBlock(NeedsLook.MUTED, "“${r.reason}”"))
                if (usable.isNotEmpty()) add(NeedsBlock(NeedsLook.MUTED, tr("Let it use a login you already saved:")))
            }
            val uses = usable.map { e -> NeedsButton("use:${e.id}", tr("Use {name}", "name" to e.name + (if (e.username.isNotBlank()) " (${e.username})" else "")), NeedsButtonLook.WIDE) }
            val lead = if (usable.isNotEmpty()) tr("Or save a new one:") else tr("It goes straight into your vault{where}. The bot never sees the password.", "where" to if (locked) " (Bitwarden)" else "")
            card(NeedsCard(key, who, tr("A login for {site}", "site" to r.site), null, blocks + NeedsBlock(NeedsLook.MUTED, lead), uses,
                login = NeedsLoginForm(
                    if (VaultTypes.shows(features)) VaultTypes.options(features, r.type).map { NeedsOption(it.first, it.second) } else emptyList(),
                    VaultTypes.CONTROL, type, fields.username, l.typed[key] ?: r.username, fields.secret, fields.multiline,
                    if (locked) tr("Bitwarden master password (it's locked)") else null, tr("Save"), tr("Decline"), key in l.pressing,
                )))
        }

        // Jobs and their changes: what a card shows is what its yes approves.
        val waitingJobs = jobsLeft(bots.flatMap { b -> b.jobs.filter { it.waits }.map { b to it } }, decided)
        for ((b, j) in waitingJobs) {
            val key = jobKey(b, j)
            val who = inGroup(botWho(b), n.cardGroups[CardGroups.jobKey(b.id, j.id)])
            val c = jobCard(j)
            val script = c.script != null
            val asked = { text: String -> if (script) tr("Then the AI is asked: {text}", "text" to text) else text }
            val blocks = buildList {
                c.summary?.let { add(NeedsBlock(NeedsLook.TEXT, it)) }
                c.scriptWas?.let { was -> add(NeedsBlock(NeedsLook.FAINT, tr("Approved script"))); add(NeedsBlock(NeedsLook.CODE, was.ifBlank { tr("(empty)") })); if (script) add(NeedsBlock(NeedsLook.FAINT, tr("New script"))) }
                c.script?.let { add(NeedsBlock(NeedsLook.CODE, it.ifBlank { tr("(empty)") })) }
                val promptWas = c.promptWas
                if (promptWas != null) add(NeedsBlock(NeedsLook.WAS_NOW, c.prompt.takeIf { it.isNotBlank() }?.let(asked).orEmpty(), asked(promptWas)))
                else if (c.prompt.isNotBlank()) add(NeedsBlock(NeedsLook.BOX, asked(c.prompt)))
                c.also.forEach { add(NeedsBlock(NeedsLook.FAINT, it)) }
                if (j.assessment.isNotBlank()) add(NeedsBlock(NeedsLook.MUTED, j.assessment))
                c.line?.takeIf { it.isNotBlank() }?.let { add(NeedsBlock(NeedsLook.MUTED, it)) }
            }
            on(key, YES, decide(key, who, c.title, true) { api.approveJob(b.id, j.id, true) })
            on(key, NO, decide(key, who, c.title, false) { api.approveJob(b.id, j.id, false) })
            on(key, ALWAYS, decide(key, who, c.title, true, tr("Always approved")) { api.approveJob(b.id, j.id, true, always = true) })
            // "Always approve" a job: approve it and trust its later changes. A script only after the warning.
            val always = NeedsButton(ALWAYS, tr("Always approve"), NeedsButtonLook.SECONDARY,
                ask = if (j.touchesScript) NeedsQuestion(tr("Always approve \"{name}\"?", "name" to j.name), scriptWarningText(b.name), tr("Always approve")) else null)
            card(NeedsCard(key, who, c.title, c.meta, blocks, listOf(NeedsButton(NO, c.no, NeedsButtonLook.SECONDARY), always, NeedsButton(YES, c.yes, NeedsButtonLook.PRIMARY))), connects = j.createsConnection)
        }

        // Memory changes.
        val memory = needs?.memory.orEmpty().filter { "m:${it.id}" !in decided }
        val memWho = { m: MemoryChange -> inGroup(whoOf(m.botId, bots.firstOrNull { it.id == m.botId }?.name ?: m.bot?.name ?: tr("A bot")), m.group) }
        for (m in memory) {
            val key = "m:${m.id}"
            val c = memoryCard(m, features)
            val who = memWho(m)
            val blocks = if (c.was != null && c.now.isNotEmpty() && c.oneBlock) listOf(NeedsBlock(NeedsLook.WAS_NOW, c.now, c.was))
                else listOfNotNull(c.was?.let { NeedsBlock(NeedsLook.BOX, it) }, c.now.takeIf { it.isNotEmpty() }?.let { NeedsBlock(NeedsLook.BOX, it) })
            on(key, YES, decide(key, who, c.title, true) { api.settleMemoryChange(m.id, true) })
            on(key, NO, decide(key, who, c.title, false) { api.settleMemoryChange(m.id, false) })
            card(NeedsCard(key, who, c.title, c.meta, blocks, yesNo(c.yes, c.no)))
        }

        // A tile of the Board with a script, or a change to one: it runs on the botdot, so it waits for the owner.
        val tiles = tilesLeft(p.dash?.waiting.orEmpty(), decided)
        for (t in tiles) {
            val key = tileKey(t)
            val who = inGroup(bots.firstOrNull { it.id == t.bot }?.let(botWho) ?: chief, n.cardGroups[CardGroups.tileKey(t.id)])
            val c = tileCard(t)
            val blocks = buildList {
                if (c.scriptsWas.isNotEmpty()) {
                    add(NeedsBlock(NeedsLook.FAINT, if (c.scriptsWas.size == 1) tr("Approved script") else tr("Approved scripts")))
                    c.scriptsWas.forEach { add(NeedsBlock(NeedsLook.CODE, it.ifBlank { tr("(empty)") })) }
                    if (c.scripts.isNotEmpty()) add(NeedsBlock(NeedsLook.FAINT, if (c.scripts.size == 1) tr("New script") else tr("New scripts")))
                }
                c.scripts.forEach { add(NeedsBlock(NeedsLook.CODE, it.ifBlank { tr("(empty)") })) }
                c.line?.takeIf { it.isNotBlank() }?.let { add(NeedsBlock(NeedsLook.MUTED, it)) }
            }
            on(key, YES, decide(key, who, c.title, true) { api.approveTile(t.id, true) })
            on(key, NO, decide(key, who, c.title, false) { api.approveTile(t.id, false) })
            card(NeedsCard(key, who, c.title, c.meta, blocks, yesNo(c.yes, c.no)))
        }

        // Permissions, skills, tools, changed bots, connected apps' actions, the Vault's switches: one card per run (#277).
        val askWho = { a: Ask -> inGroup(a.bot?.let { whoOf(it.id, it.name) } ?: chief, a.group) }
        val asks = needs?.asks.orEmpty().filter { "a:${it.id}" !in decided }
        for (ac in askCards(asks)) when (ac) {
            is AskCard.One -> askCard(ac.ask, askWho(ac.ask), false, l, features, ::on, ::card, ::decide)
            is AskCard.Several -> {
                val key = "b:${ac.id}"
                val all = { yes: Boolean ->
                    suspend {
                        val r = api.answerAskBatch(ac.id, yes, ac.asks.map { it.id })
                        for (d in r.done) {
                            val a = ac.asks.firstOrNull { it.id == d.id } ?: continue
                            if (d.error != null) tell(d.error) else record("a:${a.id}", askWho(a), askTitle(a), answeredLabel(answeredWord(null, d.answered, yes), d.answered?.carriesOn.takeIf { yes }), a)
                        }
                        after()
                        null
                    }
                }
                on(key, YES, all(true))
                on(key, NO, all(false))
                val allows = ac.asks.any { it.batch?.own != true && !it.rowsCut }
                card(NeedsCard(key, askWho(ac.asks.first()), ac.title.ifBlank { trn(ac.asks.size, "{n} thing waits for your OK", "{n} things wait for your OK") }, null,
                    listOfNotNull(batchOwnLine(ac.asks)?.let { NeedsBlock(NeedsLook.MUTED, it) }),
                    if (allows) yesNo(tr("Allow all"), tr("Decline all")) else listOf(NeedsButton(NO, tr("Decline all"), NeedsButtonLook.SECONDARY))))
                ac.asks.forEach { askCard(it, askWho(it), true, l, features, ::on, ::card, ::decide) }
            }
        }

        // A bot's plan for the Chief: nothing happens until the owner approves it.
        for (c in p.chief?.chats.orEmpty().filter { it.waiting != null && "p:${it.id}" !in decided }) {
            val key = "p:${c.id}"
            val w = c.waiting!!
            val from = w.from
            val who = whoOf(from.id, from.name)
            val title = tr("A plan for the Chief: {title}", "title" to c.title)
            on(key, YES, decide(key, who, title, true, tr("Approved · the Chief is on it")) { api.sendToChief(c.id, PLAN_APPROVAL, emptyList()); null })
            on(key, NO, decide(key, who, title, false) { api.dismissSuggestion(c.id); null })
            card(NeedsCard(key, who, title, null, listOf(NeedsBlock(NeedsLook.BOX, w.text.replace("**", "").replace(Regex("""(?m)^\s*[-*#]+\s+"""), ""))), yesNo(tr("Approve"), tr("Decline"))))
        }

        // A bot's open question, with its answers: in one place, once for each run that asks (ADR 211, ADR 243).
        for (b in bots) {
            val asks = b.asks ?: continue
            for (runId in asks.runs.distinct()) {
                val key = "q:${b.id}:$runId"
                if (key in decided) continue
                val run = l.runs[runId]
                val who = botWho(b)
                val title = run?.question ?: asks.text.takeIf { runId == asks.runId } ?: continue
                suspend fun send(text: String, label: String) {
                    api.runBot(b.id, text, emptyList(), keyOf(key, text), answers = runId)
                    record(key, who, title, label)
                    after()
                }
                val choices = run?.choices.orEmpty()
                val questions = run?.questions.orEmpty()
                choices.forEachIndexed { i, c -> on(key, "choice:$i") { send(c, c); null } }
                if (questions.isNotEmpty()) answers[key] = { a -> send(questionsAnswer(questions, a), tr("Sent")) }
                else if (choices.isEmpty()) answers[key] = { a -> a.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }?.let { send(it, it) } }
                card(NeedsCard(key, who, title, null, emptyList(),
                    choices.mapIndexed { i, c -> NeedsButton("choice:$i", c, if (i == run?.yes) NeedsButtonLook.PRIMARY else NeedsButtonLook.SECONDARY, tint = b.color.takeIf { i == run?.yes }) },
                    answer = if (choices.isNotEmpty()) null else NeedsAnswerForm(questions, questions.indices.map { run?.questionChoices?.getOrNull(it).orEmpty() }, questions.isEmpty(),
                        if (key in l.pressing) tr("Sending…") else tr("Send"))))
            }
        }

        // Answered here: faded, with what the owner said, until the screen closes.
        l.done.forEach { d -> cards += NeedsCard("d:${d.key}", d.who, d.title, null, listOf(NeedsBlock(NeedsLook.MUTED, d.label)), emptyList(), done = true) }

        // What one tap may approve: what a card shows in words. A script is answered on its own card.
        val all = approveAll(waitingJobs, memory, tiles)
        approveAllAction = all.label?.let {
            suspend {
                coroutineScope {
                    all.jobs.forEach { (b, j) ->
                        launch {
                            val key = jobKey(b, j)
                            runCatching { api.approveJob(b.id, j.id, true) }
                                .onSuccess { said -> record(key, inGroup(botWho(b), n.cardGroups[CardGroups.jobKey(b.id, j.id)]), jobCard(j).title, answeredLabel(answeredWord(null, said, true), said.carriesOn)) }
                                .onFailure { e -> if (e !is kotlinx.coroutines.CancellationException) local.update { s -> s.copy(failures = s.failures + (key to (e.message ?: tr("That didn't work")))) } }
                        }
                    }
                    all.memory.forEach { m ->
                        launch {
                            val key = "m:${m.id}"
                            runCatching { api.settleMemoryChange(m.id, true) }
                                .onSuccess { said -> record(key, memWho(m), memoryCard(m, features).title, answeredLabel(answeredWord(null, said, true), said.carriesOn)) }
                                .onFailure { e -> if (e !is kotlinx.coroutines.CancellationException) local.update { s -> s.copy(failures = s.failures + (key to (e.message ?: tr("That didn't work")))) } }
                        }
                    }
                }
                after()
            }
        }
        actions = acts
        answerActions = answers
        val loaded = needs != null
        val open = cards.count { !it.done && !it.inner }
        return NeedsState(
            cards, loaded, tr("All done.").takeIf { loaded && open == 0 },
            all.label, all.line, l.notice, l.noticeId, l.leave, l.approving, if (loaded && l.fresh) open else -1,
        )
    }

    /**
     * The card of one ask, as the Android app draws it by its kind: a card whose main button is a verb (Connect), an
     * action in a connected app, the Chief's action, a shared room's card, a changed bot, a tool, the Vault's cards
     * and a computer's step, a permission, a skill the bot wrote, and a skill to install.
     */
    private fun askCard(
        a: Ask, who: NeedsWho, inner: Boolean, l: Local, features: Collection<String>?,
        on: (String, String, suspend () -> String?) -> Unit,
        card: (NeedsCard, Boolean) -> Unit,
        decide: (String, NeedsWho?, String, Boolean, String?, Ask?, suspend () -> Answered?) -> (suspend () -> String?),
    ) {
        val key = "a:${a.id}"
        fun one(title: String, yes: Boolean, label: String?, always: Boolean = false, everyBot: Boolean = false) =
            decide(key, who, title, yes, label, a) { api.answerAsk(a.id, yes, always, everyBot) }
        fun add(title: String, meta: String?, blocks: List<NeedsBlock>, buttons: List<NeedsButton>, failed: String? = null) =
            card(NeedsCard(key, who, title, meta?.ifBlank { null }, blocks, buttons, failed = failed, inner = inner), false)
        val decline = NeedsButton(NO, tr("Decline"), NeedsButtonLook.SECONDARY)
        val facts = { rows: List<ToolCard.Fact> -> if (rows.isEmpty()) emptyList() else listOf(NeedsBlock(NeedsLook.FACTS, rows = rows)) }
        when {
            a.act != null -> {
                // Its title, Not now and the server's verb: Connect opens the app's sign-in page in the browser.
                val label = a.actLabel ?: return
                val step = l.connect[a.id]
                val no = a.no ?: tr("Not now")
                on(key, NO, one(a.title, false, no))
                val connects = a.act?.verb == AskAct.CONNECT && CONNECT_CARDS in features.orEmpty()
                if (connects) on(key, YES) {
                    if (l.connect[a.id]?.first == Connect.OPENING) return@on null
                    local.update { it.copy(connect = it.connect + (a.id to (Connect.OPENING to null))) }
                    try {
                        val c = api.connectAsk(a.id)
                        val url = c.redirectUrl
                        if (c.outcome == AskConnect.Outcome.Connected || url == null) {
                            local.update { it.copy(connect = it.connect - a.id) }
                            runCatching { store.needs.refresh() }
                            null
                        } else {
                            local.update { it.copy(connect = it.connect + (a.id to (Connect.WAITING to null))) }
                            url
                        }
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        local.update { it.copy(connect = it.connect + (a.id to (Connect.FAILED to (e.message ?: tr("Couldn't connect {name}.", "name" to a.appName))))) }
                        runCatching { store.needs.refresh() }
                        null
                    }
                }
                val word = when (step?.first) { Connect.OPENING -> tr("Opening…"); Connect.FAILED -> tr("Try again"); else -> label }
                val opening = step?.first == Connect.OPENING
                add(a.title, if (step?.first == Connect.WAITING) tr("Waiting for sign-in") else null,
                    listOfNotNull(ToolCard.text(a.body).takeIf { it.isNotEmpty() }?.let { NeedsBlock(NeedsLook.BOX, it) }),
                    listOfNotNull(NeedsButton(NO, no, NeedsButtonLook.SECONDARY, enabled = !opening), if (connects) NeedsButton(YES, word, NeedsButtonLook.PRIMARY, enabled = !opening) else null),
                    failed = step?.takeIf { it.first == Connect.FAILED }?.second)
            }
            a.kind == "connector-action" -> {
                val always = a.always?.takeIf { it.isNotBlank() } ?: tr("Always allow")
                val e = a.everyBot
                on(key, YES, one(a.title, true, tr("Approved")))
                on(key, NO, one(a.title, false, null))
                // "Always allow" grants the action with any arguments: it asks first, in the server's words (#474);
                // for an action every bot may be allowed, whom: all bots or this one (ADR 201).
                on(key, ALWAYS, if (e != null) one(a.title, true, tr("Always allowed for all bots"), always = true, everyBot = true) else one(a.title, true, tr("Always allowed"), always = true))
                if (e != null) on(key, ALWAYS + OTHER, one(a.title, true, tr("Always allowed"), always = true))
                val question = if (e != null) NeedsQuestion(e.question, e.note, e.all, e.only)
                    else NeedsQuestion(null, ToolCard.text(a.warning).ifEmpty { if (a.chiefsAction) alwaysAllowChief(who.name) else ALWAYS_ALLOW_QUESTION }, always)
                add(a.title, connectorLine(who.name, a.held, a.stoppedAt, time) ?: a.reason,
                    facts(a.rows) + listOfNotNull(
                        a.details.takeIf { connectorDetails(a) }?.let { NeedsBlock(NeedsLook.BOX, it) },
                        if (connectorTooLong(a)) NeedsBlock(NeedsLook.MUTED, TOO_LONG) else null,
                    ),
                    listOfNotNull(
                        NeedsButton(ALWAYS, always, NeedsButtonLook.LINK, ask = question).takeIf { connectorAlways(a) },
                        decline,
                        NeedsButton(YES, tr("Allow once"), NeedsButtonLook.PRIMARY).takeIf { connectorOnce(a) },
                    ))
            }
            a.kind == "chief-action" -> {
                val always = a.always?.takeIf { it.isNotBlank() && a.chiefActionYes }
                on(key, YES, one(a.title, true, tr("Approved")))
                on(key, NO, one(a.title, false, null))
                if (always != null) on(key, ALWAYS, one(a.title, true, tr("Always allowed"), always = true))
                add(a.title, a.chiefActionLine, facts(a.rows) + listOfNotNull(if (a.tooLong) NeedsBlock(NeedsLook.MUTED, TOO_LONG) else null),
                    if (!a.chiefActionYes) listOf(decline)
                    else listOfNotNull(decline, always?.let { NeedsButton(ALWAYS, it, NeedsButtonLook.SECONDARY, ask = NeedsQuestion(null, ToolCard.text(a.warning).ifEmpty { "$it?" }, it)) }, NeedsButton(YES, tr("Approve"), NeedsButtonLook.PRIMARY)))
            }
            a.isRoomCard -> {
                on(key, YES, one(a.title, true, tr("Allowed")))
                on(key, NO, one(a.title, false, null))
                add(a.title, a.roomLine, facts(a.rows) + listOfNotNull(if (a.tooLong) NeedsBlock(NeedsLook.MUTED, TOO_LONG) else null),
                    if (a.roomYes) listOf(decline, NeedsButton(YES, a.yes ?: tr("Allow"), NeedsButtonLook.PRIMARY)) else listOf(decline))
            }
            a.kind == "bot-change" -> {
                on(key, YES, one(a.title, true, tr("Approved")))
                on(key, NO, one(a.title, false, null))
                add(a.title, a.reason, if (a.parts.isNotEmpty()) changedParts(a.parts) else listOf(NeedsBlock(NeedsLook.BOX, a.details)),
                    listOf(decline, NeedsButton(YES, changeYes(a), NeedsButtonLook.PRIMARY)))
            }
            ToolCard.isTool(a) -> {
                val t = ToolCard.parts(a)
                on(key, YES, one(t.title, true, ToolCard.answered(true)))
                on(key, NO, one(t.title, false, ToolCard.answered(false)))
                add(t.title, t.meta, listOfNotNull(
                    t.body.takeIf { it.isNotEmpty() }?.let { NeedsBlock(NeedsLook.BOX, it) },
                    t.warning.takeIf { it.isNotEmpty() }?.let { NeedsBlock(NeedsLook.WARNING, it) },
                ) + facts(t.facts), listOf(NeedsButton(NO, ToolCard.DECLINE, NeedsButtonLook.SECONDARY), NeedsButton(YES, ToolCard.INSTALL, NeedsButtonLook.PRIMARY)))
            }
            a.kind in VAULT_KINDS -> {
                // A switch of a saved login, a Vault entry to remove, a secret to save (hidden until Show), secrets to
                // keep in a file, a rule to lift, and an irreversible step on a bot's computer.
                val warning = ToolCard.text(a.warning)
                val always = if (a.kind == "override") a.always?.takeIf { it.isNotBlank() } else null
                on(key, YES, one(a.title, true, tr("Allowed")))
                on(key, NO, one(a.title, false, null))
                if (always != null) on(key, ALWAYS, one(a.title, true, tr("Always allowed"), always = true))
                val secret = a.secret
                val shown = l.revealed[a.id]
                if (secret != null) on(key, REVEAL) {
                    if (a.id in local.value.revealed) local.update { it.copy(revealed = it.revealed - a.id) }
                    else { val v = runCatching { api.askSecret(a.id) }.getOrNull(); if (v != null) local.update { it.copy(revealed = it.revealed + (a.id to v)) } }
                    null
                }
                add(a.title, a.reason,
                    changedParts(a.parts) + listOfNotNull(
                        secret?.let { NeedsBlock(NeedsLook.SECRET, shown ?: "••••••••", label = it.label) },
                        warning.takeIf { it.isNotEmpty() }?.let { NeedsBlock(NeedsLook.WARNING, it) },
                    ),
                    listOfNotNull(
                        secret?.let { NeedsButton(REVEAL, if (shown == null) it.show else it.hide, NeedsButtonLook.LINK) },
                        decline,
                        always?.let { NeedsButton(ALWAYS, it, NeedsButtonLook.SECONDARY) },
                        NeedsButton(YES, a.yes ?: tr("Allow"), NeedsButtonLook.PRIMARY),
                    ))
            }
            a.kind == "permission" -> {
                val title = tr("Let it {what}?", "what" to (a.what?.label ?: a.permission.orEmpty()))
                on(key, YES, one(title, true, tr("Allowed")))
                on(key, NO, one(title, false, null))
                add(title, a.reason, listOf(NeedsBlock(NeedsLook.BOX, tr("{hint}. It can't until you allow it; you can change this in its settings.", "hint" to (a.what?.hint ?: "").replaceFirstChar { it.uppercase() }))),
                    listOf(decline, NeedsButton(YES, tr("Allow"), NeedsButtonLook.PRIMARY)))
            }
            a.written -> {
                val title = skillTitle(a)
                on(key, YES, one(title, true, tr("Approved")))
                on(key, NO, one(title, false, null))
                add(title, a.reason, listOf(NeedsBlock(NeedsLook.BOX, a.skill?.instructions.orEmpty().ifBlank { tr("(empty)") })), listOf(decline, NeedsButton(YES, tr("Approve"), NeedsButtonLook.PRIMARY)))
            }
            else -> {
                val k = a.skill ?: AskSkill()
                val title = tr("Install the skill \"{name}\"?", "name" to k.name)
                val forWhom = if (a.forBots.isNotEmpty()) " · " + tr("for {names}", "names" to a.forBots.joinToString(", ") { it.name }) else ""
                on(key, YES, one(title, true, tr("Installed")))
                on(key, NO, one(title, false, null))
                add(title, a.url.removePrefix("https://").removePrefix("www.") + forWhom,
                    listOf(NeedsBlock(NeedsLook.BOX, k.description.ifBlank { tr("No description.") } + (if (k.files > 1) " " + trn(k.files, "({n} file)", "({n} files)") else "") + (if (k.exists) " " + tr("It replaces your skill of the same name.") else "") + (if (a.reason.isNotBlank()) "\n\n" + tr("Why: {reason}", "reason" to a.reason) else ""))),
                    listOf(decline, NeedsButton(YES, tr("Install"), NeedsButtonLook.PRIMARY)))
            }
        }
    }

    /** What a bot change changes ([partGroups]): the parts that are no text as rows of one box, and each changed text with what goes struck above what comes. */
    private fun changedParts(parts: List<ChangedPart>): List<NeedsBlock> = partGroups(parts).map { g ->
        val t = g.first()
        if (t.was == null) NeedsBlock(NeedsLook.FACTS, rows = g.map { ToolCard.Fact(it.label, it.now) })
        else NeedsBlock(NeedsLook.WAS_NOW, t.now, t.was.orEmpty(), label = if (parts.size > 1) t.label else "")
    }

    companion object {
        /** The ids of a card's buttons: its yes, its no, its second yes that lasts, and Show on a secret. */
        const val YES = "yes"
        const val NO = "no"
        const val ALWAYS = "always"
        const val REVEAL = "reveal"
        /** After a button's id: the second answer of its question ([NeedsQuestion.other]). */
        const val OTHER = ":other"
        private const val SEND = "send"
        private const val BITWARDEN = "bitwarden"
        private val VAULT_KINDS = setOf("vault-switch", "vault-remove", "vault-save", "vault-file", "override", "computer-step")
    }
}

/**
 * A moment the server wrote, as the phone's cards say it: "13:52" today, "5 Oct, 13:52" another day (as the Android
 * app's shortTime); "" for one that cannot be read.
 */
fun shortClock(iso: String?, zone: TimeZone = TimeZone.currentSystemDefault(), now: Instant = Clock.System.now()): String {
    if (iso.isNullOrBlank()) return ""
    val t = runCatching { Instant.parse(iso).toLocalDateTime(zone) }.getOrNull() ?: return ""
    val today = now.toLocalDateTime(zone).date
    val clock = "${t.hour.toString().padStart(2, '0')}:${t.minute.toString().padStart(2, '0')}"
    return if (t.date == today) clock else "${t.day} ${monthShort(t.month.ordinal)}, $clock"
}

/**
 * Whether Home's Needs you opens Needs you: something waits for the owner ([waiting]), or a bot asks them something,
 * which Needs you answers on its card.
 */
fun needsYouOpens(waiting: List<Waiting>, bots: List<Bot>?): Boolean = waiting.isNotEmpty() || bots.orEmpty().any { it.asks != null }
