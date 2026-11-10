package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.BoardCanvas
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Groups
import dev.botdot.app.data.CheckinDue
import dev.botdot.app.data.Company
import dev.botdot.app.data.GoalAsk
import dev.botdot.app.data.CompanyFloor
import dev.botdot.app.data.CompanyTeam
import dev.botdot.app.data.Objective
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Suggested
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.launch

/** Where the Company's home leads: a bot's chat, the Chief's, Needs you, and a new Chief or bot chat with words started. */
internal class CompanyWays(
    val onBot: (String) -> Unit = {},
    val onChief: () -> Unit = {},
    val onNeeds: () -> Unit = {},
    val onChiefSay: (String) -> Unit = {},
    /** A bot's chat with words started in its box (a standup's Reply). */
    val onBotSay: (bot: String, words: String) -> Unit = { bot, _ -> onBot(bot) },
    /** A team's chat, from its name (#697, #705): the id of its group; null where the botdot has no team chats. */
    val onTeam: ((String) -> Unit)? = null,
    /** A project's folder in Files, alone (#702, #703): its name. */
    val onFolder: ((String) -> Unit)? = null,
    /** A folder of a project's folder in Files (the board's Files tile): the project's folder's name, the path in it. */
    val onFolderAt: ((name: String, path: String) -> Unit)? = null,
    /** A Chief chat a goal's "Change" started (#820): its id; null where the botdot can't. */
    val onGoalChat: ((String) -> Unit)? = null,
)

private val GOLD = Color(0xFFE8B44A)

