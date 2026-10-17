import SwiftUI
import Charts
import UniformTypeIdentifiers
import BotDotKit

/// A colour from a tile's look: "#rrggbb", one of the theme's (ok, warn, bad, muted, faint, text), or the
/// tile's own (its colour, or its bot's). `words` takes ok's and warn's text shades.
@MainActor
func tileTint(_ c: String?, _ t: Tile, _ store: Store, words: Bool = false) -> Color {
    switch c {
    case "ok": return words ? Theme.okText : Theme.ok
    case "warn": return words ? Theme.warnText : Theme.warn
    case "bad": return Theme.err
    case "muted": return Theme.muted
    case "faint": return Theme.faint
    case "text": return Theme.text
    case let hex? where hex.hasPrefix("#"): return Color(hex: hex)
    default: return tileColor(t, store)
    }
}

/// A tile's colour: its own, or its bot's; a group takes its tiles' bot's (the Chief's when mixed).
@MainActor
func tileColor(_ t: Tile, _ store: Store) -> Color {
    if let c = t.color { return Color(hex: c) }
    var bot = t.bot
    if t.kind == "group" {
        let owners = Set(store.dashboard.tiles.filter { $0.parent == t.id }.compactMap(\.bot))
        bot = owners.count == 1 ? owners.first : nil
    }
    return store.bots.first { $0.id == bot }.map { Color(hex: $0.color) } ?? Theme.chief
}

/// The Dashboard: tiles for the things you use most, under short headings. Built and changed by the
/// Chief (and bots); here you use them, drag them where you like, and remove them.
struct DashboardView: View {
    @Environment(Store.self) private var store
    @AppStorage("dash-open") private var openJSON = "[]"
    @State private var panel: String?
    @State private var removing: Tile?

    private var openGroups: Set<String> { Set((try? JSONDecoder().decode([String].self, from: Data(openJSON.utf8))) ?? []) }

    var body: some View {
        let d = store.dashboard
        let loose = d.tiles.filter { $0.parent == nil }
        let sections = [("", loose.filter { ($0.section ?? "").isEmpty })] + d.sections.map { s in (s, loose.filter { $0.section == s }) }
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Board").font(.geist(size: 26, weight: .bold)).kerning(-0.78)
                if d.tiles.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Switches, buttons and values for the things you use most, like a light, the temperature, or a server's disk.")
                        Text("Ask the Chief or any bot to add one, for example: ") + Text("“Add a switch for the living room light.”").italic() + Text(" They can also move, resize or remove tiles for you.")
                        Text("Bots will also suggest tiles when they notice you often ask for the same thing.")
                    }
                    .foregroundStyle(Theme.muted).frame(maxWidth: 560, alignment: .leading)
                }
                ForEach(sections.filter { !$0.1.isEmpty }, id: \.0) { name, tiles in
                    if !name.isEmpty { Text(name).font(.geist(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).padding(.top, 6) }
                    TileGrid {
                        ForEach(tiles) { t in
                            TileView(tile: t, waiting: d.waits(t), open: openGroups.contains(t.id), panel: $panel,
                                     toggleGroup: { toggle(t.id) }, remove: { removing = t })
                                .tileSpan(t.size ?? "small")
                                .modifier(TileDrag(tile: t, section: name, parent: nil))
                            if t.kind == "group" && openGroups.contains(t.id) {
                                GroupInside(group: t, pending: d.pending, panel: $panel, remove: { removing = $0 })
                                    .tileSpan("row")
                            }
                        }
                    }
                    .modifier(GridDrop(section: name, parent: nil))
                }
                if !d.suggestions.isEmpty {
                    Text("Suggested").font(.geist(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).padding(.top, 6)
                    TileGrid {
                        ForEach(d.suggestions) { s in SuggestedTile(suggestion: s).tileSpan(s.tile.wide == true ? "wide" : "small") }
                    }
                }
            }
            .frame(maxWidth: 1100, alignment: .leading)
            .padding(.horizontal, 40).padding(.vertical, 30)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        // While it's on screen, the stale tiles are read again every little while.
        .task {
            while !Task.isCancelled {
                await store.loadDashboard()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .confirmationDialog(removeTitle, isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            if let t = removing {
                let inside = store.dashboard.tiles.filter { $0.parent == t.id }.count
                if inside > 0 {
                    Button("Only the group") { remove(t, all: false) }
                    Button("The group and its tiles", role: .destructive) { remove(t, all: true) }
                } else {
                    Button("Remove", role: .destructive) { remove(t, all: false) }
                }
            }
        } message: {
            if let t = removing, case let n = store.dashboard.tiles.filter({ $0.parent == t.id }).count, n > 0 {
                Text("It holds \(n == 1 ? "one tile" : "\(n) tiles").")
            }
        }
    }

    private var removeTitle: String {
        guard let t = removing else { return "" }
        return store.dashboard.tiles.contains { $0.parent == t.id } ? "Remove “\(t.title)”?" : "Remove “\(t.title)” from your Board?"
    }

    private func toggle(_ id: String) {
        var s = openGroups
        if s.contains(id) { s.remove(id) } else { s.insert(id) }
        openJSON = (try? String(data: JSONEncoder().encode(Array(s)), encoding: .utf8)) ?? "[]"
    }

    private func remove(_ t: Tile, all: Bool) {
        removing = nil
        Task { do { try await store.removeTile(t.id, all: all) } catch { store.problem = error.localizedDescription } }
    }
}

/// An open group's tiles, right below it across the whole width.
struct GroupInside: View {
    let group: Tile
    let pending: [Tile]
    @Binding var panel: String?
    let remove: (Tile) -> Void
    @Environment(Store.self) private var store

    var body: some View {
        let inside = store.dashboard.tiles.filter { $0.parent == group.id }
        VStack(alignment: .leading) {
            if inside.isEmpty { Text("Nothing in it yet.").foregroundStyle(Theme.faint) }
            TileGrid {
                ForEach(inside) { t in
                    TileView(tile: t, waiting: store.dashboard.waits(t), open: false, panel: $panel, toggleGroup: {}, remove: { remove(t) })
                        .tileSpan(t.size ?? "small")
                        .modifier(TileDrag(tile: t, section: group.section ?? "", parent: group.id))
                }
            }
            .modifier(GridDrop(section: group.section ?? "", parent: group.id))
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 18).fill(Theme.sunk.opacity(0.6)))
    }
}

