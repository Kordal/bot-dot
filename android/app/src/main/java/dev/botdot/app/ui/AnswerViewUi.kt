package dev.botdot.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.PlayCircleOutline
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.material3.Button
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import dev.botdot.app.answerview.ViewForm
import dev.botdot.app.answerview.ViewState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.answerview.AnswerViews
import dev.botdot.app.answerview.ReplyPart
import dev.botdot.app.answerview.ViewNode
import dev.botdot.app.answerview.flag
import dev.botdot.app.answerview.media
import dev.botdot.app.answerview.number
import dev.botdot.app.answerview.text
import dev.botdot.app.answerview.viewNumber
import dev.botdot.app.data.Api
import dev.botdot.app.data.AnswerViewShelf
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.tr
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/*
 * Answer views (#1626, ADR 264): a ```ui fence in a bot's or the Chief's reply, drawn from the tree the shared validator
 * reads (answerview/AnswerView.kt), in the app's own theme. A bot sets no colour, size or style: it names a tone, and
 * this file maps the five tones to the Paper's tokens. Every word of a view is drawn as text. Wave 2 adds inputs and buttons
 * (AnswerInputs.kt, ADR 265): they post the owner's own message and nothing else; nothing a view draws approves, runs or changes anything.
 * Wave 3 (#1629, AnswerTail.kt) adds the long tail: tree, calendar, kanban, heatmap, alert, empty state, countdown, poll and quiz.
 */

/** The catalog of answer views, from a server whose features name `ui-catalog`; null where there is none (a fence is then its code). */
val LocalAnswerViews = compositionLocalOf<AnswerViews?> { null }

/** The answer views of this botdot: asked once for its revision, and only from a server that has them. */
@Composable
fun rememberAnswerViews(features: List<String>?): AnswerViews? {
    val app = BotDotApp.of(LocalContext.current)
    val api by app.api.collectAsState()
    val server by app.store.version.value.collectAsState()
    val on = AnswerViewShelf.shows(features)
    val a = api
    val revision = server?.revision ?: server?.version
    var views by remember(a?.baseUrl, revision, on) { mutableStateOf(if (on) AnswerViewShelf.cached(a?.baseUrl, revision) else null) }
    LaunchedEffect(a?.baseUrl, revision, on) {
        // A catalog that can't be read now is asked again a few times, slower each time, before the fence stays code.
        if (on && views == null && a != null) for (attempt in 0 until 4) {
            views = AnswerViewShelf.load(a, revision)
            if (views != null) break
            kotlinx.coroutines.delay(2_000L * (attempt + 1))
        }
    }
    return if (on) views else null
}

/** A tone's words, and its soft background; a bot never names a colour. */
internal data class ToneColors(val text: Color, val soft: Color, val accent: Color)

@Composable
internal fun toneColors(tone: String?): ToneColors {
    val p = LocalPaper.current
    return when (tone) {
        "good" -> ToneColors(p.okText, p.okSoft, p.ok)
        "warn" -> ToneColors(p.warnText, p.warnSoft, p.warn)
        "bad" -> ToneColors(p.err, p.errSoft, p.err)
        "accent" -> ToneColors(p.mention, p.mention.copy(alpha = 0.14f), p.mention)
        else -> ToneColors(p.text, p.sunk, p.muted)
    }
}

/** A tone a bot did not name, or "neutral": drawn in the Paper's plain colours. */
internal fun String?.isNeutralTone() = this == null || this == "neutral"

private fun gap(g: String?) = when (g) { "s" -> Space.s8; "l" -> Space.s24; else -> Space.s12 }

/** The part of a reply the validator split: a view, the code of a fence that can't be drawn under its `alt`, or "Drawing a view…". */
@Composable
internal fun AnswerPart(part: ReplyPart, color: Color, copy: Boolean, modifier: Modifier = Modifier, at: Int = 0) {
    val p = LocalPaper.current
    when (part) {
        is ReplyPart.View -> AnswerView(part.alt, part.root, modifier, at)
        is ReplyPart.Code -> Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            if (part.alt.isNotEmpty()) Text(part.alt, color = p.muted, fontSize = Type.s14)
            PlainCode(part.code, color, copy)
        }
        ReplyPart.Drawing -> Text(tr("Drawing a view…"), color = p.muted, fontSize = Type.s14, modifier = modifier)
        is ReplyPart.Text -> Unit
    }
}

