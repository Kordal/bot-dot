package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

// Groups (Milestone 10; docs/api.md, "Groups"). A group is one chat with two to six bots, its members: the owner
// writes once, the botdot server gives the turns, and every reply stands under its bot's name. The app draws what
// the server says and decides nothing. Against a server without `groups` in `features` there are no groups and
// nothing here is offered. `public/groups.js` is the web page's side of the same rules.

/** The feature of a botdot server that has groups. */
const val GROUPS = "groups"

/** Whether groups are offered: the server announces them. While its features are not known yet: no. */
fun hasGroups(features: Collection<String>?): Boolean = features != null && GROUPS in features

/** The groups of a botdot server with these [features]: one without groups is asked nothing, and has none. */
suspend fun Api.groupsOf(features: Collection<String>?): List<Group> = if (hasGroups(features)) groups() else emptyList()

/** A group has two to six bots; the server refuses anything else in its own words. */
const val GROUP_MAX = 6

/** The key of a group's chat, wherever a chat has a key: its read report, its notification, its message box. */
fun groupKey(id: String): String = "group:$id"

/** The group of a chat's key, or null for a bot's chat and a Chief chat. */
fun groupOfChat(chat: String?): String? = chat?.takeIf { it.startsWith("group:") }?.removePrefix("group:")?.ifEmpty { null }

/**
 * A group, with what its chat holds now (`GET /api/group-chats`). [members]: bot ids, in the group's order.
 * [category], [pinned] and [order]: its place in the list, as a bot's `group`, `pinned` and `order`, counted among
 * the groups. What its chat holds is kept as it came: one of a kind this app does not expect leaves the groups readable.
 */
@Serializable
data class Group(
    val id: String,
    val name: String = "",
    @SerialName("members") val membersValue: JsonElement? = null,
    val category: String = "",
    val pinned: Int = 0,
    val order: Int = 0,
    val unread: Int = 0,
    val firstUnread: String? = null,
    @SerialName("last") val lastValue: JsonElement? = null,
    @SerialName("working") val workingValue: JsonElement? = null,
    @SerialName("asks") val asksValue: JsonElement? = null,
    @SerialName("limit") val limitValue: JsonElement? = null,
) {
    /** Its members' ids, in the group's order. */
    val members: List<String> get() = texts(membersValue)

    /** Its newest reply, for the row's preview; null while it has none. */
    val last: GroupLast? get() = GroupLast.of(lastValue)

    /** The ids of the members at work in it. */
    val working: List<String> get() = texts(workingValue)

    /** Its open question to the owner, or null. */
    val asks: GroupAsks? get() = GroupAsks.of(asksValue)

    /** The line that stopped at the limit of replies, or null. */
    val limit: GroupLimit? get() = GroupLimit.of(limitValue)

    companion object {
        /** The groups of `GET /api/group-chats`, each read by itself: one this app cannot read is left out. */
        fun list(answer: String): List<Group> = (runCatching { Api.JSON.parseToJsonElement(answer) }.getOrNull() as? JsonArray).orEmpty()
            .mapNotNull { runCatching { Api.JSON.decodeFromJsonElement(serializer(), it) }.getOrNull() }
    }
}

/** A list of ids as the server sent it; what is no text in it is left out. */
private fun texts(v: JsonElement?): List<String> = (v as? JsonArray).orEmpty().mapNotNull { it.textOrNull() }

