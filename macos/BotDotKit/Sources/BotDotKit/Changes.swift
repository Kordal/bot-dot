import Foundation

/// Nothing approved unseen (docs/api.md, "Decline" and "A change that waits"; ADR 013): a change to an
/// approved job or tile waits beside it as a card of its own, the no of a card reads the server's
/// words, and "Approve all" approves no script. The app's own words here are the Android app's.
/// Reading any of it never fails: a field this app can't read reads as unchanged, and a change that
/// is no object is no change.

/// A change to an approved job that waits for the owner (`change` on a job): the job as proposed. A
/// field the server leaves out, or sends as something else than text, is nil and reads as unchanged.
/// `when`: its schedule in words. `by`: "chief" or "bot". `at`: when it was proposed, which tells one
/// change to a job from the next. `summary`: what it changes, in one sentence of whoever proposed it.
public struct JobChange: Codable, Hashable, Sendable {
    public var name: String?
    public var kind: String?
    public var when: String?
    public var prompt: String?
    public var script: String?
    public var notify: String?
    public var aiWhen: String?
    public var by: String?
    public var at: String?
    public var summary: String?
    /// It came as an object. Anything else is no change: nothing waits beside the job.
    var read = false

    enum CodingKeys: String, CodingKey { case name, kind, when, prompt, script, notify, aiWhen, by, at, summary }

    public init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }
        read = true
        name = c.words(.name)
        kind = c.words(.kind)
        when = c.words(.when)
        prompt = c.whole(.prompt)
        script = c.whole(.script)
        notify = c.words(.notify)
        aiWhen = c.words(.aiWhen)
        by = c.words(.by)
        at = c.words(.at)
        summary = c.words(.summary)
    }

    /// The job as proposed runs a script: it says so, or it carries one. The card then shows that script.
    public var runsScript: Bool { kind == "script" || script?.isBlank == false }
}

/// A change to an approved tile that waits for the owner (`change` on a tile): the tile as proposed,
/// with every script it would run.
public struct TileChange: Decodable, Hashable, Sendable {
    public var title: String?
    public var scripts: [String]?
    public var by: String?
    public var at: String?
    var read = false

    enum CodingKeys: String, CodingKey { case title, scripts, by, at }

    public init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }
        read = true
        title = c.words(.title)
        scripts = try? c.decodeIfPresent([String].self, forKey: .scripts)
        by = c.words(.by)
        at = c.words(.at)
    }
}

private extension KeyedDecodingContainer {
    /// A field as text: a string that is not blank, without the blanks around it. Anything else is none.
    func words(_ key: Key) -> String? {
        whole(key)?.words
    }

    /// A string as it came, also empty: a task, a script.
    func whole(_ key: Key) -> String? { (try? decodeIfPresent(String.self, forKey: key)) ?? nil }
}

// A job is `Codable`, and so are the words of its buttons.
extension CardText: Encodable {
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(text)
    }
}

extension Job {
    /// The change that waits beside it while it runs on as approved. None on a job that was never
    /// approved: it waits whole, and its no removes it.
    public var staged: JobChange? { approved == false ? nil : change.flatMap { $0.read ? $0 : nil } }

    /// Whether a yes approves a script: the job runs one, or its waiting change makes it one or carries
    /// one. Such a job is answered on its card, where the script shows, and never by "Approve all".
    public var touchesScript: Bool { kind == "script" || staged?.runsScript == true }
}

extension Tile {
    /// The change that waits beside it while it works on as approved.
    public var staged: TileChange? { approved == false ? nil : change.flatMap { $0.read ? $0 : nil } }
}

extension DashboardState {
    /// Whether the Board draws a tile as waiting for the owner: it is in `pending` and was never
    /// approved. An approved tile whose change waits is in `pending` too, and works on.
    public func waits(_ tile: Tile) -> Bool { pending.contains { $0.id == tile.id && $0.staged == nil } }
}

/// What the card of a change draws in place of a body: the proposer's sentence, the scripts that go
/// above those that come, the text that goes struck above the one that comes, and what else changes.
public struct ChangeCard: Hashable, Sendable {
    /// What the change changes, in one sentence of whoever proposed it (`change-summary`). A closed
    /// card shows it in place of what goes and what comes, which a click brings.
    public var summary: String?
    /// The approved scripts, where the scripts change, and the scripts it would run after the yes.
    public var scriptsWas: [String] = []
    public var scripts: [String] = []
    /// The approved text, where the text changes, and the text after the yes ("" for none).
    public var textWas: String?
    public var text = ""
    /// What else changes, a line each: whether the owner hears of every run, and when a script job asks the AI.
    public var also: [String] = []
    /// Under it all: nothing stops while the card waits.
    public var line = ChangeCard.runsAsApproved

