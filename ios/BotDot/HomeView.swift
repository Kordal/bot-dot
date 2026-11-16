import SwiftUI
import BotdotShared

/// Home on the iPhone, as the Android app's on a phone: what went wrong, Needs you, the Board's numbers under it, then
/// the bots and groups in the owner's order: the pinned ones first, then each category. Press and hold a row to drag
/// it to its place; pull down to refresh. Its ⋯ menu opens each bot's computer screen, the Chief's and each bot's
/// Files, Passwords (VaultView), Settings, Apps, the keypad and each bot's settings.
struct HomeView: View {
    let model: AppModel
    let server: String
    @State private var home: HomeModel
    @State private var deleting = false
    @State private var feedback = false
    @State private var sent: String?
    @State private var name = ""
    @State private var nameError: String?
    @State private var asking = false
    /// The bot whose computer screen is open, from the ⋯ menu.
    @State private var screen: ScreenOpen?
    /// Home's search: the Chief, bots and groups that match, then the messages botdot finds (HomeSearch).
    @State private var query = ""
    @State private var hits: [ChatHit] = []

    struct ScreenOpen: Hashable {
        let id: String
        let name: String
    }
    @Environment(\.scenePhase) private var phase
    @State private var vault = false
    /// The tiles-on-home sheet, from a long press on the Board's cards.
    @State private var choosingTiles = false
    /// What is open over Home: a chat (ChatRoute, ChiefRoute, GroupRoute), Files, or what the menu opens (Route).
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

    // The body in steps, each of a stated type: one long chain of modifiers is slow to type-check.
    var body: some View {
        withSheets
        .environment(\.tileTicks, home.home.store.tileTicks)
        // The first run's question for the Chief's name: Save, or Skip to keep "Chief of Staff".
        .alert(ChiefName.shared.question, isPresented: $asking) {
            TextField(ChiefName.shared.role, text: $name).onChange(of: name) { _, n in if n.count > Int(ChiefName.shared.MAX) { name = String(n.prefix(Int(ChiefName.shared.MAX))) } }
            Button(tr("Save")) { answerName(name) }
            Button(tr("Skip"), role: .cancel) { answerName("") }
        } message: {
            Text(nameError.map { ChiefName.shared.explain + "\n\n" + $0 } ?? ChiefName.shared.explain)
        }
        .onChange(of: home.askName) { _, ask in asking = ask }
        // A notification's tap: its chat, once Home knows its bots and groups (AppModel.chatToOpen).
        .onChange(of: model.chatToOpen, initial: true) { openAsked() } // a cold start's tap too
        .onChange(of: home.state?.bots?.count) { openAsked() }
        .onChange(of: home.state?.groups?.count) { openAsked() }
        .onDisappear { home.stop() }
        // The live feed and the rooms' while the app is in front; back to front, it reconnects after the last event it saw.
        .onChange(of: phase) { _, now in
            home.home.live(on: now == .active)
            home.rooms.front(now == .active)
        }
        .onChange(of: home.state?.signInNeeded) { _, needed in if needed == true { model.signInNeeded(server) } }
    }

