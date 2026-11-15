import SwiftUI
import Observation
import BotdotShared

/// A bot's settings for one signed-in botdot: the shared layer's BotSettingsStore on Home's Store, and the state it
/// pushes. What a change sends and when it is saved are the shared layer's (BotSettings), as on Android.
@MainActor
@Observable
final class BotSettingsModel {
    private(set) var state: BotSettingsState?
    let store: BotSettingsStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore, botId: String) {
        store = BotSettingsStore(home: home, botId: botId)
    }

    func start() {
        guard watching == nil else { return }
        watching = store.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
        Task { try? await store.load() }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
    }

    /// One change to the settings, made to them as the shared layer holds them now: kept, and saved by itself a
    /// moment after the last one.
    func edit(_ change: @escaping (BotDraft) -> BotDraft) {
        store.edit(change: change)
    }

    deinit {
        store.close() // the screen is gone for good
    }

    /// Undo last change: nil when it went, else botdot's sentence.
    func undo() async -> String? {
        do { return try await store.undo() } catch { return error.localizedDescription }
    }

    /// Delete, once the owner said yes: nil when it went, else botdot's sentence.
    func delete() async -> String? {
        do {
            try await store.delete()
            return nil
        } catch {
            return error.localizedDescription
        }
    }
}

/// A bot's settings, as Android's: its figure (a tap opens its icons), name, colour, what it does, its category and
/// main assignment, pinned, its key on the keypad, and with Advanced on its model and reasoning. Each change saves by
/// itself, and "Saved" says so at the top.
struct BotSettingsView: View {
    let home: HomeStore
    let botId: String
    let figure: FigureDef?
    /// Opened from a "Learned" chip (Android's focusSkill): the Skills section in view, on that skill's row when it
    /// has one ("" for the section); nil from anywhere else.
    var focusSkill: String? = nil
    @State private var model: BotSettingsModel?
    @State private var picking = false
    /// One of its pages, open in the viewer.
    @State private var page: DocumentView.Opening?
    @State private var askDelete = false
    @State private var deleting = false
    @State private var saved = false
    @State private var failed: String?
    /// Duplicate's confirmation, while it is open; then the copy's chat.
    @State private var duplicating: DuplicateDesk?
    @State private var copy: ChatRoute?
    /// What Duplicate or a Revoke said, for a moment at the top.
    @State private var said: (text: String, count: Int) = ("", 0)
    // What is typed stays as typed: the shared draft follows it.
    @State private var name = ""
    @State private var about = ""
    @State private var category = ""
    @State private var task = ""
    @State private var seeded = false
    @Environment(\.dismiss) private var dismiss

    /// The row a "Learned" chip's skill scrolls to: its row in the library, else nil (the Skills section), as Android's focusRow.
    static func focusRow(_ skill: String, library: [String]) -> String? {
        skill.isEmpty || !library.contains(skill) ? nil : "skill-\(skill)"
    }

