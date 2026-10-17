package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A card with a title, like the web page's settings cards. Without one where its rows name themselves. */
@Composable
fun Section(title: String?, hint: String? = null, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(
        Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(18.dp)).border(1.dp, p.line, RoundedCornerShape(18.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (title != null) Text(title, style = MaterialTheme.typography.titleMedium, color = p.text)
        if (hint != null) Text(hint, color = p.muted, style = MaterialTheme.typography.bodyMedium)
        content()
    }
}

/** A card like Section that opens and closes with a tap on its title (closed at first). */
@Composable
fun FoldSection(title: String, hint: String? = null, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(18.dp)).border(1.dp, p.line, RoundedCornerShape(18.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = p.text)
                if (hint != null) Text(hint, color = p.muted, style = MaterialTheme.typography.bodyMedium)
            }
            Text(if (open) "▾" else "▸", color = p.faint)
        }
        if (open) content()
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

/** A drop-down to pick one value; "" is the "default" choice. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Choice(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.first == value }?.second ?: value
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = shown, onValueChange = {}, readOnly = true, label = { Text(label) }, singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (id, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { onChange(id); open = false }) }
        }
    }
}
