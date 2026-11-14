package dev.botdot.app.data

// The rules of Needs you's cards, once for both phones (ADR 242): what a waiting job, tile, ask and answer say, which
// of them "Approve all" may approve, what a pressed button reads, and a job's schedule in words. Moved here from the
// Android app's NeedsYouScreen unchanged, for the iPhone's Needs you (#1363).

/**
 * What an answered card is remembered by, until the owner leaves the screen or the chat: the job, and for a change to
 * an approved job the change too, by when it was proposed (`at`), as the web page's `changeKey` does. A second change
 * to the same job, proposed after the first was answered, is a card of its own and not the answered one. A job never
 * approved has no such part: its yes approves it for good and its no removes it, and the server gives a new job a
 * new id, so it never waits a second time under the id it had.
 */
fun jobKey(b: Bot, j: Job): String = "j:${b.id}:${j.id}${changeKey(j.change.takeIf { j.approved }?.let { it.at.orEmpty() })}"

/** The same for a tile of the Board and a change to an approved one. */
fun tileKey(t: Tile): String = "t:${t.id}${changeKey(t.change.takeIf { t.approved }?.let { it.at.orEmpty() })}"

/** [at]: when the change was proposed, "" where the server does not say, and null for what is no change. */
private fun changeKey(at: String?): String = if (at == null) "" else ":change:${at.trim()}"

/** The [jobs] that wait and whose card was not [answered] here: they have a card with its buttons, and "Approve N" counts them. */
fun jobsLeft(jobs: List<Pair<Bot, Job>>, answered: List<String>): List<Pair<Bot, Job>> = jobs.filter { (b, j) -> jobKey(b, j) !in answered }

/** The same for the [tiles] that wait. */
fun tilesLeft(tiles: List<Tile>, answered: List<String>): List<Tile> = tiles.filter { tileKey(it) !in answered }

/**
 * What an answered card says: the app's own word for the answer and, after a yes that started something, what the
 * server says carries on ("Allowed · it carries on"). Without it the word stands alone.
 */
fun answeredLabel(label: String, started: CarriesOn?): String = if (started == null) label else "$label · ${started.text}"

/**
 * The word for an answer: the card's own where it has one ([own]: "Always approved", "Allowed"), else the server's
 * words for the answered card ("Declined and removed", "Changed: daily at 07:00", "Kept as it was: daily at 08:00"),
 * else "Approved" or "Declined", as before the server said any.
 */
fun answeredWord(own: String?, said: Answered?, yes: Boolean): String = own ?: said?.text ?: if (yes) tr("Approved") else tr("Declined")

/** Under the body of a change to an approved job or tile: nothing stops while the card waits. */
val RUNS_AS_APPROVED: String get() = tr("Runs as you approved it until you answer.")

/** The question before "Always allow" answers from a server that sends no `warning`, in the web page's words (public/needs.js). */
val ALWAYS_ALLOW_QUESTION: String get() = tr("Let this bot do this from now on, whatever the details?")

/** The same question on the Chief's own card (ADR 047), with the Chief's name, as the web page asks it. */
fun alwaysAllowChief(name: String) = tr("Let {name} do this from now on, whatever the details?", "name" to name)

/**
 * What "Approve all" does with what waits: it approves [jobs] and [memory], which a card shows in words, and leaves
 * every job and tile that runs a script for its own card. A guarded memory change (one to what the owner said, and
 * a forget) is left for its own card too: it is neither in [memory] nor counted, and no line names it. [label]: what the button reads, counting what it approves
 * ("Approve 3"); null with fewer than two, and then there is no button. [line]: what is left, named in one line
 * under the title; null without the button, or when nothing is left.
 */
class ApproveAll(val jobs: List<Pair<Bot, Job>>, val memory: List<MemoryChange>, left: List<String>) {
    val label: String? = (jobs.size + memory.size).takeIf { it >= 2 }?.let { tr("Approve {n}", "n" to it) }
    val line: String? = scriptsLeft(left).takeIf { label != null }
}

/** [jobs], [memory] and [tiles]: what waits and was not answered yet. A tile waits for a script, so it is always left. */
fun approveAll(jobs: List<Pair<Bot, Job>>, memory: List<MemoryChange>, tiles: List<Tile>): ApproveAll {
    val (scripts, words) = jobs.partition { (_, j) -> j.touchesScript }
    return ApproveAll(words, memory.filter { !it.guarded }, scripts.map { (_, j) -> j.name } + tiles.map { "“${it.title}”" })
}