/// One tile: its dot and title, then what its look says to draw. A click does its thing; right-click
/// removes it.
struct TileView: View {
    let tile: Tile
    let waiting: Bool
    let open: Bool
    @Binding var panel: String?
    let toggleGroup: () -> Void
    let remove: () -> Void
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var note: String?
    @State private var popped = false

    var body: some View {
        let look = tile.look
        // Not a Button: a button holds on to the mouse, so the tile couldn't be dragged.
        VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    if tile.kind != "group", let dot = look?.dot { TileDotView(dot: dot, tile: tile) }
                    Text(tile.title).font(.geist(size: 13.5, weight: .semibold)).lineLimit(2).multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                if tile.kind == "group" {
                    // One dot per tile inside (filled when on, in its own colour).
                    let inside = store.dashboard.tiles.filter { $0.parent == tile.id }
                    HStack(spacing: 5) {
                        if inside.isEmpty { Text("·").foregroundStyle(Theme.faint) }
                        ForEach(inside) { x in GroupDot(tile: x) }
                    }
                } else {
                    BlocksView(blocks: look?.face ?? [], tile: tile, where: "face", openPanel: { panel = tile.id })
                }
                Spacer(minLength: 0)
                if let n = waiting ? "Waiting for your OK" : note ?? (tile.error != nil ? "Couldn't update" : nil) {
                    Text(n).font(.geist(size: 11.5)).foregroundStyle(Theme.faint)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: tile.size == "big" ? 220 : 104, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(open ? Theme.muted : Theme.line))
            .opacity(waiting ? 0.55 : 1)
            .scaleEffect(popped ? 1.04 : 1)
            .contentShape(RoundedRectangle(cornerRadius: 16))
        .onTapGesture(perform: tap)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(tile.title)
        .accessibilityAction(.default, tap)
        .help(tile.error ?? "")
        .accessibilityAddTraits(look?.tap == "toggle" && look?.dot?.filled == true ? .isSelected : [])
        // A dialog in the middle of the window, as on the web page.
        .sheet(isPresented: Binding(get: { panel == tile.id }, set: {
            // A closing card must not clear a different card that has just opened.
            if !$0 && panel == tile.id { panel = nil }
        })) {
            TilePanel(tileId: tile.id)
        }
        .contextMenu { Button("Remove", role: .destructive, action: remove) }
    }

