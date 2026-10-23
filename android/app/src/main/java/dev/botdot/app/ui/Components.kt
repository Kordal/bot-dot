package dev.botdot.app.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.foundation.Canvas
import dev.botdot.app.data.OpeningLine
import kotlin.math.PI
import kotlin.math.cos
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Api
import dev.botdot.app.data.Attachment
import dev.botdot.app.data.Mentions
import dev.botdot.app.data.Quote
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import dev.botdot.app.data.Unread
import dev.botdot.app.BotDotApp
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.ensureActive
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.serialization.json.JsonElement

// ---------- small things ----------

fun parseColor(hex: String?, fallback: Color): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(fallback)

@Composable
fun BackButton(onClick: () -> Unit) {
    IconButton(onClick = onClick) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
}

/** A round button that floats over what's behind it (a chat's messages); [dot]: something there waits for you. */
@Composable
fun RoundButton(label: String, modifier: Modifier = Modifier, size: Dp = 40.dp, dot: Boolean = false, onClick: () -> Unit, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Box(
        modifier.size(size).clip(CircleShape).background(p.sunk).border(1.dp, p.line2, CircleShape)
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        content()
        if (dot) Box(Modifier.align(Alignment.TopEnd).padding(8.dp).size(7.dp).clip(CircleShape).background(p.warn))
    }
}

@Composable
fun RoundButton(icon: ImageVector, label: String, modifier: Modifier = Modifier, size: Dp = 40.dp, dot: Boolean = false, onClick: () -> Unit) =
    RoundButton(label, modifier, size, dot, onClick) { Icon(icon, contentDescription = null, tint = LocalPaper.current.text, modifier = Modifier.size(20.dp)) }

/** On a wide screen, where the list stands beside the chat: hides or shows the list. On a phone: null (there's Back). */
val LocalListToggle = compositionLocalOf<(() -> Unit)?> { null }

/**
 * The top of a chat, floating over its messages: the list's button (Back on a phone), whose chat it is (a tap opens
 * its settings), and its own buttons. [picture]: what stands in the head's place (a group's members). [nameLabel]:
 * what a screen reader says the name opens. [beside]: what stands right of the name and is no part of it (the small
 * plus of a bot's chat): a long name is cut, and it stays.
 */
@Composable
fun ChatBar(color: String?, state: String, name: String, onName: () -> Unit, onBack: () -> Unit, outfit: JsonElement? = null, nameLabel: String = "Its settings", picture: (@Composable () -> Unit)? = null, beside: (@Composable () -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    val p = LocalPaper.current
    val toggle = LocalListToggle.current
    Row(
        Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(p.bg, p.bg.copy(alpha = 0.85f), p.bg.copy(alpha = 0f))))
            .statusBarsPadding().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (toggle == null) RoundButton(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
        else RoundButton("Show or hide the list", onClick = toggle) {
            // A window with its left side filled: the list.
            androidx.compose.foundation.Canvas(Modifier.size(width = 18.dp, height = 15.dp)) {
                val line = 1.6.dp.toPx()
                val corner = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx())
                drawRoundRect(p.text, cornerRadius = corner, style = androidx.compose.ui.graphics.drawscope.Stroke(line))
                val gap = line + 1.5.dp.toPx()
                drawRoundRect(p.text, androidx.compose.ui.geometry.Offset(gap, gap), androidx.compose.ui.geometry.Size(this.size.width * 0.3f, this.size.height - 2 * gap), androidx.compose.ui.geometry.CornerRadius(1.dp.toPx()))
            }
        }
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f, fill = false).height(40.dp).clip(CircleShape).background(p.sunk).border(1.dp, p.line2, CircleShape)
                    .clickable(onClick = onName).semantics { contentDescription = nameLabel }.padding(start = 4.dp, end = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (picture != null) picture() else BotFigure(color, state, 32, outfit)
                Spacer(Modifier.size(6.dp))
                Text(name, color = p.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            beside?.invoke()
        }
        actions()
    }
}

private val TIME = DateTimeFormatter.ofPattern("HH:mm")
private val DAY = DateTimeFormatter.ofPattern("d MMM")
private val DAY_TIME = DateTimeFormatter.ofPattern("d MMM, HH:mm")
fun shortTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching {
        val t = Instant.parse(iso).atZone(ZoneId.systemDefault())
        if (t.toLocalDate() == java.time.LocalDate.now()) t.format(TIME) else t.format(DAY_TIME)
    }.getOrDefault("")
}

/** When a chat last had something, as short as the list needs it: the time today, then the day, then the date. */
fun listTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching {
        val t = Instant.parse(iso).atZone(ZoneId.systemDefault())
        val days = java.time.temporal.ChronoUnit.DAYS.between(t.toLocalDate(), java.time.LocalDate.now())
        when {
            days <= 0L -> t.format(TIME)
            days == 1L -> "Yesterday"
            days < 7L -> t.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.getDefault())
            else -> t.format(DAY)
        }
    }.getOrDefault("")
}

