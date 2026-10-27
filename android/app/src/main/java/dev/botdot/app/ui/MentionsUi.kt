package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.ChiefInfo
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.Mentions

/** What can be mentioned in the chat on screen (null: nothing, or not loaded yet). Read by the composer and your bubbles. */
val LocalMentions = compositionLocalOf<Mentions.World?> { null }

/** The Chief, as a bot that can be mentioned: by the name the owner gave it (ChiefName), as on the botdot server. */
private fun chiefBot(name: String) = Bot(id = ChiefInfo().id, name = name, color = CHIEF_COLOR, outfit = FigureDef.CHIEF)

/** The bots (the Chief too) and skills a chat's mentions are matched against: [Mentions.CHIEF] or the bot's id. */
@Composable
fun rememberMentions(app: BotDotApp, chat: String): Mentions.World? {
    val bots by app.store.bots.value.collectAsState()
    val skills by app.store.skills.value.collectAsState()
    val name by app.store.chiefName.collectAsState()
    val server by app.store.version.value.collectAsState()
    val runsSkills = server?.features?.contains(Mentions.SKILL_COMMANDS) == true // "/" runs a skill (#237)
    val (pages, tiles) = rememberMentionables(app)
    return remember(bots, skills, chat, name, runsSkills, pages, tiles) {
        bots?.let {
            val library = skills?.library.orEmpty()
            val account = skills?.machine.orEmpty()
            Mentions.World(chat, listOf(chiefBot(name)) + it, library.map { k -> k.name },
                about = (account.associate { k -> k.name to k.description } + library.associate { k -> k.name to k.description }),
                runsSkills = runsSkills, account = account.map { k -> k.name }, pages = pages, tiles = tiles)
        }
    }
}

/** Every page of the account and the Board's approved tiles, which a mention can name on a botdot that hands them to the
 *  run (feature `page-mentions`, #473); none without it. Never in a shared room. */
@Composable
fun rememberMentionables(app: BotDotApp): Pair<List<Mentions.PageRef>, List<Mentions.TileRef>> {
    val server by app.store.version.value.collectAsState()
    val pages by app.store.pages.value.collectAsState()
    val board by app.store.dashboard.value.collectAsState()
    val on = server?.features?.contains(Mentions.PAGE_MENTIONS) == true
    return remember(on, pages, board) {
        if (!on) emptyList<Mentions.PageRef>() to emptyList<Mentions.TileRef>()
        else pages.orEmpty().map { Mentions.PageRef(it.botId, it.slug, it.title) } to
            board?.tiles.orEmpty().filter { it.approved }.map { Mentions.TileRef(it.id, it.title, it.kind) }
    }
}

/**
 * Your message with its mentions drawn: a bot as its small mark and name, a job or skill tinted, a file as a chip (#604).
 * Text that matches nothing stays as typed. For your bubble, drawn in ink; [tint] is the theme's `mention`. Show it with
 * [figureInlines] and [fileInlines].
 */
fun withMentions(text: String, w: Mentions.World?, tint: Color): AnnotatedString {
    val mark = w?.let { Mentions.mark(text, it) }
    val found = w?.let { Mentions.find(text, it) }.orEmpty().filter { it.start >= (mark?.end ?: 0) }
    if (found.isEmpty() && mark == null) return AnnotatedString(text)
    return buildAnnotatedString {
        var at = 0
        if (mark != null) {
            append(text.substring(0, mark.start))
            withStyle(commandChip(tint, 0.14f)) { append(mark.text) }
            at = mark.end
        }
        found.forEach { m ->
            append(text.substring(at, m.start))
            when (m.kind) {
                Mentions.Kind.BOT -> w!!.bot(m.bot).let { b -> bot(b?.name ?: m.text, b?.color, b?.outfit) }
                Mentions.Kind.JOB, Mentions.Kind.SKILL, Mentions.Kind.ALL, Mentions.Kind.COMMAND, Mentions.Kind.PAGE, Mentions.Kind.TILE -> withStyle(SpanStyle(color = tint)) { append(m.text) }
                // A file (#604): a chip, which opens it in a bot's own chat.
                Mentions.Kind.FILE -> fileChip(m.file!!, w!!.chat.takeIf { c -> c != Mentions.CHIEF && w.bots.any { it.id == c } }, Color.Black.copy(alpha = 0.08f))
            }
            at = m.end
        }
        append(text.substring(at))
    }
}

