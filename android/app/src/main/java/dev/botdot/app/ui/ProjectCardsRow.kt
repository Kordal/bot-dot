package dev.botdot.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Api
import dev.botdot.app.data.CardBody
import dev.botdot.app.data.CardItem
import dev.botdot.app.data.Company
import dev.botdot.app.data.ProjectCard
import dev.botdot.app.data.ProjectCards
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay

/**
 * The cards made by Claude at the top of a project's floor (#776; web: public/project-cards.js; the rules are
 * [ProjectCards]'s): two to a line, a table, a list, the ask field and the questions over two. A dashed New card turns in
 * place into the ask field; the Chief's questions follow in the same place (dashes for how far, the ask and earlier
 * answers as chips, ready answers and an Other field); while a run builds a card it shows its title, a shimmer, one live
 * line and a bar; a card built a moment ago has a green outline. Each card: refresh, and a menu Change, Refresh, Remove.
 */
@Composable
internal fun ProjectCardsRow(ui: CompanyUi, c: Company) {
    var open by rememberSaveable(c.id) { mutableStateOf<String?>(null) }
    // Words the server refused: back in the ask field when it opens again.
    var refused by rememberSaveable(c.id) { mutableStateOf<String?>(null) }
    // Cards built a moment ago: a green outline for a few seconds.
    val fresh = remember(c.id) { mutableStateListOf<String>() }
    var before by remember(c.id) { mutableStateOf(c.cards) }
    LaunchedEffect(c.cards) {
        val built = ProjectCards.justBuilt(before, c.cards)
        before = c.cards
        if (built.isEmpty()) return@LaunchedEffect
        fresh.addAll(built)
        try { delay(4000) } finally { fresh.removeAll(built) }
    }
    // A card removed meanwhile closes its Change.
    val shown = open?.takeIf { it == ProjectCards.NEW || c.cards.any { k -> k.id == it } }
    fun send(block: suspend (Api) -> Company, done: (Boolean) -> Unit = {}) = ui.call(block, done)
    Column(verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        ProjectCards.lines(ProjectCards.slots(c.cards, shown)).forEach { line ->
            Row(Modifier.fillMaxWidth().then(if (line.size > 1) Modifier.height(IntrinsicSize.Min) else Modifier), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                line.forEach { s ->
                    val m = Modifier.weight(1f).then(if (line.size > 1) Modifier.fillMaxHeight() else Modifier)
                    when (s) {
                        is ProjectCards.Slot.New -> NewCardTile(m) { refused = null; open = ProjectCards.NEW }
                        is ProjectCards.Slot.Ask -> AskCard(m, s.card, refused ?: s.card?.name.orEmpty(), onClose = { open = null }) { text ->
                            val k = s.card
                            open = null
                            send({ if (k == null) it.addCard(text) else it.changeCard(k.id, text) }) { ok -> if (!ok) { refused = text; open = k?.id ?: ProjectCards.NEW } }
                        }
                        is ProjectCards.Slot.Questions -> QuestionsCard(m, s.card,
                            onAnswer = { text -> send({ it.answerCard(s.card.id, text) }) },
                            onClose = { send({ it.cancelCard(s.card.id) }) })
                        is ProjectCards.Slot.Card -> BoardCard(m, s.card, fresh = s.card.id in fresh,
                            onRefresh = { send({ it.refreshCard(s.card.id) }) },
                            onChange = { refused = null; open = s.card.id },
                            onRemove = { send({ it.removeCard(s.card.id) }) })
                    }
                }
                if (line.size == 1 && !line[0].wide) Spacer(Modifier.weight(1f))
            }
        }
    }
    // Back on Close: the ask field closes, nothing is sent.
    BackHandler(enabled = shown != null) { open = null }
}

private fun Modifier.cardBox(p: Paper, outline: Color? = null): Modifier =
    clip(Radius.card).background(p.raise2).then(if (outline != null) Modifier.border(1.dp, outline, Radius.card) else Modifier.border(1.dp, p.line, Radius.card))

