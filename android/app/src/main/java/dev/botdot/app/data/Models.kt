package dev.botdot.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

// What botdot's API returns (docs/api.md). Unknown fields are ignored, so newer servers are fine.

@Serializable
data class VersionInfo(
    val app: String = "",
    val version: String = "",
    val revision: String? = null, // the commit it was built from: it changes with every update, the version doesn't
    val short: String? = null,
    val apiVersion: Int = 0,
    val features: List<String> = emptyList(),
    val frontDoor: Boolean = false, // a front door's own answer, before signing in (ADR 028): botdot is behind it
    val docker: Boolean = false,
    val android: AndroidRelease? = null, // the app this botdot hands out, to update from
) {
    /**
     * Which figure definition this server has, as far as the app can tell: its version and revision, or null when it
     * hands none out (no `figure` in its features). The app asks for the definition again when this changes: an update
     * may bring a new one, and changes the revision though the version stays the same.
     */
    val figureKey: String? get() = if ("figure" in features) "$version ${revision.orEmpty()}" else null
}

@Serializable
data class AndroidRelease(val versionCode: Int = 0, val versionName: String? = null, val sha256: String? = null, val size: Long = 0, val release: ReleaseManifest? = null)

/**
 * How a job's last time went. With `job-line` (docs/api.md) the server writes the whole line for under the job
 * ([text]) and says how many failed runs in a row the job has ([failures], while the last one failed); [status] may
 * then be `missed`: its time passed and it did not run. Both are kept as they came: one of a kind this app does not
 * expect leaves the jobs readable.
 */
