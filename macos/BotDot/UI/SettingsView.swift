import SwiftUI
import AppKit
import UniformTypeIdentifiers
import CoreImage
import BotDotKit

// MARK: - Settings

/// Settings, as on the web: the pages that open from it, the default model, bots with their own
/// choice, appearance, updates, backups, and which botdot server this Mac uses.
struct SettingsView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var settings: ServerSettings?
    @State private var model = ""
    @State private var effort = ""
    @State private var ready = false
    @State private var checking = false

    var body: some View {
        WebForm {
            PageHead(title: "Settings")
            Card {
                ForEach(Self.pages, id: \.title) { p in
                    Button { nav.page = p.page } label: {
                        HStack {
                            Label(p.title, systemImage: p.icon)
                            Spacer()
                            if p.page == .activity, store.runningCount > 0 { Text("\(store.runningCount) running").foregroundStyle(Theme.faint) }
                            Image(systemName: "chevron.right").foregroundStyle(Theme.faint)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            Card {
                ModelFields(settings: settings, model: $model, effort: $effort, inherit: nil)
                HStack(spacing: 4) {
                    Text(catalogLine).foregroundStyle(settings?.catalog?.error == nil ? Theme.faint : Theme.warnText)
                    Button(checking ? "Checking…" : "Check for new models", action: refreshModels).buttonStyle(.textLink).disabled(checking)
                }
                .font(.geist(size: 12))
            } header: {
                Text("Default model and reasoning")
            } footer: {
                Text("Used by every bot that doesn't choose its own. A higher reasoning level thinks longer before answering: better results on hard tasks, but slower.")
            }
            Card("Bots with their own choice") {
                let custom = store.bots.filter { !($0.model ?? "").isEmpty || !($0.effort ?? "").isEmpty }
                if custom.isEmpty {
                    Text("None: every bot uses the default. Change a bot in its settings.").foregroundStyle(Theme.muted)
                }
                ForEach(custom) { b in
                    Button { nav.page = .botSettings(b.id) } label: {
                        HStack {
                            NameFigure(Who(b)); Text(b.name)
                            Spacer()
                            Text(llmSummary(b.model, b.effort)).foregroundStyle(Theme.muted)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            Card("Appearance") { AppearancePicker() }
            BackupsSection()
            ThisMacSection()
        }
        .font(.geist(size: 13.5))
        .task { await load() }
        .onChange(of: model) { save() }
        .onChange(of: effort) { save() }
    }

    static let pages: [(title: String, icon: String, page: Navigation.Page)] = [
        ("Activity", "waveform.path.ecg", .activity),
        ("Skills", "sparkles", .skills),
        ("Connectors", "powerplug", .connectors),
        ("Vault", "lock", .vault),
        ("Setup", "checklist", .setup),
    ]

    private var catalogLine: String {
        guard let c = settings?.catalog else { return "" }
        if let e = c.error { return e }
        if c.source == "docs" { return "Model list from Anthropic's docs, checked \(Format.date(c.checkedAt).map { Format.ago($0) } ?? "")." }
        return "Built-in model list (not checked online yet)."
    }

    private func llmSummary(_ model: String?, _ effort: String?) -> String {
        let m = settings?.models.first { $0.id == model }?.label ?? model ?? ""
        let e = settings?.efforts.first { $0.id == effort }?.label ?? effort ?? ""
        return [m.isEmpty ? "Default model" : m, e].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func load() async {
        settings = try? await store.settings()
        model = settings?.settings.defaultModel ?? ""
        effort = settings?.settings.defaultEffort ?? ""
        DispatchQueue.main.async { ready = true }
    }

    private func save() {
        guard ready else { return }
        let takes = settings?.models.first { $0.id == model }?.effort != false
        Task {
            do {
                settings = try await store.saveSettings(["defaultModel": model, "defaultEffort": model.isEmpty || takes ? effort : ""])
                nav.pill = .ok("Saved. New runs use it.")
            } catch { store.problem = error.localizedDescription }
        }
    }

    private func refreshModels() {
        checking = true
        Task {
            do {
                settings = try await store.refreshModels()
                nav.pill = settings?.catalog?.error.map { .error($0) } ?? .ok("Model list is up to date")
            } catch { store.problem = error.localizedDescription }
            checking = false
        }
    }
}

/// A model and a reasoning level, with what the chosen ones mean (no prices).
struct ModelFields: View {
    let settings: ServerSettings?
    @Binding var model: String
    @Binding var effort: String
    /// What an empty choice means: "Same as the default" for the Chief; Claude Code's default otherwise.
    let inherit: String?
    @State private var custom = false
    @State private var customName = ""

    var body: some View {
        let models = settings?.models ?? []
        let groups = models.reduce(into: [String]()) { g, m in if !g.contains(m.group ?? "") { g.append(m.group ?? "") } }
        let other = custom || Self.isCustom(model, in: settings)
        Picker("Model", selection: Binding(get: { other ? "__custom" : model }, set: { v in
            if v == "__custom" { custom = true; customName = model } else { custom = false; model = v }
        })) {
            Text(inherit ?? "Claude Code's default").tag("")
            ForEach(groups, id: \.self) { g in
                Section(g) { ForEach(models.filter { ($0.group ?? "") == g }, id: \.id) { m in Text(m.label).tag(m.id) } }
            }
            Text("Another model…").tag("__custom")
        }
        .selectField("Model")
        if other {
            TextField("Full model name", text: $customName, prompt: Text("e.g. claude-opus-4-8"))
                .font(.geistMono(size: 13))
                .onAppear { if customName.isEmpty { customName = model } }
                .onSubmit { model = customName.trimmingCharacters(in: .whitespaces) }
                .field("Full model name")
        }
        let info = models.first { $0.id == model }
        let noEffort = !model.isEmpty && info?.effort == false
        Picker("Reasoning level", selection: $effort) {
            Text(inherit ?? "Claude Code's default").tag("")
            ForEach(settings?.efforts ?? [], id: \.id) { e in Text(e.label).tag(e.id) }
        }
        .selectField("Reasoning level")
        .disabled(noEffort)
        let e = settings?.efforts.first { $0.id == effort }
        let note = [info?.note, noEffort ? "\(info?.label ?? model) doesn't use reasoning levels." : e.map { "\($0.label): \($0.note ?? "")" }].compactMap { $0 }.joined(separator: " ")
        if !note.isEmpty { Text(note).font(.geist(size: 12)).foregroundStyle(Theme.muted) }
    }

    /// A saved model that isn't in the list shows as "Another model…".
    static func isCustom(_ model: String, in settings: ServerSettings?) -> Bool {
        !model.isEmpty && !(settings?.models ?? []).contains { $0.id == model }
    }
}

// MARK: Appearance

/// Auto (follow the system), Light or Dark, for this Mac.
enum Appearance: String, CaseIterable {
    case auto, light, dark

    static let key = "botdot.theme"
    static var current: Appearance { Appearance(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .auto }

    static func apply(_ a: Appearance = current) {
        NSApp.appearance = a == .light ? NSAppearance(named: .aqua) : a == .dark ? NSAppearance(named: .darkAqua) : nil
    }

    var label: String { self == .auto ? "Auto (follow the system)" : rawValue.capitalized }
}

struct AppearancePicker: View {
    @AppStorage(Appearance.key) private var theme = Appearance.auto.rawValue
    var body: some View {
        // The web page's chips: the chosen one in the text's colour.
        FlowLayout(spacing: 8) {
            ForEach(Appearance.allCases, id: \.rawValue) { a in
                Button(a.label) { theme = a.rawValue }.buttonStyle(ChipButtonStyle(on: theme == a.rawValue))
            }
        }
        .onChange(of: theme) { Appearance.apply() }
    }
}

// MARK: Updates

/// The app menu's Check for Updates…, a window of its own and not the account's Settings, which has no update (ADR 028,
/// #473): this Mac's app, and botdot on this Mac, which the app runs as one account of its own and updates itself. A
/// botdot elsewhere is updated by its admin, for every account at once, and has no line here.
struct UpdatesView: View {
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var server: UpdateStatus?
    @State private var mac: MacAppBuild?
    @State private var busy = false
    @State private var installing = false

    /// botdot on this Mac, whose server offers its own update (`updates` in its `features`).
    private var ownsServer: Bool { store.connected && store.features.contains("updates") }

    var body: some View {
        Card("Updates") {
            if ownsServer {
                LabeledContent("botdot on this Mac") {
                    HStack(spacing: 8) {
                        Text(serverStatus).foregroundStyle(Theme.muted)
                        if server?.supported == true, server?.selfBuilt != true, server?.state == "idle" || server?.state == nil {
                            if server?.available == true {
                                Button("Update", action: { update(force: false) }).buttonStyle(.pillPrimary).disabled(busy)
                            } else {
                                Button(busy ? "Checking…" : "Check", action: check).disabled(busy)
                            }
                        }
                    }
                    .controlSize(.small)
                }
                .help(server?.version?.short.map { "Version \($0)" } ?? "")
                if server?.selfBuilt == true, let how = server?.howToUpdate { Text(how).font(.geist(size: 12)).foregroundStyle(Theme.muted) }
                if let e = server?.error { Text(e).font(.geist(size: 12)).foregroundStyle(Theme.warnText) }
            } else if store.connected {
                Text("Your botdot's admin updates it, for every account at once.").font(.geist(size: 12)).foregroundStyle(Theme.muted)
            }
            LabeledContent("This Mac") {
                HStack(spacing: 8) {
                    Text(installing ? "Updating…" : mac == nil ? "Up to date" : "New version").foregroundStyle(Theme.muted)
                    if mac != nil, !installing { Button("Update", action: updateMac).buttonStyle(.pillPrimary) }
                }
                .controlSize(.small)
            }
            .help("Version \(MacApp.version)")
        }
        .task { await load() }
        .task(id: server?.state) {
            // While the botdot server updates it goes away and comes back: follow it.
            guard server?.state == "downloading" || server?.state == "restarting" else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if let u = try? await store.updates() {
                    server = u
                    if u.state == "idle" || u.state == nil { await store.reloadAll(); return }
                }
            }
        }
    }

    private var serverStatus: String {
        guard let u = server else { return "Checking…" }
        if u.supported != true { return u.error == nil ? "Up to date" : "Can't check" }
        if u.selfBuilt == true { return "Built from the source" }
        if u.state == "downloading" { return "Updating…" }
        if u.state == "restarting" { return "Restarting…" }
        return u.available == true ? "New version" : "Up to date"
    }

    private func load() async {
        if ownsServer { server = try? await store.updates() }
        mac = await store.newerMacApp(than: MacApp.build)
    }

    private func check() {
        busy = true
        Task { server = try? await store.updates(check: true); busy = false }
    }

    private func update(force: Bool) {
        busy = true
        Task {
            do {
                try await store.applyUpdate(force: force)
            } catch {
                let message = error.localizedDescription
                if !force, message.contains("still running") {
                    let a = NSAlert()
                    a.messageText = message
                    a.informativeText = "Update anyway?"
                    a.addButton(withTitle: "Update"); a.addButton(withTitle: "Cancel")
                    if a.runModal() == .alertFirstButtonReturn { busy = false; update(force: true); return }
                } else { store.problem = message }
            }
            server = try? await store.updates()
            busy = false
        }
    }

    /// Downloads the new app from botdot, checks it, swaps this app for it where it is (e.g.
    /// /Applications), and starts it.
    private func updateMac() {
        guard let mac else { return }
        installing = true
        Task {
            do {
                let fresh = try await store.downloadMacApp(mac)
                try MacApp.replace(with: fresh)
            } catch {
                store.problem = error.localizedDescription
                installing = false
            }
        }
    }
}

/// This app's version and build number.
enum MacApp {
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?" }
    static var build: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }

    /// Puts `fresh` where this app is, then starts it once this one has quit.
    @MainActor
    static func replace(with fresh: URL) throws {
        let here = Bundle.main.bundleURL
        guard FileManager.default.isWritableFile(atPath: here.deletingLastPathComponent().path) else {
            throw ConnectError(message: "botdot can't replace itself in \(here.deletingLastPathComponent().path). Move it to a folder you can change, or copy the new version there yourself.")
        }
        _ = try FileManager.default.replaceItemAt(here, withItemAt: fresh)
        let relaunch = Process()
        relaunch.executableURL = URL(fileURLWithPath: "/bin/sh")
        relaunch.arguments = ["-c", "sleep 1; /usr/bin/open -n \"$0\"", here.path]
        try relaunch.run()
        NSApp.terminate(nil)
    }
}

// MARK: Backups

struct BackupsSection: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var b: BackupStatus?
    @State private var p1 = ""
    @State private var p2 = ""
    @State private var changing = false

    var body: some View {
        Card("Backups") {
            if let b {
                if b.configured != true {
                    Text("Set a passphrase and botdot backs up every night. Keep it safe, e.g. in Bitwarden: without it a backup can't be opened.")
                        .foregroundStyle(Theme.muted)
                    SecureField("", text: $p1, prompt: Text("at least 8 characters")).field("Passphrase")
                    SecureField("", text: $p2).field("Again")
                    HStack { Spacer(); Button("Turn on", action: turnOn).disabled(p1.count < 8 || p2.isEmpty) }
                } else {
                    Text("\(b.running == true ? "Backing up…" : b.last.map { "Last backup \(Format.date($0.at).map { Format.ago($0) } ?? "") · \(b.count ?? 0) kept" } ?? "No backup yet"). Every night at 03:00.")
                        .foregroundStyle(Theme.muted)
                    if let e = b.error { Text(e).font(.geist(size: 12)).foregroundStyle(Theme.warnText) }
                    HStack {
                        Button(b.running == true ? "Backing up…" : "Back up now", action: now).disabled(b.running == true)
                        if let last = b.last { Button("Download") { download(last.name) } }
                        Button("Change passphrase") { changing = true }.buttonStyle(.textLink)
                    }
                    .controlSize(.small)
                }
            } else {
                ProgressView()
            }
        }
        .task { b = try? await store.backups() }
        .sheet(isPresented: $changing) { PassphraseSheet { await load() } }
    }

    private func load() async { b = try? await store.backups() }

    private func turnOn() {
        guard p1 == p2 else { store.problem = "The two don't match"; return }
        let p = p1
        p1 = ""; p2 = ""
        Task {
            do { try await store.setBackupPassphrase(p); nav.pill = .ok("Backups are on"); try await store.backUpNow() } catch { store.problem = error.localizedDescription }
            await load()
        }
    }

    private func now() {
        b?.running = true
        Task {
            do { try await store.backUpNow(); nav.pill = .ok("Backed up") } catch { store.problem = error.localizedDescription }
            await load()
        }
    }

    private func download(_ name: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            do { try await store.downloadBackup(name).write(to: url); nav.pill = .ok("Saved") } catch { store.problem = error.localizedDescription }
        }
    }
}

struct PassphraseSheet: View {
    let done: () async -> Void
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var p = ""

    var body: some View {
        Dialog("Change passphrase", width: 420) {
            Text("New backup passphrase (at least 8 characters). Older backups still need the old one.").foregroundStyle(Theme.muted)
            SecureField("", text: $p).field("New passphrase")
        } foot: {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Change") {
                let v = p
                p = ""
                Task {
                    do { try await store.setBackupPassphrase(v); nav.pill = .ok("Passphrase changed. The next backups use it."); await done(); dismiss() } catch { store.problem = error.localizedDescription }
                }
            }
            .buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction).disabled(p.count < 8)
        }
    }
}

// MARK: This Mac

/// Which botdot server this Mac uses, opening it in the browser (which signs in with the same passkey), switching
/// to another, and "Sign out everywhere" behind a front door (ADR 028). When botdot runs here: keeping the Mac
/// awake, and removing botdot.
struct ThisMacSection: View {
    @Environment(Store.self) private var store
    @Environment(LocalServer.self) private var local
    @Environment(ThisMac.self) private var thisMac
    @Environment(\.openURL) private var openURL
    @State private var confirm = false
    @State private var removing = false
    @State private var signOut = false

    var body: some View {
        @Bindable var thisMac = thisMac
        Card("This Mac") {
            LabeledContent("botdot server") {
                HStack(spacing: 8) {
                    Text(SavedServer.isLocal ? "This Mac" : store.api?.base.host(percentEncoded: false) ?? "").foregroundStyle(Theme.muted)
                    Button("Open in browser") { if let base = store.api?.base { openURL(base) } }
                    Button("Switch…") { confirm = true }
                }
                .controlSize(.small)
            }
            if store.features.contains("accounts") {
                LabeledContent("Signed in") {
                    Button("Sign out everywhere…") { signOut = true }.controlSize(.small)
                }
            }
            if SavedServer.isLocal {
                Toggle("Keep this Mac awake while botdot runs here", isOn: $thisMac.keepAwake)
            }
            Toggle("Open at login", isOn: Binding(get: { _ = thisMac.changed; return thisMac.openAtLogin }, set: { thisMac.openAtLogin = $0 }))
            if SavedServer.isLocal {
                Button("Remove botdot from this Mac…", role: .destructive) { removing = true }
            }
        }
        .confirmationDialog(SavedServer.isLocal ? "Use another botdot server? botdot on this Mac keeps running." : "Use another botdot server? This Mac stops following this one; your bots keep running there.", isPresented: $confirm) {
            Button("Choose another") {
                SavedServer.isLocal = false
                store.disconnect()
                store.stopSigningIn()
            }
        }
        .confirmationDialog("Sign out everywhere? Every app and browser signed in to this account signs out, this Mac too. Your passkey signs you in again.", isPresented: $signOut) {
            Button("Sign out everywhere", role: .destructive) {
                Task {
                    do { try await store.signOutEverywhere() } catch { store.problem = error.localizedDescription }
                }
            }
        }
        .sheet(isPresented: $removing) { RemoveSheet() }
    }
}

/// Remove botdot from this Mac: its containers go; the bots and their data stay unless ticked.
struct RemoveSheet: View {
    @Environment(Store.self) private var store
    @Environment(LocalServer.self) private var local
    @Environment(ThisMac.self) private var thisMac
    @Environment(\.dismiss) private var dismiss
    @State private var deleteData = false
    @State private var busy = false
    @State private var failed: String?

    var body: some View {
        Dialog("Remove botdot from this Mac?", width: 440) {
            Text("botdot stops and its containers are removed. Your bots and their data stay in the botdot folder, so setting botdot up again brings them back.")
                .foregroundStyle(Theme.muted)
            Toggle("Also delete the bots and their data", isOn: $deleteData).toggleStyle(.checkbox)
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button(busy ? "Removing…" : "Remove", role: .destructive, action: remove).disabled(busy)
        }
    }

    private func remove() {
        busy = true
        Task {
            do {
                try await local.remove(deleteData: deleteData)
                if thisMac.openAtLogin { thisMac.openAtLogin = false }
                SavedServer.isLocal = false
                SavedServer.address = nil
                store.disconnect()
                store.stopSigningIn()
                thisMac.apply()
                dismiss()
            } catch { failed = error.localizedDescription; busy = false }
        }
    }
}

// MARK: - Setup

/// What botdot needs: Claude (required), then the bots' computers, your phone, the time zone, and
/// extras. Opens by itself on first start and while Claude isn't signed in.
struct SetupView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.openURL) private var openURL
    @State private var s: SetupState?
    @State private var signIn: URL?
    @State private var starting = false
    @State private var code = ""
    @State private var finishing = false
    @State private var restoring = false

    private var device: String { TimeZone.current.identifier }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Setup").font(.geist(size: 26, weight: .bold)).kerning(-0.78)
                if let s {
                    Text(s.claude?.loggedIn == true ? "botdot is ready. The rest is up to you." : "One step and botdot is ready.").foregroundStyle(Theme.muted)
                    claude(s)
                    if let signIn { signInBox(signIn) }
                    computers(s)
                    phone(s)
                    timezone(s)
                    Text("Extras").font(.geist(size: 13, weight: .semibold)).padding(.top, 8)
                    SetupItem(state: s.bitwarden?.configured == true ? .ok : .off, icon: "🛡", title: "Bitwarden", optional: true,
                              text: Text(s.bitwarden?.configured == true ? "Connected\(s.bitwarden?.unlocked == true ? "" : ", locked: unlock it when botdot asks"). Bots use its logins and cards without seeing them." : "Let bots use your logins, cards and identities without ever seeing them.")) {
                        Button(s.bitwarden?.configured == true ? "Open" : "Set up") { nav.page = .vault }
                    }
                    if store.bots.isEmpty {
                        HStack(spacing: 4) {
                            Text("Moving from another botdot?").foregroundStyle(Theme.muted)
                            Button("Restore a backup") { restoring = true }.buttonStyle(.textLink)
                        }
                        .font(.geist(size: 12.5))
                    }
                    HStack {
                        Spacer()
                        Button(s.done == true ? "Back to your bots" : "Meet your Chief of Staff", action: finish)
                            .buttonStyle(.pillPrimary).controlSize(.large)
                            .disabled(s.claude?.loggedIn != true)
                    }
                    .padding(.top, 8)
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(.horizontal, 40).padding(.vertical, 30)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Setup")
        .task { await load(fresh: true) }
        .sheet(isPresented: $restoring) { RestoreSheet() }
    }

    private func claude(_ s: SetupState) -> AnyView {
        let c = s.claude
        if c?.loggedIn == true {
            return AnyView(SetupItem(state: .ok, icon: "✳︎", title: "Claude",
                             text: c?.fromEnv == true ? Text("Signed in with a token from the server's settings.") : c?.email.map { Text("Signed in with ") + Text($0).bold() + Text(".") } ?? Text("Signed in.")) {
                if c?.fromEnv != true {
                    Button("Use another account", action: startSignIn).buttonStyle(.textLink)
                    Button("Sign out", action: signOut).buttonStyle(.textLink)
                }
            })
        }
        return AnyView(SetupItem(state: .todo, icon: "✳︎", title: "Sign in to Claude",
                         text: Text(c?.installed == false ? "Claude Code isn't installed on this machine, so bots can't run." : "Your bots run on your Claude subscription. Sign in once; it stays signed in.")) {
            if c?.installed != false, signIn == nil {
                Button(starting ? "Starting…" : "Sign in to Claude", action: startSignIn).buttonStyle(.pillPrimary).disabled(starting)
            }
        })
    }

    private func signInBox(_ url: URL) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button("Open the sign-in page") { openURL(url) }.buttonStyle(.pillPrimary)
                Text("Sign in, allow access, and copy the code it shows.").foregroundStyle(Theme.muted)
            }
            HStack {
                TextField("", text: $code, prompt: Text("Paste the code here")).webField().autocorrectionDisabled()
                    .onSubmit(finishSignIn)
                Button(finishing ? "Signing in…" : "Sign in", action: finishSignIn).disabled(code.isEmpty || finishing)
            }
            Button("Cancel") { signIn = nil; Task { await store.cancelClaudeSignIn() } }.buttonStyle(.textLink).foregroundStyle(Theme.muted)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }

    private func computers(_ s: SetupState) -> some View {
        let ok = s.docker?.ok == true
        return SetupItem(state: ok ? .ok : .off, icon: "🖥", title: "Bot computers",
                         text: Text(!ok ? "\(s.docker?.error ?? "Docker is not available"), so bots can't have their own desktop. Everything else works."
                                    : s.docker?.image == true ? "Ready. Any bot can get its own desktop with a browser (turn it on in the bot's settings)." : "Ready. The desktop downloads the first time a bot needs one, which takes a few minutes once.")) {}
    }

    private func phone(_ s: SetupState) -> AnyView {
        let a = s.access
        if a?.tailnet == true {
            return AnyView(SetupItem(state: a?.restricted == true ? .ok : .todo, icon: "📱", title: "Your phone",
                             text: Text("Private on your tailnet at ") + Text("https://\(a?.host ?? "")").bold() + Text(". ") + Text(a?.restricted == true ? "Only \(a?.user ?? "you") can open it." : "Everyone on your tailnet can open it. To keep it to you, set BOT_DOT_ALLOWED_USERS=\(a?.user ?? "your login")\(a?.docker == true ? " in botdot's .env" : "") and restart.")) {})
        }
        if let host = a?.tailnetHost {
            return AnyView(SetupItem(state: .ok, icon: "📱", title: "Your phone", text: Text("Also private on your tailnet at ") + Text("https://\(host)").bold() + Text(". Install the botdot app on your phone and connect it to that address.")) {})
        }
        return AnyView(SetupItem(state: .off, icon: "📱", title: "Your phone",
                         text: Text("botdot only opens on this machine for now. To use it from your phone, privately, \(a?.docker == true ? "run the installer again: it sets up Tailscale for you." : "install Tailscale, then run tailscale serve --bg \(a?.port ?? 4747) and add the address it shows to BOT_DOT_ALLOWED_HOSTS.")")) {})
    }

    private func timezone(_ s: SetupState) -> some View {
        let now = Date().formatted(Date.FormatStyle(date: .omitted, time: .shortened, timeZone: TimeZone(identifier: s.timezone) ?? .current))
        let differs = device != s.timezone
        return SetupItem(state: .ok, icon: "🕒", title: "Time zone",
                         text: Text("Schedules run on ") + Text(s.timezone).bold() + Text(" time (it's \(now) there).\(differs ? " This Mac is on \(device)." : "")")) {
            if differs {
                Button("Use \(device)") {
                    Task {
                        do { try await store.updateSetup(timezone: device); nav.pill = .ok("Schedules now run on \(device) time") } catch { store.problem = error.localizedDescription }
                        await load(fresh: false)
                    }
                }
            }
        }
    }

    private func load(fresh: Bool) async {
        do { s = try await store.setup(fresh: fresh) } catch { store.problem = error.localizedDescription }
    }

    private func startSignIn() {
        starting = true
        Task {
            do {
                let url = try await store.startClaudeSignIn()
                signIn = url
                openURL(url)
            } catch { store.problem = error.localizedDescription }
            starting = false
        }
    }

    private func finishSignIn() {
        finishing = true
        let c = code.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                let claude = try await store.finishClaudeSignIn(code: c)
                // A sign-in the server could not check afterwards is not "signed in": its sentence, as it is.
                nav.pill = claude.couldNotTell.map { .error($0) } ?? .ok("Signed in to Claude\(claude.email.map { " as \($0)" } ?? "")")
            } catch { store.problem = error.localizedDescription }
            signIn = nil // a code works once: start over if it failed
            code = ""
            finishing = false
            await load(fresh: true)
        }
    }

    private func signOut() {
        Task {
            // Ask with a fresh count of what's running, since signing out stops it.
            let running = (try? await store.setup())?.running ?? 0
            let a = NSAlert()
            a.messageText = "Sign out of Claude? Bots can't run until you sign in again."
            if running > 0 { a.informativeText = running == 1 ? "A bot is working right now; it will be stopped." : "\(running) bots are working right now; they will be stopped." }
            a.addButton(withTitle: "Sign out"); a.addButton(withTitle: "Cancel")
            guard a.runModal() == .alertFirstButtonReturn else { return }
            do {
                // A sign-out the server could not check afterwards is not "signed out": its sentence, as it is.
                let claude = try await store.signOutOfClaude()
                nav.pill = claude?.couldNotTell.map { .error($0) } ?? .ok("Signed out of Claude")
            } catch { store.problem = error.localizedDescription }
            await load(fresh: true)
        }
    }

    private func finish() {
        Task {
            try? await store.updateSetup(done: true)
            nav.page = .chief
        }
    }
}