/**
 * A project's page on Android (#675, #841; web: public/company-home.js), the same order as Home's: the header (its
 * name, "Day N of 90"), the project's own Needs you, its board (the days 30, 60 and 90, the check-in that waits, the
 * objectives as the owner picked under "Show as" ([Goals], #690), the cards, the bot the Chief suggests, New team,
 * the Calendar tile, the To-do panel ([TodoPanel])), then one row of keys per team ([TeamKeys]). The team's name
 * opens its chat, held it opens the team as a sheet, with Make lead; a key opens its bot's chat. The Chief has no
 * key here: it is Home's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CompanyHome(ui: CompanyUi, c: Company, ways: CompanyWays) {
    val p = LocalPaper.current
    val bots = ui.bots.collectAsState().value.orEmpty()
    val waiting by ui.app.store.waiting.collectAsState(initial = emptyList())
    val lines by ui.app.store.lines.lines.collectAsState()
    val server by ui.app.store.version.value.collectAsState()
    val features = server?.features.orEmpty()
    val info = remember(bots, waiting) {
        val waits = waiting.mapNotNull { it.bot }.groupingBy { it }.eachCount()
        val byId = bots.associateBy { it.id }
        CompanyFloor.Info(
            asks = { id -> (waits[id] ?: 0) + if (byId[id]?.let(::question) != null) 1 else 0 },
            working = { id -> byId[id]?.running == true },
        )
    }
    // Each team's chat (#697): its name opens it, on a botdot that has them.
    val groups by ui.app.store.groups.value.collectAsState()
    val teamChat: (String) -> (() -> Unit)? = { id ->
        ways.onTeam?.takeIf { Groups.TEAM_CHATS in features }?.let { open -> Groups.teamChat(groups.orEmpty(), id)?.let { g -> { open(g.id) } } }
    }
    fun lineOf(b: Bot): String = question(b) ?: if (b.running) OpeningLine.status(lines["bot:${b.id}"], working = true) else b.description
    var teamOpen by rememberSaveable { mutableStateOf<String?>(null) }
    // "+" at the end of a team's row: the team it adds to, while its picker is open.
    var adding by rememberSaveable { mutableStateOf<String?>(null) }
    fun offered(t: CompanyTeam): List<Bot> = CompanyFloor.addable(c, t, bots).map { (b, other) -> if (other != null) b.copy(description = tr("In {team}", "team" to other)) else b }
    // The pieces the owner put on the board (#780); a project made before has them all.
    fun on(k: String) = dev.botdot.app.data.ProjectBoard.shows(c, k)
    // The Files tile (project-files): a running project's folder, on a botdot that has it, when the app can open Files.
    val filesAt = ways.onFolderAt.takeIf { dev.botdot.app.data.ProjectFiles.FEATURE in features && on(dev.botdot.app.data.ProjectFiles.PIECE) && c.phase == "running" && c.folder != null }
    val canvas = BoardCanvas.FEATURE in features
    val saved = remember(c.layout) { BoardCanvas.of(c.layout) }
    // A long press on the flow puts the tiles on the canvas (#821): from then on a long press and a drag moves one.
    var started by rememberSaveable(c.id) { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s12).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        // Its name picks another project and its gear opens its settings (#703).
        ProjectTitle(ui, c, ways) {
            c.day?.takeIf { on("days") }?.let { Text(tr("Day {n} of 90", "n" to it), color = p.muted, fontSize = Type.s12, fontFamily = GeistMono,
                modifier = Modifier.padding(start = Space.s12).clip(Radius.pill).background(p.fill).padding(horizontal = Space.s12, vertical = Space.s4)) }
        }
        // What waits in this project only (#841): its team bots' asks, answered here as on Home.
        val here = remember(c, waiting, groups, bots) { dev.botdot.app.data.Spaces.needsIn(c, waiting, groups.orEmpty()).let { dev.botdot.app.data.Spaces.underLeads(c, it, bots) }.sortedBy { if (it.act != null) 0 else 1 } } // what stops its bots' work first: a missing app
        if (here.isNotEmpty()) NeedsRows(here, onReview = ways.onNeeds, onChat = { w -> if (w.group != null) ways.onTeam?.invoke(w.group) ?: ways.onNeeds() else w.bot?.let(ways.onBot) ?: ways.onNeeds() }, onAnswer = { id, yes ->
            ui.scope.launch {
                runCatching { (ui.api ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))).answerAsk(id, yes) }.onFailure { ui.tell(it.message ?: tr("Couldn't answer")) }
                ui.app.store.needs.refresh()
            }
        })
        // The owner's arrangement (#784): every tile where it was put, on a canvas scaled to the screen.
        if (canvas && (saved != null || started)) {
            val cards = rememberCards(ui, c)
            val tiles = buildList {
                if (on("days")) c.day?.let { day -> add(Tile("days") { m, _ -> Column(m, verticalArrangement = Arrangement.spacedBy(Space.s12)) { DaysLine(c, day); c.checkin?.let { CheckinCard(ui, it, ways, c.name.ifBlank { c.start }) } } }) }
                // An ongoing project's monthly review (#925) stands where the 90-day line would.
                else if (c.ongoing) c.checkin?.let { k -> add(Tile("days") { m, _ -> Box(m) { CheckinCard(ui, k, ways, c.name.ifBlank { c.start }, ongoing = true) } }) }
                if (CompanyFloor.DISPLAY in features && on("goals")) c.objectives.filter { it.id !in ui.removingGoals }.forEach { o -> add(Tile("goal:${o.id}") { m, _ -> Box(m) { GoalCard(ui, c, o, ways.onGoalChat.takeIf { GoalAsk.shows(features) }, GoalAsk.removes(features)) } }) }
                if (dev.botdot.app.data.ProjectCards.shows(features, c)) cards.slots().forEach { s ->
                    // New card opened: its ask and the picks under it get a card's height, not the button's.
                    val asks = s is dev.botdot.app.data.ProjectCards.Slot.Ask && s.card == null
                    add(Tile(cards.tileOf(s), open = if (asks) BoardCanvas.KINDS.getValue("card").h else 0) { m, fixed -> Column(m, verticalArrangement = Arrangement.spacedBy(Space.s12)) {
                        // On the canvas a card fills its tile, its list as many lines as it holds; in the phone's column
                        // it takes its own height, as in the flow. The ask keeps its picks under it.
                        CardSlot(cards, s, if (fixed) Modifier.fillMaxWidth().weight(1f, fill = s is dev.botdot.app.data.ProjectCards.Slot.Card) else Modifier.fillMaxWidth(), canvas = fixed)
                        if (s is dev.botdot.app.data.ProjectCards.Slot.Ask && s.card == null) CardPicks(cards, dev.botdot.app.data.ProjectBoard.missing(features, c))
                    } })
                }
                if (on("teams")) {
                    c.suggestion?.let { sg -> add(Tile("suggest") { m, _ -> Box(m) { SuggestedCard(ui, c, sg) } }) }
                    add(Tile("new-team") { m, _ -> Box(m) { NewTeam(ui, c) } })
                }
                if (dev.botdot.app.data.ProjectCalendar.FEATURE in features && on("calendar")) add(Tile("calendar") { m, _ -> Box(m) { CalendarTile(ui, c, bots) } })
                if (on("todo")) add(Tile("todo") { m, _ -> Column(m) { TodoPanel(ui, c, bots, here, ways, features) } })
                if (filesAt != null) add(Tile("files") { m, _ -> Box(m) { ProjectFilesTile(ui, c, filesAt) } })
            }
            BoardCanvasView(tiles, saved) { l -> ui.call({ it.setLayout(BoardCanvas.raw(l)) }) }
        } else {
        // The flow of a project never arranged; with the canvas, a long press here starts it.
        // On a phone (ADR 147) the board is read as a column: the tiles are arranged on a wider screen.
        val roomy = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= BoardCanvas.NARROW
        Column(Modifier.fillMaxWidth().then(if (canvas && roomy) Modifier.pointerInput(Unit) {
            holdAndDrag(onHold = { started = true; haptic.performHapticFeedback(HapticFeedbackType.LongPress); true })
        } else Modifier), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        if (on("days")) {
            c.day?.let { DaysLine(c, it) }
            c.checkin?.let { CheckinCard(ui, it, ways, c.name.ifBlank { c.start }) }
        } else if (c.ongoing) c.checkin?.let { CheckinCard(ui, it, ways, c.name.ifBlank { c.start }, ongoing = true) }
        val goals = CompanyFloor.DISPLAY in features
        if (goals && on("goals")) Goals(ui, c, ways.onGoalChat.takeIf { GoalAsk.shows(features) }, GoalAsk.removes(features))
        // The teams first; then the Chief, a suggested bot and New team (#690's side column, under them on a phone).
        Column(Modifier.fillMaxWidth().raised(Radius.card).padding(Space.s12),
            verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            if (!goals) Board(c)
            // The cards made by Claude, at the top of the floor (#776).
            if (dev.botdot.app.data.ProjectCards.shows(features, c)) ProjectCardsRow(ui, c, dev.botdot.app.data.ProjectBoard.missing(features, c))
            if (on("teams")) {
                c.suggestion?.let { SuggestedCard(ui, c, it) }
                NewTeam(ui, c)
            }
            if (dev.botdot.app.data.ProjectCalendar.FEATURE in features && on("calendar")) CalendarTile(ui, c, bots)
            if (filesAt != null) ProjectFilesTile(ui, c, filesAt)
        }
        if (on("todo")) TodoPanel(ui, c, bots, here, ways, features)
        }
        }
        // Its teams' keys (#841), in place of the floor's rooms and desks.
        val waits = remember(c, waiting, groups, bots) { dev.botdot.app.data.Spaces.teamWaits(c, waiting, groups.orEmpty(), bots.filter { question(it) != null }.map { it.id }) }
        TeamKeys(c, bots, info, wide = ui.railed, line = { lineOf(it) }, chatOf = teamChat, onBot = ways.onBot, onAdd = { id -> c.teams.firstOrNull { it.id == id }?.let { t -> if (offered(t).isEmpty()) ways.onChiefSay(newBotWords(c, t)) else adding = id } }, waits = waits) { teamOpen = it }
    }
    adding?.let { id -> c.teams.firstOrNull { it.id == id } }?.let { t ->
        BotPicker(tr("Add to {team}", "team" to t.name), offered(t), max = 40, action = tr("Add"), hint = { "" }, more = tr("New bot") to { ways.onChiefSay(newBotWords(c, t)) }, onDismiss = { adding = null }) { picked, _ ->
            val a = ui.api ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))
            ui.took(a.setTeamBots(t.id, t.bots + picked))
        }
    }
    val team = teamOpen?.let { id -> c.teams.firstOrNull { it.id == id } }
    if (team != null) ModalBottomSheet(onDismissRequest = { teamOpen = null }) {
        TeamSheet(ui, c, team, bots, reports = CompanyFloor.LEADS in features, line = { lineOf(it) }, onBot = { teamOpen = null; ways.onBot(it) })
    }
}

/** The words a team's "New bot" starts a Chief chat with. */
private fun newBotWords(c: Company, t: CompanyTeam): String =
    tr("A new bot for the {team} team in {project}:", "team" to t.name, "project" to c.name.ifBlank { c.start }) + " "