    var body: some View {
        ScrollViewReader { proxy in
        Form {
            if let model, let state = model.state, let bot = state.bot {
                form(model, state, bot)
            } else if let error = model?.state?.error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        // From a "Learned" chip: once the bot is read, its Skills in view, on the skill's row when it is there.
        .task(id: model?.state?.bot?.id) {
            guard let f = focusSkill, let state = model?.state, state.bot != nil else { return }
            let row = state.draft.useSkills ? BotSettingsView.focusRow(f, library: state.library) : nil
            try? await Task.sleep(for: .milliseconds(350))
            withAnimation { proxy.scrollTo(row ?? "skills", anchor: .center) }
        }
        }
        .navigationTitle(model?.state?.bot?.name ?? "")
        .navigationDestination(item: $page) { ViewerView(api: home.api, opening: $0) }
        .navigationDestination(item: $copy) { r in ChatView(home: home, botId: r.botId, name: r.name) }
        .modifier(NoticeOverlay(notice: said.text.isEmpty ? nil : said.text, count: said.count))
        .sheet(isPresented: Binding(get: { duplicating != nil }, set: { if !$0 { duplicating = nil } })) {
            if let desk = duplicating {
                DuplicateSheet(desk: desk, botName: model?.state?.bot?.name ?? "") { id, name in
                    duplicating = nil
                    copy = ChatRoute(botId: id, name: name)
                } onSaid: { said = ($0, said.count + 1) }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if saved { Text(tr("Saved")).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("saved") }
        }
        .alert(tr("Delete {name}?", ["name": model?.state?.bot?.name ?? ""]), isPresented: $askDelete) {
            Button(tr("Delete"), role: .destructive) { remove() }
            Button(tr("Keep"), role: .cancel) {}
        } message: {
            Text(model?.store.deleteText() ?? "")
        }
        .task {
            if model == nil {
                let made = BotSettingsModel(home: home, botId: botId)
                made.start()
                model = made
            }
        }
        .onChange(of: model?.state?.bot?.id) { _, _ in seed() }
        .onChange(of: model?.state?.deleted) { _, gone in if gone == true { dismiss() } }
        .task(id: model?.state?.savedAt) {
            guard (model?.state?.savedAt ?? 0) > 0 else { return }
            saved = true
            try? await Task.sleep(for: .seconds(2))
            saved = false
        }
    }

    @ViewBuilder
    private func form(_ model: BotSettingsModel, _ state: BotSettingsState, _ bot: Bot) -> some View {
        let draft = state.draft
        if let error = failed ?? state.error {
            Text(error).foregroundStyle(.red).accessibilityIdentifier("error")
        }
        Section(tr("Who it is")) {
            HStack(spacing: 12) {
                Button { picking.toggle() } label: {
                    if let figure {
                        FigureView(drawing: FigurePaint.shared.figure(def: figure, color: draft.color, state: bot.state, outfit: BotSettingsKt.withIcon(outfit: bot.outfit, icon: draft.icon), dark: true))
                            .frame(width: 56, height: 56)
                    }
                }
                .buttonStyle(.plain)
                .disabled(figure?.iconChoices.isEmpty ?? true)
                .accessibilityLabel(tr("Icon"))
                .accessibilityIdentifier("icon")
                TextField(tr("Name"), text: $name)
                    .onChange(of: name) { _, v in
                        // The longest name a bot has: the field keeps no more than is saved.
                        let most = Int(BotSettings.shared.NAME_LONGEST)
                        if v.count > most { name = String(v.prefix(most)); return }
                        model.edit { $0.withName(name: v) }
                    }
            }
            BotColorPicker(selected: draft.color) { hex in model.edit { $0.withColor(color: hex) } }
            if picking, let figure, !figure.iconChoices.isEmpty {
                BotIconPicker(figure: figure, icons: figure.iconChoices, selected: draft.icon, color: draft.color) { icon in
                    model.edit { $0.withIconNamed(icon: icon) }
                }
            }
            TextField(tr("What it does"), text: $about, axis: .vertical)
                .onChange(of: about) { _, v in model.edit { $0.withDescription(description: v) } }
            TextField(tr("Category"), text: $category)
                .onChange(of: category) { _, v in
                    let most = Int(BotSettings.shared.GROUP_LONGEST)
                    if v.count > most { category = String(v.prefix(most)); return }
                    model.edit { $0.withGroup(group: v) }
                }
        }
        Section(tr("Its main assignment")) {
            TextField("", text: $task, axis: .vertical).lineLimit(4...)
                .onChange(of: task) { _, v in model.edit { $0.withTask(task: v) } }
        }
        Section {
            Toggle(tr("Pinned below the Chief"), isOn: Binding(get: { draft.pinned }, set: { on in model.edit { $0.withPinned(pinned: on) } }))
            if state.showsHotkey {
                Picker(tr("Key on the keypad"), selection: Binding(get: { "\(draft.hotkey)" }, set: { v in model.edit { $0.withHotkey(hotkey: Int32(v) ?? 0) } })) {
                    ForEach(state.hotkeys, id: \.id) { Text($0.label).tag($0.id) }
                }
            }
            // Advanced (ADR 205): without it, its model is left as it is and not shown.
            if state.advanced {
                Picker(tr("Model"), selection: Binding(get: { draft.model }, set: { v in model.edit { $0.withModel(model: v) } })) {
                    ForEach(state.models, id: \.id) { Text($0.label).tag($0.id) }
                }
            }
            if state.showsEffort {
                Picker(tr("Reasoning"), selection: Binding(get: { draft.effort }, set: { v in model.edit { $0.withEffort(effort: v) } })) {
                    ForEach(state.efforts, id: \.id) { Text($0.label).tag($0.id) }
                }
            }
        }
        if state.undoes {
            Section {
                Button(tr("Undo last change")) { Task { failed = await model.undo() } }
            }
        }
        // A server from before every bot has a computer (ADR 192): whether it has one, as Android's "Browser".
        if state.showsBrowser {
            Section {
                Toggle(tr("Browser"), isOn: Binding(get: { draft.computer }, set: { on in model.edit { $0.withComputer(on: on) } }))
            }
        }
        Section(tr("Skills")) {
            Toggle(tr("Use skills"), isOn: Binding(get: { draft.useSkills }, set: { on in model.edit { $0.withUseSkills(on: on) } }))
            if draft.useSkills {
                ForEach(state.library, id: \.self) { name in
                    Toggle(name, isOn: Binding(get: { draft.skills.contains(name) }, set: { on in model.edit { $0.withSkill(name: name, on: on) } }))
                        .id("skill-\(name)")
                        .listRowBackground(name == focusSkill ? Color.accentColor.opacity(0.12) : nil)
                }
            }
        }
        .id("skills")
        // Its apps (Android's Apps): one row per connected app, and per account of an app with two or more (ADR 174).
        if !state.apps.isEmpty {
            Section(tr("Apps")) {
                ForEach(state.apps, id: \.id) { c in
                    Toggle(state.appName(c: c), isOn: Binding(get: { state.hasApp(c: c) }, set: { on in model.edit { $0.withApp(c: c, on: on) } }))
                }
            }
        }
        // Its pages (#346): what it made for you, each opening in the viewer, kept up to date from there.
        if let pages = state.pages {
            Section(tr("Pages")) {
                if pages.isEmpty { Text(tr("None yet")).foregroundStyle(.secondary) }
                ForEach(pages, id: \.slug) { pg in
                    Button {
                        page = DocumentView.shared.ofPage(botId: botId, slug: pg.slug, title: pg.title, from: state.bot?.name ?? "")
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pg.title)
                            Text(state.pageLine(page: pg)).font(.caption).foregroundStyle(pg.keep != nil ? .green : .secondary)
                        }
                    }
                    .tint(.primary)
                }
            }
        }
        // Always approved (#474): the jobs whose later changes need no OK and its lasting grants in connected apps;
        // Revoke takes one off at once.
        if !state.trusted.isEmpty || !state.grants.isEmpty {
            Section(tr("Always approved")) {
                ForEach(state.trusted, id: \.id) { j in
                    revokeRow(j.name, state.trustedLine(j: j)) { try await model.store.revokeJob(jobId: j.id) }
                }
                // One row per grant, as on Android: several may share an action under different labels.
                ForEach(state.grants, id: \.rowId) { g in
                    revokeRow(state.grantName(g: g), nil) { try await model.store.revokeGrant(action: g.action) }
                }
            }
        }
        // The rules you lifted for it with "Allow always for this bot" (#253).
        if !state.overrides.isEmpty {
            Section(tr("Rules you lifted")) {
                ForEach(state.overrides, id: \.id) { o in
                    revokeRow(o.action, state.overrideLine(o: o)) { try await model.store.revokeOverride(id: o.id) }
                }
            }
        }
        if state.showsOthersMayAsk || state.showsRooms {
            Section {
                if state.showsOthersMayAsk {
                    Toggle(tr("Other bots may ask it"), isOn: Binding(get: { draft.othersMayAsk }, set: { on in model.edit { $0.withOthersMayAsk(on: on) } }))
                }
                if state.showsRooms {
                    Toggle(tr("May be in shared rooms"), isOn: Binding(get: { draft.rooms.allowRooms }, set: { on in model.edit { $0.withAllowRooms(on: on) } }))
                    if draft.rooms.allowRooms {
                        Picker(tr("Who may mention it"), selection: Binding(get: { draft.rooms.whoMayMention }, set: { v in model.edit { $0.withWhoMayMention(who: v) } })) {
                            ForEach(state.whoMayMention, id: \.id) { Text($0.label).tag($0.id) }
                        }
                    }
                }
            }
        }
        Section {
            NavigationLink(tr("Scheduled jobs")) { JobsView(home: home, botId: bot.id, figure: figure) }
        }
        Section {
            if Duplicate.shared.shows(features: state.features) {
                Button(tr("Duplicate {name}", ["name": bot.name])) {
                    let desk = model.store.duplicate(name: bot.name)
                    Task { if (try? await desk.ask())?.boolValue == true { duplicating = desk } else { said = (desk.state.value.notice ?? "", said.count + 1) } }
                }
            }
            Button(role: .destructive) { askDelete = true } label: {
                Text(deleting ? tr("Deleting…") : tr("Delete {name}", ["name": bot.name]))
            }
            .disabled(deleting)
        }
    }

