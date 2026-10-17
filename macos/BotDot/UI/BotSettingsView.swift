import SwiftUI
import BotDotKit

/// The colours a bot can have, as on the web.
let botColors: [(hex: String, name: String)] = [
    ("#1d9e75", "Teal"), ("#378add", "Blue"), ("#7f77dd", "Purple"), ("#d4537e", "Pink"),
    ("#e24b4a", "Red"), ("#ef9f27", "Amber"), ("#639922", "Green"), ("#888780", "Grey"),
]

/// A bot's settings, as on the web: every change saves by itself. Up front what it is; then one line
/// each for its computer, pinning, skills, apps, teammates and jobs; and everything technical under
/// Advanced. Its memory has no screen: it is asked and corrected by chat.
struct BotSettingsView: View {
    let botId: String
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav

    @State private var draft = Draft()
    @State private var saved: [String: String] = [:]
    @State private var loaded = false
    @State private var note = ""
    @State private var saveTask: Task<Void, Never>?

    @State private var docker = false
    @State private var skills: SkillLists?
    @State private var apps: [ConnectedApp] = []
    @State private var settings: ServerSettings?
    @State private var confirmDelete = false
    @AppStorage("botdot.bs.advanced") private var advancedOpen = false
    @State private var newGroup = ""
    @State private var addingGroup = false

    /// The form, in the shape the API takes.
    struct Draft: Equatable {
        var name = "", color = "", description = "", group = "", prompt = "", systemPrompt = ""
        var computerEgress = "internet"
        var computer = false, computerAlwaysOn = false
        var skills: Set<String> = [], disabledSkills: Set<String> = [], connectors: Set<String> = [], mayMessage: Set<String> = []
        var allowedTools = "", permissionMode = "dontAsk", model = "", effort = ""

        init() {}
        init(_ b: Bot, others: [String]) {
            name = b.name; color = b.color ?? ""; description = b.description ?? ""; group = b.group ?? ""
            prompt = b.prompt ?? ""; systemPrompt = b.systemPrompt ?? ""
            computerEgress = b.computerEgress ?? "internet"
            computer = b.computer == "linux"; computerAlwaysOn = b.computerAlwaysOn == true
            skills = Set(b.skills ?? []); disabledSkills = Set(b.disabledSkills ?? []); connectors = Set(b.connectors ?? [])
            mayMessage = Set(b.mayMessageAll == false ? (b.mayMessage ?? []) : others)
            allowedTools = (b.allowedTools ?? []).joined(separator: "\n"); permissionMode = b.permissionMode ?? "dontAsk"
            model = b.model ?? ""; effort = b.effort ?? ""
        }

