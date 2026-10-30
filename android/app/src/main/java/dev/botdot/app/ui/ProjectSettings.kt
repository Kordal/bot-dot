package dev.botdot.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanyFloor
import dev.botdot.app.data.CompanySetup
import dev.botdot.app.data.CompanyTeam
import dev.botdot.app.data.Objective
import dev.botdot.app.data.ManyProjects
import dev.botdot.app.data.ProjectBoard
import dev.botdot.app.data.ProjectStandup
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

private val SECTIONS = listOf("general", "goal", "team", "reports", "rules", "archive")
private fun sectionName(k: String) = when (k) {
    "general" -> tr("General"); "goal" -> tr("Goal"); "team" -> tr("Team"); "reports" -> tr("Reports"); "rules" -> tr("Rules"); else -> tr("Archive or delete")
}

/**
 * A project's settings on Android (#703; web: public/company-settings.js, #701): behind the gear beside its name. One
 * page of rows, each saved as it changes: General (name, colour, the site or idea, its sources, its folder: #702),
 * Goal (the goal, the objectives and how each is shown, where a number is read from, the day its 90 days start, the
 * check-ins), Team (each team's name, bots and lead; a new team), Reports (each lead's rhythm, the morning standup),
 * Rules (never without asking, the owner's time) and Archive or delete. The sections are a row of tabs over it. A
 * change from elsewhere shows at once, except in a field that has the focus.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ProjectSettings(ui: CompanyUi, c: Company, wide: Boolean, ways: CompanyWays) {
    val p = LocalPaper.current
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val at = remember { mutableStateMapOf<String, Int>() }
    val server by ui.app.store.version.value.collectAsState()
    val features = server?.features.orEmpty()
    val bots = ui.bots.collectAsState().value.orEmpty()
    fun patch(fields: JsonObject) { ui.call({ it.patchCompany(fields) }) }
    Column(Modifier.fillMaxSize().background(p.bg).statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(start = Space.s4, end = Space.s16, top = Space.s8), verticalAlignment = Alignment.CenterVertically) {
            BackButton { ui.settingsOpen = false }
            Text(ManyProjects.nameOf(c), color = p.text, fontSize = Type.s24, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s8), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            SECTIONS.forEach { k ->
                Text(sectionName(k), color = p.text, fontSize = Type.s14, modifier = Modifier.clip(Radius.pill).border(1.dp, p.line2, Radius.pill)
                    .clickable { at[k]?.let { y -> scope.launch { scroll.animateScrollTo(y) } } }.padding(horizontal = Space.s12, vertical = Space.s8))
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal = Space.s16).navigationBarsPadding()) {
            Column(Modifier.widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                @Composable fun Card(k: String, content: @Composable () -> Unit) = Column(Modifier.onGloballyPositioned { at[k] = it.positionInParent().y.toInt() }) {
                    SettingsGroup { Column(Modifier.padding(vertical = Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
                        Text(sectionName(k), color = if (k == "archive") p.err else p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
                        content()
                    } }
                }
                Card("general") { General(ui, c, ways, ::patch); if (ProjectBoard.FEATURE in features) BoardRow(c, ::patch) }
                Card("goal") { GoalRows(ui, c, features, ::patch) }
                Card("team") { TeamRows(ui, c, bots) }
                Card("reports") { ReportRows(ui, c, features) }
                Card("rules") { RuleRows(c, ::patch) }
                Card("archive") { ArchiveRows(ui, c, ::patch) }
                Spacer(Modifier.size(Space.s24))
            }
        }
    }
}

// ---------- General ----------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun General(ui: CompanyUi, c: Company, ways: CompanyWays, patch: (JsonObject) -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    var linking by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> addSources(ui, context, c, uris, patch) }
    Labeled(tr("Name")) { SaveField(c.name, tr("Name"), 80) { patch(CompanySetup.patchText("name", it)) } }
    Labeled(tr("Color")) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            ManyProjects.COLORS.forEach { col ->
                val on = col.equals(c.color, ignoreCase = true)
                val fill = parseColor(col, p.muted)
                Box(Modifier.size(36.dp).clip(Radius.small).background(fill).then(if (on) Modifier.border(2.dp, p.text, Radius.small) else Modifier)
                    .clickable(onClickLabel = col) { if (!on) patch(buildJsonObject { put("color", col) }) }.semantics { contentDescription = col }, contentAlignment = Alignment.Center) {
                    if (on) Text(ManyProjects.nameOf(c).take(1).uppercase(), color = inkOn(fill), fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
    Labeled(tr("Site or idea")) { SaveField(c.start, tr("Site or idea"), 500, keepEmpty = false) { patch(CompanySetup.patchText("start", it)) } }
    Labeled(tr("Sources")) {
        SourceList(c.sources) { id -> patch(CompanySetup.patchSources(c.sources.filter { it.id != id })) }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            CoChip(tr("Add files"), dashed = false, icon = Icons.Filled.Add) { pick.launch("*/*") }
            CoChip(tr("Add a link"), dashed = false, icon = Icons.Filled.Add) { linking = true }
        }
        if (linking) AddField(tr("Add a link"), "https://", 1000, focus = true) { typed ->
            CompanySetup.linkSource(typed)?.let { patch(CompanySetup.patchSources(c.sources, listOf(it))) }
            linking = false
        }
    }
    val folder = c.folder
    val openFolder = ways.onFolder
    if (folder != null && openFolder != null) Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(tr("Folder"), color = p.muted, fontSize = Type.s14)
            Text(folder.path, color = p.text, fontSize = Type.s14, fontFamily = GeistMono, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        SmallButton(tr("Open")) { openFolder(folder.name) }
    }
}

