package dev.botdot.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.TrackChanges
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanySetup
import dev.botdot.app.data.ProjectStarter
import dev.botdot.app.data.Proposed
import dev.botdot.app.data.TeamReaches
import dev.botdot.app.data.VaultItem
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * The Team step (#671; web: public/company-team.js): the Chief's proposed bots as cards the owner edits (rename,
 * remove, Routines, Asks first, Connect), "Add existing bot" (Duplicate), "Change the team…" with Undo, the starter
 * board's objectives and cards to untick (#810), and "Create N bots", which goes on to Start.
 */
@Composable
internal fun TeamStep(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val proposed = c.proposed()
    if (proposed == null) {
        LaunchedEffect(c.id, ui.proposeFailed) {
            if (ui.proposing || ui.proposeFailed.isNotEmpty()) return@LaunchedEffect
            ui.proposing = true
            runCatching { ui.api!!.proposeTeam() }.onSuccess(ui::took).onError { ui.proposeFailed = it.message ?: tr("That didn't work") }
            ui.proposing = false
        }
        return StepPage(null) {
            if (ui.proposeFailed.isNotEmpty()) {
                Text(ui.proposeFailed, color = p.muted, fontSize = Type.s16)
                GoButton(tr("Try again")) { ui.proposeFailed = "" }
            } else ChiefAtWork()
        }
    }
    // The apps the account has connected: a bot that needs another shows Connect.
    LaunchedEffect(Unit) {
        if (ui.apps != null) return@LaunchedEffect
        ui.apps = runCatching { ui.api?.connectors()?.connections.orEmpty().filter { it.status == "ACTIVE" }.map { it.toolkit }.toSet() }.getOrDefault(emptySet())
    }
    fun save(next: List<kotlinx.serialization.json.JsonObject>) = ui.save(CompanySetup.patch(next)) { it.copy(proposal = next) }
    val raw = c.proposal.orEmpty()
    val n = proposed.size
    StepPage({
        Foot({ WordsButton(tr("Back")) { ui.step = "about" } }) {
            GoButton(trn(n, "Create {n} bot", "Create {n} bots"), enabled = n > 0, busy = ui.creating) {
                if (ui.creating) return@GoButton
                ui.creating = true
                ui.step = "start"
                ui.call({ it.createTeam() }) { ok -> ui.creating = false; if (!ok) ui.step = "team" }
            }
        }
    }) {
        proposed.forEach { b ->
            BotCard(ui, c, b,
                onRename = { name -> save(CompanySetup.edited(raw, b.key, mapOf("name" to JsonPrimitive(name)))) },
                onRemove = { save(CompanySetup.removed(raw, b.key)) },
                onChange = { change -> save(CompanySetup.edited(raw, b.key, change)) })
        }
        CoChip(tr("Add a bot"), dashed = false, icon = Icons.Filled.Add) { ui.draft = tr("Add a bot that ") }
        CoPanel {
            CoChip(tr("Add existing bot"), on = false, dashed = false, icon = Icons.Filled.Add) { ui.adding = !ui.adding }
            if (ui.adding) Existing(ui, proposed)
            c.teamChat.forEach { m ->
                if (m.who == "you") Text(m.text, color = p.text, fontSize = Type.s14, modifier = Modifier.fillMaxWidth().padding(start = Space.s32).clip(Radius.card).background(p.sunk).padding(Space.s12))
                else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                    BotFigure(CHIEF_COLOR, "idle", 24, dev.botdot.app.data.FigureDef.CHIEF)
                    Text(m.text, color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
                    if (m.undo && c.canUndo) WordsButton(tr("Undo")) { ui.call({ it.undoTeam() }) }
                }
            }
            AskField(ui.draft, { ui.draft = it.take(300) }, label = tr("Change the team…"), placeholder = tr("Change the team…"), button = tr("Send"), busy = ui.sending) {
                val text = ui.draft.trim()
                if (text.isEmpty() || ui.sending) return@AskField
                ui.sending = true
                ui.call({ it.changeTeam(text) }) { ok -> ui.sending = false; if (ok) ui.draft = "" }
            }
        }
        val server by ui.app.store.version.value.collectAsState()
        val starter = c.starter
        if (starter != null && ProjectStarter.FEATURE in server?.features.orEmpty()) CoPanel(tr("Board")) {
            fun tick(key: String, on: Boolean) { val next = ProjectStarter.ticked(starter, key, on); ui.save(ProjectStarter.patch(next)) { it.copy(starter = next) } }
            starter.goals.forEach { g -> StarterRow(Icons.Outlined.TrackChanges, ProjectStarter.label(g), g.on) { tick(g.key, it) } }
            starter.cards.forEach { x -> StarterRow(Icons.Outlined.BarChart, x.ask, x.on) { tick(x.key, it) } }
        }
        if (c.never.isNotEmpty()) CoPanel(tr("Never without asking")) {
            c.never.forEachIndexed { i, t ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Lock, null, tint = p.muted, modifier = Modifier.size(16.dp))
                    Text(t, color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f).padding(horizontal = Space.s12))
                    RoundButton(Icons.Filled.Close, tr("Remove"), size = 36.dp) {
                        val next = c.never.filterIndexed { x, _ -> x != i }
                        ui.save(CompanySetup.patchLines("never", next)) { it.copy(never = next) }
                    }
                }
            }
        }
        CoPanel(tr("Project memory")) { Text(trn(c.facts, "{n} fact", "{n} facts"), color = p.text, fontSize = Type.s14) }
    }
}

