package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Folder
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
import dev.botdot.app.data.ManyProjects
import dev.botdot.app.data.tr

internal const val PROJECT_FILES = "project-files"

/**
 * The project's name over its page (#703, #840, #841): on a phone a tap opens the sheet of spaces ([SpaceSheet]), with
 * the project's square before the name; beside the rail it only says where the owner is. The folder beside it opens the
 * project's folder in Files, the gear its settings (#701), from a botdot with `project-settings`. The project tree it opened before spaces is gone:
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
        // Its folder in Files, one tap from its page (it was only in its settings, #702).
        val folder = c?.folder
        val onFolder = ways.onFolder
        if (folder != null && onFolder != null) RoundButton(Icons.Outlined.Folder, tr("Files"), Modifier.padding(start = Space.s4).testTag(PROJECT_FILES)) { onFolder(folder.name) }
        if (c != null && features != null && ManyProjects.SETTINGS in features) RoundButton(Icons.Outlined.Settings, tr("Project settings"), Modifier.padding(start = Space.s4)) { ui.settingsOpen = true }
        after()
    }
}
