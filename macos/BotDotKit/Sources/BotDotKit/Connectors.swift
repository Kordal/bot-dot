import Foundation

/// Apps connected through Composio, and the marketplace of apps to connect (public/app.js renderConnectors).
public struct ConnectorsState: Decodable, Sendable {
    public struct AppInfo: Decodable, Hashable, Sendable {
        public var slug: String?
        public var name: String?
        public var logo: String?
    }

    public struct Connection: Decodable, Identifiable, Hashable, Sendable {
        public let id: String
        public var toolkit: String
        public var status: String
        public var statusReason: String?
        public var app: AppInfo?
        public var usedBy: [String]?

        public var name: String { app?.name ?? toolkit }

        /// "connected", "waiting for sign-in"… and whether it's a problem.
        public var statusText: (text: String, warn: Bool) {
            switch status {
            case "ACTIVE": ("connected", false)
            case "INITIATED", "INITIALIZING": ("waiting for sign-in", true)
            case "EXPIRED": ("expired, connect again", true)
            case "FAILED": ("failed", true)
            case "INACTIVE": ("switched off", true)
            default: (status.lowercased(), false)
            }
        }
    }

    public var configured: Bool?
    /// "botdot" (its own Composio account) or "own" (the owner's key).
    public var account: String?
    public var keyHint: String?
    public var claimInvite: String?
    public var error: String?
    public var connections: [Connection]

    public init(configured: Bool?, error: String?, connections: [Connection]) {
        self.configured = configured
        self.error = error
        self.connections = connections
    }
}

/// An app in the marketplace.
public struct CatalogApp: Decodable, Identifiable, Hashable, Sendable {
    public var slug: String
    public var name: String
    public var description: String?
    public var logo: String?
    public var toolsCount: Int?
    public var categories: [String]
    public var noAuth: Bool?
    /// "signin", "key" (asks for the app's API key) or "developer" (needs your own developer app).
    public var connect: String?

    public var id: String { slug }

    public var subtitle: String {
        (Array(categories.prefix(2)) + [toolsCount.map { "\($0) action\($0 == 1 ? "" : "s")" }].compactMap { $0 }).joined(separator: " · ")
    }
}

public struct CatalogPage: Decodable, Sendable {
    public var items: [CatalogApp]
    public var nextOffset: String?
    public var total: Int?

    enum CodingKeys: String, CodingKey { case items, nextOffset, total }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        items = try c.decode([CatalogApp].self, forKey: .items)
        total = try c.decodeIfPresent(Int.self, forKey: .total)
        // An offset can come as a number or a string.
        if let s = try? c.decodeIfPresent(String.self, forKey: .nextOffset) { nextOffset = s }
        else if let n = try? c.decodeIfPresent(Int.self, forKey: .nextOffset) { nextOffset = String(n) }
    }
}

public struct CatalogCategory: Decodable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var count: Int?
}

/// What connecting an app gives back: a sign-in page to open, or nothing to sign in to.
public struct ConnectStart: Decodable, Sendable {
    public var redirectUrl: String?
    public var connectionId: String?
    public var noAuth: Bool?
}

extension Store {
    public func connectors() async throws -> ConnectorsState {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("connectors")
    }

    public func catalog(search: String, category: String, offset: String? = nil) async throws -> CatalogPage {
        guard let api else { throw ConnectError(message: "Not connected.") }
        var q = URLComponents()
        q.queryItems = [search.isEmpty ? nil : URLQueryItem(name: "search", value: search),
                        category.isEmpty ? nil : URLQueryItem(name: "category", value: category),
                        offset.map { URLQueryItem(name: "offset", value: $0) }].compactMap { $0 }
        return try await api.get("connectors/catalog?\(q.percentEncodedQuery ?? "")")
    }

    public func catalogCategories() async -> [CatalogCategory] {
        guard let api else { return [] }
        return (try? await api.get("connectors/categories")) ?? []
    }

    public func connectApp(_ slug: String) async throws -> ConnectStart {
        guard let api else { throw ConnectError(message: "Not connected.") }
        struct Body: Encodable { let app: String }
        return try await api.send("connectors/connect", body: Body(app: slug))
    }

    public func connection(_ id: String) async throws -> ConnectorsState.Connection {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("connectors/connections/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }

    public func disconnect(_ id: String) async throws {
        guard let api else { return }
        try await api.send("connectors/connections/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)", method: "DELETE")
        try await loadBots()
    }

    /// Which bots may use an app.
    public func setAppBots(_ slug: String, _ bots: [String]) async throws {
        guard let api else { return }
        struct Body: Encodable { let bots: [String] }
        try await api.send("connectors/apps/\(slug)/bots", method: "PUT", body: Body(bots: bots))
        try await loadBots()
    }

    public func setComposioKey(_ key: String) async throws {
        guard let api else { return }
        struct Body: Encodable { let key: String }
        try await api.send("connectors/key", method: "PUT", body: Body(key: key))
    }

    public func removeComposioKey() async throws {
        guard let api else { return }
        try await api.send("connectors/key", method: "DELETE")
    }

    public func claimComposio(_ email: String) async throws {
        guard let api else { return }
        struct Body: Encodable { let email: String }
        try await api.send("connectors/claim", body: Body(email: email))
    }
}
