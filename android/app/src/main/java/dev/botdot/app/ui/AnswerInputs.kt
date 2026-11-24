package dev.botdot.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.botdot.app.answerview.Held
import dev.botdot.app.answerview.ViewBubble
import dev.botdot.app.answerview.ViewDrafts
import dev.botdot.app.answerview.ViewForm
import dev.botdot.app.answerview.ViewNode
import dev.botdot.app.answerview.number
import dev.botdot.app.answerview.text
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.roundToInt

/*
 * The inputs and actions of answer views (#1628, ADR 265), drawn from the same catalog and the same `sends` cases as the web
 * page. A form's Send and a button post one ordinary message of the owner's through the chat's own send, as a quick answer
 * does; a view never approves, runs or changes anything. Inputs work only on the newest bot message of a chat that is whole;
 * an older view is read-only and says "Sent: …" or "Not sent", read from the owner's next message. A room's views, and
 * any a chat does not wire, are read-only. What the owner typed stays until it is sent.
 */

/**
 * One chat's messages as its views read them, and its own send: `(text, key) -> whether it went`, the function a quick answer
 * and a card of questions use, so a busy bot shows the send as waiting.
 */
class ViewChat(private val bubbles: List<ViewBubble>, private val send: suspend (String, String) -> Boolean) {
    private val newest = ViewForm.newest(bubbles)
    /** What the views of the bot message [id] may do. */
    fun reply(id: String) = ViewReply(id, id == newest, ViewForm.ownersAfter(bubbles, id), send)
}

/** One bot message as its views read it: [newest] says it may be answered, [mine] are the owner's messages after it, up to the next bot message. */
class ViewReply(val id: String, val newest: Boolean, val mine: List<String>, val send: suspend (String, String) -> Boolean)

/** The chat a view is in; null where a view only shows (a room, a tile, a document). */
val LocalViewChat = compositionLocalOf<ViewChat?> { null }

/** The bot message a view is in; null where a view only shows. */
val LocalViewReply = compositionLocalOf<ViewReply?> { null }

/** Marks the views drawn inside it as those of the bot message [id] of the chat above. */
@Composable
fun ViewReplyScope(id: String, content: @Composable () -> Unit) {
    val chat = LocalViewChat.current
    val reply = remember(chat, id) { chat?.reply(id) }
    androidx.compose.runtime.CompositionLocalProvider(LocalViewReply provides reply, content = content)
}

/** What views remember for as long as the app runs: what was typed, what this phone posted that its chat may not show yet, and the sends on their way. */
object AnswerViewMemory {
    /** Sends run here, not in a screen's scope: a view that scrolls away while its send is on its way still learns that it went. */
    val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
    val drafts = ViewDrafts()
    /** A post is kept only until the chat shows the message ([ViewForm.sendOf]), so one the owner takes back opens its view again. */
    val pending = mutableStateMapOf<String, String>()
    val sending = mutableStateMapOf<String, Boolean>()
}

/** The form of the view being drawn: what the owner set, whether its inputs are live, and how a button posts. */
internal class FormCtx(val viewKey: String, val live: Boolean, val values: SnapshotStateMap<String, JsonElement>, val press: (String) -> Unit) {
    fun set(path: String, raw: JsonElement) { values[path] = raw; AnswerViewMemory.drafts.put(viewKey, path, raw) }
}

internal val LocalForm = compositionLocalOf<FormCtx?> { null }

// ---- inputs ----

@Composable
private fun Labelled(label: String, shown: String? = null, group: Boolean = false, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        // A control that carries its label for TalkBack hides this line; a group of options reads it first, as a fieldset's legend.
        Row(if (group) Modifier else Modifier.clearAndSetSemantics { }, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            Text(label, color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(1f, fill = false))
            if (shown != null) Text(shown, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
        }
        content()
    }
}

private fun JsonElement.asText() = (this as? JsonPrimitive)?.content.orEmpty()

