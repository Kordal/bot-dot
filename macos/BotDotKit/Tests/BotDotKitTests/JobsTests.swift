import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct Jobs {
    @Test func aJobIsAddedChangedRunAndRemoved() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Servers")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)

        let job = try await store.addJob(id, ["name": "Disk check", "kind": "script", "script": "df -h", "cron": "0 9 * * *"])
        #expect(store.bots.first?.jobs?.first?.approved == true) // yours: no OK needed
        try await store.updateJob(id, job.id, ["cron": "30 7 * * 1-5"])
        #expect(store.bots.first?.jobs?.first?.schedule == "Weekdays at 07:30")
        #expect(try await store.runJob(id, job.id).hasPrefix("Script started"))
        try await store.removeJob(id, job.id)
        #expect(store.bots.first?.jobs?.isEmpty == true)
    }

    @Test func aScheduleIsPreviewedOrExplained() async throws {
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        let daily = await store.cronPreview("0 9 * * *")
        #expect(daily.words == "Daily at 09:00")
        #expect(daily.next.count == 3)
        #expect(daily.error == nil)
        #expect(daily.line { _ in "then" } == "Daily at 09:00. Next: then · then · then")
        // Words the app does not know itself come from the server.
        #expect(await store.cronPreview("0 8-21 * * *").words == "Every hour, 08:00 to 21:00")
        let never = await store.cronPreview("0 0 31 2 *")
        #expect(never.words == "Never runs")
        #expect(never.next.isEmpty)
        #expect(never.line { _ in "then" } == "Never runs")
        // Five fields the app itself would call custom: the words are the server's.
        #expect(Cron.describe("61 * * * *") == "Custom schedule")
        let refused = await store.cronPreview("61 * * * *")
        #expect(refused.words == "Invalid schedule")
        #expect(refused.error?.isEmpty == false)
        #expect(refused.line { _ in "then" } == refused.error)
    }

    /// A server older than the words answers `{ next }` or `{ error }` alone; one that cannot be asked answers nothing.
    @Test func aPreviewWithoutTheServersWordsSaysTheAppsOwn() async {
        #expect(CronPreview("30 7 * * 1-5", next: [.now]).words == "Weekdays at 07:30")
        #expect(CronPreview("0 8-21 * * *", when: " ", next: [.now]).words == "Custom schedule")
        #expect(CronPreview("0 8-21 * * *", when: "Every hour, 08:00 to 21:00", next: [.now]).words == "Every hour, 08:00 to 21:00")
        // What the server refuses is no schedule, whatever the app would say of it.
        let refused = CronPreview("61 * * * *", error: "Bad cron field \"61\"")
        #expect(refused.words == "Invalid schedule")
        #expect(refused.line { _ in "then" } == "Bad cron field \"61\"")
        #expect(CronPreview("61 * * * *", when: "Invalid schedule", error: "no").words == "Invalid schedule")
        // Not connected: no words, so what is shown beside the name stays, and the reason under the field.
        let alone = await Store().cronPreview("0 9 * * *")
        #expect(alone.words == nil)
        #expect(alone.error == "Not connected.")
        #expect(alone.line { _ in "then" } == "Not connected.")
    }

    /// The words beside the name while a listed time is picked.
    @Test func aListedTimeIsSaidByItsLabelAndTheJobsOwnScheduleByTheJob() throws {
        let job = try JSON.decoder.decode(Job.self, from: Data(#"{"id":"j1","name":"a","cron":"0 8-21 * * *","when":"Every hour, 08:00 to 21:00"}"#.utf8))
        #expect(Cron.listed("0 8-21 * * *", of: job) == "Every hour, 08:00 to 21:00")
        #expect(Cron.listed("0 2 * * *", of: job) == "Nightly at 02:00")
        #expect(Cron.listed("0 10 * * 1", of: job) == "Mondays at 10:00")
    }

    /// A job that takes calls: the server's words say so, and the app shows them as they came.
    @Test func aCallableJobsWordsAreTheServers() throws {
        let daily = try JSON.decoder.decode(Job.self, from: Data(#"{"id":"j1","name":"Motion","cron":"0 8 * * *","when":"Daily at 08:00, and when called","call":true}"#.utf8))
        #expect(Cron.listed(daily.cron, of: daily) == "Daily at 08:00, and when called")
        let called = try JSON.decoder.decode(Job.self, from: Data(#"{"id":"j2","name":"Door","cron":"0 4 31 2 *","when":"When called","call":true}"#.utf8))
        #expect(Cron.listed(called.cron, of: called) == "When called")
    }

    /// The views are SwiftUI no unit test draws: each of the four places reads the job's words or the preview's,
    /// and none describes a cron by itself.
    @Test func everyPlaceShowsTheJobsWords() throws {
        let ui = TestServer.repo.appending(path: "macos/BotDot/UI")
        func lines(_ file: String) throws -> [String] { try String(contentsOf: ui.appending(path: file), encoding: .utf8).components(separatedBy: "\n") }
        let files = try FileManager.default.contentsOfDirectory(atPath: ui.path).filter { $0.hasSuffix(".swift") }
        #expect(files.count > 10)
        for file in files { #expect(try lines(file).allSatisfy { !$0.contains("Cron.describe(") }, "\(file)") }
        let jobs = try lines("JobsView.swift")
        #expect(jobs.contains { $0.contains("Text(words.isEmpty ? job.schedule : words)") })
        #expect(jobs.contains { $0.contains("words = Cron.listed(expr, of: job)") })
        #expect(jobs.contains { $0.contains("if let said = answer.words { words = said }") })
        #expect(jobs.contains { $0.contains("preview = answer.line") })
        #expect(try lines("BotSettingsView.swift").contains { $0.contains("Text(\"\\(j.schedule) · ") })
        let needs = try String(contentsOf: TestServer.repo.appending(path: "macos/BotDotKit/Sources/BotDotKit/Needs.swift"), encoding: .utf8)
        #expect(needs.contains("meta: \"\\(j.schedule) · ") && !needs.contains("Cron.describe("))
    }

    @Test func aJobShowsTheServersWords() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Mail")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        let job = try await store.addJob(id, ["name": "Inbox", "kind": "ai", "cron": "0 8-21 * * *", "prompt": ""])
        #expect(job.when == "Every hour, 08:00 to 21:00")
        #expect(store.bots.first?.jobs?.first?.schedule == "Every hour, 08:00 to 21:00")
        // The Needs-you card of a job that waits for an OK says them too.
        try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": "Deals", "kind": "script", "script": "df -h", "cron": "*/30 9-17 * * 1-5", "assessment": "a rule, no AI"], asChief: true)
        try await eventually("the job to wait") { store.needs.contains { $0.title == "Deals" } }
        #expect(store.needs.first { $0.title == "Deals" }?.meta == "Every 30 min, 09:00 to 17:30, Monday to Friday · a script, no AI · added by the Chief")
    }

    @Test func aJobWithoutTheServersWordsShowsTheAppsOwn() throws {
        func job(_ json: String) throws -> Job { try JSON.decoder.decode(Job.self, from: Data(json.utf8)) }
        #expect(try job(#"{"id":"j1","name":"a","cron":"30 7 * * 1-5"}"#).schedule == "Weekdays at 07:30")
        #expect(try job(#"{"id":"j1","name":"a","cron":"0 8-21 * * *"}"#).schedule == "Custom schedule")
        #expect(try job(#"{"id":"j1","name":"a","cron":"0 8-21 * * *","when":"  "}"#).schedule == "Custom schedule")
        #expect(try job(#"{"id":"j1","name":"a","cron":"0 8-21 * * *","when":"Every hour, 08:00 to 21:00"}"#).schedule == "Every hour, 08:00 to 21:00")
    }

    @Test func schedulesInWords() {
        #expect(Cron.describe("*/15 * * * *") == "Every 15 min")
        #expect(Cron.describe("0 */3 * * *") == "Every 3 hours")
        #expect(Cron.describe("30 */2 * * *") == "Every 2 hours, at minute 30")
        #expect(Cron.describe("0 * * * *") == "Hourly")
        #expect(Cron.describe("15 * * * *") == "Hourly, at minute 15")
        #expect(Cron.describe("0 2 * * *") == "Nightly at 02:00")
        #expect(Cron.describe("30 7 * * 1-5") == "Weekdays at 07:30")
        #expect(Cron.describe("0 8 * * 0,6") == "Weekends at 08:00")
        #expect(Cron.describe("0 10 * * 3") == "Wednesdays at 10:00")
        #expect(Cron.describe("0 9 * * 7") == "Sundays at 09:00")
        #expect(Cron.describe("0 7 1 * *") == "Monthly on day 1 at 07:00")
        #expect(Cron.describe("30 7 28 9 *") == "28 Sep at 07:30")
        #expect(Cron.describe("0 0 31 2 *") == "Never runs")
        #expect(Cron.describe("0 8-21 * * *") == "Custom schedule")
        #expect(Cron.describe("foo") == "Invalid schedule")
        #expect(Cron.describe("") == "Invalid schedule")
        for p in Cron.presets { #expect(Cron.describe(p.cron) == p.label) }
    }

    /// A shape the app knows stops being that shape once a day or a month is added: "Hourly" on Mondays is not "Hourly".
    @Test func aKnownShapeWithADayOrAMonthAddedIsCustom() {
        for expr in ["*/15 * * * 1", "*/15 * 1 * *", "*/15 * * 6 *", "0 * * * 1", "0 * 5 * *", "0 */2 * * 1", "0 */2 * 6 *",
                     "0 9 * 6 *", "0 9 * 6 1", "0 9 5 * 1", "0 9 5 6 1", "0 9 * 6 1-5", "0 9 5 * 0,6"] {
            #expect(Cron.describe(expr) == "Custom schedule", "\(expr)")
        }
    }

    /// The table the server, the web page and Android are checked against too (test/fixtures/cron-words.json):
    /// the app says a schedule as the table does or says "Custom schedule", and never the expression.
    @Test func theAppsOwnWordsAreTheTablesOrCustom() throws {
        let table = try JSONSerialization.jsonObject(with: Data(contentsOf: TestServer.repo.appending(path: "test/fixtures/cron-words.json"))) as! [String: Any]
        let rows = table["rows"] as! [[String: String]]
        #expect(rows.count >= 45)
        var said = 0
        for row in rows {
            let (cron, words) = (row["cron"]!, row["words"]!)
            let own = Cron.describe(cron)
            #expect(own == words || own == "Custom schedule", "\(cron): \(own), the table says \(words)")
            #expect(!own.contains(cron) && !own.isEmpty, "\(cron)")
            if own == words { said += 1 }
        }
        #expect(said >= 19) // the shapes it knows are really said, not all "Custom schedule"
    }

    /// The same against the server's own describer (lib/cron-words.js), over every pairing of the fields below:
    /// the app's words are the server's, or "Custom schedule".
    @Test func theAppsOwnWordsNeverContradictTheServers() throws {
        let fields: [[String]] = [
            ["*", "*/15", "*/7", "*/1", "*/60", "0", "5", "30", "07", "0,30", "0-59/15", "61", "x"],
            ["*", "*/2", "*/5", "*/24", "9", "2", "02", "8-18", "9,13", "24"],
            ["*", "1", "13", "29", "30", "31", "1,15", "32", "0"],
            ["*", "2", "9", "6-8", "13", "0"],
            ["*", "1", "0", "7", "1-5", "0,6", "1,3,5", "8"],
        ]
        var all: [String] = [""]
        for f in fields { all = all.flatMap { head in f.map { head.isEmpty ? $0 : "\(head) \($0)" } } }
        all += ["0 9 * *", "0 9 * * * *", "0\u{A0}9 * * *", "\u{FEFF}0 9 * * *", "0 9\t*  * *", "0 9 * * *\u{85}"]

        let node = Process()
        node.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        node.arguments = ["node", "-e", "const {describe}=require('./lib/cron-words');const all=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(all.map(describe)))"]
        node.currentDirectoryURL = TestServer.repo
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        node.environment = env
        let (input, output) = (Pipe(), Pipe())
        node.standardInput = input
        node.standardOutput = output
        try node.run()
        let asked = try JSONSerialization.data(withJSONObject: all)
        DispatchQueue.global().async { input.fileHandleForWriting.write(asked); try? input.fileHandleForWriting.close() }
        let answer = output.fileHandleForReading.readDataToEndOfFile()
        node.waitUntilExit()
        let servers = try #require(try JSONSerialization.jsonObject(with: answer) as? [String])
        #expect(servers.count == all.count)

        var same = 0
        var wrong: [String] = []
        for (expr, server) in zip(all, servers) {
            let own = Cron.describe(expr)
            if own == server { same += 1 }
            // What the server refuses, the app may still call custom: it does not check every field's numbers.
            else if own != "Custom schedule" { wrong.append("\(expr): \(own), the server says \(server)") }
        }
        #expect(wrong.isEmpty, "\(wrong.prefix(10))")
        #expect(same > 100)
    }

    /// A job's next run: the time today, the weekday within six days, the date beyond; a time before now as ever.
    @Test func aTimeAheadIsADayThenADate() {
        let iso = ISO8601DateFormatter()
        func at(_ days: Double) -> (String, Date) { let d = Date().addingTimeInterval(days * 86400); return (iso.string(from: d), d) }
        let weekday: (Date) -> String = { $0.formatted(.dateTime.weekday(.abbreviated)) }
        let date: (Date) -> String = { $0.formatted(.dateTime.day().month(.abbreviated)) }
        for days in [2.0, 5.0, -2.0, -5.0] { let (s, d) = at(days); #expect(Format.shortTime(s) == weekday(d), "\(days) days") }
        for days in [7.0, 20.0, 400.0, -7.0, -20.0] { let (s, d) = at(days); #expect(Format.shortTime(s) == date(d), "\(days) days") }
        #expect(Format.shortTime(nil) == "")
    }
}
