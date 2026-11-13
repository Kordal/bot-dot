package dev.botdot.app.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.AboutScreen
import dev.botdot.app.data.Api
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanyHeld
import dev.botdot.app.data.CompanySetup
import dev.botdot.app.data.CompanySource
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.ManyProjects
import dev.botdot.app.data.SourceDraft
import dev.botdot.app.data.tr
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * What one Company screen keeps beside the company itself: where the setup stands, what it waits for from the Chief,
 * and what was picked or typed and is not saved yet. The company is the Store's, kept up to date by the feed.
 */
internal class CompanyUi(val app: BotDotApp, val scope: CoroutineScope, private val context: Context) {
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
    var saving by mutableIntStateOf(0) // saves on their way: fresh chips are asked for once they land (#787)
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
    // The project's settings (#701, #703) over its screen.
    var projectBotsSaving by mutableStateOf(false)
    var teamFor by mutableStateOf<String?>(null)
    var settingsOpen by mutableStateOf(false)
    // Spaces (#840): what the project's name switches to, and whether the rail beside the screen does that instead.
    var spaces by mutableStateOf<SpaceWays?>(null)
    var railed by mutableStateOf(false)
    var spaceSheet by mutableStateOf(false)

    val api: Api? get() = app.api.value
    val bots get() = app.store.bots.value

    /** Another company than the screens were drawn for: nothing of the last one's. */
    fun follow(c: Company) {
        if (forId == c.id) return
        forId = c.id
        teamFor = null
        screen = null; readFailed = false; swotting = false; who = null; choosingWho = false; missing = ""; editing = null
        ideas.clear(); own.clear(); picked.clear(); tried.clear()
        proposeFailed = ""; draft = ""; adding = false
    }

    /** Show project [id] (#703), remembered on this device. */
    fun show(id: String) {
        teamFor = null
        app.store.showProject(id)
        scope.launch { app.settings.setProject(id) }
        step = null; settingsOpen = false
    }

    /** "New project": the start screen, for another one. */
    fun startNew() {
        teamFor = null
        app.store.newProject()
        sources.clear(); step = null; settingsOpen = false
    }

    fun tell(text: String?) = android.widget.Toast.makeText(context, text ?: tr("That didn't work"), android.widget.Toast.LENGTH_LONG).show()
    fun took(c: Company, made: Boolean = false) = app.store.tookProject(c, made)
    fun company(): Company? = app.store.company.value.value?.company

    /** Saves [fields] as given, drawn at once as [now] has them; a refused save takes the server's company back. */
    fun save(fields: JsonObject, now: (Company) -> Company) {
        app.store.company.update { h -> CompanyHeld(h.company?.let(now)) }
        saving++
        scope.launch {
            val a = api ?: run { saving--; return@launch tell(tr("Can't reach botdot.")) }
            runCatching { a.patchCompany(fields) }.onSuccess(::took).onError { tell(it.message); scope.launch { app.store.company.refresh() } }
            saving--
        }
    }

    /** One call that answers the company; [done] says whether it went. */
    // Goals the owner removed until the server answers: off the board at once, back on a refusal.
    val removingGoals = mutableStateListOf<String>()
    fun removeGoal(id: String) {
        removingGoals += id
        call({ it.removeObjective(id) }) { removingGoals -= id }
    }
    private val openingChief = dev.botdot.app.data.ProjectChats.ChiefRequests()
    fun openChief(c: Company, open: (String) -> Unit) {
        c.chiefChat?.takeIf { !c.conversation || c.creationSent }?.let { open(it); return }
        val a = api ?: run { tell(tr("Can't reach botdot.")); return }
        if (!openingChief.start(c.id, open)) return
        scope.launch {
            try {
                val chat = a.projectChiefChat(c.id)
                if (api === a && app.store.company.value.value?.company?.id == c.id && chat.isNotEmpty()) { app.store.company.refresh(); openingChief.finish(c.id, chat) }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e
            } catch (e: Exception) { tell(e.message ?: tr("Couldn't open the chat"))
            } finally { openingChief.cancel(c.id) }
        }
    }
    /** Addition and removal both replace the entire list: allow only one pending owner write. */
    suspend fun setOwnBots(ids: List<String>) {
        if (projectBotsSaving) return
        val a = api ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))
        projectBotsSaving = true
        try { took(a.setProjectBots(ids)) } finally { projectBotsSaving = false }
    }
    fun call(block: suspend (Api) -> Company, made: Boolean = false, done: (Boolean) -> Unit = {}) = scope.launch {
        val a = api ?: run { tell(tr("Can't reach botdot.")); done(false); return@launch }
        runCatching { block(a) }.onSuccess { took(it, made); done(true) }.onError { tell(it.message); done(false) }
    }
}

