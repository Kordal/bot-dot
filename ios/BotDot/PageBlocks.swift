import SwiftUI
import BotdotShared

/// A bot's page with blocks (#395; Android's PageParts): its Markdown, and its blocks drawn as the Board draws them:
/// a hero at its top, kpis and charts on cards, status pills and callouts, a table, grids of them side by side, and
/// a quiet line for a block this phone can't draw. lib/page-blocks.js fills them in; this only draws them.
struct PagePartsView: View {
    let parts: [PagePart]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                if let md = part.md {
                    MarkdownView(text: md)
                } else if let b = part.block {
                    PageBlockView(b: b)
                }
            }
        }
    }
}

struct PageBlockView: View {
    let b: Block
    @Environment(\.horizontalSizeClass) private var size

    var body: some View {
        let own = Board.tint(b.color, .accentColor)
        switch b.type {
        case "hero":
            VStack(alignment: .leading, spacing: 8) {
                if let eyebrow = b.eyebrow { Text(eyebrow.uppercased()).font(.caption.monospaced()).tracking(1).foregroundStyle(.tertiary) }
                Text(b.title ?? "").font(.title2.weight(.semibold))
                if let lead = b.lead { Text(lead).foregroundStyle(.secondary) }
                if !b.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(b.tags, id: \.self) { t in
                                Text(t).font(.caption).foregroundStyle(.secondary)
                                    .padding(.horizontal, 12).padding(.vertical, 4)
                                    .background(Color.secondary.opacity(0.12), in: .capsule)
                            }
                        }
                    }
                }
            }
            .padding(.top, 4)
        case "kpi":
            card { Kpi(b: b, color: own, compact: false) }
        case "chart":
            card { ChartBlock(b: b, color: own, tall: true) }
        case "status":
            StatusPill(text: b.text ?? "", level: b.level)
        case "callout":
            CalloutBlock(b: b)
        case "table":
            card { TableBlock(b: b) }
        case "grid":
            if b.blocks.allSatisfy({ $0.type == "status" }) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(Array(b.blocks.enumerated()), id: \.offset) { _, x in StatusPill(text: x.text ?? "", level: x.level) } }
                }
            } else {
                // Side by side as the shared Pages.rows lays them out: up to 4 across on a wide screen, 2 on a phone.
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(Pages.shared.rows(blocks: b.blocks, columns: b.columns, wide: size == .regular).enumerated()), id: \.offset) { _, row in
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, x in PageBlockView(b: x).frame(maxWidth: .infinity, alignment: .leading) }
                        }
                    }
                }
            }
        default:
            Text(tr("This block could not be drawn")).font(.caption).italic().foregroundStyle(.tertiary)
        }
    }

    /// A kpi's, a chart's or a table's card, as a tile is drawn.
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
    }
}