/// One line of the checklist: ✓ done, ! to do, – not used.
struct SetupItem<Actions: View>: View {
    enum State { case ok, todo, off }
    let state: State
    let icon: String
    let title: String
    var optional = false
    let text: Text
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(state == .ok ? "✓" : state == .todo ? "!" : "–")
                .font(.geist(size: 13, weight: .bold))
                .frame(width: 24, height: 24)
                .background(Circle().fill(state == .ok ? Theme.ok.opacity(0.18) : state == .todo ? Theme.warnSoft : Theme.sunk))
                .foregroundStyle(state == .ok ? Theme.okText : state == .todo ? Theme.warnText : Theme.faint)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("\(icon) \(title)").font(.geist(size: 14, weight: .semibold))
                    if optional { Text("optional").font(.geist(size: 11)).foregroundStyle(Theme.faint) }
                }
                text.font(.geist(size: 13)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) { actions() }.controlSize(.small)
            }
            Spacer(minLength: 0)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.panel).stroke(Theme.line))
    }
}

/// Restore a backup from another botdot: its file and passphrase; botdot restarts with it.
struct RestoreSheet: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var file: URL?
    @State private var passphrase = ""
    @State private var busy = ""
    @State private var failed: String?

    var body: some View {
        Dialog("Restore a backup", width: 460) {
            Text("Your bots, chats, memory, vault and settings come back. Afterwards, sign in to Claude (and Bitwarden) again. What's here now is kept aside, not deleted.")
                .foregroundStyle(Theme.muted)
            HStack {
                Button("Choose the backup file…") {
                    let p = NSOpenPanel()
                    p.allowedContentTypes = [UTType(filenameExtension: "bdb") ?? .data]
                    if p.runModal() == .OK { file = p.url }
                }
                Text(file?.lastPathComponent ?? "").foregroundStyle(Theme.muted)
            }
            SecureField("", text: $passphrase).field("Its passphrase")
            if let failed { Text(failed).font(.geist(size: 12.5)).foregroundStyle(Theme.err) }
        } foot: {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button(busy.isEmpty ? "Restore" : busy, action: restore).buttonStyle(.pillPrimary).keyboardShortcut(.defaultAction)
                .disabled(file == nil || passphrase.isEmpty || !busy.isEmpty)
        }
    }

    private func restore() {
        guard let file else { return }
        let p = passphrase
        passphrase = ""
        busy = "Restoring…"
        failed = nil
        Task {
            do {
                let bots = try await store.restoreBackup(file, passphrase: p)
                nav.pill = .busy("Restoring \(bots) bot\(bots == 1 ? "" : "s"). botdot restarts.")
                dismiss()
            } catch { failed = error.localizedDescription; busy = "" }
        }
    }
}

