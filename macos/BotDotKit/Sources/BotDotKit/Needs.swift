import Foundation

/// A login or a payment a bot (or the Chief) asks for (`GET /api/vault/requests`).
public struct LoginRequest: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    /// "login" or "card".
    public var kind: String?
    public var botId: String?
    public var bot: Who?
    /// "chief" when the Chief asked.
    public var from: String?
    public var site: String
    public var name: String?
    public var username: String?
    public var reason: String?
    public var amount: String?
    public var card: Card?
    /// Saved logins for that site, and whether this bot may use them already.
    public var existing: [Existing]?
    /// Logins saved for another website (docs/api.md "Login requests"). Answering with one of them
    /// adds this request's site to that login's additional hosts. A server that sends none: no list.
    public var others: [Other]?
    /// The group it was asked in, for a login a member asked for in its turn (see `group`, Groups.swift).
    public var groupId: CardText?
    public var groupName: CardText?

    public struct Existing: Decodable, Hashable, Sendable {
        public let id: String
        public var name: String?
        public var username: String?
        public var allowed: Bool?
    }
    public struct Other: Decodable, Identifiable, Hashable, Sendable {
        public let id: String
        public var name: String?
        public var username: String?
        public var site: String?
    }
    public struct Card: Decodable, Hashable, Sendable {
        public var name: String?
        public var brand: String?
        public var last4: String?
    }
}

/// "Use another saved login" in the sheet of a login request: the logins saved for another website,
/// which of them stay for what is typed in the search of a long list, and the second question before
/// one of them is used on the requested host. The sheet draws what these say; `loginRequestOthers`,
/// `loginRequestMatches` and `loginRequestConfirm` in `public/app.js` are the web page's side.
public enum OtherLogins {
    /// A list longer than this gets a search field and scrolls inside the sheet.
    public static let searchAbove = 6
    public static let open = "Use another saved login"
    public static let heading = "Saved for another website"
    public static let search = "Search"
    public static let noMatch = "No saved login matches."
    public static let use = "Use it"
    public static let back = "Back"
    public static let lead = "Use the login"
    public static let on = "on"
    public static let sending = "Letting it use the login…"
    /// How long the confirmation's button waits before it takes a click: the second click of a
    /// double click on the list's row answers nothing.
    public static let confirmAfter: Duration = .milliseconds(600)

    /// The other logins a request offers: none for a card request, and none from a server that sends none.
    public static func of(_ r: LoginRequest) -> [LoginRequest.Other] { r.kind == "card" ? [] : r.others ?? [] }

    public static func hasSearch(_ others: [LoginRequest.Other]) -> Bool { others.count > searchAbove }

    /// Whether a login stays for what was typed: every typed word is in its name, username or
    /// website, whatever the case. Nothing typed keeps every login.
    public static func matches(_ e: LoginRequest.Other, _ typed: String) -> Bool {
        let hay = [e.name, e.username, e.site].map { ($0 ?? "").lowercased() }
        return typed.lowercased().split(whereSeparator: \.isWhitespace).allSatisfy { w in hay.contains { $0.contains(w) } }
    }

    /// The rows left for what was typed, in the server's order.
    public static func shown(_ others: [LoginRequest.Other], _ typed: String) -> [LoginRequest.Other] { others.filter { matches($0, typed) } }

    /// The login the second question is about, while the server still offers it.
    public static func picked(_ others: [LoginRequest.Other], _ id: String?) -> LoginRequest.Other? { id.flatMap { id in others.first { $0.id == id } } }

    public struct Confirm: Equatable, Sendable {
        public let login: String
        public let savedFor: String
        public let host: String
        public let warning: String
        public let yes: String
    }

    /// What the confirmation says before `e` is used on the host `r` asks for, by the bot named `by`.
    public static func confirm(_ r: LoginRequest, _ e: LoginRequest.Other, by: String) -> Confirm {
        let site = e.site ?? ""
        return Confirm(
            login: e.name ?? "",
            savedFor: site.isEmpty ? "saved without a website" : "saved for \(site)",
            host: r.site,
            warning: "Its password will also be used on \(r.site), by \(by). Only continue if \(r.site) really takes this login: web pages can try to trick bots into asking.",
            yes: "Use it on \(r.site)")
    }
}

