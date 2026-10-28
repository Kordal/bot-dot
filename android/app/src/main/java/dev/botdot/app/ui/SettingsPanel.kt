package dev.botdot.app.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.saveable.Saver
import dev.botdot.app.data.tr

/**
 * The settings panel: a bot's settings, its jobs or the Chief's settings, open for one chat. With room it stands
 * right of that chat; without, it covers the chat, as the screens it holds always did.
 * [chat]: a bot's id, [SettingsPanel.CHIEF], or a group's chat ("group:<id>": its name and its members). [jobs]: the bot's jobs, not its settings. [fromSettings]: the jobs
 * were opened from the settings, so Back returns there.
 */
/** [skill]: the settings open on that skill, a skill's chip was tapped ("" for its Skills alone); null for none. */
data class Panel(val chat: String, val jobs: Boolean = false, val fromSettings: Boolean = false, val skill: String? = null)

/** What a tap leads to; MainActivity draws it. Widths in dp. */
object SettingsPanel {
    const val CHIEF = "chief"
    const val WIDTH = 360
    /** The least the chat and the panel need together. */
    const val ROOM = 2 * WIDTH

    /** Is there room for the panel beside the chat? [width]: the window's; [listShown]: the list stands beside the chat, [list] wide, and its line with it. */
    fun room(width: Int, listShown: Boolean, list: Int = ListWidth.STANDARD) = width - (if (listShown) list + ListWidth.LINE else 0) >= ROOM

    /** The chat a route shows, null for a screen that is no chat. On a wide screen "home" is the Chief's chat; on a phone, the list. */
    fun chatOf(route: String?, id: String?, wide: Boolean): String? = when {
        route == null -> null
        route.startsWith("chief") -> CHIEF
        route == "home" -> CHIEF.takeIf { wide }
        route.startsWith("bot/") -> id
        route.startsWith("group/") -> id?.let { dev.botdot.app.data.groupKey(it) }
        else -> null
    }

    /** The figure and name in a bot's chat, the gear in the Chief's. */
    fun toggle(panel: Panel?, chat: String): Panel? = if (panel != null) null else Panel(chat)

    /** A chip in the chat that leads to the settings (a skill, a change to its instructions, a connected app): opens them, also over the jobs, a skill's on that skill. A chip about a note opens nothing. */
    fun settings(chat: String, skill: String? = null) = Panel(chat, skill = skill)

    /**
     * A chat was chosen, in the list or by a tapped notification: where the panel covers the chat it makes way,
     * also for the chat it belongs to; beside the chat it stays, and [follow] moves it to that chat.
     */
    fun chosen(panel: Panel?, room: Boolean): Panel? = panel.takeIf { room }

    /** "Scheduled jobs", in the chat or in the settings. */
    fun jobs(panel: Panel?, chat: String) = Panel(chat, jobs = true, fromSettings = panel != null && (!panel.jobs || panel.fromSettings))

    /** Back: from the jobs to the settings they were opened from, else to the chat. */
    fun back(panel: Panel?): Panel? = panel?.takeIf { it.jobs && it.fromSettings }?.let { Panel(it.chat) }

    /**
     * The panel once the screen shows [chat]. Beside the chat it stays open, on the settings of whichever chat is
     * chosen; where it covers the chat it makes way for a chat that was chosen. A screen that is no chat keeps it
     * for the way back.
     */
    fun follow(panel: Panel?, chat: String?, room: Boolean): Panel? = when {
        panel == null || chat == null || chat == panel.chat -> panel
        room -> Panel(chat)
        else -> null
    }

    val Saver = Saver<Panel?, List<String>>(
        save = { p -> p?.let { listOf(it.chat, it.jobs.toString(), it.fromSettings.toString()) } ?: emptyList() },
        restore = { l -> l.takeIf { it.size == 3 }?.let { Panel(it[0], it[1].toBoolean(), it[2].toBoolean()) } },
    )
}

/** The chat is under the panel: it is not on screen, so its new replies stay new (ADR 005). */
val LocalChatCovered = compositionLocalOf { false }

/** Set where a screen stands in the panel beside the chat: what its close button does. Null where it covers the chat (there's Back). */
val LocalPanelClose = compositionLocalOf<(() -> Unit)?> { null }

/** The panel's close button, in the screen's top bar; nothing where the screen covers the chat. */
@Composable
fun PanelClose() {
    val close = LocalPanelClose.current ?: return
    IconButton(onClick = close) { Icon(Icons.Filled.Close, contentDescription = tr("Close")) }
}
