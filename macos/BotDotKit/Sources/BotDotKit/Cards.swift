import Foundation

/// What a card says of the work around the owner's yes (docs/api.md, "What follows a yes", "A changed
/// bot" and "An action in a connected app"): who carries on, what a changed bot changes, and what an
/// action in a connected app sends. The server words all of it and the app draws it as it comes; the
/// app's own words here are the Android app's. Reading any of it never fails: a field this app can't
/// read costs that field, and the card is the one it was before.

/// A feature the app asks the server's `features` for before it uses it (`Store.has`).
public enum Feature: String, Sendable {
    /// The server says who carries on after a yes, and what a changed bot changes.
    case askContinues = "ask-continues"
    /// A suggested tile says who carries on after a yes, and its answer what the yes started.
    case proposalCarriesOn = "proposal-carries-on"
    /// An action in a connected app waits for the answer inside its run, and its card has rows.
    case connectorWaits = "connector-waits"
    /// The server writes the line of a chip under a reply (`chip` of what a run learned).
    case memoryChips = "memory-chips"
    /// The server writes the words of a waiting memory change's card, and lists the guarded ones.
    case memoryCards = "memory-cards"
    /// A forget erases for good, and one that waits is a card ("Forget for good").
    case memoryForget = "memory-forget"
    /// The no on a job or tile that was never approved reads the server's words, and so does its card afterwards.
    case declineWords = "decline-words"
    /// A change to an approved job or tile waits beside it, as a card of its own.
    case stagedChanges = "staged-changes"
    /// A change that waits can say what it changes, in one sentence of whoever proposed it.
    case changeSummary = "change-summary"
    /// The server says which bot asks the owner something.
    case asksYou = "asks-you"
    /// The server says what a working bot's line reads, and changes it as the run goes on (see OpeningLine.swift).
    case workingLine = "working-line"
    /// Groups: one chat with several bots (see Groups.swift).
    case groups
    /// The Chief's checkup: its two switches in the Chief's settings (see Checkup.swift).
    case checkup
    /// The server takes a message's key once (see Outbox.swift).
    case messageKey = "message-key"
    /// The owner's message to a working bot or a replying Chief waits its turn (see Busy.swift).
    case messageWaits = "message-waits"
    /// A run keeps who ended it, and its sentence says so (see Busy.swift).
    case endedBy = "ended-by"
    /// The server writes the line under a job, and says when "Run now" started nothing (see Jobs.swift).
    case jobLine = "job-line"
    /// The feed says what every notification reads, and that the yes of a script job is given on its card.
    case needsText = "needs-text"
}

/// What a yes on a card would start (`then`): the server's sentence, shown on the card as it is.
/// `chatId` and `here` when the Chief carries on: the Chief chat it does so in, and the sentence for a
/// card drawn in that chat. One without a sentence says nothing (`line` is nil).
public struct Then: Codable, Hashable, Sendable {
    public var text: String
    public var chatId: String?
    public var here: String?

    public init(text: String, chatId: String? = nil, here: String? = nil) {
        self.text = text
        self.chatId = chatId
        self.here = here
    }

    public init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        func said(_ key: CodingKeys) -> String? { (c.flatMap { try? $0.decodeIfPresent(Loose.self, forKey: key) })?.words }
        text = said(.text) ?? ""
        chatId = said(.chatId)
        here = said(.here)
    }

    /// The card's line: `here` on a card that stands in the Chief chat it speaks of, `text` everywhere else.
    public func line(chiefChat: String? = nil) -> String? {
        if let here, let chatId, chatId == chiefChat { return here }
        return text.isEmpty ? nil : text
    }
}

/// What the owner's yes started (`carriesOn` in its answer): the server's words, printed after the
/// app's own word for the answer ("Allowed · it carries on").
public struct CarriesOn: Decodable, Hashable, Sendable {
    public let text: String

    public init(text: String) { self.text = text }

