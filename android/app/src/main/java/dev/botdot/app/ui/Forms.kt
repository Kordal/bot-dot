package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * A group of rows (#636): its name, small and muted, over them, with no card around it; without one where its rows
 * name themselves. [hint]: a line under the name, only where the screen cannot do without it (an invite, the Vault's
 * setup); settings have none.
 */
@Composable
fun Section(title: String?, hint: String? = null, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (title != null) Text(title, color = p.muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        if (hint != null) Text(hint, color = p.muted, style = MaterialTheme.typography.bodyMedium)
        content()
    }
}

/**
 * A row of settings (#636): its name, its [value] in a word or a few, and a chevron; a tap opens what it holds under
 * it (closed at first, unless [startOpen]). A thin line under it, as the flat list of the web page.
 */
@Composable
fun FoldSection(title: String, value: String? = null, startOpen: Boolean = false, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    var open by remember(startOpen) { mutableStateOf(startOpen) } // asked open again (a skill's chip), it opens again
    val turn by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(onClickLabel = if (open) "Close" else "Open") { open = !open }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            if (!value.isNullOrBlank()) Text(value, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 12.dp).widthIn(max = 200.dp))
            Text("›", color = p.faint, fontSize = 18.sp, modifier = Modifier.padding(start = 10.dp).rotate(turn))
        }
        Unfold(open) { Column(Modifier.padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() } }
        Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
    }
}

@Composable
fun Hint(text: String) = Text(text, color = LocalPaper.current.muted, style = MaterialTheme.typography.bodyMedium)

/** A label (and a short explanation) with an on/off switch. */
@Composable
fun SwitchRow(label: String, sub: String? = null, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled) { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(label, color = if (enabled) p.text else p.faint, style = MaterialTheme.typography.bodyLarge)
            if (sub != null) Text(sub, color = p.muted, style = MaterialTheme.typography.bodySmall)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled, colors = switchColors())
    }
}

@Composable
fun switchColors() = LocalPaper.current.let { p ->
    SwitchDefaults.colors(checkedTrackColor = p.ok, checkedThumbColor = Color.White, uncheckedTrackColor = p.line2, uncheckedBorderColor = p.line2, uncheckedThumbColor = p.faint)
}

/** Pick one of a few options, as a row of chips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Chips(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    val p = LocalPaper.current
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { (id, label) ->
            val on = id == selected
            Text(label, color = if (on) p.inkText else p.text, fontSize = 13.5.sp,
                modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(if (on) p.ink else p.sunk).clickable { onSelect(id) }.padding(horizontal = 14.dp, vertical = 7.dp))
        }
    }
}

/** A row to pick one value (#636): its name, the value picked and a chevron; a tap opens the choices. "" is the "default" choice. */
@Composable
fun Choice(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == value }?.second ?: value
    Box {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClickLabel = label) { open = true }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Text(shown, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 12.dp).widthIn(max = 220.dp))
            Text("›", color = p.faint, fontSize = 18.sp, modifier = Modifier.padding(start = 10.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.background(p.panel)) {
            options.forEach { (id, text) -> DropdownMenuItem(text = { Text(text, color = if (id == value) p.text else p.muted) }, onClick = { onChange(id); open = false }) }
        }
    }
}

/** The thin line between rows of a flat list (#636). */
@Composable
fun Rule() = Box(Modifier.fillMaxWidth().height(1.dp).background(LocalPaper.current.line))

/** "Saved" in a screen's top bar for two seconds after each save (#636): [count] goes up by one per save. */
@Composable
fun SavedMark(count: Int) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(count) { if (count > 0) { shown = true; delay(2_000); shown = false } }
    if (shown) Text(dev.botdot.app.data.tr("Saved"), color = LocalPaper.current.muted, fontSize = 14.sp, modifier = Modifier.padding(end = 16.dp).semantics { liveRegion = LiveRegionMode.Polite })
}

