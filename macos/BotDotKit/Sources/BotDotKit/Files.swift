import Foundation

/// A file in a chat: one you attached (as `POST /api/uploads` returned it), or one a bot gave you.
public struct FileRef: Codable, Hashable, Sendable {
    public let name: String
    /// Where botdot keeps it: send it back as it is, or download it from `/api/files/<file>`.
    public let file: String
    public var size: Int?
    /// botdot also saved a readable copy (Excel, Word, PowerPoint, OpenDocument).
    public var readable: Bool?

    public var isImage: Bool { ["png", "jpg", "jpeg", "gif", "webp"].contains(ext) }
    public var isPDF: Bool { ext == "pdf" }
    var ext: String { (name as NSString).pathExtension.lowercased() }
}

/// Who an attached file is for: a bot's workspace, or the Chief's.
public enum UploadTarget: Sendable {
    case bot(String)
    case chief
    /// A group's chat: its members read the file.
    case group(String)
    var query: String {
        switch self {
        case .bot(let id): "bot:\(id)"
        case .chief: "chief"
        case .group(let id): Groups.key(id)
        }
    }
}

extension Store {
    /// At most this many files go with one message, each up to 25 MB (as on the web).
    public static let maxFiles = 10
    public static let maxFileBytes = 25 * 1024 * 1024

    /// Uploads a file for a message, to that bot's (or the Chief's) workspace.
    public func upload(_ url: URL, to target: UploadTarget) async throws -> FileRef {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let name = url.lastPathComponent
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > Self.maxFileBytes { throw API.Failure(status: 413, message: "\(name) is over 25 MB.") }
        return try await api.upload(url, name: name, to: target.query)
    }

    /// Where a file can be downloaded from.
    public func url(of file: FileRef) -> URL? {
        guard let api else { return nil }
        let path = file.file.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(.init(charactersIn: "-._~"))) ?? "" }.joined(separator: "/")
        return URL(string: "api/files/" + path, relativeTo: api.base.appendingPathComponent("/"))?.absoluteURL
    }

    /// A file's contents.
    public func download(_ file: FileRef) async throws -> Data {
        guard let api, let url = url(of: file) else { throw ConnectError(message: "Not connected.") }
        let (data, status) = try await api.load(try api.request(url: url))
        guard status == 200 else { throw API.Failure(status: status, message: status == 404 ? "That file is gone (files are kept for 90 days)." : "botdot answered \(status)") }
        return data
    }
}

extension API {
    /// Sends the file as it is on disk, without reading it all into memory first.
    func upload(_ url: URL, name: String, to: String) async throws -> FileRef {
        var req = try request("uploads?to=\(to.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? to)", method: "POST")
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.setValue(name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? name, forHTTPHeaderField: "X-File-Name")
        let (body, response) = try await session.upload(for: req, fromFile: url)
        sessions.took(response, body: body, sent: Self.sent(req))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            struct ErrorBody: Decodable { let error: String }
            throw Failure(status: status, message: (try? JSON.decoder.decode(ErrorBody.self, from: body).error) ?? "Upload failed (\(status))")
        }
        var file = try JSON.decoder.decode(FileRef.self, from: body)
        file = FileRef(name: name, file: file.file, size: file.size, readable: file.readable)
        return file
    }
}
