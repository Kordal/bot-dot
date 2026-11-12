package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Company
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.ManyProjects
import dev.botdot.app.data.tr

/**
 * The project's name over its page (#703, #840, #841): on a phone a tap opens the sheet of spaces ([SpaceSheet]), with
 * the project's square before the name; beside the rail it only says where the owner is. The gear beside it opens the
 * project's settings (#701), from a botdot with `project-settings`. The project tree it opened before spaces is gone:
 * the spaces switch projects and the team keys reach the bots (#841).
 */
@Composable
internal fun ProjectTitle(ui: CompanyUi, c: Company?, ways: CompanyWays, modifier: Modifier = Modifier, after: @Composable () -> Unit = {}) {
    val p = LocalPaper.current
    val server by ui.app.store.version.value.collectAsState()
    val features = server?.features
    val name = c?.let(ManyProjects::nameOf) ?: tr("New project")
    val switches = ui.spaces?.shown == true && !ui.railed
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f, fill = false)) {
            Row(Modifier.clip(Radius.small).clickable(enabled = switches, onClickLabel = tr("Projects")) { ui.spaceSheet = true }.padding(vertical = Space.s4)
                .then(if (switches) Modifier.testTag(SPACE_TITLE) else Modifier),
                verticalAlignment = Alignment.CenterVertically) {
                if (switches && c != null) SpaceSquare(name, c.color ?: ManyProjects.DEFAULT_COLOR, 28.dp)
                Text(name, color = p.text, fontSize = Type.s24, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = if (switches && c != null) Space.s8 else 0.dp).weight(1f, fill = false))
                if (switches) Icon(Icons.Outlined.ExpandMore, null, tint = p.muted, modifier = Modifier.padding(start = Space.s4).size(22.dp))
            }
        }
        if (c != null && features != null && ManyProjects.SETTINGS in features) RoundButton(Icons.Outlined.Settings, tr("Project settings"), Modifier.padding(start = Space.s4)) { ui.settingsOpen = true }
        if (c != null && c.phase == "running" && features != null && ManyProjects.TIDY in features && ways.onChiefChat != null) TidyButton(ui, ways.onChiefChat, Modifier.padding(start = Space.s4))
        if (c != null && features != null && ManyProjects.CHIEF in features && ways.onChiefChat != null) ProjectChiefButton(ui, c, ways.onChiefChat, Modifier.padding(start = Space.s4))
        after()
    }
}

/** Tidy up (web: Company.tidyHTML): the project's Chief arranges the whole board, asked in its chat, which opens. */
@Composable
private fun TidyButton(ui: CompanyUi, open: (String) -> Unit, modifier: Modifier = Modifier) {
    val api by ui.app.api.collectAsState()
    var busy by remember { mutableStateOf(false) }
    RoundButton(Icons.Outlined.Dashboard, tr("Tidy up the board"), modifier) {
        val a = api
        if (a != null && !busy) {
            busy = true
            ui.scope.launch { runCatching { a.tidyBoard() }.onSuccess { if (it.isNotEmpty()) { ui.app.store.company.refresh(); open(it) } }; busy = false }
        }
    }
}

/**
 * The Chief's head beside the gear (web: Company.chiefHTML): the project's own Chief chat, made on the first tap. The
 * number is what waits for the owner there, its unread replies and the Chief's cards asked in it.
 */
@Composable
private fun ProjectChiefButton(ui: CompanyUi, c: Company, open: (String) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    val chief by ui.app.store.chief.value.collectAsState()
    val needs by ui.app.store.needs.value.collectAsState()
    val api by ui.app.api.collectAsState()
    var busy by remember { mutableStateOf(false) }
    val id = c.chiefChat
    val waiting = if (id == null) 0 else (chief?.chats?.firstOrNull { it.id == id }?.unread ?: 0) + needs?.asks.orEmpty().count { it.chatId == id }
    val name = LocalChiefName.current
    val tap = {
        val a = api
        if (id != null) open(id)
        else if (a != null && !busy) {
            busy = true
            ui.scope.launch { runCatching { a.projectChiefChat() }.onSuccess { if (it.isNotEmpty()) { ui.app.store.company.refresh(); open(it) } }; busy = false }
        }
    }
    RoundButton(if (waiting > 0) "$name ($waiting)" else name, modifier, onClick = tap, content = {
        Box(contentAlignment = Alignment.Center) {
            BotFigure(CHIEF_COLOR, if (chief?.busy == true) "working" else "idle", 28, FigureDef.CHIEF)
            if (waiting > 0) Box(Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-6).dp).defaultMinSize(minWidth = 16.dp, minHeight = 16.dp).clip(CircleShape).background(p.text).padding(horizontal = Space.s4), contentAlignment = Alignment.Center) {
                Text(if (waiting > 99) "99+" else waiting.toString(), color = p.bg, fontSize = Type.s12, fontWeight = FontWeight.SemiBold)
            }
        }
    })
}

