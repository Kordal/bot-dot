import Foundation
import Observation
import BotdotShared

/// Projects on screen (#1366): the shared ProjectStore's state and what a tap hands back to it. Everything it decides
/// is the shared layer's (ProjectDesk), as Android's Company screens. Home keeps one for the switch of spaces; each
/// project's page keeps its own.
@MainActor
@Observable
final class ProjectModel {
    private(set) var state: ProjectState?
    let store: ProjectStore
    private var watching: Kotlinx_coroutines_coreJob?

    init(home: HomeStore) {
        store = ProjectStore(home: home)
    }

    deinit {
        store.close()
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
        store.follow(on: false)
    }

    func show(_ id: String) { store.show(id: id) }
    func follow(_ on: Bool) { store.follow(on: on) }
    func refresh() async { try? await store.refresh() }

    /// Tidy up: the id of the Chief chat it was asked in, "" for none.
    func tidy() async -> String { (try? await store.tidy()) ?? "" }
    func chiefChat() async -> String { (try? await store.chiefChat()) ?? "" }

    func openCard(_ id: String) { store.openCard(id: id) }
    func closeCard() { store.closeCard() }
    func ask(_ text: String) async { try? await store.ask(text: text) }
    func answer(_ card: String, _ text: String) async -> Bool { (try? await store.answer(card: card, text: text))?.boolValue ?? false }
    func closeQuestions(_ card: String) async { try? await store.closeQuestions(card: card) }
    func refreshCard(_ card: String) async { try? await store.refreshCard(card: card) }
    func removeCard(_ card: String) async { try? await store.removeCard(card: card) }
    func putPiece(_ piece: String) async { try? await store.putPiece(piece: piece) }

    func offered(_ team: String) -> [Bot] { store.offered(team: team) }
    func addOwn(_ ids: [String]) async { _ = try? await store.addOwn(ids: ids) }
    func removeOwn(_ id: String) async { _ = try? await store.removeOwn(id: id) }
    func addToTeam(_ team: String, _ ids: [String]) async { _ = try? await store.addToTeam(team: team, ids: ids) }
    func makeLead(_ team: String, _ bot: String) async { _ = try? await store.makeLead(team: team, bot: bot) }

    func rename(_ name: String) async { _ = try? await store.rename(name: name) }
    func setColor(_ color: String) async { _ = try? await store.setColor(color: color) }
    func setLead(_ bot: String?) async { _ = try? await store.setLead(bot: bot) }
    func setArchived(_ on: Bool) async { _ = try? await store.setArchived(on: on) }
}