fun fileIcon(name: String) = when (name.substringAfterLast('.', "").lowercase()) {
    "xlsx", "xls", "xlsm", "csv", "ods", "tsv" -> "📊"
    "pdf" -> "📕"
    "docx", "doc", "odt", "md", "txt" -> "📝"
    "pptx", "odp" -> "📽"
    "png", "jpg", "jpeg", "gif", "webp", "heic" -> "🖼"
    "json" -> "🧾"
    else -> "📄"
}

fun fmtSize(n: Long): String = when {
    n >= 1_048_576 -> "%.1f MB".format(n / 1_048_576.0)
    n >= 1024 -> "${n / 1024} KB"
    else -> "$n B"
}

@Composable
fun FileChip(name: String, note: String? = null, onDark: Boolean = false, onRemove: (() -> Unit)? = null) {
    val p = LocalPaper.current
    val fg = if (onDark) p.inkText else p.text
    Row(
        Modifier.clip(RoundedCornerShape(99.dp))
            .background(if (onDark) p.inkText.copy(alpha = 0.14f) else p.panel)
            .border(1.dp, if (onDark) p.inkText.copy(alpha = 0.25f) else p.line2, RoundedCornerShape(99.dp))
            .padding(start = 10.dp, end = if (onRemove != null) 2.dp else 10.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${fileIcon(name)} ", fontSize = 13.sp)
        Text(name, color = fg, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
        if (note != null) Text("  $note", color = p.faint, fontSize = 12.sp)
        if (onRemove != null) IconButton(onClick = onRemove, modifier = Modifier.size(26.dp)) {
            Icon(Icons.Filled.Close, contentDescription = "Remove", modifier = Modifier.size(14.dp), tint = p.faint)
        }
    }
}

/**
 * Where a file the owner sent in a Chief chat or a group opens (#268): its address in the viewer, null for one botdot
 * doesn't serve. Those chats give it to their bubbles, from a server with `chat-attachments`.
 */
val LocalOwnFiles = compositionLocalOf<((Attachment) -> String?)?> { null }

/**
 * Files you attached to a message. A tap opens one in the viewer: in a bot's chat from its folder (#251,
 * [LocalPathActions]), in a Chief chat or a group from botdot's copy (#268, [LocalOwnFiles]).
 */
@Composable
fun FilesRow(files: List<Attachment>, onDark: Boolean) {
    val paths = LocalPathActions.current
    val own = LocalOwnFiles.current
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        files.forEach { f ->
            val src = if (paths == null && f.file.isNotBlank()) own?.invoke(f) else null
            when {
                paths != null && f.file.isNotBlank() -> Box(Modifier.clip(RoundedCornerShape(99.dp)).clickable { paths.open(f.file, f.name) }) { FileChip(f.name, onDark = onDark) }
                src != null -> Box(Modifier.clip(RoundedCornerShape(99.dp)).clickable { DocViewer.open = DocViewer.Request(src, f.name) }) { FileChip(f.name, onDark = onDark) }
                else -> FileChip(f.name, onDark = onDark)
            }
        }
    }
}

/** Files a bot attached to its reply: a tap opens one in the phone's own app for it. Pictures show as themselves. */
@Composable
fun BotFilesRow(files: List<Attachment>?, top: androidx.compose.ui.unit.Dp = 8.dp) {
    if (files.isNullOrEmpty()) return
    val context = LocalContext.current
    val app = dev.botdot.app.BotDotApp.of(context)
    val scope = rememberCoroutineScope()
    var opening by remember { mutableStateOf<String?>(null) }
    // From a server with the viewer (#251), a tap opens the file in it; else in the phone's own app, as before.
    val server by app.store.version.value.collectAsState()
    val viewer = dev.botdot.app.data.DocumentView.shows(server?.features)
    val from = LocalPathActions.current?.from.orEmpty()
    val open = { f: Attachment ->
        if (viewer) DocViewer.open = DocViewer.Request(dev.botdot.app.data.DocumentView.runFile(f.file), f.name, from)
        else app.api.value?.let { api ->
            opening = f.file
            scope.launch {
                runCatching { dev.botdot.app.data.BotFiles.open(context, api, f.file, f.name) }
                    .onFailure { android.widget.Toast.makeText(context, it.message ?: "Couldn't open ${f.name}", android.widget.Toast.LENGTH_LONG).show() }
                opening = null
            }
        }
        Unit
    }
    val (images, others) = files.partition { isImage(it.name) }
    Column(Modifier.padding(top = top), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        images.forEach { f -> BotImage(f, onClick = { if (opening == null) open(f) }) }
        if (others.isNotEmpty()) androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            others.forEach { f ->
                Box(Modifier.clip(RoundedCornerShape(99.dp)).clickable(enabled = opening == null) { open(f) }) {
                    FileChip(f.name, note = if (opening == f.file) "opening…" else null)
                }
            }
        }
    }
}

