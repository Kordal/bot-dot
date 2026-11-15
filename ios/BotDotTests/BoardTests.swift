import XCTest
import BotdotShared
@testable import BotDot

/// The Board on the iPhone draws the shared layer's cells (BoardDesk) and hands its taps back to it.
@MainActor
final class BoardTests: XCTestCase {
    private func home() -> HomeStore { HomeStore(api: unreachableApi()) }

    func testTheScreenGetsTheSharedStateOnTheMainThread() async throws {
        let model = BoardModel(home: home())
        model.start()
        defer { model.stop() }
        for _ in 0..<50 where model.state == nil { try await Task.sleep(for: .milliseconds(20)) }
        let state = try XCTUnwrap(model.state)
        XCTAssertFalse(state.loaded, "no botdot answered: no Board is drawn as empty")
        XCTAssertEqual(state.columns, 2)
    }

    func testABoardStartedOnAWideScreenHasItsColumnsAtOnce() async throws {
        let model = BoardModel(home: home())
        model.start(width: 700)
        defer { model.stop() }
        for _ in 0..<50 where model.state?.columns != 3 { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(model.state?.columns, 3, "an iPad's or a landscape Board: three columns from its first frame")
    }

    func testATapOnATileThatIsNotThereDoesNothing() async throws {
        let model = BoardModel(home: home())
        defer { model.stop() }
        let answer = await model.tap("gone")
        let tap = try XCTUnwrap(answer)
        if case .quiet = onEnum(of: tap) {} else { XCTFail("a tile that is not there: \(tap)") }
    }

    func testAPhoneIsTwoColumnsAndATabletThree() async throws {
        XCTAssertEqual(BoardKit.shared.columns(widthDp: 390), 2)
        XCTAssertEqual(BoardKit.shared.columns(widthDp: 700), 3)
    }

    func testAgesAndColoursComeFromTheSharedWords() {
        let now = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(Board.age(Int64(1_000_000 - 65_000), now), "1 min ago")
        XCTAssertEqual(Board.tint("ok", .gray), .green)
        XCTAssertEqual(Board.tint(nil, .gray), .gray)
        XCTAssertEqual(Board.tint("not a colour", .gray), .gray)
    }
}

/// The account's parts on the iPhone: what the front door offers, What's new, the paused account.
@MainActor
final class AccountTests: XCTestCase {
    private let api = unreachableApi()

    func testABotdotWithoutAFrontDoorOffersNothing() async throws {
        let read = try await FrontDoorDesk(api: api).read(features: ["whats-new"])
        let offers = try XCTUnwrap(read)
        XCTAssertNil(offers.deletion)
        XCTAssertFalse(offers.feedback)
    }

    func testAFrontDoorNotReachedIsUnknownSoHomeAsksAgain() async throws {
        let offers = try await FrontDoorDesk(api: api).read(features: ["accounts"])
        XCTAssertNil(offers, "not read: Feedback and Delete account aren't hidden for good")
    }

    func testDeleteSendsNothingUntilTheNameIsTyped() async throws {
        let d = try await FrontDoorDesk(api: api).delete(account: "ann", typed: "an")
        XCTAssertFalse(d.done)
        XCTAssertEqual(d.words, "Type your account name, ann, to confirm")
    }

    func testWhatsNewIsNotAskedOfAServerThatDoesNotAnnounceIt() async throws {
        let notes = try await WhatsNew.shared.unseen(api: api, features: ["accounts"])
        XCTAssertTrue(notes.isEmpty)
    }

    func testAScreenshotsBytesReachTheSharedRule() {
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
        XCTAssertEqual(Feedback.shared.pictureType(b: bytesOf(data: png)), "image/png")
        XCTAssertNotNil(Feedback.shared.refusal(name: "a.txt", bytes: bytesOf(data: Data("hello".utf8))))
    }

    func testAPausedAnswerIsSaidToTheApp() async throws {
        let session = Session(keep: KeychainSessions(service: "app.botdot.session.paused-tests"))
        let watch = PausedWatch(session: session)
        defer { watch.close() }
        var seen: String??
        _ = watch.watch { server in MainActor.assumeIsolated { seen = .some(server) } }
        session.answered(server: "https://hq.example.com", api: true, sent: nil, code: 503, setCookies: [], body: { #"{"error":"Paused.","paused":true}"# })
        for _ in 0..<50 where seen != .some("https://hq.example.com") { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(seen, .some("https://hq.example.com"))
    }
}
