package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.navigation.NavController
import dev.botdot.app.data.Bot
import kotlinx.serialization.json.JsonElement

// The keypad drawn (#496): every page one under the other (#516), its name over its bots and groups as keys in rows
// of three, the first nine numbered 1 to 9 across the pages. What a page holds is Keypad.pages; what a key of a
// hardware keyboard does is Keypad.action; where a dragged key lands is Keypad.move (#499).

/** What the keypad shows of the keys of a hardware keyboard, while one is attached. */
internal const val KEYPAD_HINT = "1–9 open · esc chief · ctrl+k search"

/** The last place on the keypad, after the last page: adding a bot starts in the Chief's chat. */
internal const val ASK_FOR_A_BOT = "Ask the Chief for a bot"

/**
 * What a key shows: the head (or a group's [members]), the name and the line the list's row has for it ([who]: the
 * bot named before it in a group's line). [asks]: it asks the owner something, and has the mark in place of the dots.
 */
internal data class KeyLook(
    val name: String, val line: String, val color: String?, val state: String = "idle", val who: String = "",
    val outfit: JsonElement? = null, val unread: Int = 0, val asks: Boolean = false, val members: List<Bot>? = null,
)

/**
 * A key dragged across the keypad (#499): which, how far, and where each key, page heading and the last place stand
 * in the window, to find what it is let go on.
 */
private class KeyDrag {
    var key by mutableStateOf<Keypad.Key?>(null)
    /** How far it was dragged from [start], where the finger took it. */
    var moved by mutableStateOf(Offset.Zero)
    var start = Offset.Zero
    val keys = mutableMapOf<String, Rect>()
    val heads = mutableMapOf<Int, Rect>()
    var lastPlace: Rect? = null // the last place, which asks the Chief for a bot

    /** Where the dragged [key] would land on [pages]: a page's heading, another key, or the last place. */
    fun aim(key: Keypad.Key, pages: List<Keypad.Page>): Aim? {
        val at = start + moved
        heads.entries.firstOrNull { it.key in pages.indices && it.value.contains(at) }?.let { return Aim(it.key, null) }
        pages.forEachIndexed { i, page ->
            val on = page.keys.indexOfFirst { it.id != key.id && keys[it.id]?.contains(at) == true }
            if (on >= 0) return Aim(i, on)
        }
        return if (pages.isNotEmpty() && lastPlace?.contains(at) == true) Aim(pages.lastIndex, pages.last().keys.size) else null
    }
}

/** What a dragged key is over: a page's heading ([at] null), or the place [at] on the page [page]. */
private data class Aim(val page: Int, val at: Int?)

/**
 * The keypad: every page one under the other, under its heading (its name, how many keys, and a dot in the colour of
 * a bot on it that asks), its keys in rows of three, and all of it scrolls. [active]: the key whose chat is open
 * beside it, which stays lit. [hint]: the keys of a hardware keyboard, while one is attached. [onAsk]: the last place,
 * which asks the Chief for a bot. [onMove]: a key pressed and held, then dragged onto another key or onto a page's
 * heading, and the place it is to have there ([Keypad.move]); nothing is called when it would stay where it is.
 * [folded]: the list's folded categories, whose pages show only their heading (#171); [onFold]: a category's heading
 * tapped, to fold or open it.
 */
