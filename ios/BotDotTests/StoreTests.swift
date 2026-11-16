import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// What the App Store asks of the app (#1374): its privacy manifest, tracking nobody; its icon; and the notice before
/// the first message that what is sent goes to Anthropic.
@MainActor
final class StoreTests: XCTestCase {
    func testThePrivacyPolicyIsTheSitesPage() {
        XCTAssertEqual(Legal.privacyPolicy.absoluteString, "https://botdot.app/privacy")
    }

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

    /// Signed in on a phone that never accepted the notice: the notice in Home's place until Continue, then Home.
    func testTheSignedInScreenIsTheNoticeUntilContinueThenHome() async throws {
        let before = SharedAddress.noticeSeen
        defer { SharedAddress.noticeSeen = before }
        SharedAddress.noticeSeen = false // never accepted, in the app or a share
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let model = AppModel(directory: dir, sessions: KeychainSessions(service: "test-\(UUID().uuidString)"))
        _ = try await model.settings.setServer(url: "https://botdot.test")
        await model.start()
        XCTAssertEqual(model.screen, .signedIn("https://botdot.test"))
        XCTAssertTrue(model.showsNotice, "the notice, not Home")
        await model.acceptNotice()
        XCTAssertFalse(model.showsNotice, "Home")
        let seen = try await model.settings.aiNoticeSeenNow()
        XCTAssertTrue(seen.boolValue, "kept: never again on this phone")
    }

    /// The share extension sends nothing before the notice: it reads the flag from the App Group, which the app keeps
    /// there; accepted in a share, the app knows it too, and shows Home.
    func testTheNoticeAcceptedInTheAppOrAShareIsKnownToBoth() async throws {
        let before = SharedAddress.noticeSeen
        defer { SharedAddress.noticeSeen = before }
        SharedAddress.noticeSeen = false
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let app = AppModel(directory: dir, sessions: KeychainSessions(service: "test-\(UUID().uuidString)"))
        _ = try await app.settings.setServer(url: "https://botdot.test")
        await app.start()
        XCTAssertTrue(app.showsNotice)
        XCTAssertFalse(SharedAddress.noticeSeen, "a share would show the notice first")
        await app.acceptNotice()
        XCTAssertTrue(SharedAddress.noticeSeen, "accepted in the app: a share sends at once")

        // Accepted in a share, on a phone whose app never showed it.
        SharedAddress.noticeSeen = true
        let other = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: other) }
        let fresh = AppModel(directory: other, sessions: KeychainSessions(service: "test-\(UUID().uuidString)"))
        _ = try await fresh.settings.setServer(url: "https://botdot.test")
        await fresh.start()
        XCTAssertFalse(fresh.showsNotice, "Home, not the notice again")
        let kept = try await fresh.settings.aiNoticeSeenNow()
        XCTAssertTrue(kept.boolValue)
    }

    func testTheShareExtensionCarriesItsPrivacyManifest() throws {
        let share = try XCTUnwrap(Bundle.main.builtInPlugInsURL?.appendingPathComponent("BotDotShare.appex"))
        let url = share.appendingPathComponent("PrivacyInfo.xcprivacy")
        let manifest = try XCTUnwrap(PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
        let apis = (manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]]) ?? []
        let defaults = apis.first { $0["NSPrivacyAccessedAPIType"] as? String == "NSPrivacyAccessedAPICategoryUserDefaults" }
        XCTAssertEqual(defaults?["NSPrivacyAccessedAPITypeReasons"] as? [String], ["1C8F.1"], "the App Group it shares with the app")
    }

    func testTheNoticeBeforeTheFirstMessageSaysWhereItGoes() {
        XCTAssertEqual(AiNotice.shared.text, "Your bots run on Claude by Anthropic. What you send them goes to Anthropic.")
        XCTAssertNotNil(ImageRenderer(content: AiNoticeView {}.frame(width: 390, height: 400)).cgImage)
    }
}
