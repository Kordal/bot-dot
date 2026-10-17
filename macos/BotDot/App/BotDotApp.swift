import SwiftUI
import BotDotKit

@main
struct BotDotApp: App {
    @State private var store = Self.newStore()
    @State private var nav = Navigation()
    @State private var local = LocalServer(config: Self.localConfig)
    @State private var thisMac = ThisMac()
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    /// The Store, with the figure definition this app was built with (lib/figure.json, bundled): bots
    /// are drawn from it at once, and from the botdot server's own copy once connected (ADR 003).
    private static func newStore() -> Store {
        let store = Store(sessions: .onThisMac())
        if let url = Bundle.main.url(forResource: "figure", withExtension: "json"), let data = try? Data(contentsOf: url) {
            store.bundledFigure = try? FigureDef(json: data)
        }
        return store
    }

    /// botdot on this Mac. Debug builds can be pointed at the repo's stand-in docker for trying the
    /// setup: BOTDOT_DOCKER (its path), BOTDOT_DIR and BOTDOT_PORT.
    /// `defaults write dev.botdot.mac botdot.image bot-dot:dev` (and `botdot.computerImage`) sets botdot
    /// up from an image built on this Mac, as BOT_DOT_IMAGE does for install.sh.
    static var localConfig: LocalServer.Config {
        var c = LocalServer.Config()
        if let image = UserDefaults.standard.string(forKey: "botdot.image"), !image.isEmpty { c.image = image }
        if let image = UserDefaults.standard.string(forKey: "botdot.computerImage"), !image.isEmpty { c.computerImage = image }
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        if let d = env["BOTDOT_DOCKER"] { c.dockerPaths = [d] }
        if let d = env["BOTDOT_DIR"] { c.dir = URL(fileURLWithPath: d) }
        if let p = env["BOTDOT_PORT"].flatMap(Int.init) { c.port = p }
        #endif
        return c
    }

    var body: some Scene {
        // Closing the window leaves botdot running (the menu-bar dot, notifications); the Dock icon
        // or the menu-bar menu brings the window back.
        WindowGroup("botdot", id: "main") {
            RootView()
                .webLook()
                .environment(store)
                .environment(nav)
                .environment(local)
                .environment(thisMac)
                .frame(minWidth: 760, minHeight: 480)
                .onAppear { delegate.leave = { [store] in await store.leave() } }
        }
        .defaultSize(width: 1100, height: 720)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Chat with the Chief") { nav.newChiefChat(store) }
                    .keyboardShortcut("n")
                    .disabled(!store.connected)
            }
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { nav.page = .settings }.keyboardShortcut(",").disabled(!store.connected)
            }
            // This app and botdot on this Mac: a window of their own, not the account's Settings (ADR 028, #473).
            CommandGroup(after: .appInfo) { CheckForUpdates() }
            CommandMenu("Go") {
                Button("Chief of Staff") { nav.showChief(store) }.keyboardShortcut("0")
                Button("Needs you") { nav.page = .needs }.keyboardShortcut("y", modifiers: [.command, .shift])
                Button("Find a Bot or Message") { nav.searchFocus = true }.keyboardShortcut("k")
                Divider()
                // The keypad of a wide window: its first nine keys by their names, across its pages.
                ForEach(1..<10, id: \.self) { n in
                    let key = nav.key(n - 1, store: store)
                    Button(key?.name ?? "Key \(n)") { nav.keypad("\(n)", store: store) }
                        .keyboardShortcut(KeyEquivalent(Character("\(n)")))
                        .disabled(key == nil)
                }
                Divider()
                Button("Activity") { nav.page = .activity }.keyboardShortcut("1", modifiers: [.command, .shift])
                Button("Skills") { nav.page = .skills }.keyboardShortcut("2", modifiers: [.command, .shift])
                Button("Connectors") { nav.page = .connectors }.keyboardShortcut("3", modifiers: [.command, .shift])
                Button("Vault") { nav.page = .vault }.keyboardShortcut("4", modifiers: [.command, .shift])
                Button("Setup") { nav.page = .setup }
                Divider()
                Button("Refresh") { Task { await store.reloadAll() } }.keyboardShortcut("r")
            }
        }
        Window("Updates", id: "updates") {
            UpdatesView().webLook().environment(store).environment(nav).environment(local).environment(thisMac)
                .padding(16).frame(width: 440)
        }
        .windowResizability(.contentSize)
        // A bot's computer, live, in a window of its own.
        WindowGroup("Computer", id: "screen", for: String.self) { $botId in
            if let botId { ScreenWindow(botId: botId).webLook().environment(store).environment(nav).environment(local).environment(thisMac) }
        }
        .defaultSize(width: 960, height: 680)
        MenuBarExtra(isInserted: Binding(get: { store.connected }, set: { _ in })) {
            MenuBarMenu().environment(store).environment(nav).environment(local).environment(thisMac)
        } label: {
            MenuBarLabel().environment(store)
        }
    }
}

