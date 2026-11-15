import SwiftUI
import UniformTypeIdentifiers
import BotdotShared

/// A project's setup, as the Android app's Company screen while it is not running: the start screen (an idea or a site,
/// files and links, Start from scratch), the conversation with the project's Chief, the review of its first step and
/// team with Approve, and "Creating your team". What each shows and sends is the shared layer's (CompanySetupDesk).
/// [fresh]: "New project", the start screen for another one.
struct CompanySetupView: View {
    let home: HomeStore
    let figure: FigureDef?
    var fresh = false
    @State private var model: CompanySetupModel?

    var body: some View {
        Group {
            if let model { CompanySetupPage(home: home, figure: figure, model: model) } else { ProgressView() }
        }
        .task {
            if model == nil {
                let made = CompanySetupModel(home: home)
                made.start(fresh: fresh)
                model = made
            }
        }
        // Also when the Chief's chat is pushed over it: leaving is a no-op once a project exists.
        .onDisappear { model?.leave() }
    }
}

/// The setup's screens for the phase the shared layer is at.
struct CompanySetupPage: View {
    let home: HomeStore
    let figure: FigureDef?
    let model: CompanySetupModel
    @State private var chief: ChiefRoute?
    @State private var deleting = false
    @Environment(\.dismiss) private var dismiss
    @State private var notice: String?

    var body: some View {
        content
            .navigationTitle(model.state?.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .navigationDestination(item: $chief) { (r: ChiefRoute) in ChiefView(home: home, chatId: r.chatId) }
            .confirmationDialog(deleteTitle, isPresented: $deleting, titleVisibility: .visible) { deleteButtons }
            .overlay(alignment: .bottom) { noticeLine }
            .onChange(of: model.state?.noticeId) { notice = model.state?.notice }
    }

    @ViewBuilder
    private var content: some View {
        if let s = model.state {
            switch s.phase {
            case .loading: loading(s)
            case .start: SetupStart(model: model, state: s)
            case .conversation: SetupConversation(state: s, chief: chiefName, onChief: openChief, onReview: model.review)
            case .review: SetupReview(model: model, state: s, figure: figure)
            case .creating: SetupCreating(state: s, figure: figure)
            // A setup started without the conversation (About and Team steps, Android's and the web's): the project's
            // page, as before (ProjectView opens it there, CompanySetupDesk.opensSetup).
            case .steps: running(s)
            // Approved and running: the project's own page, also on the New project path (no ProjectView around it).
            case .running: running(s)
            }
        } else {
            ProgressView()
        }
    }

    @ViewBuilder
    private func running(_ s: SetupState) -> some View {
        if let c = s.company { ProjectView(home: home, id: c.id, figure: figure) } else { ProgressView() }
    }

    @ViewBuilder
    private func loading(_ s: SetupState) -> some View {
        if let error = s.error { Text(error).foregroundStyle(.red).padding() } else { ProgressView() }
    }

    private var chiefName: String { home.store.chiefName.value as? String ?? tr("Chief of Staff") }

    private func openChief() {
        Task {
            let id = await model.chiefChat()
            if !id.isEmpty { chief = ChiefRoute(chatId: id) }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let s = model.state, s.company != nil, s.phase != .running {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(tr("Delete project"), role: .destructive) { deleting = true }
                } label: {
                    Image(systemName: "ellipsis.circle").accessibilityLabel(tr("More"))
                }
                .accessibilityIdentifier("setup-menu")
            }
        }
    }

    private var deleteTitle: String { tr("Delete {name}?", ["name": model.state?.name ?? ""]) }

    @ViewBuilder
    private var deleteButtons: some View {
        if model.state?.folder == true {
            Button(tr("Delete its folder too"), role: .destructive) { delete(true) }
            Button(tr("Keep its folder")) { delete(false) }
        } else {
            Button(tr("Delete"), role: .destructive) { delete(false) }
        }
        Button(tr("Cancel"), role: .cancel) {}
    }

    /// Deleted: the screen goes (the project's place in the stack goes with it), else the notice says why.
    private func delete(_ dropFolder: Bool) { Task { if await model.delete(dropFolder: dropFolder) { dismiss() } } }

    @ViewBuilder
    private var noticeLine: some View {
        if let notice {
            Text(notice).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16).accessibilityIdentifier("notice")
                .task { try? await Task.sleep(for: .seconds(3)); self.notice = nil }
        }
    }
}