/** The pages a run saved (#346): a chip each under its reply, which opens the page in the viewer. Only from a server with `pages`; the Chief's (#384) only with `chief-pages`. [name]: whose page, when the chat does not say it. */
@Composable
fun PageChips(botId: String, pages: List<dev.botdot.app.data.PageRef>, name: String? = null) {
    if (pages.isEmpty()) return
    val p = LocalPaper.current
    val app = dev.botdot.app.BotDotApp.of(LocalContext.current)
    val server by app.store.version.value.collectAsState()
    if (!dev.botdot.app.data.Pages.shows(server?.features)) return
    if (botId == dev.botdot.app.data.Pages.CHIEF && !dev.botdot.app.data.Pages.showsChief(server?.features)) return
    val from = name ?: LocalPathActions.current?.from.orEmpty()
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        pages.forEach { page ->
            Row(Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(14.dp)).background(p.panel).border(1.dp, p.line2, RoundedCornerShape(14.dp))
                .clickable { DocViewer.open = DocViewer.page(botId, page, from) }.padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text("📄", fontSize = 18.sp)
                Column(Modifier.padding(start = 10.dp)) {
                    Text(page.title, color = p.text, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("Page", color = p.faint, fontSize = 12.sp)
                }
            }
        }
    }
}

/** The Reconnect cards under the reply of a job's run (#431): an app it found signed out, and a button that connects it as the Connectors screen does. */
@Composable
fun ReconnectCards(cards: List<dev.botdot.app.data.ReconnectCard>) {
    if (cards.isEmpty()) return
    val p = LocalPaper.current
    val context = LocalContext.current
    val app = BotDotApp.of(context)
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val tell = { t: String -> android.widget.Toast.makeText(context, t, android.widget.Toast.LENGTH_LONG).show() }
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        cards.forEach { card ->
            Row(Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(14.dp)).background(p.panel).border(1.dp, p.line2, RoundedCornerShape(14.dp))
                .padding(start = 12.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(androidx.compose.ui.text.buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Medium)) { append(card.label) }
                    append(" is signed out")
                }, color = p.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                androidx.compose.material3.TextButton(onClick = {
                    scope.launch {
                        runCatching { (api ?: error("Not connected to botdot")).connectApp(card.app) }.onSuccess { link ->
                            if (link.noAuth) tell("Connected")
                            else link.redirectUrl?.let { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(it))) }
                        }.onFailure { tell(it.message ?: "Couldn't connect") }
                    }
                }) { Text("Reconnect", color = p.okText) }
            }
        }
    }
}

private fun isImage(name: String) = name.substringAfterLast('.', "").lowercase() in setOf("png", "jpg", "jpeg", "gif", "webp")

/** A picture a bot sent (a QR code to scan…), shown in the chat; a tap opens it full size. */
@Composable
private fun BotImage(f: Attachment, onClick: () -> Unit) {
    val p = LocalPaper.current
    val app = dev.botdot.app.BotDotApp.of(LocalContext.current)
    val api by app.api.collectAsState()
    val url = api?.url("/files/" + f.file.split('/').joinToString("/") { Api.enc(it) }) ?: return FileChip(f.name, note = "loading…")
    var shown by remember(url) { mutableStateOf(false) }
    val shape = RoundedCornerShape(10.dp)
    Box {
        // Decoded at the size it's shown (not the photo's own), and kept in memory and on disk (see BotDotApp).
        coil3.compose.AsyncImage(
            model = url, contentDescription = f.name,
            onState = { shown = it is coil3.compose.AsyncImagePainter.State.Success },
            modifier = Modifier.widthIn(max = 300.dp).heightIn(max = 360.dp).clip(shape)
                .then(if (shown) Modifier.border(1.dp, p.line2, shape).background(Color.White).clickable(onClick = onClick) else Modifier),
            contentScale = androidx.compose.ui.layout.ContentScale.Fit,
        )
        if (!shown) FileChip(f.name, note = "loading…")
    }
}

// ---------- new replies ----------

/** A bot's new replies in the list: one dot each, at most three, in its colour. Nothing when nothing is new; never a number. */
@Composable
fun UnreadDots(unread: Int, color: String?, modifier: Modifier = Modifier) {
    val shown = Unread.dots(unread)
    if (shown == 0) return
    val c = parseColor(color, LocalPaper.current.faint)
    Row(modifier.semantics(mergeDescendants = true) { contentDescription = if (shown == 1) "New reply" else "New replies" }, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        repeat(shown) { Box(Modifier.size(7.dp).clip(CircleShape).background(c)) }
    }
}

/** The line at the first new reply of a chat: thin, in the bot's colour, with "New" in the middle. */
@Composable
fun NewLine(color: String?) {
    val c = parseColor(color, LocalPaper.current.faint)
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.weight(1f).height(1.dp).background(c.copy(alpha = 0.45f)))
        Text("New", color = c, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
        Box(Modifier.weight(1f).height(1.dp).background(c.copy(alpha = 0.45f)))
    }
}