        /// Each field as the API names it, as JSON text (so changes are easy to spot).
        func fields(others: [String]) -> [String: String] {
            func j(_ v: Any) -> String { (try? JSONSerialization.data(withJSONObject: v, options: [.sortedKeys, .fragmentsAllowed])).map { String(decoding: $0, as: UTF8.self) } ?? "" }
            return [
                "name": j(name), "color": j(color), "description": j(description), "group": j(group.trimmingCharacters(in: .whitespaces)),
                "prompt": j(prompt), "systemPrompt": j(systemPrompt),
                "computerEgress": j(computerEgress),
                "computer": j(computer ? "linux" : "none"), "computerAlwaysOn": j(computer && computerAlwaysOn),
                "skills": j(skills.sorted()), "disabledSkills": j(disabledSkills.sorted()), "connectors": j(connectors.sorted()),
                "mayMessageAll": j(others.allSatisfy { mayMessage.contains($0) }), "mayMessage": j(mayMessage.sorted()),
                "allowedTools": j(allowedTools.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }),
                "permissionMode": j(permissionMode), "model": j(model), "effort": j(effort),
            ]
        }
    }

    private var bot: Bot? { store.bots.first { $0.id == botId } }
    private var others: [Bot] { store.bots.filter { $0.id != botId } }

    var body: some View {
        Group {
            if let bot, loaded {
                form(bot)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.bg)
        .task(id: botId) { await load() }
        .onChange(of: draft) { saveSoon() }
    }

    private func load() async {
        guard let bot else { return }
        draft = Draft(bot, others: others.map(\.id))
        saved = draft.fields(others: others.map(\.id))
        loaded = true
        async let d = store.dockerOK()
        async let k = try? store.skillLists()
        async let a = store.connectedApps()
        async let s = try? store.settings()
        docker = await d
        skills = await k
        apps = await a
        settings = await s
    }

    /// Saves what changed since the last save, a moment after the last change, one save at a time.
    private func saveSoon() {
        guard loaded else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let now = draft.fields(others: others.map(\.id))
            let diff = now.filter { saved[$0.key] != $0.value }
            guard !diff.isEmpty else { return }
            var body: [String: Any] = [:]
            for (k, v) in diff { body[k] = try? JSONSerialization.jsonObject(with: Data(v.utf8), options: .fragmentsAllowed) }
            note = "Saving…"
            do {
                try await store.updateBot(botId, body)
                saved.merge(diff) { $1 }
                note = "Saved."
            } catch {
                note = ""
                store.problem = error.localizedDescription
            }
        }
    }

    // MARK: the page

    private func form(_ bot: Bot) -> some View {
        WebForm(inPanel: true) {
            PageHead(title: "Settings", sub: "Changes save by themselves. \(note)", small: true)
            Card {
                TextField("Name", text: $draft.name).field("Name")
                PlainField("Colour") {
                    FlowLayout(spacing: 10) {
                        ForEach(botColors, id: \.hex) { c in
                            Button { draft.color = c.hex } label: {
                                Circle().fill(Color(hex: c.hex)).frame(width: 26, height: 26)
                                    .overlay(Circle().stroke(Theme.text, lineWidth: draft.color == c.hex ? 2 : 0).padding(-4))
                            }
                            .buttonStyle(.plain).help(c.name).accessibilityLabel(c.name)
                        }
                    }
                    .padding(4)
                }
                TextField("What it does", text: $draft.description, prompt: Text("One line, shown in the list")).field("What it does")
                PlainField("Category") { groupPicker }
                FormTextArea(text: $draft.prompt, prompt: "e.g. Check the news and tell me what matters", lines: 5)
                    .field("Main assignment", hint: "what it does when a job runs it, and its guide for your messages")
            }

            Card {
                if docker || draft.computer {
                    Toggle(isOn: $draft.computer) {
                        Text("🖥 Own computer").fontWeight(.semibold)
                        Text("A desktop with a browser, for sites that need real clicking.").rowHint()
                    }
                    RowLine()
                }
                Toggle(isOn: Binding(get: { (bot.pinned ?? 0) > 0 }, set: { on in
                    Task { try? await store.pin(botId, at: on ? store.sidebar.pinned.filter { $0.id != botId }.count + 1 : 0) }
                })) { Text("📌 Pinned below the Chief").fontWeight(.semibold) }
                RowLine()
                skillsRow
                RowLine()
                if !apps.isEmpty || !draft.connectors.isEmpty { appsRow; RowLine() }
                if !others.isEmpty { teammatesRow; RowLine() }
                Button { nav.page = .botJobs(botId) } label: {
                    LabeledContent {
                        Image(systemName: "chevron.right").foregroundStyle(Theme.faint)
                    } label: {
                        Text("⏰ Scheduled jobs").fontWeight(.semibold)
                        Text(jobsSummary(bot)).rowHint()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                alwaysRow(bot)
            }

            Card {
                DisclosureGroup(isExpanded: $advancedOpen) { VStack(alignment: .leading, spacing: 12) { advanced }.padding(.top, 10) } label: { Text("Advanced").fontWeight(.semibold) }
            }
            Button("Delete \(bot.name)", role: .destructive) { confirmDelete = true }
                .buttonStyle(.textLink).foregroundStyle(Theme.err).padding(.top, 4)
        }
        .font(.geist(size: 13.5))
        .confirmationDialog("Delete \(bot.name)?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { delete(bot) }
        } message: {
            let gone = [bot.computer == "linux" ? "its computer (everything installed on it, its files and its browser logins)" : nil, "its memory",
                        ownSkills.isEmpty ? nil : "the \(ownSkills.count == 1 ? "skill" : "\(ownSkills.count) skills") it wrote"].compactMap { $0 }
            Text("This also erases \(gone.count > 1 ? gone.dropLast().joined(separator: ", ") + " and " + gone.last! : gone[0]). This can't be undone.\n\nIts run history is kept.")
        }
    }

    /// Chips: None, the groups there are, and a new one typed in place.
    private var groupPicker: some View {
        let names = Set(store.bots.compactMap(\.group).filter { !$0.isEmpty } + (draft.group.isEmpty ? [] : [draft.group]))
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        return FlowLayout(spacing: 6) {
            chip("None", on: draft.group.isEmpty) { draft.group = "" }
            ForEach(names, id: \.self) { g in chip(g, on: draft.group == g) { draft.group = g } }
            if addingGroup {
                TextField("Category name", text: $newGroup).textFieldStyle(.plain).font(.geist(size: 13)).padding(.horizontal, 14).padding(.vertical, 6)
                    .overlay(Capsule().strokeBorder(Theme.line2, lineWidth: 1)).frame(width: 160).onSubmit {
                    let v = newGroup.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
                    if !v.isEmpty { draft.group = names.first { $0.lowercased() == v.lowercased() } ?? v }
                    newGroup = ""; addingGroup = false
                }
            } else {
                chip("＋ New category", on: false) { addingGroup = true }
            }
        }
    }

    private func chip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title) }.buttonStyle(ChipButtonStyle(on: on))
    }

    // MARK: skills, apps, teammates, always approved

    private var ownSkills: [SkillInfo] {
        (skills?.library ?? []).filter { $0.createdBy == "bot:\(botId)" && !($0.usedBy ?? []).contains { $0 != botId } }
    }

    @ViewBuilder
    private var skillsRow: some View {
        if bot?.useSkills == false {
            LabeledContent("✦ Skills") {
                Button("Turn them on") { Task { try? await store.updateBot(botId, ["useSkills": true]) } }.buttonStyle(.textLink)
            }
        } else if let k = skills {
            let sys = k.machine.map { ($0, "From your Claude account") } + (k.builtin ?? []).map { ($0, "Built into Claude Code") }
            DisclosureGroup {
                if k.library.isEmpty && sys.isEmpty { Text("No skills yet. Ask the Chief to write one.").foregroundStyle(Theme.muted) }
                if !k.library.isEmpty { Text("Your skills").font(.geist(size: 11)).foregroundStyle(Theme.muted) }
                ForEach(k.library, id: \.name) { s in
                    Toggle(isOn: Binding(get: { draft.skills.contains(s.name) }, set: { on in if on { draft.skills.insert(s.name) } else { draft.skills.remove(s.name) } })) {
                        Text(s.name)
                        if let d = s.description { Text(d).rowHint().lineLimit(2) }
                    }
                }
                ForEach(["From your Claude account", "Built into Claude Code"], id: \.self) { from in
                    let list = sys.filter { $0.1 == from }
                    if !list.isEmpty { Text(from).font(.geist(size: 11)).foregroundStyle(Theme.muted) }
                    ForEach(list, id: \.0.name) { s, _ in
                        Toggle(isOn: Binding(get: { !draft.disabledSkills.contains(s.name) }, set: { on in if on { draft.disabledSkills.remove(s.name) } else { draft.disabledSkills.insert(s.name) } })) {
                            Text(s.name)
                            if let d = s.description { Text(d).rowHint().lineLimit(2) }
                        }
                    }
                }
            } label: {
                let acc = k.machine.filter { !draft.disabledSkills.contains($0.name) }.count
                let built = (k.builtin ?? []).filter { !draft.disabledSkills.contains($0.name) }.count
                let parts = k.library.map(\.name).filter { draft.skills.contains($0) } + [acc > 0 ? "\(acc) from your Claude account" : "", built > 0 ? "\(built) built into Claude Code" : ""].filter { !$0.isEmpty }
                FoldTitle("✦ Skills", parts.isEmpty ? "None" : parts.joined(separator: ", "))
            }
        }
    }

    private var appsRow: some View {
        let list = apps + draft.connectors.filter { c in !apps.contains { $0.slug == c } }.map { ConnectedApp(slug: $0, name: $0) }
        return DisclosureGroup {
            ForEach(list, id: \.slug) { a in
                Toggle(a.name, isOn: Binding(get: { draft.connectors.contains(a.slug) }, set: { on in if on { draft.connectors.insert(a.slug) } else { draft.connectors.remove(a.slug) } }))
            }
        } label: {
            FoldTitle("🔌 Apps", list.filter { draft.connectors.contains($0.slug) }.map(\.name).joined(separator: ", ").nonEmpty ?? "None")
        }
    }

    private var teammatesRow: some View {
        DisclosureGroup {
            ForEach(others) { b in
                Toggle(isOn: Binding(get: { draft.mayMessage.contains(b.id) }, set: { on in if on { draft.mayMessage.insert(b.id) } else { draft.mayMessage.remove(b.id) } })) {
                    HStack(spacing: 5) { NameFigure(Who(b)); Text(b.name) }
                }
            }
        } label: {
            let all = others.count > 1 && others.allSatisfy { draft.mayMessage.contains($0.id) }
            FoldTitle("💬 May message", all ? "Everyone" : others.filter { draft.mayMessage.contains($0.id) }.map(\.name).joined(separator: ", ").nonEmpty ?? "Nobody")
        }
    }

    @ViewBuilder
    private func alwaysRow(_ bot: Bot) -> some View {
        let trusted = (bot.jobs ?? []).filter { $0.alwaysApprove == true }
        if !trusted.isEmpty {
            DisclosureGroup {
                ForEach(trusted) { j in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(j.name)
                            Text("\(j.schedule) · \(j.kind == "script" ? "a script, no AI" : "uses AI")").font(.geist(size: 11)).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Button("Revoke") {
                            Task {
                                do { try await store.updateJob(botId, j.id, ["alwaysApprove": false]); nav.pill = .ok("Revoked: its next change waits for your OK") }
                                catch { store.problem = error.localizedDescription }
                            }
                        }
                    }
                }
            } label: {
                FoldTitle("✓ Always approved", trusted.map(\.name).joined(separator: ", "))
            }
        }
    }

    private func jobsSummary(_ bot: Bot) -> String {
        let jobs = bot.jobs ?? []
        let waiting = jobs.filter { $0.approved == false }.count
        if jobs.isEmpty { return "None. Ask it, or the Chief, e.g. \"check the news every morning at 8\"." }
        if waiting > 0 { return "\(waiting) waiting for your OK" }
        return "\(jobs.count) job\(jobs.count == 1 ? "" : "s")\(bot.nextRunAt.map { " · next \(Format.shortTime($0))" } ?? "")"
    }

    // MARK: Advanced

    @ViewBuilder
    private var advanced: some View {
        let tools = Set(draft.allowedTools.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) })
        Text("What it may do").font(.geist(size: 13, weight: .semibold))
        ForEach(Permission.allCases, id: \.self) { p in
            Toggle(isOn: Binding(get: { p.tools.allSatisfy(tools.contains) }, set: { on in setPermission(p, on) })) {
                Text(p.label)
                Text(p.hint).rowHint()
            }
        }
        DisclosureGroup("Exact tools and permission mode") {
            VStack(alignment: .leading, spacing: 12) {
                FormTextArea(text: $draft.allowedTools, lines: 3, font: .geistMono(size: 12.5))
                    .field("Allowed tools", hint: "one per line, e.g. Bash(pytest:*) or mcp__github")
                Picker("Permission mode", selection: $draft.permissionMode) {
                    ForEach(Self.modes, id: \.0) { m in Text("\(m.0): \(m.1)").tag(m.0) }
                }
                .selectField("Permission mode")
            }
            .padding(.top, 8)
        }
        Picker("Model", selection: $draft.model) {
            Text("Default (\(defaultLLM))").tag("")
            ForEach(settings?.models ?? [], id: \.id) { m in Text(m.label).tag(m.id) }
            if !draft.model.isEmpty && !(settings?.models ?? []).contains(where: { $0.id == draft.model }) { Text(draft.model).tag(draft.model) }
        }
        .selectField("Model")
        if takesEffort {
            Picker("Reasoning", selection: $draft.effort) {
                Text("Claude Code's default").tag("")
                ForEach(settings?.efforts ?? [], id: \.id) { e in Text(e.label).tag(e.id) }
            }
            .selectField("Reasoning")
        }
        FormTextArea(text: $draft.systemPrompt, prompt: "e.g. Keep it short. Ask before buying anything.")
            .field("Personality / rules", hint: "added to Claude Code's system prompt")
        Picker("Computer network", selection: $draft.computerEgress) {
            Text("Internet only").tag("internet")
            Text("Internet and local network").tag("lan")
        }
        .selectField("Computer network")
        .disabled(!draft.computer)
        Toggle(isOn: Binding(get: { draft.computer && draft.computerAlwaysOn }, set: { draft.computerAlwaysOn = $0 })) {
            Text("Keep its computer on all the time"); Text("open apps keep running; uses memory all the time").rowHint()
        }
        .disabled(!draft.computer)
    }

    static let modes: [(String, String)] = [
        ("dontAsk", "Only the allowed tools; everything else is denied"),
        ("acceptEdits", "Allowed tools + auto-accept file edits"),
        ("auto", "Claude decides with its auto-mode safety classifier"),
        ("plan", "Read-only planning; no changes"),
        ("bypassPermissions", "Everything allowed; no checks (use with care)"),
    ]

    private var defaultLLM: String {
        let m = settings?.settings.defaultModel ?? "", e = settings?.settings.defaultEffort ?? ""
        let model = m.isEmpty ? "Claude Code's default" : settings?.models.first { $0.id == m }?.label ?? m
        let effort = settings?.efforts.first { $0.id == e }?.label ?? e
        return m.isEmpty && e.isEmpty ? "Claude Code's choice" : effort.isEmpty ? model : "\(model) · \(effort)"
    }

    private var takesEffort: Bool {
        guard let m = settings?.models.first(where: { $0.id == draft.model }) else { return !draft.model.lowercased().contains("haiku") }
        return m.effort != false
    }

    /// The switches add or remove their tools in the exact list (and the mode, for files).
    private func setPermission(_ p: Permission, _ on: Bool) {
        var tools = draft.allowedTools.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && !p.tools.contains($0) }
        if on { tools += p.tools }
        draft.allowedTools = tools.joined(separator: "\n")
        if p == .files {
            if on && draft.permissionMode == "dontAsk" { draft.permissionMode = "acceptEdits" }
            if !on && draft.permissionMode == "acceptEdits" { draft.permissionMode = "dontAsk" }
        }
    }

    private func delete(_ bot: Bot) {
        Task {
            do {
                let computer = try await store.deleteBot(bot.id)
                nav.page = .chief
                nav.pill = computer == "failed" ? .error("Bot deleted, but its computer couldn't be erased (is Docker running?)")
                    : .ok(computer == "erased" ? "Bot and its computer deleted" : "Bot deleted")
            } catch { store.problem = error.localizedDescription }
        }
    }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

