package dev.botdot.app.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.AboutCard
import dev.botdot.app.data.AboutScreen
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanySetup
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/** The questions of a new idea, as the server asks them, and the word each answer shows under. */
/** A question of the setup's catalogue (lib/company-chief.js CATALOGUE) in this app's words; another as the server wrote it (#805). */
private fun ideaQuestion(c: Company, key: String): String = when (key) {
    "who" -> tr("Who is it for?")
    "today" -> tr("How is it done today?")
    "why" -> tr("Why you?")
    "signal" -> tr("What would show it works in 90 days?")
    "test" -> tr("What can you test this week?")
    "runs" -> tr("What do you run?")
    "care" -> tr("What breaks or needs care?")
    "reach" -> tr("How do the bots reach it?")
    "watch" -> tr("What should be watched?")
    "done" -> tr("What does done look like?")
    "now" -> tr("Where are you now?")
    "blocks" -> tr("What is in the way?")
    "help" -> tr("Where do you want help?")
    "first" -> tr("What first?")
    else -> CompanySetup.questionScreen(c, key)?.question ?: c.card(key)?.question?.ifEmpty { null } ?: key
}

/** The line a question's answer shows on in the review. */
private fun ideaLabel(c: Company, key: String): String = when (key) {
    "who" -> tr("Who")
    "today" -> tr("Today")
    "why" -> tr("Why you")
    "signal" -> tr("90 days")
    "test", "first" -> tr("First step")
    "runs" -> tr("Runs")
    "care" -> tr("Needs care")
    "reach" -> tr("Access")
    "watch" -> tr("Watch")
    "done" -> tr("Finish line")
    "now" -> tr("Now")
    "blocks" -> tr("In the way")
    "help" -> tr("Help")
    else -> CompanySetup.questionScreen(c, key)?.label ?: key
}

/** A review row's label (#800): botdot's own words for its fields. */
private fun rowLabel(c: Company, key: String): String = when (key) {
    "stories" -> tr("Stories")
    "goal" -> tr("Goal")
    "never" -> tr("Asks before")
    "time" -> tr("Time")
    "deliverBy" -> tr("Delivery")
    else -> key.removePrefix("about:").let { k -> if (c.site) c.card(k)?.let { questionOf(c, it) } ?: k else ideaLabel(c, k) }
}

/** A card's question: botdot's own in this app's words; one the Chief wrote, as it wrote it. */
private fun questionOf(c: Company, a: AboutCard): String = when {
    a.key == "today" && c.site -> tr("How do you work today?")
    !c.site && a.key in CompanySetup.questions(c) -> ideaQuestion(c, a.key)
    a.key == "about" -> tr("What is your project about?")
    a.key == "serves" -> tr("Who do you serve?")
    else -> a.question
}

internal fun whoWord(w: String): String = when (w) {
    "users" -> tr("users")
    "customers" -> tr("customers")
    "clients" -> tr("clients")
    "members" -> tr("members")
    "students" -> tr("students")
    "team" -> tr("team")
    "partners" -> tr("partners")
    else -> w
}

/**
 * The About step (#670; web: public/company-about.js). botdot first asks the Chief to read the company: a site gets
 * its About cards and the review; an idea the questions the server sends for it (#805), with chips, one per screen,
 * then "I want my <who> to…" stories where it has them, the delivery date (#800), then the review: the SWOT where it
 * has one and one list of what was answered. Each answer is saved as it is given, so the setup goes on where it was.
 */
@Composable
internal fun AboutStep(ui: CompanyUi, c: Company) {
    if (c.about.isEmpty()) return Reading(ui, c)
    if (ui.screen == null || c.site) ui.screen = CompanySetup.startScreen(c)
    when (val s = ui.screen) {
        is AboutScreen.Question -> Question(ui, c, s.index)
        AboutScreen.Stories -> Stories(ui, c)
        AboutScreen.Delivery -> DeliveryQuestion(ui, c)
        else -> Review(ui, c)
    }
}

/**
 * Fresh chips for [key] once the answers they build on are saved (#787): asked once per [basis]. True while they are
 * on their way, when the chips there are are not shown; a failure leaves the ones drafted at the start.
 */
