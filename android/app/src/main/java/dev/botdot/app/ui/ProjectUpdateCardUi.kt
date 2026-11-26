package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.CHIEF_COLOR
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.OverviewEntry
import dev.botdot.app.data.Overviews
import dev.botdot.app.data.ProjectUpdateCard
import dev.botdot.app.data.tr

/**
 * Where a project update's rows open: [open] takes a route of the screens ("bot/<id>", "group/<id>", "chief/<id>",
 * "needs"), [project] a project's id (its Board); [bots] are the heads of its rows. Given once, where the screens are (MainActivity).
 */
class ProjectUpdateWays(val bots: List<Bot>?, val open: (String) -> Unit, val project: (String) -> Unit)

val LocalProjectUpdateWays = compositionLocalOf<ProjectUpdateWays?> { null }

/**
 * A project update as one card of the block kit (web: public/project-update.js; docs/api.md "Consolidated project
 * updates", #1755): the head, the status pills, and, once the owner unfolds it, only the sections that have something and
 * the one faint line for the rest. It starts folded to its head and pills; [key] (the update's delivery key) keeps it
 * unfolded while the owner scrolls. Row texts are Markdown drawn as a reply's preview is, in two lines at most.
 */
@Composable
fun ProjectUpdateCardUi(u: ProjectUpdateCard, key: String) {
    val p = LocalPaper.current
    val ways = LocalProjectUpdateWays.current
    val bots = ways?.bots
    val hasBody = u.needs.isNotEmpty() || u.blockers.isNotEmpty() || u.goals.isNotEmpty() || u.done.isNotEmpty() || u.work.isNotEmpty() || u.decisions.isNotEmpty() || u.replies.isNotEmpty() || u.quiet != null || u.notes.isNotEmpty()
    var open by rememberSaveable(key) { mutableStateOf(false) }
    val unfolded = open && hasBody
    Column(Modifier.fillMaxWidth().raised(Radius.card).testTag("project-update")) {
        Row(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s8, top = Space.s12, bottom = Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(Radius.small)
                    .then(if (hasBody) Modifier.clickable(role = Role.Button) { open = !open }.semantics { stateDescription = if (unfolded) tr("Unfolded") else tr("Folded") } else Modifier),
                horizontalArrangement = Arrangement.spacedBy(Space.s12), verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(Space.s32).clip(Radius.small).background(p.sunk), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.BarChart, contentDescription = null, tint = p.muted, modifier = Modifier.size(16.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(u.projectName, color = p.text, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(if (u.since.isNotBlank()) tr("Update since {when}", "when" to shortTime(u.since)) else tr("Project update"), color = p.muted, fontSize = Type.s12)
                }
                if (hasBody) Icon(Icons.Outlined.ExpandMore, contentDescription = null, tint = p.faint, modifier = Modifier.size(Space.s24).rotate(if (unfolded) 180f else 0f))
            }
            if (u.projectId.isNotBlank() && ways != null) Row(
                Modifier.heightIn(min = 48.dp).clip(Radius.small).clickable(role = Role.Button) { ways.project(u.projectId) }.padding(horizontal = Space.s8),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(tr("Board"), color = p.muted, fontSize = Type.s14)
                Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = p.muted, modifier = Modifier.size(16.dp))
            }
        }
        if (u.pills.isNotEmpty()) FlowRow(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s16, bottom = Space.s16), horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            u.pills.forEach { UpdatePill(it.level, it.text) }
        }
        if (unfolded) {
            if (u.needs.isNotEmpty()) UpdateSection(tr("Needs you")) {
                u.needs.forEach { x -> UpdateCallout("warn", tr("{name} asks", "name" to x.name), x.text, tr("Open card"), primary = true, onClick = { ways?.open(if (x.cardId != null) "needs" else x.destination ?: "needs") }) }
            }
            if (u.blockers.isNotEmpty()) UpdateSection(tr("Blockers")) {
                u.blockers.forEach { x -> UpdateCallout("err", tr("{name} failed", "name" to x.name), x.text, tr("Open chat"), primary = false, onClick = x.destination?.let { d -> { ways?.open(d) } }) }
            }
            if (u.goals.isNotEmpty()) UpdateSection(tr("Goals")) {
                u.goals.forEach { g ->
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                            Text(g.name, color = p.text, modifier = Modifier.weight(1f))
                            Text(g.value, color = p.text, fontWeight = FontWeight.SemiBold)
                            if (g.of.isNotBlank()) Text(g.of, color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(start = Space.s4))
                        }
                        g.ratio?.let { UpdateBar(it, if (g.level == "warn") p.warn else if (g.level == "err") p.err else p.ok) }
                    }
                }
            }
            if (u.done.isNotEmpty()) UpdateSection(tr("Done"), u.done.size) {
                u.done.forEach { t ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s12), verticalAlignment = Alignment.Top) {
                        Box(Modifier.size(Space.s24).clip(CircleShape).background(p.okSoft), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Check, contentDescription = null, tint = p.okText, modifier = Modifier.size(12.dp)) }
                        UpdateText(t, p.text, Modifier.weight(1f))
                    }
                }
            }
            if (u.work.isNotEmpty()) UpdateSection(tr("In progress"), u.work.size) {
                u.work.forEach { x ->
                    UpdateRow(x, bots, ways, trailing = {
                        val (level, label) = when (x.state) { "planned" -> "plan" to tr("To-do"); "asks" -> "warn" to tr("Asks"); else -> "info" to tr("Working") }
                        UpdatePill(level, label)
                    })
                }
            }
            if (u.decisions.isNotEmpty()) UpdateSection(tr("Decisions")) { u.decisions.forEach { UpdateText(it, p.text, Modifier.fillMaxWidth()) } }
            if (u.replies.isNotEmpty()) UpdateSection(tr("Latest replies"), u.replies.size) {
                u.replies.forEach { x -> UpdateRow(x, bots, ways, trailing = { Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = p.faint, modifier = Modifier.size(16.dp)) }, when_ = x.at?.let { shortTime(it) }.orEmpty()) }
            }
            (listOfNotNull(u.quiet) + u.notes).forEach { Text(it, color = p.faint, fontSize = Type.s12, modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s12)) }
        }
    }
}

