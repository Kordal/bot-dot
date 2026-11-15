import SwiftUI
import BotdotShared

/// The Board, opened from Home's Board cards, as the Android app's screen: the tiles the Chief put together under their
/// headings, one heading at a time or all of them. A tap does the tile's thing (switch, button, refresh, its pop-up),
/// press and hold for a change asked of the Chief or Remove; pull down, or the refresh button, to read every tile again.
/// What each tile says and does is the shared layer's (BoardDesk).
struct BoardView: View {
    let home: HomeStore
    let figure: FigureDef?
    @State private var model: BoardModel?
    @State private var notice: String?
    @State private var asking: Asking?
    @State private var panel: String?
    @State private var changing: String?
    @State private var removing: BoardCell?
    @State private var needs = false
    /// A chat tile's bot, its chat opened.
    @State private var chat: ChatRoute?
    /// A page tile's page, open in the viewer.
    @State private var page: DocumentView.Opening?
    @Environment(\.scenePhase) private var phase

    /// A tile whose question is on screen before its tap goes.
    struct Asking: Identifiable {
        let tile: Tile
        let on: KotlinBoolean?
        var id: String { tile.id }
    }

    // The body in steps, each of a stated type: one long chain of modifiers is slow to type-check.
    var body: some View {
        sheets
            .onDisappear { model?.stop(); model = nil }
            // Read only while the app is in front, as Android reads only while its screen is resumed.
            .onChange(of: phase) { _, now in model?.active(now == .active) }
            .task(id: model?.state?.noticeId) {
                guard let text = model?.state?.notice else { return }
                notice = text
                try? await Task.sleep(for: .seconds(3))
                if notice == text { notice = nil }
            }
    }

