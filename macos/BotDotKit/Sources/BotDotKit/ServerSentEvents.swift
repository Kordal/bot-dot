import Foundation

/// One Server-Sent Event.
public struct ServerSentEvent: Sendable {
    public var event: String?
    public var id: String?
    public var data: String
}

extension API {
    /// The events at `path` as they arrive, until the server closes the stream. Blank lines end an
    /// event; comments (": ping") are skipped. Lines are split by hand, since AsyncLineSequence
    /// drops the blank lines events are separated by.
    func events(_ path: String, lastEventId: String? = nil) -> AsyncThrowingStream<ServerSentEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var req = try request(path)
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.timeoutInterval = 24 * 60 * 60
                    if let lastEventId { req.setValue(lastEventId, forHTTPHeaderField: "Last-Event-ID") }
                    let (bytes, response) = try await session.bytes(for: req)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard status == 200 else {
                        // A session that ended: the stream's answer says so as the API's would.
                        var said = Data()
                        if status == 401 { for try await byte in bytes { said.append(byte); if said.count > 4096 { break } } }
                        sessions.took(response, body: said, sent: Self.sent(req))
                        throw Failure(status: status, message: "botdot answered \(status)")
                    }
                    var line = [UInt8]()
                    var current = ServerSentEvent(data: "")
                    var hasData = false
                    func take(_ raw: [UInt8]) {
                        let text = String(decoding: raw, as: UTF8.self)
                        if text.isEmpty {
                            if hasData { continuation.yield(current) }
                            current = ServerSentEvent(data: "")
                            hasData = false
                            return
                        }
                        if text.hasPrefix(":") { return }
                        let parts = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                        let field = String(parts[0])
                        var value = parts.count > 1 ? String(parts[1]) : ""
                        if value.hasPrefix(" ") { value.removeFirst() }
                        switch field {
                        case "event": current.event = value
                        case "id": current.id = value
                        case "data":
                            current.data = hasData ? current.data + "\n" + value : value
                            hasData = true
                        default: break
                        }
                    }
                    for try await byte in bytes {
                        if byte == UInt8(ascii: "\n") {
                            if line.last == UInt8(ascii: "\r") { line.removeLast() }
                            take(line)
                            line.removeAll(keepingCapacity: true)
                        } else {
                            line.append(byte)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
