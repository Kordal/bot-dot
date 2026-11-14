import Foundation
import Observation
import BotdotShared

/// Needs you for one signed-in botdot: the shared layer's NeedsYouStore on Home's Store, and the state it pushes. Every
/// card, word and answer is the shared layer's (NeedsDesk), as on Android; this hands the taps back.
@MainActor
@Observable
final class NeedsYouModel {
    private(set) var state: NeedsState?
    let store: NeedsYouStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) {
        store = NeedsYouStore(home: home)
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

    func refresh() async { try? await store.refresh() }

    /// A tap on a card's button; the address of a sign-in page to open, for a Connect.
    func press(_ key: String, _ button: String) async -> URL? {
        guard let url = try? await store.press(key: key, button: button) else { return nil }
        return URL(string: url)
    }

    func approveAll() async { try? await store.approveAll() }
    func choose(_ key: String, _ type: String) { store.choose(key: key, type: type) }

    /// What was typed in a card's secret fields: a login's secret and Bitwarden's master password. It is kept while the
    /// card saves or unlocks, when its fields are not drawn, and after a failure, so a failed save or a wrong master
    /// password loses nothing; it is cleared once the save or the unlock went through.
    struct Typed { var secret = ""; var master = "" }
    var typed: [String: Typed] = [:]

    func saveLogin(_ key: String, type: String, username: String, secret: String, master: String) async {
        let saved = (try? await store.saveLogin(key: key, type: type, username: username, secret: secret, master: master))?.boolValue ?? false
        if saved { typed[key] = nil }
    }

    func unlock(_ key: String, _ master: String) async {
        let unlocked = (try? await store.unlock(master: master))?.boolValue ?? false
        if unlocked { typed[key] = nil }
    }
    func answer(_ key: String, _ answers: [String]) async { try? await store.answer(key: key, answers: answers) }
    func back() async { try? await store.back() }
}