/** One input of a view, by its type, with its label for TalkBack. */
@Composable
internal fun ViewInput(n: ViewNode, path: String) {
    val f = LocalForm.current
    val p = LocalPaper.current
    val label = n.text("label").orEmpty()
    val raw = f?.values?.get(path)
    val held = ViewForm.start(n, raw)
    val on = f?.live == true
    fun set(e: JsonElement) { f?.set(path, e) }
    val unit = n.text("unit")
    when (n.type) {
        "text-input", "textarea" -> Field(
            (held as Held.Text).v, { set(JsonPrimitive(it.take(if (n.type == "textarea") 2000 else 200))) }, Modifier.fillMaxWidth().semantics { contentDescription = label }, enabled = on,
            label = { Text(label) }, placeholder = n.text("placeholder")?.let { ph -> { Text(ph) } },
            singleLine = n.type == "text-input", minLines = if (n.type == "textarea") 3 else 1, maxLines = if (n.type == "textarea") 8 else 1,
        )
        "number" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            // What is typed stays as typed ("1." on the way to "1.5"); the form reads it as a number.
            Field(raw?.asText() ?: (held as Held.Num).v?.let { viewNumberText(it) }.orEmpty(), { set(JsonPrimitive(it.take(24))) }, Modifier.weight(1f, fill = false).widthIn(max = 240.dp).semantics { contentDescription = label }, enabled = on,
                label = { Text(label) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            if (!unit.isNullOrEmpty()) Text(unit, color = p.muted, fontSize = Type.s14)
        }
        "slider" -> {
            val (lo, hi) = ViewForm.ends(n)
            val v = (held as Held.Num).v ?: lo
            val step = n.number("step")?.takeIf { it > 0 }
            Labelled(label, ViewForm.valueOf(n, raw)) {
                Slider(v.toFloat(), { x -> set(JsonPrimitive(snap(x.toDouble(), lo, hi, step))) }, Modifier.semantics { contentDescription = label; stateDescription = ViewForm.valueOf(n, raw) }, enabled = on,
                    valueRange = lo.toFloat()..hi.toFloat(), steps = stepsOf(lo, hi, step), colors = sliderColors())
            }
        }
        "range" -> {
            val (lo, hi) = ViewForm.ends(n)
            val span = held as Held.Span
            val step = n.number("step")?.takeIf { it > 0 }
            Labelled(label, ViewForm.valueOf(n, raw)) {
                fun pair(a: Double, b: Double) = set(JsonArray(listOf(JsonPrimitive(a), JsonPrimitive(b))))
                val from = tr("{label}, from", "label" to label)
                val to = tr("{label}, to", "label" to label)
                Slider(span.low.toFloat(), { x -> val a = snap(x.toDouble(), lo, hi, step); pair(a, maxOf(a, span.high)) }, Modifier.semantics { contentDescription = from; stateDescription = viewNumberText(span.low) }, enabled = on,
                    valueRange = lo.toFloat()..hi.toFloat(), steps = stepsOf(lo, hi, step), colors = sliderColors())
                Slider(span.high.toFloat(), { x -> val b = snap(x.toDouble(), lo, hi, step); pair(minOf(span.low, b), b) }, Modifier.semantics { contentDescription = to; stateDescription = viewNumberText(span.high) }, enabled = on,
                    valueRange = lo.toFloat()..hi.toFloat(), steps = stepsOf(lo, hi, step), colors = sliderColors())
            }
        }
        "select" -> ViewSelect(n, label, (held as Held.Text).v, on) { set(JsonPrimitive(it)) }
        "multi-select" -> {
            val picked = (held as Held.Picks).v
            Labelled(label, group = true) {
                Column(Modifier.selectableGroup()) {
                    n.strings("options").forEach { o ->
                        val ticked = o in picked
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(ticked, enabled = on, role = Role.Checkbox) { now ->
                            val next = n.strings("options").filter { x -> if (x == o) now else x in picked }
                            set(JsonArray(next.map { JsonPrimitive(it) }))
                        }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                            Checkbox(ticked, null, enabled = on)
                            Text(o, color = if (on) p.text else p.faint, fontSize = Type.s16)
                        }
                    }
                }
            }
        }
        "radio" -> Labelled(label, group = true) {
            val chosen = (held as Held.Text).v
            Column(Modifier.selectableGroup()) {
                n.strings("options").forEach { o ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(o == chosen, enabled = on, role = Role.RadioButton) { set(JsonPrimitive(o)) },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                        RadioButton(o == chosen, null, enabled = on)
                        Text(o, color = if (on) p.text else p.faint, fontSize = Type.s16)
                    }
                }
            }
        }
        "segmented" -> Labelled(label, group = true) {
            val chosen = (held as Held.Text).v
            Row(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
                n.strings("options").forEach { o ->
                    val isOn = o == chosen
                    Box(Modifier.heightIn(min = 48.dp).clip(Radius.pill).background(if (isOn) p.ink else p.fill)
                        .selectable(isOn, enabled = on, role = Role.RadioButton) { set(JsonPrimitive(o)) }.padding(horizontal = Space.s16), contentAlignment = Alignment.Center) {
                        Text(o, color = if (isOn) p.inkText else if (on) p.text else p.faint, fontSize = Type.s14, maxLines = 1)
                    }
                }
            }
        }
        "checkbox", "toggle" -> {
            val flag = (held as Held.Flag).v
            val toggle = n.type == "toggle"
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(flag, enabled = on, role = if (toggle) Role.Switch else Role.Checkbox) { set(JsonPrimitive(it)) },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                if (toggle) Switch(flag, null, enabled = on) else Checkbox(flag, null, enabled = on)
                Text(label, color = if (on) p.text else p.faint, fontSize = Type.s16, modifier = Modifier.weight(1f))
            }
        }
        "date" -> ViewDate(n, label, (held as Held.Text).v, on) { set(JsonPrimitive(it)) }
        "time" -> ViewTime(label, (held as Held.Text).v, on) { set(JsonPrimitive(it)) }
        "rating" -> {
            val grade = (held as Held.Grade).v
            val max = ViewForm.stars(n)
            Labelled(label, group = true) {
                Row(Modifier.selectableGroup()) {
                    for (i in 1..max) {
                        Box(Modifier.size(48.dp).selectable(i == grade, enabled = on, role = Role.RadioButton) { set(JsonPrimitive(i)) }
                            .semantics { contentDescription = tr("{n} of {max}", "n" to i, "max" to max) }, contentAlignment = Alignment.Center) {
                            Icon(if (i <= grade) Icons.Filled.Star else Icons.Outlined.StarBorder, contentDescription = null, tint = if (i <= grade && on) p.warn else p.faint, modifier = Modifier.size(28.dp))
                        }
                    }
                }
            }
        }
    }
}