// MARK: - The Chief's settings

/// The Chief's model and reasoning, your rules for it, and the two switches of its checkup.
struct ChiefSettingsView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    @State private var settings: ServerSettings?
    @State private var model = ""
    @State private var effort = ""
    @State private var rules = ""
    @State private var ready = false
    @State private var saveTask: Task<Void, Never>?

    var body: some View {
        WebForm(inPanel: true) {
            PageHead(title: "Settings", sub: "Chief of Staff. Changes save by themselves.", small: true)
            Card {
                ModelFields(settings: settings, model: $model, effort: $effort, inherit: "Same as the default")
            } header: {
                Text("Model and reasoning")
            } footer: {
                Text("What the Chief uses to plan, create and manage your bots.")
            }
            Card("Your rules for it") {
                FormTextArea(text: $rules, prompt: "e.g. Always ask me before creating a bot. Talk to me like a colleague: short and direct.", lines: 5).webField()
            }
            // Only from a server with `checkup`. Its days and time have no control: the owner tells the Chief.
            if let checkup = store.checkup {
                Card {
                    Toggle(isOn: Binding(get: { checkup.on }, set: { on in Task { await store.setCheckup(on: on) } })) {
                        Text("Checkup").fontWeight(.semibold)
                        Text(checkup.line).rowHint()
                    }
                    RowLine()
                    Toggle(isOn: Binding(get: { checkup.webSearch }, set: { on in Task { await store.setCheckup(webSearch: on) } })) {
                        Text("Web search").fontWeight(.semibold)
                        Text("Lets a checkup search the web to check a proposal. It never opens a page.").rowHint()
                    }
                    .disabled(!checkup.on)
                }
            }
        }
        .font(.geist(size: 13.5))
        .task {
            settings = try? await store.settings()
            model = settings?.settings.chiefModel ?? ""
            effort = settings?.settings.chiefEffort ?? ""
            rules = settings?.settings.chiefRules ?? ""
            DispatchQueue.main.async { ready = true }
        }
        .onChange(of: model) { save() }
        .onChange(of: effort) { save() }
        .onChange(of: rules) { save() }
    }

    private func save() {
        guard ready else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            do {
                settings = try await store.saveSettings(["chiefModel": model, "chiefEffort": effort, "chiefRules": String(rules.prefix(4000))])
                nav.pill = .ok("Saved. The Chief uses it from its next reply.")
            } catch { store.problem = error.localizedDescription }
        }
    }
}

/// Longer text in a settings card, growing with
/// what's written (no box of its own).
struct FormTextArea: View {
    @Binding var text: String
    var prompt = ""
    var lines = 3
    var font: Font = .geist(size: 13)

    var body: some View {
        TextField("", text: $text, prompt: Text(prompt), axis: .vertical)
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(font)
            .lineLimit(lines...12)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
