package dev.botdot.app.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.AboutScreen
import dev.botdot.app.data.Api
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanyHeld
import dev.botdot.app.data.CompanySetup
import dev.botdot.app.data.CompanySource
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.SourceDraft
import dev.botdot.app.data.tr
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** "Bots | Company" (#674): which place the list and the screen beside it show, at the top of the list. */
@Composable
internal fun PlaceSwitch(company: Boolean, modifier: Modifier = Modifier, fill: Boolean = false, onPick: (Boolean) -> Unit) {
    val p = LocalPaper.current
    Row(modifier.clip(RoundedCornerShape(12.dp)).border(1.dp, p.line2, RoundedCornerShape(12.dp)).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        listOf(false to tr("Bots"), true to tr("Company")).forEach { (on, label) ->
            val here = on == company
            Row((if (fill) Modifier.weight(1f) else Modifier).clip(RoundedCornerShape(9.dp)).background(if (here) p.sunk else Color.Transparent).clickable(onClickLabel = label) { if (!here) onPick(on) }
                .padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                if (on) Icon(Icons.Outlined.Business, null, tint = if (here) p.text else p.muted, modifier = Modifier.size(16.dp).padding(end = 0.dp))
                if (on) Spacer(Modifier.size(6.dp))
                Text(label, color = if (here) p.text else p.muted, fontSize = 14.sp)
            }
        }
    }
}

/**
 * What one Company screen keeps beside the company itself: where the setup stands, what it waits for from the Chief,
 * and what was picked or typed and is not saved yet. The company is the Store's, kept up to date by the feed.
 */
internal class CompanyUi(private val app: BotDotApp, val scope: CoroutineScope, private val context: Context) {
    var step by mutableStateOf<String?>(null)
    // The start screen: the sources picked before Go.
    val sources = mutableStateListOf<SourceDraft>()
    var going by mutableStateOf(false)
    // The About step.
    private var forId: String? = null
    var screen by mutableStateOf<AboutScreen?>(null)
    var reading by mutableStateOf(false)
    var readFailed by mutableStateOf(false)
    val asking = mutableStateListOf<String>()
    val tried = mutableSetOf<String>()
    var swotting by mutableStateOf(false)
    var who by mutableStateOf<String?>(null)
    var choosingWho by mutableStateOf(false)
    val ideas = mutableStateMapOf<String, List<String>>()
    var missing by mutableStateOf("")
    val own = mutableStateMapOf<String, List<String>>() // chips the owner wrote, per question
    val picked = mutableStateMapOf<String, List<String>>() // a question's picks before Done
    var editing by mutableStateOf<String?>(null)
    // The Team step.
    var proposing by mutableStateOf(false)
    var proposeFailed by mutableStateOf("")
    var sending by mutableStateOf(false)
    var draft by mutableStateOf("")
    var adding by mutableStateOf(false)
    var creating by mutableStateOf(false)
    var apps by mutableStateOf<Set<String>?>(null)

    val api: Api? get() = app.api.value
    val bots get() = app.store.bots.value

    /** Another company than the screens were drawn for: nothing of the last one's. */
    fun follow(c: Company) {
        if (forId == c.id) return
        forId = c.id
        screen = null; readFailed = false; swotting = false; who = null; choosingWho = false; missing = ""; editing = null
        ideas.clear(); own.clear(); picked.clear(); tried.clear()
        proposeFailed = ""; draft = ""; adding = false
    }

    fun tell(text: String?) = android.widget.Toast.makeText(context, text ?: tr("That didn't work"), android.widget.Toast.LENGTH_LONG).show()
    fun took(c: Company) = app.store.company.set(CompanyHeld(c))
    fun company(): Company? = app.store.company.value.value?.company

    /** Saves [fields] as given, drawn at once as [now] has them; a refused save takes the server's company back. */
    fun save(fields: JsonObject, now: (Company) -> Company) {
        app.store.company.update { h -> CompanyHeld(h.company?.let(now)) }
        scope.launch {
            val a = api ?: return@launch tell(tr("Can't reach botdot."))
            runCatching { a.patchCompany(fields) }.onSuccess(::took).onError { tell(it.message); scope.launch { app.store.company.refresh() } }
        }
    }

    /** One call that answers the company; [done] says whether it went. */
    fun call(block: suspend (Api) -> Company, done: (Boolean) -> Unit = {}) = scope.launch {
        val a = api ?: run { tell(tr("Can't reach botdot.")); done(false); return@launch }
        runCatching { block(a) }.onSuccess { took(it); done(true) }.onError { tell(it.message); done(false) }
    }
}

/**
 * The Company place (#674; web: public/company*.js): "What are you working on?" without a company, then the setup's
 * steps About, Team and Start, each in its own file ([AboutStep], [TeamStep]). On a phone the switch is on top of it,
 * as the list is not beside it.
 */
@Composable
internal fun CompanyScreen(app: BotDotApp, wide: Boolean, onBots: () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ui = remember(app) { CompanyUi(app, scope, context) }
    val held by app.store.company.value.collectAsState()
    val error by app.store.company.error.collectAsState()
    LaunchedEffect(Unit) { app.store.company.refresh() }
    Column(Modifier.fillMaxSize().background(p.bg).imePadding()) {
        if (!wide) Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 16.dp, end = 12.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Logo()
            Spacer(Modifier.weight(1f))
            PlaceSwitch(company = true) { if (!it) onBots() }
        } else Spacer(Modifier.statusBarsPadding())
        val c = held?.company
        when {
            held == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                if (error != null) Text(error!!, color = p.err, modifier = Modifier.padding(20.dp)) else CircularProgressIndicator(color = p.muted, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            }
            c == null -> StartForm(ui)
            else -> {
                ui.follow(c)
                val at = CompanySetup.stepOf(c, ui.step)
                StepBar(at, enabled = !c.running) { ui.step = it }
                Box(Modifier.weight(1f)) {
                    when (at) {
                        "about" -> AboutStep(ui, c)
                        "team" -> TeamStep(ui, c)
                        else -> MadeStep(ui, c)
                    }
                }
            }
        }
    }
}