/** A number as it stands in a box: whole as it is. */
private fun viewNumberText(d: Double) = dev.botdot.app.answerview.viewNumber(d)

/** [v] moved to the nearest step from [lo] (none without a step) and kept between the ends. */
private fun snap(v: Double, lo: Double, hi: Double, step: Double?): Double {
    val x = if (step != null) lo + ((v - lo) / step).roundToInt() * step else v
    return minOf(maxOf(x, lo), hi)
}

/** The stops a slider has between its ends for [step]: none for a smooth one, and none when they would be too many to tell apart. */
private fun stepsOf(lo: Double, hi: Double, step: Double?): Int {
    if (step == null) return 0
    val n = ((hi - lo) / step).roundToInt() - 1
    return if (n in 1..100) n else 0
}

@Composable
private fun sliderColors(): androidx.compose.material3.SliderColors {
    val p = LocalPaper.current
    return SliderDefaults.colors(thumbColor = p.ink, activeTrackColor = p.ink, inactiveTrackColor = p.fill, activeTickColor = p.inkText, inactiveTickColor = p.faint,
        disabledThumbColor = p.faint, disabledActiveTrackColor = p.faint, disabledInactiveTrackColor = p.fill)
}

/** A list that drops down: the option picked, or "Choose". */
@Composable
private fun ViewSelect(n: ViewNode, label: String, chosen: String, on: Boolean, onPick: (String) -> Unit) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(false) }
    Labelled(label) {
        Box {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(Radius.card).background(p.sunk).clickable(enabled = on, role = Role.DropdownList) { open = true }
                .semantics { contentDescription = label; stateDescription = chosen.ifEmpty { tr("Choose") } }.padding(horizontal = Space.s12),
                verticalAlignment = Alignment.CenterVertically) {
                Text(chosen.ifEmpty { tr("Choose") }, color = if (!on) p.faint else if (chosen.isEmpty()) p.muted else p.text, fontSize = Type.s16, modifier = Modifier.weight(1f))
                Text("▾", color = p.muted, fontSize = Type.s14)
            }
            DropdownMenu(open, { open = false }) {
                DropdownMenuItem({ Text(tr("Choose"), color = p.muted) }, { onPick(""); open = false })
                n.strings("options").forEach { o -> DropdownMenuItem({ Text(o, color = p.text) }, { onPick(o); open = false }) }
            }
        }
    }
}

