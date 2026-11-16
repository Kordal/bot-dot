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
    func arrange(_ layout: [String: BoardCanvas.R]) async -> Bool { (try? await store.arrange(layout: layout))?.boolValue ?? false }
    func removeCard(_ card: String) async { try? await store.removeCard(card: card) }
    func putPiece(_ piece: String) async { try? await store.putPiece(piece: piece) }
    @discardableResult func answerSuggested(add: Bool) async -> Bool { (try? await store.answerSuggested(add: add))?.boolValue ?? false }

    func todoFilter(_ filter: String) { store.todoFilter(filter: filter) }
    func tickTodo(_ id: String, _ done: Bool) async { try? await store.tickTodo(id: id, done: done) }
    func deleteTodo(_ id: String) async { try? await store.deleteTodo(id: id) }
    /// True once it went in: the field empties.
    func addTodo(_ typed: String, who: String?, due: String?, repeat r: Repeat?) async -> Bool {
        (try? await store.addTodo(typed: typed, who: who, due: due, repeat: r))?.boolValue ?? false
    }

    func offered(_ team: String) -> [Bot] { store.offered(team: team) }
    @discardableResult func addOwn(_ ids: [String]) async -> Bool { (try? await store.addOwn(ids: ids))?.boolValue ?? false }
    @discardableResult func removeOwn(_ id: String) async -> Bool { (try? await store.removeOwn(id: id))?.boolValue ?? false }
    @discardableResult func addToTeam(_ team: String, _ ids: [String]) async -> Bool { (try? await store.addToTeam(team: team, ids: ids))?.boolValue ?? false }
    @discardableResult func makeLead(_ team: String, _ bot: String) async -> Bool { (try? await store.makeLead(team: team, bot: bot))?.boolValue ?? false }

    @discardableResult func rename(_ name: String) async -> Bool { (try? await store.rename(name: name))?.boolValue ?? false }
    @discardableResult func setColor(_ color: String) async -> Bool { (try? await store.setColor(color: color))?.boolValue ?? false }
    @discardableResult func setLead(_ bot: String?) async -> Bool { (try? await store.setLead(bot: bot))?.boolValue ?? false }
    @discardableResult func setArchived(_ on: Bool) async -> Bool { (try? await store.setArchived(on: on))?.boolValue ?? false }
    @discardableResult func setStart(_ text: String) async -> Bool { (try? await store.setStart(text: text))?.boolValue ?? false }
    @discardableResult func addLink(_ typed: String) async -> Bool { (try? await store.addLink(typed: typed))?.boolValue ?? false }
    @discardableResult func removeSource(_ id: String) async -> Bool { (try? await store.removeSource(id: id))?.boolValue ?? false }
    @discardableResult func addNever(_ text: String) async -> Bool { (try? await store.addNever(text: text))?.boolValue ?? false }
    @discardableResult func removeNever(_ index: Int) async -> Bool { (try? await store.removeNever(index: Int32(index)))?.boolValue ?? false }
    @discardableResult func setTime(_ text: String) async -> Bool { (try? await store.setTime(text: text))?.boolValue ?? false }
    @discardableResult func setUpdates(_ every: String) async -> Bool { (try? await store.setUpdates(every: every))?.boolValue ?? false }
    @discardableResult func setReportRhythm(_ team: String, _ every: String) async -> Bool { (try? await store.setReportRhythm(team: team, every: every))?.boolValue ?? false }
    @discardableResult func setStandupOn(_ on: Bool) async -> Bool { (try? await store.setStandupOn(on: on))?.boolValue ?? false }
    @discardableResult func setStandupTime(_ time: String) async -> Bool { (try? await store.setStandupTime(time: time))?.boolValue ?? false }
    /// Delete project, with its folder when asked: true once botdot took it and the store forgot it.
    @discardableResult func delete(dropFolder: Bool) async -> Bool { (try? await store.delete(dropFolder: dropFolder))?.boolValue ?? false }
    @discardableResult func saveTeam(_ team: String?, name: String, bots: [String], lead: String?) async -> Bool {
        (try? await store.saveTeam(team: team, name: name, bots: bots, lead: lead))?.boolValue ?? false
    }
    @discardableResult func deleteTeam(_ team: String) async -> Bool { (try? await store.deleteTeam(team: team))?.boolValue ?? false }
    /// The Vault's logins not yet the project's; nil when the Vault can't be read (the notice says why).
    func addableLogins() async -> [VaultItem]? { (try? await store.addableLogins()) ?? nil }
    @discardableResult func addLogin(_ id: String) async -> Bool { (try? await store.addLogin(id: id))?.boolValue ?? false }
    @discardableResult func removeLogin(_ id: String) async -> Bool { (try? await store.removeLogin(id: id))?.boolValue ?? false }

    /// Files picked in Files: each copied where the app may read it, then added as sources. One that can't be
    /// read is said in the notice.
    func addFiles(_ urls: [URL]) async {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("sources", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var paths: [String] = []
        var names: [String] = []
        var unread: [String] = []
        for url in urls {
            let open = url.startAccessingSecurityScopedResource()
            defer { if open { url.stopAccessingSecurityScopedResource() } }
            let copy = dir.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
            guard (try? FileManager.default.copyItem(at: url, to: copy)) != nil else { unread.append(url.lastPathComponent); continue }
            paths.append(copy.path)
            names.append(url.lastPathComponent)
        }
        _ = try? await store.addFiles(paths: paths, names: names, unread: unread)
        for p in paths { try? FileManager.default.removeItem(atPath: p) }
    }
}