/** The pieces on its board (#780), each on or off; a project made before has them all on. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BoardRow(c: Company, patch: (JsonObject) -> Unit) {
    val p = LocalPaper.current
    Labeled(tr("Board")) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            ProjectBoard.PIECES.forEach { k ->
                val on = ProjectBoard.shows(c, k)
                Text(ProjectBoard.label(k), color = if (on) p.text else p.muted, fontSize = Type.s14,
                    modifier = Modifier.clip(Radius.pill).background(if (on) p.sunk else androidx.compose.ui.graphics.Color.Transparent).border(1.dp, if (on) p.text else p.line2, Radius.pill)
                        .clickable { patch(buildJsonObject { putJsonArray("board") { ProjectBoard.toggled(c, k).forEach { add(it) } } }) }
                        .semantics { selected = on }.padding(horizontal = Space.s12, vertical = Space.s8))
            }
        }
    }
}

/** Files added as sources: uploaded for the Chief as the start screen does, then saved with the others. */
private fun addSources(ui: CompanyUi, context: android.content.Context, c: Company, uris: List<android.net.Uri>, patch: (JsonObject) -> Unit) {
    val a = ui.api ?: return ui.tell(tr("Can't reach botdot."))
    if (uris.isEmpty()) return
    ui.scope.launch {
        val added = mutableListOf<JsonObject>()
        for (uri in uris.take((CompanySetup.MAX_SOURCES - c.sources.size).coerceAtLeast(0))) {
            val (name, size) = a.describe(context.contentResolver, uri)
            if ((size ?: 0) > CompanySetup.MAX_FILE) { ui.tell(tr("{name} is over 25 MB.", "name" to name)); continue }
            runCatching { a.upload(context.contentResolver, uri, "chief") }.onSuccess { added += CompanySetup.fileSource(name, it) }.onError { ui.tell("$name: ${it.message}") }
        }
        // The sources as they are now: another change may have come while the files went up.
        if (added.isNotEmpty()) patch(CompanySetup.patchSources((ui.company()?.takeIf { it.id == c.id } ?: c).sources, added))
    }
}

