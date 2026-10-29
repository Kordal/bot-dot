package dev.botdot.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import dev.botdot.app.data.FigureDef
import androidx.navigation.NavController
import dev.botdot.app.data.Bot
import dev.botdot.app.data.tr
import kotlinx.serialization.json.JsonElement

// The keypad drawn (#496, quiet keys #636): every page one under the other (#516). A key is a head and a name, with
// no frame: one dot on the head says its state, and a line under the name only while it works. The pinned keys are
// the first row, without a heading; the categories flow side by side, each its name over its keys. The digits 1 to 9
// are Keypad.digits (#366); what a key of a hardware keyboard does is Keypad.action; where a dragged key lands is
// Keypad.move (#499).

/** The last place on the keypad, after the last page: adding a bot starts in the Chief's chat. */
internal const val ASK_FOR_A_BOT = "Ask the Chief for a bot"

/**
 * What a key shows: the head (or a group's [members]) and the name; [line]: what the list's row has for it, shown
 * under the name only while it works ([who]: the bot named before it in a group's line). [asks]: it asks the owner
 * something. [status]: its state ([Keypad.status], #397), said by one dot on the head; [time]: when it last did
 * something, or how long it has been working, read by TalkBack.
 */
internal data class KeyLook(
    val name: String, val line: String, val color: String?, val state: String = "idle", val who: String = "",
    val outfit: JsonElement? = null, val unread: Int = 0, val asks: Boolean = false, val members: List<Bot>? = null,
    val status: Keypad.Status = Keypad.status(), val time: String = "",
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

/** How big the keys are: on the keypad, or in a phone's sections. */
private data class KeySize(val width: Dp, val head: Int, val name: TextUnit)

private val WIDE_KEY = KeySize(132.dp, 52, Type.s14)
private val PHONE_KEY = KeySize(80.dp, 40, Type.s12)

/**
 * The keypad: every page, the pinned keys first and the categories after them side by side, and all of it scrolls.
 * [active]: the key whose chat is open beside it, which stays lit. [digitsShown]: a hardware keyboard is attached, and
 * each key shows its digit. [onAsk]: the last place, which asks the Chief for a bot. [onMove]: a key pressed and held,
 * then dragged onto another key or onto a page's heading, and the place it is to have there ([Keypad.move]); nothing
 * is called when it would stay where it is. [folded]: the list's folded categories, whose pages show only their
 * heading (#171); [onFold]: a category's heading tapped, to fold or open it.
 */
@Composable
internal fun KeypadView(
    pages: List<Keypad.Page>, active: String?, look: (Keypad.Key) -> KeyLook,
    onKey: (Keypad.Key) -> Unit, onAsk: () -> Unit, modifier: Modifier = Modifier, digitsShown: Boolean = false,
    onMove: ((Keypad.Key, ListLayout.Place) -> Unit)? = null,
    folded: Set<String> = emptySet(), onFold: ((Keypad.Page) -> Unit)? = null,
) {
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
    val digits = Keypad.digits(pages, Keypad.shownKeys(pages, folded))
    // While a key is dragged the keys stand still, so the finger moves the key and not the page.
    Column(modifier.fillMaxWidth().testTag(KEYPAD_PAGES).verticalScroll(rememberScrollState(), enabled = dragged == null).padding(horizontal = Space.s16, vertical = Space.s12)) {
        KeyPages(pages, folded, onFold,
            heading = { i -> Modifier.onGloballyPositioned { drag.heads[i] = it.boundsInRoot() } },
            headingLit = { i -> aim == Aim(i, null) },
            onHeadingGone = { i -> drag.heads.remove(i) },
        ) { i, n, k ->
            DisposableEffect(k.id) { onDispose { drag.keys.remove(k.id) } }
            QuietKey(look(k), WIDE_KEY, lit = k.id == active, aimed = aim == Aim(i, n), number = if (digitsShown) Keypad.digitOf(digits, k) else 0, modifier = dragging(k)) { onKey(k) }
        }
        // The last place, after the last page's keys; with no bot yet, alone, where the first one is asked for.
        AskKey(onAsk, aimed = pages.isNotEmpty() && aim == Aim(pages.lastIndex, pages.last().keys.size),
            modifier = Modifier.padding(top = Space.s12).onGloballyPositioned { drag.lastPlace = it.boundsInRoot() })
    }
}

/**
 * [pages] as quiet keys: the pinned page's keys in the first row with no heading, then each other page, its name over
 * its keys, side by side as they fit. [heading]: what a page's heading carries (where it stands, for a drag);
 * [headingLit]: a dragged key is over it. [key]: draws the key [k], the [n]th of the page [i].
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KeyPages(
    pages: List<Keypad.Page>, folded: Set<String>, onFold: ((Keypad.Page) -> Unit)?,
    heading: (Int) -> Modifier = { Modifier }, headingLit: (Int) -> Boolean = { false }, onHeadingGone: (Int) -> Unit = {},
    key: @Composable (i: Int, n: Int, k: Keypad.Key) -> Unit,
) {
    val p = LocalPaper.current
    @Composable
    fun Keys(i: Int, page: Keypad.Page) = FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s4), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        page.keys.forEachIndexed { n, k -> androidx.compose.runtime.key(k.id) { key(i, n, k) } }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        pages.forEachIndexed { i, page -> if (page.kind == Keypad.Kind.PINNED) Keys(i, page) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
            pages.forEachIndexed { i, page ->
                if (page.kind == Keypad.Kind.PINNED) return@forEachIndexed
                val isFolded = Keypad.isFolded(page, folded)
                androidx.compose.runtime.key("page:${page.kind}:${page.name}") {
                    Column {
                        DisposableEffect(i) { onDispose { onHeadingGone(i) } }
                        Box(heading(i).folding(page, isFolded, onFold).padding(start = Space.s4, end = Space.s4, bottom = Space.s4)) {
                            PageLabel(page, if (headingLit(i)) p.text else p.muted, isFolded.takeIf { folds(page, onFold) })
                        }
                        if (!isFolded) Keys(i, page)
                    }
                }
            }
        }
    }
}

/**
 * A page's name over its keys, on the keypad and on a phone. [folded]: a category's heading that folds (#171), null
 * where nothing folds; folded, it has a chevron, and a green dot when one of its bots is working.
 */
@Composable
private fun PageLabel(page: Keypad.Page, color: Color, folded: Boolean? = null) {
    val p = LocalPaper.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (folded == true) Text("▾", color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(end = Space.s8).rotate(-90f))
        Text(page.name, color = color, fontSize = Type.s12, maxLines = 1)
        if (folded == true && page.keys.any { it is Keypad.Key.OfBot && it.bot.running }) Box(Modifier.padding(start = Space.s8).size(6.dp).clip(CircleShape).background(p.ok).testTag(FOLDED_BUSY))
    }
}