/** A bot's open question, while it is not working: what its desk and its row say. */
internal fun question(b: Bot): String? = b.asks?.text?.takeIf { !b.running }?.replace('\n', ' ')?.take(120)

// ---------- the 90 days (#673) ----------

/** Days 30, 60 and 90 on a thin line, filled up to today; an answered day in the colour of its answer, the one that waits marked. */
@Composable
private fun DaysLine(c: Company, day: Int) {
    val p = LocalPaper.current
    BoxWithConstraints(Modifier.fillMaxWidth().height(34.dp)) {
        val w = maxWidth
        Box(Modifier.fillMaxWidth().padding(top = Space.s8).height(2.dp).clip(RoundedCornerShape(1.dp)).background(p.line2))
        Box(Modifier.width(w * CompanyFloor.gone(day)).padding(top = Space.s8).height(2.dp).background(p.muted))
        CompanyFloor.DAYS.forEach { d ->
            val k = c.checkins.firstOrNull { it.day == d }
            val due = c.checkin?.day == d
            val color = when { k?.decision == "keep" -> p.ok; k?.decision == "stop" -> p.err; k != null -> p.warn; due -> p.warn; d <= day -> p.muted; else -> p.line2 }
            val x = w * (d.toFloat() / CompanyFloor.DAYS_ALL)
            val label = tr("Day {n}", "n" to d)
            Box(Modifier.offset(x = x - 5.dp, y = 2.dp).size(10.dp).clip(CircleShape).background(color))
            Text(label, color = if (due) p.warnText else p.faint, fontSize = Type.s12, textAlign = TextAlign.End, maxLines = 1,
                modifier = Modifier.offset(x = (x - 60.dp).coerceAtLeast(0.dp), y = 16.dp).width(60.dp))
        }
    }
}

