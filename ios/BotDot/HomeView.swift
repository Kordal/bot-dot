import SwiftUI
import BotdotShared

/// Home on the iPhone, as the Android app's on a phone: what went wrong, Needs you, the Board's numbers under it, then
/// the bots and groups in the owner's order: the pinned ones first, then each category. Press and hold a row to drag
/// it to its place; pull down to refresh. Its ⋯ menu opens each bot's computer screen, the Chief's and each bot's
/// Files, Passwords (VaultView), Settings, Apps, the keypad and each bot's settings.
struct HomeView: View {
    let model: AppModel
    let server: String
    @State private var path = NavigationPath()
    @State private var home: HomeModel
    /// The bot whose computer screen is open, from the ⋯ menu.
    @State private var screen: ScreenOpen?

    struct ScreenOpen: Hashable {
        let id: String
        let name: String
    }
    @Environment(\.scenePhase) private var phase
    @State private var vault = false
    /// What is open over Home: a chat (ChatRoute) or what the menu opens (Route).
    @State private var path = NavigationPath()

    /// What Home's menu opens.
    enum Route: Hashable {
        case settings
        case apps
        case keypad
        case bot(String)
    }

    init(model: AppModel, server: String, api: Api) {
        self.model = model
        self.server = server
        _home = State(initialValue: HomeModel(api: api))
    }

