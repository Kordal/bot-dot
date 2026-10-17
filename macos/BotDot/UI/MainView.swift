import SwiftUI
import BotDotKit

/// The window once connected: the bots on the left, the page on the right.
struct MainView: View {
    @Environment(Store.self) private var store
    @Environment(Navigation.self) private var nav
    /// This window is the one in front: the key window of the active app.
    @Environment(\.appearsActive) private var active
    /// The screen is locked or asleep: nobody is looking, whatever window is in front.
    @State private var asleep = false
    @State private var locked = false
    private var inFront: Bool { active && !asleep && !locked }
    /// The list's width, which the owner drags; kept on this Mac.
    @AppStorage("botdot.sidebar.width") private var keptWidth = SidebarWidth.standard
    @State private var windowWidth: Double?
    private var sidebarWidth: Double { SidebarWidth.fitting(keptWidth, window: windowWidth) }

    /// A wide window shows the keypad, with one chat on its right (#494); a narrower one, and a page
    /// that is no chat (the Board, Needs you, Settings…), shows the list.
    private var keypad: Bool { (windowWidth ?? 0) >= Keypad.wide && nav.chat != nil }
    /// The chat's column beside the keypad: the 420 a chat keeps, or two fifths of a wider window.
    private var chatWidth: CGFloat { CGFloat(max(SidebarWidth.chat, min(560, (windowWidth ?? 0) * 0.4)).rounded()) }

