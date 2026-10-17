package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.random.Random

/**
 * New replies (ADR 005, docs/api.md "New replies"). The botdot server says what is new: a bot and a Chief chat carry
 * `unread` (how many) and `firstUnread` (where they begin). The app only draws that and reports the chat on screen;
 * it counts nothing. Against a server without the fields everything here is zero: no dots, no line, no report.
 *   - dots: one per new reply, at most three, in the bot's colour, after the time in the list. No number.
 *   - the "New" line: at the first new reply of the chat that was opened, until the chat is left.
 *   - the report: [ReadReport].
 * `public/unread.js` is the web page's side of the same rules.
 */
object Unread {
    const val MAX_DOTS = 3
    const val REPEAT_MS = 10_000L // until the server names its own

    /** How many dots a count of new replies draws. */
    fun dots(unread: Int): Int = unread.coerceIn(0, MAX_DOTS)

    /**
     * What a chat's "New" line is drawn from, after the chat came on screen and the server said [unread] and
     * [firstUnread] (a run's id, or a message's place in a Chief chat). [had]: what it was drawn from until now.
     * The line stays where it is while nothing is new, and moves when there are new replies again.
     */
    fun <T : Any> line(had: T?, unread: Int, firstUnread: T?): T? = if (unread > 0 && firstUnread != null) firstUnread else had

    /** What started a run, as its chat shows it above the reply. */
    enum class Asked { REPLIES, MESSAGE, JOB, SCHEDULE, HELLO, CARRIED_ON, USUAL, MINE }

    /** The one place that says what started a run: the chat draws from it, and the "New" line is placed by it. */
    fun asked(r: Run): Asked = when {
        r.trigger == "replies" -> Asked.REPLIES // the answers it waited for: the notes it read are what started it
        r.fromBot != null || r.startedBy == "chief" -> Asked.MESSAGE // another bot's message or a Chief task, folded
        r.jobName != null -> Asked.JOB
        r.trigger == "schedule" -> Asked.SCHEDULE
        r.trigger == "hello" -> Asked.HELLO // a new bot's first message (#511): nobody asked, nothing stands above it
        // After the owner's OK it goes on with a request that stands above the first reply: nothing is drawn for it
        // a second time. A job's run and a teammate's request that carry on are drawn as the run they follow, above.
        r.continues != null -> Asked.CARRIED_ON
        !r.customPrompt -> Asked.USUAL // "Ran its main assignment"
        else -> Asked.MINE
    }

    /** A job's run above its reply: "⏰ Motion", and "⏰ Motion, called" when a device on the tailnet called it. */
    fun jobChip(r: Run): String = "⏰ ${r.jobName}${if (r.trigger == "call") ", called" else ""}"

    /**
     * True when the owner's own message started this run: that message isn't new, so the line goes below it.
     * Above everything else that started a run: a schedule's chip, its main assignment, a folded message.
     */
    fun mine(r: Run): Boolean = asked(r) == Asked.MINE

    /**
     * In a Chief chat the line goes above the message at place [first], or above the next one that is drawn.
     * [places]: the place of each drawn message in the whole chat, in order. The index in [places], or -1 for none.
     */
    fun rowFrom(places: List<Int>, first: Int?): Int = if (first == null) -1 else places.indexOfFirst { it >= first }

    /** The bots with what the server now says about one bot's chat (the feed's `unread`); the same list when nothing changed. */
    fun set(bots: List<Bot>, botId: String, unread: Int, firstUnread: String?): List<Bot> {
        val n = unread.coerceAtLeast(0)
        val first = firstUnread.takeIf { n > 0 }
        if (bots.none { it.id == botId && (it.unread != n || it.firstUnread != first) }) return bots
        return bots.map { if (it.id == botId) it.copy(unread = n, firstUnread = first) else it }
    }

    /** An id this app makes up for itself at its start, so the server can tell two apps on one chat apart. */
    fun appId(random: Random = Random): String = "android-" + String(CharArray(12) { "abcdefghijklmnopqrstuvwxyz0123456789"[random.nextInt(36)] })
}

/**
 * The report of the chat on screen. A chat's screen says [show] once its chat is drawn, and [hide] when it goes.
 * [on]: the botdot server keeps read positions (`unread` in its features). [front]: the app is in front (the
 * activity is resumed). While a chat is shown and both hold, the chat is sent with [post], again every `repeatMs`;
 * the moment one of the three doesn't, null is sent once. [onRead]: the server took that chat as read.
 */
class ReadReport(
    scope: CoroutineScope,
    val on: StateFlow<Boolean>,
    private val front: StateFlow<Boolean>,
    private val post: suspend (chat: String?) -> ReadAnswer?,
    private val onRead: (chat: String) -> Unit = {},
) {
    private val shown = MutableStateFlow<String?>(null)
    private val nudge = Channel<Unit>(Channel.CONFLATED)

    fun show(chat: String) { shown.value = chat }

    /** That chat is no longer shown (null: whatever was). */
    fun hide(chat: String? = null) { if (chat == null || shown.value == chat) shown.value = null }

    /** Say it once more now: the app holds counts from before its report. */
    fun again(chat: String) { if (shown.value == chat) nudge.trySend(Unit) }

    init {
        scope.launch {
            var sent: String? = null // the last chat the server was told
            var repeatMs = Unread.REPEAT_MS
            combine(shown, on, front) { chat, has, inFront -> chat.takeIf { has && inFront } }.distinctUntilChanged().collectLatest { chat ->
                if (chat == null) {
                    if (sent != null) { sent = null; say(null) } // lost: the report runs out by itself on the server
                    return@collectLatest
                }
                while (true) {
                    sent = chat
                    val answer = say(chat) // offline: the next repeat tries again
                    if (answer?.ok == true) onRead(chat)
                    if (answer != null && answer.repeatMs > 0) repeatMs = answer.repeatMs
                    withTimeoutOrNull(repeatMs) { nudge.receive() }
                }
            }
        }
    }

    private suspend fun say(chat: String?): ReadAnswer? =
        try { post(chat) } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
}
