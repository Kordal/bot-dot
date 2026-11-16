package dev.botdot.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.BotNames
import dev.botdot.app.data.ChiefName
import dev.botdot.app.data.Mentions

/**
 * The bots a message in a chat can name, each name a link to that bot's chat ([BotNames]): the bots there are, and the
 * Chief by the name the owner gave it, not by its role. [open] takes a bot's id, or [Mentions.CHIEF].
 */
class BotLinks(val bots: List<BotNames.Bot>, val open: (String) -> Unit)

/** The names the chat on screen links; null links none. Given by the Chief's, a bot's and a group's chat. */
val LocalBotLinks = compositionLocalOf<BotLinks?> { null }

/** Opens a bot's chat, or the Chief's: given once, where the screens are. */
val LocalOpenChat = compositionLocalOf<((String) -> Unit)?> { null }

/** The links of a chat. [own]: the bot whose chat it is, which a link would not leave. */
@Composable
fun rememberBotLinks(app: BotDotApp, own: String? = null): BotLinks? {
    val bots by app.store.bots.value.collectAsState()
    val chief by app.store.chiefName.collectAsState()
    // The screens' own function, not a key: a new one each time the screens draw must not restyle every message.
    val open by rememberUpdatedState(LocalOpenChat.current)
    val role = ChiefName.role
    val shown = LocalOpenChat.current != null
    return remember(bots, chief, own, role, shown) {
        if (!shown) return@remember null
        val named = if (chief == role) emptyList() else listOf(BotNames.Bot(Mentions.CHIEF, chief))
        BotLinks((named + bots.orEmpty().map { BotNames.Bot(it.id, it.name) }).filter { it.id != own }) { id -> open?.invoke(id) }
    }
}