/**
 * One view: its tree, and under it, for a view with inputs, one Send (#1628, ADR 265). [at]: its place in its reply, which
 * names it with the reply. In a chat that wires its views ([ViewReplyScope]) the newest bot message's inputs and buttons
 * work and post the owner's own message; an older view is read-only and says what was sent, or "Not sent". Anywhere else
 * a view only shows.
 */
@Composable
fun AnswerView(alt: String, root: ViewNode, modifier: Modifier = Modifier, at: Int = 0) {
    val reply = LocalViewReply.current
    val fields = remember(root) { ViewForm.fields(root) }
    val buttons = remember(root) { ViewForm.buttons(root) }
    val acts = fields.isNotEmpty() || buttons.isNotEmpty()
    val viewKey = "${reply?.id.orEmpty()}#$at"
    val values = remember(viewKey) { mutableStateMapOf<String, JsonElement>().apply { putAll(AnswerViewMemory.drafts.of(viewKey)) } }
    val says = remember(buttons) { buttons.map { ViewForm.press(it.node) } }
    val labels = remember(fields) { fields.map { it.node.text("label").orEmpty() } }
    // The chat is the truth: what it shows of the owner's messages first, else what this phone posted that it does not show yet.
    val posted = AnswerViewMemory.pending[viewKey]
    val read = if (reply != null) ViewForm.sendOf(reply.mine, says, labels, posted) else null
    val sent = read?.sent
    // Keyed on the post too: a chat that shows the message before `send` returns leaves `read` the same when the post is stored, and the post must still go.
    LaunchedEffect(viewKey, read, posted) { if (read != null && read.pending == null) AnswerViewMemory.pending.remove(viewKey) } // the chat shows it now: forget the post
    val state = if (reply == null) null else ViewForm.state(reply.newest, sent)
    val sending = AnswerViewMemory.sending[viewKey] == true
    val live = state == ViewState.Open && !sending
    val scope = AnswerViewMemory.scope
    fun post(text: String) {
        if (text.isEmpty() || reply == null || !live || AnswerViewMemory.sending[viewKey] == true) return
        AnswerViewMemory.sending[viewKey] = true // before the tap is over: a second tap finds it
        val key = AnswerViewMemory.drafts.keyFor(viewKey, text) // the same text again is the same message
        scope.launch {
            val went = try { reply.send(text, key) } catch (e: CancellationException) { throw e } catch (e: Exception) { false } finally { AnswerViewMemory.sending.remove(viewKey) }
            if (went) { AnswerViewMemory.drafts.sent(viewKey); AnswerViewMemory.pending[viewKey] = text; values.clear() }
        }
    }
    val form = remember(viewKey, live, values, reply) { FormCtx(viewKey, live, values) { post(it) } }
    CompositionLocalProvider(LocalForm provides form, LocalViewSaid provides (state as? ViewState.Sent)?.said) {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            ViewBlock(root, alt, "0", top = true)
            if (fields.isNotEmpty()) Button({ post(ViewForm.form(root, values)) }, Modifier.heightIn(min = 48.dp), enabled = live) { Text(tr("Send")) }
            if (acts && state != null && state != ViewState.Open) {
                val line = if (state is ViewState.Sent) tr("Sent: {text}", "text" to state.said) else tr("Not sent")
                Text(line, color = LocalPaper.current.muted, fontSize = Type.s14, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        }
    }
}

private val INLINE = setOf("badge", "status")

/** One component, by the tree's own name for it: no code of a component's own is the validator's, only the drawing is here. */
@Composable
internal fun ViewBlock(n: ViewNode, alt: String, path: String, top: Boolean = false) {
    when (n.type) {
        "stack" -> Column(verticalArrangement = Arrangement.spacedBy(gap(n.text("gap")))) { n.children.orEmpty().forEachIndexed { i, c -> ViewBlock(c, alt, "$path.$i") } }
        "row" -> ViewRow(n, alt, path)
        "grid" -> ViewGrid(n.children.orEmpty(), (n.number("columns") ?: 2.0).toInt(), gap(n.text("gap")), alt, path)
        "card" -> {
            val c = toneColors(n.text("tone"))
            val tinted = !n.text("tone").isNeutralTone()
            Column(Modifier.fillMaxWidth().let { if (tinted) it.clip(Radius.card).background(c.soft) else it.raised(Radius.card) }.padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                n.text("title")?.let { Text(it, color = if (tinted) c.text else LocalPaper.current.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
                n.children.orEmpty().forEachIndexed { i, c -> ViewBlock(c, alt, "$path.$i") }
            }
        }
        "section" -> Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                Text(n.text("title").orEmpty(), color = LocalPaper.current.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
                n.text("lead")?.let { Text(it, color = LocalPaper.current.muted, fontSize = Type.s14) }
            }
            n.children.orEmpty().forEachIndexed { i, c -> ViewBlock(c, alt, "$path.$i") }
        }
        "tabs" -> ViewTabs(n, alt, path)
        "accordion" -> Column { n.children.orEmpty().forEachIndexed { i, c -> ViewBlock(c, alt, "$path.$i") } }
        "panel" -> ViewPanel(n, alt, path)
        "divider" -> ViewDivider(n.text("label"))
        "spacer" -> Spacer(Modifier.height(when (n.text("size")) { "s" -> Space.s8; "l" -> Space.s32; else -> Space.s16 }))
        "heading" -> {
            val level = (n.number("level") ?: 2.0).toInt()
            Text(n.text("text").orEmpty(), color = LocalPaper.current.text, fontWeight = FontWeight.SemiBold, fontSize = if (level == 1) Type.s20 else if (level == 2) Type.s16 else Type.s14,
                modifier = Modifier.widthIn(max = Space.answer).semantics { heading() })
        }
        "text" -> Text(n.text("text").orEmpty(), style = MaterialTheme.typography.bodyLarge, color = toneColors(n.text("tone")).text.takeIf { !n.text("tone").isNeutralTone() } ?: LocalPaper.current.text, modifier = Modifier.widthIn(max = Space.answer))
        "list" -> ViewList(n)
        "quote" -> Column(Modifier.padding(start = Space.s12).widthIn(max = Space.answer), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(n.text("text").orEmpty(), style = MaterialTheme.typography.bodyLarge, color = LocalPaper.current.muted)
            n.text("by")?.let { Text(it, color = LocalPaper.current.faint, fontSize = Type.s12) }
        }
        "code" -> Box(Modifier.fillMaxWidth().background(LocalPaper.current.sunk, Radius.small)) {
            Text(n.text("text").orEmpty(), fontFamily = GeistMono, fontSize = Type.s12, color = LocalPaper.current.text, modifier = Modifier.horizontalScroll(rememberScrollState()).padding(Space.s12))
        }
        "badge" -> TonePill(n.text("text").orEmpty(), n.text("tone"), dot = false)
        "status" -> TonePill(n.text("text").orEmpty(), n.text("tone"), dot = true)
        "key-value" -> ViewKeyValue(n)
        "steps" -> ViewSteps(n)
        "hero" -> ViewHero(n)
        "kpi" -> ViewKpi(n)
        "stat-row" -> ViewGrid(n.children.orEmpty(), if (n.children.orEmpty().size <= 2) n.children.orEmpty().size.coerceAtLeast(1) else 2, Space.s16, alt, path, wide = n.children.orEmpty().size.coerceAtLeast(1))
        "progress" -> ViewProgress(n)
        "table" -> ViewTableList(n)
        "timeline" -> ViewTimeline(n)
        "comparison" -> ViewComparison(n)
        "checklist" -> ViewChecklist(n)
        "callout" -> ViewCallout(n)
        "tree" -> ViewTree(n)
        "calendar" -> ViewCalendar(n)
        "kanban" -> ViewKanban(n)
        "alert" -> ViewAlert(n)
        "empty-state" -> ViewEmptyState(n) { c, i -> ViewBlock(c, alt, "$path.$i") }
        "countdown" -> ViewCountdown(n)
        "poll", "quiz" -> ViewPoll(n)
        "chart", "pie", "scatter", "histogram", "sparkline", "gauge", "heatmap" -> ViewChart(n)
        "image" -> ViewImage(n.media("src"), n.text("alt").orEmpty(), n.text("caption"), Modifier.fillMaxWidth(), square = false)
        "gallery" -> ViewGallery(n)
        "video" -> ViewFileRow(n.media("src"), n.text("alt").orEmpty(), n.text("caption"), Icons.Outlined.PlayCircleOutline, tr("Video"))
        "audio" -> ViewFileRow(n.media("src"), n.text("title").orEmpty(), null, Icons.Outlined.AudioFile, tr("Audio"))
        "file" -> ViewFileRow(n.media("src"), n.text("title") ?: n.media("src")?.value?.substringAfterLast('/').orEmpty(), null, Icons.Outlined.Description, tr("File"))
        "link-card" -> ViewLinkCard(n)
        "products" -> ViewProducts(n)
        "text-input", "textarea", "number", "slider", "range", "select", "multi-select", "radio", "checkbox", "toggle", "date", "time", "rating", "segmented" -> ViewInput(n, path)
        "button" -> ViewButton(n)
        "button-group" -> ViewButtons(n) { c, i -> ViewBlock(c, alt, "$path.$i") }
        "link" -> ViewLink(n)
        "copy" -> ViewCopy(n)
        else -> ViewUnknown(alt, top)
    }
}

/** What an app can't draw: one quiet line, and, where it is the whole view, the fence's `alt` under it. */
@Composable
private fun ViewUnknown(alt: String, whole: Boolean) {
    val p = LocalPaper.current
    Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(tr("Can't show this here"), color = p.muted, fontSize = Type.s14)
        if (whole && alt.isNotEmpty()) Text(alt, color = p.faint, fontSize = Type.s12)
    }
}

// ---- layout ----

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ViewRow(n: ViewNode, alt: String, path: String) {
    val kids = n.children.orEmpty()
    if (kids.isNotEmpty() && kids.all { it.type in INLINE }) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) { kids.forEachIndexed { i, c -> ViewBlock(c, alt, "$path.$i") } }
        return
    }
    // Side by side where there is room, one under the other on a phone's width.
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth < 480.dp || kids.isEmpty()) Column(verticalArrangement = Arrangement.spacedBy(gap(n.text("gap")))) { kids.forEachIndexed { i, c -> ViewBlock(c, alt, "$path.$i") } }
        else Row(horizontalArrangement = Arrangement.spacedBy(gap(n.text("gap")))) { kids.forEachIndexed { i, c -> Box(Modifier.weight(1f)) { ViewBlock(c, alt, "$path.$i") } } }
    }
}