/// A permission or a skill a bot (or the Chief) asked for, or a tool the Chief asks to install for a
/// bot (`GET /api/asks`).
public struct Ask: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    /// "permission", "skill", "tool", "bot-change" or "connector-action".
    public var kind: String
    public var botId: String?
    public var bot: Who?
    public var permission: String?
    public var what: What?
    public var url: String?
    public var skill: Skill?
    /// A skill its bot wrote, which waits for approval (`memory-cards`): `text` is the server's
    /// line for it, and the skill has `instructions`, the whole text a yes would save.
    public var written: CardFlag?
    public var text: CardText?
    public var forBots: [Who]?
    public var reason: String?
    public var title: String?
    public var details: String?
    /// A tool to install (docs/api.md "A tool to install"): its card as the server wrote it, with
    /// `title`. `warning` only for a tool from a link; `facts` are rows of label and value, in order.
    /// These are read as the web page reads them (public/tool-card.js), so one this app can't read
    /// costs that field and not the whole list of asks.
    public var meta: CardText?
    public var body: CardText?
    public var warning: CardText?
    public var facts: CardFacts?
    /// Where the owner's yes is given (docs/api.md): "card" means on this card and nowhere else, so
    /// the ask's notification has Decline and no yes button. Today a tool from a link has it. Absent,
    /// or a value this app does not know: answered from the notification too, as before.
    public var yesOn: CardText?
    /// What a yes would start (docs/api.md "What follows a yes"); a changed bot: who proposed it
    /// ("chief" or "bot"), what changes and what its yes button reads; an action in a connected app:
    /// what it sends, whether it is too long to show in full (`more`), whether its run still waits
    /// (`held`) and since when it does not. See Cards.swift.
    public var then: Then?
    public var by: CardText?
    public var parts: ChangedParts?
    public var yes: CardText?
    public var rows: CardRows?
    public var more: CardFlag?
    public var held: CardFlag?
    public var stoppedAt: CardText?
    /// The group it was asked in, for a card asked in a turn (see `group`, Groups.swift).
    public var groupId: CardText?
    public var groupName: CardText?

    public struct What: Decodable, Hashable, Sendable {
        public var label: String?
        public var hint: String?
    }
    public struct Skill: Decodable, Hashable, Sendable {
        public var name: String?
        public var description: String?
        public var files: Int?
        public var exists: Bool?
        public var instructions: String?
    }
    /// One row of a tool's card: "Version", "2.101.0".
    public struct Fact: Decodable, Hashable, Sendable {
        public var label: String
        public var value: String

        public init(label: String, value: String) {
            self.label = label
            self.value = value
        }

        enum CodingKeys: String, CodingKey { case label, value }
        /// Never fails: a row that is no object, or has neither, is an empty row, which is not drawn.
        public init(from decoder: Decoder) throws {
            let c = try? decoder.container(keyedBy: CodingKeys.self)
            label = c.flatMap { try? $0.decodeIfPresent(CardText.self, forKey: .label) }?.text ?? ""
            value = c.flatMap { try? $0.decodeIfPresent(CardText.self, forKey: .value) }?.text ?? ""
        }
    }
}

extension Ask {
    /// `yesOn` of an ask whose yes is given on its card.
    public static let yesOnCard = "card"
}

/// A field of a card the server hands out as data (ADR 003): a string, or a number as it is written.
/// Anything else (a list, an object) is no text, "". Reading it never fails.
public struct CardText: Decodable, Hashable, Sendable {
    public let text: String

    public init(from decoder: Decoder) throws {
        let c = try? decoder.singleValueContainer()
        if let s = try? c?.decode(String.self) {
            text = s.trimmingCharacters(in: .whitespacesAndNewlines)
        } else if let n = try? c?.decode(Int.self) {
            text = String(n)
        } else if let n = try? c?.decode(Double.self), n.isFinite {
            text = String(n)
        } else {
            text = ""
        }
    }
}

/// The rows of facts on a card: every row that has a label or a value, also labels this app never
/// saw. Anything that is no list has no rows. Reading it never fails.
public struct CardFacts: Decodable, Hashable, Sendable {
    public let rows: [Ask.Fact]