/**
 * A working bot's opening line under its chat: a dot in the bot's colour that pulses (it holds still with animations
 * off), what it said it is about to do, and the app's ellipsis. It is never a message. [working]: a bot's chat while
 * the bot works, where this line is all there is of the run and says "Working…" until the bot says its own.
 * Nothing without a line otherwise. [waiting]: its run waits for the owner's OK: the line says so in the opening
 * line's place, and the dot holds still, since nothing moves until the owner answers.
 */
@Composable
fun StatusLine(line: String?, color: String?, working: Boolean = false, waiting: Boolean = false) =
    StatusLine(OpeningLine.status(line, working, waiting), color, still = waiting)

/**
 * The working line with its words already chosen ([OpeningLine.botLine], [OpeningLine.chiefLine]); nothing when
 * they are empty. [still]: the dot holds still. [onStop]: the word Stop at the end of the line, which ends what the
 * line is about. It is a button of its own, 48 dp high to the touch, beside the line's words and not one of them:
 * TalkBack reads the line as it changes, and Stop when the owner goes to it. [stopWord]: what that button reads
 * ("Stop all" under a group's last working line). [room]: the line is as high without Stop as with it: Stop comes
 * to it in a moment (a message is on its way), and nothing above it moves then.
 */
@Composable
fun StatusLine(text: String, color: String?, still: Boolean = false, onStop: (() -> Unit)? = null, stopWord: String = "Stop", room: Boolean = false) {
    if (text.isEmpty()) return
    val p = LocalPaper.current
    val c = parseColor(color, p.faint)
    val clock = movingClock(!still)
    // With Stop the row is as high as its touch target, which then stands for the line's own space above and below.
    Row(Modifier.fillMaxWidth().padding(start = 2.dp).then(if (onStop != null) Modifier else if (room) Modifier.heightIn(min = 48.dp) else Modifier.padding(top = 8.dp, bottom = 4.dp)), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f, fill = false).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Canvas(Modifier.size(7.dp)) {
                // As the web page's: down to a quarter and back, every 1.2 seconds.
                val a = clock?.let { 0.625f + 0.375f * cos(2 * PI * (it.ms.longValue % 1200L) / 1200.0).toFloat() } ?: 1f
                drawCircle(c.copy(alpha = a))
            }
            Text(text, color = p.muted, fontSize = 13.sp, lineHeight = 18.sp)
        }
        if (onStop != null) WordButton(stopWord, p.faint, onStop)
    }
}

/** A small word that is a button ("Stop", "Take back"): 48 dp high and at least as wide to the touch, read out as a button. */
@Composable
fun WordButton(word: String, color: Color, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center) {
        Text(word, color = color, fontSize = 12.sp)
    }
}

/**
 * A message of the owner that waits its turn, at the end of its chat: their bubble at half strength, and under it
 * what it waits for and "Take back", which puts it in the message box again. [who]: the bot's name, or "the Chief".
 */
@Composable
fun WaitingMessage(q: dev.botdot.app.data.Queued, who: String, onSteer: (() -> Unit)? = null, onTakeBack: () -> Unit) {
    // Steered (ADR 040): "Steering…" until the run read it, and Take back alone; else "Steer" beside Take back, where the server has it.
    val steering = onSteer != null && q.steering
    WaitingMessage(q.text, q.attachments, if (steering) STEERING else waitsUntil(who), onSteer.takeUnless { steering }, onTakeBack)
}

/**
 * The owner's message from Send until the botdot server answered ([SentMessage]): their bubble at half strength, as
 * one that waits, with its files, and nothing under it. [above]: it stands above the working line, where its run
 * will draw it, and keeps a chat row's distance from that line. [modifier]: its arrival on Send ([arrives]).
 */
@Composable
fun SentBubble(m: SentMessage, above: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(top = if (above) 0.dp else 6.dp, bottom = if (above) 10.dp else 0.dp).alpha(0.5f)) { MyBubble(m.text, m.attachments) }
}

/** A waiting message with its words given: [waits] says what it waits for (in a group: for which members). */
@Composable
fun WaitingMessage(text: String, attachments: List<Attachment>, waits: String, onSteer: (() -> Unit)? = null, onTakeBack: () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Box(Modifier.alpha(0.5f)) { MyBubble(text, attachments) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(waits, color = p.faint, fontSize = 12.sp)
            if (onSteer != null) WordButton("Steer", p.muted, onSteer)
            WordButton("Take back", p.muted, onTakeBack)
        }
    }
}

/** The owner's messages that wait in a chat, oldest first, under its working line. [onSteer]: "Steer" under each (ADR 040), or none. */
@Composable
fun WaitingMessages(queued: List<dev.botdot.app.data.Queued>, who: String, onSteer: ((dev.botdot.app.data.Queued) -> Unit)? = null, onTakeBack: (dev.botdot.app.data.Queued) -> Unit) {
    if (queued.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        queued.forEach { q -> androidx.compose.runtime.key(q.id) { WaitingMessage(q, who, onSteer?.let { steer -> { steer(q) } }) { onTakeBack(q) } } }
    }
}

/**
 * A message of the owner that a run read while it worked (ADR 040): their bubble, after the run's request, and under
 * it "Steered" with when it was sent. No buttons: it is part of that run.
 */