/** [columns] equal columns, fewer where a column would be under 140 dp wide; [wide] caps the columns of a roomy screen (a KPI strip). */
@Composable
private fun ViewGrid(kids: List<ViewNode>, columns: Int, space: androidx.compose.ui.unit.Dp, alt: String, path: String, wide: Int = columns) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val fit = ((maxWidth + space) / (140.dp + space)).toInt().coerceAtLeast(1)
        val cols = minOf(maxOf(columns, if (maxWidth >= 480.dp) wide else 1), fit).coerceAtLeast(1)
        Column(verticalArrangement = Arrangement.spacedBy(space)) {
            kids.withIndex().chunked(cols).forEach { rowKids ->
                Row(horizontalArrangement = Arrangement.spacedBy(space)) {
                    rowKids.forEach { (i, c) -> Box(Modifier.weight(1f)) { ViewBlock(c, alt, "$path.$i") } }
                    repeat(cols - rowKids.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun ViewTabs(n: ViewNode, alt: String, path: String) {
    val p = LocalPaper.current
    val tabs = n.children.orEmpty().withIndex().filter { it.value.type == "tab" }
    if (tabs.isEmpty()) return
    var at by remember(n) { mutableStateOf(0) }
    val shown = at.coerceIn(0, tabs.lastIndex)
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
            tabs.forEachIndexed { i, (_, t) ->
                val on = i == shown
                Box(
                    Modifier.heightIn(min = 48.dp).clip(Radius.pill).background(if (on) p.fill else Color.Transparent)
                        .clickable(role = Role.Tab) { at = i }.semantics { selected = on }.padding(horizontal = Space.s16),
                    contentAlignment = Alignment.Center,
                ) { Text(t.text("label").orEmpty(), color = if (on) p.text else p.muted, fontSize = Type.s14, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1) }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Space.s12)) { tabs[shown].let { (at, tab) -> tab.children.orEmpty().forEachIndexed { j, c -> ViewBlock(c, alt, "$path.$at.$j") } } }
    }
}

@Composable
private fun ViewPanel(n: ViewNode, alt: String, path: String) {
    val p = LocalPaper.current
    var open by remember(n) { mutableStateOf(n.flag("open") == true) }
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { open = !open }
                .semantics { stateDescription = if (open) tr("Expanded") else tr("Collapsed") },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8),
        ) {
            Text(n.text("title").orEmpty(), color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null, tint = p.muted, modifier = Modifier.size(20.dp))
        }
        if (open) Column(Modifier.padding(bottom = Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s12)) { n.children.orEmpty().forEachIndexed { i, c -> ViewBlock(c, alt, "$path.$i") } }
        Box(Modifier.fillMaxWidth().height(1.dp).background(p.line2))
    }
}

