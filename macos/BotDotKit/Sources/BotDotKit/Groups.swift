import Foundation

/// Groups (Milestone 10; docs/api.md, "Groups"). A group is one chat with two to six bots, its
/// members: the owner writes once, the botdot server gives the turns, and every reply stands under
/// its bot's name. The app draws what the server says and decides nothing. Against a server without
/// `groups` in `features` there are no groups and nothing here is asked. The rules and the words are
/// the Android app's (data/Groups.kt, ui/GroupWords.kt).
public enum Groups {
    /// How many of a group's newest items its chat reads at once.
    static let page = 50

    /// A group has two to six bots; the server refuses anything else in its own words.
    public static let most = 6

    /// The bots that can be added to a group: those that are not in it. None when it is full.
    public static func addable(_ group: BotGroup, _ bots: [Bot]) -> [Bot] {
        group.members.count >= most ? [] : bots.filter { !group.members.contains($0.id) }
    }

    /// The bots that can join `bot` in a new group, as its picker lists them: its category's first, then A to Z.
    public static func toJoin(_ bot: Bot, _ bots: [Bot]) -> [Bot] {
        bots.filter { $0.id != bot.id }.sorted { a, b in
            let ca = (a.group ?? "") != (bot.group ?? ""), cb = (b.group ?? "") != (bot.group ?? "")
            return ca != cb ? !ca : a.name.lowercased() < b.name.lowercased()
        }
    }

    /// The key of a group's chat, wherever a chat has a key: its read report, its notification, its message box.
    public static func key(_ id: String) -> String { "group:\(id)" }

    /// The group of a chat's key, or nil for a bot's chat and a Chief chat.
    public static func of(chat: String?) -> String? {
        guard let chat, chat.hasPrefix("group:") else { return nil }
        let id = String(chat.dropFirst(6))
        return id.isEmpty ? nil : id
    }

    /// The pinned groups, in the order of `pinned`: they stand after the pinned bots.
    public static func pinned(_ groups: [BotGroup]) -> [BotGroup] {
        groups.filter { $0.pinned > 0 }.sorted { $0.pinned < $1.pinned }
    }

    /// A category's groups that are not pinned, in their order, A to Z for those never placed: they
    /// stand after its bots (ADR 018).
    public static func inCategory(_ groups: [BotGroup], _ category: String) -> [BotGroup] {
        groups.filter { $0.pinned <= 0 && $0.category == category }.sorted { a, b in
            let oa = a.order > 0 ? a.order : Int.max, ob = b.order > 0 ? b.order : Int.max
            return oa != ob ? oa < ob : a.name.lowercased() < b.name.lowercased()
        }
    }

    /// A group's members that exist, in the group's order.
    public static func members(_ group: BotGroup, _ bots: [Bot]) -> [Bot] { members(group.members, bots) }

    /// The bots of these ids that exist, in that order: a bot the app does not know is given no head.
    public static func members(_ ids: [String], _ bots: [Bot]) -> [Bot] {
        ids.compactMap { id in bots.first { $0.id == id } }
    }

    /// Who is next in a group's chat: the members whose turn has not come, in the order they will
    /// have it, of the one message that is shown them of. `messages`: the owner's messages the chat
    /// holds, oldest first, each with the server's `next`. `working`: the members at work in the
    /// group, each with the message its turn is of. While a member works, only the messages whose
    /// turns are running count; while none works, every message does. Of those, it is the newest that
    /// "Stop all" did not end and whose `next` is not empty. Nobody otherwise.
    public static func next(_ messages: [GroupMessage], _ working: [GroupWorking]) -> [String] {
        let running = Set(working.compactMap(\.messageId))
        return messages.last { (working.isEmpty || running.contains($0.id)) && !$0.stopped && !$0.next.isEmpty }?.next ?? []
    }

    /// The groups with what the server now says of one group's new replies (`group_unread`).
    public static func setUnread(_ groups: [BotGroup], _ groupId: String, _ unread: Int, _ firstUnread: String?) -> [BotGroup] {
        var out = groups
        for i in out.indices where out[i].id == groupId {
            out[i].unread = max(0, unread)
            out[i].firstUnread = unread > 0 ? firstUnread : nil
        }
        return out
    }

    /// The groups after a feed event about one of them: who works in it (`group_run_started`,
    /// `group_run_finished`), its newest reply, unless the turn passed, its open question
    /// (`group_asks`), its stopped line (`group_limit`) and its new replies (`group_unread`). Any other
    /// event, and one about a group this app does not have, changes nothing.
    public static func on(_ groups: [BotGroup], event: String, data: Data) -> [BotGroup] {
        guard event.hasPrefix("group_"), let d = object(data), let id = d["groupId"] as? String,
              let i = groups.firstIndex(where: { $0.id == id }) else { return groups }
        var out = groups
        let bot = d["botId"] as? String ?? ""
        switch event {
        case "group_run_started":
            guard !bot.isEmpty else { return groups }
            if !out[i].working.contains(bot) { out[i].working.append(bot) }
        case "group_run_finished":
            if d["passed"] as? Bool != true, !bot.isEmpty {
                out[i].last = GroupLast(runId: d["id"] as? String, botId: bot, botName: d["botName"] as? String ?? "", status: d["status"] as? String ?? "",
                                        at: nonEmpty(d["endedAt"]) ?? nonEmpty(d["startedAt"]), text: String((nonEmpty(d["result"]) ?? d["problem"] as? String ?? "").prefix(300)))
            }
            out[i].working.removeAll { $0 == bot }
        case "group_asks": out[i].asks = GroupAsks(json: d["asks"])
        case "group_limit": out[i].limit = GroupLimit(json: d["limit"])
        case "group_unread": return setUnread(groups, id, d["unread"] as? Int ?? 0, d["firstUnread"] as? String)
        default: return groups
        }
        return out
    }
}

