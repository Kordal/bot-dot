package dev.botdot.app.answerview

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Live numbers in answer views (#1630, ADR 264 amendment, ADR 071), for both phones: a kpi, gauge, sparkline, chart or table that
 * names a tile of the Board (`tile`, with `bind`) shows the tile's values over the ones the bot wrote. The server fills them in
 * (POST /api/dashboard/live, as a page's blocks are) and gives each node back read by the same validator; a null is a tile that is
 * gone, waits for the owner or can't be read, and the written values then stay with nothing said. This holds only what the apps
 * share: which nodes bind, what is asked and how the answer is read.
 */
object AnswerViewLive {
    const val FEATURE = "ui-live"
    val BOUND = setOf("kpi", "gauge", "sparkline", "chart", "table")

    fun isBound(n: ViewNode) = n.type in BOUND && !n.text("tile").isNullOrEmpty()

    /** A node that binds, and the path it stands at in its view (`0`, then `.i` for each child: the paths the drawing gives). */
    class At(val path: String, val node: ViewNode)

    fun boundIn(root: ViewNode, path: String = "0"): List<At> =
        (if (isBound(root)) listOf(At(path, root)) else emptyList()) + root.children.orEmpty().flatMapIndexed { i, c -> boundIn(c, "$path.$i") }

    /** What is asked: the nodes as the validator kept them, and the bot whose reply it is (of tiles of one title, that bot's first). */
    fun body(bot: String?, nodes: List<ViewNode>): JsonObject = buildJsonObject {
        if (!bot.isNullOrEmpty()) put("bot", bot)
        put("nodes", JsonArray(nodes.map { it.toJson() }))
    }

    /**
     * What the server answered, read for each node asked: the node with the tile's values, read again by [views] (the same rules
     * as a fence's), or null where there are none. An answer that can't be read is all nulls.
     */
    fun filled(views: AnswerViews, asked: List<ViewNode>, answer: String): List<ViewNode?> {
        val list = (StrictJson.parse(answer) as? JsonObject)?.get("nodes") as? JsonArray ?: return asked.map { null }
        return asked.mapIndexed { i, n ->
            val raw = list.getOrNull(i) as? JsonObject ?: return@mapIndexed null
            val fence = buildJsonObject { put("alt", "x"); put("root", raw) }.toString()
            ((views.validate(fence) as? ViewResult.Drawn)?.root)?.takeIf { it.type == n.type }
        }
    }

    /** The ids of the tiles the server read, to ask again when the live feed says one changed. */
    fun tiles(answer: String): Set<String> =
        ((StrictJson.parse(answer) as? JsonObject)?.get("tiles") as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }.toSet()
}
