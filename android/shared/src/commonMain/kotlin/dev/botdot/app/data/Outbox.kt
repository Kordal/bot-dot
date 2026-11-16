package dev.botdot.app.data

import kotlinx.atomicfu.locks.SynchronizedObject
import kotlinx.atomicfu.locks.synchronized
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject

// A chat's sends, for both phones (ADR 242): the message on its way, what a failed send keeps, and the line above the
// message box, in the web page's words. Android's chats (ui/ChatModels.kt) and the iPhone's draw them.

// ---------- a message that is there at once ----------

/**
 * The owner's message as its chat draws it from Send until the botdot server answered: their own words and files,
 * in the look of a message that waits. It is the one thing an app draws before the server spoke, and it decides
 * nothing. [key] is the message's key ([messageKey]): the answer to the request that carried it is the server's
 * version of this message, and takes its place. [chat]: the chat it was sent in, where one outbox serves several
 * (the Chief's chats). [known]: the ids of the owner's messages the chat held on Send.
 */
data class SentMessage(val key: String, val text: String, val attachments: List<Attachment> = emptyList(), val chat: String? = null, val known: Set<String> = emptySet()) {
    /**
     * This message, or null once the server's own version of it is among [theirs], the owner's messages the chat
     * holds now. The feed can bring it before the request answers, or when its answer was lost: it is then one the
     * chat did not hold on Send, with these words and these files. Never drawn twice.
     */
    fun unlessIn(theirs: List<Queued>): SentMessage? = takeUnless { m ->
        theirs.any { it.id !in m.known && it.text.trim() == m.text.trim() && it.attachments.map { a -> a.file } == m.attachments.map { a -> a.file } }
    }
}

/** The working line under a message that is on its way, until the server has words of its own. */
val WORKING: String get() = tr("Working…")

/** A chat's working line: the line it has ([line], "" for none), or "Working…" while a message of the owner's is on its way ([sent]). */
fun lineWith(line: String, sent: SentMessage?): String = line.ifEmpty { if (sent != null) WORKING else "" }

/**
 * What waits for a bot's chat to draw its run: [starting] with each message that left the list ([had] then [now]) without
 * being taken back ([takenBack]): its turn came.
 */
fun leftQueue(starting: List<Queued>, had: List<Queued>, now: List<Queued>, takenBack: Set<String>): List<Queued> {
    val ids = now.mapTo(HashSet()) { it.id }
    return starting + had.filter { q -> q.id !in ids && q.id !in takenBack && starting.none { it.id == q.id } }
}

/** Those of [starting] whose run is not among [runs] yet: a run with its id, or one it was steered into. */
fun stillStarting(starting: List<Queued>, runs: List<Run>): List<Queued> =
    starting.filter { q -> runs.none { r -> (r.id == q.id && !r.isQueued) || r.steered.any { it.id == q.id } } }

/** The owner's own messages among a bot's [runs] and those that wait for it: what [SentMessage.unlessIn] looks through. */
fun ownWords(runs: List<Run>, queued: List<Queued>): List<Queued> =
    runs.filter { Unread.mine(it) }.map { Queued(it.id, it.prompt, it.attachments.orEmpty()) } + queued

/** As [ownWords], of a Chief chat: a message there has no id, and is named by its place in the whole chat. */
fun ownWords(chat: ChiefChat?): List<Queued> = chat?.let { c ->
    c.messages.mapIndexedNotNull { i, m -> if (m.role == "user") Queued("at:${c.offset + i}", m.text, m.attachments.orEmpty()) else null } + c.queued
}.orEmpty()

/**
 * A bot's runs (newest first) with the run a send answered: on top, where the chat does not hold it yet. One the
 * chat holds already stays as it is: the feed brought it, or the same message was sent again and botdot took it once.
 */
fun withAnswer(had: List<Run>, run: Run): List<Run> = if (had.any { it.id == run.id }) had else listOf(run) + had

/** What waits for a bot with the message a send answered as waiting: last, as the newest. One that is there already is not added. */
fun withWaiting(had: List<Queued>, q: Queued): List<Queued> = if (had.any { it.id == q.id }) had else had + q

