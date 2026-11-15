import Foundation
import Observation
import BotdotShared

/// The Board for one signed-in botdot: the shared layer's BoardStore on Home's Store, and the state it pushes. Every
/// cell, word and tap is the shared layer's (BoardDesk), as on Android; this hands the taps back.
@MainActor
@Observable
final class BoardModel {
    private(set) var state: BoardState?
    let store: BoardStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) {
        store = BoardStore(home: home)
    }

    /// Starts it at the screen's [width] (its columns): the width's changes after come through [width(_:)].
    func start(width points: CGFloat) {
        width(points)
        start()
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

    func width(_ points: CGFloat) { store.width(points: Float(points)) }
    /// The app in front or not: the Board is read only while it is (the poll stops when the phone is locked).
    func active(_ on: Bool) { store.active(on: on) }
    func filter(_ name: String) { store.filter(name: name) }
    func refresh() async { try? await store.refresh() }

    /// The name of the bot [id], for the chat a chat tile opens.
    func botName(_ id: String) -> String? { store.botName(id: id) }

    /// A tap on a tile: what is left for the screen to do; nil when the tap did all it does here.
    func tap(_ key: String, asked: Bool = false) async -> BoardTap? {
        try? await store.tap(key: key, asked: asked)
    }

    func setSwitch(_ key: String, _ block: String, _ on: Bool) async { try? await store.setSwitch(key: key, block: block, on: on) }
    func setNumber(_ key: String, _ block: String, _ value: Double) async { try? await store.setNumber(key: key, block: block, value: value) }
    func choose(_ key: String, _ block: String, _ option: Int) async { try? await store.choose(key: key, block: block, option: Int32(option)) }
    func press(_ key: String, _ block: String) async { try? await store.press(key: key, block: block) }
    func setColor(_ key: String, _ block: String, _ hex: String, done: Bool) async { try? await store.setColor(key: key, block: block, hex: hex, done: done) }
    func remove(_ key: String, withTiles: Bool) async { try? await store.remove(key: key, withTiles: withTiles) }
    func askChange(_ key: String, _ text: String) async -> Bool { (try? await store.askChange(key: key, text: text))?.boolValue ?? false }
    func answer(_ suggestion: String, add: Bool) async { try? await store.answer(suggestion: suggestion, add: add) }
}