/// What the server sent, as loose JSON: a field of a kind this app does not expect is left out, and
/// the rest stays readable.
private func object(_ data: Data) -> [String: Any]? { (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
/// A list of ids as the server sent it; what is no text in it is left out.
private func texts(_ v: Any?) -> [String] { (v as? [Any])?.compactMap { $0 as? String } ?? [] }
/// A text that says something, or nil.
private func nonEmpty(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }

/// The group a card was asked in (`groupId` and `groupName` on an ask, a login request, a waiting
/// memory change, and on what the feed says waits of a job or a tile; docs/api.md, "A card and a
/// question in a group"). Such a card stands at the end of that group's chat and in no bot's own,
/// and its notification opens the group.
public struct GroupRef: Hashable, Sendable {
    public let id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }

    /// From the two fields as they came; nil without an id: a card of a bot's own chat.
    static func of(_ id: String?, _ name: String?) -> GroupRef? {
        nonEmpty(id).map { GroupRef(id: $0, name: nonEmpty(name) ?? "a group") }
    }
}

extension Ask {
    /// The group it was asked in, or nil.
    public var group: GroupRef? { GroupRef.of(groupId?.text, groupName?.text) }
}

extension LoginRequest {
    /// The group it was asked in, or nil.
    public var group: GroupRef? { GroupRef.of(groupId?.text, groupName?.text) }
}

extension MemoryChange {
    /// The group it was asked in, or nil.
    public var group: GroupRef? { GroupRef.of(groupId, groupName) }
}

/// The groups that waiting jobs and Board tiles were asked in, as the feed says them (`approvals` in
/// its first message and the `approvals` event): a bot's own list of jobs, and the Board, which the
/// cards are drawn from, do not carry it. Kept by "job:<botId>/<jobId>" and "tile:<tileId>".
enum CardGroups {
    static func jobKey(_ botId: String, _ jobId: String) -> String { "job:\(botId)/\(jobId)" }
    static func tileKey(_ tileId: String) -> String { "tile:\(tileId)" }

    /// The groups of the jobs and tiles that wait, from the feed's `approvals`.
    static func of(_ approvals: Any?) -> [String: GroupRef] {
        let a = approvals as? [String: Any]
        let entries = { (list: String) in (a?[list] as? [Any] ?? []).compactMap { $0 as? [String: Any] } }
        var out: [String: GroupRef] = [:]
        for o in entries("jobs") {
            if let bot = o["botId"] as? String, let job = o["jobId"] as? String { out[jobKey(bot, job)] = GroupRef.of(o["groupId"] as? String, o["groupName"] as? String) }
        }
        for o in entries("tiles") {
            if let tile = o["tileId"] as? String { out[tileKey(tile)] = GroupRef.of(o["groupId"] as? String, o["groupName"] as? String) }
        }
        return out
    }

    /// Whether the event `id` is one the feed replays from before its first message (`hello`, where
    /// it stood when the app connected): the same run of botdot ("<boot>.<n>"), and not after it.
    static func isReplay(_ id: String?, hello: String?) -> Bool {
        guard let id = id?.split(separator: "."), let hello = hello?.split(separator: "."), id.count > 1, id.dropLast() == hello.dropLast(),
              let n = id.last.flatMap({ Int($0) }), let at = hello.last.flatMap({ Int($0) }) else { return false }
        return n <= at
    }
}

extension NeedItem {
    /// Whose card it is, as the card names it: its bot, and for a card asked in a group the group too
    /// ("Coder in Dev"). At the end of that group's chat (`chat`) the bot alone.
    public func asker(in chat: ChatScope? = nil) -> String? {
        guard let name = who?.name, let group, chat != self.chat else { return who?.name }
        return "\(name) in \(group.name)"
    }
}

extension ChatScope {
    /// Whether a card at the end of this chat names its bot: in a bot's chat it is all that bot's;
    /// the Chief's says which bot it is for, and a group's which member asked.
    public var namesWho: Bool { if case .bot = self { false } else { true } }
}

extension Arrivals {
    /// The replies of a group's chat, oldest first, from its rows: the owner's messages are none.
    public static func replyIds(_ rows: [GroupItem]) -> [String] { rows.filter { $0.message == nil }.map(\.id) }
}

/// A group, with what its chat holds now (`GET /api/group-chats`). `members`: bot ids, in the
/// group's order. `category`, `pinned` and `order`: its place in the list, as a bot's `group`,
/// `pinned` and `order`, counted among the groups. Named so because SwiftUI has a `Group` of its own.
public struct BotGroup: Identifiable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var members: [String]
    public var category: String
    public var pinned: Int
    public var order: Int
    public var unread: Int
    public var firstUnread: String?
    /// Its newest reply, for the row's preview; nil while it has none.
    public var last: GroupLast?
    /// The ids of the members at work in it.
    public var working: [String]
    /// Its open question to the owner, or nil.
    public var asks: GroupAsks?
    /// The line that stopped at the limit of replies, or nil.
    public var limit: GroupLimit?

    public init(id: String, name: String = "", members: [String] = [], category: String = "", pinned: Int = 0, order: Int = 0, unread: Int = 0,
                firstUnread: String? = nil, last: GroupLast? = nil, working: [String] = [], asks: GroupAsks? = nil, limit: GroupLimit? = nil) {
        self.id = id
        self.name = name
        self.members = members
        self.category = category
        self.pinned = pinned
        self.order = order
        self.unread = unread
        self.firstUnread = firstUnread
        self.last = last
        self.working = working
        self.asks = asks
        self.limit = limit
    }

    /// A group as the server sent it; nil without an id.
    public init?(json: Any?) {
        guard let o = json as? [String: Any], let id = nonEmpty(o["id"]) else { return nil }
        self.init(id: id, name: o["name"] as? String ?? "", members: texts(o["members"]), category: o["category"] as? String ?? "",
                  pinned: o["pinned"] as? Int ?? 0, order: o["order"] as? Int ?? 0, unread: o["unread"] as? Int ?? 0, firstUnread: o["firstUnread"] as? String,
                  last: GroupLast(json: o["last"]), working: texts(o["working"]), asks: GroupAsks(json: o["asks"]), limit: GroupLimit(json: o["limit"]))
    }

    /// The groups of `GET /api/group-chats`, each read by itself: one this app cannot read is left out.
    public static func list(_ data: Data) -> [BotGroup] {
        ((try? JSONSerialization.jsonObject(with: data)) as? [Any])?.compactMap(BotGroup.init(json:)) ?? []
    }
}

/// A group's newest reply (`last`): who wrote it, how it ended, and its first words, or its problem when it failed.
public struct GroupLast: Hashable, Sendable {
    public var runId: String?
    public var botId: String
    public var botName: String
    public var status: String
    public var at: String?
    public var text: String

    public init(runId: String?, botId: String, botName: String, status: String, at: String?, text: String) {
        self.runId = runId
        self.botId = botId
        self.botName = botName
        self.status = status
        self.at = at
        self.text = text
    }

    init?(json: Any?) {
        guard let o = json as? [String: Any], let bot = o["botId"] as? String else { return nil }
        self.init(runId: o["runId"] as? String, botId: bot, botName: o["botName"] as? String ?? "", status: o["status"] as? String ?? "", at: o["at"] as? String, text: o["text"] as? String ?? "")
    }
}

/// A group's open question (`asks`): the member that asks, the question in one line, and the reply that asked.
public struct GroupAsks: Hashable, Sendable {
    public var botId: String
    public var botName: String
    public var text: String
    public var runId: String?
    public var at: String?

    public init(botId: String, botName: String, text: String, runId: String?, at: String? = nil) {
        self.botId = botId
        self.botName = botName
        self.text = text
        self.runId = runId
        self.at = at
    }

    init?(json: Any?) {
        guard let o = json as? [String: Any], let bot = o["botId"] as? String else { return nil }
        self.init(botId: bot, botName: o["botName"] as? String ?? "", text: o["text"] as? String ?? "", runId: o["runId"] as? String, at: o["at"] as? String)
    }
}

