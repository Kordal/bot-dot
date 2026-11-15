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

    func testTheNoticeBeforeTheFirstMessageSaysWhereItGoes() {
        XCTAssertEqual(AiNotice.shared.text, "Your bots run on Claude by Anthropic. What you send them goes to Anthropic.")
        XCTAssertNotNil(ImageRenderer(content: AiNoticeSheet {}.frame(width: 390, height: 400)).cgImage)
    }
}