@Composable
private fun refresh(ui: CompanyUi, key: String, stale: Boolean, basis: String): Boolean {
    val at = "$key:$basis"
    val idle = ui.saving == 0
    LaunchedEffect(key, basis, stale, idle) { if (stale && idle && "suggest:$key" !in ui.asking && ui.tried.add(at)) suggest(ui, key) }
    return "suggest:$key" in ui.asking || (stale && at !in ui.tried)
}

/** The Chief's call for chips; its answer arrives as the company, a failure leaves no chips. */
private fun suggest(ui: CompanyUi, key: String) {
    val id = "suggest:$key"
    if (id in ui.asking) return
    ui.asking.add(id)
    ui.scope.launch {
        runCatching { ui.api?.suggestForCompany(key) }.onSuccess { it?.let(ui::took) }
        ui.asking.remove(id)
    }
}

/** The Chief reads the site, or names the idea: what the owner gave, until it has. */
@Composable
private fun Reading(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    LaunchedEffect(c.id, ui.readFailed) {
        if (ui.reading || ui.readFailed) return@LaunchedEffect
        ui.reading = true
        val a = ui.api
        runCatching { a!!.readCompany() }.onSuccess { ui.took(it); ui.readFailed = false }.onError { ui.tell(it.message); ui.readFailed = true }
        ui.reading = false
    }
    StepPage(null) {
        CoTitle(c.name.ifEmpty { c.start })
        if (c.name.isNotEmpty()) Text(c.start, color = p.muted, fontSize = Type.s16)
        SourceList(c.sources)
        if (ui.readFailed) GoButton(tr("Try again")) { ui.readFailed = false } else ChiefAtWork()
    }
}

/** The ticks under the step bar (#800): one a screen of a new idea's, the ones done grey, the one on screen white. */
@Composable
private fun Ticks(c: Company, s: AboutScreen) {
    val p = LocalPaper.current
    val at = CompanySetup.tick(c, s)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        repeat(CompanySetup.count(c)) { i -> Box(Modifier.weight(1f).height(3.dp).clip(RoundedCornerShape(2.dp)).background(if (i == at) p.text else if (i < at) p.muted else p.line2)) }
    }
}

/** The answer the question builds on, as a small chip over it. */
@Composable
private fun Previous(text: String) {
    val p = LocalPaper.current
    Row(Modifier.raised(Radius.pill).padding(horizontal = Space.s12, vertical = Space.s8), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Check, null, tint = p.muted, modifier = Modifier.size(15.dp))
        Text(text, color = p.muted, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s8))
    }
}

/** Grey chips in the place of the Chief's while it writes them (#787, #800). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkeletonChips() {
    val p = LocalPaper.current
    val pulse = rememberInfiniteTransition(label = "skeleton")
    val alpha by pulse.animateFloat(0.5f, 1f, infiniteRepeatable(tween(Motion.SLOW * 3), RepeatMode.Reverse), label = "alpha")
    FlowRow(Modifier.alpha(alpha).semantics { contentDescription = tr("Working") }, horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        listOf(180, 132, 156).forEach { w -> Box(Modifier.width(w.dp).height(36.dp).clip(Radius.pill).background(p.raise2)) }
    }
}

/** A question's foot: Skip quiet on the left, Next on the right. */
@Composable
private fun NextFoot(enabled: Boolean, onSkip: () -> Unit, onNext: () -> Unit) =
    Foot({ WordsButton(tr("Skip"), onClick = onSkip) }) { GoButton(tr("Next"), enabled = enabled, arrow = true, onClick = onNext) }

/** One of a new idea's questions, the answer before it over it (#800). */
@Composable
private fun Question(ui: CompanyUi, c: Company, i: Int) {
    val delivery = hasDelivery(ui)
    val key = CompanySetup.questions(c).getOrNull(i) ?: return run { ui.screen = CompanySetup.startScreen(c) }
    val a = c.card(key) ?: AboutCard(key, ideaQuestion(c, key))
    val basis = CompanySetup.basis(c, key)
    val waiting = refresh(ui, key, a.basis != basis, basis)
    val picked = ui.picked[key] ?: CompanySetup.split(a.answer)
    fun answer(text: String) {
        ui.picked.remove(key)
        val next = CompanySetup.answered(c.about, key, text, a.question.ifEmpty { ideaQuestion(c, key) })
        val then = CompanySetup.after(c, AboutScreen.Question(i), delivery)
        if (then == AboutScreen.Stories) ui.screen = then else leave(ui, c, then)
        ui.save(CompanySetup.patchAbout(next)) { it.copy(about = next) }
    }
    StepPage({ NextFoot(picked.isNotEmpty(), onSkip = { answer("") }) { answer(picked.joinToString(CompanySetup.SEP)) } }) {
        Ticks(c, AboutScreen.Question(i))
        CompanySetup.previous(c, key)?.let { Previous(it) }
        CoTitle(ideaQuestion(c, key))
        if (waiting) SkeletonChips()
        ChipQuestion(ui, key, if (waiting) emptyList() else a.chips.orEmpty(), picked, multi = true) { ui.picked[key] = it }
    }
}