/// A line of the group that stopped at the limit (`limit`): the server's sentence, to draw with "Go on".
public struct GroupLimit: Hashable, Sendable {
    /// What the line says when the server sends no sentence.
    public static let stopped = "The group stopped."

    public var text: String
    public var messages: [String]
    public var waits: [String]

    public init(text: String, messages: [String] = [], waits: [String] = []) {
        self.text = text
        self.messages = messages
        self.waits = waits
    }

    init?(json: Any?) {
        guard let o = json as? [String: Any] else { return nil }
        self.init(text: o["text"] as? String ?? Self.stopped, messages: texts(o["messages"]), waits: texts(o["waits"]))
    }
}

/// The owner's message in a group. `to`: the members it was for. `waitsFor`: the members whose turn
/// waits because they are working. `next`: those whose turn has not come. `canTakeBack`: none of its
/// turns has started. `atLimit`: its line stopped at the limit. `stopped`: "Stop all" ended its line.
public struct GroupMessage: Identifiable, Hashable, Sendable {
    public let id: String
    public var text: String
    public var at: String
    public var attachments: [FileRef] = []
    public var to: [String] = []
    public var waitsFor: [String] = []
    public var next: [String] = []
    public var canTakeBack = false
    public var atLimit = false
    public var stopped = false

    /// A message as the server sent it; nil without an id: it cannot be taken back, or told from the next.
    public init?(json: Any?) {
        guard let o = json as? [String: Any], let id = nonEmpty(o["id"]) else { return nil }
        self.id = id
        text = o["text"] as? String ?? ""
        at = o["at"] as? String ?? ""
        attachments = (o["attachments"] as? [Any] ?? []).compactMap { f in
            (try? JSONSerialization.data(withJSONObject: f)).flatMap { try? JSON.decoder.decode(FileRef.self, from: $0) }
        }
        to = texts(o["to"])
        waitsFor = texts(o["waitsFor"])
        next = texts(o["next"])
        canTakeBack = o["canTakeBack"] as? Bool == true
        atLimit = o["atLimit"] as? Bool == true
        stopped = o["stopped"] as? Bool == true
    }
}

/// One row of a group's chat: the owner's message, or a member's reply with its run. `at`: where it stands.
public enum GroupItem: Identifiable, Hashable, Sendable {
    case message(GroupMessage)
    case reply(id: String, at: String, run: RunSummary)

    public var id: String {
        switch self {
        case .message(let m): m.id
        case .reply(let id, _, _): id
        }
    }

    public var at: String {
        switch self {
        case .message(let m): m.at
        case .reply(_, let at, _): at
        }
    }

    public var message: GroupMessage? { if case .message(let m) = self { m } else { nil } }

    /// An item of the chat as the server sent it; nil for one of a kind this app does not know.
    init?(json: Any?) {
        guard let o = json as? [String: Any] else { return nil }
        switch o["type"] as? String {
        case "message":
            guard let m = GroupMessage(json: o) else { return nil }
            self = .message(m)
        case "reply":
            guard let id = o["id"] as? String, let r = o["run"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: r),
                  let run = try? JSON.decoder.decode(RunSummary.self, from: data) else { return nil }
            self = .reply(id: id, at: o["at"] as? String ?? run.startedAt ?? "", run: run)
        default:
            return nil
        }
    }
}

/// A member at work in a group (`working` on its chat): its run, what it said it is about to do,
/// and, from a server with `working-line`, what its line reads now.
public struct GroupWorking: Hashable, Sendable {
    public var botId: String
    public var runId: String
    public var messageId: String?
    public var startedAt: String?
    public var openingLine: String?
    public var workingLine: String?

    public init(botId: String, runId: String, messageId: String? = nil, startedAt: String? = nil, openingLine: String? = nil, workingLine: String? = nil) {
        self.botId = botId
        self.runId = runId
        self.messageId = messageId
        self.startedAt = startedAt
        self.openingLine = openingLine
        self.workingLine = workingLine
    }

    static func list(_ json: Any?) -> [GroupWorking] {
        (json as? [Any] ?? []).compactMap { e in
            guard let o = e as? [String: Any], let bot = o["botId"] as? String, let run = o["runId"] as? String else { return nil }
            return GroupWorking(botId: bot, runId: run, messageId: o["messageId"] as? String, startedAt: o["startedAt"] as? String, openingLine: o["openingLine"] as? String, workingLine: o["workingLine"] as? String)
        }
    }
}

/// One page of a group's chat (`GET /api/group-chats/:id/chat`): its items, oldest first, whether
/// older ones are left, the members at work, the open question, the stopped line and its new replies.
public struct GroupChatPage: Hashable, Sendable {
    public var items: [GroupItem] = []
    public var more = false
    public var working: [GroupWorking] = []
    public var asks: GroupAsks?
    public var limit: GroupLimit?
    public var unread = 0
    public var firstUnread: String?

    public init() {}

    /// From the answer as it came; what is not what this app expects is left out.
    public init(_ data: Data) {
        guard let o = object(data) else { return }
        items = (o["items"] as? [Any] ?? []).compactMap(GroupItem.init(json:))
        more = o["more"] as? Bool == true
        working = GroupWorking.list(o["working"])
        asks = GroupAsks(json: o["asks"])
        limit = GroupLimit(json: o["limit"])
        unread = o["unread"] as? Int ?? 0
        firstUnread = o["firstUnread"] as? String
    }
}

/// What a send to a group answers: the message as it was taken, or, for the words "Go on" typed
/// while the group is stopped at the limit, `wentOn` and the messages that go on, with no message of
/// its own (docs/api.md, "The limit").
public struct GroupSent: Hashable, Sendable {
    public var message: GroupMessage?
    public var wentOn = false
    public var messages: [GroupMessage] = []

    /// The messages the answer hands over: the one that was taken, or those that go on.
    public var held: [GroupMessage] { wentOn ? messages : message.map { [$0] } ?? [] }

    public init(_ data: Data) {
        guard let o = object(data) else { return }
        wentOn = o["wentOn"] as? Bool == true
        message = wentOn ? nil : GroupMessage(json: o)
        messages = (o["messages"] as? [Any] ?? []).compactMap(GroupMessage.init(json:))
    }
}

/// A group's chat as the app holds it while it is open: the owner's messages and the replies by
/// their id. The app keeps no message of its own: what the owner sends is drawn from the server's
/// answer and from the feed.
public struct GroupChatItems: Hashable, Sendable {
    private var byId: [String: GroupItem] = [:]
    /// Whether older items are left on the server.
    public private(set) var more = false

    public init() {}

    /// The rows, oldest first: by when they stand, a message before a reply of the same moment.
    public var rows: [GroupItem] {
        byId.values.sorted { a, b in
            if a.at != b.at { return a.at < b.at }
            if (a.message != nil) != (b.message != nil) { return a.message != nil }
            return a.id < b.id
        }
    }

