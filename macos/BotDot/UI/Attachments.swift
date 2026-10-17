import SwiftUI
import AppKit
import UniformTypeIdentifiers
import BotDotKit

extension PendingFiles {
    /// Files from a drop: file URLs, or a picture (a screenshot) saved as a PNG first, in the order
    /// they were dropped.
    func add(_ providers: [NSItemProvider], store: Store, to target: UploadTarget) -> Bool {
        let wanted = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) || $0.canLoadObject(ofClass: NSImage.self) }
        guard !wanted.isEmpty else { return false }
        note = nil
        Task {
            var urls: [URL] = []
            for p in wanted {
                if let url = await Self.load(p) { urls.append(url) }
            }
            add(urls, store: store, to: target)
        }
        return true
    }

    private static func load(_ p: NSItemProvider) async -> URL? {
        await withCheckedContinuation { done in
            if p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                _ = p.loadObject(ofClass: URL.self) { url, _ in done.resume(returning: url) }
            } else {
                _ = p.loadObject(ofClass: NSImage.self) { image, _ in done.resume(returning: (image as? NSImage).flatMap(png)) }
            }
        }
    }

    /// A pasted or dropped picture as a PNG file, named like a Mac screenshot ("Screenshot 2026-09-29
    /// at 09.30.12.png"), each in a folder of its own so two never clash.
    nonisolated static func png(_ image: NSImage) -> URL? {
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let data = rep.representation(using: .png, properties: [:]) else { return nil }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-paste-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("Screenshot \(f.string(from: .now)).png")
        return (try? data.write(to: url)) != nil ? url : nil
    }
}

/// What a file is, at a glance, as on the web.
func fileIcon(_ name: String) -> String {
    let ext = (name as NSString).pathExtension.lowercased()
    switch ext {
    case "xlsx", "xls", "xlsm", "csv", "ods", "tsv": return "📊"
    case "pdf": return "📕"
    case "docx", "doc", "odt", "md", "txt": return "📝"
    case "pptx", "odp": return "📽"
    case "png", "jpg", "jpeg", "gif", "webp": return "🖼"
    case "json": return "🧾"
    default: return "📄"
    }
}

func fileSize(_ n: Int) -> String {
    n >= 1_048_576 ? String(format: "%.1f MB", Double(n) / 1_048_576) : n >= 1024 ? "\(n / 1024) KB" : "\(n) B"
}

/// A file as a small chip: its icon and name.
struct FileChip: View {
    let name: String
    var size: Int?
    var status: String?
    var remove: (() -> Void)?

    var body: some View {
        HStack(spacing: 5) {
            Text(fileIcon(name))
            Text(name).lineLimit(1).truncationMode(.middle)
            if let status { Text(status).italic().foregroundStyle(Theme.muted) }
            if let remove {
                Button(action: remove) { Image(systemName: "xmark").font(.geist(size: 9, weight: .bold)) }
                    .buttonStyle(.plain).foregroundStyle(Theme.muted).help("Remove")
            }
        }
        .font(.geist(size: 12.5))
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(Capsule().fill(Theme.panel))
        .overlay(Capsule().strokeBorder(Theme.line2, lineWidth: 1))
        .help(size.map { "\(name) · \(fileSize($0))" } ?? name)
    }
}

/// The files a bot gave you: pictures inline (they open big), other files as chips that open.
struct BotFiles: View {
    let files: [FileRef]
    var opensDocuments = true
    @Environment(Store.self) private var store
    @Environment(\.openChatImage) private var openImage

    var body: some View {
        if !files.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(files, id: \.file) { f in
                    if f.isImage {
                        Button { openImage?(f) } label: {
                            ChatImage(file: f, thumbnail: true)
                            .frame(maxWidth: 360, maxHeight: 420)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.line2, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .help(f.name)
                        .accessibilityLabel(f.name)
                    } else if opensDocuments {
                        Button { open(f) } label: { FileChip(name: f.name, size: f.size) }.buttonStyle(.plain)
                    } else {
                        FileChip(name: f.name, size: f.size)
                    }
                }
            }
        }
    }

    /// Opens a file: a PDF straight away; anything else is saved in Downloads first, as the web does.
    private func open(_ f: FileRef) {
        Task {
            do {
                let data = try await store.download(f)
                let folder = f.isPDF ? FileManager.default.temporaryDirectory : (FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
                let url = uniqueURL(in: folder, name: f.name)
                try data.write(to: url)
                NSWorkspace.shared.open(url)
            } catch {
                store.problem = error.localizedDescription
            }
        }
    }

    private func uniqueURL(in folder: URL, name: String) -> URL {
        let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
        var url = folder.appendingPathComponent(name)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return url
    }
}