@Composable
private fun CheckinCard(ui: CompanyUi, k: CheckinDue, ways: CompanyWays, project: String, ongoing: Boolean = false) {
    val p = LocalPaper.current
    var busy by remember(k.day) { mutableStateOf(false) }
    fun answer(decision: String) {
        if (busy) return
        busy = true
        ui.scope.launch {
            val a = ui.api ?: run { ui.tell(tr("Can't reach botdot.")); busy = false; return@launch }
            runCatching { a.answerCheckin(k.day, decision) }.onSuccess { d ->
                ui.took(d.company)
                if (decision == "stop") ui.tell(trn(d.paused, "Switched off {n} job of the project's bots.", "Switched off {n} jobs of the project's bots."))
                if (decision == "change") ways.onChiefSay((if (ongoing) tr("Monthly review of {project}: I want to change direction.", "project" to project) else tr("Day {n} check-in of {project}: I want to change direction.", "n" to k.day, "project" to project)) + " ")
            }.onFailure { ui.tell(it.message) }
            busy = false
        }
    }
    Column(Modifier.fillMaxWidth().raised(Radius.card, p.warnSoft).padding(Space.s16),
        verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (ongoing) tr("Monthly review") else tr("Day {n} check-in", "n" to k.day), color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            ByChief()
        }
        k.objectives.forEach { o ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(o.color)
                Text(o.name, color = p.text, fontSize = Type.s14, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = Space.s8))
                Text("${CompanyFloor.num(o.current)} / ${CompanyFloor.num(o.target)}", color = p.muted, fontSize = Type.s12, fontFamily = GeistMono)
                Text(if (o.onTrack) tr("On track") else tr("Behind"), color = if (o.onTrack) p.okText else p.warnText, fontSize = Type.s12, modifier = Modifier.padding(start = Space.s12))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            WordsButton(tr("Stop"), enabled = !busy) { answer("stop") }
            Spacer(Modifier.weight(1f))
            WordsButton(tr("Change direction"), enabled = !busy) { answer("change") }
            GoButton(tr("Keep going"), busy = busy) { answer("keep") }
        }
    }
}