/**
 * The Company place (#674; web: public/company*.js): "What are you working on?" without a company, then the setup's
 * steps About, Team and Start, each in its own file ([AboutStep], [TeamStep]), and once the team is made its home,
 * the office floor ([CompanyHome]). A project is a space (#840): its name switches spaces ([spaces]) unless the
 * rail beside it does ([railed]), and without a chat column ([field]) its default chat is a field at the bottom.
 */
@Composable
internal fun CompanyScreen(app: BotDotApp, wide: Boolean, ways: CompanyWays = CompanyWays(), spaces: SpaceWays? = null, railed: Boolean = false, field: Boolean = !railed) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var savedSources by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }
    val ui = remember(app) { CompanyUi(app, scope, context).also { u ->
        if (savedSources.isNotEmpty()) runCatching { dev.botdot.app.data.Api.JSON.decodeFromString(kotlinx.serialization.builtins.ListSerializer(SourceDraft.serializer()), savedSources) }.getOrNull()?.let { list -> u.sources.addAll(list.map { if (it.uploading) it.copy(failed = true) else it }) }
    } }
    LaunchedEffect(ui.sources.toList()) { savedSources = dev.botdot.app.data.Api.JSON.encodeToString(kotlinx.serialization.builtins.ListSerializer(SourceDraft.serializer()), ui.sources.toList()) }
    ui.spaces = spaces
    ui.railed = railed
    if (ui.spaceSheet && spaces?.shown == true) SpaceSheet(spaces) { ui.spaceSheet = false }
    val held by app.store.company.value.collectAsState()
    val error by app.store.company.error.collectAsState()
    LaunchedEffect(Unit) {
        // The project this device showed last (#703); with spaces the space picked it already, or "New project" is on.
        if (spaces == null) app.settings.projectNow()?.let { app.store.showProject(it) }
        app.store.company.refresh()
    }
    val server by app.store.version.value.collectAsState()
    val many = ManyProjects.many(server?.features)
    val list by app.store.projectList.collectAsState()
    val shownId = held?.company?.id
    LaunchedEffect(shownId) { if (many && shownId != null) app.settings.setProject(shownId) }
    val settingsOf = held?.company?.takeIf { ui.settingsOpen }
    if (settingsOf != null) {
        BackHandler { ui.settingsOpen = false }
        ui.follow(settingsOf)
        return ProjectSettings(ui, settingsOf, wide, ways)
    }
    Column(Modifier.fillMaxSize().background(p.bg).imePadding()) {
        Spacer(Modifier.statusBarsPadding())
        val c = held?.company
        when {
            held == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                if (error != null) Text(error!!, color = p.err, modifier = Modifier.padding(Space.s16)) else CircularProgressIndicator(color = p.muted, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            }
            c == null -> {
                // A new project beside others (#703): their names over the start screen, to go back to one.
                if (many && list.isNotEmpty()) ProjectTitle(ui, null, ways, Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s12, top = Space.s8))
                StartForm(ui, conversation = "project-conversation" in server?.features.orEmpty(), empty = CompanySetup.EMPTY in server?.features.orEmpty(), titled = !(many && list.isNotEmpty()))
            }
            c.conversation && "project-conversation" in server?.features.orEmpty() && !c.running && ui.step !in listOf("team", "start") -> {
                ui.follow(c)
                LaunchedEffect(c.id) { ui.openChief(c) { ways.onChiefChat?.invoke(it) ?: ways.onChief() } }
                Column(Modifier.fillMaxSize().padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
                    ProjectTitle(ui, c, ways, boardTools = false)
                    Text(c.start, color = p.text)
                    Text(tr("Discuss the first step with the Chief. Review the proposal before anything starts."), color = p.muted)
                    if (c.firstStep.isNotBlank()) { Text(tr("First step"), fontSize = Type.s20, fontWeight = FontWeight.SemiBold); Text(c.firstStep, color = p.text) }
                    SmallButton(LocalChiefName.current) { ui.openChief(c) { ways.onChiefChat?.invoke(it) ?: ways.onChief() } }
                    if (!c.proposal.isNullOrEmpty()) SmallButton(tr("Review first step")) { ui.step = "team" }
                }
            }
            // A running company: its home, the office floor (#675).
            c.running -> {
                ui.follow(c)
                val fixed = dev.botdot.app.data.ProjectOverview.FEATURE in server?.features.orEmpty()
                var board by androidx.compose.runtime.saveable.rememberSaveable(c.id) { mutableStateOf(false) }
                val teamView = fixed && ui.teamFor == c.id
                BackHandler(fixed && (board || teamView)) { board = false; ui.teamFor = null }
                Box(Modifier.weight(1f)) { CompanyHome(ui, c, ways, overview = fixed && !board && !teamView, teamView = teamView, onTeamView = { ui.teamFor = c.id; board = false }, onBoard = { board = true }, onOverview = { board = false; ui.teamFor = null }) }
                if (field) DefaultChatField(ui, c, ways)
            }
            else -> {
                ui.follow(c)
                val at = CompanySetup.stepOf(c, ui.step)
                // The setup's header (#800): Back to the question before, the project's name, and ⋯ with Delete.
                val delivery = CompanySetup.DELIVERY in server?.features.orEmpty()
                val back = ui.screen?.takeIf { at == "about" && !c.site && c.about.isNotEmpty() }?.let { CompanySetup.before(c, it, delivery) }
                if (back != null) BackHandler { ui.screen = back }
                Row(Modifier.fillMaxWidth().padding(start = if (back != null) Space.s4 else Space.s16, end = Space.s4, top = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                    if (back != null) IconButton({ ui.screen = back }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("Back"), tint = p.muted) }
                    ProjectTitle(ui, c, ways, Modifier.weight(1f))
                    SetupMenu(ui, c)
                }
                if (!c.conversation) StepBar(at, enabled = !c.running) { ui.step = it }
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
    Row(Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s8), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        CompanySetup.STEPS.forEachIndexed { n, k ->
            val tappable = enabled && k != "start"
            Column(Modifier.weight(1f).clickable(enabled = tappable, onClickLabel = labels[k]) { onStep(k) }, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(if (n <= i) p.text else p.line2))
                Text(labels[k].orEmpty(), color = if (n == i) p.text else p.muted, fontSize = Type.s12)
            }
        }
    }
}