/** Leaves the stories: on to the delivery date when the server has it, else the review. */
private fun afterStories(ui: CompanyUi, c: Company, delivery: Boolean) = leave(ui, c, CompanySetup.after(c, AboutScreen.Stories, delivery))

/** Goes on to [to] past the questions and stories: the Chief starts the SWOT meanwhile, where the setup has one. */
private fun leave(ui: CompanyUi, c: Company, to: AboutScreen) {
    ui.screen = to
    if (CompanySetup.hasSwot(c) && c.swot == null && !ui.swotting) {
        ui.swotting = true
        ui.scope.launch { runCatching { ui.api?.companySwot() }.onSuccess { it?.let(ui::took) }; ui.swotting = false }
    }
}

@Composable
private fun hasDelivery(ui: CompanyUi): Boolean {
    val server by ui.app.store.version.value.collectAsState()
    return CompanySetup.DELIVERY in server?.features.orEmpty()
}

/** "I want my <who> to…": the stories, by group; the Chief suggests some for each group, and a group that is missing. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Stories(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val delivery = hasDelivery(ui)
    val who = ui.who ?: c.stories.firstOrNull()?.who ?: "users"
    LaunchedEffect(who) {
        ui.who = who
        if (who in ui.ideas) return@LaunchedEffect
        ui.ideas[who] = emptyList()
        runCatching { ui.api?.storyIdeas(who) }.onSuccess { r -> if (r != null) { ui.ideas[who] = r.stories; if (r.group.isNotEmpty()) ui.missing = r.group } }
    }
    var typed by remember(who) { mutableStateOf("") }
    fun add(text: String) {
        val next = CompanySetup.addStory(c.stories, who, text) ?: return
        ui.save(CompanySetup.patchStories(next)) { it.copy(stories = next) }
    }
    StepPage({ NextFoot(true, onSkip = { afterStories(ui, c, delivery) }) { afterStories(ui, c, delivery) } }) {
        Ticks(c, AboutScreen.Stories)
        CompanySetup.split(c.card(CompanySetup.questions(c).lastOrNull().orEmpty())?.answer.orEmpty()).firstOrNull()?.let { Previous(it) }
        FlowRow(verticalArrangement = Arrangement.Center, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            CoTitle(tr("I want my"))
            Row(Modifier.clip(Radius.small).background(p.raise2).clickable { ui.choosingWho = !ui.choosingWho }.padding(horizontal = Space.s8),
                verticalAlignment = Alignment.CenterVertically) {
                CoTitle(whoWord(who))
                Icon(Icons.Filled.ArrowDropDown, null, tint = p.muted)
            }
            CoTitle(tr("to…"))
        }
        if (ui.choosingWho) ChipQuestion(ui, "who", CompanySetup.whoWords(c.stories, who, ui.missing), emptyList(), label = ::whoWord) { list ->
            list.firstOrNull()?.let { ui.who = it; ui.choosingWho = false }
        }
        AskField(typed, { typed = it.take(200) }, label = tr("I want my") + " " + whoWord(who) + " " + tr("to…"), button = tr("Add")) { add(typed); typed = "" }
        val ideas = CompanySetup.ideas(ui.ideas[who].orEmpty(), c.stories, who)
        if (ideas.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            ideas.forEach { t -> CoChip(t, icon = Icons.Filled.Add) { add(t) } }
        }
        c.stories.forEachIndexed { gi, g ->
            Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                Text(whoWord(g.who), color = p.muted, fontSize = Type.s12, fontWeight = FontWeight.Medium)
                g.items.forEachIndexed { si, s ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${si + 1}", color = p.faint, fontSize = Type.s12, modifier = Modifier.width(22.dp))
                        Text(s.text, color = p.text, fontSize = Type.s16, modifier = Modifier.weight(1f))
                        Text(if (s.start) tr("Start") else tr("Later"), color = if (s.start) p.inkText else p.muted, fontSize = Type.s12,
                            modifier = Modifier.clip(Radius.pill).background(if (s.start) p.ink else p.sunk)
                                .clickable { val next = CompanySetup.flipStart(c.stories, gi, si); ui.save(CompanySetup.patchStories(next)) { it.copy(stories = next) } }
                                .padding(horizontal = Space.s12, vertical = Space.s8))
                        RoundButton(Icons.Filled.Close, tr("Remove"), size = 36.dp) { val next = CompanySetup.dropStory(c.stories, gi, si); ui.save(CompanySetup.patchStories(next)) { it.copy(stories = next) } }
                    }
                }
            }
        }
        if (!ui.choosingWho) CoChip(tr("I want my…"), dashed = false, icon = Icons.Filled.Add) { ui.choosingWho = true }
    }
}

/** The delivery date as its own question (#800): the presets, a day, or Indefinite. */
@Composable
private fun DeliveryQuestion(ui: CompanyUi, c: Company) {
    StepPage({ NextFoot(c.deliverBy.isNotEmpty(), onSkip = { ui.screen = AboutScreen.Review }) { ui.screen = AboutScreen.Review } }) {
        Ticks(c, AboutScreen.Delivery)
        CoTitle(tr("When should it be delivered?"))
        DeliveryChips(c.deliverBy) { v -> ui.save(CompanySetup.patchText("deliverBy", v)) { it.copy(deliverBy = v) } }
    }
}