@Composable
internal fun KeypadView(
    pages: List<Keypad.Page>, active: String?, look: (Keypad.Key) -> KeyLook,
    onKey: (Keypad.Key) -> Unit, onAsk: () -> Unit, modifier: Modifier = Modifier, hint: String? = null,
    onMove: ((Keypad.Key, ListLayout.Place) -> Unit)? = null,
    folded: Set<String> = emptySet(), onFold: ((Keypad.Page) -> Unit)? = null,
) {
    val p = LocalPaper.current
    val drag = remember { KeyDrag() }
    val pagesNow by rememberUpdatedState(pages)
    val move by rememberUpdatedState(onMove)
    val dragged = drag.key
    val aim = dragged?.let { drag.aim(it, pages) }
    // Let go: the place it is dropped on, saved by whoever drew the keypad.
    fun drop() {
        val k = drag.key ?: return
        val on = drag.aim(k, pagesNow)
        drag.key = null
        val place = on?.let { Keypad.move(pagesNow, k, it.page, it.at) } ?: return
        move?.invoke(k, place)
    }
    // Press and hold a key, then drag it: it follows the finger, above the others.
    fun dragging(k: Keypad.Key): Modifier = if (onMove == null) Modifier else Modifier
        .onGloballyPositioned { drag.keys[k.id] = it.boundsInRoot() }
        .pointerInput(k.id) {
            detectDragGesturesAfterLongPress(
                onDragStart = { at -> drag.start = (drag.keys[k.id]?.topLeft ?: Offset.Zero) + at; drag.moved = Offset.Zero; drag.key = k },
                onDrag = { change, amount -> change.consume(); drag.moved += amount },
                onDragEnd = { drop() },
                onDragCancel = { drag.key = null },
            )
        }
        .then(if (dragged?.id == k.id) Modifier.zIndex(1f).graphicsLayer { translationX = drag.moved.x; translationY = drag.moved.y; alpha = 0.6f } else Modifier)
    Column(modifier) {
        if (hint != null) Text(hint, color = p.faint, fontSize = 12.sp, maxLines = 1, modifier = Modifier.align(Alignment.End).padding(start = 16.dp, end = 16.dp, top = 10.dp))
        // While a key is dragged the keys stand still, so the finger moves the key and not the page.
        Keys(Modifier.weight(1f).fillMaxWidth().testTag(KEYPAD_PAGES), scroll = dragged == null) {
            var number = 0
            pages.forEachIndexed { i, page ->
                val aimed = aim == Aim(i, null) // a key dragged over it would go last on this page
                val isFolded = Keypad.isFolded(page, folded)
                item(key = "page:${page.kind}:${page.name}", span = { GridItemSpan(maxLineSpan) }) {
                    DisposableEffect(i) { onDispose { drag.heads.remove(i) } }
                    Column(Modifier.onGloballyPositioned { drag.heads[i] = it.boundsInRoot() }.folding(page, isFolded, onFold).padding(start = 4.dp, top = if (i == 0) 0.dp else 12.dp)) {
                        PageLabel(page, look, if (aimed) p.text else p.faint, isFolded.takeIf { folds(page, onFold) })
                        Spacer(Modifier.height(9.dp))
                        Box(Modifier.height(if (aimed) 2.dp else 1.dp).fillMaxWidth().background(if (aimed) p.text else p.line))
                    }
                }
                if (isFolded) return@forEachIndexed // its keys are not shown, nor counted by the digits
                val first = number
                itemsIndexed(page.keys, key = { _, k -> k.id }) { n, k ->
                    DisposableEffect(k.id) { onDispose { drag.keys.remove(k.id) } }
                    KeyView(first + n + 1, look(k), lit = k.id == active, aimed = aim == Aim(i, n), modifier = dragging(k)) { onKey(k) }
                }
                number += page.keys.size
            }
            // The last place, after the last page's keys; with no bot yet, alone, where the first one is asked for.
            askKey(onAsk, aimed = pages.isNotEmpty() && aim == Aim(pages.lastIndex, pages.last().keys.size),
                modifier = Modifier.onGloballyPositioned { drag.lastPlace = it.boundsInRoot() })
        }
    }
}

/**
 * A page's name and how many keys it has, and a dot in the colour of a bot on it that asks: over its keys on the keypad
 * and on a phone. [folded]: a category's heading that folds (#171), with the list's chevron (null: Pinned, or nothing
 * folds); folded, a green dot also says one of its bots is working, as in the list.
 */
