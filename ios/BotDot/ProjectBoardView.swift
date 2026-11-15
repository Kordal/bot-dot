import SwiftUI
import UniformTypeIdentifiers
import BotdotShared

/// The cards made by Claude on a project's board (#776; Android's ProjectCardsRow, the rules are ProjectCards'): two to
/// a line, a table or a list on a line of its own; New card turns in place into the ask field, the Chief's questions
/// follow in the same place; a building card shows its live line and a bar; one built a moment ago has a green
/// outline. Each card's menu: Change, Refresh, Remove.
struct CardsRow: View {
    let model: ProjectModel
    let state: ProjectState
    let slots: [ProjectCardsSlot]
    let figure: FigureDef?
    /// The pieces to add under New card's ask: on an arranged board only under New card's own tile.
    var pieces = true

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(ProjectCards.shared.lines(slots: slots).enumerated()), id: \.offset) { _, line in
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(line.enumerated()), id: \.offset) { _, s in slot(s).frame(maxWidth: .infinity, alignment: .topLeading) }
                    if line.count == 1, !(line[0].wide) { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                }
            }
            if pieces, !state.pieces.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(state.pieces, id: \.self) { k in
                            Button { Task { await model.putPiece(k) } } label: { Label(ProjectBoard.shared.label(k: k), systemImage: "plus") }
                                .buttonStyle(.bordered).font(.subheadline)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func slot(_ s: ProjectCardsSlot) -> some View {
        switch onEnum(of: s) {
        case .new:
            Button { model.openCard(ProjectCards.shared.NEW) } label: { Label(tr("New card"), systemImage: "plus") }
                .buttonStyle(.bordered).clipShape(.capsule)
                .accessibilityIdentifier("new-card")
        case .ask(let a):
            AskCard(start: state.refused ?? a.card?.name ?? "", figure: figure, onClose: { model.closeCard() }) { text in
                Task { await model.ask(text) }
            }
        case .questions(let q):
            QuestionsCard(card: q.card, figure: figure, onClose: { Task { await model.closeQuestions(q.card.id) } }) { text in
                await model.answer(q.card.id, text)
            }
        case .card(let k):
            BoardCard(card: k.card, fresh: state.fresh.contains(k.card.id),
                      onChange: { model.openCard(k.card.id) },
                      onRefresh: { Task { await model.refreshCard(k.card.id) } },
                      onRemove: { Task { await model.removeCard(k.card.id) } })
        }
    }
}

/// The Chief's small head, as the ask field and the questions show it.
private struct ChiefHead: View {
    let figure: FigureDef?
    var body: some View {
        if let figure {
            FigureView(drawing: FigurePaint.shared.small(def: figure, color: ChiefColorKt.CHIEF_COLOR, outfit: FigureDef.companion.CHIEF, dark: true)).frame(width: 28, height: 28)
        }
    }
}

private extension View {
    func cardBox(outline: Color? = nil) -> some View {
        padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 14))
            .overlay { if let outline { RoundedRectangle(cornerRadius: 14).stroke(outline, lineWidth: 1) } }
    }
}

/// The ask field: a new card's, or a card's Change with its title in it.
struct AskCard: View {
    let start: String
    let figure: FigureDef?
    let onClose: () -> Void
    let onGo: (String) -> Void
    @State private var typed = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            ChiefHead(figure: figure)
            TextField(tr("New card"), text: $typed)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit(go)
                .onChange(of: typed) { _, now in
                    let most = Int(ProjectRules.shared.ASK_MAX)
                    if now.count > most { typed = String(now.prefix(most)) }
                }
            Button(action: go) { Image(systemName: "arrow.up") }
                .buttonStyle(.borderedProminent).clipShape(Circle())
                .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel(tr("Send"))
            Button(action: onClose) { Image(systemName: "xmark") }.buttonStyle(.borderless).accessibilityLabel(tr("Close"))
        }
        .cardBox()
        .onAppear { typed = start; focused = true }
    }

    private func go() {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { onGo(text) }
    }
}

