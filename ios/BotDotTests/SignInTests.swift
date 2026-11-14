import XCTest
import BotdotShared
@testable import BotDot

/// The Swift side of the sign-in (#1359): the Keychain keeps a session per address, and the sheet's way back is read
/// by the shared layer, as on Android.
final class SignInTests: XCTestCase {
    private let keep = KeychainSessions(service: "app.botdot.session.tests")

    override func tearDown() {
        keep.write(server: "https://a.example.com", token: nil)
        keep.write(server: "https://b.example.com", token: nil)
    }

    func testEachAddressKeepsItsOwnSession() {
        keep.write(server: "https://a.example.com", token: "one")
        keep.write(server: "https://b.example.com", token: "two")
        XCTAssertEqual(keep.read(server: "https://a.example.com"), "one")
        XCTAssertEqual(keep.read(server: "https://b.example.com"), "two")
        keep.write(server: "https://a.example.com", token: "three")
        XCTAssertEqual(keep.read(server: "https://a.example.com"), "three", "a new session takes the old one's place")
        keep.write(server: "https://a.example.com", token: nil)
        XCTAssertNil(keep.read(server: "https://a.example.com"), "signed out, it is forgotten")
        XCTAssertEqual(keep.read(server: "https://b.example.com"), "two", "the other address keeps its session")
    }

    func testTheSessionCarriesTheKeptSecret() {
        let session = Session(keep: keep)
        keep.write(server: "https://a.example.com", token: "s3cret")
        XCTAssertEqual(session.cookie(server: "https://a.example.com"), "botdot_session=s3cret")
        XCTAssertNil(session.cookie(server: "https://c.example.com"))
    }

    func testTheSheetComesBackWithItsCode() {
        let code = String(repeating: "a", count: 43)
        XCTAssertEqual(Handoff.companion.codeOf(uri: "botdot://signed-in?code=\(code)"), code)
        XCTAssertTrue(Handoff.companion.isReturn(uri: "botdot://signed-in"))
        XCTAssertNil(Handoff.companion.codeOf(uri: "botdot://other?code=\(code)"), "only the sign-in's way back")
        XCTAssertNil(Handoff.companion.codeOf(uri: "botdot://signed-in?code=short"))
    }

    func testTheSignInPageIsTheIosAppsHandOff() {
        let page = Handoff.companion.start(server: "https://hq.example.com", now: 0, random: { n in
            KotlinByteArray(size: n.int32Value)
        }).page
        XCTAssertTrue(page.hasPrefix("https://hq.example.com/sign-in?app=ios&handoff="), page)
    }
}
