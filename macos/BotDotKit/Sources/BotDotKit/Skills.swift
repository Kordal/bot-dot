import Foundation

/// A skill from a link, fetched and shown before it's imported.
public struct SkillPreview: Decodable, Sendable {
    public let id: String
    public var name: String
    public var description: String?
    public var instructions: String?
    public var files: [File]
    public var totalBytes: Double?
    public var folder: String?
    public var exists: Bool?
    public var scripts: [String]
    public var allowedTools: [String]

    public struct File: Decodable, Sendable { public let path: String; public let size: Double? }
}

extension SkillInfo {
    /// Where a library skill came from: imported, or written by you, the Chief or a bot.
    @MainActor
    public func originText(_ bots: [Bot]) -> String {
        if source != "created" { return ["github": "From GitHub"][source ?? ""] ?? (source ?? "") }
        if createdBy == "chief" { return "Written by the Chief" }
        if let c = createdBy, c.hasPrefix("bot:") {
            return bots.first { $0.id == String(c.dropFirst(4)) }.map { "Written by \($0.name)" } ?? "Written by a bot"
        }
        return "Written here"
    }
}

extension Store {
    /// Every run, newest first (Activity), optionally one bot's.
    public func runs(bot: String? = nil, limit: Int = 200) async throws -> [RunSummary] {
        guard let api else { return [] }
        return try await api.get("runs?limit=\(limit)\(bot.map { "&botId=\($0)" } ?? "")")
    }

    /// A library skill in full (its instructions, too).
    public func skill(_ name: String) async throws -> SkillInfo {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("skills/\(name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name)")
    }

    /// Writes a new skill (`original` nil) or changes one, and gives it to these bots.
    @discardableResult
    public func saveSkill(original: String?, name: String, description: String, instructions: String, bots: [String]) async throws -> SkillInfo {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let body = try JSONSerialization.data(withJSONObject: ["name": name, "description": description, "instructions": instructions, "bots": bots])
        let path = original.map { "skills/\($0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? $0)" } ?? "skills"
        let saved = try JSON.decoder.decode(SkillInfo.self, from: try await api.sendJSON(path, method: original == nil ? "POST" : "PUT", body: body))
        try await loadBots()
        return saved
    }

    public func deleteSkill(_ name: String) async throws {
        guard let api else { return }
        try await api.send("skills/\(name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name)", method: "DELETE")
        try await loadBots()
    }

    /// Fetches a skill from skills.sh or a GitHub folder, to review before importing it.
    public func previewSkill(_ url: String) async throws -> SkillPreview {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let body = try JSONSerialization.data(withJSONObject: ["url": url])
        return try JSON.decoder.decode(SkillPreview.self, from: try await api.sendJSON("skills/import/preview", body: body))
    }

    @discardableResult
    public func importSkill(_ preview: SkillPreview, name: String, bots: [String]) async throws -> SkillInfo {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let body = try JSONSerialization.data(withJSONObject: ["id": preview.id, "name": name, "bots": bots])
        let saved = try JSON.decoder.decode(SkillInfo.self, from: try await api.sendJSON("skills/import/confirm", body: body))
        try await loadBots()
        return saved
    }
}