    public init(from decoder: Decoder) throws {
        var rows: [Ask.Fact] = []
        if var list = try? decoder.unkeyedContainer() {
            while !list.isAtEnd, let row = try? list.decode(Ask.Fact.self) { rows.append(row) }
        }
        self.rows = rows.filter { !$0.label.isEmpty || !$0.value.isEmpty }
    }
}

/// Bitwarden, as far as Needs you cares (`GET /api/vault/bitwarden`).
public struct BitwardenStatus: Decodable, Hashable, Sendable {
    public var installed: Bool?
    public var configured: Bool?
    public var unlocked: Bool?
    public var email: String?
    /// A bot waiting for it to be unlocked.
    public var wantedBy: Who?
}

/// One thing waiting for the owner's OK, as a card: on the Needs you page, and at the end of the
/// chat it belongs to (public/app.js needsItems and needCardHTML).
public struct NeedItem: Identifiable, Hashable, Sendable {
    public enum Kind: Hashable, Sendable { case login, pay, bitwarden, job, memory, permission, skill, tool, plan, tile, tileSuggestion }

    public let key: String
    public let kind: Kind
    /// Whose it is: the figure and the name on the card.
    public let who: Who?
    public let title: String
    public let meta: String
    /// Longer text: a job's task or script, a memory note, a skill's description, a plan.
    public var body: [String] = []
    /// A job's reason for needing AI or not.
    public var why: String?
    /// A tool from a link: what the card warns of, between its body and its facts. The app marks it.
    public var warning: String?
    /// A tool's rows of label and value, as the server ordered them.
    public var facts: [Ask.Fact] = []
    /// What the yes approves, as rows of label and value (an action in a connected app): a closed card
    /// draws the first `closedRows` of them, an opened one every row and every value in full.
    public var rows: [Ask.Fact] = []
    /// What a changed bot changes, in the server's order (`ChangedPart.groups` is how they are drawn).
    public var parts: [ChangedPart] = []
    /// One line of the app's own under the body ("Too long to show in full.").
    public var note: String?
    /// Who carries on after the yes, in the server's sentence. nil: the yes changes the setting only.
    public var then: Then?
    /// A changed bot the Chief asked for: its card stands in the Chief's chat too.
    public var byChief = false
    /// The words on the buttons: no, yes (and "Always approve" for jobs).
    public var no: String?
    public var yes: String?
    public var always = false
    /// The no button reads the server's words, which say what it does ("Decline and remove", "Keep
    /// as it is"): nothing is asked before it is sent.
    public var noSaid = false
    /// A change to an approved job or tile: what its card draws in place of a body (see Changes.swift).
    public var change: ChangeCard?
    /// A yes approves a script: it is given on this card, where the script shows, never by "Approve all".
    public var runsScript = false
    /// Where it belongs: a bot's chat, the Chief's, a group's, or neither (Bitwarden, plans).
    public var chat: ChatScope?
    /// The group it was asked in, by its name now; nil for a card of a bot's own chat or the Chief's
    /// (`Store.placed`, Groups.swift).
    public var group: GroupRef?

    public var loginRequest: LoginRequest?
    public var job: Job?
    public var botId: String?
    public var ask: Ask?
    public var memory: MemoryChange?
    public var planChat: String?
    public var tile: Tile?
    public var suggestion: TileSuggestion?

    public var id: String { key }

    /// How many rows a closed card draws, as the web page's: the card stays small when an action has many.
    public static let closedRows = 3

    /// What a decided card says, faded, until you leave. A tool's Install answers at once and the
    /// install goes on by itself, so its card says "Installing": the result arrives as a Chief message.
    /// `started`: what the server says the yes started, printed after the word ("Allowed · it carries on").
    /// `said`: the server's own words for the answered card ("Declined and removed"), in place of the
    /// app's word, except after "Always approve".
    public func decided(yes: Bool, always: Bool = false, started: CarriesOn? = nil, said: String? = nil) -> String {
        let word = (always ? nil : said) ?? word(yes: yes, always: always)
        guard yes, let started, !started.text.isEmpty else { return word }
        return "\(word) · \(started.text)"
    }