/** As [withWaiting], for the list as the server sent it (`queued` on a bot), which the app keeps as it came. */
fun withWaiting(list: kotlinx.serialization.json.JsonElement?, q: Queued): kotlinx.serialization.json.JsonElement {
    val all = (list as? kotlinx.serialization.json.JsonArray).orEmpty()
    if (all.any { (it as? JsonObject)?.str("id") == q.id }) return kotlinx.serialization.json.JsonArray(all)
    return kotlinx.serialization.json.JsonArray(all + kotlinx.serialization.json.buildJsonObject {
        put("id", kotlinx.serialization.json.JsonPrimitive(q.id))
        put("text", kotlinx.serialization.json.JsonPrimitive(q.text))
        put("attachments", dev.botdot.app.data.Api.JSON.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(Attachment.serializer()), q.attachments))
        q.at?.let { put("at", kotlinx.serialization.json.JsonPrimitive(it)) }
    })
}

/**
 * A Chief chat with what a send answered: the whole chat as it is now, with the owner's message in it, or among
 * those that wait while the Chief replies. [had]: the part of the chat that is loaded, which keeps where it starts
 * and what it knows of new replies. null: nothing was loaded, and the answer is the chat, all of it, as a botdot
 * from before parts sends one (the next look reads its last page). An answer that holds fewer messages than are
 * loaded is no whole chat: only what waits is taken from it. null when there is nothing to draw.
 */
fun withAnswer(had: ChiefChat?, answer: ChiefChat): ChiefChat? {
    if (had == null) return answer.takeIf { it.messages.isNotEmpty() || it.queued.isNotEmpty() }
    val waits = answer.queuedValue ?: had.queuedValue
    if (answer.messages.size < had.offset + had.messages.size) return had.copy(queuedValue = waits)
    return had.copy(title = answer.title, messages = answer.messages.drop(had.offset), busy = answer.busy, total = if (had.total < 0) had.total else answer.messages.size, queuedValue = waits)
}

/**
 * Whether these words are "Go on" and nothing else, as the botdot server reads them (docs/api.md, "The limit"): in
 * any case, with the signs typed around them. Sent while a group is stopped at the limit they are no message.
 */
fun isGoOn(text: String): Boolean = Regex("""^[\s*_`"'.!]*go\s+on[\s*_`"'.!]*$""", RegexOption.IGNORE_CASE).matches(text)

// ---------- a message that could not be sent ----------

val NOT_CONNECTED: String get() = tr("Not connected to botdot")
private val STILL_HERE: String get() = tr("Your message is still here.")

/** The feature of a botdot that takes a message's key once (docs/api.md, "A message sent twice"). */
const val MESSAGE_KEY = "message-key"

/** A key for a message the owner sends: new for each message, and sent again with it when its send failed. */
@OptIn(kotlin.uuid.ExperimentalUuidApi::class)
fun messageKey(): String = kotlin.uuid.Uuid.random().toString()

/** Whether the botdot this app talks to takes a key once, by the features it last named (not known yet: no). */
fun takesOnce(features: Collection<String>?): Boolean = features != null && MESSAGE_KEY in features

/** The feature of a botdot that keeps the owner's message while a bot works or the Chief replies (docs/api.md). */
const val MESSAGE_WAITS = "message-waits"

/**
 * Whether the message box keeps Send while something works: the botdot this app talks to takes a message then and
 * lets it wait ([MESSAGE_WAITS]), and Stop is the word at the end of the working line. Against a botdot from before
 * (and while its features are not known yet) the box is as it was: Stop while busy, nothing sent meanwhile.
 */
fun sendStays(features: Collection<String>?): Boolean = features != null && MESSAGE_WAITS in features

/** Whether the message box shows Stop in Send's place: something works, and this botdot would not take a message meanwhile. */
fun boxStops(busy: Boolean, features: Collection<String>?): Boolean = busy && !sendStays(features)

/** Under a message that waits: what it waits for. [who]: the bot's name, or "the Chief". */
fun waitsUntil(who: String): String = tr("Waits until {names} is free", "names" to who)

/** The box's line when "Take back" came too late: the message's run or turn has begun (the server's 409). */
val ALREADY_STARTED: String get() = tr("It has already started.")

/**
 * The line above the message box after a "Take back" that failed. 409: it has already started. Else botdot's own
 * sentence; a 404 without one: it no longer waits; no answer, or a gateway's that botdot is not there (502, 503):
 * botdot was not reached; any other answer with its status, as a failed send says it. The message is where it was.
 */