@Serializable
data class JobLast(
    val status: String = "", val at: String? = null,
    @SerialName("text") val textValue: JsonElement? = null,
    @SerialName("failures") val failuresValue: JsonElement? = null,
) {
    /** The line for under the job, in the server's words, or null: the app writes its own. */
    val text: String? get() = textValue.textOrNull()

    /** How many failed runs in a row the job has; 0 when the server names none. */
    val failures: Int get() = (failuresValue as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: 0
}

@Serializable
data class Job(
    val id: String,
    val name: String = "",
    val kind: String = "ai",
    val cron: String = "",
    @SerialName("when") val words: String? = null, // its schedule in words, "Every hour, 08:00 to 21:00"; null from a server older than `when`
    val enabled: Boolean = true,
    val approved: Boolean = true,
    val alwaysApprove: Boolean = false, // you trust it: its later changes need no OK
    val nextRunAt: String? = null,
    val prompt: String = "",
    val script: String = "",
    val aiWhen: String? = null,
    val assessment: String = "",
    val createdBy: String? = null,
    val changedBy: String? = null,
    val last: JobLast? = null,
    // A change that waits beside the approved job (`staged-changes`), what its buttons read (`decline-words`,
    // `staged-changes`) and what a yes would start, kept as they came: one of a kind this app does not expect leaves
    // the bots readable. Read them through [change], [no], [yes] and [then].
    @SerialName("change") val changeValue: JsonElement? = null,
    @SerialName("no") val noValue: JsonElement? = null,
    @SerialName("yes") val yesValue: JsonElement? = null,
    @SerialName("then") val thenValue: JsonElement? = null,
    // Whether the owner hears of every run ("always") or only of what it reports ("report-only"), kept as it came.
    @SerialName("notify") val notifyValue: JsonElement? = null,
) {
    /** Its report setting, "always" or "report-only"; null from a server that does not say. */
    val notify: String? get() = notifyValue.textOrNull()

    /** The change that waits for the owner's answer while the job runs on as approved, or null. */
    val change: JobChange? get() = JobChange.of(changeValue)

    /** What its no button reads, in the server's words ("Decline and remove", "Keep as it is"), or null: the app's own. */
    val no: String? get() = noValue.textOrNull()

    /** What its yes button reads, in the server's words ("Approve the change"), or null: the app's own. */
    val yes: String? get() = yesValue.textOrNull()

    /** What a yes would start, where the job itself says it (see [Then]); the feed says it too ([JobThens]). */
    val then: Then? get() = Then.of(thenValue)

    /** It waits for the owner: never approved, or approved with a change beside it. */
    val waits: Boolean get() = !approved || change != null

    /** Who asked for what waits: "chief", "bot" or null. A change says so itself; a new job by who changed it last. */
    val askedBy: String? get() = change?.let { it.by ?: changedBy } ?: changedBy

    /**
     * Whether a yes approves a script: the job runs one, or its waiting change makes it one or carries one. Such a
     * job is answered on its card, where the script shows, and never by "Approve all".
     */
    val touchesScript: Boolean get() = kind == "script" || change?.runsScript == true
}

/**
 * A change to an approved job that waits for the owner (`change` on a job, docs/api.md): the job as proposed. A field
 * the server leaves out, or sends as something else than text, is null here and reads as unchanged. [words]: its
 * schedule in words (`when`). [notify]: its report setting. [aiWhen]: when a script job asks the AI. [by]: "chief" or "bot".
 * [at]: when it was proposed, which tells one change to a job from the next. [summary]: what it changes, in one sentence
 * of whoever proposed it (`change-summary`); null from a server that sends none.
 */
data class JobChange(
    val name: String? = null, val kind: String? = null, val words: String? = null,
    val prompt: String? = null, val script: String? = null, val by: String? = null,
    val notify: String? = null, val aiWhen: String? = null, val at: String? = null, val summary: String? = null,
) {
    /** The job as proposed runs a script: it says so, or it carries one. The card then shows that script. */
    val runsScript: Boolean get() = kind == "script" || !script.isNullOrBlank()

    companion object {
        /** `change` as the server sent it; null when it is no object: nothing waits beside the job. */
        fun of(v: JsonElement?): JobChange? {
            val o = v as? JsonObject ?: return null
            val whole = { key: String -> (o[key] as? JsonPrimitive)?.takeIf { it.isString }?.content }
            return JobChange(o["name"].textOrNull(), o["kind"].textOrNull(), o["when"].textOrNull(), whole("prompt"), whole("script"), o["by"].textOrNull(), o["notify"].textOrNull(), o["aiWhen"].textOrNull(), o["at"].textOrNull(), whole("summary")?.trim()?.ifEmpty { null })
        }
    }
}

@Serializable
data class Bot(
    val id: String,
    val name: String,
    val emoji: String = "🤖",
    val color: String? = null,
    val description: String = "",
    val group: String = "",
    val pinned: Int = 0, // its place right below the Chief (1 = first); 0 = not pinned
    val order: Int = 0, // its place in its group (1 = first); 0 = pinned, or never placed (then A–Z)
    val running: Boolean = false,
    val state: String = "idle", // what its figure shows: idle, working, waiting, needs_you, failed, paused
    val outfit: JsonElement? = null, // what it wears: { hat }, a kit name, "" or a hat drawn inline; null: none
    val computer: String = "none",
    val nextRunAt: String? = null,
    val jobs: List<Job> = emptyList(),
    val prompt: String = "",
    val model: String? = null,
    val effort: String? = null,
    val computerEgress: String = "internet",
    val computerAlwaysOn: Boolean = false,
    val useSkills: Boolean = true,
    val skills: List<String> = emptyList(),
    val disabledSkills: List<String> = emptyList(), // skills from your Claude account or Claude Code switched off for it
    val connectors: List<String> = emptyList(),
    val mayMessageAll: Boolean = false, // it may message every other bot, bots made later too
    val mayMessage: List<String> = emptyList(),
    val unread: Int = 0, // its new replies, as the botdot server counts them; 0 from a server without the feature
    val firstUnread: String? = null, // the run that is the first of them in its chat: the "New" line goes there
    // The owner's messages that wait for it (`message-waits`), kept as they came. Read them through [queued].
    @SerialName("queued") val queuedValue: JsonElement? = null,
    // Its open question to the owner (`asks-you`), kept as it came. Read it through [asks].
    @SerialName("asks") val asksValue: JsonElement? = null,
) {
    /** The owner's messages that wait until it is free, oldest first; none from a server that keeps none. */
    val queued: List<Queued> get() = Queued.list(queuedValue)

    /** What it asks the owner, until the owner writes to it; null when it asks nothing, or the server does not say. */
    val asks: Asks? get() = Asks.of(asksValue)
}

/** A bot's open question to the owner (`asks` on a bot, docs/api.md): [text] in one line, and the run that asked. */
data class Asks(val text: String, val runId: String? = null, val at: String? = null) {
    companion object {
        /** `asks` as the server sent it; null without a question to show. */
        fun of(v: JsonElement?): Asks? {
            val o = v as? JsonObject ?: return null
            return Asks(o["text"].textOrNull() ?: return null, o["runId"].textOrNull(), o["at"].textOrNull())
        }

        /**
         * The bots after the feed's `asks` event about one bot's question (`{ botId, asks }`, `asks` null when it
         * ends): that bot with the question, or without one; the others as they were. The event of the same name
         * about what waits for the owner's OK (`{ waiting, list }`) names no bot and changes nothing here.
         */
        fun on(bots: List<Bot>, ev: FeedEvent): List<Bot> {
            if (ev.type != "asks" || "asks" !in ev.data) return bots
            val id = ev.data["botId"].textOrNull() ?: return bots
            val asks = ev.data["asks"].takeIf { it is JsonObject }
            return bots.map { if (it.id == id) it.copy(asksValue = asks) else it }
        }
    }
}

/**
 * A message of the owner that waits its turn (`queued` on a bot and on a Chief chat, docs/api.md): [text] as the
 * owner wrote it, its files, and when it was sent. [id] is what "Take back" names.
 */
data class Queued(val id: String, val text: String = "", val attachments: List<Attachment> = emptyList(), val at: String? = null) {
    companion object {
        /** The list as the server sent it, each entry read by itself: one without an id cannot be taken back, and is left out. */
        fun list(v: JsonElement?): List<Queued> = (v as? JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            Queued(
                o["id"].textOrNull() ?: return@mapNotNull null,
                (o["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty(),
                attachments(o["attachments"]),
                o["at"].textOrNull(),
            )
        }

        /** Files as a run has them; none when they are not what this app expects. */
        internal fun attachments(v: JsonElement?): List<Attachment> = (v as? JsonArray)?.let { list ->
            runCatching { Api.JSON.decodeFromJsonElement(ListSerializer(Attachment.serializer()), list) }.getOrNull()
        }.orEmpty()

        /**
         * The feed's `queued` event: the chat it is about ("bot:<id>", "chief:<chatId>") and its list as it stands
         * now, as it came. null for any other event, and for one that names no chat or carries no list.
         */
        fun event(ev: FeedEvent): Pair<String, JsonArray>? {
            if (ev.type != "queued") return null
            val chat = ev.data.str("chat").ifEmpty { return null }
            return chat to (ev.data["queued"] as? JsonArray ?: return null)
        }
    }
}

/**
 * What "Run now" answers (docs/api.md): the job started, it waits until the bot is free (`queued: true`), or it was
 * skipped, with the server's reason (`skipped`).
 */
sealed interface RunNow {
    data object Started : RunNow
    data object Queued : RunNow
    data class Skipped(val why: String) : RunNow

    companion object {
        /** From the answer as it came: anything that names neither is a job that started, as before. */
        fun of(answer: String): RunNow {
            val o = runCatching { Api.JSON.parseToJsonElement(answer) as? JsonObject }.getOrNull()
            o?.get("skipped").textOrNull()?.let { return Skipped(it) }
            return if (isTrue(o?.get("queued"))) Queued else Started
        }
    }
}

/**
 * What a tap on a tile, or one of its controls, answers: the tile as it is now, and, when the tap asked a busy bot
 * (`message-waits`), that the bot will do it when it is free (`{ runId, queued: true }`). [tile] is null when the
 * answer carries none this app can read: the Board keeps the one it has.
 */
data class TileTap(val tile: Tile?, val queued: Boolean) {
    companion object {
        fun of(answer: String): TileTap {
            val o = runCatching { Api.JSON.parseToJsonElement(answer) as? JsonObject }.getOrNull()
            val tile = o?.takeIf { it["id"].textOrNull() != null }?.let { runCatching { Api.JSON.decodeFromJsonElement(Tile.serializer(), it) }.getOrNull() }
            return TileTap(tile, isTrue(o?.get("queued")))
        }
    }
}

/** The JSON value `true`, and nothing else. */
internal fun isTrue(v: JsonElement?): Boolean = (v as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true

/**
 * Whether Claude is signed out, from `claude` in the feed's "hello" or the data of its `claude` event
 * (`{ loggedIn }`, docs/api.md). null when it does not say: the server could not tell yet.
 */
fun claudeSignedOut(v: JsonElement?): Boolean? =
    ((v as? JsonObject)?.get("loggedIn") as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull?.let { !it }

/** What botdot newly announces with Milestone 7, "busy and stopped": a message waits, a run says who ended it, a job has its line. */
private val BUSY_AND_STOPPED = setOf("message-waits", "ended-by", "job-line")

/**
 * Whether the apps of this botdot say that Claude is signed out, with a line above the message box and one
 * notification: a botdot that names one of Milestone 7's features. `claude` in the feed is older than that and has
 * no feature of its own; against a botdot from before, where its jobs still start and fail one by one, nothing new
 * is shown. null: its features are not known yet.
 */
fun saysSignedOut(features: Collection<String>?): Boolean = features != null && features.any { it in BUSY_AND_STOPPED }

/** What "Take back" answers: the message's text and files, for the message box. */
data class TakenBack(val text: String, val attachments: List<Attachment>) {
    companion object {
        /** From the answer as it came; what cannot be read is left empty, since the message is gone from the server either way. */
        fun of(answer: String): TakenBack {
            val o = runCatching { Api.JSON.parseToJsonElement(answer) as? JsonObject }.getOrNull()
            return TakenBack((o?.get("text") as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty(), Queued.attachments(o?.get("attachments")))
        }
    }
}

@Serializable
data class Attachment(
    val name: String,
    val file: String,
    val size: Long = 0,
    val readable: String? = null,
)

@Serializable
data class Run(
    val id: String,
    val botId: String = "",
    val botName: String = "",
    val botEmoji: String = "🤖",
    val prompt: String = "",
    val customPrompt: Boolean = false,
    val status: String = "",
    val result: String? = null,
    val error: String? = null,
    val problem: String? = null, // the error said plainly, for showing (the raw error stays in error)
    val trigger: String? = null,
    val jobName: String? = null,
    val kind: String? = null,
    val startedAt: String = "",
    val endedAt: String? = null,
    val costUsd: Double? = null,
    val attachments: List<Attachment>? = null,
    val files: List<Attachment>? = null, // files it attached to its reply
    val fromBot: BotRef? = null, // a run started by another bot's message
    val startedBy: String? = null, // "chief" when the Chief handed the bot this task
    val inbox: List<InboxNote>? = null, // notes other bots left, read at its start
    val sentTo: SentTo? = null, // the latest teammate this run messaged
    val sentToAll: List<SentTo>? = null, // every teammate it messaged, once each
    val choices: List<String>? = null, // quick answers to its closing question
    val questions: List<String>? = null, // several questions at once: a card with a box under each
    val quiet: Boolean = false, // a scheduled run with nothing for the owner: no bubble, no notification
    val learned: List<Learned>? = null, // what it remembered or changed about itself on this run
    val screenshots: Int = 0, // how many screenshots its tools took
    val openingLine: String? = null, // while it runs: what it said it is about to do (OpeningLine)
    val workingLine: String? = null, // while it runs, from a server with `working-line`: what its line reads now (OpeningLine)
    // `continues` and `waitingFor` as the server sends them, kept as they came: one of a kind this app does not
    // expect leaves the chat readable. Read them through [continues] and [waitsForOk].
    @SerialName("continues") val continuesValue: JsonElement? = null,
    @SerialName("waitingFor") val waitingForValue: JsonElement? = null,
    // Who ended it (`ended-by`): "owner", "chief", "signout" or "limit". Kept as it came; read it through [endedBy].
    @SerialName("endedBy") val endedByValue: JsonElement? = null,
    // Its reply holds a question for the owner, what its notification is titled and the question in one line
    // (`asks-you`), kept as they came.
    @SerialName("asks") val asksValue: JsonElement? = null,
    @SerialName("title") val titleValue: JsonElement? = null,
    @SerialName("question") val questionValue: JsonElement? = null,
    // Its bot's colour as the server says it, for a reply in a group whose bot is gone. Kept as it came.
    @SerialName("botColor") val botColorValue: JsonElement? = null,
) {
    val isRunning get() = status == "running"

    /** Its bot's colour as the run carries it, or null. */
    val botColor: String? get() = botColorValue.textOrNull()

    /** Its reply holds a question for the owner (`asks: true`). */
    val asks: Boolean get() = isTrue(asksValue)

    /** What its notification is titled, in the server's words ("Mail Sorter asks"), or null. */
    val title: String? get() = titleValue.textOrNull()

    /** The question its reply asks, in one line and in the server's words, or null: the server sends none. */
    val question: String? get() = questionValue.textOrNull()

    /** The answer of a send to a busy bot (`message-waits`): no run yet, the message waits its turn. */
    val isQueued get() = status == "queued"

    /** Who ended it, or null: it ended by itself, or the server does not say. */
    val endedBy: String? get() = endedByValue.textOrNull()

    /**
     * The earlier run that stopped for the owner's OK and that this run goes on from (`continues`, docs/api.md "What
     * follows a yes"), or null. The request stands once, above that run's reply: this run draws no message of the owner.
     */
    val continues: String? get() = continuesValue.textOrNull()

    /** While it runs: it waits for the owner's OK on an action in a connected app (`waitingFor: "ok"`). */
    val waitsForOk: Boolean get() = isRunning && OpeningLine.waitsForOk(waitingForValue)
}

/** A field as text: a JSON string that is not blank, without the blanks around it. Anything else is none. */
internal fun JsonElement?.textOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.ifEmpty { null }

/**
 * Something a bot learned or changed about itself on a run, a chip under its reply. [chip]: the whole line, as the
 * botdot server wrote it (`memory-chips`, docs/api.md "What a run learned"); kept as it came, read through [line].
 */
@Serializable
data class Learned(val kind: String = "", val text: String = "", @SerialName("chip") val chipValue: JsonElement? = null) {
    /**
     * What the chip reads. Against a server that announces `memory-chips`, the item's `chip`, whole, with no word
     * of the app's own. An item without one (a job, a connected app, a note in a run from before the chips), and
     * every item of a server that does not announce it, is drawn from its kind and `text` as before. [features]:
     * the server's, null while they are not known: what it sent is then printed.
     */
    fun line(features: Collection<String>?): String {
        val chip = chipValue.textOrNull().takeIf { announces(features, MEMORY_CHIPS) }
        return (LEARN_ICON[kind] ?: "🧠") + " " + (chip ?: ((BEFORE_CHIPS[kind] ?: "") + text))
    }

    /** What a tap on the chip opens. A chip about a note opens nothing: memory has no screen. */
    val opens: Opens? get() = when {
        kind == "job" -> Opens.JOBS
        kind == "instructions" || kind == "connector" || kind.startsWith("skill") -> Opens.SETTINGS
        else -> null
    }

    enum class Opens { JOBS, SETTINGS }
}

/** The server's features that say it writes the words of a chip and of a waiting memory change's card. */
const val MEMORY_CHIPS = "memory-chips"
const val MEMORY_CARDS = "memory-cards"

/**
 * Whether the app draws what the feature [name] brings: the server announces it, or its [features] are not known
 * yet (null), and what it sent is then drawn as it came. A server that announces others and not this one is older.
 */
fun announces(features: Collection<String>?, name: String): Boolean = features == null || name in features

// The app's own words for a note in a run from before the chips, which the server sends without `chip`.
private val BEFORE_CHIPS = mapOf("memory" to "Remembered: ", "memory-shared" to "Remembered for all bots: ", "forgot" to "Forgot: ")

private val LEARN_ICON = mapOf("memory-pending" to "⏳", "skill-pending" to "⏳", "forgot" to "🧹", "instructions" to "✏️",
    "skill" to "✦", "skill-updated" to "✦", "job" to "⏰", "connector" to "🔌")

/** What the Chief did while replying: "Created Web Surfer", "Started Coder". */
@Serializable
data class ChiefAction(
    val kind: String = "", val text: String = "", val botId: String? = null, val runId: String? = null,
    // `waits` as the server sends it; anything but words is none. Read it through [waits].
    @SerialName("waits") val waitsValue: JsonElement? = null,
) {
    /** What still waits for the owner's OK, in the server's words ("web access waits for your OK"), or null. */
    val waits: String? get() = (waitsValue as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.ifEmpty { null }

    // "from": a late result, the reply of the bot the Chief had asked ("↩ From Web Surfer").
    val label get() = (mapOf("created" to "✨", "updated" to "✏️", "run" to "→", "deleted" to "🗑", "stopped" to "■", "skill" to "✦", "job" to "⏰", "from" to "↩")[kind]?.let { "$it " } ?: "") + text
}

@Serializable
data class SentTo(val id: String = "", val name: String = "", val emoji: String = "🤖", val color: String? = null, val delivered: String? = null, val text: String? = null) // text: the latest it sent that bot

@Serializable
data class InboxNote(val fromId: String? = null, val from: String = "", val emoji: String? = null, val color: String? = null, val text: String = "", val at: String? = null)

@Serializable
data class ChiefInfo(val id: String = "chief", val name: String = "Chief of Staff", val emoji: String = "🧭")

@Serializable
data class ChiefChatSummary(
    val id: String, val title: String = "New chat", val updatedAt: String = "", val waiting: WaitingPlan? = null,
    val unread: Int = 0, // its new replies
    val firstUnread: Int? = null, // the place of the first of them in the whole chat
    val openingLine: String? = null, // while the Chief replies in it: what it said it is about to do (OpeningLine)
)

/** A bot's plan for the Chief that waits for your "Approve". */
@Serializable
data class WaitingPlan(val from: BotRef = BotRef(), val text: String = "")

@Serializable
data class ChiefOverview(
    val chief: ChiefInfo = ChiefInfo(), val chats: List<ChiefChatSummary> = emptyList(), val busy: Boolean = false,
    val unread: Int = 0, // the new replies of all its chats, for the Chief's one place in the list
)

@Serializable
data class ChiefActivity(val tool: String = "", val text: String? = null)

@Serializable
data class ChiefMessage(
    val role: String,
    val activity: ChiefActivity? = null,
    val text: String = "",
    val attachments: List<Attachment>? = null,
    // `error` as the server sends it: words for the Chief's own failed reply, `true` for a bot's report that
    // didn't finish (its text says why). Read it through [error] and [failed].
    @SerialName("error") val errorValue: JsonElement? = null,
    val pending: Boolean = false,
    val at: String? = null,
    val endedAt: String? = null, // a Chief reply: when it finished
    val from: BotRef? = null, // role "suggestion" or "report": the bot that sent it
    val files: List<Attachment>? = null, // report, and a Chief reply about a bot's result: files the bot attached to its reply
    val status: String? = null, // suggestion: pending | answered | dismissed
    val choices: List<String>? = null, // quick answers to its closing question
    val questions: List<String>? = null, // several questions at once: a card with a box under each
    val actions: List<ChiefAction>? = null, // what it did while replying
    val unasked: Boolean = false, // the Chief wrote it without being asked: it gets 👍 and 👎 (Ratings)
    val rating: String? = null, // an unasked message: "up" or "down" as the owner rated it, or none
) {
    /** Why it failed, in words, or null. */
    val error: String? get() = (errorValue as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** It didn't finish: `error` came as words or as `true`. */
    val failed: Boolean get() = error != null || (errorValue as? JsonPrimitive)?.booleanOrNull == true
}

@Serializable
data class ChiefChat(
    val id: String,
    val title: String = "New chat",
    val messages: List<ChiefMessage> = emptyList(),
    val busy: Boolean = false,
    val offset: Int = 0, // where messages start in the whole chat (a part of a long one)
    val total: Int = -1, // how many the whole chat has; -1: an older botdot, which sends them all
    val unread: Int = 0, // its new replies
    val firstUnread: Int? = null, // the place of the first of them in the whole chat (counted like offset)
    val openingLine: String? = null, // while the Chief replies: what it said it is about to do (OpeningLine)
    // The owner's messages that wait for the reply to end (`message-waits`), kept as they came. Read them through [queued].
    @SerialName("queued") val queuedValue: JsonElement? = null,
) {
    /** The owner's messages that wait until the Chief is free, oldest first. */
    val queued: List<Queued> get() = Queued.list(queuedValue)
}

/** What botdot answers to the report of the chat on screen (POST /api/read). */
@Serializable
data class ReadAnswer(val ok: Boolean = false, val chat: String? = null, val readAt: String? = null, val repeatMs: Long = 0)

/** One line of a run's live stream (?simple): start, a step, text the bot says, end. */
sealed interface RunEvent {
    data class Step(val text: String) : RunEvent
    data class Text(val text: String) : RunEvent
    data class End(val status: String) : RunEvent
    /** It attached a file while it keeps working. */
    data object File : RunEvent
    /** Its line: its opening line, what it said it is about to do; or ([working]) its working line, what the line reads now. */
    data class Line(val text: String, val working: Boolean = false) : RunEvent

    companion object {
        /** One event of the stream as the server sent it; null for one this app does not draw. */
        fun of(o: JsonObject): RunEvent? = when (o.str("type")) {
            "step" -> Step(o.str("text"))
            "text" -> Text(o.str("text"))
            "end" -> End((o["run"] as? JsonObject)?.str("status").orEmpty())
            "file" -> File
            "opening_line" -> Line(o.str("text"))
            "working_line" -> Line(o.str("text"), working = true)
            else -> null
        }
    }
}

/** One event from the live feed (/api/events). */
data class FeedEvent(val id: String?, val type: String, val data: kotlinx.serialization.json.JsonObject)

/** Whether event [id] is one the feed replays from before [hello] (where it stood when we connected): same run of
 *  botdot ("<boot>.<n>"), and not after it. */
internal fun isReplayOf(id: String?, hello: String?): Boolean {
    if (hello == null || id == null || id.substringBeforeLast('.') != hello.substringBeforeLast('.')) return false
    val n = id.substringAfterLast('.').toLongOrNull() ?: return false
    return n <= (hello.substringAfterLast('.').toLongOrNull() ?: return false)
}

// ---------- things that need the owner (phase 2) ----------

@Serializable
data class BotRef(val id: String = "", val name: String = "", val emoji: String = "🤖", val color: String? = null)

/** A message the search box found: a bot's run (runId, bot, fromBot between bots) or a Chief reply (chatId, index). snippet marks matches with «…». */
@Serializable
data class ChatHit(
    val runId: String? = null, val bot: BotRef? = null, val fromBot: BotRef? = null,
    val chatId: String? = null, val index: Int? = null, val title: String? = null,
    val at: String? = null, val snippet: String = "",
)

/**
 * Something a bot (or the Chief) asked you for: a permission it lacks, a skill to install from a link, or a tool to
 * install on the botdot server for one bot ([bot]).
 */
@Serializable
data class Ask(
    val id: String,
    val kind: String = "permission", // "permission" | "skill" | "tool" | "bot-change" | "connector-action"
    val permission: String? = null,
    val reason: String = "",
    val bot: BotRef? = null,
    val forBots: List<BotRef> = emptyList(),
    val url: String = "",
    val skill: AskSkill? = null,
    val what: AskWhat? = null,
    // The card's title, which a changed bot and an action in a connected app now get in the owner's words. Kept as
    // it came, like the fields below; read it through [title].
    @SerialName("title") val titleValue: JsonElement? = null,
    val details: String = "",
    // A tool to install: what its card shows, as the server wrote it (see ToolCard). These five are kept as they
    // came: one of them of a kind this app does not expect is left out of the card, and the asks are still read.
    val meta: JsonElement? = null,
    val body: JsonElement? = null,
    val warning: JsonElement? = null,
    val facts: JsonElement? = null,
    val tool: JsonElement? = null,
    // What says who carries on after the yes, who asked for a changed bot and what changes, and what an action in a
    // connected app sends and whether its run still waits (docs/api.md, "What follows a yes"). Kept as they came,
    // like the five above: one of a kind this app does not expect leaves today's card, and the asks are still read.
    @SerialName("then") val thenValue: JsonElement? = null,
    @SerialName("by") val byValue: JsonElement? = null,
    @SerialName("parts") val partsValue: JsonElement? = null,
    @SerialName("rows") val rowsValue: JsonElement? = null,
    @SerialName("held") val heldValue: JsonElement? = null,
    @SerialName("stoppedAt") val stoppedAtValue: JsonElement? = null,
    // What the yes button of a changed bot reads, and whether an action is too long to show in full ("A changed
    // bot" and "An action in a connected app"). Kept as they came, like the fields above.
    @SerialName("yes") val yesValue: JsonElement? = null,
    @SerialName("more") val moreValue: JsonElement? = null,
    // A skill a bot wrote after its run read content from others (docs/api.md, "A skill that waits"): `written`,
    // and the server's line for it (`text`). Kept as they came, like the fields above.
    @SerialName("written") val writtenValue: JsonElement? = null,
    @SerialName("text") val textValue: JsonElement? = null,
    // The group it was asked in (docs/api.md, "A card and a question in a group"), kept as it came. Read it through [group].
    @SerialName("groupId") val groupIdValue: JsonElement? = null,
    @SerialName("groupName") val groupNameValue: JsonElement? = null,
) {
    /** The group it was asked in, or null: a card of its bot's own chat. */
    val group: GroupRef? get() = GroupRef.of(groupIdValue, groupNameValue)

    /** A skill the bot wrote itself, which waits for the owner's OK: its card shows the whole text a yes would save. */
    val written: Boolean get() = kind == "skill" && isTrue(writtenValue)

    /** The server's line for the ask ("Wants to keep a skill it wrote: “weekly-roundup”"); "" when it sent none. */
    val line: String get() = textValue.textOrNull().orEmpty()

    /** The card's title as the server wrote it; "" when it sent none, or one that is no text. */
    val title: String get() = titleValue.textOrNull().orEmpty()

    /** What a yes would start, or null: the yes only changes the setting, or the server says nothing of it. */
    val then: Then? get() = Then.of(thenValue)

    /** A changed bot that the Chief asked for (`by: "chief"`): its card stands in the Chief's chat too. */
    val byChief: Boolean get() = byValue.textOrNull() == "chief"

    /**
     * What a bot change changes, one entry per field, or none: the card then shows `details`. All of them or none:
     * with one entry this app cannot read the card would show less than the yes approves. An entry is read when it
     * has a label, what the field becomes as text, and what it was either left out or as text.
     */
    val parts: List<ChangedPart> get() = whole(partsValue) { o ->
        val label = o["label"].textOrNull() ?: return@whole null
        val was = when (val w = o["was"]) {
            null, JsonNull -> null
            else -> (w as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim() ?: return@whole null
        }
        if (said(o["now"])) ChangedPart(label, was, ToolCard.text(o["now"])) else null
    }

    /** What an action in a connected app sends, as rows of a label and its value, or none: the card then shows `details`. All of them or none, as [parts]. */
    val rows: List<ToolCard.Fact> get() = whole(rowsValue) { o ->
        ToolCard.Fact(ToolCard.text(o["label"]), ToolCard.text(o["value"])).takeIf { it.label.isNotEmpty() && said(o["value"]) }
    }

    /** A connected-app action: true while its run waits for the answer, false once it stopped waiting; null when the server does not say. */
    val held: Boolean? get() = (heldValue as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

    /** When the run stopped waiting for the answer, as the server wrote it. */
    val stoppedAt: String? get() = stoppedAtValue.textOrNull()

    /** What the yes button reads, in the server's word ("Allow"), or null: the app's own "Approve". */
    val yes: String? get() = yesValue.textOrNull()

    /**
     * Whether a row of a connected-app action was clipped: `more: true` on the row, as the feed's short form marks
     * it. Such a value is less than the action sends, so the card that draws it takes no yes. No row of
     * `GET /api/asks` is clipped.
     */
    val rowsCut: Boolean get() = (rowsValue as? JsonArray).orEmpty().any { isTrue((it as? JsonObject)?.get("more")) }

    /**
     * Whether the action is too long to show in full: `more: true` on the ask, beside its rows. In `GET /api/asks`,
     * where the app's cards come from, the rows are then the first that fit, each whole, and the server refuses
     * "Allow once": it would send what no card shows.
     */
    val tooLong: Boolean get() = isTrue(moreValue)

    companion object {
        /** A value the card can show: text (also empty: an email without a subject) or a number. */
        private fun said(v: JsonElement?): Boolean = v is JsonPrimitive && (v.isString || ToolCard.text(v).isNotEmpty())

        /** Every entry of a list read with [read], or nothing when the list is none or one entry cannot be read. */
        private fun <T : Any> whole(list: JsonElement?, read: (JsonObject) -> T?): List<T> =
            (list as? JsonArray).orEmpty().map { (it as? JsonObject)?.let(read) ?: return emptyList() }

        /**
         * The asks of `GET /api/asks`, each read by itself: one this app cannot read is left out, and the others
         * are still there to answer.
         */
        fun list(answer: String): List<Ask> = (Api.JSON.parseToJsonElement(answer) as JsonArray)
            .mapNotNull { runCatching { Api.JSON.decodeFromJsonElement(serializer(), it) }.getOrNull() }
    }
}

/**
 * Whether the ask's card stands at the end of the chat [scope]: a bot's id, or "chief" for the Chief's chats. A bot's
 * chat has what that bot asked for; the Chief's, the skills the Chief asked for. A tool to install is in both, as on
 * the web page: the Chief asked for it, and it is installed for that bot. So is a changed bot that the Chief asked
 * for: the card is where the owner asked, and in the chat of the bot it changes. A card asked in a group
 * (`groupId`) stands in that group's chat ([scope] "group:<id>") and nowhere else.
 */
fun Ask.standsInChat(scope: String): Boolean = when {
    group != null -> groupOfChat(scope) == group?.id // asked in a group: at the end of that group's chat, and in no other
    groupOfChat(scope) != null -> false
    ToolCard.isTool(this) || (kind == "bot-change" && byChief) -> scope == "chief" || bot?.id == scope
    scope == "chief" -> kind == "skill" && bot == null
    else -> bot?.id == scope
}

/**
 * What a yes on a card would start (`then`, docs/api.md "What follows a yes"): the server's sentence, shown on the
 * card as it is. [chatId] and [here] when the Chief carries on: the Chief chat it does so in, and the sentence for a
 * card drawn in that chat.
 */
data class Then(val text: String, val chatId: String? = null, val here: String? = null) {
    /** The card's line: [here] on a card that stands in the Chief chat [chiefChat] it speaks of, [text] everywhere else. */
    fun line(chiefChat: String? = null): String = here?.takeIf { chatId != null && chatId == chiefChat } ?: text

    companion object {
        /** `then` as the server sent it; null without a sentence to show. */
        fun of(v: JsonElement?): Then? {
            val o = v as? JsonObject ?: return null
            return Then(o["text"].textOrNull() ?: return null, o["chatId"].textOrNull(), o["here"].textOrNull())
        }

        /**
         * Who carries on after the yes on each waiting job, from the feed's `approvals`: "<botId>/<jobId>" to the
         * job's `then`. null when it lists no jobs.
         */
        fun ofJobs(approvals: JsonObject): Map<String, Then>? = approvals.arr("jobs")?.mapNotNull { j ->
            (j as? JsonObject)?.let { o -> of(o["then"])?.let { "${o.str("botId")}/${o.str("jobId")}" to it } }
        }?.toMap()
    }
}

/**
 * What the owner's yes started (`carriesOn` in its answer): the server's words, printed after the app's own word
 * for the answer ("Allowed · it carries on").
 */
data class CarriesOn(val text: String) {
    companion object {
        /** From the answer of a yes, as it came. null when it names nothing, or is not what this app expects: the yes still went. */
        fun of(answer: String): CarriesOn? = runCatching {
            ((Api.JSON.parseToJsonElement(answer) as? JsonObject)?.get("carriesOn") as? JsonObject)?.get("text").textOrNull()?.let(::CarriesOn)
        }.getOrNull()
    }
}

/**
 * What the server answers to a yes or a no on a card: its own words for an answered card ([text]: "Declined and
 * removed", "Changed: daily at 07:00", "Kept as it was: daily at 08:00"), whether a no kept an approved job or tile
 * as it was ([kept]), and what a yes started ([carriesOn]). All of it is none from a server that says none of it.
 */
data class Answered(val text: String? = null, val kept: Boolean = false, val carriesOn: CarriesOn? = null) {
    companion object {
        /** From the answer as it came. What is not what this app expects is left out: the answer still went. */
        fun of(answer: String): Answered {
            val o = runCatching { Api.JSON.parseToJsonElement(answer) as? JsonObject }.getOrNull()
            return Answered(o?.get("text").textOrNull(), isTrue(o?.get("kept")), CarriesOn.of(answer))
        }
    }
}

/** One changed field of a bot change (`parts`): a text has what it [was] and what it is [now]; anything else has no [was]. */
data class ChangedPart(val label: String, val was: String?, val now: String)

/** The skill of a skill ask. [instructions]: of a skill a bot wrote, the whole text a yes would save (`GET /api/asks`). */
@Serializable
data class AskSkill(val name: String = "", val description: String = "", val files: Int = 0, val exists: Boolean = false, val instructions: String = "")

@Serializable
data class AskWhat(val label: String = "", val hint: String = "")

@Serializable
data class CardRef(val id: String = "", val name: String = "", val brand: String? = null, val last4: String? = null)

@Serializable
data class ExistingLogin(val id: String, val name: String = "", val username: String = "", val allowed: Boolean = false)

/** A login saved for another website than the one a bot asks a login for (see OtherLogins). */
@Serializable
data class OtherLogin(val id: String, val name: String = "", val username: String = "", val site: String = "")

/** A bot asking for a login ("login") or to pay with a saved card ("card"). */
@Serializable
data class LoginRequest(
    val id: String,
    val kind: String = "login",
    // What the bot or the Chief asked for: login, api-token or other (VaultTypes).
    val type: String = "login",
    val site: String = "",
    val name: String = "",
    val username: String = "",
    val reason: String = "",
    val from: String = "bot",
    val amount: String = "",
    val card: CardRef? = null,
    val bot: BotRef? = null,
    val existing: List<ExistingLogin> = emptyList(),
    // The saved logins of other websites; a server from before them sends none.
    val others: List<OtherLogin> = emptyList(),
    // The group it was asked in (docs/api.md, "A card and a question in a group"), kept as it came. Read it through [group].
    @SerialName("groupId") val groupIdValue: JsonElement? = null,
    @SerialName("groupName") val groupNameValue: JsonElement? = null,
) {
    /** The group it was asked in, or null: a card of its bot's own chat. */
    val group: GroupRef? get() = GroupRef.of(groupIdValue, groupNameValue)
}

@Serializable
data class BitwardenStatus(
    val installed: Boolean = true,
    val configured: Boolean = false,
    val unlocked: Boolean = false,
    val email: String? = null,
    val server: String? = null,
    val items: Int? = null,
    val lastSync: String? = null,
    val error: String? = null,
    val wantedBy: BotRef? = null,
)

@Serializable
data class NoteRef(val id: String = "", val text: String = "")

/**
 * A memory change that waits for the owner's OK: one to the shared memory from a run that read outside content, or
 * a guarded one (a change to what the owner said, and a forget that waits; docs/api.md, "The contract"). The card's
 * words are the server's, kept as they came and read through [memoryCard].
 */
@Serializable
data class MemoryChange(
    val id: String,
    val action: String = "add", // "add" | "edit" | "remove" | "erase" (a forget that waits)
    val owner: String = "",
    val text: String = "",
    val topic: String = "",
    val by: String? = null,
    val botId: String? = null,
    val reason: String = "",
    val at: String? = null,
    val current: NoteRef? = null,
    val bot: BotRef? = null,
    @SerialName("title") val titleValue: JsonElement? = null,
    @SerialName("meta") val metaValue: JsonElement? = null,
    @SerialName("yes") val yesValue: JsonElement? = null,
    @SerialName("no") val noValue: JsonElement? = null,
    @SerialName("guarded") val guardedValue: JsonElement? = null,
    // The group it was asked in (docs/api.md, "A card and a question in a group"), kept as it came. Read it through [group].
    @SerialName("groupId") val groupIdValue: JsonElement? = null,
    @SerialName("groupName") val groupNameValue: JsonElement? = null,
) {
    /** The group it was asked in, or null: a card of its bot's own chat. */
    val group: GroupRef? get() = GroupRef.of(groupIdValue, groupNameValue)

    /** A guarded change: a card of its own, never part of "Approve all" or its count. */
    val guarded: Boolean get() = isTrue(guardedValue)
}

/**
 * What the card of a waiting memory change shows. [now]: the note that comes, the note that goes, or what a forget
 * would erase. [was]: what a change takes away; with [oneBlock] it stands struck above [now] in one block, so that a
 * closed card shows the start of both, as the web page draws it. Without, each is a block of its own, as before.
 */
data class MemoryCard(val title: String, val meta: String, val was: String?, val now: String, val yes: String, val no: String, val oneBlock: Boolean = false)

/**
 * The card of [m]. Against a server that announces `memory-cards` and sends them, its title, why it waits and
 * both buttons are the server's words ([cardWords]), the same in every app, and the app adds none. Otherwise the
 * card reads as it did before: the app's titles, "Now: …" and "New: …", and a yes that reads "Forget it" for a removal.
 */
fun memoryCard(m: MemoryChange, features: Collection<String>?): MemoryCard {
    val current = m.current?.text?.trim().orEmpty()
    val text = m.text.trim()
    // A guarded change is never drawn in the words of a change to the shared memory: without the server's (a
    // server that breaks the contract), the app's copy of them, so that no "Approve" stands on a forget.
    val words = cardWords(features, m.titleValue, m.yesValue, m.noValue) ?: guardedWords(m.action).takeIf { m.guarded }
    if (words != null) {
        val meta = listOfNotNull(m.metaValue.textOrNull(), m.reason.trim().ifEmpty { null }).joinToString(" · ")
        return when (m.action) {
            "edit" -> MemoryCard(words.title, meta, current.takeIf { it.isNotEmpty() && it != text }, text, words.yes, words.no, oneBlock = true)
            "remove" -> MemoryCard(words.title, meta, null, current, words.yes, words.no)
            else -> MemoryCard(words.title, meta, null, text, words.yes, words.no)
        }
    }
    val own = when (m.action) { "edit" -> "Change in the shared memory"; "remove" -> "Remove from the shared memory"; else -> "Add to the shared memory" }
    val meta = listOfNotNull("after reading outside content", m.reason.takeIf { it.isNotBlank() }).joinToString(" · ")
    return MemoryCard(own, meta, current.takeIf { it.isNotEmpty() && m.action != "add" }?.let { "Now: $it" },
        if (m.text.isBlank()) "" else if (m.action == "edit") "New: ${m.text}" else m.text, if (m.action == "remove") "Forget it" else "Approve", "Decline")
}

/** The title and the two buttons of a waiting memory change. */
data class CardWords(val title: String, val yes: String, val no: String)

/**
 * The server's words for a waiting memory change, for its card and for its notification alike: all three, from a
 * server that announces `memory-cards` (or whose [features] are not known yet). null when it announces none or one
 * of them is missing or no text: the change then reads as it did before.
 */
fun cardWords(features: Collection<String>?, title: JsonElement?, yes: JsonElement?, no: JsonElement?): CardWords? {
    if (!announces(features, MEMORY_CARDS)) return null
    return CardWords(title.textOrNull() ?: return null, yes.textOrNull() ?: return null, no.textOrNull() ?: return null)
}

/** The words of a guarded change as docs/api.md has them ("A waiting memory change"), for one that came without. */
private fun guardedWords(action: String): CardWords = when (action) {
    "erase" -> CardWords("Forget for good", "Forget for good", "Keep")
    "remove" -> CardWords("Remove what you said", "Remove it", "Keep it")
    else -> CardWords("Change what you said", "Change it", "Keep it")
}

// ---------- phase 3: settings, skills, connectors ----------

@Serializable
data class AppSettings(val defaultModel: String = "", val defaultEffort: String = "", val chiefModel: String = "", val chiefEffort: String = "", val chiefRules: String = "")

@Serializable
data class ModelChoice(val id: String, val label: String = "", val group: String? = null, val note: String? = null, val effort: Boolean = true)

@Serializable
data class EffortChoice(val id: String, val label: String = "", val note: String? = null)

@Serializable
data class SettingsInfo(val settings: AppSettings = AppSettings(), val models: List<ModelChoice> = emptyList(), val efforts: List<EffortChoice> = emptyList())

@Serializable
data class BackupInfo(val configured: Boolean = false, val running: Boolean = false, val error: String? = null, val last: BackupFile? = null, val count: Int = 0)

@Serializable
data class BackupFile(val name: String, val size: Long = 0, val at: String = "")

@Serializable
data class Skill(val name: String, val description: String = "", val instructions: String = "", val source: String? = null, val createdBy: String? = null, val usedBy: List<String> = emptyList(),
                 val sourceUrl: String? = null, val fileCount: Int = 1)

@Serializable
data class BuiltinSkill(val name: String, val origin: String = "", val description: String = "")

@Serializable
data class SkillsInfo(val library: List<Skill> = emptyList(), val machine: List<BuiltinSkill> = emptyList(), val builtin: List<BuiltinSkill> = emptyList())

@Serializable
data class AppInfo(val slug: String = "", val name: String = "", val description: String? = null, val logo: String? = null)

@Serializable
data class Connection(val id: String, val toolkit: String = "", val status: String = "", val app: AppInfo? = null, val usedBy: List<String> = emptyList())

@Serializable
data class ConnectorsInfo(val configured: Boolean = false, val keyHint: String? = null, val error: String? = null, val connections: List<Connection> = emptyList())

@Serializable
data class CatalogApp(val slug: String, val name: String = "", val description: String? = null)

@Serializable
data class Catalog(val items: List<CatalogApp> = emptyList())

@Serializable
data class ConnectLink(val redirectUrl: String? = null, val noAuth: Boolean = false)

@Serializable
data class ClaudeStatus(val installed: Boolean = true, val loggedIn: Boolean = false, val email: String? = null, val method: String? = null, val fromEnv: Boolean = false, val error: String? = null)

/** What a sign-in answers (docs/api.md, `POST /api/setup/claude/code`): `claude`, the status after it. */
@Serializable
data class ClaudeAnswer(val claude: ClaudeStatus? = null)

/** `claude` of a sign-in's answer; null when the answer has none, as from an older server, or cannot be read. */
fun claudeOfAnswer(body: String): ClaudeStatus? = runCatching { Api.JSON.decodeFromString<ClaudeAnswer>(body).claude }.getOrNull()

/** The sentence of a check that could not tell (`error`): the sign-in is not known then. Null when the check could tell. */
fun claudeCouldNotTell(claude: ClaudeStatus?): String? = claude?.error?.takeIf { it.isNotBlank() }

@Serializable
data class SetupInfo(val done: Boolean = false, val timezone: String = "", val claude: ClaudeStatus = ClaudeStatus(), val running: Int = 0)

@Serializable
data class LoginLink(val url: String)

@Serializable
data class ComputerInfo(val state: String = "none")

/** The Board (GET /api/dashboard): headings in order, the tiles, and those whose script waits for your OK. */
@Serializable
data class Dashboard(val sections: List<String> = emptyList(), val tiles: List<Tile> = emptyList(), val pending: List<Tile> = emptyList(), val suggestions: List<TileSuggestion> = emptyList()) {
    /**
     * The tiles that wait for the owner, each once: those never approved ([pending]) and the approved ones with a
     * change beside them (`staged-changes`), wherever the server lists those.
     */
    val waiting: List<Tile> get() = (pending + tiles.filter { it.change != null }).distinctBy { it.id }
}

/** A tile a bot suggested: it becomes one when you tap Add. [tile] has its scripts, if any. */
@Serializable
data class TileSuggestion(
    val id: String, val bot: String? = null, val reason: String = "", val tile: SuggestedTile = SuggestedTile(),
    @SerialName("then") val thenValue: JsonElement? = null, // what an Add would start, kept as it came
) {
    /** What an Add would start, or null (see [Then]). */
    val then: Then? get() = Then.of(thenValue)
}

@Serializable
data class SuggestedTile(val kind: String = "value", val title: String = "", val section: String = "", val wide: Boolean = false, val scripts: List<String> = emptyList())

/**
 * A tile: switch, button, value, list, note, group, or custom (built from blocks). [look] is what to draw,
 * already filled in by botdot (its dot, face, panel and what a tap does); [value] is the older way to read it.
 * The sources are only in [Dashboard.pending].
 */
@Serializable
data class Tile(
    val id: String,
    val kind: String = "value",
    val title: String = "",
    val section: String = "",
    val parent: String? = null, // the group tile it's in
    val wide: Boolean = false,
    val size: String = "small", // small, wide, big (two across, two high), row
    val color: String? = null,
    val bot: String? = null,
    val unit: String = "",
    val look: TileLook? = null,
    val approved: Boolean = true,
    val createdBy: String? = null,
    val changedBy: String? = null,
    val tappable: Boolean = false,
    val asks: Boolean = false, // a tap starts a run of its bot
    val value: kotlinx.serialization.json.JsonElement? = null,
    val error: String? = null,
    val read: TileSource? = null,
    @kotlinx.serialization.SerialName("do") val doIt: TileSource? = null,
    val turnOn: TileSource? = null,
    val turnOff: TileSource? = null,
    // The named reads and actions of a tile built from blocks, and the server's own list of every script the tile
    // runs (`scripts`), kept as they came: one of a kind this app does not expect leaves the Board readable.
    val reads: JsonElement? = null,
    val actions: JsonElement? = null,
    @SerialName("scripts") val scriptList: JsonElement? = null,
    @SerialName("then") val thenValue: JsonElement? = null, // a waiting tile: what a yes would start, kept as it came
    // A change that waits beside the approved tile, and what its buttons read, kept as they came (as on a [Job]).
    @SerialName("change") val changeValue: JsonElement? = null,
    @SerialName("no") val noValue: JsonElement? = null,
    @SerialName("yes") val yesValue: JsonElement? = null,
) {
    /** What a yes on a waiting tile would start, or null (see [Then]). */
    val then: Then? get() = Then.of(thenValue)

    /** The change that waits for the owner's answer while the tile works on as approved, or null. */
    val change: TileChange? get() = TileChange.of(changeValue)

    /** What its no button reads, in the server's words, or null: the app's own. */
    val no: String? get() = noValue.textOrNull()

    /** What its yes button reads, in the server's words, or null: the app's own. */
    val yes: String? get() = yesValue.textOrNull()

    /** Who asked for what waits: "chief", "bot" or null. A change says so itself; a new tile by who changed it last. */
    val askedBy: String? get() = change?.let { it.by ?: changedBy } ?: changedBy

    /**
     * Every script the card of a waiting tile lists: the server's `scripts`, or, from a server that sends none, those
     * of `read`, `do`, `turnOn`, `turnOff` and of every named read and action, as the web page gathers them.
     */
    val scripts: List<String> get() = (scriptList as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { s -> s.isString }?.content }?.takeIf { it.isNotEmpty() }
        ?: (listOfNotNull(read, doIt, turnOn, turnOff) + named(reads) + named(actions)).filter { it.type == "script" }.map { it.script }

    private fun named(sources: JsonElement?): List<TileSource> = (sources as? JsonObject)?.values.orEmpty().mapNotNull { v ->
        (v as? JsonObject)?.let { o -> TileSource(o.str("type"), o.str("script")) }
    }
}

@Serializable
data class TileSource(val type: String = "", val script: String = "")

/** How a tile is drawn. tap: toggle, act, refresh, panel, chat, group or none. short: a few words for one line. */
@Serializable
data class TileLook(val dot: TileDot? = null, val face: List<Block> = emptyList(), val panel: List<Block>? = null, val tap: String = "none", val short: String = "")

/** filled: null while it isn't known. color: "#rrggbb", a theme name (ok, warn, bad, faint, muted, text), or null for the tile's own. */
@Serializable
data class TileDot(val filled: Boolean? = true, val color: String? = null, val big: Boolean = false)

/**
 * One block of a tile's face or panel (lib/tile-blocks.js), already filled in. Controls (switch, button,
 * slider, color, choice) have a [key]: using one is POST /dashboard/tiles/:id/act { block: key, value }.
 */
@Serializable
data class Block(
    val type: String,
    val key: String? = null,
    val text: String? = null,
    val label: String? = null,
    val size: String? = null,
    val muted: Boolean = false,
    val markdown: Boolean = false,
    val lines: Int? = null,
    val unit: String? = null,
    val color: String? = null,
    val filled: Boolean? = true,
    val big: Boolean = false,
    val items: List<String> = emptyList(),
    val ratio: Double? = null,
    val points: List<Double> = emptyList(),
    val src: String? = null,
    val height: String? = null,
    val fit: String? = null,
    val on: Boolean? = null,
    val value: kotlinx.serialization.json.JsonElement? = null,
    val min: Double = 0.0,
    val max: Double = 100.0,
    val step: Double = 1.0,
    val percent: Boolean = false,
    val options: List<BlockOption> = emptyList(),
    val blocks: List<Block> = emptyList(),
)

@Serializable
data class BlockOption(val label: String, val value: kotlinx.serialization.json.JsonElement)

/** Something in the vault a bot may use: a login, or from Bitwarden also a card or an identity. Secrets never come back. */
@Serializable
data class VaultItem(
    val id: String,
    val name: String,
    val kind: String = "login",
    // Of a login-kind item: login, api-token or other (VaultTypes); a server from before the types sends none.
    val type: String = "login",
    val site: String = "",
    val username: String = "",
    val allowedBots: List<String> = emptyList(),
    val allowedHosts: List<String> = emptyList(),
    val insecureTls: Boolean = false,
    // "Usable in its computer" (docs/api.md, `vault-in-computer`): a bot may use it in a command on its own computer.
    val inComputer: Boolean = false,
    val hasTotp: Boolean = false,
    val reprompt: Boolean = false,
    val brand: String? = null,
    val last4: String? = null,
    val expiry: String? = null,
    val holder: String? = null,
    val email: String? = null,
)

/**
 * A change to an approved tile that waits for the owner (`change` on a tile, docs/api.md): the tile as proposed, with
 * every script it would run ([scripts]; null when the server lists none: the card then shows none as proposed, never
 * the approved ones). [by]: "chief" or "bot". [at]: when it was proposed, which tells one change to a tile from the next.
 */
data class TileChange(val title: String? = null, val scripts: List<String>? = null, val by: String? = null, val at: String? = null) {
    companion object {
        /** `change` as the server sent it; null when it is no object: nothing waits beside the tile. */
        fun of(v: JsonElement?): TileChange? {
            val o = v as? JsonObject ?: return null
            val scripts = (o["scripts"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { s -> s.isString }?.content }
            return TileChange(o["title"].textOrNull(), scripts, o["by"].textOrNull() ?: o["changedBy"].textOrNull(), o["at"].textOrNull())
        }
    }
}