@Composable
internal fun ByChief() {
    val p = LocalPaper.current
    val chief = chiefNamed()
    Row(verticalAlignment = Alignment.CenterVertically) {
        BotFigure(chief.color, "idle", 20, chief.outfit)
        Text(chief.name, color = p.muted, fontSize = Type.s12, modifier = Modifier.padding(start = Space.s8))
    }
}

/** The week's plan at the top of You: its items, each with its team and in its objective's colour, with Change and Approve until approved. */
@Composable
internal fun PlanCard(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val plan = c.plan?.takeIf { it.items.isNotEmpty() } ?: return
    var changing by rememberSaveable { mutableStateOf(false) }
    var typed by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(Radius.card).background(p.sunk).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("This week"), color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            ByChief()
        }
        plan.items.forEachIndexed { i, x ->
            val color = c.objectives.firstOrNull { it.id == x.objective }?.color
            val team = c.teams.firstOrNull { it.id == x.team }
            Row(verticalAlignment = Alignment.Top) {
                Text("${i + 1}.", color = p.faint, fontSize = Type.s14, modifier = Modifier.width(22.dp))
                Text(x.text, color = if (plan.approved) p.muted else p.text, fontSize = Type.s14, lineHeight = Type.line20, modifier = Modifier.weight(1f))
                if (team != null) TeamChip(team)
                if (color != null) Box(Modifier.padding(start = Space.s8, top = Space.s4)) { Dot(color) }
            }
        }
        if (!plan.approved) {
            if (changing) AskField(typed, { typed = it.take(1000) }, label = tr("Change"), button = tr("Send"), busy = busy, focus = true) {
                val text = typed.trim()
                if (text.isEmpty()) return@AskField
                busy = true
                ui.call({ it.changePlan(text) }) { ok -> busy = false; if (ok) { typed = ""; changing = false } }
            } else Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                WordsButton(tr("Change")) { changing = true }
                GoButton(tr("Approve"), busy = busy) { busy = true; ui.call({ it.approvePlan() }) { busy = false } }
            }
        }
    }
}

/** The team that does a plan item (#696): its name in its colour. */
@Composable
private fun TeamChip(t: CompanyTeam) {
    val color = parseColor(t.color, LocalPaper.current.muted)
    Text(t.name, color = color, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(start = Space.s8).widthIn(max = 120.dp).clip(Radius.pill).background(color.copy(alpha = 0.16f)).padding(horizontal = Space.s8, vertical = Space.s4))
}

// ---------- the floor ----------

/** The whiteboard: each objective, its number and the one aimed at, and a bar in its colour. */
@Composable
private fun Board(c: Company) {
    val p = LocalPaper.current
    val shape = Radius.card
    Row(Modifier.fillMaxWidth().raised(shape).padding(Space.s12), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        if (c.objectives.isEmpty()) Text(c.goal, color = p.muted, fontSize = Type.s14)
        c.objectives.forEach { o -> Kpi(o, Modifier.weight(1f)) }
    }
}