fun takeBackNote(e: Throwable): String {
    val api = e as? ApiException
    val said = api?.message?.trim().orEmpty()
    return when {
        api?.status == 409 -> ALREADY_STARTED
        api != null && api.said && said.isNotEmpty() -> said
        api?.status == 404 -> tr("It is no longer waiting.")
        api == null || api.status == 0 || api.status == 502 || api.status == 503 -> tr("Not taken back: can't reach botdot.")
        else -> tr("Not taken back: botdot couldn't do that ({status}).", "status" to api.status)
    }
}

/** The feature of "Steer" under a bot's waiting message (ADR 040): without it there is no button. */
const val STEER = "steer"

/** Whether a bot's waiting message has "Steer": the botdot this app talks to announces it. */
fun canSteer(features: Collection<String>?): Boolean = features != null && STEER in features

/** The feature of "Steer" under a message that waits in a Chief chat (ADR 040). */
const val CHIEF_STEER = "chief-steer"

/** Whether a Chief chat's waiting message has "Steer". */
fun canSteerChief(features: Collection<String>?): Boolean = features != null && CHIEF_STEER in features

/** The feature of "Steer" under a message that waits in a group (ADR 253). */
const val GROUP_STEER = "group-steer"

/** Whether a group's waiting message has "Steer". */
fun canSteerGroup(features: Collection<String>?): Boolean = features != null && GROUP_STEER in features

/** Under a message that the owner steered into the run that is going, until that run read it. */
val STEERING: String get() = tr("Steering…")

/**
 * The line above the message box after a "Steer" that did not go. 409: botdot's own sentence (the run can't take it,
 * or it has already started), else "It has already started."; a 404: it no longer waits; no answer: botdot was not
 * reached; any other answer with its status. The message waits as it did.
 */
fun steerNote(e: Throwable): String {
    val api = e as? ApiException
    val said = api?.message?.trim().orEmpty()
    return when {
        api != null && api.said && said.isNotEmpty() -> said
        api?.status == 409 -> ALREADY_STARTED
        api?.status == 404 -> tr("It is no longer waiting.")
        api == null || api.status == 0 || api.status == 502 || api.status == 503 -> tr("Not steered: can't reach botdot.")
        else -> tr("Not steered: botdot couldn't do that ({status}).", "status" to api.status)
    }
}

/** A list of what waits, as it came, with the entry [id] marked as steered: here, before the server's list says so. */
fun steered(list: kotlinx.serialization.json.JsonElement?, id: String): kotlinx.serialization.json.JsonElement? =
    (list as? kotlinx.serialization.json.JsonArray)?.let { all ->
        kotlinx.serialization.json.JsonArray(all.map { e ->
            val o = e as? JsonObject
            if (o != null && o.str("id") == id) JsonObject(o + ("steering" to kotlinx.serialization.json.JsonPrimitive(true))) else e
        })
    } ?: list

/** A list of what waits, as it came, without the entry [id]: taken back here, before the server's list says so. */
fun without(list: kotlinx.serialization.json.JsonElement?, id: String): kotlinx.serialization.json.JsonElement? =
    (list as? kotlinx.serialization.json.JsonArray)?.let { all ->
        kotlinx.serialization.json.JsonArray(all.filterNot { (it as? JsonObject)?.str("id") == id })
    } ?: list

/** A failure before the message was sent that botdot answered with a [status] and no sentence: see [notSent]. */
class NotSent(val status: Int) : kotlinx.io.IOException(statusWords(status))

/**
 * A failure before the message itself was sent (its chat could not be made), in the web page's words. botdot's own
 * refusal or its answer that it could not (a 4xx) as it is; an answer of the 500s without botdot's sentence that is
 * no gateway's "not there" (502, 503) with its status; else botdot not reached. Never "it may have been sent": the
 * message did not leave.
 */
fun notSent(e: Throwable): kotlinx.io.IOException {
    val api = e as? ApiException ?: return ApiException(NOT_CONNECTED)
    return when {
        api.said || api.status in 400..499 -> api
        api.status >= 500 && api.status != 502 && api.status != 503 -> NotSent(api.status)
        else -> ApiException(NOT_CONNECTED)
    }
}

/**
 * Whether a send that threw was taken by botdot all the same: it answered with a success, and only reading that
 * answer failed. Such a message is in the chat, and is not put back in the box.
 */
fun delivered(e: Throwable): Boolean = when (e) {
    is ApiException -> e.status in 200..299
    else -> e is SerializationException
}

