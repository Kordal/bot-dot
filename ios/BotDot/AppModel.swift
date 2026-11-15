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
    }

    private(set) var screen: Screen = .starting {
        // The share extension sends through the botdot signed in to, and none once there is none.
        didSet { if case .signedIn(let server) = screen { SharedAddress.write(server) } else if screen != .starting { SharedAddress.write(nil) } }
    }
    var error: String?
    private(set) var busy = false

    let session: Session
    private let sessions: KeychainSessions
    let settings: Settings

    init(directory: URL? = nil, sessions: KeychainSessions = KeychainSessions()) {
        self.sessions = sessions
        session = Session(keep: sessions)
        let dir = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        settings = settingsIn(directory: dir.path)
    }

    /// The botdot this phone was set to: Home, until its front door asks for a sign-in ([signInNeeded]), as on Android.
    func start() async {
        let server = (try? await settings.serverNow()) ?? nil
        screen = server.map { .signedIn($0) } ?? .address
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
                screen = connected.frontDoor && session.token(server: connected.url) == nil ? .signIn(connected.url) : .signedIn(connected.url)
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
        case .done: screen = .signedIn(server)
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
        // Another address may have been chosen meanwhile: its screen stays.
        if screen == .signedIn(server) { screen = .signIn(server) }
    }

    /// The front door of [server] ended this phone's session (signed out everywhere, or never signed in): its sign-in.
    func signInNeeded(_ server: String) {
        if screen == .signedIn(server) { screen = .signIn(server) }
    }

    /// This phone's API for [server], with its session.
    func api(_ server: String) -> Api {
        Api(baseUrl: server, session: session, quietMs: Api.companion.QUIET_MS)
    }

    /// Another address: this one's session stays for when the phone comes back to it.
    func otherAddress() {
        error = nil
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
