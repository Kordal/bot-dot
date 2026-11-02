package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Spaces
import dev.botdot.app.data.tr

/**
 * The spaces (#836, #840) as the screens draw them: [list] the projects with their counts, [current] the space on
 * screen ([Spaces.HOME] or a project's id). [pick] opens a space, [new] starts a project with today's setup. Empty
 * [list]: no rail, no sheet, and the title is the logo alone.
 */
internal class SpaceWays(val list: List<Spaces.Space>, val current: String, val pick: (String) -> Unit, val new: () -> Unit) {
    val shown: Boolean get() = list.isNotEmpty()
    val project: Spaces.Space? get() = list.firstOrNull { it.id == current }
}

internal const val SPACE_RAIL = "space-rail"
internal const val SPACE_SHEET = "space-sheet"
internal const val SPACE_TITLE = "space-title"
private val RAIL_WIDTH = 76.dp

/** A project's square: its colour, its first letter. */
@Composable
internal fun SpaceSquare(name: String, color: String, size: Dp) {
    val p = LocalPaper.current
    val fill = parseColor(color, p.muted)
    Box(Modifier.size(size).clip(Radius.small).background(fill), contentAlignment = Alignment.Center) {
        Text(name.take(1).uppercase(), color = inkOn(fill), fontSize = if (size >= 40.dp) Type.s16 else Type.s12, fontWeight = FontWeight.SemiBold)
    }
}

/** What waits in a space, as a small white count; nothing while nothing waits. */
@Composable
internal fun SpaceCount(n: Int, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    if (n > 0) Text(n.toString(), color = p.inkText, fontSize = Type.s12, fontWeight = FontWeight.SemiBold,
        modifier = modifier.clip(Radius.pill).background(p.ink).padding(horizontal = 6.dp))
}

/**
 * A phone's title (C-4, C-5): the logo on Home, a project's square and name in a project, with a chevron that opens
 * the sheet of spaces. Without projects: the logo alone, as before.
 */
@Composable
internal fun SpaceTitle(ways: SpaceWays?, busy: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    val project = ways?.project
    if (ways == null || !ways.shown) return Box(modifier) { Logo(busy = busy) }
    Row(modifier.clip(Radius.small).clickable(onClickLabel = tr("Projects"), role = Role.Button, onClick = onOpen).padding(vertical = Space.s4).testTag(SPACE_TITLE),
        verticalAlignment = Alignment.CenterVertically) {
        if (project == null) Logo(busy = busy)
        else {
            SpaceSquare(project.name, project.color, 28.dp)
            Text(project.name, color = p.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = Space.s8).weight(1f, fill = false))
        }
        Icon(Icons.Outlined.ExpandMore, null, tint = p.muted, modifier = Modifier.padding(start = Space.s4).size(20.dp))
    }
}

/** The sheet the title opens (C-6): Home, each project with its count, New project. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SpaceSheet(ways: SpaceWays, onDismiss: () -> Unit) {
    val p = LocalPaper.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = p.panel) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = Space.s12, vertical = Space.s8).testTag(SPACE_SHEET)) {
            SheetRow(here = ways.current == Spaces.HOME, label = tr("Home"), onClick = { onDismiss(); ways.pick(Spaces.HOME) }) {
                Box(Modifier.size(36.dp).clip(Radius.small).background(p.sunk), contentAlignment = Alignment.Center) { Logo(size = Type.s12) }
            }
            ways.list.forEach { s ->
                SheetRow(here = ways.current == s.id, label = s.name, count = s.asks, onClick = { onDismiss(); ways.pick(s.id) }) { SpaceSquare(s.name, s.color, 36.dp) }
            }
            SheetRow(here = false, label = tr("New project"), onClick = { onDismiss(); ways.new() }) {
                Box(Modifier.size(36.dp).clip(Radius.small).border(1.dp, p.line2, Radius.small), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Add, null, tint = p.muted, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
private fun SheetRow(here: Boolean, label: String, count: Int = 0, onClick: () -> Unit, mark: @Composable () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(Radius.card).background(if (here) p.sunk else Color.Transparent)
        .clickable(onClickLabel = label, onClick = onClick).semantics { selected = here }.padding(horizontal = Space.s12, vertical = Space.s8),
        verticalAlignment = Alignment.CenterVertically) {
        mark()
        Text(label, color = p.text, fontSize = Type.s16, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s16).weight(1f))
        SpaceCount(count)
    }
}

/**
 * The rail from 840 dp (C-1, C-2): Home (the logo), one square per project with its count, "+" for a new project,
 * then search and settings at the bottom. A short bar at its left edge marks the space on screen. Shown only while
 * there are projects.
 */
