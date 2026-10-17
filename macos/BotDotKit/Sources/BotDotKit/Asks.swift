import Foundation

/// A bot that asks (docs/api.md, "A bot that asks"). The botdot server says which bot asks the owner
/// something: the bot carries the open question, the feed says each change, and the run whose reply
/// asks says how its notification reads. The app draws what the server says and works none of it out;
/// against a server without `asks-you` nothing here is used, and the list and the notifications are
/// as before.

/// A bot's open question to the owner (`asks` on a bot): `text` in one line, and the run that asked.
/// Reading it never fails: one this app can't read has no text, and is no question.
public struct BotAsks: Decodable, Hashable, Sendable {
    public let text: String
    public let runId: String?
    public let at: String?

    enum CodingKeys: String, CodingKey { case text, runId, at }

    public init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        func said(_ key: CodingKeys) -> String? { (c.flatMap { try? $0.decodeIfPresent(String.self, forKey: key) })?.trimmingCharacters(in: .whitespacesAndNewlines) }
        text = said(.text) ?? ""
        runId = said(.runId)
        at = said(.at)
    }
}

extension Store {
    /// What a bot's row says of its open question: "Asks: <question>", in one line of plain text. nil
    /// when it asks nothing, the server does not say (`asks-you`), or it is working: the row then says
    /// what it does. `lastRun`: its latest run.
    public func asksLine(_ bot: Bot, lastRun: RunSummary? = nil) -> String? {
        guard has(.asksYou), let text = bot.asks?.text, !text.isEmpty, bot.running != true, lastRun?.isRunning != true else { return nil }
        return "Asks: \(Format.plain(text).prefix(120))"
    }

    /// The feed's `asks` event about one bot's question (`{ botId, asks }`, `asks` null when it ends):
    /// that bot's row says so at once. The event of the same name about what waits in Needs you
    /// (`{ waiting, list }`) names no bot and changes nothing here.
    func heardBotAsks(_ data: Data) {
        struct Event: Decodable {
            var botId: String?
            var asks: BotAsks?
            var said = false
            enum Keys: String, CodingKey { case botId, asks }
            init(from decoder: Decoder) throws {
                guard let c = try? decoder.container(keyedBy: Keys.self) else { return }
                botId = try? c.decodeIfPresent(String.self, forKey: .botId)
                said = c.contains(.asks)
                let question = (try? c.decodeIfPresent(BotAsks.self, forKey: .asks)) ?? nil
                asks = question.flatMap { $0.text.isEmpty ? nil : $0 }
            }
        }
        guard let ev = try? JSON.decoder.decode(Event.self, from: data), ev.said, let id = ev.botId, let i = bots.firstIndex(where: { $0.id == id }) else { return }
        if bots[i].asks != ev.asks { bots[i].asks = ev.asks }
    }
}

/// What stands under a reply's bubble, in a bot's chat and in a group's alike: what it learned, a
/// chip each, and the answers of the reply that asks the owner something: its quick answers, or its
/// card of questions.
public struct UnderReply: Hashable, Sendable {
    public var chips: [LearnedChip] = []
    public var choices: [String] = []
    public var questions: [String] = []
}

extension Store {
    /// What stands under the reply of `run`. `answers`: it is the reply whose answers are open: the
    /// newest in a bot's chat, the group's open question in a group's, until the owner answered. A
    /// run that did not finish asks nothing.
    public func under(_ run: RunSummary, answers: Bool) -> UnderReply {
        let asks = answers && !run.failed
        return UnderReply(chips: chips(of: run), choices: asks ? run.choices ?? [] : [], questions: asks ? run.questions ?? [] : [])
    }
}

extension ReplyNotifications {
    /// The notification of a reply that holds a question for the owner (`asks: true` on the run): the
    /// server's `title` ("Mail Sorter asks"), or "<bot> asks" where it sends none, and the `question`
    /// in the server's one line: a long reply asks at its end, and its first words need not hold the
    /// question. Without a `question` the body is the reply's, as before. Any other run, and one
    /// that carries neither, notifies as a reply does.
    static func asking(_ reply: ReplyNotification, asks: Bool, title: String?, question: String?, botName: String?, result: String?) -> ReplyNotification {
        guard asks, let body = question?.words ?? (result?.words == nil ? nil : result) else { return reply }
        return ReplyNotification(chat: reply.chat, id: reply.id, title: title?.words ?? "\(botName ?? "A bot") asks", body: body)
    }
}
