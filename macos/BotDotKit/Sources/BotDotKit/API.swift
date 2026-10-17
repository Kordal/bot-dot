import Foundation

/// The botdot server's JSON API (docs/api.md): GETs, and writes with the `X-Bot-Dot: 1` header.
/// Errors come back in words that can be shown as they are. Behind a front door every request carries
/// this app's session (`sessions`, ADR 028).
public struct API: Sendable {
    public let base: URL
    public let sessions: Sessions
    let session: URLSession

    public init(base: URL, sessions: Sessions = Sessions(), session: URLSession = .shared) {
        self.base = base
        self.sessions = sessions
        self.session = session
    }

    public struct Failure: LocalizedError, Sendable {
        public let status: Int
        public let message: String
        /// The message is botdot's own sentence (`{ "error": "…" }`), not this app's words for a status.
        public var said = false
        public var errorDescription: String? { message }
    }

    func url(_ path: String) -> URL {
        URL(string: "api/" + path, relativeTo: base.appendingPathComponent("/"))!.absoluteURL
    }

    func request(_ path: String, method: String = "GET", body: (any Encodable)? = nil) throws -> URLRequest {
        try request(url: url(path), method: method, body: body)
    }

    /// A request to any address of this botdot server (the front door's own routes are outside /api/).
    func request(url: URL, method: String = "GET", body: (any Encodable)? = nil) throws -> URLRequest {
        guard ReleaseManifest.secureURL(base) else { throw Failure(status: 0, message: "Use HTTPS for a remote botdot server.") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if method != "GET" { req.setValue("1", forHTTPHeaderField: "X-Bot-Dot") }
        sessions.authorize(&req)
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return req
    }

    /// The session's secret a request carries.
    static func sent(_ req: URLRequest) -> String? {
        req.value(forHTTPHeaderField: "Cookie").map { String($0.dropFirst(Sessions.cookie.count + 1)) }
    }

    /// Sends a request, and notes what came back for the session (a new one, a cleared one, one that ended).
    func load(_ req: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await session.data(for: req, delegate: RejectUpdateRedirects())
        sessions.took(response, body: data, sent: Self.sent(req))
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    static func failure(_ status: Int, _ data: Data) -> Failure {
        struct ErrorBody: Decodable { let error: String }
        let said = try? JSON.decoder.decode(ErrorBody.self, from: data).error
        return Failure(status: status, message: said ?? "botdot answered \(status)", said: said != nil)
    }

    public func data(_ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> Data {
        let (data, status) = try await load(try request(path, method: method, body: body))
        guard (200..<300).contains(status) else { throw Self.failure(status, data) }
        return data
    }

    public func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try JSON.decoder.decode(T.self, from: try await data(path))
    }

    @discardableResult
    public func send<T: Decodable>(_ path: String, method: String = "POST", body: (any Encodable)? = nil, as type: T.Type = T.self) async throws -> T {
        try JSON.decoder.decode(T.self, from: try await data(path, method: method, body: body))
    }

    public func send(_ path: String, method: String = "POST", body: (any Encodable)? = nil) async throws {
        _ = try await data(path, method: method, body: body)
    }

    /// A write whose body is loose JSON (fields that differ from call to call).
    public func sendJSON(_ path: String, method: String = "POST", body: Data) async throws -> Data {
        var req = try request(path, method: method)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, status) = try await load(req)
        guard (200..<300).contains(status) else { throw Self.failure(status, data) }
        return data
    }

    /// A write to one of the front door's own routes (`sign-in/handoff`, `sign-out-everywhere`).
    func frontDoor(_ path: String, body: (any Encodable)? = nil) async throws -> Data {
        let (data, status) = try await load(try request(url: URL(string: path, relativeTo: base.appendingPathComponent("/"))!.absoluteURL, method: "POST", body: body))
        guard (200..<300).contains(status) else { throw Self.failure(status, data) }
        return data
    }
}

/// The one JSON decoder for the botdot server's answers.
enum JSON {
    static let decoder = JSONDecoder()
}
