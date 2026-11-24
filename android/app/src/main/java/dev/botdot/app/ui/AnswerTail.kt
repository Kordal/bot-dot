package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.botdot.app.answerview.ViewForm
import dev.botdot.app.answerview.ViewNode
import dev.botdot.app.answerview.ViewTail
import dev.botdot.app.answerview.number
import dev.botdot.app.answerview.text
import dev.botdot.app.answerview.viewNumber
import dev.botdot.app.data.I18n
import dev.botdot.app.data.locale
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle

/*
 * The long tail of the answer views (#1629, wave 3): tree, calendar, kanban, heatmap, alert, empty state, countdown, poll and
 * quiz, drawn from the same catalog and the same shared cases as the web page (test/fixtures/ui-cases.json). Each is a plain
 * drawing in the Paper's tokens; a bot names a tone, never a colour. A poll's and a quiz's choices are buttons that post their
 * own words, as ADR 265's buttons do (ViewForm.buttons counts them), and nothing here runs, approves or changes anything.
 */

/** What the view being drawn has sent as the owner's message, or null: how a poll and a quiz know their choice went. */
internal val LocalViewSaid = compositionLocalOf<String?> { null }

// ---- tree ----

/** An outline: items in order, each as deep as the shared rule allows, with its note under it. */
@Composable
internal fun ViewTree(n: ViewNode) {
    val p = LocalPaper.current
    val items = n.objects("items")
    val depths = ViewTail.outlineOf(items)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        n.text("title")?.let { Text(it, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
        items.forEachIndexed { i, item ->
            val c = toneColors(item.text("tone"))
            val note = item.text("note")
            val plain = item.text("tone").isNeutralTone()
            Row(
                Modifier.fillMaxWidth().padding(start = (depths[i] * 16).dp).semantics(mergeDescendants = true) { stateDescription = tr("Level {n}", "n" to depths[i] + 1) },
                horizontalArrangement = Arrangement.spacedBy(Space.s8),
            ) {
                Box(Modifier.padding(top = 7.dp).size(6.dp).clip(CircleShape).background(if (plain) p.muted else c.accent))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    Text(item.text("text").orEmpty(), color = if (plain) p.text else c.text, fontSize = Type.s14)
                    note?.let { Text(it, color = p.muted, fontSize = Type.s12) }
                }
            }
        }
    }
}

// ---- calendar ----

private fun monthTitle(m: dev.botdot.app.answerview.ViewMonth): String =
    "${YearMonth.of(m.year, m.month).month.getDisplayName(TextStyle.FULL_STANDALONE, I18n.locale)} ${m.year}"