/** What a message invokes (a skill it runs, "/btw"): a chip, in [tint] on a wash of it ([wash], its alpha). */
fun commandChip(tint: Color, wash: Float) = SpanStyle(color = tint, background = tint.copy(alpha = wash), fontWeight = FontWeight.SemiBold)

/** The message box with what its message invokes drawn as a chip ([Mentions.mark]); the text itself stays as typed. */
class CommandChips(private val w: Mentions.World?, private val tint: Color) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val m = w?.let { Mentions.mark(text.text, it) }
        val files = Mentions.findFiles(text.text).filter { m == null || it.start >= m.end } // a file mentioned (#604) too
        if (m == null && files.isEmpty()) return TransformedText(text, OffsetMapping.Identity)
        val shown = buildAnnotatedString {
            append(text)
            m?.let { addStyle(SpanStyle(background = tint.copy(alpha = 0.26f)), it.start, it.end) }
            files.forEach { addStyle(SpanStyle(background = tint.copy(alpha = 0.26f)), it.start, it.end) }
        }
        return TransformedText(shown, OffsetMapping.Identity)
    }
    override fun equals(other: Any?) = other is CommandChips && other.w === w && other.tint == tint
    override fun hashCode() = System.identityHashCode(w) * 31 + tint.hashCode()
}

/** [v] with [row] picked (see Mentions.pick), and where the bot it put in (and its new space) ends, or -1. */
fun pickMention(v: TextFieldValue, row: Mentions.Row): Pair<TextFieldValue, Int> {
    val done = Mentions.pick(v.text, v.selection.start, row) ?: return v to -1
    return TextFieldValue(done.text, TextRange(done.cursor)) to (if (done.jobsNext) done.cursor else -1)
}

/**
 * A "/" typed right after a picked bot ([picked]: where the bot and the space the pick added end) goes in place of that
 * space, so the bot's jobs show (as on the web and the Mac): the text for that, or null when [typed] isn't that.
 */
fun slashAfterPick(was: TextFieldValue, typed: TextFieldValue, picked: Int): TextFieldValue? {
    val t = was.text
    if (picked !in 1..t.length || typed.selection != TextRange(picked + 1) || typed.text != t.substring(0, picked) + "/" + t.substring(picked)) return null
    return TextFieldValue(t.substring(0, picked - 1) + "/" + t.substring(picked), TextRange(picked))
}

/** The suggestions while you type a mention: bots and jobs with their bot's small mark, skills by name; a skill to run
 *  ("/" in a bot's chat, #237) with its description after it. Tap one to pick it. */
@Composable
fun MentionList(rows: List<Mentions.Row>, w: Mentions.World, onPick: (Mentions.Row) -> Unit) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(shape).background(p.panel).border(1.dp, p.line2, shape)) { MentionRows(rows, w, onPick) }
}

/** The rows of [MentionList], also under the files found (#604, FileMentionList). */
@Composable
fun MentionRows(rows: List<Mentions.Row>, w: Mentions.World, onPick: (Mentions.Row) -> Unit) {
    val p = LocalPaper.current
    rows.forEach { r ->
        val label = buildAnnotatedString {
            when (r.kind) {
                Mentions.Kind.BOT, Mentions.Kind.JOB -> w.bot(r.bot).let { b -> bot(r.label, b?.color, b?.outfit) }
                // A page (#473): its bot's mark and "Bot · Title", or the title alone when its bot is not in this chat.
                Mentions.Kind.PAGE -> w.bot(r.bot)?.let { b -> bot(r.label, b.color, b.outfit) } ?: append(r.label)
                Mentions.Kind.COMMAND -> {
                    append(r.text)
                    if (r.about.isNotEmpty()) withStyle(SpanStyle(color = p.muted)) { append("  ${r.about}") }
                }
                else -> append(r.label)
            }
        }
        FigureText(label, color = p.text, fontSize = 15.sp, maxLines = 1,
            modifier = Modifier.fillMaxWidth().clickable { onPick(r) }.padding(horizontal = 16.dp, vertical = 11.dp))
    }
}
