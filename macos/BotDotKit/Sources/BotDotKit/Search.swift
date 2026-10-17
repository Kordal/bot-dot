import Foundation

/// A message that matches the search box, and where to open it (`GET /api/search`): a bot's run, a
/// message in a Chief chat, or a member's reply in a group's chat.
public struct SearchHit: Decodable, Hashable, Sendable {
    public var at: String?
    /// The words around the match, the matched ones in «…».
    public var snippet: String?
    public var runId: String?
    public var bot: Who?
    /// For a message between bots: who sent it.
    public var fromBot: Who?
    public var chatId: String?
    /// The message's place in that Chief chat.
    public var index: Int?
    public var title: String?
    /// The group whose chat the reply is in: it opens there, not in its bot's own chat.
    public var group: InGroup?

    public struct InGroup: Decodable, Hashable, Sendable {
        public var id: String
        public var name: String?
    }

    /// The words to mark in the open chat: each word of at least two letters (a word it starts
    /// counts too, "haiku" marks "haikus").
    public static func terms(_ query: String) -> [String] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard q.count >= 2 else { return [] }
        var seen = Set<String>()
        return q.split { !$0.isLetter && !$0.isNumber }.map(String.init).filter { $0.count > 1 && seen.insert($0).inserted }
    }
}

extension Store {
    /// Messages in every chat with all these words (the last may be half typed). Nothing for less than
    /// two letters.
    public func search(_ query: String) async throws -> [SearchHit] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let api, q.count >= 2 else { return [] }
        // The turns in the groups too, from a server that has groups: without `groups=1` none is a match.
        return try await api.get("search?q=\(q.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? q)\(has(.groups) ? "&groups=1" : "")")
    }
}
