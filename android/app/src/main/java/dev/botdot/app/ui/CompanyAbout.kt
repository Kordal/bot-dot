package dev.botdot.app.ui

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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.AboutCard
import dev.botdot.app.data.AboutScreen
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanySetup
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.launch

/** The questions of a new idea, as the server asks them, and the word each answer shows under. */
private fun ideaQuestion(key: String): String = when (key) {
    "who" -> tr("Who is it for?")
    "today" -> tr("What do they do today?")
    "why" -> tr("Why you?")
    "signal" -> tr("What would show it works in 90 days?")
    "test" -> tr("What can you test this week?")
    else -> key
}

private fun ideaLabel(key: String): String = when (key) {
    "who" -> tr("Who")
    "today" -> tr("Today")
    "why" -> tr("Why you")
    "signal" -> tr("90 days")
    "test" -> tr("First step")
    else -> key
}

/** A card's question: botdot's own in this app's words; one the Chief wrote, as it wrote it. */
private fun questionOf(c: Company, a: AboutCard): String = when {
    a.key == "today" && c.site -> tr("How do you work today?")
    a.key in CompanySetup.IDEA -> ideaQuestion(a.key)
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
 * its About cards and the review; an idea five questions with chips, one per screen, then "I want my <who> to…"
 * stories, then the review with the SWOT. Each answer is saved as it is given, so the setup goes on where it was.
 */
@Composable
internal fun AboutStep(ui: CompanyUi, c: Company) {
    if (c.about.isEmpty()) return Reading(ui, c)
    if (ui.screen == null || c.site) ui.screen = CompanySetup.startScreen(c)
    when (val s = ui.screen) {
        is AboutScreen.Question -> Question(ui, c, s.index)
        AboutScreen.Stories -> Stories(ui, c)
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

/** The dots over a new idea's screens: the five questions and the stories. */
@Composable
private fun Progress(at: Int) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        repeat(CompanySetup.IDEA.size + 1) { i -> Box(Modifier.weight(1f).height(3.dp).clip(RoundedCornerShape(2.dp)).background(if (i <= at) p.muted else p.line2)) }
    }
}

@Composable
private fun BackWords(enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.clip(Radius.pill).clickable(enabled = enabled, onClick = onClick).padding(horizontal = Space.s8, vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = if (enabled) p.muted else p.faint, modifier = Modifier.size(16.dp))
        Text(tr("Back"), color = if (enabled) p.muted else p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s8))
    }
}