    public static let runsAsApproved = "Runs as you approved it until you answer."
    /// Under a change's sentence on a closed card: where the rest is, as the web page says it.
    public static let seeFull = "Click to see the full change"
    public static let keep = "Keep as it is"
    public static let approve = "Approve the change"
    /// In a job's row in the bot's settings: it runs as approved, and a change waits beside it.
    public static let waits = "A change waits for your OK"

    /// Whether the card shows what goes and what comes: always without a sentence, and with one once it is open.
    public func showsFull(open: Bool) -> Bool { open || summary == nil }

    /// The faint labels above the approved scripts and above the new ones, where the scripts change.
    public var wasLabel: String? { scriptsWas.isEmpty ? nil : scriptsWas.count == 1 ? "Approved script" : "Approved scripts" }
    public var nowLabel: String? { scriptsWas.isEmpty || scripts.isEmpty ? nil : scripts.count == 1 ? "New script" : "New scripts" }

    /// A script as its box shows it.
    static func shown(_ script: String) -> String { script.isBlank ? "(empty)" : script }
}

/// What "Approve all" does with what waits: it approves the jobs and memory changes a card shows in
/// words, and leaves every job and tile that runs a script for its own card. `label`: what the button
/// reads, counting what it approves ("Approve 3"); nil with fewer than two, and then there is no
/// button. `line`: what is left, named in one line; nil without the button, or when nothing is left.
public struct ApproveAll: Sendable {
    public let items: [NeedItem]
    public let label: String?
    public let line: String?

    /// `open`: the cards that wait and were not answered yet.
    public init(_ open: [NeedItem]) {
        items = open.filter { ($0.kind == .job && !$0.runsScript) || $0.memory?.withApproveAll == true }
        let left = open.compactMap { $0.kind == .job && $0.runsScript ? $0.job?.name : $0.kind == .tile ? $0.tile.map { "“\($0.title)”" } : nil }
        label = items.count >= 2 ? "Approve \(items.count)" : nil
        line = label == nil ? nil : Self.scriptsLeft(left)
    }

    /// "Disk check runs a script: approve it on its card." nil for none.
    static func scriptsLeft(_ names: [String]) -> String? {
        switch names.count {
        case 0: nil
        case 1: "\(names[0]) runs a script: approve it on its card."
        default: "\(names.dropLast().joined(separator: ", ")) and \(names[names.count - 1]) run scripts: approve them on their cards."
        }
    }
}

extension ConnectorCard {
    /// The question before "Always allow this action" answers, in the web page's words: it grants the
    /// action with any arguments.
    public static let alwaysQuestion = "Allow this exact connector action for this bot in future runs, with any arguments?"
    public static let alwaysYes = "Always allow"
}

extension NeedNotice {
    /// The Mac's notification category of its buttons: that of `actions`, or one of its own where the
    /// buttons read the server's words.
    public var category: String {
        guard no != nil || yes != nil else { return actions.rawValue }
        return "\(actions.rawValue)\(keeps ? "-keeps" : ""):\(yes ?? "")|\(no ?? "")"
    }
}

extension Store {
    /// The change that waits beside an approved job, from a server that keeps one there (`staged-changes`).
    func staged(_ job: Job) -> JobChange? { has(.stagedChanges) ? job.staged : nil }
    func staged(_ tile: Tile) -> TileChange? { has(.stagedChanges) ? tile.staged : nil }

    /// The words of a no button as the server sends them (`decline-words`); nil: the app's own.
    func said(_ words: CardText?) -> String? { has(.declineWords) ? words?.words : nil }

    /// The words of a change's buttons: the server's, or the app's own.
    private func buttons(no: CardText?, yes: CardText?) -> (no: String, yes: String) {
        (no?.words ?? ChangeCard.keep, yes?.words ?? ChangeCard.approve)
    }

    /// Who proposed a change, as its card's meta line ends.
    private static func changedBy(_ by: String?) -> String {
        by == "chief" ? "changed by the Chief" : by == "bot" ? "changed by itself" : "changed"
    }

    /// The tiles that wait for the owner, each once: those never approved (`pending`) and the approved
    /// ones with a change beside them, wherever the server lists those.
    var waitingTiles: [Tile] {
        guard has(.stagedChanges) else { return dashboard.pending }
        return dashboard.pending + dashboard.tiles.filter { t in t.staged != nil && !dashboard.pending.contains { $0.id == t.id } }
    }