/// The Chief's questions for a card, in its place on the board: the question that waits, its choices, and Other.
struct QuestionsCard: View {
    let card: ProjectCard
    let figure: FigureDef?
    let onClose: () -> Void
    let onAnswer: (String) async -> Bool
    @State private var other = ""
    @State private var sent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ChiefHead(figure: figure)
                Text(card.name).font(.headline).lineLimit(1)
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    ForEach(Array(ProjectCards.shared.dashes(k: card).enumerated()), id: \.offset) { _, d in
                        Capsule().fill(d == "done" ? Color.green : d == "now" ? Color.primary : Color.secondary.opacity(0.3)).frame(width: 18, height: 3)
                    }
                }
                Button(action: onClose) { Image(systemName: "xmark") }.buttonStyle(.borderless).accessibilityLabel(tr("Close"))
            }
            ForEach(card.answers, id: \.q) { a in
                Text("\(a.q) · \(a.a)").font(.caption).foregroundStyle(.secondary)
            }
            if let q = card.next {
                Text(q.q).font(.subheadline)
                ForEach(q.choices, id: \.self) { choice in
                    Button(choice) { answer(choice) }.buttonStyle(.bordered).disabled(sent)
                }
                HStack {
                    TextField(tr("Other"), text: $other).submitLabel(.send).onSubmit { answer(other) }
                    Button { answer(other) } label: { Image(systemName: "arrow.up") }
                        .buttonStyle(.borderedProminent).clipShape(Circle())
                        .disabled(sent || other.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel(tr("Send"))
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .cardBox()
        .onChange(of: card.answers.count) { sent = false; other = "" }
    }

    private func answer(_ text: String) {
        guard !sent, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        sent = true
        Task {
            // Taken or refused (said on the page), the buttons work again; what was typed goes once it was taken.
            if await onAnswer(text) { other = "" }
            sent = false
        }
    }
}

/// A card on the board: its title and menu; while it builds its live line and a bar; built, its number, list, table,
/// bars or line; failed, why.
struct BoardCard: View {
    let card: ProjectCard
    let fresh: Bool
    let onChange: () -> Void
    let onRefresh: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(card.name).font(.subheadline.weight(.semibold)).lineLimit(2)
                Spacer(minLength: 0)
                Menu {
                    Button(tr("Change"), action: onChange)
                    Button(tr("Refresh"), action: onRefresh)
                    Button(tr("Remove"), role: .destructive, action: onRemove)
                } label: { Image(systemName: "ellipsis").frame(width: 28, height: 28) }
                .accessibilityLabel(tr("More"))
            }
            if card.building {
                Text(ProjectCards.shared.stepText(s: card.step)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                ProgressView(value: Double(ProjectCards.shared.progress(steps: card.steps)))
            }
            if let content = card.body { CardBodyView(content: content) }
            if card.failed, let error = card.error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .cardBox(outline: fresh ? .green : nil)
        .accessibilityIdentifier("card-\(card.id)")
    }
}

/// What a built card shows, plain text drawn as text (ADR 004): a number, a list, a table, bars or a line.
struct CardBodyView: View {
    let content: CardBody

