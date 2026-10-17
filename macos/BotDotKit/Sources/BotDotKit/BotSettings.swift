import Foundation

/// The models and reasoning levels to pick from, and the defaults (`GET /api/settings`).
public struct ServerSettings: Decodable, Sendable {
    public struct Values: Decodable, Sendable {
        public var defaultModel: String?
        public var defaultEffort: String?
        public var chiefModel: String?
        public var chiefEffort: String?
        public var chiefRules: String?
    }
    public struct Model: Decodable, Hashable, Sendable {
        public let id: String
        public var label: String
        public var group: String?
        public var note: String?
        /// false: it takes no reasoning level.
        public var effort: Bool?
    }
    public struct Effort: Decodable, Hashable, Sendable {
        public let id: String
        public var label: String
        public var note: String?
    }
    /// Where the model list came from: Anthropic's docs (checked when), or the built-in one.
    public struct Catalog: Decodable, Sendable {
        public var source: String?
        public var checkedAt: String?
        public var error: String?
    }
    public var settings: Values
    public var models: [Model]
    public var efforts: [Effort]
    public var catalog: Catalog?
}

/// A skill, as the Skills page and a bot's settings list them (`GET /api/skills`).
public struct SkillInfo: Decodable, Hashable, Sendable {
    public var name: String
    public var description: String?
    /// "bot:<id>" when a bot wrote it, "chief" when the Chief did.
    public var createdBy: String?
    public var usedBy: [String]?
    /// "created" (written here) or "github" (imported).
    public var source: String?
    public var sourceUrl: String?
    public var scripts: [String]?
    public var allowedTools: [String]?
    public var instructions: String?
    public var fileCount: Int?
    /// Where a skill on this computer comes from.
    public var origin: String?
}

public struct SkillLists: Decodable, Sendable {
    /// Your skills, which you give to bots.
    public var library: [SkillInfo]
    /// From your Claude account; every bot has them unless switched off.
    public var machine: [SkillInfo]
    /// Built into Claude Code; the same.
    public var builtin: [SkillInfo]?
}

/// The three simple switches under "What it may do", and the tools each adds.
public enum Permission: String, CaseIterable, Sendable {
    case files, web, bash
    public var label: String { ["files": "Can change files", "web": "Can browse the web", "bash": "Can run commands"][rawValue]! }
    public var hint: String { ["files": "create and edit files in its folder", "web": "search, and read web pages", "bash": "any shell command in its folder"][rawValue]! }
    public var tools: [String] { ["files": ["Edit", "Write"], "web": ["WebSearch", "WebFetch"], "bash": ["Bash"]][rawValue]! }
}

extension Store {
    /// Changes some of a bot's settings (the fields as the API names them); the bot as saved comes back.
    @discardableResult
    public func updateBot(_ id: String, _ changes: [String: Any]) async throws -> Bot {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let body = try JSONSerialization.data(withJSONObject: changes)
        let bot = try JSON.decoder.decode(Bot.self, from: try await api.sendJSON("bots/\(id)", method: "PUT", body: body))
        if let i = bots.firstIndex(where: { $0.id == id }) { bots[i] = bot }
        return bot
    }

    /// Deletes a bot, its memory, the skills only it wrote, and its computer. Its runs are kept.
    public func deleteBot(_ id: String) async throws -> String? {
        guard let api else { return nil }
        struct Deleted: Decodable { let computer: String? }
        let r: Deleted = try await api.send("bots/\(id)", method: "DELETE")
        try await loadBots()
        return r.computer
    }

    public func settings() async throws -> ServerSettings {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("settings")
    }

    public func skillLists() async throws -> SkillLists {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("skills")
    }

    /// Refreshes `skillLibrary`; on a failure the names already loaded stay.
    public func loadSkillLibrary() async {
        if let lists = try? await skillLists() { skillLibrary = lists.library.map(\.name) }
    }

    /// Whether Docker runs (bots' computers need it).
    public func dockerOK() async -> Bool {
        guard let api else { return false }
        struct Status: Decodable { struct Docker: Decodable { let ok: Bool? }; let docker: Docker? }
        return ((try? await api.get("status", as: Status.self))?.docker?.ok) ?? false
    }
}

/// An app connected through Composio, which bots can be given.
public struct ConnectedApp: Hashable, Sendable {
    public let slug: String
    public let name: String
    public init(slug: String, name: String) {
        self.slug = slug
        self.name = name
    }
}

extension Store {
    /// The apps connected and working now (a bot's settings offer them once there are any).
    public func connectedApps() async -> [ConnectedApp] {
        guard let api else { return [] }
        struct List: Decodable {
            struct Connection: Decodable {
                struct App: Decodable { let slug: String?; let name: String? }
                let status: String?
                let toolkit: String
                let app: App?
            }
            let configured: Bool?
            let connections: [Connection]?
        }
        guard let l: List = try? await api.get("connectors"), l.configured == true else { return [] }
        var seen = Set<String>()
        return (l.connections ?? []).filter { $0.status == "ACTIVE" && seen.insert($0.toolkit).inserted }
            .map { ConnectedApp(slug: $0.toolkit, name: $0.app?.name ?? $0.toolkit) }
    }
}
