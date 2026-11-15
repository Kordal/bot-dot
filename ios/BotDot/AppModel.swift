import AuthenticationServices
import Foundation
import Observation
import BotdotShared

/// What the app is showing, and the calls behind it: everything it decides is the shared layer's (Connect, Session,
/// BrowserSignIn, Settings), as the Android app's.
@MainActor
@Observable
final class AppModel {
    enum Screen: Equatable {
        case starting
        case address
        case signIn(String)
        case signedIn(String)
        /// Its account is paused by the admin (Session.paused): the paused screen, until botdot answers otherwise.
        case paused(String)
    }

    private(set) var screen: Screen = .starting {
        // The share extension sends through the botdot signed in to; paused, it still does, and botdot says it is
        // paused. Another address, or a sign-in: none.
        didSet {
            switch screen {
            case .signedIn(let server), .paused(let server): SharedAddress.write(server)
            case .address, .signIn: SharedAddress.write(nil)
            case .starting: break
            }
        }
    }
    var error: String?
    /// What the sign-in says without it being wrong: that the account was deleted.
    var notice: String?
    private(set) var busy = false
    /// The notice that what is sent goes to Anthropic was accepted on this phone (AiNotice): until it is, the
    /// signed-in screen is the notice.
    private(set) var noticeSeen = false

    /// Signed in, and the notice not accepted yet: the notice in Home's place.
    var showsNotice: Bool {
        if case .signedIn = screen { return !noticeSeen }
        return false
    }

    let session: Session
    private let sessions: KeychainSessions
    let settings: Settings
    private let paused: PausedWatch

    init(directory: URL? = nil, sessions: KeychainSessions = KeychainSessions()) {
        self.sessions = sessions
        session = Session(keep: sessions)
        let dir = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        settings = settingsIn(directory: dir.path)
        paused = PausedWatch(session: session)
        _ = paused.watch { [weak self] server in
            MainActor.assumeIsolated { self?.pausedNow(server) }
        }
    }

    /// The admin paused [server]'s account, or resumed it (nil, or another botdot's).
    /// Home for [server], or its paused screen when its account is paused already.
    private func home(_ server: String) -> Screen { paused.now() == server ? .paused(server) : .signedIn(server) }

    private func pausedNow(_ server: String?) {
        switch screen {
        case .signedIn(let s) where s == server: screen = .paused(s)
        case .paused(let s) where s != server: screen = .signedIn(s)
        default: break
        }
    }

    /// The botdot this phone was set to: Home, until its front door asks for a sign-in ([signInNeeded]), as on Android.
    func start() async {
        // Accepted in the app or in a share: both know, so it shows never again.
        noticeSeen = !((try? await AiNotice.shared.asks(settings: settings))?.boolValue ?? true)
        if noticeSeen { SharedAddress.noticeSeen = true } else if SharedAddress.noticeSeen { await acceptNotice() }
        let server = (try? await settings.serverNow()) ?? nil
        screen = server.map { home($0) } ?? .address
    }

    /// Continue on the notice: kept, so it shows never again, and Home shows.
    func acceptNotice() async {
        try? await settings.setAiNoticeSeen()
        SharedAddress.noticeSeen = true
        noticeSeen = true
    }