@Composable
private fun NewCardTile(modifier: Modifier, onClick: () -> Unit) {
    val p = LocalPaper.current
    Column(modifier.heightIn(min = 148.dp).dashedBox(p.line2).clickable(onClickLabel = tr("New card"), onClick = onClick).padding(Space.s12),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(Icons.Filled.Add, null, tint = p.muted, modifier = Modifier.size(20.dp))
        Text(tr("New card"), color = p.muted, fontSize = Type.s14, modifier = Modifier.padding(top = Space.s8))
    }
}

/** The Chief's head, as the ask field and the questions show it. */
@Composable
private fun ChiefHead(size: Int = 28) {
    val chief = chiefNamed()
    BotFigure(chief.color, "idle", size, chief.outfit)
}

/** A white round arrow that sends; faint while there is nothing to send. */
@Composable
private fun SendArrow(enabled: Boolean, onClick: () -> Unit) {
    val p = LocalPaper.current
    Box(Modifier.size(40.dp).clip(CircleShape).background(if (enabled) p.ink else p.fill).clickable(enabled = enabled, onClickLabel = tr("Send"), onClick = onClick),
        contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.ArrowUpward, tr("Send"), tint = if (enabled) p.inkText else p.faint, modifier = Modifier.size(18.dp))
    }
}

/** The ask field: a new card's, or a card's Change with its title in it. */
@Composable
private fun AskCard(modifier: Modifier, card: ProjectCard?, start: String, onClose: () -> Unit, onGo: (String) -> Unit) {
    val p = LocalPaper.current
    var typed by rememberSaveable(card?.id) { mutableStateOf(start) }
    val requester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { requester.requestFocus() } }
    fun go() { val text = typed.trim(); if (text.isNotEmpty()) onGo(text) }
    Row(modifier.heightIn(min = 148.dp).cardBox(p).padding(Space.s12), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        ChiefHead(32)
        Field(typed, { typed = it.take(200) }, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { go() }),
            modifier = Modifier.weight(1f).focusRequester(requester).semantics { contentDescription = tr("New card") })
        SendArrow(typed.isNotBlank()) { go() }
        CardIcon(Icons.Filled.Close, tr("Close"), onClose)
    }
}

/** The Chief's questions for a card, in its place on the board. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionsCard(modifier: Modifier, k: ProjectCard, onAnswer: (String) -> Unit, onClose: () -> Unit) {
    val p = LocalPaper.current
    val q = k.next
    var other by rememberSaveable(k.id, k.answers.size) { mutableStateOf("") }
    var sent by remember(k.id, k.answers.size) { mutableStateOf(false) }
    fun answer(text: String) { if (!sent && text.isNotBlank()) { sent = true; onAnswer(text.trim()) } }
    Column(modifier.cardBox(p).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ChiefHead()
            Text(k.name, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = Space.s12))
            val dashes = ProjectCards.dashes(k)
            if (dashes.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(Space.s4), modifier = Modifier.padding(end = Space.s8)) {
                dashes.forEach { d -> Box(Modifier.width(18.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(when (d) { "done" -> p.ok; "now" -> p.text; else -> p.line2 })) }
            }
            CardIcon(Icons.Filled.Close, tr("Close"), onClose)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8), itemVerticalAlignment = Alignment.CenterVertically) {
            // The ask is in the head until the Chief names the card: not twice.
            if (k.title.isNotBlank() && k.title != k.ask) SaidChip(k.ask)
            k.answers.forEach { a ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(a.q, color = p.muted, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp).padding(end = Space.s8))
                    SaidChip(a.a)
                }
            }
        }
        if (q == null) Waiting()
        else {
            Text(q.q, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, lineHeight = Type.line24)
            if (q.choices.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                q.choices.forEach { x ->
                    Text(x, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clip(Radius.pill).border(1.dp, p.line2, Radius.pill).clickable(enabled = !sent) { answer(x) }.heightIn(min = 40.dp).padding(horizontal = Space.s16, vertical = Space.s8))
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                Field(other, { other = it.take(120) }, singleLine = true, enabled = !sent, placeholder = { Text(tr("Other")) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { answer(other) }),
                    modifier = Modifier.weight(1f).semantics { contentDescription = tr("Other") })
                SendArrow(other.isNotBlank() && !sent) { answer(other) }
            }
        }
    }
}

/** What the owner said: the ask, an answer. */
@Composable
private fun SaidChip(text: String) {
    val p = LocalPaper.current
    Text(text, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.widthIn(max = 240.dp).clip(Radius.pill).background(p.fill).padding(horizontal = Space.s12, vertical = Space.s4))
}