@Composable
private fun PageLabel(page: Keypad.Page, look: (Keypad.Key) -> KeyLook, color: Color, folded: Boolean? = null) {
    val p = LocalPaper.current
    val asks = page.keys.map(look).firstOrNull { it.asks }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (folded != null) Text("▾", color = p.faint, fontSize = 11.sp, modifier = Modifier.padding(end = 6.dp).rotate(if (folded) -90f else 0f))
        Text(page.name.uppercase(), color = color, fontSize = 11.5.sp, fontWeight = FontWeight.Medium, letterSpacing = 1.sp, maxLines = 1)
        Text("${page.keys.size}", color = p.faint, fontSize = 11.5.sp, modifier = Modifier.padding(start = 6.dp))
        if (asks != null) Box(Modifier.padding(start = 6.dp).size(5.dp).clip(CircleShape).background(parseColor(asks.color, p.faint)))
        if (folded == true && page.keys.any { it is Keypad.Key.OfBot && it.bot.running }) Box(Modifier.padding(start = 6.dp).size(6.dp).clip(CircleShape).background(p.ok).testTag(FOLDED_BUSY))
    }
}

/** The tag of the green dot on a folded page's heading while one of its bots works (KeypadUiTest). */
internal const val FOLDED_BUSY = "folded-busy"

/** [page]'s heading folds it: a category's (Other's too) where folding is offered, never Pinned's. */
private fun folds(page: Keypad.Page, onFold: ((Keypad.Page) -> Unit)?) = onFold != null && Keypad.foldName(page) != null

/** A category's heading taps to fold or open its page (#171), as the list's does; Pinned's does not. */
private fun Modifier.folding(page: Keypad.Page, folded: Boolean, onFold: ((Keypad.Page) -> Unit)?): Modifier =
    if (!folds(page, onFold)) this
    else clickable(onClickLabel = if (folded) "Show this category" else "Hide this category") { onFold?.invoke(page) }

/** The tag of the keypad's pages, which scroll (KeypadUiTest). */
internal const val KEYPAD_PAGES = "keypad-pages"

/** Keys in rows of three, under their pages' headings; what does not fit scrolls, unless [scroll] is false. */
@Composable
private fun Keys(modifier: Modifier, scroll: Boolean = true, content: LazyGridScope.() -> Unit) = LazyVerticalGrid(
    columns = GridCells.Fixed(3), modifier = modifier, contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
    userScrollEnabled = scroll, content = content,
)

private val KEY_SHAPE = RoundedCornerShape(20.dp)
private val KEY_HEIGHT = 88.dp

/**
 * A key: its [number] (1 to 9; none past nine), the head, the name and the line the list's row says. [lit]: its chat
 * is the one open beside the keypad. [aimed]: a dragged key is over it, and would take its place.
 */
@Composable
private fun KeyView(number: Int, look: KeyLook, lit: Boolean, modifier: Modifier = Modifier, aimed: Boolean = false, onClick: () -> Unit) {
    val p = LocalPaper.current
    Box(
        modifier.fillMaxWidth().height(KEY_HEIGHT).clip(KEY_SHAPE).background(if (lit) p.sunk else Color.Transparent)
            .border(1.dp, if (aimed) p.text else if (lit || look.members != null) p.line2 else p.line, KEY_SHAPE)
            .semantics { selected = lit }.clickable(onClickLabel = look.name, onClick = onClick).padding(horizontal = 14.dp),
    ) {
        if (number <= 9) Text("$number", color = p.faint, fontSize = 12.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.align(Alignment.TopEnd).padding(top = 10.dp))
        Row(Modifier.align(Alignment.CenterStart).padding(end = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box {
                if (look.members != null) GroupPicture(look.members, 48) else BotFigure(look.color, look.state, 48, look.outfit)
                if (look.asks) AsksMark(look.color, Modifier.align(Alignment.TopEnd))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(look.name, color = p.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (!look.asks) UnreadDots(look.unread, look.color, Modifier.padding(start = 6.dp))
                }
                KeyLine(look, 12.5.sp, maxLines = 2)
            }
        }
    }
}

/** What a key says under its name, as the list's row: what it asks stands out from what it last said. Nothing for no line. */
@Composable
private fun KeyLine(look: KeyLook, fontSize: TextUnit, maxLines: Int, textAlign: TextAlign? = null) {
    if (look.line.isBlank()) return
    val p = LocalPaper.current
    val line = buildAnnotatedString {
        if (look.who.isNotEmpty()) withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.Medium)) { append("${look.who}: ") }
        append(look.line)
    }
    Text(line, color = if (look.asks) p.text else if (look.state == "working") p.okText else p.muted, fontWeight = if (look.asks) FontWeight.Medium else null,
        fontSize = fontSize, lineHeight = 16.sp, maxLines = maxLines, overflow = TextOverflow.Ellipsis, textAlign = textAlign)
}

