import UserNotifications
import XCTest
import BotdotShared
@testable import BotDot

/// iPhone notifications (ADR 150): the extension's opener reads the seals this repository's server made
/// (test/fixtures/push-seals.json, lib/apns.js), draws the buttons the server named, and a tap opens its target.
@MainActor
final class PushTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Case: Decodable {
            let what: String
            let sealed: String
            let threadId: String?
            let payload: PushPayload
            let opens: String
        }
        struct Refused: Decodable {
            let what: String
            let sealed: String
        }
        /// The device's 32 bytes the seals were made with (made up, base64url).
        let seed: String
        let cases: [Case]
        let refused: [Refused]
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "push-seals", withExtension: "json"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testEverySealTheServerMadeOpensToItsPayload() throws {
        let f = try fixture()
        let key = try XCTUnwrap(Seal.base64url(f.seed))
        XCTAssertEqual(key.count, 32)
        XCTAssertGreaterThanOrEqual(f.cases.count, 5)
        for c in f.cases {
            let json = try Seal.open(c.sealed, key: key)
            XCTAssertEqual(try PushPayload.of(json), c.payload, c.what)
        }
        for r in f.refused {
            XCTAssertThrowsError(try Seal.open(r.sealed, key: key), r.what)
        }
        var other = key
        other[0] ^= 1
        XCTAssertThrowsError(try Seal.open(f.cases[0].sealed, key: other), "another device's key")
    }

    func testTheExtensionShowsBotdotsWordsAndKeepsWhatATapNeeds() throws {
        let f = try fixture()
        let key = try XCTUnwrap(Seal.base64url(f.seed))
        for c in f.cases {
            // As the relay sends it: a generic alert, the seal, the thread.
            let push = UNMutableNotificationContent()
            push.title = "botdot"
            push.body = "New notification"
            push.threadIdentifier = c.threadId ?? ""
            push.userInfo = ["aps": ["mutable-content": 1], "sealed": c.sealed]
            let (shown, payload) = try XCTUnwrap(PushPayload.opened(push, key: key), c.what)
            XCTAssertEqual([shown.title, shown.body], [c.payload.title, c.payload.body], c.what)
            XCTAssertEqual(shown.threadIdentifier, c.payload.target, c.what)
            XCTAssertEqual(shown.userInfo["target"] as? String, c.payload.target, c.what)
            XCTAssertEqual(shown.userInfo["tag"] as? String, c.payload.tag, c.what)
            XCTAssertNil(shown.userInfo["sealed"], c.what)
            XCTAssertEqual(payload, c.payload, c.what)
        }
        let push = UNMutableNotificationContent()
        push.userInfo = ["sealed": f.cases[0].sealed]
        var other = key
        other[5] ^= 1
        XCTAssertNil(PushPayload.opened(push, key: other), "not opened: shown as it came")
        XCTAssertNil(PushPayload.opened(push, key: nil), "no key yet")
    }

    func testTheButtonsAreTheServersAndTheSameButtonsAreOneCategory() throws {
        let f = try fixture()
        func actions(_ i: Int) -> [String] {
            (f.cases[i].payload.category?.actions ?? []).map { "\($0.identifier)=\($0.title)" }
        }
        XCTAssertEqual(actions(0), ["reply=Reply"], f.cases[0].what)
        XCTAssertTrue(f.cases[0].payload.category?.actions.first is UNTextInputNotificationAction)
        XCTAssertEqual(actions(1), ["reply=Odpowiedz"], f.cases[1].what)
        XCTAssertEqual(actions(3), ["no=Decline and remove", "yes=Approve"], f.cases[3].what)
        XCTAssertEqual(actions(4), ["no=Decline"], f.cases[4].what)
        XCTAssertNil(f.cases[5].payload.category, f.cases[5].what)
        XCTAssertNil(f.cases[7].payload.category, f.cases[7].what)
        XCTAssertEqual(f.cases[0].payload.category?.identifier, f.cases[2].payload.category?.identifier, "Reply in English, twice")
        XCTAssertNotEqual(f.cases[0].payload.category?.identifier, f.cases[1].payload.category?.identifier)
        for a in f.cases.flatMap({ $0.payload.category?.actions ?? [] }) {
            XCTAssertTrue(a.options.contains(.authenticationRequired), "an answer waits for the unlock: \(a.identifier)")
            XCTAssertTrue([PushNotices.shared.REPLY, PushNotices.shared.NO, PushNotices.shared.YES].contains(a.identifier), "the ids the shared layer reads")
        }
    }

    func testATapOpensItsChatOrHome() async throws {
        let f = try fixture()
        let model = AppModel(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let before = Notifications.shared.model
        Notifications.shared.model = model
        defer { Notifications.shared.model = before }
        for c in f.cases {
            await Notifications.shared.handle(.init(action: UNNotificationDefaultActionIdentifier, target: c.payload.target, tag: c.payload.tag, thread: c.threadId ?? "", title: c.payload.title, text: nil))
            XCTAssertEqual(model.chatToOpen, c.opens == "chat" ? c.payload.target : nil, c.what)
            model.chatOpened()
        }
        // A seal the extension could not open: the thread is the target.
        await Notifications.shared.handle(.init(action: UNNotificationDefaultActionIdentifier, target: nil, tag: nil, thread: "chief:c1", title: "botdot", text: nil))
        XCTAssertEqual(model.chatToOpen, "chief:c1")
        await Notifications.shared.handle(.init(action: UNNotificationDismissActionIdentifier, target: "bot:b9", tag: "bot:b9", thread: "bot:b9", title: "News", text: nil))
        XCTAssertEqual(model.chatToOpen, "chief:c1", "dismissed: nothing opens")
    }

    func testTheKeyIsMadeOnceAndKeptAsThirtyTwoBytes() throws {
        let key = try XCTUnwrap(PushKey.readOrMake())
        XCTAssertEqual(key.count, 32)
        XCTAssertEqual(PushKey.readOrMake(), key)
        XCTAssertEqual(PushKey.read(), key)
        XCTAssertEqual(Seal.base64url(Seal.base64url(key)), key, "as the app hands it to its botdot")
        XCTAssertFalse(Seal.base64url(key).contains("="))
    }
}