// ---------- the start screen ----------

/**
 * The start screen (#800, #856, #925): "What shall we take on?" over one field for the site or the idea, a clip inside it that adds files
 * and links, shown as chips under it, and Start from scratch (#788) right under them (#849). [titled] false: the
 * project names over it stand in its place. Start from scratch asks the project's name first (#857), so its
 * folder is made from that name; Back returns to the field with what was typed there.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StartForm(ui: CompanyUi, empty: Boolean, conversation: Boolean = false, titled: Boolean = true) {
    val p = LocalPaper.current
    val context = LocalContext.current
    var what by rememberSaveable { mutableStateOf("") }
    var creationKey by rememberSaveable { mutableStateOf(java.util.UUID.randomUUID().toString()) }
    var creationBasis by rememberSaveable { mutableStateOf("") }
    var attaching by remember { mutableStateOf(false) }
    var linking by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    var naming by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    BackHandler(enabled = naming) { naming = false }
    fun scratch() {
        val n = name.trim()
        if (n.isEmpty() || ui.going) return
        if (ui.sources.any { it.uploading }) return ui.tell(tr("Wait for the files to finish uploading."))
        ui.going = true
        ui.call({ it.startEmptyProject(n, ui.sources.toList()) }, made = true) { ok -> ui.going = false; if (ok) { naming = false; name = ""; ui.sources.clear() }; ui.step = null }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> addFiles(ui, context, uris) }
    fun go() {
        val start = what.trim()
        if (start.isEmpty() || ui.going) return
        if (ui.sources.any { it.uploading }) return ui.tell(tr("Wait for the files to finish uploading."))
        if (conversation && ui.sources.any { it.failed }) return ui.tell(tr("Remove failed files or add them again."))
        val basis = CompanySetup.startBody(start, ui.sources.toList()).toString()
        if (basis != creationBasis) { creationBasis = basis; creationKey = java.util.UUID.randomUUID().toString() }
        ui.going = true
        ui.call({ it.startCompany(start, ui.sources.toList(), creationKey.takeIf { conversation }) }, made = true) { ok -> ui.going = false; if (ok) { ui.sources.clear(); ui.step = if (conversation) null else "about"; creationKey = java.util.UUID.randomUUID().toString() } }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = Space.s16, vertical = Space.s16)) {
        Spacer(Modifier.weight(1f))
        Column(Modifier.widthIn(max = Space.answer), verticalArrangement = Arrangement.spacedBy(Space.s24)) {
            if (titled && naming) Text(tr("New project"), color = p.text, fontSize = Type.s32, lineHeight = Type.line40, fontWeight = FontWeight.SemiBold)
            else if (titled) Text(tr("What shall we take on?"), color = p.text, fontSize = Type.s32, lineHeight = Type.line40, fontWeight = FontWeight.SemiBold, style = TextStyle(lineBreak = LineBreak.Heading))
            if (naming) {
                val requester = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { requester.requestFocus() } }
                Field(name, { name = it.take(80) }, singleLine = true, enabled = !ui.going, shape = Radius.pill,
                    placeholder = { Text(tr("Project name"), color = p.faint) },
                    trailingIcon = {
                        if (ui.going) CircularProgressIndicator(color = p.muted, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        else IconButton(::scratch, enabled = name.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.ArrowForward, tr("Go"), tint = if (name.isNotBlank()) p.text else p.faint) }
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { scratch() }),
                    modifier = Modifier.fillMaxWidth().focusRequester(requester).semanticsLabel(tr("Project name")))
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { WordsButton(tr("Back"), enabled = !ui.going) { naming = false } }
            } else {
                Field(what, { what = it.take(500); creationKey = java.util.UUID.randomUUID().toString() }, singleLine = true, enabled = !ui.going, shape = Radius.pill,
                    placeholder = { Text(tr("Goal, matter or site"), color = p.faint) },
                    leadingIcon = {
                        Box {
                            IconButton({ attaching = true }) { Icon(Icons.Outlined.AttachFile, tr("Attach"), tint = p.muted) }
                            DropdownMenu(expanded = attaching, onDismissRequest = { attaching = false }, modifier = Modifier.background(p.raise2)) {
                                DropdownMenuItem(text = { Text(tr("Add files")) }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null) }, onClick = { attaching = false; pick.launch("*/*") })
                                DropdownMenuItem(text = { Text(tr("Add a link")) }, leadingIcon = { Icon(Icons.Outlined.Link, null) }, onClick = { attaching = false; linking = true })
                            }
                        }
                    },
                    trailingIcon = {
                        if (ui.going) CircularProgressIndicator(color = p.muted, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        else IconButton(::go, enabled = what.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.ArrowForward, tr("Go"), tint = if (what.isNotBlank()) p.text else p.faint) }
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { go() }),
                    modifier = Modifier.fillMaxWidth().semanticsLabel(tr("Goal, matter or site")))
                if (linking) AskField(link, { link = it.take(1000) }, label = tr("Add a link"), placeholder = "https://", button = tr("Add"), focus = true) {
                    CompanySetup.link(newId(), link)?.let { if (ui.sources.size < CompanySetup.MAX_SOURCES) ui.sources.add(it) else ui.tell(tr("Add at most 20 sources.")) }
                    link = ""; linking = false
                }
                if (ui.sources.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                    ui.sources.forEach { s -> SourceChip(s) { ui.sources.removeAll { it.id == s.id } } }
                }
                if (empty && !conversation) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    WordsButton(tr("Start from scratch"), enabled = !ui.going) { naming = true }
                }
            }
        }
        Spacer(Modifier.weight(1.4f))
    }
}