/// The app menu's Check for Updates…: opens the Updates window.
struct CheckForUpdates: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View { Button("Check for Updates…") { openWindow(id: "updates") } }
}

/// Which page the window shows, and which pop-up. The sidebar sets it; the menu commands too.
@MainActor
@Observable
final class Navigation {
    enum Page: Hashable {
        case chief
        case dashboard
        case bot(String)
        case botSettings(String)
        case botJobs(String)
        case needs
        case settings, setup, chiefSettings
        case activity, skills, connectors, vault
        /// A group's chat, by the group's id.
        case group(String)
        /// A group's chat with its panel open beside it: its name and its members.
        case groupSettings(String)
    }

    /// The chat the page shows: a chat itself, or the one whose settings or jobs are open in the panel beside it.
    var chat: Page? {
        switch page {
        case .bot(let id), .botSettings(let id), .botJobs(let id): .bot(id)
        case .group(let id), .groupSettings(let id): .group(id)
        case .chief, .chiefSettings, nil: .chief
        default: nil
        }
    }

    /// The panel beside the chat is open.
    var panelOpen: Bool { chat != nil && page != chat && page != nil }
    /// The window is too narrow for a chat and its panel: the panel is over the chat.
    var panelCovers = false

    /// A chat picked in the list. Another chat keeps the panel open, on that chat's settings; a panel
    /// that covers the chat makes way for it, since a chat was asked for (the web page's panel.js).
    func pick(_ chat: Page, store: Store) {
        let keep = panelOpen && !panelCovers
        switch chat {
        case .bot(let id): page = keep ? .botSettings(id) : .bot(id)
        case .group(let id): page = keep ? .groupSettings(id) : .group(id)
        case .chief:
            showChief(store)
            if keep { page = .chiefSettings }
        default: page = chat
        }
    }

    /// The figure and name in a chat: opens its panel, or closes it.
    func togglePanel() {
        switch page {
        case .bot(let id): page = .botSettings(id)
        case .group(let id): page = .groupSettings(id)
        case .chief, nil: page = .chiefSettings
        default: page = chat
        }
    }

    /// A pop-up over the window: a login or payment a bot asks for, or unlocking Bitwarden.
    enum Sheet: Identifiable {
        case login(LoginRequest)
        case pay(LoginRequest)
        case unlock(String)
        var id: String {
            switch self {
            case .login(let r), .pay(let r): r.id
            case .unlock: "unlock"
            }
        }
    }

    /// The page the window opens on: the Chief's chat. A Debug build started with BOTDOT_PAGE opens on
    /// another instead, to look at one without clicking: a bot's chat ("bot:<id>"), its settings
    /// ("settings:<id>") or jobs ("jobs:<id>"), a group's chat ("group:<id>"), or a page by its name
    /// ("needs", "board", "activity", "skills", "connectors", "vault", "settings", "setup", "chief-settings").
    private static let first: Page = {
        #if DEBUG
        if let wanted = ProcessInfo.processInfo.environment["BOTDOT_PAGE"] {
            if wanted == "needs" { return .needs }
            if wanted.hasPrefix("bot:") { return .bot(String(wanted.dropFirst(4))) }
            if wanted.hasPrefix("settings:") { return .botSettings(String(wanted.dropFirst(9))) }
            if wanted.hasPrefix("jobs:") { return .botJobs(String(wanted.dropFirst(5))) }
            if wanted.hasPrefix("group:") { return .group(String(wanted.dropFirst(6))) }
            if wanted.hasPrefix("group-settings:") { return .groupSettings(String(wanted.dropFirst(15))) }
            let pages: [String: Page] = ["chief": .chief, "board": .dashboard, "activity": .activity, "skills": .skills, "connectors": .connectors,
                                         "vault": .vault, "settings": .settings, "setup": .setup, "chief-settings": .chiefSettings]
            if let page = pages[wanted] { return page }
        }
        #endif
        return .chief
    }()

    /// A Debug build started with BOTDOT_SHEET=unlock opens with the sheet that unlocks Bitwarden over
    /// its page, to look at a dialog without clicking.
    private static let firstSheet: Sheet? = {
        #if DEBUG
        if ProcessInfo.processInfo.environment["BOTDOT_SHEET"] == "unlock" { return .unlock("") }
        #endif
        return nil
    }()

    /// A small note in the corner while something goes on in the background.
    enum Pill: Equatable {
        case busy(String), ok(String), error(String)
        var text: String { switch self { case .busy(let t), .ok(let t), .error(let t): t } }
    }

