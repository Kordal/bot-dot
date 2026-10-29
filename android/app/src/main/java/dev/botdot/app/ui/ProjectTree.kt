package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Company
import dev.botdot.app.data.ManyProjects
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/**
 * The project's name over the Projects screen (#703; web: public/company.js pickHTML, the tree): from a botdot with
 * `projects-many` a tap on it opens the tree, project > teams > bots, each project and team folding, with "New
 * project" at its end; the archived projects fold under Archived. A project row shows it, a bot row opens its chat.
 * The gear beside it opens the project's settings (#701), from a botdot with `project-settings`.
 */
@Composable
internal fun ProjectTitle(ui: CompanyUi, c: Company?, ways: CompanyWays, modifier: Modifier = Modifier, after: @Composable () -> Unit = {}) {
    val p = LocalPaper.current
    val server by ui.app.store.version.value.collectAsState()
    val features = server?.features
    val many = ManyProjects.many(features)
    var open by remember { mutableStateOf(false) }
    val name = c?.let(ManyProjects::nameOf) ?: tr("New project")
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f, fill = false)) {
            Row(Modifier.clip(Radius.small).clickable(enabled = many, onClickLabel = tr("Projects")) { open = true }.padding(vertical = Space.s4),
                verticalAlignment = Alignment.CenterVertically) {
                Text(name, color = p.text, fontSize = Type.s24, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (many) Icon(Icons.Outlined.ExpandMore, null, tint = p.muted, modifier = Modifier.padding(start = Space.s4).size(22.dp))
            }
            if (many) DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.background(p.panel).widthIn(min = 260.dp, max = 360.dp)) {
                ProjectTree(ui, c?.id, ways) { open = false }
            }
        }
        if (c != null && features != null && ManyProjects.SETTINGS in features) RoundButton(Icons.Outlined.Settings, tr("Project settings"), Modifier.padding(start = Space.s4)) { ui.settingsOpen = true }
        after()
    }
}

/** The tree itself: [shown] the project on screen; [close] once a row took the owner somewhere. */
@Composable
private fun ProjectTree(ui: CompanyUi, shown: String?, ways: CompanyWays, close: () -> Unit) {
    val p = LocalPaper.current
    val list by ui.app.store.projectList.collectAsState()
    val bots = ui.bots.collectAsState().value.orEmpty()
    val waiting by ui.app.store.waiting.collectAsState(initial = emptyList())
    val asks: (String) -> Int = remember(bots, waiting) {
        val waits = waiting.mapNotNull { it.bot }.groupingBy { it }.eachCount()
        val byId = bots.associateBy { it.id };
        { id -> (waits[id] ?: 0) + if (byId[id]?.let(::question) != null) 1 else 0 }
    }
    var folds by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    LaunchedEffect(Unit) { folds = ui.app.settings.treeNow() }
    fun turn(key: String) { folds = ManyProjects.fold(folds, key, shown); val now = folds; ui.scope.launch { ui.app.settings.setTree(now) } }
    val adding by ui.app.store.addingProject.collectAsState()

    Column(Modifier.padding(vertical = Space.s4)) {
        ManyProjects.open(list).forEach { c -> ProjectBranch(c, here = !adding && c.id == shown, bots, asks, folds, shown, ::turn, onShow = { ui.show(c.id); close() }, onBot = { ways.onBot(it); close() }) }
        val archived = ManyProjects.archived(list)
        if (archived.isNotEmpty()) {
            val open = ManyProjects.isOpen(folds, "archived:", shown)
            TreeRow(level = 0, caret = open, onCaret = { turn("archived:") }, onClick = { turn("archived:") }) {
                Text(tr("Archived"), color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(1f))
                Text(archived.size.toString(), color = p.faint, fontSize = Type.s12)
            }
            if (open) archived.forEach { c -> ProjectBranch(c, here = !adding && c.id == shown, bots, asks, folds, shown, ::turn, onShow = { ui.show(c.id); close() }, onBot = { ways.onBot(it); close() }) }
        }
        Rule()
        TreeRow(level = 0, onClick = { ui.startNew(); close() }) {
            Icon(Icons.Filled.Add, null, tint = if (adding) p.text else p.muted, modifier = Modifier.size(18.dp))
            Text(tr("New project"), color = if (adding) p.text else p.muted, fontSize = Type.s14, modifier = Modifier.padding(start = Space.s12))
        }
    }
}