/**
 * The line above the message box after a send that failed, in the web page's words (`sendNoteText`, public/app.js):
 * why, and that nothing is lost. botdot's own sentence for a refusal. "Can't reach botdot" when no answer came, or a
 * gateway answered in botdot's place that it is not there (502, 503). "It may have been sent" when nobody can tell: a
 * gateway gave up waiting (504), or another answer of the 500s without botdot's sentence.
 *
 * [once]: botdot takes a message's key once ([MESSAGE_KEY]), so sending again is safe also where the request had
 * gone out before the connection dropped. Against a botdot from before, that case still reads "It may have been sent".
 */
fun sendNote(e: Throwable, once: Boolean = false): String {
    if (e is NotSent) return notSentBecause(e.message.orEmpty())
    val api = e as? ApiException ?: return tr("It may have been sent: check the chat.") + " " + STILL_HERE
    val said = api.message?.trim().orEmpty()
    return when {
        api.said && said.isNotEmpty() -> notSentBecause(said)
        api.status == 502 || api.status == 503 || (api.status == 0 && (once || !api.sent)) -> tr("Not sent: can't reach botdot.") + " " + STILL_HERE
        api.status == 0 || api.status >= 500 -> tr("It may have been sent: check the chat.") + " " + STILL_HERE
        else -> notSentBecause(statusWords(api.status)) // an answer without a sentence, as the web page says it
    }
}

private fun notSentBecause(said: String) = tr("Not sent: {why}", "why" to said + if (said.last() in ".!?…") "" else ".") + " " + STILL_HERE

/** The [Outbox] a chat's messages go through: one for all the Chief's chats ("chief:<id>"), else the chat's own. */
fun outboxKey(chat: String): String = if (chat.startsWith("chief:")) "chief" else chat

/**
 * A reply typed in a notification (#1069), to a chat ("chief:<id>", "bot:<id>", "group:<id>"): sent as its message box
 * sends, through the chat's [Outbox], with a message key [request] gets. Null once it went. When it did not, it waits
 * in that chat's box with the line that says why ([sendNote]), and that line is the answer.
 */
suspend fun replyFromNotification(chat: String, text: String, features: Collection<String>?, request: suspend (key: String) -> Unit): String? {
    val outbox = Outbox.of(outboxKey(chat))
    val went = outbox.send(text, emptyList(), box = true, once = takesOnce(features), chat = chat.takeIf { it.startsWith("chief:") }?.removePrefix("chief:"), draw = false, request = request)
    return if (went) null else outbox.note ?: sendNote(ApiException(NOT_CONNECTED), takesOnce(features))
}

/**
 * What Stop says once botdot answered (#1070), as the web page's Stop and a group's "Stop all": that it is stopping, or
 * why it could not, so the owner never believes a run stopped that goes on.
 */
fun stopNote(r: Result<*>): String = r.fold({ tr("Stopping…") }, { it.message ?: tr("Couldn't stop") })

/** A failed message back in the box, in front of what was typed since. */
fun withFailed(failed: String, typedSince: String): String =
    if (failed.isNotEmpty() && typedSince.isNotBlank()) "$failed\n$typedSince" else failed.ifEmpty { typedSince }

/** A message whose send failed, on its way back into the message box. */
data class FailedSend(val text: String, val attachments: List<Attachment>)

/**
 * What a chat's message box is told about its sends, kept by chat ("bot:<id>", or "chief" for all the Chief's chats)
 * for as long as the app runs: a send goes on after its chat was left, and a message that then fails is back in the
 * box when the chat is opened again. One message at a time: while one is under way, another sends nothing.
 *
 * Every message goes with a key ([messageKey]). A message from the box that failed keeps its key until it went or
 * the owner changes it: sent again as it is, botdot takes it once.
 */
class Outbox {
    /** A send is under way. */
    private val sendingState = observed<Boolean>(false)
    var sending: Boolean
        get() = sendingState.value
        private set(v) { sendingState.value = v }
    /** The line above the box: why the last send failed. It stays until the owner sends or edits. */
    private val noteState = observed<String?>(null)
    var note: String?
        get() = noteState.value
        private set(v) { noteState.value = v }
    /** A failed message the box has not taken back yet. */
    private val backState = observed<FailedSend?>(null)
    var back: FailedSend?
        get() = backState.value
        private set(v) { backState.value = v }
    /** The message from the box that failed last, as it was sent, with its key. */
    private var failed: Pair<FailedSend, String>? = null
    /**
     * The message that is on its way, as its chat draws it from Send until botdot answered ([SentMessage]). It goes
     * with the answer: the chat has botdot's own version by then, or the message is back in the box.
     */
    private val sentState = observed<SentMessage?>(null)
    var sent: SentMessage?
        get() = sentState.value
        private set(v) { sentState.value = v }