    /// The tiles, in a scroll view as wide as the screen; the model is made where that width is known.
    private var scroller: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let model, let state = model.state, state.loaded {
                        content(state, model, width: geo.size.width - 32)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(16)
            }
            // At first and when it shows again (back from Needs you).
            .task {
                if model == nil {
                    let made = BoardModel(home: home)
                    made.start(width: geo.size.width)
                    model = made
                }
            }
            .onChange(of: geo.size.width) { _, w in model?.width(w) }
        }
    }

    private var framed: some View {
        scroller
            .refreshable { await model?.refresh() }
            .navigationTitle(BoardWords.shared.NAME)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .navigationDestination(isPresented: $needs) { NeedsYouView(home: home, figure: figure) }
            .navigationDestination(item: $chat) { r in ChatView(home: home, botId: r.botId, name: r.name) }
            .navigationDestination(item: $page) { ViewerView(api: home.api, opening: $0) }
            .overlay(alignment: .bottom) { noticeLine }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let model, let state = model.state, state.refreshable {
            ToolbarItem(placement: .topBarTrailing) { RefreshButton(state: state) { Task { await model.refresh() } } }
        }
    }

    @ViewBuilder
    private var noticeLine: some View {
        if let notice {
            Text(notice).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16)
                .accessibilityIdentifier("notice")
        }
    }

    private var askTitle: String { asking.map { BoardKit.shared.askTitle(t: $0.tile, on: $0.on) } ?? "" }
    private var askShown: Binding<Bool> { Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }) }
    private var removeTitle: String { removing.map { tr("Remove “{title}”?", ["title": $0.tile?.title ?? ""]) } ?? "" }
    private var removeShown: Binding<Bool> { Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }) }

    private var asked: some View {
        framed
            .alert(askTitle, isPresented: askShown, presenting: asking) { (a: Asking) in
                Button(BoardKit.shared.askYes(on: a.on), role: a.on?.boolValue == false ? .destructive : nil) { tap(a.tile.id, asked: true) }
                Button(tr("Cancel"), role: .cancel) {}
            }
            .confirmationDialog(removeTitle, isPresented: removeShown, titleVisibility: .visible, presenting: removing) { (cell: BoardCell) in
                removeButtons(cell)
            } message: { (cell: BoardCell) in
                Text(cell.holds > 0 ? trn(Int(cell.holds), "It holds one tile.", "It holds {n} tiles.") : tr("It goes off your Board."))
            }
    }

    @ViewBuilder
    private func removeButtons(_ cell: BoardCell) -> some View {
        if cell.holds > 0 {
            Button(tr("Only the group")) { remove(cell.key, withTiles: false) }
            Button(tr("The group and its tiles"), role: .destructive) { remove(cell.key, withTiles: true) }
        } else {
            Button(tr("Remove"), role: .destructive) { remove(cell.key, withTiles: false) }
        }
        Button(tr("Cancel"), role: .cancel) {}
    }

    private var panelKey: Binding<Key?> { Binding(get: { panel.map(Key.init) }, set: { panel = $0?.id }) }
    private var changingKey: Binding<Key?> { Binding(get: { changing.map(Key.init) }, set: { changing = $0?.id }) }

    private func cellOf(_ key: String) -> BoardCell? { model?.state?.rows.flatMap({ $0 }).first(where: { $0.key == key }) }

    private var sheets: some View {
        asked
            .sheet(item: panelKey) { (key: Key) in
                if let model, let cell = cellOf(key.id), let tile = cell.tile {
                    TilePanel(tile: tile, color: cell.color, model: model)
                }
            }
            .sheet(item: changingKey) { (key: Key) in
                if let model { AskChangeSheet(title: cellOf(key.id)?.tile?.title ?? "", key: key.id, model: model) }
            }
    }

    struct Key: Identifiable { let id: String }

    @ViewBuilder
    private func content(_ state: BoardState, _ model: BoardModel, width: CGFloat) -> some View {
        if state.empty {
            VStack(alignment: .leading, spacing: 12) {
                Text(BoardWords.shared.WHAT_FOR).foregroundStyle(.secondary)
                (Text(BoardWords.shared.TELL).foregroundStyle(.secondary) + Text(BoardWords.shared.EXAMPLE))
            }
            .accessibilityIdentifier("board-empty")
        }
        if !state.filters.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(state.filters, id: \.self) { name in
                        let on = name == state.filter
                        Button(name.isEmpty ? tr("All") : name) { model.filter(name) }
                            .buttonStyle(.plain)
                            .font(.subheadline)
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(on ? Color.primary : Color.secondary.opacity(0.18), in: .capsule)
                            .foregroundStyle(on ? Color(.systemBackground) : Color.primary)
                    }
                }
            }
        }
        let columns = Int(state.columns)
        let gap: CGFloat = 10
        let unit = max(0, (width - gap * CGFloat(columns - 1)) / CGFloat(columns))
        ForEach(Array(state.rows.enumerated()), id: \.offset) { _, row in
            HStack(alignment: .top, spacing: gap) {
                ForEach(row, id: \.key) { cell in
                    let span = CGFloat(min(Int(cell.span), columns))
                    self.cell(cell, model).frame(width: unit * span + gap * (span - 1), alignment: .leading)
                }
            }
            // The rows of one Controls box touch, so they read as one.
            .padding(.top, row.first?.kind == .control && row.first?.first == false ? -10 : 0)
        }
        if !state.suggestions.isEmpty {
            Text(tr("Suggested")).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 12)
            ForEach(state.suggestions, id: \.id) { s in SuggestionCard(s: s, model: model) }
        }
    }

    @ViewBuilder
    private func cell(_ cell: BoardCell, _ model: BoardModel) -> some View {
        switch cell.kind {
        case .heading: HeadingView(cell: cell)
        case .groupTop:
            if cell.empty { Text(tr("Nothing in it yet.")).font(.subheadline).foregroundStyle(.tertiary) }
        case .groupEnd: Divider()
        case .control, .tile:
            Group {
                if cell.kind == .control { ControlRowView(cell: cell) } else { TileCard(cell: cell, model: model) }
            }
            .contentShape(.rect)
            .onTapGesture { tap(cell.key) }
            .contextMenu {
                if cell.askable { Button(tr("Change")) { changing = cell.key } }
                Button(tr("Remove from Board"), role: .destructive) { removing = cell }
            }
            // Drag to move (Android's press, hold and drag): let go on another tile and it goes where that one is,
            // under its heading or into its open group (BoardDesk.drop; a group stays out of groups).
            .draggable(cell.key)
            .dropDestination(for: String.self) { keys, _ in
                guard let from = keys.first, from != cell.key else { return false }
                Task { await model.drop(from, cell.key) }
                return true
            }
            .accessibilityAddTraits(.isButton)
        }
    }

    /// A tap: done by the shared layer where it can be; its question, its pop-up or Needs you here.
    private func tap(_ key: String, asked: Bool = false) {
        guard let model else { return }
        Task {
            guard let what = await model.tap(key, asked: asked) else { return }
            switch onEnum(of: what) {
            case .ask(let ask):
                if let t = model.state?.rows.flatMap({ $0 }).first(where: { $0.key == key })?.tile { asking = Asking(tile: t, on: ask.on) }
            case .panel: panel = key
            case .needs: needs = true
            case .chat(let c): chat = ChatRoute(botId: c.bot, name: model.botName(c.bot) ?? "")
            case .page(let p):
                let title = model.state?.rows.flatMap({ $0 }).first(where: { $0.key == key })?.tile?.title ?? p.slug
                page = DocumentView.shared.ofPage(botId: p.bot, slug: p.slug, title: title, from: model.botName(p.bot) ?? "")
            default: break
            }
        }
    }

    private func remove(_ key: String, withTiles: Bool) {
        guard let model else { return }
        Task { await model.remove(key, withTiles: withTiles) }
    }
}