    private func tap() {
        if waiting { nav.page = .needs; return }
        switch tile.look?.tap ?? "none" {
        case "group": withAnimation(.snappy) { toggleGroup() }
        case "panel": panel = tile.id
        case "chat": if let b = tile.bot { nav.page = .bot(b) }
        case "none": break
        default:
            let asked = store.bots.first { $0.id == tile.bot }?.name
            if tile.asks == true { flash(Tile.asked(asked, queued: false)) }
            Task {
                do {
                    // Its bot was busy: the request waits its turn, and the tile says so.
                    if try await store.tap(tile), tile.asks == true { flash(Tile.asked(asked, queued: true)) }
                    if tile.look?.tap == "act" && tile.asks != true { pop() }
                } catch { store.problem = error.localizedDescription; await store.loadDashboard(quiet: true) }
            }
        }
    }

    private func flash(_ text: String) {
        note = text
        Task { try? await Task.sleep(for: .seconds(2.5)); note = nil }
    }

    private func pop() {
        withAnimation(.spring(duration: 0.25)) { popped = true }
        Task { try? await Task.sleep(for: .milliseconds(250)); withAnimation(.spring(duration: 0.25)) { popped = false } }
    }
}

/// A tile's dot: filled when on, a ring when off, grey-dashed when unknown.
struct TileDotView: View {
    let dot: TileDot
    let tile: Tile
    @Environment(Store.self) private var store
    var body: some View {
        let c = tileTint(dot.color, tile, store)
        let d: CGFloat = dot.big == true ? 14 : 10
        Group {
            if dot.filled == false { Circle().stroke(c, lineWidth: 2) }
            else if dot.filled == nil { Circle().stroke(Theme.faint, style: StrokeStyle(lineWidth: 1.5, dash: [2, 2])) }
            else { Circle().fill(c) }
        }
        .frame(width: d, height: d)
    }
}

/// A tile's blocks (on its face, or in its pop-up).
struct BlocksView: View {
    let blocks: [TileBlock]
    let tile: Tile
    let `where`: String
    var openPanel: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in BlockView(block: b, tile: tile, where: `where`, openPanel: openPanel) }
        }
    }
}

struct BlockView: View {
    let block: TileBlock
    let tile: Tile
    let `where`: String
    var openPanel: () -> Void = {}
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var slider: Double?
    @State private var color: Color = .white

    private let faint = Text("·").foregroundStyle(Theme.faint)