@Composable
private fun ViewDivider(label: String?) {
    val p = LocalPaper.current
    if (label == null) { Box(Modifier.fillMaxWidth().height(1.dp).background(p.line2)); return }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        Box(Modifier.weight(1f).height(1.dp).background(p.line2))
        Text(label, color = p.faint, fontSize = Type.s12, maxLines = 1)
        Box(Modifier.weight(1f).height(1.dp).background(p.line2))
    }
}

// ---- text ----

@Composable
private fun ViewList(n: ViewNode) {
    val p = LocalPaper.current
    val ordered = n.flag("ordered") == true
    Column(Modifier.widthIn(max = Space.answer), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        n.strings("items").forEachIndexed { i, item ->
            Row {
                Text(if (ordered) "${i + 1}." else "•", color = p.muted, style = MaterialTheme.typography.bodyLarge, maxLines = 1, softWrap = false, modifier = Modifier.widthIn(min = markerWidth(ordered)).padding(end = Space.s4))
                Text(item, color = p.text, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

/** A pill: a tone's word on its soft background; a status has a dot before it, so it isn't colour alone. */
@Composable
private fun TonePill(text: String, tone: String?, dot: Boolean) {
    val c = toneColors(tone)
    Row(Modifier.clip(Radius.pill).background(c.soft).padding(horizontal = Space.s12, vertical = Space.s4), verticalAlignment = Alignment.CenterVertically) {
        if (dot) { Box(Modifier.size(6.dp).clip(CircleShape).background(c.accent)); Spacer(Modifier.width(6.dp)) }
        Text(text, color = if (tone.isNeutralTone()) LocalPaper.current.text else c.text, fontSize = Type.s12, maxLines = 1)
    }
}

@Composable
private fun ViewKeyValue(n: ViewNode) {
    val p = LocalPaper.current
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.text("title")?.let { Text(it, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
        n.objects("items").forEach { item ->
            val key = item.text("key").orEmpty()
            val value = item.text("value").orEmpty()
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { }, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                Text(key, color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(0.4f))
                Text(value, color = p.text, fontSize = Type.s14, modifier = Modifier.weight(0.6f))
            }
        }
    }
}

@Composable
private fun ViewSteps(n: ViewNode) {
    val p = LocalPaper.current
    Column(verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        n.objects("items").forEachIndexed { i, step ->
            val state = step.text("state") ?: "todo"
            val words = when (state) { "done" -> tr("Done"); "current" -> tr("Now"); else -> tr("To do") }
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { stateDescription = words }, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                when (state) {
                    "done" -> Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = p.okText, modifier = Modifier.size(20.dp))
                    "current" -> Box(Modifier.size(20.dp).clip(CircleShape).background(p.mention), contentAlignment = Alignment.Center) { Text("${i + 1}", color = p.bg, fontSize = Type.s12, fontWeight = FontWeight.SemiBold) }
                    else -> Icon(Icons.Outlined.RadioButtonUnchecked, contentDescription = null, tint = p.faint, modifier = Modifier.size(20.dp))
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    Text(step.text("title").orEmpty(), color = if (state == "todo") p.muted else p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                    step.text("text")?.let { Text(it, color = p.muted, fontSize = Type.s14) }
                }
            }
        }
    }
}

// ---- data ----

@Composable
private fun ViewHero(n: ViewNode) {
    val p = LocalPaper.current
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.text("eyebrow")?.let { Text(it, color = p.muted, fontSize = Type.s12) }
        Text(n.text("title").orEmpty(), color = p.text, fontSize = Type.s24, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        n.text("lead")?.let { Text(it, color = p.muted, fontSize = Type.s16, modifier = Modifier.widthIn(max = Space.answer)) }
        val tags = n.strings("tags")
        if (tags.isNotEmpty()) @OptIn(ExperimentalLayoutApi::class) FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) { tags.forEach { TonePill(it, null, dot = false) } }
    }
}

/** A number with its label, its unit and "of N", its change over its recent values, its note and its source. */
@Composable
private fun ViewKpi(n: ViewNode) {
    val p = LocalPaper.current
    val c = toneColors(n.text("tone"))
    val points = n.numbers("points").filterNotNull()
    val label = n.text("label").orEmpty()
    val value = n.text("value").orEmpty()
    val unit = n.text("unit")
    val of = n.text("of")
    val change = if (points.size >= 2) points.last() - points.first() else null
    val dir = change?.let { if (it > 0) "up" else if (it < 0) "down" else "flat" }
    val moved = change?.takeIf { it != 0.0 }?.let { if (it > 0) tr("Up {amount}", "amount" to viewNumber(it)) else tr("Down {amount}", "amount" to viewNumber(kotlin.math.abs(it))) }
    val spoken = listOfNotNull(label, value + (unit?.let { " $it" } ?: ""), moved, of?.let { tr("of {total}", "total" to it) }, n.text("sub"), n.text("source")?.let { tr("Source: {source}", "source" to it) } ?: if (n.noSource) tr("No source") else null).joinToString(", ")
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(label, color = p.muted, fontSize = Type.s12)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            Text(buildAnnotatedString {
                append(value)
                unit?.let { withStyle(SpanStyle(fontSize = Type.s16, fontWeight = FontWeight.Normal, color = p.faint)) { append(" $it") } }
                of?.let { withStyle(SpanStyle(fontSize = Type.s16, fontWeight = FontWeight.Normal, color = p.faint)) { append("  " + tr("of {total}", "total" to it)) } }
            }, color = if (n.text("tone").isNeutralTone()) p.text else c.text, fontSize = Type.s32, lineHeight = Type.s32, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (points.size >= 2) KitSpark(points, if (n.text("tone").isNeutralTone()) p.muted else c.accent, Modifier.width(64.dp).height(28.dp).padding(bottom = Space.s4))
        }
        if (dir != null && dir != "flat") {
            val good = n.text("good")
            Text((if (dir == "up") "▲ " else "▼ ") + viewNumber(kotlin.math.abs(change)), fontSize = Type.s12, color = if (good == null) p.faint else if (good == dir) p.okText else p.err)
        }
        n.text("sub")?.let { Text(it, color = p.muted, fontSize = Type.s12) }
        SourceLine(n)
    }
}

/** Where a chart's, a table's or a KPI's numbers came from, quietly; "No source" where a bot gave none. */
@Composable
internal fun SourceLine(n: ViewNode, modifier: Modifier = Modifier) {
    val text = n.text("source")?.let { tr("Source: {source}", "source" to it) } ?: if (n.noSource) tr("No source") else return
    Text(text, color = LocalPaper.current.faint, fontSize = Type.s12, modifier = modifier)
}

@Composable
private fun ViewProgress(n: ViewNode) {
    val p = LocalPaper.current
    val c = toneColors(n.text("tone"))
    val value = (n.number("value") ?: 0.0).coerceIn(0.0, 100.0)
    val label = n.text("label").orEmpty()
    val shown = n.text("text") ?: "${viewNumber(value)}%"
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "$label, $shown" }, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            Text(label, color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f))
            Text(shown, color = p.muted, fontSize = Type.s12)
        }
        Box(Modifier.fillMaxWidth().height(8.dp).clip(Radius.pill).background(p.sunk)) {
            Box(Modifier.fillMaxWidth((value / 100.0).toFloat()).height(8.dp).clip(Radius.pill).background(c.accent))
        }
    }
}