/// The start screen: one field for the idea or the site, files and links added under it, and Start from scratch where
/// botdot offers it (it asks the project's name first).
struct SetupStart: View {
    let model: CompanySetupModel
    let state: SetupState
    @State private var what = ""
    @State private var naming = false
    @State private var name = ""
    @State private var linking = false
    @State private var link = ""
    @State private var importing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(naming || !state.go ? tr("New project") : tr("What shall we take on?")).font(.largeTitle.bold())
                if naming { nameField } else if state.go { whatField; sources; scratchButton } else { scratchButton }
            }
            .padding(16)
            .frame(maxWidth: 560, alignment: .leading)
        }
        .alert(tr("Add a link"), isPresented: $linking) {
            TextField("https://", text: $link).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            Button(tr("Add")) { _ = model.addLink(link); link = "" }
            Button(tr("Cancel"), role: .cancel) { link = "" }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { model.addFiles(urls) }
        }
    }

    private var whatField: some View {
        HStack(spacing: 8) {
            Menu {
                Button { importing = true } label: { Label(tr("Add files"), systemImage: "doc") }
                Button { linking = true } label: { Label(tr("Add a link"), systemImage: "link") }
            } label: {
                Image(systemName: "paperclip").frame(width: 32, height: 32)
            }
            .accessibilityLabel(tr("Attach"))
            TextField(tr("Goal, matter or site"), text: $what).submitLabel(.go).onSubmit(go)
                .onChange(of: what) { _, n in if n.count > 500 { what = String(n.prefix(500)) } }
                .accessibilityIdentifier("setup-what")
            goButton(enabled: !what.trimmingCharacters(in: .whitespaces).isEmpty, action: go)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(.quaternary, in: .capsule)
    }

    private var nameField: some View {
        VStack(spacing: 16) {
            HStack(spacing: 8) {
                TextField(tr("Project name"), text: $name).submitLabel(.go).onSubmit(scratch)
                    .onChange(of: name) { _, n in if n.count > 80 { name = String(n.prefix(80)) } }
                goButton(enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty, action: scratch)
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(.quaternary, in: .capsule)
            Button(tr("Back")) { naming = false }.disabled(state.going)
        }
    }

    private func goButton(enabled: Bool, action: @escaping () -> Void) -> some View {
        Group {
            if state.going { ProgressView().frame(width: 32, height: 32) }
            else {
                Button(action: action) { Image(systemName: "arrow.right.circle.fill").font(.title2) }
                    .disabled(!enabled)
                    .accessibilityLabel(tr("Go"))
            }
        }
    }

    @ViewBuilder
    private var sources: some View {
        if !state.sources.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(state.sources, id: \.id) { (s: SourceDraft) in SourceChip(source: s) { model.removeSource(s.id) } }
            }
        }
    }

    @ViewBuilder
    private var scratchButton: some View {
        if state.scratch {
            Button(tr("Start from scratch")) { naming = true }.disabled(state.going).frame(maxWidth: .infinity)
        }
    }

    private func go() { let typed = what; Task { if await model.go(typed) { what = "" } } }
    private func scratch() { let typed = name; Task { if await model.scratch(typed) { name = ""; naming = false } } }
}

/// A source added on the start screen: its kind's icon and its name, × takes it off; red when its upload failed.
struct SourceChip: View {
    let source: SourceDraft
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: source.kind == "link" ? "link" : "doc").foregroundStyle(source.failed ? .red : .secondary)
            Text(source.uploading ? source.name + " …" : source.name).lineLimit(1).foregroundStyle(source.failed ? .red : .primary)
            Button(action: onRemove) { Image(systemName: "xmark").font(.caption) }.buttonStyle(.borderless).accessibilityLabel(tr("Remove"))
        }
        .font(.subheadline)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.quaternary, in: .capsule)
    }
}