    var body: some View {
        switch block {
        case .text(let text, let size, let muted, let markdown, let lines):
            if text.isEmpty { faint } else {
                Group {
                    if markdown { MarkdownView(text) } else { Text(text) }
                }
                .font(.geist(size: size == "small" ? 12 : size == "large" ? 18 : 13.5))
                .foregroundStyle(muted ? Theme.muted : Theme.text)
                .lineLimit(`where` == "face" ? lines : nil)
            }
        case .value(let text, let unit, let c):
            if text.isEmpty { faint } else {
                (Text(text).font(.geist(size: 26, weight: .semibold)) + Text(unit.map { " \($0)" } ?? "").font(.geist(size: 13)).foregroundColor(Theme.muted))
                    .foregroundStyle(c == nil ? Theme.text : tileTint(c, tile, store, words: true))
            }
        case .dot(let d):
            HStack(spacing: 6) { TileDotView(dot: d, tile: tile); if let l = d.label { Text(l).font(.geist(size: 12.5)) } }
        case .list(let items, let max):
            if items.isEmpty { faint } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(items.prefix(max).enumerated()), id: \.offset) { _, l in Text("• \(l)").font(.geist(size: 12.5)).lineLimit(1) }
                    if items.count > max { Text("…").foregroundStyle(Theme.faint) }
                }
            }
        case .progress(let ratio, let text, let c):
            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: ratio ?? 0).tint(tileTint(c, tile, store))
                if let text { Text(text).font(.geist(size: 12)).foregroundStyle(Theme.muted) }
            }
        case .gauge(let ratio, let text, let c):
            Gauge(value: ratio ?? 0) { EmptyView() } currentValueLabel: { Text(text ?? "·") }
                .gaugeStyle(.accessoryCircular).tint(tileTint(c, tile, store))
        case .chart(let points, let c, let text):
            VStack(alignment: .leading, spacing: 4) {
                if let text { Text(text).font(.geist(size: 12)).foregroundStyle(Theme.muted) }
                if points.count < 2 { faint } else {
                    Chart(Array(points.enumerated()), id: \.offset) { i, v in LineMark(x: .value("", i), y: .value("", v)).foregroundStyle(tileTint(c, tile, store)) }
                        .chartXAxis(.hidden).chartYAxis(.hidden).frame(height: 40)
                }
            }
        case .image(let src, let height, let fit):
            TileImage(src: src, fit: fit)
                .frame(height: height == "small" ? 70 : height == "large" ? 220 : 130)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        case .chat(let label):
            if let b = store.bots.first(where: { $0.id == tile.bot }) {
                Button { nav.page = .bot(b.id) } label: {
                    HStack(spacing: 4) { if label == nil { NameFigure(Who(b)) }; Text("\(label ?? b.name) ›") }
                }
                .buttonStyle(.textLink)
            }
        case .toggle(let key, let on, let label):
            Toggle(label ?? "", isOn: Binding(get: { on == true }, set: { send(key, .bool($0)) })).toggleStyle(.webSwitch)
        case .button(let key, let label):
            Button(label) { send(key, .null) }.controlSize(.small)
        case .slider(let key, let value, let min, let max, let step, let unit, let percent, let label):
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    if let label { Text(label).font(.geist(size: 12.5)) }
                    Spacer()
                    Text((slider ?? value).map { v in percent ? "\(Int(((v - min) / (max - min) * 100).rounded())) %" : "\(v == v.rounded() ? String(Int(v)) : String(v))\(unit.map { " \($0)" } ?? "")" } ?? "·")
                        .font(.geist(size: 12.5, weight: .semibold))
                }
                // Sent when let go.
                Slider(value: Binding(get: { slider ?? value ?? min }, set: { slider = $0 }), in: min...max, step: step) { editing in
                    if !editing, let v = slider { send(key, .number(v)) }
                }
            }
        case .color(let key, let value, let label):
            ColorPicker(label ?? "Colour", selection: Binding(get: { value.map { Color(hex: $0) } ?? color }, set: { c in
                color = c
                colorSoon(key, c)
            }), supportsOpacity: false)
        case .choice(let key, let options, let value, let label):
            Picker(label ?? "", selection: Binding(get: { value ?? .null }, set: { send(key, $0) })) {
                ForEach(options, id: \.label) { o in Text(o.label).tag(o.value) }
            }
            .pickerStyle(.segmented)
        case .row(let list):
            HStack(alignment: .center, spacing: 10) { ForEach(Array(list.enumerated()), id: \.offset) { _, b in BlockView(block: b, tile: tile, where: `where`, openPanel: openPanel) } }
        case .column(let list):
            VStack(alignment: .leading, spacing: 6) { ForEach(Array(list.enumerated()), id: \.offset) { _, b in BlockView(block: b, tile: tile, where: `where`, openPanel: openPanel) } }
        case .unknown:
            EmptyView()
        }
    }

    private func send(_ key: String, _ value: JSONValue) {
        Task {
            do {
                if try await store.act(tile, key: key, value: value), tile.asks == true {
                    nav.pill = .ok(Tile.asked(store.bots.first { $0.id == tile.bot }?.name, queued: true))
                }
            } catch { store.problem = error.localizedDescription; await store.loadDashboard(quiet: true) }
        }
    }

    @State private var colorTask: Task<Void, Never>?
    /// The colour follows a few times a second while you pick, and once more at the end.
    private func colorSoon(_ key: String, _ c: Color) {
        colorTask?.cancel()
        colorTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, let rgb = NSColor(c).usingColorSpace(.sRGB) else { return }
            let hex = String(format: "#%02x%02x%02x", Int(rgb.redComponent * 255), Int(rgb.greenComponent * 255), Int(rgb.blueComponent * 255))
            send(key, .string(hex))
        }
    }
}

/// A tile's pop-up: all of a note or list, a light's controls, with a way into its bot's chat. It
/// follows the tile's new values.
struct TilePanel: View {
    let tileId: String
    @Environment(Store.self) private var store