/**
 * The review (#800): the project's name, a new idea's SWOT, and one list of what was answered, a row a field; a tap
 * on a row opens it to change it. "Build my team" goes on to Team.
 */
@Composable
private fun Review(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val delivery = hasDelivery(ui)
    // A new idea's review chips build on all five answers (#787); a site's come with its read.
    val basis = CompanySetup.basis(c, "goal")
    val stale = if (c.site) c.suggestions == null else c.suggestions?.basis != basis
    val waiting = listOfNotNull("goal", "never", if (c.site) null else "time").associateWith { refresh(ui, it, stale, basis) }
    StepPage({ Foot({}) { GoButton(tr("Build my team"), arrow = true) { ui.editing = null; ui.step = "team" } } }) {
        if (!c.site) Ticks(c, AboutScreen.Review)
        CoTitle(c.name.ifEmpty { c.start })
        if (!c.site && CompanySetup.hasSwot(c)) SwotGrid(ui, c)
        Column(Modifier.fillMaxWidth().raised(Radius.card)) {
            CompanySetup.reviewKeys(c, delivery).forEachIndexed { n, key ->
                if (n > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
                ReviewRow(ui, c, key, waiting[key] == true)
            }
        }
    }
}

/** What a review row shows: the answer as one line, or null while not answered. */
private fun rowValue(c: Company, key: String): String? = when (key) {
    "stories" -> c.stories.filter { it.items.isNotEmpty() }.joinToString("\n") { g -> whoWord(g.who).replaceFirstChar { it.uppercase() } + ": " + g.items.joinToString(" · ") { it.text } }
    "goal" -> c.goal
    "never" -> c.never.joinToString(", ")
    "time" -> c.time
    "deliverBy" -> Delivery.value(c.deliverBy)
    else -> c.card(key.removePrefix("about:"))?.answer
}?.takeIf { it.isNotEmpty() }

/** One row of the review: its label over its answer; a tap opens what changes it, a tap on its label closes it. */
@Composable
private fun ReviewRow(ui: CompanyUi, c: Company, key: String, waiting: Boolean) {
    val p = LocalPaper.current
    val value = rowValue(c, key)
    val card = if (key.startsWith("about:")) c.card(key.removePrefix("about:")) else null
    // What the owner has yet to answer on a site's review, as the setup asked before (#670).
    val wanted = c.site && value == null && (card?.open == true || key == "goal" || key == "never")
    val open = ui.editing == key
    Column(Modifier.fillMaxWidth().clickable(onClickLabel = tr("Change")) {
        if (key == "stories") ui.screen = AboutScreen.Stories else ui.editing = if (open) null else key
    }.padding(horizontal = Space.s16, vertical = Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(rowLabel(c, key), color = if (wanted) p.warnText else p.muted, fontSize = Type.s12)
        if (!open) Text(value ?: "—", color = if (value == null) p.faint else p.text, fontSize = Type.s16)
    }
    if (open) Column(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s16, bottom = Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        RowEditor(ui, c, key, card, waiting)
    }
}

/** What changes a row: the Chief's chips for the goal, the rules and the time, the presets for the date, a field for an answer. */
@Composable
private fun RowEditor(ui: CompanyUi, c: Company, key: String, card: AboutCard?, waiting: Boolean) {
    val s = c.suggestions
    fun chips(list: List<String>?) = if (waiting) emptyList() else list.orEmpty()
    if (waiting) SkeletonChips()
    when (key) {
        "goal" -> ChipQuestion(ui, "goal", chips(s?.goal), listOfNotNull(c.goal.ifEmpty { null }), plus = true) { list ->
            val v = list.firstOrNull().orEmpty(); ui.save(CompanySetup.patchText("goal", v)) { it.copy(goal = v) }
        }
        "never" -> ChipQuestion(ui, "never", chips(s?.never), c.never, multi = true, plus = true) { list -> ui.save(CompanySetup.patchLines("never", list)) { it.copy(never = list) } }
        "time" -> ChipQuestion(ui, "time", chips(s?.time), listOfNotNull(c.time.ifEmpty { null }), plus = true) { list ->
            val v = list.firstOrNull().orEmpty(); ui.save(CompanySetup.patchText("time", v)) { it.copy(time = v) }
        }
        "deliverBy" -> DeliveryChips(c.deliverBy) { v -> ui.save(CompanySetup.patchText("deliverBy", v)) { it.copy(deliverBy = v) } }
        else -> {
            val k = key.removePrefix("about:")
            val question = card?.let { questionOf(c, it) } ?: ideaQuestion(c, k)
            fun answer(text: String) {
                ui.editing = null
                val next = CompanySetup.answered(c.about, k, text, card?.question?.ifEmpty { null } ?: question)
                ui.save(CompanySetup.patchAbout(next)) { it.copy(about = next) }
            }
            if (card?.answer.isNullOrEmpty() && !card?.chips.isNullOrEmpty()) ChipQuestion(ui, key, card!!.chips.orEmpty(), emptyList(), plus = true) { list -> list.firstOrNull()?.let(::answer) }
            else {
                var typed by remember(key) { mutableStateOf(card?.answer.orEmpty()) }
                AskField(typed, { typed = it.take(300) }, label = question, button = tr("Save"), focus = true) {
                    val t = typed.replace(Regex("\\s+"), " ").trim()
                    if (t.isNotEmpty()) answer(t) else ui.editing = null
                }
            }
        }
    }
}

/** The SWOT of a new idea: four cells, each its word in its colour over what it holds, then the one first test; while the Chief writes it, four empty cells. */
@Composable
private fun SwotGrid(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val w = c.swot
    if (w == null && !ui.swotting) return
    @Composable
    fun Cell(label: String, list: List<String>, tint: Color, modifier: Modifier) {
        Column(modifier.raised(Radius.card).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            Text(label, color = tint, fontWeight = FontWeight.SemiBold, fontSize = Type.s14)
            list.forEach { Text(it, color = p.text, fontSize = Type.s14) }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
            Cell(tr("Strengths"), w?.strengths.orEmpty(), p.okText, Modifier.weight(1f).fillMaxHeight())
            Cell(tr("Weaknesses"), w?.weaknesses.orEmpty(), p.warnText, Modifier.weight(1f).fillMaxHeight())
        }
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
            Cell(tr("Opportunities"), w?.opportunities.orEmpty(), p.mention, Modifier.weight(1f).fillMaxHeight())
            Cell(tr("Threats"), w?.threats.orEmpty(), p.err, Modifier.weight(1f).fillMaxHeight())
        }
        if (w != null && w.firstTest.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(top = Space.s4).raised(Radius.card).padding(Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.PlayArrow, null, tint = p.text, modifier = Modifier.size(18.dp))
            Text(w.firstTest, color = p.text, fontSize = Type.s14, modifier = Modifier.padding(start = Space.s8))
        }
    }
}