/** The line that names what "Approve all" left: "Disk check runs a script: approve it on its card." null for none. */
fun scriptsLeft(names: List<String>): String? = when (names.size) {
    0 -> null
    1 -> tr("{name} runs a script: approve it on its card.", "name" to names[0])
    else -> tr("{names} and {last} run scripts: approve them on their cards.", "names" to names.dropLast(1).joinToString(", "), "last" to names.last())
}


/**
 * What the card of a waiting job shows. A job before its first OK: its name, and "Decline" in the server's words where
 * it sends them (`no`: "Decline and remove"). An approved job with a change beside it: "<name>: a change", the approved
 * schedule and the new one, and what goes beside what comes: [promptWas] is the approved text, struck above [prompt],
 * where the text changes; [scriptWas] the approved script above [script], where the script changes. [script] is null
 * for a job that runs none after the yes. [line]: [RUNS_AS_APPROVED] on a change. [also]: what else the change
 * changes, a line each: whether the owner hears of every run, when a script job asks the AI, and its logins (a new job lists them too). [summary]: what the
 * change changes in its proposer's one sentence, null where the server sends none: a closed card shows it in place of
 * what goes and what comes, which a tap brings.
 */
data class JobCard(
    val title: String, val meta: String,
    val script: String?, val scriptWas: String?,
    val prompt: String, val promptWas: String?,
    val line: String?, val no: String, val yes: String,
    val also: List<String> = emptyList(),
    val summary: String? = null,
)

/** A job's report setting in words (`notify`, docs/api.md); a value this app does not know as it came. */
private fun notifyWords(v: String) = when (v) { "always" -> tr("after every run"); "report-only" -> tr("only when it has something to report"); else -> v }

/** When a script job asks the AI, in the words of the web page's job dialog (`aiWhen`); a value this app does not know as it came. */
private fun aiWhenWords(v: String) = when (v) {
    "output" -> tr("only when it prints something"); "failed" -> tr("only when it fails"); "always" -> tr("every time it runs"); "never" -> tr("never, just its output"); else -> v
}

/** "<label>: <was> → <now>" for a setting that changes, "<label>: <now>" for one that had none; null when it stays. */
private fun changed(label: String, was: String?, now: String?, words: (String) -> String): String? = when {
    now == null || now == was -> null
    was == null -> "$label: ${words(now)}"
    else -> "$label: ${words(was)} → ${words(now)}"
}

private fun kindWords(script: Boolean) = if (script) tr("a script, no AI") else tr("uses AI")

/** Under a change's sentence on a closed card: where the rest is. */
val SEE_FULL_CHANGE: String get() = tr("Tap to see the full change")

/** Whether the card shows what goes and what comes: always without a sentence, and with one once it is [open]. */
fun showsFull(card: JobCard, open: Boolean) = open || card.summary == null

fun jobCard(j: Job): JobCard {
    val c = j.change.takeIf { j.approved }
    val was = scheduleWords(j) // the approved schedule: a change shows the new one beside it
    if (c == null) {
        val by = when (j.changedBy ?: j.createdBy) { "chief" -> tr("added by the Chief"); "bot" -> tr("added by itself"); else -> tr("changed") }
        val script = j.kind == "script"
        return JobCard(j.name, "$was · ${kindWords(script)} · $by", j.script.takeIf { script }, null, j.prompt, null, null, j.no ?: tr("Decline"), j.yes ?: tr("Approve"),
            listOfNotNull(j.logins.takeIf { script && it.isNotEmpty() }?.let { tr("Logins: {logins}", "logins" to it.joinToString(", ")) }))
    }
    val by = when (c.by) { "chief" -> tr("changed by the Chief"); "bot" -> tr("changed by itself"); else -> tr("changed") }
    val now = c.words ?: was
    // After the yes it runs a script: the change says so or carries one ([Job.touchesScript] reads it the same way),
    // or it says nothing of it and the approved job runs one.
    val script = c.runsScript || (c.kind == null && j.kind == "script")
    val scriptNow = (c.script ?: j.script).takeIf { script }
    val prompt = c.prompt ?: j.prompt
    val meta = listOfNotNull(
        if (now == was) was else tr("now {was} → {now}", "was" to was, "now" to now),
        c.name?.takeIf { it != j.name }?.let { tr("renamed “{name}”", "name" to it) },
        kindWords(script), by,
    ).joinToString(" · ")
    return JobCard(
        tr("{name}: a change", "name" to j.name), meta,
        scriptNow, j.script.takeIf { j.kind == "script" && it != scriptNow },
        prompt, j.prompt.takeIf { it.isNotBlank() && it != prompt },
        RUNS_AS_APPROVED, j.no ?: tr("Keep as it is"), j.yes ?: tr("Approve the change"),
        listOfNotNull(
            changed(tr("Tells you"), j.notify ?: "report-only", c.notify, ::notifyWords),
            changed(tr("Asks the AI"), j.aiWhen?.ifBlank { null }, c.aiWhen.takeIf { script }, ::aiWhenWords),
            changed(tr("Logins"), j.logins.joinToString(", ").ifEmpty { null }, if (!script) null else c.logins.orEmpty().joinToString(", ").ifEmpty { if (j.logins.isEmpty()) null else tr("none") }) { it },
        ),
        c.summary,
    )
}

