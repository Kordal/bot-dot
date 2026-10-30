package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Company
import dev.botdot.app.data.ManyProjects
import dev.botdot.app.data.tr

/** The setup header's ⋯ (#800): Delete project, asked in a sheet where the red is. */
@Composable
internal fun SetupMenu(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    Box {
        IconButton({ open = true }) { Icon(Icons.Filled.MoreHoriz, tr("More"), tint = p.muted) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.background(p.raise2)) {
            DropdownMenuItem(text = { Text(tr("Delete project")) }, onClick = { open = false; asking = true })
        }
    }
    if (asking) DeleteSheet(ui, c) { asking = false }
}

/** "Delete <name>?" and the red Delete; with a folder (#702), whether it goes too. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeleteSheet(ui: CompanyUi, c: Company, onClose: () -> Unit) {
    val p = LocalPaper.current
    fun delete(dropFolder: Boolean) { onClose(); deleteProject(ui, c, dropFolder) { ui.step = null } }
    @Composable
    fun Wide(label: String, danger: Boolean, onClick: () -> Unit) = Button(onClick, Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = Radius.pill, elevation = null,
        colors = ButtonDefaults.buttonColors(containerColor = if (danger) p.err else p.fill, contentColor = if (danger) p.inkText else p.text)) {
        Text(label, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
    }
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = p.raise2, dragHandle = null) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            Text(tr("Delete {name}?", "name" to ManyProjects.nameOf(c)), color = p.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = Space.s8))
            if (c.folder != null) {
                Wide(tr("Delete its folder too"), danger = true) { delete(true) }
                Wide(tr("Keep its folder"), danger = false) { delete(false) }
            } else Wide(tr("Delete"), danger = true) { delete(false) }
            Wide(tr("Cancel"), danger = false, onClose)
        }
    }
}
