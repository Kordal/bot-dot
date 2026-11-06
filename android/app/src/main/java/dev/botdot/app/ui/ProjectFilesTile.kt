package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Company
import dev.botdot.app.data.ProjectFiles
import dev.botdot.app.data.RecentFile
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay

internal const val PROJECT_FILES_TILE = "project-files-tile"
private const val FILES_COLOR = "#e8b44a"

/**
 * The Files tile of a project's board (web: public/company-files-view.js): the newest files of its folder, asked of
 * GET /api/company/files when the project changes and each minute while on screen. A tap on the tile opens the folder
 * in Files; a tap on a file opens Files at the folder it is in.
 */
@Composable
internal fun ProjectFilesTile(ui: CompanyUi, c: Company, onFolder: (name: String, path: String) -> Unit) {
    val folder = c.folder ?: return
    val p = LocalPaper.current
    var files by remember(c.id) { mutableStateOf<List<RecentFile>>(emptyList()) }
    LaunchedEffect(c.id) {
        while (true) {
            runCatching { ui.api?.projectFiles() }.getOrNull()?.let { files = it.files }
            delay(ProjectFiles.AGAIN_MS)
        }
    }
    val shape = Radius.card
    Column(Modifier.fillMaxWidth().testTag(PROJECT_FILES_TILE).clip(shape).background(p.bg).border(1.dp, p.line2, shape)
        .clickable(onClickLabel = tr("Files")) { onFolder(folder.name, "") }.padding(Space.s12),
        verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Row(Modifier.padding(bottom = Space.s4), verticalAlignment = Alignment.CenterVertically) {
            Dot(FILES_COLOR)
            Text(tr("Files"), color = p.text, fontSize = Type.s14, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = Space.s8))
        }
        files.forEach { f ->
            Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(Radius.small).clickable(onClickLabel = f.name) { onFolder(folder.name, ProjectFiles.folderOf(f.path)) },
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Description, null, tint = p.muted, modifier = Modifier.size(18.dp))
                Text(f.name, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = Space.s12))
                Text(ProjectFiles.whenOf(f.at), color = p.muted, fontSize = Type.s12, maxLines = 1)
            }
        }
    }
}