/** One objective or card of the starter board, ticked or not. */
@Composable
private fun StarterRow(icon: ImageVector, text: String, on: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalPaper.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = p.muted, modifier = Modifier.size(16.dp))
        Text(text, color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f).padding(horizontal = Space.s12))
        Switch(on, onChange, colors = switchColors())
    }
}

@Composable
private fun CoPanel(title: String? = null, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().clip(Radius.card).background(p.panel).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        if (title != null) Text(title, color = p.muted, fontSize = Type.s12, fontWeight = FontWeight.Medium)
        content()
    }
}

/** The account's bots, each with Duplicate, or Added when its copy is in the team. */
@Composable
private fun Existing(ui: CompanyUi, proposed: List<Proposed>) {
    val p = LocalPaper.current
    val bots by ui.bots.collectAsState()
    CompanySetup.existing(bots.orEmpty(), proposed).forEach { b ->
        val added = CompanySetup.added(proposed, b.id)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
            BotFigure(b.color, "idle", 28, b.outfit)
            Column(Modifier.weight(1f)) {
                Text(b.name, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.Medium)
                if (b.description.isNotEmpty()) Text(b.description, color = p.muted, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (added) Text(tr("Added"), color = p.muted, fontSize = Type.s12)
            else WordsButton(tr("Duplicate")) { ui.call({ it.duplicateIntoTeam(b.id) }) }
        }
    }
}

/** One proposed bot: its name (renamed in place), what it owns, the apps it connects, its routine, when it asks first, and its preview line. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BotCard(ui: CompanyUi, c: Company, b: Proposed, onRename: (String) -> Unit, onRemove: () -> Unit, onChange: (Map<String, JsonElement>) -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    var renaming by remember(b.key) { mutableStateOf(false) }
    var name by remember(b.key, b.name) { mutableStateOf(b.name) }
    val missing = CompanySetup.missing(b, ui.apps)
    val server by ui.app.store.version.value.collectAsState()
    val reaches = TeamReaches.FEATURE in server?.features.orEmpty()
    val gaps = if (reaches) TeamReaches.gaps(b) else emptyList()
    Column(Modifier.fillMaxWidth().clip(Radius.card).border(1.dp, p.line, Radius.card).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BotFigure(b.color, "idle", 40)
            Column(Modifier.weight(1f).padding(horizontal = Space.s12)) {
                if (renaming) AskField(name, { name = it.take(60) }, label = tr("Name"), button = tr("Save"), focus = true) {
                    renaming = false
                    val v = name.trim()
                    if (v.isNotEmpty() && v != b.name) onRename(v)
                } else Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(b.name, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f, fill = false))
                    RoundButton(Icons.Outlined.Edit, tr("Rename"), size = 32.dp) { renaming = true }
                }
                if (b.description.isNotEmpty() && !renaming) Text(b.description, color = p.muted, fontSize = Type.s12)
            }
            RoundButton(Icons.Outlined.Delete, tr("Remove"), size = 36.dp, onClick = onRemove)
        }
        Row2(tr("Owns")) { if (b.owns.isEmpty()) None() else b.owns.forEach { Tag(it) } }
        Row2(tr("Connects")) { if (b.connects.isEmpty()) None() else b.connects.forEach { Tag(CompanySetup.appName(it), off = it in missing, link = true) } }
        Row2(tr("Routines")) {
            if (b.routines.isEmpty()) None()
            else Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(b.routinesOn, { onChange(mapOf("routinesOn" to JsonPrimitive(it))) }, colors = switchColors())
                Text(b.routines, color = p.text, fontSize = Type.s14, modifier = Modifier.padding(start = Space.s8))
            }
        }
        if (reaches && (b.computer || b.logins.isNotEmpty() || b.ssh.isNotEmpty())) Row2(tr("Access")) {
            if (b.computer) Tag(tr("Computer"), icon = Icons.Outlined.DesktopWindows)
            (b.logins + b.ssh).forEach { n -> Tag(n.name ?: n.need, off = n.id == null, icon = Icons.Outlined.Key) }
        }
        if (b.from == null) Choice(tr("Asks first"), b.asksFirst, listOf("rules" to tr("Project rules"), "every" to tr("Every action"), "never" to tr("Never"))) {
            onChange(mapOf("asksFirst" to JsonPrimitive(it)))
        }
        if (b.preview.isNotEmpty() || missing.isNotEmpty() || gaps.isNotEmpty()) Column(Modifier.fillMaxWidth().clip(Radius.card).background(p.sunk).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            Row {
                Text(if (c.site) tr("Yesterday") else tr("Week one"), color = p.muted, fontSize = Type.s12, modifier = Modifier.width(84.dp))
                Text(b.preview.ifEmpty { "—" }, color = p.text, fontSize = Type.s14)
            }
            missing.forEach { app ->
                WordsButton(tr("Connect {app}", "app" to CompanySetup.appName(app))) {
                    ui.scope.launch {
                        runCatching { ui.api!!.connectApp(app) }.onSuccess { link ->
                            if (link.noAuth) ui.apps = ui.apps.orEmpty() + app
                            else link.redirectUrl?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) }
                        }.onError { ui.tell(it.message) }
                    }
                }
            }
            gaps.forEach { (kind, n) -> GapButton(ui, kind, n.need) { id -> onChange(TeamReaches.picked(b, kind, n.need, id)) } }
        }
    }
}

/** A need with no Vault entry (#808): its menu lists the Vault's entries of its kind, and a pick fills it. */
@Composable
private fun GapButton(ui: CompanyUi, kind: String, need: String, onPick: (String) -> Unit) {
    val p = LocalPaper.current
    var vault by remember { mutableStateOf<List<VaultItem>?>(null) }
    var menu by remember { mutableStateOf(false) }
    Box {
        WordsButton(if (kind == TeamReaches.SSH) tr("SSH key for {need}", "need" to need) else tr("Login for {need}", "need" to need)) {
            ui.scope.launch {
                vault = try { ui.api?.vault() } catch (e: Exception) { ui.tell(e.message ?: tr("Can't reach botdot.")); null }
                menu = vault != null
            }
        }
        DropdownMenu(menu, { menu = false }, containerColor = p.panel) {
            TeamReaches.pickable(vault.orEmpty(), kind).forEach { e ->
                DropdownMenuItem(text = { Text(e.name, color = p.text, fontSize = Type.s14) }, onClick = { menu = false; onPick(e.id) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Row2(label: String, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Row(verticalAlignment = Alignment.Top) {
        Text(label, color = p.muted, fontSize = Type.s12, modifier = Modifier.width(84.dp).padding(top = Space.s8))
        FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) { content() }
    }
}

@Composable
private fun None() = Text(tr("None"), color = LocalPaper.current.faint, fontSize = Type.s14, modifier = Modifier.padding(top = Space.s4))

@Composable
private fun Tag(text: String, off: Boolean = false, link: Boolean = false, icon: ImageVector? = if (link) Icons.Outlined.Link else null) {
    val p = LocalPaper.current
    Row(Modifier.clip(Radius.small).background(p.sunk).padding(horizontal = Space.s8, vertical = Space.s4), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) { Icon(icon, null, tint = if (off) p.faint else p.muted, modifier = Modifier.size(13.dp)); Spacer(Modifier.size(4.dp)) }
        Text(text, color = if (off) p.faint else p.text, fontSize = Type.s12)
    }
}