    public func has(_ id: String) -> Bool { byId[id] != nil }
    public var oldest: GroupItem? { rows.first }

    /// A page of the chat into what the app holds. The newest page says what is there now: an item
    /// it no longer has, from where it begins, is gone (a message taken back in another app). An
    /// `older` page only adds.
    public mutating func take(_ page: GroupChatPage, older: Bool = false) {
        if older {
            more = page.more
        } else {
            let from = page.items.first?.at
            let ids = Set(page.items.map(\.id))
            byId = byId.filter { id, item in ids.contains(id) || from.map { item.at < $0 } == true }
            // Older pages that are held say whether more is left.
            if byId.values.allSatisfy({ item in from.map { item.at >= $0 } != false }) { more = page.more }
        }
        for item in page.items { byId[item.id] = item }
    }

    /// A message of the owner's as the feed or an answer hands it over: kept when the app holds it
    /// already, or when it belongs to what the app holds. One from further back than that is left to
    /// the page that reads it: held alone, it would stand above replies that are not read yet. True
    /// when it was kept.
    @discardableResult
    public mutating func hold(_ m: GroupMessage) -> Bool {
        if !has(m.id), more, oldest.map({ m.at >= $0.at }) != true { return false }
        byId[m.id] = .message(m)
        return true
    }

    /// That item is gone (a message that was taken back). True when it was held.
    @discardableResult
    public mutating func remove(_ id: String) -> Bool { byId.removeValue(forKey: id) != nil }
}

/// What a member at work in a group is doing, by its run: `text` its line, `held` it waits for the
/// owner's OK. `works`: the turn has a working line, so its opening line, which the server sends as
/// before, is not drawn in its place.
public struct TurnLine: Hashable, Sendable {
    public var groupId: String
    public var botId: String
    public var text = ""
    public var held = false
    public var works = false

    public init(groupId: String, botId: String, text: String = "", held: Bool = false, works: Bool = false) {
        self.groupId = groupId
        self.botId = botId
        self.text = text
        self.held = held
        self.works = works
    }
}

/// The lines of the turns at work in the groups, by run. The feed says them (`group_working_line`,
/// `group_opening_line`, `group_run_waits`), and a group's chat when it is read (`working`); a run's
/// end takes its line away. From a server with `working-line` (`follows`) a turn's line is its
/// working line (docs/api.md, "The working line"): the server's words for what the member is doing
/// now, drawn as they come. Until a turn has one, and against a server that sends a turn none, the
/// line is its opening line.
public struct TurnLines: Equatable, Sendable {
    public private(set) var value: [String: TurnLine] = [:]
    /// The runs in the order their lines were first said.
    private var order: [String] = []

    public init() {}

    public subscript(run: String) -> TurnLine? { value[run] }

    /// The server said something of the run `runId`: what `change` makes of what was known of it.
    mutating func say(_ runId: String?, _ groupId: String?, _ botId: String?, _ change: (inout TurnLine) -> Void) {
        guard let runId, !runId.isEmpty, let groupId, !groupId.isEmpty, let botId, !botId.isEmpty else { return }
        var line = value[runId] ?? TurnLine(groupId: groupId, botId: botId)
        line.groupId = groupId
        line.botId = botId
        change(&line)
        if value[runId] == nil { order.append(runId) }
        value[runId] = line
    }

    /// The turn's working line, as the feed or the chat has it: only from a server that says it has one.
    private mutating func works(_ runId: String?, _ groupId: String?, _ botId: String?, _ line: String?, follows: Bool) -> Bool {
        let t = follows ? OpeningLine.text(line) : ""
        if !t.isEmpty { say(runId, groupId, botId) { $0.text = t; $0.works = true } }
        return !t.isEmpty
    }

    /// The turn's opening line: its line until it has a working line.
    private mutating func opens(_ runId: String?, _ groupId: String?, _ botId: String?, _ line: String?) {
        let t = OpeningLine.text(line)
        if !t.isEmpty { say(runId, groupId, botId) { if !$0.works { $0.text = t } } }
    }

    private mutating func drop(_ match: (String, TurnLine) -> Bool) {
        value = value.filter { !match($0.key, $0.value) }
        order.removeAll { value[$0] == nil }
    }

    /// A group's chat was read: the line of each member at work, as its `working` has it now.
    public mutating func read(_ groupId: String, _ working: [GroupWorking], follows: Bool) {
        for w in working where !works(w.runId, groupId, w.botId, w.workingLine, follows: follows) { opens(w.runId, groupId, w.botId, w.openingLine) }
    }

    public mutating func clear() {
        value = [:]
        order = []
    }

    /// What a feed event says of a turn's line. Any event that is not a group's changes nothing.
    public mutating func handle(_ event: String, _ data: Data, follows: Bool) {
        if event == "reset" { return clear() } // the feed could not say what was missed: the lists are read again
        guard event.hasPrefix("group_"), let d = object(data) else { return }
        let group = d["groupId"] as? String, bot = d["botId"] as? String
        switch event {
        // A member's new turn: the line of its earlier one in that group goes.
        case "group_run_started": drop { id, l in l.groupId == group && l.botId == bot && id != d["id"] as? String }
        case "group_run_finished": drop { id, _ in id == d["id"] as? String }
        case "group_working_line": _ = works(d["runId"] as? String, group, bot, d["text"] as? String, follows: follows)
        case "group_opening_line": opens(d["runId"] as? String, group, bot, d["text"] as? String)
        case "group_run_waits": say(d["runId"] as? String, group, bot) { $0.held = d["waitingFor"] as? String == "ok" }
        default: break
        }
    }

    /// What the member `botId` at work in `groupId` says it is doing; "" when it has said nothing.
    public func of(_ groupId: String, _ botId: String) -> String {
        order.last { value[$0].map { $0.groupId == groupId && $0.botId == botId && !$0.text.isEmpty } == true }.flatMap { value[$0]?.text } ?? ""
    }

    /// The line of a member at work as its entry in the chat's `working` has it: its working line
    /// from a server that says it has one, else its opening line.
    public static func ofRun(_ w: GroupWorking, follows: Bool) -> String? {
        follows && !OpeningLine.text(w.workingLine).isEmpty ? w.workingLine : w.openingLine
    }
}

/// The line under a group's name in the list. `who`: the bot named before it ("Coder: …"), or "".
/// `working`: a member works, and the line is what it does. `asks`: a member asks the owner
/// something. `color`: the colour of the dots, "#rrggbb".
public struct GroupLine: Hashable, Sendable {
    public var who: String
    public var text: String
    public var working = false
    public var asks = false
    public var color = GroupWords.gone

    public init(who: String, text: String, working: Bool = false, asks: Bool = false, color: String = GroupWords.gone) {
        self.who = who
        self.text = text
        self.working = working
        self.asks = asks
        self.color = color
    }

