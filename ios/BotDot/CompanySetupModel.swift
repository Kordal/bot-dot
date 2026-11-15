import Foundation
import Observation
import BotdotShared

/// A project's setup for one signed-in botdot: the shared layer's CompanySetupStore on Home's Store, and the state it
/// pushes. What each screen shows and sends is the shared layer's (CompanySetupDesk), as on Android.
@MainActor
@Observable
final class CompanySetupModel {
    private(set) var state: SetupState?
    let store: CompanySetupStore
    private var watching: Kotlinx_coroutines_coreJob?
    /// Where the files picked for the Chief are copied, so the shared layer can read them; gone with the screen.
    private let picked = FileManager.default.temporaryDirectory.appendingPathComponent("setup").appendingPathComponent(UUID().uuidString)

    init(home: HomeStore) {
        store = CompanySetupStore(home: home)
    }

    deinit {
        store.close()
        try? FileManager.default.removeItem(at: picked)
    }

    func start(fresh: Bool) {
        guard watching == nil else { return }
        if fresh { store.startNew() }
        watching = store.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
        store.start()
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
    }

    /// The screen went: backed out of New project with none made, the project shown before shows again.
    func leave() { store.leave() }

    func addLink(_ typed: String) -> Bool { store.addLink(typed: typed) }

    /// Files picked in Files: each copied where the app may read it, then uploaded for the Chief.
    func addFiles(_ urls: [URL]) {
        try? FileManager.default.createDirectory(at: picked, withIntermediateDirectories: true)
        for url in urls {
            let open = url.startAccessingSecurityScopedResource()
            defer { if open { url.stopAccessingSecurityScopedResource() } }
            let copy = picked.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
            // Not read (in iCloud only, not allowed, no room): a red chip, so Go waits, not a file quietly left out.
            guard (try? FileManager.default.copyItem(at: url, to: copy)) != nil else { store.addFailed(name: url.lastPathComponent); continue }
            store.addFile(path: copy.path, name: url.lastPathComponent)
        }
    }

    func removeSource(_ id: String) { store.removeSource(id: id) }
    func go(_ typed: String) async -> Bool { (try? await store.go(typed: typed))?.boolValue ?? false }
    func scratch(_ typed: String) async -> Bool { (try? await store.scratch(typed: typed))?.boolValue ?? false }
    func chiefChat() async -> String { (try? await store.chiefChat()) ?? "" }
    func review() { store.review() }
    func back() { store.back() }
    func rename(_ key: String, _ name: String) { store.rename(key: key, name: name) }
    func remove(_ key: String) { store.remove(key: key) }
    func tick(_ key: String, _ on: Bool) { store.tick(key: key, on: on) }
    func removeNever(_ index: Int) { store.removeNever(index: Int32(index)) }
    func changeTeam(_ typed: String) async -> Bool { (try? await store.changeTeam(typed: typed))?.boolValue ?? false }
    func undo() async { try? await store.undo() }
    func approve() async -> Bool { (try? await store.approve())?.boolValue ?? false }
    func delete(dropFolder: Bool) async -> Bool { (try? await store.delete(dropFolder: dropFolder))?.boolValue ?? false }
}
