import XCTest
import BotdotShared
@testable import BotDot

/// A bot's settings, the app's Settings, Apps and the status keypad on the iPhone draw the shared layer's state
/// (BotSettingsDesk, AppSettingsDesk, AppsDesk, Keypad) and get the Android app's answers.
@MainActor
final class SettingsTests: XCTestCase {
    private func home() -> HomeStore { HomeStore(api: unreachableApi()) }

    private func wait(_ done: () -> Bool) async throws {
        for _ in 0..<250 where !done() { try await Task.sleep(for: .milliseconds(20)) }
    }

    func testSettingsGetTheSharedStateOnTheMainThread() async throws {
        let model = SettingsModel(home: home())
        model.start()
        defer { model.stop() }
        try await wait { model.state != nil }
        let state = try XCTUnwrap(model.state)
        XCTAssertEqual(state.address, "127.0.0.1:9")
        XCTAssertNil(state.subscription, "no front door answered: no Subscription row")
        XCTAssertEqual(state.presets.count, 3)
    }

    func testABotThatCannotBeReadSaysSoAndSavesNothing() async throws {
        let model = BotSettingsModel(home: home(), botId: "gone")
        model.start()
        defer { model.stop() }
        try await wait { model.state?.error != nil }
        XCTAssertNotNil(model.state?.error)
        XCTAssertNil(model.state?.bot)
        model.edit { $0.withName(name: "Anything") } // no bot read: nothing to edit
        XCTAssertNotEqual(model.state?.draft.name, "Anything")
    }

    func testAppsSayWhyAKeyIsNeeded() {
        let none = ConnectorsInfo(configured: false, account: nil, keyHint: nil, machine: false, error: nil, keyRejected: false, connections: [], reconnect: [])
        XCTAssertEqual(Apps.shared.keyTitle(i: none), "Add your Composio key")
        XCTAssertTrue(Apps.shared.COMPOSIO_KEYS.hasPrefix("https://"))
    }

    func testAKeysPillIsAndroidsAndOnlyNeedsYouIsLoud() {
        let s = Keypad.shared.status(running: true, needs: false, unread: 0, last: nil, runs: 2, seen: false, watching: false, lastTime: "")
        XCTAssertEqual(s.text, "Working ×2")
        XCTAssertFalse(Keypad.shared.loud(kind: s.kind))
        XCTAssertTrue(Keypad.shared.loud(kind: .needs))
        XCTAssertEqual(AppSettingsRules.shared.address(baseUrl: "https://my.botdot.app/"), "my.botdot.app")
    }

    func testTheBotColoursAreTheServersEight() {
        XCTAssertEqual(BotSettingsKt.BotColors.count, 8)
        XCTAssertEqual(BotSettingsKt.BotColors.first?.first as String?, "#1d9e75")
    }

    /// A bot's computer, skills, asking and rooms are edited through the shared draft.
    func testABotsDraftTakesItsComputerSkillsAndRooms() {
        let d = BotDraft.companion.empty().withComputer(on: true).withSkill(name: "mail", on: true).withAllowRooms(on: true)
        XCTAssertTrue(d.computer)
        XCTAssertTrue(d.skills.contains("mail"))
        XCTAssertTrue(d.rooms.allowRooms)
        XCTAssertFalse(d.withSkill(name: "mail", on: false).skills.contains("mail"))
    }

    /// A bot's scheduled jobs: the shared desk and words reach Swift (its rules are the shared JobsDeskTest's).
    func testTheJobsDeskReachesSwift() {
        let desk = home().jobs(botId: "b1")
        XCTAssertNil(desk.state.value.jobs, "the bots not read yet: nothing")
        XCTAssertEqual(Jobs.shared.CHANGE_WAITS, "A change waits for your OK")
    }
    /// Settings → Storage: the shared StorageDesk reaches Swift, and its colours and sizes are Android's.
    func testStorageIsTheSharedDesk() {
        let model = StorageModel(home: home())
        XCTAssertEqual(model.desk.state.value.title, "Storage")
        XCTAssertNil(model.desk.state.value.answer, "not read yet")
        XCTAssertFalse(model.desk.back(), "at the groups: the screen goes back")
        XCTAssertEqual(Storage.shared.size(bytes: 1_500_000), "1.5 MB")
        XCTAssertTrue(Storage.shared.shows(features: ["storage"]))
    }
    /// Settings → Skills: the shared SkillsDesk and words reach Swift.
    func testSkillsAreTheSharedDeskAndWords() {
        let model = SkillsModel(home: home())
        XCTAssertFalse(model.desk.state.value.loaded, "not read yet")
        let k = Api.companion.JSON.decodeFromString(deserializer: Skill.companion.serializer(), string: #"{"name":"deploy","usedBy":["chief"],"createdBy":"chief"}"#) as! Skill
        XCTAssertEqual(SkillWords.shared.usedLine(k: k), "Used by the Chief")
        XCTAssertEqual(model.desk.madeBy(k: k), "Made by the Chief")
    }

    /// A bot's Apps: one row per app and per account of one with two or more, ticked as the shared rules say.
    func testABotsAppsAreTheSharedRows() {
        func conn(_ json: String) -> Connection { Api.companion.JSON.decodeFromString(deserializer: Connection.companion.serializer(), string: json) as! Connection }
        let gmail = conn(#"{"id":"c1","toolkit":"gmail","status":"ACTIVE","app":{"name":"Gmail"}}"#)
        let work = conn(#"{"id":"c2","toolkit":"slack","status":"ACTIVE","accounts":2,"label":"Work","app":{"name":"Slack"}}"#)
        XCTAssertEqual(BotSettings.shared.appName(c: work), "Slack · Work")
        let on = BotSettings.shared.appToggled(c: work, on: true, connectors: [], accounts: [:])
        let connectors = on.first as? Set<String> ?? []
        let accounts = on.second as? [String: String] ?? [:]
        XCTAssertEqual(accounts["slack"], "c2", "the account of an app with two")
        XCTAssertTrue(BotSettings.shared.appPicked(c: work, connectors: connectors, accounts: accounts, botId: "b1"))
        XCTAssertFalse(BotSettings.shared.appPicked(c: gmail, connectors: connectors, accounts: accounts, botId: "b1"), "not ticked")
    }

    /// The Chief's settings: the shared ChiefSettingsDesk reaches Swift; before it is read, nothing shows.
    func testTheChiefsSettingsAreTheSharedDesk() {
        let model = ChiefSettingsModel(home: home())
        let s = model.desk.state.value
        XCTAssertFalse(s.loaded)
        XCTAssertNil(s.name, "no chief-name read yet: no Name field")
        XCTAssertNil(s.skills)
        XCTAssertNil(s.jobs)
        XCTAssertEqual(ChiefSettingsDesk.companion.SAVE_MS, 800)
        model.stop()
    }
    /// Duplicate: the shared desk and words reach Swift.
    func testDuplicateIsTheSharedDesk() {
        let desk = BotSettingsStore(home: home(), botId: "b1").duplicate(name: "Coder")
        XCTAssertNil(desk.state.value.plan, "not asked yet")
        XCTAssertFalse(desk.state.value.canGo)
        XCTAssertEqual(Duplicate.shared.made(name: "Coder 2"), "Coder 2 made")
        XCTAssertTrue(Duplicate.shared.shows(features: ["duplicate-bot"]))
    }
}
