package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** Which figure definition a phone draws its bots from (ADR 003): the copy it was built with, then the server's. */
object Figures {
    /**
     * The definition for a server whose version says [key] ([VersionInfo.figureKey]): [bundled] when it hands none out,
     * else its own, asked again every 30 s until it arrives. One this app can't draw from (a newer format) is
     * [bundled], not an earlier server's. As the Android app follows it (BotDotApp).
     */
    @Throws(Exception::class)
    suspend fun of(api: Api, key: String?, bundled: FigureDef?): FigureDef? {
        if (key == null) return bundled
        while (true) {
            val text = runCatching { api.figure() }.getOrElse { e -> if (e is CancellationException) throw e; null }
            if (text != null) return runCatching { FigureDef.parse(text) }.getOrNull() ?: bundled
            delay(30_000)
        }
    }

    /** [text] read as a definition, or null for one this app can't draw from. */
    fun parse(text: String): FigureDef? = runCatching { FigureDef.parse(text) }.getOrNull()
}
