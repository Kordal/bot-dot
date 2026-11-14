import XCTest
import BotdotShared
@testable import BotDot

/// Swift reaches the shared data layer (BotdotShared.xcframework): what it answers is the Android app's.
final class SharedBridgeTests: XCTestCase {
    func testAnAddressIsReadAsOnAndroid() {
        XCTAssertEqual(Api.companion.normalize(input: "my-vm.tailnet.ts.net/"), "https://my-vm.tailnet.ts.net")
        XCTAssertNil(Api.companion.normalize(input: "http://example.com"), "plain HTTP to another computer is refused")
    }

    func testTheScreenShowsTheSharedAnswer() {
        XCTAssertEqual(StartView.address, "https://my-vm.tailnet.ts.net")
    }

    func testWordsComeFromTheSharedDictionary() {
        XCTAssertEqual(tr("Saved"), "Saved")
        XCTAssertEqual(tr("Ran {name}", ["name": "Ops"]), "Ran Ops")
        XCTAssertEqual(trn(2, "{n} bot", "{n} bots"), "2 bots")
    }
}
