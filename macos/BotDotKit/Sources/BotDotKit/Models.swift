import Foundation

/// `GET /api/version`.
public struct Version: Decodable, Sendable {
    public let app: String
    public let version: String?
    public let revision: String?
    public let apiVersion: Int?
    public let features: [String]?
    /// A front door answered, not a botdot server: this app has no session there yet (ADR 028).
    public var frontDoor: Bool? = nil
}

/// A bot as `GET /api/bots` lists it. `state` is what its face shows.
public struct Bot: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var color: String?
    public var description: String?
    public var group: String?
    public var pinned: Int?
    public var order: Int?
    public var running: Bool?
    public var state: String?
    /// What it asks the owner, until the owner writes to it (docs/api.md "A bot that asks"). See Asks.swift.
    public var asks: BotAsks?
    /// Its hat; `nil` for a bot that was never given an outfit, and from a server without `outfits`:
    /// a head without a hat.
    public var outfit: Outfit?
    public var computer: String?
    /// Its usual task.
    public var prompt: String?
    public var jobs: [Job]?
    public var nextRunAt: String?
    // Its settings (a bot's settings page).
    /// Personality / rules, added to Claude Code's system prompt.
    public var systemPrompt: String?
    public var allowedTools: [String]?
    public var permissionMode: String?
    public var model: String?
    public var effort: String?
    public var computerEgress: String?
    public var computerAlwaysOn: Bool?
    /// "all", "memory" (its notes only) or "off".
    public var learning: String?
    public var useSkills: Bool?
    public var skills: [String]?
    public var disabledSkills: [String]?
    public var connectors: [String]?
    public var mayMessageAll: Bool?
    public var mayMessage: [String]?
    /// How many new replies its chat has, and the run that is the first of them (ADR 005). Missing from
    /// a server without `unread`: nothing is new.
    public var unread: Int?
    public var firstUnread: String?
    /// The owner's messages that wait for it, from a server with `message-waits`: read them with
    /// `Store.waiting(in:)`.
    public var queued: QueuedList?
}

/// A run, as `GET /api/runs` and the live feed give it: the task the bot was given, and its reply.
public struct RunSummary: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public let botId: String?
    public var botName: String?
    public var botColor: String?
    /// "ai" or "script".
    public var kind: String?
    /// "manual", "schedule", "bot", "replies", …
    public var trigger: String?
    public var status: String?
    public var startedAt: String?
    public var endedAt: String?
    public var durationMs: Double?
    public var prompt: String?
    /// false when it ran its usual task.
    public var customPrompt: Bool?
    /// The earlier run it carries on after the owner's OK (`ask-continues`).
    public var continues: String?
    public var jobId: String?
    public var jobName: String?
    public var parentRunId: String?
    public var result: String?
    public var error: String?
    /// What went wrong, in words, when the server already put it so.
    public var problem: String?
    /// Who ended it, from a server with `ended-by`: "owner", "chief", "signout" or "limit". None for a
    /// run that ended by itself.
    public var endedBy: String?
    /// When the owner sent it, in the answer of a send to a busy bot (`isQueued`).
    public var queuedAt: String?
    /// Quick answers for a question at the end of the reply.
    public var choices: [String]?
    /// Several questions at once: a card with a box under each.
    public var questions: [String]?
    /// Its reply asks the owner something: what its notification is titled ("Mail Sorter asks") and
    /// the question in one line (docs/api.md "A bot that asks").
    public var asks: CardFlag?
    public var title: CardText?
    public var question: CardText?
    /// The bot whose message started this run.
    public var fromBot: Who?
    /// "chief" when the Chief of Staff handed it this task.
    public var startedBy: String?
    /// The teammates it messaged, each once, with what it last sent them.
    public var sentToAll: [Who]?
    public var sentTo: Who?
    public var project: String?
    public var model: String?
    public var modelUsed: String?
    public var effort: String?
    public var numTurns: Int?
    public var sessionId: String?
    public var exitCode: Int?
    /// What it's doing before its first step ("Starting its computer").
    public var phase: String?
    /// What it said it is about to do, while it runs (see OpeningLine.swift). Missing from a run that
    /// wrote none, from one that ended, and from a server without `opening-line`.
    public var openingLine: String?
    /// What its line reads now, while it runs, from a server with `working-line` (see OpeningLine.swift).
    /// Missing from a run that has no line yet, and from one that ended.
    public var workingLine: String?
    /// What it waits for while it runs: "ok", the owner's answer on an action in a connected app
    /// (docs/api.md "An action in a connected app"). Gone when the wait ends.
    public var waitingFor: CardText?
    /// It runs with its own computer.
    public var computer: Bool?
    /// Notes teammates left that it read at its start.
    public var inbox: [Note]?
    /// What it learned or changed in itself during the run ("🧠 Remembered …"; see Memory.swift).
    public var learned: [Learned]?
    /// The files that came with the task, and the ones it gave you with its reply.
    public var attachments: [FileRef]?
    public var files: [FileRef]?

    public var isRunning: Bool { status == "running" }
    /// It is going on and waits for the owner's OK.
    public var waitsForOk: Bool { isRunning && waitingFor?.text == "ok" }
    /// The answer of a send to a busy bot (`message-waits`): no run yet, the message waits its turn.
    public var isQueued: Bool { status == "queued" }
    public var failed: Bool { ["error", "stopped", "interrupted"].contains(status ?? "") }
}