    var body: some View {
        NavigationStack(path: $path) {
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
                    // The Chief first, as on Android: its chat is one conversation.
                    NavigationLink(value: ChiefRoute()) {
                        ContactRow(name: state.chiefName, sub: "", unread: Int(state.chiefUnread), color: ChiefColorKt.CHIEF_COLOR, asks: false,
                                   drawing: home.figure.map { FigurePaint.shared.figure(def: $0, color: ChiefColorKt.CHIEF_COLOR, state: state.chiefBusy ? "working" : "idle", outfit: FigureDef.companion.CHIEF, dark: true) })
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                    .moveDisabled(true)
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
            .navigationDestination(for: FilesPlace.self) { FilesView(api: home.home.api, at: $0) }
            .navigationDestination(for: DocumentView.Opening.self) { ViewerView(api: home.home.api, opening: $0) }
            .refreshable { await home.refresh() }
            .navigationTitle("botdot")
            .navigationDestination(item: $screen) { s in ScreenView(home: home.home, botId: s.id, name: s.name) }
            .navigationDestination(for: ChatRoute.self) { r in ChatView(home: home.home, botId: r.botId, name: r.name) }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .settings: SettingsView(app: model, home: home.home)
                case .apps: AppsView(home: home.home)
                case .keypad: KeypadView(home: home) { path.append(Route.bot($0)) }
                case .bot(let id): BotSettingsView(home: home.home, botId: id, figure: home.figure)
                }
            }
            .navigationDestination(for: ChiefRoute.self) { r in ChiefView(home: home.home, chatId: r.chatId) }
            .navigationDestination(for: GroupRoute.self) { r in GroupChatView(home: home.home, groupId: r.groupId, name: r.name, figure: home.figure) }
            .toolbar {
                Menu {
                    // Each bot's computer screen (as Android's "Its screen" in a bot's chat), until the iPhone has the chat.
                    if let bots = home.state?.screens, !bots.isEmpty {
                        Section(tr("Its screen")) {
                            ForEach(bots, id: \.id) { b in
                                Button { screen = ScreenOpen(id: b.id, name: ComputerScreen.shared.title(bot: b)) } label: {
                                    Label(b.name, systemImage: "desktopcomputer")
                                }
                                .accessibilityIdentifier("screen-\(b.id)")
                            }
                        }
                    }
                    let owners = filesOwners
                    if !owners.isEmpty {
                        Menu {
                            ForEach(owners, id: \.owner) { o in Button(o.name) { path.append(o) } }
                        } label: {
                            Label(tr("Files"), systemImage: "folder")
                        }
                        .accessibilityIdentifier("files")
                    }
                    Button(tr("Settings")) { path.append(Route.settings) }
                    Button(tr("Apps")) { path.append(Route.apps) }
                    Button(tr("Keypad")) { path.append(Route.keypad) }
                    if let bots = home.state?.bots, !bots.isEmpty {
                        Menu(tr("Bots")) {
                            ForEach(bots, id: \.id) { b in Button(b.name) { path.append(Route.bot(b.id)) } }
                        }
                    }
                    Button(tr("Passwords")) { vault = true }
                    Divider()
                    Button(tr("Change botdot's address")) { model.otherAddress() }
                    Button(tr("Sign out"), role: .destructive) { Task { await model.signOut(server) } }
                } label: {
                    Image(systemName: "ellipsis.circle").accessibilityLabel(tr("More"))
                }
            }
            .navigationDestination(isPresented: $vault) { VaultView(api: home.home.api, settings: model.settings) }
        }
        .task {
            home.start()
            home.home.live(on: true)
            await Notifications.shared.start(home.home.api) // asks and registers once this botdot sends to iPhones
        }
        .sheet(isPresented: Binding(get: { !home.whatsNew.isEmpty }, set: { if !$0 { home.whatsNewClosed() } })) {
            WhatsNewSheet(entries: home.whatsNew) { home.whatsNewClosed() }
        }
        // A notification's tap: its chat, once Home knows its bots and groups (AppModel.chatToOpen).
        .onChange(of: model.chatToOpen, initial: true) { openAsked() } // a cold start's tap too
        .onChange(of: home.state?.bots?.count) { openAsked() }
        .onChange(of: home.state?.groups?.count) { openAsked() }
        .onDisappear { home.stop() }
        // The live feed while the app is in front; back to front, it reconnects after the last event it saw.
        .onChange(of: phase) { _, now in home.home.live(on: now == .active) }
        .onChange(of: home.state?.signInNeeded) { _, needed in if needed == true { model.signInNeeded(server) } }
    }

    /// Opens the chat a notification asked for, as the shared layer decides (PushNotices.opening): a bot's or a group's
    /// once Home has read them, a Chief conversation at once; what can't be opened is let go, so the same tap works again.
    private func openAsked() {
        switch onEnum(of: PushNotices.shared.opening(chat: model.chatToOpen, bots: home.state?.bots, groups: home.state?.groups)) {
        case .unasked, .wait:
            return
        case .botChat(let b):
            path.append(ChatRoute(botId: b.id, name: b.name))
        case .chiefChat(let c):
            path.append(ChiefRoute(chatId: c.chatId))
        case .groupChat(let g):
            path.append(GroupRoute(groupId: g.id, name: g.name))
        case .letGo:
            break
        }
        model.chatOpened()
    }

    /// Whose Files open from here: the Chief's, then each bot's in the list's order (FilesExplorer.opensFor).
    private var filesOwners: [FilesPlace] {
        guard let state = home.state else { return [] }
        let features = state.version?.features
        let chief = UploadedFiles.shared.CHIEF
        let bots = (state.bots ?? []).filter { FilesExplorer.shared.opensFor(ownerId: $0.id, features: features) }
        return (FilesExplorer.shared.opensFor(ownerId: chief, features: features) ? [FilesPlace(owner: chief, name: home.home.store.chiefName.value)] : [])
            + bots.map { FilesPlace(owner: $0.id, name: $0.name) }
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
            NavigationLink(value: GroupRoute(groupId: g.id, name: g.name)) {
                ContactRow(name: g.name, sub: g.last?.text ?? "", unread: Int(g.unread), color: Groups.shared.members(g: g, bots: state.bots ?? []).first?.color, asks: false,
                           drawing: home.figure.map { FigurePaint.shared.figure(def: $0, color: Groups.shared.members(g: g, bots: state.bots ?? []).first?.color, state: "idle", outfit: nil, dark: true) })
            }
            .navigationLinkIndicatorVisibility(.hidden)
        } else if let b = state.bot(id: key) {
            NavigationLink(value: ChatRoute(botId: b.id, name: b.name)) { ContactRow(name: b.name, sub: state.sub(b: b), unread: Int(b.unread), color: b.color, asks: state.asks(b: b),
                       drawing: home.figure.map { FigurePaint.shared.figure(def: $0, color: b.color, state: b.state, outfit: b.outfit, dark: true) }) }
                .navigationLinkIndicatorVisibility(.hidden) // Android's rows have no arrow
        }
    }
}

/// The Chief's chat: one conversation, its latest.
struct ChiefRoute: Hashable {
    /// A notification's conversation; nil, the latest.
    var chatId: String? = nil
}

/// A bot's chat, opened from its row.
struct ChatRoute: Hashable {
    let botId: String
    let name: String
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

/// What's new (#219), once after an update, as Android's dialog: the notes not seen yet and one button. Closed any way,
/// they are seen, here and on the web page.
struct WhatsNewSheet: View {
    let entries: [WhatsNew.Entry]
    let close: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView { WhatsNewNotes(entries: entries).padding().frame(maxWidth: .infinity, alignment: .leading) }
                .navigationTitle(WhatsNew.shared.TITLE)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { Button(WhatsNew.shared.GOT_IT, action: close).accessibilityIdentifier("got-it") }
        }
        .presentationDetents([.medium, .large])
    }
}