/** Three dots while the Chief thinks of its questions. */
@Composable
private fun Waiting() {
    val p = LocalPaper.current
    val t by rememberInfiniteTransition(label = "asking").animateFloat(0.3f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "a")
    Row(horizontalArrangement = Arrangement.spacedBy(Space.s4), modifier = Modifier.padding(vertical = Space.s8).semantics { contentDescription = tr("Working") }) {
        repeat(3) { i -> Box(Modifier.size(6.dp).alpha(if (i == 1) 1.3f - t else t).clip(CircleShape).background(p.muted)) }
    }
}

@Composable
private fun CardIcon(icon: ImageVector, label: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Box(Modifier.size(32.dp).clip(CircleShape).clickable(onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = p.faint, modifier = Modifier.size(18.dp))
    }
}

/** A card: its title, refresh and the menu; then what it shows, or while it is built for the first time its shimmer, line and bar. */
@Composable
private fun BoardCard(modifier: Modifier, k: ProjectCard, fresh: Boolean, onRefresh: () -> Unit, onChange: () -> Unit, onRemove: () -> Unit) {
    val p = LocalPaper.current
    var menu by remember(k.id) { mutableStateOf(false) }
    Column(modifier.heightIn(min = 148.dp).cardBox(p, if (fresh) p.ok else null).padding(start = Space.s16, end = Space.s8, top = Space.s8, bottom = Space.s16),
        verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(k.name, color = p.muted, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            val spin by rememberInfiniteTransition(label = "refresh").animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "r")
            Box(Modifier.rotate(if (k.building) spin else 0f)) { CardIcon(Icons.Filled.Refresh, tr("Refresh")) { if (!k.building) onRefresh() } }
            Box {
                CardIcon(Icons.Filled.MoreHoriz, tr("More")) { menu = true }
                DropdownMenu(menu, { menu = false }, containerColor = p.panel) {
                    MenuRow(Icons.Outlined.Edit, tr("Change"), p.text) { menu = false; onChange() }
                    MenuRow(Icons.Filled.Refresh, tr("Refresh"), p.text) { menu = false; if (!k.building) onRefresh() }
                    MenuRow(Icons.Outlined.Delete, tr("Remove"), p.err) { menu = false; onRemove() }
                }
            }
        }
        Column(Modifier.padding(end = Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            val body = k.body
            if (k.building && body == null) Building(k)
            else {
                if (body != null) Body(body)
                if (k.failed) Text(k.error ?: tr("Could not build it"), color = if (body != null) p.faint else p.err, fontSize = Type.s12, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) =
    DropdownMenuItem(text = { Text(label, color = color, fontSize = Type.s14) }, leadingIcon = { Icon(icon, null, tint = color, modifier = Modifier.size(18.dp)) }, onClick = onClick)

/** A card built for the first time: a shimmer, the run's line beside the Chief's head, and a bar. */
@Composable
private fun Building(k: ProjectCard) {
    val p = LocalPaper.current
    val glow by rememberInfiniteTransition(label = "shimmer").animateFloat(0.45f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "g")
    Column(Modifier.alpha(glow), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Box(Modifier.width(56.dp).height(28.dp).clip(Radius.small).background(p.fill))
        Box(Modifier.fillMaxWidth().height(8.dp).clip(Radius.pill).background(p.fill))
        Box(Modifier.fillMaxWidth(0.7f).height(8.dp).clip(Radius.pill).background(p.fill))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        ChiefHead(20)
        Text(ProjectCards.stepText(k.step), color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s8))
    }
    Box(Modifier.fillMaxWidth().height(3.dp).clip(Radius.pill).background(p.line2)) {
        Box(Modifier.fillMaxWidth(ProjectCards.progress(k.steps)).height(3.dp).clip(Radius.pill).background(p.ok))
    }
}

@Composable
private fun toneColor(tone: String?): Color {
    val p = LocalPaper.current
    return when (tone) { "ok" -> p.okText; "bad" -> p.err; "muted" -> p.faint; else -> p.okText }
}

/** What a card shows: the big number and its line, then its spark, bars, list or table. */
@Composable
private fun Body(b: CardBody) {
    val p = LocalPaper.current
    Row(verticalAlignment = Alignment.Bottom) {
        Text(b.value, color = p.text, fontSize = Type.s32, fontWeight = FontWeight.SemiBold, lineHeight = Type.line40, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        b.sub?.let { Text(it, color = toneColor(b.tone ?: "muted"), fontSize = Type.s12, fontFamily = GeistMono, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s8, bottom = 6.dp)) }
    }
    when (b.show) {
        "spark" -> KitSpark(b.points, if (b.tone == "bad") p.err else p.ok, Modifier.fillMaxWidth().height(44.dp))
        "bars" -> Bars(b)
        "list" -> Column { b.list.forEach { Box(Modifier.fillMaxWidth().height(1.dp).background(p.line)); ListLine(it) } }
        "table" -> Column { b.rows.forEach { r ->
            Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
            Row(Modifier.fillMaxWidth().padding(vertical = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                Text(r.label, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(r.value, color = p.text, fontSize = Type.s14, fontWeight = FontWeight.Medium, fontFamily = GeistMono, modifier = Modifier.padding(start = Space.s12))
                Text(r.change.orEmpty(), color = toneColor(r.tone ?: "muted"), fontSize = Type.s12, fontFamily = GeistMono, textAlign = TextAlign.End, modifier = Modifier.width(56.dp))
            }
        } }
    }
}

@Composable
private fun Bars(b: CardBody) {
    val p = LocalPaper.current
    val heights = ProjectCards.barHeights(b.bars)
    Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(Space.s4), verticalAlignment = Alignment.Bottom) {
        b.bars.forEachIndexed { i, bar ->
            Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.fillMaxWidth().fillMaxHeight(heights[i]).clip(RoundedCornerShape(3.dp)).background(if (i == b.bars.lastIndex) p.ok else p.fill))
                }
                Text(bar.label, color = p.faint, fontSize = Type.s12, maxLines = 1, fontFamily = GeistMono, modifier = Modifier.padding(top = Space.s4))
            }
        }
    }
}

/** A line of a list card: its ref, its words, its pill; a link opens in the browser. */
@Composable
private fun ListLine(x: CardItem) {
    val p = LocalPaper.current
    val uri = LocalUriHandler.current
    val url = x.url?.takeIf { it.startsWith("https://") }
    Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).then(if (url != null) Modifier.clickable { runCatching { uri.openUri(url) } } else Modifier).padding(vertical = Space.s4),
        verticalAlignment = Alignment.CenterVertically) {
        x.ref?.let { Text(it, color = p.faint, fontSize = Type.s12, fontFamily = GeistMono, maxLines = 1, modifier = Modifier.padding(end = Space.s8)) }
        Text(x.text, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        x.tag?.let { tag ->
            val (fg, bg) = when (x.level) {
                "ok" -> p.okText to p.okSoft
                "warn" -> p.warnText to p.warnSoft
                "err" -> p.err to p.errSoft
                "plan" -> p.muted to p.sunk
                else -> p.mention to p.mention.copy(alpha = 0.14f)
            }
            Text(tag, color = fg, fontSize = Type.s12, maxLines = 1, modifier = Modifier.padding(start = Space.s8).clip(Radius.pill).background(bg).padding(horizontal = Space.s8, vertical = 2.dp))
        }
    }
}