/// A Chief of Staff chat in the list (`GET /api/chief`).
public struct ChiefChatSummary: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public var title: String?
    public var updatedAt: String?
    public var preview: String?
    /// A bot's plan in this chat, waiting for the owner's answer.
    public var waiting: Waiting?
    /// How many new replies it has, and the place of the first of them in its messages (ADR 005).
    public var unread: Int?
    public var firstUnread: Int?
    /// The Chief's opening line, while it replies in this chat (see OpeningLine.swift).
    public var openingLine: String?
    public struct Waiting: Decodable, Hashable, Sendable {
        public var from: Who?
        public var text: String?
    }
}

/// What the Chief of Staff did in a reply ("Created News").
public struct ChiefAction: Decodable, Hashable, Sendable {
    public var kind: String?
    public var text: String?
    public var botId: String?
    public var runId: String?
    /// What it still waits for ("waits for your OK"), printed after the text.
    public var waits: String?

    public init(kind: String? = nil, text: String? = nil, botId: String? = nil, runId: String? = nil, waits: String? = nil) {
        self.kind = kind; self.text = text; self.botId = botId; self.runId = runId; self.waits = waits
    }

    /// The chip's words, as the web page and the Android app print them: the kind's mark, the
    /// server's text, and what it waits for. A kind without a mark (a memory note, a group, one this
    /// app doesn't know) is the text alone.
    public var label: String {
        let icon = ["created": "✨", "updated": "✏️", "run": "→", "deleted": "🗑", "stopped": "■", "skill": "✦", "job": "⏰", "from": "↩"][kind ?? ""]
        let waits = waits?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return (icon.map { "\($0) " } ?? "") + (text ?? "") + (waits.isEmpty ? "" : " · \(waits)")
    }
}

/// Someone named in a message: a bot, or the Chief.
public struct Who: Decodable, Hashable, Sendable {
    public var id: String?
    public var name: String?
    public var color: String?
    /// What it sent, where that's part of it (a run's `sentToAll`).
    public var text: String?
    /// How a message reached it: "started", "queued" or "inbox…".
    public var delivered: String?

    /// The Chief of Staff, where it's the one who wrote.
    public static let chief = Who(id: "chief", name: "Chief of Staff", color: "#d85a30")

    /// A bot, where it is named like anyone who wrote.
    public init(_ bot: Bot) { self.init(id: bot.id, name: bot.name, color: bot.color) }

    public init(id: String?, name: String?, color: String?, text: String? = nil, delivered: String? = nil) {
        self.id = id
        self.name = name
        self.color = color
        self.text = text
        self.delivered = delivered
    }
}

/// A small mark: a colour (0xRRGGBB) and the outfit whose hat it wears.
public struct BotMark: Hashable, Sendable {
    public var rgb: UInt32
    public var outfit: Outfit?

    public init(rgb: UInt32, outfit: Outfit? = nil) {
        self.rgb = rgb
        self.outfit = outfit
    }
}

/// Current server-authored status of a pending Chief reply.
public struct ChiefMessageActivity: Decodable, Hashable, Sendable {
    public var tool: String?
    public var text: String?
}