@Composable
private fun Kpi(o: Objective, modifier: Modifier) {
    val p = LocalPaper.current
    val color = parseColor(o.color, p.muted)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.padding(top = Space.s4)) { Dot(o.color) }
            Text(o.name, color = p.muted, fontSize = Type.s12, lineHeight = Type.line16, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s4))
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(CompanyFloor.num(o.current), color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
            Text(" / ${CompanyFloor.num(o.target)}", color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(bottom = Space.s4))
        }
        Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(p.line2)) {
            Box(Modifier.fillMaxWidth(CompanyFloor.ratio(o)).height(3.dp).background(color))
        }
    }
}

/** The lead's crown: the web page's shape, in gold. */
@Composable
internal fun Crown(modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    Box(modifier.size(18.dp).clip(CircleShape).background(p.sunk), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(12.dp)) {
            val s = size.width / 24f
            val path = Path().apply {
                moveTo(4 * s, 17 * s); lineTo(3 * s, 7 * s); lineTo(8 * s, 11 * s); lineTo(12 * s, 5 * s); lineTo(16 * s, 11 * s); lineTo(21 * s, 7 * s); lineTo(20 * s, 17 * s); close()
            }
            drawPath(path, GOLD)
        }
    }
}

@Composable
internal fun Dot(color: String?) = Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(color, LocalPaper.current.muted)))

/** The bot the Chief suggests: a dashed card in the colour of the team it would join, Add and dismiss. */
@Composable
private fun SuggestedCard(ui: CompanyUi, c: Company, s: Suggested) {
    val p = LocalPaper.current
    val color = c.teams.firstOrNull { it.id == s.team }?.color ?: "#8e7cff"
    var busy by remember(s.name) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().dashedBox(parseColor(color, p.line2)).padding(Space.s12), verticalAlignment = Alignment.CenterVertically) {
        BotFigure(color, "idle", 40)
        Column(Modifier.weight(1f).padding(horizontal = Space.s12)) {
            Text(s.name, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
            if (s.why.isNotBlank()) Text(s.why, color = p.muted, fontSize = Type.s12, lineHeight = Type.line16)
        }
        RoundButton(Icons.Filled.Close, tr("Dismiss"), size = 36.dp) { if (!busy) { busy = true; ui.call({ it.dismissSuggested() }) { busy = false } } }
        GoButton(tr("Add"), busy = busy) { busy = true; ui.call({ it.addSuggested() }) { busy = false } }
    }
}

/** A dashed "New team": a name and its bots, the first picked its lead; the bots in no team are offered first. */
@Composable
private fun NewTeam(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    var picking by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).dashedBox(p.line2).clickable(onClickLabel = tr("New team")) { picking = true }.padding(Space.s12),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Add, null, tint = p.muted, modifier = Modifier.size(18.dp))
        Text(tr("New team"), color = p.muted, fontSize = Type.s14, modifier = Modifier.padding(start = Space.s8))
    }
    if (picking) {
        val inTeam = c.teams.flatMap { it.bots }.toSet()
        val bots = ui.bots.collectAsState().value.orEmpty().sortedBy { it.id in inTeam }
        BotPicker(tr("New team"), bots, max = 40, action = tr("Create"), hint = { "" }, name = "", onDismiss = { picking = false }) { picked, name ->
            val a = ui.api ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))
            ui.took(a.newCompanyTeam(name, picked))
        }
    }
}

internal fun Modifier.dashedBox(color: Color): Modifier = clip(Radius.card).drawBehind {
    drawRoundRect(color, cornerRadius = CornerRadius(14.dp.toPx()), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
}

// ---------- You, and a team ----------

@Composable
internal fun YouRow(head: @Composable () -> Unit, text: String, action: @Composable () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        head()
        Text(text, color = p.text, fontSize = Type.s14, lineHeight = Type.line20, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = Space.s12))
        action()
    }
}

@Composable
internal fun SmallButton(label: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Text(label, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.Normal,
        modifier = Modifier.clip(Radius.pill).background(p.fill).clickable(onClick = onClick).padding(horizontal = Space.s12, vertical = Space.s8))
}

