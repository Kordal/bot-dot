package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A working bot's opening line (docs/api.md, "The opening line"). The botdot server reads the line from the bot's run
 * and offers it while the run is going on; the app keeps what the server said per chat and draws it: a status line
 * under the chat, with a pulsing dot in the bot's colour, and the bot's preview in the list. The line is plain text
 * and never a message of the chat: it makes no dot and moves no "New" line ([Unread]). In a bot's chat the
 * status line is all a working bot shows: against a server without opening lines, and until the bot says one, it
 * says "Working".
 * A run that waits for the owner's OK on an action in a connected app (`waitingFor: "ok"` on the run, docs/api.md)
 * says "Waiting for your OK" where its line stood, until the wait is over: the line comes back as it was.
 * With `working-line` in the server's `features` a bot's line is its working line (docs/api.md, "The working line"):
 * the server's words for what the bot is doing now, which change as the run goes on ("Reading nytimes.com",
 * "Starting its computer", "Running <job name>"). The app draws them as it draws the opening line, each text as it
 * comes, and has no words of its own for a running run's step or for a job's run. A member's turn in a group has a
 * working line too ([TurnLines]). The Chief has no `working_line`: its line is the `activity` of its reply, in the
 * server's words as well ([chiefActivity], [chiefLine]): its opening line first, then the steps that follow.
 * `public/opening-line.js` is the web page's side of the same rules.
 */
object OpeningLine {
    /** What stands where the opening line stood while a run waits for the owner's OK. No ellipsis: nothing moves until the owner answers. */
    const val WAITING_FOR_OK = "Waiting for your OK"

    /** Whether a run's `waitingFor`, as the server sent it, says that it waits for the owner's OK. Anything else: it does not. */
    fun waitsForOk(v: JsonElement?): Boolean = (v as? JsonPrimitive)?.takeIf { it.isString }?.content == "ok"

    /** The line as the app takes it: the server's text (already one line, cut and without marks). "" for none. */
    fun text(x: String?): String = x?.trim().orEmpty()

    /** The server's feature that says it sends the working line. */
    const val WORKING_LINE = "working-line"

    /** Does the server offer the working line? [features]: its `features`; null while they are not known yet: no. */
    fun follows(features: Collection<String>?): Boolean = features != null && WORKING_LINE in features

    /**
     * The line of a bot's running run, from the run as the server gives it: its working line from a server that has
     * one, its opening line from one that does not. The same for a turn in a group, from its entry in `working`; a
     * run or an entry that has an opening line and no working line shows its opening line.
     */
    fun ofRun(workingLine: String?, openingLine: String?, features: Collection<String>?): String =
        (if (follows(features)) text(workingLine) else "").ifEmpty { text(openingLine) }

    /**
     * Does this event bring the line of a bot's run, on the feed and in the run's stream? `working_line` from a
     * server that has the working line, which sends every change of the line with it, the opening line first;
     * `opening_line` from one that does not. So the line changes when the server says, and at most once a second.
     */
    fun says(type: String, features: Collection<String>?): Boolean = type == if (follows(features)) "working_line" else "opening_line"

    /** The bot's preview in the list while it works: its line with the app's ellipsis, or "" for the usual words. */
    fun preview(line: String?): String = text(line).let { if (it.isEmpty()) "" else "$it…" }

    /**
     * The status line of a bot's chat: its line, or "Working…" while it works and has said none; "" when it rests.
     * [waiting]: its run waits for the owner's OK, and says that in the line's place.
     */
    fun status(line: String?, working: Boolean, waiting: Boolean = false): String =
        if (waiting) WAITING_FOR_OK else preview(line).ifEmpty { if (working) "Working…" else "" }

    /**
     * The run a bot's chat shows as at work, with the line and Stop: its running run, or null. A script job has no
     * run while its script runs (docs/api.md, "The working line": the server makes its run when the script ended
     * with something to show), so no line stands for it; a run of a script that came as running all the same is
     * not at work here either, as on the web page (`working` in `placeStatusLines`).
     */
    fun atWork(runs: List<Run>): Run? = runs.firstOrNull { it.isRunning && it.kind != "script" }

    /**
     * The working line of a bot's chat where Stop is the word at its end (`message-waits`): there for every run
     * Stop can end, [running] ([atWork]), a job's too. As [status]: the app has no words of its own for a job's
     * run, which reads as the server says ("Running <job name>" in its working line) and "Working…" without a line,
     * as on the web page. "" when nothing runs and no line stands.
     */
    fun botLine(line: String?, running: Run?, waiting: Boolean = false): String =
        status(line, working = running != null, waiting = waiting && running != null)

    /** What stands for an activity of the Chief that has no words: a server from before it had words for every tool names the tool alone. */
    const val NO_WORDS = "Working"