    /// The line as the row prints it: "Coder: Working…", "Coder asks: Which one?".
    public var preview: String { who.isEmpty ? text : "\(who): \(text)" }
}

/// What the app says of a group, in the Android app's words (ui/GroupWords.kt). Nothing here asks
/// the botdot server anything.
public enum GroupWords {
    /// The grey of a bot that is gone, and of a group whose bots are all gone.
    public static let gone = "#888780"

    /// "Coder", "Coder and Reviewer", "Coder, Reviewer and Issue Writer".
    public static func names(_ names: [String]) -> String {
        names.count > 1 ? "\(names.dropLast().joined(separator: ", ")) and \(names[names.count - 1])" : names.first ?? ""
    }

    /// What VoiceOver is told of the heads of who is next in a group, which carry no words: "Next: Reviewer and Issue Writer".
    public static func next(_ names: [String]) -> String { names.isEmpty ? "" : "Next: \(self.names(names))" }

    /// A member's name now, or as the server `said` it for a bot that is gone.
    public static func memberName(_ bots: [Bot], _ botId: String?, _ said: String? = nil) -> String {
        bots.first { $0.id == botId }?.name ?? said.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.flatMap { $0.isEmpty ? nil : $0 } ?? "A bot"
    }

    /// A member's colour now, or as the server `said` it for a bot that is gone.
    public static func memberColor(_ bots: [Bot], _ botId: String?, _ said: String? = nil) -> String {
        bots.first { $0.id == botId }?.color ?? said.flatMap { $0.isEmpty ? nil : $0 } ?? gone
    }

    /// What a group's row says: while a member works, who it is and its line; else "… asks" when a
    /// member asks the owner something; else its newest reply, with the bot's name before it.
    /// `lines`: what the turns at work said.
    public static func line(_ g: BotGroup, _ bots: [Bot], _ lines: TurnLines) -> GroupLine {
        let one = { (text: String) in String(Format.plain(text).prefix(120)) }
        let dots = memberColor(bots, g.last?.botId ?? g.members.first { id in bots.contains { $0.id == id } })
        if let at = g.working.lazy.compactMap({ id in bots.first { $0.id == id } }).first {
            let said = lines.of(g.id, at.id)
            return GroupLine(who: at.name, text: "\(said.isEmpty ? "Working" : said)…", working: true, color: dots)
        }
        if let a = g.asks {
            let text = one(a.text)
            return GroupLine(who: "", text: "\(memberName(bots, a.botId, a.botName)) asks\(text.isEmpty ? "" : ": \(text)")", asks: true, color: memberColor(bots, a.botId))
        }
        if let l = g.last {
            let text = one(l.text)
            return GroupLine(who: memberName(bots, l.botId, l.botName), text: text.isEmpty ? (l.status == "success" ? "Done." : "Couldn't finish") : text, color: dots)
        }
        return GroupLine(who: "", text: "No messages yet", color: dots)
    }

    /// What the search box finds a group by: its name, its category and its members' names.
    public static func searchText(_ g: BotGroup, _ bots: [Bot]) -> String {
        "\(g.name) \(g.category) \(Groups.members(g, bots).map(\.name).joined(separator: " "))".lowercased()
    }

    /// Under a message of the owner's that waits for busy members: for whom. "" when it waits for nobody.
    public static func waitsLine(_ m: GroupMessage, _ bots: [Bot]) -> String {
        let names = m.waitsFor.map { memberName(bots, $0) }
        return names.isEmpty ? "" : names.count > 1 ? "Waits until \(self.names(names)) are free" : MessageWaits.waitsUntil(names[0])
    }

    /// A message none of whose turns has started, and that waits for a busy member. It is drawn at
    /// the end of the chat, faded, with "Take back", as a waiting message in a bot's chat is.
    /// `signedOut`: Claude is signed out, so no turn can start, whoever is free.
    public static func waitsWhole(_ m: GroupMessage, _ bots: [Bot], signedOut: Bool = false) -> Bool { m.canTakeBack && (!waitsLine(m, bots).isEmpty || signedOut) }

    /// One working line at the end of a group's chat: its member's name, and what it is doing in the
    /// server's words. `line`: what the feed and the chat said of its turn. `opening`: the turn's
    /// line as its entry in the chat's `working` has it (`TurnLines.ofRun`), until they said one.
    public static func working(_ name: String, _ line: TurnLine?, _ opening: String?) -> String {
        if line?.held == true { return "\(name) · \(OpeningLine.waitingForOk)" }
        let said = [OpeningLine.text(line?.text), OpeningLine.text(opening)].first { !$0.isEmpty } ?? "Working"
        return "\(name) · \(said)…"
    }

    /// What VoiceOver says of the small plus right of the name in a bot's chat. It has no words beside it.
    public static let addABot = "Add a bot to this chat"

    /// Under the picker that makes a group from the chat of `bot`: how many are picked (`n`), with that bot.
    public static func makeHint(_ n: Int, _ bot: String) -> String {
        n > 0 ? "\(n + 1) bots in the group, with \(bot)." : "Pick one to five bots to join \(bot). Its own chat stays as it is."
    }

    /// Under the picker that adds bots to a group of `members` bots called `name`.
    public static func addHint(_ n: Int, members: Int, name: String) -> String {
        n > 0 ? "\(members + n) bots in \(name)." : "A group has two to six bots."
    }

    /// A group's name as it is saved: one line, without the blanks around it.
    public static func name(typed: String) -> String {
        typed.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// A group with no message yet: its members, and that all of them read what is written there.
    public static func empty(_ names: [String]) -> String {
        names.isEmpty ? "Its bots are all gone. Add one, or delete the group." : "\(self.names(names)). What you write here, all of them read."
    }
}

extension Mentions {
    /// What can be mentioned in a group's chat: its members and their jobs. No other bot, not the
    /// Chief of Staff and no skill: a mention there gives the member it names the turn.
    public init(group: BotGroup, bots: [Bot]) {
        self.init(chat: Groups.key(group.id), bots: Groups.members(group, bots).map(Target.init), library: [])
    }
}

extension SidebarSections {
    /// The list with the groups in it: a category's groups after its bots, and the pinned groups
    /// after the pinned bots (ADR 018). A category is one of the bots' or of the groups': it can hold
    /// groups and no bot.
    public func with(_ chats: [BotGroup]) -> SidebarSections {
        let names = Set(groups.map(\.name)).union(chats.filter { $0.pinned <= 0 }.map(\.category))
        let ordered = names.filter { !$0.isEmpty }.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending } + (names.contains("") ? [""] : [])
        var out = SidebarSections(pinned: pinned, groups: ordered.map { name in
            var category = Group(name: name, bots: groups.first { $0.name == name }?.bots ?? [])
            category.groupChats = Groups.inCategory(chats, name)
            return category
        })
        out.pinnedGroupChats = Groups.pinned(chats)
        return out
    }
}

