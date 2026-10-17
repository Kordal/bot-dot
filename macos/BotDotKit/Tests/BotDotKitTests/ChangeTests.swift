import Foundation
import Testing
@testable import BotDotKit

/// Milestone 8 on the Mac, the cards: "Approve all" approves no script, Decline is worded by the
/// server, and a change to an approved job or tile waits beside it as a change card (docs/api.md,
/// "Decline" and "A change that waits"; ADR 013). The bots and the Board as the server sends them,
/// read without a server; the suite below asks real botdot servers.
@MainActor
@Suite struct Changes {
    static let all: Set<String> = [Feature.declineWords.rawValue, Feature.stagedChanges.rawValue, Feature.changeSummary.rawValue, Feature.memoryCards.rawValue]
    static let at = "2026-10-06T09:00:00.000Z"

    /// An approved job with a change beside it: a new text, an earlier time, a new name and a report of every run.
    static let changed = ##"""
    { "id": "j1", "name": "Morning news", "cron": "0 8 * * *", "when": "Daily at 08:00", "kind": "ai", "prompt": "Send three stories.", "approved": true, "notify": "report-only",
      "changedBy": "you", "assessment": "It writes: it needs AI.", "no": "Keep as it is", "yes": "Approve the change",
      "change": { "name": "Evening news", "kind": "ai", "when": "Daily at 07:00", "cron": "0 7 * * *", "once": null, "prompt": "Send five stories.", "script": "", "notify": "always",
                  "aiWhen": null, "timeoutSeconds": 300, "assessment": "", "by": "bot", "at": "2026-10-06T09:00:00.000Z", "summary": "Five stories instead of three, an hour earlier." } }
    """##
    /// An approved script job whose script the Chief changed.
    static let script = ##"""
    { "id": "j2", "name": "Disk check", "cron": "0 * * * *", "when": "Hourly", "kind": "script", "script": "df -h", "prompt": "Say what is full.", "aiWhen": "output", "approved": true,
      "no": "Keep as it is", "yes": "Approve the change",
      "change": { "name": "Disk check", "kind": "script", "when": "Hourly", "prompt": "Say what is full.", "script": "df -h /data", "aiWhen": "failed", "by": "chief", "at": "2026-10-06T10:00:00.000Z" } }
    """##
    /// Jobs that were never approved: two that use AI, and one that runs a script.
    static let news = #"{ "id": "a1", "name": "Evening digest", "cron": "0 18 * * *", "kind": "ai", "prompt": "Write the digest.", "approved": false, "changedBy": "bot", "no": "Decline and remove" }"#
    static let plan = #"{ "id": "a2", "name": "Monday plan", "cron": "0 8 * * 1", "kind": "ai", "prompt": "Send the plan.", "approved": false, "changedBy": "bot", "no": "Decline and remove" }"#
    static let disks = #"{ "id": "s1", "name": "Disk watch", "cron": "0 * * * *", "kind": "script", "script": "df -h", "approved": false, "changedBy": "chief", "no": "Decline and remove" }"#
    static let memory = #"[{ "id": "m1", "action": "add", "botId": "b1", "text": "Lives in Brussels", "title": "Remember", "yes": "Approve", "no": "Decline" }]"#
    static let door = ##"{ "id": "t1", "kind": "value", "title": "Door", "bot": "b1", "approved": false, "changedBy": "chief", "read": { "type": "script", "script": "cat /tmp/door" }, "no": "Decline and remove" }"##
    /// An approved tile whose script was changed: in `tiles`, where it works on, and in `pending`.
    static let lamp = ##"""
    { "id": "t2", "kind": "switch", "title": "Lamp", "section": "Home", "bot": "b1", "approved": true, "changedBy": "chief", "read": { "type": "script", "script": "lamp state" },
      "no": "Keep as it is", "yes": "Approve the change",
      "change": { "id": "t2", "kind": "switch", "title": "Desk lamp", "scripts": ["lamp state --desk"], "by": "bot", "at": "2026-10-06T11:00:00.000Z" } }
    """##

    /// A store that holds one bot with these jobs, on a server with Milestone 8 unless `features` says otherwise.
    func store(jobs: [String] = [], pending: [String] = [], tiles: [String] = [], memory: String = "[]", features: Set<String> = Changes.all) throws -> Store {
        let store = Store()
        store.features = features
        store.bots = try JSONDecoder().decode([Bot].self, from: Data(##"[{ "id": "b1", "name": "News Watcher", "color": "#1d9e75", "jobs": [\##(jobs.joined(separator: ","))] }]"##.utf8))
        store.memoryPending = try JSONDecoder().decode([MemoryChange].self, from: Data(memory.utf8))
        store.dashboard = try JSONDecoder().decode(DashboardState.self, from: Data(#"{ "sections": [], "tiles": [\#(tiles.joined(separator: ","))], "pending": [\#(pending.joined(separator: ","))], "suggestions": [] }"#.utf8))
        return store
    }

    // MARK: "Approve all"

    @Test func approveAllLeavesEveryCardThatRunsAScript() throws {
        // A job that becomes a script job with its change runs a script after the yes, as a script job does.
        let becomes = Self.changed.replacingOccurrences(of: #""kind": "ai", "when": "Daily at 07:00""#, with: #""kind": "script", "when": "Daily at 07:00""#)
        let store = try store(jobs: [Self.news, Self.plan, Self.disks, becomes], pending: [Self.door], memory: Self.memory)
        let all = ApproveAll(store.needs)
        #expect(all.items.map(\.key) == ["job:a1", "job:a2", "mem:m1"])
        #expect(all.label == "Approve 3") // the button counts what it approves
        #expect(all.line == "Disk watch, Morning news and “Door” run scripts: approve them on their cards.")
        #expect(store.needs.filter { !all.items.contains($0) }.map(\.kind) == [.job, .job, .tile]) // each still has its own card

        // One script left; none; and a change that changes words only is approved with the rest.
        #expect(ApproveAll(try self.store(jobs: [Self.news, Self.plan, Self.disks]).needs).line == "Disk watch runs a script: approve it on its card.")
        let words = ApproveAll(try self.store(jobs: [Self.news, Self.changed]).needs)
        #expect(words.label == "Approve 2" && words.line == nil)
        #expect(words.items.map(\.key) == ["job:a1", "job:j1:change:\(Self.at)"])
    }

    @Test func withOnlyScriptsWaitingThereIsNoApproveAll() throws {
        let scripts = ApproveAll(try store(jobs: [Self.disks, Self.script], pending: [Self.door]).needs)
        #expect(scripts.items.isEmpty && scripts.label == nil && scripts.line == nil)
        // One thing to approve is approved on its card: no button for it, and no line about the rest.
        let one = ApproveAll(try store(jobs: [Self.news, Self.disks]).needs)
        #expect(one.label == nil && one.line == nil)
        #expect(ApproveAll([]).label == nil)
    }

    @Test func approveAllApprovesNoScriptOnAnyServer() throws {
        // What the button approves is the app's own rule: it holds against a server from before Milestone 8 too.
        let all = ApproveAll(try store(jobs: [Self.news, Self.plan, Self.disks], pending: [Self.door], features: []).needs)
        #expect(all.items.map(\.key) == ["job:a1", "job:a2"])
        #expect(all.label == "Approve 2")
        #expect(all.line == "Disk watch and “Door” run scripts: approve them on their cards.")
    }

    // MARK: Decline

    @Test func declineIsWordedByTheServerAndSaysThatItRemoves() throws {
        let store = try store(jobs: [Self.news], pending: [Self.door])
        let (job, tile) = (store.needs[0], store.needs[1])
        #expect([job.no, job.yes] == ["Decline and remove", "Approve"])
        #expect(job.noSaid) // the button says what it does: nothing is asked before it is sent
        #expect([tile.no, tile.yes] == ["Decline and remove", "Approve"])
        #expect(job.change == nil && tile.change == nil)
        #expect(job.key == "job:a1")

        // What the card reads afterwards is the server's too.
        let said = Answered.of(Data(#"{ "ok": true, "removed": true, "text": "Declined and removed" }"#.utf8))
        #expect(said.text == "Declined and removed")
        #expect(job.decided(yes: false, said: said.text) == "Declined and removed")
        #expect(job.decided(yes: false) == "Declined")
        #expect(job.decided(yes: true, always: true, said: "Changed: Daily at 07:00") == "Always approved") // the app's own word stays
        for none in [#"{ "ok": true }"#, #"{ "text": "" }"#, #"{ "text": 7 }"#, #"{ "text": ["a"] }"#, "not json"] {
            #expect(Answered.of(Data(none.utf8)).text == nil, "\(none)")
        }

        // A job without `no`, and words this app can't read, keep the app's own word.
        for odd in [#""changedBy": "bot""#, #""changedBy": "bot", "no": "  ""#, #""changedBy": "bot", "no": { "a": 1 }"#, #""changedBy": "bot", "no": null"#] {
            let job = try #require(try self.store(jobs: [Self.news.replacingOccurrences(of: #""changedBy": "bot", "no": "Decline and remove""#, with: odd)]).needs.first, "\(odd)")
            #expect(job.no == "Decline" && !job.noSaid, "\(odd)")
        }
    }

    @Test func aServerWithoutDeclineWordsKeepsDecline() throws {
        // The words are there all the same: the app asks `features` before it uses them.
        let store = try store(jobs: [Self.news], pending: [Self.door], features: [Feature.stagedChanges.rawValue])
        #expect(store.needs.map(\.no) == ["Decline", "Decline"])
        #expect(!store.needs[0].noSaid) // "Remove this job?" is asked, as before
    }

    // MARK: a change that waits

    @Test func aChangeCardNamesEveryFieldThatChangesAndShowsTheServersSentence() throws {
        let store = try store(jobs: [Self.changed])
        let item = try #require(store.needs.first)
        #expect(item.kind == .job)
        #expect(item.title == "Morning news: a change")
        #expect(item.meta == "now Daily at 08:00 → Daily at 07:00 · renamed “Evening news” · uses AI · changed by itself")
        let card = try #require(item.change)
        #expect(card.summary == "Five stories instead of three, an hour earlier.")
        #expect(card.textWas == "Send three stories." && card.text == "Send five stories.")
        #expect(card.scriptsWas.isEmpty && card.scripts.isEmpty)
        #expect(card.also == ["Tells you: only when it has something to report → after every run"])
        #expect(card.line == "Runs as you approved it until you answer.")
        // Closed, the sentence stands for what goes and what comes; a click brings them.
        #expect(!card.showsFull(open: false) && card.showsFull(open: true))
        #expect(ChangeCard.seeFull == "Click to see the full change")
        #expect(item.body.isEmpty)
        #expect(item.why == "It writes: it needs AI.")
        #expect([item.no, item.yes] == ["Keep as it is", "Approve the change"])
        #expect(item.noSaid && item.always && !item.runsScript)
        #expect(item.chat == .bot("b1"))
        #expect(item.who?.name == "News Watcher")
    }

    @Test func aChangedScriptShowsTheApprovedOneAboveTheNewOne() throws {
        let item = try #require(try store(jobs: [Self.script]).needs.first)
        #expect(item.title == "Disk check: a change")
        #expect(item.meta == "Hourly · a script, no AI · changed by the Chief")
        let card = try #require(item.change)
        #expect(card.summary == nil && card.showsFull(open: false)) // without a sentence the card shows it all
        #expect(card.scriptsWas == ["df -h"] && card.scripts == ["df -h /data"])
        #expect(card.wasLabel == "Approved script" && card.nowLabel == "New script")
        #expect(card.textWas == nil && card.text == "Then the AI is asked: Say what is full.")
        #expect(card.also == ["Asks the AI: only when it prints something → only when it fails"])
        #expect(item.runsScript)
        #expect(item.chat == .chief)

        // A job that the change turns into a script job: the script it would run, and nothing above it.
        let becomes = Self.changed.replacingOccurrences(of: #""kind": "ai", "when": "Daily at 07:00""#, with: #""kind": "script", "when": "Daily at 07:00""#)
            .replacingOccurrences(of: #""script": "", "notify""#, with: #""script": "curl news", "notify""#)
        let turned = try #require(try store(jobs: [becomes]).needs.first)
        #expect(turned.meta == "now Daily at 08:00 → Daily at 07:00 · renamed “Evening news” · a script, no AI · changed by itself")
        #expect(turned.change?.scriptsWas == [] && turned.change?.scripts == ["curl news"])
        #expect(turned.change?.wasLabel == nil && turned.change?.nowLabel == nil)
        #expect(turned.change?.textWas == "Then the AI is asked: Send three stories." && turned.change?.text == "Then the AI is asked: Send five stories.")
        #expect(turned.runsScript)
    }

    @Test func aFieldTheChangeLeavesOutReadsAsUnchanged() throws {
        let bare = ##"{ "id": "j3", "name": "Digest", "cron": "0 9 * * *", "when": "Daily at 09:00", "kind": "ai", "prompt": "Write it.", "approved": true, "change": { "prompt": "Write it short.", "at": 7 } }"##
        let item = try #require(try store(jobs: [bare]).needs.first)
        #expect(item.meta == "Daily at 09:00 · uses AI · changed")
        #expect(item.change?.textWas == "Write it." && item.change?.text == "Write it short.")
        #expect(item.change?.also == [] && item.change?.summary == nil)
        // The server's words for the buttons are missing: the app's own, which are Android's.
        #expect([item.no, item.yes] == ["Keep as it is", "Approve the change"])
        #expect(item.key == "job:j3:change:") // it does not say when it was proposed
    }

    @Test func anAnsweredChangeIsKeyedByTheChange() throws {
        let first = try #require(try store(jobs: [Self.changed]).needs.first)
        #expect(first.key == "job:j1:change:2026-10-06T09:00:00.000Z")
        // A second change to the same job, proposed after the first was answered, is a card of its own.
        let second = try #require(try store(jobs: [Self.changed.replacingOccurrences(of: #""at": "2026-10-06T09:00:00.000Z""#, with: #""at": "2026-10-06T12:30:00.000Z""#)]).needs.first)
        #expect(second.key == "job:j1:change:2026-10-06T12:30:00.000Z")
        // A job that was never approved keeps the key it had, and a tile's change has its own too.
        #expect(try store(jobs: [Self.news]).needs.first?.key == "job:a1")
        #expect(try store(pending: [Self.lamp], tiles: [Self.lamp]).needs.first?.key == "tile:t2:change:2026-10-06T11:00:00.000Z")

        // After the answer the card reads the server's words for it.
        #expect(first.decided(yes: true, started: CarriesOn(text: "it carries on"), said: "Changed: Daily at 07:00") == "Changed: Daily at 07:00 · it carries on")
        #expect(first.decided(yes: false, said: "Kept as it was: Daily at 08:00") == "Kept as it was: Daily at 08:00")
    }

    @Test func aChangedTileKeepsWorkingAndItsCardShowsBothScripts() throws {
        // The approved tile is in `tiles` and in `pending`: one card.
        let store = try store(pending: [Self.lamp], tiles: [Self.lamp])
        #expect(store.needs.count == 1)
        let item = try #require(store.needs.first)
        #expect(item.kind == .tile)
        #expect(item.title == "Lamp: a change")
        #expect(item.meta == "Home · renamed “Desk lamp” · a script, no AI · changed by itself")
        #expect(item.change?.scriptsWas == ["lamp state"] && item.change?.scripts == ["lamp state --desk"])
        #expect(item.change?.line == "Runs as you approved it until you answer.")
        #expect(item.body.isEmpty)
        #expect([item.no, item.yes] == ["Keep as it is", "Approve the change"])
        #expect(item.chat == .bot("b1"))
        // It works on while its change waits: the Board does not draw it as waiting.
        #expect(!store.dashboard.waits(store.dashboard.tiles[0]))
        // A server that lists it in `tiles` only: the card is there all the same.
        #expect(try self.store(tiles: [Self.lamp]).needs.map(\.key) == ["tile:t2:change:2026-10-06T11:00:00.000Z"])

        // A tile that was never approved is as before, and the Board draws it as waiting.
        let new = try self.store(pending: [Self.door], tiles: [Self.door])
        #expect(new.needs.first?.title == "Put “Door” on your Board?")
        #expect(new.needs.first?.change == nil && new.needs.first?.body == ["cat /tmp/door"])
        #expect(new.dashboard.waits(new.dashboard.tiles[0]))
    }

    @Test func aChangeThisAppCannotReadIsNoChangeAndTheBotsAreStillRead() throws {
        for odd in [#""a change""#, "7", "true", #"["a"]"#, "null"] {
            let job = Self.changed.replacingOccurrences(of: #""change": {"#, with: #""change": \#(odd), "was": {"#)
            let tile = Self.lamp.replacingOccurrences(of: #""change": {"#, with: #""change": \#(odd), "was": {"#)
            let store = try store(jobs: [job, Self.news], pending: [tile], tiles: [tile])
            // The approved job waits for nothing; the job that was never approved has its card.
            #expect(store.needs.map(\.key) == ["job:a1", "tile:t2:10"], "\(odd)")
        }
        // Fields of another kind cost that field alone.
        let odd = Self.changed.replacingOccurrences(of: #""name": "Evening news", "kind": "ai", "when": "Daily at 07:00""#, with: #""name": 7, "kind": ["ai"], "when": { "a": 1 }"#)
            .replacingOccurrences(of: #""summary": "Five stories instead of three, an hour earlier.""#, with: #""summary": { "no": "text" }"#)
        let item = try #require(try store(jobs: [odd]).needs.first)
        #expect(item.meta == "Daily at 08:00 · uses AI · changed by itself")
        #expect(item.change?.summary == nil && item.change?.text == "Send five stories.")
    }

    @Test func aServerWithoutStagedChangesShowsNoChangeCard() throws {
        // An approved job is approved and running, as before: nothing waits. The app asks `features` first.
        let old = try store(jobs: [Self.changed, Self.script, Self.news], pending: [Self.lamp], tiles: [Self.lamp], features: [])
        #expect(old.needs.map(\.key) == ["job:a1", "tile:t2:10"])
        #expect(old.needs[0].no == "Decline" && old.needs[0].change == nil)
        #expect(old.needs[1].title == "Put “Lamp” on your Board?" && old.needs[1].change == nil)
        // The server's sentence is shown only by its own feature.
        let silent = try store(jobs: [Self.changed], features: [Feature.stagedChanges.rawValue])
        #expect(silent.needs.first?.change != nil && silent.needs.first?.change?.summary == nil)
        #expect(silent.needs.first?.change?.showsFull(open: false) == true)
    }

    // MARK: the notification

    @Test func aNotificationsButtonsReadTheCardsWords() throws {
        let store = try store(jobs: [Self.news, Self.changed, Self.script, Self.disks], memory: Self.memory)
        let notices = Dictionary(uniqueKeysWithValues: store.needNotices.map { ($0.key, $0) })
        let new = try #require(notices["job:a1"])
        #expect(new.actions == .approve && new.no == "Decline and remove" && new.yes == "Approve" && !new.keeps)
        #expect(new.category == "approve:Approve|Decline and remove")
        let change = try #require(notices["job:j1:change:\(Self.at)"])
        #expect(change.actions == .approve && change.no == "Keep as it is" && change.yes == "Approve the change" && change.keeps)
        #expect(change.category == "approve-keeps:Approve the change|Keep as it is")
        // A change that touches a script is approved on its card, where the script shows.
        let script = try #require(notices["job:j2:change:2026-10-06T10:00:00.000Z"])
        #expect(script.actions == .decline && script.no == "Keep as it is" && script.yes == nil && script.keeps)
        // A memory card with Approve and Decline has the category it had.
        #expect(notices["mem:m1"]?.category == "approve")

        let old = try self.store(jobs: [Self.news, Self.disks], features: [])
        #expect(old.needNotices.map(\.category) == ["approve", "approve"])
        #expect(old.needNotices.allSatisfy { $0.no == nil && $0.yes == nil })
    }

    @Test func aScriptJobThatWasNeverApprovedIsApprovedOnItsCard() throws {
        // Where the feed says so for the phone (`needs-text`): Decline alone, in the card's words.
        let store = try store(jobs: [Self.news, Self.disks], features: Self.all.union([Feature.needsText.rawValue]))
        let notices = Dictionary(uniqueKeysWithValues: store.needNotices.map { ($0.key, $0) })
        let script = try #require(notices["job:s1"])
        #expect(script.actions == .decline && script.no == "Decline and remove" && script.yes == nil && !script.keeps)
        #expect(script.category == "decline:|Decline and remove")
        // A job that uses AI says what it does in its line, and keeps its yes.
        #expect(notices["job:a1"]?.actions == .approve)
        // A server from before sends the phone no such word, and the Mac's notification is as it was.
        let old = try self.store(jobs: [Self.disks])
        #expect(old.needNotices.map(\.actions) == [.approve])
    }

    @Test func alwaysAllowThisActionAsksFirstAndAnAnsweredCardReadsAndroidsWords() throws {
        #expect(ConnectorCard.alwaysQuestion == "Allow this exact connector action for this bot in future runs, with any arguments?")
        #expect(ConnectorCard.alwaysYes == "Always allow")
        // After the answer: "Approved" for an action and for a changed bot, "Allowed" for a permission.
        let needs = try Cards().store(Cards.mail, Cards.change, Cards.permission).needs
        #expect(needs.map { $0.decided(yes: true) } == ["Approved", "Approved", "Allowed"])
        #expect(needs[0].decided(yes: true, always: true) == "Always allowed")
        #expect(try store(jobs: [Self.news]).needs.first?.decided(yes: true, always: true) == "Always approved")
    }
}

/// The same against real botdot test servers.
@MainActor
@Suite struct ChangesOnAServer {
    nonisolated static func script() -> [String: Any] { ["name": "Disk check", "kind": "script", "cron": "0 * * * *", "script": "df -h", "assessment": "A clear rule: no AI needed."] }

    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    @Test func aChangeToAnApprovedJobWaitsBesideItAndEachAnswerIsTheServers() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Disk Keeper")
        let job = try await server.api("bots/\(id)/jobs", method: "POST", body: Self.script()) as? [String: Any]
        let jobId = try #require(job?["id"] as? String)
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.has(.stagedChanges) && store.has(.changeSummary) && store.has(.declineWords)) // read from the server's `features`
        #expect(store.needs.isEmpty) // the owner's own job is approved

        // The Chief changes its script: the job stays approved, and the change waits as a card.
        try await server.api("bots/\(id)/jobs/\(jobId)", method: "PUT", body: ["script": "df -h /data", "summary": "Checks /data instead of the whole disk."], asChief: true)
        try await store.loadBots()
        let waiting = try #require(store.bots.first { $0.id == id }?.jobs?.first)
        #expect(waiting.approved == true && waiting.script == "df -h")
        let card = try #require(store.needs.first)
        #expect(card.title == "Disk check: a change")
        #expect(card.change?.summary == "Checks /data instead of the whole disk.")
        #expect(card.change?.scriptsWas == ["df -h"] && card.change?.scripts == ["df -h /data"])
        #expect([card.no, card.yes] == ["Keep as it is", "Approve the change"])
        #expect(card.key.hasPrefix("job:\(jobId):change:2"))
        #expect(ApproveAll(store.needs).label == nil) // it runs a script
        #expect(store.chatNeeds(.chief).map(\.key) == [card.key])

        // "Keep as it is": the job is as approved and nothing was removed.
        let kept = try await store.decide(card, yes: false)
        #expect(kept.text?.hasPrefix("Kept as it was: ") == true)
        #expect(card.decided(yes: false, said: kept.text) == kept.text)
        #expect(store.needs.isEmpty)
        #expect(store.bots.first { $0.id == id }?.jobs?.first?.script == "df -h")

        // A second change is a card of its own, and its yes changes the job.
        try await server.api("bots/\(id)/jobs/\(jobId)", method: "PUT", body: ["script": "df -h /home"], asChief: true)
        try await store.loadBots()
        let second = try #require(store.needs.first)
        #expect(second.key != card.key)
        #expect(second.change?.summary == nil && second.change?.scripts == ["df -h /home"])
        let changed = try await store.decide(second, yes: true)
        #expect(changed.text?.hasPrefix("Changed: ") == true)
        #expect(store.needs.isEmpty)
        #expect(store.bots.first { $0.id == id }?.jobs?.first?.script == "df -h /home")
    }

    @Test func declineOnANewJobReadsTheServersWordsAndRemovesIt() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Disk Keeper")
        try await server.api("bots/\(id)/jobs", method: "POST", body: Self.script(), asChief: true)
        let store = try await connected(server)
        defer { store.disconnect() }
        let card = try #require(store.needs.first { $0.kind == .job })
        #expect(card.title == "Disk check" && card.no == "Decline and remove" && card.noSaid)
        let said = try await store.decide(card, yes: false)
        #expect(said.text == "Declined and removed")
        #expect(card.decided(yes: false, said: said.text) == "Declined and removed")
        #expect(store.bots.first { $0.id == id }?.jobs?.isEmpty == true)
    }

    @Test func againstAServerWithoutTheseFeaturesTheCardsAndTheirAnswersAreAsBefore() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Disk Keeper")
        let job = try await server.api("bots/\(id)/jobs", method: "POST", body: Self.script()) as? [String: Any]
        let jobId = try #require(job?["id"] as? String)
        try await server.api("bots/\(id)/jobs/\(jobId)", method: "PUT", body: ["script": "df -h /data", "summary": "Checks /data."], asChief: true)
        try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": "Tidy", "kind": "script", "cron": "0 2 * * *", "script": "rm -rf /tmp/x", "assessment": "A clear rule."], asChief: true)
        let store = try await CardsOnAServer().connected(server) // once the feed's start is over: it reads the features again
        defer { store.disconnect() }
        store.features = [] // from here the app takes it for a botdot server from before Milestone 8

        // The test server still sends `change`, `no` and `text`, which such an app does not look at.
        #expect(store.bots.first { $0.id == id }?.jobs?.first?.change != nil)
        #expect(store.needs.map(\.title) == ["Tidy"])
        let card = try #require(store.needs.first)
        #expect(card.no == "Decline" && !card.noSaid && card.change == nil)
        let said = try await store.decide(card, yes: false)
        #expect(said.text == nil)
        #expect(card.decided(yes: false, said: said.text) == "Declined")
    }

    @Test func approveAllApprovesWhatACardShowsInWordsAndTheScriptStillWaits() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Reporter")
        // In one run the bot adds two jobs that use AI and one that runs a script.
        try server.hold()
        let known = try server.runs()
        try await server.api("bots/\(id)/run", method: "POST", body: ["prompt": "Set up my reports"])
        _ = try await server.newRun(since: known)
        for (name, cron) in [("Morning report", "0 9 * * *"), ("Evening report", "0 18 * * *")] {
            try await server.selfTool("jobs", ["action": "add", "name": name, "kind": "ai", "cron": cron, "prompt": "Write the report.", "assessment": "It writes: it needs AI."])
        }
        try await server.selfTool("jobs", ["action": "add", "name": "Disk check", "kind": "script", "cron": "0 * * * *", "script": "df -h", "assessment": "A clear rule: no AI needed."])
        try server.unhold()
        let store = try await connected(server)
        defer { store.disconnect() }

        try await eventually("the three jobs to wait") { store.needs.filter { $0.kind == .job }.count == 3 }
        let all = ApproveAll(store.needs)
        #expect(all.label == "Approve 2")
        #expect(all.items.map(\.title).sorted() == ["Evening report", "Morning report"])
        #expect(all.line == "Disk check runs a script: approve it on its card.")
        for item in all.items { try await store.decide(item, yes: true) }
        // The script was approved by nobody: it still waits, on its own card.
        #expect(store.needs.filter { $0.kind == .job }.map(\.title) == ["Disk check"])
        let jobs = try #require(store.bots.first { $0.id == id }?.jobs)
        #expect(jobs.filter { $0.approved == true }.map(\.name).sorted() == ["Evening report", "Morning report"])
        #expect(ApproveAll(store.needs).label == nil)
    }
}