    /**
     * The working line of the Chief's chat while it replies ([busy]): what it is doing in the server's words
     * ([activity], [chiefActivity]), which is the whole line as it reads now: its opening line first, then the steps
     * that follow ("Reading nytimes.com", "Waiting for Web Surfer", "Thinking"). [line]: its opening line, which is
     * still sent apart: it stands where the activity has no words (none came yet, or a server from before), as it
     * always did. With neither, "Thinking". "" when it rests. `chiefLine` in `public/opening-line.js` is the web
     * page's side.
     */
    fun chiefLine(line: String?, activity: String?, busy: Boolean): String {
        if (!busy) return ""
        val doing = text(activity)
        val said = if (doing.isNotEmpty() && doing != NO_WORDS) doing else text(line).ifEmpty { doing }
        return "${said.ifEmpty { "Thinking" }}…"
    }

    /**
     * What the Chief is doing in a reply it is still writing, in words: its activity as the server says it
     * (`{ tool, text }`, in the chat's pending reply and on its stream); "" when it said none. The words are the
     * server's, the same as a bot's line for the same step: the app has none of its own for a tool. A server from
     * before it had words for every tool names the tool alone: "Working".
     */
    fun chiefActivity(a: ChiefActivity?): String = if (a == null) "" else text(a.text).ifEmpty { NO_WORDS }

    /** As above, for an `activity` of the stream of the Chief's chat. */
    fun chiefActivity(ev: JsonObject): String = chiefActivity(ChiefActivity(ev.str("tool"), ev.str("text")))

    /** The `features` a feed's `hello` names; null when it names none. */
    fun features(hello: JsonObject): List<String>? = hello.arr("features")?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }

    /** What the feed's `hello` says is going on: each of its `running` runs, with its line when it has one ([ofRun]). */
    fun live(hello: JsonObject, features: Collection<String>? = features(hello)): List<Live>? = hello.arr("running")?.mapNotNull { it as? JsonObject }?.map { r ->
        Live("bot:${r.str("botId")}", r.str("id").ifEmpty { null }, ofRun(r.str("workingLine"), r.str("openingLine"), features), waitsForOk(r["waitingFor"]))
    }

    /** The runs of a list that are still going on, with their lines ([ofRun]). [features]: the server's, as [OpeningLines.features] has them. */
    fun live(runs: List<Run>, features: Collection<String>? = null): List<Live> =
        runs.filter { it.isRunning }.map { Live("bot:${it.botId}", it.id, ofRun(it.workingLine, it.openingLine, features), it.waitsForOk) }

    /** The Chief's chats, with the lines of those it is replying in; none of them when it is not replying. */
    fun live(chief: ChiefOverview): List<Live> = if (chief.busy) chief.chats.map { Live("chief:${it.id}", null, it.openingLine) } else emptyList()
}

/**
 * Something going on now, as one of the server's lists says it: a run of a bot's chat, or the Chief's reply (no run
 * id). [waits]: the run waits for the owner's OK.
 */
data class Live(val chat: String, val runId: String?, val text: String?, val waits: Boolean = false)

/**
 * The lines of the chats, as the server said them. A chat is "bot:<id>" or "chief:<chatId>". A line belongs to a run
 * (the Chief's to the reply it is writing: no run id), and a chat shows the line of the latest run that said one and
 * still goes on. [lines] is what to draw: chat to line. [waits] is the chats with a run that waits for the owner's OK:
 * they say so where their line stood, and the line is kept for when the wait is over.
 * [features]: what the botdot server offers, as its `hello` or its version said: whether a bot's line is its working
 * line or its opening line.
 */
class OpeningLines {
    /** The server's `features`; null while they are not known. A `reset` leaves them: the server is the same. */
    @Volatile var features: Collection<String>? = null
        private set

    /** The server said what it offers (the feed's `hello`, its version), or another botdot was chosen (null). */
    fun serverHas(features: Collection<String>?) { this.features = features }

    private val said = LinkedHashMap<String, LinkedHashMap<String, String>>() // chat -> run id ("" for the Chief) -> text, in the order they were said
    private val held = LinkedHashMap<String, LinkedHashSet<String>>() // chat -> its runs that wait for the owner's OK
    private val saidBy = HashMap<String, String>() // run -> the feed event that said it waits: the same event without the field says the wait is over
    private val ended = LinkedHashSet<String>() // runs that ended: a list fetched before that does not bring their line back
    private val _lines = MutableStateFlow<Map<String, String>>(emptyMap())
    val lines: StateFlow<Map<String, String>> = _lines
    private val _waits = MutableStateFlow<Set<String>>(emptySet())
    val waits: StateFlow<Set<String>> = _waits

    private fun publish() {
        _lines.value = said.mapValues { it.value.values.last() }
        _waits.value = held.keys.toSet()
    }

    /** A run waits for the owner's OK ([on]), or no longer does. True when that changed something. */
    private fun hold(chat: String, runId: String?, on: Boolean): Boolean {
        if (chat.isEmpty() || runId.isNullOrEmpty()) return false
        if (on) return runId !in ended && held.getOrPut(chat) { LinkedHashSet() }.add(runId)
        saidBy.remove(runId)
        val of = held[chat] ?: return false
        if (!of.remove(runId)) return false
        if (of.isEmpty()) held.remove(chat)
        return true
    }

