package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.CHIEF_COLOR
import dev.botdot.app.data.Company
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.OverviewDesk
import dev.botdot.app.data.OverviewEntry
import dev.botdot.app.data.OverviewState
import dev.botdot.app.data.Overviews
import dev.botdot.app.data.ProjectFiles
import dev.botdot.app.data.ProjectOverview
import dev.botdot.app.data.tr
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
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
    val bots by ui.bots.collectAsState() // each row's head
    LaunchedEffect(desk, request, life) {
        val d = desk ?: return@LaunchedEffect
        life.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { d.read(); delay(d.everyMs) }
        }
    }
    val open = remember(c, ways) { overviewOpener(ui, c, ways) }
    // The questions waiting for the owner stand in Needs you, above, not again under Blockers.
    needsYou(snapshot?.questions().orEmpty(), open)
    Column(Modifier.fillMaxWidth().testTag("project-overview"), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        state.problem?.let { Text(it, color = p.err) }
        Text(state.status, color = p.muted, fontSize = if (snapshot != null) Type.s12 else androidx.compose.ui.unit.TextUnit.Unspecified)
        SmallButton(tr("Refresh")) { request++ }
        snapshot?.let { d ->
            OverviewSection(tr("Current work")) { OverviewRows(d.work, bots, open, dev.botdot.app.data.Overviews.noWork, sites) }
            OverviewSection(tr("Blockers")) { OverviewRows(d.failures(), bots, open, dev.botdot.app.data.Overviews.noBlockers, sites) }
            OverviewSection(tr("Latest replies")) { OverviewRows(d.replies, bots, open, dev.botdot.app.data.Overviews.noReplies, sites) }
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
internal fun OverviewRows(items: List<OverviewEntry>, bots: List<Bot>?, open: (OverviewEntry) -> Unit, empty: String? = null, sites: Boolean = false) {
    val p = LocalPaper.current
    if (items.isEmpty() && empty != null) Text(empty, color = p.muted)
    items.forEach { x -> OverviewRow(x, bots, open, sites) }
}

@Composable
private fun OverviewRow(x: OverviewEntry, bots: List<Bot>?, open: (OverviewEntry) -> Unit, sites: Boolean = false, probe: Boolean = false) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).then(if (probe) Modifier.clearAndSetSemantics {} else Modifier.clickable { open(x) }).padding(vertical = Space.s8), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        // Whose it is (web: head in public/project-overview.js): the bot's head, the Chief's, or the owner's.
        Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
            when (val h = Overviews.head(x, bots)) {
                is Overviews.Head.Of -> BotFigure(h.bot.color, h.bot.state, 28, h.bot.outfit)
                Overviews.Head.Chief -> BotFigure(CHIEF_COLOR, if (x.state == "working") "working" else "idle", 28, FigureDef.CHIEF)
                Overviews.Head.You -> YouHead(28)
                Overviews.Head.Unknown -> Unit
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
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

/**
 * The rows of an overview tile that has the height the owner gave it on the canvas (web: `fit` in
 * public/project-overview.js, ADR 273): the whole rows that fit the room it is given, one at least, then a muted "N more"
 * for the rest ([Overviews.fit]). Taller, it shows more. It does not scroll.
 */
@Composable
private fun OverviewRowsFit(items: List<OverviewEntry>, bots: List<Bot>?, open: (OverviewEntry) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    SubcomposeLayout(modifier.clipToBounds()) { constraints ->
        val width = Constraints(minWidth = constraints.maxWidth, maxWidth = constraints.maxWidth)
        // Every row is measured as a probe, which is no node for a screen reader or a tap; only the rows that fit are composed again as themselves.
        val heights = items.mapIndexed { i, x -> subcompose("probe-$i") { OverviewRow(x, bots, open, probe = true) }.first().measure(width).height }
        val room = if (constraints.hasBoundedHeight) constraints.maxHeight else Int.MAX_VALUE
        val moreOf = { slot: String, k: Int, probe: Boolean -> subcompose(slot) { Text(tr("{n} more", "n" to k), color = p.muted, fontSize = Type.s14, modifier = Modifier.padding(top = Space.s4).then(if (probe) Modifier.clearAndSetSemantics {} else Modifier)) }.first().measure(width) }
        val n = Overviews.fit(heights, if (items.size > 1) moreOf("more-room", items.size - 1, true).height else 0, room)
        val more = if (n < items.size) moreOf("more", items.size - n, false) else null
        val shown = items.take(n).mapIndexed { i, x -> subcompose("row-$i") { OverviewRow(x, bots, open) }.first().measure(width) }
        val height = shown.sumOf { it.height } + (more?.height ?: 0)
        layout(constraints.maxWidth, if (constraints.hasBoundedHeight) constraints.maxHeight else height) {
            var y = 0
            for (r in shown) { r.placeRelative(0, y); y += r.height }
            more?.placeRelative(0, y)
        }
    }
}

/**
 * The overview for its board tiles (overview-board, ADR 245): what botdot recorded, read by the shared [OverviewDesk]
 * every [OverviewDesk.everyMs] while a tile shows, never starting the computer (no files are asked for).
 */
@Composable
internal fun rememberOverviewFeed(ui: CompanyUi, c: Company): OverviewState {
    val api by ui.app.api.collectAsState()
    val life = LocalLifecycleOwner.current
    val desk = remember(c.id, api) { api?.let { OverviewDesk(it, c.id) } }
    val state = desk?.state?.collectAsState()?.value ?: OverviewState()
    LaunchedEffect(desk, life) {
        val d = desk ?: return@LaunchedEffect
        life.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { d.readRecorded(); delay(d.everyMs) }
        }
    }
    return state
}

/** Where a row of the overview opens ([Overviews.open]): its team chat, its bot, a Chief chat, or the Chief. */
internal fun overviewOpener(ui: CompanyUi, c: Company, ways: CompanyWays): (OverviewEntry) -> Unit = { x ->
    when (val to = Overviews.open(x.destination(c, ui.bots.value, ui.app.store.version.value.value?.features))) {
        is Overviews.Open.Team -> ways.onTeam?.invoke(to.groupId) ?: ways.onNeeds()
        is Overviews.Open.Bot -> ways.onBot(to.botId)
        Overviews.Open.ProjectChief -> ways.onChiefChat?.let { ui.openChief(c, it) }
        Overviews.Open.Chief -> ways.onChief()
        is Overviews.Open.ChiefChat -> ways.onChiefChat?.invoke(to.chatId)
        null -> Unit
    }
}

/** Current work, Blockers or Latest replies as a board tile; [fixed] on the canvas, where the tile has the height the owner gave it. */
@Composable
internal fun OverviewTile(key: String, feed: OverviewState, bots: List<Bot>?, open: (OverviewEntry) -> Unit, modifier: Modifier = Modifier, fixed: Boolean = false) {
    val p = LocalPaper.current
    val title = when (key) { "work" -> tr("Current work"); "blockers" -> tr("Blockers"); else -> tr("Latest replies") }
    Column(modifier.fillMaxWidth().cardRing(key).raised(Radius.card).padding(Space.s16).testTag("overview-$key"), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16, modifier = Modifier.weight(1f).semantics { heading() })
            CardPencil(key, title)
        }
        feed.problem?.let { Text(it, color = p.err) }
        val d = feed.snapshot
        when {
            d == null -> Text(feed.status, color = p.muted)
            else -> {
                val (items, none) = when (key) { "work" -> d.work to Overviews.noWork; "blockers" -> d.failures() to Overviews.noBlockers; else -> d.replies to Overviews.noReplies }
                // On the canvas the tile's height is the owner's: whole rows and "N more". In the column every row is shown.
                if (fixed && items.size > 1) OverviewRowsFit(items, bots, open, Modifier.weight(1f)) else OverviewRows(items, bots, open, none)
            }
        }
    }
}
