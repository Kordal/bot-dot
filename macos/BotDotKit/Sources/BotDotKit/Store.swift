import Foundation
import Observation

/// Why an address couldn't be used, in words for the owner.
public struct ConnectError: LocalizedError, Sendable {
    public let message: String
    public init(message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// Everything the screens show about one botdot server, kept up to date from its API and live feed.
/// The screens read it and call its actions; they hold no server logic of their own.
@MainActor
@Observable
public final class Store {
    public internal(set) var api: API?
    public internal(set) var connected = false
    /// The live feed is down and the app is trying again (Standing.swift).
    public internal(set) var away = false
    /// Whether Claude is signed out on the botdot server, as the feed says it.
    public internal(set) var claude = ClaudeSignIn()
    public internal(set) var bots: [Bot] = []
    public internal(set) var chiefChats: [ChiefChatSummary] = []
    public internal(set) var chiefBusy = false
    /// New replies in all the Chief's chats, for its one row (see Unread.swift).
    public internal(set) var chiefUnread = 0
    /// The "New" line of the chat that is open, if it has one.
    public internal(set) var newLine: NewLine?
    /// The Chief chat on screen.
    public internal(set) var chief = ChiefChatState()
    /// Something that went wrong, in words to show; the screens clear it once shown.
    public var problem: String?
    /// This botdot server has `ratings` in its `features`: 👍 and 👎 under unasked Chief messages.
    public internal(set) var rates = false
    /// This botdot server has `message-key` in its `features`: it takes a message's key once (see Outbox.swift).
    public var takesOnce: Bool { has(.messageKey) }
    /// This botdot server has `message-waits` in its `features`: Send stays while something works (see Busy.swift).
    public var sendStays: Bool { has(.messageWaits) }
    /// This botdot server has `ended-by` in its `features`: a run's sentence says who ended it.
    public var saysWhoEnded: Bool { has(.endedBy) }
    /// The owner's messages that wait their turn, by chat ("bot:<id>", "chief:<chatId>"): read them with `waiting(in:)`.
    public internal(set) var queued: [String: [Queued]] = [:]
    /// The waiting messages a "Take back" is under way for.
    @ObservationIgnored var taking: Set<String> = []
    /// What each chat's message box is told about its sends, by chat (see Outbox.swift).
    @ObservationIgnored var outboxes: [String: Outbox] = [:]
    /// What this botdot server says it can do (`features` of `GET /api/version`), read when connecting
    /// and again whenever the live feed starts: it may have been updated. Ask it with `has`.
    public internal(set) var features: Set<String> = []

    /// The figure definition every bot is drawn from (see Figure.swift): this botdot server's, or the
    /// copy the app was built with. `nil` when neither can be used: bots are then bare heads.
    public var figure: FigureDef? { serverFigure ?? bundledFigure }
    /// The copy the app was built with, which the app hands over when it starts.
    public var bundledFigure: FigureDef?
    public internal(set) var serverFigure: FigureDef?
    /// The server and version the definition was last asked from (`nil`: not yet, or it didn't arrive).
    @ObservationIgnored var figureAsked: String?

    /// The newest runs, newest first: the sidebar's previews.
    public internal(set) var recentRuns: [RunSummary] = []

    /// What waits for the owner's OK (see Needs.swift).
    public internal(set) var loginRequests: [LoginRequest] = []
    public internal(set) var asks: [Ask] = []
    /// The asks the feed has named, by id, each with the line a tool's notification reads ("" for
    /// none); the tool asks it has not named, with when that was first seen, and those of them whose
    /// notification no longer waits for it (see `needNotices`).
    var askLines: [String: String] = [:]
    var asksOverdue: Set<String> = []
    @ObservationIgnored var askUnnamedSince: [String: Date] = [:]
    @ObservationIgnored var askWait: TimeInterval = 10
    public internal(set) var memoryPending: [MemoryChange] = []
    public internal(set) var bitwarden: BitwardenStatus?

    /// The dashboard's tiles (see Dashboard.swift).
    public internal(set) var dashboard = DashboardState()

    /// The groups, the group's chat that is open, and what the turns at work say (see Groups.swift).
    public internal(set) var groups: [BotGroup] = []
    public internal(set) var groupChat = GroupChatState()
    public internal(set) var turnLines = TurnLines()
    /// The groups that waiting jobs and tiles were asked in, as the feed says them, and the feed's
    /// first message that said where they stand (see `heardCards`, Groups.swift).
    var cardGroups: [String: GroupRef] = [:]
    @ObservationIgnored var cardsSaidAt: String?

    /// The checkup's setting, for its two switches; `nil` on a server without `checkup` (see Checkup.swift).
    public internal(set) var checkup: CheckupSetting?

    /// A newer botdot server is waiting.
    public internal(set) var updateAvailable = false

    /// The bot chat on screen.
    public internal(set) var botChat = BotChatState()

    /// What each working bot, and the Chief, said it is about to do (see OpeningLine.swift).
    public internal(set) var openingLines = OpeningLines()

    /// The names of the skills in the library, for "@" mentions (see Mentions.swift).
    public internal(set) var skillLibrary: [String] = []

    /// Every live-feed event as it comes (its name and JSON), for notifications.
    @ObservationIgnored public var onEvent: ((String, Data) -> Void)?

    @ObservationIgnored var chiefFollow: Task<Void, Never>?
    @ObservationIgnored var runFollow: Task<Void, Never>?
    /// Runs whose live stream has ended, so they aren't followed again.
    @ObservationIgnored var followed: Set<String> = []
    @ObservationIgnored var feed: Task<Void, Never>?
    @ObservationIgnored var refresher: Task<Void, Never>?

    // The report of the chat on screen (see Unread.swift).
    /// This botdot server has `unread` in its `features`.
    @ObservationIgnored var followsUnread = false
    /// The "New" line whose run the open bot's chat could not be read back to (it is gone, or too far
    /// back): not looked for again at every reload.
    @ObservationIgnored var lineNotReached: NewLine?
    @ObservationIgnored let appId = Unread.appId()
    /// The chat the window shows, and the one it shows in front: what the server is told.
    @ObservationIgnored var openChat: String?
    @ObservationIgnored var windowInFront = false
    @ObservationIgnored var readChat: String?
    /// The last chat the server was told.
    @ObservationIgnored var reported: String?
    @ObservationIgnored var repeater: Task<Void, Never>?
    @ObservationIgnored var repeatMs = Unread.repeatMs

    /// This app's sessions with front doors (ADR 028), by botdot address.
    public let sessions: Sessions
    /// The botdot address whose front door asks this app to sign in, before it connects or when its session
    /// ended (signed out everywhere): the screens show the sign-in. Nil while none asks.
    public internal(set) var signInNeeded: URL?

    /// `sessions`: where the sessions are kept (the app hands `Sessions.onThisMac()`; memory by default).
    public init(sessions: Sessions = Sessions()) {
        self.sessions = sessions
        sessions.whenEnded { [weak self] origin in
            Task { @MainActor in self?.sessionEnded(origin) }
        }
    }

    /// "localhost:4747", "my-mac.tail1234.ts.net" or a full URL → the botdot server's base URL.
    /// A bare name gets https (a tailnet address), except this Mac, which gets http.
    public static func baseURL(for address: String) -> URL? {
        var a = address.trimmingCharacters(in: .whitespacesAndNewlines)
        while a.hasSuffix("/") { a.removeLast() }
        if a.isEmpty { return nil }
        if !a.contains("://") {
            let host = a.split(separator: ":").first.map(String.init) ?? a
            let local = ["localhost", "127.0.0.1", "[::1]"].contains(host.lowercased())
            a = (local ? "http://" : "https://") + a
        }
        guard let url = URL(string: a), url.host != nil, ReleaseManifest.secureURL(url) else { return nil }
        return url
    }

    /// Connects to the botdot server at `address` and loads what the sidebar shows.
    /// Behind a front door without a session here, it connects to nothing and asks for a sign-in
    /// (`signInNeeded`).
    public func connect(to address: String) async throws {
        guard let base = Self.baseURL(for: address) else { throw ConnectError(message: "That isn't an address.") }
        let api = API(base: base, sessions: sessions)
        // Nothing answering and something else answering are different fixes for the owner.
        let version: Version?
        do {
            version = try await api.get("version")
        } catch is URLError {
            throw ConnectError(message: "No botdot server answers at \(base.host() ?? address).")
        } catch {
            version = nil
        }
        guard version?.app == "bot-dot" else { throw ConnectError(message: "That address isn't a botdot server.") }
        if version?.frontDoor == true {
            // Its front door answered, not the account's botdot server: this app has no session there.
            if self.api != nil { disconnect() }
            sessions.set(nil, for: base)
            signInNeeded = base
            return
        }
        signInNeeded = nil
        self.api = api
        forgetAskLines() // this server's feed has named none yet
        followsUnread = version?.features?.contains("unread") == true
        rates = version?.features?.contains("ratings") == true
        features = Set(version?.features ?? [])
        try await loadBots()
        try await loadChiefChats()
        await loadGroups()
        await loadFigure(version)
        await loadUpdateStatus()
        await loadNeeds()
        await loadDashboard(quiet: true)
        await loadCheckup()
        connected = true
        startFeed()
    }

    public func loadBots() async throws {
        guard let api else { return }
        async let bots: [Bot] = api.get("bots")
        async let runs: [RunSummary] = api.get("runs?limit=100")
        self.bots = try await bots
        waitingForBots()
        guard let listed = try? await runs else { return }
        recentRuns = listed
        showLines(of: listed) // the lines of the runs that are still going on
    }

    /// Whether this botdot server has the feature: the app asks before it uses something new. For a
    /// server without it the app draws what it drew before, or nothing where it never had words of
    /// its own (a memory chip, a memory card). While no server is followed: no.
    public func has(_ feature: Feature) -> Bool { features.contains(feature.rawValue) }

    /// How someone is marked beside their name in text and in "Needs you", as the web page's botMark:
    /// a bot in its colour and hat now (not when a run or a message was saved), the colour the server
    /// sent for a bot that is gone, grey without one; the Chief of Staff in coral and its fixed hat.
    public func mark(_ who: Who?) -> BotMark {
        if who?.id == Who.chief.id { return BotMark(rgb: FigureDef.rgb(Who.chief.color), outfit: figure?.chief) }
        let now = who?.id.flatMap { id in bots.first { $0.id == id } }
        return BotMark(rgb: FigureDef.rgb(now?.color ?? who?.color), outfit: now?.outfit)
    }

    /// Takes this botdot server's figure definition when its `features` has `figure`, in place of the
    /// bundled copy (ADR 003). One this app can't draw from (a newer format), or a server without the
    /// feature, leaves the bundled copy. It is asked for when connecting and when the live feed starts
    /// again (the server may have been updated), and only from another server or version than the one
    /// already asked; one that didn't arrive is asked for again with every reload until it does.
    func loadFigure(_ known: Version? = nil) async {
        guard let api else { return }
        var version = known
        if version == nil { version = try? await api.get("version") }
        guard self.api?.base == api.base else { return }
        // The server didn't say which it is: nothing counts as asked, so the next reload asks again.
        guard let version else { figureAsked = nil; return }
        await follows(unread: version.features?.contains("unread") == true) // it may have been updated too
        guard self.api?.base == api.base else { return }
        rates = version.features?.contains("ratings") == true
        if features != Set(version.features ?? []) { features = Set(version.features ?? []) }
        let from = "\(api.base.absoluteString) \(version.version ?? "") \(version.revision ?? "")"
        guard version.features?.contains("figure") == true else {
            serverFigure = nil
            figureAsked = from
            return
        }
        guard figureAsked != from else { return }
        guard let data = try? await api.data("figure") else {
            // It didn't arrive: nothing is asked of this server yet, so the next reload asks again.
            // Until then the app keeps the definition it has.
            if self.api?.base == api.base { figureAsked = nil }
            return
        }
        // Read off the main thread: it is the whole kit.
        let read = await Task.detached { Self.usable(data) }.value
        guard self.api?.base == api.base else { return } // another server was chosen meanwhile
        serverFigure = read
        figureAsked = from
    }

    /// A server's definition, when this app can draw from it. One it can't (another version of the
    /// format, or broken) is none: the app keeps the copy it was built with.
    nonisolated static func usable(_ data: Data) -> FigureDef? { try? FigureDef(json: data) }

    private func forgetAskLines() {
        askLines = [:]
        asksOverdue = []
        askUnnamedSince = [:]
    }

    // MARK: Signing in (ADR 028)

    /// Whether the page `setupKey` opens still makes the passkey of a local botdot server's one account: false once
    /// that account has its passkey (then the app signs in with it).
    public func signUpOpens(at base: URL, setupKey: String) async -> Bool {
        var req = URLRequest(url: URL(string: "sign-up/\(setupKey)", relativeTo: base.appendingPathComponent("/"))!.absoluteURL)
        req.httpShouldHandleCookies = false
        guard let (_, response) = try? await URLSession.shared.data(for: req) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    /// Back from the sign-in sheet (`Handoff`) at `callback`: this app's own session, then the botdot server
    /// behind the front door.
    public func signIn(at base: URL, handoff: Handoff, callback: URL) async throws {
        guard let code = Handoff.code(in: callback) else { throw ConnectError(message: "The sign-in didn't finish. Try again.") }
        struct Body: Encodable { let code: String; let verifier: String }
        _ = try await API(base: base, sessions: sessions).frontDoor("sign-in/handoff", body: Body(code: code, verifier: handoff.verifier))
        guard sessions.token(for: base) != nil else { throw ConnectError(message: "The sign-in didn't finish. Try again.") }
        signInNeeded = nil
        try await connect(to: base.absoluteString)
    }

    /// "Sign out everywhere" (Settings): every session of this account ends, in every app, this one too. The app
    /// then asks for a sign-in.
    public func signOutEverywhere() async throws {
        guard let api else { throw ConnectError(message: "Not connected.") }
        _ = try await api.frontDoor("sign-out-everywhere")
        api.sessions.set(nil, for: api.base) // also when the answer's cookie didn't say so
        sessionEnded(Sessions.origin(of: api.base))
    }

    /// The sign-in is not wanted now (another botdot server is chosen).
    public func stopSigningIn() { signInNeeded = nil }

    /// The session with this botdot address ended (here or elsewhere): what was shown goes, and a sign-in is asked.
    func sessionEnded(_ origin: String) {
        guard let api, Sessions.origin(of: api.base) == origin else { return }
        let base = api.base
        disconnect()
        signInNeeded = base
    }

    /// Stops following this botdot server.
    public func disconnect() {
        stopFeed()
        stopReporting()
        chiefFollow?.cancel()
        runFollow?.cancel()
        botChat = BotChatState()
        openingLines = OpeningLines()
        api = nil
        connected = false
        away = false
        claude = ClaudeSignIn()
        rates = false
        queued = [:]
        outboxes = [:]
        features = []
        serverFigure = nil
        figureAsked = nil
        bots = []
        recentRuns = []
        chiefChats = []
        chief = ChiefChatState()
        loginRequests = []
        asks = []
        forgetAskLines()
        memoryPending = []
        bitwarden = nil
        checkup = nil
        forgetGroups()
    }
}