/// The conversation's landing page: what the project is, its first step once the Chief staged one, the Chief's chat,
/// and Review first step when a proposal waits ([onReview]).
struct SetupConversation: View {
    let state: SetupState
    let chief: String
    let onChief: () -> Void
    let onReview: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(state.start)
                if !state.firstStep.isEmpty {
                    Text(tr("First step")).font(.title3.bold())
                    Text(state.firstStep)
                }
                Button(chief, action: onChief).buttonStyle(.borderedProminent).accessibilityIdentifier("setup-chief")
                if let onReview, state.review {
                    Button(tr("Review first step"), action: onReview).buttonStyle(.bordered).accessibilityIdentifier("setup-review")
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The review of the first step and the team the Chief proposed: each bot's card (rename, ✕), Change the team… with
/// the Chief's answers and Undo, the starter board to untick, Never without asking, and Approve.
struct SetupReview: View {
    let model: CompanySetupModel
    let state: SetupState
    let figure: FigureDef?
    @State private var draft = ""
    @State private var renaming: Proposed?
    @State private var newName = ""

    var body: some View {
        List {
            if !state.firstStep.isEmpty {
                Section(tr("First step")) { Text(state.firstStep) }
            }
            Section { ForEach(state.proposed, id: \.key) { (b: Proposed) in botRow(b) } }
            Section { change }
            starter
            never
        }
        .safeAreaInset(edge: .bottom) { foot }
        .alert(tr("Rename"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(tr("Name"), text: $newName)
            Button(tr("Rename")) { if let b = renaming { model.rename(b.key, newName) }; renaming = nil }
            Button(tr("Cancel"), role: .cancel) { renaming = nil }
        }
    }

    private func botRow(_ b: Proposed) -> some View {
        HStack(alignment: .top, spacing: 12) {
            BotHead(figure: figure, color: b.color, size: 32)
            VStack(alignment: .leading, spacing: 4) {
                Button(b.name) { newName = b.name; renaming = b }.font(.headline).buttonStyle(.plain)
                if !b.description_.isEmpty { Text(b.description_).font(.subheadline).foregroundStyle(.secondary) }
                if !b.routines.isEmpty { Text(b.routines).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
            Button { model.remove(b.key) } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).accessibilityLabel(tr("Remove"))
        }
        .accessibilityIdentifier("proposed-\(b.key)")
    }

    @ViewBuilder
    private var change: some View {
        ForEach(Array(state.teamChat.enumerated()), id: \.offset) { (_, line: TeamLine) in
            HStack(alignment: .top) {
                Text(line.text).font(.subheadline).foregroundStyle(line.who == "you" ? .secondary : .primary)
                Spacer(minLength: 0)
                if line.undo && state.canUndo { Button(tr("Undo")) { Task { await model.undo() } }.buttonStyle(.borderless) }
            }
        }
        HStack {
            TextField(tr("Change the team…"), text: $draft).submitLabel(.send).onSubmit(send)
                .onChange(of: draft) { _, n in if n.count > 300 { draft = String(n.prefix(300)) } }
            if state.sending { ProgressView() } else {
                Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel(tr("Send"))
            }
        }
    }

    private func send() { let typed = draft; Task { if await model.changeTeam(typed) { draft = "" } } }

    @ViewBuilder
    private var starter: some View {
        if !state.starter.isEmpty {
            Section(tr("Board")) {
                ForEach(state.starter, id: \.key) { (r: StarterRow) in
                    Toggle(isOn: Binding(get: { r.on }, set: { model.tick(r.key, $0) })) {
                        Label(r.label, systemImage: r.goal ? "scope" : "chart.bar")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var never: some View {
        if !state.never.isEmpty {
            Section(tr("Never without asking")) {
                ForEach(Array(state.never.enumerated()), id: \.offset) { (i, t: String) in
                    HStack {
                        Label(t, systemImage: "lock")
                        Spacer(minLength: 0)
                        Button { model.removeNever(i) } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).accessibilityLabel(tr("Remove"))
                    }
                }
            }
        }
    }

    private var foot: some View {
        HStack {
            Button(tr("Back")) { model.back() }
            Spacer()
            Button { Task { _ = await model.approve() } } label: {
                if state.creating { ProgressView() } else { Text(state.approve).bold() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!state.approveOn)
            .accessibilityIdentifier("setup-approve")
        }
        .padding(16)
        .background(.bar)
    }
}

/// "Creating your team": each bot of the proposal while botdot makes them.
struct SetupCreating: View {
    let state: SetupState
    let figure: FigureDef?

    var body: some View {
        List {
            ForEach(Array(state.made.enumerated()), id: \.offset) { (_, b: MadeBot) in
                HStack(spacing: 12) {
                    BotHead(figure: figure, color: b.color, size: 32)
                    Text(b.name)
                    Spacer(minLength: 0)
                    ProgressView()
                }
            }
        }
        .navigationTitle(tr("Creating your team"))
    }
}

/// A bot's head in its colour, as the rest of the app draws it; a plain dot without a figure.
struct BotHead: View {
    let figure: FigureDef?
    let color: String?
    let size: CGFloat

    var body: some View {
        Group {
            if let figure {
                FigureView(drawing: FigurePaint.shared.small(def: figure, color: color, outfit: nil, dark: true))
            } else {
                Circle().fill(ContactRow.tint(color))
            }
        }
        .frame(width: size, height: size)
    }
}