    var page: Page? = Navigation.first
    var sheet: Sheet? = Navigation.firstSheet
    /// What's in the search box, and the match to open (its chat scrolls to it, then forgets it).
    var query = ""
    var jump: SearchHit?
    /// ⌘K: put the cursor in the search box.
    var searchFocus = false
    /// The window is wide and shows the keypad (MainView): ⌘1–⌘9 work.
    var keypadShown = false
    /// The chat on screen ("bot:<id>" or "chief:<chatId>"), for notifications and presence.
    var chatOnScreen: String?
    let notifier = Notifier()
    var pill: Pill?
    /// Requests put off with Later: they don't pop up again by themselves.
    private(set) var snoozed: Set<String> = []

    func snooze(_ id: String) { snoozed.insert(id) }

    /// The Chief's page, as its row in the list opens it: on the chat that has new replies, when one
    /// has (the row shows the dots of all its chats), else on the chat it showed before.
    func showChief(_ store: Store) {
        page = .chief
        if let chat = store.chiefChatWithNewReplies, chat != store.chief.chatId { store.openChief(chatId: chat) }
    }

    func newChiefChat(_ store: Store) {
        page = .chief
        store.openChief(chatId: nil)
    }

    /// Opens the chat a search match is in, at that message.
    func open(_ hit: SearchHit, store: Store) {
        jump = hit
        if let chat = hit.chatId { openChief(chat, store: store) } else if let group = hit.group?.id { page = .group(group) } else if let bot = hit.bot?.id { page = .bot(bot) }
    }

    /// The key a ⌘digit opens (0 first, counted across the pages), while the keypad is on screen:
    /// what its Go menu item says.
    func key(_ index: Int, store: Store) -> Keypad.Key? {
        guard keypadShown else { return nil }
        let keys = Keypad.keys(store.keypad)
        return keys.indices.contains(index) ? keys[index] : nil
    }

    /// A Go menu command of the keypad (⌘1–⌘9): what it does is BotDotKit's Keypad.action.
    func keypad(_ key: String, store: Store) {
        guard keypadShown else { return }
        let keys = Keypad.keys(store.keypad)
        // A menu command: it works the same whether or not the cursor is in a field.
        switch Keypad.action(key: key, modifiers: .command, fieldFocused: false, keys: keys.count) {
        case .open(let i): open(keys[i], store: store)
        case .chief: showChief(store)
        case .search: searchFocus = true
        case .nothing: break
        }
    }

    /// A key on the keypad: its chat opens on the right, as a click on its row in the list opens it.
    func open(_ key: Keypad.Key, store: Store) {
        switch key {
        case .bot(let b): pick(.bot(b.id), store: store)
        case .group(let g): pick(.group(g.id), store: store)
        }
    }

    func openChief(_ chatId: String, store: Store) {
        page = .chief
        store.openChief(chatId: chatId)
    }

    /// Opens what a card is about: its pop-up, its chat, or the Needs you page.
    func open(_ item: NeedItem, store: Store) {
        switch item.kind {
        case .login: if let r = item.loginRequest { sheet = .login(r) }
        case .pay: if let r = item.loginRequest { sheet = .pay(r) }
        case .bitwarden: sheet = .unlock("")
        case .plan: if let c = item.planChat { openChief(c, store: store) }
        default: page = .needs
        }
    }
}

/// The botdot server this Mac connects to, remembered between launches.
enum SavedServer {
    private static let key = "botdot.server"
    static var address: String? {
        // Updated from the old Mac app, which kept its address as "server": carry on with it.
        get { UserDefaults.standard.string(forKey: key) ?? UserDefaults.standard.string(forKey: "server") }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
    /// It's the local botdot server: botdot running on this Mac, set up by the app.
    static var isLocal: Bool {
        get { UserDefaults.standard.bool(forKey: "botdot.local") }
        set { UserDefaults.standard.set(newValue, forKey: "botdot.local") }
    }
}

struct RootView: View {
    @Environment(Store.self) private var store
    @Environment(LocalServer.self) private var local
    @Environment(ThisMac.self) private var thisMac
    @State private var starting = SavedServer.address != nil
    @State private var startProblem: String?

    var body: some View {
        Group {
            if store.connected {
                MainView()
            } else if let base = store.signInNeeded {
                SignInView(base: base)
            } else if starting {
                ProgressView().controlSize(.small)
            } else {
                ConnectView(problem: startProblem)
            }
        }
        .background(Theme.bg)
        .onAppear { Appearance.apply() }
        .onChange(of: store.connected, initial: true) { thisMac.apply() }
        .task {
            guard starting, let address = SavedServer.address else { return }
            // botdot on this Mac: start it if it isn't running (Docker restarts it too, once Docker runs).
            // Anything in the way shows on the setup screen, which starts it again.
            if SavedServer.isLocal {
                if await local.answers() { try? await store.connect(to: local.address) }
                starting = false
                return
            }
            do { try await store.connect(to: address) } catch { startProblem = error.localizedDescription }
            starting = false
        }
    }
}
