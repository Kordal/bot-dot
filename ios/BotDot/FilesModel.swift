import Foundation
import Observation
import BotdotShared

/// One folder of Files: whose files, which place, and the folder in it. A folder tapped opens as another.
struct FilesPlace: Hashable {
    let owner: String
    let name: String
    var place: String = ""
    var path: String = ""
}

/// One folder of a bot's, the Chief's or a project's files (FilesStore): what it shows and does is the shared layer's,
/// as on Android. A change it makes answers in a few words ([notice]); a failed one says why.
@MainActor
@Observable
final class FilesModel {
    private(set) var state: FilesState?
    var notice: String?
    private(set) var busy = false

    let files: FilesStore
    private var watching: Kotlinx_coroutines_coreJob?
    /// Where files saved for Share go, gone with the folder's screen.
    private let shared = FileManager.default.temporaryDirectory.appendingPathComponent("files").appendingPathComponent(UUID().uuidString)

    init(api: Api, at: FilesPlace) {
        files = FilesStore(api: api, ownerId: at.owner, name: at.name, place: at.place, path: at.path)
    }

    func start() {
        guard watching == nil else { return }
        watching = files.watch { [weak self] state in
            MainActor.assumeIsolated { self?.state = state }
        }
        files.start()
    }

    func stop() {
        watching?.cancel(cause: nil)
        watching = nil
    }

    deinit {
        files.close()
        try? FileManager.default.removeItem(at: shared)
    }

    func refresh() async { try? await files.refresh() }

    /// Does [act], saying what it answers, or why it failed.
    func run(_ act: @escaping (FilesStore) async throws -> String?) async {
        busy = true
        defer { busy = false }
        do {
            if let said = try await act(files) { notice = said }
        } catch {
            notice = error.localizedDescription
        }
    }

    /// Uploads [picked] (where each copy is, its name); [unread]: the names of those the phone couldn't read, said too.
    func upload(_ picked: [(URL, String)], unread: [String] = []) async {
        guard !picked.isEmpty || !unread.isEmpty else { return }
        await run { try await $0.upload(paths: picked.map { $0.0.path }, names: picked.map { $0.1 }, unread: unread) }
        for (url, _) in picked { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    }

    func makeFolder(_ name: String) async { await run { try await $0.makeFolder(name: name); return nil } }
    func rename(_ e: WorkspaceEntry, to name: String) async { await run { try await $0.rename(e: e, name: name); return nil } }
    func keep(_ e: WorkspaceEntry, _ on: Bool) async { await run { try await $0.keep(e: e, on: on) } }
    func delete(_ e: WorkspaceEntry) async { await run { try await $0.delete(e: e) } }
    func startComputer() async { await run { try await $0.startComputer(); return nil } }

    /// The question before a delete, or nil when it couldn't be counted (said).
    func deleteWords(_ e: WorkspaceEntry) async -> String? {
        do { return try await files.deleteWords(e: e) } catch { notice = error.localizedDescription; return nil }
    }

    /// The file [opening] saved in the app's own storage, for Share; nil when it couldn't be (said).
    func saved(_ opening: DocumentView.Opening) async -> URL? {
        await ViewerModel.save(DocumentViewer(api: files.api, opening: opening), in: shared.appendingPathComponent(UUID().uuidString)) { self.notice = $0 }
    }
}

/// The document viewer for one file (DocumentViewer): its start, and the file itself where QuickLook and Share take it.
@MainActor
@Observable
final class ViewerModel {
    private(set) var viewed: Viewed?
    /// The file itself, once saved for QuickLook or Share.
    private(set) var file: URL?
    var mode = "source"
    var notice: String?

    let viewer: DocumentViewer
    /// Where its file is saved, gone with the viewer.
    private let dir = FileManager.default.temporaryDirectory.appendingPathComponent("viewer").appendingPathComponent(UUID().uuidString)

    init(api: Api, opening: DocumentView.Opening) {
        viewer = DocumentViewer(api: api, opening: opening)
    }

    func load() async {
        viewed = nil
        guard let v = try? await viewer.load() else { return }
        viewed = v
        mode = v.mode
    }

    private var fetching: Task<URL?, Never>?

    /// The file itself, saved once and kept while the viewer is open: QuickLook and Share wait for the same download.
    func fetch() async -> URL? {
        if let file { return file }
        let task = fetching ?? Task { await Self.save(viewer, in: dir) { self.notice = $0 } }
        fetching = task
        let url = await task.value
        if url == nil { fetching = nil } // asked again on the next tap
        file = url
        return url
    }

    func startComputer() async {
        do { try await viewer.startComputer(); await load() } catch { notice = error.localizedDescription }
    }

    deinit {
        try? FileManager.default.removeItem(at: dir)
    }

    /// [viewer]'s file in the folder [dir] (one of its own in the app's temporary files); nil when it couldn't be saved
    /// ([failed] says why).
    static func save(_ viewer: DocumentViewer, in dir: URL, failed: (String) -> Void) async -> URL? {
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            return URL(fileURLWithPath: try await viewer.save(dir: dir.path))
        } catch {
            failed(error.localizedDescription)
            return nil
        }
    }
}