/// One message in a Chief chat.
public struct ChiefMessage: Decodable, Hashable, Sendable {
    public var activity: ChiefMessageActivity?
    public var role: String
    public var text: String?
    /// Why the Chief's own reply failed, in words. The server sends `error` as text there, and as
    /// `true` in a bot's report that didn't finish, whose text says why: that is `failed` only.
    public var error: String?
    /// It didn't finish: `error` came as text or as `true`.
    public var failed = false
    /// The Chief wrote it without being asked (docs/api.md "The Chief writes first").
    public var unasked: Bool?
    /// The owner's 👍 or 👎 on an unasked message: "up", "down", or nil.
    public var rating: String?
    /// A checkup wrote it (see Checkup.swift): a reply with answer buttons, never rated.
    public var checkup: Bool?
    public var pending: Bool?
    public var at: String?
    public var endedAt: String?
    public var actions: [ChiefAction]?
    public var choices: [String]?
    public var questions: [String]?
    public var from: Who?
    public var status: String?
    /// Files you sent with it; files a bot gave you with it.
    public var attachments: [FileRef]?
    public var files: [FileRef]?
}

extension ChiefMessage {
    enum CodingKeys: String, CodingKey {
        case activity, role, text, error, unasked, rating, checkup, pending, at, endedAt, actions, choices, questions, from, status, attachments, files
    }

    // In an extension, so the memberwise init stays.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        activity = try c.decodeIfPresent(ChiefMessageActivity.self, forKey: .activity)
        role = try c.decode(String.self, forKey: .role)
        text = try c.decodeIfPresent(String.self, forKey: .text)
        if let words = try? c.decodeIfPresent(String.self, forKey: .error) {
            error = words
            failed = true
        } else {
            failed = (try? c.decodeIfPresent(Bool.self, forKey: .error)) == true
        }
        unasked = try c.decodeIfPresent(Bool.self, forKey: .unasked)
        rating = Ratings.value(try? c.decodeIfPresent(String.self, forKey: .rating))
        checkup = try? c.decodeIfPresent(Bool.self, forKey: .checkup)
        pending = try c.decodeIfPresent(Bool.self, forKey: .pending)
        at = try c.decodeIfPresent(String.self, forKey: .at)
        endedAt = try c.decodeIfPresent(String.self, forKey: .endedAt)
        actions = try c.decodeIfPresent([ChiefAction].self, forKey: .actions)
        choices = try c.decodeIfPresent([String].self, forKey: .choices)
        questions = try c.decodeIfPresent([String].self, forKey: .questions)
        from = try c.decodeIfPresent(Who.self, forKey: .from)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        attachments = try c.decodeIfPresent([FileRef].self, forKey: .attachments)
        files = try c.decodeIfPresent([FileRef].self, forKey: .files)
    }
}

/// A whole Chief chat (`GET /api/chief/chats/:id`).
public struct ChiefChat: Decodable, Sendable {
    public let id: String
    public var title: String?
    public var messages: [ChiefMessage]
    /// The place of the first of `messages` in the whole chat (from a server that can send part of it).
    public var offset: Int?
    public var busy: Bool?
    /// The Chief's opening line, while it replies in this chat (see OpeningLine.swift).
    public var openingLine: String?
    /// The owner's messages that wait for the reply to end, from a server with `message-waits`.
    public var queued: QueuedList?
}

/// A note a teammate left for a bot: waiting in its inbox, or read by one of its runs.
public struct Note: Decodable, Hashable, Sendable {
    public var fromId: String?
    public var from: String?
    public var color: String?
    public var text: String?
    public var at: String?
    public var who: Who { Who(id: fromId, name: from, color: color) }
}

/// The card of questions under a reply (see lib/choices.js on the botdot server).
public enum Questions {
    /// The one message that answers them: each question, then "→" and its answer ("–" when left empty).
    public static func answer(_ questions: [String], _ answers: [String]) -> String {
        questions.enumerated().map { i, q in
            let a = (i < answers.count ? answers[i] : "").trimmingCharacters(in: .whitespacesAndNewlines)
            return "\(q)\n→ \(a.isEmpty ? "–" : a)"
        }.joined(separator: "\n\n")
    }
}