/** A source added on the start screen, as a chip: its kind's icon and its name, × removes it; red when its upload failed. */
@Composable
private fun SourceChip(s: SourceDraft, onRemove: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.raised(Radius.pill).padding(start = Space.s12), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (s.kind == "link") Icons.Outlined.Link else Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = if (s.failed) p.err else p.muted, modifier = Modifier.size(16.dp))
        Text(if (s.uploading) s.name + " …" else s.name, color = if (s.failed) p.err else p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 220.dp).padding(start = Space.s8))
        IconButton(onRemove, Modifier.size(36.dp)) { Icon(Icons.Filled.Close, tr("Remove"), tint = p.muted, modifier = Modifier.size(16.dp)) }
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
    Column(Modifier.fillMaxWidth().raised(Radius.card)) {
        list.forEachIndexed { i, s ->
            if (i > 0) Rule()
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(start = Space.s12, end = Space.s4), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (s.kind == "link") Icons.Outlined.Link else Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = if (s.id in failed) p.err else p.muted, modifier = Modifier.size(16.dp))
                Text(s.name, color = if (s.id in failed) p.err else p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = Space.s12))
                Text(if (s.id in busy) "…" else if (s.kind == "link") tr("page") else if (s.size > 0) fmtSize(s.size) else "", color = p.faint, fontSize = Type.s12)
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
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s24), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        CoTitle(if (c.running) tr("Team ready") else tr("Creating your team"))
        if (c.running) c.teams.forEach { t ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = Space.s8)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(parseColor(t.color, p.muted)))
                Text(t.name, color = p.text, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = Space.s8))
            }
            t.bots.forEach { id ->
                val b = bots?.firstOrNull { it.id == id }
                val proposed = c.proposed()?.firstOrNull { it.bot == id }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                    BotFigure(b?.color ?: proposed?.color, "idle", 32, b?.outfit)
                    Text(b?.name ?: proposed?.name.orEmpty(), color = p.text, modifier = Modifier.weight(1f))
                    if (id == t.lead && t.bots.size > 1) Text(tr("Lead"), color = p.muted, fontSize = Type.s12)
                    Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.size(18.dp))
                }
            }
        } else c.proposed().orEmpty().forEach { b ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                BotFigure(b.color, "working", 32)
                Text(b.name, color = p.text)
            }
        }
    }
}

