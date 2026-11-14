import XCTest
import BotdotShared
@testable import BotDot

/// Needs you on the iPhone draws the shared layer's cards (NeedsDesk) and hands its taps back to it.
@MainActor
final class NeedsYouTests: XCTestCase {
    func testTheScreenGetsTheSharedStateOnTheMainThread() async throws {
        let model = NeedsYouModel(home: HomeStore(api: Api(baseUrl: "https://botdot.invalid", session: nil, quietMs: 1_000)))
        model.start()
        defer { model.stop() }
        for _ in 0..<50 where model.state == nil { try await Task.sleep(for: .milliseconds(20)) }
        let state = try XCTUnwrap(model.state)
        XCTAssertFalse(state.loaded, "no botdot answered: nothing is drawn as done")
        XCTAssertNil(state.allDone)
    }

    func testATapOnACardThatIsNotThereSendsNothing() async {
        let model = NeedsYouModel(home: HomeStore(api: Api(baseUrl: "https://botdot.invalid", session: nil, quietMs: 1_000)))
        defer { model.stop() }
        let url = await model.press("a:gone", NeedsDesk.companion.YES)
        XCTAssertNil(url)
    }

    func testSeveralQuestionsAreOneMessageAsOnAndroid() {
        XCTAssertEqual(NeedsDeskKt.questionsAnswer(questions: ["Which day?"], answers: [""]), "Which day?\n→ –")
    }
}