/** The tag of the green dot on a folded page's heading while one of its bots works (KeypadUiTest). */
internal const val FOLDED_BUSY = "folded-busy"

/** [page]'s heading folds it: a category's (Other's too) where folding is offered, never Pinned's. */
private fun folds(page: Keypad.Page, onFold: ((Keypad.Page) -> Unit)?) = onFold != null && Keypad.foldName(page) != null

/** A category's heading taps to fold or open its page (#171), as the list's does; Pinned's does not. */
private fun Modifier.folding(page: Keypad.Page, folded: Boolean, onFold: ((Keypad.Page) -> Unit)?): Modifier =
    if (!folds(page, onFold)) this
    else clickable(onClickLabel = if (folded) tr("Show this category") else tr("Hide this category")) { onFold?.invoke(page) }

/** The tag of the keypad's pages, which scroll (KeypadUiTest). */
internal const val KEYPAD_PAGES = "keypad-pages"

private val KEY_SHAPE = Radius.card

/**
 * A quiet key (#636): the head, the name under it, and under that its status line (#664), on a light ground. No frame. [number]: its digit (1 to 9), shown while a hardware keyboard is attached; 0: none.
 * [lit]: its chat is the one open beside the keypad. [aimed]: a dragged key is over it, and would take its place.
 */
