import SwiftUI
import BotdotShared

// Projects on the iPhone (#1366), as the Android app's on a phone: the switch of spaces over Home, a project's page
// with its board, its cards and Tidy, its teams and its own bots, the Files tile and its default chat at the bottom,
// and its settings behind the gear. What each part shows and sends is the shared ProjectDesk's (ADR 242).

/// A project's page, opened from the switch of spaces.
struct ProjectRoute: Hashable, Identifiable {
    let id: String
}

extension View {
    /// Home's switch of spaces (Android's SpaceTitle and SpaceSheet): on a botdot with projects, a button that opens
    /// the sheet of Home and each project with what waits in it; a project opens its page.
    func projectSpaces(home: HomeStore, figure: FigureDef?) -> some View {
        modifier(ProjectSpaces(home: home, figure: figure))
    }
}

private struct ProjectSpaces: ViewModifier {
    let home: HomeStore
    let figure: FigureDef?
    @State private var model: ProjectModel?
    @State private var sheet = false
    @State private var open: ProjectRoute?
    @State private var starting = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                if let state = model?.state, state.shows {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { sheet = true } label: {
                            Label(tr("Projects"), systemImage: "square.grid.2x2")
                        }
                        .accessibilityIdentifier("spaces")
                    }
                }
            }
            .sheet(isPresented: $sheet) {
                SpaceSheet(spaces: model?.state?.spaces ?? [], onNew: { sheet = false; starting = true }) { id in
                    sheet = false
                    if let id { open = ProjectRoute(id: id) }
                }
                .presentationDetents([.medium, .large])
            }
            .navigationDestination(item: $open) { r in ProjectView(home: home, id: r.id, figure: figure) }
            .navigationDestination(isPresented: $starting) { CompanySetupView(home: home, figure: figure, fresh: true) }
            .task {
                if model == nil { model = ProjectModel(home: home) }
                model?.start()
            }
            .onDisappear { model?.stop() }
    }
}

/// The sheet of spaces: Home, then each project with its square and what waits in it.
struct SpaceSheet: View {
    let spaces: [Spaces.Space]
    /// "New project": the start screen, for another one.
    let onNew: () -> Void
    /// A project's id, or nil for Home.
    let pick: (String?) -> Void

    var body: some View {
        List {
            Button { pick(nil) } label: {
                HStack(spacing: 16) {
                    RoundedRectangle(cornerRadius: 8).fill(.quaternary).frame(width: 36, height: 36)
                        .overlay(Text("b").font(.headline))
                    Text(tr("Home"))
                }
            }
            ForEach(spaces, id: \.id) { s in
                Button { pick(s.id) } label: {
                    HStack(spacing: 16) {
                        SpaceSquare(name: s.name, color: s.color, size: 36)
                        Text(s.name).lineLimit(1)
                        Spacer(minLength: 0)
                        if s.asks > 0 { Count(n: Int(s.asks)) }
                    }
                }
                .accessibilityIdentifier("space-\(s.id)")
            }
            Button(action: onNew) { Label(tr("New project"), systemImage: "plus") }
                .accessibilityIdentifier("new-project")
        }
        .tint(.primary)
    }
}

/// A project's square: its colour, its first letter.
struct SpaceSquare: View {
    let name: String
    let color: String
    let size: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: size / 4).fill(ContactRow.tint(color)).frame(width: size, height: size)
            .overlay(Text(name.prefix(1).uppercased()).font(size >= 40 ? .headline : .subheadline.weight(.semibold)).foregroundStyle(.white))
            .accessibilityHidden(true)
    }
}

/// What waits, as a small count; nothing while nothing waits.
struct Count: View {
    let n: Int
    var body: some View {
        if n > 0 {
            Text(ProjectRules.shared.countText(n: Int32(n))).font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                .background(.primary, in: .capsule).foregroundStyle(Color(uiColor: .systemBackground))
        }
    }
}

/// A project's page, opened from the switch of spaces: its model is made once, when the page first shows, not each
/// time Home draws the link (each one follows the Store until it goes).
struct ProjectView: View {
    let home: HomeStore
    let id: String
    let figure: FigureDef?
    @State private var model: ProjectModel?