/** One month as a grid (weeks start on Monday) with a mark on each day that has an event, and the events under it in date order. */
@Composable
internal fun ViewCalendar(n: ViewNode) {
    val p = LocalPaper.current
    val month = ViewTail.month(n.text("month"))
    val events = ViewTail.agenda(n.objects("events"))
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.text("title")?.let { Text(it, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
        if (month != null) {
            Text(monthTitle(month), color = p.muted, fontSize = Type.s14, modifier = Modifier.semantics { heading() })
            Row(Modifier.fillMaxWidth().clearAndSetSemantics { }) {
                (1..7).forEach { d -> Text(java.time.DayOfWeek.of(d).getDisplayName(TextStyle.SHORT, I18n.locale), color = p.faint, fontSize = Type.s12, textAlign = TextAlign.Center, maxLines = 1, modifier = Modifier.weight(1f)) }
            }
            val prefix = "%04d-%02d-".format(month.year, month.month)
            val cells: List<Int?> = List(month.start) { null } + (1..month.days).toList()
            val padded = cells + List((7 - cells.size % 7) % 7) { null }
            padded.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    week.forEach { day ->
                        if (day == null) Spacer(Modifier.weight(1f).heightIn(min = 40.dp).clearAndSetSemantics { })
                        else {
                            val here = events.filter { it.text("date") == prefix + "%02d".format(day) }
                            val c = toneColors(here.firstOrNull()?.text("tone"))
                            val plain = here.firstOrNull()?.text("tone").isNeutralTone()
                            Box(
                                Modifier.weight(1f).heightIn(min = 40.dp).padding(2.dp).clip(Radius.small).background(if (here.isEmpty()) androidx.compose.ui.graphics.Color.Transparent else if (plain) p.fill else c.soft)
                                    .semantics(mergeDescendants = true) { contentDescription = if (here.isEmpty()) "$day" else "$day: " + here.joinToString(", ") { it.text("title").orEmpty() } },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("$day", color = if (here.isEmpty()) p.muted else if (plain) p.text else c.text, fontSize = Type.s14, fontWeight = if (here.isEmpty()) FontWeight.Normal else FontWeight.SemiBold)
                                if (here.isNotEmpty()) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp).size(4.dp).clip(CircleShape).background(if (plain) p.muted else c.accent))
                            }
                        }
                    }
                }
            }
        }
        if (events.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            events.forEach { e ->
                val date = e.text("date").orEmpty()
                val shown = if (ViewTail.realDay(date)) runCatching { LocalDate.parse(date).format(DateTimeFormatter.ofPattern("d MMM", I18n.locale)) }.getOrDefault(date) else date
                val c = toneColors(e.text("tone"))
                Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { }, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                    Text(shown, color = p.muted, fontSize = Type.s14, modifier = Modifier.width(64.dp))
                    Text(e.text("title").orEmpty(), color = if (e.text("tone").isNeutralTone()) p.text else c.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

// ---- kanban ----

/** Columns of cards, side by side where there is room and sideways to scroll on a phone; it only shows them. */
@Composable
internal fun ViewKanban(n: ViewNode) {
    val p = LocalPaper.current
    val columns = n.objects("columns")
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.text("title")?.let { Text(it, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val roomy = maxWidth >= 480.dp
            val box: Modifier = if (roomy) Modifier.fillMaxWidth() else Modifier.horizontalScroll(rememberScrollState())
            Row(box, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                columns.forEach { col ->
                    val cards = (col["cards"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
                    Column(
                        (if (roomy) Modifier.weight(1f) else Modifier.width(220.dp)).clip(Radius.card).background(p.sunk).padding(Space.s8),
                        verticalArrangement = Arrangement.spacedBy(Space.s8),
                    ) {
                        Row(Modifier.semantics(mergeDescendants = true) { heading() }, horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
                            Text(col.text("title").orEmpty(), color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                            Text("${cards.size}", color = p.faint, fontSize = Type.s12)
                        }
                        cards.forEach { card ->
                            val tone = card.text("tone")
                            val c = toneColors(tone)
                            Column(
                                Modifier.fillMaxWidth().let { if (tone.isNeutralTone()) it.raised(Radius.small) else it.clip(Radius.small).background(c.soft) }.padding(Space.s8).semantics(mergeDescendants = true) { },
                                verticalArrangement = Arrangement.spacedBy(Space.s4),
                            ) {
                                Text(card.text("title").orEmpty(), color = if (tone.isNeutralTone()) p.text else c.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                                card.text("text")?.let { Text(it, color = p.muted, fontSize = Type.s12) }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun JsonArray?.orEmpty(): List<kotlinx.serialization.json.JsonElement> = this ?: emptyList()

// ---- heatmap ----

/** A grid of numbers, each cell shaded by its place between the smallest and the biggest and showing its number (shade is never the only way to read it). */
@Composable
internal fun HeatmapGrid(n: ViewNode) {
    val p = LocalPaper.current
    val rows = n.strings("rows")
    val columns = n.strings("columns")
    val values = n.items("values").map { r -> (r as? JsonArray).orEmpty().map { (it as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { x -> !x.isString && x !is kotlinx.serialization.json.JsonNull }?.content?.toDoubleOrNull() } }
    val shades = ViewTail.shade(values)
    Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            Spacer(Modifier.width(72.dp))
            columns.forEach { Text(it, color = p.muted, fontSize = Type.s12, textAlign = TextAlign.Center, maxLines = 1, modifier = Modifier.width(48.dp)) }
        }
        rows.forEachIndexed { i, r ->
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(r, color = p.muted, fontSize = Type.s12, maxLines = 1, modifier = Modifier.width(72.dp).padding(end = Space.s4))
                columns.indices.forEach { j ->
                    val v = values.getOrNull(i)?.getOrNull(j)
                    val shade = shades.getOrNull(i)?.getOrNull(j)
                    if (v == null || shade == null) Box(Modifier.width(48.dp).heightIn(min = 32.dp).clip(Radius.small).background(p.sunk.copy(alpha = 0.5f)))
                    else Box(Modifier.width(48.dp).heightIn(min = 32.dp).clip(Radius.small).background(p.mention.copy(alpha = 0.12f + 0.78f * shade.toFloat())), contentAlignment = Alignment.Center) {
                        Text(viewNumber(v), color = if (shade > 0.55) p.inkText else p.text, fontSize = Type.s12, maxLines = 1)
                    }
                }
            }
        }
    }
}

// ---- alert and empty state ----

/** A short bar with an icon and a word for its tone, so that it is not colour alone. */
@Composable
internal fun ViewAlert(n: ViewNode) {
    val p = LocalPaper.current
    val tone = n.text("tone")?.takeIf { it in listOf("neutral", "good", "warn", "bad", "accent") } ?: "warn"
    val c = toneColors(tone)
    val word = when (tone) { "good" -> tr("Done"); "warn" -> tr("Warning"); "bad" -> tr("Problem"); else -> tr("Note") }
    val icon = when (tone) { "good" -> Icons.Outlined.CheckCircle; "warn" -> Icons.Outlined.Warning; "bad" -> Icons.Outlined.ErrorOutline; else -> Icons.Outlined.Info }
    val plain = tone.isNeutralTone()
    Row(Modifier.fillMaxWidth().clip(Radius.card).background(c.soft).padding(Space.s12).semantics(mergeDescendants = true) { }, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        Icon(icon, contentDescription = null, tint = if (plain) p.muted else c.text, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(word, color = if (plain) p.muted else c.text, fontSize = Type.s12, fontWeight = FontWeight.SemiBold)
            n.text("title")?.let { Text(it, color = if (plain) p.text else c.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold) }
            Text(n.text("text").orEmpty(), color = p.text, fontSize = Type.s14)
        }
    }
}

/** A quiet note for when there is nothing to show yet, with at most two buttons or links for what to do next ([kids] draws them). */
@Composable
internal fun ViewEmptyState(n: ViewNode, kids: @Composable (ViewNode, Int) -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().padding(vertical = Space.s12), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Text(n.text("title").orEmpty(), color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
        n.text("text")?.let { Text(it, color = p.muted, fontSize = Type.s14, textAlign = TextAlign.Center) }
        if (n.children.orEmpty().isNotEmpty()) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            n.children.orEmpty().forEachIndexed { i, c -> kids(c, i) }
        }
    }
}

// ---- countdown ----

/** The device's own zone: its offset in minutes east of UTC at a moment (milliseconds since 1970). */
private fun deviceOffset(at: Long): Int = java.util.TimeZone.getDefault().getOffset(at) / 60_000

/** The time left to a moment, counted here on the device and nowhere else; each second when it is under an hour away, else each quarter minute. */
@Composable
internal fun ViewCountdown(n: ViewNode) {
    val p = LocalPaper.current
    val c = toneColors(n.text("tone"))
    val to = n.text("to").orEmpty()
    val label = n.text("label").orEmpty()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val left = ViewTail.countdown(to, now, offsetAt = ::deviceOffset)
    LaunchedEffect(to) {
        while (true) {
            now = System.currentTimeMillis()
            val ms = ViewTail.countdown(to, now, offsetAt = ::deviceOffset)?.takeIf { !it.over }?.ms ?: break
            delay(if (ms < 3_600_000L) 1000 else 15_000)
        }
    }
    val shown = if (left == null) to else if (left.over) tr("Time is up") else left.shows
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "$label: $shown" }, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(label, color = p.muted, fontSize = Type.s12)
        Text(shown, color = if (n.text("tone").isNeutralTone()) p.text else c.text, fontSize = Type.s24, fontWeight = FontWeight.SemiBold)
    }
}

// ---- poll and quiz ----

/** A question with a button for each choice; a choice posts its own words, and a quiz says after the send whether it was right. */
@Composable
internal fun ViewPoll(n: ViewNode) {
    val p = LocalPaper.current
    val f = LocalForm.current
    val said = LocalViewSaid.current
    val options = n.strings("options")
    val quiz = n.type == "quiz"
    val answer = n.number("answer")?.toInt()
    val verdict = if (quiz && said != null) ViewTail.verdict(options, answer, n.text("explain"), said) else null
    val on = f?.live == true
    Column(Modifier.fillMaxWidth().semantics { contentDescription = n.text("question").orEmpty() }, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Text(n.text("question").orEmpty(), color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        options.forEachIndexed { i, o ->
            val went = said == o
            val right = verdict != null && (verdict.first && went || !verdict.first && answer == i)
            val wrong = verdict != null && !verdict.first && went
            val c = toneColors(if (right) "good" else if (wrong) "bad" else null)
            val mod = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics { selected = went }
            val face: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
                if (right) Icon(Icons.Outlined.CheckCircle, contentDescription = null, modifier = Modifier.padding(end = Space.s8).size(18.dp))
                else if (wrong) Icon(Icons.Outlined.ErrorOutline, contentDescription = null, modifier = Modifier.padding(end = Space.s8).size(18.dp))
                Text(o)
            }
            if (right || wrong) androidx.compose.material3.Button(
                { f?.press?.invoke(ViewForm.press(ViewNode("button", JsonObject(mapOf("label" to kotlinx.serialization.json.JsonPrimitive(o)))))) }, mod, enabled = false,
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(disabledContainerColor = c.soft, disabledContentColor = c.text), elevation = null,
            ) { face() }
            else SecondaryButton({ f?.press?.invoke(ViewForm.press(ViewNode("button", JsonObject(mapOf("label" to kotlinx.serialization.json.JsonPrimitive(o)))))) }, mod, enabled = on) {
                if (went) Icon(Icons.Outlined.CheckCircle, contentDescription = null, modifier = Modifier.padding(end = Space.s8).size(18.dp))
                Text(o)
            }
        }
        if (verdict != null) Text(verdict.second, color = if (verdict.first) p.okText else p.err, fontSize = Type.s14, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}
