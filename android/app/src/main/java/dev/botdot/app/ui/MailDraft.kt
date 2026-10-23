package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.ChiefAction
import dev.botdot.app.data.MailDraft
import kotlinx.coroutines.launch

/** A mail draft in the Chief's chat (docs/api.md, "A mail draft", #415): what the card shows, decided once here. */
object MailCard {
    const val SEND = "Send now"
    const val KEEP = "Not now"

    /** The state line, without the sent time: "Sent" is followed by it. A look's draft ([MailDraft.unsaved], #422) is in no mailbox yet. */
    fun state(d: MailDraft) = when {
        d.state == "sent" -> "Sent"
        d.unsaved -> "Not sent"
        d.state == "kept" -> "Kept in Drafts · not sent"
        else -> "In Drafts · not sent"
    }

    /** The buttons on the card: Send now and Not now while it waits, Send now alone once kept, none when sent or folded. */
    fun actions(d: MailDraft) = when {
        d.earlier || d.state == "sent" -> emptyList()
        d.state == "kept" -> listOf(SEND)
        else -> listOf(SEND, KEEP)
    }

    /** A chip of the run that wrote the draft: the card's footer takes its place. */
    fun takesChip(d: MailDraft?, a: ChiefAction) = d?.botId != null && (a.kind == "run" || a.kind == "from") && a.botId == d.botId
}

/**
 * The card: To and Subject, the state, the text, its buttons and the bot in its footer ([bot], with "Screen" when
 * [screen]). An earlier version folds to one line, a sent mail to its header; a tap opens them. [onPick] sends a
 * button's words as the owner's message, with its key, and says whether it went.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MailDraftCard(d: MailDraft, bot: String?, screen: Boolean, onBot: () -> Unit, onScreen: () -> Unit, onPick: suspend (String, String) -> Boolean) {
    val p = LocalPaper.current
    var open by rememberSaveable(d.earlier) { mutableStateOf(!d.earlier) }
    var textShown by rememberSaveable(d.state) { mutableStateOf(d.state != "sent") }
    if (!open) {
        Text("Earlier version · show", color = p.faint, fontSize = 12.5.sp,
            modifier = Modifier.clip(RoundedCornerShape(99.dp)).border(1.dp, p.line2, RoundedCornerShape(99.dp))
                .clickable(role = Role.Button) { open = true }.heightIn(min = 44.dp).padding(horizontal = 14.dp, vertical = 12.dp))
        return
    }
    val scope = rememberCoroutineScope()
    val actions = MailCard.actions(d)
    val keys = remember(actions) { actions.map { messageKey() } }
    var used by remember(actions) { mutableStateOf(false) }
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.padding(end = 32.dp)) {
        Column(Modifier.widthIn(max = 560.dp).fillMaxWidth().clip(shape).background(p.panel).border(1.dp, p.line2, shape).semantics { paneTitle = "Mail draft"; contentDescription = "Mail draft" }) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for ((label, value) in listOf("To" to d.to, "Subject" to d.subject)) Row {
                    Text(label, color = p.faint, fontSize = 13.5.sp, modifier = Modifier.widthIn(min = 60.dp))
                    Text(value, color = p.text, fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (label == "Subject") FontWeight.SemiBold else null)
                }
            }
            HorizontalDivider(color = p.line)
            val sent = d.state == "sent"
            Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = if (sent && bot == null) 12.dp else 0.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (sent) p.ok else p.warn))
                Spacer(Modifier.size(8.dp))
                Text(if (sent) "Sent ${shortTime(d.sentAt)}".trimEnd() else MailCard.state(d), color = if (sent) p.okText else p.muted, fontSize = 12.5.sp)
            }
            if (textShown && d.text.isNotBlank()) Text(d.text, color = p.text, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.holdToCopy(d.text).padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 4.dp))
            if (actions.isNotEmpty() && !used) FlowRow(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                actions.forEachIndexed { i, c ->
                    val pick = { scope.launch { if (onPick(c, keys[i])) used = true }; Unit }
                    if (i == 0) Button(onClick = pick, modifier = Modifier.heightIn(min = 44.dp), colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(c) }
                    else OutlinedButton(onClick = pick, modifier = Modifier.heightIn(min = 44.dp)) { Text(c, color = p.text) }
                }
            }
            if (bot != null) Row(Modifier.padding(start = 16.dp, end = 16.dp, top = if (sent) 2.dp else 0.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(bot, color = p.muted, fontSize = 12.sp, modifier = Modifier.clickable(role = Role.Button, onClick = onBot).heightIn(min = 32.dp).padding(vertical = 8.dp))
                if (screen) {
                    Text(" · ", color = p.faint, fontSize = 12.sp)
                    Text("Screen", color = p.muted, fontSize = 12.sp, modifier = Modifier.clickable(role = Role.Button, onClick = onScreen).heightIn(min = 32.dp).padding(vertical = 8.dp))
                }
            }
        }
        if (!textShown && d.text.isNotBlank()) Text("Show the text", color = p.muted, fontSize = 12.5.sp,
            modifier = Modifier.clickable(role = Role.Button) { textShown = true }.heightIn(min = 44.dp).padding(start = 16.dp, top = 12.dp, bottom = 12.dp))
    }
}