/// The refresh button: its arrows, turning while every tile is read, and the age of the newest value.
private struct RefreshButton: View {
    let state: BoardState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                HStack(spacing: 4) {
                    Image(systemName: "arrow.clockwise").symbolEffect(.rotate, isActive: state.refreshing)
                    if state.newestAt > 0 { Text(Board.age(state.newestAt, ctx.date)).font(.caption.monospacedDigit()) }
                }
            }
        }
        .disabled(state.refreshing)
        .accessibilityLabel(tr("Refresh"))
    }
}

/// The Board's small helpers for drawing: colours by name or hex, and ages from the shared layer's words.
enum Board {
    /// "1 min ago" for a value that came at [ms], as of [now] (BoardKit.ageWords).
    static func age(_ ms: Int64, _ now: Date) -> String {
        BoardKit.shared.ageWords(secs: (Int64(now.timeIntervalSince1970 * 1000) - ms) / 1000)
    }

    /// A colour from a tile's look: a theme name (ok, warn, bad, faint, muted, text), "#rrggbb", or the tile's own.
    static func tint(_ name: String?, _ own: Color) -> Color {
        switch name {
        case "ok": return .green
        case "warn": return .orange
        case "bad": return .red
        case "faint": return Color(.tertiaryLabel)
        case "muted": return .secondary
        case "text": return .primary
        case nil: return own
        default: return FigurePaint.shared.colorOf(hex: name) != nil ? ContactRow.tint(name) : own
        }
    }

    /// A status's or callout's level, as its colour.
    static func level(_ level: String?) -> Color {
        switch BoardKit.shared.level(l: level) {
        case "ok": return .green
        case "warn": return .orange
        case "err": return .red
        case "plan": return .secondary
        default: return .blue
        }
    }
}

/// A heading: its name, the bots its tiles come from, and how long ago their values were read when they come from one source.
private struct HeadingView: View {
    let cell: BoardCell

    var body: some View {
        HStack(spacing: 6) {
            Text(cell.heading).font(.headline).lineLimit(1)
            if !cell.bots.isEmpty { Text(cell.bots).font(.caption).foregroundStyle(.tertiary).lineLimit(1) }
            Spacer(minLength: 0)
            if cell.readAt > 0 {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in Text(Board.age(cell.readAt, ctx.date)).font(.caption.monospaced()).foregroundStyle(.tertiary) }
            }
        }
        .padding(.top, 12)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A tile as a card: its dot, title and what its head says at the end, its face's blocks, and its note.
private struct TileCard: View {
    let cell: BoardCell
    let model: BoardModel

