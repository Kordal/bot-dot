package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.PageInfo
import dev.botdot.app.data.PageRef
import dev.botdot.app.data.Pages
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/**
 * Every bot's pages in one list (#361; docs/api.md, "Pages"), opened from Settings: the pages kept up to date first,
 * then the others. A tap opens the page in the viewer, where it can be kept up to date. As the web page's Pages view
 * (public/pages.js). Read again when a bot saves a page (the feed's `page`) or the viewer closes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PagesScreen(app: BotDotApp, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val pageSaves by app.store.pageSaves.value.collectAsState()
    var pages by remember { mutableStateOf<List<PageInfo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val server by app.store.version.value.collectAsState()
    val scope = rememberCoroutineScope()
    // A row's switch (#451): the page on the Board or off it, shown at once and put back if the server says no.
    val board: ((PageInfo, Boolean) -> Unit)? = if (Pages.showsBoard(server?.features)) { pg, on ->
        fun set(v: Boolean?) { pages = pages?.map { if (it.botId == pg.botId && it.slug == pg.slug) it.copy(onBoard = v) else it } }
        set(on)
        scope.launch { runCatching { api!!.setPageOnBoard(pg.botId, pg.slug, on) }.onSuccess { set(it?.onBoard ?: on) }.onFailure { set(pg.onBoard); error = it.message } }
    } else null
    LaunchedEffect(api, pageSaves, DocViewer.open == null) {
        val a = api ?: return@LaunchedEffect
        runCatching { a.allPages() }.onSuccess { pages = it; error = null }.onFailure { error = tr("Couldn't load the pages.") }
    }

    Scaffold(
        containerColor = p.bg,
        topBar = { TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
            title = { Column { Text(tr("Pages"), style = MaterialTheme.typography.titleMedium); Text(tr("Made by your bots"), color = p.muted, style = MaterialTheme.typography.bodySmall) } }) },
    ) { pad ->
        val list = pages
        val (kept, other) = Pages.split(list.orEmpty())
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            error?.let { e -> item { Text(e, color = p.err) } }
            if (list != null && list.isEmpty()) item { Hint(tr("No pages yet. Ask a bot for a page, a report or an overview: it shows here, and under the bot's reply.")) }
            if (kept.isNotEmpty()) {
                item { SectionLabel(tr("Kept up to date")) }
                items(kept, key = { "${it.botId}/${it.slug}" }) { PageRow(it, board) }
            }
            if (other.isNotEmpty()) {
                item { SectionLabel(if (kept.isEmpty()) tr("All pages") else tr("Other pages")) }
                items(other, key = { "${it.botId}/${it.slug}" }) { PageRow(it, board) }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text.uppercase(), color = LocalPaper.current.muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = Space.s8, start = Space.s4))
}

@Composable
private fun PageRow(page: PageInfo, board: ((PageInfo, Boolean) -> Unit)?) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().raised(Radius.card)
        .clickable { DocViewer.open = DocViewer.page(page.botId, PageRef(page.slug, page.title), page.bot) }.padding(Space.s12),
        verticalAlignment = Alignment.CenterVertically) {
        Text("📄", style = MaterialTheme.typography.titleMedium)
        Column(Modifier.weight(1f).padding(start = Space.s12)) {
            Text(page.title, color = p.text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(Pages.allLine(page), color = p.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (page.keep != null) Box(Modifier.size(7.dp).background(p.ok, CircleShape))
        if (board != null && page.onBoard != null) {
            Spacer(Modifier.size(10.dp))
            Switch(checked = page.onBoard, onCheckedChange = { board(page, it) }, colors = switchColors(), modifier = Modifier.semantics { contentDescription = tr("On the Board") })
        }
    }
}