    /// The fields start as botdot has the bot, once it is read.
    private func seed() {
        guard !seeded, let d = model?.state?.draft, model?.state?.bot != nil else { return }
        seeded = true
        name = d.name
        about = d.description_
        category = d.group
        task = d.task
    }

    private func remove() {
        guard let model else { return }
        deleting = true
        Task {
            failed = await model.delete()
            deleting = false
        }
    }

    /// A row with Revoke (Always approved, Rules you lifted): its name, its line, and the button, which says what happened.
    private func revokeRow(_ name: String, _ line: String?, _ revoke: @escaping () async throws -> String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                if let line { Text(line).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Button(tr("Revoke")) {
                Task { if let words = try? await revoke(), !words.isEmpty { said = (words, said.count + 1) } }
            }
            .buttonStyle(.bordered)
        }
    }
}

/// The colour of a bot's figure: one of the shared BotColors, the picked one ringed.
private struct BotColorPicker: View {
    let selected: String
    let pick: (String) -> Void

    var body: some View {
        HStack {
            ForEach(BotSettingsKt.BotColors, id: \.first) { pair in
                let hex = pair.first as String? ?? ""
                let on = hex.caseInsensitiveCompare(selected) == .orderedSame
                Button { pick(hex) } label: {
                    Circle().fill(ContactRow.tint(hex)).frame(width: 26, height: 26)
                        .padding(3)
                        .overlay(Circle().strokeBorder(on ? Color.primary : .clear, lineWidth: 2))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(pair.second as String? ?? hex)
                .accessibilityAddTraits(on ? .isSelected : [])
                if hex != (BotSettingsKt.BotColors.last?.first as String?) { Spacer(minLength: 0) }
            }
        }
    }
}

/// A bot's icon (ADR 169): every icon of the kit on a tile in its colour, the picked one ringed.
private struct BotIconPicker: View {
    let figure: FigureDef
    let icons: [KotlinPair<NSString, NSString>]
    let selected: String
    let color: String
    let pick: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 48), spacing: 4)], spacing: 4) {
            ForEach(icons, id: \.first) { pair in
                let name = pair.first as String? ?? ""
                let on = name == selected
                Button { pick(name) } label: {
                    FigureView(drawing: FigurePaint.shared.figure(def: figure, color: color, state: "idle", outfit: BotSettingsKt.withIcon(outfit: nil, icon: name), dark: true))
                        .frame(width: 40, height: 40)
                        .padding(4)
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(on ? Color.primary : .clear, lineWidth: 2))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(pair.second as String? ?? name)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

private extension AlwaysAllowed {
    /// A grant's row: its action and label, since one action may have several labels.
    var rowId: String { "\(action)\u{0}\(label)" }
}
