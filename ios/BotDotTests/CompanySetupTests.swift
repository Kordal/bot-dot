import SwiftUI
import XCTest
import BotdotShared
@testable import BotDot

/// A project's setup on the iPhone (#1366): the start screen before botdot answers, and the source chips and the
/// conversation's page drawing from what the shared layer holds.
@MainActor
final class CompanySetupTests: XCTestCase {
    private func home() -> HomeStore { HomeStore(api: Api(baseUrl: "https://botdot.invalid", session: nil, quietMs: 1_000)) }

    func testTheSetupStartsWithNothingMadeAndNothingSent() async throws {
        let model = CompanySetupModel(home: home())
        model.start(fresh: true)
        defer { model.stop() }
        for _ in 0..<50 where model.state == nil { try await Task.sleep(for: .milliseconds(20)) }
        let s = try XCTUnwrap(model.state)
        XCTAssertTrue(s.sources.isEmpty)
        XCTAssertFalse(s.going)
        let made = await model.go("   ")
        XCTAssertFalse(made, "nothing typed: nothing is made")
        XCTAssertFalse(model.addLink("   "), "nothing typed: no link")
        XCTAssertTrue(model.addLink("kitchen.example"), "the rest is botdot's to read, as on Android")
    }

    func testASourceChipAndTheConversationDraw() throws {
        let link = SourceDraft(id: "s1", kind: "link", name: "kitchen.example", url: "https://kitchen.example", size: 0, upload: nil, failed: false)
        XCTAssertNotNil(ImageRenderer(content: SourceChip(source: link) {}.frame(width: 320)).cgImage)
        let model = CompanySetupModel(home: home())
        model.start(fresh: true)
        defer { model.stop() }
        if let s = model.state {
            let page = SetupConversation(state: s, chief: "Chief of Staff", onChief: {}, onReview: {}).frame(width: 390, height: 600)
            XCTAssertNotNil(ImageRenderer(content: page).cgImage)
        }
    }
}
