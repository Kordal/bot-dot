package dev.botdot.app.feed

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Build
import android.os.SystemClock
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import dev.botdot.app.MainActivity
import dev.botdot.app.R
import dev.botdot.app.data.Api
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.FeedEvent
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.GroupRef
import dev.botdot.app.data.groupKey
import dev.botdot.app.data.groupOfChat
import dev.botdot.app.data.ToolCard
import dev.botdot.app.data.cardWords
import dev.botdot.app.data.arr
import dev.botdot.app.data.claudeSignedOut
import dev.botdot.app.data.isTrue
import dev.botdot.app.data.saysSignedOut
import dev.botdot.app.data.isReplayOf
import dev.botdot.app.data.str
import dev.botdot.app.data.textOrNull
import dev.botdot.app.ui.CHIEF_COLOR
import dev.botdot.app.ui.figureBitmap
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Turns feed events into notifications: what a bot or the Chief said, stacked per chat with a Reply button,
 * a bot that asks the owner something under "<Bot> asks", and, always, what needs you: a login or payment, a job, a permission, skill or tool, a memory change or a plan
 * waiting for your OK (with Decline / Approve right there), and Bitwarden being locked. Each shows the head,
 * with its hat, of the bot it is about.
 * A chat has a notification while it has a new reply, as the botdot server says (ADR 005): a reply notifies
 * when its event says `new`, and the chat's notification goes when `unread` says it was read, in any app. This
 * decides nothing about that itself. A botdot from before (no `unread` in its features) is followed as before:
 * a reply notifies unless you're looking at that chat or using the web page, and `chat_seen` clears a chat's.
 * What needs you cleans itself up too: once it is answered (here, on the web or anywhere), it goes away.
 * Each is tagged with what it's about: "bot:<id>" / "chief:<chatId>" (a chat), and "login:<id>",
 * "job:<botId>/<jobId>", "ask:<id>", "memory:<id>", "plan:<chatId>", "bitwarden" (needs you), and "claude":
 * Claude is signed out and no bot can work, said once per sign-out, also while the web page is in use, and taken
 * away when Claude is signed in again.
 * A reply in a group makes no notification (Milestone 10). A member's question to the owner makes one, tagged
 * "group:<id>" and titled with the group's name, and so does a card asked in a group, under "<Bot> in <Group>": a tap
 * on either opens the group. The question's goes when the group is read in any app, or when the question ends.
 *
 * [figure]: the definition bots are drawn from (null: none can be used, and a bot is a coloured circle).
 * [outfitOf]: what a bot wears now. [newChats]: the chats with new replies, asked of botdot (null: it didn't say).
 * [groupNameOf]: what a group is called now (null: the app does not know it).
 */
class Notifier(
    private val context: Context,
    private val figure: () -> FigureDef? = { null },
    private val outfitOf: (botId: String) -> JsonElement? = { null },
    private val newChats: suspend () -> List<NewChat>? = { null },
    private val groupNameOf: (groupId: String) -> String? = { null },
) {
    companion object {
        const val CH_UPDATES = "updates"
        const val CH_NEEDS_YOU = "needs_you"
        const val CH_CONNECTION = "connection"
        const val EXTRA_OPEN = "open" // "bot:<id>" | "chief:<chatId>" | "group:<id>" | "needs"
        private const val KEEP_MESSAGES = 8 // per chat notification
        private const val YOU_COLOR = "#9a9a9a"
        private const val HEAD_PX = 144
    }

    /** The chat on screen right now ("bot:<id>", "chief:<chatId>" or "group:<id>"). Opening it clears its notifications. */
    @Volatile var visibleChat: String? = null
        set(chat) { field = chat; if (chat != null) cancelWhere { it == chat } }
    @Volatile var appInForeground: Boolean = false
    var serverUrl: String? = null

    private val nm get() = context.getSystemService(NotificationManager::class.java)

    // What already rang, kept across restarts so it doesn't ring again; forgotten once it's answered.
    private val prefs = context.getSharedPreferences("notifier", Context.MODE_PRIVATE)
    private val rung = prefs.getStringSet("rung", emptySet()).orEmpty().toMutableSet()
    private var rungChanged = false
    private fun saveRung() { rungChanged = true } // written once, at the end of the event
    private fun flushRung() { if (rungChanged) { rungChanged = false; prefs.edit().putStringSet("rung", rung.toSet()).apply() } }
    // After the phone restarted or the app was updated (which can clear notifications): what still waits
    // comes back, quietly, once botdot says where things stand.
    private var restore = prefs.getStringSet("restore", emptySet()).orEmpty()

    /** The phone restarted, or the app was updated: what rang but isn't showing any more may come back. */
    fun afterRestart() {
        val showing = runCatching { nm.activeNotifications.mapNotNull { it.tag }.toSet() }.getOrDefault(emptySet())
        val gone = rung.filter { it !in showing && !it.startsWith("bitwarden") } + rung.filter { it.startsWith("bitwarden") && "bitwarden" !in showing }
        if (gone.isEmpty()) return
        restore = restore + gone
        rung.removeAll(gone.toSet())
        prefs.edit().putStringSet("restore", restore).putStringSet("rung", rung.toSet()).apply()
    }

    // You're using botdot's web page right now (botdot marks the event): no notification then. For replies this
    // counts only with a botdot from before unread state.
    private var webActive = false
    // botdot keeps what is new and read (`unread` in its features), as "hello" said.
    private var follows = false
    // What this botdot announces, as "hello" named it (null: not said yet): whether it writes a memory card's words.
    private var features: List<String>? = null
    // This botdot's apps say that Claude is signed out (saysSignedOut), as "hello" named its features.
    private var saysClaude = false
    // The chats' notifications may not match botdot's unread state: the app just started, or the feed could not
    // replay what was missed ("reset"). The next catch-up makes again what is missing.
    private var owes = true
    // The catch-up going on (a later one takes its place), and the chats an event said something about since it
    // began: the event is newer than what the catch-up was told, so it leaves those alone.
    private var round = 0
    private val touched = mutableSetOf<String>()
    private fun standing() = Standing(follows, visibleChat.takeIf { appInForeground }, webActive)
    // Where the feed stood when we (re)connected: events up to there are catching up on what we missed.
    private var helloAt: String? = null
    private var openPlans = emptySet<String>()
    private var lastRing = 0L

    fun createChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        nm.createNotificationChannel(NotificationChannel(CH_UPDATES, "Replies and finished tasks", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_NEEDS_YOU, "Needs you", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "A bot asks for a login, or something waits for your OK"
        })
        nm.createNotificationChannel(NotificationChannel(CH_CONNECTION, "Connection to botdot", NotificationManager.IMPORTANCE_MIN).apply {
            description = "The quiet notification that keeps the connection open"
            setShowBadge(false)
        })
    }

    /** Runs on [dev.botdot.app.BotDotApp.notifying], like everything here that changes what rang. */
    fun handle(ev: FeedEvent) = atOnce { handleNow(ev) }

    // What shows is read once per step (each read is a call into Android), when it's first needed. A step never
    // waits for botdot: another may run on this lane meanwhile, and must read what shows afresh.
    private inline fun <T> atOnce(step: () -> T): T {
        showing = null; handling = Thread.currentThread()
        try { return step() } finally { handling = null; showing = null; flushRung() }
    }

    /**
     * After "hello" from a botdot that keeps unread state: the chats' notifications are brought in line with it. One
     * for a chat that was read meanwhile goes. After the app started, and when the feed could not replay what was
     * missed, a chat with new replies and no notification gets one again, quietly, showing its first new reply.
     * It runs on the notifying lane beside the events, which are not kept waiting for botdot's answers.
     */
    suspend fun catchUp() {
        if (!follows) return
        val mine = ++round
        touched.clear()
        val chats = newChats() ?: return
        if (mine != round) return
        val unread = chats.map { it.chat }.toSet()
        val plan = atOnce {
            val showing = showingNow().mapNotNull { it.tag }.filter(::isChat).toSet()
            catchUpOf(showing, unread, rebuild = owes, watching = standing().watching, touched = touched).also { p -> cancelWhere { it in p.remove } }
        }
        for (c in chats.filter { it.chat in plan.rebuild }) {
            val r = try { c.first() } catch (e: CancellationException) { throw e } catch (e: Exception) { null } ?: continue
            if (mine != round) return
            atOnce {
                if (c.chat !in touched && active(c.chat) == null) {
                    message(c.chat, Sender(r.botId, r.name, r.color, r.outfit), r.text, r.at ?: System.currentTimeMillis(), r.title, quiet = true)
                }
            }
        }
        owes = false
    }

    private fun handleNow(ev: FeedEvent) {
        val d = ev.data
        if (ev.type == "hello") {
            features = d.arr("features")?.mapNotNull { (it as? JsonPrimitive)?.content }
            follows = features?.contains("unread") == true
            saysClaude = saysSignedOut(features)
        }
        if (ev.type == "reset") owes = true // nothing is replayed: the "hello" that follows says where things stand
        if (!follows && !shouldNotifyOwner(ev)) return
        webActive = d.str("webActive") == "true"
        val at = time(d.str("at")) ?: System.currentTimeMillis()
        // Missed while away: what it said still shows, but what needs you is taken from "hello" (where things stand now).
        val replay = isReplay(ev.id)
        when (ev.type) {
            "hello" -> {
                helloAt = d.str("lastEventId").ifBlank { null }
                cancelWhere { it == "approvals" } // the one-for-all-jobs notification of earlier versions
                d.arr("loginRequests")?.let { l -> sync("login:", l.map { loginNeed(it.jsonObject) }) }
                (d["approvals"] as? JsonObject)?.let { approvals(it) }
                d.arr("asks")?.let { l -> sync("ask:", l.map { askNeed(it.jsonObject) }) }
                (d["bitwarden"] as? JsonObject)?.let { bitwarden(it) }
                claude(d["claude"])
                d.arr("plans")?.let { l ->
                    openPlans = l.map { it.jsonPrimitive.content }.toSet()
                    forget { it.startsWith("plan:") && it.removePrefix("plan:") !in openPlans }
                }
                if (restore.isNotEmpty()) { restore = emptySet(); prefs.edit().remove("restore").apply() }
            }
            "run_finished" -> {
                val chat = "bot:${d.str("botId")}"
                touched += chat
                if (!replyNotifies(ev, chat, standing())) return
                val name = d.str("botName").ifBlank { "A bot" }
                // Its reply holds a question for the owner: "<Bot> asks" and the question, and a tap opens the chat,
                // where the answers are. It goes as every reply's does: when the feed says its chat was read.
                val asks = asksNotice(isTrue(d["asks"]), d.str("title"), name, d.str("result"), d["question"].textOrNull())
                val body = asks?.body ?: runText(d.str("status"), d.str("result"), d.str("problem"), d.str("error"), d.str("jobName"))
                message(chat, Sender(d.str("botId"), asks?.title ?: name, d.str("botColor")), body, at, open = if (asks != null) chat else oneFile(d) ?: chat)
            }
            // A turn in a group ended. No reply in a group notifies: only one that asks the owner something
            // (`notify: true`), under "<Bot> asks" in the group's name, and a tap opens the group.
            "group_run_finished" -> {
                val group = d.str("groupId").ifEmpty { return }
                val chat = groupKey(group)
                if (!groupNotifies(ev, chat, standing().watching)) return
                val name = d.str("botName").ifBlank { "A bot" }
                val asks = asksNotice(true, d.str("title"), name, d.str("result"), d["question"].textOrNull())
                message(chat, Sender(d.str("botId"), asks?.title ?: "$name asks", d.str("botColor")), asks?.body ?: runText(d.str("status"), d.str("result"), d.str("problem"), d.str("error"), ""), at,
                    title = groupNameOf(group) ?: "A group", open = chat)
            }
            // The group was read, in any app, or its question ended: its notification goes.
            "group_unread", "group_asks" -> groupSettled(ev)?.let { c -> cancelWhere { it == c } }
            "chief_reply" -> {
                val chat = "chief:${d.str("chatId")}"
                touched += chat
                if (!replyNotifies(ev, chat, standing())) return
                val body = chiefReplyText(d.str("status"), d.str("text"), d.str("error"))
                val from = d["from"] as? JsonObject // a bot's reply posted in the chat
                val sender = from?.let { Sender(it.str("id"), it.str("name").ifBlank { "A bot" }, it.str("color")) } ?: Sender(CHIEF_ID, CHIEF, CHIEF_COLOR)
                message(chat, sender, body, at, d.str("title"), open = oneFile(d) ?: chat)
            }
            "chief_suggestion" -> {
                val chatId = d.str("chatId")
                if (appInForeground && visibleChat == "chief:$chatId") return
                if (replay && chatId !in openPlans) return // answered since
                val from = d["from"] as? JsonObject
                once(Need("plan:$chatId", from?.str("name")?.ifBlank { null } ?: "A bot", from?.str("color"), "A plan for the Chief: ${d.str("title")}",
                    plain(d.str("text")), at, yes = "Approve", open = "chief:$chatId", bot = from?.str("id")))
            }
            "plan_closed" -> forget { it == "plan:${d.str("chatId")}" }
            "login_request" -> if (!replay) once(loginNeed(d))
            "login_request_closed" -> forget { it == "login:${d.str("id")}" }
            "approvals" -> if (!replay) approvals(d)
            "asks" -> if (!replay) d.arr("list")?.let { l -> sync("ask:", l.map { askNeed(it.jsonObject) }) }
            "bitwarden" -> if (!replay) bitwarden(d)
            "claude" -> if (!replay) claude(d)
            // The chat was read, in any app: its notification here goes away.
            "unread", "chat_seen" -> {
                d.str("chat").takeIf(::isChat)?.let { touched += it }
                chatRead(ev, standing())?.let { c -> cancelWhere { it == c } }
            }
        }
    }

    // ---------- what needs you ----------

    /**
     * Something waiting for you. [yes]: the label of its yes button (with Decline beside it); null: tapping opens the
     * app. [no]: whether it has Decline; alone, without a yes, when the yes is given on its card (`yesOn`). Without
     * either, a tap opens Needs you, and the notification goes when the thing is answered there or anywhere.
     * [bot]: the bot it concerns, whose head it shows (none: the Chief of Staff's).
     */
    private data class Need(
        val key: String, val title: String, val color: String?, val text: String, val detail: String? = null,
        val at: Long? = null, val yes: String? = null, val open: String = "needs", val bot: String? = null,
        val no: Boolean = yes != null,
        val noLabel: String = DECLINE, // what its no reads: the server's words for a job and a tile that send them
        // What a locked screen shows in its place, and whether it is said also while the web page is in use.
        val hidden: String = "Waiting for your OK", val evenOnWeb: Boolean = false,
    )

    /** Claude is signed out: one notification per sign-out; a tap opens the app. Signed in again: it goes, and may ring the next time. */
    private fun claude(said: JsonElement?) {
        if (!saysClaude) return
        when (signedOutStep(claudeSignedOut(said), SIGNED_OUT_KEY in rung)) {
            SignedOutStep.RING -> once(Need(SIGNED_OUT_KEY, "botdot", CHIEF_COLOR, SIGNED_OUT_TEXT, open = "app", hidden = SIGNED_OUT_TEXT, evenOnWeb = true))
            SignedOutStep.TAKE -> forget { it == SIGNED_OUT_KEY }
            SignedOutStep.NONE -> Unit
        }
    }

    private fun loginNeed(o: JsonObject): Need {
        val site = o.str("site")
        val text = if (o.str("kind") == "card") "Wants to pay on $site${o.str("amount").takeIf { it.isNotBlank() }?.let { " ($it)" } ?: ""}" else "Asks for the $site login"
        val place = cardPlace(o, o.str("botName").ifBlank { "A bot" }, groupNameOf)
        return Need("login:${o.str("id")}", place.title, o.str("botColor"), text, at = time(o.str("createdAt")), bot = o.str("botId"), open = place.open)
    }

    private fun jobNeed(o: JsonObject): Need {
        val words = jobWords(o)
        val place = cardPlace(o, o.str("botName").ifBlank { "A bot" }, groupNameOf)
        return Need("job:${o.str("botId")}/${o.str("jobId")}", place.title, o.str("botColor"), words.text, yes = words.yes, bot = o.str("botId"), no = words.decline, noLabel = words.no, open = place.open)
    }

    private fun tileNeed(o: JsonObject): Need {
        val words = tileWords(o)
        val place = cardPlace(o, o.str("botName").ifBlank { CHIEF }, groupNameOf)
        return Need("tile:${o.str("tileId")}", place.title, o.str("botColor").ifBlank { CHIEF_COLOR }, words.text, yes = words.yes, bot = o.str("botId"), no = words.decline, noLabel = words.no, open = place.open)
    }

    private fun memoryNeed(o: JsonObject): Need {
        val words = memoryWords(o, features)
        val place = cardPlace(o, o.str("botName").ifBlank { "A bot" }, groupNameOf)
        return Need("memory:${o.str("id")}", place.title, o.str("botColor"), words.text, words.detail, time(o.str("at")), yes = words.yes, bot = o.str("botId"), no = words.decline, noLabel = words.no, open = place.open)
    }

    private fun askNeed(o: JsonObject): Need {
        val words = askWords(o)
        val place = cardPlace(o, o.str("botName").ifBlank { CHIEF }, groupNameOf)
        return Need("ask:${o.str("id")}", place.title, o.str("botColor"), words.text, at = time(o.str("at")), yes = words.yes, bot = o.str("botId"), no = words.decline, open = place.open)
    }

    private fun approvals(a: JsonObject) {
        a.arr("jobs")?.let { l -> sync("job:", l.map { jobNeed(it.jsonObject) }) }
        a.arr("memoryChanges")?.let { l ->
            val needs = l.map { memoryNeed(it.jsonObject) }
            val rang = rung.toSet()
            sync("memory:", needs)
            // One that turned guarded while it waited loses its buttons: drawn again in place, without a sound.
            val showing = runCatching { nm.activeNotifications.mapNotNull { it.tag }.toSet() }.getOrDefault(emptySet())
            val again = redrawn(needs.filter { it.yes == null && !it.no }.map { it.key }, rang, showing)
            needs.filter { it.key in again }.forEach { need(it, quiet = true) }
        }
        a.arr("tiles")?.let { l -> sync("tile:", l.map { tileNeed(it.jsonObject) }) }
    }

    /** Locked: a quiet notification; it rings when a bot wants a saved login meanwhile. Unlocked: it goes away. */
    private fun bitwarden(b: JsonObject) {
        if (b.str("configured") != "true" || b.str("unlocked") == "true") { forget { it == "bitwarden" || it.startsWith("bitwarden:") }; return }
        val wanted = b["wantedBy"] as? JsonObject
        val key = wanted?.let { "bitwarden:${it.str("id")}" } ?: "bitwarden"
        if (key in rung) return
        val back = "bitwarden" in restore || key in restore
        rung += key; saveRung()
        val text = wanted?.let { "${it.str("name")} wants a saved login. Bots can't use them until you unlock it." } ?: "Bots can't use your saved logins until you unlock it."
        need(Need("bitwarden", "Bitwarden is locked", wanted?.str("color") ?: CHIEF_COLOR, text, bot = wanted?.str("id")), quiet = wanted == null || back)
    }

    /** Brings one kind of need up to date with what's open now: new ones ring once, answered ones go away. */
    private fun sync(prefix: String, open: List<Need>) {
        val keys = open.map { it.key }.toSet()
        forget { it.startsWith(prefix) && it !in keys }
        open.forEach { once(it) }
    }

    private fun once(n: Need) {
        if (n.key.endsWith(":") || n.key in rung) return
        rung += n.key; saveRung()
        need(n, quiet = n.key in restore)
    }

    /** It's answered: its notification goes away, and it may ring again if it ever comes back. */
    private fun forget(match: (String) -> Boolean) {
        cancelWhere(match)
        if (rung.removeAll(match)) saveRung()
    }

    /** Answered from its notification: take it away now, before botdot's event says so. */
    fun take(tag: String) = cancelWhere { it == tag }

    private fun need(n: Need, quiet: Boolean = false) {
        if (staysSilent(webActive, n.evenOnWeb)) return
        val b = builder(CH_NEEDS_YOU, n.at, quiet)
            .setContentTitle(n.title)
            .setContentText(n.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(listOfNotNull(n.text, n.detail).joinToString("\n\n").take(1000)))
            .setLargeIcon(head(n.bot, n.color))
            .setContentIntent(openApp(n.open))
            .setPublicVersion(hidden(CH_NEEDS_YOU, n.hidden))
        answerButtons(n.yes, n.no, n.noLabel).forEach { (label, yes) -> b.addAction(answer(label, n.key, yes)) }
        notify(n.key, b)
    }

    /** Decline / Approve: sent only once the phone is unlocked. Android 12 and later ask for that
     *  themselves; before, the button opens [UnlockToAnswer], which asks first. */
    private fun answer(label: String, key: String, yes: Boolean): NotificationCompat.Action {
        val i = Intent().putExtra(NotificationActions.EXTRA_KEY, key).putExtra(NotificationActions.EXTRA_YES, yes)
        val pi = if (Build.VERSION.SDK_INT >= 31) {
            PendingIntent.getBroadcast(context, "$key:$yes".hashCode(), i.setClass(context, NotificationActions::class.java).setAction(NotificationActions.ANSWER),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        } else {
            PendingIntent.getActivity(context, "$key:$yes".hashCode(), i.setClass(context, UnlockToAnswer::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Action.Builder(0, label, pi).setAuthenticationRequired(true).build()
    }

    /** What a locked screen shows instead, when the phone hides notifications' content there. */
    private fun hidden(channel: String, text: String) = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(text)
        .build()

    // ---------- what bots and the Chief said ----------

    /** Who said it. [outfit]: what it wears, when the caller knows; else it is looked up. */
    private data class Sender(val id: String, val name: String, val color: String?, val outfit: JsonElement? = null)

    private val me by lazy { Person.Builder().setKey("me").setName("You").setIcon(IconCompat.createWithBitmap(dot(YOU_COLOR, 64))).build() }

    private fun person(s: Sender) = Person.Builder().setKey(s.id).setName(s.name).setIcon(IconCompat.createWithBitmap(head(s.id, s.color, s.outfit))).build()

    /** A reply with exactly one file (like a morning paper): tapping its notification opens that file. */
    private fun oneFile(d: JsonObject): String? = d.arr("files")?.singleOrNull()?.jsonObject?.str("file")?.ifBlank { null }?.let { BotFiles.PREFIX + it }

    /** Adds a message to its chat's notification (the last few stay, in order). [open]: what a tap opens. [quiet]: it doesn't ring. */
    private fun message(chat: String, from: Sender, markdown: String, at: Long, title: String? = null, open: String = chat, quiet: Boolean = false) {
        val old = stackOf(chat)
        val style = NotificationCompat.MessagingStyle(me)
        old?.messages?.takeLast(KEEP_MESSAGES - 1)?.forEach { style.addMessage(it) }
        style.addMessage(plain(markdown).take(1000), at, person(from))
        val chief = chat.startsWith("chief:")
        // A Chief chat is named by its title, and a group by its name: who said it stands under that.
        if (chief || groupOfChat(chat) != null) style.setConversationTitle(title?.ifBlank { null } ?: old?.conversationTitle ?: if (chief) CHIEF else "A group").setGroupConversation(true)
        notify(chat, chatBuilder(chat, style, at, quiet).setContentIntent(openApp(open)).setLargeIcon(if (chief) head(CHIEF_ID, CHIEF_COLOR) else head(from.id, from.color, from.outfit)))
    }

    /** After you replied from the notification: your words show under the chat's messages (null: it didn't send, just stop waiting). */
    fun replied(chat: String, text: String?) {
        val sbn = active(chat) ?: return
        val old = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(sbn.notification) ?: return
        val style = NotificationCompat.MessagingStyle(me).setConversationTitle(old.conversationTitle).setGroupConversation(old.isGroupConversation)
        old.messages.takeLast(KEEP_MESSAGES - 1).forEach { style.addMessage(it) }
        val now = System.currentTimeMillis()
        if (text != null) style.addMessage(text, now, null as Person?)
        notify(chat, chatBuilder(chat, style, now, quiet = true).apply { sbn.notification.getLargeIcon()?.let { setLargeIcon(it) } })
    }

    private fun stackOf(chat: String) = active(chat)?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it.notification) }

    private fun chatBuilder(chat: String, style: NotificationCompat.MessagingStyle, at: Long, quiet: Boolean): NotificationCompat.Builder {
        val last = style.messages.lastOrNull()
        return builder(CH_UPDATES, at, quiet)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentTitle(last?.person?.name ?: "You")
            .setContentText(last?.text?.lineSequence()?.firstOrNull { it.isNotBlank() }?.take(200))
            .setStyle(style)
            .setContentIntent(openApp(chat))
            .setPublicVersion(hidden(CH_UPDATES, "New message"))
            .addAction(replyAction(chat))
    }

    private fun replyAction(chat: String): NotificationCompat.Action {
        // Mutable, so Android can hand over what you typed.
        val pi = PendingIntent.getBroadcast(context, "reply:$chat".hashCode(),
            Intent(context, NotificationActions::class.java).setAction(NotificationActions.REPLY).putExtra(NotificationActions.EXTRA_KEY, chat),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0))
        return NotificationCompat.Action.Builder(0, "Reply", pi)
            .addRemoteInput(RemoteInput.Builder(NotificationActions.KEY_TEXT).setLabel("Reply").build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .setAuthenticationRequired(true) // what you send can set the Chief or a bot to work
            .build()
    }

    // ---------- the parts ----------

    private fun builder(channel: String, at: Long?, quiet: Boolean) = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_notification)
        .apply { if (at != null) setWhen(at).setShowWhen(true) }
        .setAutoCancel(true)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setSilent(quiet || !ringNow())
        .setPriority(if (channel == CH_NEEDS_YOU) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)

    /** A burst (catching up after a while offline, a reply with its bots' reports) rings once. */
    private fun ringNow(): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (lastRing != 0L && now - lastRing < 3_000) return false
        lastRing = now
        return true
    }

    private fun notify(tag: String, b: NotificationCompat.Builder) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        NotificationManagerCompat.from(context).notify(tag, 0, b.build())
    }

    private fun isReplay(id: String?): Boolean = isReplayOf(id, helloAt)

    private fun time(iso: String): Long? = timeOf(iso)

    // Each bot is its head with its hat, in notifications too: drawn from the one definition, as it looks in the app.
    private val heads = mutableMapOf<String, Bitmap>()
    /** The head of the bot [botId] (none, or [CHIEF_ID]: the Chief of Staff's) in [color]; a coloured circle when no definition can be used. */
    private fun head(botId: String?, color: String?, wears: JsonElement? = null): Bitmap {
        val def = figure() ?: return dot(color, HEAD_PX)
        val chief = botId.isNullOrBlank() || botId == CHIEF_ID
        val outfit = if (chief) FigureDef.CHIEF else wears ?: outfitOf(botId!!)
        val tint = color?.ifBlank { null } ?: if (chief) CHIEF_COLOR else null
        val dark = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        if (heads.size > 64) heads.clear()
        return heads.getOrPut("$tint/$outfit/$dark/${System.identityHashCode(def)}") {
            runCatching { figureBitmap(def, tint, outfit, HEAD_PX, dark) }.getOrElse { dot(color, HEAD_PX) }
        }
    }

    // Without a definition, and for you: a coloured circle.
    private val dots = mutableMapOf<String, Bitmap>()
    private fun dot(color: String?, size: Int): Bitmap = dots.getOrPut("$color/$size") {
        val c = runCatching { android.graphics.Color.parseColor(color) }.getOrElse { android.graphics.Color.parseColor(CHIEF_COLOR) }
        Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also { Canvas(it).drawCircle(size / 2f, size / 2f, size / 2f, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = c }) }
    }

    // The notifications showing, kept while an event is handled on [handling] (other threads always read them afresh).
    @Volatile private var handling: Thread? = null
    private var showing: Array<StatusBarNotification>? = null
    private fun showingNow(): Array<StatusBarNotification> {
        val read = { runCatching { nm.activeNotifications }.getOrDefault(emptyArray()) }
        if (Thread.currentThread() !== handling) return read()
        return showing ?: read().also { showing = it }
    }

    private fun active(tag: String): StatusBarNotification? = showingNow().firstOrNull { it.tag == tag }

    /** Take away the notifications whose tag matches (they're answered, or their chat was read). */
    private fun cancelWhere(match: (String) -> Boolean) {
        showingNow().forEach { if (it.tag != null && match(it.tag)) nm.cancel(it.tag, it.id) }
    }

    private fun openApp(target: String): PendingIntent {
        val i = Intent(context, MainActivity::class.java).putExtra(EXTRA_OPEN, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, target.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Replies are Markdown; a notification shows plain text ("## This week" -> "This week"). */
    private fun plain(md: String): String = plainText(md)
}

// Made once: plain() runs for every notification.
private val MD_HEADING = Regex("^#{1,6}\\s+")
private val MD_ITEM = Regex("^[-*+]\\s+")
private val MD_LINK = Regex("\\[([^\\]]+)]\\([^)]*\\)")
private val MD_BOLD = Regex("\\*\\*(.+?)\\*\\*|__(.+?)__")
private val MD_ITALIC = Regex("(?<![*\\w])\\*([^*]+)\\*(?!\\w)")

/** Replies are Markdown; a notification shows plain text ("## This week" -> "This week"). */
internal fun plainText(md: String): String = md.lineSequence().map { line ->
    line.trim()
        .replace(MD_HEADING, "")
        .replace(MD_ITEM, "• ")
        .replace(MD_LINK, "$1")
        .replace(MD_BOLD, "$1$2")
        .replace(MD_ITALIC, "$1")
        .replace("`", "")
}.filter { it.isNotBlank() && it != "---" && !it.startsWith("|---") }.joinToString("\n")

/**
 * What an ask's notification says under its bot's name, the label of its yes button (null: none), and whether it has
 * Decline. Without either button a tap opens Needs you; so does a tap beside the buttons.
 */
internal class AskWords(val text: String, val yes: String?, val decline: Boolean = yes != null, val no: String = DECLINE)

/** What the no of a notification reads when the server names none. */
internal const val DECLINE = "Decline"

/** The tag of the notification that Claude is signed out, and what it says. */
internal const val SIGNED_OUT_KEY = "claude"
internal const val SIGNED_OUT_TEXT = dev.botdot.app.ui.SIGNED_OUT // the words of the line above the message box

/** What the feed's word on Claude's sign-in does to that notification. */
internal enum class SignedOutStep { RING, TAKE, NONE }

/**
 * [signedOut]: what "hello" or the `claude` event says (null: nothing). [rung]: this sign-out was said already.
 * Signed out and not yet said: it rings, once. Signed in: the notification goes, and the next sign-out rings again.
 * It does not ask whether the web page is in use: the asks stay silent then, this does not.
 */
internal fun signedOutStep(signedOut: Boolean?, rung: Boolean): SignedOutStep = when (signedOut) {
    true -> if (rung) SignedOutStep.NONE else SignedOutStep.RING
    false -> SignedOutStep.TAKE
    null -> SignedOutStep.NONE
}

/**
 * Whether something that needs the owner makes no notification: the web page is in use, where it shows already.
 * Not what is said [evenOnWeb]: that Claude is signed out.
 */
internal fun staysSilent(webActive: Boolean, evenOnWeb: Boolean): Boolean = webActive && !evenOnWeb

/** `yesOn` of an entry whose yes is given on the ask's card and nowhere else (docs/api.md). */
internal const val YES_ON_CARD = "card"

/** The buttons of a notification of what needs you, in their order: each label, and whether it is the yes. [noLabel]: what the no reads. */
internal fun answerButtons(yes: String?, no: Boolean, noLabel: String = DECLINE): List<Pair<String, Boolean>> =
    listOfNotNull((noLabel to false).takeIf { no }, yes?.let { it to true })

/**
 * The yes button of an entry of what waits (an ask, a job, a tile): [label], or none when the entry says
 * `yesOn: "card"`. The owner then says yes on the card, which shows what the notification cannot: a script, a
 * link's warning. Read as the card's fields are, without the blanks around it; an entry without the field, or with
 * another value, keeps its yes.
 */
internal fun yesButton(label: String?, o: JsonObject): String? = label.takeIf { o.str("yesOn").trim() != YES_ON_CARD }

/** What an entry of what waits says of itself (`text`, docs/api.md), or "" from a server that sends none. */
private fun saidText(o: JsonObject) = o.str("text").trim()

/** What an ask says when the app has no words for it: enough to open its card, and nothing to answer blind. */
internal const val NEEDS_OK = "Needs your OK"

/**
 * The words of one entry of the feed's `asks` (docs/api.md), of any kind. The line is the server's own (`text`:
 * "Asks to install gh", "Asks to install stripe from a link") and the app adds nothing to it. Its yes is named by
 * its kind, and is answered only once the phone is unlocked, as every answer from a notification is; with
 * `yesOn: "card"` it keeps Decline and has no yes ([yesButton]).
 * An entry without the line, from an older server: a permission says "Asks to <what>" when it names what, a skill
 * its name, and a tool nothing, with no button, so nothing is installed from a notification that does not say what.
 * Any other, a kind this app has no words for or a permission that names nothing, says "Needs your OK" with no
 * button at all: a tap opens its card.
 */
internal fun askWords(o: JsonObject): AskWords {
    val kind = o.str("kind").ifBlank { "permission" } // as the asks themselves are read (Ask.kind)
    val said = saidText(o)
    val yes = when (kind) { "skill" -> "Install"; ToolCard.KIND -> ToolCard.INSTALL; "permission" -> "Allow"; else -> "Approve" }
    val what = o.str("what").trim()
    return when {
        said.isNotEmpty() -> AskWords(said, yesButton(yes, o), decline = true)
        kind == "skill" -> AskWords("Asks to install the skill “${o.str("skill")}”", yesButton(yes, o), decline = true)
        kind == ToolCard.KIND -> AskWords("", null)
        kind == "permission" && what.isNotEmpty() -> AskWords("Asks to $what", yesButton(yes, o), decline = true)
        else -> AskWords(NEEDS_OK, null)
    }
}

/** What the notification of a waiting memory change says: [text] under the bot's name, [detail] when it is opened, and its buttons. */
internal class MemoryWords(val text: String, val detail: String?, val yes: String?, val decline: Boolean, val no: String = DECLINE)

/**
 * The words of one entry of `approvals.memoryChanges` (docs/api.md, "A waiting memory change"). Against a server that
 * announces `memory-cards` and sends them, the card's own: its `title`, under it the note and why it waits (`meta`),
 * and both buttons in the server's words (`no`, `yes`). A guarded change (one to what the owner said, and a forget)
 * has no button at all: a tap opens its card, where it is answered by itself. Any other entry reads as it did:
 * "Add to the shared memory" and the like, with Decline and Approve. [features]: the server's, null while unknown.
 */
internal fun memoryWords(o: JsonObject, features: Collection<String>?): MemoryWords {
    val note = o.str("text").trim().ifEmpty { null }
    val guarded = isTrue(o["guarded"])
    val words = cardWords(features, o["title"], o["yes"], o["no"])
    if (words != null) {
        val detail = listOfNotNull(note, o["meta"].textOrNull()).joinToString("\n").ifEmpty { null }
        return if (guarded) MemoryWords(words.title, detail, null, decline = false) else MemoryWords(words.title, detail, words.yes, decline = true, no = words.no)
    }
    // A guarded change without the card's words: nothing says what a yes would do, so it has no button either.
    if (guarded) return MemoryWords(NEEDS_OK, null, null, decline = false)
    val verb = when (o.str("action")) { "edit" -> "Change in"; "remove" -> "Remove from"; else -> "Add to" }
    return MemoryWords("$verb the shared memory", note, "Approve", decline = true)
}

/**
 * The notifications of memory changes to draw again, by their keys: a change that rang with Decline and Approve and
 * has become guarded since (its note became the owner's while it waited, docs/api.md "A guarded change"). Its
 * notification is still showing with a yes it must not have. [guarded]: the keys of the guarded changes that wait
 * now; [rang]: what had rung before this event; [showing]: the notifications on the phone.
 */
internal fun redrawn(guarded: List<String>, rang: Set<String>, showing: Set<String>): List<String> = guarded.filter { it in rang && it in showing }

/**
 * The words of one entry of `approvals.jobs`: the server's `text`, or "Waiting for your OK: <its name>" from a server
 * that sends none. Approve, unless the entry says its yes is on the card (a script). Its buttons read the server's
 * words where it sends them (`no`: "Decline and remove" for a job never approved; `no` and `yes` for a change to an
 * approved one); an entry that says `change: true` without them reads "Keep as it is" and "Approve the change",
 * since its no removes nothing. Any other reads "Decline" and "Approve", as before.
 */
internal fun jobWords(o: JsonObject): AskWords = waitingWords(o, "Waiting for your OK: ${o.str("jobName")}")

/** The words of one entry of `approvals.tiles`, as [jobWords]: the server's `text`, or the app's own line. */
internal fun tileWords(o: JsonObject): AskWords = waitingWords(o, tileWaits(o.str("title")))

private fun waitingWords(o: JsonObject, own: String): AskWords {
    val change = isTrue(o["change"])
    return AskWords(
        saidText(o).ifEmpty { own },
        yesButton(o.str("yes").trim().ifEmpty { if (change) "Approve the change" else "Approve" }, o),
        decline = true,
        no = o.str("no").trim().ifEmpty { if (change) "Keep as it is" else DECLINE },
    )
}

/** What the notification of a run that asks the owner something says: its [title] ("Mail Sorter asks") and the question. */
internal class AsksNotice(val title: String, val body: String)

/**
 * The notification of a reply that holds a question for the owner (`asks: true` on the run, docs/api.md): the server's
 * [title], or "<bot> asks" where it sends none, and the [question] in the server's one line: a long reply asks at its
 * end, and its first words ([result]) need not hold the question. Against a server that sends no `question` the body
 * is the reply's text, as before. null for any other run, and for one whose event carries neither: it notifies as a
 * reply does.
 */
internal fun asksNotice(asks: Boolean, title: String?, bot: String, result: String?, question: String? = null): AsksNotice? {
    if (!asks) return null
    val body = question?.trim()?.ifEmpty { null } ?: result?.takeIf { it.isNotBlank() } ?: return null
    return AsksNotice(title?.trim()?.ifEmpty { null } ?: "$bot asks", body)
}

/**
 * What the notification of a Chief reply says, from its `chief_reply` event: the reply, or, when its `status` is
 * "error", the problem and not the half-written text.
 */
internal fun chiefReplyText(status: String, text: String, error: String): String =
    (if (status == "error") error.ifBlank { text } else text.ifBlank { error }).ifBlank { "Replied." }

// ---------- following the botdot server's unread state (ADR 005) ----------

private const val CHIEF = "Chief of Staff"
private const val CHIEF_ID = "chief" // in place of a bot's id: the Chief of Staff

private fun timeOf(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

/** A chat with new replies, as the botdot server says. [first] asks it for the first of them. */
class NewChat(val chat: String, val first: suspend () -> NewReply?)

/** A new reply, to show in its chat's notification: who said it ([botId] "chief": the Chief of Staff), what it wears, and what it said. */
class NewReply(val botId: String, val name: String, val color: String?, val text: String, val at: Long?, val title: String? = null, val outfit: JsonElement? = null)

/**
 * The chats with new replies, read from the botdot server (`GET /api/bots`, `GET /api/chief`). The app counts
 * nothing: a chat is new when the server gives it `unread`, and its first new reply is the one `firstUnread` names.
 */
suspend fun newChats(api: Api): List<NewChat> = coroutineScope {
    val bots = async { api.bots() }
    val chief = async { api.chief() }
    val all = bots.await()
    all.filter { it.unread > 0 }.map { b ->
        NewChat("bot:${b.id}") {
            b.firstUnread?.let { api.run(it) }?.let { r ->
                val asks = asksNotice(r.asks, r.title, b.name, r.result, r.question)
                NewReply(b.id, asks?.title ?: b.name, b.color, asks?.body ?: runText(r.status, r.result.orEmpty(), r.problem.orEmpty(), r.error.orEmpty(), r.jobName.orEmpty()), timeOf(r.endedAt), outfit = b.outfit)
            }
        }
    } + chief.await().chats.filter { it.unread > 0 }.map { c ->
        NewChat("chief:${c.id}") {
            c.firstUnread?.let { api.chiefChat(c.id, offset = it, limit = 1) }?.messages?.firstOrNull()?.let { m ->
                val text = m.text.ifBlank { m.error?.ifBlank { null } ?: "Replied." }
                val from = m.from?.takeIf { m.role == "report" } // a bot's reply posted in the chat
                if (from == null) NewReply(CHIEF_ID, CHIEF, CHIEF_COLOR, text, timeOf(m.endedAt ?: m.at), c.title)
                else all.firstOrNull { it.id == from.id }.let { now -> // the bot as it looks now
                    NewReply(from.id, from.name.ifBlank { "A bot" }, now?.color ?: from.color, text, timeOf(m.endedAt ?: m.at), c.title, now?.outfit)
                }
            }
        }
    }
}

/** What a finished run says in a notification: its reply, or why it didn't finish, under its job's name. */
internal fun runText(status: String, result: String, problem: String, error: String, job: String): String {
    val body = if (status == "success") result.ifBlank { "Done." } else problem.ifBlank { "Didn't finish: ${error.ifBlank { status }}" }
    return (if (job.isNotBlank()) "$job\n" else "") + body
}

internal fun isChat(tag: String) = tag.startsWith("bot:") || tag.startsWith("chief:")

// ---------- a group (Milestone 10; docs/api.md, "A card and a question in a group") ----------

/**
 * Whether the end of a turn in a group (`group_run_finished`) makes a notification: only a reply that asks the owner
 * something, which the server marks `notify: true`. No other reply in a group ever notifies, new or not. Nor does a
 * question in the group that is on screen with the app in front ([watching]): the owner is reading it.
 */
internal fun groupNotifies(ev: FeedEvent, chat: String, watching: String?): Boolean =
    ev.type == "group_run_finished" && isTrue(ev.data["notify"]) && chat != watching

/**
 * The group whose notification goes, as "group:<id>": it was read, in any app (`group_unread` with a count of 0), or
 * its open question ended (`group_asks` without one). null for any other event.
 */
internal fun groupSettled(ev: FeedEvent): String? {
    val group = ev.data.str("groupId").ifEmpty { return null }
    return when (ev.type) {
        "group_unread" -> groupKey(group).takeIf { (ev.data["unread"] as? JsonPrimitive)?.takeIf { n -> !n.isString }?.intOrNull == 0 }
        "group_asks" -> groupKey(group).takeIf { "asks" in ev.data && ev.data["asks"] !is JsonObject }
        else -> null
    }
}

/** Whom the notification of a card names, and what a tap on it opens. */
internal class CardPlace(val title: String, val open: String)

/**
 * A card asked in a group (`groupId` and `groupName` on its entry in the feed) names its bot and the group, "Coder
 * in Dev", and a tap opens the group, where the card stands at the end of the chat. Any other card names its bot
 * and opens Needs you, as before. [nameNow]: what the group is called now, when the app knows.
 */
internal fun cardPlace(o: JsonObject, bot: String, nameNow: (String) -> String? = { null }): CardPlace {
    val group = GroupRef.of(o) ?: return CardPlace(bot, "needs")
    return CardPlace("$bot in ${nameNow(group.id) ?: group.name}", groupKey(group.id))
}

/**
 * Where things stand when an event arrives. [follows]: the botdot server keeps what is new and read. [watching]: the
 * chat on screen with the app in front. [webActive]: the web page is in use. The last two count only with a server
 * from before unread state.
 */
internal class Standing(val follows: Boolean, val watching: String? = null, val webActive: Boolean = false)

/**
 * Whether a reply (`run_finished`, `chief_reply`) in [chat] gets a notification. With unread state it does exactly
 * when the server says it is new; replayed events are followed in order like any other, so a reply that was read
 * since is taken away again by the `unread` that follows it. A server from before decides nothing: the reply
 * notifies unless it isn't for the owner, its chat is on screen or the web page is in use.
 */
internal fun replyNotifies(ev: FeedEvent, chat: String, s: Standing): Boolean =
    if (s.follows) ev.data.str("new") == "true" else shouldNotifyOwner(ev) && chat != s.watching && !s.webActive

/**
 * The chat an event says was read, whose notification goes: `unread` with a count of 0 from a server with unread
 * state, `chat_seen` from one before it (each ignores the other's event).
 */
internal fun chatRead(ev: FeedEvent, s: Standing): String? {
    val chat = ev.data.str("chat").takeIf(::isChat) ?: return null
    return when (ev.type) {
        "unread" -> chat.takeIf { s.follows && (ev.data["unread"] as? JsonPrimitive)?.intOrNull == 0 }
        "chat_seen" -> chat.takeIf { !s.follows }
        else -> null
    }
}

/** What "hello" changes: the chats whose notification goes, and those that get one again, quietly. */
internal class CatchUp(val remove: Set<String>, val rebuild: Set<String>)

/**
 * Brings the chats' notifications in line with the server's unread state. [showing]: the chats that have a
 * notification; [unread]: the chats with new replies. A notification of a read chat goes. With [rebuild] (the app
 * started, or the feed replayed nothing), an unread chat without one gets it again, except the chat being
 * [watching]: the server is about to hear that it is read. A chat an event [touched] since the server was asked is
 * left as the event made it.
 */
internal fun catchUpOf(showing: Set<String>, unread: Set<String>, rebuild: Boolean, watching: String?, touched: Set<String> = emptySet()): CatchUp =
    CatchUp(showing - unread - touched, if (rebuild) unread - showing - touched - setOfNotNull(watching) else emptySet())

/** The notification of a tile whose script waits for your OK. */
internal fun tileWaits(title: String) = "Waiting for your OK: “$title” on your Board (a script)"