    var body: some View {
        Group {
            // A project not running yet is still being set up: its setup's screens, as Android's Company screen.
            if let model, let c = model.state?.project, c.id == id,
               CompanySetupDesk.companion.opensSetup(c: c, features: home.store.version.value.value?.features) { CompanySetupView(home: home, figure: figure) }
            else if let model { ProjectPage(home: home, id: id, figure: figure, model: model) }
            else { ProgressView() }
        }
        .task { if model == nil { model = ProjectModel(home: home) } }
    }
}

/// A project's page (Android's CompanyHome on a phone): its name, gear, Tidy and Project Manager; what waits in it;
/// the board (the day, the objectives, the cards, the Files tile); a row per team (the lead first, with the crown),
/// the project's own bots with Add bot; and its default chat at the bottom.
struct ProjectPage: View {
    let home: HomeStore
    let id: String
    let figure: FigureDef?
    let model: ProjectModel
    @Environment(\.dismiss) private var dismiss
    @State private var settings = false
    @State private var picking: Picking?
    @State private var panel: TeamRoute?
    @State private var chat: ChatRoute?
    @State private var chief: ChiefRoute?
    @State private var group: GroupRoute?
    @State private var files: FilesPlace?
    /// The project's Overview (ADR 236), from the toolbar.
    @State private var overview = false
    @State private var unfolded: Set<String> = []

    /// A team's panel on screen.
    struct TeamRoute: Identifiable {
        let id: String
    }

    /// A bot picker on screen: Add bot (the project's own), or a team's "+".
    struct Picking: Identifiable {
        let team: String?
        let title: String
        let bots: [Bot]
        var id: String { team ?? "" }
    }