    var body: some View {
        let body = content
        switch body.show {
        case "list":
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(body.list.prefix(Int(ProjectCards.shared.FLOW_LIST)).enumerated()), id: \.offset) { _, x in
                    HStack(alignment: .firstTextBaseline) {
                        Text("•").foregroundStyle(.secondary)
                        Text(x.text).font(.subheadline).lineLimit(2)
                        if let tag = x.tag { Spacer(minLength: 0); Text(tag).font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
        case "table":
            VStack(spacing: 4) {
                ForEach(Array(body.rows.prefix(Int(ProjectCards.shared.FLOW_ROWS)).enumerated()), id: \.offset) { _, r in
                    HStack {
                        Text(r.label).font(.subheadline).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(r.value).font(.subheadline.monospacedDigit())
                        if let change = r.change { Text(change).font(.caption).foregroundStyle(r.tone == "bad" ? .red : r.tone == "good" ? .green : .secondary) }
                    }
                }
            }
        case "bars":
            let heights = ProjectCards.shared.barHeights(bars: body.bars)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(Array(body.bars.enumerated()), id: \.offset) { i, b in
                    VStack(spacing: 2) {
                        RoundedRectangle(cornerRadius: 2).fill(.tint).frame(height: 48 * CGFloat(heights[i].floatValue))
                        Text(b.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 64, alignment: .bottom)
        default:
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(body.value).font(.title2.weight(.semibold)).lineLimit(1)
                    if let sub = body.sub { Text(sub).font(.caption).foregroundStyle(body.tone == "bad" ? .red : body.tone == "good" ? .green : .secondary) }
                }
                if body.show == "spark", body.points.count > 1 { Spark(points: body.points.map { $0.doubleValue }).frame(height: 28) }
            }
        }
    }
}

/// A spark line of a card's points.
private struct Spark: Shape {
    let points: [Double]
    func path(in r: CGRect) -> Path {
        let lo = points.min() ?? 0, hi = max((points.max() ?? 1), lo + 1e-9)
        var p = Path()
        for (i, v) in points.enumerated() {
            let pt = CGPoint(x: r.minX + r.width * CGFloat(i) / CGFloat(points.count - 1), y: r.maxY - r.height * CGFloat((v - lo) / (hi - lo)))
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        return p.strokedPath(.init(lineWidth: 2, lineCap: .round))
    }
}

/// A project's settings behind the gear (Android's ProjectSettings): its name, its colour, its Project Manager, its
/// teams and its own bots with ✕ and Add bot, and Archive.
struct ProjectSettingsView: View {
    let model: ProjectModel
    let figure: FigureDef?
    /// Once the project is deleted: off its page.
    var onDeleted: () -> Void = {}
    /// Open, beside the project's folder: the folder in Files.
    var onFolder: (() -> Void)? = nil
    @State private var name = ""
    @State private var start = ""
    @State private var link = ""
    @State private var never = ""
    @State private var time = ""
    @State private var standupTime = ""
    @State private var adding = false
    @State private var deleting = false
    @State private var importing = false
    @State private var logins: [VaultItem]?
    @State private var team: TeamDraft?

    var body: some View {
        Form {
            if let s = model.state, let c = s.project {
                Section(tr("Name")) {
                    TextField(tr("Name"), text: $name)
                        .submitLabel(.done)
                        .onSubmit {
                            let typed = name
                            // Refused: the name botdot keeps comes back in the field, and the notice says why.
                            Task { if !(await model.rename(typed)) { name = model.state?.project?.name ?? "" } }
                        }
                        .accessibilityIdentifier("project-name")
                }
                Section(tr("Color")) {
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(40)), count: 6), alignment: .leading) {
                        ForEach(ManyProjects.shared.COLORS, id: \.self) { col in
                            let on = col.caseInsensitiveCompare(c.color ?? "") == .orderedSame
                            Button { Task { await model.setColor(col) } } label: {
                                RoundedRectangle(cornerRadius: 8).fill(ContactRow.tint(col)).frame(width: 36, height: 36)
                                    .overlay { if on { RoundedRectangle(cornerRadius: 8).stroke(.primary, lineWidth: 2) } }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(col)
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                }
                Section(tr("Site or idea")) {
                    TextField(tr("Site or idea"), text: $start, axis: .vertical)
                        .submitLabel(.done)
                        .onSubmit { let typed = start; Task { if !(await model.setStart(typed)) { start = model.state?.project?.start ?? "" } } }
                        .accessibilityIdentifier("project-start")
                }
                Section(tr("Sources")) {
                    ForEach(c.sources, id: \.id) { src in
                        HStack {
                            Text(src.name).lineLimit(1)
                            Spacer()
                            Button { Task { await model.removeSource(src.id) } } label: { Image(systemName: "xmark") }
                                .buttonStyle(.borderless)
                                .accessibilityLabel(tr("Remove"))
                        }
                    }
                    TextField(tr("Add a link"), text: $link)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit { let typed = link; Task { if await model.addLink(typed) { link = "" } } }
                    if c.sources.count < Int(CompanySetup.shared.MAX_SOURCES) { Button(tr("Add files")) { importing = true } }
                }
                if let folder = c.folder, let onFolder {
                    Section(tr("Folder")) {
                        HStack {
                            Text(folder.path).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
                            Spacer()
                            Button(tr("Open"), action: onFolder).buttonStyle(.borderless)
                        }
                    }
                }
                if s.logins {
                    Section(tr("Logins")) {
                        ForEach(c.logins, id: \.id) { l in
                            HStack {
                                Text(l.name ?? l.id).lineLimit(1)
                                Spacer()
                                Button { Task { await model.removeLogin(l.id) } } label: { Image(systemName: "xmark") }
                                    .buttonStyle(.borderless)
                                    .accessibilityLabel(tr("Remove"))
                            }
                        }
                        if c.logins.count < Int(ProjectLogins.shared.MAX) {
                            Button(tr("Add")) { Task { logins = await model.addableLogins() } }
                        }
                    }
                }
                TeamSection(model: model, state: s, project: c, team: $team, adding: $adding)
                if s.updates {
                    Section(tr("Project updates")) {
                        Picker(tr("Project updates"), selection: Binding(get: { c.updates?.every ?? "existing" }, set: { v in Task { await model.setUpdates(v) } })) {
                            ForEach(ProjectSettingWords.shared.updateChoices(setting: c.updates), id: \.id) { o in Text(o.label).tag(o.id) }
                        }
                        ForEach(c.updates?.schedules ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
                    }
                } else if s.rhythms || s.standup {
                    Section(tr("Reports")) {
                        if s.rhythms {
                            ForEach(c.teams, id: \.id) { t in
                                Picker(t.name, selection: Binding(get: { t.report ?? "" }, set: { v in Task { await model.setReportRhythm(t.id, v) } })) {
                                    ForEach(ProjectSettingWords.shared.rhythms, id: \.id) { o in Text(o.label).tag(o.id) }
                                }
                            }
                        }
                        if s.standup {
                            let st = c.standup ?? StandupSetting(on: true, time: "09:00")
                            Toggle(tr("Morning standup"), isOn: Binding(get: { st.on }, set: { on in Task { await model.setStandupOn(on) } }))
                            if st.on {
                                TextField(tr("Standup time"), text: $standupTime)
                                    .keyboardType(.numbersAndPunctuation)
                                    .submitLabel(.done)
                                    .onSubmit { let typed = standupTime; Task { if !(await model.setStandupTime(typed)) { standupTime = model.state?.project?.standup?.time ?? st.time } } }
                                    .accessibilityIdentifier("project-standup-time")
                            }
                        }
                    }
                }
                Section(tr("Never without asking")) {
                    ForEach(Array(c.never.enumerated()), id: \.offset) { i, n in
                        HStack {
                            Text(n)
                            Spacer()
                            Button { Task { await model.removeNever(i) } } label: { Image(systemName: "xmark") }
                                .buttonStyle(.borderless)
                                .accessibilityLabel(tr("Remove"))
                        }
                    }
                    if c.never.count < Int(ManyProjects.shared.MAX_NEVER) {
                        TextField(tr("Never without asking"), text: $never)
                            .submitLabel(.done)
                            .onSubmit { let typed = never; Task { if await model.addNever(typed) { never = "" } } }
                    }
                }
                Section(tr("Time")) {
                    TextField(tr("Time"), text: $time)
                        .submitLabel(.done)
                        .onSubmit { let typed = time; Task { if !(await model.setTime(typed)) { time = model.state?.project?.time ?? "" } } }
                }
                Section {
                    Button(c.archived ? tr("Unarchive") : tr("Archive")) { Task { await model.setArchived(!c.archived) } }
                    Button(tr("Delete project"), role: .destructive) { deleting = true }
                }
                .confirmationDialog(ProjectSettingWords.shared.deleteQuestion(c: c), isPresented: $deleting, titleVisibility: .visible) {
                    if c.folder != nil {
                        Button(tr("Delete its folder too"), role: .destructive) { delete(true) }
                        Button(tr("Keep its folder")) { delete(false) }
                    } else {
                        Button(tr("Delete"), role: .destructive) { delete(false) }
                    }
                    Button(tr("Cancel"), role: .cancel) {}
                }
            }
        }
        .navigationTitle(tr("Project settings"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            let c = model.state?.project
            name = c?.name ?? ""
            start = c?.start ?? ""
            time = c?.time ?? ""
            standupTime = c?.standup?.time ?? "09:00"
        }
        .modifier(ProjectNotice(model: model))
        .sheet(isPresented: $adding) {
            BotPickerView(title: tr("Add bot"), bots: model.state?.addable ?? [], figure: figure) { ids in Task { await model.addOwn(ids) } }
                .modifier(ProjectNotice(model: model))
        }
        .sheet(item: $team) { d in
            TeamEditorView(draft: d, bots: model.state?.bots ?? [], model: model)
                .modifier(ProjectNotice(model: model))
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await model.addFiles(urls) } }
        }
        .confirmationDialog(tr("Logins"), isPresented: Binding(get: { logins != nil }, set: { if !$0 { logins = nil } })) {
            ForEach(logins ?? [], id: \.id) { l in Button(l.name) { Task { await model.addLogin(l.id) } } }
            Button(tr("Cancel"), role: .cancel) {}
        }
    }

    private func delete(_ dropFolder: Bool) {
        Task { if await model.delete(dropFolder: dropFolder) { onDeleted() } }
    }
}

/// A team's editor as it opens: a new team when [id] is nil.
struct TeamDraft: Identifiable {
    let id: String?
    var name: String
    var bots: [String]
    var lead: String?
}

/// A team's editor (Android's TeamEditor): its name, which bots are in it, its lead, and Delete team for one that is
/// there. What is saved is the shared ProjectDesk's ([ManyProjects.teamBody]).
struct TeamEditorView: View {
    @State var draft: TeamDraft
    let bots: [Bot]
    let model: ProjectModel
    @State private var deleting = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section(tr("Name")) {
                    TextField(tr("Name"), text: Binding(get: { draft.name }, set: { draft.name = String($0.prefix(60)) }))
                        .accessibilityIdentifier("team-name")
                }
                Section(tr("Bots")) {
                    ForEach(bots, id: \.id) { b in
                        Button { draft.bots = ManyProjects.shared.toggle(bots: draft.bots, id: b.id) } label: {
                            HStack {
                                Text(b.name)
                                Spacer()
                                if draft.bots.contains(b.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }
                        .tint(.primary)
                    }
                }
                let members = draft.bots.compactMap { id in bots.first { $0.id == id } }
                if members.count > 1 {
                    Picker(tr("Lead"), selection: Binding(get: { draft.lead.flatMap { draft.bots.contains($0) ? $0 : nil } ?? draft.bots[0] }, set: { draft.lead = $0 })) {
                        ForEach(members, id: \.id) { b in Text(b.name).tag(b.id) }
                    }
                }
                if draft.id != nil {
                    Section { Button(tr("Delete team"), role: .destructive) { deleting = true } }
                }
            }
            .navigationTitle(draft.id == nil ? tr("New team") : draft.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("Save")) {
                        let d = draft
                        Task { if await model.saveTeam(d.id, name: d.name, bots: d.bots, lead: d.lead) { dismiss() } }
                    }
                    .disabled(!ManyProjects.shared.canSaveTeam(name: draft.name, bots: draft.bots))
                }
            }
            .confirmationDialog(deleteQuestion, isPresented: $deleting, titleVisibility: .visible) {
                Button(tr("Delete team"), role: .destructive) {
                    guard let id = draft.id else { return }
                    Task { if await model.deleteTeam(id) { dismiss() } }
                }
                Button(tr("Cancel"), role: .cancel) {}
            }
        }
    }