/**
 * What the card of a waiting tile shows, as [JobCard]: a tile before its first OK with its [scripts], and an approved
 * tile with a change beside it: "<title>: a change", the scripts it runs today ([scriptsWas], where the server lists
 * them) above those it would run. A change that lists no scripts shows none as proposed: the approved ones are never
 * shown as what the yes would approve, and stand above as the approved ones, as on the web page.
 */
data class TileCard(val title: String, val meta: String, val scripts: List<String>, val scriptsWas: List<String>, val line: String?, val no: String, val yes: String)

fun tileCard(t: Tile): TileCard {
    val c = t.change.takeIf { t.approved }
    val scripts = if (c == null) t.scripts else c.scripts.orEmpty()
    val by = if (c == null) { if (t.changedBy == "bot") tr("added by itself") else tr("added by the Chief") }
        else when (c.by) { "chief" -> tr("changed by the Chief"); "bot" -> tr("changed by itself"); else -> tr("changed") }
    // Every script it runs: the card says "a script" only above the scripts it shows.
    val meta = listOfNotNull(
        t.section.ifEmpty { null }, c?.title?.takeIf { it != t.title }?.let { tr("renamed “{name}”", "name" to it) },
        tr("a script, no AI").takeIf { scripts.isNotEmpty() }, by,
    ).joinToString(" · ")
    return if (c == null) TileCard(tr("Put “{title}” on your Board?", "title" to t.title), meta, scripts, emptyList(), null, t.no ?: tr("Decline"), t.yes ?: tr("Approve"))
    else TileCard(tr("{name}: a change", "name" to t.title), meta, scripts, t.scripts.takeIf { it != scripts }.orEmpty(), RUNS_AS_APPROVED, t.no ?: tr("Keep as it is"), t.yes ?: tr("Approve the change"))
}


/** A row the card of an action in a connected app draws was clipped ([Ask.rowsCut]): a yes would send more than the card shows. */
private fun connectorCut(a: Ask): Boolean = a.rows.isNotEmpty() && a.rowsCut

/**
 * Whether that card says [TOO_LONG]: the action is too long to show in full ([Ask.tooLong]). The card has the rows
 * that fit, or none, and never `details`, which is as long as the action.
 */
fun connectorTooLong(a: Ask): Boolean = a.tooLong && !connectorCut(a)

/** The line of a card whose action is too long to show in full, as the web page says it. */
val TOO_LONG: String get() = tr("Too long to show in full.")

/**
 * Whether the card offers "Always allow": not while a row it draws was clipped. It grants the action
 * with any arguments, so it is offered for an action too long to show in full too.
 */
fun connectorAlways(a: Ask): Boolean = !connectorCut(a)

/**
 * Whether the card offers "Allow once", which sends exactly the action's arguments: only when the card shows them
 * all. Not while a row was clipped, and not for an action too long to show in full. Without rows the card shows
 * `details`, which is whole.
 */
fun connectorOnce(a: Ask): Boolean = connectorAlways(a) && !connectorTooLong(a)