// ---------- Goal ----------

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun GoalRows(ui: CompanyUi, c: Company, features: List<String>, patch: (JsonObject) -> Unit) {
    val p = LocalPaper.current
    Labeled(tr("Goal")) { SaveField(c.goal, tr("Goal"), 300) { patch(CompanySetup.patchText("goal", it)) } }
    Labeled(tr("Objectives")) {
        c.objectives.forEach { o ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(o.color, p.muted)))
                SaveField(o.name, tr("Objective"), 80, Modifier.weight(1f)) { patch(CompanySetup.patchObjectives(ManyProjects.objectivesAfter(c.objectives, o.id, name = it))) }
                SaveField(ManyProjects.shownNumber(o.current), tr("Now"), 16, Modifier.width(72.dp), number = true) { t ->
                    ManyProjects.number(t)?.let { patch(CompanySetup.patchObjectives(ManyProjects.objectivesAfter(c.objectives, o.id, current = it))) }
                }
                Text("/", color = p.faint)
                SaveField(ManyProjects.shownNumber(o.target), tr("Target"), 16, Modifier.width(72.dp), number = true) { t ->
                    ManyProjects.number(t)?.let { patch(CompanySetup.patchObjectives(ManyProjects.objectivesAfter(c.objectives, o.id, target = it))) }
                }
                RoundButton(Icons.Filled.Close, tr("Remove"), size = 36.dp) { patch(CompanySetup.patchObjectives(c.objectives.filter { it.id != o.id })) }
            }
        }
        if (c.objectives.size < ManyProjects.MAX_OBJECTIVES) AddField(tr("New objective"), tr("New objective"), 80) { name ->
            patch(CompanySetup.patchObjectives(c.objectives + Objective(name = name)))
        }
    }
    if (c.objectives.isNotEmpty() && CompanyFloor.DISPLAY in features) Labeled(tr("Show as")) {
        c.objectives.forEach { o ->
            Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                if (c.objectives.size > 1) Dotted(o.name, o.color)
                Chips(CompanyFloor.DISPLAYS.map { it to displayName(it) }, CompanyFloor.displayOf(o)) { d -> ui.call({ it.setObjective(o.id, display = d) }) }
            }
        }
    }
    // Where a number comes from (#699): read from a connected app, how often, and Stop updating. One is added from the goal card.
    c.objectives.filter { it.source != null }.takeIf { it.isNotEmpty() }?.let { fed ->
        Labeled(tr("Update from an app")) {
            fed.forEach { o ->
                val s = o.source!!
                Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                    Dotted("${o.name} · ${s.app} · ${s.what}", o.color)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f)) {
                            Chips(listOf("daily" to tr("Daily"), "weekly" to tr("Weekly")), s.every) { every ->
                                ui.call({ it.putObjective(o.id, buildJsonObject { put("source", buildJsonObject { put("app", s.app); put("what", s.what); put("every", every) }) }) })
                            }
                        }
                        SmallButton(tr("Stop updating")) { ui.call({ it.putObjective(o.id, buildJsonObject { put("source", JsonNull) }) }) }
                    }
                }
            }
        }
    }
    if (CompanySetup.DELIVERY in features) Row(verticalAlignment = Alignment.CenterVertically) {
        Text(tr("Delivery"), color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(1f))
        DeliveryChips(c.deliverBy) { v -> patch(buildJsonObject { put("deliverBy", v) }) }
    }
    if (c.running) {
        var picking by remember { mutableStateOf(false) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("Start"), color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(1f))
            SmallButton(ManyProjects.startDay(c).ifEmpty { "—" }) { picking = true }
        }
        if (picking) {
            val day = runCatching { LocalDate.parse(ManyProjects.startDay(c)) }.getOrNull() ?: LocalDate.now()
            val state = rememberDatePickerState(initialSelectedDateMillis = day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
            DatePickerDialog(onDismissRequest = { picking = false },
                confirmButton = { TextButton({ state.selectedDateMillis?.let { ms -> patch(buildJsonObject { put("startDay", Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()) }) }; picking = false }) { Text(tr("Save")) } },
                dismissButton = { TextButton({ picking = false }) { Text(tr("Cancel")) } }) { DatePicker(state) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("Check-ins"), color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                CompanyFloor.DAYS.forEach { d ->
                    val k = c.checkins.firstOrNull { it.day == d }
                    val color = when { k?.decision == "keep" -> p.ok; k?.decision == "stop" -> p.err; k != null -> p.warn; c.checkin?.day == d -> p.warn; else -> p.line2 }
                    Text(tr("Day {n}", "n" to d), color = if (k != null || c.checkin?.day == d) color else p.muted, fontSize = Type.s12, fontFamily = GeistMono,
                        modifier = Modifier.border(1.dp, color, Radius.pill).padding(horizontal = Space.s8, vertical = Space.s4))
                }
            }
        }
    }
}

