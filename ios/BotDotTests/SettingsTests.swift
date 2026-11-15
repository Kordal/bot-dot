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
}