/** A team, opened from its room: its objective, its bots with what each does, the lead's chip, Make lead on the others, its reports. */
@Composable
private fun TeamSheet(ui: CompanyUi, c: Company, team: CompanyTeam, bots: List<Bot>, reports: Boolean, line: (Bot) -> String, onBot: (String) -> Unit) {
    val p = LocalPaper.current
    val o = CompanyFloor.objectiveOf(team, c.objectives)
    val members = team.bots.mapNotNull { id -> bots.firstOrNull { it.id == id } }
    var moving by remember(team.id) { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.s16).padding(bottom = Space.s24).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(team.color)
            Text(team.name, color = p.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = Space.s12))
        }
        if (o != null) Row(Modifier.fillMaxWidth().clip(Radius.card).background(p.sunk).padding(Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Text(o.name, color = p.muted, fontSize = Type.s12, modifier = Modifier.weight(1f))
            Text("${CompanyFloor.num(o.current)} / ${CompanyFloor.num(o.target)}", color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
        }
        members.forEach { b ->
            val lead = b.id == team.lead || (team.lead == null && b == members.first())
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).clip(Radius.small).clickable(onClickLabel = b.name) { onBot(b.id) }.padding(vertical = Space.s4), verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        BotFigure(b.color, b.state, 36, b.outfit)
                        if (lead && members.size > 1) Crown(Modifier.align(Alignment.TopEnd).offset(x = 8.dp, y = (-4).dp))
                    }
                    Column(Modifier.padding(start = Space.s12)) {
                        Text(b.name, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
                        Text(line(b), color = p.muted, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (lead) Text(tr("Lead"), color = GOLD, fontSize = Type.s12, modifier = Modifier.padding(start = Space.s8))
                else if (moving == null) SmallButton(tr("Make lead")) { moving = b.id; ui.call({ it.makeLead(team.id, b.id) }) { moving = null } }
            }
        }
        if (reports) Reports(ui, team, bots)
    }
}

/** How often the team's lead reports (#696), and its latest report with its bot's head and time. */
@Composable
private fun Reports(ui: CompanyUi, team: CompanyTeam, bots: List<Bot>) {
    val p = LocalPaper.current
    val words = mapOf("" to tr("Off"), "daily" to tr("Daily"), "twice-weekly" to tr("Twice a week"), "weekly" to tr("Weekly"))
    Choice(tr("Reports"), team.report.orEmpty(), CompanyFloor.RHYTHMS.map { it to words[it].orEmpty() }) { every ->
        if (every != team.report.orEmpty()) ui.call({ it.setReportRhythm(team.id, every) })
    }
    val r = team.lastReport?.takeIf { it.text.isNotBlank() } ?: return
    val by = bots.firstOrNull { it.id == r.bot }
    Row(Modifier.fillMaxWidth().clip(Radius.card).background(p.sunk).padding(Space.s12), verticalAlignment = Alignment.Top) {
        if (by != null) BotFigure(by.color, "idle", 28, by.outfit)
        Column(Modifier.weight(1f).padding(start = if (by != null) Space.s12 else 0.dp)) {
            Text(r.text, color = p.text, fontSize = Type.s14, lineHeight = Type.line20)
            Text(shortTime(r.at), color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(top = Space.s4))
        }
    }
}

/** The tag of a team's row of keys (#841). */
internal const val TEAM_KEYS = "team-keys"
/** The tag of a team's chevron, which shows or hides its keys (ADR 196). */
internal const val TEAM_FOLD = "team-fold"

/**
 * One row per team (#841, ADR 196), folded by default: the team's faces (the lead first, with the crown), its name and
 * what it is at ("Needs you", "2 working"). The row opens the team chat ([chatOf]; held, or with no chat, the team's
 * sheet: [onTeam]). The chevron before it shows the team's bots as keys, the lead first with the crown, and "+"; a
 * key opens that bot's own chat. Which teams are unfolded is kept per project on this device. A team with none of its
 * bots left is not shown.
 */
