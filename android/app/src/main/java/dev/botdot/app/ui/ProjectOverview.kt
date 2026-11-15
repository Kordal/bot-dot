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
import dev.botdot.app.data.OverviewEntry
import dev.botdot.app.data.ProjectFiles
import dev.botdot.app.data.tr
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

/** A fixed reading order; polls only while this overview is composed, never starts the computer. */
@Composable
internal fun FixedProjectOverview(ui: CompanyUi, c: Company, ways: CompanyWays) {
    val p = LocalPaper.current
    val api by ui.app.api.collectAsState()
    val life = LocalLifecycleOwner.current
    // What botdot recorded and the newest files, read as the iPhone reads them (OverviewDesk); again every 30 seconds.
    val desk = remember(c.id, api) { api?.let { dev.botdot.app.data.OverviewDesk(it, c.id) } }
    val state = desk?.state?.collectAsState()?.value ?: dev.botdot.app.data.OverviewState()
    val snapshot = state.snapshot
    val files = state.files
    var request by remember(c.id) { mutableStateOf(0) }
    LaunchedEffect(desk, request, life) {
        val d = desk ?: return@LaunchedEffect
        life.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { d.read(); delay(d.everyMs) }
        }
    }
    fun open(x: OverviewEntry) {
        when (val to = dev.botdot.app.data.Overviews.open(x.destination(c, ui.bots.value, ui.app.store.version.value.value?.features))) {
            is dev.botdot.app.data.Overviews.Open.Team -> ways.onTeam?.invoke(to.groupId) ?: ways.onNeeds()
            is dev.botdot.app.data.Overviews.Open.Bot -> ways.onBot(to.botId)
            dev.botdot.app.data.Overviews.Open.ProjectChief -> ways.onChiefChat?.let { ui.openChief(c, it) }
            dev.botdot.app.data.Overviews.Open.Chief -> ways.onChief()
            is dev.botdot.app.data.Overviews.Open.ChiefChat -> ways.onChiefChat?.invoke(to.chatId)
            null -> Unit
        }
    }
    Column(Modifier.fillMaxWidth().testTag("project-overview"), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        state.problem?.let { Text(it, color = p.err) }
        Text(state.status, color = p.muted, fontSize = if (snapshot != null) Type.s12 else androidx.compose.ui.unit.TextUnit.Unspecified)
        SmallButton(tr("Refresh")) { request++ }
        OverviewSection(tr("Goal")) { Text(c.goal.ifBlank { tr("No goal set.") }, color = p.text, fontSize = Type.s20) }
        snapshot?.let { d ->
            OverviewSection(tr("Current work")) { OverviewRows(d.work, dev.botdot.app.data.Overviews.noWork, ::open) }
            OverviewSection(tr("Blockers")) { OverviewRows(d.blockers, dev.botdot.app.data.Overviews.noBlockers, ::open) }
            OverviewSection(tr("Latest replies")) { OverviewRows(d.replies, dev.botdot.app.data.Overviews.noReplies, ::open) }
        }
        OverviewSection(tr("Files")) {
            state.filesProblem?.let { Text(it, color = p.err) }
            val line = state.filesLine
            when {
                line != null -> Text(line, color = p.muted)
                else -> files!!.files.forEach { f ->
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
        Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { open(x) }.padding(vertical = Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Row { Text(x.name, color = p.text, fontWeight = FontWeight.SemiBold) }
            Text(dev.botdot.app.data.Overviews.meta(x), color = p.muted, fontSize = Type.s12)
            Text(dev.botdot.app.data.Overviews.text(x), color = p.text)
        }
    }
}