@Composable
private fun QuietKey(look: KeyLook, size: KeySize, modifier: Modifier = Modifier, lit: Boolean = false, aimed: Boolean = false, number: Int = 0, onClick: () -> Unit) {
    val p = LocalPaper.current
    val pop = donePop(look.status.kind)
    val live = look.status.kind == Keypad.StatusKind.WORKING
    val ground by animateColorAsState(if (lit) p.raise2 else if (live) p.panel else Color.Transparent, Motion.enter(), label = "key ground")
    Box(
        modifier.width(size.width).graphicsLayer { scaleX = pop; scaleY = pop }.then(if (lit) Modifier.raised(KEY_SHAPE, ground) else Modifier.clip(KEY_SHAPE).background(ground))
            .then(if (aimed) Modifier.border(1.dp, p.text, KEY_SHAPE) else Modifier)
            .semantics { selected = lit }.clickable(onClickLabel = look.name, onClick = onClick).padding(horizontal = Space.s8, vertical = Space.s12),
    ) {
        if (number in 1..9) Text("$number", color = p.faint, fontSize = Type.s12, fontFamily = FontFamily.Monospace, modifier = Modifier.align(Alignment.TopEnd))
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            KeyHead(look, size.head)
            Spacer(Modifier.height(Space.s8))
            Text(look.name, color = p.text, fontSize = size.name, fontWeight = FontWeight.Medium, lineHeight = size.name * 1.25f, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            KeyState(look)
        }
    }
}

/** The tag of a key's status line (KeypadUiTest). */
internal const val KEY_STATE = "key-state"

/** The head on a key, or a group's heads. */
@Composable
private fun KeyHead(look: KeyLook, size: Int) {
    if (look.members != null) GroupPicture(look.members, size) else BotFigure(look.color, look.state, size, look.outfit)
}

/**
 * A key's status line under its name (#664): a dot and the status's words in the state's colour: green while it works,
 * where the words are what it does now (and which member, for a group), amber while it needs the owner, blue with its
 * unread replies, red when its last run did not finish, muted when done (a green dot) or idle. TalkBack reads the
 * status's words and its time.
 */
