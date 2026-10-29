package dev.botdot.app.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.DocumentExport
import dev.botdot.app.data.tr

/** Whether a reply is a document (#348): the rule the web page shares (test/fixtures/document-cases.json). */
internal fun isDocument(text: String): Boolean {
    val n = DocumentExport.words(text)
    if (n >= DocumentExport.LONG_WORDS) return true
    return n >= DocumentExport.SECTIONED_WORDS && parseBlocks(text).any { it is Block.Heading || it is Block.Table }
}

/** A document's title from its text: its first heading, else its first line. */
internal fun documentTitle(text: String): String =
    DocumentExport.title((parseBlocks(text).firstOrNull { it is Block.Heading } as? Block.Heading)?.text, text)

/** "Open as document" under a long reply, from a server with `document-export`: the reply full screen in the viewer,
 *  with Export. [from]: who wrote it. */
@Composable
fun OpenAsDocument(text: String?, from: String) {
    if (text.isNullOrBlank()) return
    val app = BotDotApp.of(LocalContext.current)
    val server by app.store.version.value.collectAsState()
    if (!DocumentExport.shows(server?.features)) return
    val long = remember(text) { isDocument(text) }
    if (!long) return
    val p = LocalPaper.current
    Row(
        Modifier.padding(top = Space.s12).clip(Radius.pill).border(1.dp, p.line2, Radius.pill)
            .clickable { DocViewer.open = DocViewer.Request(src = "", name = documentTitle(text), from = from, text = text) }
            .padding(horizontal = Space.s12, vertical = Space.s8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(tr("Open as document") + "  ↗", color = p.text, fontSize = Type.s14)
    }
}