extension ReplyNotifications {
    /// What a group's event means for notifications (docs/api.md, "A card and a question in a
    /// group"). No reply in a group notifies: only one that asks the owner something, which the
    /// server marks `notify: true`, and not while this app shows the group in front (`watching`). It
    /// is one notification per group, tagged "group:<id>", under the group's name and the server's
    /// title ("Coder asks"), with the question in the server's one line. It goes when the group is
    /// read in any app (`group_unread` with nothing left) or its question ends (`group_asks` without one).
    static func group(_ event: String, _ d: [String: Any], watching: String?, name: (String) -> String?) -> NotificationStep? {
        guard let id = nonEmpty(d["groupId"]) else { return nil }
        let chat = Groups.key(id)
        switch event {
        case "group_run_finished":
            guard d["notify"] as? Bool == true, chat != watching else { return nil }
            let str = { (k: String) in d[k] as? String }
            let asks = nonEmpty(str("title")?.trimmingCharacters(in: .whitespacesAndNewlines)) ?? "\(nonEmpty(str("botName")) ?? "A bot") asks"
            let body = nonEmpty(str("question")?.trimmingCharacters(in: .whitespacesAndNewlines))
                ?? run(chat: chat, id: str("id"), botName: nil, jobName: nil, status: str("status"), result: nonEmpty(str("result")), problem: str("problem"), error: str("error")).body
            return .post(ReplyNotification(chat: chat, id: chat, title: "\(name(id) ?? "A group") · \(asks)", body: body))
        case "group_unread":
            return d["unread"] as? Int == 0 ? .remove(chat: chat) : nil
        case "group_asks":
            return d["asks"] != nil && !(d["asks"] is [String: Any]) ? .remove(chat: chat) : nil
        default:
            return nil
        }
    }
}

/// A group's chat on screen: the owner's messages and the replies as the botdot server hands them
/// out, the members at work, the open question and the stopped line.
public struct GroupChatState: Sendable {
    public var groupId: String?
    /// The chat's rows, oldest first.
    public var rows: [GroupItem] = []
    /// The members at work in the group, in the order they started.
    public var working: [GroupWorking] = []
    /// The group's open question: the answer buttons stand under the reply that asked.
    public var asks: GroupAsks?
    /// The line that stopped at the limit of replies, or nil.
    public var limit: GroupLimit?
    /// Its chat has been read (until then, it isn't an empty chat yet).
    public var loaded = false
    /// Whether older items are left on the server.
    public var more: Bool { held.more }
    /// The owner's messages among the rows, oldest first.
    public var messages: [GroupMessage] { rows.compactMap(\.message) }

    var held = GroupChatItems()
    /// How many of the newest items are asked for, and which answer is drawn: a later one wins.
    var want = Groups.page
    var asked = 0
    var taken = 0
    var loadingOlder = false

    public init(groupId: String? = nil) { self.groupId = groupId }
}

extension Store {
    /// The most of a group's newest items one request reads: for a "New" line further back.
    static let groupReach = 200

    /// A group the app holds, by its id.
    public func group(_ id: String) -> BotGroup? { groups.first { $0.id == id } }

    /// Reads the groups. A botdot server without `groups` is asked nothing and has none. A read that
    /// fails says nothing of the groups: what is held stays. So does it when the server's `features`
    /// could not be read: they are then as they were last read (`loadFigure`), never emptied.
    /// True when the groups are as the server has them now.
    @discardableResult
    public func loadGroups() async -> Bool {
        guard let api else { return false }
        guard has(.groups) else {
            if !groups.isEmpty { groups = [] }
            return true
        }
        guard let data = try? await api.data("group-chats"), self.api?.base == api.base else { return false }
        let now = BotGroup.list(data)
        if now != groups { groups = now }
        return true
    }

    /// Whether the group `id` is gone: deleted, here or in another app, so there is no chat to show.
    /// The list is read once more first: a group made a moment ago, opened from its notification, may
    /// not be in the list the app holds. A read that failed says nothing of the group. One that is
    /// gone is no longer the open chat.
    public func groupIsGone(_ id: String) async -> Bool {
        guard await loadGroups(), group(id) == nil else { return false }
        if groupChat.groupId == id { groupChat = GroupChatState() }
        return true
    }

    /// What the feed says of the groups that waiting jobs and tiles were asked in (`CardGroups`): its
    /// first message says where things stand, and each `approvals` after it. One it replays from
    /// before that message is older than it, and says nothing.
    func heardCards(_ event: String, id: String?, _ data: Data) {
        var now = cardGroups
        switch event {
        case "hello":
            cardsSaidAt = nonEmpty(object(data)?["lastEventId"])
            now = CardGroups.of(object(data)?["approvals"])
        case "approvals" where !CardGroups.isReplay(id, hello: cardsSaidAt):
            now = CardGroups.of(object(data))
        default:
            break
        }
        if now != cardGroups { cardGroups = now }
    }

    /// A card in the chat it belongs to. One asked in a group belongs to that group's chat and to no
    /// bot's own, under the group's name as it is now (the server's, for a group this app does not
    /// hold). Any other card, and every card against a server without `groups`, is as it was.
    func placed(_ item: NeedItem) -> NeedItem {
        let asked = item.ask?.group ?? item.loginRequest?.group ?? item.memory?.group
            ?? item.job.flatMap { j in item.botId.flatMap { cardGroups[CardGroups.jobKey($0, j.id)] } }
            ?? item.tile.flatMap { cardGroups[CardGroups.tileKey($0.id)] }
        guard has(.groups), let asked else { return item }
        var card = item
        card.group = GroupRef(id: asked.id, name: group(asked.id)?.name ?? asked.name)
        card.chat = .group(asked.id)
        return card
    }

    /// Shows a group's chat: its newest messages and replies, and who is at work in it.
    public func openGroup(_ id: String) {
        groupChat = GroupChatState(groupId: id)
        Task { await loadGroupChat(id) }
    }

    /// The open group's newest items (again). `reach`: read this many of them, when more than the usual page.
    func loadGroupChat(_ id: String, reach: Int = 0) async {
        guard let api, groupChat.groupId == id else { return }
        groupChat.want = min(max(groupChat.want, reach), Self.groupReach)
        groupChat.asked += 1
        let mine = groupChat.asked
        let data: Data
        do {
            data = try await api.data("group-chats/\(id)/chat?limit=\(groupChat.want)")
        } catch {
            if groupChat.groupId == id, !groupChat.loaded { problem = error.localizedDescription }
            return
        }
        guard groupChat.groupId == id, mine >= groupChat.taken else { return } // another chat, or a later answer is drawn already
        let page = GroupChatPage(data)
        var chat = groupChat
        chat.taken = mine
        chat.held.take(page)
        chat.working = page.working
        chat.asks = page.asks
        chat.limit = page.limit
        chat.loaded = true
        chat.rows = chat.held.rows
        groupChat = chat
        turns { $0.read(id, page.working, follows: has(.workingLine)) } // each member's line, as the chat has it now
        reachGroupNewLine()
    }