@Composable
fun SteeredMessage(m: dev.botdot.app.data.Steered) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        MyBubble(m.text, m.attachments)
        Text(m.at?.let { "Steered · ${shortTime(it)}" } ?: "Steered", color = p.faint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp, end = 6.dp))
    }
}

/** The standing line above the message box while Claude is signed out; its end leads to where the owner signs in. */
const val SIGNED_OUT = "Claude is signed out: bots can't work."

/**
 * What a chat's screen does about new replies (ADR 005). Each time the screen is in front (its lifecycle resumed,
 * asked of the lifecycle itself, not of a redraw), [arrive] places the "New" line from what the server says is new,
 * then the chat is reported as on screen, which reads it everywhere, then [toNew] scrolls to a line that was placed.
 * When the screen goes, the report stops and [leave] takes the line away, unless the phone only turned.
 * [chat]: "bot:<id>", "chief:<chatId>", or null while there is no chat yet. [unread]: its new replies as the app
 * knows them: a list fetched before the report can put them back on the chat being read, and then it is said again.
 * Nothing happens against a botdot server that keeps no read positions.
 */
@Composable
fun NewReplies(app: BotDotApp, chat: String?, unread: Int, arrive: suspend () -> Boolean, leave: () -> Unit, toNew: suspend () -> Unit) {
    // Under the settings panel the chat is not on screen: as when the settings were a screen of their own.
    @Suppress("NAME_SHADOWING") val chat = chat.takeIf { !LocalChatCovered.current }
    val on by app.reading.on.collectAsState()
    val owner = LocalLifecycleOwner.current
    val host = LocalActivity.current
    val doArrive by rememberUpdatedState(arrive)
    val doLeave by rememberUpdatedState(leave)
    val doToNew by rememberUpdatedState(toNew)
    LaunchedEffect(chat, on, owner) {
        if (chat == null || !on) return@LaunchedEffect
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            val placed = doArrive()
            ensureActive() // left or paused while botdot was asked: not on screen any more
            app.reading.show(chat)
            if (placed) doToNew()
        }
    }
    LaunchedEffect(chat, unread) { if (chat != null && unread > 0) app.reading.again(chat) }
    DisposableEffect(chat) {
        onDispose {
            if (chat != null) app.reading.hide(chat)
            if (host?.isChangingConfigurations != true) doLeave() // the phone only turned: the chat is still open
        }
    }
}

/**
 * Scrolls a chat (newest at the bottom) so that an item starts at the top of what is visible: the exchange that
 * holds the "New" line, however long its reply is. Near the end of the chat it goes as far as the chat does.
 * [index]: where the item is, or null while the list has not laid out what the chat now holds (a reply that just
 * came in); it is asked until it says, for a moment at most.
 */
suspend fun LazyListState.showFromTop(index: () -> Int?) {
    val at = withTimeoutOrNull(2_000) { snapshotFlow(index).filterNotNull().first() } ?: return
    scrollToItem(at) // its end at the bottom
    val info = layoutInfo
    val item = info.visibleItemsInfo.firstOrNull { it.index == at } ?: return
    val room = info.viewportSize.height - info.beforeContentPadding - info.afterContentPadding
    scrollBy((item.size - room).toFloat())
}

// ---------- bubbles ----------

@Composable
fun MyBubble(text: String, files: List<Attachment>? = null) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().padding(start = 48.dp), horizontalArrangement = Arrangement.End) {
        Column(
            Modifier.clip(RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)).holdToCopy(text).background(p.ink).padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            val mentions = LocalMentions.current
            val shown = remember(text, mentions, p.mention) { withMentions(text, mentions, p.mention) }
            // Selectable, with Quote in its menu (QuoteUi.kt), as a bot's reply is.
            if (text.isNotBlank()) QuotableSelection {
                Text(SearchMarks.mark(linkedChatText(shown, p.inkText)), color = p.inkText, style = MaterialTheme.typography.bodyLarge, inlineContent = figureInlines(shown))
            }
            if (!files.isNullOrEmpty()) FilesRow(files, onDark = true)
        }
    }
}

@Composable
fun Chip(text: String) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Text(text, color = p.muted, fontSize = 12.5.sp,
            modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(p.sunk).padding(horizontal = 12.dp, vertical = 5.dp))
    }
}

@Composable
fun TheirBubble(footer: String? = null, error: Boolean = false, copyText: String? = null, chips: List<Pair<CharSequence, (() -> Unit)?>> = emptyList(), footerEnd: (@Composable () -> Unit)? = null, wholeChips: Boolean = false, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().padding(end = 32.dp)) {
        Box(
            Modifier.clip(RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp))
                .holdToCopy(copyText)
                .background(if (error) p.errSoft else p.panel)
                .border(1.dp, if (error) p.err.copy(alpha = 0.3f) else p.line, RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp))
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) { content() }
        if (chips.isNotEmpty()) ActionChips(chips, wholeChips)
        // [footerEnd]: what sits on the time's line after it (👍 and 👎 under an unasked Chief message).
        if (footerEnd != null) Row(verticalAlignment = Alignment.CenterVertically) {
            if (!footer.isNullOrBlank()) Text(footer, color = p.faint, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
            footerEnd()
        } else if (!footer.isNullOrBlank()) Text(footer, color = p.faint, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp, top = 4.dp))
    }
}

