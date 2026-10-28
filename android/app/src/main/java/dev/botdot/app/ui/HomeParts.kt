package dev.botdot.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.serialization.json.JsonElement

// The pieces of the home screen that the list's rows and the keypad's keys share (HomeScreen, KeypadView).

/**
 * A big figure on top of the list: the Chief, or a bot you pinned, with its new replies' dots under its head and its
 * name below. One that [asks] the owner something has the mark at its head's corner, and no dots: it has no line to say it in.
 * [picture]: what stands in the head's place (a group's members).
 */
@Composable
internal fun Pin(color: String?, state: String, name: String, modifier: Modifier = Modifier, active: Boolean = false, lifted: Boolean = false, outfit: JsonElement? = null, unread: Int = 0, asks: Boolean = false, picture: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val p = LocalPaper.current
    val lift by animateFloatAsState(if (lifted) 1f else 0f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow), label = "lift")
    val shape = RoundedCornerShape(14.dp)
    val figures = LocalListShows.current == ListWidth.Shows.FIGURES // no room for its name
    Column(
        Modifier.width(if (figures) 64.dp else 74.dp).graphicsLayer { scaleX = 1f + 0.1f * lift; scaleY = scaleX }.clip(shape).background(if (active) p.sunk else Color.Transparent)
            .then(modifier).clickable(onClickLabel = name, onClick = onClick).padding(horizontal = 4.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box {
            if (picture != null) picture() else BotFigure(color, state, 52, outfit)
            if (asks) AsksMark(color, Modifier.align(Alignment.TopEnd))
        }
        // The dots have their room between the head and the name whether there are any, so a new reply moves nothing.
        Box(Modifier.height(9.dp), contentAlignment = Alignment.Center) { if (!asks) UnreadDots(unread, color) }
        if (!figures) Text(name, color = p.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * A row of the list: a bot, or a group. [picture]: what stands in the head's place (a group's members). [who]: the
 * bot named before the line under the name ("Coder: …"), in a group's row.
 */
@Composable
internal fun Contact(color: String?, state: String, name: String, sub: String, time: String = "", modifier: Modifier = Modifier, active: Boolean = false, lifted: Boolean = false, outfit: JsonElement? = null, unread: Int = 0, asks: Boolean = false, who: String = "", picture: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val p = LocalPaper.current
    // Picked up to drag: the row grows a little and floats on a card; its figure pulses once. Let go: it settles back.
    val lift by animateFloatAsState(if (lifted) 1f else 0f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow), label = "lift")
    val pulse = remember { Animatable(1f) }
    LaunchedEffect(lifted) {
        if (lifted) { pulse.animateTo(1.25f, tween(140)); pulse.animateTo(1f, spring(dampingRatio = 0.4f, stiffness = Spring.StiffnessMediumLow)) }
    }
    val shape = RoundedCornerShape(14.dp)
    val shows = LocalListShows.current
    // A list of figures: the figure alone in the middle, the mark at its corner or the dots under it, as a big figure's.
    if (shows == ListWidth.Shows.FIGURES) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp)
                .graphicsLayer { scaleX = 1f + 0.03f * lift; scaleY = scaleX }
                .clip(shape).background(if (active) p.sunk else Color.Transparent)
                .then(modifier).clickable(onClickLabel = name, onClick = onClick).padding(top = 7.dp, bottom = 2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.graphicsLayer { scaleX = pulse.value; scaleY = pulse.value }) {
                if (picture != null) picture() else BotFigure(color, state, 40, outfit)
                if (asks) AsksMark(color, Modifier.align(Alignment.TopEnd))
            }
            Box(Modifier.height(9.dp), contentAlignment = Alignment.Center) { if (!asks) UnreadDots(unread, color) }
        }
        return
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp)
            .graphicsLayer { scaleX = 1f + 0.03f * lift; scaleY = scaleX }
            .then(if (lift > 0.01f) Modifier.shadow(8.dp * lift, shape).background(p.panel.copy(alpha = lift), shape) else Modifier)
            .clip(shape).background(if (active) p.sunk else Color.Transparent)
            .then(modifier).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.graphicsLayer { scaleX = pulse.value; scaleY = pulse.value }) { if (picture != null) picture() else BotFigure(color, state, 40, outfit) }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, color = p.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (time.isNotEmpty() && shows == ListWidth.Shows.ALL) Text(time, color = p.faint, fontSize = 12.sp, maxLines = 1, modifier = Modifier.padding(start = 8.dp))
                // It asks the owner something: the mark, in place of the dots. Else one dot per new reply, after the time.
                if (asks) AsksMark(color, Modifier.padding(start = 8.dp)) else UnreadDots(unread, color, Modifier.padding(start = 8.dp))
            }
            // What it asks stands out from what a bot last said: the list's stronger colour, as on the web page.
            val line = if (who.isEmpty()) androidx.compose.ui.text.AnnotatedString(sub) else buildAnnotatedString {
                withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.Medium)) { append("$who: ") }
                append(sub)
            }
            if (sub.isNotBlank() && shows == ListWidth.Shows.ALL) Text(line, color = if (asks) p.text else if (state == "working") p.okText else p.muted, fontWeight = if (asks) FontWeight.Medium else null,
                fontSize = 13.5.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The mark of a bot that asks the owner something: round, in the bot's colour, holding "?". */
@Composable
internal fun AsksMark(color: String?, modifier: Modifier = Modifier) {
    Box(modifier.size(18.dp).clip(CircleShape).background(parseColor(color, LocalPaper.current.faint)).semantics { contentDescription = tr("Asks you") }, contentAlignment = Alignment.Center) {
        Text("?", color = Color.White, fontSize = 11.sp, lineHeight = 11.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * The Board's strip at the top of the list: each tile's dot and name, and a value's value (a switch's dot is
 * filled when it's on). As many as fit whole, or the first cut short; a tap opens the Board. With no tile to show it says so
 * ("Board · Nothing on it yet"); not there before the Board has loaded.
 */
@Composable
internal fun DashboardStrip(dash: dev.botdot.app.data.Dashboard?, bots: List<Bot>, onClick: () -> Unit) {
    val p = LocalPaper.current
    val tiles = stripTiles(dash) ?: return
    // A list of figures: the Board's mark, four small squares, in place of its tiles.
    if (LocalListShows.current == ListWidth.Shows.FIGURES) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp).clip(RoundedCornerShape(12.dp)).clickable(onClickLabel = BoardWords.NAME, onClick = onClick).padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(2) { Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) { repeat(2) { Box(Modifier.size(7.dp).border(1.5.dp, p.muted, RoundedCornerShape(2.dp))) } } }
            }
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)
        .padding(horizontal = 8.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        if (tiles.isEmpty()) Text(buildAnnotatedString {
            withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.Medium)) { append(BoardWords.NAME) }
            append(" · ${BoardWords.NOTHING}")
        }, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        else FitRow(Modifier.weight(1f), gap = 14.dp) {
            for (t in tiles) {
                val c = parseColor(tileColor(t, dash?.tiles.orEmpty(), bots), p.faint)
                // Its dot and first value as its look has them (a light's own colour, a value's level).
                val look = t.look?.dot
                val dot = tint(look?.color, c)
                val off = look != null && look.filled != true
                val text = t.look?.short.orEmpty()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).then(if (off) Modifier.border(1.5.dp, dot, CircleShape) else Modifier.background(dot)))
                    Spacer(Modifier.size(6.dp))
                    Text(buildAnnotatedString {
                        append(t.title)
                        if (text.isNotEmpty()) withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.Medium)) { append(" $text") }
                    }, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, softWrap = false, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            }
        }
        Spacer(Modifier.size(8.dp))
        Text("›", color = p.faint, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * The Board's numbers over the keys, on the keypad and a phone (#397, #636): each tile's title over its first number
 * ([stripKpi]) with its sparkline or bar where there is room, or its dot (a switch On or Off), with no box around
 * them. Two to four a row, as many rows as it takes: none is cut off. A tap opens the Board; with no tile it says
 * so. Not there before the Board has loaded. A long press chooses its tiles ([onEdit], #447), where the server can.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun BoardCards(dash: dev.botdot.app.data.Dashboard?, bots: List<Bot>, onClick: () -> Unit, onEdit: (() -> Unit)? = null) {
    val p = LocalPaper.current
    val tiles = stripTiles(dash) ?: return
    if (tiles.isEmpty()) {
        Text(buildAnnotatedString {
            withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.Medium)) { append(BoardWords.NAME) }
            append(" · ${BoardWords.NOTHING}")
        }, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, modifier = Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onEdit).padding(horizontal = 20.dp, vertical = 10.dp))
        return
    }
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).testTag(BOARD_CARDS)) {
        val cols = (maxWidth / 160.dp).toInt().coerceIn(2, 4)
        val narrow = cols == 2 // a phone: the numbers alone
        Column {
            for (row in tiles.chunked(cols)) Row(Modifier.fillMaxWidth()) {
                for (t in row) {
                    val c = parseColor(tileColor(t, dash?.tiles.orEmpty(), bots), p.faint)
                    Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).combinedClickable(onClickLabel = BoardWords.NAME, onClick = onClick, onLongClickLabel = if (onEdit != null) HOME_TILES else null, onLongClick = onEdit).padding(horizontal = 8.dp, vertical = 8.dp)) {
                        val kpi = stripKpi(t)
                        if (kpi != null) KitKpi(if (narrow) kpi.copy(points = emptyList(), ratio = null) else kpi, tint(kpi.color, c), compact = true, small = true)
                        else Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(t.title, color = p.muted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val look = t.look?.dot
                            val dot = tint(look?.color, c)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(10.dp).clip(CircleShape).then(if (look != null && look.filled != true) Modifier.border(1.5.dp, dot, CircleShape) else Modifier.background(dot)))
                                if (look?.big == true) Text(if (look.filled == true) tr("On") else if (look.filled == false) tr("Off") else "·", color = p.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp))
                            }
                        }
                    }
                }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** The tag of the Board's numbers over the keys (KeypadUiTest). */
