import SwiftUI
import BotdotShared

/// A table (#396; Android's KitTableView): sorted by a header's tap, searched, filtered on one column and paged, by
/// the shared KitTable. Narrow, it is a list: the first column as the title, a reference under it, a pill on the right.
struct TableBlock: View {
    let b: Block
    // What the owner chose stays when the tile is drawn again with new rows.
    @State private var query = ""
    @State private var filter = ""
    @State private var page = 0
    @State private var sort: TableSort?

    var body: some View {
        let v = KitTable.shared.view(b: b, sort: sort, query: query, filter: filter, page: Int32(page))
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                if let text = b.text { Text(text).font(.subheadline.weight(.semibold)) }
                Text("\(b.rows.count)").font(.caption.monospaced()).foregroundStyle(.tertiary)
            }
            if b.search {
                TextField(tr("Search"), text: Binding(get: { query }, set: { query = $0; page = 0 }))
                    .font(.subheadline)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color.secondary.opacity(0.12), in: .capsule)
            }
            if let f = b.filter {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach([""] + f.options, id: \.self) { o in
                            let on = o.caseInsensitiveCompare(filter) == .orderedSame
                            Button(o.isEmpty ? tr("All") : o) { filter = o; page = 0 }
                                .buttonStyle(.plain)
                                .font(.caption).foregroundStyle(on ? .primary : .secondary)
                                .padding(.horizontal, 12).padding(.vertical, 4)
                                .background(on ? Color.secondary.opacity(0.2) : .clear, in: .capsule)
                        }
                    }
                    .padding(4)
                    .background(Color.secondary.opacity(0.12), in: .capsule)
                }
            }
            if b.rows.isEmpty {
                Text(tr("No rows")).font(.subheadline).foregroundStyle(.tertiary)
            } else if v.matching == 0 {
                Text(tr("Nothing matches")).font(.subheadline).foregroundStyle(.tertiary)
            } else {
                ViewThatFits(in: .horizontal) {
                    grid(v).frame(minWidth: 560)
                    list(v)
                }
            }
            HStack {
                Text(KitTable.shared.count(v: v)).font(.caption).foregroundStyle(.tertiary)
                Spacer()
                if v.pages > 1 {
                    Button("‹") { page = Int(v.page) - 1 }.disabled(v.page == 0)
                    Text("\(v.page + 1) / \(v.pages)").font(.caption.monospaced()).foregroundStyle(.tertiary)
                    Button("›") { page = Int(v.page) + 1 }.disabled(v.page >= v.pages - 1)
                }
            }
            .buttonStyle(.borderless)
        }
    }

    private static let right: Set<String> = ["number", "date"]

    private func grid(_ v: KitTable.View) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
            GridRow {
                ForEach(Array(b.head.enumerated()), id: \.offset) { i, h in
                    let on = v.sort?.column == Int32(i)
                    Button(h.label + (on ? (v.sort?.dir == "desc" ? " ▼" : " ▲") : "")) {
                        sort = KitTable.shared.next(now: sort ?? b.sort, column: Int32(i)); page = 0
                    }
                    .buttonStyle(.plain)
                    .font(.caption).foregroundStyle(on ? .primary : .tertiary).lineLimit(1)
                    .gridColumnAlignment(Self.right.contains(h.type) ? .trailing : .leading)
                }
            }
            Divider()
            ForEach(Array(v.rows.enumerated()), id: \.offset) { _, r in
                GridRow {
                    ForEach(Array(b.head.enumerated()), id: \.offset) { i, h in
                        TableCellView(c: i < r.count ? r[i] : TableCell(text: "", n: nil, level: nil, refs: []), type: h.type, soft: i > 0)
                    }
                }
                Divider()
            }
        }
    }

    private func list(_ v: KitTable.View) -> some View {
        let cols = KitTable.shared.listColumns(b: b)
        let ref = cols.first?.intValue, stat = cols.second?.intValue
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(v.rows.enumerated()), id: \.offset) { _, r in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.first?.text ?? "").font(.subheadline)
                        if let i = ref, i < r.count, !r[i].text.isEmpty { TableCellView(c: r[i], type: "ref", soft: false) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let i = stat, i < r.count, !r[i].text.isEmpty { StatusPill(text: r[i].text, level: r[i].level) }
                }
                .padding(.vertical, 12)
                Divider()
            }
        }
    }
}

/// One cell: a status pill, references (a link opens), or its text.
private struct TableCellView: View {
    let c: TableCell
    let type: String
    let soft: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        if c.text.isEmpty {
            EmptyView()
        } else if type == "status" {
            StatusPill(text: c.text, level: c.level)
        } else if type == "ref" {
            let refs = c.refs.isEmpty ? [TableRef(text: c.text, url: nil)] : c.refs
            HStack(spacing: 0) {
                ForEach(Array(refs.enumerated()), id: \.offset) { i, r in
                    if i > 0 { Text(" · ").foregroundStyle(.tertiary) }
                    if let s = r.url, s.hasPrefix("https://") || s.hasPrefix("http://"), let url = URL(string: s) {
                        Button(r.text) { openURL(url) }.buttonStyle(.plain).foregroundStyle(.tint)
                    } else {
                        Text(r.text).foregroundStyle(.tint)
                    }
                }
            }
            .font(.caption.monospaced())
        } else {
            Text(c.text).font(soft ? .caption : .subheadline).foregroundStyle(soft ? .secondary : .primary)
        }
    }
}

/// A status pill: its dot and words in its level's colour.
struct StatusPill: View {
    let text: String
    let level: String?

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Board.level(level)).frame(width: 6, height: 6)
            Text(text).font(.caption).lineLimit(1)
        }
        .foregroundStyle(Board.level(level))
        .padding(.horizontal, 12).padding(.vertical, 4)
        .background(Board.level(level).opacity(0.15), in: .capsule)
    }
}

/// A picture (a camera snapshot; Android's TileImage): the old one stays until the new one is in, so it doesn't blink.
struct PictureBlock: View {
    let b: Block
    let model: BoardModel
    @State private var image: UIImage?

    var body: some View {
        let h: CGFloat = b.height == "small" ? 90 : b.height == "large" ? 280 : 160
        ZStack {
            Color.secondary.opacity(0.12)
            if let image {
                if b.fit == "contain" {
                    Image(uiImage: image).resizable().scaledToFit()
                } else {
                    Image(uiImage: image).resizable().scaledToFill()
                }
            }
        }
        .frame(maxWidth: .infinity).frame(height: h)
        .clipShape(.rect(cornerRadius: 12))
        .task(id: b.src) {
            guard let src = b.src, let path = await model.picture(src) else { return }
            if let shown = await Task.detached(operation: { UIImage(contentsOfFile: path)?.preparingThumbnail(of: CGSize(width: 900, height: 900)) }).value {
                image = shown
            }
        }
    }
}