@OptIn(ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun TeamKeys(c: Company, bots: List<Bot>, info: CompanyFloor.Info, wide: Boolean, line: (Bot) -> String, chatOf: (String) -> (() -> Unit)?, onBot: (String) -> Unit, onAdd: ((String) -> Unit)? = null, waits: Map<String, dev.botdot.app.data.Spaces.TeamWait> = emptyMap(), onTeam: (String) -> Unit) {
    val p = LocalPaper.current
    val prefs = androidx.compose.ui.platform.LocalContext.current.getSharedPreferences("teams-open", android.content.Context.MODE_PRIVATE)
    var open by remember(c.id) { mutableStateOf(prefs.getStringSet(c.id, emptySet()).orEmpty().toSet()) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        for (branch in dev.botdot.app.data.ManyProjects.branches(c, bots)) {
            val t = branch.team
            val chat = chatOf(t.id)
            val unfold = t.id in open
            // Who waits (ADR 205): its bots by name, then its chat; a bot on several teams only on its home team.
            val w = waits[t.id] ?: dev.botdot.app.data.Spaces.TeamWait()
            val who = w.bots.mapNotNull { id -> bots.firstOrNull { it.id == id }?.name } + if (w.chat > 0) listOf(tr("Team chat")) else emptyList()
            val asks = who.size
            val whoText = if (who.size > 2) "${who.take(2).joinToString(", ")} +${who.size - 2}" else who.joinToString(", ")
            val working = branch.bots.count { info.working(it.id) || it.running }
            Column(Modifier.fillMaxWidth().clip(Radius.card).background(p.panel).testTag(TEAM_KEYS)) {
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = Space.s4, end = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(44.dp).clip(Radius.small).clickable(onClickLabel = tr("Members")) {
                        open = if (unfold) open - t.id else open + t.id
                        prefs.edit().putStringSet(c.id, open).apply()
                    }.testTag(TEAM_FOLD), contentAlignment = Alignment.Center) {
                        Icon(if (unfold) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight, contentDescription = tr("Members"), tint = p.muted, modifier = Modifier.size(20.dp))
                    }
                    Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(Radius.small)
                        .combinedClickable(onClickLabel = if (chat != null) tr("Team chat") else t.name, onLongClickLabel = t.name, onLongClick = { onTeam(t.id) }, onClick = { chat?.invoke() ?: onTeam(t.id) })
                        .padding(horizontal = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                        TeamPicture(branch.bots.take(3), if (branch.bots.size > 1) t.lead else null, 26)
                        Text(t.name, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = Space.s12))
                        val (word, dot, ink) = when {
                            asks > 0 -> Triple(tr("Needs you: {who}", "who" to whoText), p.warn, p.warnText)
                            working > 0 -> Triple(trn(working, "{n} working", "{n} working"), p.ok, p.muted)
                            else -> Triple("", p.ok, p.muted)
                        }
                        if (word.isNotEmpty()) {
                            Box(Modifier.padding(start = Space.s8).size(7.dp).clip(CircleShape).background(dot))
                            Text(word, color = ink, fontSize = Type.s14, fontWeight = if (asks > 0) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s8).widthIn(max = 200.dp))
                        }
                    }
                }
                if (unfold) FlowRow(Modifier.fillMaxWidth().padding(start = Space.s8, end = Space.s8, bottom = Space.s12), horizontalArrangement = Arrangement.spacedBy(Space.s4), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    branch.bots.forEach { b ->
                        val ask = info.asks(b.id) > 0
                        val look = KeyLook(b.name, line(b), b.color, b.state, outfit = b.outfit, unread = b.unread, asks = ask,
                            status = Keypad.status(b.running, needs = ask, unread = b.unread, runs = b.runningCount))
                        TeamKey(look, crown = b.id == t.lead && branch.bots.size > 1, wide = wide) { onBot(b.id) }
                    }
                    if (onAdd != null) TeamAddKey(tr("Add bots to {team}", "team" to t.name), wide) { onAdd(t.id) }
                }
            }
        }
    }
}