/** A day: the one picked (YYYY-MM-DD) or "Choose", and Android's own date picker, kept between `min` and `max`. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ViewDate(n: ViewNode, label: String, chosen: String, on: Boolean, onPick: (String) -> Unit) {
    val p = LocalPaper.current
    var picking by remember { mutableStateOf(false) }
    Labelled(label) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(Radius.card).background(p.sunk).clickable(enabled = on, role = Role.Button) { picking = true }
            .semantics { contentDescription = label; stateDescription = chosen.ifEmpty { tr("Choose") } }.padding(horizontal = Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Text(chosen.ifEmpty { tr("Choose") }, color = if (!on) p.faint else if (chosen.isEmpty()) p.muted else p.text, fontSize = Type.s16)
        }
    }
    if (picking) {
        fun day(s: String?) = s?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        fun ms(d: LocalDate) = d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val lo = day(n.text("min"))
        val hi = day(n.text("max"))
        val state = rememberDatePickerState(initialSelectedDateMillis = ms(day(chosen.ifEmpty { null }) ?: LocalDate.now()), selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = (lo == null || utcTimeMillis >= ms(lo)) && (hi == null || utcTimeMillis <= ms(hi))
        })
        DatePickerDialog(onDismissRequest = { picking = false },
            confirmButton = { TextButton({ state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }; picking = false }) { Text(tr("Save")) } },
            dismissButton = { TextButton({ picking = false }) { Text(tr("Cancel")) } }) { DatePicker(state) }
    }
}

/** A time of day: the one picked (HH:MM) or "Choose", and Android's own time picker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ViewTime(label: String, chosen: String, on: Boolean, onPick: (String) -> Unit) {
    val p = LocalPaper.current
    var picking by remember { mutableStateOf(false) }
    Labelled(label) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(Radius.card).background(p.sunk).clickable(enabled = on, role = Role.Button) { picking = true }
            .semantics { contentDescription = label; stateDescription = chosen.ifEmpty { tr("Choose") } }.padding(horizontal = Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Text(chosen.ifEmpty { tr("Choose") }, color = if (!on) p.faint else if (chosen.isEmpty()) p.muted else p.text, fontSize = Type.s16)
        }
    }
    if (picking) {
        val state = rememberTimePickerState(chosen.take(2).toIntOrNull() ?: 12, chosen.drop(3).toIntOrNull() ?: 0, is24Hour = true)
        androidx.compose.material3.AlertDialog(onDismissRequest = { picking = false }, text = { TimePicker(state) },
            confirmButton = { TextButton({ onPick("%02d:%02d".format(state.hour, state.minute)); picking = false }) { Text(tr("Save")) } },
            dismissButton = { TextButton({ picking = false }) { Text(tr("Cancel")) } })
    }
}

// ---- actions ----

/** A button: it posts its `send` text (or its label) as the owner's message, and does nothing else. */
@Composable
internal fun ViewButton(n: ViewNode) {
    val f = LocalForm.current
    val p = LocalPaper.current
    val label = n.text("label").orEmpty()
    val say = ViewForm.press(n)
    val on = f?.live == true
    val tone = n.text("tone")
    // What it posts, when that is more than its label, is written under the label: the owner sees exactly what is sent, and TalkBack reads it too.
    val shown = ViewForm.shows(n)
    val mod = Modifier.heightIn(min = 48.dp)
    val face: @Composable () -> Unit = {
        if (shown.isEmpty()) Text(label)
        else Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label)
            Text(tr("Sends: {text}", "text" to shown), fontSize = Type.s12)
        }
    }
    if (tone.isNeutralTone()) SecondaryButton({ f?.press?.invoke(say) }, mod, enabled = on) { face() }
    else if (tone == "accent") Button({ f?.press?.invoke(say) }, mod, enabled = on) { face() }
    else {
        val c = toneColors(tone)
        Button({ f?.press?.invoke(say) }, mod, enabled = on, colors = ButtonDefaults.buttonColors(containerColor = c.soft, contentColor = c.text, disabledContainerColor = c.soft.copy(alpha = 0.5f), disabledContentColor = p.faint),
            border = BorderStroke(1.dp, c.accent.copy(alpha = if (on) 0.6f else 0.3f)), elevation = null) { face() }
    }
}

/** A link: it opens an https address in the browser, and works in an older view too. */
@Composable
internal fun ViewLink(n: ViewNode) {
    val context = LocalContext.current
    val label = n.text("label").orEmpty()
    val url = n.text("url").orEmpty()
    if (!url.startsWith("https://")) return
    SecondaryButton({ runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }, Modifier.heightIn(min = 48.dp).semantics { contentDescription = tr("{label}, opens in the browser", "label" to label) }) {
        Text(label)
        Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.padding(start = Space.s8).size(16.dp))
    }
}

/** Copy: its text goes to the owner's clipboard on their tap, and nothing is sent. It works in an older view too. */
@Composable
internal fun ViewCopy(n: ViewNode) {
    val context = LocalContext.current
    val label = n.text("label").orEmpty()
    var done by remember { mutableStateOf(false) }
    LaunchedEffect(done) { if (done) { delay(1500); done = false } }
    SecondaryButton({ copyToClipboard(context, n.text("text").orEmpty()); done = true }, Modifier.heightIn(min = 48.dp)) { Text(if (done) tr("Copied") else label) }
}

/** Buttons side by side. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ViewButtons(n: ViewNode, content: @Composable (ViewNode, Int) -> Unit) {
    FlowRow(Modifier.fillMaxWidth().semantics { n.text("label")?.let { contentDescription = it } }, horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.children.orEmpty().forEachIndexed { i, c -> content(c, i) }
    }
}