/** About, Team, Start as a bar of three: what is done, where the setup is; About and Team open their step while setting up. */
@Composable
private fun StepBar(at: String, enabled: Boolean, onStep: (String) -> Unit) {
    val p = LocalPaper.current
    val i = CompanySetup.STEPS.indexOf(at)
    val labels = mapOf("about" to tr("About"), "team" to tr("Team"), "start" to tr("Start"))
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CompanySetup.STEPS.forEachIndexed { n, k ->
            val tappable = enabled && k != "start"
            Column(Modifier.weight(1f).clickable(enabled = tappable, onClickLabel = labels[k]) { onStep(k) }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(if (n <= i) p.text else p.line2))
                Text(labels[k].orEmpty(), color = if (n == i) p.text else p.muted, fontSize = 13.sp)
            }
        }
    }
}

// ---------- the start screen ----------

/** "What are you working on?": one field, two examples, and the sources (files and links). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StartForm(ui: CompanyUi) {
    val p = LocalPaper.current
    val context = LocalContext.current
    var what by rememberSaveable { mutableStateOf("") }
    var linking by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> addFiles(ui, context, uris) }
    fun go() {
        val start = what.trim()
        if (start.isEmpty() || ui.going) return
        if (ui.sources.any { it.uploading }) return ui.tell(tr("Wait for the files to finish uploading."))
        ui.going = true
        ui.call({ it.startCompany(start, ui.sources.toList()) }) { ok -> ui.going = false; if (ok) { ui.sources.clear(); ui.step = "about" } }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        CoTitle(tr("What are you working on?"))
        AskField(what, { what = it.take(500) }, label = tr("What are you working on?"), placeholder = tr("Your site, or your idea in one sentence"), button = tr("Go"), busy = ui.going, onGo = ::go)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CompanySetup.EXAMPLES.forEachIndexed { i, text -> CoChip(text, icon = if (i == 0) Icons.Outlined.Link else Icons.Filled.Add) { what = text } }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CoChip(tr("Add files"), on = false, dashed = false, icon = Icons.AutoMirrored.Outlined.InsertDriveFile) { pick.launch("*/*") }
            CoChip(tr("Add a link"), on = false, dashed = false, icon = Icons.Outlined.Link) { linking = true }
        }
        if (linking) AskField(link, { link = it.take(1000) }, label = tr("Add a link"), placeholder = "https://", button = tr("Add")) {
            CompanySetup.link(newId(), link)?.let { if (ui.sources.size < CompanySetup.MAX_SOURCES) ui.sources.add(it) else ui.tell(tr("Add at most 20 sources.")) }
            link = ""; linking = false
        }
        SourceList(ui.sources.map { CompanySource(it.id, it.kind, it.name, it.url, it.size) }, failed = ui.sources.filter { it.failed }.map { it.id }.toSet(),
            busy = ui.sources.filter { it.uploading }.map { it.id }.toSet()) { id -> ui.sources.removeAll { it.id == id } }
    }
}