    /// Reads the open group's chat back to a reply it doesn't hold (a search match). False when it
    /// holds it, or there is no further back to read: the reply is then opened by itself.
    public func reachGroupReply(_ run: String) -> Bool {
        guard let id = groupChat.groupId, groupChat.loaded, !groupChat.held.has(run), groupChat.held.more, groupChat.want < Self.groupReach else { return false }
        Task { await loadGroupChat(id, reach: Self.groupReach) }
        return true
    }

    /// A group's place in the list: among the pinned groups, or among its category's (1 = first).
    private func place(ofGroup id: String) -> DropSpot? {
        guard let g = group(id) else { return nil }
        if let i = Groups.pinned(groups).firstIndex(where: { $0.id == id }) { return .pinned(i + 1) }
        return Groups.inCategory(groups, g.category).firstIndex { $0.id == id }.map { .group(g.category, $0 + 1) }
    }

    /// Drops a group's row where the gap was: pins it, reorders it or moves it to a category, as a
    /// bot's row (`drop`). The places are counted among the groups; `spot` counts the dragged group
    /// where it still is.
    public func dropGroup(_ id: String, at spot: DropSpot) async throws {
        guard let now = place(ofGroup: id) else { return }
        struct Pin: Encodable { let pinned: Int }
        struct Move: Encodable { let category: String; let order: Int; let pinned: Int? }
        switch (now, spot) {
        case (.pinned(let own), .pinned(let at)):
            if at == own || at == own + 1 { return }
            try await changeGroup(id, Pin(pinned: own < at ? at - 1 : at))
        case (.group, .pinned(let at)):
            try await changeGroup(id, Pin(pinned: at))
        case (.group(let from, let own), .group(let to, let at)) where from == to:
            if at == own || at == own + 1 { return }
            try await changeGroup(id, Move(category: to, order: own < at ? at - 1 : at, pinned: nil))
        case (.group, .group(let to, let at)):
            try await changeGroup(id, Move(category: to, order: at, pinned: nil))
        case (.pinned, .group(let to, let at)):
            try await changeGroup(id, Move(category: to, order: at, pinned: 0))
        }
    }

    /// The "New" line was placed in the open group's chat above a reply it doesn't hold: read back to it.
    func reachGroupNewLine() {
        guard let line = newLine, let first = line.first.run, let id = groupChat.groupId, line.chat == Groups.key(id), groupChat.loaded,
              !groupChat.held.has(first), groupChat.held.more, groupChat.want < Self.groupReach else { return }
        Task { await loadGroupChat(id, reach: Self.groupReach) }
    }

    /// The page before the oldest item held (the chat was scrolled up).
    public func loadOlderGroupChat() async {
        guard let api, let id = groupChat.groupId, groupChat.loaded, groupChat.held.more, !groupChat.loadingOlder, let oldest = groupChat.held.oldest?.id else { return }
        groupChat.loadingOlder = true
        let before = oldest.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? oldest
        let data = try? await api.data("group-chats/\(id)/chat?limit=\(Groups.page)&before=\(before)")
        guard groupChat.groupId == id else { return }
        groupChat.loadingOlder = false
        guard let data else { return }
        groupChat.held.take(GroupChatPage(data), older: true)
        groupChat.rows = groupChat.held.rows
    }

    /// Who is next in the open group's chat: the ids of the members whose turn has not come (`Groups.next`).
    public var groupNext: [String] { Groups.next(groupChat.messages, groupChat.working) }

    /// The working line of a member at work in the open group's chat: its name and what it is doing.
    public func words(of working: GroupWorking) -> String {
        GroupWords.working(GroupWords.memberName(bots, working.botId), turnLines[working.runId], TurnLines.ofRun(working, follows: has(.workingLine)))
    }

    /// Changes the turns' lines, and tells the screens only when something is different.
    func turns(_ change: (inout TurnLines) -> Void) {
        var now = turnLines
        change(&now)
        if now != turnLines { turnLines = now }
    }

    /// What an answer hands over is in the open chat at once.
    private func took(_ sent: GroupSent, in id: String) {
        guard groupChat.groupId == id else { return }
        for m in sent.held { groupChat.held.hold(m) }
        if sent.wentOn { groupChat.limit = nil } // "Go on", typed: no message of its own, and the line is no longer stopped
        groupChat.rows = groupChat.held.rows
    }

    /// The owner writes in a group: one message, and the server gives the turns. `key`: the
    /// message's key, kept under "group:<id>" (see Outbox.swift).
    public func sendToGroup(_ id: String, _ text: String, attachments: [FileRef] = [], key: String? = nil) async throws {
        guard let api else { throw NotSent(cause: ConnectError(message: "Not connected.")) }
        struct Message: Encodable { let text: String; let attachments: [FileRef]?; let key: String? }
        let data = try await api.data("group-chats/\(id)/messages", method: "POST", body: Message(text: text, attachments: attachments.isEmpty ? nil : attachments, key: takesOnce ? key : nil))
        took(GroupSent(data), in: id)
    }

    /// Sends the owner's message from the open group's chat through that chat's outbox, as
    /// `deliverToBot`; true once botdot took it. The chat is read again after it.
    @discardableResult
    public func deliverToGroup(_ text: String, attachments: [FileRef] = [], box: Bool = true, key: String? = nil) async -> Bool {
        guard let id = groupChat.groupId else { return false }
        let went = await outbox(Groups.key(id)).send(text, attachments: attachments, box: box, key: key, once: takesOnce, known: Set(groupChat.messages.map(\.id))) { key in
            try await sendToGroup(id, text, attachments: attachments, key: key)
        }
        await loadGroupChat(id)
        return went
    }

    /// The owner's message on its way to this group, drawn in its chat until the server's version of
    /// it is there, as `sent(toBot:)`; nil when none is, and for a group whose chat is not the open one.
    public func sent(toGroup id: String) -> SentMessage? {
        guard groupChat.groupId == id else { return nil }
        return outbox(Groups.key(id)).sent?.unlessIn(groupChat.messages.map { Queued(id: $0.id, text: $0.text, attachments: $0.attachments) })
    }

    /// "Take back" on a message in a group none of whose turns has started: it leaves the server,
    /// and its text and files wait for that chat's message box, as after a failed send; true once it
    /// is back. When a turn of it has started meanwhile, the box's line says so.
    @discardableResult
    public func takeBack(_ message: GroupMessage, fromGroup id: String) async -> Bool {
        guard let api, taking.insert(message.id).inserted else { return false }
        defer { taking.remove(message.id) }
        let back = await outbox(Groups.key(id)).takeBack {
            KeptMessage(takenBack: try await api.data("group-chats/\(id)/messages/\(message.id)", method: "DELETE"))
        }
        if back, groupChat.groupId == id, groupChat.held.remove(message.id) { groupChat.rows = groupChat.held.rows }
        await loadGroupChat(id)
        return back
    }