@Composable
internal fun SpaceRail(ways: SpaceWays, busy: Boolean, onSearch: () -> Unit, onSettings: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxHeight()) {
        Column(Modifier.width(RAIL_WIDTH).fillMaxHeight().statusBarsPadding().navigationBarsPadding().padding(vertical = Space.s12).testTag(SPACE_RAIL),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            RailItem(here = ways.current == Spaces.HOME, label = tr("Home"), onClick = { ways.pick(Spaces.HOME) }) {
                Box(Modifier.size(44.dp).clip(Radius.card).background(p.sunk), contentAlignment = Alignment.Center) { Logo(size = Type.s14, busy = busy) }
            }
            Box(Modifier.width(28.dp).padding(vertical = Space.s4).heightIn(min = 1.dp, max = 1.dp).background(p.line))
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s12)) {
                ways.list.forEach { s ->
                    RailItem(here = ways.current == s.id, label = s.name, onClick = { ways.pick(s.id) }) {
                        Box {
                            SpaceSquare(s.name, s.color, 44.dp)
                            SpaceCount(s.asks, Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-6).dp))
                        }
                    }
                }
                RailItem(here = false, label = tr("New project"), onClick = ways.new) {
                    Box(Modifier.size(44.dp).clip(Radius.card).border(1.dp, p.line2, Radius.card), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Add, null, tint = p.muted, modifier = Modifier.size(20.dp))
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            RoundButton(Icons.Filled.Search, tr("Search"), onClick = onSearch)
            RoundButton(Icons.Filled.Settings, tr("Settings"), onClick = onSettings)
        }
        Box(Modifier.width(1.dp).fillMaxHeight().background(p.line))
    }
}

@Composable
private fun RailItem(here: Boolean, label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    Box(Modifier.width(RAIL_WIDTH), contentAlignment = Alignment.Center) {
        if (here) Box(Modifier.align(Alignment.CenterStart).width(3.dp).heightIn(min = 20.dp, max = 20.dp).clip(Radius.pill).background(p.text))
        Box(Modifier.clip(Radius.card).clickable(onClickLabel = label, role = Role.Button, onClick = onClick).semantics { contentDescription = label; selected = here }) { content() }
    }
}

/**
 * A space's chat field at the bottom of a phone's project (C-5), as the Chief's is on Home: its faces and its name,
 * a tap opens that chat.
 */
@Composable
internal fun SpaceChatField(name: String, unread: Int, color: String?, onClick: () -> Unit, picture: @Composable () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = Space.s12, vertical = Space.s8).raised(Radius.pill)
        .clickable(onClickLabel = name, onClick = onClick).padding(horizontal = Space.s12, vertical = Space.s8).testTag(SPACE_CHAT_FIELD),
        verticalAlignment = Alignment.CenterVertically) {
        picture()
        Spacer(Modifier.width(Space.s12))
        Text(name, color = p.faint, fontSize = Type.s16, maxLines = 1, modifier = Modifier.weight(1f))
        UnreadDots(unread, color ?: CHIEF_COLOR)
    }
}

internal const val SPACE_CHAT_FIELD = "space-chat-field"