private fun newId() = java.util.UUID.randomUUID().toString().take(8)

private fun addFiles(ui: CompanyUi, context: Context, uris: List<Uri>) {
    val a = ui.api ?: return ui.tell(tr("Can't reach botdot."))
    for (uri in uris) {
        if (ui.sources.size >= CompanySetup.MAX_SOURCES) { ui.tell(tr("Add at most 20 sources.")); break }
        val (name, size) = a.describe(context.contentResolver, uri)
        if ((size ?: 0) > CompanySetup.MAX_FILE) { ui.tell(tr("{name} is over 25 MB.", "name" to name)); continue }
        val s = SourceDraft(newId(), "file", name, size = size ?: 0)
        ui.sources.add(s)
        ui.scope.launch {
            val done = runCatching { a.upload(context.contentResolver, uri, "chief") }
            val i = ui.sources.indexOfFirst { it.id == s.id }
            if (i < 0) return@launch
            done.onSuccess { ui.sources[i] = s.copy(upload = it, size = if (it.size > 0) it.size else s.size) }
                .onError { ui.sources[i] = s.copy(failed = true); ui.tell("$name: ${it.message}") }
        }
    }
}

/** The sources: a file's size, a link's "page", a removable one with ×. */
@Composable
internal fun SourceList(list: List<CompanySource>, failed: Set<String> = emptySet(), busy: Set<String> = emptySet(), onRemove: ((String) -> Unit)? = null) {
    val p = LocalPaper.current
    if (list.isEmpty()) return
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, p.line, RoundedCornerShape(12.dp))) {
        list.forEachIndexed { i, s ->
            if (i > 0) Rule()
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (s.kind == "link") Icons.Outlined.Link else Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = if (s.id in failed) p.err else p.muted, modifier = Modifier.size(16.dp))
                Text(s.name, color = if (s.id in failed) p.err else p.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = 10.dp))
                Text(if (s.id in busy) "…" else if (s.kind == "link") tr("page") else if (s.size > 0) fmtSize(s.size) else "", color = p.faint, fontSize = 12.sp)
                if (onRemove != null) RoundButton(Icons.Filled.Close, tr("Remove"), size = 36.dp) { onRemove(s.id) } else Spacer(Modifier.size(8.dp))
            }
        }
    }
}

// ---------- Start: the team being made, then made ----------

/** "Creating your team" while Create makes the bots, then "Team ready" with each team and its bots. */
@Composable
private fun MadeStep(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val bots by ui.bots.collectAsState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CoTitle(if (c.running) tr("Team ready") else tr("Creating your team"))
        if (c.running) c.teams.forEach { t ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(parseColor(t.color, p.muted)))
                Text(t.name, color = p.text, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp))
            }
            t.bots.forEach { id ->
                val b = bots?.firstOrNull { it.id == id }
                val proposed = c.proposed()?.firstOrNull { it.bot == id }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BotFigure(b?.color ?: proposed?.color, "idle", 32, b?.outfit)
                    Text(b?.name ?: proposed?.name.orEmpty(), color = p.text, modifier = Modifier.weight(1f))
                    if (id == t.lead && t.bots.size > 1) Text(tr("Lead"), color = p.muted, fontSize = 12.sp)
                    Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.size(18.dp))
                }
            }
        } else c.proposed().orEmpty().forEach { b ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BotFigure(b.color, "working", 32)
                Text(b.name, color = p.text)
            }
        }
    }
}

// ---------- shared pieces of the steps ----------

@Composable
internal fun CoTitle(text: String) = Text(text, color = LocalPaper.current.text, fontSize = 26.sp, lineHeight = 31.sp, fontWeight = FontWeight.SemiBold)

/** A chip: [on] filled, else dashed (a suggestion) or plain. */
@Composable
internal fun CoChip(text: String, on: Boolean = false, dashed: Boolean = true, icon: ImageVector? = null, onClick: () -> Unit) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(99.dp)
    Row(Modifier.clip(shape).background(if (on) p.ink else Color.Transparent)
        .then(if (on) Modifier else if (dashed) Modifier.dashedBorder(p.line2) else Modifier.border(1.dp, p.line2, shape))
        .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        val shown = if (on) Icons.Filled.Check else icon
        if (shown != null) { Icon(shown, null, tint = if (on) p.inkText else p.muted, modifier = Modifier.size(15.dp)); Spacer(Modifier.size(6.dp)) }
        Text(text, color = if (on) p.inkText else p.text, fontSize = 14.sp)
    }
}