/// A folded row's title, and what's in it in one dim line after it.
struct FoldTitle: View {
    let title: String
    let summary: String
    init(_ title: String, _ summary: String) { self.title = title; self.summary = summary }
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).fontWeight(.semibold)
            Spacer(minLength: 12)
            Text(summary).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.tail)
        }
    }
}

/// A field of a settings card that is no text box: its name above what it holds (`div.field`).
struct PlainField<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content
    init(_ label: String, @ViewBuilder content: () -> Content) { self.label = label; self.content = content() }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.geist(size: 12.5, weight: .medium)).foregroundStyle(Theme.muted)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The web page's `.gchip`: a pill with a hairline, in the text's colour when it is the chosen one.
struct ChipButtonStyle: ButtonStyle {
    let on: Bool

    func makeBody(configuration: Configuration) -> some View { Chip(configuration: configuration, on: on) }

    private struct Chip: View {
        let configuration: Configuration
        let on: Bool
        @State private var over = false

        var body: some View {
            configuration.label
                .font(.geist(size: 13, weight: .medium))
                .foregroundStyle(on ? Theme.bg : Theme.text)
                .padding(.horizontal, 14).padding(.vertical, 6)
                .background(Capsule().fill(on ? Theme.text : over ? Theme.sunk : .clear))
                .overlay(Capsule().strokeBorder(on ? Theme.text : Theme.line2, lineWidth: 1))
                .contentShape(Capsule())
                .onHover { over = $0 }
        }
    }
}