/** One of the five questions of a new idea. */
@Composable
private fun Question(ui: CompanyUi, c: Company, i: Int) {
    val p = LocalPaper.current
    val key = CompanySetup.IDEA[i]
    val a = c.card(key) ?: AboutCard(key, ideaQuestion(key))
    val basis = CompanySetup.basis(c, key)
    val waiting = refresh(ui, key, a.basis != basis, basis)
    val picked = ui.picked[key] ?: CompanySetup.split(a.answer)
    fun answer(text: String) {
        ui.picked.remove(key)
        ui.screen = if (i + 1 < CompanySetup.IDEA.size) AboutScreen.Question(i + 1) else AboutScreen.Stories
        val next = CompanySetup.answered(c.about, key, text, a.question.ifEmpty { ideaQuestion(key) })
        ui.save(CompanySetup.patchAbout(next)) { it.copy(about = next) }
    }
    StepPage({
        Foot({ BackWords(enabled = i > 0) { ui.screen = AboutScreen.Question(i - 1) } }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                WordsButton(tr("Skip")) { answer("") }
                GoButton(tr("Done"), enabled = picked.isNotEmpty(), arrow = true) { answer(picked.joinToString(CompanySetup.SEP)) }
            }
        }
    }) {
        Progress(i)
        CoTitle(ideaQuestion(key))
        if (waiting) ChiefAtWork()
        ChipQuestion(ui, key, if (waiting) emptyList() else a.chips.orEmpty(), picked, multi = true) { ui.picked[key] = it }
        val answered = CompanySetup.IDEA.filter { k -> k != key && c.card(k)?.answer?.isNotEmpty() == true }
        if (answered.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            answered.forEach { k ->
                Row(verticalAlignment = Alignment.Top) {
                    Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.padding(top = Space.s4).size(16.dp))
                    Text(ideaLabel(k), color = p.muted, fontSize = Type.s14, modifier = Modifier.padding(start = Space.s8).width(80.dp))
                    Text(c.card(k)?.answer.orEmpty(), color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/** "I want my <who> to…": the stories, by group; the Chief suggests some for each group, and a group that is missing. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Stories(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
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
    StepPage({
        Foot({ BackWords { ui.screen = AboutScreen.Question(CompanySetup.IDEA.size - 1) } }) {
            GoButton(tr("Done"), arrow = true) {
                ui.screen = AboutScreen.Review
                if (c.swot == null && !ui.swotting) {
                    ui.swotting = true
                    ui.scope.launch { runCatching { ui.api?.companySwot() }.onSuccess { it?.let(ui::took) }; ui.swotting = false }
                }
            }
        }
    }) {
        Progress(CompanySetup.IDEA.size)
        FlowRow(verticalArrangement = Arrangement.Center, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            CoTitle(tr("I want my"))
            Row(Modifier.clip(Radius.small).border(1.dp, p.line2, Radius.small).clickable { ui.choosingWho = !ui.choosingWho }.padding(horizontal = Space.s8),
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

/**
 * The review: the SWOT, the 90-day goal, what the team never does without asking, time, the Chief's open questions
 * and the answered cards; then what the Chief knows. "Build my team" goes on to Team.
 */
@Composable
private fun Review(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    // A new idea's review chips build on all five answers (#787); a site's come with its read.
    val basis = CompanySetup.basis(c, "goal")
    val stale = if (c.site) c.suggestions == null else c.suggestions?.basis != basis
    val waiting = listOfNotNull("goal", "never", if (c.site) null else "time").associateWith { refresh(ui, it, stale, basis) }
    val s = c.suggestions
    val open = c.about.filter { it.answer.isEmpty() }
    val done = c.about.filter { it.answer.isNotEmpty() }
    fun answer(key: String, text: String) {
        val next = c.about.map { if (it.key == key) it.copy(answer = text, open = false) else it }
        ui.save(CompanySetup.patchAbout(next)) { it.copy(about = next) }
    }
    StepPage({
        Foot({ if (!c.site) BackWords { ui.screen = AboutScreen.Stories } }) { GoButton(tr("Build my team"), arrow = true) { ui.step = "team" } }
    }) {
        if (!c.site) SwotGrid(ui, c)
        ChipCard(tr("What is the main goal for the next 90 days?"), highlighted = c.site && c.goal.isEmpty()) {
            if (waiting["goal"] == true) ChiefAtWork()
            ChipQuestion(ui, "goal", if (waiting["goal"] == true) emptyList() else s?.goal.orEmpty(), listOfNotNull(c.goal.ifEmpty { null }), plus = true) { list ->
                val v = list.firstOrNull().orEmpty(); ui.save(CompanySetup.patchText("goal", v)) { it.copy(goal = v) }
            }
        }
        ChipCard(tr("What should the team never do without asking?"), highlighted = c.site && c.never.isEmpty()) {
            if (waiting["never"] == true) ChiefAtWork()
            ChipQuestion(ui, "never", if (waiting["never"] == true) emptyList() else s?.never.orEmpty(), c.never, multi = true, plus = true) { list -> ui.save(CompanySetup.patchLines("never", list)) { it.copy(never = list) } }
        }
        if (!c.site) ChipCard(tr("How much time can you give it?")) {
            if (waiting["time"] == true) ChiefAtWork()
            ChipQuestion(ui, "time", if (waiting["time"] == true) emptyList() else s?.time.orEmpty(), listOfNotNull(c.time.ifEmpty { null }), plus = true) { list ->
                val v = list.firstOrNull().orEmpty(); ui.save(CompanySetup.patchText("time", v)) { it.copy(time = v) }
            }
        }
        open.forEach { a ->
            ChipCard(questionOf(c, a), highlighted = a.open) {
                ChipQuestion(ui, "about:${a.key}", a.chips.orEmpty(), emptyList(), plus = true) { list -> list.firstOrNull()?.let { answer(a.key, it) } }
            }
        }
        done.forEach { a -> AnsweredCard(ui, c, a) { answer(a.key, it) } }
        Knows(c)
    }
}

@Composable
private fun ChipCard(question: String, highlighted: Boolean = false, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().clip(Radius.card).border(1.dp, if (highlighted) p.warnLine else p.line, Radius.card).padding(Space.s16),
        verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Text(question, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.Medium)
        content()
    }
}

/** An answered card: a tap opens its answer to change it. */
@Composable
private fun AnsweredCard(ui: CompanyUi, c: Company, a: AboutCard, onAnswer: (String) -> Unit) {
    val p = LocalPaper.current
    if (ui.editing == a.key) {
        var typed by remember(a.key) { mutableStateOf(a.answer) }
        ChipCard(questionOf(c, a)) {
            AskField(typed, { typed = it.take(300) }, label = questionOf(c, a), button = tr("Save"), focus = true) {
                val t = typed.replace(Regex("\\s+"), " ").trim()
                ui.editing = null
                if (t.isNotEmpty()) onAnswer(t)
            }
        }
        return
    }
    Column(Modifier.fillMaxWidth().clip(Radius.card).border(1.dp, p.line, Radius.card).clickable(onClickLabel = tr("Change")) { ui.editing = a.key }.padding(Space.s16),
        verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(questionOf(c, a), color = p.muted, fontSize = Type.s12, modifier = Modifier.weight(1f))
            Icon(Icons.Outlined.Edit, null, tint = p.faint, modifier = Modifier.size(14.dp))
        }
        Text(a.answer, color = p.text, fontSize = Type.s16)
    }
}

/** The SWOT of a new idea: four cells, then the one first test; while the Chief writes it, four empty cells. */
@Composable
private fun SwotGrid(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val w = c.swot
    if (w == null && !ui.swotting) return
    @Composable
    fun Cell(letter: String, label: String, list: List<String>, tint: Color, modifier: Modifier) {
        Column(modifier.clip(Radius.card).background(p.panel).border(1.dp, p.line, Radius.card).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(letter, color = tint, fontWeight = FontWeight.Bold, fontSize = Type.s16)
                Text(label, color = p.muted, fontSize = Type.s12, modifier = Modifier.padding(start = Space.s8))
            }
            list.forEach { Text(it, color = p.text, fontSize = Type.s14) }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            Cell("S", tr("Strengths"), w?.strengths.orEmpty(), p.ok, Modifier.weight(1f))
            Cell("W", tr("Weaknesses"), w?.weaknesses.orEmpty(), p.err, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            Cell("O", tr("Opportunities"), w?.opportunities.orEmpty(), p.mention, Modifier.weight(1f))
            Cell("T", tr("Threats"), w?.threats.orEmpty(), p.warn, Modifier.weight(1f))
        }
        if (w != null && w.firstTest.isNotEmpty()) Row(Modifier.fillMaxWidth().clip(Radius.card).background(p.sunk).padding(Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.PlayArrow, null, tint = p.text, modifier = Modifier.size(18.dp))
            Text(w.firstTest, color = p.text, fontSize = Type.s14, modifier = Modifier.padding(start = Space.s8))
        }
    }
}

/** What the Chief knows so far. */
@Composable
private fun Knows(c: Company) {
    val p = LocalPaper.current
    val rows = buildList {
        c.about.filter { it.answer.isNotEmpty() }.forEach { add(it.answer) }
        if (c.sources.isNotEmpty()) add(trn(c.sources.size, "Read {n} source", "Read {n} sources"))
        c.stories.filter { g -> g.items.any { it.start } }.forEach { g -> add(tr("I want my") + " " + whoWord(g.who) + " " + tr("to…") + " " + g.items.filter { it.start }.joinToString(CompanySetup.SEP) { it.text }) }
        c.swot?.firstTest?.takeIf { it.isNotEmpty() }?.let { add(tr("First test") + ": " + it) }
        if (c.goal.isNotEmpty()) add(c.goal)
        if (c.never.isNotEmpty()) add(tr("Asks before") + ": " + c.never.joinToString(", "))
        if (c.time.isNotEmpty()) add(tr("Time") + ": " + c.time)
    }
    Column(Modifier.fillMaxWidth().clip(Radius.card).background(p.panel).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Text(c.name.ifEmpty { c.start }, color = p.text, fontWeight = FontWeight.SemiBold)
        rows.forEach { t ->
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.padding(top = Space.s4).size(16.dp))
                Spacer(Modifier.size(8.dp))
                Text(t, color = p.muted, fontSize = Type.s14)
            }
        }
    }
}