    var body: some View {
        let t = cell.tile!
        let own = ContactRow.tint(cell.color)
        let kpi = BoardKit.shared.isKpiTile(t: t)
        VStack(alignment: .leading, spacing: 8) {
            if t.kind == "group" {
                Text(t.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                HStack(spacing: 8) {
                    if cell.inside.isEmpty { Text("·").foregroundStyle(.tertiary) }
                    ForEach(Array(cell.inside.enumerated()), id: \.offset) { _, d in
                        let c = Board.tint(d.color, own)
                        if d.filled?.boolValue == true { Circle().fill(c).frame(width: 14, height: 14) } else { Circle().strokeBorder(Color(.tertiaryLabel), lineWidth: 1.5).frame(width: 14, height: 14) }
                    }
                }
            } else {
                HStack(spacing: 8) {
                    if let dot = t.look?.dot { TileDot(filled: dot.filled?.boolValue, color: Board.tint(dot.color, own), big: false) }
                    if t.kind == "page" { Image(systemName: "doc.text").font(.caption).foregroundStyle(.secondary) }
                    Text(t.title).font(kpi ? .subheadline : .subheadline.weight(.semibold)).foregroundStyle(kpi ? .secondary : .primary).lineLimit(1)
                    Spacer(minLength: 0)
                    if cell.ai {
                        Text(BoardWords.shared.WRITTEN_BY_AI).font(.caption2.monospaced()).foregroundStyle(.tertiary)
                            .padding(.horizontal, 6).background(Color.secondary.opacity(0.15), in: .capsule)
                    } else if t.kind == "page", t.at != nil {
                        Text(BoardKit.shared.pageAge(t: t)).font(.caption.monospaced()).foregroundStyle(.tertiary)
                    } else if cell.readAt > 0 {
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in Text(Board.age(cell.readAt, ctx.date)).font(.caption.monospaced()).foregroundStyle(.tertiary) }
                    }
                }
                if let face = t.look?.face { Blocks(list: face, color: own, where: cell.where, key: t.id, model: model) }
            }
            if let note = cell.note { Text(note).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: t.size == "big" ? 220 : 104, alignment: .topLeading)
        .background(cell.open ? Color.secondary.opacity(0.22) : Color.secondary.opacity(0.12), in: .rect(cornerRadius: 16))
        .opacity(cell.waiting ? 0.55 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// A switch or a button as a row of a Controls box: "Controls" over the first, its title and line, a switch or a go mark.
private struct ControlRowView: View {
    let cell: BoardCell

    var body: some View {
        let t = cell.tile!
        VStack(alignment: .leading, spacing: 0) {
            if cell.first {
                Text(BoardWords.shared.CONTROLS).font(.subheadline.weight(.semibold)).padding(.top, 16).padding(.bottom, 4)
            } else {
                Divider()
            }
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let note = cell.note { Text(note).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if t.kind == "switch" {
                    let on = t.look?.dot?.filled?.boolValue
                    Capsule().fill(on == true ? Color.green : Color.secondary.opacity(0.35)).frame(width: 40, height: 24)
                        .overlay(alignment: on == true ? .trailing : .leading) { Circle().fill(.white).frame(width: 18, height: 18).padding(3) }
                        .opacity(on == nil ? 0.5 : 1)
                        .accessibilityLabel(on == true ? tr("On") : tr("Off"))
                } else {
                    Image(systemName: "chevron.right").foregroundStyle(.secondary).frame(width: 30, height: 30).background(Color.secondary.opacity(0.15), in: .circle)
                }
            }
            .padding(.vertical, 12)
            if cell.last { Spacer().frame(height: 4) }
        }
        .padding(.horizontal, 16)
        .background(Color.secondary.opacity(0.12), in: UnevenRoundedRectangle(topLeadingRadius: cell.first ? 14 : 0, bottomLeadingRadius: cell.last ? 14 : 0, bottomTrailingRadius: cell.last ? 14 : 0, topTrailingRadius: cell.first ? 14 : 0))
        .opacity(cell.waiting ? 0.55 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// A tile's dot: filled when on, a ring when off, faint while not known.
private struct TileDot: View {
    let filled: Bool?
    let color: Color
    let big: Bool

    var body: some View {
        let size: CGFloat = big ? 28 : 10
        Group {
            if filled == false { Circle().strokeBorder(color, lineWidth: 1.5) } else { Circle().fill(color).opacity(filled == nil ? 0.4 : 1) }
        }
        .frame(width: size, height: size)
    }
}

/// A list of blocks, one under the other.
struct Blocks: View {
    let list: [Block]
    let color: Color
    let `where`: String
    let key: String
    let model: BoardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(list.enumerated()), id: \.offset) { _, b in BlockView(b: b, color: color, where: `where`, key: key, model: model) }
        }
    }
}

/// One block of a tile's face or pop-up (lib/tile-blocks.js fills them in), drawn as Android's BlockView draws it.
struct BlockView: View {
    let b: Block
    let color: Color
    let `where`: String
    let key: String
    let model: BoardModel

    var body: some View {
        let own = Board.tint(b.color, color)
        switch b.type {
        case "text":
            let text = b.text ?? ""
            if text.isEmpty { Text("·").foregroundStyle(.tertiary) } else {
                Text(b.markdown ? BoardKit.shared.plain(md: text) : text)
                    .font(b.size == "small" ? .caption : b.size == "large" ? .body.weight(.semibold) : .subheadline)
                    .foregroundStyle(b.muted ? .secondary : .primary)
                    .lineLimit(b.lines.map { Int(truncating: $0) })
            }
        case "value", "kpi":
            Kpi(b: b, color: own, compact: `where` == "compact")
        case "dot":
            HStack(spacing: 8) {
                TileDot(filled: b.filled?.boolValue, color: own, big: b.big)
                if let label = b.label { Text(label).font(.subheadline) }
            }
        case "list":
            VStack(alignment: .leading, spacing: 4) {
                if b.items.isEmpty { Text("·").foregroundStyle(.tertiary) }
                ForEach(Array(b.items.prefix(Int(b.max)).enumerated()), id: \.offset) { _, item in
                    Text(item).font(.subheadline).lineLimit(`where` == "panel" ? nil : 1)
                }
                if b.items.count > Int(b.max) { Text("…").foregroundStyle(.tertiary) }
            }
        case "progress", "gauge":
            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: min(max(b.ratio?.doubleValue ?? 0, 0), 1)).tint(own)
                if let text = b.text, !text.isEmpty { Text(text).font(.caption).foregroundStyle(.secondary) }
            }
        case "chart":
            ChartBlock(b: b, color: own, tall: `where` == "panel" || `where` == "wide")
        case "status":
            StatusPill(text: b.text ?? "", level: b.level)
        case "callout":
            CalloutBlock(b: b)
        case "switch":
            Toggle(b.label ?? "", isOn: Binding(get: { b.on?.boolValue == true }, set: { on in
                if let k = b.key { Task { await model.setSwitch(key, k, on) } }
            }))
            .font(.subheadline)
        case "button":
            Button(b.label ?? "") { if let k = b.key { Task { await model.press(key, k) } } }.buttonStyle(.bordered)
        case "slider":
            SliderBlock(b: b, key: key, model: model)
        case "choice":
            VStack(alignment: .leading, spacing: 8) {
                if let label = b.label { Text(label).font(.subheadline) }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(b.options.enumerated()), id: \.offset) { i, o in
                            let on = BoardKit.shared.textOf(v: o.value) == BoardKit.shared.textOf(v: b.value)
                            Button(o.label) { if let k = b.key { Task { await model.choose(key, k, i) } } }
                                .buttonStyle(.plain)
                                .font(.subheadline).padding(.horizontal, 12).padding(.vertical, 7)
                                .background(on ? Color.primary : Color.secondary.opacity(0.18), in: .capsule)
                                .foregroundStyle(on ? Color(.systemBackground) : Color.primary)
                        }
                    }
                }
            }
        case "row":
            HStack(alignment: .top, spacing: 12) {
                ForEach(Array(b.blocks.enumerated()), id: \.offset) { _, x in BlockView(b: x, color: color, where: `where`, key: key, model: model).frame(maxWidth: .infinity, alignment: .leading) }
            }
        case "column":
            Blocks(list: b.blocks, color: color, where: `where`, key: key, model: model)
        case "table":
            TableBlock(b: b)
        case "image":
            PictureBlock(b: b, model: model)
        default:
            // A block this phone doesn't draw yet (a colour wheel, a chat link): the tile stays readable.
            EmptyView()
        }
    }
}