    var body: some View {
        let t = store.dashboard.tiles.first { $0.id == tileId }
        Dialog(t?.title ?? "") {
            if let t {
                ScrollView { BlocksView(blocks: t.look?.panel ?? [], tile: t, where: "panel").frame(maxWidth: .infinity, alignment: .leading) }
            }
        }
        .frame(minWidth: 360, idealWidth: 420, maxWidth: 520, minHeight: 200, maxHeight: 600, alignment: .top)
        .background(Theme.panel)
    }
}

/// A tile a bot suggested: faded, who and why, its script if it has one, Add or ✕.
struct SuggestedTile: View {
    let suggestion: TileSuggestion
    @Environment(Store.self) private var store

    var body: some View {
        let b = store.bots.first { $0.id == suggestion.bot }
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) { Circle().fill(b.map { Color(hex: $0.color) } ?? Theme.chief).frame(width: 10, height: 10); Text(suggestion.tile.title).font(.geist(size: 13.5, weight: .semibold)) }
            (Text(b.map { "\($0.name) · " } ?? "").bold() + Text(suggestion.reason ?? "")).font(.geist(size: 12.5)).foregroundStyle(Theme.muted)
            if let scripts = suggestion.tile.scripts, !scripts.isEmpty {
                DisclosureGroup("Its script") {
                    ForEach(scripts, id: \.self) { Text($0).font(.geistMono(size: 11.5)).textSelection(.enabled) }
                }
                .font(.geist(size: 12))
            }
            HStack {
                Spacer()
                Button("✕") { answer(false) }.help("Not this one")
                Button("Add") { answer(true) }.buttonStyle(.pillPrimary)
            }
            .controlSize(.small)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 16).stroke(Theme.line2, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        .opacity(0.8)
    }

    private func answer(_ add: Bool) {
        Task { do { try await store.answer(suggestion, add: add) } catch { store.problem = error.localizedDescription } }
    }
}

// MARK: - The grid and dragging

/// How many columns a tile takes: small 1, wide and big 2, row all.
nonisolated struct TileSpan: LayoutValueKey { static let defaultValue = "small" }

extension View {
    func tileSpan(_ size: String) -> some View { layoutValue(key: TileSpan.self, value: size) }
}

/// Tiles in columns at least 160 points wide (two on a narrow window); wide and big ones take two, a
/// row the whole width. Each tile keeps its own height; a row is as tall as its tallest tile.
struct TileGrid: Layout {
    var spacing: CGFloat = 12

    private func columns(_ width: CGFloat) -> Int { max(2, Int((width + spacing) / (160 + spacing))) }

    private func place(_ width: CGFloat, _ subviews: Subviews) -> (frames: [CGRect], height: CGFloat) {
        let cols = columns(width)
        let colW = (width - CGFloat(cols - 1) * spacing) / CGFloat(cols)
        var frames: [CGRect] = []
        var col = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let span = { switch v[TileSpan.self] { case "row": cols; case "wide", "big": min(2, cols); default: 1 } }()
            if col + span > cols { y += rowH + spacing; col = 0; rowH = 0 }
            let w = CGFloat(span) * colW + CGFloat(span - 1) * spacing
            let h = v.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            frames.append(CGRect(x: CGFloat(col) * (colW + spacing), y: y, width: w, height: h))
            rowH = max(rowH, h)
            col += span
            if col >= cols { y += rowH + spacing; col = 0; rowH = 0 }
        }
        return (frames, subviews.isEmpty ? 0 : y + (col > 0 ? rowH : -spacing))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 700
        return CGSize(width: w, height: max(0, place(w, subviews).height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (frames, _) = place(bounds.width, subviews)
        for (v, f) in zip(subviews, frames) {
            v.place(at: CGPoint(x: bounds.minX + f.minX, y: bounds.minY + f.minY), proposal: ProposedViewSize(width: f.width, height: f.height))
        }
    }
}

/// Dragged tiles carry this before their id, so other drags are left alone.
let tileDragPrefix = "botdot-tile:"

/// The id of the tile a drop carries, if it's one of ours (read once the drop happens).
@MainActor
func draggedTile(_ providers: [NSItemProvider], _ then: @escaping @MainActor (String) -> Void) -> Bool {
    guard let p = providers.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else { return false }
    _ = p.loadObject(ofClass: NSString.self) { text, _ in
        guard let s = (text as? NSString).map(String.init), s.hasPrefix(tileDragPrefix) else { return }
        let id = String(s.dropFirst(tileDragPrefix.count))
        Task { @MainActor in then(id) }
    }
    return true
}

/// A tile can be dragged: onto another tile to go before it (or into a closed group, over its
/// middle), or onto the empty part of a heading's grid to go at its end.
struct TileDrag: ViewModifier {
    let tile: Tile
    let section: String
    let parent: String?
    @Environment(Store.self) private var store
    @State private var over = false

