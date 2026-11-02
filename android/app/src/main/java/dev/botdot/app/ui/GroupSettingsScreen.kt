package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.GROUP_MAX
import dev.botdot.app.data.Group
import dev.botdot.app.data.GroupNote
import dev.botdot.app.data.GroupNotes
import dev.botdot.app.data.str
import dev.botdot.app.data.Groups
import dev.botdot.app.data.tr
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val SPACES = Regex("\\s+")

/** A group's name as it is saved: one line, without the blanks around it. */
internal fun groupName(typed: String): String = typed.replace(SPACES, " ").trim()

/**
 * A group's settings, opened from its chat's title: its name, its members each with a way to take it out, "Add a
 * bot", its notes (ADR 139), and "Delete this group", which says that it deletes no bot. Every change saves by itself, and what the
 * botdot server refuses is said in its words. A team's chat (#697) follows its team in Projects: its panel shows its
 * faces, its members and its notes, and nothing that renames it, changes its members or deletes it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupSettingsScreen(app: BotDotApp, groupId: String, onDeleted: () -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    val groupsNow by app.store.groups.value.collectAsState()
    val botsNow by app.store.bots.value.collectAsState()
    val versionNow by app.store.version.value.collectAsState()
    val bots = botsNow.orEmpty()
    val group = groupsNow?.firstOrNull { it.id == groupId }
    var adding by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }

    // A change to the group, saved at once; the list is read again either way.
    fun change(g: Group, body: JsonObject) = scope.launch {
        runCatching { (app.api.value ?: error(tr("Not connected to botdot"))).updateGroup(g.id, body) }.onError { tell(it.message ?: tr("Couldn't save")) }
        app.store.groups.refresh()
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(navigationIcon = { if (LocalPanelClose.current == null) BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(group?.name.orEmpty(), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) }, actions = { PanelClose() })
        },
    ) { pad ->
        val g = group ?: return@Scaffold
        val members = Groups.members(g, bots)
        val team = g.team != null
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { if (team) TeamPicture(Groups.teamFaces(g, bots), g.lead, 56) else GroupPicture(members, 72) }
            if (!team) GroupName(app, g, ::change)
            Section(tr("Members")) {
                if (members.isEmpty() && !team) Hint(tr("Its bots are all gone. Add one, or delete the group."))
                members.forEach { b ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        BotFigure(b.color, b.state, 32, b.outfit)
                        Spacer(Modifier.size(10.dp))
                        Text(b.name, color = p.text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        if (!team) IconButton(onClick = { change(g, app.api.value?.membersOf(g.members - b.id) ?: return@IconButton) }) {
                            Icon(Icons.Filled.Close, contentDescription = tr("Take {name} out of the group", "name" to b.name), tint = p.muted, modifier = Modifier.size(18.dp))
                        }
                    }
                }
                // Nothing to add: the group is full, or every bot is in it. A team's members follow its team.
                if (!team && Groups.addable(g, bots).isNotEmpty()) SecondaryButton(onClick = { adding = true }) { Text("＋ " + tr("Add a bot"), color = p.text) }
            }
            if (versionNow?.features?.contains(GroupNotes.FEATURE) == true) GroupNotesSection(app, g.id, ::tell)
            if (!team) SecondaryButton(onClick = { askDelete = true }, modifier = Modifier.fillMaxWidth()) { Text(tr("Delete this group"), color = p.err) }
        }
    }

    val g = group
    if (adding && g != null) BotPicker(
        title = tr("Add a bot"), bots = Groups.addable(g, bots).sortedBy { it.name.lowercase() }, max = GROUP_MAX - g.members.size, action = tr("Add"),
        hint = { n -> addHint(n, g.members.size, g.name) }, onDismiss = { adding = false },
    ) { picked, _ ->
        val a = app.api.value ?: error(tr("Not connected to botdot"))
        a.updateGroup(g.id, a.membersOf(g.members + picked))
        app.store.groups.refresh()
    }
    if (askDelete && g != null) AlertDialog(
        onDismissRequest = { askDelete = false },
        title = { Text(tr("Delete the group {name}?", "name" to g.name)) },
        text = { Text(tr("Its chat is erased. No bot is deleted: each keeps its own chat.")) },
        confirmButton = {
            TextButton(onClick = {
                askDelete = false
                scope.launch {
                    runCatching { (app.api.value ?: error(tr("Not connected to botdot"))).deleteGroup(g.id) }
                        .onSuccess { app.store.groups.update { all -> all.filterNot { it.id == g.id } }; onDeleted(); app.store.groups.refresh() }
                        .onError { tell(it.message ?: tr("Couldn't delete")) }
                }
            }) { Text(tr("Delete"), color = p.err) }
        },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text(tr("Keep"), color = p.text) } },
    )
}

/** A group's name, which saves when the keyboard's Done is tapped or the box is left. */
@Composable
private fun GroupName(app: BotDotApp, g: Group, change: (Group, JsonObject) -> Any) {
    // An emptied box takes the old one back.
    var name by remember(g.id) { mutableStateOf(g.name) }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(g.name) { if (!focused) name = g.name } // renamed elsewhere; not under the cursor
    val focus = LocalFocusManager.current
    fun saveName() {
        val to = groupName(name)
        if (to.isEmpty()) name = g.name else if (to != g.name) change(g, buildJsonObject { put("name", to) })
    }
    // The panel was closed with the cursor still in the box: the name typed is saved all the same, by the app,
    // which outlives the panel. A group deleted meanwhile is not in the list, and nothing is sent.
    DisposableEffect(g.id) {
        onDispose {
            val to = groupName(name)
            val now = app.store.groups.value.value?.firstOrNull { it.id == g.id }?.name
            if (to.isNotEmpty() && now != null && to != now) app.scope.launch {
                runCatching { app.api.value?.updateGroup(g.id, buildJsonObject { put("name", to) }) }
                app.store.groups.refresh()
            }
        }
    }
    Field(name, { name = it.take(60) }, label = { Text(tr("Name")) }, singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        modifier = Modifier.fillMaxWidth().onFocusChanged { if (focused && !it.isFocused) saveName(); focused = it.isFocused })
}