// ---------- Team ----------

/** A team's editor: its name, which bots are in it (a bot in another team of this project leaves it), its lead. */
private class TeamDraft(val id: String?, name: String, bots: List<String>, lead: String?) {
    var name by mutableStateOf(name)
    var bots by mutableStateOf(bots)
    var lead by mutableStateOf(lead)
}

@Composable
private fun TeamRows(ui: CompanyUi, c: Company, bots: List<Bot>) {
    val p = LocalPaper.current
    var draft by remember(c.id) { mutableStateOf<TeamDraft?>(null) }
    var askDelete by remember { mutableStateOf<CompanyTeam?>(null) }
    if (draft?.id != null && c.teams.none { it.id == draft?.id }) draft = null
    c.teams.forEach { t ->
        if (draft?.id == t.id) TeamEditor(draft!!, bots, onDelete = { askDelete = t }, onCancel = { draft = null }) { body -> draft = null; ui.call({ it.editTeam(t.id, body) }) }
        else Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 44.dp)) {
            Dotted(t.name, t.color, Modifier.weight(1f))
            val members = t.bots.mapNotNull { id -> bots.firstOrNull { it.id == id } }
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
                members.take(6).forEach { b -> Box { BotFigure(b.color, b.state, 24, b.outfit); if (b.id == t.lead && members.size > 1) Crown(Modifier.align(Alignment.TopEnd)) } }
            }
            SmallButton(tr("Edit")) { draft = TeamDraft(t.id, t.name, t.bots, t.lead) }
        }
    }
    val d = draft
    if (d != null && d.id == null) TeamEditor(d, bots, onDelete = null, onCancel = { draft = null }) { body -> draft = null; ui.call({ it.addTeam(body) }) }
    else if (d == null) Row { CoChip(tr("New team"), dashed = false, icon = Icons.Filled.Add) { draft = TeamDraft(null, "", emptyList(), null) } }
    askDelete?.let { t ->
        AlertDialog(onDismissRequest = { askDelete = null }, containerColor = p.panel,
            title = { Text(tr("Delete the team {name}? Its bots stay.", "name" to t.name)) },
            confirmButton = { TextButton({ askDelete = null; draft = null; ui.call({ it.deleteTeam(t.id) }) }) { Text(tr("Delete team"), color = p.err) } },
            dismissButton = { TextButton({ askDelete = null }) { Text(tr("Cancel")) } })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TeamEditor(d: TeamDraft, bots: List<Bot>, onDelete: (() -> Unit)?, onCancel: () -> Unit, onSave: (JsonObject) -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().clip(Radius.card).border(1.dp, p.line2, Radius.card).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Labeled(tr("Name")) { Field(d.name, { d.name = it.take(60) }, singleLine = true, modifier = Modifier.fillMaxWidth().semantics { contentDescription = tr("Name") }) }
        Labeled(tr("Bots")) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                bots.forEach { b ->
                    val on = b.id in d.bots
                    Row(Modifier.clip(Radius.pill).background(if (on) p.sunk else androidx.compose.ui.graphics.Color.Transparent).border(1.dp, if (on) p.text else p.line2, Radius.pill)
                        .clickable { d.bots = ManyProjects.toggle(d.bots, b.id) }.padding(start = Space.s4, end = Space.s12, top = Space.s4, bottom = Space.s4), verticalAlignment = Alignment.CenterVertically) {
                        BotFigure(b.color, b.state, 22, b.outfit)
                        Text(b.name, color = if (on) p.text else p.muted, fontSize = Type.s14, modifier = Modifier.padding(start = Space.s8))
                    }
                }
            }
        }
        val members = d.bots.mapNotNull { id -> bots.firstOrNull { it.id == id } }
        if (members.size > 1) Choice(tr("Lead"), d.lead?.takeIf { it in d.bots } ?: d.bots.first(), members.map { it.id to it.name }) { d.lead = it }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (onDelete != null) TextButton(onDelete) { Text(tr("Delete team"), color = p.err) }
            Spacer(Modifier.weight(1f))
            WordsButton(tr("Cancel"), onClick = onCancel)
            val body = ManyProjects.teamBody(d.name, d.bots, d.lead)
            GoButton(tr("Save"), enabled = body != null) { body?.let(onSave) }
        }
    }
}

