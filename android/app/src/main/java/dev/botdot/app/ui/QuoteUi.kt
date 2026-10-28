package dev.botdot.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.contextmenu.builder.item
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuItem
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuKeys
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuSession
import androidx.compose.foundation.text.contextmenu.modifier.appendTextContextMenuComponents
import androidx.compose.foundation.text.contextmenu.modifier.filterTextContextMenuComponents
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.LocalClipboard
import dev.botdot.app.data.tr

/**
 * Quote (#97, [dev.botdot.app.data.Quote]): text selected in one message of a chat (the Chief's, a bot's, a group's)
 * has Quote in its selection menu, beside Copy; a tap adds the text to that chat's message box as a Markdown quote,
 * after what was typed, the cursor after it. A selection is always inside one message: each message is a selection of
 * its own. The chat gives its box to the messages as [LocalQuote]; text outside a chat has no Quote.
 */
class QuoteBox {
    /** Text quoted and not yet in the box. The [Composer] takes it. */
    var pending by mutableStateOf<String?>(null)
        private set

    fun quote(text: String) { pending = text }

    fun take(): String? = pending.also { pending = null }
}

val LocalQuote = compositionLocalOf<QuoteBox?> { null }

/** Where Quote's item is in the selection menu. */
private object QuoteKey

/**
 * The selection of one message, with Quote in its menu when the chat has a message box ([LocalQuote]); a plain
 * [SelectionContainer] otherwise. Compose gives a menu item no way to read the selection: Quote runs the menu's own
 * Copy, and the text Copy hands the clipboard goes to the box instead (any other copy reaches the clipboard as before).
 */
@Composable
fun QuotableSelection(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val box = LocalQuote.current
    if (box == null) return SelectionContainer(modifier) { content() }
    val clipboard = LocalClipboard.current
    val taker = remember(clipboard) { TakingClipboard(clipboard) }
    // The menu's Copy, as the menu now shown has it: Quote is that, with the text taken.
    val copy = remember { arrayOfNulls<TextContextMenuSession.() -> Unit>(1) }
    Box(
        modifier
            .filterTextContextMenuComponents { c ->
                if (c is TextContextMenuItem && c.key == TextContextMenuKeys.CopyKey) copy[0] = c.onClick
                true
            }
            .appendTextContextMenuComponents {
                item(QuoteKey, tr("Quote")) {
                    val copyNow = copy[0]
                    if (copyNow != null) {
                        taker.next = { box.quote(it) } // the copy's text, when it comes (it may come after run returns)
                        copyNow()
                    }
                    close()
                }
            },
    ) {
        CompositionLocalProvider(LocalClipboard provides taker) { SelectionContainer { content() } }
    }
}

/** The clipboard, except that a copy made while [next] is set goes to [next] instead. */
private class TakingClipboard(private val real: Clipboard) : Clipboard {
    var next: ((String) -> Unit)? = null

    override suspend fun getClipEntry(): ClipEntry? = real.getClipEntry()

    override suspend fun setClipEntry(clipEntry: ClipEntry?) {
        val take = next ?: return real.setClipEntry(clipEntry)
        next = null
        val data = clipEntry?.clipData
        if (data != null && data.itemCount > 0) data.getItemAt(0).text?.toString()?.let(take)
    }

    @Deprecated("Compose's own: the platform clipboard")
    override val nativeClipboard get() = @Suppress("DEPRECATION") real.nativeClipboard
}
