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

    private(set) var screen: Screen = .starting
    var error: String?
    private(set) var busy = false

    let session = Session(keep: KeychainSessions())
    private let settings: Settings

    init(directory: URL? = nil) {
        let dir = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        settings = settingsIn(directory: dir.path)
    }

    /// The botdot this phone was set to, signed in or not.
    func start() async {
        let server = (try? await settings.serverNow()) ?? nil
        screen = server.map(screenFor) ?? .address
    }

    /// An address typed in: refused at once, asked whether it is a botdot, then kept.
    func connect(_ typed: String) async {
        error = nil
        let address = Connect.shared.address(input: typed)
        if let words = Connect.shared.words(address: address) {
            error = words
            return
        }
        guard case .remote(let remote) = onEnum(of: address) else { return }
        busy = true
        defer { busy = false }
        do {
            if let words = try await Connect.shared.check(url: remote.url) {
                error = words
                return
            }
            _ = try await settings.setServer(url: remote.url)
            screen = screenFor(remote.url)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The front door's sign-in page in [open] (the Safari sheet), and its code turned into this phone's session.
    func signIn(_ server: String, open: (URL) async throws -> URL) async {
        error = nil
        let api = Api(baseUrl: server, session: session, quietMs: Api.companion.QUIET_MS)
        let flow = BrowserSignIn(keep: WaitingSignIn(), now: { KotlinLong(value: Int64(Date().timeIntervalSince1970 * 1000)) }, api: { api })
        guard let page = flow.start(), let url = URL(string: page) else { return }
        let back: URL
        do {
            back = try await open(url)
        } catch {
            flow.couldNotOpen(words: "") // closed by the owner: nothing to say
            return
        }
        busy = true
        defer { busy = false }
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
        let api = Api(baseUrl: server, session: session, quietMs: Api.companion.QUIET_MS)
        try? await api.signOut()
        KeychainSessions().write(server: server, token: nil)
        screen = .signIn(server)
    }

    /// Another address: this one's session stays for when the phone comes back to it.
    func otherAddress() {
        error = nil
        screen = .address
    }

    private func screenFor(_ server: String) -> Screen {
        session.token(server: server) != nil ? .signedIn(server) : .signIn(server)
    }
}
