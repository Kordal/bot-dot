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
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
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
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay

/**
 * A group of rows (#636): its name, small and muted, over them, with no card around it; without one where its rows
 * name themselves. [hint]: a line under the name, only where the screen cannot do without it (an invite, the Vault's
 * setup); settings have none.
 */
@Composable
fun Section(title: String?, hint: String? = null, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(modifier.fillMaxWidth().padding(top = Space.s8, bottom = Space.s4), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        if (title != null) Text(title, color = p.muted, fontSize = Type.s14, fontWeight = FontWeight.Medium)
        if (hint != null) Text(hint, color = p.muted, style = MaterialTheme.typography.bodyMedium)
        content()
    }
}

/** Whether a row stands in a [SettingsGroup], whose surface holds its rows together without a line between them (#728). */
val LocalInGroup = staticCompositionLocalOf { false }

/**
 * A group of settings rows (#728), as on the web page: one raised surface with no line between its rows, a larger gap
 * between two groups (the screen's) than between two rows (none).
 */
@Composable
fun SettingsGroup(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth().raised(Radius.card).padding(horizontal = Space.s16)) {
        CompositionLocalProvider(LocalInGroup provides true) { content() }
    }
}

/**
 * A row of settings (#636): its name, its [value] in a word or a few, and a chevron; a tap opens what it holds under
 * it (closed at first, unless [startOpen]). A thin line under it where it stands in no [SettingsGroup].
 */
@Composable
fun FoldSection(title: String, value: String? = null, startOpen: Boolean = false, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    var open by remember(startOpen) { mutableStateOf(startOpen) } // asked open again (a skill's chip), it opens again
    val turn by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(onClickLabel = if (open) tr("Close") else tr("Open")) { open = !open }.padding(vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            if (!value.isNullOrBlank()) Text(value, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = Space.s12).widthIn(max = 200.dp))
            Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12).rotate(turn))
        }
        Unfold(open) { Column(Modifier.padding(bottom = Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) { content() } }
        Rule()
    }
}

@Composable
fun Hint(text: String) = Text(text, color = LocalPaper.current.muted, style = MaterialTheme.typography.bodyMedium)

/** A label (and a short explanation) with an on/off switch. */
@Composable
fun SwitchRow(label: String, sub: String? = null, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled) { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = Space.s12)) {
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
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        options.forEach { (id, label) ->
            val on = id == selected
            Text(label, color = if (on) p.inkText else p.text, fontSize = Type.s14,
                modifier = Modifier.clip(Radius.pill).background(if (on) p.ink else p.sunk).clickable { onSelect(id) }.padding(horizontal = Space.s16, vertical = Space.s8))
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
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClickLabel = label) { open = true }.padding(vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Text(shown, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s12).widthIn(max = 220.dp))
            Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.background(p.panel)) {
            options.forEach { (id, text) -> DropdownMenuItem(text = { Text(text, color = if (id == value) p.text else p.muted) }, onClick = { onChange(id); open = false }) }
        }
    }
}

/** The thin line between rows of a flat list (#636); none in a [SettingsGroup] (#728). */
@Composable
fun Rule() { if (!LocalInGroup.current) Box(Modifier.fillMaxWidth().height(1.dp).background(LocalPaper.current.line)) }

/** A row that opens another screen, as in a [SettingsGroup] (#728): its name, its [value] and a chevron. */
@Composable
fun LinkRow(label: String, value: String? = null, valueColor: Color? = null, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(onClick = onClick).padding(vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (!value.isNullOrBlank()) Text(value, color = valueColor ?: p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = Space.s12).widthIn(max = 220.dp))
        Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12))
    }
}

/** "Saved" in a screen's top bar for two seconds after each save (#636): [count] goes up by one per save. */
@Composable
fun SavedMark(count: Int) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(count) { if (count > 0) { shown = true; delay(2_000); shown = false } }
    if (shown) Text(dev.botdot.app.data.tr("Saved"), color = LocalPaper.current.muted, fontSize = Type.s14, modifier = Modifier.padding(end = Space.s16).semantics { liveRegion = LiveRegionMode.Polite })
}

