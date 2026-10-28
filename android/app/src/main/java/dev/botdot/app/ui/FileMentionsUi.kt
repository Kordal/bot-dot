package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderShared
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.FileMentions
import dev.botdot.app.data.Mentions
import dev.botdot.app.data.WorkspaceFiles
import dev.botdot.app.data.tr

/** Files for "@" in the chat on screen (#604): a bot's own chat on a botdot with `file-mentions`; null elsewhere. */
val LocalFileMentions = compositionLocalOf<FileMentions?> { null }

@Composable
fun rememberFileMentions(app: BotDotApp, botId: String): FileMentions? {
    val server by app.store.version.value.collectAsState()
    val api by app.api.collectAsState()
    val on = server?.features?.contains(Mentions.FILE_MENTIONS) == true
    return remember(on, api, botId) {
        val a = api
        if (!on || a == null) null
        else FileMentions(find = { q -> a.searchFiles(botId, q).results }, list = { d -> a.workspace(botId, d.apiRoot, d.path).entries })
    }
}

private fun iconOf(kind: String): ImageVector = when (kind) {
    "folder" -> Icons.Outlined.Folder
    "table" -> Icons.Outlined.TableChart
    "image" -> Icons.Outlined.Image
    else -> Icons.Outlined.Description
}
private fun tintOf(kind: String, p: Paper, plain: Color): Color = when (kind) { "folder" -> p.warn; "table" -> p.ok; "image" -> p.mention; else -> plain }
private fun placeIcon(root: String): ImageVector = when (root) { "server" -> Icons.Outlined.Dns; "computer" -> Icons.Outlined.DesktopWindows; else -> Icons.Outlined.FolderShared }

/**
 * The "@" list with files (#604): a folder opened has a header (back, its place and the folders on the way: a tap on
 * them mentions the folder itself); its rows, or the files found and then [mentions]. A row is at least 44dp.
 */
@Composable
fun FileMentionList(view: FileMentions.View, mentions: List<Mentions.Row>, w: Mentions.World?, onFile: (FileMentions.Row) -> Unit, onMention: (Mentions.Row) -> Unit, onBack: () -> Unit, onSelf: () -> Unit) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(shape).background(p.panel).border(1.dp, p.line2, shape)) {
        view.dir?.let { d ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, tr("Back"), tint = p.muted,
                    modifier = Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).clickable(role = Role.Button, onClick = onBack).padding(10.dp))
                Icon(placeIcon(d.root), null, tint = p.faint, modifier = Modifier.size(16.dp))
                val trail = listOf(FileMentions.placeName(d.root, d.project)) + d.path.split('/').filter { it.isNotEmpty() }
                Text(buildAnnotatedString {
                    trail.forEachIndexed { i, t ->
                        if (i < trail.size - 1) { append(t); withStyle(SpanStyle(color = p.faint)) { append("  /  ") } }
                        else withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.Medium)) { append(t) }
                    }
                }, color = p.muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = d.path.isNotEmpty(), onClickLabel = tr("Mention this folder"), onClick = onSelf).padding(horizontal = 8.dp, vertical = 12.dp))
            }
            Row(Modifier.fillMaxWidth().heightIn(min = 1.dp).background(p.line)) {}
        }
        Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
            view.rows.forEach { r -> FileRowItem(r, onFile) }
            if (view.dir == null && w != null && mentions.isNotEmpty()) MentionRows(mentions.take(maxOf(0, maxOf(Mentions.MAX_ROWS, view.rows.size) - view.rows.size)), w, onMention)
        }
    }
}

@Composable
private fun FileRowItem(r: FileMentions.Row, onPick: (FileMentions.Row) -> Unit) {
    val p = LocalPaper.current
    val kind = FileMentions.kindOf(r.name, r.type)
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onPick(r) }.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(iconOf(kind), null, tint = tintOf(kind, p, p.muted), modifier = Modifier.size(20.dp))
        Text(buildAnnotatedString {
            val i = if (r.q.isEmpty()) -1 else r.name.indexOf(r.q, ignoreCase = true)
            if (i < 0) append(r.name) else {
                append(r.name.substring(0, i))
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(r.name.substring(i, i + r.q.length)) }
                append(r.name.substring(i + r.q.length))
            }
        }, color = p.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (!r.inFolder) Row(Modifier.widthIn(max = 140.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(placeIcon(r.ref.root), null, tint = p.faint, modifier = Modifier.size(15.dp))
            Text(FileMentions.whereOf(r.ref), color = p.faint, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (r.folder) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = p.faint, modifier = Modifier.size(18.dp))
    }
}

/** A file's chip in running text (#604): its icon (see [fileInlines]) and name, on a wash; a tap opens it in the viewer
 *  when [botId] (the bot whose chat it is) is given. */
fun AnnotatedString.Builder.fileChip(f: Mentions.FileRef, botId: String?, wash: Color) {
    val file = f.path.isNotEmpty() && Regex("\\.[^./]+$").containsMatchIn(f.name)
    val kind = if (file) FileMentions.kindOf(f.name, "file") else "folder"
    val chip = SpanStyle(background = wash, fontWeight = FontWeight.Medium)
    val body: AnnotatedString.Builder.() -> Unit = {
        withStyle(chip) {
            append("\u00A0")
            appendInlineContent("$FILE_INLINE$kind", "\u200B")
            append("\u00A0${f.name}\u00A0")
        }
    }
    if (file && botId != null) {
        val src = WorkspaceFiles.file(botId, FileMentions.Dir(f.root, f.path, f.project).apiRoot, f.path)
        withLink(LinkAnnotation.Clickable("file:${f.root}:${f.path}") { DocViewer.open = DocViewer.Request(src, f.name) }) { body() }
    } else body()
}

private const val FILE_INLINE = "file:"

/** The icons of the file chips a text holds (see [fileChip]), for Text's inlineContent. */
@Composable
fun fileInlines(text: AnnotatedString): Map<String, InlineTextContent> {
    val p = LocalPaper.current
    return remember(text, p) {
        text.getStringAnnotations(INLINE_CONTENT_TAG, 0, text.length).map { it.item }.filter { it.startsWith(FILE_INLINE) }.distinct().associateWith { id ->
            val kind = id.removePrefix(FILE_INLINE)
            InlineTextContent(Placeholder(1.1.em, 1.1.em, PlaceholderVerticalAlign.TextCenter)) {
                Icon(iconOf(kind), null, tint = tintOf(kind, p, p.inkText), modifier = Modifier.fillMaxSize())
            }
        }
    }
}