/// A kpi, or a value: the number big with its unit and "of N", the line under it, a sparkline beside it and a bar under it.
struct Kpi: View {
    let b: Block
    let color: Color
    let compact: Bool

    var body: some View {
        let words = BoardKit.shared.isWords(text: b.text)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    if let label = b.label { Text(label).font(.caption).foregroundStyle(.secondary) }
                    (Text((b.text ?? "").isEmpty ? "·" : b.text!)
                        + Text(b.unit.map { " " + $0 } ?? "").font(.callout).foregroundStyle(.tertiary)
                        + Text(b.of.map { "  " + tr("of {total}", ["total": $0]) } ?? "").font(.callout).foregroundStyle(.tertiary))
                        .font(words ? .title3.weight(.semibold) : .title.weight(.semibold))
                        .foregroundStyle(b.type == "value" && b.color != nil ? Board.tint(b.color, .primary) : .primary)
                        .lineLimit(2)
                    if let d = b.delta {
                        Text(BoardKit.shared.deltaLine(b: b, clock: { BoardKit.shared.clock(ms: $0.int64Value) }))
                            .font(.caption).foregroundStyle(d.good?.boolValue == true ? .green : d.good?.boolValue == false ? .red : .secondary)
                    }
                    if let sub = b.sub { Text(sub).font(.caption).foregroundStyle(Board.tint(b.subColor, .secondary)) }
                }
                if b.points.count >= 2 && !compact {
                    Spark(points: b.points.map { $0.doubleValue }, color: color).frame(height: 44)
                }
            }
            if let r = b.ratio?.doubleValue { ProgressView(value: min(max(r, 0), 1)).tint(color) }
        }
    }
}

