package dev.botdot.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import dev.botdot.app.BotDotApp
import dev.botdot.app.answerview.AnswerViewLive
import dev.botdot.app.answerview.ViewNode
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Live numbers in answer views (#1630, ADR 264 amendment, ADR 071). A kpi, gauge, sparkline, chart or table that names a tile of
 * the Board shows the tile's values over the ones the bot wrote: the written ones show first, and stay where the tile can't say
 * (it is gone, waits for the owner's OK, has not read yet), with nothing said. The server fills them in, as for a page's blocks
 * (POST /api/dashboard/live, announced as `ui-live`); the chat asks once when a view is drawn and again when the live feed's
 * `dashboard` says a tile it read changed. No polling of its own. Only in a chat of the owner's (a bot's, the Chief's, a group's):
 * a room, a tile and a document show what was written.
 */

/** What this app run knows of the live nodes: the last answer for a component, so that a chat drawn again shows it at once. */
internal object AnswerLiveMemory {
    class Got(val node: ViewNode?, val tiles: Set<String>)
    private val got = LinkedHashMap<String, Got>()
    fun of(key: String): Got? = got[key]
    fun put(key: String, g: Got) {
        got.remove(key)
        got[key] = g
        while (got.size > CAP) got.remove(got.keys.first())
    }
    const val CAP = 300
}

/** [n] with the tile's live values over its written ones, or [n] itself while they are not there. */
@Composable
internal fun rememberLive(n: ViewNode): ViewNode {
    val reply = LocalViewReply.current ?: return n
    val app = BotDotApp.of(LocalContext.current)
    val api by app.api.collectAsState()
    val server by app.store.version.value.collectAsState()
    val views = LocalAnswerViews.current
    val on = server?.features?.contains(AnswerViewLive.FEATURE) == true && views != null
    val key = remember(n, reply.bot) { "${reply.bot.orEmpty()}\u0000${n.toJson()}" }
    var got by remember(key) { mutableStateOf(AnswerLiveMemory.of(key)) }
    var changed by remember(key) { mutableIntStateOf(0) }
    // The feed says a tile changed (`dashboard`, with its id; none: the Board): a component that read it asks again.
    LaunchedEffect(key, on) {
        if (!on) return@LaunchedEffect
        app.feed.events.collect { ev ->
            if (ev.type != "dashboard") return@collect
            val id = ((ev.data["tile"] as? JsonObject)?.get("id") as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (id == null || got?.tiles?.contains(id) == true) changed++
        }
    }
    LaunchedEffect(key, on, api, changed) {
        val a = api
        if (!on || a == null || views == null) return@LaunchedEffect
        if (changed > 0) delay(400) // a tile that changes often is asked for once the changes have come
        val answer = runCatching { a.answerLive(AnswerViewLive.body(reply.bot, listOf(n))) }.getOrNull() ?: return@LaunchedEffect // the written values stay
        val next = AnswerLiveMemory.Got(AnswerViewLive.filled(views, listOf(n), answer).firstOrNull(), AnswerViewLive.tiles(answer))
        AnswerLiveMemory.put(key, next)
        got = next
    }
    return got?.node ?: n
}