// ---------- Reports ----------

@Composable
private fun ReportRows(ui: CompanyUi, c: Company, features: List<String>) {
    val p = LocalPaper.current
    if (CompanyFloor.LEADS in features) c.teams.forEach { t ->
        Labeled(t.name) {
            Chips(ManyProjects.RHYTHMS.map { it to rhythmName(it) }, t.report.orEmpty()) { every -> ui.call({ it.setReportRhythm(t.id, every) }) }
        }
    }
    if (ProjectStandup.FEATURE in features) {
        val s = c.standup ?: dev.botdot.app.data.StandupSetting()
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("Morning standup"), color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
            SaveField(s.time, tr("Standup time"), 5, Modifier.width(88.dp), enabled = s.on) { t ->
                if (Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(t)) ui.call({ it.setStandup(buildJsonObject { put("time", t) }) })
            }
            Spacer(Modifier.width(Space.s12))
            Switch(checked = s.on, onCheckedChange = { on -> ui.call({ it.setStandup(buildJsonObject { put("on", on) }) }) }, colors = switchColors(),
                modifier = Modifier.semantics { contentDescription = tr("Morning standup") })
        }
    }
}

private fun rhythmName(k: String) = when (k) { "daily" -> tr("Daily"); "twice-weekly" -> tr("Twice a week"); "weekly" -> tr("Weekly"); else -> tr("Off") }

// ---------- Rules ----------

@Composable
private fun RuleRows(c: Company, patch: (JsonObject) -> Unit) {
    val p = LocalPaper.current
    Labeled(tr("Never without asking")) {
        c.never.forEachIndexed { i, n ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(n, color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
                RoundButton(Icons.Filled.Close, tr("Remove"), size = 36.dp) { patch(CompanySetup.patchLines("never", c.never.filterIndexed { x, _ -> x != i })) }
            }
        }
        if (c.never.size < ManyProjects.MAX_NEVER) AddField(tr("Never without asking"), tr("Add"), 80) { patch(CompanySetup.patchLines("never", c.never + it)) }
    }
    Labeled(tr("Time")) { SaveField(c.time, tr("Time"), 80) { patch(CompanySetup.patchText("time", it)) } }
}

// ---------- Archive or delete ----------