/**
 * Small grey lines under a reply for what was done or learned ("🧠 Remembered: …"); a tap opens where it lives, and a
 * chip with nothing to open is no button. Words given with their own colours (what still waits for the owner's OK,
 * [chipText]) keep them. [whole]: each line is printed whole, on as many lines as it needs: what a run learned is
 * the botdot server's line, and the app cuts nothing of it. Otherwise a chip is one line of [CHIP_CHARS] at most.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ActionChips(chips: List<Pair<CharSequence, (() -> Unit)?>>, whole: Boolean = false) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(if (whole) 14.dp else 99.dp)
    androidx.compose.foundation.layout.FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((text, onClick) in chips) {
            Text(chipShown(text, whole), color = p.muted, fontSize = 12.5.sp, maxLines = if (whole) Int.MAX_VALUE else 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.clip(shape).background(p.sunk).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                    .padding(horizontal = 12.dp, vertical = 5.dp))
        }
    }
}

/** The most a chip that is cut shows. */
internal const val CHIP_CHARS = 90

/** What a chip draws of its [text]: all of it when [whole], else its first [CHIP_CHARS], the last of them "…". */
internal fun chipShown(text: CharSequence, whole: Boolean): AnnotatedString =
    if (!whole && text.length > CHIP_CHARS) AnnotatedString.Builder().apply { append(text.subSequence(0, CHIP_CHARS - 1)); append("…") }.toAnnotatedString()
    else text as? AnnotatedString ?: AnnotatedString(text.toString())

/** What a chip says of something the Chief did, and after " · " what of it still waits for the owner's OK, the server's words. */
data class ChipWords(val text: String, val waits: String? = null, val after: String = "")

/** A Chief action's chip: its label, what still waits (`waits`), and "View live screen" where a tap opens the bot's screen. */
fun chipWords(a: dev.botdot.app.data.ChiefAction, screen: Boolean) = ChipWords(a.label, a.waits, if (screen) " · View live screen" else "")

/** The chip's words as they are drawn: what waits in the warning colour [warn], the rest in the chip's own. */
fun chipText(w: ChipWords, warn: Color): AnnotatedString = AnnotatedString.Builder().apply {
    append(w.text)
    if (w.waits != null) {
        append(" · ")
        pushStyle(SpanStyle(color = warn)); append(w.waits); pop()
    }
    append(w.after)
}.toAnnotatedString()

/** Hold a message to copy all of it (its text as written). Taps still reach links inside it. */
@Composable
fun Modifier.holdToCopy(text: String?): Modifier {
    if (text.isNullOrBlank()) return this
    val context = androidx.compose.ui.platform.LocalContext.current
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    return this.pointerInput(text) {
        detectTapGestures(onLongPress = {
            haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
            copyToClipboard(context, text)
        })
    }
}

/** [text] to the system clipboard, with a "Copied" note where Android shows none of its own (before 13). */
fun copyToClipboard(context: android.content.Context, text: String) {
    context.getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText("botdot", text))
    if (android.os.Build.VERSION.SDK_INT < 33) android.widget.Toast.makeText(context, "Copied", android.widget.Toast.LENGTH_SHORT).show()
}