    private var list: some View {
        Group {
            if HomeSearch.shared.query(typed: query).isEmpty { lists } else { found }
        }
        .searchable(text: $query)
        .task(id: HomeSearch.shared.query(typed: query)) {
            let q = HomeSearch.shared.query(typed: query)
            hits = []
            guard q.count >= Int(HomeSearch.shared.MIN) else { return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            hits = (try? await HomeSearch.shared.hits(api: home.home.api, q: q)) ?? []
        }
    }

    /// While searching: the Chief, the bots and the groups that match, then the messages, each opening its chat.
    private var found: some View {
        let q = HomeSearch.shared.query(typed: query)
        let state = home.state
        let bots = state?.bots ?? []
        return List {
            if let state, HomeSearch.shared.chief(q: q, chiefName: state.chiefName) {
                NavigationLink(value: ChiefRoute()) { Text(state.chiefName) }
            }
            ForEach(HomeSearch.shared.bots(q: q, bots: bots), id: \.id) { b in
                NavigationLink(value: ChatRoute(botId: b.id, name: b.name)) { ContactRow(name: b.name, sub: state?.sub(b: b) ?? "", unread: 0, color: b.color, asks: false, drawing: nil) }
            }
            ForEach(HomeSearch.shared.groups(q: q, groups: state?.groups ?? [], bots: bots), id: \.id) { g in
                NavigationLink(value: GroupRoute(groupId: g.id, name: g.name)) { Text(g.name) }
            }
            if !hits.isEmpty {
                Section(tr("Messages")) {
                    ForEach(Array(hits.enumerated()), id: \.offset) { _, h in hitRow(h, chiefName: state?.chiefName ?? "") }
                }
            }
        }
        .listStyle(.plain)
        .accessibilityIdentifier("search-results")
    }

    @ViewBuilder
    private func hitRow(_ h: ChatHit, chiefName: String) -> some View {
        let label = VStack(alignment: .leading, spacing: 2) {
            Text(HomeSearch.shared.who(h: h, chiefName: chiefName)).font(.caption).foregroundStyle(.secondary)
            HomeSearch.shared.snippet(h: h).reduce(Text("")) { t, p in t + Text(p.text).fontWeight(p.hit ? .semibold : .regular) }
                .font(.subheadline).lineLimit(2)
        }
        if let to = HomeSearch.shared.opens(h: h) {
            switch onEnum(of: to) {
            case .chief(let c): NavigationLink(value: ChiefRoute(chatId: c.chatId)) { label }
            case .bot(let b): NavigationLink(value: ChatRoute(botId: b.id, name: b.name)) { label }
            }
        } else {
            label
        }
    }

    private var lists: some View {
        List {
            if let error = home.state?.error ?? home.error {
                Text(error).foregroundStyle(.red).accessibilityIdentifier("error")
            }
            if let state = home.state, NeedsDeskKt.needsYouOpens(waiting: state.waiting, bots: state.bots) {
                // A tap opens Needs you, where each card is answered.
                NavigationLink {
                    NeedsYouView(home: home.home, figure: home.figure)
                } label: {
                    NeedsYou(waiting: state.waiting, figure: home.figure) { id, yes in Task { await home.answer(id, yes: yes) } }
                }
                .accessibilityIdentifier("needs-you")
                .listRowSeparator(.hidden)
            }
            if let state = home.state, let board = state.board {
                // A tap opens the Board, where each tile does its thing.
                NavigationLink {
                    BoardView(home: home.home, figure: home.figure)
                } label: {
                    BoardCards(tiles: board)
                }
                // A long press picks the tiles on home (#447), on a botdot with home-tiles.
                .simultaneousGesture(LongPressGesture().onEnded { _ in
                    if HomeTiles.shared.shows(features: state.version?.features) { choosingTiles = true }
                })
                .accessibilityIdentifier("board")
                .listRowSeparator(.hidden)
            }
            if let rooms = home.rooms.state, rooms.on {
                // "Shared rooms" under Needs you and the Board, as on Android, with the invitations that wait.
                NavigationLink {
                    RoomsView(rooms: home.rooms, figure: home.figure)
                } label: {
                    Text("\(Text(RoomWords.shared.TITLE).bold())\(Text(rooms.row.map { " · " + $0 } ?? "").foregroundStyle(.orange))").lineLimit(1)
                }
                .accessibilityIdentifier("rooms")
                .listRowSeparator(.hidden)
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
    }

    private var routed: some View {
        list
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
            .toolbar { toolbar }
        .navigationDestination(isPresented: $vault) { VaultView(api: home.home.api, settings: model.settings) }
        .projectSpaces(home: home.home, figure: home.figure) // the switch of spaces, on a botdot with projects (#1366)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu { menu } label: {
                Image(systemName: "ellipsis.circle").accessibilityLabel(tr("More"))
            }
        }
    }

    /// Home's ⋯ menu.
    @ViewBuilder
    private var menu: some View {
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
        if home.offers?.feedback == true { Button(Feedback.shared.TITLE) { feedback = true } }
        if home.offers?.deletion != nil { Button(tr("Delete account"), role: .destructive) { deleting = true } }
        Button(tr("Passwords")) { vault = true }
        Divider()
        Button(tr("Change botdot's address")) { model.otherAddress() }
        Button(tr("Sign out"), role: .destructive) { Task { await model.signOut(server) } }
    }

    private var whatsNewShown: Binding<Bool> {
        Binding(get: { home.showsWhatsNew && !feedback }, set: { if !$0 { home.whatsNewClosed() } })
    }

    private var withSheets: some View {
        NavigationStack(path: $path) { routed }
        .task {
            home.home.keep(settings: model.settings) // the folded categories, kept on the phone
            home.start()
            home.home.live(on: true)
            await Notifications.shared.start(home.home.api) // asks and registers once this botdot sends to iPhones
        }
        .overlay(alignment: .bottom) {
            if let sent {
                Text(sent).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16).accessibilityIdentifier("notice")
                    .task { try? await Task.sleep(for: .seconds(3)); self.sent = nil }
            }
        }
        .sheet(isPresented: $deleting) {
            if let offer = home.offers?.deletion {
                AccountDeletionView(offer: offer, api: home.home.api) { words in model.accountDeleted(server, words) }
            }
        }
        .sheet(isPresented: $choosingTiles) { HomeTilesView(home: home.home) }
        .sheet(isPresented: $feedback) {
            FeedbackView(api: home.home.api, shotsOn: home.offers?.shots == true) { sent = tr("Sent") }
        }
        // What's new after an update, once, after the Chief's name; closed any way, its notes are seen.
        .sheet(isPresented: whatsNewShown) {
            WhatsNewSheet(entries: home.whatsNew) { home.whatsNewClosed() }
        }
    }