    func body(content: Content) -> some View {
        content
            .draggable(tileDragPrefix + tile.id)
            .onDrop(of: [.plainText], isTargeted: $over) { providers in
                draggedTile(providers) { id in
                    guard id != tile.id else { return }
                    let dragged = store.dashboard.tiles.first { $0.id == id }
                    Task {
                        do {
                            if tile.kind == "group" && dragged?.kind != "group" {
                                try await store.moveTile(id, section: nil, parent: tile.id, before: nil)
                            } else {
                                try await store.moveTile(id, section: section, parent: parent, before: tile.id)
                            }
                        } catch { store.problem = error.localizedDescription }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.chief, lineWidth: over ? 2 : 0).allowsHitTesting(false))
    }
}

/// The empty part of a heading's grid (or an open group): a tile dropped there goes at its end.
struct GridDrop: ViewModifier {
    let section: String
    let parent: String?
    @Environment(Store.self) private var store

    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            .onDrop(of: [.plainText], isTargeted: nil) { providers in
                draggedTile(providers) { id in
                    Task { do { try await store.moveTile(id, section: section, parent: parent, before: nil) } catch { store.problem = error.localizedDescription } }
                }
            }
    }
}

/// The strip at the top of the sidebar: each tile's dot and name, and a value's value, as many as fit.
/// A click opens the Board. With no tile to show it says so (`.dash-strip .none`).
struct DashboardStrip: View {
    @Environment(Store.self) private var store
    @Environment(\.listLayout) private var layout

    var body: some View {
        let tiles = store.dashboard.tiles.filter { $0.parent == nil && $0.approved != false }
        // A list that shows figures only: the Board's mark in place of its tiles.
        if layout == .figures {
            Image(systemName: "square.grid.2x2").font(.geist(size: 15)).foregroundStyle(Theme.muted).frame(height: 18)
        } else {
        HStack(spacing: 8) {
            if tiles.isEmpty {
                (Text("Board").fontWeight(.medium).foregroundStyle(Theme.text) + Text(" · Nothing on it yet")).lineLimit(1)
            } else {
                // The tiles that don't fit whole are left out, not cut off.
                ViewThatFits(in: .horizontal) {
                    ForEach((1...tiles.count).reversed(), id: \.self) { n in
                        HStack(spacing: 14) {
                            ForEach(tiles.prefix(n)) { t in
                                HStack(spacing: 6) {
                                    if let d = t.look?.dot { TileDotView(dot: d, tile: t) }
                                    Text(t.title).lineLimit(1)
                                    if let s = t.look?.short, !s.isEmpty { Text(s).fontWeight(.medium).foregroundStyle(Theme.text) }
                                }
                                .fixedSize()
                            }
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            Text("›").foregroundStyle(Theme.faint)
        }
        .font(.geist(size: 13))
        .foregroundStyle(Theme.muted)
        }
    }
}

/// One tile inside a group, as a dot on the group: filled when on, a ring when off.
struct GroupDot: View {
    let tile: Tile
    @Environment(Store.self) private var store
    var body: some View {
        let d = tile.look?.dot
        let c: Color = tileTint(d?.color, tile, store)
        let filled = d == nil || d?.filled == true
        Circle().fill(filled ? c : Color.clear)
            .overlay(Circle().stroke(c, lineWidth: 1.5))
            .frame(width: 10, height: 10)
    }
}

/// An image tile's picture, loaded with this app's session (behind a front door nothing loads without it).
struct TileImage: View {
    let src: String
    let fit: String?
    @Environment(Store.self) private var store
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image {
                if fit == "contain" { Image(nsImage: image).resizable().scaledToFit() } else { Image(nsImage: image).resizable().scaledToFill() }
            } else {
                Theme.sunk
            }
        }
        .task(id: src) { image = await store.tileImage(src).flatMap(NSImage.init(data:)) }
    }
}