@Composable
private fun ProjectBranch(c: Company, here: Boolean, bots: List<Bot>, asks: (String) -> Int, folds: Map<String, Boolean>, shown: String?, turn: (String) -> Unit, onShow: () -> Unit, onBot: (String) -> Unit) {
    val p = LocalPaper.current
    val branches = ManyProjects.branches(c, bots)
    val open = branches.isNotEmpty() && ManyProjects.isOpen(folds, c.id, shown)
    val name = ManyProjects.nameOf(c)
    TreeRow(level = 0, caret = if (branches.isEmpty()) null else open, here = here, onCaret = { turn(c.id) }, onClick = onShow) {
        Box(Modifier.size(24.dp).clip(Radius.small).background(parseColor(c.color ?: ManyProjects.DEFAULT_COLOR, p.muted)), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase(), color = inkOn(parseColor(c.color ?: ManyProjects.DEFAULT_COLOR, p.muted)), fontSize = Type.s12, fontWeight = FontWeight.SemiBold)
        }
        Text(name, color = p.text, fontSize = Type.s14, fontWeight = if (here) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(start = Space.s12))
        Count(ManyProjects.waits(c, bots, asks))
    }
    if (open) branches.forEach { b ->
        val key = "${c.id}:${b.team.id}"
        val teamOpen = ManyProjects.isOpen(folds, key, shown)
        TreeRow(level = 1, caret = teamOpen, onCaret = { turn(key) }, onClick = { turn(key) }) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(b.team.color, p.muted)))
            Text(b.team.name, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = Space.s12))
            Text(b.bots.size.toString(), color = p.faint, fontSize = Type.s12)
        }
        if (teamOpen) b.bots.forEach { bot ->
            TreeRow(level = 2, onClick = { onBot(bot.id) }) {
                Box {
                    BotFigure(bot.color, bot.state, 22, bot.outfit)
                    if (bot.id == b.team.lead && b.bots.size > 1) Crown(Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-4).dp))
                }
                Text(bot.name, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = Space.s12))
                val n = asks(bot.id)
                if (n > 0) Count(n) else Box(Modifier.size(6.dp).clip(CircleShape).background(if (bot.running) p.ok else p.line2))
            }
        }
    }
}

/** What waits for the owner, as a small white count. */
@Composable
private fun Count(n: Int) {
    val p = LocalPaper.current
    if (n > 0) Text(n.toString(), color = p.inkText, fontSize = Type.s12, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = Space.s8).clip(Radius.pill).background(p.ink).padding(horizontal = Space.s8))
}

/** A row of the tree at its [level]: a caret that folds it ([caret] null: nothing to fold), then what it shows. */
@Composable
private fun TreeRow(level: Int, caret: Boolean? = null, here: Boolean = false, onCaret: () -> Unit = {}, onClick: () -> Unit, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).background(if (here) p.sunk else androidx.compose.ui.graphics.Color.Transparent).clickable(onClick = onClick)
        .padding(start = Space.s8 + (level * 16).dp, end = Space.s12), verticalAlignment = Alignment.CenterVertically) {
        if (caret != null) {
            val word = if (caret) tr("Close") else tr("Open")
            Box(Modifier.size(28.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = word, onClick = onCaret)
                .semantics { contentDescription = word }, contentAlignment = Alignment.Center) {
                Icon(if (caret) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight, null, tint = p.faint, modifier = Modifier.size(18.dp))
            }
        } else Spacer(Modifier.width(28.dp))
        Spacer(Modifier.width(Space.s4))
        content()
    }
}
