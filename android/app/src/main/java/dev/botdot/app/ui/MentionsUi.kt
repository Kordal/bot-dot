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
import androidx.compose.ui.text.input.TextFieldValue
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
    return remember(bots, skills, chat, name, runsSkills) {
        bots?.let {
            Mentions.World(chat, listOf(chiefBot(name)) + it, skills.orEmpty().map { k -> k.name },
                about = skills.orEmpty().associate { k -> k.name to k.description }, runsSkills = runsSkills)
        }
    }
}

/**
 * Your message with its mentions drawn: a bot as its small mark and name, a job or skill tinted. Text that matches
 * nothing stays as typed. For your bubble, drawn in ink; [tint] is the theme's `mention`. Show it with [figureInlines].
 */
fun withMentions(text: String, w: Mentions.World?, tint: Color): AnnotatedString {
    val found = w?.let { Mentions.find(text, it) }.orEmpty()
    if (found.isEmpty()) return AnnotatedString(text)
    return buildAnnotatedString {
        var at = 0
        found.forEach { m ->
            append(text.substring(at, m.start))
            when (m.kind) {
                Mentions.Kind.BOT -> w!!.bot(m.bot).let { b -> bot(b?.name ?: m.text, b?.color, b?.outfit) }
                Mentions.Kind.JOB, Mentions.Kind.SKILL, Mentions.Kind.ALL, Mentions.Kind.COMMAND -> withStyle(SpanStyle(color = tint)) { append(m.text) }
            }
            at = m.end
        }
        append(text.substring(at))
    }
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
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(shape).background(p.panel).border(1.dp, p.line2, shape)) {
        rows.forEach { r ->
            val label = buildAnnotatedString {
                when (r.kind) {
                    Mentions.Kind.BOT, Mentions.Kind.JOB -> w.bot(r.bot).let { b -> bot(r.label, b?.color, b?.outfit) }
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
}