/** A table on a phone is a list: each row's first cell is its name, the others sit under it with their column's heading. */
@Composable
private fun ViewTableList(n: ViewNode) {
    val p = LocalPaper.current
    val head = n.objects("columns")
    val rows = n.items("rows").map { r -> (r as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.takeIf { c -> c.isString }?.content.orEmpty() } }
    Column(Modifier.fillMaxWidth()) {
        n.text("title")?.let { Text(it, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = Space.s8).semantics { heading() }) }
        rows.forEachIndexed { r, cells ->
            val spoken = cells.mapIndexed { i, c -> (head.getOrNull(i)?.text("label")?.takeIf { it.isNotEmpty() }?.let { "$it: " }.orEmpty()) + c }.joinToString(", ")
            Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }.padding(vertical = Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                cells.forEachIndexed { i, cell ->
                    val title = head.getOrNull(i)?.text("label").orEmpty()
                    if (i == 0) Text(cell, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                    else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                        Text(title, color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(0.4f))
                        Text(cell, color = p.text, fontSize = Type.s14, textAlign = if (head.getOrNull(i)?.text("align") == "right") TextAlign.End else TextAlign.Start, modifier = Modifier.weight(0.6f))
                    }
                }
            }
            if (r < rows.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(p.line2))
        }
        SourceLine(n, Modifier.padding(top = Space.s8))
    }
}

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