internal const val BOARD_CARDS = "board-cards"
/** What a long press on the strip does, for TalkBack, and the sheet's name (#447). */
internal val HOME_TILES: String get() = tr("Tiles on home")

/**
 * Needs you over the keys (#636): one warm card, a row per thing that waits, its bot's head and what it wants. A
 * permission a bot asks for is all its row says, so the row answers it with No and Allow ([onAnswer]: its id and the
 * answer); a tap on any other row opens Needs you ([onReview]), where its card shows the rest. The first [NEEDS_ROWS]
 * rows, then how many more.
 */
@Composable
internal fun NeedsRows(waiting: List<dev.botdot.app.data.Waiting>, onReview: () -> Unit, onAnswer: (String, Boolean) -> Unit) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(16.dp)
    val chief = chiefNamed()
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(shape).background(p.warnSoft).border(1.dp, p.warn.copy(alpha = 0.25f), shape)) {
        for (w in waiting.take(NEEDS_ROWS)) Row(
            Modifier.fillMaxWidth().then(if (w.permission == null) Modifier.clickable(onClickLabel = tr("Needs you"), onClick = onReview) else Modifier)
                .heightIn(min = 52.dp).padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (w.color == null) BotFigure(chief.color, "idle", 28, chief.outfit) else BotFigure(w.color, "idle", 28, w.outfit)
            Spacer(Modifier.size(10.dp))
            Text(w.text, color = p.text, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            w.permission?.let { id ->
                Spacer(Modifier.size(6.dp))
                Text(tr("No"), color = p.muted, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.clip(RoundedCornerShape(11.dp)).clickable { onAnswer(id, false) }.padding(horizontal = 12.dp, vertical = 9.dp))
                Text(tr("Allow"), color = p.inkText, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.clip(RoundedCornerShape(11.dp)).background(p.ink).clickable { onAnswer(id, true) }.padding(horizontal = 14.dp, vertical = 9.dp))
            }
        }
        if (waiting.size > NEEDS_ROWS) Text(tr("{n} more", "n" to waiting.size - NEEDS_ROWS), color = p.warnText, fontSize = 13.5.sp,
            modifier = Modifier.fillMaxWidth().clickable(onClickLabel = tr("Needs you"), onClick = onReview).padding(horizontal = 14.dp, vertical = 10.dp))
    }
}