/** Whether that card shows `details`: in place of rows it does not have, and under rows that were clipped. */
fun connectorDetails(a: Ask): Boolean = !connectorTooLong(a) && (a.rows.isEmpty() || (a.rowsCut && a.details.isNotBlank()))

/** The title of the card of a skill a bot wrote: the server's line, or the app's own where it sent none. */
fun skillTitle(a: Ask): String = a.line.ifEmpty { tr("Wants to keep a skill it wrote: “{name}”", "name" to a.skill?.name.orEmpty()) }

/** What the yes button of a changed bot reads: the server's word where it sends one ("Allow"), "Approve" otherwise. */
fun changeYes(a: Ask): String = a.yes ?: tr("Approve")

/** What the yes of a card that turns on a call or a notify address says while its answer is on its way (#154). */
val CREATING_CONNECTION: String get() = tr("Creating connection…")

/**
 * What a card's button says while its answer is on its way: "Approving…" for "Approve", as on the web page. [connects]:
 * it is the yes of a card that turns on a call or a notify address ([dev.botdot.app.data.Job.createsConnection]): "Creating connection…".
 */
fun busyWord(label: String, connects: Boolean = false): String = if (connects) CREATING_CONNECTION else when (label) {
    tr("Approve"), tr("Always approve") -> tr("Approving…")
    tr("Allow"), tr("Allow once"), tr("Always allow") -> tr("Allowing…")
    tr("Decline") -> tr("Declining…")
    tr("Save") -> tr("Saving…")
    tr("Install") -> tr("Installing…")
    tr("Add") -> tr("Adding…")
    else -> if (label.startsWith("Always allow ") || label.startsWith("Allow always ") || label.startsWith(tr("Always allow") + " ")) tr("Allowing…") else "$label…" // the server's "Always allow reminders" (#280)
}

/**
 * The parts of a bot change as the card draws them, in the server's order: a changed text by itself, and the parts
 * that are no text together while they follow one another, as the rows of one box.
 */
fun partGroups(parts: List<ChangedPart>): List<List<ChangedPart>> {
    val groups = mutableListOf<MutableList<ChangedPart>>()
    for (part in parts) {
        val last = groups.lastOrNull()
        if (part.was == null && last != null && last.last().was == null) last += part else groups += mutableListOf(part)
    }
    return groups
}

/** The line that names the asks "Allow all" leaves to their own Allow (`own`), as on the web page; null for none. */
fun batchOwnLine(asks: List<Ask>): String? {
    val own = asks.filter { it.batch?.own == true }.map { "“${it.title.ifBlank { it.line }}”" }
    return when (own.size) {
        0 -> null
        1 -> tr("Allow all leaves {name} to its own Allow.", "name" to own[0])
        else -> tr("Allow all leaves {names} and {last} to their own Allow.", "names" to own.dropLast(1).joinToString(", "), "last" to own.last())
    }
}

/** An ask's card title as its own card draws it, for the faded line once it is answered. */
fun askTitle(a: Ask): String = when {
    a.kind == "permission" -> tr("Let it {what}?", "what" to (a.what?.label ?: a.permission))
    a.written -> skillTitle(a)
    ToolCard.isTool(a) -> ToolCard.parts(a).title
    a.kind == "skill" -> tr("Install the skill \"{name}\"?", "name" to a.skill?.name.orEmpty())
    else -> a.title.ifBlank { a.line }
}

/** A job's schedule as every screen shows it: the server's words (`when`, docs/api.md), or the app's own for a server that sends none. */
fun scheduleWords(j: Job): String = j.words?.takeIf { it.isNotBlank() } ?: describeCron(j.cron)

private val CUSTOM: String get() = tr("Custom schedule")
// What parts the fields on the server: JavaScript's white space, which is neither Kotlin's trim() nor every regex engine's \s.
private val SPACES = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
private val DAYS: List<String> get() = listOf(tr("Sundays"), tr("Mondays"), tr("Tuesdays"), tr("Wednesdays"), tr("Thursdays"), tr("Fridays"), tr("Saturdays"))
private val MONTHS: List<String> get() = listOf(tr("Jan"), tr("Feb"), tr("Mar"), tr("Apr"), tr("May"), tr("Jun"), tr("Jul"), tr("Aug"), tr("Sep"), tr("Oct"), tr("Nov"), tr("Dec"))
/** A month's short name, January being 0. */
internal fun monthShort(month: Int): String = MONTHS[month]
private val MONTH_DAYS = listOf(31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31) // February in a leap year