@Composable
private fun ViewTimeline(n: ViewNode) {
    val p = LocalPaper.current
    val items = n.objects("items")
    Column {
        items.forEachIndexed { i, e ->
            val c = toneColors(e.text("tone"))
            val when_ = e.text("when")
            val spoken = listOfNotNull(when_, e.text("title"), e.text("text")).joinToString(", ")
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).semantics(mergeDescendants = true) { contentDescription = spoken }, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                Column(Modifier.width(12.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.padding(top = Space.s4).size(8.dp).clip(CircleShape).background(if (e.text("tone").isNeutralTone()) p.muted else c.accent))
                    if (i < items.lastIndex) Box(Modifier.weight(1f).width(1.dp).background(p.line2))
                }
                Column(Modifier.weight(1f).padding(bottom = if (i < items.lastIndex) Space.s12 else 0.dp), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    when_?.let { Text(it, color = p.faint, fontSize = Type.s12) }
                    Text(e.text("title").orEmpty(), color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                    e.text("text")?.let { Text(it, color = p.muted, fontSize = Type.s14) }
                }
            }
        }
    }
}

@Composable
private fun ViewComparison(n: ViewNode) {
    val p = LocalPaper.current
    val options = n.strings("options")
    val pick = n.number("pick")?.toInt()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.text("title")?.let { Text(it, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            options.forEachIndexed { i, o ->
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    Text(o, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                    if (pick == i) Text(tr("Recommended"), color = p.okText, fontSize = Type.s12)
                }
            }
        }
        n.objects("rows").forEach { row ->
            val values = (row["values"] as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.content.orEmpty() }
            val label = row.text("label").orEmpty()
            val spoken = label + ": " + options.mapIndexed { i, o -> "$o ${values.getOrNull(i).orEmpty()}" }.joinToString(", ")
            Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(p.line2))
                Text(label, color = p.muted, fontSize = Type.s12)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                    options.indices.forEach { i -> Text(values.getOrNull(i).orEmpty(), color = p.text, fontSize = Type.s14, modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun ViewChecklist(n: ViewNode) {
    val p = LocalPaper.current
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.text("title")?.let { Text(it, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
        n.objects("items").forEach { item ->
            val done = item.flag("done") == true
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { stateDescription = if (done) tr("Done") else tr("To do") }, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                Icon(if (done) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank, contentDescription = null, tint = if (done) p.okText else p.muted, modifier = Modifier.size(20.dp))
                Text(item.text("text").orEmpty(), color = if (done) p.muted else p.text, fontSize = Type.s14, textDecoration = if (done) TextDecoration.LineThrough else null)
            }
        }
    }
}

@Composable
private fun ViewCallout(n: ViewNode) {
    val p = LocalPaper.current
    val tone = n.text("tone")
    val c = toneColors(tone)
    val icon = when (tone) { "good" -> Icons.Outlined.CheckCircle; "warn" -> Icons.Outlined.Warning; "bad" -> Icons.Outlined.ErrorOutline; else -> Icons.Outlined.Info }
    val plain = tone.isNeutralTone()
    Row(Modifier.fillMaxWidth().clip(Radius.card).background(c.soft).padding(Space.s12), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        Icon(icon, contentDescription = null, tint = if (plain) p.muted else c.text, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            n.text("title")?.let { Text(it, color = if (plain) p.text else c.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold) }
            Text(n.text("text").orEmpty(), color = p.text, fontSize = Type.s14)
        }
    }
}

// ---- media ----

/** An image through botdot, never from the host: an https address as a product photo is (/product-image), a file of the bot's by its path. */
@Composable
internal fun ViewPicture(media: dev.botdot.app.answerview.ViewMedia?, alt: String, modifier: Modifier, scale: ContentScale) {
    val p = LocalPaper.current
    val api by BotDotApp.of(LocalContext.current).api.collectAsState()
    val bot = LocalProductSaver.current
    val a = api
    val src = when {
        media == null || a == null -> null
        media.isFile -> bot?.let { a.url(DocumentView.pathFile(it, media.value)) }
        else -> a.url("/product-image?url=" + Api.enc(media.value))
    }
    var failed by remember(src) { mutableStateOf(false) }
    // The alt is the box's own words, so it is read whether the picture came, failed or was never asked for.
    Box(modifier.clip(Radius.small).background(p.sunk).clearAndSetSemantics { contentDescription = alt }, contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Image, contentDescription = null, tint = p.faint, modifier = Modifier.size(24.dp))
        if (src != null && !failed) coil3.compose.AsyncImage(
            model = src, contentDescription = null, contentScale = scale,
            onState = { if (it is coil3.compose.AsyncImagePainter.State.Error) failed = true },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun ViewImage(media: dev.botdot.app.answerview.ViewMedia?, alt: String, caption: String?, modifier: Modifier, square: Boolean) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        ViewPicture(media, alt, Modifier.fillMaxWidth().aspectRatio(if (square) 1f else 16f / 9f), if (square) ContentScale.Crop else ContentScale.Fit)
        caption?.let { Text(it, color = LocalPaper.current.muted, fontSize = Type.s12) }
    }
}

@Composable
private fun ViewGallery(n: ViewNode) {
    val items = n.objects("items")
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val cols = if (maxWidth >= 480.dp) 3 else 2
        Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            items.chunked(cols).forEach { rowItems ->
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                    rowItems.forEach { item -> ViewImage(item.media("src"), item.text("alt").orEmpty(), item.text("caption"), Modifier.weight(1f), square = true) }
                    repeat(cols - rowItems.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A video, a sound or a file of the bot's: its name, which opens in the viewer where the chat has one. Nothing is embedded or played from outside. */
@Composable
private fun ViewFileRow(media: dev.botdot.app.answerview.ViewMedia?, title: String, caption: String?, icon: androidx.compose.ui.graphics.vector.ImageVector, kind: String) {
    val p = LocalPaper.current
    val paths = LocalPathActions.current
    val path = media?.takeIf { it.isFile }?.value
    val open = if (paths != null && path != null) ({ paths.open(path, path.substringAfterLast('/')) }) else null
    Row(
        Modifier.fillMaxWidth().clip(Radius.small).background(p.sunk).heightIn(min = 48.dp)
            .let { if (open != null) it.clickable(role = Role.Button, onClick = open) else it }
            .semantics(mergeDescendants = true) { contentDescription = "$kind: $title" + (caption?.let { ", $it" } ?: "") }
            .padding(Space.s12),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12),
    ) {
        Icon(icon, contentDescription = null, tint = p.muted, modifier = Modifier.size(24.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(title.ifEmpty { kind }, color = p.text, fontSize = Type.s14, maxLines = 2, overflow = TextOverflow.Ellipsis)
            caption?.let { Text(it, color = p.muted, fontSize = Type.s12) }
        }
        if (open != null) Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, tint = p.faint, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun ViewLinkCard(n: ViewNode) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val url = n.text("url").orEmpty()
    val title = n.text("title").orEmpty()
    val host = url.removePrefix("https://").substringBefore('/').substringBefore('?')
    Row(
        Modifier.fillMaxWidth().raised(Radius.card).heightIn(min = 64.dp)
            .clickable(role = Role.Button) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
            .semantics(mergeDescendants = true) { contentDescription = tr("Open link: {title}, {site}", "title" to title, "site" to host) }
            .padding(Space.s12),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12),
    ) {
        n.media("image")?.let { ViewPicture(it, "", Modifier.size(56.dp), ContentScale.Crop) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(title, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            n.text("text")?.let { Text(it, color = p.muted, fontSize = Type.s14, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Text(host, color = p.faint, fontSize = Type.s12, maxLines = 1)
        }
        Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, tint = p.faint, modifier = Modifier.size(16.dp))
    }
}

/** Shopping results as product cards (ADR 113), from the same cards a `products` fence draws. */
@Composable
private fun ViewProducts(n: ViewNode) {
    val list = n.objects("items").map { o ->
        val price = o.text("price").orEmpty()
        val was = o.text("was").orEmpty()
        val off = Products.off(price, was)
        Product(o.text("name").orEmpty(), o.text("url").orEmpty(), o.text("image").orEmpty(), price, if (off > 0) was else "", off, o.text("store").orEmpty(),
            o.number("rating")?.takeIf { it > 0 && it <= 5 }?.let { Math.round(it * 10) / 10.0 }, o.number("reviews")?.takeIf { it >= 1 }?.toInt(), o.text("arrives").orEmpty(), o.text("why").orEmpty())
    }
    if (list.isNotEmpty()) ProductCards(list)
}