/** How many of what waits home's Needs you shows as rows. */
internal const val NEEDS_ROWS = 3

/** "1 needs you", "3 need you": the Needs you card's first line, the web page's words. */
internal fun needsCount(n: Int) = trn(n, "{n} needs you", "{n} need you")

/** Its children in a row, as many as fit whole: the rest are left out, not cut off. When none fits, the first is cut short. */
@Composable
internal fun FitRow(modifier: Modifier, gap: androidx.compose.ui.unit.Dp, content: @Composable () -> Unit) {
    androidx.compose.ui.layout.Layout(content, modifier) { children, constraints ->
        val space = gap.roundToPx()
        val loose = androidx.compose.ui.unit.Constraints()
        val shown = mutableListOf<Pair<androidx.compose.ui.layout.Placeable, Int>>()
        var x = 0
        for (child in children) {
            val it = child.measure(loose)
            val at = if (shown.isEmpty()) 0 else x + space
            if (at + it.width > constraints.maxWidth) break
            shown += it to at
            x = at + it.width
        }
        // Not even the first fits whole (a narrow list, #493): it is cut short rather than the row left blank.
        if (shown.isEmpty()) children.firstOrNull()?.let { shown += it.measure(constraints.copy(minWidth = 0)) to 0 }
        val h = shown.maxOfOrNull { it.first.height } ?: 0
        layout(constraints.maxWidth, h) { for ((it, at) in shown) it.placeRelative(at, (h - it.height) / 2) }
    }
}