/** A text as it was written, blanks and all (a message's `text`); "" when it is none. */
private fun JsonElement?.whole(): String = (this as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

/** A group's newest reply (`last`): who wrote it, how it ended, and its first words, or its problem when it failed. */
data class GroupLast(val runId: String?, val botId: String, val botName: String, val status: String, val at: String?, val text: String) {
    companion object {
        fun of(v: JsonElement?): GroupLast? {
            val o = v as? JsonObject ?: return null
            return GroupLast(o["runId"].textOrNull(), o["botId"].textOrNull() ?: return null, o["botName"].textOrNull().orEmpty(), o["status"].textOrNull().orEmpty(), o["at"].textOrNull(), o["text"].whole())
        }
    }
}

/** A group's open question (`asks`): the member that asks, the question in one line, and the reply that asked. */
data class GroupAsks(val botId: String, val botName: String, val text: String, val runId: String?, val at: String? = null) {
    companion object {
        fun of(v: JsonElement?): GroupAsks? {
            val o = v as? JsonObject ?: return null
            return GroupAsks(o["botId"].textOrNull() ?: return null, o["botName"].textOrNull().orEmpty(), o["text"].textOrNull().orEmpty(), o["runId"].textOrNull(), o["at"].textOrNull())
        }
    }
}

/** A line of the group that stopped at the limit (`limit`): the server's sentence, to draw with "Go on". */
data class GroupLimit(val text: String, val messages: List<String> = emptyList(), val waits: List<String> = emptyList()) {
    companion object {
        /** What the line says when the server sends no sentence. */
        const val STOPPED = "The group stopped."

        fun of(v: JsonElement?): GroupLimit? {
            val o = v as? JsonObject ?: return null
            return GroupLimit(o["text"].textOrNull() ?: STOPPED, texts(o["messages"]), texts(o["waits"]))
        }
    }
}

/**
 * The owner's message in a group. [to]: the members it was for. [waitsFor]: the members whose turn waits because
 * they are working. [next]: those whose turn has not come. [canTakeBack]: none of its turns has started.
 */
data class GroupMessage(
    val id: String, val text: String, val at: String, val attachments: List<Attachment> = emptyList(),
    val to: List<String> = emptyList(), val waitsFor: List<String> = emptyList(), val next: List<String> = emptyList(),
    val canTakeBack: Boolean = false, val atLimit: Boolean = false, val stopped: Boolean = false,
) {
    companion object {
        /** A message as the server sent it; null without an id: it cannot be taken back, or told from the next. */
        fun of(v: JsonElement?): GroupMessage? {
            val o = v as? JsonObject ?: return null
            return GroupMessage(
                o["id"].textOrNull() ?: return null, o["text"].whole(), o["at"].textOrNull().orEmpty(), Queued.attachments(o["attachments"]),
                texts(o["to"]), texts(o["waitsFor"]), texts(o["next"]), isTrue(o["canTakeBack"]), isTrue(o["atLimit"]), isTrue(o["stopped"]),
            )
        }
    }
}

/** One row of a group's chat: the owner's message, or a member's reply with its run. [at]: where it stands. */
sealed interface GroupItem {
    val id: String
    val at: String

    data class Message(val message: GroupMessage) : GroupItem {
        override val id get() = message.id
        override val at get() = message.at
    }

    data class Reply(override val id: String, override val at: String, val run: Run) : GroupItem

    companion object {
        /** An item of the chat as the server sent it; null for one of a kind this app does not know. */
        fun of(v: JsonElement?): GroupItem? {
            val o = v as? JsonObject ?: return null
            return when (o["type"].textOrNull()) {
                "message" -> GroupMessage.of(o)?.let(::Message)
                "reply" -> {
                    val run = (o["run"] as? JsonObject)?.let { runCatching { Api.JSON.decodeFromJsonElement(Run.serializer(), it) }.getOrNull() } ?: return null
                    Reply(o["id"].textOrNull() ?: return null, o["at"].textOrNull() ?: run.startedAt, run)
                }
                else -> null
            }
        }
    }
}

/**
 * A member at work in a group (`working` on its chat): its run, what it said it is about to do, and, from a server
 * with `working-line`, what its line reads now ([TurnLines.read]).
 */
data class GroupWorking(val botId: String, val runId: String, val messageId: String? = null, val startedAt: String? = null, val openingLine: String? = null, val workingLine: String? = null) {
    companion object {
        fun list(v: JsonElement?): List<GroupWorking> = (v as? JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            GroupWorking(o["botId"].textOrNull() ?: return@mapNotNull null, o["runId"].textOrNull() ?: return@mapNotNull null, o["messageId"].textOrNull(), o["startedAt"].textOrNull(), o["openingLine"].textOrNull(), o["workingLine"].textOrNull())
        }
    }
}

/**
 * One page of a group's chat (`GET /api/group-chats/:id/chat`): its items, oldest first, whether older ones are
 * left, the members at work, the open question, the stopped line and its new replies.
 */
data class GroupChatPage(
    val items: List<GroupItem> = emptyList(), val more: Boolean = false, val working: List<GroupWorking> = emptyList(),
    val asks: GroupAsks? = null, val limit: GroupLimit? = null, val unread: Int = 0, val firstUnread: String? = null,
) {
    companion object {
        /** From the answer as it came; what is not what this app expects is left out. */
        fun of(answer: String): GroupChatPage {
            val o = runCatching { Api.JSON.parseToJsonElement(answer) as? JsonObject }.getOrNull() ?: return GroupChatPage()
            return GroupChatPage(
                (o["items"] as? JsonArray).orEmpty().mapNotNull(GroupItem::of), isTrue(o["more"]), GroupWorking.list(o["working"]),
                GroupAsks.of(o["asks"]), GroupLimit.of(o["limit"]), (o["unread"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: 0, o["firstUnread"].textOrNull(),
            )
        }
    }
}

/**
 * What a send to a group answers: the message as it was taken, or, for the words "Go on" typed while the group is
 * stopped at the limit, [wentOn] and the messages that go on, with no message of its own (docs/api.md, "The limit").
 */
data class GroupSent(val message: GroupMessage?, val wentOn: Boolean, val messages: List<GroupMessage> = emptyList()) {
    /** The messages the answer hands over: the one that was taken, or those that go on. */
    val held: List<GroupMessage> get() = if (wentOn) messages else listOfNotNull(message)

    companion object {
        fun of(answer: String): GroupSent {
            val o = runCatching { Api.JSON.parseToJsonElement(answer) as? JsonObject }.getOrNull()
            val wentOn = isTrue(o?.get("wentOn"))
            return GroupSent(GroupMessage.of(o).takeIf { !wentOn }, wentOn, (o?.get("messages") as? JsonArray).orEmpty().mapNotNull(GroupMessage::of))
        }
    }
}

/**
 * The group a card was asked in (`groupId` and `groupName` on an ask, a login request, a waiting memory change, and
 * on what the feed says waits of a job or a tile; docs/api.md, "A card and a question in a group"). Such a card
 * stands at the end of that group's chat and in no bot's own, and its notification opens the group.
 */
data class GroupRef(val id: String, val name: String) {
    companion object {
        /** From the two fields as they came; null without an id: a card of a bot's own chat. */
        fun of(id: JsonElement?, name: JsonElement?): GroupRef? = id.textOrNull()?.let { GroupRef(it, name.textOrNull() ?: "a group") }
        fun of(o: JsonObject): GroupRef? = of(o["groupId"], o["groupName"])
    }
}

/**
 * The groups that waiting jobs and Board tiles were asked in, as the feed says them (`approvals` in "hello" and the
 * `approvals` event): a bot's own list of jobs, and the Board, which the cards are drawn from, do not carry it.
 * Kept by "job:<botId>/<jobId>" and "tile:<tileId>", as the feed last said where things stand.
 */
class CardGroups {
    private val _value = MutableStateFlow<Map<String, GroupRef>>(emptyMap())
    val value: StateFlow<Map<String, GroupRef>> = _value
    private var helloAt: String? = null

    fun handle(ev: FeedEvent) {
        when (ev.type) {
            "hello" -> {
                helloAt = ev.data.str("lastEventId").ifBlank { null }
                _value.value = (ev.data["approvals"] as? JsonObject)?.let(::of).orEmpty()
            }
            "approvals" -> if (!isReplayOf(ev.id, helloAt)) _value.value = of(ev.data)
        }
    }

    /** Another botdot: forget what this one said. */
    fun clear() { helloAt = null; _value.value = emptyMap() }

    companion object {
        fun jobKey(botId: String, jobId: String) = "job:$botId/$jobId"
        fun tileKey(tileId: String) = "tile:$tileId"

        /** The groups of the jobs and tiles that wait, from the feed's `approvals`. */
        fun of(approvals: JsonObject): Map<String, GroupRef> = buildMap {
            approvals.arr("jobs")?.forEach { j -> (j as? JsonObject)?.let { o -> GroupRef.of(o)?.let { put(jobKey(o.str("botId"), o.str("jobId")), it) } } }
            approvals.arr("tiles")?.forEach { t -> (t as? JsonObject)?.let { o -> GroupRef.of(o)?.let { put(tileKey(o.str("tileId")), it) } } }
        }
    }
}

/**
 * What a member at work in a group is doing, by its run: [text] its line, [held] it waits for the owner's OK.
 * [works]: the turn has a working line, so its opening line, which the server sends as before, is not drawn in its place.
 */
data class TurnLine(val groupId: String, val botId: String, val text: String = "", val held: Boolean = false, val works: Boolean = false)

/**
 * The lines of the turns at work in the groups, by run. The feed says them (`group_working_line`,
 * `group_opening_line`, `group_run_waits`), and a group's chat when it is read (`working`, [read]); a run's end
 * takes its line away. With `working-line` among the server's [features] a turn's line is its working line
 * (docs/api.md, "The working line"): the server's words for what the member is doing now, drawn as they come. The
 * app has no words of its own for a step. Until a turn has one, and against a server that sends a turn none, the
 * line is its opening line. `turnLines` in `public/groups.js` is the web page's side of the same rules.
 */
class TurnLines(private val features: () -> Collection<String>? = { null }) {
    private val _value = MutableStateFlow<Map<String, TurnLine>>(emptyMap())
    val value: StateFlow<Map<String, TurnLine>> = _value

    /** The turn's working line, as the feed or the chat has it: only from a server that says it has one. */
    private fun works(runId: String?, groupId: String, botId: String, line: String?): Boolean {
        val t = if (OpeningLine.follows(features())) OpeningLine.text(line) else ""
        if (t.isNotEmpty()) say(runId, groupId, botId) { it.copy(text = t, works = true) }
        return t.isNotEmpty()
    }

    /** The turn's opening line: its line until it has a working line. */
    private fun opens(runId: String?, groupId: String, botId: String, line: String?) {
        val t = OpeningLine.text(line)
        if (t.isNotEmpty()) say(runId, groupId, botId) { if (it.works) it else it.copy(text = t) }
    }

    /** A group's chat was read: the line of each member at work, as its `working` has it now. */
    fun read(groupId: String, working: List<GroupWorking>) {
        for (w in working) if (!works(w.runId, groupId, w.botId, w.workingLine)) opens(w.runId, groupId, w.botId, w.openingLine)
    }

    /** The server said something of the run [runId]: what [change] makes of what was known of it. */
    @Synchronized
    fun say(runId: String?, groupId: String, botId: String, change: (TurnLine) -> TurnLine) {
        if (runId.isNullOrEmpty() || groupId.isEmpty() || botId.isEmpty()) return
        val now = change((_value.value[runId] ?: TurnLine(groupId, botId)).copy(groupId = groupId, botId = botId))
        if (_value.value[runId] != now) _value.value = _value.value + (runId to now)
    }

    @Synchronized
    fun clear() { _value.value = emptyMap() }

    @Synchronized
    private fun drop(match: (String, TurnLine) -> Boolean) {
        val left = _value.value.filterNot { (id, l) -> match(id, l) }
        if (left.size != _value.value.size) _value.value = left
    }

    fun handle(ev: FeedEvent) {
        val d = ev.data
        val group = d.str("groupId")
        val bot = d.str("botId")
        when (ev.type) {
            // A member's new turn: the line of its earlier one in that group goes.
            "group_run_started" -> d.str("id").let { run -> drop { id, l -> l.groupId == group && l.botId == bot && id != run } }
            "group_run_finished" -> d.str("id").let { run -> drop { id, _ -> id == run } }
            "group_working_line" -> works(d.str("runId"), group, bot, d.str("text"))
            "group_opening_line" -> opens(d.str("runId"), group, bot, d.str("text"))
            "group_run_waits" -> say(d.str("runId"), group, bot) { it.copy(held = OpeningLine.waitsForOk(d["waitingFor"])) }
            "reset" -> clear() // the feed could not say what was missed: the lists are read again
        }
    }

    companion object {
        /** What the member [botId] at work in [groupId] says it is doing; "" when it has said nothing. */
        fun of(lines: Map<String, TurnLine>, groupId: String, botId: String): String =
            lines.values.lastOrNull { it.groupId == groupId && it.botId == botId && it.text.isNotEmpty() }?.text.orEmpty()
    }
}

/** The groups, and what the feed says of them at once, before the list is read again. */
object Groups {
    /** The pinned groups, in the order of `pinned`: they stand after the pinned bots. */
    fun pinned(groups: List<Group>): List<Group> = groups.filter { it.pinned > 0 }.sortedBy { it.pinned }

    /** A category's groups that are not pinned, in their order: they stand after its bots (ADR 018). */
    fun inCategory(groups: List<Group>, category: String): List<Group> = groups.filter { it.pinned <= 0 && it.category == category }
        .sortedWith(compareBy<Group> { if (it.order > 0) it.order else Int.MAX_VALUE }.thenBy { it.name.lowercase() })

    /** A group's members that exist, in the group's order. */
    fun members(g: Group, bots: List<Bot>): List<Bot> = g.members.mapNotNull { id -> bots.firstOrNull { it.id == id } }

    /**
     * Who is next in a group's chat: the members whose turn has not come, in the order they will have it, of the one
     * message that is shown them of. [messages]: the owner's messages the chat holds, oldest first, each with the
     * server's `next`. [working]: the members at work in the group, each with the message its turn is of. While a
     * member works, only the messages whose turns are running count; while none works, every message does. Of
     * those, it is the newest that "Stop all" did not end and whose `next` is not empty. Nobody otherwise: the
     * last turn is at work or has ended, or the owner stopped them all. `public/groups.js` has the same rule.
     */
    fun next(messages: List<GroupMessage>, working: List<GroupWorking>): List<String> {
        val running = working.mapNotNullTo(HashSet()) { it.messageId }
        return messages.lastOrNull { (working.isEmpty() || it.id in running) && !it.stopped && it.next.isNotEmpty() }?.next.orEmpty()
    }

    /** The bots of who is next ([next]) that exist, in that order: a bot the app does not know is given no head. */
    fun heads(next: List<String>, bots: List<Bot>): List<Bot> = next.mapNotNull { id -> bots.firstOrNull { it.id == id } }

    /** The bots that can be added to a group: those that are not in it. None when it is full. */
    fun addable(g: Group, bots: List<Bot>): List<Bot> = if (g.members.size >= GROUP_MAX) emptyList() else bots.filter { it.id !in g.members }

    /** The groups with what the server now says of one group's new replies (`group_unread`); the same list when nothing changed. */
    fun setUnread(groups: List<Group>, groupId: String, unread: Int, firstUnread: String?): List<Group> {
        val n = unread.coerceAtLeast(0)
        val first = firstUnread.takeIf { n > 0 }
        if (groups.none { it.id == groupId && (it.unread != n || it.firstUnread != first) }) return groups
        return groups.map { if (it.id == groupId) it.copy(unread = n, firstUnread = first) else it }
    }

    /**
     * The groups after a feed event about one of them: who works in it (`group_run_started`, `group_run_finished`),
     * its newest reply, unless the turn passed, its open question (`group_asks`), its stopped line (`group_limit`)
     * and its new replies (`group_unread`). Any other event, and one about a group this app does not have, changes nothing.
     */
    fun on(groups: List<Group>, ev: FeedEvent): List<Group> {
        if (!ev.type.startsWith("group_")) return groups
        val d = ev.data
        val id = d.str("groupId").ifEmpty { return groups }
        if (groups.none { it.id == id }) return groups
        val change: (Group) -> Group = when (ev.type) {
            "group_run_started" -> d.str("botId").ifEmpty { return groups }.let { bot -> { g -> g.copy(workingValue = ids((g.working + bot).distinct())) } }
            "group_run_finished" -> { g ->
                val bot = d.str("botId")
                val last = if (isTrue(d["passed"]) || bot.isEmpty()) g.lastValue else JsonObject(mapOf(
                    "runId" to JsonPrimitive(d.str("id")), "botId" to JsonPrimitive(bot), "botName" to JsonPrimitive(d.str("botName")), "status" to JsonPrimitive(d.str("status")),
                    "at" to JsonPrimitive(d.str("endedAt").ifEmpty { d.str("startedAt") }), "text" to JsonPrimitive(d.str("result").ifEmpty { d.str("problem") }.take(300)),
                ))
                g.copy(workingValue = ids(g.working - bot), lastValue = last)
            }
            "group_asks" -> { g -> g.copy(asksValue = d["asks"].takeIf { it is JsonObject }) }
            "group_limit" -> { g -> g.copy(limitValue = d["limit"].takeIf { it is JsonObject }) }
            "group_unread" -> return setUnread(groups, id, (d["unread"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: 0, d["firstUnread"].textOrNull())
            else -> return groups
        }
        return groups.map { if (it.id == id) change(it) else it }
    }

    private fun ids(list: List<String>) = JsonArray(list.map { JsonPrimitive(it) })
}

/**
 * A group's chat as the app holds it while it is open: the owner's messages and the replies by their id. The app
 * keeps no message of its own: what the owner sends is drawn from the server's answer and from the feed.
 */
class GroupChatItems {
    private val byId = LinkedHashMap<String, GroupItem>()

    /** Whether older items are left on the server. */
    var more = false
        private set

    /** The rows, oldest first: by when they stand, a message before a reply of the same moment. */
    fun rows(): List<GroupItem> = byId.values.sortedWith(ORDER)
    fun has(id: String): Boolean = id in byId
    val oldest: GroupItem? get() = rows().firstOrNull()

    /**
     * A page of the chat into what the app holds. The newest page says what is there now: an item it no longer has,
     * from where it begins, is gone (a message taken back in another app). An [older] page only adds.
     */
    fun take(page: GroupChatPage, older: Boolean = false) {
        if (!older) {
            val from = page.items.firstOrNull()?.at
            val ids = page.items.mapTo(HashSet()) { it.id }
            byId.values.removeAll { it.id !in ids && (from == null || it.at >= from) }
            // Older pages that are held say whether more is left.
            if (from == null || byId.values.none { it.at < from }) more = page.more
        } else more = page.more
        for (x in page.items) byId[x.id] = x
    }

    /**
     * A message of the owner's as the feed or an answer hands it over: kept when the app holds it already, or when
     * it belongs to what the app holds. One from further back than that is left to the page that reads it: held
     * alone, it would stand above replies that are not read yet. True when it was kept.
     */
    fun hold(m: GroupMessage): Boolean {
        val first = oldest
        if (!has(m.id) && more && !(first != null && m.at >= first.at)) return false
        byId[m.id] = GroupItem.Message(m)
        return true
    }

    /** That item is gone (a message that was taken back). True when it was held. */
    fun remove(id: String): Boolean = byId.remove(id) != null

    companion object {
        private val ORDER = compareBy<GroupItem> { it.at }.thenBy { if (it is GroupItem.Message) 0 else 1 }.thenBy { it.id }
    }
}
