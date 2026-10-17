import Foundation
import Testing
@testable import BotDotKit

/// Milestone 9 on the Mac: memory has no screen. What a bot kept, corrected or forgot is a chip under
/// its reply when an older server sends it, and a change that must wait is a card, both in the server's
/// words (docs/api.md, "The contract" and "What a run learned"). The current server sends no chip of a
/// done change (ADR 024). The chips and the cards as the server sends them, read without a server; the
/// suite below asks real botdot servers.
@MainActor
@Suite struct MemoryChips {
    static let all: Set<String> = [Feature.memoryChips.rawValue, Feature.memoryCards.rawValue, Feature.memoryForget.rawValue]

    /// A run with these `learned` items, as `GET /api/runs` lists it.
    func run(_ learned: String) throws -> RunSummary {
        let json = #"[{ "id": "r1", "botId": "cook", "status": "success", "result": "Noted.", "learned": [\#(learned)] }]"#
        return try #require(try JSON.decoder.decode([RunSummary].self, from: Data(json.utf8)).first)
    }
    func store(_ features: Set<String> = all) -> Store {
        let store = Store()
        store.features = features
        return store
    }
    func lines(_ learned: String, _ features: Set<String> = all) throws -> [String] { store(features).chips(of: try run(learned)).map(\.text) }