    /// The Chief's name, saved or skipped; a refusal keeps the question, saying why.
    private func answerName(_ given: String) {
        Task {
            nameError = await home.nameChief(given)
            // The alert closed with the tap: it asks again, saying why.
            if nameError != nil { asking = true }
        }
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
            CategoryHeading(category: ListLayout.shared.categoryOf(key: key), folded: state.isFolded(category: ListLayout.shared.categoryOf(key: key)),
                            works: state.foldedWorks(category: ListLayout.shared.categoryOf(key: key))) {
                Task { try? await home.home.toggleFolded(category: ListLayout.shared.categoryOf(key: key)) }
            }
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
    /// What its box starts with (a standup's Reply); nil, the box as it was.
    var words: String? = nil
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

/// A category's heading: a tap folds it to the heading alone, or opens it; folded, a green dot says one of its bots
/// works (Android's Home).
struct CategoryHeading: View {
    let category: String
    let folded: Bool
    let works: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                Text(category.isEmpty ? tr("Other") : category).font(.footnote.weight(.semibold)).textCase(.uppercase)
                Image(systemName: "chevron.down").font(.caption2).rotationEffect(.degrees(folded ? -90 : 0))
                if works { Circle().fill(.green).frame(width: 7, height: 7).accessibilityLabel(tr("Working")) }
                Spacer(minLength: 0)
            }
            .foregroundStyle(.secondary)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(folded ? tr("Show this category") : tr("Hide this category"))
    }
}

/// Needs you, above the Board: one line for each thing that waits, with the small mark of the bot it is about.
struct NeedsYou: View {
    let waiting: [Waiting]
    let figure: FigureDef?
    /// Allow or No on a row that asks for a permission, answered here as on Android; the rest open Needs you.
    var onAnswer: (String, Bool) -> Void = { _, _ in }
    /// On a project's board (overview-board, ADR 245): the questions in its chats, each opening its chat, and the cards
    /// asked in its Chief chat ([Overviews.needsYou]).
    var questions: [OverviewEntry] = []
    var asks: [Ask] = []
    var onQuestion: (OverviewEntry) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(tr("Needs you")).font(.headline)
            if !questions.isEmpty { OverviewRows(items: questions, empty: nil, onOpen: onQuestion) }
            ForEach(asks, id: \.id) { a in Text(Overviews.shared.askText(a: a)).font(.subheadline).lineLimit(2) }
            ForEach(Array(waiting.enumerated()), id: \.offset) { _, w in
                HStack(spacing: 8) {
                    if let figure {
                        FigureView(drawing: FigurePaint.shared.small(def: figure, color: w.color ?? ChiefColorKt.CHIEF_COLOR, outfit: w.color == nil ? FigureDef.companion.CHIEF : w.outfit, dark: true))
                            .frame(width: 20, height: 20)
                    }
                    Text(w.text).font(.subheadline).lineLimit(2)
                    if let id = w.permission {
                        Spacer(minLength: 4)
                        // Borderless: a tap on the button is the answer, not the row's link to Needs you.
                        Button(tr("No")) { onAnswer(id, false) }.buttonStyle(.borderless).foregroundStyle(.secondary)
                        Button(tr("Allow")) { onAnswer(id, true) }.buttonStyle(.borderedProminent).controlSize(.small)
                    }
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
