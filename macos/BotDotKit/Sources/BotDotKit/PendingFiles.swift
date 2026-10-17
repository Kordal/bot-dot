import Foundation
import Observation

/// Files waiting to go with the next message: attached, dropped on the chat or pasted (screenshots
/// too). Each uploads at once, as on the web, so sending is instant.
@MainActor
@Observable
public final class PendingFiles {
    public struct Item: Identifiable, Sendable {
        public let id = UUID()
        public let name: String
        public let size: Int
        public var ref: FileRef?
        public var failed = false
    }

    public var items: [Item] = []
    /// A short word about the last thing that didn't work ("Attach at most 10 files at a time.").
    public var note: String?

    public init() {}

    public var uploading: Bool { items.contains { $0.ref == nil && !$0.failed } }
    public var ready: [FileRef] { items.compactMap(\.ref) }

    /// Adds files (up to 10, each up to 25 MB) and uploads them to that bot's or the Chief's workspace.
    public func add(_ urls: [URL], store: Store, to target: UploadTarget) {
        var notes: [String] = []
        for url in urls {
            if items.count >= Store.maxFiles { notes.append("Attach at most 10 files at a time."); break }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if size > Store.maxFileBytes { notes.append("\(url.lastPathComponent) is over 25 MB."); continue }
            let item = Item(name: url.lastPathComponent, size: size)
            items.append(item)
            Task {
                do {
                    let ref = try await store.upload(url, to: target)
                    if let i = items.firstIndex(where: { $0.id == item.id }) { items[i].ref = ref }
                } catch {
                    if let i = items.firstIndex(where: { $0.id == item.id }) { items[i].failed = true }
                    note = "\(item.name): \(error.localizedDescription)"
                }
            }
        }
        note = notes.isEmpty ? nil : notes.joined(separator: " ")
    }

    public func remove(_ id: UUID) { items.removeAll { $0.id == id } }

    /// The files of a message that could not be sent are back, in front of those attached since.
    public func putBack(_ files: [FileRef]) {
        items.insert(contentsOf: files.map { Item(name: $0.name, size: $0.size ?? 0, ref: $0) }, at: 0)
    }

    /// Takes the ready files for sending, and empties the list.
    public func take() -> [FileRef] {
        let r = ready
        items = []
        note = nil
        return r
    }
}