/**
 * A group's notes (ADR 139): what was settled in its chat, which every member's turn reads above the chat. Each
 * row is its kind, which a tap changes, its line, which a tap opens to change, and ✕. The last row adds one. Read
 * again when the feed says they changed.
 */
@Composable
private fun GroupNotesSection(app: BotDotApp, groupId: String, tell: (String) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var notes by remember(groupId) { mutableStateOf<List<GroupNote>>(emptyList()) }
    var editing by remember { mutableStateOf<GroupNote?>(null) }
    fun call(block: suspend (dev.botdot.app.data.Api) -> List<GroupNote>) = scope.launch {
        runCatching { block(app.api.value ?: error(tr("Not connected to botdot"))) }.onSuccess { notes = it }.onError { tell(it.message ?: tr("Couldn't save")) }
    }
    LaunchedEffect(groupId) {
        app.api.filterNotNull().first()
        runCatching { app.api.value?.groupNotes(groupId) }.getOrNull()?.let { notes = it }
        app.feed.events.collect { ev ->
            if (ev.type == "group_notes" && ev.data.str("groupId") == groupId) runCatching { app.api.value?.groupNotes(groupId) }.getOrNull()?.let { notes = it }
        }
    }
    Section(tr("Notes")) {
        notes.forEach { n ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                NoteKind(n.kind) { k -> if (k != n.kind) call { it.changeGroupNote(groupId, n.id, kind = k) } }
                Text(n.text, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).clickable { editing = n }.padding(vertical = Space.s8))
                IconButton(onClick = { call { it.removeGroupNote(groupId, n.id) } }) {
                    Icon(Icons.Filled.Close, contentDescription = tr("Remove"), tint = p.muted, modifier = Modifier.size(18.dp))
                }
            }
        }
        var kind by remember { mutableStateOf("decision") }
        var text by remember { mutableStateOf("") }
        val focus = LocalFocusManager.current
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            NoteKind(kind) { kind = it }
            Field(text, { text = it.take(GroupNotes.TEXT_MAX) }, placeholder = { Text(tr("Add a note")) }, singleLine = true, modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = {
                    val t = GroupNotes.clean(text)
                    if (t.isNotEmpty()) { call { it.addGroupNote(groupId, kind, t) }; text = "" }
                    focus.clearFocus()
                }))
        }
    }
    editing?.let { n ->
        var text by remember(n.id) { mutableStateOf(n.text) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(GroupNotes.kindWord(n.kind)) },
            text = { Field(text, { text = it.take(GroupNotes.TEXT_MAX) }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = {
                TextButton(onClick = {
                    editing = null
                    val t = GroupNotes.clean(text)
                    if (t.isEmpty()) call { it.removeGroupNote(groupId, n.id) } else if (t != n.text) call { it.changeGroupNote(groupId, n.id, text = t) }
                }) { Text(tr("Save"), color = p.text) }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(tr("Cancel"), color = p.text) } },
        )
    }
}

/** A note's kind, which a tap opens to choose another. */
@Composable
private fun NoteKind(kind: String, onPick: (String) -> Unit) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(GroupNotes.kindWord(kind), color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1) }
        DropdownMenu(open, { open = false }, containerColor = p.panel) {
            GroupNotes.KINDS.forEach { k -> DropdownMenuItem({ Text(GroupNotes.kindWord(k), color = p.text) }, { open = false; onPick(k) }) }
        }
    }
}