/// A sparkline: the line, and the area under it, faint.
private struct Spark: View {
    let points: [Double]
    let color: Color

    var body: some View {
        GeometryReader { geo in
            if points.count >= 2, let lo = points.min(), let hi = points.max() {
                let span = hi - lo > 0 ? hi - lo : 1
                let at = { (i: Int, v: Double) -> CGPoint in
                    CGPoint(x: geo.size.width * CGFloat(i) / CGFloat(points.count - 1), y: geo.size.height - 2 - CGFloat((v - lo) / span) * (geo.size.height - 4))
                }
                Path { p in
                    p.move(to: CGPoint(x: 0, y: geo.size.height))
                    for (i, v) in points.enumerated() { p.addLine(to: at(i, v)) }
                    p.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height))
                    p.closeSubpath()
                }
                .fill(color.opacity(0.14))
                Path { p in
                    for (i, v) in points.enumerated() { if i == 0 { p.move(to: at(i, v)) } else { p.addLine(to: at(i, v)) } }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
        }
        .accessibilityHidden(true)
    }
}

/// A slider: its label and value, sent once it is let go, on its steps.
private struct SliderBlock: View {
    let b: Block
    let key: String
    let model: BoardModel
    @State private var value: Double?

    var body: some View {
        let known = BoardKit.shared.numberOf(v: b.value)?.doubleValue
        let now = value ?? known ?? b.min
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(b.label ?? "").font(.subheadline)
                Spacer()
                Text(value != nil || known != nil ? BoardKit.shared.sliderText(b: b, v: now) : "·").font(.subheadline).foregroundStyle(.secondary)
            }
            Slider(value: Binding(get: { now }, set: { value = $0 }), in: b.min...max(b.max, b.min + b.step), step: b.step) { editing in
                if !editing, let k = b.key, let v = value { Task { await model.setNumber(key, k, v) } }
            }
            .opacity(value != nil || known != nil ? 1 : 0.5)
        }
    }
}