internal fun Modifier.dashedBorder(color: Color): Modifier = drawBehind {
    drawRoundRect(color, cornerRadius = CornerRadius(size.height / 2), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))))
}

/**
 * A chip question: the Chief's chips and the owner's own, picked by a tap; "Write your own" turns into a field where
 * Done adds a chip. [onPick] gets the chips picked after each tap.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ChipQuestion(ui: CompanyUi, id: String, chief: List<String>, picked: List<String>, multi: Boolean = false, plus: Boolean = false, label: (String) -> String = { it }, onPick: (List<String>) -> Unit) {
    var writing by remember(id) { mutableStateOf(false) }
    var typed by remember(id) { mutableStateOf("") }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        CompanySetup.chips(chief, picked, ui.own[id].orEmpty()).forEach { t ->
            CoChip(label(t), on = t in picked, icon = if (plus) Icons.Filled.Add else null) { onPick(CompanySetup.pick(picked, t, multi)) }
        }
        if (!writing) CoChip(tr("Write your own"), icon = Icons.Outlined.Edit) { writing = true }
    }
    if (writing) AskField(typed, { typed = it.take(120) }, label = tr("Write your own"), button = tr("Add"), focus = true) {
        val t = typed.replace(Regex("\\s+"), " ").trim()
        if (t.isNotEmpty()) {
            ui.own[id] = (ui.own[id].orEmpty() + t).distinct()
            onPick(if (multi) (picked + t).distinct() else listOf(t))
        }
        typed = ""; writing = false
    }
}

/** One line to type in with its button beside it: Enter or the button sends. */
@Composable
internal fun AskField(value: String, onValue: (String) -> Unit, label: String, placeholder: String? = null, button: String, busy: Boolean = false, enabled: Boolean = true, focus: Boolean = false, onGo: () -> Unit) {
    val requester = remember { FocusRequester() }
    if (focus) LaunchedEffect(Unit) { runCatching { requester.requestFocus() } }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(value, onValue, singleLine = true, enabled = enabled && !busy, placeholder = placeholder?.let { { Text(it) } },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (value.isNotBlank()) onGo() }),
            modifier = Modifier.weight(1f).focusRequester(requester).semanticsLabel(label))
        GoButton(button, enabled = enabled && value.isNotBlank(), busy = busy, onClick = onGo)
    }
}

private fun Modifier.semanticsLabel(label: String) = semantics { contentDescription = label }

/** The step's main button: white on black. */
@Composable
internal fun GoButton(label: String, enabled: Boolean = true, busy: Boolean = false, arrow: Boolean = false, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.clip(RoundedCornerShape(99.dp)).background(if (enabled) p.ink else p.sunk).clickable(enabled = enabled && !busy, onClick = onClick)
        .heightIn(min = 44.dp).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        if (busy) CircularProgressIndicator(color = p.inkText, strokeWidth = 2.dp, modifier = Modifier.size(16.dp).padding(end = 0.dp))
        else {
            Text(label, color = if (enabled) p.inkText else p.faint, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (arrow) Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = if (enabled) p.inkText else p.faint, modifier = Modifier.padding(start = 6.dp).size(16.dp))
        }
    }
}

/** A quiet button of words. */
@Composable
internal fun WordsButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPaper.current
    Text(label, color = if (enabled) p.muted else p.faint, fontSize = 15.sp,
        modifier = Modifier.clip(RoundedCornerShape(99.dp)).clickable(enabled = enabled, onClick = onClick).heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 12.dp))
}

/** A step's foot: Back (and Skip) left, the step's button right. */
@Composable
internal fun Foot(left: @Composable () -> Unit, right: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            left()
            Spacer(Modifier.weight(1f))
            right()
        }
    }
}

/** A step's page: what scrolls, and its foot under it. */
@Composable
internal fun StepPage(foot: (@Composable () -> Unit)?, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { content() }
        }
        foot?.invoke()
    }
}

/** The Chief, at work for the setup. */
@Composable
internal fun ChiefAtWork() = Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) { BotFigure(CHIEF_COLOR, "working", 56, FigureDef.CHIEF) }
