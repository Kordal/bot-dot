import Foundation

/// A bot's own computer, as `GET /api/bots/:id/computer` describes it.
public struct ComputerDetails: Decodable, Sendable {
    /// "running", "stopped", "starting" or "none".
    public var state: String
    /// A newer desktop exists; this one keeps what's installed on it.
    public var outdated: Bool?
    public var diskBytes: Double?
}

extension Store {
    public func computer(_ botId: String) async throws -> ComputerDetails {
        guard let api else { throw ConnectError(message: "Not connected.") }
        return try await api.get("bots/\(botId)/computer")
    }

    /// Turns it on or off, or erases it ("start", "stop", "reset").
    @discardableResult
    public func computer(_ botId: String, _ action: String) async throws -> ComputerDetails {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let body = try JSONSerialization.data(withJSONObject: ["action": action])
        return try JSON.decoder.decode(ComputerDetails.self, from: try await api.sendJSON("bots/\(botId)/computer", body: body))
    }

    /// The live screen (botdot's own noVNC page): watching, or with control of mouse and keyboard.
    public func screenURL(_ botId: String, control: Bool) -> URL? {
        guard let api else { return nil }
        let id = botId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? botId
        let path = "computer/\(botId)/websockify".addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return URL(string: "computer/\(id)/vnc.html?autoconnect=1&reconnect=1&resize=scale&show_dot=1&view_only=\(control ? 0 : 1)&path=\(path)", relativeTo: api.base.appendingPathComponent("/"))?.absoluteURL
    }
}