    /** The message on its way belongs to [chat] now: a first message, whose Chief chat was just made. */
    fun sentIn(chat: String) { sent = sent?.copy(chat = chat) }

    /**
     * Sends with [request], which gets the message's key; true once botdot took the message. When it failed, the line
     * says why, and a message from the message box ([box]) waits in [back], in front of one that already waits there.
     * A quick answer or a question card ([box] false) keeps what was tapped or typed by staying on screen, and gives
     * its own [key], the same for every send of it. A message from the box has the key it failed with when its text
     * and files are those that failed, else a new one. [once]: see [sendNote].
     *
     * From here until [request] ends the message stands in [sent], for its chat to draw: [chat] is the chat it was
     * sent in, where one outbox serves several, and [known] the ids of the owner's messages that chat had already
     * ([SentMessage]). [request] puts botdot's answer in the chat before it returns, so the two change places in one
     * step. [draw] false: these words are no message (a typed "Go on" in a group that stopped), and nothing is drawn.
     */
    suspend fun send(
        text: String, attachments: List<Attachment>, box: Boolean, key: String? = null, once: Boolean = false,
        chat: String? = null, known: Set<String> = emptySet(), draw: Boolean = true, request: suspend (String) -> Unit,
    ): Boolean {
        if (sending) {
            if (box) giveBack(text, attachments) // the box emptied for it: nothing typed is lost
            return false
        }
        val message = FailedSend(text, attachments)
        val k = key ?: failed?.takeIf { box && it.first == message }?.second ?: messageKey()
        sending = true
        note = null
        sent = if (draw) SentMessage(k, text, attachments, chat, known) else null
        try {
            request(k)
            if (box) failed = null
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (delivered(e)) { if (box) failed = null; return true }
            if (box) { giveBack(text, attachments); failed = message to k }
            note = sendNote(e, once)
            return false
        } finally {
            sending = false
            sent = null
        }
    }

    private fun giveBack(text: String, attachments: List<Attachment>) {
        back = FailedSend(withFailed(text, back?.text.orEmpty()), attachments + back?.attachments.orEmpty())
    }

    /**
     * "Take back" on a message that waits, with [request], which answers its text and files; true once it is back.
     * It then waits in [back] for the message box, as a failed send does, in front of what waits there, and the line
     * goes: what is in the box is another message now, as after an edit. When it could not be taken back the line
     * says why ([takeBackNote]), and nothing comes back: the message is where it was.
     */
    suspend fun takeBack(request: suspend () -> TakenBack): Boolean {
        try {
            val m = request()
            giveBack(m.text, m.attachments)
            edited()
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            note = takeBackNote(e)
            return false
        }
    }

    /** "Steer" on a message that waits did not go ([steerNote]): the line says why; the message waits as it did. */
    fun steerFailed(e: Throwable) { note = steerNote(e) }

    /** The box takes the failed message back. */
    fun take(): FailedSend? = back.also { back = null }

    /** The owner edited the message: the line goes, and what is in the box is a new message. */
    fun edited() { note = null; failed = null }

    /**
     * What was typed in the box and not sent when its chat was left (#1068): Back, another chat, a notification. The
     * box takes it back once when it is drawn again, as long as the app runs.
     */
    private var unsent = ""
    fun leave(typed: String) { unsent = typed.takeIf { it.isNotBlank() }.orEmpty() }
    fun takeUnsent(): String = unsent.also { unsent = "" }

    companion object {
        private val byChat = mutableMapOf<String, Outbox>()
        fun of(chat: String): Outbox = synchronized(lock) { byChat.getOrPut(chat) { Outbox() } }
        private val lock = SynchronizedObject()
    }
}

/**
 * The newest runs ([fresh], a look at the [limit] newest) put in place of those in [had] (both newest first).
 * null when they don't meet: more runs came than one look brings, so the chat should start over.
 */
fun mergeNewest(had: List<Run>, fresh: List<Run>, limit: Int): List<Run>? {
    if (fresh.isEmpty()) return if (had.isEmpty()) had else null
    val at = had.indexOfFirst { it.id == fresh.last().id }
    return when {
        at >= 0 -> fresh + had.drop(at + 1)
        fresh.size < limit -> fresh // that's all it has
        had.isEmpty() -> fresh
        else -> null
    }
}
