import SwiftUI
import BotdotShared

/// Home on the iPhone, as the Android app's on a phone: what went wrong, Needs you, the Board's numbers under it, then
/// the bots and groups in the owner's order: the pinned ones first, then each category. Press and hold a row to drag
/// it to its place; pull down to refresh.
struct HomeView: View {
    let model: AppModel
    let server: String
    @State private var home: HomeModel

    init(model: AppModel, server: String, api: Api) {
        self.model = model
        self.server = server
        _home = State(initialValue: HomeModel(api: api))
    }

    var body: some View {
        NavigationStack {
            List {
                if let error = home.state?.error ?? home.error {
                    Text(error).foregroundStyle(.red).accessibilityIdentifier("error")
                }
                if let state = home.state, NeedsDeskKt.needsYouOpens(waiting: state.waiting, bots: state.bots) {
                    // A tap opens Needs you, where each card is answered.
                    NavigationLink {
                        NeedsYouView(home: home.home, figure: home.figure)
                    } label: {
                        NeedsYou(waiting: state.waiting, figure: home.figure)
                    }
                    .accessibilityIdentifier("needs-you")
                    .listRowSeparator(.hidden)
                }
                if let state = home.state, let board = state.board {
                    BoardCards(tiles: board)
                }
                if let state = home.state {
                    ForEach(home.order, id: \.self) { key in
                        row(key, state)
                            .moveDisabled(key == ListLayout.shared.PINS || ListLayout.shared.isHeading(key: key))
                    }
                    .onMove { from, to in home.move(from: from, to: to) }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .listStyle(.plain)
            .refreshable { await home.refresh() }
            .navigationTitle("botdot")
            .toolbar {
                Menu {
                    Button(tr("Change botdot's address")) { model.otherAddress() }
                    Button(tr("Sign out"), role: .destructive) { Task { await model.signOut(server) } }
                } label: {
                    Image(systemName: "ellipsis.circle").accessibilityLabel(tr("More"))
                }
            }
        }
        .task { home.start() }
        .onDisappear { home.stop() }
        .onChange(of: home.state?.signInNeeded) { _, needed in if needed == true { model.signInNeeded(server) } }
    }

    @ViewBuilder
    private func row(_ key: String, _ state: HomeState) -> some View {
        if key == ListLayout.shared.PINS {
            // The line under the pinned bots: drag a row above it to pin it.
            Rectangle().fill(.separator).frame(height: 1).frame(maxWidth: .infinity)
                .listRowSeparator(.hidden).accessibilityHidden(true)
        } else if ListLayout.shared.isHeading(key: key) {
            Text(ListLayout.shared.categoryOf(key: key).isEmpty ? tr("Other") : ListLayout.shared.categoryOf(key: key))
                .font(.footnote.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                .listRowSeparator(.hidden)
        } else if let g = state.group(key: key) {
            ContactRow(name: g.name, sub: g.last?.text ?? "", unread: Int(g.unread), color: Groups.shared.members(g: g, bots: state.bots ?? []).first?.color, asks: false,
                       drawing: home.figure.map { FigurePaint.shared.figure(def: $0, color: Groups.shared.members(g: g, bots: state.bots ?? []).first?.color, state: "idle", outfit: nil, dark: true) })
        } else if let b = state.bot(id: key) {
            ContactRow(name: b.name, sub: state.sub(b: b), unread: Int(b.unread), color: b.color, asks: state.asks(b: b),
                       drawing: home.figure.map { FigurePaint.shared.figure(def: $0, color: b.color, state: b.state, outfit: b.outfit, dark: true) })
        }
    }
}

/// One row of the list: the mark, the name, what it says under it, and its new replies as dots in its colour (at most
/// three, never a number), as Android's UnreadDots.
struct ContactRow: View {
    let name: String
    let sub: String
    let unread: Int
    let color: String?
    let asks: Bool
    let drawing: FigurePaint.Drawing?

    var body: some View {
        HStack(spacing: 12) {
            if let drawing { FigureView(drawing: drawing).frame(width: 40, height: 40) }
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.body).lineLimit(1)
                if !sub.isEmpty {
                    Text(sub).font(.subheadline).foregroundStyle(asks ? .orange : .secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            let dots = Int(Unread.shared.dots(unread: Int32(unread)))
            if dots > 0 {
                HStack(spacing: 4) {
                    ForEach(0..<dots, id: \.self) { _ in Circle().fill(Self.tint(color)).frame(width: 7, height: 7) }
                }
                .accessibilityElement()
                .accessibilityLabel(dots == 1 ? tr("New reply") : tr("New replies"))
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// A bot's colour, or grey without one.
    static func tint(_ color: String?) -> Color {
        let rgb = FigurePaint.shared.colorOf(hex: color)?.int32Value ?? Int32(FigureDef.companion.GREY)
        return Color(red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255)
    }
}

/// Needs you, above the Board: one line for each thing that waits, with the small mark of the bot it is about.
struct NeedsYou: View {
    let waiting: [Waiting]
    let figure: FigureDef?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(tr("Needs you")).font(.headline)
            ForEach(Array(waiting.enumerated()), id: \.offset) { _, w in
                HStack(spacing: 8) {
                    if let figure {
                        FigureView(drawing: FigurePaint.shared.small(def: figure, color: w.color ?? ChiefColorKt.CHIEF_COLOR, outfit: w.color == nil ? FigureDef.companion.CHIEF : w.outfit, dark: true))
                            .frame(width: 20, height: 20)
                    }
                    Text(w.text).font(.subheadline).lineLimit(2)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.15), in: .rect(cornerRadius: 12))
        .listRowSeparator(.hidden)
    }
}

/// The Board's numbers under Needs you: each tile on home as its title and its number, or its dot.
struct BoardCards: View {
    let tiles: [Tile]

    var body: some View {
        Group {
            if tiles.isEmpty {
                (Text(tr("Board")).bold() + Text(" · " + tr("Nothing on it yet"))).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .topLeading), count: 3), alignment: .leading, spacing: 12) {
                    ForEach(tiles, id: \.id) { t in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(t.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            if let kpi = HomeListKt.stripKpi(t: t) {
                                Text(kpi.text ?? "").font(.title3.weight(.semibold)).lineLimit(1)
                            } else if let dot = t.look?.dot {
                                Text(dot.filled?.boolValue == true ? tr("On") : dot.filled?.boolValue == false ? tr("Off") : "·")
                                    .font(.title3.weight(.semibold))
                            }
                        }
                    }
                }
            }
        }
        .listRowSeparator(.hidden)
    }
}