/// A tile's pop-up: its panel's blocks (a note or list in full, a light's controls), and how often it refreshes.
private struct TilePanel: View {
    let tile: Tile
    let color: String
    let model: BoardModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Blocks(list: tile.look?.panel ?? [], color: ContactRow.tint(color), where: "panel", key: tile.id, model: model)
                    if let line = BoardKt.refreshLine(t: tile) { Text(line).font(.caption).foregroundStyle(.tertiary) }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle(tile.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button(tr("Close")) { dismiss() } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// What should change in a tile, sent to the Chief: its title over a field, and Send.
private struct AskChangeSheet: View {
    let title: String
    let key: String
    let model: BoardModel
    @State private var text = ""
    @State private var sending = false
    @FocusState private var typing: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TextField(TileAsk.shared.PLACEHOLDER, text: $text, axis: .vertical)
                .lineLimit(3...8)
                .focused($typing)
                .onAppear { typing = true }
                .padding(16)
                .frame(maxHeight: .infinity, alignment: .top)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(tr("Send")) {
                            sending = true
                            Task {
                                if await model.askChange(key, text) { dismiss() }
                                sending = false
                            }
                        }
                        .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
        }
        .presentationDetents([.medium])
    }
}

/// A tile a bot suggested, as a faded card: its title, who and why, its script if it has one, and Add or ✕.
private struct SuggestionCard: View {
    let s: BoardSuggestion
    let model: BoardModel
    @State private var script = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(ContactRow.tint(s.color)).frame(width: 10, height: 10)
                Text(s.title).font(.subheadline.weight(.semibold))
            }
            .opacity(0.75)
            (Text(s.who.map { $0 + " · " } ?? "").bold() + Text(s.reason)).font(.subheadline).foregroundStyle(.secondary)
            if !s.scripts.isEmpty {
                Button(script ? tr("Hide its script") : tr("Its script")) { script.toggle() }.font(.caption).foregroundStyle(.secondary)
                if script { ForEach(s.scripts, id: \.self) { Text($0).font(.caption.monospaced()).padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Color.secondary.opacity(0.12), in: .rect(cornerRadius: 6)) } }
            }
            HStack {
                Spacer()
                Button("✕") { Task { await model.answer(s.id, add: false) } }.buttonStyle(.bordered).accessibilityLabel(tr("Dismiss"))
                Button(tr("Add")) { Task { await model.answer(s.id, add: true) } }.buttonStyle(.borderedProminent)
            }
        }
        .padding(16)
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.secondary.opacity(0.3)))
    }
}

/// A chart block: bars across with their labels, or a line of its points.
struct ChartBlock: View {
    let b: Block
    let color: Color
    /// Taller: in a pop-up, a wide tile or on a page.
    let tall: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let text = b.text { Text(text).font(.caption).foregroundStyle(.secondary) }
            if b.style == "hbar" {
                ForEach(Array(b.bars.enumerated()), id: \.offset) { _, bar in
                    HStack {
                        Text(bar.label).font(.subheadline).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                        ProgressView(value: min(max(bar.ratio, 0), 1)).tint(color).frame(maxWidth: .infinity)
                        Text(bar.text).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }
            } else {
                Spark(points: b.points.map { $0.doubleValue }, color: color).frame(height: tall ? 80 : 44)
            }
        }
    }
}

/// A callout: its title and words on its level's colour.
struct CalloutBlock: View {
    let b: Block

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let title = b.title { Text(title).font(.subheadline.weight(.semibold)) }
            Text(BoardKit.shared.plain(md: b.text ?? "")).font(.subheadline)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Board.level(b.level).opacity(0.15), in: .rect(cornerRadius: 12))
    }
}