    private func word(yes: Bool, always: Bool) -> String {
        if always { return ask?.kind == "connector-action" ? "Always allowed" : "Always approved" }
        if kind == .tileSuggestion { return yes ? "On your Board" : "Not added" }
        if !yes { return "Declined" }
        switch kind {
        case .permission: return ask?.kind == "permission" ? "Allowed" : "Approved"
        case .skill: return ask?.written?.value == true ? "Approved" : "Installed"
        case .tool: return "Installing"
        case .plan: return "Approved · the Chief is on it"
        default: return "Approved"
        }
    }
}

/// What the notification of a card says, and the buttons under it.
public struct NeedNotice: Hashable, Sendable {
    /// The card's key (`NeedItem.key`).
    public let key: String
    public let title: String
    public let body: String
    public let actions: Actions
    /// What its buttons read where the card's words are the server's ("Decline and remove", "Keep as
    /// it is", "Approve the change"); nil: the words of `actions`. `keeps`: its no removes nothing.
    public var no: String? = nil
    public var yes: String? = nil
    public var keeps = false

    /// The buttons under it: a yes with Decline, or Decline alone for an ask whose yes is given on
    /// its card (`Ask.yesOn`). The Mac's notification categories have these names.
    public enum Actions: String, Sendable { case approve, allow, install, decline, none = "" }
}

/// A chat: a bot's, the Chief's, or a group's (by the group's id).
public enum ChatScope: Hashable, Sendable {
    case bot(String)
    case chief
    case group(String)
}