    @Test func aChipSaysWhatWasKeptAndWhereInTheServersWords() throws {
        let long = "Remembered for all bots until Sun 11 Oct: In Berlin this week, at the hotel on the corner of the long street with the long name, so plan around that"
        #expect(try lines(#"""
            { "kind": "memory", "text": "pnpm for JavaScript", "chip": "Remembered: Package manager: pnpm for JavaScript", "at": "2026-10-07T09:00:00.000Z" },
            { "kind": "memory-shared", "text": "In Berlin", "chip": "\#(long)" },
            { "kind": "memory", "text": "Svelte", "chip": "Updated: Front end: Svelte (was: React)" },
            { "kind": "forgot", "text": "1 note", "chip": "Forgot 1 note" },
            { "kind": "memory-pending", "text": "x", "chip": "Asked to forget for good: 1 note and 2 chats (waiting for your OK)" },
            { "kind": "memory-removed", "text": "x", "chip": "Removed: Redis for the cache" },
            { "kind": "skill-pending", "text": "x", "chip": "Asked to add the skill weekly-roundup (waiting for your OK)" }
            """#) == [
            "🧠 Remembered: Package manager: pnpm for JavaScript",
            "🧠 \(long)", // whole: the app cuts nothing off the server's line and adds no word
            "🧠 Updated: Front end: Svelte (was: React)",
            "🧹 Forgot 1 note",
            "⏳ Asked to forget for good: 1 note and 2 chats (waiting for your OK)",
            "🧠 Removed: Redis for the cache",
            "⏳ Asked to add the skill weekly-roundup (waiting for your OK)",
        ])
    }

    @Test func aChipOfAKindTheAppDoesNotKnowIsShownAndBreaksNothing() throws {
        // A kind from a newer server, an item whose fields are of another type, and entries that are no item at all.
        let run = try run(#"""
            { "kind": "memory-merged", "text": "2 notes", "chip": "Merged 2 notes about Berlin", "into": { "id": "n1" } },
            { "kind": "team", "text": "Joined the group Kitchen" },
            { "kind": 7, "text": ["a"], "chip": { "line": "x" } },
            "a line", null, 3,
            { "kind": "memory", "text": 12, "chip": "Remembered: Twelve" }
            """#)
        #expect(run.result == "Noted.") // the reply is still read
        let chips = store().chips(of: run)
        #expect(chips.map(\.text) == ["🧠 Merged 2 notes about Berlin", "🧠 Joined the group Kitchen", "🧠 Remembered: Twelve"])
        #expect(chips.allSatisfy { $0.opens == nil })
    }

    @Test func anItemWithoutTheServersLineIsDrawnFromItsKindAndTextAsBefore() throws {
        // A job and a connected app have no `chip`; neither has a note in a run from before the chips.
        #expect(try lines(#"""
            { "kind": "job", "text": "Added job Morning news" }, { "kind": "connector", "text": "Used Gmail: send email" },
            { "kind": "instructions", "text": "Proposed changing its rules; waiting for your approval" },
            { "kind": "memory", "text": "The owner is vegetarian." }, { "kind": "memory-shared", "text": "Lives in Ghent" }, { "kind": "forgot", "text": "The old address" },
            { "kind": "memory", "text": "" }, { "kind": "memory", "chip": "   " }
            """#) == ["⏰ Added job Morning news", "🔌 Used Gmail: send email", "✏️ Proposed changing its rules; waiting for your approval",
                      "🧠 Remembered: The owner is vegetarian.", "🧠 Remembered for all bots: Lives in Ghent", "🧹 Forgot: The old address"])
    }

    @Test func aChipAboutANoteOpensNothing() throws {
        let chips = store().chips(of: try run(#"""
            { "kind": "memory", "chip": "Remembered: pnpm" }, { "kind": "memory-shared", "chip": "Remembered for all bots: Brussels" }, { "kind": "forgot", "chip": "Forgot 1 note" },
            { "kind": "memory-pending", "chip": "Asked to change what you said: pnpm (waiting for your OK)" },
            { "kind": "job", "text": "Added job Morning news" }, { "kind": "skill", "chip": "Created skill weekly-roundup" }, { "kind": "skill-updated", "chip": "Updated skill weekly-roundup" },
            { "kind": "instructions", "text": "Proposed changing its rules" }, { "kind": "connector", "text": "Used Gmail: send email" }
            """#))
        // Memory has no screen: only a job, a skill, its instructions and a connected app have a place to open.
        #expect(chips.map(\.opens) == [nil, nil, nil, nil, .jobs, .settings, .settings, .settings, .settings])
    }

    @Test func aServerWithoutMemoryChipsShowsNoChipAboutMemory() throws {
        let learned = #"""
            { "kind": "memory", "text": "The owner is vegetarian.", "chip": "Remembered: The owner is vegetarian." }, { "kind": "memory-shared", "text": "Lives in Ghent" },
            { "kind": "forgot", "text": "1 note" }, { "kind": "memory-pending", "text": "Asked to add to the shared memory: x" },
            { "kind": "job", "text": "Added job Morning news" }, { "kind": "skill", "text": "Created skill weekly-roundup", "chip": "Created skill weekly-roundup: it kept doing this by hand" }
            """#
        // What is no chip about memory stays as it was: a job, and a skill from its `text`.
        #expect(try lines(learned, []) == ["⏰ Added job Morning news", "✦ Created skill weekly-roundup"])
        #expect(try lines(learned, [Feature.memoryCards.rawValue, Feature.memoryForget.rawValue]) == ["⏰ Added job Morning news", "✦ Created skill weekly-roundup"])
        #expect(try lines(learned, [Feature.memoryChips.rawValue]).count == 6)
    }

    @Test func theChiefsChipNamesThePlaceInTheServersWords() throws {
        // An action of the Chief's reply (docs/api.md, "The Chief's memory"): `text` whole, about no bot.
        let json = #"{ "role": "chief", "text": "Noted.", "actions": [{ "kind": "memory", "text": "Remembered for Coder and Reviewer: Prefers TypeScript", "notes": ["a1", "b2"] }] }"#
        let action = try #require(try JSON.decoder.decode(ChiefMessage.self, from: Data(json.utf8)).actions?.first)
        #expect(action.text == "Remembered for Coder and Reviewer: Prefers TypeScript")
        #expect(action.botId == nil && action.runId == nil) // it opens nothing
    }
}

@MainActor
@Suite struct MemoryCards {
    static let shared = ##"""
    { "id": "p1", "action": "add", "owner": "_shared", "noteId": null, "text": "The owner lives in Ghent.", "topic": "home", "source": "outside", "by": "surfer", "runId": "r1", "botId": "surfer",
      "reason": "", "at": "2026-10-07T09:00:00.000Z", "current": null, "bot": { "id": "surfer", "name": "Web Surfer", "emoji": "🧪", "color": "#378add" },
      "title": "Add to the shared memory", "meta": "after reading outside content", "yes": "Approve", "no": "Decline" }
    """##
    static let change = ##"""
    { "id": "p2", "action": "edit", "owner": "coder", "noteId": "n1", "text": "Front end: Svelte", "topic": "", "source": "bot", "by": "coder", "runId": "r2", "botId": "coder",
      "reason": "the owner switched", "at": "2026-10-07T09:05:00.000Z", "current": { "id": "n1", "text": "Front end: React", "source": "owner" },
      "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "guarded": true,
      "title": "Change what you said", "meta": "in a run you did not start", "yes": "Change it", "no": "Keep it" }
    """##
    static let removal = ##"""
    { "id": "p3", "action": "remove", "owner": "coder", "noteId": "n2", "text": "", "botId": "coder", "at": "2026-10-07T09:06:00.000Z", "current": { "id": "n2", "text": "Uses Redis" },
      "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "guarded": true,
      "title": "Remove what you said", "meta": "in a run you did not start", "yes": "Remove it", "no": "Keep it" }
    """##
    static let forget = ##"""
    { "id": "p4", "action": "erase", "owner": "coder", "noteId": "n3", "text": "The gate code is MAGNOLIA · 2 chats", "botId": "coder", "at": "2026-10-07T09:07:00.000Z", "current": null,
      "notes": [{ "id": "n3", "text": "The gate code is MAGNOLIA" }], "runs": [{ "runId": "r3", "at": "2026-10-07T08:00:00.000Z", "asked": "My gate code is MAGNOLIA." }],
      "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "guarded": true,
      "title": "Forget for good", "meta": "after reading outside content", "yes": "Forget for good", "no": "Keep" }
    """##
    static let chiefs = ##"""
    { "id": "p5", "action": "erase", "owner": "chief", "text": "Ask before creating bots", "by": "chief", "botId": null, "source": "outside", "at": "2026-10-07T09:08:00.000Z",
      "bot": { "id": "chief", "name": "Chief of Staff", "emoji": "", "color": "#d85a30" }, "guarded": true,
      "title": "Forget for good", "meta": "in a run you did not start", "yes": "Forget for good", "no": "Keep" }
    """##

    /// A store that holds these waiting changes, as after `GET /api/memory/pending?guarded=1`.
    func store(_ json: String..., features: Set<String> = MemoryChips.all) throws -> Store {
        let store = Store()
        store.memoryPending = try JSON.decoder.decode([MemoryChange].self, from: Data("[\(json.joined(separator: ","))]".utf8))
        store.features = features
        return store
    }

    @Test func aMemoryCardIsDrawnFromTheServersWords() throws {
        let store = try store(Self.shared, Self.change, Self.removal)
        let cards = store.needs
        #expect(cards.map(\.kind) == [.memory, .memory, .memory])
        #expect(cards.map(\.title) == ["Add to the shared memory", "Change what you said", "Remove what you said"])
        #expect(cards.map { [$0.no, $0.yes] } == [["Decline", "Approve"], ["Keep it", "Change it"], ["Keep it", "Remove it"]])
        #expect(cards.map(\.who?.name) == ["Web Surfer", "Coder", "Coder"])
        // Why it waits is the server's too; the app adds when, and the bot's reason where it gave one.
        let when = [Format.shortTime("2026-10-07T09:00:00.000Z"), Format.shortTime("2026-10-07T09:05:00.000Z"), Format.shortTime("2026-10-07T09:06:00.000Z")]
        #expect(cards.map(\.meta) == ["\(when[0]) · after reading outside content", "\(when[1]) · in a run you did not start · the owner switched", "\(when[2]) · in a run you did not start"])
        // The note that comes; for a change what goes above what comes; for a removal the note that goes.
        #expect(cards.map(\.body) == [["The owner lives in Ghent."], ["Front end: React", "Front end: Svelte"], ["Uses Redis"]])
        #expect(cards.map(\.always) == [false, false, false])
        // Each is a card in its bot's chat and in Needs you.
        #expect(store.chatNeeds(.bot("coder")).map(\.key) == ["mem:p2", "mem:p3"])
        #expect(store.chatNeeds(.bot("surfer")).map(\.key) == ["mem:p1"])
        #expect(store.chatNeeds(.chief).isEmpty)
    }

    @Test func aForgetThatWaitsIsACardOfItsOwn() throws {
        let store = try store(Self.forget, Self.chiefs)
        let card = try #require(store.needs.first)
        #expect(card.title == "Forget for good")
        #expect([card.no, card.yes] == ["Keep", "Forget for good"])
        #expect(card.body == ["The gate code is MAGNOLIA · 2 chats"])
        #expect(card.memory?.guarded == true)
        // One the Chief asked for is the Chief's, in its chat.
        #expect(store.needs.last?.who?.name == "Chief of Staff")
        #expect(store.chatNeeds(.chief).map(\.key) == ["mem:p5"])
        #expect(store.chatNeeds(.bot("coder")).map(\.key) == ["mem:p4"])
    }

    @Test func aGuardedChangeIsNeverPartOfApproveAll() throws {
        let store = try store(Self.shared, Self.change, Self.removal, Self.forget)
        #expect(store.needs.filter { $0.memory?.guarded == true }.map(\.key) == ["mem:p2", "mem:p3", "mem:p4"])
        #expect(store.needs.filter { $0.memory?.withApproveAll == true }.map(\.key) == ["mem:p1"])
    }

    @Test func aCardOfAKindTheAppDoesNotKnowIsShownAndBreaksNothing() throws {
        // An action from a newer server, fields of another type, and entries that are no change at all.
        let store = try store(#"""
            { "id": "p9", "action": "merge", "text": "Two notes about Berlin become one", "botId": "coder", "bot": { "id": "coder", "name": "Coder" }, "guarded": "yes", "current": "n1", "notes": 4,
              "title": "Merge two notes", "meta": ["x"], "reason": 3, "yes": "Merge them", "no": "Leave them", "weight": { "a": 1 } }
            """#, #""a line""#, "null", "7", #"{ "action": "add", "title": "No id", "yes": "Approve", "no": "Decline" }"#, Self.shared)
        #expect(store.needs.map(\.key) == ["mem:p9", "mem:p1"])
        let card = try #require(store.needs.first)
        #expect(card.title == "Merge two notes")
        #expect(card.body == ["Two notes about Berlin become one"])
        #expect([card.no, card.yes] == ["Leave them", "Merge them"])
        #expect(card.meta.isEmpty)
        #expect(card.memory?.withApproveAll == false) // what it is cannot be told, so it is answered on its own card
    }

    @Test func aChangeWithoutTheServersWordsIsNoCard() throws {
        // The app has no words of its own for memory: without a title and both buttons nothing says what a yes would do.
        let store = try store(#"{ "id": "p1", "action": "add", "text": "Lives in Ghent", "botId": "surfer", "yes": "Approve", "no": "Decline" }"#,
                              #"{ "id": "p2", "action": "erase", "text": "x", "botId": "coder", "guarded": true, "title": "Forget for good", "yes": "", "no": "Keep" }"#)
        #expect(store.needs.isEmpty)
        #expect(store.needNotices.isEmpty)
    }

    @Test func aNotificationAboutMemoryUsesTheServersWords() throws {
        let notices = try store(Self.shared, Self.change, Self.forget, Self.chiefs).needNotices
        #expect(notices.map(\.key) == ["mem:p1", "mem:p2", "mem:p4", "mem:p5"])
        #expect(notices.map(\.title) == ["Web Surfer", "Coder", "Coder", "Chief of Staff"])
        #expect(notices.map(\.body) == [
            "Add to the shared memory · The owner lives in Ghent. · after reading outside content",
            "Change what you said · Front end: Svelte · in a run you did not start",
            "Forget for good · The gate code is MAGNOLIA · 2 chats · after reading outside content",
            "Forget for good · Ask before creating bots · in a run you did not start",
        ])
        // Approve and Decline where those are the server's words for the two buttons. A guarded change, a forget
        // among them, has no button: a click opens its card, where it is answered by itself.
        #expect(notices.map(\.actions) == [.approve, .none, .none, .none])
    }

    @Test func aServerWithoutMemoryCardsShowsNoCardAndNoNotification() throws {
        for features: Set<String> in [[], [Feature.memoryChips.rawValue, Feature.memoryForget.rawValue]] {
            let store = try store(Self.shared, Self.change, Self.forget, features: features)
            #expect(store.needs.isEmpty)
            #expect(store.needNotices.isEmpty)
            #expect(store.chatNeeds(.bot("coder")).isEmpty)
        }
    }

    @Test func aServerWithoutMemoryForgetShowsNoForgetCard() throws {
        let store = try store(Self.shared, Self.change, Self.forget, features: [Feature.memoryChips.rawValue, Feature.memoryCards.rawValue])
        #expect(store.needs.map(\.key) == ["mem:p1", "mem:p2"])
        #expect(store.needNotices.map(\.key) == ["mem:p1", "mem:p2"])
    }

    @Test func aDecidedMemoryCardReadsTheServersWord() throws {
        let card = try #require(try store(Self.forget).needs.first)
        // As the card is told its answer (NeedCard): the server's words for it, in place of the app's.
        func decided(_ yes: Bool, _ json: String) -> String { card.decided(yes: yes, said: Answered.of(Data(json.utf8)).text) }
        #expect(decided(true, #"{ "erased": ["n3"], "leftOut": ["r3"], "text": "Forgotten" }"#) == "Forgotten")
        #expect(decided(false, #"{ "declined": true, "text": "Kept" }"#) == "Kept")
        // An answer this app can't read: the answer still went, and the card says so in the app's word.
        #expect(decided(true, #"{ "text": 7 }"#) == "Approved")
        #expect(decided(false, "[]") == "Declined")
    }
}

/// The same against real botdot test servers and the stand-in Claude: a bot keeps, corrects and
/// forgets a note, and raises the cards, through its own memory tool as the server's tests do.
@MainActor
@Suite struct MemoryOnAServer {
    @MainActor final class Heard { var events: [String] = [] }

    /// A store connected to that server, once the feed's start is over: it reads the server's features
    /// again, after which a test may set them as an older server's.
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        let heard = Heard()
        store.onEvent = { name, _ in heard.events.append(name) }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { heard.events.contains("hello") }
        _ = try await server.makeBot("Bystander")
        try await eventually("the feed's start to be over") { heard.events.contains("bots") }
        return store
    }

    /// A run of that bot that is held, so its memory tool can be called: its id. `reads`: a tool the
    /// stand-in Claude asks for first, once botdot has seen it ask.
    func held(_ server: TestServer, _ id: String, _ prompt: String, asChief: Bool = false, reads: String? = nil) async throws -> String {
        try server.hold()
        let known = try server.runs()
        let run = try await server.api("bots/\(id)/run", method: "POST", body: ["prompt": prompt], asChief: asChief) as? [String: Any]
        let runId = try #require(run?["id"] as? String)
        let standIn = try await server.newRun(since: known)
        guard let reads else { return runId }
        try server.play([TestServer.uses(reads, ["url": "https://example.com"])], into: standIn)
        try await eventuallyAsync("the run to have asked for \(reads)") {
            ((try await server.api("runs/\(runId)") as? [String: Any])?["events"] as? [[String: Any]] ?? []).contains { $0["type"] as? String == "assistant" }
        }
        return runId
    }

    /// Lets the held run end, and waits until it has.
    func end(_ server: TestServer, _ run: String) async throws {
        try server.unhold()
        try await eventuallyAsync("the run to end") { (try await server.api("runs/\(run)") as? [String: Any])?["status"] as? String != "running" }
    }

    /// A note the owner typed into that bot's memory: its id.
    func note(_ server: TestServer, _ id: String, _ text: String) async throws -> String {
        let made = try await server.api("memory/notes", method: "POST", body: ["owner": id, "text": text]) as? [String: Any]
        return try #require((made?["note"] as? [String: Any])?["id"] as? String)
    }

    func notes(_ server: TestServer, _ id: String) async throws -> [String] {
        let bots = (try await server.api("memory") as? [String: Any])?["bots"] as? [[String: Any]]
        return (bots?.first { $0["id"] as? String == id }?["notes"] as? [[String: Any]] ?? []).compactMap { $0["text"] as? String }
    }

    @Test func theServerAnnouncesTheThreeFeaturesAndTheAppReadsThem() async throws {
        let server = try TestServer()
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.has(.memoryChips) && store.has(.memoryCards) && store.has(.memoryForget))
    }

    @Test func whatABotKeepsCorrectsAndForgetsIsNoChipButIsDone() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Coder")
        let store = try await connected(server)
        defer { store.disconnect() }
        store.openBot(id)
        func ended(_ run: String) -> Bool { store.botChat.runs.last.map { $0.id == run && $0.status != "running" } ?? false }
        func chips(_ run: String) throws -> [String] { store.chips(of: try #require(store.botChat.runs.first { $0.id == run })).map(\.text) }

        // It keeps a note of its own and one for every bot: the notes are kept, and no row says so (ADR 024).
        let kept = try await held(server, id, "I always use pnpm, and I live in Brussels.")
        let saved = try await server.selfTool("memory", ["action": "add", "text": "pnpm for JavaScript", "topic": "Package manager"])
        let noteId = try #require((saved["note"] as? [String: Any])?["id"] as? String)
        try await server.selfTool("memory", ["action": "add", "text": "Lives in Brussels", "scope": "shared"])
        try await end(server, kept)
        try await eventually("the run") { ended(kept) }
        #expect(try chips(kept).isEmpty)
        #expect(store.botChat.runs.last?.learned?.isEmpty ?? true)
        #expect(try await notes(server, id).contains { $0.contains("pnpm for JavaScript") })

        // It corrects it: the note changes, and no row says so.
        let corrected = try await held(server, id, "No, I switched to bun.")
        try await server.selfTool("memory", ["action": "edit", "id": noteId, "text": "bun for JavaScript", "reason": "the owner switched"])
        try await end(server, corrected)
        try await eventually("the second run") { ended(corrected) }
        #expect(try chips(corrected).isEmpty)
        #expect(try await notes(server, id).contains { $0.contains("bun for JavaScript") })

        // It forgets it: the note is erased, and no row says so.
        let forgot = try await held(server, id, "Forget what I told you about my package manager.")
        let gone = try await server.selfTool("memory", ["action": "forget", "notes": [noteId], "about": "package manager"])
        #expect(gone["result"] as? String == "forgotten")
        try await end(server, forgot)
        try await eventually("the third run") { ended(forgot) }
        #expect(try chips(forgot).isEmpty)
        await store.reloadAll()
        #expect(try chips(kept).isEmpty)
        #expect(try await notes(server, id).isEmpty)
    }

    @Test func aForgetThatWaitsIsACardInTheChatAndInNeedsYouAndIsAnsweredThere() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Coder")
        let store = try await connected(server)
        defer { store.disconnect() }
        let code = try await note(server, id, "The gate code is MAGNOLIA")

        // A run the owner did not start asks to forget: nothing is erased, and it waits on a card.
        let asking = try await held(server, id, "Forget the gate code.", asChief: true)
        let asked = try await server.selfTool("memory", ["action": "forget", "notes": [code], "about": "gate code"])
        #expect(asked["result"] as? String == "waits")
        try await eventually("the card") { store.needs.contains { $0.kind == .memory } }
        let card = try #require(store.needs.first { $0.kind == .memory })
        #expect(card.title == "Forget for good")
        #expect([card.no, card.yes] == ["Keep", "Forget for good"])
        #expect(card.meta.hasSuffix("in a run you did not start"))
        #expect(card.body == ["The gate code is MAGNOLIA"])
        #expect(card.who?.name == "Coder")
        #expect(card.memory?.action == "erase" && card.memory?.guarded == true && card.memory?.withApproveAll == false)
        #expect(store.chatNeeds(.bot(id)).map(\.key) == [card.key])
        // Its notification: the server's words, and no button, so that it is answered on its card.
        let notice = try #require(store.needNotices.first { $0.key == card.key })
        #expect([notice.title, notice.body] == ["Coder", "Forget for good · The gate code is MAGNOLIA · in a run you did not start"])
        #expect(notice.actions == NeedNotice.Actions.none)
        #expect(try await notes(server, id) == ["The gate code is MAGNOLIA"])

        // Keep: the card reads the server's word, and the note stays.
        let kept = try await store.decide(card, yes: false)
        #expect(card.decided(yes: false, started: kept.carriesOn, said: kept.text) == "Kept")
        #expect(!store.needs.contains { $0.kind == .memory })
        #expect(try await notes(server, id) == ["The gate code is MAGNOLIA"])

        // Asked again and answered "Forget for good": the note is erased.
        try await server.selfTool("memory", ["action": "forget", "notes": [code], "about": "gate code"])
        try await eventually("the card again") { store.needs.contains { $0.kind == .memory } }
        let again = try #require(store.needs.first { $0.kind == .memory })
        let forgotten = try await store.decide(again, yes: true)
        #expect(again.decided(yes: true, started: forgotten.carriesOn, said: forgotten.text) == "Forgotten")
        #expect(!store.needs.contains { $0.kind == .memory })
        #expect(try await notes(server, id).isEmpty)
        try await end(server, asking)
    }

    @Test func aChangeToWhatTheOwnerSaidWaitsOnItsOwnCard() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Coder")
        let store = try await connected(server)
        defer { store.disconnect() }
        let front = try await note(server, id, "Front end: React")

        let asking = try await held(server, id, "Tidy your notes.", asChief: true)
        let asked = try await server.selfTool("memory", ["action": "edit", "id": front, "text": "Front end: Svelte"])
        #expect(asked["result"] as? String == "waits")
        try await eventually("the card") { store.needs.contains { $0.kind == .memory } }
        let card = try #require(store.needs.first { $0.kind == .memory })
        #expect(card.title == "Change what you said")
        #expect([card.no, card.yes] == ["Keep it", "Change it"])
        #expect(card.body == ["Front end: React", "Front end: Svelte"])
        #expect(card.memory?.withApproveAll == false)
        #expect(store.needNotices.first { $0.key == card.key }?.actions == NeedNotice.Actions.none)

        let changed = try await store.decide(card, yes: true)
        #expect(card.decided(yes: true, started: changed.carriesOn, said: changed.text) == "Changed")
        #expect(try await notes(server, id) == ["Front end: Svelte"])
        try await end(server, asking)
    }

    @Test func aChangeToTheSharedMemoryAfterOutsideContentIsACardWithApproveAndDecline() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Web Surfer")
        let store = try await connected(server)
        defer { store.disconnect() }

        // The run reads a web page, then wants to tell every bot what it found.
        let run = try await held(server, id, "Find out where I live.", reads: "WebFetch")
        let asked = try await server.selfTool("memory", ["action": "add", "text": "The owner lives in Ghent.", "scope": "shared"])
        #expect(asked["result"] as? String == "waits")
        try await eventually("the card") { store.needs.contains { $0.kind == .memory } }
        let card = try #require(store.needs.first { $0.kind == .memory })
        #expect(card.title == "Add to the shared memory")
        #expect([card.no, card.yes] == ["Decline", "Approve"])
        #expect(card.meta.hasSuffix("after reading outside content"))
        #expect(card.body == ["The owner lives in Ghent."])
        #expect(card.memory?.withApproveAll == true)
        let notice = try #require(store.needNotices.first { $0.key == card.key })
        #expect([notice.title, notice.body] == ["Web Surfer", "Add to the shared memory · The owner lives in Ghent. · after reading outside content"])
        #expect(notice.actions == .approve)

        // The same server taken for one from before the cards: no card, no notification.
        store.features = []
        #expect(!store.needs.contains { $0.kind == .memory } && !store.needNotices.contains { $0.key == card.key } && store.chatNeeds(.bot(id)).isEmpty)
        store.features = MemoryChips.all

        let said = try await store.decide(card, yes: true)
        #expect(card.decided(yes: true, started: said.carriesOn, said: said.text) == "Approved")
        #expect(!store.needs.contains { $0.kind == .memory })
        let shared = (try await server.api("memory") as? [String: Any])?["shared"] as? [[String: Any]]
        #expect(shared?.compactMap { $0["text"] as? String } == ["The owner lives in Ghent."])
        try await end(server, run)
    }
}