// ---------- shared pieces of the steps ----------

@Composable
internal fun CoTitle(text: String) = Text(text, color = LocalPaper.current.text, fontSize = Type.s24, lineHeight = Type.line32, fontWeight = FontWeight.SemiBold)

/** A chip: [on] filled, else dashed (a suggestion) or plain. */
@Composable
internal fun CoChip(text: String, on: Boolean = false, dashed: Boolean = true, icon: ImageVector? = null, onClick: () -> Unit) {
    val p = LocalPaper.current
    val shape = Radius.pill
    Row(Modifier.clip(shape).background(if (on) p.ink else if (dashed) Color.Transparent else p.fill)
        .then(if (!on && dashed) Modifier.dashedBorder(p.line2) else Modifier)
        .clickable(onClick = onClick).padding(horizontal = Space.s12, vertical = Space.s8), verticalAlignment = Alignment.CenterVertically) {
        val shown = if (on) Icons.Filled.Check else icon
        if (shown != null) { Icon(shown, null, tint = if (on) p.inkText else p.muted, modifier = Modifier.size(15.dp)); Spacer(Modifier.size(6.dp)) }
        Text(text, color = if (on) p.inkText else p.text, fontSize = Type.s14)
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
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
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
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        Field(value, onValue, singleLine = true, enabled = enabled && !busy, placeholder = placeholder?.let { { Text(it) } },
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
    Row(Modifier.clip(Radius.pill).background(if (enabled) p.ink else p.sunk).clickable(enabled = enabled && !busy, onClick = onClick)
        .heightIn(min = 44.dp).padding(horizontal = Space.s16), verticalAlignment = Alignment.CenterVertically) {
        if (busy) CircularProgressIndicator(color = p.inkText, strokeWidth = 2.dp, modifier = Modifier.size(16.dp).padding(end = 0.dp))
        else {
            Text(label, color = if (enabled) p.inkText else p.faint, fontSize = Type.s16, fontWeight = FontWeight.Normal)
            if (arrow) Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = if (enabled) p.inkText else p.faint, modifier = Modifier.padding(start = Space.s8).size(16.dp))
        }
    }
}

/** A quiet button of words. */
@Composable
internal fun WordsButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPaper.current
    Text(label, color = if (enabled) p.muted else p.faint, fontSize = Type.s16,
        modifier = Modifier.clip(Radius.pill).clickable(enabled = enabled, onClick = onClick).heightIn(min = 44.dp).padding(horizontal = Space.s12, vertical = Space.s12))
}

