import Foundation
import Testing
@testable import BotDotKit

/// Milestone 6 on the Mac: a card names what it approves and says who carries on (docs/api.md, "What
/// follows a yes", "A changed bot", "An action in a connected app"). The cards as the server sends
/// them, read without a server; the suites below ask real botdot servers.
@MainActor
@Suite struct Cards {
    static let mail = ##"""
    { "id": "c1", "kind": "connector-action", "botId": "mailer", "bot": { "id": "mailer", "name": "Mailer", "color": "#378add" },
      "reason": "", "title": "Send email with Gmail?", "details": "Allow once applies to exactly these arguments.\n{\"recipient_email\":\"anna@example.com\"}",
      "rows": [{ "label": "To", "value": "anna@example.com" }, { "label": "Subject", "value": "" }, { "label": "Text", "value": "Hi Anna,\nI will be 20 minutes late." },
               { "label": "Is html", "value": "no" }, { "label": "Copies", "value": 2 }],
      "held": true, "yesOn": "card", "text": "Asks to send email with Gmail", "runId": "r1", "sentBy": { "a": 1 } }
    """##
    static let change = ##"""
    { "id": "c2", "kind": "bot-change", "botId": "news", "bot": { "id": "news", "name": "News Watcher", "color": "#1d9e75" },
      "by": "chief", "chatId": "chat1", "reason": "The Chief wants to change what it may do", "title": "Change News Watcher: web access and new rules?",
      "details": "allowedTools: Read, WebSearch\nsystemPrompt: Be brief.", "yesOn": "card",
      "parts": [{ "label": "What it may do", "now": "browse the web" }, { "label": "Computer", "now": "a computer of its own" },
                { "label": "Rules", "was": "Be thorough.", "now": "Be brief." }, { "label": "Main assignment", "was": "", "now": "Read the tech news." },
                { "label": "Connected apps", "now": "Gmail" }],
      "then": { "who": "chief", "text": "The Chief carries on in “Tech news” when you allow it.", "chatId": "chat1", "here": "The Chief carries on in this chat when you allow it.", "since": 7 } }
    """##
    static let permission = ##"""
    { "id": "c3", "kind": "permission", "botId": "coder", "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "permission": "bash",
      "what": { "label": "run commands", "hint": "it runs commands on its computer" }, "reason": "gh pr list",
      "then": { "who": "bot", "text": "It carries on with “Check the PRs” when you allow it." } }
    """##

    /// A store that holds these asks, as after `GET /api/asks`, on a server with Milestone 6 or one from before.
    func store(_ json: String..., old: Bool = false) throws -> Store {
        let store = Store()
        store.asks = try JSONDecoder().decode([Ask].self, from: Data("[\(json.joined(separator: ","))]".utf8))
        if !old { store.features = [Feature.askContinues.rawValue, Feature.connectorWaits.rawValue] }
        return store
    }
    func rows(_ item: NeedItem) -> [[String]] { item.rows.map { [$0.label, $0.value] } }
    func with(_ json: String, _ field: String) -> String { json.replacingOccurrences(of: #""held": true"#, with: field) }

    // MARK: an action in a connected app

    @Test func anActionInAConnectedAppIsShownAsRowsUnderTheServersTitle() throws {
        let item = try #require(try store(Self.mail).needs.first)
        #expect(item.title == "Send email with Gmail?")
        #expect(item.meta == "Mailer waits for your answer")
        // Every row, in the server's order, an empty value and a number too; the details are not drawn beside them.
        #expect(rows(item) == [["To", "anna@example.com"], ["Subject", ""], ["Text", "Hi Anna,\nI will be 20 minutes late."], ["Is html", "no"], ["Copies", "2"]])
        #expect(item.body.isEmpty)
        #expect(item.note == nil)
        #expect(item.then == nil) // its run waits: the yes lets that run go on
        #expect([item.no, item.yes] == ["Decline", "Allow once"])
        #expect(item.always)
        #expect(item.kind == .permission)
        #expect(try store(Self.mail).chatNeeds(.bot("mailer")).map(\.key) == ["ask:c1"])
    }

    @Test func aCardNamesEveryRowItApprovesAndAClosedOneStaysSmall() throws {
        let many = (0..<40).map { #"{ "label": "Extra \#($0)", "value": "value \#($0)" }"# }.joined(separator: ",")
        let ask = Self.mail.replacingOccurrences(of: #""rows": ["#, with: #""rows": [\#(many),"#)
        let item = try #require(try store(ask).needs.first)
        #expect(item.rows.count == 45)
        #expect(rows(item).first == ["Extra 0", "value 0"])
        #expect(rows(item).last == ["Copies", "2"])
        // Closed, the card draws the first of them; opened, all.
        #expect(NeedItem.closedRows == 3)
        #expect(item.shownRows(open: false).map(\.label) == ["Extra 0", "Extra 1", "Extra 2"])
        #expect(item.shownRows(open: true) == item.rows)
        // A yes approves every row, so it answers only where every row is drawn: on the closed card it
        // opens the card, and answers when it is clicked again.
        #expect(!item.yesAnswers(open: false))
        #expect(item.yesAnswers(open: true))
        // A card whose rows all fit is answered closed, as every card without rows is.
        let few = try #require(try store(Self.mail.replacingOccurrences(of: #"{ "label": "To", "value": "anna@example.com" }, { "label": "Subject", "value": "" }, "#, with: "")).needs.first)
        #expect(few.rows.count == 3)
        #expect(few.yesAnswers(open: false))
        #expect(try #require(try store(Self.permission).needs.first).yesAnswers(open: false))
    }

    @Test func anActionTooLongToShowInFullSaysSoAndCannotBeAllowedOnce() throws {
        let item = try #require(try store(with(Self.mail, #""held": true, "more": true"#)).needs.first)
        #expect(item.rows.count == 5) // the rows that fit, each whole
        #expect(item.note == "Too long to show in full.")
        #expect(item.body.isEmpty) // the details are as long as the action
        #expect(item.no == "Decline")
        #expect(item.yes == nil)
        #expect(item.always) // "Always allow this action" grants it with any arguments

        // Too long to show a single row: the line alone.
        let none = try #require(try store(#"{ "id": "c9", "kind": "connector-action", "title": "Send email with Gmail?", "details": "long", "rows": [], "more": true, "held": true }"#).needs.first)
        #expect(none.rows.isEmpty)
        #expect(none.body.isEmpty)
        #expect(none.note == "Too long to show in full.")
        #expect(none.yes == nil)
    }

    @Test func aPartThatIsNoTextLeavesTheCardOnItsDetails() throws {
        let details = "Allow once applies to exactly these arguments.\n{\"recipient_email\":\"anna@example.com\"}"
        for odd in [#"{ "label": "To", "value": { "name": "Anna" } }"#, #"{ "label": "To", "value": ["a"] }"#, #"{ "label": "To", "value": true }"#, #"{ "label": "To" }"#,
                    #"{ "label": "", "value": "x" }"#, #"{ "label": { "a": 1 }, "value": "x" }"#, #""a row""#, "null", "7"] {
            let ask = Self.mail.replacingOccurrences(of: #""rows": ["#, with: #""rows": [\#(odd),"#)
            let item = try #require(try store(ask).needs.first, "\(odd)")
            // With one row this app can't read the rows would show less than the yes approves.
            #expect(item.rows.isEmpty, "\(odd)")
            #expect(item.body == [details], "\(odd)")
            #expect(item.yes == "Allow once" && item.always, "\(odd)")
        }
        // Rows that are no list, and none at all: the details, as before.
        for none in [#""rows": "none", "held": true"#, #""rows": { "label": "To" }, "held": true"#] {
            let item = try #require(try store(with(Self.mail, none).replacingOccurrences(of: #""rows": [{"#, with: #""was": [{"#)).needs.first)
            #expect(item.rows.isEmpty && item.body == [details])
        }
    }

    @Test func rowsThatWereClippedTakeNoYes() throws {
        // The feed's short form marks a clipped row: its value is less than the action sends.
        let ask = Self.mail.replacingOccurrences(of: #"{ "label": "Is html", "value": "no" }"#, with: #"{ "label": "Is html", "value": "no…", "more": true }"#)
        let item = try #require(try store(with(ask, #""held": true, "more": true"#)).needs.first)
        #expect(item.rows.count == 5)
        #expect(item.body.count == 1) // the details under them
        #expect(item.note == nil)
        #expect(item.no == "Decline")
        #expect(item.yes == nil)
        #expect(!item.always)
    }

    @Test func theCardSaysWhetherItsRunStillWaits() throws {
        #expect(ConnectorCard.state(bot: "Mailer", held: true, stoppedAt: nil) == "Mailer waits for your answer")
        #expect(ConnectorCard.state(bot: "Mailer", held: false, stoppedAt: "2026-10-05T09:10:00.000Z", time: { _ in "09:10" }) == "Mailer stopped waiting at 09:10")
        // The server says neither, or a time this app can't read: the line the card has today.
        #expect(ConnectorCard.state(bot: "Mailer", held: nil, stoppedAt: "2026-10-05T09:10:00.000Z") == nil)
        #expect(ConnectorCard.state(bot: "Mailer", held: false, stoppedAt: nil) == nil)
        #expect(ConnectorCard.state(bot: "Mailer", held: false, stoppedAt: "soon") == nil)

        // A run that stopped waiting: a yes starts the bot again, and the card says so.
        let late = with(Self.mail, #""held": false, "stoppedAt": "2026-10-05T09:10:00.000Z", "reason": "to tell Anna", "then": { "who": "bot", "text": "It carries on when you allow it." }"#)
        let item = try #require(try store(late).needs.first)
        #expect(item.meta.hasPrefix("Mailer stopped waiting at "))
        #expect(item.then?.line() == "It carries on when you allow it.")
        #expect(item.yes == "Allow once")
        // `held` in quotes says nothing.
        let odd = try #require(try store(with(Self.mail, #""held": "true", "reason": "to tell Anna""#).replacingOccurrences(of: #""reason": "", "#, with: "")).needs.first)
        #expect(odd.meta == "to tell Anna")
    }

    // MARK: a changed bot

    @Test func aChangedBotNamesWhatChangesAndWhoCarriesOn() throws {
        let item = try #require(try store(Self.change).needs.first)
        #expect(item.title == "Change News Watcher: web access and new rules?")
        #expect(item.meta == "The Chief wants to change what it may do")
        #expect(item.parts == [
            ChangedPart(label: "What it may do", now: "browse the web"), ChangedPart(label: "Computer", now: "a computer of its own"),
            ChangedPart(label: "Rules", was: "Be thorough.", now: "Be brief."), ChangedPart(label: "Main assignment", was: "", now: "Read the tech news."),
            ChangedPart(label: "Connected apps", now: "Gmail"),
        ])
        #expect(item.body.isEmpty) // the parts stand in place of the details
        // What is switched on stands together as rows of one box; each changed text by itself.
        #expect(ChangedPart.groups(item.parts).map { $0.map(\.label) } == [["What it may do", "Computer"], ["Rules"], ["Main assignment"], ["Connected apps"]])
        #expect([item.no, item.yes] == ["Decline", "Approve"])
        #expect(!item.always)
        // The server's sentence as it is; in the Chief chat it speaks of, the one for that chat.
        #expect(item.then?.line() == "The Chief carries on in “Tech news” when you allow it.")
        #expect(item.then?.line(chiefChat: "chat1") == "The Chief carries on in this chat when you allow it.")
        #expect(item.then?.line(chiefChat: "chat2") == "The Chief carries on in “Tech news” when you allow it.")
    }

    @Test func aChangeTheChiefAskedForStandsInTheChiefsChatAsItsCard() throws {
        let own = Self.change.replacingOccurrences(of: #""by": "chief""#, with: #""by": "bot""#).replacingOccurrences(of: #""id": "c2""#, with: #""id": "c4""#)
        let store = try store(Self.change, own, Self.permission)
        #expect(store.needs.map(\.key) == ["ask:c2", "ask:c4", "ask:c3"]) // one card each in Needs you
        // Where the owner asked, and in the chat of the bot it changes. What the bot proposed itself: its own chat.
        #expect(store.chatNeeds(.chief).map(\.key) == ["ask:c2"])
        #expect(store.chatNeeds(.bot("news")).map(\.key) == ["ask:c2", "ask:c4"])
        #expect(store.chatNeeds(.bot("coder")).map(\.key) == ["ask:c3"])
    }

    @Test func theYesButtonOfAChangeThatOnlyGivesPermissionsReadsAllow() throws {
        let item = try #require(try store(Self.change.replacingOccurrences(of: #""yesOn": "card""#, with: #""yesOn": "card", "yes": " Allow ""#)).needs.first)
        #expect(item.yes == "Allow")
        let odd = try #require(try store(Self.change.replacingOccurrences(of: #""yesOn": "card""#, with: #""yesOn": "card", "yes": { "label": "Allow" }"#)).needs.first)
        #expect(odd.yes == "Approve")
    }

    @Test func aPartOfAChangeThisAppCannotReadLeavesTheCardOnItsDetails() throws {
        let details = "allowedTools: Read, WebSearch\nsystemPrompt: Be brief."
        for odd in [#"{ "label": "Rules", "was": ["Be thorough."], "now": "Be brief." }"#, #"{ "label": "Rules", "now": { "text": "Be brief." } }"#, #"{ "now": "Be brief." }"#, #"{ "label": "Rules" }"#, #""Rules""#] {
            let ask = Self.change.replacingOccurrences(of: #""parts": ["#, with: #""parts": [\#(odd),"#)
            let item = try #require(try store(ask).needs.first, "\(odd)")
            #expect(item.parts.isEmpty, "\(odd)")
            #expect(item.body == [details], "\(odd)")
            #expect(item.then != nil, "\(odd)") // the rest of the card is as it was
        }
        // A part with a field this app does not know, and a `was` of null, are read.
        let known = Self.change.replacingOccurrences(of: #""parts": ["#, with: #""parts": [{ "label": "Its computer's network", "was": null, "now": "your home network", "risk": "high" },"#)
        #expect(try #require(try store(known).needs.first).parts.first == ChangedPart(label: "Its computer's network", now: "your home network"))
    }

    // MARK: who carries on

    @Test func aCardSaysWhoCarriesOnInTheServersWords() throws {
        let item = try #require(try store(Self.permission).needs.first)
        #expect(item.title == "Let it run commands?")
        #expect(item.then?.line() == "It carries on with “Check the PRs” when you allow it.")
        #expect(item.then?.line(chiefChat: "chat1") == "It carries on with “Check the PRs” when you allow it.") // no chat of its own
        #expect([item.no, item.yes] == ["Decline", "Allow"]) // the buttons keep their words

        // A `then` without a sentence, or one that is no object: no line, and the asks are still read.
        for odd in [#"{ "who": "bot" }"#, #"{ "who": "bot", "text": "  " }"#, #"{ "text": 7 }"#, #""It carries on""#, "true", "[]", "null"] {
            let ask = Self.permission.replacingOccurrences(of: #"{ "who": "bot", "text": "It carries on with “Check the PRs” when you allow it." }"#, with: odd)
            let store = try store(ask, Self.change)
            #expect(store.needs.count == 2, "\(odd)")
            #expect(store.needs[0].then == nil, "\(odd)")
        }
    }

    @Test func aWaitingJobAndAWaitingTileSayWhoCarriesOn() throws {
        let then = #"{ "who": "chief", "text": "The Chief carries on in “Disks” when you allow it.", "chatId": "chat1", "here": "The Chief carries on in this chat when you allow it." }"#
        let store = try store()
        store.bots = try JSONDecoder().decode([Bot].self, from: Data(#"""
        [{ "id": "disks", "name": "Disk Keeper", "jobs": [{ "id": "j1", "name": "Disk check", "cron": "0 * * * *", "kind": "script", "script": "df -h", "approved": false,
           "createdBy": "chief", "chatId": "chat1", "askedAt": "2026-10-05T09:00:00.000Z", "then": \#(then) }] }]
        """#.utf8))
        store.dashboard = try JSONDecoder().decode(DashboardState.self, from: Data(#"""
        { "sections": [], "tiles": [], "suggestions": [], "pending": [{ "id": "t1", "kind": "value", "title": "Door", "changedBy": "chief", "tap": "none",
          "read": { "type": "script", "script": "cat /tmp/door-state" }, "then": \#(then) }] }
        """#.utf8))
        #expect(store.needs.map(\.kind) == [.job, .tile])
        for item in store.needs {
            #expect(item.then?.line() == "The Chief carries on in “Disks” when you allow it.")
            #expect(item.then?.line(chiefChat: "chat1") == "The Chief carries on in this chat when you allow it.")
        }
        store.features = []
        #expect(store.needs.map(\.then) == [nil, nil])
    }

    @Test func anAnsweredCardSaysWhatTheYesStarted() throws {
        let item = try #require(try store(Self.permission).needs.first)
        #expect(item.decided(yes: true, started: CarriesOn(text: "it carries on")) == "Allowed · it carries on")
        #expect(item.decided(yes: true, started: CarriesOn(text: "the Chief carries on")) == "Allowed · the Chief carries on")
        // Without it the word stands alone; a no starts nothing.
        #expect(item.decided(yes: true) == "Allowed")
        #expect(item.decided(yes: true, started: CarriesOn(text: "")) == "Allowed")
        #expect(item.decided(yes: false, started: CarriesOn(text: "it carries on")) == "Declined")

        // The answer of a yes, as the server sends it; one this app can't read still went.
        #expect(Answered.of(Data(#"{ "ok": true, "carriesOn": { "who": "bot", "text": "it carries on when it is free" }, "queued": 2 }"#.utf8)).carriesOn?.text == "it carries on when it is free")
        for none in [#"{ "ok": true }"#, #"{ "ok": true, "carriesOn": "it carries on" }"#, #"{ "ok": true, "carriesOn": { "who": "bot" } }"#, #"{ "carriesOn": { "text": 1 } }"#, "[]", "not json"] {
            #expect(Answered.of(Data(none.utf8)).carriesOn == nil, "\(none)")
        }
    }

    // MARK: a server without these features

    @Test func aServerWithoutTheseFeaturesShowsTheCardsAsBefore() throws {
        // The fields are there all the same (a server could send some without saying so): the app asks
        // `features` before it uses them.
        let store = try store(Self.mail, Self.change, Self.permission, old: true)
        #expect(!store.has(.askContinues) && !store.has(.connectorWaits))
        let (mail, change, permission) = (store.needs[0], store.needs[1], store.needs[2])
        // An action in a connected app: its title and its details, with both yes buttons.
        #expect(mail.title == "Send email with Gmail?")
        #expect(mail.meta == "")
        #expect(mail.body == ["Allow once applies to exactly these arguments.\n{\"recipient_email\":\"anna@example.com\"}"])
        #expect(mail.rows.isEmpty && mail.note == nil && mail.then == nil)
        #expect([mail.no, mail.yes] == ["Decline", "Allow once"])
        #expect(mail.always)
        // A changed bot: its details, "Approve", and only in the chat of its bot.
        #expect(change.body == ["allowedTools: Read, WebSearch\nsystemPrompt: Be brief."])
        #expect(change.parts.isEmpty && change.then == nil)
        #expect([change.no, change.yes] == ["Decline", "Approve"])
        #expect(store.chatNeeds(.chief).isEmpty)
        #expect(store.chatNeeds(.bot("news")).map(\.key) == ["ask:c2"])
        // A permission: no line of who carries on.
        #expect(permission.then == nil)
        #expect(permission.body == ["It runs commands on its computer. It can't until you allow it; you can change this in its settings."])

        // Each feature by itself.
        store.features = [Feature.connectorWaits.rawValue]
        #expect(store.needs[0].rows.count == 5 && store.needs[1].parts.isEmpty && store.needs[2].then == nil)
        store.features = [Feature.askContinues.rawValue]
        #expect(store.needs[0].rows.isEmpty && store.needs[1].parts.count == 5 && store.needs[2].then != nil)
    }

    // MARK: a run that waits

    @Test func aRunThatWaitsForTheOwnerSaysSoUntilTheEventThatEndsTheWait() async throws {
        let store = try store()
        func feed(_ event: String, _ data: String) async { await store.handle(ServerSentEvent(event: event, data: data)) }
        let chat = "bot:mailer"
        await feed("opening_line", #"{ "chat": "bot:mailer", "botId": "mailer", "runId": "r1", "text": "Writing to Anna" }"#)
        #expect(!store.waitsForOk(chat, run: "r1"))
        #expect(OpeningLine.status(store.openingLine(of: chat), working: true, waiting: store.waitsForOk(chat, run: "r1")) == "Writing to Anna")

        await feed("run_waits", #"{ "chat": "bot:mailer", "botId": "mailer", "runId": "r1", "waitingFor": "ok" }"#)
        #expect(store.waitsForOk(chat, run: "r1"))
        #expect(!store.waitsForOk(chat, run: "r2") && !store.waitsForOk("bot:coder", run: "r1"))
        #expect(OpeningLine.status(store.openingLine(of: chat), working: true, waiting: true) == "Waiting for your OK")

        // The event without `waitingFor`: the wait is over, and the line comes back as it was.
        await feed("run_waits", #"{ "chat": "bot:mailer", "botId": "mailer", "runId": "r1" }"#)
        #expect(!store.waitsForOk(chat, run: "r1"))
        #expect(OpeningLine.status(store.openingLine(of: chat), working: true, waiting: store.waitsForOk(chat, run: "r1")) == "Writing to Anna")

        // The run's end ends its wait too, and it waits for nothing afterwards.
        await feed("run_waits", #"{ "chat": "bot:mailer", "botId": "mailer", "runId": "r1", "waitingFor": "ok" }"#)
        #expect(store.waitsForOk(chat, run: "r1"))
        await feed("run_finished", #"{ "id": "r1", "botId": "mailer", "status": "success" }"#)
        #expect(!store.waitsForOk(chat, run: "r1"))
        await feed("run_waits", #"{ "chat": "bot:mailer", "botId": "mailer", "runId": "r1", "waitingFor": "ok" }"#)
        #expect(!store.waitsForOk(chat, run: "r1"))

        // Something it waits for that this app does not know, and an event it can't read: no wait.
        for odd in [#"{ "chat": "bot:mailer", "runId": "r2", "waitingFor": "login" }"#, #"{ "chat": "bot:mailer", "runId": "r2", "waitingFor": true }"#, #"{ "chat": "bot:mailer", "waitingFor": "ok" }"#, "not json"] {
            await feed("run_waits", odd)
            #expect(!store.waitsForOk(chat, run: "r2"), "\(odd)")
        }
    }

    @Test func aServerWhoseRunsDoNotWaitNeverSaysWaiting() async throws {
        let store = try store(old: true)
        store.features = [Feature.askContinues.rawValue]
        await store.handle(ServerSentEvent(event: "run_waits", data: #"{ "chat": "bot:mailer", "botId": "mailer", "runId": "r1", "waitingFor": "ok" }"#))
        #expect(!store.waitsForOk("bot:mailer", run: "r1"))
        #expect(OpeningLine.status(nil, working: true) == "Working") // the status line, as before
    }

    @Test func theRunsListSaysWhichRunWaits() throws {
        let runs = try JSONDecoder().decode([RunSummary].self, from: Data(#"""
        [{ "id": "r1", "botId": "mailer", "status": "running", "waitingFor": "ok" }, { "id": "r2", "botId": "mailer", "status": "running" },
         { "id": "r3", "botId": "mailer", "status": "success", "waitingFor": "ok" }, { "id": "r4", "botId": "mailer", "status": "running", "waitingFor": { "a": 1 } }]
        """#.utf8))
        #expect(runs.map(\.waitsForOk) == [true, false, false, false])

        var lines = OpeningLines()
        let began = lines.sync([.init(chat: "bot:mailer", run: "r1", text: nil, waits: true)], scope: "bot:")
        #expect(began && lines.waits("bot:mailer", run: "r1"))
        // A list in which it no longer waits, or is no longer there, ends the wait.
        let ended = lines.sync([.init(chat: "bot:mailer", run: "r1", text: nil)], scope: "bot:")
        #expect(ended && !lines.waits("bot:mailer", run: "r1"))
        let again = lines.sync([], scope: "bot:")
        #expect(!again)
    }
}

/// The same against real botdot test servers and the stand-in Claude.
@MainActor
@Suite struct CardsOnAServer {
    @MainActor final class Heard { var events: [String] = [] }

    /// A store connected to that server, once the feed's start is over: it reads the server's features
    /// again, after which a test may set them as an older server's.
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        let heard = Heard()
        store.onEvent = { name, _ in heard.events.append(name) }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { heard.events.contains("hello") }
        // Events are handled one after the other: once a later one is heard, the feed's start is over.
        _ = try await server.makeBot("Bystander")
        try await eventually("the feed's start to be over") { heard.events.contains("bots") }
        return store
    }

    static let bash: [String: Any] = ["tool_name": "Bash", "tool_use_id": "t1", "tool_input": ["command": "gh pr list", "description": "List open pull requests"]]

    /// A run of that bot that ends refused a command, and its card once the run is over.
    func refused(_ server: TestServer, _ store: Store, _ id: String, _ prompt: String) async throws -> NeedItem {
        try server.refuse([Self.bash])
        try await server.runToEnd(id, prompt)
        try server.refuse([])
        await store.reloadAll()
        return try #require(store.chatNeeds(.bot(id)).first { $0.kind == .permission })
    }

    @Test func aBotCarriesOnAfterAllowAndTheCardSaysSoBeforeAndAfter() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Coder")
        try await server.api("bots/\(id)", method: "PUT", body: ["allowedTools": ["Read"]])
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.has(.askContinues) && store.has(.connectorWaits)) // read from the server's `features`

        let card = try await refused(server, store, id, "Check the PRs")
        #expect(card.title == "Let it run commands?")
        #expect(card.then?.line() == "It carries on with “Check the PRs” when you allow it.")
        let said = try await store.decide(card, yes: true)
        #expect(said.carriesOn?.text == "it carries on")
        #expect(card.decided(yes: true, started: said.carriesOn) == "Allowed · it carries on")
        try await eventually("it to be allowed") { !store.needs.contains { $0.kind == .permission } }
        // The server started the bot again itself: a run that goes on from the one that stopped.
        try await eventuallyAsync("the run that carries on") {
            let runs = try await server.api("runs") as? [[String: Any]]
            return runs?.contains { $0["botId"] as? String == id && $0["continues"] is String } == true
        }
    }

    @Test func againstAServerWithoutAskContinuesTheCardAndItsAnswerAreAsBefore() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Coder")
        try await server.api("bots/\(id)", method: "PUT", body: ["allowedTools": ["Read"]])
        let store = try await connected(server)
        defer { store.disconnect() }
        store.features = [] // from here the app takes it for a botdot server from before Milestone 6

        // The test server still sends `then` and `carriesOn`, which such an app does not look at.
        let card = try await refused(server, store, id, "Check the PRs")
        #expect(card.ask?.then?.line() != nil)
        #expect(card.then == nil)
        let said = try await store.decide(card, yes: true)
        #expect(said.carriesOn == nil)
        #expect(card.decided(yes: true, started: said.carriesOn) == "Allowed")
    }

    @Test func aChangeTheChiefAskedForInAChatIsACardThereAndAYesGivesTheChiefItsTurn() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Reader")
        try await server.api("bots/\(id)", method: "PUT", body: ["allowedTools": ["Read"]])
        let chat = try await server.chiefChat(about: "Give Reader the web")
        let store = try await connected(server)
        defer { store.disconnect() }
        try await server.api("bots/\(id)", method: "PUT", body: ["allowedTools": ["Read", "WebSearch", "WebFetch"]], asChief: true, chiefChat: chat)

        try await eventually("the card in the Chief's chat") { !store.chatNeeds(.chief).isEmpty }
        let card = try #require(store.chatNeeds(.chief).first)
        #expect(card.ask?.kind == "bot-change")
        #expect(card.who?.name == "Reader")
        #expect(card.title == "Let Reader browse the web?")
        #expect(card.parts == [ChangedPart(label: "What it may do", now: "browse the web")])
        #expect(card.body.isEmpty)
        #expect([card.no, card.yes] == ["Decline", "Allow"])
        // One card: in the Chief's chat, in the chat of the bot it changes, and in Needs you.
        #expect(store.chatNeeds(.bot(id)).map(\.key) == [card.key])
        #expect(store.needs.map(\.key) == [card.key])
        let title = try #require(store.chiefChats.first { $0.id == chat }?.title)
        #expect(card.then?.line() == "The Chief carries on in “\(title)” when you allow it.")
        #expect(card.then?.line(chiefChat: chat) == "The Chief carries on in this chat when you allow it.")

        let said = try await store.decide(card, yes: true)
        #expect(said.carriesOn?.text == "the Chief carries on")
        try await eventually("the card to go from both") { store.needs.isEmpty && store.chatNeeds(.chief).isEmpty }
    }

    @Test func aScriptJobAndATileTheChiefAskedForSayThatTheChiefCarriesOn() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Disk Keeper")
        let chat = try await server.chiefChat(about: "Set up the disk watcher")
        let store = try await connected(server)
        defer { store.disconnect() }
        try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": "Disk check", "kind": "script", "cron": "0 * * * *", "script": "df -h", "assessment": "A clear rule: no AI needed."], asChief: true, chiefChat: chat)
        try await server.api("dashboard/tiles", method: "POST", body: ["kind": "value", "title": "Door", "bot": id, "read": ["type": "script", "script": "cat /tmp/door-state"]], asChief: true, chiefChat: chat)

        try await eventually("both to wait") { Set(store.chatNeeds(.chief).map(\.kind)) == [.job, .tile] }
        for card in store.chatNeeds(.chief) {
            #expect(card.then?.line(chiefChat: chat) == "The Chief carries on in this chat when you allow it.", "\(card.title)")
        }
        let job = try #require(store.needs.first { $0.kind == .job })
        let said = try await store.decide(job, yes: true)
        #expect(job.decided(yes: true, started: said.carriesOn) == "Approved · the Chief carries on")
    }

    @Test func anActionInAConnectedAppWaitsInItsRunAndItsCardShowsItsRows() async throws {
        let app = try ConnectedApp()
        let server = try TestServer(env: app.env)
        try await app.connect(server)
        let bot = try await server.api("bots", method: "POST", body: ["name": "Mailer", "emoji": "🧪", "prompt": "Send the mail.", "connectors": ["gmail"]]) as? [String: Any]
        let id = try #require(bot?["id"] as? String)
        try server.hold()
        let store = try await connected(server)
        defer { store.disconnect() }
        store.openBot(id)
        try await store.sendToBot("Tell Anna I am late")
        try await eventually("it to work") { store.botChat.runs.last?.status == "running" }
        let run = try #require(store.botChat.runs.last?.id)
        let chat = "bot:\(id)"
        #expect(!store.waitsForOk(chat, run: run))

        // The bot wants to send an email: nothing is sent, and its run waits for the answer.
        let extra = (0..<35).map { #""extra_\#($0)": "value \#($0)""# }.joined(separator: ", ")
        let mail = #"{ "app": "gmail", "action": "GMAIL_SEND_EMAIL", "arguments": { "recipient_email": "anna@example.com", "subject": "Running late", "body": "Hi Anna,\nI will be 20 minutes late.", \#(extra) } }"#
        let told = try await server.connectorTool("run", json: mail)
        #expect(told["waits"] as? Bool == true)
        try await eventually("its line to say that it waits") { store.waitsForOk(chat, run: run) }
        try await eventually("the card") { store.chatNeeds(.bot(id)).contains { $0.ask?.kind == "connector-action" } }
        let card = try #require(store.chatNeeds(.bot(id)).first)
        #expect(card.title == "Send email with Gmail?")
        #expect(card.meta == "Mailer waits for your answer")
        // A row for every argument, in the bot's order, every value in full; a closed card draws the first.
        #expect(card.rows.count == 38)
        #expect(card.rows.prefix(4).map { [$0.label, $0.value] } == [["To", "anna@example.com"], ["Subject", "Running late"], ["Text", "Hi Anna,\nI will be 20 minutes late."], ["Extra 0", "value 0"]])
        #expect(card.rows.last.map { [$0.label, $0.value] } == ["Extra 34", "value 34"])
        #expect(card.body.isEmpty && card.note == nil)
        #expect(card.then == nil) // the same run goes on after the yes
        #expect([card.no, card.yes] == ["Decline", "Allow once"])
        #expect(card.always)

        // "Allow once": the wait is over with the event that says so, and the run goes on.
        let said = try await store.decide(card, yes: true)
        #expect(said.carriesOn == nil)
        try await eventually("the wait to end") { !store.waitsForOk(chat, run: run) }
        let now = try await server.api("runs/\(run)") as? [String: Any]
        #expect(now?["status"] as? String == "running")

        // An action too long to show in full: the rows that fit, a line that says so, and no "Allow once".
        let many = (0..<201).map { #""field_\#($0)": "value \#($0)""# }.joined(separator: ", ")
        try await server.connectorTool("run", json: #"{ "app": "gmail", "action": "GMAIL_SEND_EMAIL", "arguments": { \#(many) } }"#)
        try await eventually("the second card") { store.chatNeeds(.bot(id)).contains { $0.note != nil } }
        let long = try #require(store.chatNeeds(.bot(id)).first)
        #expect(long.rows.count == 200)
        #expect(long.note == "Too long to show in full.")
        #expect(long.yes == nil && long.always && long.body.isEmpty)
        try await eventually("its line to say that it waits again") { store.waitsForOk(chat, run: run) }

        // An app that takes this for a server whose runs do not wait says nothing of it.
        store.features = [Feature.askContinues.rawValue]
        try await store.loadBots()
        #expect(!store.waitsForOk(chat, run: run))
        #expect(store.chatNeeds(.bot(id)).first?.rows.isEmpty == true)
        store.features = [Feature.askContinues.rawValue, Feature.connectorWaits.rawValue]
        try await store.loadBots()
        #expect(store.waitsForOk(chat, run: run)) // the runs list says it too

        // The run's end ends the wait.
        await store.stopRun(run)
        try await eventually("the wait to end with the run") { !store.waitsForOk(chat, run: run) }
    }}

/// What was left after the catch-up (#379): cards and tiles as the web page and the Android app draw them.
@MainActor
@Suite struct CardsLeftOver {
    func store(_ json: String) throws -> Store {
        let store = Store()
        store.asks = try JSONDecoder().decode([Ask].self, from: Data("[\(json)]".utf8))
        return store
    }

    // A skill a bot wrote is not installed from anywhere: the server's line, the whole text, Approve.
    @Test func aSkillABotWroteShowsItsWholeTextAndIsApproved() throws {
        let written = ##"""
        { "id": "a9", "kind": "skill", "botId": "b1", "bot": { "id": "b1", "name": "Scout", "color": "#1d9e75" }, "written": true, "url": "",
          "text": "Wants to keep a skill it wrote: “flight-search”", "reason": "I search flights the same way every week",
          "skill": { "name": "flight-search", "description": "Find flights", "files": 1, "exists": false, "instructions": "1. Open the site\n2. Compare" } }
        """##
        let item = try #require(try store(written).needs.first)
        #expect(item.kind == .skill && item.title == "Wants to keep a skill it wrote: “flight-search”")
        #expect(item.meta == "I search flights the same way every week")
        #expect(item.body == ["1. Open the site\n2. Compare"])
        #expect([item.no, item.yes] == ["Decline", "Approve"])
        #expect(item.decided(yes: true) == "Approved" && item.decided(yes: false) == "Declined")
        // Without the server's line the app has one of its own, and an empty text says so.
        let bare = try #require(try store(#"{ "id": "a9", "kind": "skill", "written": true, "skill": { "name": "x" } }"#).needs.first)
        #expect(bare.title == "Wants to keep a skill it wrote: “x”" && bare.body == ["(empty)"])
        // A skill from a link is installed, as before.
        let linked = try #require(try store(#"{ "id": "a8", "kind": "skill", "url": "https://skills.sh/a/b", "skill": { "name": "x" } }"#).needs.first)
        #expect(linked.title == "Install the skill \"x\"?" && linked.yes == "Install" && linked.decided(yes: true) == "Installed")
    }

    // A tile's card lists every script the server lists, those of its named reads and actions too.
    @Test func aTileListsTheScriptsOfItsNamedReadsAndActions() throws {
        func tile(_ more: String) throws -> Tile {
            try JSONDecoder().decode(Tile.self, from: Data(##"{ "id": "t1", "kind": "value", "title": "Door", "read": { "type": "script", "script": "cat door" }\##(more) }"##.utf8))
        }
        #expect(try tile(#", "scripts": ["cat door", "cat temp", "open door"]"#).itsScripts == ["cat door", "cat temp", "open door"])
        // A server without the list: the app gathers them, the named ones by their names.
        let gathered = try tile(#", "reads": { "temp": { "type": "script", "script": "cat temp" }, "air": { "type": "ai" } }, "actions": { "open": { "type": "script", "script": "open door" } }"#)
        #expect(gathered.itsScripts == ["cat door", "cat temp", "open door"])
        #expect(try tile("").itsScripts == ["cat door"])
    }

    // A suggested tile: "Board", who carries on from a server that says it, and the answered words.
    @Test func aSuggestedTileSaysWhoCarriesOnAndWhereItWent() throws {
        let store = Store()
        store.dashboard = try JSONDecoder().decode(DashboardState.self, from: Data(##"""
        { "sections": [], "tiles": [], "pending": [], "suggestions": [{ "id": "s1", "bot": "b1", "reason": "You ask for it daily",
          "then": { "who": "bot", "text": "Scout carries on when you add it." }, "tile": { "kind": "value", "title": "Fares" } }] }
        """##.utf8))
        var item = try #require(store.chatNeeds(.bot("b1")).first)
        #expect(item.title == "Put “Fares” on your Board?" && item.then == nil) // a server that does not say it
        store.features = [Feature.proposalCarriesOn.rawValue]
        item = try #require(store.chatNeeds(.bot("b1")).first)
        #expect(item.then?.line() == "Scout carries on when you add it.")
        #expect(item.decided(yes: true, started: CarriesOn(text: "it carries on")) == "On your Board · it carries on")
        #expect(item.decided(yes: false) == "Not added")
    }

    @Test func aTileThatAsksABusyBotSaysItWaits() {
        #expect(Tile.asked("Scout", queued: false) == "Asked Scout" && Tile.asked(nil, queued: false) == "Asked its bot")
        #expect(Tile.asked("Scout", queued: true) == "Scout will do it when it is free" && Tile.asked(nil, queued: true) == "Its bot will do it when it is free")
    }
}
