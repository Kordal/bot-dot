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
import androidx.compose.ui.text.style.TextOverflow
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
internal fun FixedProjectOverview(ui: CompanyUi, c: Company, ways: CompanyWays, needsYou: @Composable (questions: List<OverviewEntry>, open: (OverviewEntry) -> Unit) -> Unit = { _, _ -> }) {
    val p = LocalPaper.current
    val api by ui.app.api.collectAsState()
    val life = LocalLifecycleOwner.current
    // What botdot recorded and the newest files, read as the iPhone reads them (OverviewDesk); again every 30 seconds.
    val desk = remember(c.id, api) { api?.let { dev.botdot.app.data.OverviewDesk(it, c.id) } }
    val state = desk?.state?.collectAsState()?.value ?: dev.botdot.app.data.OverviewState()
    val snapshot = state.snapshot
    val files = state.files
    var request by remember(c.id) { mutableStateOf(0) }
    val server by ui.app.store.version.value.collectAsState() // its features: whether links show their site's icon
    val sites = sitesShown(server?.features)
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
    // The questions waiting for the owner stand in Needs you, above, not again under Blockers.
    needsYou(snapshot?.questions().orEmpty(), ::open)
    Column(Modifier.fillMaxWidth().testTag("project-overview"), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        state.problem?.let { Text(it, color = p.err) }
        Text(state.status, color = p.muted, fontSize = if (snapshot != null) Type.s12 else androidx.compose.ui.unit.TextUnit.Unspecified)
        SmallButton(tr("Refresh")) { request++ }
        snapshot?.let { d ->
            OverviewSection(tr("Current work")) { OverviewRows(d.work, ::open, dev.botdot.app.data.Overviews.noWork, sites) }
            OverviewSection(tr("Blockers")) { OverviewRows(d.failures(), ::open, dev.botdot.app.data.Overviews.noBlockers, sites) }
            OverviewSection(tr("Latest replies")) { OverviewRows(d.replies, ::open, dev.botdot.app.data.Overviews.noReplies, sites) }
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
internal fun OverviewRows(items: List<OverviewEntry>, open: (OverviewEntry) -> Unit, empty: String? = null, sites: Boolean = false) {
    val p = LocalPaper.current
    if (items.isEmpty() && empty != null) Text(empty, color = p.muted)
    items.forEach { x ->
        Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { open(x) }.padding(vertical = Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Row { Text(x.name, color = p.text, fontWeight = FontWeight.SemiBold) }
            Text(dev.botdot.app.data.Overviews.meta(x), color = p.muted, fontSize = Type.s12)
            // The bot's Markdown as in its chat, in at most four lines; a link opens itself, the rest of the row the chat.
            if (x.text.isBlank()) Text(dev.botdot.app.data.Overviews.text(x), color = p.text)
            else {
                val text = remember(x.text, p, sites) { previewText(x.text, p.text, p, sites) }
                Text(text, color = p.text, maxLines = 4, overflow = TextOverflow.Ellipsis, inlineContent = remember(text) { siteIconsIn(listOf(text)) })
            }
        }
    }
}

/** The overview's snapshot for its board tiles (overview-board, ADR 245): polled while a tile shows, never starting the computer. */
internal class OverviewFeed(val snapshot: ProjectOverview?, val error: String?)

@Composable
internal fun rememberOverviewFeed(ui: CompanyUi, c: Company): OverviewFeed {
    val api by ui.app.api.collectAsState()
    val life = LocalLifecycleOwner.current
    var snapshot by remember(c.id, api) { mutableStateOf<ProjectOverview?>(null) }
    var error by remember(c.id, api) { mutableStateOf<String?>(null) }
    LaunchedEffect(c.id, api, life) {
        val a = api ?: return@LaunchedEffect
        life.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                runCatching { a.projectOverview(c.id) }.onSuccess { if (it.projectId == c.id) { snapshot = it; error = null } }.onFailure { if (it is CancellationException) throw it; error = it.message ?: tr("Couldn't refresh") }
                delay(30_000)
            }
        }
    }
    return OverviewFeed(snapshot, error)
}

/** Where a row of the overview opens: its team chat, its bot, or the Chief's chat. */
internal fun overviewOpener(ui: CompanyUi, c: Company, ways: CompanyWays): (OverviewEntry) -> Unit = { x ->
    x.destination(c, ui.bots.value, ui.app.store.version.value.value?.features)?.let { route ->
        when {
            route.startsWith("group/") -> ways.onTeam?.invoke(route.removePrefix("group/")) ?: ways.onNeeds()
            route.startsWith("bot/") -> ways.onBot(route.removePrefix("bot/"))
            route.startsWith(dev.botdot.app.data.Spaces.PROJECT_CHIEF) -> ways.onChiefChat?.let { ui.openChief(c, it) }
            route == dev.botdot.app.data.Spaces.CHIEF -> ways.onChief()
            route.startsWith("chief/") -> ways.onChiefChat?.invoke(route.removePrefix("chief/"))
        }
    }
}

/** Current work, Blockers or Latest replies as a board tile. */
@Composable
internal fun OverviewTile(key: String, feed: OverviewFeed, open: (OverviewEntry) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    val title = when (key) { "work" -> tr("Current work"); "blockers" -> tr("Blockers"); else -> tr("Latest replies") }
    Column(modifier.fillMaxWidth().raised(Radius.card).padding(Space.s16).testTag("overview-$key"), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Text(title, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16, modifier = Modifier.semantics { heading() })
        feed.error?.let { Text("${tr("Couldn't refresh")}: $it", color = p.err) }
        val d = feed.snapshot
        when {
            d == null -> Text(if (feed.error == null) tr("Loading…") else tr("Information unavailable"), color = p.muted)
            key == "work" -> OverviewRows(d.work, open, tr("No recorded work."))
            key == "blockers" -> OverviewRows(d.failures(), open, tr("No failed work."))
            else -> OverviewRows(d.replies, open, tr("No replies yet."))
        }
    }
}