@Composable
private fun ArchiveRows(ui: CompanyUi, c: Company, patch: (JsonObject) -> Unit) {
    val p = LocalPaper.current
    var asking by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(tr("Archive project"), color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
        SmallButton(if (c.archived) tr("Unarchive") else tr("Archive")) { patch(buildJsonObject { put("archived", !c.archived) }) }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(tr("Delete project"), color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
        SmallButton(tr("Delete"), danger = true) { asking = true }
    }
    fun delete(dropFolder: Boolean) {
        asking = false
        ui.scope.launch {
            val a = ui.api ?: return@launch ui.tell(tr("Can't reach botdot."))
            runCatching { a.deleteCompany(dropFolder) }.onSuccess { ui.settingsOpen = false; ui.app.store.projectGone(c.id) }.onError { ui.tell(it.message) }
        }
    }
    // With a folder (#702) it asks whether the folder goes too.
    if (asking) AlertDialog(onDismissRequest = { asking = false }, containerColor = p.panel,
        title = { Text(tr("Delete the project {name}? Its bots stay.", "name" to ManyProjects.nameOf(c))) },
        confirmButton = {
            if (c.folder != null) TextButton({ delete(true) }) { Text(tr("Delete its folder too"), color = p.err) }
            else TextButton({ delete(false) }) { Text(tr("Delete"), color = p.err) }
        },
        dismissButton = {
            if (c.folder != null) TextButton({ delete(false) }) { Text(tr("Keep its folder")) }
            else TextButton({ asking = false }) { Text(tr("Cancel")) }
        })
}

// ---------- pieces ----------

/** A row's label over what changes it. */
@Composable
private fun Labeled(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Text(label, color = LocalPaper.current.muted, fontSize = Type.s14)
        content()
    }
}

/** A name in the colour of its dot. */
@Composable
private fun Dotted(text: String, color: String?, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(color, p.muted)))
        Text(text, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s8))
    }
}

/** A small outlined button of words. */
@Composable
private fun SmallButton(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val p = LocalPaper.current
    Text(label, color = if (danger) p.err else p.text, fontSize = Type.s14,
        modifier = Modifier.clip(Radius.pill).border(1.dp, if (danger) p.err else p.line2, Radius.pill).clickable(onClick = onClick)
            .heightIn(min = 36.dp).padding(horizontal = Space.s12, vertical = Space.s8))
}

/**
 * A field saved as it loses the focus (or on Done) when it changed. A change from elsewhere shows in it unless it has
 * the focus. [keepEmpty] false: emptied, it takes back what it held.
 */
@Composable
private fun SaveField(value: String, label: String, max: Int, modifier: Modifier = Modifier.fillMaxWidth(), number: Boolean = false, enabled: Boolean = true, keepEmpty: Boolean = true, onSave: (String) -> Unit) {
    val focus = LocalFocusManager.current
    var text by remember { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(value) { if (!focused) text = value }
    Field(text, { text = it.take(max) }, singleLine = true, enabled = enabled,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = if (number) KeyboardType.Decimal else KeyboardType.Text),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        modifier = modifier.semantics { contentDescription = label }.onFocusChanged { f ->
            if (focused && !f.isFocused) {
                val t = text.trim()
                if (t.isEmpty() && !keepEmpty) text = value else if (t != value) onSave(t)
            }
            focused = f.isFocused
        })
}

/** A field that adds what is typed on Done, then empties and keeps the focus for the next one. */
@Composable
private fun AddField(label: String, placeholder: String, max: Int, focus: Boolean = false, onAdd: (String) -> Unit) {
    var typed by remember { mutableStateOf("") }
    val requester = remember { FocusRequester() }
    if (focus) LaunchedEffect(Unit) { runCatching { requester.requestFocus() } }
    Field(typed, { typed = it.take(max) }, singleLine = true, placeholder = { Text(placeholder) },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { val t = typed.replace(Regex("\\s+"), " ").trim(); typed = ""; if (t.isNotEmpty()) onAdd(t) }),
        modifier = Modifier.fillMaxWidth().focusRequester(requester).semantics { contentDescription = label })
}