    var body: some View {
        // The web page's shell: the list, a hairline, the page. No bar above them.
        HStack(spacing: 0) {
            if keypad {
                KeypadView().frame(maxWidth: .infinity, maxHeight: .infinity)
                Rectangle().fill(Theme.line).frame(width: 1)
            } else {
                Sidebar().environment(\.listLayout, SidebarWidth.layout(sidebarWidth)).frame(width: sidebarWidth)
                // The hairline is the list's edge: dragged, it makes the list wider or narrower.
                Rectangle().fill(Theme.line).frame(width: 1)
                    .overlay { SidebarGrip(width: sidebarWidth) { keptWidth = SidebarWidth.fitting($0, window: windowWidth) } }
                    .zIndex(1)
            }
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.bg)
                .environment(\.searchTerms, SearchHit.terms(nav.query))
                .safeAreaInset(edge: .top, spacing: 0) { NeedsBanner() }
                // What went wrong, or what was done: a pill at the bottom, as the web page's toast.
                .overlay(alignment: .bottom) {
                    if let problem = store.problem {
                        Toast(text: problem, failed: true)
                            .onTapGesture { store.problem = nil }
                            .task(id: problem) { try? await Task.sleep(for: .seconds(3.2)); if store.problem == problem { store.problem = nil } }
                    } else if let pill = nav.pill {
                        PillView(pill: pill) { nav.pill = nil }
                    }
                }
                .animation(.easeOut(duration: 0.15), value: store.problem)
                .frame(width: keypad ? chatWidth : nil)
        }
        .onGeometryChange(for: Double.self) { $0.size.width } action: { windowWidth = $0 }
        .onChange(of: keypad, initial: true) { _, shown in nav.keypadShown = shown }
        .ignoresSafeArea(edges: .top)
        .sheet(item: Binding(get: { nav.sheet }, set: { nav.sheet = $0 })) { sheet in
            switch sheet {
            case .login(let r): LoginRequestSheet(request: r)
            case .pay(let r): PaymentSheet(request: r)
            case .unlock(let reason): UnlockSheet(reason: reason)
            }
        }
        // A new login or payment request pops up by itself (Later puts it off), as on the web; so does
        // unlocking Bitwarden when a bot waits for it.
        .onChange(of: store.loginRequests.map(\.id), initial: true) { popUp() }
        // What waits, and what its notifications say: a tool's line arrives with the feed, after its card.
        .onChange(of: store.needs.map(\.key), initial: true) { nav.notifier.sync(store.needs, notices: store.needNotices) }
        .onChange(of: store.needNotices) { nav.notifier.sync(store.needs, notices: store.needNotices) }
        .onChange(of: onScreen, initial: true) { _, chat in
            nav.chatOnScreen = chat
            Task { await store.present(chat: chat) }
        }
        // New replies: the chat on screen is read while this window is in front, and not a moment longer
        // (another window or app in front, the app hidden, the window closed).
        .onChange(of: Shown(chat: onScreen, inFront: inFront), initial: true) { _, shown in
            Task { await store.show(chat: shown.chat, inFront: shown.inFront) }
        }
        .onDisappear { Task { await store.leave() } }
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.screensDidSleepNotification)) { _ in asleep = true }
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.screensDidWakeNotification)) { _ in asleep = false }
        .onReceive(DistributedNotificationCenter.default().publisher(for: Notification.Name("com.apple.screenIsLocked"))) { _ in locked = true }
        .onReceive(DistributedNotificationCenter.default().publisher(for: Notification.Name("com.apple.screenIsUnlocked"))) { _ in locked = false }
        .task {
            // First start, or Claude isn't signed in: the Setup checklist opens by itself.
            #if DEBUG
            if ProcessInfo.processInfo.environment["BOTDOT_PAGE"] != nil { return } // the page that was asked for stays
            #endif
            if let s = try? await store.setup(), s.needsSetup { nav.page = .setup }
        }
        .task {
            nav.notifier.start(store: store, nav: nav)
            // While you use this app, say so every 30 s (and which chat is open), so the phone doesn't
            // notify you about what you already see here.
            let watch = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .scrollWheel, .mouseMoved]) { e in
                nav.notifier.lastUsed = .now
                return e
            }
            defer { if let watch { NSEvent.removeMonitor(watch) } }
            while !Task.isCancelled {
                if NSApp.isActive && Date().timeIntervalSince(nav.notifier.lastUsed) < 5 * 60 { await store.present(chat: onScreen) }
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .onChange(of: store.bitwarden?.wantedBy?.id) { _, id in
            if let id, nav.sheet == nil, !nav.snoozed.contains("bw:\(id)") {
                nav.snooze("bw:\(id)")
                nav.sheet = .unlock("\(store.bitwarden?.wantedBy?.name ?? "A bot") needs a saved login.")
            }
        }
    }

    private struct Shown: Equatable {
        let chat: String?
        let inFront: Bool
    }

    private var onScreen: String? {
        // A chat under the panel that covers it is not on screen.
        if nav.panelOpen && nav.panelCovers { return nil }
        return switch nav.chat {
        case .bot(let id): "bot:\(id)"
        case .chief: store.chief.chatId.map { "chief:\($0)" }
        case .group(let id): Groups.key(id)
        default: nil
        }
    }

    private func popUp() {
        guard nav.sheet == nil, let r = store.loginRequests.first(where: { !nav.snoozed.contains($0.id) }) else { return }
        nav.sheet = r.kind == "card" ? .pay(r) : .login(r)
    }

    @ViewBuilder
    private var detail: some View {
        if let chat = nav.chat {
            // The chat and, right of it, the panel with that chat's settings; in a window too narrow
            // for both, the panel is over the chat.
            GeometryReader { g in
                let covers = g.size.width < 380 + 400
                HStack(spacing: 0) {
                    chatView(chat).frame(maxWidth: .infinity, maxHeight: .infinity)
                    if nav.panelOpen && !covers { panel.frame(width: 380) }
                }
                .overlay { if nav.panelOpen && covers { panel } }
                .onChange(of: covers, initial: true) { nav.panelCovers = covers }
            }
        } else {
            switch nav.page {
            case .needs: NeedsPage()
            case .dashboard: DashboardView()
            case .activity: ActivityView()
            case .skills: SkillsView()
            case .connectors: ConnectorsView()
            case .vault: VaultView()
            case .settings: SettingsView()
            case .setup: SetupView()
            default: Color.clear
            }
        }
    }

    @ViewBuilder
    private func chatView(_ chat: Navigation.Page) -> some View {
        switch chat {
        case .bot(let id):
            if let bot = store.bots.first(where: { $0.id == id }) {
                BotChatView(bot: bot).id(bot.id) // its own message box and files
            } else {
                Color.clear
            }
        case .group(let id):
            if let group = store.group(id) {
                GroupChatView(group: group).id(group.id) // its own message box and files
            } else {
                // Deleted, here or in another app: there is no chat to show, and the window shows the Chief's.
                Color.clear.task(id: id) { if await store.groupIsGone(id) { nav.page = .chief } }
            }
        default:
            ChiefView()
        }
    }

    @ViewBuilder
    private var panel: some View {
        let close = { nav.page = nav.chat }
        switch nav.page {
        case .botSettings(let id): ChatPanel(close: close) { BotSettingsView(botId: id).id(id) }
        case .botJobs(let id): ChatPanel(back: "Settings", onBack: { nav.page = .botSettings(id) }, close: close) { JobsView(botId: id).id(id) }
        case .groupSettings(let id): ChatPanel(close: close) { GroupPanel(groupId: id).id(id) }
        case .chiefSettings: ChatPanel(close: close) { ChiefSettingsView() }
        default: EmptyView()
        }
    }
}

/// The strip over the list's edge that takes the drag: 9 wide, a line while the pointer is on it.
/// A double-click puts the list back at its standard width.
private struct SidebarGrip: View {
    let width: Double
    let set: (Double) -> Void
    /// The list's width when the drag began.
    @State private var from: Double?
    @State private var over = false

    var body: some View {
        Color.clear
            .frame(width: 9)
            .contentShape(Rectangle())
            .overlay { Rectangle().fill(Theme.faint).frame(width: 2).opacity(over || from != nil ? 1 : 0) }
            .onHover { over = $0 }
            .pointerStyle(.columnResize)
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { drag in
                        let start = from ?? width
                        from = start
                        set(start + drag.translation.width)
                    }
                    .onEnded { _ in from = nil }
            )
            .onTapGesture(count: 2) { set(SidebarWidth.standard) }
            .animation(.easeOut(duration: 0.12), value: over)
    }
}