    /// An address typed in: refused at once, asked whether it is a botdot, then kept.
    func connect(_ typed: String) async {
        guard !busy else { return } // one check at a time: a second tap waits for the first
        error = nil
        busy = true
        defer { busy = false }
        do {
            switch onEnum(of: try await Connect.shared.connect(typed: typed)) {
            case .refused(let refused):
                error = refused.words
            case .connected(let connected):
                _ = try await settings.setServer(url: connected.url)
                // A front door without this phone's session asks for the sign-in first; a botdot without one doesn't.
                screen = connected.frontDoor && session.token(server: connected.url) == nil ? .signIn(connected.url) : home(connected.url)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The front door's sign-in page in [open] (the Safari sheet), and its code turned into this phone's session.
    func signIn(_ server: String, open: (URL) async throws -> URL) async {
        guard !busy else { return } // one sign-in at a time
        busy = true
        defer { busy = false }
        error = nil
        notice = nil
        let api = Api(baseUrl: server, session: session, quietMs: Api.companion.QUIET_MS)
        let flow = BrowserSignIn(keep: WaitingSignIn(), now: { KotlinLong(value: Int64(Date().timeIntervalSince1970 * 1000)) }, api: { api })
        guard let page = flow.start(), let url = URL(string: page) else { return }
        let back: URL
        do {
            back = try await open(url)
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            flow.couldNotOpen(words: "") // closed by the owner: nothing to say
            return
        } catch {
            // The sheet couldn't open, or ended otherwise: said, and Sign in can be tapped again.
            let words = tr("The sign-in didn't come back from the browser. Sign in again.")
            flow.couldNotOpen(words: words)
            self.error = words
            return
        }
        do {
            try await flow.back(uri: back.absoluteString)
        } catch {
            self.error = error.localizedDescription
            return
        }
        switch onEnum(of: flow.state.value) {
        case .done:
            ReplyPictures.forgetAll() // another account may be signing in: none of the last one's pictures
            screen = home(server)
        case .failed(let failed): error = failed.words
        default: break
        }
    }

    /// Signs this phone out of [server]: the front door clears its session, and the Keychain forgets it.
    func signOut(_ server: String) async {
        guard !busy else { return } // nothing else starts while it signs out
        busy = true
        defer { busy = false }
        let api = Api(baseUrl: server, session: session, quietMs: Api.companion.QUIET_MS)
        await Notifications.shared.signOut(api) // while the session still lets it in
        try? await api.signOut()
        sessions.write(server: server, token: nil)
        ReplyPictures.forgetAll() // signed out: none of this account's pictures stay
        // Another address may have been chosen meanwhile: its screen stays.
        if screen == .signedIn(server) || screen == .paused(server) { screen = .signIn(server) }
    }

    /// The front door of [server] ended this phone's session (signed out everywhere, or never signed in): its sign-in.
    func signInNeeded(_ server: String) {
        if screen == .signedIn(server) || screen == .paused(server) { screen = .signIn(server) }
    }

    /// The account was deleted: the sign-in, saying so, from Home or from its paused screen.
    func accountDeleted(_ server: String, _ words: String) {
        sessions.write(server: server, token: nil)
        ReplyPictures.forgetAll() // signed out: none of this account's pictures stay
        notice = words
        if screen == .signedIn(server) || screen == .paused(server) { screen = .signIn(server) }
    }

    /// This phone's API for [server], with its session.
    func api(_ server: String) -> Api {
        Api(baseUrl: server, session: session, quietMs: Api.companion.QUIET_MS)
    }

    /// Another address: this one's session stays for when the phone comes back to it.
    func otherAddress() {
        error = nil
        notice = nil
        screen = .address
    }

    /// The API of the botdot this phone is set to, also when the app was started just for a notification's button.
    func apiNow() async -> Api? {
        guard let server = (try? await settings.serverNow()) ?? nil else { return nil }
        return api(server)
    }

    /// The chat a notification's tap asked for (`"bot:<id>"`, `"chief:<chatId>"`, `"group:<id>"`), until a chat
    /// screen takes it. The hook for the bot chat (#1390): it opens this chat when it is set and calls [chatOpened].
    /// Until then a tap opens Home, where the chat's bot is in the list.
    private(set) var chatToOpen: String?

    /// A tap on a notification (PushNotices.opens): a chat, Needs you or the app. Needs you is at the top of Home,
    /// so it and the app open Home: the screen signed in to shows it; a sign-in or the address shows as it is.
    func open(_ opens: PushNotices.Opens) {
        switch onEnum(of: opens) {
        case .chat(let chat): chatToOpen = chat.chat
        case .needsYou, .app: chatToOpen = nil
        }
    }

    /// The chat screen showed [chatToOpen].
    func chatOpened() {
        chatToOpen = nil
    }

}
