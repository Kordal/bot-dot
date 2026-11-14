import AuthenticationServices
import XCTest
import BotdotShared
@testable import BotDot

/// The app's model at its seams (#1359): one check or sign-in at a time, the sheet's way out, and a sign-out that
/// leaves another address's screen alone.
@MainActor
final class AppModelTests: XCTestCase {
    private let sessions = KeychainSessions(service: "app.botdot.session.model-tests")
    private var dirs: [URL] = []

    private func model() -> AppModel {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        dirs.append(dir)
        return AppModel(directory: dir, sessions: sessions)
    }

    override func tearDown() async throws {
        sessions.write(server: "https://hq.example.com", token: nil)
        for d in dirs { try? FileManager.default.removeItem(at: d) }
    }

    func testASecondSignInWaitsForTheFirst() async {
        let m = model()
        var opened = 0
        await m.signIn("https://hq.example.com") { _ in
            opened += 1
            await m.signIn("https://hq.example.com") { _ in opened += 1; return URL(string: "botdot://signed-in")! }
            throw ASWebAuthenticationSessionError(.canceledLogin)
        }
        XCTAssertEqual(opened, 1, "the second sign-in opened no sheet")
        XCTAssertFalse(m.busy)
    }

    func testClosingTheSheetSaysNothingAndAFailureSaysSo() async {
        let m = model()
        await m.signIn("https://hq.example.com") { _ in throw ASWebAuthenticationSessionError(.canceledLogin) }
        XCTAssertNil(m.error)
        await m.signIn("https://hq.example.com") { _ in throw ASWebAuthenticationSessionError(.presentationContextInvalid) }
        XCTAssertEqual(m.error, "The sign-in didn't come back from the browser. Sign in again.")
        XCTAssertFalse(m.busy, "Sign in can be tapped again")
    }

    func testASecondConnectWaitsForTheFirst() async {
        let m = model()
        let first = Task { await m.connect("192.0.2.1") } // TEST-NET: answers nothing while the test runs
        while !m.busy { await Task.yield() }
        m.error = "kept"
        await m.connect("other.example.com")
        XCTAssertEqual(m.error, "kept", "the second tap did nothing")
        first.cancel()
    }

    func testSigningOutLeavesAnotherAddressOnScreen() async {
        let m = model()
        sessions.write(server: "https://hq.example.com", token: "s3cret")
        m.otherAddress()
        await m.signOut("https://hq.example.com")
        XCTAssertEqual(m.screen, .address)
        XCTAssertNil(sessions.read(server: "https://hq.example.com"), "its session is forgotten all the same")
    }
}