/** A status pill: its words in the kit's level, with a dot (never colour alone). */
@Composable
private fun UpdatePill(level: String, text: String) {
    val (fg, bg) = levelColors(level)
    Row(Modifier.clip(Radius.pill).background(bg).padding(horizontal = Space.s12, vertical = Space.s4), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(fg))
        Spacer(Modifier.size(Space.s8))
        Text(text, color = fg, fontSize = Type.s12, maxLines = 1)
    }
}

@Composable
private fun UpdateSection(title: String, n: Int? = null, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().drawTopLine(p.line).padding(start = Space.s16, end = Space.s16, top = Space.s12, bottom = Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s8), modifier = Modifier.semantics { heading() }) {
            Text(title, color = p.muted, fontSize = Type.s12, fontWeight = FontWeight.SemiBold)
            if (n != null) Text(n.toString(), color = p.faint, fontSize = Type.s12)
        }
        content()
    }
}

private fun Modifier.drawTopLine(color: androidx.compose.ui.graphics.Color): Modifier = this.then(
    Modifier.drawBehind { drawLine(color, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(size.width, 0f), strokeWidth = 1.dp.toPx()) },
)

/** The kit's callout with its button: Needs you (warn, **Open card**) and Blockers (err, **Open chat**). */
@Composable
private fun UpdateCallout(level: String, title: String, text: String, button: String, primary: Boolean, onClick: (() -> Unit)?) {
    val p = LocalPaper.current
    val (fg, bg) = levelColors(level)
    Row(Modifier.fillMaxWidth().clip(Radius.card).background(bg).padding(horizontal = Space.s16, vertical = Space.s12), horizontalArrangement = Arrangement.spacedBy(Space.s12), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(title, color = fg, fontWeight = FontWeight.SemiBold)
            UpdateText(text, p.text, Modifier.fillMaxWidth(), lines = Int.MAX_VALUE)
        }
        // A button that opens nothing is no button: a row with nowhere to go has none.
        if (onClick != null) Box(
            Modifier.heightIn(min = 48.dp).clip(Radius.pill).background(if (primary) p.ink else p.fill).clickable(role = Role.Button, onClick = onClick).padding(horizontal = Space.s16),
            contentAlignment = Alignment.Center,
        ) { Text(button, color = if (primary) p.inkText else p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s14, maxLines = 1) }
    }
}

/** A goal's bar (the kit's): [ratio] of the width in [color] on the sunk track. */
@Composable
private fun UpdateBar(ratio: Float, color: androidx.compose.ui.graphics.Color) {
    val p = LocalPaper.current
    Box(Modifier.fillMaxWidth().height(6.dp).clip(Radius.pill).background(p.sunk)) {
        Box(Modifier.fillMaxWidth(ratio.coerceIn(0f, 1f)).height(6.dp).clip(Radius.pill).background(color))
    }
}

/** Markdown as a reply's preview is drawn: its lines styled as in a chat, at most [lines] of them; never markup. */
@Composable
private fun UpdateText(text: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier, lines: Int = 2) {
    val p = LocalPaper.current
    val shown = androidx.compose.runtime.remember(text, color, p) { previewText(text, color, p) }
    Text(shown, color = color, maxLines = lines, overflow = TextOverflow.Ellipsis, modifier = modifier)
}

/** A row of In progress or Latest replies: its head, its name (a button to its chat), its words, and [trailing]. */
@Composable
private fun UpdateRow(x: ProjectUpdateCard.Row, bots: List<Bot>?, ways: ProjectUpdateWays?, trailing: @Composable () -> Unit, when_: String = "") {
    val p = LocalPaper.current
    val to = x.destination
    Row(
        Modifier.fillMaxWidth().then(if (to != null && ways != null) Modifier.clip(Radius.small).clickable(role = Role.Button) { ways.open(to) } else Modifier),
        horizontalArrangement = Arrangement.spacedBy(Space.s12), verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(Space.s24), contentAlignment = Alignment.Center) {
            val entry = OverviewEntry(id = x.runId.orEmpty(), botId = x.botId, chatId = x.chatId, groupId = x.groupId, name = x.name, state = x.state)
            if (to == null) Box(Modifier.size(Space.s24).clip(CircleShape).background(p.sunk))
            else when (val h = Overviews.head(entry, bots)) {
                is Overviews.Head.Of -> BotFigure(h.bot.color, h.bot.state, 24, h.bot.outfit)
                Overviews.Head.Chief -> BotFigure(CHIEF_COLOR, "idle", 24, FigureDef.CHIEF)
                Overviews.Head.You -> YouHead(24)
                Overviews.Head.Unknown -> Unit
            }
        }
        Column(Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalAlignment = Alignment.Bottom) {
                Text(x.name, color = p.text, fontWeight = FontWeight.SemiBold)
                if (when_.isNotBlank()) Text(when_, color = p.faint, fontSize = Type.s12)
            }
            if (x.text.isBlank()) Text(when (x.state) { "planned" -> tr("To-do"); "asks" -> tr("Asks"); else -> tr("Working") }, color = p.muted)
            else UpdateText(x.text, p.muted, Modifier.fillMaxWidth())
        }
        trailing()
    }
}