/** A step's foot: Back (and Skip) left, the step's button right. */
@Composable
internal fun Foot(left: @Composable () -> Unit, right: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.s12, vertical = Space.s8), verticalAlignment = Alignment.CenterVertically) {
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
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
            Column(Modifier.widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(Space.s16)) { content() }
        }
        foot?.invoke()
    }
}

/** The Chief, at work for the setup. */
@Composable
internal fun ChiefAtWork(line: String? = null) = Column(Modifier.fillMaxWidth().padding(vertical = Space.s24), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s16)) {
    BotFigure(CHIEF_COLOR, "working", if (line == null) 56 else 96, FigureDef.CHIEF)
    if (line != null) Text(line, color = LocalPaper.current.text, fontSize = Type.s16, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
}

/** The same primary contact as the wide project conversation (ADR 235). */
@Composable
private fun DefaultChatField(ui: CompanyUi, c: Company, ways: CompanyWays) {
    val app = ui.app
    val bots by app.store.bots.value.collectAsState()
    val chief by app.store.chief.value.collectAsState()
    val needs by app.store.needs.value.collectAsState()
    val server by app.store.version.value.collectAsState()
    val route = dev.botdot.app.data.Spaces.defaultChat(c, bots, server?.features) ?: return
    val manager = route.takeIf { it.startsWith("bot/") }?.removePrefix("bot/")?.let { id -> bots.orEmpty().firstOrNull { it.id == id } }
    if (manager != null) {
        SpaceChatField(manager.name, manager.unread, manager.color, onClick = { ways.onBot(manager.id) }) { BotFigure(manager.color ?: CHIEF_COLOR, manager.state, 28, manager.outfit) }
    } else {
        val name = LocalChiefName.current
        val id = c.chiefChat
        val waiting = if (route == dev.botdot.app.data.Spaces.CHIEF) chief?.unread ?: 0
            else if (id == null) 0 else (chief?.chats?.firstOrNull { it.id == id }?.unread ?: 0) + needs?.asks.orEmpty().count { it.chatId == id }
        val open = {
            if (route == dev.botdot.app.data.Spaces.CHIEF || ways.onChiefChat == null) ways.onChief()
            else ui.openChief(c, ways.onChiefChat)
        }
        SpaceChatField(name, waiting, CHIEF_COLOR, onClick = open) { BotFigure(CHIEF_COLOR, if (chief?.busy == true) "working" else "idle", 28, FigureDef.CHIEF) }
    }
}