    /// The card of a change to an approved job: "<name>: a change", the approved schedule and the new
    /// one, and what goes beside what comes. It is keyed by the change, by when it was proposed: a
    /// second change to the same job, proposed after the first was answered, is a card of its own.
    func changeCard(_ j: Job, _ c: JobChange, of bot: Bot, then: Then?) -> NeedItem {
        let was = j.schedule
        let now = c.when ?? was
        // After the yes it runs a script: the change says so or carries one, or it says nothing of it
        // and the approved job runs one.
        let script = c.runsScript || (c.kind == nil && j.kind == "script")
        let scriptNow = script ? c.script ?? j.script ?? "" : nil
        let prompt = c.prompt ?? j.prompt ?? ""
        let by = Self.changedBy(c.by)
        let renamed = c.name.flatMap { $0 == j.name ? nil : "renamed “\($0)”" }
        let meta = [now == was ? was : "now \(was) → \(now)", renamed, script ? "a script, no AI" : "uses AI", by].compactMap { $0 }.joined(separator: " · ")
        let asked = { (text: String) in script ? "Then the AI is asked: \(text)" : text }
        var card = ChangeCard(summary: has(.changeSummary) ? c.summary : nil)
        if j.kind == "script", let approved = j.script, approved != scriptNow { card.scriptsWas = [ChangeCard.shown(approved)] }
        if let scriptNow { card.scripts = [ChangeCard.shown(scriptNow)] }
        if let approved = j.prompt, !approved.isBlank, approved != prompt { card.textWas = asked(approved) }
        card.text = prompt.isBlank ? "" : asked(prompt)
        card.also = [
            Self.changed("Tells you", was: j.notify ?? "report-only", now: c.notify) { ["always": "after every run", "report-only": "only when it has something to report"][$0] ?? $0 },
            Self.changed("Asks the AI", was: j.aiWhen.flatMap { $0.isBlank ? nil : $0 }, now: script ? c.aiWhen : nil) {
                ["output": "only when it prints something", "failed": "only when it fails", "always": "every time it runs", "never": "never, just its output"][$0] ?? $0
            },
        ].compactMap { $0 }
        let words = buttons(no: j.no, yes: j.yes)
        return NeedItem(
            key: "job:\(j.id):change:\(c.at ?? "")", kind: .job, who: Who(id: bot.id, name: bot.name, color: bot.color), title: "\(j.name): a change", meta: meta,
            why: j.assessment, then: then, no: words.no, yes: words.yes, always: true, noSaid: true, change: card, runsScript: j.touchesScript,
            chat: (c.by ?? j.changedBy) == "chief" ? .chief : .bot(bot.id), job: j, botId: bot.id)
    }

    /// The card of a change to an approved tile: the scripts it runs today above those it would run. A
    /// change that lists no scripts shows none as proposed: the approved ones are never shown as what
    /// the yes would approve.
    func changeCard(_ t: Tile, _ c: TileChange, of bot: Bot?, then: Then?) -> NeedItem {
        let scripts = c.scripts ?? []
        let by = Self.changedBy(c.by)
        let renamed = c.title.flatMap { $0 == t.title ? nil : "renamed “\($0)”" }
        let meta = [t.section.flatMap { $0.isEmpty ? nil : $0 }, renamed, scripts.isEmpty ? nil : "a script, no AI", by].compactMap { $0 }.joined(separator: " · ")
        var card = ChangeCard(scripts: scripts.map(ChangeCard.shown))
        if t.itsScripts != scripts { card.scriptsWas = t.itsScripts.map(ChangeCard.shown) }
        let words = buttons(no: t.no, yes: t.yes)
        return NeedItem(
            key: "tile:\(t.id):change:\(c.at ?? "")", kind: .tile, who: bot.map { Who(id: $0.id, name: $0.name, color: $0.color) }, title: "\(t.title): a change", meta: meta,
            then: then, no: words.no, yes: words.yes, noSaid: true, change: card, runsScript: true,
            chat: (c.by ?? t.changedBy) == "bot" ? t.bot.map(ChatScope.bot) : .chief, tile: t)
    }

    /// "<label>: <was> → <now>" for a setting that changes, "<label>: <now>" for one that had none;
    /// nil when it stays.
    private static func changed(_ label: String, was: String?, now: String?, words: (String) -> String) -> String? {
        guard let now, now != was else { return nil }
        guard let was else { return "\(label): \(words(now))" }
        return "\(label): \(words(was)) → \(words(now))"
    }
}
