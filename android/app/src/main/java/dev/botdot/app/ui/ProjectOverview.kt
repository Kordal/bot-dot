package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Company
import dev.botdot.app.data.NotesWake
import dev.botdot.app.data.OverviewEntry
import dev.botdot.app.data.ProjectOverview
import dev.botdot.app.data.ProjectFiles
import dev.botdot.app.data.RecentFiles
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay

/** A fixed reading order; polls only while this overview is composed, never starts the computer. */
@Composable
internal fun FixedProjectOverview(ui: CompanyUi, c: Company, ways: CompanyWays) {
    val p = LocalPaper.current
    val api by ui.app.api.collectAsState()
    var snapshot by remember(c.id, api) { mutableStateOf<ProjectOverview?>(null) }
    var files by remember(c.id, api) { mutableStateOf<RecentFiles?>(null) }
    var error by remember(c.id, api) { mutableStateOf<String?>(null) }
    var filesError by remember(c.id, api) { mutableStateOf<String?>(null) }
    var request by remember(c.id) { mutableStateOf(0) }
    LaunchedEffect(c.id, api, request) {
        val a = api ?: return@LaunchedEffect
        while (true) {
            runCatching { a.projectOverview(c.id) }.onSuccess { if (it.projectId == c.id) { snapshot = it; error = null } }.onError { error = it.message ?: tr("Couldn't refresh") }
            runCatching { a.projectFiles(c.id) }.onSuccess { files = it; filesError = null }.onError { filesError = it.message ?: tr("Couldn't load files") }
            delay(30_000)
        }
    }
    fun open(x: OverviewEntry) {
        when {
            x.groupId != null -> ways.onTeam?.invoke(x.groupId) ?: ways.onNeeds()
            x.chatId != null -> ways.onChiefChat?.invoke(x.chatId) ?: ways.onChief()
            x.botId != null -> ways.onBot(x.botId)
            else -> c.lead?.let(ways.onBot) ?: ways.onChief()
        }
    }
    Column(Modifier.fillMaxWidth().testTag("project-overview"), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        error?.let { Text("${tr("Couldn't refresh")}: $it" + if (snapshot != null) " · ${tr("Showing saved information")}" else "", color = p.err) }
        snapshot?.let { Text(tr("Updated {when}", "when" to NotesWake.ago(it.at)), color = p.muted, fontSize = Type.s12) }
            ?: Text(if (error == null) tr("Loading…") else tr("Information unavailable"), color = p.muted)
        SmallButton(tr("Refresh")) { request++ }
        OverviewSection(tr("Goal")) { Text(c.goal.ifBlank { tr("No goal set.") }, color = p.text, fontSize = Type.s20) }
        snapshot?.let { d ->
            OverviewSection(tr("Current work")) { OverviewRows(d.work, tr("No recorded work."), ::open) }
            OverviewSection(tr("Blockers")) { OverviewRows(d.blockers, tr("No failed work or open questions."), ::open) }
            OverviewSection(tr("Latest replies")) { OverviewRows(d.replies, tr("No replies yet."), ::open) }
        }
        OverviewSection(tr("Files")) {
            filesError?.let { Text("${tr("Couldn't load files")}: $it" + if (files != null) " · ${tr("Showing saved information")}" else "", color = p.err) }
            val known = files
            when {
                known == null -> Text(if (filesError == null) tr("Loading…") else tr("Information unavailable"), color = p.muted)
                known.state == "off" -> Text(tr("Files are unavailable while the computer is off."), color = p.muted)
                known.files.isEmpty() -> Text(tr("No files yet."), color = p.muted)
                else -> known.files.forEach { f ->
                    Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { c.folder?.let { ways.onFolderFile(it.name, f.path) } }.padding(vertical = Space.s8)) {
                        Text(f.name, color = p.text)
                        Text(ProjectFiles.whenOf(f.at), color = p.muted, fontSize = Type.s12)
                    }
                }
            }
            c.folder?.let { folder -> ways.onFolderAt?.let { open -> SmallButton(tr("Open folder")) { open(folder.name, "") } } }
        }
    }
}

@Composable
private fun OverviewSection(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().raised(Radius.card).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Text(title, color = LocalPaper.current.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16, modifier = Modifier.semantics { heading() })
        content()
    }
}

@Composable
private fun OverviewRows(items: List<OverviewEntry>, empty: String, open: (OverviewEntry) -> Unit) {
    val p = LocalPaper.current
    if (items.isEmpty()) Text(empty, color = p.muted)
    items.forEach { x ->
        val label = when (x.state) { "working" -> tr("Working"); "planned" -> tr("Planned"); "failed" -> tr("Failed"); "asks" -> tr("Asks"); else -> tr("Reply") }
        Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { open(x) }.padding(vertical = Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Row { Text(x.name, color = p.text, fontWeight = FontWeight.SemiBold) }
            Text(label + if (x.at.isNotBlank()) " · ${NotesWake.ago(x.at)}" else "", color = p.muted, fontSize = Type.s12)
            Text(x.text.ifBlank { label }, color = p.text)
        }
    }
}
