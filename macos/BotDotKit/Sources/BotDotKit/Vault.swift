import Foundation

/// Something in the vault a bot may use: a login (the built-in vault, or Bitwarden's bot-dot folder),
/// or from Bitwarden also a payment card or an identity. Secrets never come back from the server.
public struct VaultItem: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var kind: String?
    public var site: String?
    public var username: String?
    public var allowedBots: [String]
    public var allowedHosts: [String]?
    public var insecureTls: Bool?
    public var hasTotp: Bool?
    public var reprompt: Bool?
    public var brand: String?
    public var last4: String?
    public var expiry: String?
    public var holder: String?
    public var email: String?

    public var isLogin: Bool { (kind ?? "login") == "login" }
}

/// Bitwarden as the Vault page shows it.
public struct BitwardenDetails: Decodable, Hashable, Sendable {
    public var installed: Bool?
    public var configured: Bool?
    public var unlocked: Bool?
    public var email: String?
    public var server: String?
    public var items: Int?
    public var lastSync: String?
    public var error: String?
}

extension Store {
    public func vault() async throws -> [VaultItem] {
        guard let api else { return [] }
        return try await api.get("vault")
    }

    public func bitwardenDetails() async throws -> BitwardenDetails {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("vault/bitwarden")
    }

    /// Adds a login (`id` nil) or changes one. An empty password keeps the saved one.
    public func saveVaultLogin(id: String?, name: String, site: String, username: String, password: String, insecureTls: Bool, bots: [String], allowedHosts: [String] = []) async throws {
        guard let api else { return }
        var body: [String: Any] = ["name": name, "site": site, "username": username, "insecureTls": insecureTls, "allowedBots": bots, "allowedHosts": allowedHosts]
        if !password.isEmpty { body["password"] = password }
        let data = try JSONSerialization.data(withJSONObject: body)
        _ = try await api.sendJSON(id.map { "vault/\($0)" } ?? "vault", method: id == nil ? "POST" : "PUT", body: data)
    }

    /// Which bots may use a card or an identity (their details are changed in Bitwarden).
    public func setVaultBots(_ id: String, _ bots: [String]) async throws {
        guard let api else { return }
        _ = try await api.sendJSON("vault/\(id)", method: "PUT", body: try JSONSerialization.data(withJSONObject: ["allowedBots": bots]))
    }

    public func deleteVaultItem(_ id: String) async throws {
        guard let api else { return }
        try await api.send("vault/\(id)", method: "DELETE")
    }

    /// Connects Bitwarden with its API key (server: "us", "eu" or "custom" with its address).
    public func setUpBitwarden(server: String, serverUrl: String, clientId: String, clientSecret: String) async throws {
        struct Setup: Encodable { let server: String; let serverUrl: String; let clientId: String; let clientSecret: String }
        guard let api else { return }
        try await api.send("vault/bitwarden/setup", body: Setup(server: server, serverUrl: serverUrl, clientId: clientId, clientSecret: clientSecret))
        await loadNeeds()
    }

    public func lockBitwarden() async throws {
        guard let api else { return }
        try await api.send("vault/bitwarden/lock")
        await loadNeeds()
    }

    public func syncBitwarden() async throws {
        guard let api else { return }
        try await api.send("vault/bitwarden/sync")
    }
}