/** The Chief's reply while it is written, against a botdot from before `message-waits`: there the working line says it ([StatusLine]). */
@Composable
fun Working(label: String, steps: List<String>) {
    val p = LocalPaper.current
    TheirBubble {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = p.muted)
                Spacer(Modifier.size(8.dp))
                Text(label, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            steps.takeLast(4).dropLast(if (steps.isNotEmpty()) 1 else 0).forEach {
                Text("✓ $it", color = p.faint, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

// ---------- attachments in the message box ----------

/** Files attached in a message box: uploaded right away, sent with the message. */
class PendingFiles(private val scope: CoroutineScope, private val context: Context, val api: () -> Api?, private val target: () -> String, private val onFailed: (String) -> Unit) {
    data class Item(val key: Int, val name: String, val size: Long?, val status: String, val attachment: Attachment? = null, val error: String? = null)

    val items = mutableStateListOf<Item>()
    private var nextKey = 0

    fun add(uris: List<Uri>) {
        val a = api() ?: return
        for (uri in uris.take(10 - items.size)) {
            val (name, size) = a.describe(context.contentResolver, uri)
            if ((size ?: 0) > 25L * 1024 * 1024) { onFailed("$name is over 25 MB."); continue }
            val item = Item(nextKey++, name, size, "uploading")
            items += item
            scope.launch {
                val done = runCatching { a.upload(context.contentResolver, uri, target()) }
                val idx = items.indexOfFirst { it.key == item.key } // it may have been removed meanwhile
                if (idx >= 0) items[idx] = item.copy(
                    status = if (done.isSuccess) "ready" else "failed",
                    attachment = done.getOrNull(),
                    error = done.exceptionOrNull()?.message,
                )
                done.exceptionOrNull()?.let { e ->
                    onFailed(if (e is SecurityException) "botdot can't open ${item.name}: the app that shared it didn't allow it." else "${item.name}: ${e.message ?: "couldn't upload"}")
                }
            }
        }
    }

    fun remove(key: Int) { items.removeAll { it.key == key } }
    val uploading get() = items.any { it.status == "uploading" }
    fun take(): List<Attachment> = items.mapNotNull { it.attachment }.also { items.clear() }
    /** The files of a message that could not be sent, back in front of those attached since: uploaded already, ready to send. */
    fun put(attachments: List<Attachment>) { items.addAll(0, attachments.map { Item(nextKey++, it.name, it.size, "ready", it) }) }
}

/**
 * The message box. [busy]: it shows Stop in Send's place and sends nothing: only against a botdot from before
 * `message-waits` ([boxStops]). With that feature Send stays while something works, and Stop is on the working line.
 */
@Composable
fun Composer(
    placeholder: String,
    files: PendingFiles?, // null: a chat that takes no files (a shared room), and no "Attach files"
    busy: Boolean,
    outbox: Outbox,
    onSend: (String, List<Attachment>) -> Unit,
    onStop: () -> Unit,
    onError: (String) -> Unit,
    initialText: String = "",
    onSignIn: (() -> Unit)? = null,
) {
    val p = LocalPaper.current
    // Kept when the phone turns. With the cursor: a mention is what's typed before it.
    var text by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue(initialText, TextRange(initialText.length))) }
    var picked by remember { mutableIntStateOf(-1) } // where a bot just picked (and its new space) ends; -1: none
    val mentions = LocalMentions.current
    val rows = remember(text, mentions) {
        if (mentions == null || !text.selection.collapsed) emptyList() else Mentions.suggest(text.text.substring(0, text.selection.start), mentions)
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> files?.add(uris) }
    // A message that could not be sent comes back: its text in front of what was typed since, its files in front of
    // those attached since. Also one whose chat was left while it was sent.
    val back = outbox.back
    LaunchedEffect(back) {
        val failed = outbox.take() ?: return@LaunchedEffect
        val now = withFailed(failed.text, text.text)
        text = TextFieldValue(now, TextRange(now.length))
        picked = -1
        files?.put(failed.attachments)
    }
    // Text quoted from a message of this chat (QuoteUi.kt): after what is typed, the cursor after it, ready to write.
    val quotes = LocalQuote.current
    val focus = remember { FocusRequester() }
    val quoted = quotes?.pending
    LaunchedEffect(quoted) {
        val added = quotes?.take()?.let { Quote.add(text.text, it) } ?: return@LaunchedEffect
        text = TextFieldValue(added.text, TextRange(added.cursor))
        picked = -1
        outbox.edited()
        runCatching { focus.requestFocus() }
    }
    // It floats over the messages, which fade out behind it.
    Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(p.bg.copy(alpha = 0f), p.bg.copy(alpha = 0.85f), p.bg)))
        .navigationBarsPadding().imePadding().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 8.dp)) {
        if (files != null && files.items.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                files.items.forEach { f ->
                    FileChip(f.name, note = when (f.status) { "uploading" -> "uploading…"; "failed" -> "failed"; else -> null }, onRemove = { files.remove(f.key) })
                }
            }
        }
        if (rows.isNotEmpty() && mentions != null) MentionList(rows, mentions) { row -> pickMention(text, row).let { (v, end) -> text = v; picked = end } }
        // Claude is signed out ([onSignIn] is given while it is): one standing line, and the way to sign in.
        if (onSignIn != null) Text(
            AnnotatedString.Builder().apply { append("$SIGNED_OUT "); pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold)); append("Sign in"); pop() }.toAnnotatedString(),
            color = p.warnText, fontSize = 12.5.sp, lineHeight = 17.sp,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = "Sign in", role = Role.Button, onClick = onSignIn)
                .padding(start = 6.dp, end = 6.dp).wrapContentHeight(Alignment.CenterVertically),
        )
        // Why the last send failed, until the owner sends or edits.
        outbox.note?.let { note ->
            Text(note, color = p.warnText, fontSize = 12.5.sp, lineHeight = 17.sp,
                modifier = Modifier.padding(start = 6.dp, bottom = 8.dp).semantics { liveRegion = LiveRegionMode.Polite })
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (files != null) RoundButton(Icons.Filled.Add, "Attach files", size = 48.dp) { pick.launch("*/*") }
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(24.dp)).background(p.sunk).border(1.dp, p.line2, RoundedCornerShape(24.dp)).padding(start = 16.dp, top = 4.dp, end = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                BasicTextField(
                    value = text,
                    onValueChange = { v ->
                        if (v.text != text.text || v.selection != text.selection) { // not only the keyboard's composing
                            if (v.text != text.text) outbox.edited()
                            text = slashAfterPick(text, v, picked) ?: v
                            picked = -1
                        } else text = v
                    },
                    textStyle = TextStyle(color = p.text, fontSize = 16.sp, lineHeight = 22.sp, fontFamily = Geist),
                    cursorBrush = SolidColor(p.text),
                    maxLines = 6,
                    visualTransformation = remember(mentions, p.mention) { CommandChips(mentions, p.mention) },
                    modifier = Modifier.weight(1f).padding(vertical = 9.dp).heightIn(min = 22.dp).focusRequester(focus),
                    decorationBox = { inner ->
                        Box { if (text.text.isEmpty()) Text(placeholder, color = p.faint, fontSize = 16.sp); inner() }
                    },
                )
                // One message at a time: while one is on its way, Send waits for it.
                val canSend = !outbox.sending && (text.text.isNotBlank() || files?.items?.any { it.status == "ready" } == true)
                Box(
                    Modifier.padding(2.dp).size(36.dp).clip(CircleShape).background(if (busy) p.err else if (canSend) p.ink else p.line).clickable(role = Role.Button) {
                        if (busy) return@clickable onStop()
                        if (files?.uploading == true) return@clickable onError("Wait a moment: the files are still uploading.")
                        if (!canSend) return@clickable
                        // The box empties at once, for the next message; a message that did not go comes back (above).
                        val t = text.text.trim()
                        text = TextFieldValue() // no edit: sent as it failed, the message keeps its key (the send takes the line away)
                        onSend(t, files?.take().orEmpty())
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(if (busy) Icons.Filled.Stop else Icons.Filled.ArrowUpward, contentDescription = if (busy) "Stop" else "Send",
                        tint = if (busy) Color.White else if (canSend) p.inkText else p.faint, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

/** The key of what a question card sends: the same while its text is the same, a new one once it changed. */
internal class CardKey {
    private var last: Pair<String, String>? = null
    fun of(text: String): String = (last?.takeIf { it.first == text } ?: (text to messageKey()).also { last = it }).second
}

/** Like onFailure, but not when the work was only cancelled (the screen closed or reloaded): that's no error to show. */
inline fun <T> Result<T>.onError(block: (Throwable) -> Unit): Result<T> =
    onFailure { if (it !is kotlinx.coroutines.CancellationException) block(it) }

/**
 * Quick answers under the newest reply ("Yes" / "No"…): tap one to send it. [onPick] sends the answer with its key
 * and says whether it went: the answers go only then, and stay to be tapped again when it did not. An answer keeps
 * its key for as long as it is shown, so tapped again after a failed send it is the same message.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun Choices(choices: List<String>?, onPick: suspend (String, String) -> Boolean) {
    if (choices.isNullOrEmpty()) return
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var used by remember(choices) { mutableStateOf(false) }
    if (used) return
    val keys = remember(choices) { choices.map { messageKey() } }
    androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth().padding(start = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        choices.forEachIndexed { i, c -> androidx.compose.material3.OutlinedButton(onClick = { scope.launch { if (onPick(c, keys[i])) used = true } }) { Text(c, color = p.text) } }
    }
}

/**
 * Several questions at once, under the newest reply: a box under each, and Send posts them all as one message.
 * [onSend] sends them with their key and says whether it went: the card goes only then, and keeps its answers when it
 * did not. The card keeps its key until an answer changes: changed answers are a new message.
 */
@Composable
fun Questions(questions: List<String>?, onSend: suspend (String, String) -> Boolean) {
    if (questions.isNullOrEmpty()) return
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var used by remember(questions) { mutableStateOf(false) }
    if (used) return
    val answers = remember(questions) { mutableStateListOf(*Array(questions.size) { "" }) }
    val keys = remember(questions) { CardKey() }
    Column(
        Modifier.fillMaxWidth().padding(end = 24.dp).clip(RoundedCornerShape(18.dp)).border(1.dp, p.line, RoundedCornerShape(18.dp)).background(p.panel).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        questions.forEachIndexed { i, q ->
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(q, color = p.text, fontSize = 14.sp)
                BasicTextField(
                    value = answers[i],
                    onValueChange = { answers[i] = it },
                    textStyle = TextStyle(color = p.text, fontSize = 16.sp, lineHeight = 22.sp, fontFamily = Geist),
                    cursorBrush = SolidColor(p.text),
                    maxLines = 6, // one line to start with; it grows as you type
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, p.line2, RoundedCornerShape(12.dp)).background(p.bg).padding(horizontal = 12.dp, vertical = 9.dp),
                )
            }
        }
        val canSend = answers.any { it.isNotBlank() }
        androidx.compose.material3.Button(
            onClick = {
                // Each question with its answer (see lib/choices.js).
                val all = questions.mapIndexed { i, q -> "$q\n→ ${answers[i].trim().ifEmpty { "–" }}" }.joinToString("\n\n")
                scope.launch { if (onSend(all, keys.of(all))) used = true }
            },
            enabled = canSend,
            modifier = Modifier.align(Alignment.End),
        ) { Text("Send") }
    }
}
