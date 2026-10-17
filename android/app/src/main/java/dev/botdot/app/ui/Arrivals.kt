package dev.botdot.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.GroupItem
import dev.botdot.app.data.Run

/** How long a reply's arrival lasts, in milliseconds. */
internal const val ARRIVAL_MS = 260L

/** How far below its place an arriving reply starts. */
private val ARRIVAL_RISE = 10.dp

/**
 * Which replies of one open chat are new on screen, and so arrive: they fade and slide in, once. A chat's screen
 * tells it what it draws ([draw]) every time it draws; a reply's part of the screen asks when it came ([since]).
 *
 * A reply is told by its id: the run's in a bot's chat, the message's place in a Chief chat, the turn's in a group.
 * It is new when its id was not drawn before in this open chat and it stands after every reply that was. In a chat
 * that was open with no reply at all, the first ones are new. So nothing is new when the chat opens, when its lists
 * are read again, when older messages are loaded above, or when the chat is read from scratch.
 *
 * The owner's own messages are no replies and are not among the ids. The one on its way ([SentMessage]) arrives
 * when it is first drawn, on Send; the server's version that takes its place stands where it stood and does not.
 */
internal class Arrivals(private val now: () -> Long = FigureClock::now) {
    private var chat: String? = null
    private var seen: MutableSet<String>? = null // null until the chat was drawn once with what it holds
    private var sent: String? = null // the key of the message on its way, as drawn last
    private val came = HashMap<String, Long>()

    /**
     * What the chat draws now; the ids that are new with it (among them [sent]'s, as [Arrivals.sent]).
     * [chat]: which chat, where one screen shows several (the Chief's); null for a new chat without an id yet.
     * [loaded]: the chat's messages were read. [replies]: the ids of the replies drawn, oldest first.
     * [sent]: the key of the owner's message on its way, or null.
     */
    fun draw(chat: String?, loaded: Boolean, replies: List<String>, sent: String? = null): Set<String> {
        if (chat != this.chat) {
            // A new chat that got its id by the message on its way is the same chat. Any other is another one.
            if (!(this.chat == null && this.sent != null)) { seen = null; this.sent = null; came.clear() }
            this.chat = chat
        }
        if (!loaded) return emptySet()
        val had = seen
        if (had == null) { // the chat opens: what is there stands still
            seen = replies.toHashSet()
            this.sent = sent
            return emptySet()
        }
        val new = LinkedHashSet<String>(newReplies(had, replies))
        had += replies
        if (sent != null && sent != this.sent) new += sent(sent)
        this.sent = sent
        val at = now()
        for (id in new) came[id] = at
        return new
    }

    /** When the reply [id] arrived (on the clock given), or null for one that was there or is no reply. */
    fun since(id: String?): Long? = came[id]

    companion object {
        /** The id of the owner's message on its way, by its key. */
        fun sent(key: String): String = "sent:$key"
    }
}

/**
 * The replies that are new among [replies] (ids, oldest first), in a chat that drew [seen] before: those after the
 * last one it drew. In a chat that drew none, all of them. None when it drew some and none of those is left: the
 * chat was read from scratch.
 */
internal fun newReplies(seen: Set<String>, replies: List<String>): List<String> {
    if (seen.isEmpty()) return replies
    val last = replies.indexOfLast { it in seen }
    return if (last < 0) emptyList() else replies.drop(last + 1)
}

/** Whether a reply that came at [since] is moving at [now]. [still]: the system's animations are off, and nothing moves. */
internal fun arrivalMoves(since: Long?, now: Long, still: Boolean): Boolean = !still && since != null && now - since < ARRIVAL_MS

/** The replies of a bot's chat, oldest first, from its [runs] (newest first): a run that ended. One at work has its working line. */
internal fun replyIds(runs: List<Run>): List<String> = runs.asReversed().filterNot { it.isRunning || it.isQueued }.map { it.id }

/** The replies of a Chief chat, oldest first, each by its place in the whole chat: every message but the owner's own and a reply still being written. */
internal fun replyIds(chat: ChiefChat?): List<String> = chat?.let { c ->
    c.messages.mapIndexedNotNull { i, m -> if (m.role == "user" || m.pending) null else "${c.offset + i}" }
}.orEmpty()

/** The replies of a group's chat, oldest first, each by its turn's id. */
internal fun groupReplyIds(rows: List<GroupItem>): List<String> = rows.filterIsInstance<GroupItem.Reply>().map { it.id }

/**
 * The arrival of the reply [id]: it fades in and rises into its place, once, when [arrivals] says it is new. One
 * that was there stands still, as does everything with the system's animations off (the heads' own check,
 * [FigureClock.still]). Scrolled away and back, it stands.
 */
@Composable
internal fun Modifier.arrives(arrivals: Arrivals, id: String?): Modifier {
    val since = arrivals.since(id)
    val still = LocalFigureClock.current.still
    val moves = remember(since, still) { arrivalMoves(since, FigureClock.now(), still) }
    if (!moves) return this
    val t = remember(since) { Animatable(0f) }
    LaunchedEffect(since) { t.animateTo(1f, tween(ARRIVAL_MS.toInt())) }
    return graphicsLayer {
        alpha = t.value
        translationY = (1f - t.value) * ARRIVAL_RISE.toPx()
    }
}