/**
 * The last place on the keypad: a dashed key that opens a new chat with the Chief, to ask it for a bot. [aimed]: a
 * dragged key is over it, and would go last on the last page.
 */
private fun LazyGridScope.askKey(onAsk: () -> Unit, aimed: Boolean = false, modifier: Modifier = Modifier) = item(key = ASK_FOR_A_BOT) {
    val p = LocalPaper.current
    Box(
        modifier.fillMaxWidth().height(KEY_HEIGHT).clip(KEY_SHAPE)
            .drawBehind {
                val r = 20.dp.toPx()
                drawRoundRect(if (aimed) p.text else p.line2, cornerRadius = CornerRadius(r, r), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx()))))
            }
            .clickable(onClick = onAsk).padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(ASK_FOR_A_BOT, color = p.faint, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
}

/** The Chief's message box at the foot of a phone's home. */
internal const val ASK_THE_CHIEF = "Ask the Chief…"

private val SECTION_KEY_HEIGHT = 108.dp

/**
 * A phone's home (#498): the same pages as the keypad, one under the other, each a section under its name and count
 * (and the dot of a bot on it that asks) with its keys in rows of three and no digits; above them [header] (Needs
 * you, the Board), below them the Chief's message box ([onChief]; [chiefUnread]: its new replies). A key opens its
 * chat ([onKey]) full screen, as a row of the list does, and Back returns here. A phone's keys answer no keyboard.
 * [folded] and [onFold]: a category's page folds as on the keypad (#171).
 */
@Composable
internal fun KeypadSections(
    pages: List<Keypad.Page>, look: (Keypad.Key) -> KeyLook, onKey: (Keypad.Key) -> Unit, onChief: () -> Unit,
    modifier: Modifier = Modifier, chiefUnread: Int = 0, folded: Set<String> = emptySet(), onFold: ((Keypad.Page) -> Unit)? = null,
    header: @Composable () -> Unit = {},
) {
    val p = LocalPaper.current
    Column(modifier) {
        header()
        LazyVerticalGrid(
            GridCells.Fixed(3), Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (page in pages) {
                val isFolded = Keypad.isFolded(page, folded)
                item(key = "page:${page.kind}:${page.name}", span = { GridItemSpan(maxLineSpan) }) {
                    Box(Modifier.folding(page, isFolded, onFold).padding(start = 4.dp, top = 14.dp, bottom = 2.dp)) {
                        PageLabel(page, look, p.faint, isFolded.takeIf { folds(page, onFold) })
                    }
                }
                if (!isFolded) items(page.keys, key = { it.id }) { k -> SectionKey(look(k)) { onKey(k) } }
            }
        }
        val shape = RoundedCornerShape(16.dp)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).clip(shape).border(1.dp, p.line2, shape)
                .clickable(onClickLabel = LocalChiefName.current, onClick = onChief).padding(horizontal = 16.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(ASK_THE_CHIEF, color = p.faint, fontSize = 15.sp, maxLines = 1, modifier = Modifier.weight(1f))
            UnreadDots(chiefUnread, CHIEF_COLOR)
        }
    }
}