    private fun put(chat: String, line: String?, runId: String?): Boolean {
        val t = OpeningLine.text(line)
        if (chat.isEmpty() || t.isEmpty() || (runId != null && runId in ended)) return false
        val of = said.getOrPut(chat) { LinkedHashMap() }
        if (of[runId.orEmpty()] == t) return false
        of[runId.orEmpty()] = t
        return true
    }

    private fun drop(chat: String, run: String): Boolean {
        val of = said[chat] ?: return false
        if (of.remove(run) == null) return false
        if (of.isEmpty()) said.remove(chat)
        return true
    }

    /** The server said a line (the feed's `opening_line` or `working_line`, a run's stream, a Chief chat's stream): a run's new line takes the place of its last. */
    @Synchronized
    fun say(chat: String, line: String?, runId: String? = null) { if (put(chat, line, runId)) publish() }

    /** A line in the stream of a bot's run: drawn when it is the one this server's line is read from ([OpeningLine.says]). */
    fun streamed(chat: String, ev: RunEvent.Line, runId: String) { if (ev.working == OpeningLine.follows(features)) say(chat, ev.text, runId) }

    /** The server said a run waits for the owner's OK ([on]), or that its wait is over (the feed, announced as its opening line is). */
    @Synchronized
    fun waiting(chat: String, runId: String, on: Boolean) { if (hold(chat, runId, on)) publish() }

    /** The run or the reply ended, whichever way: its line goes, and it waits for nothing. A run's end takes only its own line; without a run id, every line of the chat. */
    @Synchronized
    fun end(chat: String, runId: String? = null) {
        val gone = if (runId == null) (said.remove(chat) != null) or (held.remove(chat) != null) else {
            if (ended.size > 500) ended.clear()
            ended += runId
            drop(chat, runId) or hold(chat, runId, false)
        }
        if (gone) publish()
    }

    /**
     * What is going on now in the chats [within], from one of the server's lists. A line there whose run is no longer
     * among them goes; a line the feed brought meanwhile for a run that is among them stays. A run waits for the
     * owner's OK exactly when the list says so: the field goes from the run when its wait is over.
     */
    @Synchronized
    fun sync(live: List<Live>, within: (chat: String) -> Boolean) {
        var changed = false
        for (chat in said.keys.filter(within)) {
            for (run in said[chat]?.keys?.toList().orEmpty()) {
                if (live.none { it.chat == chat && it.runId.orEmpty() == run }) changed = drop(chat, run) || changed
            }
        }
        for (chat in held.keys.filter(within)) {
            for (run in held[chat]?.toList().orEmpty()) {
                if (live.none { it.chat == chat && it.runId == run && it.waits }) changed = hold(chat, run, false) || changed
            }
        }
        for (x in live) if (within(x.chat)) {
            changed = put(x.chat, x.text, x.runId) || changed
            if (x.waits) changed = hold(x.chat, x.runId, true) || changed
        }
        if (changed) publish()
    }

    /** Forget everything: another botdot, or the feed could not say what was missed and the lists are read again. */
    @Synchronized
    fun clear() { if (said.isNotEmpty() || held.isNotEmpty()) { said.clear(); held.clear(); saidBy.clear(); publish() } }

    /**
     * A run's wait for the owner's OK, as the feed announces it: the way it announces the run's opening line, in an
     * event that names the chat and the run. With `waitingFor` the event says what the run waits for now. The field
     * goes when the wait ends: so does the wait, with the next event of that kind for the run that has none.
     */
    @Synchronized
    private fun announced(ev: FeedEvent) {
        val chat = ev.data.str("chat")
        val run = ev.data.str("runId")
        if (!chat.startsWith("bot:") || run.isEmpty()) return
        val on = when {
            "waitingFor" in ev.data -> OpeningLine.waitsForOk(ev.data["waitingFor"])
            saidBy[run] == ev.type -> false
            else -> return
        }
        val changed = hold(chat, run, on)
        if (on && run !in ended) saidBy[run] = ev.type
        if (changed) publish()
    }

    /** A feed event: what it says about the lines. */
    fun handle(ev: FeedEvent) {
        val d = ev.data
        announced(ev)
        when (ev.type) {
            // A bot's line is read from one of the two, as the server's features say; the Chief's is its opening line.
            "opening_line", "working_line" -> d.str("chat").let { chat ->
                val reads = if (chat.startsWith("bot:")) OpeningLine.says(ev.type, features) else ev.type == "opening_line"
                if (reads) say(chat, d.str("text"), d.str("runId").ifEmpty { null })
            }
            "run_finished" -> end("bot:${d.str("botId")}", d.str("id").ifEmpty { return })
            // The Chief's own reply ended (also when it failed or was stopped); a bot's report in its chat doesn't end it.
            "chief_reply" -> if (d["from"].let { it == null || it is kotlinx.serialization.json.JsonNull }) end("chief:${d.str("chatId")}")
            "reset" -> clear() // the lists are read again
            "hello" -> {
                OpeningLine.features(d)?.let { serverHas(it) }
                OpeningLine.live(d, features)?.let { live -> sync(live) { it.startsWith("bot:") } }
            }
        }
    }
}