    var body: some View {
        List {
            if let s = model.state, let c = s.project, c.id == id {
                page(s, c)
            } else if let error = model.state?.error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .refreshable { await model.refresh() }
        .navigationTitle(model.state?.project?.id == id ? model.state?.name ?? "" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .safeAreaInset(edge: .bottom) { chatField }
        .navigationDestination(isPresented: $settings) { ProjectSettingsView(model: model, figure: figure, onDeleted: { settings = false; dismiss() },
                                onFolder: model.state?.project?.folder == nil ? nil : { if let c = model.state?.project { settings = false; file(c, nil) } }) }
        .navigationDestination(isPresented: $overview) {
            if let c = model.state?.project { ProjectOverviewView(company: c, api: home.api, onOpen: { open($0, c) }, onFile: { file(c, $0) }) }
        }
        .navigationDestination(item: $chat) { r in ChatView(home: home, botId: r.botId, name: r.name) }
        .navigationDestination(item: $chief) { r in ChiefView(home: home, chatId: r.chatId) }
        .navigationDestination(item: $group) { r in GroupChatView(home: home, groupId: r.groupId, name: r.name, figure: figure) }
        .navigationDestination(item: $files) { FilesView(api: home.api, at: $0) }
        .sheet(item: $picking) { p in
            BotPickerView(title: p.title, bots: p.bots, figure: figure) { ids in
                Task { if let team = p.team { await model.addToTeam(team, ids) } else { await model.addOwn(ids) } }
            }
            .modifier(ProjectNotice(model: model))
        }
        .sheet(item: $panel) { t in
            TeamPanel(model: model, teamId: t.id, figure: figure, onBot: { b in panel = nil; chat = ChatRoute(botId: b.id, name: b.name) })
                .presentationDetents([.medium, .large])
                .modifier(ProjectNotice(model: model))
        }
        .modifier(ProjectNotice(model: model))
        // Followed while the page is in the stack, also under its settings or a chat it opened: the model closes it when it goes.
        .task { model.start(); model.show(id); model.follow(true) }
    }

    /// An Overview entry's chat (Overviews.open): a team's, a bot's, a Chief chat, or the project's own Chief chat.
    private func open(_ e: OverviewEntry, _ c: Company) {
        let dest = e.destination(project: c, bots: home.store.bots.value.value as? [Bot], features: home.store.version.value.value?.features)
        guard let to = Overviews.shared.open(destination: dest) else { return }
        overview = false
        switch onEnum(of: to) {
        case .team(let t): group = GroupRoute(groupId: t.groupId, name: e.name)
        case .bot(let b): chat = ChatRoute(botId: b.botId, name: e.name)
        case .chiefChat(let ch): chief = ChiefRoute(chatId: ch.chatId)
        case .chief: chief = ChiefRoute()
        case .projectChief: Task { let id = await model.chiefChat(); if !id.isEmpty { chief = ChiefRoute(chatId: id) } }
        }
    }

    /// A file of the project's folder from the Overview, or the folder (nil).
    private func file(_ c: Company, _ path: String?) {
        guard let folder = c.folder?.name else { return }
        overview = false
        files = FilesPlace(owner: ProjectFiles.shared.owner(folder: folder), name: folder, path: path.map { ProjectFiles.shared.folderOf(path: $0) } ?? "", file: path ?? "")
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let s = model.state, s.project?.id == id {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let m = s.manager {
                    Button { chat = ChatRoute(botId: m.id, name: m.name) } label: { head(m, 26) }
                        .accessibilityLabel("\(tr("Project Manager")): \(m.name)")
                }
                if s.tidy {
                    // Tidy asks the project's Chief in its chat, which opens.
                    Button { Task { let id = await model.tidy(); if !id.isEmpty { chief = ChiefRoute(chatId: id) } } } label: { Image(systemName: s.tidying ? "hourglass" : "square.grid.3x3") }
                        .disabled(s.tidying)
                        .accessibilityLabel(tr("Tidy up the board"))
                }
                if s.overview {
                    Button { overview = true } label: { Image(systemName: "list.bullet.rectangle") }
                        .accessibilityLabel(tr("Overview"))
                }
                if s.settings {
                    Button { settings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel(tr("Project settings"))
                        .accessibilityIdentifier("project-settings")
                }
            }
        }
    }

    @ViewBuilder
    private func page(_ s: ProjectState, _ c: Company) -> some View {
        if let day = s.day?.intValue {
            Text(tr("Day {n} of 90", ["n": "\(day)"])).font(.caption.monospaced()).foregroundStyle(.secondary)
                .padding(.horizontal, 12).padding(.vertical, 4).background(.quaternary, in: .capsule)
                .listRowSeparator(.hidden)
        }
        if !s.needs.isEmpty {
            NavigationLink { NeedsYouView(home: home, figure: figure) } label: { NeedsYou(waiting: s.needs, figure: figure) }
                .listRowSeparator(.hidden)
        }
        if !s.goals.isEmpty {
            Goals(goals: s.goals).listRowSeparator(.hidden)
        } else if !s.goal.isEmpty && s.cards == nil {
            Text(s.goal).foregroundStyle(.secondary).listRowSeparator(.hidden)
        }
        if let slots = s.cards {
            CardsRow(model: model, state: s, slots: slots, figure: figure).listRowSeparator(.hidden)
        }
        if s.filesTile {
            FilesTile(files: s.files) { file in
                if let folder = c.folder?.name {
                    files = FilesPlace(owner: ProjectFiles.shared.owner(folder: folder), name: folder, path: file.map { ProjectFiles.shared.folderOf(path: $0) } ?? "", file: file ?? "")
                }
            }
            .listRowSeparator(.hidden)
        }
        ForEach(s.teams, id: \.team.id) { t in
            teamRow(t).listRowSeparator(.hidden)
        }
        if s.ownBots {
            OwnKeys(keys: s.own, figure: figure, busy: s.ownSaving, onBot: { b in chat = ChatRoute(botId: b.id, name: b.name) }) {
                picking = Picking(team: nil, title: tr("Add bot"), bots: s.addable)
            }
            .listRowSeparator(.hidden)
        }
    }

    /// One row per team (Android's TeamKeys), folded at first: the faces, the name and what it is at. The chevron shows
    /// its bots as keys with "+"; the name opens the team's panel, where Make lead is.
    private func teamRow(_ t: ProjectTeam) -> some View {
        let open = unfolded.contains(t.team.id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    if open { unfolded.remove(t.team.id) } else { unfolded.insert(t.team.id) }
                } label: {
                    Image(systemName: open ? "chevron.down" : "chevron.right").frame(width: 32, height: 32)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(tr("Members"))
                // The team's name opens its chat (a group chat); with none, the team's panel.
                Button {
                    if let g = t.chat { group = GroupRoute(groupId: g, name: t.team.name) } else { panel = TeamRoute(id: t.team.id) }
                } label: {
                    HStack(spacing: 8) {
                        HStack(spacing: -8) { ForEach(t.keys.prefix(3), id: \.bot.id) { k in head(k.bot, 26) } }
                        Text(t.team.name).font(.headline).lineLimit(1)
                        Spacer(minLength: 0)
                        if !t.word.isEmpty {
                            Circle().fill(t.asks ? .orange : .green).frame(width: 7, height: 7)
                            Text(t.word).font(.subheadline.weight(t.asks ? .semibold : .regular)).foregroundStyle(t.asks ? .orange : .secondary).lineLimit(1)
                        }
                    }
                }
                .buttonStyle(.borderless)
                .tint(.primary)
                .accessibilityIdentifier("team-\(t.team.id)")
            }
            if open {
                ForEach(t.keys, id: \.bot.id) { k in
                    KeyRow(key: k, figure: figure) { chat = ChatRoute(botId: k.bot.id, name: k.bot.name) }
                }
                Button {
                    picking = Picking(team: t.team.id, title: tr("Add bots to {team}", ["team": t.team.name]), bots: model.offered(t.team.id))
                } label: { Label(tr("Add bots to {team}", ["team": t.team.name]), systemImage: "plus") }
                .buttonStyle(.borderless).font(.subheadline)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
    }

    /// The default chat's field at the bottom (ADR 235): the Project Manager's chat, else the project's Chief chat.
    @ViewBuilder
    private var chatField: some View {
        if let s = model.state, s.project?.id == id, let field = s.chat {
            let label = HStack(spacing: 12) {
                if let b = field.bot { head(b, 28) } else if let figure {
                    FigureView(drawing: FigurePaint.shared.small(def: figure, color: ChiefColorKt.CHIEF_COLOR, outfit: FigureDef.companion.CHIEF, dark: true)).frame(width: 28, height: 28)
                }
                Text(field.name).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                Count(n: Int(field.waiting))
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(.bar, in: .capsule)
            .padding(.horizontal).padding(.bottom, 4)
            if let b = field.bot {
                Button { chat = ChatRoute(botId: b.id, name: b.name) } label: { label }.tint(.primary).accessibilityIdentifier("project-chat")
            } else {
                // The project's own Chief chat, made on the first tap.
                Button { Task { let id = await model.chiefChat(); if !id.isEmpty { chief = ChiefRoute(chatId: id) } } } label: { label }
                    .tint(.primary).accessibilityIdentifier("project-chat")
            }
        }
    }

    private func head(_ b: Bot, _ size: CGFloat) -> some View {
        Group {
            if let figure { FigureView(drawing: FigurePaint.shared.figure(def: figure, color: b.color, state: b.state, outfit: b.outfit, dark: true)) }
            else { Circle().fill(ContactRow.tint(b.color)) }
        }
        .frame(width: size, height: size)
    }
}

/// A bot's key in a team or among the project's own bots: its head, its name, its line, the crown on the lead.
struct KeyRow: View {
    let key: ProjectKey
    let figure: FigureDef?
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                ZStack(alignment: .topTrailing) {
                    if let figure { FigureView(drawing: FigurePaint.shared.figure(def: figure, color: key.bot.color, state: key.bot.state, outfit: key.bot.outfit, dark: true)).frame(width: 32, height: 32) }
                    if key.crown { Image(systemName: "crown.fill").font(.caption2).foregroundStyle(.yellow).offset(x: 6, y: -4) }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(key.bot.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if !key.line.isEmpty { Text(key.line).font(.caption).foregroundStyle(key.asks ? .orange : .secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
                let dots = Int(Unread.shared.dots(unread: key.bot.unread))
                if dots > 0 { Circle().fill(ContactRow.tint(key.bot.color)).frame(width: 7, height: 7) }
            }
        }
        .buttonStyle(.borderless)
        .tint(.primary)
        .accessibilityElement(children: .combine)
    }
}

/// The project's own bots in no team (ADR 233), with Add bot after them.
struct OwnKeys: View {
    let keys: [ProjectKey]
    let figure: FigureDef?
    let busy: Bool
    let onBot: (Bot) -> Void
    let onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(keys, id: \.bot.id) { k in KeyRow(key: k, figure: figure) { onBot(k.bot) } }
            Button(action: onAdd) { Label(tr("Add bot"), systemImage: "plus") }
                .buttonStyle(.borderless).font(.subheadline).disabled(busy)
                .accessibilityIdentifier("add-bot")
        }
        .padding(10)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
    }
}

/// The objectives on the board: each its name, its number and the one aimed at, and a bar in its colour.
struct Goals: View {
    let goals: [Objective]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], alignment: .leading, spacing: 12) {
            ForEach(goals, id: \.id) { o in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 4) {
                        Circle().fill(ContactRow.tint(o.color)).frame(width: 8, height: 8).padding(.top, 4)
                        Text(o.name).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    (Text(CompanyFloor.shared.num(d: o.current)).font(.headline) + Text(" / " + CompanyFloor.shared.num(d: o.target)).font(.caption).foregroundStyle(.tertiary))
                    ProgressView(value: Double(CompanyFloor.shared.ratio(o: o))).tint(ContactRow.tint(o.color))
                }
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
    }
}

/// The Files tile: the newest files of the project's folder, with when each changed. A tap on its title opens the
/// folder in Files ([open] with nil), a tap on a file opens it over its folder.
struct FilesTile: View {
    let files: [RecentFile]
    let open: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { open(nil) } label: {
                Label(tr("Files"), systemImage: "folder").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("project-files")
            ForEach(files, id: \.path) { f in
                Button { open(f.path) } label: {
                    HStack {
                        Image(systemName: "doc.text").foregroundStyle(.secondary)
                        Text(f.name).font(.subheadline).lineLimit(1)
                        Spacer(minLength: 0)
                        Text(ProjectRules.shared.fileWhen(at: f.at)).font(.caption).foregroundStyle(.secondary)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
        .accessibilityIdentifier("project-files-tile")
    }
}

/// A team's panel (Android's TeamSheet): its objective, its bots with what each does, the lead's word and Make lead on the others.
struct TeamPanel: View {
    let model: ProjectModel
    let teamId: String
    let figure: FigureDef?
    let onBot: (Bot) -> Void
    @State private var moving: String?

    var body: some View {
        let t = model.state?.teams.first { $0.team.id == teamId }
        NavigationStack {
            List {
                if let t {
                    if let o = t.objective {
                        HStack {
                            Text(o.name).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Text(CompanyFloor.shared.num(d: o.current) + " / " + CompanyFloor.shared.num(d: o.target)).font(.headline)
                        }
                    }
                    ForEach(t.keys, id: \.bot.id) { k in
                        HStack {
                            KeyRow(key: k, figure: figure) { onBot(k.bot) }
                            if k.lead {
                                Text(tr("Lead")).font(.caption).foregroundStyle(.yellow)
                            } else if moving == nil {
                                Button(tr("Make lead")) {
                                    moving = k.bot.id
                                    Task { await model.makeLead(teamId, k.bot.id); moving = nil }
                                }
                                .buttonStyle(.bordered).font(.caption)
                            }
                        }
                    }
                }
            }
            .navigationTitle(t?.team.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// A list of bots to pick from, with Add: Add bot's and a team's "+".
struct BotPickerView: View {
    let title: String
    let bots: [Bot]
    let figure: FigureDef?
    let done: ([String]) -> Void
    @State private var picked: [String] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(bots, id: \.id) { b in
                Button {
                    if let i = picked.firstIndex(of: b.id) { picked.remove(at: i) } else { picked.append(b.id) }
                } label: {
                    HStack(spacing: 12) {
                        if let figure { FigureView(drawing: FigurePaint.shared.figure(def: figure, color: b.color, state: b.state, outfit: b.outfit, dark: true)).frame(width: 32, height: 32) }
                        VStack(alignment: .leading) {
                            Text(b.name)
                            if !b.description_.isEmpty { Text(b.description_).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                        }
                        Spacer()
                        if picked.contains(b.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                }
                .tint(.primary)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Add")) { done(picked); dismiss() }.disabled(picked.isEmpty)
                }
            }
        }
    }
}

/// What botdot refused on a project's page, its settings or a sheet over them, in its words for a moment at the top
/// (the shared ProjectState's notice, new with each noticeCount): each screen shows it, as the one on top is seen.
struct ProjectNotice: ViewModifier {
    let model: ProjectModel
    @State private var notice: String?
    @State private var timer: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let notice { Text(notice).font(.callout).padding(10).background(.thinMaterial, in: .capsule).padding(.top, 8).accessibilityIdentifier("notice") }
            }
            .onChange(of: model.state?.noticeCount) {
                notice = model.state?.notice
                timer?.cancel()
                timer = Task { try? await Task.sleep(for: .seconds(3)); if !Task.isCancelled { notice = nil } }
            }
    }
}