    private var deleteQuestion: String {
        guard let id = draft.id, let t = model.state?.project?.teams.first(where: { $0.id == id }) else { return tr("Delete team") }
        return ProjectSettingWords.shared.deleteTeamQuestion(t: t)
    }
}

/// A project's Team (Android's ProjectTeamSettings): its Project Manager, each team with Edit and New team, its own
/// bots with ✕ and Add bot. In its settings, and with overview-board behind the page's Team (ADR 238).
struct TeamSection: View {
    let model: ProjectModel
    let state: ProjectState
    let project: Company
    @Binding var team: TeamDraft?
    @Binding var adding: Bool

    var body: some View {
        let s = state
        let c = project
        Section(tr("Team")) {
            Picker(tr("Project Manager"), selection: Binding(get: { c.lead ?? "" }, set: { v in Task { await model.setLead(v.isEmpty ? nil : v) } })) {
                Text(s.chiefName).tag("")
                ForEach(s.leadChoices, id: \.id) { b in Text(b.name).tag(b.id) }
            }
            ForEach(s.teams, id: \.team.id) { t in
                HStack {
                    Text(t.team.name)
                    Spacer()
                    Text(t.keys.map { $0.bot.name }.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Button(tr("Edit")) { team = TeamDraft(id: t.team.id, name: t.team.name, bots: t.team.bots, lead: t.team.lead) }
                        .buttonStyle(.borderless)
                }
            }
            Button(tr("New team")) { team = TeamDraft(id: nil, name: "", bots: [], lead: nil) }
            if s.ownBots {
                ForEach(s.own, id: \.bot.id) { k in
                    HStack {
                        Text(k.bot.name)
                        Spacer()
                        Button { Task { await model.removeOwn(k.bot.id) } } label: { Image(systemName: "xmark") }
                            .buttonStyle(.borderless).disabled(s.ownSaving)
                            .accessibilityLabel(tr("Remove {name}", ["name": k.bot.name]))
                    }
                }
                Button(tr("Add bot")) { adding = true }.disabled(s.ownSaving)
            }
        }
    }
}

/// A project's Team page (ADR 238): with overview-board its team rows and own bots leave the board for here, each
/// opening a team's panel and chat or a bot's chat from this page, over the Team editor its settings have.
struct ProjectTeamView: View {
    let home: HomeStore
    let model: ProjectModel
    let figure: FigureDef?
    @State private var team: TeamDraft?
    @State private var adding = false
    // Its rows' routes are its own (TeamRoutes): a panel, a picker or a chat presents from this page, on top.
    @State private var unfolded: Set<String> = []
    @State private var picking: ProjectPage.Picking?
    @State private var panel: ProjectPage.TeamRoute?
    @State private var chat: ChatRoute?
    @State private var group: GroupRoute?

    /// Where its team rows and keys go: this page's own sheets and chats.
    var routes: TeamRoutes.Routes { TeamRoutes.Routes(picking: $picking, panel: $panel, chat: $chat, group: $group) }

    var body: some View {
        Form {
            if let s = model.state, let c = s.project {
                if !s.teams.isEmpty || !s.own.isEmpty {
                    Section { TeamKeysView(model: model, state: s, figure: figure, unfolded: $unfolded, routes: routes) }
                }
                TeamSection(model: model, state: s, project: c, team: $team, adding: $adding)
            }
        }
        .modifier(TeamRoutes(home: home, model: model, figure: figure, routes: routes))
        .navigationTitle(tr("Team"))
        .navigationBarTitleDisplayMode(.inline)
        .modifier(ProjectNotice(model: model))
        .sheet(isPresented: $adding) {
            BotPickerView(title: tr("Add bot"), bots: model.state?.addable ?? [], figure: figure) { ids in Task { await model.addOwn(ids) } }
                .modifier(ProjectNotice(model: model))
        }
        .sheet(item: $team) { d in
            TeamEditorView(draft: d, bots: model.state?.bots ?? [], model: model)
                .modifier(ProjectNotice(model: model))
        }
    }
}
