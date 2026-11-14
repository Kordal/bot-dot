import Foundation
import Observation
import BotdotShared

/// One bot's computer screen: the shared layer's ScreenStore on Home's Store, and the state it pushes. Where it opens,
/// its page, "I'm done" and the words are the shared layer's (ComputerScreen), as on Android; this hands the taps back.
@MainActor
@Observable
final class ScreenModel {
    private(set) var state: ScreenState?
    let store: ScreenStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore, botId: String) {
        store = ScreenStore(home: home, botId: botId)
    }

    func start() {
        guard watching == nil else { return }
        watching = store.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
        store.close()
    }

    func startScreen() { store.start() }
    func control() { store.control() }

    /// "I'm done": whether the screen went back to the bot.
    func done() async -> Bool { (try? await store.done())?.boolValue ?? false }

    /// The session's cookie for the page, as WKWebView takes it; nil without a session.
    func cookie(for url: URL) -> HTTPCookie? {
        guard let c = store.cookie(), let host = url.host() else { return nil }
        var props: [HTTPCookiePropertyKey: Any] = [.name: c.name, .value: c.value, .domain: host, .path: "/"]
        if c.secure { props[.secure] = "TRUE" }
        return HTTPCookie(properties: props)
    }
}
