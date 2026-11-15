import SwiftUI
import BotdotShared

/// Where a room opens: its chat, or its settings (a room just made opens on them, to share its link).
enum RoomRoute: Hashable {
    case chat(String)
    case settings(String)
}

/// Shared rooms, opened from Home's row, as the Android app's RoomsScreen: the invitations that wait, each with Accept
/// and Decline, then the rooms; New room and Join (with an invite link) at the top.
struct RoomsView: View {
    let rooms: RoomsModel
    let figure: FigureDef?
    @State private var open: RoomRoute?
    @State private var making = false
    @State private var name = ""
    @State private var joining = false
    @State private var link = ""
    @State private var seen: RoomsJoin?
    @State private var notice: String?

    // The body in steps, each of a stated type: one long chain of modifiers is slow to type-check.
    var body: some View {
        asked
            .overlay(alignment: .bottom) { noticeLine }
            .task { await rooms.refresh() }
    }

    private var list: some View {
        List {
            if let state = rooms.state {
                ForEach(state.invites, id: \.id) { (i: RoomInviteView) in invite(i) }
                if state.empty {
                    Text(tr("No rooms yet")).foregroundStyle(.secondary).listRowSeparator(.hidden)
                }
                ForEach(state.rooms, id: \.id) { (r: RoomRowView) in room(r) }
            } else {
                ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
    }

    private func invite(_ i: RoomInviteView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(i.name).font(.headline)
            Text(i.line).font(.subheadline).foregroundStyle(.secondary)
            HStack {
                Button(tr("Accept")) { act { await rooms.accept(i.id) } }.buttonStyle(.bordered)
                Button(tr("Decline")) { act { await rooms.decline(i.id) } }.buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
    }

    private func room(_ r: RoomRowView) -> some View {
        Button { open = .chat(r.id) } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.name).lineLimit(1)
                    Text(r.line).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(r.time).font(.caption).foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("room-" + r.id)
    }

    private var routed: some View {
        list
            .refreshable { await rooms.refresh() }
            .navigationTitle(RoomWords.shared.TITLE)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .navigationDestination(item: $open) { (route: RoomRoute) in destination(route) }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if rooms.state?.links == true { ToolbarItem(placement: .topBarTrailing) { Button(tr("Join")) { link = ""; joining = true } } }
        if rooms.state?.on == true { ToolbarItem(placement: .topBarTrailing) { Button(tr("New room")) { name = ""; making = true }.accessibilityIdentifier("new-room") } }
    }

    @ViewBuilder
    private func destination(_ route: RoomRoute) -> some View {
        switch route {
        case .chat(let id): RoomChatView(rooms: rooms, id: id, figure: figure)
        case .settings(let id): RoomSettingsView(rooms: rooms, id: id, figure: figure)
        }
    }

    private var seenShown: Binding<Bool> { Binding(get: { seen != nil }, set: { if !$0 { seen = nil } }) }

    private var asked: some View {
        routed
            .alert(tr("New room"), isPresented: $making) {
                TextField(tr("Name"), text: $name).onChange(of: name) { _, n in name = Self.capped(n) }
                Button(tr("Make")) { make(name) }
                Button(tr("Cancel"), role: .cancel) {}
            }
            .alert(tr("Join a room"), isPresented: $joining) {
                TextField(tr("Invite link"), text: $link).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(tr("Next")) { look(link) }
                Button(tr("Cancel"), role: .cancel) {}
            }
            .alert(seen?.title ?? "", isPresented: seenShown, presenting: seen) { (s: RoomsJoin) in
                Button(tr("Join")) { if let token = s.token { act { await rooms.join(token) } } }
                Button(tr("Cancel"), role: .cancel) {}
            } message: { (s: RoomsJoin) in
                Text(s.says)
            }
    }

    @ViewBuilder
    private var noticeLine: some View {
        if let notice {
            Text(notice).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16).accessibilityIdentifier("notice")
                .task { try? await Task.sleep(for: .seconds(3)); self.notice = nil }
        }
    }

    /// Make, with the name typed: the new room opens on its settings, to share its link.
    private func make(_ typed: String) {
        Task {
            guard !typed.trimmingCharacters(in: .whitespaces).isEmpty, let done = await rooms.make(typed) else { return }
            if let id = done.room { open = .settings(id) } else { notice = done.failed }
        }
    }

    /// Next, with the invite link typed: a room already joined opens, another asks first.
    private func look(_ typed: String) {
        Task {
            guard let got = await rooms.look(typed) else { return }
            if let id = got.open { open = .chat(id) } else if got.token != nil { seen = got } else { notice = got.failed }
        }
    }

    /// A room's name as typed, cut at the longest one the front door takes.
    static func capped(_ n: String) -> String { n.count > Int(Rooms.shared.LONGEST_NAME) ? String(n.prefix(Int(Rooms.shared.LONGEST_NAME))) : n }

    /// An action on the list: its room opens, or what went wrong is said.
    private func act(_ block: @escaping @MainActor () async -> RoomsDone?) {
        Task {
            guard let done = await block() else { return }
            if let id = done.room { open = .chat(id) } else if let failed = done.failed { notice = failed }
        }
    }
}

/// A shared room's chat, as the Android app's RoomChatScreen: every message under who wrote it, a person by their
/// account, a bot as "name · account" with its head in its colour, and under a message the bots it mentioned; the front
/// door's notices as quiet lines; this account's own on the right. The title opens the room's settings.
struct RoomChatView: View {
    let rooms: RoomsModel
    let id: String
    let figure: FigureDef?
    @State private var model: RoomChatModel?
    @State private var typed = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if let state = model?.state {
                        Color.clear.frame(height: 1).onAppear { model?.loadOlder() }
                        if let error = state.error { Text(error).foregroundStyle(.red) }
                        if let empty = state.empty {
                            Text(empty).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(24)
                        }
                        ForEach(state.lines, id: \.id) { line in RoomLineView(line: line, figure: figure) }
                        if let sent = state.sent {
                            Bubble(text: sent, mine: true).opacity(0.6).frame(maxWidth: .infinity, alignment: .trailing)
                        }
                        if !state.working.isEmpty {
                            HStack {
                                Text(state.working).font(.subheadline).foregroundStyle(.secondary)
                                Spacer()
                                Button(tr("Stop")) { Task { await model?.stopTurns() } }
                            }
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(16)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: model?.state?.lines.last?.id) { _, _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
            .refreshable { await model?.refresh() }
        }
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(model?.state?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            NavigationLink {
                RoomSettingsView(rooms: rooms, id: id, figure: figure)
            } label: {
                Image(systemName: "person.2").accessibilityLabel(tr("Its people and bots"))
            }
        }
        .onChange(of: model?.state?.back) { _, back in
            // A message that did not go comes back into the box, in front of what was typed since.
            guard back != nil, let text = model?.takeFailed() else { return }
            typed = typed.isEmpty ? text : text + "\n" + typed
        }
        .onChange(of: model?.state?.gone) { _, gone in if gone == true { dismiss() } }
        .task {
            if model == nil { model = RoomChatModel(rooms: rooms, id: id) }
            model?.start()
        }
        .onDisappear { model?.stop() }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let note = model?.state?.note { Text(note).font(.footnote).foregroundStyle(.red) }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(model?.state?.placeholder ?? "", text: $typed, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(10)
                    .background(.quaternary, in: .rect(cornerRadius: 18))
                    .onChange(of: typed) { _, now in model?.edited(now.trimmingCharacters(in: .whitespacesAndNewlines)) }
                    .accessibilityIdentifier("room-box")
                Button {
                    let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    typed = ""
                    Task { _ = await model?.send(text) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title)
                }
                .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel(tr("Send"))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

/// One message of a room's chat.
struct RoomLineView: View {
    let line: RoomLine
    let figure: FigureDef?

    var body: some View {
        switch line.kind {
        case .notice:
            Text(line.text).font(.caption).foregroundStyle(.tertiary).multilineTextAlignment(.center).frame(maxWidth: .infinity)
        case .mine:
            VStack(alignment: .trailing, spacing: 4) {
                Bubble(text: line.text, mine: true)
                if !line.mentioned.isEmpty { Text(line.mentioned).font(.caption).foregroundStyle(.tertiary) }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        default:
            HStack(alignment: .top, spacing: 6) {
                if line.bot, let figure {
                    FigureView(drawing: FigurePaint.shared.figure(def: figure, color: line.color, state: "idle", outfit: nil, dark: true))
                        .frame(width: 28, height: 28).padding(.top, 16)
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(line.author).font(.caption.weight(.semibold)).foregroundStyle(line.bot ? ContactRow.tint(line.color) : .secondary)
                        Text(line.time).font(.caption2).foregroundStyle(.tertiary)
                    }
                    Bubble(text: line.text, mine: false)
                    if !line.mentioned.isEmpty { Text(line.mentioned).font(.caption).foregroundStyle(.tertiary) }
                }
            }
        }
    }
}

/// A message's bubble: Markdown as the server's text has it, selectable; this account's own tinted.
struct Bubble: View {
    let text: String
    let mine: Bool

    var body: some View {
        Text((try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text))
            .textSelection(.enabled)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(mine ? AnyShapeStyle(.tint.opacity(0.3)) : AnyShapeStyle(.quaternary), in: .rect(cornerRadius: 16))
    }
}

/// A room's settings, as the Android app's RoomSettingsScreen: its name, its people and who is still invited, the
/// maker's invite link with Share, its bots with Remove on this account's own, adding one of this account's bots, and
/// Leave (Delete for the account that made it).
struct RoomSettingsView: View {
    let rooms: RoomsModel
    let id: String
    let figure: FigureDef?
    @State private var model: RoomSettingsModel?
    @State private var name = ""
    @State private var asking: Bool? // true: Delete, false: Leave, while its question is open
    @State private var notice: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            if let model, let s = model.state, s.room {
                Section(tr("Name")) {
                    TextField(tr("Name"), text: $name).onChange(of: name) { _, n in name = RoomsView.capped(n) }
                    if model.desk.saves(typed: name) {
                        Button(tr("Save")) { Task { await model.rename(name) } }.disabled(s.busy)
                    }
                }
                Section(tr("People")) {
                    ForEach(s.people, id: \.self) { Text($0) }
                    ForEach(s.invited, id: \.self) { Text($0).foregroundStyle(.secondary) }
                }
                if s.linkShown {
                    Section(tr("Invite link")) {
                        if let link = s.link {
                            Text(link.url).textSelection(.enabled).font(.callout)
                            ShareLink(tr("Share"), item: link.url)
                            Button(tr("New link")) { Task { await model.makeLink(again: true) } }.disabled(s.busy)
                            Button(tr("Take back"), role: .destructive) { Task { await model.dropLink() } }.disabled(s.busy)
                        } else {
                            Button(tr("Make an invite link")) { Task { await model.makeLink(again: false) } }.disabled(s.busy)
                        }
                    }
                }
                Section(tr("Bots")) {
                    if s.bots.isEmpty { Text(tr("No bots yet.")).foregroundStyle(.secondary) }
                    ForEach(s.bots, id: \.id) { b in
                        botRow(b) { if b.removable { Button(tr("Remove")) { Task { await model.remove(b.id) } }.disabled(s.busy) } }
                    }
                    ForEach(s.addable, id: \.id) { b in
                        botRow(b) { Button(tr("Add")) { Task { await model.add(b.id) } }.disabled(s.busy) }
                    }
                }
                Section {
                    Button(tr("Leave"), role: .destructive) { asking = false }.disabled(s.busy)
                    if s.mayDelete { Button(tr("Delete"), role: .destructive) { asking = true }.disabled(s.busy) }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(model?.state?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .alert(RoomWords.shared.askTitle(delete: asking == true, name: model?.state?.name), isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), presenting: asking) { delete in
            Button(RoomWords.shared.askYes(delete: delete), role: .destructive) { Task { await model?.leave(delete: delete) } }
            Button(tr("Cancel"), role: .cancel) {}
        } message: { delete in
            Text(RoomWords.shared.askText(delete: delete))
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice).padding(12).background(.regularMaterial, in: .capsule).padding(.bottom, 16).accessibilityIdentifier("notice")
            }
        }
        .task(id: model?.state?.noticeId) {
            guard let text = model?.state?.notice else { return }
            notice = text
            try? await Task.sleep(for: .seconds(3))
            if notice == text { notice = nil }
        }
        .onChange(of: model?.state?.name) { _, n in if let n { name = n } }
        .onChange(of: model?.state?.gone) { _, gone in if gone == true { dismiss() } }
        .task {
            if model == nil { model = RoomSettingsModel(rooms: rooms, id: id) }
            model?.start()
        }
        .onDisappear { model?.stop(); model = nil }
    }

    private func botRow(_ b: RoomBotView, @ViewBuilder action: () -> some View) -> some View {
        HStack(spacing: 8) {
            if let figure {
                FigureView(drawing: FigurePaint.shared.figure(def: figure, color: b.color, state: "idle", outfit: b.outfit, dark: true)).frame(width: 24, height: 24)
            }
            Text(b.label)
            Spacer()
            action()
        }
    }
}
