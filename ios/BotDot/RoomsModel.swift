import Foundation
import Observation
import BotdotShared

/// Shared rooms for one signed-in botdot: the shared layer's RoomsStore on Home's Store, and the list's state it pushes.
/// Home keeps it, for its row; every room, word and answer is the shared layer's (RoomsDesk), as on Android.
@MainActor
@Observable
final class RoomsModel {
    private(set) var state: RoomsState?
    let store: RoomsStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) {
        store = RoomsStore(home: home)
    }

    func start() {
        guard watching == nil else { return }
        watching = store.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
    }

    deinit {
        store.close()
    }

    /// The app came to front or went behind: the rooms' live events only in front.
    func front(_ on: Bool) { store.front(on: on) }

    func refresh() async { try? await store.refresh() }

    /// The answer to an action on the list: the room to open, or what to say.
    func make(_ name: String) async -> RoomsDone? { try? await store.make(name: name) }
    func accept(_ id: String) async -> RoomsDone? { try? await store.accept(id: id) }
    func decline(_ id: String) async -> RoomsDone? { try? await store.decline(id: id) }
    func look(_ link: String) async -> RoomsJoin? { try? await store.look(link: link) }
    func join(_ token: String) async -> RoomsDone? { try? await store.join(token: token) }
}

/// A room's chat while it is on screen: the shared layer's RoomChatDesk, started when it shows and stopped when it goes,
/// so nothing it follows outlives the screen.
@MainActor
@Observable
final class RoomChatModel {
    private(set) var state: RoomChatState?
    let desk: RoomChatDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(rooms: RoomsModel, id: String) {
        desk = rooms.store.chat(id: id)
    }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
        desk.start()
    }

    func stop() {
        desk.stop()
        watching?.cancel(cause: nil)
        watching = nil
    }

    func refresh() async { try? await desk.load() }
    func loadOlder() { desk.loadOlder() }
    func send(_ text: String) async -> Bool { (try? await desk.send(text: text))?.boolValue ?? false }
    func takeFailed() -> String? { desk.takeFailed() }
    func edited() { desk.edited() }
    func stopTurns() async { try? await desk.stopTurns() }
}

/// A room's settings while they are on screen: the shared layer's RoomSettingsDesk, closed when they go.
@MainActor
@Observable
final class RoomSettingsModel {
    private(set) var state: RoomSettingsState?
    let desk: RoomSettingsDesk
    private var watching: Kotlinx_coroutines_coreJob?

    init(rooms: RoomsModel, id: String) {
        desk = rooms.store.settings(id: id)
    }

    func start() {
        guard watching == nil else { return }
        watching = desk.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
        desk.close()
    }

    func rename(_ name: String) async { try? await desk.rename(name: name) }
    func makeLink(again: Bool) async { try? await desk.makeLink(again: again) }
    func dropLink() async { try? await desk.dropLink() }
    func add(_ bot: String) async { try? await desk.add(bot: bot) }
    func remove(_ bot: String) async { try? await desk.remove(bot: bot) }
    func leave(delete: Bool) async { try? await desk.leave(delete: delete) }
}