/** A key in a phone's section: the head over the name and the list's line, and no digit. */
@Composable
private fun SectionKey(look: KeyLook, onClick: () -> Unit) {
    val p = LocalPaper.current
    Column(
        Modifier.fillMaxWidth().height(SECTION_KEY_HEIGHT).clip(KEY_SHAPE).border(1.dp, if (look.members != null) p.line2 else p.line, KEY_SHAPE)
            .clickable(onClickLabel = look.name, onClick = onClick).padding(horizontal = 6.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box {
            if (look.members != null) GroupPicture(look.members, 40) else BotFigure(look.color, look.state, 40, look.outfit)
            if (look.asks) AsksMark(look.color, Modifier.align(Alignment.TopEnd))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(look.name, color = p.text, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (!look.asks) UnreadDots(look.unread, look.color, Modifier.padding(start = 4.dp))
        }
        KeyLine(look, 11.5.sp, maxLines = 1, textAlign = TextAlign.Center)
    }
}

/** Hands the presses of a hardware keyboard from the activity (MainActivity.dispatchKeyEvent) to the keypad on screen. */
internal class KeyRelay {
    /** The keypad's answer to a press, true when it used it; [typing]: a text field has focus. null: no keypad is on screen. */
    var handler: ((press: Keypad.Press, typing: Boolean) -> Boolean)? = null
}

/**
 * Answers the presses [relay] hands on while this keypad is on screen ([Keypad.action]): a digit opens that key,
 * counted across the pages ([onKey]), Esc opens the Chief's chat ([onChief]), Ctrl+K puts the owner in the search box
 * ([onSearch]). [keysShown]: the keys are on screen, not what the search found. [folded]: the folded categories,
 * whose keys are not on screen, so not counted (#171).
 */
@Composable
internal fun KeypadKeys(relay: KeyRelay?, pages: List<Keypad.Page>, keysShown: Boolean, onKey: (Keypad.Key) -> Unit, onChief: () -> Unit, onSearch: () -> Unit, folded: Set<String> = emptySet()) {
    val now by rememberUpdatedState(pages)
    val foldedNow by rememberUpdatedState(folded)
    val shown by rememberUpdatedState(keysShown)
    val open by rememberUpdatedState(onKey)
    val chief by rememberUpdatedState(onChief)
    val search by rememberUpdatedState(onSearch)
    DisposableEffect(relay) {
        val handler: (Keypad.Press, Boolean) -> Boolean = { press, typing ->
            val keys = if (shown) Keypad.shownKeys(now, foldedNow) else emptyList()
            when (val action = Keypad.action(press, typing, keys.size)) {
                is Keypad.Action.Open -> { open(keys[action.number - 1]); true }
                Keypad.Action.Chief -> { chief(); true }
                Keypad.Action.Search -> { search(); true }
                Keypad.Action.None -> false
            }
        }
        relay?.handler = handler
        onDispose { if (relay != null && relay.handler === handler) relay.handler = null }
    }
}

/**
 * The home of a wide window, left of the chat: the keypad from 840 dp, else the list, which the owner can hide
 * ([listShown]). [home]: what the window's width gives ([Keypad.home]); [window]: that width, in dp. The chat stays
 * in one place whatever stands beside it, so what is typed in it stays when the window is resized.
 */
@Composable
internal fun RowScope.HomePanes(home: Keypad.Home, window: Int, listShown: Boolean, keypad: @Composable (Modifier) -> Unit, list: @Composable () -> Unit, chat: @Composable (Modifier) -> Unit) {
    if (home == Keypad.Home.KEYPAD) {
        keypad(Modifier.weight(1f).fillMaxHeight())
        Box(Modifier.width(1.dp).fillMaxHeight().background(LocalPaper.current.line))
    } else if (home == Keypad.Home.LIST && listShown) list()
    chat(if (home == Keypad.Home.KEYPAD) Modifier.width(Keypad.chatWidth(window).dp).fillMaxHeight() else Modifier.weight(1f).fillMaxHeight())
}

/** Opens a chat beside the list or the keypad: it takes the place of the one open, and Back leads to the Chief's. */
internal fun NavController.openBeside(route: String) = navigate(route) { popUpTo("home"); launchSingleTop = true }
