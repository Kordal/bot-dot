import XCTest
import BotdotShared
@testable import BotDot

/// A bot's computer screen on the iPhone draws the shared layer's state (ComputerScreen, ScreenStore) and hands its taps
/// back to it.
@MainActor
final class ScreenTests: XCTestCase {
    private func model(session: Session? = nil) -> ScreenModel {
        ScreenModel(home: HomeStore(api: Api(baseUrl: "https://botdot.invalid", session: session, quietMs: 1_000)), botId: "b")
    }

    func testAComputerThatCannotBeReachedSaysWhyAndOffersNoDone() async throws {
        let model = model()
        model.start()
        defer { model.stop() }
        for _ in 0..<250 where model.state?.state != ComputerScreen.shared.ERROR { try await Task.sleep(for: .milliseconds(20)) }
        let state = try XCTUnwrap(model.state)
        XCTAssertEqual(state.state, ComputerScreen.shared.ERROR)
        XCTAssertNil(state.url, "no page while its computer is not running")
        XCTAssertFalse(state.handBack)
        XCTAssertFalse(state.errorLine.isEmpty)
        model.control()
        let done = await model.done()
        XCTAssertFalse(done, "nothing is handed back from a screen that is not running")
    }

    func testThePageCarriesThePhonesSessionAsWKWebViewTakesIt() throws {
        let sessions = KeychainSessions(service: "app.botdot.tests.screen")
        sessions.write(server: "https://botdot.invalid", token: "abc")
        defer { sessions.write(server: "https://botdot.invalid", token: nil) }
        let model = model(session: Session(keep: sessions))
        defer { model.stop() }
        let cookie = try XCTUnwrap(model.cookie(for: URL(string: "https://botdot.invalid/computer/b/vnc.html")!))
        XCTAssertEqual(cookie.name, "botdot_session")
        XCTAssertEqual(cookie.value, "abc")
        XCTAssertEqual(cookie.domain, "botdot.invalid")
        XCTAssertTrue(cookie.isSecure)
    }

    func testNoSessionNoCookie() {
        let model = model()
        defer { model.stop() }
        XCTAssertNil(model.cookie(for: URL(string: "https://botdot.invalid/computer/b/vnc.html")!))
    }
}
