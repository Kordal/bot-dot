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

    func saveLogin(_ key: String, type: String, username: String, secret: String, master: String) async {
        try? await store.saveLogin(key: key, type: type, username: username, secret: secret, master: master)
    }

    func unlock(_ master: String) async { try? await store.unlock(master: master) }
    func answer(_ key: String, _ answers: [String]) async { try? await store.answer(key: key, answers: answers) }
    func back() async { try? await store.back() }
}
