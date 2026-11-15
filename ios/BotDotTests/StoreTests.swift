import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// What the App Store asks of the app (#1374): its privacy manifest, tracking nobody; its icon; and the notice before
/// the first message that what is sent goes to Anthropic.
@MainActor
final class StoreTests: XCTestCase {
    func testTheAppCarriesItsPrivacyManifestAndTracksNobody() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"), "the manifest is in the app")
        let manifest = try XCTUnwrap(PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
        XCTAssertEqual((manifest["NSPrivacyTrackingDomains"] as? [Any])?.count, 0)
        let apis = (manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]]) ?? []
        XCTAssertTrue(apis.contains { $0["NSPrivacyAccessedAPIType"] as? String == "NSPrivacyAccessedAPICategoryFileTimestamp" },
                      "the shared layer reads its files' times")
    }

    func testTheAppHasItsIcon() throws {
        let icons = try XCTUnwrap(Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any])
        let primary = try XCTUnwrap(icons["CFBundlePrimaryIcon"] as? [String: Any])
        XCTAssertEqual(primary["CFBundleIconName"] as? String, "AppIcon")
    }

    /// A message box's Send through the gate (Composer and a room's box alike): held for the notice; swiped away,
    /// nothing goes; Continue sends the words held, and the next send goes at once.
    func testSendIsHeldForTheNoticeAndASwipedAwayNoticeSendsNothing() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let gate = NoticeGate()
        gate.setUp(settingsIn(directory: dir.path))
        var sent: [String] = []
        func settle() async { for _ in 0..<200 where gate.checking || gate.showing == false { try? await Task.sleep(for: .milliseconds(10)) } }

        gate.send("hello") { sent.append($0) }
        gate.send("twice") { sent.append($0) } // a second tap while the first is checked
        await settle()
        XCTAssertTrue(gate.showing)
        XCTAssertEqual(sent, [])

        gate.showing = false
        gate.closed() // swiped away
        XCTAssertEqual(sent, [])

        gate.send("hello") { sent.append($0) }
        await settle()
        XCTAssertTrue(gate.showing, "asked again")
        gate.accept()
        gate.closed()
        for _ in 0..<200 where sent.isEmpty { try? await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(sent, ["hello"])

        gate.send("next") { sent.append($0) }
        for _ in 0..<200 where sent.count < 2 { try? await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(sent, ["hello", "next"])
        XCTAssertFalse(gate.showing)
    }

    func testTheNoticeBeforeTheFirstMessageSaysWhereItGoes() {
        XCTAssertEqual(AiNotice.shared.text, "Your bots run on Claude by Anthropic. What you send them goes to Anthropic.")
        XCTAssertNotNil(ImageRenderer(content: AiNoticeSheet {}.frame(width: 390, height: 400)).cgImage)
    }
}