extension Store {
    /// Everything waiting for the owner, in the web's order.
    public var needs: [NeedItem] {
        var out: [NeedItem] = []
        // Who carries on after a yes: only from a server that says it does (`ask-continues`).
        let says = has(.askContinues)
        let then = { (t: Then?) in says ? t.flatMap { $0.line() == nil ? nil : $0 } : nil }
        for r in loginRequests {
            let chief = r.from == "chief" && !bots.contains { $0.id == r.botId }
            let who = chief ? Who.chief : r.bot
            let scope: ChatScope? = r.from == "chief" ? .chief : r.botId.map(ChatScope.bot)
            if r.kind == "card" {
                out.append(NeedItem(key: "req:\(r.id)", kind: .pay, who: who, title: "Pay on \(r.site)", meta: r.amount ?? "", yes: "Review", chat: scope, loginRequest: r))
            } else {
                out.append(NeedItem(key: "req:\(r.id)", kind: .login, who: who, title: "A login for \(r.site)", meta: r.reason ?? "", yes: "Add it", chat: scope, loginRequest: r))
            }
        }
        if let bw = bitwarden, bw.configured == true, bw.unlocked != true {
            out.append(NeedItem(key: "bitwarden", kind: .bitwarden, who: bw.wantedBy, title: "Bitwarden is locked", meta: "Bots can't use your saved logins until you unlock it.", yes: "Unlock"))
        }
        for bot in bots {
            for j in bot.jobs ?? [] where j.approved == false || staged(j) != nil {
                // A change to an approved job: a card of its own, beside the job that runs on (Changes.swift).
                if let change = staged(j) { out.append(changeCard(j, change, of: bot, then: then(j.then))); continue }
                let script = j.kind == "script"
                let changer = j.changedBy ?? j.createdBy
                let by = changer == "bot" ? "added by itself" : changer == "chief" ? "added by the Chief" : "changed"
                var body: [String] = []
                if script, let s = j.script { body.append(s) }
                if let p = j.prompt, !p.isEmpty { body.append(p) }
                out.append(NeedItem(
                    key: "job:\(j.id)", kind: .job, who: Who(id: bot.id, name: bot.name, color: bot.color), title: j.name,
                    meta: "\(j.schedule) · \(script ? "a script, no AI" : "uses AI") · \(by)",
                    body: body, why: j.assessment, then: then(j.then), no: said(j.no) ?? "Decline", yes: "Approve", always: true,
                    noSaid: said(j.no) != nil, runsScript: j.touchesScript,
                    chat: changer == "chief" ? .chief : .bot(bot.id), job: j, botId: bot.id))
            }
        }
        out.append(contentsOf: memoryCards) // the server's words (see Memory.swift)
        for a in asks {
            let who = a.bot ?? (a.kind == "skill" ? Who.chief : nil)
            let scope: ChatScope? = a.kind == "skill" && a.botId == nil ? .chief : a.botId.map(ChatScope.bot)
            if a.kind == "connector-action", has(.connectorWaits) {
                // The server's title, whether its run still waits, and the action's fields as rows. Without
                // rows: the details, as before. Rows that were clipped are not all a yes approves: the
                // details stand under them and Decline is all the card offers. An action too long to show
                // in full has the rows that fit and a line that says so; it cannot be allowed once.
                let rows = a.rows?.rows ?? []
                let cut = !rows.isEmpty && a.rows?.cut == true
                let long = a.more?.value == true && !cut
                let details = a.details ?? ""
                let state = ConnectorCard.state(bot: who?.name ?? "The bot", held: a.held?.value, stoppedAt: a.stoppedAt?.text)
                out.append(NeedItem(key: "ask:\(a.id)", kind: .permission, who: who, title: a.title ?? "Approve this change?", meta: state ?? a.reason ?? "",
                                    body: !long && (rows.isEmpty || (cut && !details.isEmpty)) ? [details] : [], rows: rows, note: long ? ConnectorCard.tooLong : nil, then: then(a.then),
                                    no: "Decline", yes: cut || long ? nil : "Allow once", always: !cut, chat: scope, ask: a))
            } else if a.kind == "bot-change", says {
                // What changes as the server's `parts`; without them, the details. The yes button reads
                // the server's word where it sends one ("Allow", for a change that only gives permissions).
                let parts = a.parts?.list ?? []
                let yes = a.yes?.words ?? "Approve"
                out.append(NeedItem(key: "ask:\(a.id)", kind: .permission, who: who, title: a.title ?? "Approve this change?", meta: a.reason ?? "",
                                    body: parts.isEmpty ? [a.details ?? ""] : [], parts: parts, then: then(a.then), byChief: a.by?.text == "chief",
                                    no: "Decline", yes: yes, chat: scope, ask: a))
            } else if a.kind == "bot-change" || a.kind == "connector-action" {
                out.append(NeedItem(key: "ask:\(a.id)", kind: .permission, who: who, title: a.title ?? "Approve this change?", meta: a.reason ?? "",
                                    body: [a.details ?? ""], no: "Decline", yes: a.kind == "connector-action" ? "Allow once" : "Approve", always: a.kind == "connector-action", chat: scope, ask: a))
            } else if a.kind == "permission" {
                let hint = (a.what?.hint ?? "").prefix(1).uppercased() + (a.what?.hint ?? "").dropFirst()
                out.append(NeedItem(key: "ask:\(a.id)", kind: .permission, who: who, title: "Let it \(a.what?.label ?? a.permission ?? "do this")?", meta: a.reason ?? "",
                                    body: ["\(hint). It can't until you allow it; you can change this in its settings."], then: then(a.then), no: "Decline", yes: "Allow", chat: scope, ask: a))
            } else if a.kind == "tool" {
                // A tool the Chief asks to install for a bot: the server's own words, none from here
                // but the two buttons. It is that bot's, and the Chief's who asked (chatNeeds).
                let text = { (t: CardText?) in t?.words }
                out.append(NeedItem(key: "ask:\(a.id)", kind: .tool, who: who, title: a.title ?? "", meta: text(a.meta) ?? "", body: text(a.body).map { [$0] } ?? [],
                                    warning: text(a.warning), facts: a.facts?.rows ?? [], then: then(a.then), no: "Decline", yes: "Install", chat: scope, ask: a))
            } else if a.kind == "skill", a.written?.value == true {
                // A skill the bot wrote itself: the server's line, the whole text, and Approve, as
                // on the web page and the Android app. Nothing is downloaded, so nothing is "installed".
                let text = a.skill?.instructions?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                out.append(NeedItem(key: "ask:\(a.id)", kind: .skill, who: who, title: a.text?.words ?? "Wants to keep a skill it wrote: “\(a.skill?.name ?? "")”", meta: a.reason ?? "",
                                    body: [text.isEmpty ? "(empty)" : text], then: then(a.then), no: "Decline", yes: "Approve", chat: scope, ask: a))
            } else {
                let k = a.skill
                let site = (a.url ?? "").replacingOccurrences(of: #"^https?://(www\.)?"#, with: "", options: .regularExpression)
                let forBots = a.forBots?.isEmpty == false ? " · for \(a.forBots!.compactMap(\.name).joined(separator: ", "))" : ""
                var text = k?.description?.isEmpty == false ? k!.description! : "No description."
                if (k?.files ?? 0) > 1 { text += " (\(k!.files!) files)" }
                if k?.exists == true { text += " It replaces your skill of the same name." }
                if let r = a.reason, !r.isEmpty { text += "\n\nWhy: \(r)" }
                out.append(NeedItem(key: "ask:\(a.id)", kind: .skill, who: who, title: "Install the skill \"\(k?.name ?? "")\"?", meta: site + forBots, body: [text], then: then(a.then), no: "Decline", yes: "Install", chat: scope, ask: a))
            }
        }
        // A dashboard tile with a script: it runs on the botdot server's computer, so it waits for you.
        for t in waitingTiles {
            let b = bots.first { $0.id == t.bot }
            // A change to an approved tile: a card of its own, beside the tile that works on (Changes.swift).
            if let change = staged(t) { out.append(changeCard(t, change, of: b, then: then(t.then))); continue }
            let scripts = t.itsScripts
            out.append(NeedItem(key: "tile:\(t.id):\(scripts.joined().count)", kind: .tile, who: b.map { Who(id: $0.id, name: $0.name, color: $0.color) },
                                title: "Put “\(t.title)” on your Board?",
                                meta: "\(t.section?.isEmpty == false ? "\(t.section!) · " : "")a script, no AI · \(t.changedBy == "bot" ? "added by itself" : "added by the Chief")",
                                body: scripts, then: then(t.then), no: said(t.no) ?? "Decline", yes: "Approve", runsScript: true, chat: t.changedBy == "bot" ? t.bot.map(ChatScope.bot) : .chief, tile: t))
        }
        for c in chiefChats {
            guard let w = c.waiting else { continue }
            out.append(NeedItem(key: "sug:\(c.id)", kind: .plan, who: w.from, title: "A plan for the Chief: \(c.title ?? "")", meta: "Nothing happens until you approve it",
                                body: [w.text ?? ""], no: "Decline", yes: "Approve", planChat: c.id))
        }
        return out.map(placed) // a card asked in a group is that group's chat's (see Groups.swift)
    }

    /// The notifications of what waits, one per card. A tool's is the bot's name over the line the
    /// server's feed gives for it ("Asks to install gh"): the app builds no text of its own. The card
    /// comes with the list of asks and the line with the feed, in either order, so a tool's
    /// notification waits until the feed has named its ask. One the feed has no line for, or has not
    /// named a while after its card was read (`asksOverdue`), is announced like any other card, by
    /// its title; the line replaces that when it does arrive.
    /// An ask whose yes is given on its card (`yesOn`, today a tool from a link) has Decline and no
    /// yes button, whatever its kind and whichever text it is announced by: a click opens Needs you.
    public var needNotices: [NeedNotice] {
        needs.compactMap { item in
            if item.kind == .memory { return memoryNotice(item) }
            let actions: NeedNotice.Actions = switch item.kind {
            case _ where item.ask?.yesOn?.text == Ask.yesOnCard: .decline
            case .job where item.change != nil && item.runsScript: .decline // a changed script is approved on its card
            case .job where item.runsScript && has(.needsText): .decline // and so is a new one, where the feed says so for the phone (`yesOn`)
            case .job, .memory, .plan: .approve
            case .permission: .allow
            case .skill, .tool: .install
            default: .none
            }
            if item.kind == .tool, let id = item.ask?.id {
                if let line = askLines[id], !line.isEmpty {
                    return NeedNotice(key: item.key, title: item.asker() ?? Who.chief.name ?? "", body: line, actions: actions)
                }
                if askLines[id] == nil && !asksOverdue.contains(id) { return nil }
            }
            let who = item.asker().map { "\($0): " } ?? ""
            // A job whose buttons read the server's words: its notification's read them too.
            let worded = item.kind == .job && item.noSaid
            return NeedNotice(key: item.key, title: "Waiting for your OK", body: who + item.title, actions: actions,
                              no: worded ? item.no : nil, yes: worded && actions == .approve ? item.yes : nil, keeps: worded && item.change != nil)
        }
    }

    /// What the feed says of the waiting asks: the `asks` event (`{ list }`), or `hello` (`{ asks }`).
    /// Each tool ask has `text`, the line its notification shows under the bot's name. After `hello`
    /// the server replays the events this app missed, older lists among them, so a list only adds:
    /// the line of an ask that still waits is kept, whatever a later list leaves out.
    func heardAsks(_ data: Data, hello: Bool = false) {
        struct Brief: Decodable { var id: String?; var text: String? }
        struct Event: Decodable { var list: [Brief]? }
        struct Hello: Decodable { var asks: [Brief]? }
        let heard = hello ? (try? JSON.decoder.decode(Hello.self, from: data))?.asks : (try? JSON.decoder.decode(Event.self, from: data))?.list
        guard let heard else { return } // a list this app can't read names nothing
        let waiting = Set(asks.map(\.id))
        var lines = askLines.filter { waiting.contains($0.key) }
        for b in heard { if let id = b.id { lines[id] = b.text ?? lines[id] ?? "" } }
        askLines = lines
    }

    /// Notes which tool asks the feed has not named, and since when. One that is still unnamed when
    /// the asks are read again `askWait` seconds later no longer waits for its line: the feed is
    /// down, stuck, or says it in a way this app can't read. Everything is read again every minute.
    func noteUnnamedAsks(now: Date = Date()) {
        let unnamed = Set(asks.filter { $0.kind == "tool" && askLines[$0.id] == nil }.map(\.id))
        askUnnamedSince = askUnnamedSince.filter { unnamed.contains($0.key) }
        for id in unnamed where askUnnamedSince[id] == nil { askUnnamedSince[id] = now }
        let overdue = unnamed.filter { now.timeIntervalSince(askUnnamedSince[$0] ?? now) >= askWait }
        if overdue != asksOverdue { asksOverdue = overdue }
    }

    /// The cards at the end of a chat: a bot's own jobs, permissions, memory changes and logins in
    /// its chat; what the Chief set up or asked for in the Chief's. A tool is in both: the Chief
    /// asked for it, and it is installed for that bot. So is a changed bot that the Chief asked for:
    /// the card is where the owner asked, and in the chat of the bot it changes. A card asked in a
    /// group stands at the end of that group's chat, and in no other.
    public func chatNeeds(_ scope: ChatScope) -> [NeedItem] {
        // Tiles a bot suggested show in its chat too (on the dashboard they're faded tiles).
        var suggested: [NeedItem] = []
        if case .bot(let id) = scope {
            suggested = dashboard.suggestions.filter { $0.bot == id }.map { s in
                NeedItem(key: "tsug:\(s.id)", kind: .tileSuggestion, who: nil, title: "Put “\(s.tile.title)” on your Board?", meta: s.reason ?? "",
                         body: s.tile.scripts ?? [], then: has(.proposalCarriesOn) ? s.then.flatMap { $0.line() == nil ? nil : $0 } : nil, no: "No", yes: "Add", chat: scope, suggestion: s)
            }
        }
        return suggested + needs.filter { ($0.chat == scope || ($0.group == nil && ($0.kind == .tool || $0.byChief) && scope == .chief)) && $0.kind != .bitwarden && $0.kind != .plan }
    }

    /// Approves or declines a card (jobs can also be approved for good: "Always approve"). Returns
    /// what the server says of the answer: what a yes started (`carriesOn`), from a server that says
    /// who carries on (`ask-continues`), and its own words for an answered job or tile (`text`), from
    /// a server that words them (`decline-words`, `staged-changes`).
    @discardableResult
    public func decide(_ item: NeedItem, yes: Bool, always: Bool = false) async throws -> Answered {
        guard let api else { return Answered() }
        let said = try await answer(item, yes: yes, always: always, api: api)
        if item.kind == .memory { return Answered(text: said.text) } // what its card reads now, for a yes and a no
        if item.kind == .tileSuggestion { return said } // its own feature decides (Dashboard.swift)
        let words = (item.kind == .job || item.kind == .tile) && (has(.declineWords) || has(.stagedChanges))
        return Answered(carriesOn: yes && has(.askContinues) ? said.carriesOn : nil, text: words ? said.text : nil)
    }

    private func answer(_ item: NeedItem, yes: Bool, always: Bool, api: API) async throws -> Answered {
        var said = Answered()
        struct Approve: Encodable { let approve: Bool; var always: Bool? = nil }
        struct Yes: Encodable { let yes: Bool; var always: Bool = false }
        struct Text: Encodable { let text: String }
        switch item.kind {
        case .job:
            guard let j = item.job, let bot = item.botId else { break }
            said = Answered.of(try await api.data("bots/\(bot)/jobs/\(j.id)/approve", method: "POST", body: Approve(approve: yes, always: always)))
            try await loadBots()
        case .permission, .skill, .tool:
            guard let a = item.ask else { break }
            said = Answered.of(try await api.data("asks/\(a.id)", method: "POST", body: Yes(yes: yes, always: always)))
            await loadNeeds()
        case .memory:
            guard let m = item.memory else { break }
            said = Answered.of(try await api.data("memory/pending/\(m.id)", method: "POST", body: Approve(approve: yes)))
            await loadNeeds()
        case .plan:
            guard let chat = item.planChat else { break }
            if yes { try await api.send("chief/chats/\(chat)/messages", body: Text(text: Self.planApproval)) } else { try await api.send("chief/chats/\(chat)/dismiss") }
            try await loadChiefChats()
        case .login, .pay:
            guard let r = item.loginRequest else { break }
            if yes, r.kind == "card" { try await answer(r, ["action": "approve"]) } else if !yes { try await declineRequest(r) }
        case .tile:
            guard let t = item.tile else { break }
            let data = try JSONSerialization.data(withJSONObject: ["approve": yes])
            said = Answered.of(try await api.sendJSON("dashboard/tiles/\(t.id)/approve", body: data))
            await loadDashboard(quiet: true)
        case .tileSuggestion:
            guard let s = item.suggestion else { break }
            said = try await answer(s, add: yes)
        case .bitwarden:
            break
        }
        return said
    }

    /// What Approve sends to answer a bot's plan for the Chief (the server knows it).
    public static let planApproval = "Approved. Go ahead."

    /// Saves a new login for a login request; the password goes straight into the vault (or
    /// Bitwarden) and never to the AI. A locked Bitwarden needs its master password too.
    public func saveLogin(_ r: LoginRequest, username: String, password: String, name: String, insecureTls: Bool, unlockPassword: String?) async throws {
        struct Save: Encodable { let action = "save"; let name: String; let username: String; let password: String; let insecureTls: Bool; let unlockPassword: String? }
        guard let api else { return }
        try await api.send("vault/requests/\(r.id)", body: Save(name: name, username: username, password: password, insecureTls: insecureTls, unlockPassword: unlockPassword))
        await loadNeeds()
    }

    /// Lets the bot use a login already in the vault.
    public func allowLogin(_ r: LoginRequest, loginId: String) async throws {
        try await answer(r, ["action": "allow", "loginId": loginId])
    }

    public func declineRequest(_ r: LoginRequest) async throws {
        try await answer(r, ["action": "decline"])
    }

    /// Allows a card: for this run, card and site, for 15 minutes.
    public func approvePayment(_ r: LoginRequest) async throws {
        try await answer(r, ["action": "approve"])
    }

    private func answer(_ r: LoginRequest, _ body: [String: String]) async throws {
        guard let api else { return }
        try await api.send("vault/requests/\(r.id)", body: body)
        await loadNeeds()
    }

    /// Unlocks Bitwarden with the master password, which botdot keeps only in memory.
    public func unlockBitwarden(_ password: String) async throws -> Int {
        guard let api else { return 0 }
        struct Unlock: Encodable { let password: String }
        struct Unlocked: Decodable { let moved: Int? }
        let r: Unlocked = try await api.send("vault/bitwarden/unlock", body: Unlock(password: password))
        await loadNeeds()
        return r.moved ?? 0
    }

    /// Reads again everything that can wait for the owner.
    func loadNeeds() async {
        guard let api else { return }
        async let requests: [LoginRequest]? = try? api.get("vault/requests")
        async let asks: [Ask]? = try? api.get("asks")
        async let memory: [MemoryChange]? = try? api.get(Memory.waiting(cards: has(.memoryCards)))
        async let bw: BitwardenStatus? = try? api.get("vault/bitwarden")
        if let r = await requests { loginRequests = r }
        if let a = await asks { self.asks = a }
        noteUnnamedAsks()
        if let m = await memory { memoryPending = m }
        if let b = await bw { bitwarden = b }
    }
}
