package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/**
 * The picture of a group: its members' heads, the first three, each with the face of its state. One grey head when
 * its bots are all gone. [size]: the side of the square it fills, in dp.
 */
@Composable
fun GroupPicture(members: List<Bot>, size: Int) {
    val heads = members.take(3)
    Box(Modifier.size(size.dp)) {
        when (heads.size) {
            0 -> BotFigure(GONE_COLOR, "idle", size)
            1 -> heads[0].let { BotFigure(it.color, it.state, size, it.outfit) }
            2 -> {
                val head = size * 2 / 3
                Box(Modifier.align(Alignment.TopStart)) { BotFigure(heads[0].color, heads[0].state, head, heads[0].outfit) }
                Box(Modifier.align(Alignment.BottomEnd)) { BotFigure(heads[1].color, heads[1].state, head, heads[1].outfit) }
            }
            else -> {
                val head = size * 4 / 7
                Box(Modifier.align(Alignment.TopCenter)) { BotFigure(heads[0].color, heads[0].state, head, heads[0].outfit) }
                Box(Modifier.align(Alignment.BottomStart)) { BotFigure(heads[1].color, heads[1].state, head, heads[1].outfit) }
                Box(Modifier.align(Alignment.BottomEnd)) { BotFigure(heads[2].color, heads[2].state, head, heads[2].outfit) }
            }
        }
    }
}

/** A team's chat (#697, #705): up to three faces in a row, the lead first with the crown (as the web page draws it). */
@Composable
fun TeamPicture(faces: List<Bot>, lead: String?, size: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        if (faces.isEmpty()) BotFigure(GONE_COLOR, "idle", size)
        faces.forEachIndexed { i, b ->
            Box {
                BotFigure(b.color, b.state, size, b.outfit)
                if (i == 0 && b.id == lead && faces.size > 1) Crown(Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-6).dp))
            }
        }
    }
}

/**
 * A very small plus with no words: a round mark 28 dp wide in a touch target of 40 dp, as high as the buttons of a
 * chat's top, named [label] for a screen reader.
 */
@Composable
internal fun SmallPlus(label: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Box(
        Modifier.size(40.dp).clip(CircleShape).clickable(onClickLabel = label, role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(28.dp).clip(CircleShape).background(p.sunk).border(1.dp, p.line2, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = p.text, modifier = Modifier.size(16.dp))
        }
    }
}

/**
 * The picker of bots: rows to tick, at most [max], and with [name] a name to give. [done] saves what was picked, in
 * the order it was ticked, and throws with the botdot server's sentence when it is refused: the sentence is then
 * shown here, with nothing lost. [hint]: the line under the rows, by how many are ticked.
 */
@Composable
fun BotPicker(title: String, bots: List<Bot>, max: Int, action: String, hint: (Int) -> String, name: String? = null, onDismiss: () -> Unit, done: suspend (picked: List<String>, name: String) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var picked by remember { mutableStateOf(listOf<String>()) } // in the order they were ticked: the group's order
    var named by remember { mutableStateOf(name.orEmpty()) }
    var refused by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        containerColor = p.panel,
        title = { Text(title, style = MaterialTheme.typography.titleMedium, color = p.text) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                if (name != null) Field(named, { named = it.take(60) }, label = { Text(tr("Name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                    bots.forEach { b ->
                        val on = b.id in picked
                        val can = on || picked.size < max // full: nothing more can be ticked
                        Row(Modifier.fillMaxWidth().clickable(enabled = can, role = Role.Checkbox) { picked = if (on) picked - b.id else picked + b.id }.padding(vertical = Space.s4),
                            verticalAlignment = Alignment.CenterVertically) {
                            BotFigure(b.color, "idle", 32, b.outfit)
                            Spacer(Modifier.size(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(b.name, color = if (can) p.text else p.faint, fontSize = Type.s16, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                if (b.description.isNotBlank()) Text(b.description, color = p.faint, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Checkbox(on, null, enabled = can, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText))
                        }
                    }
                }
                Text(hint(picked.size), color = p.faint, fontSize = Type.s12)
                refused?.let { Text(it, color = p.err, fontSize = Type.s14, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            }
        },
        confirmButton = {
            TextButton(enabled = picked.isNotEmpty() && !saving, onClick = {
                saving = true
                refused = null
                scope.launch {
                    runCatching { done(picked, named) }.onSuccess { onDismiss() }.onError { refused = it.message ?: tr("That didn't work") }
                    saving = false
                }
            }) { Text(action, color = if (picked.isNotEmpty() && !saving) p.text else p.faint) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text(tr("Cancel"), color = p.text) } },
    )
}