    /// "Stop all": every run of the group at work ends, and the turns that would have followed never start.
    public func stopGroup(_ id: String) async {
        guard let api else { return }
        do { try await api.send("group-chats/\(id)/stop") } catch { problem = error.localizedDescription }
        await loadGroupChat(id)
    }

    /// "Go on": the group stopped at the limit gets its next replies. A group that is no longer
    /// stopped says so in the server's words.
    public func goOn(_ id: String) async {
        guard let api else { return }
        do {
            let sent = GroupSent(try await api.data("group-chats/\(id)/go-on", method: "POST"))
            if sent.wentOn { took(sent, in: id) }
        } catch { problem = error.localizedDescription }
        await loadGroupChat(id)
    }

    /// Whether the small plus stands in this bot's chat: this botdot server has groups, and there is another bot.
    public func canMakeGroup(with botId: String) -> Bool {
        has(.groups) && bots.contains { $0.id != botId }
    }

    /// A new group of these bots, in their order: it is in the list when this returns, so its chat
    /// can open. A refusal is thrown as the server's sentence for the owner, and nothing is made.
    @discardableResult
    public func makeGroup(name: String, members: [String]) async throws -> BotGroup {
        guard let api else { throw ConnectError(message: "Not connected.") }
        struct New: Encodable { let name: String; let members: [String] }
        let data = try await api.data("group-chats", method: "POST", body: New(name: name, members: members))
        guard let made = BotGroup(json: try? JSONSerialization.jsonObject(with: data)) else { throw ConnectError(message: "That didn't work") }
        await loadGroups()
        if group(made.id) == nil { groups.append(made) } // the list could not be read: the answer is the group
        return made
    }

    /// A change to a group. The list is read again either way; a refusal is thrown as the server's sentence.
    private func changeGroup(_ id: String, _ changes: some Encodable & Sendable) async throws {
        guard let api else { throw ConnectError(message: "Not connected.") }
        do {
            let data = try await api.data("group-chats/\(id)", method: "PUT", body: changes)
            if let now = BotGroup(json: try? JSONSerialization.jsonObject(with: data)), let i = groups.firstIndex(where: { $0.id == id }), groups[i] != now { groups[i] = now }
        } catch {
            await loadGroups()
            throw error
        }
        await loadGroups()
    }

    /// Saves the name typed in a group's panel (`GroupWords.name`). An emptied box and the name it
    /// has send nothing; neither does a group that is not in the list (deleted meanwhile). The panel
    /// calls it when it closes too: the store outlives the panel.
    public func nameGroup(_ id: String, typed: String) async throws {
        let to = GroupWords.name(typed: typed)
        guard !to.isEmpty, let now = group(id)?.name, to != now else { return }
        struct Name: Encodable { let name: String }
        try await changeGroup(id, Name(name: to))
    }

    /// A group's members as they are to be, the whole list in its order: it adds one and takes one out.
    public func setMembers(of id: String, _ members: [String]) async throws {
        struct Members: Encodable { let members: [String] }
        try await changeGroup(id, Members(members: members))
    }

    /// Deletes the group and its chat: its row leaves the list at once. No bot and no run is deleted.
    public func deleteGroup(_ id: String) async throws {
        guard let api else { throw ConnectError(message: "Not connected.") }
        try await api.send("group-chats/\(id)", method: "DELETE")
        groups.removeAll { $0.id == id }
        if groupChat.groupId == id { groupChat = GroupChatState() }
        await loadGroups()
    }

    /// What can be mentioned in a chat: in a group's ("group:<id>") its members, else every bot and
    /// the skills in scope. `chat`: the Chief's id, a bot's id, or a group's key.
    public func mentions(in chat: String) -> Mentions {
        guard let id = Groups.of(chat: chat) else { return Mentions(chat: chat, bots: bots, library: skillLibrary) }
        return Mentions(group: group(id) ?? BotGroup(id: id), bots: bots)
    }

    /// What the server says of a group's new replies: as the app knows it, and asked now.
    func groupUnreadKnown(_ id: String) -> UnreadNow? {
        group(id).map { UnreadNow(unread: $0.unread, first: $0.firstUnread.map(NewLine.First.run)) }
    }

    func groupUnreadNow(_ id: String) async -> UnreadNow? {
        guard let api, let data = try? await api.data("group-chats/\(id)"), let g = BotGroup(json: try? JSONSerialization.jsonObject(with: data)) else { return nil }
        return UnreadNow(unread: g.unread, first: g.firstUnread.map(NewLine.First.run))
    }

    /// The feed's events about groups. `groups`: one was made, changed or deleted, and the list is
    /// read again. What happens in a group (`group_…`) changes its row at once, and the open chat
    /// when it is that group's: the chat is then read again, so a message sent from another app and
    /// every reply are in it.
    func groupHeard(_ event: String, _ data: Data) async {
        if event == "groups" { await loadGroups(); return }
        guard event.hasPrefix("group_") else { return }
        let now = Groups.on(groups, event: event, data: data)
        if now != groups { groups = now }
        let d = object(data) ?? [:]
        if let id = d["groupId"] as? String, id == groupChat.groupId {
            var read = true
            switch event {
            case "group_message":
                if let m = GroupMessage(json: d["message"]), groupChat.held.hold(m) { groupChat.rows = groupChat.held.rows }
            case "group_message_gone":
                if let gone = d["id"] as? String, groupChat.held.remove(gone) { groupChat.rows = groupChat.held.rows }
            case "group_run_started":
                if let run = nonEmpty(d["id"]), let bot = nonEmpty(d["botId"]), !groupChat.working.contains(where: { $0.runId == run }) {
                    groupChat.working.append(GroupWorking(botId: bot, runId: run, messageId: nonEmpty(d["groupMessageId"]), startedAt: nonEmpty(d["startedAt"])))
                }
            case "group_run_finished":
                groupChat.working.removeAll { $0.runId == d["id"] as? String }
            case "group_asks":
                groupChat.asks = GroupAsks(json: d["asks"])
                read = false
            case "group_limit":
                groupChat.limit = GroupLimit(json: d["limit"])
            default:
                read = false
            }
            if read { await loadGroupChat(id) }
        }
        // Who works in it, its newest reply and its new replies: the row follows the server's own list.
        if ["group_run_started", "group_run_finished", "group_unread"].contains(event) { await loadGroups() }
        if event == "group_run_finished" { reportAgainIfStale() }
    }

    /// Another botdot server, or none: forget what this one said of its groups.
    func forgetGroups() {
        groups = []
        groupChat = GroupChatState()
        turnLines = TurnLines()
        cardGroups = [:]
        cardsSaidAt = nil
    }
}
