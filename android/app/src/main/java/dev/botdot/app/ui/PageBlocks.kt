package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Block
import dev.botdot.app.data.PagePart
import dev.botdot.app.data.Pages
import dev.botdot.app.data.tr

/*
 * A bot's page with blocks (#395; the web page's pageHTML in public/blocks.js): its Markdown with the chat's own
 * renderer, and its blocks with the Board's block kit (BlockKit.kt): a hero at its top, kpis and charts on cards,
 * status pills and callouts, a table (#396), grids of them side by side, and a quiet line for a block that cannot be drawn.
 * lib/page-blocks.js fills them in; this only draws them.
 */
@Composable
fun PageParts(parts: List<PagePart>) {
    Column(verticalArrangement = Arrangement.spacedBy(Space.s16)) {
        parts.forEach { part ->
            when {
                part.md != null -> MarkdownText(part.md, onWeb = null, paths = null)
                part.block != null -> PageBlock(part.block)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PageBlock(b: Block) {
    val p = LocalPaper.current
    when (b.type) {
        "hero" -> Column(Modifier.padding(top = Space.s4), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            b.eyebrow?.let { Text(it.uppercase(), color = p.faint, fontSize = Type.s12, letterSpacing = Type.wide, fontFamily = FontFamily.Monospace) }
            Text(b.title.orEmpty(), color = p.text, fontSize = Type.s24, lineHeight = Type.line32, fontWeight = FontWeight.SemiBold)
            b.lead?.let { Text(it, color = p.muted, fontSize = Type.s16, lineHeight = Type.line24) }
            if (b.tags.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                b.tags.forEach { Text(it, color = p.muted, fontSize = Type.s12, modifier = Modifier.clip(Radius.pill).background(p.sunk).padding(horizontal = Space.s12, vertical = Space.s4)) }
            }
        }
        "kpi" -> PageCard { KitKpi(b, tint(b.color, p.mention), compact = false) }
        "chart" -> PageCard { KitChart(b, tint(b.color, p.mention), axes = true) }
        "status" -> KitStatus(b)
        "callout" -> KitCallout(b)
        "table" -> PageCard { KitTableView(b) }
        "grid" -> if (b.blocks.all { it.type == "status" }) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) { b.blocks.forEach { KitStatus(it) } }
        } else BoxWithConstraints {
            val wide = maxWidth >= 600.dp
            Column(verticalArrangement = Arrangement.spacedBy(Space.s12)) {
                Pages.rows(b.blocks, b.columns, wide).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                        row.forEach { x -> Column(Modifier.weight(1f)) { PageBlock(x) } }
                    }
                }
            }
        }
        else -> Text(tr("This block could not be drawn"), color = p.faint, fontSize = Type.s12, fontStyle = FontStyle.Italic)
    }
}

/** A kpi's or a chart's card, as a tile is drawn. */
@Composable
private fun PageCard(content: @Composable () -> Unit) {
    val p = LocalPaper.current
    val shape = Radius.card
    Column(Modifier.fillMaxWidth().clip(shape).background(p.panel).border(1.dp, p.line, shape).padding(horizontal = Space.s16, vertical = Space.s16)) {
        content()
    }
}