    enum CodingKeys: String, CodingKey { case text }
    public init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        text = (c.flatMap { try? $0.decodeIfPresent(Loose.self, forKey: .text) })?.words ?? ""
    }
}

/// What the server answers to a yes or a no on a card, as far as this app reads it: what a yes
/// started, and its own words for the answered card (`text`: "Forgotten", "Kept", "Declined and
/// removed", "Changed: Daily at 07:00", "Kept as it was: Daily at 08:00"). None of it from a server that
/// says none, and from an answer this app can't read: the answer still went.
public struct Answered: Decodable, Hashable, Sendable {
    public var carriesOn: CarriesOn?
    public var text: String?

    public init(carriesOn: CarriesOn? = nil, text: String? = nil) {
        self.carriesOn = carriesOn
        self.text = text
    }

    enum CodingKeys: String, CodingKey { case carriesOn, text }
    public init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        let said = c.flatMap { try? $0.decodeIfPresent(CarriesOn.self, forKey: .carriesOn) }
        carriesOn = said.flatMap { $0.text.isEmpty ? nil : $0 }
        text = (c.flatMap { try? $0.decodeIfPresent(Loose.self, forKey: .text) })?.words
    }

    static func of(_ answer: Data) -> Answered { (try? JSON.decoder.decode(Answered.self, from: answer)) ?? Answered() }
}

/// One changed field of a bot change (`parts`): a text has what it `was` and what it is `now`;
/// anything else has no `was`.
public struct ChangedPart: Hashable, Sendable {
    public let label: String
    public let was: String?
    public let now: String

    public init(label: String, was: String? = nil, now: String) {
        self.label = label
        self.was = was
        self.now = now
    }

    /// The parts as the card draws them, in the server's order: a changed text by itself, and the
    /// parts that are no text together while they follow one another, as the rows of one box.
    public static func groups(_ parts: [ChangedPart]) -> [[ChangedPart]] {
        var groups: [[ChangedPart]] = []
        for part in parts {
            if part.was == nil, let last = groups.last, last.last?.was == nil { groups[groups.count - 1].append(part) } else { groups.append([part]) }
        }
        return groups
    }
}

/// What a bot change changes, one entry per field. All of them or none: with one entry this app
/// cannot read the card would show less than the yes approves, so it shows `details`. An entry is read
/// when it has a label, what the field becomes as text, and what it was either left out or as text.
public struct ChangedParts: Decodable, Hashable, Sendable {
    public let list: [ChangedPart]

    public init(from decoder: Decoder) throws {
        struct Entry: Decodable {
            var part: ChangedPart?
            enum Keys: String, CodingKey { case label, was, now }
            init(from decoder: Decoder) throws {
                guard let c = try? decoder.container(keyedBy: Keys.self) else { return }
                func read(_ key: Keys) -> Loose { (try? c.decodeIfPresent(Loose.self, forKey: key)) ?? .null }
                guard let label = read(.label).words, let now = read(.now).said else { return }
                switch read(.was) {
                case .null: part = ChangedPart(label: label, now: now)
                case .string(let was): part = ChangedPart(label: label, was: was, now: now)
                default: break
                }
            }
        }
        list = whole(decoder, Entry.self)?.map(\.part).allOrNone() ?? []
    }
}

/// What an action in a connected app sends, as rows of a label and its value. All of them or none, as
/// `ChangedParts`: a row is read when it has a label and a value that is text (also empty: an email
/// without a subject) or a number. `cut`: a row was clipped (`more: true` on it, as the feed's short
/// form marks it), so its value is less than the action sends. No row of `GET /api/asks` is clipped.
public struct CardRows: Decodable, Hashable, Sendable {
    public let rows: [Ask.Fact]
    public let cut: Bool