@Composable
private fun KeyState(look: KeyLook) {
    val p = LocalPaper.current
    val kind = look.status.kind
    val (words, dot) = when (kind) {
        Keypad.StatusKind.WORKING -> p.okText to p.ok
        Keypad.StatusKind.NEEDS -> p.warnText to p.warn
        Keypad.StatusKind.UNREAD -> p.mention to p.mention
        Keypad.StatusKind.FAILED -> p.err to p.err
        Keypad.StatusKind.DONE -> p.muted to p.ok
        Keypad.StatusKind.IDLE -> p.faint to p.line2
    }
    val live = kind == Keypad.StatusKind.WORKING && look.line.isNotBlank()
    val text = if (!live) look.status.text else if (look.who.isNotEmpty()) "${look.who}: ${look.line}" else look.line
    val said = listOf(look.status.text, look.time).filter { it.isNotEmpty() }.joinToString(", ")
    Row(Modifier.padding(top = Space.s4).testTag(KEY_STATE).semantics(mergeDescendants = true) { contentDescription = if (live) "$said: $text" else said },
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
        Spacer(Modifier.width(Space.s8))
        Text(text, color = words, fontSize = Type.s12, lineHeight = Type.line16, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A key's scale: 1, and once when its bot goes from Working to Done, up to 1.03 and back (#496). */
@Composable
private fun donePop(kind: Keypad.StatusKind): Float {
    val scale = remember { Animatable(1f) }
    var was by remember { mutableStateOf(kind) }
    LaunchedEffect(kind) {
        val done = was == Keypad.StatusKind.WORKING && kind == Keypad.StatusKind.DONE
        was = kind
        if (done) { scale.animateTo(1.03f, Motion.enter(Motion.FAST)); scale.animateTo(1f, Motion.exit()) }
    }
    return scale.value
}

/**
 * The last place on the keypad: a dashed head that opens a new chat with the Chief, to ask it for a bot. [aimed]: a
 * dragged key is over it, and would go last on the last page.
 */
@Composable
private fun AskKey(onAsk: () -> Unit, modifier: Modifier = Modifier, aimed: Boolean = false) {
    val p = LocalPaper.current
    val size = WIDE_KEY
    Column(modifier.width(size.width).clip(KEY_SHAPE).clickable(onClick = onAsk).padding(horizontal = Space.s8, vertical = Space.s12), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size.head.dp).drawBehind {
            drawCircle(if (aimed) p.text else p.line2, style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
        }, contentAlignment = Alignment.Center) { Text("+", color = p.faint, fontSize = Type.s20) }
        Spacer(Modifier.height(Space.s8))
        Text(tr("Ask the Chief for a bot"), color = p.faint, fontSize = Type.s12, lineHeight = Type.line16, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

/** The tag of the Chief's field at the foot of a phone's home. */
internal const val CHIEF_FIELD = "chief-field"

/**
 * A phone's home (#498, #636): the same pages as the keypad, the pinned keys first and the categories side by side,
 * with no digits; above them [header] (Needs you, the Board), below them the Chief's field, its head and name
 * ([onChief]; [chiefBusy]: it works; [chiefUnread]: its new replies). A key opens its chat ([onKey]) full screen, as
 * a row of the list does, and Back returns here. A phone's keys answer no keyboard. [folded] and [onFold]: a
 * category's page folds as on the keypad (#171).
 */
@Composable
internal fun KeypadSections(
    pages: List<Keypad.Page>, look: (Keypad.Key) -> KeyLook, onKey: (Keypad.Key) -> Unit, onChief: () -> Unit,
    modifier: Modifier = Modifier, chiefUnread: Int = 0, chiefBusy: Boolean = false, folded: Set<String> = emptySet(), onFold: ((Keypad.Page) -> Unit)? = null,
    header: @Composable () -> Unit = {},
) {
    val p = LocalPaper.current
    Column(modifier) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
            header()
            Box(Modifier.padding(start = Space.s12, end = Space.s12, top = Space.s12, bottom = Space.s12)) {
                KeyPages(pages, folded, onFold) { _, _, k -> QuietKey(look(k), PHONE_KEY) { onKey(k) } }
            }
        }
        val shape = Radius.pill
        val name = LocalChiefName.current
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s12, vertical = Space.s8).raised(shape)
                .clickable(onClickLabel = name, onClick = onChief).padding(horizontal = Space.s12, vertical = Space.s8).testTag(CHIEF_FIELD),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BotFigure(CHIEF_COLOR, if (chiefBusy) "working" else "idle", 28, FigureDef.CHIEF)
            Spacer(Modifier.width(Space.s12))
            Text(name, color = p.faint, fontSize = Type.s16, maxLines = 1, modifier = Modifier.weight(1f))
            UnreadDots(chiefUnread, CHIEF_COLOR)
        }
    }
}

/** Hands the presses of a hardware keyboard from the activity (MainActivity.dispatchKeyEvent) to the keypad on screen. */
internal class KeyRelay {
    /** The keypad's answer to a press, true when it used it; [typing]: a text field has focus. null: no keypad is on screen. */
    var handler: ((press: Keypad.Press, typing: Boolean) -> Boolean)? = null
}

/**
 * Answers the presses [relay] hands on while this keypad is on screen ([Keypad.action]): a digit opens the key it
 * belongs to ([Keypad.digits], [onKey]), Esc opens the Chief's chat ([onChief]), Ctrl+K puts the owner in the search box
 * ([onSearch]). [keysShown]: the keys are on screen, not what the search found. [folded]: the folded categories,
 * whose keys are not on screen, so given no free digit (#171).
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
            val digits = if (shown) Keypad.digits(now, Keypad.shownKeys(now, foldedNow)) else emptyMap()
            when (val action = Keypad.action(press, typing, digits.keys)) {
                is Keypad.Action.Open -> { open(digits.getValue(action.number)); true }
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
