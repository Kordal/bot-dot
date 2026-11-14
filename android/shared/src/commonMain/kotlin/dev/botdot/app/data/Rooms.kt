package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.put

/**
 * A bot's shared-room settings (ADR 060, #316), kept in its own account: whether it may be in shared rooms at all
 * ([allowRooms]), and who may mention it there ([whoMayMention]: [OWNER], only its owner, or [MEMBERS], anyone in
 * the room). The account refuses a room turn these do not allow, whatever the front door asks.
 */
data class BotRooms(val allowRooms: Boolean = false, val whoMayMention: String = OWNER) {
    companion object {
        /** The feature of a botdot that keeps these settings. */
        const val FEATURE = "room-settings"
        const val OWNER = "owner"
        const val MEMBERS = "anyone"

        /** The choices of "Who may mention it", as their wire value and their words. */
        val WHO: List<Pair<String, String>> get() = listOf(OWNER to tr("Only you"), MEMBERS to tr("Anyone in the room"))

        /** Whether the bot settings show the section: the server keeps them (while its features are not known: no). */
        fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

        /** `rooms` on a bot as the server sent it; null when it sent none. A value it doesn't know is the default. */
        fun of(v: JsonElement?): BotRooms? {
            val o = v as? JsonObject ?: return null
            val allow = (o["allowRooms"] as? JsonPrimitive)?.takeIf { !it.isString }?.content == "true"
            val who = (o["whoMayMention"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { if (it == "room members") MEMBERS else it }?.takeIf { it == OWNER || it == MEMBERS } ?: OWNER
            return BotRooms(allow, who)
        }

        /** The change `PUT /api/bots/:id` takes for these settings (a partial object merges), or null when nothing changed. */
        fun change(was: BotRooms, now: BotRooms): JsonObject? {
            if (was == now) return null
            return buildJsonObject {
                if (now.allowRooms != was.allowRooms) put("allowRooms", now.allowRooms)
                if (now.whoMayMention != was.whoMayMention) put("whoMayMention", now.whoMayMention)
            }
        }
    }
}

/** A person in a shared room: their account's name, as the front door sets it. */
@Serializable
data class RoomMember(val account: String = "", val joined: String? = null)

/** A bot in a shared room: [id] is its id in its own [account]. Shown as "name · account" ([Rooms.label]). */
@Serializable
data class RoomBot(val account: String = "", val id: String = "", val name: String = "", val color: String? = null, val emoji: String? = null)

/** An account invited to a room, by whom and when. */
@Serializable
data class RoomInvite(val account: String = "", val by: String = "", val at: String? = null)

/** Who a message named: a bot ([bot], its id in [account]) and its [name]. */
@Serializable
data class RoomMention(val account: String = "", val bot: String = "", val name: String = "")

/** Which bot wrote a message, by its id in the message's account and its name then. */
@Serializable
data class RoomAuthor(val id: String = "", val name: String = "")

/**
 * One message of a shared room. [bot] null: a person wrote it, and [account] is who. [kind] "notice": the front door's
 * own line (joined, left, a bot that may not be mentioned by the sender, a turn that failed). [mentions]: who it named.
 */
@Serializable
data class RoomMessage(
    val id: String = "",
    val at: String? = null,
    val account: String = "",
    val bot: RoomAuthor? = null,
    val text: String = "",
    val mentions: List<RoomMention> = emptyList(),
    val kind: String = "text",
) {
    val notice: Boolean get() = kind == "notice"
}

/** A bot at work in a room. */
@Serializable
data class RoomWorking(val account: String = "", val bot: String = "")

/** A shared room as the front door hands it out (#318). [by]: the account that made it, the one that may delete it. */
@Serializable
data class Room(
    val id: String = "",
    val name: String = "",
    val created: String? = null,
    val by: String = "",
    val members: List<RoomMember> = emptyList(),
    val bots: List<RoomBot> = emptyList(),
    val invites: List<RoomInvite> = emptyList(),
    val last: RoomMessage? = null,
    val working: List<RoomWorking> = emptyList(),
)

/** An invitation waiting for this account: to [room], from [by]. */
@Serializable
data class RoomInvitation(val room: RoomRef = RoomRef(), val by: String = "", val at: String? = null)

@Serializable
data class RoomRef(val id: String = "", val name: String = "", val by: String = "")

/** `GET /front-door/rooms`: the rooms this account is in, and the invitations waiting for it. */
@Serializable
data class RoomsAnswer(val rooms: List<Room> = emptyList(), val invites: List<RoomInvitation> = emptyList())

/** A page of a room's messages, oldest first; [more]: older ones remain. */
@Serializable
data class RoomPage(val messages: List<RoomMessage> = emptyList(), val more: Boolean = false)

@Serializable
internal data class RoomAnswer(val room: Room? = null)

/** A room's invite link (ADR 068): the address its maker shares, and when it stops working. */
@Serializable
data class RoomLink(val url: String = "", val expires: String? = null)

@Serializable
internal data class RoomLinkAnswer(val link: RoomLink? = null)

/** What an invite link opens: the room's [room] id, name and maker, and whether this account is a [member] already. */
@Serializable
data class RoomLinkPreview(val room: RoomRef = RoomRef(), val member: Boolean = false)

@Serializable
internal data class RoomMessageAnswer(val message: RoomMessage? = null)

/**
 * Shared rooms (ADR 060, #318): chats on this machine between people of several accounts and their bots, kept by the
 * front door. The app shows them only when the front door's session says `rooms: true`; a bot there answers only when
 * mentioned, and only talks.
 */
object Rooms {
    /** Whether to show Rooms: behind a front door (`accounts`) whose session says they are on. */
    fun on(features: Collection<String>?, session: JsonObject?): Boolean =
        features?.contains("accounts") == true && (session?.get("rooms") as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

    /** Whether the front door makes invite links for rooms (`roomLinks` in its session, ADR 068). */
    fun links(session: JsonObject?): Boolean = (session?.get("roomLinks") as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

    private val JOIN = Regex("(?:^|[#/])join=([A-Za-z0-9_-]{1,100})\\s*$")

    /**
     * The token of an invite link as the owner pasted it: the whole link (`https://<machine>/#rooms/join=<token>`) or
     * its end; null for text that isn't one.
     */
    fun linkToken(text: String): String? = JOIN.find(text.trim())?.groupValues?.get(1)

    /** The account this app is signed in as, when the front door says (`account` in its session); null otherwise. */
    fun account(session: JsonObject?): String? = (session?.get("account") as? JsonPrimitive)?.takeIf { it.isString }?.content?.ifBlank { null }

    /** A bot as everyone in the room sees it: "name · account". */
    fun label(name: String, account: String): String = if (account.isBlank()) name else "$name · $account"

    /** Who wrote [m], as the room shows it: a bot "name · account", a person by their account; a notice by nobody. */
    fun author(m: RoomMessage): String = when {
        m.notice -> ""
        m.bot != null -> label(m.bot.name, m.account)
        else -> m.account
    }

    /** "mentioned @Scout · ann, @Pip · bob": who [m] named, so everyone sees who mentioned whom; "" for none. */
    fun mentionLine(m: RoomMessage): String =
        m.mentions.distinctBy { it.account to it.bot }.joinToString(", ") { "@${Mentions.shortName(it.name)} · ${it.account}" }.let { if (it.isEmpty()) "" else tr("mentioned {names}", "names" to it) }

    /** The key a room bot has in the mention picker, unique across accounts. */
    fun key(b: RoomBot): String = "${b.account}/${b.id}"

    /**
     * What can be mentioned in a room: its bots, each as a [Bot] whose id is [key] and whose [Mentions.World.labels]
     * say "name · account". Two bots of the same name in different accounts are both offered, with the same "@Name":
     * the front door asks every bot of that name.
     */
    fun world(room: Room?): Mentions.World? {
        room ?: return null
        val bots = room.bots.map { Bot(id = key(it), name = it.name, color = it.color, emoji = it.emoji ?: "🤖") }
        return Mentions.World("room:${room.id}", bots, emptyList(), labels = room.bots.associate { key(it) to label(it.name, it.account) })
    }

    /** The line under the room's name in the list: its last message, by whom, or how many are in it. */
    fun summary(r: Room): String = r.last?.let { m ->
        val who = author(m)
        val text = m.text.lineSequence().firstOrNull { it.isNotBlank() }?.trim().orEmpty()
        if (who.isEmpty()) text else "$who: $text"
    } ?: (trn(r.members.size, "{n} person", "{n} people") + ", " + trn(r.bots.size, "{n} bot", "{n} bots"))

    /** [held] with [more] added (by id, a newer copy wins), oldest first. */
    fun merge(held: List<RoomMessage>, more: List<RoomMessage>): List<RoomMessage> {
        val byId = LinkedHashMap<String, RoomMessage>()
        for (m in held + more) byId[m.id] = m
        return byId.values.sortedBy { it.at.orEmpty() } // stable: messages of the same moment keep their order
    }

    /** The bots at work in [r], as the room shows them: "name · account is writing…"; "" for none. */
    fun workingLine(r: Room): String {
        val names = r.working.mapNotNull { w -> r.bots.firstOrNull { it.account == w.account && it.id == w.bot }?.let { label(it.name, it.account) } }
        return when (names.size) {
            0 -> ""
            1 -> tr("{name} is writing…", "name" to names[0])
            else -> tr("{names} and {last} are writing…", "names" to names.dropLast(1).joinToString(", "), "last" to names.last())
        }
    }

    /** The owner's own bots that may join [r]: allowed in rooms ([BotRooms.allowRooms]) and not in it yet. */
    fun addable(r: Room, mine: List<Bot>, account: String?): List<Bot> =
        mine.filter { b -> b.rooms?.allowRooms == true && r.bots.none { it.id == b.id && (account == null || it.account == account) } }

    /** Whether [account] made [r], and so may delete it. */
    fun mayDelete(r: Room, account: String?): Boolean = account != null && r.by == account

    /** [a] with [room] in its place, or first when it is new; no longer an invitation. */
    fun withRoom(a: RoomsAnswer, room: Room): RoomsAnswer = a.copy(
        rooms = if (a.rooms.any { it.id == room.id }) a.rooms.map { if (it.id == room.id) room else it } else listOf(room) + a.rooms,
        invites = a.invites.filterNot { it.room.id == room.id },
    )

    /** [a] without the room [id], and without an invitation to it. */
    fun withoutRoom(a: RoomsAnswer, id: String): RoomsAnswer = a.copy(rooms = a.rooms.filterNot { it.id == id }, invites = a.invites.filterNot { it.room.id == id })

    /**
     * [a] after one of the front door's live events: `room` puts the room in, `room_gone` takes it out, `invite` adds an
     * invitation, `invite_gone` takes it away, `room_message` makes it the room's last message. Others change nothing.
     */
    fun applied(a: RoomsAnswer, ev: FeedEvent): RoomsAnswer {
        val d = ev.data
        return when (ev.type) {
            "room" -> decode<Room>(d["room"])?.takeIf { it.id.isNotEmpty() }?.let { withRoom(a, it) } ?: a
            "room_gone" -> withoutRoom(a, d.str("id"))
            "invite" -> decode<RoomInvitation>(d)?.takeIf { it.room.id.isNotEmpty() }?.let { i -> a.copy(invites = a.invites.filterNot { it.room.id == i.room.id } + i) } ?: a
            "invite_gone" -> a.copy(invites = a.invites.filterNot { it.room.id == d.str("id") })
            "room_message" -> {
                val m = decode<RoomMessage>(d["message"]) ?: return a
                a.copy(rooms = a.rooms.map { if (it.id == d.str("roomId")) it.copy(last = m) else it })
            }
            else -> a
        }
    }

    /** A message from a `room_message` event for the room [roomId]; null for another room's, or none. */
    fun messageOf(ev: FeedEvent, roomId: String): RoomMessage? =
        if (ev.type == "room_message" && ev.data.str("roomId") == roomId) decode<RoomMessage>(ev.data["message"])?.takeIf { it.id.isNotEmpty() } else null

    private inline fun <reified T> decode(v: JsonElement?): T? = v?.let { runCatching { Api.JSON.decodeFromJsonElement<T>(it) }.getOrNull() }

    /** The body of a message sent to a room: its [text] and the key that makes a resend the same message. */
    fun messageBody(text: String, key: String?): JsonObject = buildJsonObject {
        put("text", text)
        if (key != null) put("key", key)
    }
}