    public init(from decoder: Decoder) throws {
        struct Entry: Decodable {
            var row: Ask.Fact?
            var more = false
            enum Keys: String, CodingKey { case label, value, more }
            init(from decoder: Decoder) throws {
                guard let c = try? decoder.container(keyedBy: Keys.self) else { return }
                func read(_ key: Keys) -> Loose { (try? c.decodeIfPresent(Loose.self, forKey: key)) ?? .null }
                more = (try? c.decodeIfPresent(CardFlag.self, forKey: .more))?.value == true
                guard let label = read(.label).said, !label.isEmpty, let value = read(.value).said else { return }
                row = Ask.Fact(label: label, value: value)
            }
        }
        let entries = whole(decoder, Entry.self) ?? []
        rows = entries.map(\.row).allOrNone() ?? []
        cut = entries.contains(where: \.more)
    }
}

/// A yes or a no of a card as the server sent it: `true` or `false`, and nothing (nil) for anything
/// else, a "true" in quotes too.
public struct CardFlag: Decodable, Hashable, Sendable {
    public let value: Bool?

    public init(from decoder: Decoder) throws {
        value = try? decoder.singleValueContainer().decode(Bool.self)
    }
}

extension CardText {
    /// Its text when it says something; nil for none.
    var words: String? { text.isEmpty ? nil : text }
}

/// A value of a card as it came, for the fields where it matters what kind it is.
private enum Loose: Decodable {
    case string(String), number(String), null, other

    init(from decoder: Decoder) throws {
        guard let c = try? decoder.singleValueContainer() else { self = .other; return }
        if c.decodeNil() {
            self = .null
        } else if let s = try? c.decode(String.self) {
            self = .string(s.trimmingCharacters(in: .whitespacesAndNewlines))
        } else if (try? c.decode(Bool.self)) != nil {
            self = .other
        } else if let n = try? c.decode(Int.self) {
            self = .number(String(n))
        } else if let n = try? c.decode(Double.self), n.isFinite {
            self = .number(String(n))
        } else {
            self = .other
        }
    }

    /// What a card can show: text, also empty, or a number as it is written.
    var said: String? {
        switch self {
        case .string(let s), .number(let s): s
        default: nil
        }
    }

    /// Text that says something: a string that is not empty.
    var words: String? {
        if case .string(let s) = self { return s.words }
        return nil
    }
}

/// Every entry of a list, each read by a type whose reading never fails. nil when it is no list.
private func whole<T: Decodable>(_ decoder: Decoder, _ type: T.Type) -> [T]? {
    guard var list = try? decoder.unkeyedContainer() else { return nil }
    var out: [T] = []
    while !list.isAtEnd, let entry = try? list.decode(T.self) { out.append(entry) }
    return list.isAtEnd ? out : nil
}

private extension Array {
    /// The entries when every one of them was read, nil when one was not.
    func allOrNone<T>() -> [T]? where Element == T? {
        let read = compactMap { $0 }
        return read.count == count ? read : nil
    }
}

extension NeedItem {
    /// The rows a card draws: every row once it is open, the first `closedRows` while it is closed.
    public func shownRows(open: Bool) -> [Ask.Fact] { open ? rows : Array(rows.prefix(Self.closedRows)) }

    /// Whether a click on a yes of the card ("Allow once", "Always allow this action") answers it: only
    /// where the card draws every row the yes approves. On a closed card that has more rows than it
    /// draws, the click opens the card instead, and the yes answers when it is clicked again.
    public func yesAnswers(open: Bool) -> Bool { open || rows.count <= Self.closedRows }
}

/// The line under the title of an action in a connected app: that the bot waits for the answer inside
/// its run (`held`), or when it stopped waiting (`stoppedAt`). nil when the server says neither, or a
/// time this app cannot read: the card keeps the line it has today.
public enum ConnectorCard {
    /// The line of a card whose action is too long to show in full, as the web page says it.
    public static let tooLong = "Too long to show in full."

    public static func state(bot: String, held: Bool?, stoppedAt: String?, time: (String) -> String = { Format.messageTime($0) }) -> String? {
        if held == true { return "\(bot) waits for your answer" }
        guard held == false, let stoppedAt else { return nil }
        let at = time(stoppedAt)
        return at.isEmpty ? nil : "\(bot) stopped waiting at \(at)"
    }
}