/** A field that is one number of `range`, "07" too: null for anything else. */
private fun number(field: String, range: IntRange): Int? =
    field.takeIf { f -> f.all { it in '0'..'9' } }?.toIntOrNull()?.takeIf { it in range }

// The step of a field that is every step-th value ("*/15"), when the steps divide `whole` evenly: null otherwise.
private fun stepOf(field: String, whole: Int): Int? =
    field.takeIf { it.startsWith("*/") }?.let { number(it.drop(2), 2..whole / 2) }?.takeIf { whole % it == 0 }

private fun two(n: Int) = n.toString().padStart(2, '0')

/**
 * The app's own words for a schedule, for a server that sends no `when`: "0 9 * * *" -> "Daily at 09:00". It knows the
 * common shapes and says each as the server does (test/fixtures/cron-words.json, which ScheduleWordsTest holds it to).
 * Any other schedule is "Custom schedule", and text that is not five fields "Invalid schedule": never the expression.
 */
fun describeCron(cron: String): String {
    val f = cron.split(SPACES).filter { it.isNotEmpty() }
    if (f.size != 5) return tr("Invalid schedule")
    val (min, hour, dom, mon, dow) = f
    val everyDay = dom == "*" && mon == "*" && dow == "*"
    if (everyDay && hour == "*") stepOf(min, 60)?.let { return tr("Every {n} min", "n" to it) }
    val m = number(min, 0..59) ?: return CUSTOM
    val atMinute = if (m == 0) "" else ", " + tr("at minute {m}", "m" to m)
    if (everyDay && hour == "*") return tr("Hourly") + atMinute
    if (everyDay) stepOf(hour, 24)?.let { return tr("Every {n} hours", "n" to it) + atMinute }
    val h = number(hour, 0..23) ?: return CUSTOM
    val at = tr("at {time}", "time" to "${two(h)}:${two(m)}")
    val day = number(dom, 1..31)
    val month = number(mon, 1..12)
    val weekday = number(dow, 0..7) // 0 and 7 are Sunday
    return when {
        everyDay -> if (h == 2 && m == 0) tr("Nightly at 02:00") else tr("Daily") + " " + at
        dom == "*" && mon == "*" && dow == "1-5" -> tr("Weekdays") + " " + at
        dom == "*" && mon == "*" && dow == "0,6" -> tr("Weekends") + " " + at
        dom == "*" && mon == "*" && weekday != null -> "${DAYS[weekday % 7]} $at"
        day != null && mon == "*" && dow == "*" -> tr("Monthly on day {day}", "day" to day) + " " + at
        // One day of the year: how a one-time job is kept ("28 Sep at 07:00"). A day no year has never comes.
        day != null && month != null && dow == "*" -> if (day > MONTH_DAYS[month - 1]) tr("Never runs") else "$day ${MONTHS[month - 1]} $at"
        else -> CUSTOM
    }
}

/**
 * The line under the title of an action in a connected app: that [bot] waits for the answer inside its run ([held]),
 * or when it stopped waiting ([stoppedAt], shown with the app's short [time]). null when the server says neither, or a
 * time this app cannot read: the card keeps the line it has today.
 */
fun connectorLine(bot: String, held: Boolean?, stoppedAt: String?, time: (String) -> String): String? = when {
    held == true -> tr("{bot} waits for your answer", "bot" to bot)
    held == false && stoppedAt != null -> time(stoppedAt).ifEmpty { null }?.let { tr("{bot} stopped waiting at {time}", "bot" to bot, "time" to it) }
    else -> null
}

/** What Approve sends to answer a bot's plan for the Chief (the server knows it). */
const val PLAN_APPROVAL = "Approved. Go ahead."

/** Why "Always approve" on a script needs a second thought. */
fun scriptWarningText(name: String) = tr("It's a quick check without AI. It can change anything on botdot's computer, so allow it only if you trust {name}.\n\nYou can take this back in {name}'s settings.", "name" to name)

/** A card asked in a group names its bot and the group after it ("Coder in Dev"); [group] null or blank: the bot alone. */
fun nameInGroup(name: String, group: String?): String = if (group.isNullOrBlank()) name else tr("{name} in {group}", "name" to name, "group" to group)
