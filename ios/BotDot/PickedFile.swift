import CoreTransferable
import UniformTypeIdentifiers

/// A photo or video picked in Photos, handed over by the system as a file and copied into a folder of its own in the
/// app's temporary directory: its bytes never sit in memory, which a long video's would. Delete [folder] once it is
/// uploaded or not.
struct PickedFile: Transferable {
    let url: URL
    var folder: URL { url.deletingLastPathComponent() }

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .item) { received in
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(received.file.lastPathComponent)
            do {
                try FileManager.default.copyItem(at: received.file, to: url)
            } catch {
                try? FileManager.default.removeItem(at: folder)
                throw error
            }
            return PickedFile(url: url)
        }
    }

    /// The name it is sent under: "photo" or "video", with its kind's extension (the phone's own file names say nothing).
    static func name(of type: UTType?) -> String {
        let ext = type?.preferredFilenameExtension ?? "jpg"
        return (type?.conforms(to: .movie) == true ? "video." : "photo.") + ext
    }
}
